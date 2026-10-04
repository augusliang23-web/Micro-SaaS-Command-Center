import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { DockerSandboxRuntime } from '../server/sandbox/dockerSandboxRuntime.mjs';
import { assertDockerArgs, buildCreateArgs } from '../server/sandbox/sandboxPolicy.mjs';
import { classifyNode, scanWorkspace } from '../server/sandbox/workspaceView.mjs';
import { TEST_IMAGES } from '../server/sandbox/sandboxImages.mjs';
import { FakeDocker } from './helpers/fakeDocker.mjs';
import { makeScratch, realTmp } from './helpers/dockerScratch.mjs';

// Phase 3B2.1 — filesystem boundary: non-recursive workspace bind, mount-boundary gate, special-file gate.

const policyOf = (extra = {}) => ({ network: 'NO_NETWORK', image: 'busybox-test', ...extra });
let n = 0;
const id = () => `fsb-${process.pid}-${n++}-abcdef`;

function setup({ lstat } = {}) {
  const fake = new FakeDocker();
  const scratch = makeScratch();
  const runtime = new DockerSandboxRuntime({ docker: fake, stateRoot: realTmp('cc-p3b21-state-'), commandCenterRoot: process.cwd(), user: { uid: 501, gid: 20 }, lstat });
  const prepare = (extra = {}) => runtime.prepare({ sandboxId: id(), role: 'scratch', worktreePath: scratch.wt, policy: policyOf(), command: ['true'], ...extra });
  return { fake, scratch, runtime, prepare, done: () => { runtime.dispose(); scratch.cleanup(); } };
}
async function withSetup(fn, opts) { const s = setup(opts); try { return await fn(s); } finally { s.done(); } }

// ---- Docker-side: non-recursive bind in argv + guard --------------------------------------------------------------
const IMG = TEST_IMAGES['busybox-test'];
function sampleArgs(writablePaths = ['/tmp']) {
  const policy = { network: 'NO_NETWORK', memoryMb: 512, cpus: 1, pids: 128, writablePaths, env: {} };
  return buildCreateArgs({ name: 'cc-sandbox-scratch-x', sandboxId: 'x', role: 'scratch', policy, image: IMG, workspacePath: '/work/wt', gitMask: { kind: 'file', emptyFile: '/state/empty' }, user: '501:20', command: ['true'] });
}
const guardOpts = { image: IMG, allowedBindSources: ['/work/wt', '/state/empty'] };

test('argv: the workspace bind is non-recursive (read-only and writable); the .git mask bind is not given the option', () => {
  const ro = sampleArgs(['/tmp']);
  assert.ok(ro.includes('--mount=type=bind,src=/work/wt,dst=/workspace,readonly,bind-recursive=disabled'));
  const rw = sampleArgs(['/tmp', '/workspace']);
  assert.ok(rw.includes('--mount=type=bind,src=/work/wt,dst=/workspace,bind-recursive=disabled'));
  for (const args of [ro, rw]) {
    assert.ok(args.includes('--mount=type=bind,src=/state/empty,dst=/workspace/.git,readonly'));
    assert.equal(args.filter((a) => a.includes('bind-recursive')).length, 1);
    assert.equal(assertDockerArgs(args, guardOpts), true);
  }
});

test('argv guard: removing or mutating bind-recursive=disabled on the workspace mount is rejected', () => {
  const base = sampleArgs();
  const swap = (from, to) => base.map((a) => (a.includes(from) && a.includes('dst=/workspace,') ? to : a));
  assert.throws(() => assertDockerArgs(swap('bind-recursive', '--mount=type=bind,src=/work/wt,dst=/workspace,readonly'), guardOpts), /non-recursive/);
  for (const v of ['enabled', 'writable', 'readonly', 'DISABLED', '']) {
    assert.throws(() => assertDockerArgs(swap('bind-recursive', `--mount=type=bind,src=/work/wt,dst=/workspace,readonly,bind-recursive=${v}`), guardOpts), /Unexpected mount/, v);
  }
  assert.throws(() => assertDockerArgs(swap('bind-recursive', '--mount=type=bind,src=/work/wt,dst=/workspace,readonly,bind-recursive=disabled,bind-propagation=shared'), guardOpts), /Unexpected mount/);
  assert.throws(() => assertDockerArgs(swap('bind-recursive', '--mount=type=bind,src=/work/wt,dst=/workspace,bind-recursive=disabled,readonly'), guardOpts), /Unexpected mount/, 'option order is fixed');
  // the .git mask must stay option-free
  assert.throws(() => assertDockerArgs(base.map((a) => (a.includes('dst=/workspace/.git') ? `${a},bind-recursive=disabled` : a)), guardOpts), /bind options/);
  // exactly one workspace bind
  assert.throws(() => assertDockerArgs(base.filter((a) => !a.includes('dst=/workspace,')), guardOpts), /Exactly one/);
  assert.throws(() => assertDockerArgs([...base.slice(0, 6), base.find((a) => a.includes('dst=/workspace,')), ...base.slice(6)], guardOpts), /Exactly one/);
});

test('input: a task/policy cannot supply mount options, bind-recursive values, host paths or Docker flags', async () => withSetup(async ({ fake, prepare }) => {
  for (const extra of [
    { policy: policyOf({ bindRecursive: 'enabled' }) }, { policy: policyOf({ mountOptions: 'bind-recursive=enabled' }) },
    { policy: policyOf({ mounts: [{ src: '/', dst: '/host' }] }) }, { policy: policyOf({ dockerArgs: ['--privileged'] }) },
    { bindRecursive: 'enabled' }, { mountOptions: ['bind-recursive=enabled'] }, { dockerFlags: ['--mount=type=bind,src=/,dst=/h'] },
  ]) {
    const r = await prepare(extra);
    assert.equal(r.state, 'BLOCKED', JSON.stringify(extra));
    assert.ok(/^(INVALID_POLICY|INVALID_SPEC|UNKNOWN_POLICY_FIELD|MOUNT_NOT_ALLOWED)$/.test(r.code), `${JSON.stringify(extra)} -> ${r.code}`);
  }
  assert.equal(fake.callsOf('create').length, 0);
}));

test('readback: Docker must report the workspace bind as NonRecursive=true; missing is INCOMPLETE, false is a MISMATCH; the container is removed by id', async () => {
  const cases = {
    'HostConfig.Mounts missing': [(i) => { delete i.HostConfig.Mounts; }, 'POLICY_READBACK_INCOMPLETE'],
    'BindOptions missing': [(i) => { delete i.HostConfig.Mounts.find((m) => m.Target === '/workspace').BindOptions; }, 'POLICY_READBACK_INCOMPLETE'],
    'NonRecursive missing': [(i) => { i.HostConfig.Mounts.find((m) => m.Target === '/workspace').BindOptions = {}; }, 'POLICY_READBACK_INCOMPLETE'],
    'workspace entry missing': [(i) => { i.HostConfig.Mounts = i.HostConfig.Mounts.filter((m) => m.Target !== '/workspace'); }, 'POLICY_READBACK_INCOMPLETE'],
    'NonRecursive false': [(i) => { i.HostConfig.Mounts.find((m) => m.Target === '/workspace').BindOptions.NonRecursive = false; }, 'POLICY_READBACK_MISMATCH'],
    'NonRecursive "true" string': [(i) => { i.HostConfig.Mounts.find((m) => m.Target === '/workspace').BindOptions.NonRecursive = 'true'; }, 'POLICY_READBACK_MISMATCH'],
  };
  for (const [label, [mutate, code]] of Object.entries(cases)) {
    await withSetup(async ({ fake, prepare }) => {
      fake.mutateInspect = (info) => { if (fake.callsOf('create').length) mutate(info); };
      const r = await prepare();
      assert.notEqual(r.state, 'PREPARED', label);
      assert.equal(r.code, code, label);
      assert.deepEqual(r.evidence, [], label);
      assert.ok(!JSON.stringify(r).includes('LOCALLY_VERIFIED'), label);
      assert.equal(fake.containers.size, 0, `${label}: removed by id`);
    });
  }
  await withSetup(async ({ prepare, runtime }) => {
    const r = await prepare();
    assert.equal(r.state, 'PREPARED');
    assert.equal(r.evidence.find((e) => e.kind === 'sandbox_policy').data.checks.workspaceNonRecursive, true);
    await runtime.destroy(r.sandboxId);
  });
});

// ---- Host-side: filesystem boundary ------------------------------------------------------------------------------
/** An lstat that reports a different st_dev for the given paths (simulated mount point / foreign filesystem). */
const lstatWithForeignDev = (foreign) => (p) => {
  const real = fs.lstatSync(p);
  if (!foreign().some((f) => p === f || p.startsWith(`${f}${path.sep}`))) return real;
  return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { dev: real.dev + 1 });
};

test('mount boundary: an entry on a different filesystem BLOCKS prepare (MOUNT_BOUNDARY_UNSAFE); Docker is never contacted', async () => {
  let foreign = [];
  await withSetup(async ({ fake, scratch, prepare }) => {
    fs.mkdirSync(path.join(scratch.wt, 'mnt'));
    fs.writeFileSync(path.join(scratch.wt, 'mnt', 'inside.txt'), 'x');
    foreign = [path.join(scratch.wt, 'mnt')];
    const r = await prepare();
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'MOUNT_BOUNDARY_UNSAFE']);
    assert.match(r.reason, /mnt/);
    assert.equal(fake.calls.length, 0);
  }, { lstat: lstatWithForeignDev(() => foreign) });
});

test('mount boundary: a file on a foreign device is also blocked; a normal worktree (same device everywhere) is not', async () => {
  let foreign = [];
  await withSetup(async ({ scratch, prepare, runtime }) => {
    const ok = await prepare();
    assert.equal(ok.state, 'PREPARED', 'ordinary git worktree: no false positive');
    await runtime.destroy(ok.sandboxId);
    foreign = [path.join(scratch.wt, 'a.txt')];
    assert.equal((await prepare()).code, 'MOUNT_BOUNDARY_UNSAFE');
  }, { lstat: lstatWithForeignDev(() => foreign) });
});

test('mount boundary: a boundary introduced between prepare and start BLOCKS start; docker start is never called', async () => {
  let foreign = [];
  await withSetup(async ({ fake, scratch, prepare, runtime }) => {
    const r = await prepare();
    assert.equal(r.state, 'PREPARED');
    fs.mkdirSync(path.join(scratch.wt, 'late-mnt'));
    foreign = [path.join(scratch.wt, 'late-mnt')];
    const res = await runtime.start(r.sandboxId);
    assert.deepEqual([res.state, res.code], ['BLOCKED', 'MOUNT_BOUNDARY_UNSAFE']);
    assert.equal(fake.streams.length, 0);
    assert.equal(fake.callsOf('start').length, 0);
    foreign = [];
    await runtime.destroy(r.sandboxId);
  }, { lstat: lstatWithForeignDev(() => foreign) });
});

test('mount boundary: a foreign filesystem is not descended into (no scan of what is behind a mount)', () => {
  const s = makeScratch();
  try {
    fs.mkdirSync(path.join(s.wt, 'mnt/deep'), { recursive: true });
    fs.writeFileSync(path.join(s.wt, 'mnt/deep/x'), 'x');
    const seen = [];
    const lstat = (p) => { seen.push(p); return lstatWithForeignDev(() => [path.join(s.wt, 'mnt')])(p); };
    const scan = scanWorkspace(s.wt, { lstat });
    assert.deepEqual(scan.boundaries, ['mnt']);
    assert.ok(!seen.some((p) => p.includes(`mnt${path.sep}deep`)));
  } finally { s.cleanup(); }
});

// ---- Special filesystem nodes ------------------------------------------------------------------------------------
async function withUnixSocket(file, fn) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(file, resolve); });
  try { return await fn(); } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(file, { force: true }); }
}
const mkfifo = (file) => execFileSync('/usr/bin/mkfifo', [file]);

test('special file: a Unix socket in the workspace BLOCKS prepare (SPECIAL_FILE_UNSAFE); docker create is never called', async () => withSetup(async ({ fake, scratch, prepare }) => {
  const sock = path.join(scratch.wt, 's.sock');
  await withUnixSocket(sock, async () => {
    assert.ok(fs.lstatSync(sock).isSocket());
    const r = await prepare();
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'SPECIAL_FILE_UNSAFE']);
    assert.match(r.reason, /s\.sock \(socket\)/);
    assert.equal(fake.calls.length, 0);
  });
  assert.equal(fs.existsSync(sock), false, 'synthetic socket cleaned up');
  assert.equal((await prepare()).state, 'PREPARED', 'same workspace without the socket is allowed');
}));

test('special file: a FIFO in the workspace BLOCKS prepare (SPECIAL_FILE_UNSAFE); Docker is not contacted', async () => withSetup(async ({ fake, scratch, prepare }) => {
  mkfifo(path.join(scratch.wt, 'pipe'));
  assert.ok(fs.lstatSync(path.join(scratch.wt, 'pipe')).isFIFO());
  const r = await prepare();
  assert.deepEqual([r.state, r.code], ['BLOCKED', 'SPECIAL_FILE_UNSAFE']);
  assert.match(r.reason, /pipe \(fifo\)/);
  assert.equal(fake.calls.length, 0);
  fs.mkdirSync(path.join(scratch.wt, 'd/e'), { recursive: true });
  fs.rmSync(path.join(scratch.wt, 'pipe')); mkfifo(path.join(scratch.wt, 'd/e/nested-pipe'));
  assert.equal((await prepare()).code, 'SPECIAL_FILE_UNSAFE', 'nested');
  assert.equal(fake.calls.length, 0);
}));

test('special file: a socket or FIFO created AFTER prepare BLOCKS start; docker start is never called', async () => withSetup(async ({ fake, scratch, prepare, runtime }) => {
  const r = await prepare();
  assert.equal(r.state, 'PREPARED');
  mkfifo(path.join(scratch.wt, 'late-fifo'));
  let res = await runtime.start(r.sandboxId);
  assert.deepEqual([res.state, res.code], ['BLOCKED', 'SPECIAL_FILE_UNSAFE']);
  fs.rmSync(path.join(scratch.wt, 'late-fifo'));
  const sock = path.join(scratch.wt, 'late.sock');
  await withUnixSocket(sock, async () => {
    res = await runtime.start(r.sandboxId);
    assert.deepEqual([res.state, res.code], ['BLOCKED', 'SPECIAL_FILE_UNSAFE']);
  });
  assert.equal(fake.streams.length, 0);
  assert.equal(fake.callsOf('start').length, 0);
  await runtime.destroy(r.sandboxId);
}));

const statLike = (kind) => ({
  isSymbolicLink: () => kind === 'symlink', isDirectory: () => kind === 'dir', isFile: () => kind === 'file', isSocket: () => kind === 'socket',
  isFIFO: () => kind === 'fifo', isBlockDevice: () => kind === 'block', isCharacterDevice: () => kind === 'char',
});

test('special file: node-type classification — only directories and regular files pass; block/char devices and unknown types are special', () => {
  assert.deepEqual(classifyNode(statLike('dir')), { kind: 'dir' });
  assert.deepEqual(classifyNode(statLike('file')), { kind: 'file' });
  assert.deepEqual(classifyNode(statLike('symlink')), { kind: 'symlink' });
  assert.deepEqual(classifyNode(statLike('socket')), { kind: 'special', what: 'socket' });
  assert.deepEqual(classifyNode(statLike('fifo')), { kind: 'special', what: 'fifo' });
  assert.deepEqual(classifyNode(statLike('block')), { kind: 'special', what: 'block-device' });
  assert.deepEqual(classifyNode(statLike('char')), { kind: 'special', what: 'character-device' });
  assert.deepEqual(classifyNode(statLike('whiteout-or-future-type')), { kind: 'special', what: 'unknown' }, 'an unrecognised node type is never silently allowed');
});

test('special file: a block / character / unknown node observed at scan time BLOCKS the workspace (simulated via lstat; no device is created)', async () => {
  for (const kind of ['block', 'char', 'whiteout-or-future-type']) {
    let target = null;
    await withSetup(async ({ fake, scratch, prepare }) => {
      target = path.join(scratch.wt, 'a.txt');
      const r = await prepare();
      assert.deepEqual([r.state, r.code], ['BLOCKED', 'SPECIAL_FILE_UNSAFE'], kind);
      assert.equal(fake.calls.length, 0, kind);
    }, { lstat: (p) => { const real = fs.lstatSync(p); return p === target ? Object.assign(Object.create(null), { dev: real.dev, nlink: 1 }, statLike(kind)) : real; } });
  }
});
