// ZC-MVP-B1 (Issue #119): bounded supervision of TEST FAKE children only.
// Every child below is a script this test writes into a mkdtemp fixture. No
// real agent, shell or network is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertFixtureRoot, assertFakeChild, safeEnvironment, supervisedRun, SUPERVISOR_LIMITS,
} from '../tools/zc-bridge-core/process-supervisor.mjs';
import {BridgeError} from '../tools/zc-bridge-core/state-machine.mjs';

const code = c => e => e instanceof BridgeError && e.code === c;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zc-bridge-core-')));
  const cwd = path.join(root, 'ws');
  fs.mkdirSync(cwd, {mode: 0o700});
  const script = (name, body) => {
    const p = path.join(root, name);
    fs.writeFileSync(p, body, {mode: 0o600});
    return p;
  };
  const run = (name, body, extra = {}) => supervisedRun({
    command: process.execPath, args: [script(name, body)], cwd,
    env: safeEnvironment({tmp: root}), fixtureRoot: root, timeoutMs: 3000, ...extra,
  });
  return {root, cwd, script, run, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}

test('assertFixtureRoot accepts only a private mkdtemp directory under the temp dir', () => {
  const f = fixture();
  try {
    assert.equal(assertFixtureRoot(f.root), f.root);
    for (const bad of [undefined, null, 'relative', os.tmpdir(), os.homedir(), '/', f.cwd, path.join(f.root, 'zc-bridge-core-AAAAAA')])
      assert.throws(() => assertFixtureRoot(bad), code('UNSAFE_FIXTURE_ROOT'), String(bad));
    const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zc-bridge-core-')));
    fs.chmodSync(loose, 0o755);
    assert.throws(() => assertFixtureRoot(loose), code('UNSAFE_FIXTURE_ROOT'));
    fs.rmSync(loose, {recursive: true});
    const link = path.join(os.tmpdir(), `zc-bridge-core-L${process.pid % 10}${Date.now() % 10000}`.slice(0, 22));
    fs.symlinkSync(f.root, link);
    try { assert.throws(() => assertFixtureRoot(link), code('UNSAFE_FIXTURE_ROOT')); }
    finally { fs.unlinkSync(link); }
    const wrongName = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'other-')));
    try { assert.throws(() => assertFixtureRoot(wrongName), code('UNSAFE_FIXTURE_ROOT')); }
    finally { fs.rmSync(wrongName, {recursive: true}); }
  } finally { f.cleanup(); }
});

test('assertFakeChild allows only node + a script inside the fixture', () => {
  const f = fixture();
  try {
    const ok = f.script('ok.mjs', '');
    assert.doesNotThrow(() => assertFakeChild({command: process.execPath, args: [ok], fixtureRoot: f.root}));
    assert.doesNotThrow(() => assertFakeChild({command: process.execPath, args: [ok, 'a', 'b'], fixtureRoot: f.root}));
  } finally { f.cleanup(); }
});

test('assertFakeChild refuses shells, agy, env and any other executable (task text cannot choose a command)', () => {
  const f = fixture();
  try {
    const ok = f.script('ok.mjs', '');
    for (const command of ['/bin/sh', '/bin/bash', '/usr/bin/env', 'sh', 'agy', '/Users/x/.local/bin/agy', 'node', '', null, undefined, 5, `${process.execPath} `, '/usr/bin/curl'])
      assert.throws(() => assertFakeChild({command, args: [ok], fixtureRoot: f.root}), code('SUPERVISOR_COMMAND_NOT_ALLOWED'), String(command));
  } finally { f.cleanup(); }
});

test('assertFakeChild refuses node flags, eval, relative, symlinked and foreign scripts', () => {
  const f = fixture();
  try {
    const ok = f.script('ok.mjs', '');
    const link = path.join(f.root, 'link.mjs');
    fs.symlinkSync(ok, link);
    const outside = path.join(os.tmpdir(), `zc-outside-${process.pid}.mjs`);
    fs.writeFileSync(outside, '');
    const nested = path.join(f.cwd, 'nested.mjs');
    fs.writeFileSync(nested, '');
    const big = f.script('big.mjs', 'x'.repeat(SUPERVISOR_LIMITS.maxScriptBytes + 1));
    const agy = f.script('agy.mjs', '');
    const bad = [
      ['-e', 'process.exit(0)'], ['--eval', '1'], ['-p', '1'], ['--require', ok], ['ok.mjs'], ['./ok.mjs'],
      [link], [outside], [nested], [f.root], [path.join(f.root, 'missing.mjs')], [big], [agy],
      [path.join(f.root, 'ok.txt')], [], [ok, 'x'.repeat(513)], [ok, 'a\0b'], [ok, 5], [ok, ...Array(8).fill('a')], 'not-an-array', null,
    ];
    try {
      for (const args of bad)
        assert.throws(() => assertFakeChild({command: process.execPath, args, fixtureRoot: f.root}), e => e instanceof BridgeError, JSON.stringify(args));
    } finally { fs.unlinkSync(outside); }
    assert.throws(() => assertFakeChild({command: process.execPath, args: [ok], fixtureRoot: os.tmpdir()}), code('UNSAFE_FIXTURE_ROOT'));
  } finally { f.cleanup(); }
});

test('safeEnvironment is an explicit allowlist and inherits nothing', () => {
  const f = fixture();
  try {
    process.env.ZC_TEST_SECRET_TOKEN = 'not-a-real-secret';
    const env = safeEnvironment({tmp: f.root});
    assert.deepEqual(Object.keys(env).sort(), ['CI', 'LANG', 'LC_ALL', 'NO_COLOR', 'PATH', 'TMPDIR']);
    assert.equal(JSON.stringify(env).includes('not-a-real-secret'), false);
    assert.throws(() => safeEnvironment({tmp: 'relative'}), code('SUPERVISOR_ENV_INVALID'));
    assert.throws(() => safeEnvironment({}), code('SUPERVISOR_ENV_INVALID'));
  } finally { delete process.env.ZC_TEST_SECRET_TOKEN; f.cleanup(); }
});

test('a fake child cannot see the parent environment', async () => {
  const f = fixture();
  try {
    process.env.ZC_TEST_SECRET_TOKEN = 'not-a-real-secret';
    const r = await f.run('env.mjs', "process.stdout.write(JSON.stringify(Object.keys(process.env)));");
    assert.equal(r.error, null);
    const keys = JSON.parse(r.stdout);
    assert.equal(keys.includes('ZC_TEST_SECRET_TOKEN'), false);
    assert.equal(keys.includes('HOME'), false);
    for (const k of keys) assert.ok(['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'CI', 'NO_COLOR', '__CF_USER_TEXT_ENCODING'].includes(k), k);
  } finally { delete process.env.ZC_TEST_SECRET_TOKEN; f.cleanup(); }
});

test('a clean exit returns stdout, status 0 and an observed empty process group', async () => {
  const f = fixture();
  try {
    const r = await f.run('ok.mjs', "process.stdout.write('hello\\n');");
    assert.deepEqual([r.error, r.status, r.signal, r.stdout, r.groupExitObserved, r.exitObserved],
      [null, 0, null, 'hello\n', true, true]);
  } finally { f.cleanup(); }
});

test('a non-zero exit is reported, not thrown', async () => {
  const f = fixture();
  try {
    const r = await f.run('fail.mjs', 'process.exit(7);');
    assert.deepEqual([r.error, r.status, r.groupExitObserved], [null, 7, true]);
  } finally { f.cleanup(); }
});

test('stderr is counted but its content is never returned', async () => {
  const f = fixture();
  try {
    const r = await f.run('err.mjs', "process.stderr.write('PRIVATE-DETAIL');");
    assert.equal(r.stderrBytes, 'PRIVATE-DETAIL'.length);
    assert.equal(JSON.stringify(r).includes('PRIVATE-DETAIL'), false);
  } finally { f.cleanup(); }
});

test('a hanging child is terminated on timeout and its group is gone (M12 core)', async () => {
  const f = fixture();
  try {
    const r = await f.run('hang.mjs',
      "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);",
      {timeoutMs: 300});
    assert.equal(r.error, 'TIMEOUT');
    assert.equal(r.groupExitObserved, true);
    assert.equal(alive(Number(r.stdout)), false);
  } finally { f.cleanup(); }
});

test('a child that ignores SIGTERM is killed with SIGKILL', async () => {
  const f = fixture();
  try {
    const r = await f.run('stubborn.mjs',
      "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);",
      {timeoutMs: 300, graceMs: 200});
    assert.equal(r.error, 'TIMEOUT');
    assert.equal(r.groupExitObserved, true);
    assert.equal(alive(Number(r.stdout)), false);
  } finally { f.cleanup(); }
});

test('leftover grandchildren in the process group are cleaned up after a clean exit', async () => {
  const f = fixture();
  try {
    const r = await f.run('orphan.mjs', `
      import {spawn} from 'node:child_process';
      const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
      process.stdout.write(String(g.pid));
      g.unref();
    `);
    const gpid = Number(r.stdout);
    assert.ok(gpid > 1);
    assert.equal(r.error, null);
    assert.equal(r.groupExitObserved, true);
    await sleep(50);
    assert.equal(alive(gpid), false);
  } finally { f.cleanup(); }
});

test('shouldAbort terminates the child with ABORTED (STOP path)', async () => {
  const f = fixture();
  try {
    const started = Date.now();
    const r = await f.run('abort.mjs', "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);",
      {timeoutMs: 5000, shouldAbort: () => Date.now() - started > 150});
    assert.equal(r.error, 'ABORTED');
    assert.equal(r.groupExitObserved, true);
    assert.equal(alive(Number(r.stdout)), false);
    assert.ok(r.durationMs < 3000);
  } finally { f.cleanup(); }
});

test('a throwing shouldAbort is treated as an abort request (fail closed)', async () => {
  const f = fixture();
  try {
    const r = await f.run('abort2.mjs', 'setInterval(() => {}, 1000);', {timeoutMs: 5000, shouldAbort: () => { throw new Error('boom'); }});
    assert.equal(r.error, 'ABORTED');
    assert.equal(r.groupExitObserved, true);
  } finally { f.cleanup(); }
});

test('output beyond the cap kills the child with OUTPUT_LIMIT', async () => {
  const f = fixture();
  try {
    const r = await f.run('flood.mjs',
      "const b = 'x'.repeat(4096); setInterval(() => process.stdout.write(b), 1);", {timeoutMs: 5000});
    assert.equal(r.error, 'OUTPUT_LIMIT');
    assert.equal(r.groupExitObserved, true);
    assert.ok(Buffer.byteLength(r.stdout) <= SUPERVISOR_LIMITS.maxStdoutBytes);
  } finally { f.cleanup(); }
});

test('a child killed by a signal reports the signal', async () => {
  const f = fixture();
  try {
    const r = await f.run('selfkill.mjs', "process.kill(process.pid, 'SIGKILL');");
    assert.equal(r.signal, 'SIGKILL');
    assert.equal(r.status, null);
    assert.equal(r.error, null);
  } finally { f.cleanup(); }
});

test('timeouts are range-checked and the cwd must be a direct child of the fixture', async () => {
  const f = fixture();
  try {
    const ok = f.script('ok.mjs', '');
    const base = {command: process.execPath, args: [ok], cwd: f.cwd, env: {}, fixtureRoot: f.root};
    for (const timeoutMs of [undefined, 0, 10, 49, 1200001, 1.5, '100', NaN])
      await assert.rejects(() => supervisedRun({...base, timeoutMs}), code('SUPERVISOR_TIMEOUT_INVALID'));
    for (const cwd of [f.root, os.tmpdir(), '/', 'ws', path.join(f.cwd, 'x'), undefined])
      await assert.rejects(() => supervisedRun({...base, cwd, timeoutMs: 1000}), code('SUPERVISOR_CWD_INVALID'));
  } finally { f.cleanup(); }
});

test('supervisedRun re-validates the command even when called directly', async () => {
  const f = fixture();
  try {
    const ok = f.script('ok.mjs', '');
    await assert.rejects(() => supervisedRun({command: '/bin/sh', args: [ok], cwd: f.cwd, env: {}, fixtureRoot: f.root, timeoutMs: 1000}),
      code('SUPERVISOR_COMMAND_NOT_ALLOWED'));
    await assert.rejects(() => supervisedRun({command: process.execPath, args: ['-e', '1'], cwd: f.cwd, env: {}, fixtureRoot: f.root, timeoutMs: 1000}),
      code('SUPERVISOR_SCRIPT_INVALID'));
  } finally { f.cleanup(); }
});

test('spawn failure and unobservable spawns are reported without running anything', async () => {
  const f = fixture();
  try {
    const ok = f.script('ok.mjs', '');
    const base = {command: process.execPath, args: [ok], cwd: f.cwd, env: {}, fixtureRoot: f.root, timeoutMs: 1000};
    const a = await supervisedRun({...base, launch: () => { throw new Error('no'); }});
    assert.equal(a.error, 'SPAWN_FAILED');
    const killed = [];
    const b = await supervisedRun({...base, launch: () => ({pid: undefined, kill: s => killed.push(s), once() {}})});
    assert.equal(b.error, 'SPAWN_UNOBSERVABLE');
    assert.deepEqual(killed, ['SIGKILL']);
  } finally { f.cleanup(); }
});

test('a group that cannot be confirmed gone is PROCESS_STILL_ALIVE, never a clean result', async () => {
  const f = fixture();
  try {
    const ok = f.script('ok.mjs', '');
    const listeners = {};
    const child = {
      pid: 4242424, stdout: {on() {}}, stderr: {on() {}},
      once(ev, fn) { listeners[ev] = fn; if (ev === 'close') setTimeout(() => fn(0, null), 10); },
    };
    const signals = [];
    const r = await supervisedRun({
      command: process.execPath, args: [ok], cwd: f.cwd, env: {}, fixtureRoot: f.root, timeoutMs: 1000,
      launch: () => child, sendSignal: (pid, sig) => { signals.push([pid, sig]); },
    });
    assert.equal(r.error, 'PROCESS_STILL_ALIVE');
    assert.equal(r.groupExitObserved, false);
    assert.ok(signals.some(([pid, sig]) => pid === -4242424 && sig === 'SIGKILL'));
    assert.ok(signals.every(([pid]) => pid === -4242424), 'only the child group is ever signalled');
  } finally { f.cleanup(); }
});

test('the supervisor never enables a shell', () => {
  const src = fs.readFileSync(new URL('../tools/zc-bridge-core/process-supervisor.mjs', import.meta.url), 'utf8');
  assert.match(src, /shell:\s*false/);
  assert.doesNotMatch(src, /shell:\s*true/);
  assert.doesNotMatch(src, /\b(exec|execSync|execFile|execFileSync|spawnSync|fork)\s*\(/);
});
