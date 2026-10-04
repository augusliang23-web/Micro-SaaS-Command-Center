import { SandboxBlockedError } from './pathSafety.mjs';

// ---------------------------------------------------------------------------
// SandboxPolicy: strict, server-owned. Browsers and tasks never supply Docker
// arguments, images, mounts or environment. Unknown fields fail closed.
// ---------------------------------------------------------------------------

export const NETWORK_PROFILES = Object.freeze({
  // Verifier profile: Docker `--network=none`, proven by inspect readback.
  NO_NETWORK: Object.freeze({ dockerNetwork: 'none' }),
  // Agent profile. Docker cannot restrict this to the provider's endpoints without extra infrastructure:
  // the container gets a default bridge network. The agent's *tools* have no network access only because
  // the adapter withholds them (see Claude adapter); this profile does NOT confine traffic to Anthropic.
  PROVIDER_NETWORK: Object.freeze({ dockerNetwork: 'bridge' }),
});

export const SANDBOX_ROLES = Object.freeze(['agent', 'verifier', 'scratch']);
export const WRITABLE_PATHS = Object.freeze(['/workspace', '/tmp']);

const POLICY_KEYS = ['network', 'image', 'mounts', 'writablePaths', 'env', 'cpus', 'memoryMb', 'pids', 'timeoutMs', 'outputBytes'];
export const DEFAULT_LIMITS = Object.freeze({ cpus: 1, memoryMb: 512, pids: 128, timeoutMs: 120_000, outputBytes: 1024 * 1024 });
const RANGE = {
  cpus: [0.1, 8],
  memoryMb: [8, 8192],
  pids: [8, 4096],
  timeoutMs: [500, 3_600_000],
  outputBytes: [1024, 32 * 1024 * 1024],
};

// Fixed, minimal base environment. Host process.env is never consulted.
export const BASE_ENV = Object.freeze({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' });
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENV_RESERVED = new Set(Object.keys(BASE_ENV));
// Secrets and routing variables can never be passed through the generic runtime. Provider auth is a
// separate, later interface (ProviderAuthMount), not an env entry.
const ENV_FORBIDDEN = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE)|^(GH_|GITHUB_|SSH_|AWS_|GOOGLE_|GCP_|GCLOUD|FIREBASE|ANTHROPIC_|OPENAI_|CODEX_|CLAUDE|NPM_|NODE_AUTH|GIT_|DOCKER_|LD_|DYLD_|NODE_OPTIONS|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)/i;

const blocked = (code, message) => new SandboxBlockedError(code, message);
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function number(policy, key) {
  const value = policy[key] === undefined ? DEFAULT_LIMITS[key] : policy[key];
  const [min, max] = RANGE[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw blocked('INVALID_POLICY', `${key} must be a number between ${min} and ${max}`);
  if (key !== 'cpus' && !Number.isInteger(value)) throw blocked('INVALID_POLICY', `${key} must be an integer`);
  return value;
}

export function parseSandboxPolicy(raw, { images }) {
  if (!isRecord(raw)) throw blocked('INVALID_POLICY', 'Policy must be an object');
  const unknown = Object.keys(raw).filter((k) => !POLICY_KEYS.includes(k));
  if (unknown.length > 0) throw blocked('UNKNOWN_POLICY_FIELD', `Unknown policy field(s): ${unknown.join(', ')}`);

  if (!Object.hasOwn(NETWORK_PROFILES, raw.network ?? '')) throw blocked('INVALID_POLICY', `network must be one of: ${Object.keys(NETWORK_PROFILES).join(', ')}`);
  if (typeof raw.image !== 'string' || !Object.hasOwn(images, raw.image)) throw blocked('IMAGE_NOT_ALLOWED', 'image must be an alias from the server-side allowlist');
  // Phase 3B2 allows no extra mounts: the workspace is the only (server-derived) mount.
  if (raw.mounts !== undefined && !(Array.isArray(raw.mounts) && raw.mounts.length === 0)) throw blocked('MOUNT_NOT_ALLOWED', 'Policies may not request mounts');

  const writable = raw.writablePaths === undefined ? ['/workspace', '/tmp'] : raw.writablePaths;
  if (!Array.isArray(writable) || !writable.every((p) => WRITABLE_PATHS.includes(p))) throw blocked('INVALID_POLICY', `writablePaths may only contain: ${WRITABLE_PATHS.join(', ')}`);

  const env = raw.env === undefined ? {} : raw.env;
  if (!isRecord(env)) throw blocked('INVALID_POLICY', 'env must be an object');
  for (const [name, value] of Object.entries(env)) {
    if (!ENV_NAME.test(name)) throw blocked('INVALID_ENV', `Invalid environment variable name: ${name.slice(0, 40)}`);
    if (ENV_RESERVED.has(name)) throw blocked('INVALID_ENV', `${name} is set by the runtime`);
    if (ENV_FORBIDDEN.test(name)) throw blocked('INVALID_ENV', `${name} may not be passed to a sandbox`);
    if (typeof value !== 'string' || value.length > 1024 || /[\0\n\r]/.test(value)) throw blocked('INVALID_ENV', `${name} must be a short single-line string`);
  }

  return Object.freeze({
    network: raw.network,
    image: raw.image,
    writablePaths: Object.freeze([...new Set(writable)].sort()),
    env: Object.freeze({ ...env }),
    cpus: number(raw, 'cpus'),
    memoryMb: number(raw, 'memoryMb'),
    pids: number(raw, 'pids'),
    timeoutMs: number(raw, 'timeoutMs'),
    outputBytes: number(raw, 'outputBytes'),
  });
}

export const SANDBOX_ID = /^[A-Za-z0-9][A-Za-z0-9-]{5,40}$/;
export function sandboxName(role, sandboxId) {
  if (!SANDBOX_ROLES.includes(role)) throw blocked('INVALID_SPEC', 'Unknown sandbox role');
  if (!SANDBOX_ID.test(sandboxId ?? '')) throw blocked('INVALID_SPEC', 'sandboxId is malformed');
  return `cc-sandbox-${role}-${sandboxId.toLowerCase()}`;
}

export function validateCommand(command) {
  if (!Array.isArray(command) || command.length < 1 || command.length > 64 || !command.every((c) => typeof c === 'string' && c.length <= 4096 && !c.includes('\0')) || command[0] === '') {
    throw blocked('INVALID_SPEC', 'command must be a non-empty array of strings (server-built)');
  }
  return [...command];
}

/**
 * Build `docker create` argv. Every option uses the `--flag=value` form so no value
 * can be parsed as a separate option, and the image reference comes only from the
 * server allowlist. The container command follows the image and is plain data.
 */
export function buildCreateArgs({ name, sandboxId, role, policy, image, workspacePath, gitMask, user, command }) {
  const mountSrc = (src, dst, readonly) => `--mount=type=bind,src=${src},dst=${dst}${readonly ? ',readonly' : ''}`;
  const args = [
    'create',
    `--name=${name}`,
    '--label=cc.sandbox=1',
    `--label=cc.sandbox.id=${sandboxId}`,
    `--label=cc.sandbox.role=${role}`,
    '--pull=never', // never download at create time
    `--network=${NETWORK_PROFILES[policy.network].dockerNetwork}`,
    '--ipc=private',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--read-only',
    `--memory=${policy.memoryMb}m`,
    `--memory-swap=${policy.memoryMb}m`,
    `--cpus=${policy.cpus}`,
    `--pids-limit=${policy.pids}`,
    `--user=${user}`,
    '--workdir=/workspace',
    '--log-driver=none',
  ];
  if (policy.writablePaths.includes('/tmp')) args.push('--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m');
  args.push(mountSrc(workspacePath, '/workspace', !policy.writablePaths.includes('/workspace')));
  if (gitMask?.kind === 'file') args.push(mountSrc(gitMask.emptyFile, '/workspace/.git', true));
  if (gitMask?.kind === 'dir') args.push('--tmpfs=/workspace/.git:ro,noexec,nosuid,nodev,size=1k');
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...policy.env })) args.push(`--env=${key}=${value}`);
  args.push(image.reference, ...command);
  return args;
}

const ALLOWED_FLAG = [
  /^--name=cc-sandbox-(agent|verifier|scratch)-[a-z0-9-]+$/, /^--label=cc\.sandbox(\.id|\.role)?=[A-Za-z0-9-]+$/, /^--pull=never$/, /^--network=(none|bridge)$/, /^--ipc=private$/,
  /^--cap-drop=ALL$/, /^--security-opt=no-new-privileges$/, /^--read-only$/, /^--memory=\d+m$/, /^--memory-swap=\d+m$/, /^--cpus=[\d.]+$/, /^--pids-limit=\d+$/,
  /^--user=[1-9]\d*:\d+$/, /^--workdir=\/workspace$/, /^--log-driver=none$/, /^--tmpfs=\/tmp:rw,noexec,nosuid,nodev,size=64m$/, /^--tmpfs=\/workspace\/\.git:ro,noexec,nosuid,nodev,size=1k$/,
  /^--env=[A-Z][A-Z0-9_]*=[^\0\n\r]*$/,
];

/**
 * Last line of defense on the FINAL argv: only the exact option shapes above may appear
 * before the image, only the expected bind sources may be mounted, and no privilege,
 * host-namespace, device, socket or env-file option can slip in. The image must be the
 * allowlisted reference. Throws SandboxBlockedError otherwise.
 */
export function assertDockerArgs(args, { image, allowedBindSources }) {
  const bad = (m) => blocked('DOCKER_ARGS_REJECTED', m);
  if (!Array.isArray(args) || args[0] !== 'create') throw bad('Only `docker create` is built by the runtime');
  let i = 1;
  while (i < args.length && args[i].startsWith('-')) {
    const arg = args[i];
    if (arg.startsWith('--mount=')) {
      const m = /^--mount=type=bind,src=([^,]+),dst=(\/workspace(?:\/\.git)?)(,readonly)?$/.exec(arg);
      if (!m || !allowedBindSources.includes(m[1])) throw bad('Unexpected mount');
      if (m[2] === '/workspace/.git' && !m[3]) throw bad('.git mask must be read-only');
    } else if (!ALLOWED_FLAG.some((re) => re.test(arg))) {
      throw bad(`Option not allowed: ${arg.slice(0, 40)}`);
    }
    if (/docker\.sock/.test(arg)) throw bad('Docker socket may never be referenced');
    i += 1;
  }
  if (args[i] !== image.reference) throw bad('Image must be the allowlisted reference');
  return true;
}
