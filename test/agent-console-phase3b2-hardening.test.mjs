import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { DockerSandboxRuntime } from '../server/sandbox/dockerSandboxRuntime.mjs';
import { tmpfsOptionsEqual, verifyContainerReadback } from '../server/sandbox/readbackVerifier.mjs';
import { FakeDocker } from './helpers/fakeDocker.mjs';
import { makeScratch, realTmp } from './helpers/dockerScratch.mjs';

const policyOf = (extra = {}) => ({ network: 'NO_NETWORK', image: 'busybox-test', ...extra });
let n = 0;
const id = () => `hard-${process.pid}-${n++}-abcdef`;

function setup({ fake = new FakeDocker() } = {}) {
  const scratch = makeScratch();
  const stateRoot = realTmp('cc-p3b2-hstate-');
  const runtime = new DockerSandboxRuntime({ docker: fake, stateRoot, commandCenterRoot: process.cwd(), user: { uid: 501, gid: 20 } });
  const prepare = (extra = {}) => runtime.prepare({ sandboxId: id(), role: 'scratch', worktreePath: scratch.wt, policy: policyOf(), command: ['true'], ...extra });
  return { fake, scratch, stateRoot, runtime, prepare, done: () => { runtime.dispose(); scratch.cleanup(); } };
}
async function withSetup(fn) { const s = setup(); try { return await fn(s); } finally { s.done(); } }
const verbs = (fake, ...names) => fake.calls.filter((c) => names.includes(c[0]));

// =================================================================================================
// Blocker 1 — immutable container-ID ownership
// =================================================================================================

test('ownership: stop, kill and rm target the exact verified container ID, never the name', async () => withSetup(async ({ fake, prepare, runtime }) => {
  fake.scenario = { hang: true }; fake.stopStopsContainer = false;
  const r = await prepare({ policy: policyOf({ timeoutMs: 600 }) });
  await runtime.start(r.sandboxId); // times out → stop → kill
  const destructive = verbs(fake, 'stop', 'kill');
  assert.deepEqual(destructive.map((c) => c[0]), ['stop', 'kill']);
  for (const call of destructive) assert.equal(call.at(-1), r.containerId, `${call[0]} must use the id`);
  await runtime.destroy(r.sandboxId);
  const rm = verbs(fake, 'rm');
  assert.equal(rm.length, 1);
  assert.equal(rm[0].at(-1), r.containerId);
  assert.ok(!verbs(fake, 'stop', 'kill', 'rm').some((c) => c.includes(r.name)), 'the name is never an operand of a state-changing command');
  assert.equal(fake.callsOf('start')[0].at(-1) ?? fake.streams[0].args.at(-1), r.containerId);
}));

test('ownership: an owned container replaced by a foreign one before STOP — the replacement is never stopped, no stop evidence', async () => withSetup(async ({ fake, prepare, runtime }) => {
  const r = await prepare();
  const foreign = fake.replace(r.name);
  foreign.running = true;
  const res = await runtime.stop(r.sandboxId);
  assert.equal(fake.callsOf('stop').length + fake.callsOf('kill').length, 0, 'nothing was stopped or killed');
  assert.equal(foreign.running, true, 'the replacement is untouched');
  assert.ok(fake.containers.get(r.name) === foreign);
  assert.deepEqual(res.evidence, [], 'no evidence is emitted for the old id');
  assert.ok(res.already === true || res.state === 'BLOCKED', 'the old identity is gone, which is reported without touching anyone else');
}));

test('ownership: the same id with changed ownership labels is NOT_OWNED for stop, start, inspect and destroy', async () => withSetup(async ({ fake, prepare, runtime }) => {
  const r = await prepare();
  for (const mutate of [(c) => { c.labels = {}; }, (c) => { c.labels['cc.sandbox.id'] = 'someone-else-1'; }, (c) => { c.labels['cc.sandbox.role'] = 'agent'; }, (c) => { c.labels['cc.sandbox'] = '0'; }]) {
    const container = fake.containers.get(r.name);
    const saved = { ...container.labels };
    mutate(container);
    container.running = true;
    const stop = await runtime.stop(r.sandboxId);
    assert.deepEqual([stop.state, stop.code], ['BLOCKED', 'NOT_OWNED']);
    assert.deepEqual(stop.evidence, []);
    assert.equal((await runtime.destroy(r.sandboxId)).code, 'NOT_OWNED');
    assert.deepEqual((await runtime.inspect(r.sandboxId)).state, 'UNKNOWN');
    assert.equal((await runtime.start(r.sandboxId)).code, 'CONTAINER_CHANGED');
    assert.equal(container.running, true, 'still running: nothing touched it');
    container.labels = saved; container.running = false;
  }
  assert.equal(verbs(fake, 'stop', 'kill', 'rm').length, 0);
  assert.equal(fake.streams.length, 0);
}));

test('ownership: an owned container replaced before DESTROY — the replacement is never removed', async () => withSetup(async ({ fake, prepare, runtime, stateRoot }) => {
  const r = await prepare();
  const foreign = fake.replace(r.name);
  const res = await runtime.destroy(r.sandboxId);
  assert.equal(verbs(fake, 'rm').length, 0, 'rm was never called; the reused name was not followed');
  assert.ok(fake.containers.get(r.name) === foreign, 'the foreign container still exists');
  assert.equal(res.state, 'DESTROYED', 'our exact id is confirmed absent');
  assert.equal(res.evidence[0].data.containerId, r.containerId);
  assert.deepEqual(fs.readdirSync(stateRoot), [], 'our own mask state is cleaned');
}));

test('ownership: normal stop, normal destroy and idempotent cleanup still succeed', async () => withSetup(async ({ fake, prepare, runtime }) => {
  fake.scenario = { hang: true };
  const r = await prepare({ policy: policyOf({ timeoutMs: 600 }) });
  const run = await runtime.start(r.sandboxId);
  assert.deepEqual([run.state, run.outcome], ['EXITED', 'TIMED_OUT']);
  const stop = await runtime.stop(r.sandboxId);
  assert.equal(stop.state, 'STOPPED');
  assert.deepEqual([stop.evidence[0].kind, stop.evidence[0].grade, stop.evidence[0].data.containerId], ['sandbox_stopped', 'LOCALLY_VERIFIED', r.containerId]);
  assert.equal((await runtime.stop(r.sandboxId)).state, 'STOPPED', 'stop is idempotent');
  const a = await runtime.destroy(r.sandboxId);
  assert.deepEqual([a.state, a.already, a.evidence[0].grade], ['DESTROYED', false, 'LOCALLY_VERIFIED']);
  const b = await runtime.destroy(r.sandboxId);
  assert.deepEqual([b.state, b.already], ['DESTROYED', true]);
  assert.equal(verbs(fake, 'rm').length, 1);
  assert.equal(fake.containers.size, 0);
}));

test('ownership: a failed policy readback removes only the verified-identity container, by id', async () => withSetup(async ({ fake, prepare }) => {
  fake.mutateInspect = (info) => { if (fake.callsOf('create').length) info.HostConfig.Privileged = true; };
  const r = await prepare();
  assert.equal(r.code, 'POLICY_READBACK_MISMATCH');
  const rm = verbs(fake, 'rm');
  assert.equal(rm.length, 1);
  assert.match(rm[0].at(-1), /^[0-9a-f]{64}$/, 'removed by immutable id');
  assert.equal(fake.containers.size, 0);
}));

test('ownership: a created container whose labels were not applied is left untouched and reported NOT_OWNED', async () => withSetup(async ({ fake, prepare, runtime }) => {
  fake.mutateInspect = (info) => { if (fake.callsOf('create').length) info.Config.Labels = {}; };
  const r = await prepare();
  assert.deepEqual([r.state, r.code], ['BLOCKED', 'NOT_OWNED']);
  assert.equal(verbs(fake, 'rm', 'stop', 'kill').length, 0);
  assert.equal(fake.containers.size, 1);
  assert.deepEqual((await runtime.destroy(r.sandboxId)).state === 'DESTROYED', false, 'it never claims DESTROYED');
}));

// =================================================================================================
// Blocker 2 — strict inspect verification
// =================================================================================================

const del = (path_) => (info) => { const keys = path_.split('.'); let o = info; for (const k of keys.slice(0, -1)) o = o[k]; delete o[keys.at(-1)]; };
const set = (path_, value) => (info) => { const keys = path_.split('.'); let o = info; for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = value; };

const MISSING = {
  PidMode: del('HostConfig.PidMode'), IpcMode: del('HostConfig.IpcMode'), UsernsMode: del('HostConfig.UsernsMode'), UTSMode: del('HostConfig.UTSMode'),
  Devices: del('HostConfig.Devices'), DeviceCgroupRules: del('HostConfig.DeviceCgroupRules'), DeviceRequests: del('HostConfig.DeviceRequests'),
  SecurityOpt: del('HostConfig.SecurityOpt'), NetworkMode: del('HostConfig.NetworkMode'), ReadonlyRootfs: del('HostConfig.ReadonlyRootfs'),
  Privileged: del('HostConfig.Privileged'), CapDrop: del('HostConfig.CapDrop'), CapAdd: del('HostConfig.CapAdd'), PortBindings: del('HostConfig.PortBindings'),
  PublishAllPorts: del('HostConfig.PublishAllPorts'), Links: del('HostConfig.Links'), Binds: del('HostConfig.Binds'), VolumesFrom: del('HostConfig.VolumesFrom'),
  Memory: del('HostConfig.Memory'), MemorySwap: del('HostConfig.MemorySwap'), NanoCpus: del('HostConfig.NanoCpus'), PidsLimit: del('HostConfig.PidsLimit'),
  LogConfig: del('HostConfig.LogConfig'), Tmpfs: del('HostConfig.Tmpfs'), User: del('Config.User'), WorkingDir: del('Config.WorkingDir'), Env: del('Config.Env'), Mounts: del('Mounts'),
  ImageId: del('Image'), 'Mount.RW': (i) => { delete i.Mounts[0].RW; },
};
const UNSAFE = {
  'no-new-privileges=false': set('HostConfig.SecurityOpt', ['no-new-privileges=false']),
  'no-new-privileges:false': set('HostConfig.SecurityOpt', ['no-new-privileges:false']),
  'no-new-privileges + seccomp=unconfined': set('HostConfig.SecurityOpt', ['no-new-privileges', 'seccomp=unconfined']),
  'empty SecurityOpt': set('HostConfig.SecurityOpt', []),
  'null SecurityOpt': set('HostConfig.SecurityOpt', null),
  'prefix-only no-new-privileges-x': set('HostConfig.SecurityOpt', ['no-new-privileges-bypass']),
  'privileged': set('HostConfig.Privileged', true),
  'Privileged null': set('HostConfig.Privileged', null),
  'pid host': set('HostConfig.PidMode', 'host'),
  'ipc host': set('HostConfig.IpcMode', 'host'),
  'ipc shareable': set('HostConfig.IpcMode', 'shareable'),
  'userns host': set('HostConfig.UsernsMode', 'host'),
  'uts host': set('HostConfig.UTSMode', 'host'),
  'device present': set('HostConfig.Devices', [{ PathOnHost: '/dev/sda' }]),
  'device request': set('HostConfig.DeviceRequests', [{ Driver: 'nvidia' }]),
  'capdrop partial': set('HostConfig.CapDrop', ['CHOWN']),
  'capdrop ALL + extra': set('HostConfig.CapDrop', ['ALL', 'CHOWN']),
  'capadd present': set('HostConfig.CapAdd', ['NET_ADMIN']),
  'writable root': set('HostConfig.ReadonlyRootfs', false),
  'readonly root as string': set('HostConfig.ReadonlyRootfs', 'true'),
  'host network': set('HostConfig.NetworkMode', 'host'),
  'default network for NO_NETWORK': set('HostConfig.NetworkMode', 'default'),
  'ports bound': set('HostConfig.PortBindings', { '80/tcp': [{ HostPort: '80' }] }),
  'publish all ports': set('HostConfig.PublishAllPorts', true),
  'legacy binds': set('HostConfig.Binds', ['/:/host']),
  'volumes-from': set('HostConfig.VolumesFrom', ['other']),
  'links': set('HostConfig.Links', ['other:o']),
  'root user': set('Config.User', '0:0'),
  'empty user': set('Config.User', ''),
  'wrong workdir': set('Config.WorkingDir', '/'),
  'memory unlimited': set('HostConfig.Memory', 0),
  'memory as string': set('HostConfig.Memory', '536870912'),
  'cpus unlimited': set('HostConfig.NanoCpus', 0),
  'pids unlimited': set('HostConfig.PidsLimit', 0),
  'json-file logging': set('HostConfig.LogConfig', { Type: 'json-file' }),
  'tmpfs exec/suid/dev/4g': set('HostConfig.Tmpfs', { '/tmp': 'rw,exec,suid,dev,size=4g' }),
  'tmpfs oversized': set('HostConfig.Tmpfs', { '/tmp': 'rw,noexec,nosuid,nodev,size=4g' }),
  'tmpfs no size': set('HostConfig.Tmpfs', { '/tmp': 'rw,noexec,nosuid,nodev' }),
  'tmpfs exec': set('HostConfig.Tmpfs', { '/tmp': 'rw,exec,nosuid,nodev,size=64m' }),
  'tmpfs suid': set('HostConfig.Tmpfs', { '/tmp': 'rw,noexec,suid,nodev,size=64m' }),
  'tmpfs dev': set('HostConfig.Tmpfs', { '/tmp': 'rw,noexec,nosuid,dev,size=64m' }),
  'tmpfs wrong path only': set('HostConfig.Tmpfs', { '/var': 'rw,noexec,nosuid,nodev,size=64m' }),
  'tmpfs destination only (empty opts)': set('HostConfig.Tmpfs', { '/tmp': '' }),
  'tmpfs extra mount': set('HostConfig.Tmpfs', { '/tmp': 'rw,noexec,nosuid,nodev,size=64m', '/home': 'rw,size=1g' }),
  'tmpfs missing entirely': set('HostConfig.Tmpfs', {}),
  'mounts null': set('Mounts', null),
  'mount writable git mask': (i) => { const m = i.Mounts.find((x) => x.Destination === '/workspace/.git'); if (m) m.RW = true; },
  'mount RW as string': (i) => { i.Mounts[0].RW = 'true'; },
  'env var not string': set('Config.Env', [null]),
};

async function expectNotVerified(mutate, { code, gitKind = 'file', label }) {
  await withSetup(async ({ fake, prepare, scratch }) => {
    if (gitKind === 'dir') { fs.rmSync(path.join(scratch.wt, '.git')); fs.mkdirSync(path.join(scratch.wt, '.git')); }
    fake.mutateInspect = (info) => { if (fake.callsOf('create').length) mutate(info); };
    const r = await prepare();
    assert.notEqual(r.state, 'PREPARED', label);
    assert.deepEqual(r.evidence, [], `${label}: no evidence of any grade`);
    assert.ok(!JSON.stringify(r).includes('LOCALLY_VERIFIED'), label);
    if (code) assert.equal(r.code, code, label);
    assert.equal(fake.containers.size, 0, `${label}: the verified-identity container is removed`);
    const rm = verbs(fake, 'rm'); assert.equal(rm.length, 1, label); assert.match(rm[0].at(-1), /^[0-9a-f]{64}$/, label);
  });
}

test('strict readback: every missing security field is INCOMPLETE and never PREPARED / LOCALLY_VERIFIED', async () => {
  for (const [name, mutate] of Object.entries(MISSING)) await expectNotVerified(mutate, { code: 'POLICY_READBACK_INCOMPLETE', label: `missing ${name}` });
});

test('strict readback: every present-but-unsafe value is a MISMATCH and never PREPARED / LOCALLY_VERIFIED', async () => {
  for (const [name, mutate] of Object.entries(UNSAFE)) {
    await withSetup(async ({ fake, prepare }) => {
      fake.mutateInspect = (info) => { if (fake.callsOf('create').length) mutate(info); };
      const r = await prepare();
      assert.notEqual(r.state, 'PREPARED', name);
      assert.ok(['POLICY_READBACK_MISMATCH', 'POLICY_READBACK_INCOMPLETE'].includes(r.code), `${name}: ${r.code}`);
      assert.deepEqual(r.evidence, [], name);
      assert.ok(!JSON.stringify(r).includes('LOCALLY_VERIFIED'), name);
      assert.equal(fake.containers.size, 0, `${name}: removed by id`);
    });
  }
});

test('strict readback: the .git tmpfs must be exactly read-only/noexec/nosuid/nodev/size=1k', async () => {
  for (const [label, opts] of Object.entries({ writable: 'rw,noexec,nosuid,nodev,size=1k', 'oversized': 'ro,noexec,nosuid,nodev,size=1m', exec: 'ro,exec,nosuid,nodev,size=1k', 'no size': 'ro,noexec,nosuid,nodev', missing: null })) {
    await expectNotVerified((info) => {
      if (opts === null) delete info.HostConfig.Tmpfs['/workspace/.git']; else info.HostConfig.Tmpfs['/workspace/.git'] = opts;
    }, { gitKind: 'dir', label: `.git tmpfs ${label}` });
  }
  await withSetup(async ({ fake, prepare, scratch, runtime }) => {
    fs.rmSync(path.join(scratch.wt, '.git')); fs.mkdirSync(path.join(scratch.wt, '.git'));
    const ok = await prepare();
    assert.equal(ok.state, 'PREPARED', 'the exact intended options verify');
    assert.equal(ok.evidence[0].data.tmpfs['/workspace/.git'], 'ro,noexec,nosuid,nodev,size=1k');
    await runtime.destroy(ok.sandboxId);
  });
});

test('strict readback: option ORDER and equivalent size spellings are normalized, weaker options are not', () => {
  assert.equal(tmpfsOptionsEqual('nodev,nosuid,noexec,rw,size=64m', 'rw,noexec,nosuid,nodev,size=64m'), true);
  assert.equal(tmpfsOptionsEqual('rw,noexec,nosuid,nodev,size=65536k', 'rw,noexec,nosuid,nodev,size=64m'), true);
  assert.equal(tmpfsOptionsEqual('rw,noexec,nosuid,nodev,size=67108864', 'rw,noexec,nosuid,nodev,size=64m'), true);
  for (const weaker of ['rw,exec,suid,dev,size=4g', 'rw,noexec,nosuid,nodev,size=4g', 'rw,noexec,nosuid,nodev', 'rw,noexec,nosuid,size=64m', 'rw,noexec,nosuid,nodev,size=64m,exec', 'rw,noexec,nosuid,nodev,size=64m,size=4g', '', undefined, null, 5]) {
    assert.equal(tmpfsOptionsEqual(weaker, 'rw,noexec,nosuid,nodev,size=64m'), false, String(weaker));
  }
});

test('strict readback: no tmpfs expected — missing HostConfig.Tmpfs is INCOMPLETE, explicit {} is PREPARED', async () => {
  const noTmpfs = { policy: policyOf({ writablePaths: [] }) };
  await withSetup(async ({ fake, prepare }) => {
    fake.mutateInspect = (info) => { if (fake.callsOf('create').length) delete info.HostConfig.Tmpfs; };
    const r = await prepare(noTmpfs);
    assert.notEqual(r.state, 'PREPARED');
    assert.equal(r.code, 'POLICY_READBACK_INCOMPLETE');
    assert.deepEqual(r.evidence, []);
    assert.ok(!JSON.stringify(r).includes('LOCALLY_VERIFIED'));
    assert.equal(fake.containers.size, 0);
  });
  await withSetup(async ({ fake, prepare, runtime }) => {
    fake.mutateInspect = (info) => { if (fake.callsOf('create').length) info.HostConfig.Tmpfs = {}; };
    const r = await prepare(noTmpfs);
    assert.equal(r.state, 'PREPARED');
    assert.equal(r.evidence.find((e) => e.kind === 'sandbox_policy').data.checks.tmpfs, true);
    await runtime.destroy(r.sandboxId);
  });
  // tmpfs entries present although none were requested stay a mismatch
  await withSetup(async ({ fake, prepare }) => {
    fake.mutateInspect = (info) => { if (fake.callsOf('create').length) info.HostConfig.Tmpfs = { '/tmp': 'rw,size=1g' }; };
    assert.equal((await prepare(noTmpfs)).code, 'POLICY_READBACK_MISMATCH');
  });
});

test('strict readback: malformed or empty inspect output is UNKNOWN / INCOMPLETE, never verified', async () => {
  const verdict = (info) => verifyContainerReadback(info, { plan: { policy: { network: 'NO_NETWORK', memoryMb: 512, cpus: 1, pids: 128 }, tmpfs: {}, mounts: [], env: {}, image: { reference: 'x' }, sandboxId: 's' }, image: { imageId: 'i', envKeys: [] }, user: '501:20' });
  for (const bad of [null, undefined, [], 'x', 5, {}, { HostConfig: {} }, { HostConfig: {}, Config: {} }, { HostConfig: [], Config: {} }]) {
    const v = verdict(bad);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.missing.length > 0 || v.failures.length > 0);
  }
  await withSetup(async ({ fake, prepare, runtime }) => {
    fake.mutateInspect = null;
    const original = fake.run.bind(fake);
    let created = false;
    fake.run = async (args) => { const r = await original(args); if (args[0] === 'create') created = true; if (created && args[0] === 'inspect') return { exitCode: 0, stdout: '{not json', stderr: '', spawnError: null, timedOut: false }; return r; };
    const r = await prepare();
    assert.deepEqual([r.state, r.code], ['UNKNOWN', 'READBACK_UNCONFIRMED']);
    assert.deepEqual(r.evidence, []);
    assert.equal(verbs(fake, 'rm').length, 0);
  });
});

test('strict readback: PREPARED evidence is only produced when every check is explicitly true', async () => withSetup(async ({ prepare, runtime }) => {
  const r = await prepare();
  assert.equal(r.state, 'PREPARED');
  const checks = r.evidence.find((e) => e.kind === 'sandbox_policy').data.checks;
  assert.ok(Object.keys(checks).length >= 28);
  assert.ok(Object.values(checks).every((v) => v === true));
  for (const key of ['pidMode', 'devices', 'deviceCgroupRules', 'deviceRequests', 'securityOpt', 'networkMode', 'user', 'readonlyRootfs', 'tmpfs', 'capAdd', 'utsMode']) assert.equal(checks[key], true, key);
  await runtime.destroy(r.sandboxId);
}));

// =================================================================================================
// Blocker 3 — hard links
// =================================================================================================

test('hard links: a workspace file sharing an inode with an outside file BLOCKS activation; Docker create is never called', async () => withSetup(async ({ fake, prepare, scratch }) => {
  fs.linkSync(scratch.secret, path.join(scratch.wt, 'leak')); // synthetic outside/secret.txt ↔ workspace/leak, same inode
  assert.equal(fs.statSync(path.join(scratch.wt, 'leak')).ino, fs.statSync(scratch.secret).ino);
  const r = await prepare();
  assert.deepEqual([r.state, r.code], ['BLOCKED', 'HARDLINK_UNSAFE']);
  assert.match(r.reason, /leak/);
  assert.equal(fake.callsOf('create').length, 0);
  assert.equal(fake.calls.length, 0, 'Docker was not contacted at all');
}));

test('hard links: nested, in-workspace and executable hard links are blocked too (conservative, documented)', async () => withSetup(async ({ fake, prepare, scratch }) => {
  fs.mkdirSync(path.join(scratch.wt, 'deep/er'), { recursive: true });
  fs.writeFileSync(path.join(scratch.wt, 'deep/er/a.sh'), '#!/bin/sh\n', { mode: 0o755 });
  fs.linkSync(path.join(scratch.wt, 'deep/er/a.sh'), path.join(scratch.wt, 'b.sh')); // both names inside the workspace
  assert.equal((await prepare()).code, 'HARDLINK_UNSAFE');
  fs.rmSync(path.join(scratch.wt, 'b.sh'));
  assert.equal(fs.statSync(path.join(scratch.wt, 'deep/er/a.sh')).nlink, 1);
  fs.linkSync(scratch.secret, path.join(scratch.wt, 'deep/er/leak'));
  assert.equal((await prepare()).code, 'HARDLINK_UNSAFE', 'nested leak');
  assert.equal(fake.callsOf('create').length, 0);
}));

test('hard links: a normal single-link workspace (executable bits, nested dirs, symlink-free) is still allowed', async () => withSetup(async ({ prepare, scratch, runtime }) => {
  fs.mkdirSync(path.join(scratch.wt, 'src/lib'), { recursive: true });
  fs.writeFileSync(path.join(scratch.wt, 'src/lib/run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(scratch.wt, 'README.md'), 'x');
  const r = await prepare();
  assert.equal(r.state, 'PREPARED', JSON.stringify(r));
  await runtime.destroy(r.sandboxId);
}));

test('hard links: a link added AFTER prepare is caught by the re-scan before start; nothing is started', async () => withSetup(async ({ fake, prepare, scratch, runtime }) => {
  const r = await prepare();
  assert.equal(r.state, 'PREPARED');
  fs.linkSync(scratch.secret, path.join(scratch.wt, 'late-leak'));
  const res = await runtime.start(r.sandboxId);
  assert.deepEqual([res.state, res.code], ['BLOCKED', 'HARDLINK_UNSAFE']);
  assert.equal(fake.streams.length, 0);
  fs.rmSync(path.join(scratch.wt, 'late-leak'));
  assert.equal((await runtime.start(r.sandboxId)).state, 'EXITED', 'after the link is removed, start proceeds');
}));

// =================================================================================================
// Blocker 4 — created-but-unverified containers stay tracked
// =================================================================================================

test('tracking: create succeeds, post-create inspect is ambiguous → UNKNOWN, record kept, destroy never fakes already:true', async () => withSetup(async ({ fake, prepare, runtime, stateRoot }) => {
  fake.ambiguousAfterCreate = true;
  const sandboxId = id();
  const r = await prepare({ sandboxId });
  assert.deepEqual([r.state, r.code], ['UNKNOWN', 'READBACK_UNCONFIRMED']);
  assert.match(r.containerId, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.evidence, []);
  assert.equal(fake.containers.size, 1, 'the created container exists');
  assert.equal(verbs(fake, 'rm').length, 0, 'nothing is deleted on ambiguity');
  assert.equal(fs.readdirSync(stateRoot).length, 1, 'mask state is kept for the tracked container');

  const i = await runtime.inspect(sandboxId);
  assert.equal(i.state, 'UNKNOWN', 'tracked, not forgotten and not "absent"');
  const d1 = await runtime.destroy(sandboxId);
  assert.deepEqual([d1.state, d1.code], ['UNKNOWN', 'AMBIGUOUS_DOCKER_STATE']);
  assert.notEqual(d1.already, true, 'no fake already:true');
  assert.deepEqual(d1.evidence, []);
  assert.equal(verbs(fake, 'rm').length, 0);
  assert.equal((await prepare({ sandboxId })).code, 'DUPLICATE_SANDBOX', 'the sandbox id stays reserved while its container may exist');

  // Docker becomes readable again: the exact owned ID can be cleaned, DESTROYED only after absence is confirmed.
  fake.ambiguousInspect = false; fake.ambiguousAfterCreate = false;
  const d2 = await runtime.destroy(sandboxId);
  assert.deepEqual([d2.state, d2.already], ['DESTROYED', false]);
  assert.equal(d2.evidence[0].data.containerId, r.containerId);
  assert.equal(verbs(fake, 'rm').length, 1);
  assert.equal(verbs(fake, 'rm')[0].at(-1), r.containerId);
  assert.equal(fake.containers.size, 0);
  assert.deepEqual(fs.readdirSync(stateRoot), []);
  assert.deepEqual([(await runtime.destroy(sandboxId)).state, (await runtime.destroy(sandboxId)).already], ['DESTROYED', true]);
}));

test('tracking: DESTROYED requires Docker to confirm the exact id is absent; an unconfirmed removal stays UNKNOWN and tracked', async () => withSetup(async ({ fake, prepare, runtime, stateRoot }) => {
  const r = await prepare();
  const original = fake.run.bind(fake);
  fake.run = async (args) => (args[0] === 'rm' ? { exitCode: 0, stdout: '', stderr: '', spawnError: null, timedOut: false } : original(args)); // rm "succeeds" but nothing is removed
  const d = await runtime.destroy(r.sandboxId);
  assert.deepEqual([d.state, d.code], ['UNKNOWN', 'DESTROY_NOT_CONFIRMED']);
  assert.deepEqual(d.evidence, []);
  assert.equal(fake.containers.size, 1);
  assert.equal(fs.readdirSync(stateRoot).length, 1, 'mask kept until the destroy is confirmed');
  fake.run = original;
  assert.equal((await runtime.destroy(r.sandboxId)).state, 'DESTROYED');
}));

test('tracking: a created container whose first readback says "absent" stays tracked as UNKNOWN until Docker confirms', async () => withSetup(async ({ fake, prepare, runtime }) => {
  fake.absentAfterCreate = true;
  const r = await prepare();
  assert.deepEqual([r.state, r.code], ['UNKNOWN', 'READBACK_UNCONFIRMED']);
  const i = await runtime.inspect(r.sandboxId);
  assert.equal(i.state, 'CREATED', 'the tracked id is readable on the next look: present, ours, not started');
  const d = await runtime.destroy(r.sandboxId); // by id: the container is present and ours → removed and confirmed absent
  assert.equal(d.state, 'DESTROYED');
  assert.equal(fake.containers.size, 0);
}));

test('tracking: stop on a created-but-unverified container works by its tracked id once readable', async () => withSetup(async ({ fake, prepare, runtime }) => {
  fake.ambiguousAfterCreate = true;
  const r = await prepare();
  assert.equal((await runtime.stop(r.sandboxId)).code, 'AMBIGUOUS_DOCKER_STATE');
  fake.ambiguousInspect = false; fake.ambiguousAfterCreate = false;
  const stop = await runtime.stop(r.sandboxId);
  assert.equal(stop.state, 'STOPPED');
  await runtime.destroy(r.sandboxId);
}));

test('tracking: an exception after creation cannot make the runtime forget the container', async () => withSetup(async ({ fake, prepare, runtime }) => {
  const sandboxId = id();
  const original = fake.run.bind(fake);
  let created = false;
  fake.run = async (args) => { const r = await original(args); if (args[0] === 'create') created = true; if (created && args[0] === 'inspect') throw new Error('unexpected failure'); return r; };
  await assert.rejects(prepare({ sandboxId }), /unexpected failure/);
  fake.run = original;
  const d = await runtime.destroy(sandboxId);
  assert.equal(d.state, 'DESTROYED');
  assert.equal(d.already, false, 'it really removed the container that had been created');
  assert.equal(fake.containers.size, 0);
}));
