import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostTcbLifecycleObserver, lifecycleProofComplete } from '../scripts/hostTcbLifecycleObserver.mjs';

const parent = { executablePath: '/synthetic/candidate/claude', sha256: 'a'.repeat(64) };
const helper = { executablePath: '/synthetic/vendor/helper', sha256: 'b'.repeat(64), signingIdentity: 'SYNTHETIC_VENDOR', classification: 'APPROVED_VENDOR_HELPER', taskAuthority: false, approved: true, executionAuthority: 'TCB_INTERNAL' };
const proc = (pid = 100, extra = {}) => ({ pid, ppid: 1, parentGeneration: 'host', pgid: 100, sid: 100, generation: `g${pid}`, startTime: pid,
  birthAncestryComplete: true, birthAncestry: [{ pid: 1, generation: 'host' }],
  ...parent, ...extra });
const child = extra => proc(123, { ppid: 100, parentGeneration: 'g100', ...helper, ...extra });
const ipc = { state: 'NO_OBSERVED_UNAPPROVED_IPC' };
function setup(extra = {}) {
  const o = createHostTcbLifecycleObserver({ approvedParent: parent, baseline: { at: -250, processes: [], visibility: 'COMPLETE' }, ...extra });
  o.start({ pid: 100, generation: 'g100' });
  return o;
}
const sample = (o, at, processes, extra = {}) => o.observe({ at, processes, visibility: 'COMPLETE', ipc, ...extra });
function clean(o, { at = 250, processes = [] } = {}) {
  o.parentExit({ pid: 100, generation: 'g100', at });
  for (let t = at; t <= at + 2000; t += 250) sample(o, t, processes);
  return o.finish();
}

test('parent-only termination needs explicit exit and the full stable window', () => {
  const o = setup(); sample(o, 0, [proc()]);
  o.parentExit({ pid: 100, generation: 'g100', at: 250 }); sample(o, 250, []);
  assert.equal(o.finish().state, 'LIFECYCLE_UNKNOWN');
  for (let t = 500; t <= 2250; t += 250) sample(o, t, []);
  assert.equal(o.finish().state, 'LIFECYCLE_PASS');
  assert.equal(lifecycleProofComplete(o.finish()), true);
});

test('explicit synthetic helper may exit cleanly without a zero-child requirement', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child()]);
  const result = clean(o);
  assert.equal(result.state, 'LIFECYCLE_PASS');
  assert.equal(result.classCounts.APPROVED_VENDOR_HELPER, 1);
  assert.equal(result.attributableDescendants, 1);
});

test('empty approval inventory never trusts a descendant because Claude spawned it', () => {
  const o = setup(); sample(o, 0, [proc(), child()]);
  assert.equal(clean(o).state, 'LIFECYCLE_UNKNOWN');
});

test('approved helper bytes alone do not prove the launch has no task authority', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child({ executionAuthority: undefined })]);
  assert.equal(clean(o).state, 'LIFECYCLE_UNKNOWN');
  const task = setup({ approvedHelpers: [helper] }); sample(task, 0, [proc(), child({ executionAuthority: 'TASK_CONTROLLED' })]);
  assert.equal(clean(task).state, 'LIFECYCLE_FAIL');
});

test('shell, Git, SSH, MCP, browsers and package managers cannot inherit trust', () => {
  for (const name of ['sh', 'bash', 'zsh', 'pwsh', 'git', 'gh', 'ssh', 'mcp-server', 'Google Chrome', 'npm']) {
    const o = setup(); sample(o, 0, [proc(), child({ executablePath: `/usr/bin/${name}` })]);
    assert.equal(clean(o).state, 'LIFECYCLE_FAIL', name);
  }
});

test('project executables and task-controlled interpreters are definite violations', () => {
  for (const extra of [{ executablePath: '/synthetic/task/bin/tool' }, { executablePath: '/usr/bin/python3', taskControlled: true }]) {
    const o = setup({ taskRoots: ['/synthetic/task'] }); sample(o, 0, [proc(), child(extra)]);
    assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
  }
});

test('background/subagent/cross-session roles are forbidden even for approved helper bytes', () => {
  for (const role of ['background', 'subagent', 'cross-session']) {
    const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child({ role })]);
    assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
  }
});

test('approved helper surviving foreground completion blocks qualification', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child()]);
  const result = clean(o, { processes: [child()] });
  assert.equal(result.state, 'LIFECYCLE_BLOCKED'); assert.equal(result.survivors, 1);
});

test('reparented helper stays attributable when it escapes its original group and session', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child()]);
  const result = clean(o, { processes: [child({ ppid: 1, parentGeneration: 'launchd', pgid: 123, sid: 123 })] });
  assert.equal(result.state, 'LIFECYCLE_BLOCKED'); assert.equal(result.reparented, 1);
  assert.equal(result.classCounts.SURVIVOR, 1);
});

test('reused PID is separated from an exited helper and an unrelated replacement', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child()]);
  sample(o, 250, [proc()]);
  const unrelated = proc(123, { generation: 'new-generation', startTime: 300, ppid: 1, pgid: 999, sid: 999, executablePath: '/host/unrelated' });
  sample(o, 500, [proc(), unrelated]);
  const result = clean(o, { at: 750, processes: [unrelated] });
  assert.equal(result.state, 'LIFECYCLE_PASS'); assert.equal(result.survivors, 0);
  assert.equal(result.reusedPids, 1); assert.equal(result.classCounts.UNRELATED_HOST_PROCESS, 1);
  assert.equal(result.attributableDescendants, 1);
});

test('reused parent PID cannot substitute for the invocation or manufacture cleanup', () => {
  const o = setup(); sample(o, 0, [proc()]);
  sample(o, 250, [proc(100, { generation: 'replacement', startTime: 200 })]);
  assert.equal(o.finish().state, 'LIFECYCLE_UNKNOWN');
});

test('pre-existing and concurrent same-name host Claude processes are unrelated by generation and ancestry', () => {
  const host = proc(50, { pgid: 50, sid: 50 });
  const o = setup({ baseline: { at: -250, processes: [host], visibility: 'COMPLETE' } });
  const concurrent = proc(60, { pgid: 60, sid: 60 }); sample(o, 0, [proc(), host, concurrent]);
  const result = clean(o, { processes: [host, concurrent] });
  assert.equal(result.state, 'LIFECYCLE_PASS'); assert.equal(result.attributableDescendants, 0);
});

test('missed interval and incomplete visibility are sticky UNKNOWN after clean termination', () => {
  for (const extra of [{ visibility: 'INCOMPLETE' }, {}]) {
    const o = setup(); sample(o, 0, [proc()], extra); sample(o, 1000, [proc()]);
    assert.equal(clean(o, { at: 1250 }).state, 'LIFECYCLE_UNKNOWN');
  }
});

test('a gap before the first parent observation cannot be ignored', () => {
  const o = setup(); sample(o, 10000, [proc()]);
  assert.equal(clean(o, { at: 10250 }).state, 'LIFECYCLE_UNKNOWN');
});

test('first-seen detached process needs positive birth ancestry to be unrelated', () => {
  const o = setup(); sample(o, 0, [proc(), child({ ppid: 1, pgid: 123, sid: 123, parentGeneration: 'host', birthAncestryComplete: false, birthAncestry: [] })]);
  assert.equal(clean(o).state, 'LIFECYCLE_UNKNOWN');
});

test('complete birth ancestry attributes a child that detached before its first sample', () => {
  const orphan = child({ ppid: 1, pgid: 123, sid: 123, parentGeneration: 'host', birthAncestry: [{ pid: 100, generation: 'g100' }, { pid: 1, generation: 'host' }] });
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), orphan]);
  const result = clean(o, { processes: [orphan] });
  assert.equal(result.state, 'LIFECYCLE_BLOCKED'); assert.equal(result.survivors, 1);
});

test('unapproved attributable IPC blocks even when processes terminate', () => {
  const o = setup(); sample(o, 0, [proc()], { ipc: { state: 'UNAPPROVED_IPC' } });
  assert.equal(clean(o).state, 'LIFECYCLE_BLOCKED');
});

test('unavailable IPC visibility cannot produce lifecycle PASS', () => {
  const o = setup(); sample(o, 0, [proc()], { ipc: { state: 'IPC_OBSERVATION_INCOMPLETE' } });
  assert.equal(clean(o).state, 'LIFECYCLE_UNKNOWN');
});

test('conflicting or malformed IPC signals cannot qualify a no-IPC claim', () => {
  for (const signalClasses of [['UNIX_SOCKET'], { unexpected: true }]) {
    const o = setup(); sample(o, 0, [proc()], { ipc: { state: 'NO_OBSERVED_UNAPPROVED_IPC', signalClasses } });
    assert.equal(clean(o).state, 'LIFECYCLE_UNKNOWN');
  }
});

test('lost visibility after parent exit is UNKNOWN rather than a fabricated survivor', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child()]);
  o.parentExit({ pid: 100, generation: 'g100', at: 250 });
  sample(o, 250, [], { visibility: 'INCOMPLETE' });
  assert.equal(o.finish().state, 'LIFECYCLE_UNKNOWN'); assert.equal(o.finish().survivors, 0);
});

test('approved parent identity cannot hide a definite background or task-controlled role', () => {
  for (const extra of [{ role: 'background' }, { taskControlled: true }, { executionAuthority: 'TASK_CONTROLLED' }]) {
    const o = setup(); sample(o, 0, [proc(100, extra)]); assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
  }
});

test('Unix socket, cross-session endpoint and listener signals retain their normalized blocking classes', () => {
  for (const kind of ['UNIX_SOCKET', 'CROSS_SESSION_ENDPOINT', 'LOCAL_LISTENER']) {
    const o = setup(); sample(o, 0, [proc()], { ipc: { state: 'UNAPPROVED_IPC', signalClasses: [kind] } });
    const proof = clean(o); assert.equal(proof.state, 'LIFECYCLE_BLOCKED'); assert.deepEqual(proof.ipcSignals, [kind]);
  }
});

test('ambiguous attribution and missing generation remain UNKNOWN after all processes disappear', () => {
  for (const extra of [{ parentGeneration: undefined }, { generation: undefined }, { attributionAmbiguous: true }]) {
    const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child(extra)]);
    assert.equal(clean(o).state, 'LIFECYCLE_UNKNOWN');
  }
});

test('approved OS helper requires exact signing/hash identity and cannot override forbidden authority', () => {
  const apple = { ...helper, executablePath: '/synthetic/os/service', signingIdentity: 'SYNTHETIC_APPLE', classification: 'APPROVED_OS_HELPER' };
  const o = setup({ approvedHelpers: [apple] }); sample(o, 0, [proc(), child(apple)]);
  assert.equal(clean(o).state, 'LIFECYCLE_PASS');
  const drift = setup({ approvedHelpers: [apple] }); sample(drift, 0, [proc(), child({ ...apple, signingIdentity: 'wrong' })]);
  assert.equal(clean(drift).state, 'LIFECYCLE_UNKNOWN');
});

test('malformed/reordered observations and resurrection of an exited generation cannot pass', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child()]); sample(o, 250, [proc()]);
  sample(o, 500, [proc(), child()]); assert.equal(clean(o, { at: 750 }).state, 'LIFECYCLE_UNKNOWN');
  const other = setup(); sample(other, 0, [proc()]); sample(other, -1, []);
  assert.equal(other.finish().state, 'LIFECYCLE_UNKNOWN');
});

test('wrong approved-parent binary cannot become PASS after later cleanup', () => {
  const o = setup(); sample(o, 0, [proc(100, { sha256: 'c'.repeat(64) })]);
  assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
});

test('absence alone cannot replace an explicit parent-exit event', () => {
  const o = setup(); sample(o, 0, [proc()]);
  for (let t = 250; t <= 2500; t += 250) sample(o, t, []);
  assert.equal(o.finish().state, 'LIFECYCLE_UNKNOWN');
});

test('a new descendant during cleanup resets quiescence and still needs explicit approval', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc()]); o.parentExit({ pid: 100, generation: 'g100', at: 250 }); sample(o, 250, []);
  sample(o, 500, [child()]); sample(o, 750, []);
  for (let t = 1000; t <= 2500; t += 250) sample(o, t, []);
  assert.equal(o.finish().state, 'LIFECYCLE_UNKNOWN');
  sample(o, 2750, []); assert.equal(o.finish().state, 'LIFECYCLE_PASS');
});

test('lifecycle summary carries normalized classes and hashes without executable paths', () => {
  const o = setup({ approvedHelpers: [helper] }); sample(o, 0, [proc(), child()]);
  const result = clean(o); const serialized = JSON.stringify(result);
  assert.equal(result.state, 'LIFECYCLE_PASS'); assert.equal(serialized.includes('/synthetic'), false);
  assert.equal(serialized.includes('SYNTHETIC_VENDOR'), false);
});
