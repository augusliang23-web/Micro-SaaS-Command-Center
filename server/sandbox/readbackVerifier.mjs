/**
 * Strict verification of `docker inspect` output against the intended sandbox configuration.
 *
 * Rule: a property supports LOCALLY_VERIFIED only if Docker EXPLICITLY reports the expected safe value.
 * A missing field is never equivalent to false / [] / {} / "" — it is reported as `missing`
 * (POLICY_READBACK_INCOMPLETE). A present-but-unsafe value is a `failure` (POLICY_READBACK_MISMATCH).
 * Docker 29.x reports every field checked here explicitly (null, [], "", {} or a value), so this loses nothing.
 */

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => isRecord(o) && Object.hasOwn(o, k);
const emptyList = (v) => v === null || (Array.isArray(v) && v.length === 0);
const emptyMap = (v) => v === null || (isRecord(v) && Object.keys(v).length === 0);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Exactly the representations Docker uses for "no-new-privileges: on". `=false` / `:false` / anything else fails.
const NO_NEW_PRIVILEGES = new Set(['no-new-privileges', 'no-new-privileges=true', 'no-new-privileges:true']);

function sizeBytes(token) {
  const m = /^size=(\d+)([kmg]?)$/i.exec(token);
  if (!m) return null;
  return Number(m[1]) * ({ '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase()]);
}

/** Compare tmpfs option strings as sets (order-insensitive) with size compared numerically. Weaker options fail. */
export function tmpfsOptionsEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const split = (s) => s.split(',').map((t) => t.trim()).filter(Boolean);
  const a = split(actual); const e = split(expected);
  const aSize = a.filter((t) => t.startsWith('size=')); const eSize = e.filter((t) => t.startsWith('size='));
  if (aSize.length !== 1 || eSize.length !== 1 || sizeBytes(aSize[0]) === null || sizeBytes(aSize[0]) !== sizeBytes(eSize[0])) return false;
  const aRest = a.filter((t) => !t.startsWith('size=')).sort(); const eRest = e.filter((t) => !t.startsWith('size=')).sort();
  return aRest.length === eRest.length && aRest.every((t, i) => t === eRest[i]);
}

/**
 * @returns {{ ok: boolean, failures: string[], missing: string[], checks: Record<string, boolean> }}
 */
export function verifyContainerReadback(info, { plan, image, user }) {
  const failures = []; const missing = []; const checks = {};
  const record = (name, present, safe) => {
    if (!present) { missing.push(name); checks[name] = false; } else if (!safe) { failures.push(name); checks[name] = false; } else checks[name] = true;
  };
  if (!isRecord(info) || !isRecord(info.HostConfig) || !isRecord(info.Config)) {
    return { ok: false, failures, missing: ['HostConfig/Config'], checks };
  }
  const hc = info.HostConfig; const cfg = info.Config;
  const field = (name, key, safe) => record(name, has(hc, key), has(hc, key) && safe(hc[key]));

  const expectedNet = plan.policy.network === 'NO_NETWORK' ? ['none'] : ['bridge', 'default'];
  field('networkMode', 'NetworkMode', (v) => typeof v === 'string' && expectedNet.includes(v));
  field('privileged', 'Privileged', (v) => v === false);
  field('capDrop', 'CapDrop', (v) => Array.isArray(v) && v.length === 1 && v[0] === 'ALL');
  field('capAdd', 'CapAdd', emptyList);
  field('securityOpt', 'SecurityOpt', (v) => Array.isArray(v) && v.length === 1 && NO_NEW_PRIVILEGES.has(v[0]));
  field('readonlyRootfs', 'ReadonlyRootfs', (v) => v === true);
  field('pidMode', 'PidMode', (v) => v === '');
  field('ipcMode', 'IpcMode', (v) => v === 'private');
  field('usernsMode', 'UsernsMode', (v) => v === '');
  field('utsMode', 'UTSMode', (v) => v === '');
  field('devices', 'Devices', emptyList);
  field('deviceCgroupRules', 'DeviceCgroupRules', emptyList);
  field('deviceRequests', 'DeviceRequests', emptyList);
  field('portBindings', 'PortBindings', emptyMap);
  field('publishAllPorts', 'PublishAllPorts', (v) => v === false);
  field('links', 'Links', emptyList);
  field('binds', 'Binds', emptyList);
  field('volumesFrom', 'VolumesFrom', emptyList);
  field('memory', 'Memory', (v) => isNum(v) && v === plan.policy.memoryMb * 1024 * 1024);
  field('memorySwap', 'MemorySwap', (v) => isNum(v) && v === plan.policy.memoryMb * 1024 * 1024);
  field('nanoCpus', 'NanoCpus', (v) => isNum(v) && v === Math.round(plan.policy.cpus * 1e9));
  field('pidsLimit', 'PidsLimit', (v) => isNum(v) && v === plan.policy.pids);
  record('logDriver', has(hc, 'LogConfig') && has(hc.LogConfig, 'Type'), hc.LogConfig?.Type === 'none');

  // tmpfs: the COMPLETE intended options, not just the destination path. If none are intended, none may exist.
  const expectedTmpfs = plan.tmpfs;
  if (Object.keys(expectedTmpfs).length === 0) {
    // Missing is not "none": Docker must explicitly report an empty map. (Real Docker 29.x OMITS the field when no tmpfs
    // exists, so such a configuration cannot be verified and fails closed as INCOMPLETE rather than being assumed safe.)
    record('tmpfs', has(hc, 'Tmpfs'), isRecord(hc.Tmpfs) && Object.keys(hc.Tmpfs).length === 0);
  } else {
    const actual = hc.Tmpfs;
    const present = has(hc, 'Tmpfs') && isRecord(actual);
    const same = present && Object.keys(actual).sort().join('\0') === Object.keys(expectedTmpfs).sort().join('\0')
      && Object.entries(expectedTmpfs).every(([dst, opts]) => tmpfsOptionsEqual(actual[dst], opts));
    record('tmpfs', present, same);
  }

  record('user', has(cfg, 'User'), cfg.User === user);
  record('workingDir', has(cfg, 'WorkingDir'), cfg.WorkingDir === '/workspace');
  record('image', has(cfg, 'Image') && has(info, 'Image'), cfg.Image === plan.image.reference && info.Image === image.imageId);
  record('labels', has(cfg, 'Labels') && isRecord(cfg.Labels), isRecord(cfg.Labels) && cfg.Labels['cc.sandbox'] === '1' && cfg.Labels['cc.sandbox.id'] === plan.sandboxId);

  const mountsPresent = Array.isArray(info.Mounts) && info.Mounts.every((m) => isRecord(m) && typeof m.Type === 'string' && typeof m.Source === 'string' && typeof m.Destination === 'string' && typeof m.RW === 'boolean');
  const mounts = mountsPresent ? info.Mounts.map((m) => ({ type: m.Type, source: m.Source, destination: m.Destination, rw: m.RW })).sort((a, b) => a.destination.localeCompare(b.destination)) : [];
  const expectedMounts = plan.mounts.map((m) => ({ type: 'bind', source: m.source, destination: m.destination, rw: m.rw })).sort((a, b) => a.destination.localeCompare(b.destination));
  record('mounts', mountsPresent, JSON.stringify(mounts) === JSON.stringify(expectedMounts));
  // The workspace bind must be non-recursive. Docker reports it as HostConfig.Mounts[].BindOptions.NonRecursive (explicit true);
  // absence of the list or of the flag is INCOMPLETE, not "recursive is fine".
  const hcMounts = hc.Mounts;
  const wsMount = Array.isArray(hcMounts) ? hcMounts.find((m) => isRecord(m) && m.Target === '/workspace') : undefined;
  record('workspaceNonRecursive', isRecord(wsMount) && isRecord(wsMount.BindOptions) && has(wsMount.BindOptions, 'NonRecursive'), wsMount?.BindOptions?.NonRecursive === true);
  record('dockerSocket', mountsPresent, !/docker\.sock/.test(JSON.stringify({ mounts: info.Mounts, hc })));

  const envPresent = Array.isArray(cfg.Env) && cfg.Env.every((e) => typeof e === 'string' && e.includes('='));
  if (!envPresent) record('env', false, false);
  else {
    const env = Object.fromEntries(cfg.Env.map((e) => { const i = e.indexOf('='); return [e.slice(0, i), e.slice(i + 1)]; }));
    const extra = Object.keys(env).filter((k) => !(k in plan.env) && !image.envKeys.includes(k));
    record('env', true, Object.entries(plan.env).every(([k, v]) => env[k] === v) && extra.length === 0);
  }
  return { ok: failures.length === 0 && missing.length === 0, failures, missing, checks };
}
