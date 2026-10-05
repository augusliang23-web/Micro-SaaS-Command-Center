import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DockerSandboxRuntime, SANDBOX_EVIDENCE_KINDS } from '../server/sandbox/dockerSandboxRuntime.mjs';
import { DockerClient } from '../server/sandbox/dockerClient.mjs';
import { TEST_IMAGES, validateImageAllowlist } from '../server/sandbox/sandboxImages.mjs';
import { assertDockerArgs, buildCreateArgs, parseSandboxPolicy, sandboxName, validateCommand } from '../server/sandbox/sandboxPolicy.mjs';
import { assertSafeWorkspacePath } from '../server/sandbox/pathSafety.mjs';
import { FakeDocker } from './helpers/fakeDocker.mjs';
import { makeScratch, realTmp } from './helpers/dockerScratch.mjs';

const IMG = TEST_IMAGES['busybox-test'];
const policyOf = (extra = {}) => ({ network: 'NO_NETWORK', image: 'busybox-test', ...extra });
const parse = (raw) => parseSandboxPolicy(raw, { images: TEST_IMAGES });
let n = 0;
const id = () => `unit-${process.pid}-${n++}-abcdef`;

function setup({ fake = new FakeDocker(), runtimeOptions = {} } = {}) {
  const scratch = makeScratch();
  const stateRoot = realTmp('cc-p3b2-state-');
  const runtime = new DockerSandboxRuntime({ docker: fake, stateRoot, commandCenterRoot: process.cwd(), user: { uid: 501, gid: 20 }, ...runtimeOptions });
  const prepare = (extra = {}) => runtime.prepare({ sandboxId: id(), role: 'scratch', worktreePath: scratch.wt, policy: policyOf(), command: ['true'], ...extra });
  return { fake, scratch, stateRoot, runtime, prepare, done: () => { runtime.dispose(); scratch.cleanup(); } };
}
async function withSetup(fn, options) { const s = setup(options); try { return await fn(s); } finally { s.done(); } }
const noDockerCreate = (fake) => assert.equal(fake.callsOf('create').length, 0, 'docker create must not run');

// ---------- Policy ----------

test('policy: valid minimal policy gets conservative defaults', () => {
  const p = parse(policyOf());
  assert.deepEqual({ ...p, env: { ...p.env }, writablePaths: [...p.writablePaths] }, { network: 'NO_NETWORK', image: 'busybox-test', writablePaths: ['/tmp', '/workspace'], env: {}, cpus: 1, memoryMb: 512, pids: 128, timeoutMs: 120000, outputBytes: 1048576 });
  assert.ok(Object.isFrozen(p));
});

test('policy: malformed policies and unknown fields fail closed', () => {
  const bad = [null, undefined, [], 'x', 5, {}, { image: 'busybox-test' }, { network: 'HOST', image: 'busybox-test' }, { network: 'NO_NETWORK' },
    policyOf({ network: 'host' }), policyOf({ privileged: true }), policyOf({ args: ['--privileged'] }), policyOf({ dockerArgs: '--network=host' }), policyOf({ providerAuthMount: '/x' }),
    policyOf({ cpus: 0 }), policyOf({ cpus: 64 }), policyOf({ cpus: '1' }), policyOf({ memoryMb: 1 }), policyOf({ memoryMb: 1e9 }), policyOf({ pids: 2 }), policyOf({ pids: 1.5 }),
    policyOf({ timeoutMs: 1 }), policyOf({ outputBytes: 10 }), policyOf({ writablePaths: ['/'] }), policyOf({ writablePaths: ['/etc'] }), policyOf({ writablePaths: '/tmp' }), policyOf({ env: 'x' })];
  for (const raw of bad) assert.throws(() => parse(raw), (e) => e.name === 'SandboxBlockedError', JSON.stringify(raw));
  assert.throws(() => parse(policyOf({ privileged: true })), (e) => e.code === 'UNKNOWN_POLICY_FIELD');
});

test('policy: only allowlisted image aliases; raw references, tags and digests are rejected', () => {
  for (const image of ['busybox:latest', 'busybox:1.37.0', IMG.reference, 'alpine@sha256:' + 'a'.repeat(64), '', undefined, 5, '__proto__', 'constructor', '../../x']) {
    assert.throws(() => parse(policyOf({ image })), (e) => e.code === 'IMAGE_NOT_ALLOWED', String(image));
  }
  assert.throws(() => validateImageAllowlist({ x: { reference: 'busybox:latest', digest: 'sha256:x', os: 'linux', arch: 'arm64' } }), /pinned by digest/);
  assert.doesNotThrow(() => validateImageAllowlist(TEST_IMAGES));
  assert.match(IMG.reference, /@sha256:[0-9a-f]{64}$/);
});

test('policy: arbitrary mounts are rejected', () => {
  for (const mounts of [['/'], [{ src: '/', dst: '/host' }], ['/var/run/docker.sock:/var/run/docker.sock'], 'x', [''], [1]]) {
    assert.throws(() => parse(policyOf({ mounts })), (e) => e.code === 'MOUNT_NOT_ALLOWED');
  }
  assert.doesNotThrow(() => parse(policyOf({ mounts: [] })));
});

test('policy: environment is explicit; secrets, routing and reserved names are refused', () => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'GIT_DIR', 'DOCKER_HOST', 'LD_PRELOAD', 'NODE_OPTIONS', 'HTTPS_PROXY', 'MY_PASSWORD', 'DB_SECRET', 'CLAUDE_CODE_OAUTH_TOKEN', 'FIREBASE_TOKEN']) {
    assert.throws(() => parse(policyOf({ env: { [name]: 'x' } })), (e) => e.code === 'INVALID_ENV', name);
  }
  for (const name of ['PATH', 'HOME']) assert.throws(() => parse(policyOf({ env: { [name]: '/x' } })), /set by the runtime/);
  for (const bad of ['lower', '1X', 'A-B', 'A B', '', '__proto__']) assert.throws(() => parse(policyOf({ env: { [bad]: 'x' } })), (e) => e.code === 'INVALID_ENV', bad);
  for (const value of ['a\nb', 'a\0b', 5, null, 'x'.repeat(2000)]) assert.throws(() => parse(policyOf({ env: { CI: value } })), (e) => e.code === 'INVALID_ENV');
  assert.deepEqual({ ...parse(policyOf({ env: { CI: '1', LANG: 'C' } })).env }, { CI: '1', LANG: 'C' });
});

test('naming: container names derive only from a validated role and id, never from titles or prompts', () => {
  assert.equal(sandboxName('verifier', 'RUN-20261003-AAAAAAAA'), 'cc-sandbox-verifier-run-20261003-aaaaaaaa');
  for (const bad of ['--privileged', 'a b c d e f', 'x;rm', '../x', '', 'short', 'a'.repeat(60), undefined]) assert.throws(() => sandboxName('agent', bad), /sandboxId/);
  for (const role of ['root', '', undefined, 'agent;x']) assert.throws(() => sandboxName(role, 'valid-id-123'), /role/);
  for (const bad of [[], [''], 'sh', [5], ['a\0'], Array(65).fill('x')]) assert.throws(() => validateCommand(bad), /command must be/);
});

// ---------- Docker argv ----------

const sampleArgs = (policy = parse(policyOf()), gitMask = { kind: 'file', emptyFile: '/state/empty' }, command = ['true']) =>
  buildCreateArgs({ name: 'cc-sandbox-scratch-abc', sandboxId: 'abc', role: 'scratch', policy, image: IMG, workspacePath: '/work/wt', gitMask, user: '501:20', command });

test('argv: exact, minimal and every option uses --flag=value; the image is the allowlisted digest', () => {
  const args = sampleArgs();
  assert.deepEqual(args, [
    'create', '--name=cc-sandbox-scratch-abc', '--label=cc.sandbox=1', '--label=cc.sandbox.id=abc', '--label=cc.sandbox.role=scratch', '--pull=never', '--network=none', '--ipc=private',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=128', '--user=501:20', '--workdir=/workspace',
    '--log-driver=none', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m', '--mount=type=bind,src=/work/wt,dst=/workspace,bind-recursive=disabled', '--mount=type=bind,src=/state/empty,dst=/workspace/.git,readonly',
    '--env=PATH=/usr/local/bin:/usr/bin:/bin', '--env=HOME=/tmp', IMG.reference, 'true',
  ]);
  const options = args.slice(1, args.indexOf(IMG.reference));
  assert.ok(options.every((o) => o.startsWith('--') && o.includes('=') || o === '--read-only'));
  assert.ok(!args.some((a) => /privileged|--network=host|--pid(=|$)|--cap-add|--device|--volume|^-v$|docker\.sock|env-file|--userns|seccomp|apparmor/.test(a)));
  assert.doesNotThrow(() => assertDockerArgs(args, { image: IMG, allowedBindSources: ['/work/wt', '/state/empty'] }));
});

test('argv: network profiles, limits and writable paths are all reflected', () => {
  const provider = sampleArgs(parse(policyOf({ network: 'PROVIDER_NETWORK', cpus: 0.5, memoryMb: 64, pids: 16, writablePaths: ['/tmp'] })));
  assert.ok(provider.includes('--network=bridge') && provider.includes('--cpus=0.5') && provider.includes('--memory=64m') && provider.includes('--memory-swap=64m') && provider.includes('--pids-limit=16'));
  assert.ok(provider.includes('--mount=type=bind,src=/work/wt,dst=/workspace,readonly,bind-recursive=disabled'), 'workspace is read-only unless /workspace is writable');
  const none = sampleArgs(parse(policyOf({ writablePaths: ['/workspace'] })), null);
  assert.ok(!none.some((a) => a.startsWith('--tmpfs=')) && !none.some((a) => a.includes('/workspace/.git')));
  const dir = sampleArgs(parse(policyOf()), { kind: 'dir' });
  assert.ok(dir.includes('--tmpfs=/workspace/.git:ro,noexec,nosuid,nodev,size=1k'));
});

test('argv guard: a Docker option can never be added — privileged, host network/pid/ipc, caps, devices, volumes, sockets, root', () => {
  const base = sampleArgs();
  const opts = { image: IMG, allowedBindSources: ['/work/wt', '/state/empty'] };
  const inject = (arg) => [...base.slice(0, 5), arg, ...base.slice(5)];
  for (const arg of ['--privileged', '--privileged=true', '--network=host', '--net=host', '--pid=host', '--ipc=host', '--uts=host', '--cap-add=ALL', '--cap-add=SYS_ADMIN', '--device=/dev/sda', '--volume=/:/host', '-v', '/:/host:rw',
    '--mount=type=bind,src=/,dst=/host', '--mount=type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock', '--env-file=/etc/secrets', '--userns=host', '--security-opt=seccomp=unconfined', '--security-opt=apparmor=unconfined',
    '--user=0:0', '--user=root', '--volumes-from=x', '--group-add=0', '--shm-size=1g', '--entrypoint=/bin/sh', '-e', '--env=docker.sock=1', '--memory-reservation=1g', '--restart=always', '--add-host=a:1.1.1.1']) {
    assert.throws(() => assertDockerArgs(inject(arg), opts), (e) => e.code === 'DOCKER_ARGS_REJECTED', arg);
  }
  assert.throws(() => assertDockerArgs(base.map((a) => (a.startsWith('--mount=type=bind,src=/work/wt') ? '--mount=type=bind,src=/work,dst=/workspace,bind-recursive=disabled' : a)), opts), /Unexpected mount/);
  assert.throws(() => assertDockerArgs(base.map((a) => (a.includes(',readonly') ? '--mount=type=bind,src=/state/empty,dst=/workspace/.git' : a)), opts), /read-only/);
  assert.throws(() => assertDockerArgs(base.map((a) => (a === IMG.reference ? 'busybox:latest' : a)), opts), /allowlisted reference/);
  assert.throws(() => assertDockerArgs(['run', ...base.slice(1)], opts), /docker create/);
});

test('argv: task-looking strings are only ever container command data, after the image', () => {
  const hostile = ['--privileged', '--network=host', '-v', '/:/host', '--cap-add=ALL'];
  const args = sampleArgs(parse(policyOf()), null, hostile);
  assert.deepEqual(args.slice(args.indexOf(IMG.reference) + 1), hostile);
  assert.ok(!args.slice(0, args.indexOf(IMG.reference)).some((a) => hostile.includes(a)));
  assert.doesNotThrow(() => assertDockerArgs(args, { image: IMG, allowedBindSources: ['/work/wt'] }));
});

// ---------- Path security ----------

test('path safety: root, system dirs, home, ancestors, credentials, Docker socket, source checkout and odd characters are refused', () => {
  const home = realTmp('cc-p3b2-home-');
  const checkout = realTmp('cc-p3b2-checkout-');
  const ok = realTmp('cc-p3b2-ok-');
  try {
    fs.mkdirSync(path.join(home, '.docker/run'), { recursive: true });
    fs.mkdirSync(path.join(home, '.ssh'));
    fs.mkdirSync(path.join(home, 'Developer/worktrees/t1'), { recursive: true });
    fs.mkdirSync(path.join(checkout, 'sub'));
    const ctx = { commandCenterRoot: checkout, homeDir: home };
    const codes = (p) => { try { assertSafeWorkspacePath(p, ctx); return 'OK'; } catch (e) { return e.code; } };
    assert.equal(codes('/'), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes('/Users'), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes('/private/etc'), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes('/etc'), 'INVALID_WORKSPACE', 'macOS /etc is a symlink, so it is not canonical');
    assert.equal(codes(home), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes(path.dirname(home)), 'FORBIDDEN_WORKSPACE', 'an ancestor of home');
    assert.equal(codes(path.join(home, 'Developer')), 'OK', 'a normal dev dir is fine');
    assert.equal(codes(path.join(home, 'Developer/worktrees/t1')), 'OK');
    assert.equal(codes(path.join(home, '.docker')), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes(path.join(home, '.docker/run')), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes(path.join(home, '.ssh')), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes(checkout), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes(path.join(checkout, 'sub')), 'FORBIDDEN_WORKSPACE');
    assert.equal(codes(path.dirname(checkout)), 'FORBIDDEN_WORKSPACE', 'an ancestor of the checkout');
    assert.equal(codes(ok), 'OK');
    for (const bad of ['relative', '', undefined, 5, `${ok}/../x`, `${ok}\0`, `${ok},dst=/host`, `${ok}"`, path.join(ok, 'missing')]) assert.equal(codes(bad), 'INVALID_WORKSPACE', String(bad));
    const file = path.join(ok, 'f'); fs.writeFileSync(file, 'x');
    assert.equal(codes(file), 'INVALID_WORKSPACE');
    const link = `${ok}-link`; fs.symlinkSync(ok, link);
    try { assert.equal(codes(link), 'INVALID_WORKSPACE', 'non-canonical'); } finally { fs.rmSync(link); }
  } finally { for (const d of [home, checkout, ok]) fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------- Runtime with the fake Docker driver ----------

test('prepare: happy path creates one verified container and returns LOCALLY_VERIFIED evidence', async () => withSetup(async ({ fake, runtime, prepare, scratch, stateRoot }) => {
  const res = await prepare();
  assert.equal(res.state, 'PREPARED', JSON.stringify(res));
  assert.deepEqual(fake.callsOf('create').length, 1);
  assert.deepEqual(fake.calls.map((c) => c[0]), ['image', 'inspect', 'create', 'inspect']);
  const created = fake.callsOf('create')[0];
  assert.ok(created.includes('--network=none') && created.includes('--cap-drop=ALL') && created.includes('--pull=never'));
  assert.ok(!JSON.stringify(created).includes('docker.sock'), 'the Docker socket never appears in what we send to Docker');
  assert.ok(!created.some((a) => /^--(volume|device|privileged|cap-add|pid|net|userns)\b|^-v$/.test(a)), 'no volume/device/privilege/host-namespace option');
  assert.deepEqual(res.evidence.map((e) => e.kind), ['sandbox_policy', 'sandbox_created']);
  assert.ok(res.evidence.every((e) => e.grade === 'LOCALLY_VERIFIED' && SANDBOX_EVIDENCE_KINDS.includes(e.kind)));
  assert.ok(Object.values(res.evidence[0].data.checks).every((v) => v === true));
  assert.equal(fake.calls.some((c) => c[0] === 'pull' || (c[0] === 'image' && c[1] === 'pull')), false, 'never pulls');
  const empty = fs.readdirSync(stateRoot).flatMap((d) => fs.readdirSync(path.join(stateRoot, d)));
  assert.deepEqual(empty, ['empty']);
  assert.equal(fs.readFileSync(path.join(scratch.wt, '.git'), 'utf8').startsWith('gitdir:'), true, 'host .git is untouched');
  await runtime.destroy(res.sandboxId);
}));

test('prepare: unknown spec fields (title, prompt, args, image, cwd, env, mounts) are rejected and Docker is never called', async () => withSetup(async ({ fake, prepare }) => {
  for (const extra of [{ title: '--privileged' }, { prompt: '--network=host' }, { args: ['--privileged'] }, { dockerArgs: '-v /:/host' }, { image: 'alpine' }, { cwd: '/' }, { env: { GH_TOKEN: 'x' } }, { mounts: ['/'] }, { binaryPath: '/bin/sh' }]) {
    const r = await prepare(extra);
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'INVALID_SPEC'], JSON.stringify(extra));
  }
  assert.equal(fake.calls.length, 0);
}));

test('prepare: forbidden/invalid workspaces and policy problems BLOCK before any docker create', async () => {
  await withSetup(async ({ fake, prepare }) => {
    for (const worktreePath of ['/', os.homedir(), process.cwd(), path.dirname(process.cwd()), '/var/run', '/Users']) {
      const r = await prepare({ worktreePath });
      assert.equal(r.state, 'BLOCKED', worktreePath);
    }
    for (const policy of [{}, policyOf({ image: 'alpine' }), policyOf({ mounts: ['/'] }), policyOf({ privileged: true })]) assert.equal((await prepare({ policy })).state, 'BLOCKED');
    noDockerCreate(fake);
  });
});

test('prepare: escaping, dangling and chained symlinks BLOCK activation; so do nested and symlinked .git', async () => withSetup(async ({ fake, prepare, scratch }) => {
  const leak = path.join(scratch.wt, 'leak');
  fs.symlinkSync(scratch.secret, leak);
  assert.equal((await prepare()).code, 'SYMLINK_ESCAPE');
  fs.rmSync(leak);
  fs.symlinkSync('does-not-exist', leak);
  assert.equal((await prepare()).code, 'SYMLINK_ESCAPE');
  fs.rmSync(leak);
  fs.mkdirSync(path.join(scratch.wt, 'a/b'), { recursive: true });
  fs.writeFileSync(path.join(scratch.wt, 'a/b/.git'), 'gitdir: /elsewhere\n');
  assert.equal((await prepare()).code, 'GIT_METADATA_UNSAFE');
  fs.rmSync(path.join(scratch.wt, 'a'), { recursive: true });
  fs.rmSync(path.join(scratch.wt, '.git'));
  fs.symlinkSync(path.join(scratch.src, '.git'), path.join(scratch.wt, '.git'));
  assert.equal((await prepare()).code, 'GIT_METADATA_UNSAFE', 'a symlinked .git cannot be masked');
  noDockerCreate(fake);
}));

test('.git indirection: a worktree .git file is masked by an empty read-only file; a .git directory by an empty read-only tmpfs; none needs nothing', async () => {
  await withSetup(async ({ fake, prepare, runtime }) => {
    const r = await prepare();
    const create = fake.callsOf('create')[0];
    const mask = create.find((a) => a.endsWith('dst=/workspace/.git,readonly'));
    assert.ok(mask, 'worktree .git file is masked');
    const src = /src=([^,]+)/.exec(mask)[1];
    assert.equal(fs.statSync(src).size, 0);
    assert.equal(fs.statSync(src).mode & 0o222, 0, 'mask file is not writable');
    assert.equal(r.evidence[0].data.gitMask, 'file');
    await runtime.destroy(r.sandboxId);
    assert.equal(fs.existsSync(src), false, 'mask removed on destroy');
  });
  await withSetup(async ({ fake, prepare, scratch, runtime }) => {
    fs.rmSync(path.join(scratch.wt, '.git'));
    fs.mkdirSync(path.join(scratch.wt, '.git'));
    const r = await prepare();
    assert.equal(r.evidence[0].data.gitMask, 'dir');
    assert.ok(fake.callsOf('create')[0].includes('--tmpfs=/workspace/.git:ro,noexec,nosuid,nodev,size=1k'));
    await runtime.destroy(r.sandboxId);
  });
  await withSetup(async ({ prepare, scratch, runtime }) => {
    fs.rmSync(path.join(scratch.wt, '.git'));
    const r = await prepare();
    assert.equal(r.evidence[0].data.gitMask, 'none');
    await runtime.destroy(r.sandboxId);
  });
});

test('readback: any configuration Docker did not honour BLOCKS and removes only our own container', async () => {
  const cases = {
    privileged: (i) => { i.HostConfig.Privileged = true; },
    hostNetwork: (i) => { i.HostConfig.NetworkMode = 'host'; },
    defaultNetworkForNoNetwork: (i) => { i.HostConfig.NetworkMode = 'default'; },
    capAdd: (i) => { i.HostConfig.CapAdd = ['SYS_ADMIN']; },
    noCapDrop: (i) => { i.HostConfig.CapDrop = null; },
    writableRoot: (i) => { i.HostConfig.ReadonlyRootfs = false; },
    hostPid: (i) => { i.HostConfig.PidMode = 'host'; },
    hostIpc: (i) => { i.HostConfig.IpcMode = 'host'; },
    device: (i) => { i.HostConfig.Devices = [{ PathOnHost: '/dev/sda' }]; },
    secOpt: (i) => { i.HostConfig.SecurityOpt = ['seccomp=unconfined']; },
    memory: (i) => { i.HostConfig.Memory = 0; },
    cpus: (i) => { i.HostConfig.NanoCpus = 0; },
    pids: (i) => { i.HostConfig.PidsLimit = -1; },
    dockerSocket: (i) => { i.Mounts.push({ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock', RW: true }); },
    parentMount: (i) => { i.Mounts[0].Source = path.dirname(i.Mounts[0].Source); },
    extraMount: (i) => { i.Mounts.push({ Type: 'bind', Source: os.homedir(), Destination: '/home', RW: true }); },
    gitMaskWritable: (i) => { i.Mounts.find((m) => m.Destination === '/workspace/.git').RW = true; },
    extraEnv: (i) => { i.Config.Env.push('GH_TOKEN=leaked'); },
    root: (i) => { i.Config.User = '0:0'; },
    otherImage: (i) => { i.Image = 'sha256:' + 'f'.repeat(64); },
    logging: (i) => { i.HostConfig.LogConfig.Type = 'json-file'; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    await withSetup(async ({ fake, prepare, stateRoot }) => {
      fake.mutateInspect = (info) => { if (fake.callsOf('create').length) mutate(info); };
      const r = await prepare();
      assert.deepEqual([r.state, r.code], ['BLOCKED', 'POLICY_READBACK_MISMATCH'], name);
      assert.equal(fake.containers.size, 0, `${name}: our container is removed`);
      assert.deepEqual(r.evidence, []);
      assert.deepEqual(fs.readdirSync(stateRoot), [], `${name}: mask state cleaned`);
    });
  }
});

test('NO_NETWORK vs PROVIDER_NETWORK: Docker readback decides, not the argv we sent', async () => {
  await withSetup(async ({ prepare, fake, runtime }) => {
    const r = await prepare({ policy: policyOf({ network: 'NO_NETWORK' }) });
    assert.equal(r.evidence[0].data.checks.networkMode, true);
    assert.equal(fake.containers.get(r.name).network, 'none');
    await runtime.destroy(r.sandboxId);
  });
  await withSetup(async ({ prepare, fake, runtime }) => {
    const r = await prepare({ policy: policyOf({ network: 'PROVIDER_NETWORK' }) });
    assert.equal(r.state, 'PREPARED');
    assert.equal(fake.containers.get(r.name).network, 'bridge');
    const probe = await runtime.probe();
    assert.equal(probe.capabilities.providerNetworkRestrictsToProvider, false);
    await runtime.destroy(r.sandboxId);
  });
});

test('limits: CPU, memory, PIDs are passed to Docker; timeout and output cap go to the start stream', async () => withSetup(async ({ fake, prepare, runtime }) => {
  const r = await prepare({ policy: policyOf({ cpus: 0.5, memoryMb: 96, pids: 20, timeoutMs: 7000, outputBytes: 8192 }) });
  const create = fake.callsOf('create')[0];
  for (const flag of ['--cpus=0.5', '--memory=96m', '--memory-swap=96m', '--pids-limit=20']) assert.ok(create.includes(flag), flag);
  await runtime.start(r.sandboxId);
  assert.equal(fake.streams[0].timeoutMs, 7000);
  assert.deepEqual(fake.streams[0].limits, { maxStdoutBytes: 8192 });
  assert.deepEqual(fake.streams[0].args, ['start', '-a', r.containerId], 'start targets the immutable id, not the name');
  const defaults = await prepare();
  assert.ok(fake.callsOf('create')[1].some((a) => a.startsWith('--memory=')) && fake.callsOf('create')[1].some((a) => a.startsWith('--pids-limit=')), 'never unlimited by default');
  await runtime.destroy(r.sandboxId); await runtime.destroy(defaults.sandboxId);
}));

test('start: FINISHED comes from inspect readback (exit code and OOM), with LOCALLY_VERIFIED evidence', async () => withSetup(async ({ fake, prepare, runtime }) => {
  fake.scenario = { lines: ['hello', 'world'], exitCode: 3, hang: false, oom: false };
  const r = await prepare();
  const lines = [];
  const res = await runtime.start(r.sandboxId, { onLine: (l) => lines.push(l) });
  assert.deepEqual([res.state, res.outcome, res.exitCode, res.oomKilled], ['EXITED', 'FINISHED', 3, false]);
  assert.deepEqual(res.lines, ['hello', 'world']);
  assert.deepEqual(lines, ['hello', 'world']);
  assert.equal(res.evidence[0].grade, 'LOCALLY_VERIFIED');
  assert.ok(!JSON.stringify(res.evidence).includes('hello'), 'container stdout is not evidence');
  fake.scenario = { lines: [], exitCode: 137, oom: true };
  const r2 = await prepare();
  const oom = await runtime.start(r2.sandboxId);
  assert.deepEqual([oom.exitCode, oom.oomKilled], [137, true]);
  assert.equal((await runtime.start(r.sandboxId)).code, 'INVALID_STATE', 'a sandbox cannot be started twice');
}));

test('timeout: the container is stopped and TIMED_OUT is reported only after readback confirms it stopped', async () => withSetup(async ({ fake, prepare, runtime }) => {
  fake.scenario = { lines: [], hang: true };
  const r = await prepare({ policy: policyOf({ timeoutMs: 600 }) });
  const res = await runtime.start(r.sandboxId);
  assert.deepEqual([res.state, res.outcome], ['EXITED', 'TIMED_OUT']);
  assert.equal(fake.containers.get(r.name).running, false);
  assert.deepEqual(fake.calls.map((c) => c[0]).filter((v) => ['stop', 'kill'].includes(v)), ['stop']);
}));

test('stop/kill: stop first, kill only if it is still running, STOPPED only on confirmation, otherwise UNKNOWN', async () => {
  await withSetup(async ({ fake, prepare, runtime }) => {
    fake.scenario = { hang: true };
    fake.stopStopsContainer = false; // PID 1 ignores SIGTERM: docker stop would not stop it in the fake
    const r = await prepare({ policy: policyOf({ timeoutMs: 600 }) });
    const res = await runtime.start(r.sandboxId);
    assert.equal(res.state, 'EXITED');
    assert.deepEqual(fake.calls.map((c) => c[0]).filter((v) => ['stop', 'kill'].includes(v)), ['stop', 'kill']);
    assert.equal(res.outcome, 'TIMED_OUT');
  });
  await withSetup(async ({ fake, prepare, runtime }) => {
    fake.scenario = { hang: true };
    fake.stopStopsContainer = false; fake.killKillsContainer = false; // nothing can stop it
    const r = await prepare({ policy: policyOf({ timeoutMs: 600 }) });
    const res = await runtime.start(r.sandboxId);
    assert.equal(res.state, 'UNKNOWN');
    assert.equal(res.code, 'STOP_NOT_CONFIRMED');
    assert.notEqual(res.outcome, 'FINISHED');
    const stopped = await runtime.stop(r.sandboxId);
    assert.deepEqual([stopped.state, stopped.code], ['UNKNOWN', 'STOP_NOT_CONFIRMED']);
    assert.deepEqual(stopped.evidence, []);
  });
});

test('ambiguous Docker answers are UNKNOWN or BLOCKED, never success or absence', async () => {
  await withSetup(async ({ fake, prepare }) => {
    fake.ambiguousInspect = true;
    const r = await prepare();
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'AMBIGUOUS_DOCKER_STATE']);
    noDockerCreate(fake);
  });
  await withSetup(async ({ fake, prepare, runtime }) => {
    const r = await prepare();
    fake.ambiguousInspect = true;
    assert.equal((await runtime.start(r.sandboxId)).state, 'UNKNOWN');
    assert.equal((await runtime.inspect(r.sandboxId)).state, 'UNKNOWN');
    assert.deepEqual((await runtime.stop(r.sandboxId)).state, 'UNKNOWN');
    const destroyed = await runtime.destroy(r.sandboxId);
    assert.equal(destroyed.state, 'UNKNOWN');
    assert.equal(fake.callsOf('rm').length, 0, 'nothing is deleted on ambiguity');
    fake.ambiguousInspect = false;
    await runtime.destroy(r.sandboxId);
  });
});

test('collision: a pre-existing container with this identity BLOCKS and is never deleted; foreign containers are never destroyed', async () => withSetup(async ({ fake, runtime, scratch }) => {
  const sandboxId = id();
  const name = `cc-sandbox-scratch-${sandboxId.toLowerCase()}`;
  fake.addForeign(name);
  const r = await runtime.prepare({ sandboxId, role: 'scratch', worktreePath: scratch.wt, policy: policyOf(), command: ['true'] });
  assert.deepEqual([r.state, r.code], ['BLOCKED', 'CONTAINER_EXISTS']);
  assert.equal(fake.callsOf('rm').length, 0);
  assert.ok(fake.containers.has(name));
  noDockerCreate(fake);
}));

test('destroy: idempotent, ownership-checked, and cleans mask state', async () => withSetup(async ({ fake, prepare, runtime, stateRoot }) => {
  const r = await prepare();
  const a = await runtime.destroy(r.sandboxId);
  assert.deepEqual([a.state, a.already], ['DESTROYED', false]);
  assert.equal(a.evidence[0].kind, 'sandbox_destroyed');
  const b = await runtime.destroy(r.sandboxId);
  assert.deepEqual([b.state, b.already], ['DESTROYED', true]);
  assert.equal(fake.callsOf('rm').length, 1, 'removed exactly once');
  assert.deepEqual(fs.readdirSync(stateRoot), []);
  assert.deepEqual((await runtime.destroy('never-existed-1')).state, 'DESTROYED');
  // identity swapped under us: refuse to touch it
  const r2 = await prepare();
  fake.containers.get(r2.name).labels = {};
  const refused = await runtime.destroy(r2.sandboxId);
  assert.deepEqual([refused.state, refused.code], ['BLOCKED', 'NOT_OWNED']);
  assert.equal(fake.callsOf('rm').length, 1);
}));

test('create failure: a plain failure leaves nothing; a container that appears under our name is NEVER removed', async () => {
  await withSetup(async ({ fake, prepare, stateRoot }) => {
    fake.failCreate = true;
    const r = await prepare();
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'CREATE_FAILED']);
    assert.equal(fake.containers.size, 0);
    assert.deepEqual(fs.readdirSync(stateRoot), []);
  });
  await withSetup(async ({ fake, prepare, runtime, stateRoot }) => {
    // initial inspect(name) = ABSENT → docker create fails → second inspect(name) = PRESENT (someone else's container)
    fake.failCreate = true; fake.leaveBehindOnFailedCreate = true;
    const sandboxId = id();
    const r = await prepare({ sandboxId });
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'CREATE_AMBIGUOUS']);
    assert.equal(fake.callsOf('rm').length, 0, 'ownership is unprovable, so nothing is removed');
    assert.equal(fake.callsOf('stop').length + fake.callsOf('kill').length, 0);
    assert.equal(fake.containers.size, 1, 'the container under our name is untouched');
    assert.deepEqual(r.evidence, []);
    assert.deepEqual(fs.readdirSync(stateRoot), [], 'our own mask state is cleaned');
    const d = await runtime.destroy(sandboxId);
    assert.deepEqual([d.state, d.code], ['UNKNOWN', 'CREATE_AMBIGUOUS'], 'cleanup refuses to guess');
    assert.equal(fake.callsOf('rm').length, 0);
    assert.deepEqual((await runtime.stop(sandboxId)).code, 'NO_TRACKED_CONTAINER_ID');
  });
});

test('start re-verifies identity and policy just before running and refuses a swapped or modified container', async () => {
  await withSetup(async ({ fake, prepare, runtime }) => {
    const r = await prepare();
    const replacement = fake.replace(r.name);
    const res = await runtime.start(r.sandboxId);
    assert.deepEqual([res.state, res.code], ['BLOCKED', 'CONTAINER_CHANGED']);
    assert.equal(fake.streams.length, 0, 'nothing was started');
    assert.equal(fake.containers.get(r.name), replacement, 'the replacement is untouched');
  });
  await withSetup(async ({ fake, prepare, runtime }) => {
    const r = await prepare();
    fake.mutateInspect = (i) => { i.HostConfig.Privileged = true; };
    assert.equal((await runtime.start(r.sandboxId)).code, 'CONTAINER_CHANGED');
    assert.equal(fake.streams.length, 0);
  });
});

test('docker unavailable is BLOCKED with no host fallback; images are never pulled and platform/digest are checked', async () => {
  await withSetup(async ({ fake, runtime, prepare }) => {
    fake.unavailable = true;
    const probe = await runtime.probe();
    assert.deepEqual([probe.available, probe.reason], [false, 'DOCKER_UNAVAILABLE']);
    const r = await prepare();
    assert.equal(r.state, 'BLOCKED');
    noDockerCreate(fake);
  });
  for (const [mutate, code] of [[(f) => { f.imagePresent = false; }, 'IMAGE_UNAVAILABLE'], [(f) => { f.imagePlatform = { Os: 'linux', Architecture: 'amd64' }; }, 'IMAGE_PLATFORM_MISMATCH'], [(f) => { f.imageDigestOk = false; }, 'IMAGE_DIGEST_MISMATCH']]) {
    await withSetup(async ({ fake, prepare }) => {
      mutate(fake);
      const r = await prepare();
      assert.deepEqual([r.state, r.code], ['BLOCKED', code]);
      assert.ok(!fake.calls.some((c) => c.includes('pull')), 'no pull is ever attempted');
      noDockerCreate(fake);
    });
  }
  await withSetup(async ({ fake, runtime }) => {
    fake.engine = { Version: '1', Os: 'windows', Arch: 'amd64' };
    assert.equal((await runtime.probe()).reason, 'UNSUPPORTED_ENGINE');
  });
});

test('probe reports engine, per-image digest/platform and honest network capabilities', async () => withSetup(async ({ runtime }) => {
  const p = await runtime.probe();
  assert.equal(p.available, true);
  assert.deepEqual(p.engine, { version: '29.8.1', os: 'linux', arch: 'arm64' });
  assert.deepEqual([p.images['busybox-test'].present, p.images['busybox-test'].digest, p.images['busybox-test'].arch], [true, IMG.digest, 'arm64']);
  assert.deepEqual(p.capabilities.networkProfiles, ['NO_NETWORK', 'PROVIDER_NETWORK']);
  assert.equal(p.capabilities.dockerSocket, 'never mounted');
}));

test('environment: host process.env is never inherited into the container or the docker client', async () => withSetup(async ({ fake, prepare, runtime }) => {
  const secrets = { GH_TOKEN: 'synthetic-1', ANTHROPIC_API_KEY: 'synthetic-2', AWS_SECRET_ACCESS_KEY: 'synthetic-3', SSH_AUTH_SOCK: '/synthetic/4', NPM_TOKEN: 'synthetic-5', OPENAI_API_KEY: 'synthetic-6' };
  const saved = { ...process.env };
  Object.assign(process.env, secrets);
  try {
    const r = await prepare({ policy: policyOf({ env: { CI: '1' } }) });
    const text = JSON.stringify(fake.calls);
    for (const v of Object.values(secrets)) assert.ok(!text.includes(v));
    assert.deepEqual(Object.keys(fake.containers.get(r.name).env).sort(), ['CI', 'HOME', 'PATH']);
    // The docker client itself gets only HOME and PATH.
    let spawned;
    const client = new DockerClient({ dockerPath: '/Applications/Docker.app/Contents/Resources/bin/docker', spawnImpl: (c, a, o) => { spawned = { c, a, o }; throw new Error('stop'); } });
    await client.run(['version']);
    assert.deepEqual(Object.keys(spawned.o.env).sort(), ['HOME', 'PATH']);
    assert.equal(spawned.o.shell, false);
    assert.equal(spawned.c, '/Applications/Docker.app/Contents/Resources/bin/docker');
    assert.deepEqual(spawned.a, ['version']);
    await runtime.destroy(r.sandboxId);
  } finally { for (const k of Object.keys(secrets)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}));

test('docker client: server-owned absolute binary, explicit argv, no shell', async () => {
  for (const bad of ['docker', './docker', '', undefined, '/a/../docker', '/x\0/docker']) assert.throws(() => new DockerClient({ dockerPath: bad }), /absolute path/);
  assert.throws(() => new DockerClient({ dockerPath: '/usr/bin/docker', env: {} }), /HOME/);
  const client = new DockerClient({ dockerPath: '/usr/bin/docker' });
  await assert.rejects(client.run('version; rm -rf /'), /Invalid docker arguments/);
  await assert.rejects(client.run(['a\0b']), /Invalid docker arguments/);
});

test('runtime requires a non-root user and a docker client; evidence kinds are the sandbox set', () => {
  assert.throws(() => new DockerSandboxRuntime({ docker: new FakeDocker(), user: { uid: 0, gid: 0 } }), /non-root/);
  assert.throws(() => new DockerSandboxRuntime({}), /docker client/);
  assert.deepEqual([...SANDBOX_EVIDENCE_KINDS], ['sandbox_created', 'sandbox_started', 'sandbox_stopped', 'sandbox_destroyed', 'sandbox_policy']);
});

// ---------- Scope boundaries ----------

const REPO = new URL('..', import.meta.url).pathname;
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'data'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

test('scope: the sandbox layer is provider-neutral and unwired; the Orchestrator is still fake-only', () => {
  for (const f of fs.readdirSync(path.join(REPO, 'server/sandbox'))) {
    const text = src(`server/sandbox/${f}`);
    assert.ok(!/claudeCliAdapter|CodexAppServerClient|codexHandoff|\bcodex\b.*spawn/i.test(text), `${f} must not depend on a provider adapter`);
  }
  const importers = walk(REPO).filter((f) => /\.(mjs|ts|tsx|js)$/.test(f) && /sandbox\/(dockerSandboxRuntime|dockerClient|sandboxPolicy|workspaceView)/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(REPO, f)).filter((f) => !f.startsWith('test/') && !f.startsWith('server/sandbox/'));
  assert.deepEqual(importers, ['server/verifier/foundation.mjs', 'server/verifier/verificationRunner.mjs'], 'only the internal verifier foundation and its internal runner reuse workspace gates; no route is wired');
  assert.ok(!/sandbox/.test(src('server.ts')) && !/sandbox/.test(src('server/tasks/taskRoutes.mjs')) && !/sandbox/i.test(src('server/execution/orchestrator.mjs')));
  assert.match(src('server/execution/orchestrator.mjs'), /this\.#adapter\.id !== 'fake'/);
  assert.ok(!/claude|codex/i.test(src('server/execution/orchestrator.mjs')));
  const routes = src('server/tasks/taskRoutes.mjs');
  assert.deepEqual([...routes.matchAll(/router\.(get|post|put|patch|delete)\('([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`), ['post /', 'get /', 'get /:taskId']);
});

test('scope: no Docker client code uses a shell or host-wide docker access', () => {
  const client = src('server/sandbox/dockerClient.mjs') + src('server/execution/streamingProcess.mjs');
  assert.ok(!/shell:\s*true|exec\(|execSync|spawnSync/.test(client));
  assert.match(src('server/execution/streamingProcess.mjs'), /shell: false/);
});
