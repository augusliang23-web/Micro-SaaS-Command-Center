// ZC-MVP-B1 (Issue #119): single-slot executor, mock adapter and end-to-end
// negative tests (design IDs M07, M10-M13, M15, M17, M20-M22 from Issue #118
// section 6.7). Offline only: fake children inside a mkdtemp fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Executor} from '../tools/zc-bridge-core/executor.mjs';
import {Journal} from '../tools/zc-bridge-core/journal.mjs';
import {Control} from '../tools/zc-bridge-core/control.mjs';
import {MockAdapter, MOCK_FAULTS, createMockReporter, classifyOutput} from '../tools/zc-bridge-core/adapters/mock.mjs';
import {BridgeError} from '../tools/zc-bridge-core/state-machine.mjs';

const nonce = n => n.toString(16).padStart(32, '0');
const TASK = 'zc-exec-fixture';
const TASK2 = 'zc-exec-other';
const SCOPE = ['docs/fixture-note.md'];
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const code = c => e => e instanceof BridgeError && e.code === c;

function setup({quotaBreakerMs = 5000, sentinel = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zc-bridge-core-')));
  for (const d of ['journal', 'control']) { fs.mkdirSync(path.join(root, d), {mode: 0o700}); fs.chmodSync(path.join(root, d), 0o700); }
  const sentinelPath = path.join(root, 'sentinel.txt');
  if (sentinel) fs.writeFileSync(sentinelPath, 'ORIGINAL_SENTINEL\n', {mode: 0o600});
  let t = Date.parse('2026-11-02T00:00:00.000Z');
  let offset = 0;
  const clock = () => new Date((t += 10) + offset);
  const advance = ms => { offset += ms; };
  const journal = new Journal(path.join(root, 'journal'), {clock});
  const control = new Control(path.join(root, 'control'));
  const reporter = createMockReporter();
  const spies = [];
  const make = (adapter, {rep = reporter, journalOverride} = {}) => {
    const spy = {starts: 0, reports: []};
    spies.push(spy);
    const wrapped = {
      id: adapter.id,
      probe: () => adapter.probe(),
      async start(spec, ctx) { spy.starts++; const r = await adapter.start(spec, ctx); spy.reports.push(r); return r; },
    };
    const exec = new Executor({
      fixtureRoot: root, journal: journalOverride ?? journal, control, adapter: wrapped, reporter: rep,
      clock, sentinels: sentinel ? [sentinelPath] : [], quotaBreakerMs,
    });
    return {exec, spy};
  };
  return {root, journal, control, reporter, clock, advance, make, sentinelPath, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}
const req = (o = {}) => ({
  task_id: TASK, attempt: 1, max_attempts: 3, nonce: nonce(1), risk_level: 'low',
  scope_paths: SCOPE, timeout_ms: 5000, seed: {'docs/fixture-note.md': 'old\n', 'keep.txt': 'keep\n'}, ...o,
});
const SAFETY = {
  mode: 'MOCK_ONLY_OFFLINE', simulated: true, actual_dispatch: false, provider_calls: 0,
  github_writes: 0, mac_settings_writes: 0, ready_to_merge: false, owner_approval_required: true,
};
const safe = res => { for (const [k, v] of Object.entries(SAFETY)) assert.equal(res[k], v, k); return res; };
const stateOf = (x, task = TASK, attempt = 1) => x.journal.load(task, attempt).state;

test('happy path: READY_FOR_REVIEW, one report, safety flags fixed', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter());
    const res = safe(await exec.run(req()));
    assert.equal(res.state, 'READY_FOR_REVIEW');
    assert.equal(res.claimed, true);
    assert.deepEqual(res.changed_files, ['docs/fixture-note.md']);
    assert.match(res.evidence_digest, /^[a-f0-9]{64}$/);
    assert.equal(spy.starts, 1);
    assert.equal(x.reporter.calls.length, 1);
    assert.equal(x.reporter.calls[0].simulated, true);
    assert.equal(stateOf(x), 'READY_FOR_REVIEW');
    assert.deepEqual(x.journal.load(TASK, 1).history.map(h => h.state),
      ['CLAIMED', 'PREPARING', 'RUNNING', 'VERIFYING', 'REPORTING', 'READY_FOR_REVIEW']);
    assert.equal(fs.readFileSync(path.join(x.root, `workspace-${TASK}-1`, 'docs/fixture-note.md'), 'utf8'), 'synthetic mock output\n');
  } finally { x.cleanup(); }
});

test('every result, success or not, states no dispatch and never ready to merge', async () => {
  const x = setup();
  try {
    const out = [];
    let n = 1;
    for (const fault of ['none', 'denied', 'out-of-scope', 'crash', 'quota']) {
      x.advance(10000);
      const {exec} = x.make(new MockAdapter({fault}));
      out.push(await exec.run(req({task_id: `zc-exec-run-${fault.replace(/[^a-z]/g, '')}`, nonce: nonce(n++)})));
    }
    out.push(await x.make(new MockAdapter()).exec.run({}));
    for (const r of out) safe(r);
  } finally { x.cleanup(); }
});

test('M07: a replayed request is refused and the adapter never runs twice', async () => {
  const x = setup();
  try {
    const first = x.make(new MockAdapter());
    assert.equal((await first.exec.run(req())).state, 'READY_FOR_REVIEW');
    const again = x.make(new MockAdapter());
    const r = await again.exec.run(req());
    assert.deepEqual([r.state, r.reason, r.claimed], ['HELD', 'TASK_ALREADY_COMPLETED', false]);
    assert.equal(again.spy.starts, 0);
    assert.equal(x.reporter.calls.length, 1);
  } finally { x.cleanup(); }
});

test('M07: after a failure the same attempt or nonce cannot be replayed', async () => {
  const x = setup();
  try {
    assert.equal((await x.make(new MockAdapter({fault: 'denied'})).exec.run(req())).state, 'FAILED_ADAPTER');
    const sameAttempt = x.make(new MockAdapter());
    assert.equal((await sameAttempt.exec.run(req())).reason, 'TASK_ALREADY_CLAIMED');
    const sameNonce = x.make(new MockAdapter());
    assert.equal((await sameNonce.exec.run(req({attempt: 2}))).reason, 'NONCE_REUSED');
    assert.equal(sameAttempt.spy.starts + sameNonce.spy.starts, 0);
    const fresh = x.make(new MockAdapter());
    const ok = await fresh.exec.run(req({attempt: 2, nonce: nonce(2)}));
    assert.equal(ok.state, 'READY_FOR_REVIEW');
    assert.equal(ok.attempt, 2);
  } finally { x.cleanup(); }
});

test('attempt cap: a third failure leaves no fourth attempt', async () => {
  const x = setup();
  try {
    for (let a = 1; a <= 2; a++)
      assert.equal((await x.make(new MockAdapter({fault: 'denied'})).exec.run(req({attempt: a, max_attempts: 2, nonce: nonce(a)}))).state, 'FAILED_ADAPTER');
    const r = await x.make(new MockAdapter()).exec.run(req({attempt: 3, max_attempts: 2, nonce: nonce(3)}));
    assert.deepEqual([r.state, r.claimed], ['REJECTED', false]);
  } finally { x.cleanup(); }
});

for (const [fault, expected] of [
  ['out-of-scope', 'OUT_OF_SCOPE:tools/unrelated.mjs'],
  ['protected', 'PROTECTED_PATH:package.json'],
  ['symlink', 'SYMLINK:docs/fixture-link.md'],
  ['binary', 'BINARY:docs/fixture-note.md'],
  ['oversize', 'TOO_LARGE:docs/fixture-note.md'],
  ['executable', 'MODE_CHANGE:docs/fixture-note.md'],
]) {
  test(`M10: ${fault} change -> FAILED_SCOPE, workspace discarded, nothing reported`, async () => {
    const x = setup();
    try {
      const {exec} = x.make(new MockAdapter({fault}));
      const r = safe(await exec.run(req()));
      assert.equal(r.state, 'FAILED_SCOPE');
      assert.ok(r.violations.map(v => `${v.code}:${v.path}`).includes(expected), JSON.stringify(r.violations));
      assert.equal(x.reporter.calls.length, 0);
      assert.equal(fs.existsSync(path.join(x.root, `workspace-${TASK}-1`)), false);
      assert.equal(stateOf(x), 'FAILED_SCOPE');
    } finally { x.cleanup(); }
  });
}

test('M11: tool-layer denial with exit 0 and status SUCCESS is a FAILURE, never a pass', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter({fault: 'denied'}));
    const r = safe(await exec.run(req()));
    assert.deepEqual([r.state, r.reason], ['FAILED_ADAPTER', 'DENIED_ACTIONS']);
    // Prove the premise: the child really exited 0 and reported SUCCESS.
    const rep = spy.reports[0];
    assert.equal(rep.supervision.status, 0);
    assert.equal(rep.supervision.signal, null);
    assert.equal(rep.denied_actions_count, 1);
    assert.equal(rep.error_steps, 1);
    assert.equal(x.reporter.calls.length, 0);
    assert.equal(stateOf(x), 'FAILED_ADAPTER');
  } finally { x.cleanup(); }
});

test('M11: classifyOutput shape (synthetic, modelled on the G1-R3 event shape)', () => {
  const lines = [
    {event: 'init'},
    {event: 'step_update', step_update: {state: 'ERROR', tool_info: {error: {type: 'TOOL_ERROR'}}}},
    {event: 'result', result: {status: 'SUCCESS', response: '', denied_actions: [{action: 'command'}]}},
  ].map(o => JSON.stringify(o)).join('\n');
  const c = classifyOutput(lines);
  assert.deepEqual([c.protocolError, c.denied, c.errorSteps, c.result.status], [false, 1, 1, 'SUCCESS']);
  for (const bad of ['not json', '[1]', 'null', '{"event":"result","result":{"status":"SUCCESS","denied_actions":"all"}}'])
    assert.equal(classifyOutput(bad).protocolError, true, bad);
  assert.equal(classifyOutput('').result, null);
});

test('M12: a hanging child times out, its group is gone, state is TIMED_OUT', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter({fault: 'hang'}));
    const r = safe(await exec.run(req({timeout_ms: 300})));
    assert.deepEqual([r.state, r.reason], ['TIMED_OUT', 'TASK_TIMEOUT']);
    const pid = spy.reports[0].child_pid;
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    assert.equal(alive(pid), false);
    assert.equal(spy.reports[0].supervision.groupExitObserved, true);
    assert.equal(x.reporter.calls.length, 0);
  } finally { x.cleanup(); }
});

test('a child that crashes by signal is FAILED_ADAPTER (ADAPTER_CRASHED)', async () => {
  const x = setup();
  try {
    const r = await x.make(new MockAdapter({fault: 'crash'})).exec.run(req());
    assert.deepEqual([r.state, r.reason], ['FAILED_ADAPTER', 'ADAPTER_CRASHED']);
  } finally { x.cleanup(); }
});

test('M13: a claim abandoned mid-run becomes RECONCILE_REQUIRED and blocks everything', async () => {
  const x = setup();
  try {
    x.journal.claim({task_id: TASK, attempt: 1, max_attempts: 3, nonce: nonce(1)});
    x.journal.transition(TASK, 1, 0, 'PREPARE');
    x.journal.transition(TASK, 1, 1, 'PREPARED');
    // "Process crash": nothing finishes the attempt. A fresh Journal is the restart.
    const restarted = new Journal(path.join(x.root, 'journal'), {clock: x.clock});
    assert.deepEqual(restarted.recover(), [{task_id: TASK, attempt: 1, state: 'RECONCILE_REQUIRED'}]);
    const {exec, spy} = x.make(new MockAdapter(), {journalOverride: restarted});
    const r = await exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([r.state, r.reason, r.claimed], ['HELD', 'RECONCILE_REQUIRED_BLOCKS_CLAIM', false]);
    const same = await exec.run(req({attempt: 2, nonce: nonce(3)}));
    assert.equal(same.reason, 'RECONCILE_REQUIRED_BLOCKS_CLAIM');
    assert.equal(spy.starts, 0);
  } finally { x.cleanup(); }
});

test('an adapter that throws after the claim ends FAILED_ADAPTER without leaking its error', async () => {
  const x = setup();
  try {
    const adapter = {id: 'boom', probe: async () => ({}), start: async () => { throw new Error('SECRET-DETAIL'); }};
    const r = await x.make(adapter).exec.run(req());
    assert.deepEqual([r.state, r.reason], ['FAILED_ADAPTER', 'ADAPTER_THREW']);
    assert.equal(JSON.stringify(r).includes('SECRET-DETAIL'), false);
  } finally { x.cleanup(); }
});

test('M15: STOP during a run terminates the child, ends STOPPED, and survives restart', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter({fault: 'hang'}));
    const pending = exec.run(req({timeout_ms: 20000}));
    await sleep(250);
    x.control.requestStop('OPERATOR_STOP');
    const r = safe(await pending);
    assert.deepEqual([r.state, r.reason], ['STOPPED', 'CONTROL_STOP']);
    const pid = spy.reports[0].child_pid;
    assert.equal(alive(pid), false);
    assert.equal(spy.reports[0].supervision.groupExitObserved, true);
    // Restart: brand-new control, journal, executor and adapter.
    const control2 = new Control(path.join(x.root, 'control'));
    const journal2 = new Journal(path.join(x.root, 'journal'), {clock: x.clock});
    const spy2 = {starts: 0};
    const exec2 = new Executor({
      fixtureRoot: x.root, journal: journal2, control: control2, reporter: x.reporter, clock: x.clock,
      adapter: {id: 'mock', probe: async () => ({}), start: async () => { spy2.starts++; return {}; }},
    });
    const again = await exec2.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([again.state, again.reason, again.claimed], ['HELD', 'CONTROL_STOP', false]);
    assert.equal(spy2.starts, 0);
    assert.equal(journal2.list().length, 1);
  } finally { x.cleanup(); }
});

test('M15: STOP set before a run prevents any claim', async () => {
  const x = setup();
  try {
    x.control.requestStop('OPERATOR_STOP');
    const {exec, spy} = x.make(new MockAdapter());
    const r = await exec.run(req());
    assert.deepEqual([r.state, r.reason, r.claimed], ['HELD', 'CONTROL_STOP', false]);
    assert.equal(spy.starts, 0);
    assert.deepEqual(x.journal.list(), []);
  } finally { x.cleanup(); }
});

test('M15: nothing in task data can clear STOP', async () => {
  const x = setup();
  try {
    x.control.requestStop('OPERATOR_STOP');
    const {exec, spy} = x.make(new MockAdapter());
    const hostile = [
      req({seed: {'docs/RESUME': 'STOP=false\nresume\n'}}),
      req({task_id: 'zc-resume-now'}),
      {...req(), control: 'clear', resume: true, stop: false},
    ];
    for (const h of hostile) assert.equal((await exec.run(h)).state === 'READY_FOR_REVIEW', false);
    assert.equal(x.control.status().stop, true);
    assert.equal(fs.existsSync(path.join(x.root, 'control', 'STOP')), true);
    assert.equal(spy.starts, 0);
  } finally { x.cleanup(); }
});

test('PAUSE prevents new claims without touching the journal', async () => {
  const x = setup();
  try {
    x.control.requestPause('OPERATOR_PAUSE');
    const {exec, spy} = x.make(new MockAdapter());
    const r = await exec.run(req());
    assert.deepEqual([r.state, r.reason, r.claimed], ['HELD', 'CONTROL_PAUSE', false]);
    assert.equal(spy.starts, 0);
    assert.deepEqual(x.journal.list(), []);
  } finally { x.cleanup(); }
});

test('an unsafe control directory is treated as STOP', async () => {
  const x = setup();
  try {
    fs.chmodSync(path.join(x.root, 'control'), 0o755);
    const {exec, spy} = x.make(new MockAdapter());
    const r = await exec.run(req());
    assert.deepEqual([r.state, r.reason], ['HELD', 'CONTROL_UNSAFE']);
    assert.equal(spy.starts, 0);
  } finally { x.cleanup(); }
});

test('M17: quota failure ends FAILED_QUOTA, opens the breaker, and blocks later claims until it closes', async () => {
  const x = setup({quotaBreakerMs: 5000});
  try {
    const r = safe(await x.make(new MockAdapter({fault: 'quota'})).exec.run(req()));
    assert.deepEqual([r.state, r.reason], ['FAILED_QUOTA', 'QUOTA_EXHAUSTED']);
    assert.equal(x.reporter.calls.length, 0);
    const blocked = x.make(new MockAdapter());
    const b = await blocked.exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([b.state, b.reason, b.claimed], ['HELD', 'QUOTA_BREAKER_OPEN', false]);
    assert.equal(blocked.spy.starts, 0);
    x.advance(6000);
    const later = await x.make(new MockAdapter()).exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.equal(later.state, 'READY_FOR_REVIEW');
  } finally { x.cleanup(); }
});

test('M20: static scan finds no network, shell, eval, env, deploy or merge paths in the sources', () => {
  const dir = new URL('../tools/zc-bridge-core/', import.meta.url);
  const expected = ['adapters/mock.mjs', 'control.mjs', 'executor.mjs', 'journal.mjs',
    'process-supervisor.mjs', 'scope-guard.mjs', 'state-machine.mjs'];
  const found = [];
  const walk = (d, rel = '') => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${rel}${e.name}/`);
      else found.push(`${rel}${e.name}`);
    }
  };
  walk(dir.pathname);
  assert.deepEqual(found.sort(), expected);
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const NODE_OK = new Set(['node:fs', 'node:path', 'node:os', 'node:crypto', 'node:child_process']);
  for (const name of expected) {
    const src = strip(fs.readFileSync(new URL(name, dir), 'utf8'));
    const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
    for (const s of specs) assert.ok(s.startsWith('./') || s.startsWith('../') || NODE_OK.has(s), `${name} imports ${s}`);
    assert.equal(specs.includes('node:child_process'), name === 'process-supervisor.mjs', `${name} child_process import`);
    if (name === 'process-supervisor.mjs')
      assert.match(src, /import\s*\{\s*spawn as nodeSpawn\s*\}\s*from\s*'node:child_process'/);
    for (const re of [
      /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\brequire\s*\(/, /\bimport\s*\(/, /\beval\s*\(/,
      /new\s+Function\b/, /process\.env\b/, /--dangerously-skip-permissions/, /https?:\/\//,
      /\bgh\s+pr\s+merge\b/, /\bgit\s+merge\b/, /\/merge\b/, /firebase\s+deploy/, /\bgcloud\b/,
      /node:(http|https|http2|net|tls|dns|dgram|worker_threads|cluster|vm|readline|repl|inspector)/,
      /(?<![.\w])exec(Sync|File|FileSync)?\s*\(/, /\bspawnSync\s*\(/, /\bfork\s*\(/, /shell:\s*true/, /\bsh\s+-c\b/,
    ]) assert.doesNotMatch(src, re, `${name} matches ${re}`);
    const agy = (src.match(/\bagy\b/g) ?? []).length;
    assert.equal(agy, name === 'process-supervisor.mjs' ? 1 : 0, `${name} mentions agy ${agy}x`);
  }
});

test('M20: the CI workflow is read-only, SHA-pinned, secret-free and PR-only', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/zc-bridge-core-qa.yml', import.meta.url), 'utf8');
  assert.match(wf, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.match(wf, /persist-credentials:\s*false/);
  assert.doesNotMatch(wf, /\bsecrets\./);
  assert.doesNotMatch(wf, /^\s*(push|schedule|workflow_dispatch|repository_dispatch|issue_comment|issues|pull_request_target|workflow_run)\s*:/m);
  assert.match(wf, /^\s*pull_request:\s*$/m);
  for (const m of wf.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  const code = wf.split('\n').filter(l => !/^\s*#/.test(l) && !/^\s*-?\s*name:/.test(l)).join('\n');
  assert.doesNotMatch(code, /\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b/);
});

test('M21: a sentinel changed during the run triggers STOP with a persistent marker', async () => {
  const x = setup({sentinel: true});
  try {
    const before = fs.readFileSync(x.sentinelPath, 'utf8');
    const {exec} = x.make(new MockAdapter({fault: 'tamper', sentinel: {path: x.sentinelPath, content: 'tampered\n'}}));
    const r = safe(await exec.run(req()));
    assert.deepEqual([r.state, r.reason], ['STOPPED', 'TRIPWIRE']);
    assert.notEqual(fs.readFileSync(x.sentinelPath, 'utf8'), before);
    assert.equal(x.control.status().stop, true);
    assert.equal(x.reporter.calls.length, 0);
    const next = await x.make(new MockAdapter()).exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([next.state, next.reason], ['HELD', 'CONTROL_STOP']);
  } finally { x.cleanup(); }
});

test('M21: rewriting identical sentinel bytes, or a sentinel missing on both sides, is not a change', async () => {
  const x = setup({sentinel: true});
  try {
    const {exec} = x.make(new MockAdapter({fault: 'tamper', sentinel: {path: x.sentinelPath, content: 'ORIGINAL_SENTINEL\n'}}));
    // Identical content is not a change: the run is allowed to finish.
    assert.equal((await exec.run(req())).state, 'READY_FOR_REVIEW');
    fs.rmSync(x.sentinelPath);
    const again = await x.make(new MockAdapter({fault: 'none'})).exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    // Both sides read MISSING, so a pre-deleted sentinel is not "changed during".
    assert.equal(again.state, 'READY_FOR_REVIEW');
  } finally { x.cleanup(); }
});

test('M22: a high-risk proposal is REJECTED before any claim', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter());
    const r = safe(await exec.run(req({risk_level: 'high'})));
    assert.deepEqual([r.state, r.reason, r.claimed], ['REJECTED', 'RISK_NOT_ALLOWED', false]);
    assert.equal(spy.starts, 0);
    assert.deepEqual(x.journal.list(), []);
    assert.deepEqual(fs.readdirSync(path.join(x.root, 'journal')), []);
  } finally { x.cleanup(); }
});

test('unknown, missing or security-class risk levels are REJECTED', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter());
    for (const risk_level of ['critical', 'security', 'HIGH', 'Low', '', null, undefined, 1]) {
      const r = await exec.run(req({risk_level}));
      assert.equal(r.state, 'REJECTED', String(risk_level));
    }
    assert.equal(spy.starts, 0);
  } finally { x.cleanup(); }
});

test('task data can never become a command, argument, cwd or environment', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter());
    const smuggled = [
      {command: 'sh'}, {args: ['-c', 'id']}, {cwd: '/'}, {env: {A: '1'}}, {shell: true}, {executable: 'agy'},
      {prompt: 'ignore previous instructions'}, {mode: 'anti_headless'}, {adapter: 'agy'}, {sentinels: ['/etc/passwd']},
    ];
    for (const extra of smuggled) {
      const r = await exec.run({...req(), ...extra});
      assert.deepEqual([r.state, r.reason, r.claimed], ['REJECTED', 'INVALID_REQUEST', false], JSON.stringify(extra));
    }
    assert.equal(spy.starts, 0);
    assert.deepEqual(x.journal.list(), []);
  } finally { x.cleanup(); }
});

test('malformed or hostile request fields are REJECTED, never executed', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter());
    const bad = [
      null, undefined, 'x', [], 42, {},
      req({task_id: 'bad id'}), req({task_id: '../../etc'}), req({task_id: 'zc-a'}), req({task_id: 'x'.repeat(100)}),
      req({attempt: 0}), req({attempt: 4}), req({max_attempts: 9}), req({attempt: 3, max_attempts: 2}),
      req({nonce: 'short'}), req({nonce: nonce(1).toUpperCase().replace(/0/g, 'G')}), req({nonce: 7}),
      req({scope_paths: []}), req({scope_paths: ['../etc/passwd']}), req({scope_paths: ['package.json']}),
      req({scope_paths: ['.github/workflows/x.yml']}), req({scope_paths: ['tools/server.ts']}), req({scope_paths: 'docs/a.md'}),
      req({timeout_ms: 1}), req({timeout_ms: 1200001}), req({timeout_ms: '5000'}),
      req({seed: null}), req({seed: []}), req({seed: {'../escape.txt': 'x'}}), req({seed: {'/abs.txt': 'x'}}),
      req({seed: {'a/../b.txt': 'x'}}), req({seed: {'ok.txt': 5}}), req({seed: {'a b.txt': 'x'}}),
      req({seed: Object.fromEntries(Array.from({length: 17}, (_, i) => [`f${i}.txt`, 'x']))}),
    ];
    for (const b of bad) {
      const r = await exec.run(b);
      assert.equal(r.claimed, false);
      assert.ok(['REJECTED'].includes(r.state), `${JSON.stringify(b)?.slice(0, 80)} -> ${r.state}/${r.reason}`);
    }
    assert.equal(spy.starts, 0);
    assert.deepEqual(x.journal.list(), []);
    assert.deepEqual(fs.readdirSync(x.root).filter(n => n.startsWith('workspace-') || n.startsWith('child-')), []);
  } finally { x.cleanup(); }
});

test('a failing reporter defers: REPORT_PENDING, no second run, claims stay blocked', async () => {
  const x = setup();
  try {
    const rep = createMockReporter({failWith: 'network down'});
    const {exec, spy} = x.make(new MockAdapter(), {rep});
    const r = safe(await exec.run(req()));
    assert.deepEqual([r.state, r.reason], ['REPORT_PENDING', 'REPORT_PENDING']);
    assert.equal(JSON.stringify(r).includes('network down'), false);
    assert.equal(spy.starts, 1);
    assert.equal(stateOf(x), 'REPORT_PENDING');
    const next = await x.make(new MockAdapter()).exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([next.state, next.reason], ['HELD', 'BRIDGE_BUSY']);
  } finally { x.cleanup(); }
});

test('concurrency is exactly one: a second run on the same executor is EXECUTOR_BUSY', async () => {
  const x = setup();
  try {
    const {exec, spy} = x.make(new MockAdapter({fault: 'hang'}));
    const first = exec.run(req({timeout_ms: 600}));
    const second = await exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([second.state, second.reason], ['HELD', 'EXECUTOR_BUSY']);
    assert.equal((await first).state, 'TIMED_OUT');
    assert.equal(spy.starts, 1);
  } finally { x.cleanup(); }
});

test('concurrency is exactly one across executors sharing a journal', async () => {
  const x = setup();
  try {
    const a = x.make(new MockAdapter({fault: 'hang'}));
    const b = x.make(new MockAdapter());
    const first = a.exec.run(req({timeout_ms: 600}));
    for (let i = 0; i < 100 && x.journal.list().length === 0; i++) await sleep(10);
    const r = await b.exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([r.state, r.reason], ['HELD', 'BRIDGE_BUSY']);
    assert.equal(b.spy.starts, 0);
    await first;
  } finally { x.cleanup(); }
});

test('an uncertain journal write after the claim stops the run before the adapter starts', async () => {
  const x = setup();
  try {
    let renames = 0;
    const io = {...fs, renameSync: (...a) => { if (++renames > 1) throw new Error('disk error'); return fs.renameSync(...a); }};
    const j = new Journal(path.join(x.root, 'journal'), {io, clock: x.clock});
    const {exec, spy} = x.make(new MockAdapter(), {journalOverride: j});
    const r = safe(await exec.run(req()));
    assert.deepEqual([r.state, r.reason, r.journal_uncertain], ['HELD', 'JOURNAL_WRITE_UNCERTAIN', true]);
    assert.equal(spy.starts, 0);
    assert.equal(fs.existsSync(path.join(x.root, 'journal', 'writer.lock')), true);
    const next = await x.make(new MockAdapter()).exec.run(req({task_id: TASK2, nonce: nonce(2)}));
    assert.deepEqual([next.state, next.reason], ['HELD', 'JOURNAL_LOCKED']);
  } finally { x.cleanup(); }
});

test('executor construction refuses non-fixture roots, bad sentinels and missing parts', () => {
  const x = setup();
  try {
    const ok = {fixtureRoot: x.root, journal: x.journal, control: x.control, adapter: new MockAdapter(), reporter: x.reporter};
    assert.doesNotThrow(() => new Executor(ok));
    assert.throws(() => new Executor({...ok, fixtureRoot: os.tmpdir()}), code('UNSAFE_FIXTURE_ROOT'));
    assert.throws(() => new Executor({...ok, fixtureRoot: os.homedir()}), code('UNSAFE_FIXTURE_ROOT'));
    assert.throws(() => new Executor({...ok, fixtureRoot: undefined}), code('UNSAFE_FIXTURE_ROOT'));
    for (const miss of ['journal', 'control', 'adapter', 'reporter'])
      assert.throws(() => new Executor({...ok, [miss]: undefined}), code('EXECUTOR_CONFIG_INVALID'));
    assert.throws(() => new Executor({...ok, sentinels: ['/etc/passwd']}), code('EXECUTOR_CONFIG_INVALID'));
    assert.throws(() => new Executor({...ok, sentinels: ['relative']}), code('EXECUTOR_CONFIG_INVALID'));
    assert.throws(() => new Executor({...ok, sentinels: 'x'}), code('EXECUTOR_CONFIG_INVALID'));
    assert.throws(() => new Executor({...ok, quotaBreakerMs: 5}), code('EXECUTOR_CONFIG_INVALID'));
  } finally { x.cleanup(); }
});

test('the mock adapter is one-attempt, listed faults only, and never a real agent', async () => {
  assert.ok(MOCK_FAULTS.includes('denied') && MOCK_FAULTS.includes('hang'));
  assert.throws(() => new MockAdapter({fault: 'rm -rf'}), code('MOCK_FAULT_UNKNOWN'));
  assert.throws(() => new MockAdapter({fault: 'tamper'}), code('MOCK_SENTINEL_REQUIRED'));
  const p = await new MockAdapter().probe();
  assert.deepEqual([p.id, p.simulated, p.real_agent], ['mock', true, false]);
  const x = setup();
  try {
    const a = new MockAdapter();
    const {exec} = x.make(a);
    assert.equal((await exec.run(req())).state, 'READY_FOR_REVIEW');
    await assert.rejects(() => a.start({fixtureRoot: x.root}, {supervise: async () => ({})}), code('ADAPTER_ATTEMPT_ALREADY_USED'));
    await assert.rejects(() => new MockAdapter().start({fixtureRoot: x.root}, {}), code('ADAPTER_SUPERVISE_REQUIRED'));
  } finally { x.cleanup(); }
});

test('the executor only ever runs the fixture child, never a path derived from task data', async () => {
  const x = setup();
  try {
    const seen = [];
    const adapter = {
      id: 'probe', probe: async () => ({}),
      async start(spec, {supervise}) {
        // An adapter may only hand over script text; it cannot choose the command.
        const run = await supervise({scriptSource: "process.stdout.write(process.argv.slice(2).join(','));", args: ['a', 'b']});
        seen.push(run);
        return {adapter: 'probe', outcome: 'failed', supervision: {}, simulated: true};
      },
    };
    await x.make(adapter).exec.run(req({task_id: 'zc-exec-probe', nonce: nonce(7)}));
    assert.equal(seen[0].stdout, 'a,b');
    assert.ok(fs.existsSync(path.join(x.root, 'child-zc-exec-probe-1.mjs')));
    const bad = {id: 'bad', probe: async () => ({}), start: async (spec, {supervise}) => supervise({scriptSource: 5})};
    const r = await x.make(bad).exec.run(req({task_id: 'zc-exec-bad', nonce: nonce(8)}));
    assert.deepEqual([r.state, r.reason], ['FAILED_ADAPTER', 'ADAPTER_THREW']);
  } finally { x.cleanup(); }
});
