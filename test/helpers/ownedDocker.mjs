/**
 * Phase 3B7B2A test-only Docker client wrapper. It sits between DockerSandboxRuntime and a Docker client (the real
 * DockerClient in the integration run, an in-memory fake in the offline dry run) and adds an INDEPENDENT safety layer:
 *
 *  - ALLOW-LIST of verbs: version, `image inspect` of the pinned digest, inspect, create, stop, kill, rm and `start -a`. Nothing
 *    else (no ps/images/pull/build/run/prune/system/network/exec/cp/logs).
 *  - OWNERSHIP is explicit, never a name pattern: a container is owned only if (a) its exact id was returned by a `create` that
 *    passed this wrapper, or (b) for the pre-create collision check only, its exact name was RESERVED by the test
 *    (`reserveSandbox`/`reserveRun`). Pattern-shaped names that nobody reserved are refused.
 *  - EXACT CREATE SHAPE: the full `docker create` argv is validated against a hard-coded, reviewed contract (see validateCreate):
 *    pinned digest, NO_NETWORK, no-pull, reserved name + matching ownership labels, non-root numeric user equal to this process,
 *    read-only root, cap-drop ALL, no-new-privileges, bounded CPU/memory/PIDs, exactly the registered workspace bind plus the
 *    state-root `.git` mask and the /tmp tmpfs, exactly PATH/HOME, an approved command, no unknown and no duplicate options.
 *    The production `assertDockerArgs` is then applied as a second, unchanged layer.
 *  - OBSERVATION of real inspect responses (a sanitized subset), an optional PAUSE of the nth inspect-by-id response, and
 *    FAULT INJECTION (`faults`, `swallow`) that is counted separately so a test can prove the fault happened.
 */
import path from 'node:path';
import { assertDockerArgs } from '../../server/sandbox/sandboxPolicy.mjs';
import { buildScenarioCommand } from '../../server/execution/containerAgentAdapter.mjs';
import { RUN_ID_PATTERN, TASK_ID_PATTERN } from '../../server/tasks/types.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const SANDBOX_ID = /^[A-Za-z0-9][A-Za-z0-9-]{5,40}$/;
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', spawnError: null, timedOut: false });

export class PolicyError extends Error { constructor(message) { super(`OwnedDocker policy: ${message}`); this.name = 'PolicyError'; this.code = 'OWNED_DOCKER_POLICY'; } }

export const CREATE_BOUNDS = Object.freeze({ memoryMb: [8, 256], cpus: [0.1, 1], pids: [8, 64] });
const REQUIRED_ENV = Object.freeze(['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp']);
const SINGLE_FLAGS = ['--name', '--pull', '--network', '--ipc', '--cap-drop', '--security-opt', '--memory', '--memory-swap', '--cpus', '--pids-limit', '--user', '--workdir', '--log-driver'];
const MULTI_FLAGS = { '--label': 3, '--mount': 2, '--env': 2, '--tmpfs': 1 };
const APPROVED_STATIC_COMMANDS = Object.freeze([['/bin/true'], ['/bin/sleep', '30']]);

/**
 * Pure validator for a `docker create` argv. Throws PolicyError on anything that is not EXACTLY the reviewed shape.
 * ctx: { imageRef, reservedNames:Set, workspaces:Set, stateRoot, uid, gid }
 */
export function validateCreate(args, ctx) {
  const fail = (m) => { throw new PolicyError(`create refused: ${m}`); };
  if (!Array.isArray(args) || args[0] !== 'create' || !args.every((a) => typeof a === 'string' && a !== '' && !a.includes('\0'))) fail('malformed argv');
  const imageAt = args.indexOf(ctx.imageRef, 1);
  if (imageAt < 0) fail('the pinned image digest is required');
  if (args.indexOf(ctx.imageRef, imageAt + 1) >= 0) fail('the pinned image appears more than once');
  const opts = args.slice(1, imageAt); const command = args.slice(imageAt + 1);
  const single = new Map(); const multi = new Map(); let readOnly = 0;
  for (const o of opts) {
    if (o === '--read-only') { readOnly += 1; continue; }
    const m = /^(--[a-z-]+)=(.+)$/s.exec(o);
    if (!m) fail(`option is not in the --flag=value form: ${o.slice(0, 30)}`);
    const [, key, value] = m;
    if (SINGLE_FLAGS.includes(key)) { if (single.has(key)) fail(`duplicate ${key}`); single.set(key, value); continue; }
    if (Object.hasOwn(MULTI_FLAGS, key)) { multi.set(key, [...(multi.get(key) ?? []), value]); continue; }
    fail(`unknown or unapproved option ${key}`);
  }
  if (readOnly !== 1) fail('exactly one --read-only is required');
  for (const key of SINGLE_FLAGS) if (!single.has(key)) fail(`missing ${key}`);
  for (const [key, n] of Object.entries(MULTI_FLAGS)) if ((multi.get(key) ?? []).length !== n) fail(`${key} must appear exactly ${n} time(s)`);

  const name = single.get('--name');
  if (!ctx.reservedNames.has(name)) fail('the container name was not reserved by this test');
  const eq = (key, expected) => { if (single.get(key) !== expected) fail(`${key} must be ${expected}`); };
  eq('--pull', 'never'); eq('--network', 'none'); eq('--ipc', 'private'); eq('--cap-drop', 'ALL'); eq('--security-opt', 'no-new-privileges'); eq('--workdir', '/workspace'); eq('--log-driver', 'none');
  const labels = [...multi.get('--label')].sort();
  const id = labels.find((l) => l.startsWith('cc.sandbox.id='))?.slice(14);
  if (!id || !SANDBOX_ID.test(id) || name !== `cc-sandbox-agent-${id.toLowerCase()}`) fail('the id label does not match the reserved name');
  if (JSON.stringify(labels) !== JSON.stringify(['cc.sandbox.id=' + id, 'cc.sandbox.role=agent', 'cc.sandbox=1'].sort())) fail('ownership labels must be exactly cc.sandbox=1, cc.sandbox.id and cc.sandbox.role=agent');
  const mem = /^(\d+)m$/.exec(single.get('--memory') ?? ''); const swap = single.get('--memory-swap');
  if (!mem || Number(mem[1]) < CREATE_BOUNDS.memoryMb[0] || Number(mem[1]) > CREATE_BOUNDS.memoryMb[1] || swap !== single.get('--memory')) fail('memory must be bounded and equal to memory-swap');
  const cpus = Number(single.get('--cpus'));
  if (!/^\d+(\.\d+)?$/.test(single.get('--cpus')) || !(cpus >= CREATE_BOUNDS.cpus[0] && cpus <= CREATE_BOUNDS.cpus[1])) fail('cpus must be bounded');
  const pids = single.get('--pids-limit');
  if (!/^\d+$/.test(pids) || Number(pids) < CREATE_BOUNDS.pids[0] || Number(pids) > CREATE_BOUNDS.pids[1]) fail('pids-limit must be bounded');
  const user = /^([1-9]\d*):(\d+)$/.exec(single.get('--user'));
  if (!user || Number(user[1]) !== ctx.uid || Number(user[2]) !== ctx.gid) fail('the user must be this process\'s non-root uid:gid');

  const mounts = [...multi.get('--mount')].sort();
  const workspace = mounts.find((x) => x.includes('dst=/workspace,'));
  const wm = /^type=bind,src=([^,]+),dst=\/workspace,bind-recursive=disabled$/.exec(workspace ?? '');
  if (!wm || !ctx.workspaces.has(wm[1])) fail('the workspace bind must be exactly a registered test workspace, non-recursive');
  const maskSrc = path.join(ctx.stateRoot, name, 'empty');
  const expectedMounts = [`type=bind,src=${wm[1]},dst=/workspace,bind-recursive=disabled`, `type=bind,src=${maskSrc},dst=/workspace/.git,readonly`].sort();
  if (JSON.stringify(mounts) !== JSON.stringify(expectedMounts)) fail('mounts must be exactly the registered workspace and the state-root .git mask');
  if (JSON.stringify([...multi.get('--tmpfs')]) !== JSON.stringify(['/tmp:rw,noexec,nosuid,nodev,size=64m'])) fail('tmpfs must be exactly the bounded noexec /tmp');
  if (JSON.stringify([...multi.get('--env')].sort()) !== JSON.stringify([...REQUIRED_ENV].sort())) fail('the environment must be exactly PATH and HOME');

  const taskCmd = command.length === 6 && command[0] === '/bin/sh' ? command : null;
  const fixture = taskCmd ? taskCmd[5] : null;
  const approved = APPROVED_STATIC_COMMANDS.some((c) => JSON.stringify(c) === JSON.stringify(command))
    || (taskCmd && TASK_ID_PATTERN.test(taskCmd[4]) && fixture === `agent-console-fixture/${taskCmd[4]}.txt` && JSON.stringify(command) === JSON.stringify(buildScenarioCommand('edit-fixture', { taskId: taskCmd[4], fixturePath: fixture })));
  if (!approved) fail('the container command is not one of the approved fake-agent scripts');

  // Second, unchanged layer: the production argv guard.
  try { assertDockerArgs(args, { image: { reference: ctx.imageRef }, allowedBindSources: [wm[1], maskSrc] }); } catch (error) { fail(`production guard: ${error.message}`); }
  return { name, id };
}

export class OwnedDocker {
  inner; imageRef; stateRoot;
  calls = []; // { verb, target, injected } — never full argv, never environment
  owned = new Set(); // container ids returned by a create that passed validateCreate
  ownedNames = new Set();
  reservedNames = new Set(); // exact pre-create names reserved by the test
  workspaces = new Set(); // exact registered temp workspace paths
  observed = []; // real inspect responses (sanitized subset) of owned containers
  cleanupErrors = [];
  faults = null; faultsApplied = 0;
  swallow = new Set(); swallowed = 0;
  #pause = null; #idInspects = 0;

  constructor({ inner, imageRef, stateRoot }) {
    if (!inner || typeof inner.run !== 'function' || typeof inner.stream !== 'function') throw new Error('An inner docker client is required');
    if (!/^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/.test(imageRef ?? '')) throw new Error('The pinned image reference is required');
    if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot)) throw new Error('The sandbox state root is required');
    this.inner = inner; this.imageRef = imageRef; this.stateRoot = stateRoot;
  }

  // ---- explicit ownership registration (test code only) -----------------------------------------------------------------------
  reserveSandbox(sandboxId) {
    if (!SANDBOX_ID.test(sandboxId ?? '')) throw new PolicyError('invalid sandbox id');
    this.reservedNames.add(`cc-sandbox-agent-${sandboxId.toLowerCase()}`); return sandboxId;
  }
  reserveRun(runId) { if (!RUN_ID_PATTERN.test(runId ?? '')) throw new PolicyError('invalid run id'); return this.reserveSandbox(runId); }
  registerWorkspace(workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || /[,\0\n\r"']/.test(workspacePath) || workspacePath === '/') throw new PolicyError('invalid workspace path');
    this.workspaces.add(workspacePath); return workspacePath;
  }

  /** Pause the nth inspect-by-id response (counted from now) AFTER Docker answered, until `release()` is called. release() is idempotent. */
  armPause(nth) {
    let released = false; let release; const gate = new Promise((r) => { release = () => { released = true; r(); }; });
    let reached; const reachedPromise = new Promise((r) => { reached = r; });
    this.#idInspects = 0;
    this.#pause = { nth, gate, reached };
    return { release: () => { if (!released) release(); }, reached: reachedPromise, get released() { return released; } };
  }

  #isOwnedId(ref) { return HEX64.test(ref) && this.owned.has(ref); }
  #isReservedName(ref) { return this.reservedNames.has(ref) || this.ownedNames.has(ref); }
  #record(verb, target, injected = false) { this.calls.push({ verb, target: target ? String(target).slice(0, 12) : null, injected }); }
  count(verb, { injected } = {}) { return this.calls.filter((c) => c.verb === verb && (injected === undefined || c.injected === injected)).length; }

  async run(args, opts) {
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw new PolicyError('arguments must be strings');
    const verb = args[0];
    const last = args.at(-1);
    if (verb === 'version') {
      if (args.length !== 2 || !args[1].startsWith('--format=')) throw new PolicyError('version must use --format only');
      this.#record('version'); return this.inner.run(args, opts);
    }
    if (verb === 'image') {
      if (args.length !== 4 || args[1] !== 'inspect' || last !== this.imageRef) throw new PolicyError('only `image inspect` of the pinned image is allowed');
      this.#record('image-inspect'); return this.inner.run(args, opts);
    }
    if (verb === 'inspect') {
      if (args.length !== 4 || args[1] !== '--type=container' || !args[2].startsWith('--format=')) throw new PolicyError('inspect must be `inspect --type=container --format=… <ref>`');
      if (!this.#isOwnedId(last) && !this.#isReservedName(last)) throw new PolicyError('inspect is limited to exact owned container ids and reserved names');
      this.#record('inspect', last);
      return this.#inspect(args, opts, last);
    }
    if (verb === 'create') {
      const { name } = validateCreate(args, { imageRef: this.imageRef, reservedNames: this.reservedNames, workspaces: this.workspaces, stateRoot: this.stateRoot, uid: process.getuid(), gid: process.getgid() });
      const res = await this.inner.run(args, opts);
      this.#record('create', res.stdout);
      if (res.exitCode === 0 && HEX64.test(res.stdout.trim())) { this.owned.add(res.stdout.trim()); this.ownedNames.add(name); }
      return res;
    }
    if (verb === 'stop' || verb === 'kill' || verb === 'rm') {
      const shape = verb === 'stop' ? args.length === 3 && /^--time=\d+$/.test(args[1]) : verb === 'rm' ? args.length === 3 && args[1] === '--force' : args.length === 2;
      if (!shape) throw new PolicyError(`${verb} has an unapproved argument shape`);
      if (!this.#isOwnedId(last)) throw new PolicyError(`${verb} is limited to container ids created by this test`);
      if (this.swallow.has(verb)) { this.swallowed += 1; this.#record(verb, last, true); return ok(); }
      this.#record(verb, last); return this.inner.run(args, opts);
    }
    throw new PolicyError(`docker verb not allowed: ${String(verb).slice(0, 20)}`);
  }

  async #inspect(args, opts, ref) {
    const res = await this.inner.run(args, opts);
    const byId = this.#isOwnedId(ref);
    if (!byId || res.exitCode !== 0) return res;
    let info;
    try { info = JSON.parse(res.stdout); } catch { return res; }
    this.observed.push(sanitize(info)); // REAL observation, taken before any injected change
    let out = res;
    if (this.faults && info?.State?.Status === 'exited') {
      this.faults(info.State, info); this.faultsApplied += 1; this.#record('inspect-fault', ref, true);
      out = { ...res, stdout: JSON.stringify(info) };
    }
    const pause = this.#pause;
    if (pause) {
      this.#idInspects += 1;
      if (this.#idInspects === pause.nth) { this.#pause = null; pause.reached(); await pause.gate; }
    }
    return out;
  }

  /** Only `docker start -a <owned id>` may be streamed. */
  stream(args, opts) {
    if (args.length !== 3 || args[0] !== 'start' || args[1] !== '-a' || !this.#isOwnedId(args[2])) throw new PolicyError('only `start -a <owned container id>` may be streamed');
    this.#record('start', args[2]);
    return this.inner.stream(args, opts);
  }

  // ---- test-side helpers (always scoped to owned ids; bypass faults, swallowing and pauses) ------------------------------------
  /** 'PRESENT' | 'ABSENT' | 'UNKNOWN' by exact id. A thrown error or an unrecognized answer is UNKNOWN, never ABSENT. */
  async existence(id) {
    if (!this.#isOwnedId(id)) throw new PolicyError('existence checks are limited to owned ids');
    let r;
    try { r = await this.inner.run(['inspect', '--type=container', '--format={{json .}}', id]); } catch { return 'UNKNOWN'; }
    if (r.spawnError || r.timedOut) return 'UNKNOWN';
    if (r.exitCode === 0) return 'PRESENT';
    return /no such (object|container)/i.test(r.stderr ?? '') ? 'ABSENT' : 'UNKNOWN';
  }
  async realState(id) {
    if (!this.#isOwnedId(id)) throw new PolicyError('state reads are limited to owned ids');
    const r = await this.inner.run(['inspect', '--type=container', '--format={{json .}}', id]);
    if (r.exitCode !== 0) return null;
    try { return sanitize(JSON.parse(r.stdout)); } catch { return null; }
  }
  /** Force-remove exactly one owned id; resolves 'ABSENT' only when Docker proves it, otherwise 'PRESENT' or 'UNKNOWN'. Never throws for Docker trouble. */
  async forceRemove(id) {
    if (!this.#isOwnedId(id)) throw new PolicyError('cleanup is limited to owned ids');
    try { await this.inner.run(['rm', '--force', id], { timeoutMs: 20_000 }); } catch (error) { this.cleanupErrors.push({ id: id.slice(0, 12), error: String(error?.message ?? error).slice(0, 120) }); }
    return this.existence(id);
  }
  /** Attempts EVERY owned id even if one fails. Returns the short ids that could not be confirmed absent (empty = all confirmed). */
  async cleanupAll() {
    const leftovers = [];
    for (const id of [...this.owned]) {
      let state;
      try { state = await this.forceRemove(id); } catch (error) { this.cleanupErrors.push({ id: id.slice(0, 12), error: String(error?.message ?? error).slice(0, 120) }); state = 'UNKNOWN'; }
      if (state !== 'ABSENT') leftovers.push(id.slice(0, 12));
    }
    return leftovers;
  }
}

/** The small subset of an inspect response that tests assert on. No environment values, no host paths beyond mount destinations. */
export function sanitize(info) {
  const hc = info?.HostConfig ?? {}; const st = info?.State ?? {}; const cfg = info?.Config ?? {};
  return {
    id: info?.Id,
    labels: { ...(cfg.Labels ?? {}) },
    user: cfg.User,
    image: cfg.Image,
    state: { ...st },
    host: {
      networkMode: hc.NetworkMode, privileged: hc.Privileged, capDrop: hc.CapDrop, capAdd: hc.CapAdd, securityOpt: hc.SecurityOpt, readonlyRootfs: hc.ReadonlyRootfs,
      memory: hc.Memory, pidsLimit: hc.PidsLimit, nanoCpus: hc.NanoCpus, binds: hc.Binds, tmpfs: hc.Tmpfs, logType: hc.LogConfig?.Type,
    },
    mountDestinations: (info?.Mounts ?? []).map((m) => ({ destination: m.Destination, rw: m.RW })).sort((a, b) => (a.destination < b.destination ? -1 : 1)),
    envNames: (cfg.Env ?? []).map((e) => e.split('=')[0]).sort(),
  };
}
