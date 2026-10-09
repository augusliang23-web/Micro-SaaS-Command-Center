import assert from 'node:assert/strict';
import test from 'node:test';

import {createHostTcbLifecycleObserver, lifecycleProofComplete} from '../scripts/hostTcbLifecycleObserver.mjs';

const parent = {
  executablePath: '/synthetic/candidate/claude',
  sha256: 'a'.repeat(64)
};
const authority = {
  canonicalLaunch: true,
  toolInventory: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
  invokedTools: ['Read', 'Edit'],
  protocolState: 'PASS',
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  requestedModel: 'sonnet',
  requestedEffort: 'medium',
  modelEvidence: 'AUTHORITATIVE',
  effectiveModel: 'sonnet',
  sessionState: 'ABSENT',
  filesystemState: 'PASS'
};
const proc = (pid = 100, extra = {}) => ({
  pid,
  ppid: 1,
  parentGeneration: 'host',
  pgid: 100,
  sid: 100,
  generation: `g${pid}`,
  startTime: pid,
  birthAncestryComplete: true,
  birthAncestry: [{pid: 1, generation: 'host'}],
  ...parent,
  ...extra
});
const child = (extra = {}) => proc(
    123,
    {ppid: 100, parentGeneration: 'g100', executablePath: '/synthetic/vendor/internal', ...extra});
function setup(extra = {}) {
  const o = createHostTcbLifecycleObserver({
    approvedParent: parent,
    baseline: {at: -250, processes: [], inspectionState: 'PASS'},
    taskRoots: ['/synthetic/task'],
    ...extra
  });
  o.start({pid: 100, generation: 'g100'});
  return o;
}
const sample = (o, at, processes, extra = {}) =>
    o.observe({at, processes, visibility: 'SAMPLING_ONLY', ...extra});
const post = (o, at, processes = [], extra = {}) => sample(o, at, processes, {
  inspection: {process: 'PASS', ipc: 'PASS'},
  ipc: {state: 'NO_PERSISTENT_UNAPPROVED_IPC'},
  ...extra
});
function clean(o, {at = 250, processes = [], extra = {}, auth = authority} = {}) {
  o.parentExit({pid: 100, generation: 'g100', at});
  for (let t = at; t <= at + 2000; t += 250) post(o, t, processes, extra);
  return o.finish(auth);
}

test(
    'clean authority and postconditions pass only after explicit parent exit and stable window',
    () => {
      const o = setup();
      sample(o, 0, [proc()]);
      o.parentExit({pid: 100, generation: 'g100', at: 250});
      post(o, 250);
      assert.equal(o.finish(authority).state, 'LIFECYCLE_UNKNOWN');
      for (let t = 500; t <= 2250; t += 250) post(o, t);
      assert.equal(o.finish(authority).state, 'LIFECYCLE_PASS');
      assert.equal(lifecycleProofComplete(o.finish(authority)), true);
    });
test('attributable internal transient needs no permanent helper approval', () => {
  const o = setup();
  sample(o, 0, [proc(), child()]);
  const p = clean(o);
  assert.equal(p.state, 'LIFECYCLE_PASS');
  assert.equal(p.classCounts.TCB_INTERNAL_TRANSIENT, 1);
  assert.equal(p.historyCoverage, 'SAMPLING_ONLY');
});
test(
    'completely missed transient activity is accepted with clean authority and final postconditions',
    () => {
      const o = setup();
      sample(o, 0, [proc()]);
      sample(o, 1000, [proc()], {visibility: 'INCOMPLETE'});
      assert.equal(clean(o, {at: 1250}).state, 'LIFECYCLE_PASS');
    });
test('execution and initial sampling gaps do not independently block postcondition proof', () => {
  const o = setup();
  sample(o, 10000, [proc()]);
  const p = clean(o, {at: 10250});
  assert.equal(p.state, 'LIFECYCLE_PASS');
  assert.equal(p.observationGaps > 0, true);
});
test('positive shells and authority processes remain sticky FAIL after disappearing', () => {
  for (const name
           of ['sh', 'bash', 'zsh', 'fish', 'pwsh', 'PowerShell', 'cmd', 'git', 'gh', 'ssh', 'scp',
               'sftp', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'pip', 'cargo', 'mcp-server',
               'Google Chrome', 'browser']) {
    const o = setup();
    sample(o, 0, [proc(), child({executablePath: `/usr/bin/${name}`})]);
    assert.equal(clean(o).state, 'LIFECYCLE_FAIL', name);
  }
});
test('task-root executable, task-controlled interpreter and task authority enum fail', () => {
  for (const extra
           of [{executablePath: '/synthetic/task/run'},
               {executablePath: '/usr/bin/python3', taskControlled: true},
               {executionAuthority: 'TASK_CONTROLLED'}]) {
    const o = setup();
    sample(o, 0, [proc(), child(extra)]);
    assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
  }
});
test('background, subagent, team, resume, fork and cross-session roles remain forbidden', () => {
  for (const role
           of ['background', 'subagent', 'team', 'resume', 'fork', 'cross-session',
               'session-worker']) {
    const o = setup();
    sample(o, 0, [proc(), child({role})]);
    assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
  }
});
test('internal and unknown owned survivors block', () => {
  for (const extra of [{}, {executablePath: null}]) {
    const o = setup();
    sample(o, 0, [proc(), child(extra)]);
    const p = clean(o, {processes: [child(extra)]});
    assert.equal(p.state, 'LIFECYCLE_BLOCKED');
    assert.equal(p.survivors, 1);
  }
});
test('reparenting and session/group detachment retain observed generation ownership', () => {
  const o = setup();
  sample(o, 0, [proc(), child()]);
  const p =
      clean(o, {processes: [child({ppid: 1, parentGeneration: 'host', pgid: 123, sid: 123})]});
  assert.equal(p.state, 'LIFECYCLE_BLOCKED');
  assert.equal(p.reparented, 1);
});
test('original parent generation can attribute a first-seen detached survivor', () => {
  const o = setup();
  sample(o, 0, [proc()]);
  const p = clean(o, {
    processes: [child(
        {ppid: 1, parentGeneration: 'host', originalParentGeneration: 'g100', pgid: 123, sid: 123})]
  });
  assert.equal(p.state, 'LIFECYCLE_BLOCKED');
});
test('ambiguous persistent origin is UNKNOWN, expired unknown history is not a blocker', () => {
  const orphan = child({
    ppid: 1,
    parentGeneration: 'missing',
    pgid: 123,
    sid: 123,
    birthAncestryComplete: false,
    birthAncestry: []
  });
  const o = setup();
  sample(o, 0, [proc(), orphan]);
  assert.equal(clean(o, {processes: [orphan]}).state, 'LIFECYCLE_UNKNOWN');
  const gone = setup();
  sample(gone, 0, [proc(), orphan]);
  assert.equal(clean(gone).state, 'LIFECYCLE_PASS');
});
test('reused helper PID never merges an unrelated replacement with the owned generation', () => {
  const o = setup();
  sample(o, 0, [proc(), child()]);
  sample(o, 250, [proc()]);
  const host = proc(123, {
    generation: 'replacement',
    startTime: 300,
    pgid: 999,
    sid: 999,
    executablePath: '/host/other'
  });
  sample(o, 500, [proc(), host]);
  const p = clean(o, {at: 750, processes: [host]});
  assert.equal(p.state, 'LIFECYCLE_PASS');
  assert.equal(p.survivors, 0);
  assert.equal(p.reusedPids, 1);
});
test(
    'preexisting and positively unrelated same-name processes do not become target survivors',
    () => {
      const host = proc(50, {pgid: 50, sid: 50});
      const o = setup({baseline: {at: -250, processes: [host], inspectionState: 'PASS'}});
      const concurrent = proc(60, {pgid: 60, sid: 60});
      sample(o, 0, [proc(), host, concurrent]);
      assert.equal(clean(o, {processes: [host, concurrent]}).state, 'LIFECYCLE_PASS');
    });
test('persistent unapproved Unix/listener/cross-session IPC blocks', () => {
  for (const kind of ['UNIX_SOCKET', 'LOCAL_LISTENER', 'CROSS_SESSION_ENDPOINT']) {
    const o = setup();
    sample(o, 0, [proc()]);
    const p = clean(o, {extra: {ipc: {state: 'UNAPPROVED_IPC', signalClasses: [kind]}}});
    assert.equal(p.state, 'LIFECYCLE_BLOCKED');
    assert.deepEqual(p.ipcSignals, [kind]);
  }
});
test('transient internal sockets gone at final checks do not block', () => {
  const o = setup();
  sample(o, 0, [proc()], {ipc: {state: 'TRANSIENT_TCB_IPC', signalClasses: ['UNIX_SOCKET']}});
  assert.equal(clean(o).state, 'LIFECYCLE_PASS');
});
test('positive task-controlled IPC stays FAIL even when final sockets are absent', () => {
  const o = setup();
  sample(o, 0, [proc()], {ipc: {state: 'FORBIDDEN_IPC'}});
  assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
});
test('missing final socket or process inspection never passes', () => {
  for (const inspection of [{process: 'PASS', ipc: 'UNKNOWN'}, {process: 'UNKNOWN', ipc: 'PASS'}]) {
    const o = setup();
    sample(o, 0, [proc()]);
    assert.equal(clean(o, {extra: {inspection}}).state, 'LIFECYCLE_UNKNOWN');
  }
});
test('a final collector error resets stability and cannot use an earlier clean checkpoint', () => {
  const o = setup();
  sample(o, 0, [proc()]);
  clean(o);
  o.loseVisibility();
  assert.equal(o.finish(authority).state, 'LIFECYCLE_UNKNOWN');
});
test('a missed cleanup interval needs a fresh stable final window', () => {
  const o = setup();
  sample(o, 0, [proc()]);
  o.parentExit({pid: 100, generation: 'g100', at: 250});
  post(o, 250);
  post(o, 1250);
  for (let t = 1500; t <= 3000; t += 250) post(o, t);
  assert.equal(o.finish(authority).state, 'LIFECYCLE_UNKNOWN');
  post(o, 3250);
  assert.equal(o.finish(authority).state, 'LIFECYCLE_PASS');
});
test('wrong parent, reused parent without matching exit, and absent parent cannot pass', () => {
  const wrong = setup();
  sample(wrong, 0, [proc(100, {sha256: 'b'.repeat(64)})]);
  assert.equal(clean(wrong).state, 'LIFECYCLE_FAIL');
  const noexit = setup();
  sample(noexit, 0, [proc()]);
  for (let t = 250; t <= 2250; t += 250) post(noexit, t);
  assert.equal(noexit.finish(authority).state, 'LIFECYCLE_UNKNOWN');
  const missing = setup();
  assert.equal(clean(missing).state, 'LIFECYCLE_UNKNOWN');
});
test('parent task-controlled and session roles remain definite violations', () => {
  for (const extra
           of [{taskControlled: true}, {executionAuthority: 'TASK_CONTROLLED'},
               {role: 'background'}]) {
    const o = setup();
    sample(o, 0, [proc(100, extra)]);
    assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
  }
});
test('no higher-level authority evidence means no lifecycle PASS', () => {
  const o = setup();
  sample(o, 0, [proc()]);
  assert.equal(clean(o, {auth: null}).state, 'LIFECYCLE_UNKNOWN');
});
test('exact tool inventory excludes duplicates, additions, missing and unknown tools', () => {
  for (const tools
           of [['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
               ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Grep'], ['Read', 'Edit', 'Write', 'Glob'],
               ['Read', 'Edit', 'Write', 'Glob', 'future']]) {
    const o = setup();
    sample(o, 0, [proc()]);
    assert.equal(clean(o, {auth: {...authority, toolInventory: tools}}).state, 'LIFECYCLE_FAIL');
  }
});
test('forbidden tool invocation, auth/provider route or canonical drift never passes', () => {
  for (const extra
           of [{invokedTools: ['Bash']}, {authMethod: 'api_key'}, {apiProvider: 'bedrock'},
               {canonicalLaunch: false}]) {
    const o = setup();
    sample(o, 0, [proc()]);
    assert.equal(clean(o, {auth: {...authority, ...extra}}).state, 'LIFECYCLE_FAIL');
  }
});
test('session transcript blocks, ambiguous session/model/protocol evidence remains UNKNOWN', () => {
  const o = setup();
  sample(o, 0, [proc()]);
  assert.equal(
      clean(o, {auth: {...authority, sessionState: 'PRESENT'}}).state, 'LIFECYCLE_BLOCKED');
  for (const extra
           of [{sessionState: 'UNKNOWN'}, {modelEvidence: 'UNKNOWN'}, {protocolState: 'UNKNOWN'}]) {
    const x = setup();
    sample(x, 0, [proc()]);
    assert.equal(clean(x, {auth: {...authority, ...extra}}).state, 'LIFECYCLE_UNKNOWN');
  }
});
test(
    'filesystem and protected diff barriers cannot be overridden by clean lifecycle processes',
    () => {
      for (const state of ['FAIL', 'BLOCKED', 'UNKNOWN']) {
        const o = setup();
        sample(o, 0, [proc()]);
        assert.equal(
            clean(o, {auth: {...authority, filesystemState: state}}).state, `LIFECYCLE_${state}`);
      }
    });
test(
    'sanitized evidence records postcondition proof without claiming complete transient history',
    () => {
      const o = setup();
      sample(o, 0, [proc(), child()]);
      const p = clean(o);
      assert.equal(p.state, 'LIFECYCLE_PASS');
      assert.equal(p.historyCoverage, 'SAMPLING_ONLY');
      assert.equal(JSON.stringify(p).includes('/synthetic'), false);
    });
test('incomplete metadata never hides a definite filesystem breach or observed session', () => {
  for (const [extra, state] of [
           [{filesystemState: 'FAIL'}, 'LIFECYCLE_FAIL'],
           [{sessionState: 'PRESENT'}, 'LIFECYCLE_BLOCKED']]) {
    const o = setup();
    sample(o, 0, [proc()]);
    assert.equal(clean(o, {auth: {...authority, modelEvidence: 'UNKNOWN', ...extra}}).state, state);
  }
});
test('a positively attributable survivor stays owned across UID changes', () => {
  const o = setup();
  sample(o, 0, [proc(), child({uid: 501})]);
  assert.equal(
      clean(o, {
        processes: [child({uid: 0, ppid: 1, parentGeneration: 'host', pgid: 123, sid: 123})]
      }).state,
      'LIFECYCLE_BLOCKED');
});
test('IPC targets include reparented generations and exclude a reused unrelated PID', () => {
  const o = setup();
  sample(o, 0, [proc(), child()]);
  const reparent = child({ppid: 1, parentGeneration: 'host', pgid: 123, sid: 123});
  assert.equal(o.targets([reparent])[0].owned, true);
  const replacement = proc(123, {generation: 'new', pgid: 999, sid: 999});
  assert.deepEqual(o.targets([replacement]), []);
});
test(
    'parent PID reuse before matching exit is ambiguous, after exit unrelated birth proof keeps generations separate',
    () => {
      const o = setup();
      sample(o, 0, [proc()]);
      sample(o, 250, [proc(100, {generation: 'new', startTime: 200})]);
      assert.equal(clean(o, {at: 500}).state, 'LIFECYCLE_UNKNOWN');
      const ok = setup();
      sample(ok, 0, [proc()]);
      const replacement = proc(100, {generation: 'new', startTime: 300});
      assert.equal(clean(ok, {processes: [replacement]}).state, 'LIFECYCLE_PASS');
    });
test(
    'a changed parent executable remains a definite violation without a replacement digest', () => {
      const o = setup();
      sample(o, 0, [proc(100, {executablePath: '/bin/bash', sha256: undefined})]);
      assert.equal(clean(o).state, 'LIFECYCLE_FAIL');
    });
test(
    'native unique ID exec-version transitions retain parent ownership and sticky forbidden execution',
    () => {
      const o = createHostTcbLifecycleObserver(
          {approvedParent: parent, baseline: {at: -250, processes: [], inspectionState: 'PASS'}});
      o.start({pid: 100, generation: '50:1'});
      sample(o, 0, [proc(100, {generation: '50:1'})]);
      sample(
          o, 250, [proc(100, {generation: '50:2', executablePath: '/bin/sh', sha256: undefined})]);
      o.parentExit({pid: 100, generation: '50:1', at: 500});
      for (let t = 500; t <= 2500; t += 250) post(o, t);
      const p = o.finish(authority);
      assert.equal(p.state, 'LIFECYCLE_FAIL');
      assert.equal(p.execTransitions, 1);
      assert.equal(p.reusedPids, 0);
    });
