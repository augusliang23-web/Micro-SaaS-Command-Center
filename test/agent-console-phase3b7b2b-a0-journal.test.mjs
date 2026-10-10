import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { ExecutionIdentityJournal, JournalError } from '../server/execution/identity/identityJournal.mjs';
import {
  EXECUTION_STAGES, STAGE_TRANSITIONS, IdentityError, buildPlannedRecord, validateIdentityRecord, expectedLabels,
} from '../server/execution/identity/executionIdentity.mjs';
import { DIGEST, cid, planned, runId, taskId, freshJournal, openJournal, readRecordFile, recordPath, tempRoot } from './helpers/identityFixture.mjs';

// OFFLINE ONLY. No Docker, no network, no agent, no credential. Covers the durable execution identity model, atomic journal writes,
// revisions/generations, start authorization and the double-execution contract.

// Journal and identity errors share a `code`; either class is a deliberate refusal.
const code = (c) => (e) => (e instanceof JournalError || e instanceof IdentityError) && e.code === c;
const icode = code;

test('a planned record is built from server identifiers only and derives name and labels itself', () => {
  const fx = freshJournal();
  try {
    const r = fx.journal.createPlanned(planned(1));
    assert.equal(r.stage, 'PLANNED');
    assert.equal(r.containerId, null);
    assert.equal(r.containerName, 'cc-sandbox-agent-run-20260101-00000001');
    assert.deepEqual(r.labels, expectedLabels(r.sandboxId, 'agent'));
    assert.equal(r.executionGeneration, 1);
    assert.equal(r.revision, 1);
    assert.equal(r.writerEpoch, fx.journal.epoch);
    assert.equal(r.stateRootId, fx.journal.stateRootId);
    assert.deepEqual(Object.keys(readRecordFile(fx.root, runId(1))).sort(), ['containerId', 'containerName', 'createdAt', 'executionGeneration', 'imageDigest', 'labels', 'revision', 'role', 'runId', 'sandboxId', 'schemaVersion', 'stage', 'stateRootId', 'taskId', 'updatedAt', 'writerEpoch']);
  } finally { fx.cleanup(); }
});

test('caller-supplied container ids, names, labels, paths or any extra key are refused, not ignored', () => {
  const fx = freshJournal();
  try {
    for (const extra of [{ containerId: cid('c') }, { containerName: 'x' }, { labels: {} }, { workspacePath: '/etc' }, { hostPath: '/' }, { stage: 'RUNNING' }, { revision: 9 }, JSON.parse('{"__proto__":{"x":1}}')]) {
      assert.throws(() => fx.journal.createPlanned({ ...planned(1), ...extra }), icode('INVALID_INPUT'), JSON.stringify(Object.keys(extra)));
    }
    for (const missing of ['taskId', 'runId', 'sandboxId', 'role', 'imageDigest']) {
      const input = { ...planned(1) }; delete input[missing];
      assert.throws(() => fx.journal.createPlanned(input), icode('INVALID_INPUT'), missing);
    }
    assert.throws(() => fx.journal.createPlanned(null), icode('INVALID_INPUT'));
    assert.throws(() => fx.journal.createPlanned('RUN-x'), icode('INVALID_INPUT'));
    assert.deepEqual(fx.journal.scan().records, []);
  } finally { fx.cleanup(); }
});

test('every identity field is validated strictly', () => {
  const base = buildPlannedRecord(planned(1), { stateRootId: 'f'.repeat(32), writerEpoch: 1, executionGeneration: 1, now: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(validateIdentityRecord(base), []);
  const bad = {
    taskId: ['CC-1', '../x', 'CC-20260101-0000000G', 5, null],
    runId: ['RUN-1', '../RUN-20260101-00000001', 'run-20260101-00000001', null],
    sandboxId: ['', 'a', '-abc-def', 'a/b/c/d/e/f', 'x'.repeat(60), 5],
    role: ['scratch', 'AGENT', 'root', '', null],
    imageDigest: ['busybox:latest', 'sha256:abc', `sha256:${'A'.repeat(64)}`, `sha512:${'a'.repeat(64)}`, null],
    containerId: ['abc', 'C'.repeat(64), 'c'.repeat(63), 'c'.repeat(65), 5, undefined],
    executionGeneration: [0, -1, 1.5, '1', NaN, 2 ** 60],
    revision: [0, -1, 1.5, '1', null],
    writerEpoch: [0, 1.5, '1', null],
    stateRootId: ['x', 'F'.repeat(32), '', null],
    createdAt: ['2026-01-01', 'yesterday', '2026-13-01T00:00:00.000Z', '2026-01-01T00:00:00Z', 5],
    schemaVersion: [0, 2, '1', null],
    stage: ['', 'RUN', 'running', null],
    containerName: ['cc-sandbox-agent-other', '', 'x; rm -rf /'],
  };
  for (const [field, values] of Object.entries(bad)) {
    for (const value of values) {
      const r = { ...base, [field]: value };
      if (field === 'containerId' && value === undefined) continue;
      assert.notDeepEqual(validateIdentityRecord(r), [], `${field}=${String(value)}`);
    }
  }
  assert.notDeepEqual(validateIdentityRecord({ ...base, extra: 1 }), []);
  assert.notDeepEqual(validateIdentityRecord({ ...base, labels: { ...base.labels, 'cc.sandbox.extra': 'x' } }), []);
  assert.notDeepEqual(validateIdentityRecord({ ...base, labels: { ...base.labels, 'cc.sandbox': '0' } }), []);
  assert.notDeepEqual(validateIdentityRecord({ ...base, labels: { ...base.labels, 'cc.sandbox.role': 'verifier' } }), []);
  assert.notDeepEqual(validateIdentityRecord({ ...base, updatedAt: '2025-12-31T00:00:00.000Z' }), []);
  assert.notDeepEqual(validateIdentityRecord({ ...base, containerId: cid('c') }), [], 'PLANNED may not carry a container id');
  assert.notDeepEqual(validateIdentityRecord({ ...base, stage: 'CREATED' }), [], 'CREATED requires a container id');
  assert.notDeepEqual(validateIdentityRecord([]), []);
  assert.notDeepEqual(validateIdentityRecord(null), []);
  assert.notDeepEqual(validateIdentityRecord({ ...base }, { stateRootId: '0'.repeat(32) }), []);
});

test('validation holds on each field independently, even when the derived name and labels are made consistent with a bad value', () => {
  const base = buildPlannedRecord(planned(1), { stateRootId: 'f'.repeat(32), writerEpoch: 1, executionGeneration: 1, now: '2026-01-01T00:00:00.000Z' });
  const consistent = (over) => { const r = { ...base, ...over }; r.containerName = `cc-sandbox-${r.role}-${r.sandboxId.toLowerCase()}`; r.labels = expectedLabels(r.sandboxId, r.role); return r; };
  for (const sandboxId of ['a', 'abc', '-abcdef', 'ab_cdef', 'x'.repeat(60)]) assert.notDeepEqual(validateIdentityRecord(consistent({ sandboxId })), [], sandboxId);
  for (const role of ['scratch', 'root', 'Agent']) assert.notDeepEqual(validateIdentityRecord(consistent({ role })), [], role);
  for (const stage of ['WEIRD', 'running', '', 'RUNNING ']) assert.notDeepEqual(validateIdentityRecord({ ...base, stage, containerId: cid('c') }), [], stage);
  for (const at of ['2026-02-30T00:00:00.000Z', '2026-04-31T00:00:00.000Z', '2026-01-01T24:00:00.000Z', '2026-01-01T00:60:00.000Z']) assert.notDeepEqual(validateIdentityRecord({ ...base, createdAt: at, updatedAt: '2026-12-01T00:00:00.000Z' }), [], at);
  assert.deepEqual(validateIdentityRecord(consistent({ sandboxId: 'ABCDEF-123456', role: 'verifier' })), []);
});

test('records and label maps with a foreign prototype are not records', () => {
  const base = buildPlannedRecord(planned(1), { stateRootId: 'f'.repeat(32), writerEpoch: 1, executionGeneration: 1, now: '2026-01-01T00:00:00.000Z' });
  assert.notDeepEqual(validateIdentityRecord(Object.assign(Object.create(null), base)), []);
  class Impostor {}
  assert.notDeepEqual(validateIdentityRecord(Object.assign(new Impostor(), base)), []);
  assert.notDeepEqual(validateIdentityRecord({ ...base, labels: Object.assign(Object.create(null), base.labels) }), []);
});

test('the stage table allows only forward lifecycle moves and UNKNOWN/DESTROYED are terminal', () => {
  assert.deepEqual([...EXECUTION_STAGES], ['PLANNED', 'CREATED', 'START_AUTHORIZED', 'RUNNING', 'STOPPING', 'STOPPED', 'DESTROYED', 'UNKNOWN']);
  assert.deepEqual(STAGE_TRANSITIONS.DESTROYED, []);
  assert.deepEqual(STAGE_TRANSITIONS.UNKNOWN, []);
  for (const [from, tos] of Object.entries(STAGE_TRANSITIONS)) for (const to of tos) assert.ok(EXECUTION_STAGES.includes(to), `${from}->${to}`);
  for (const stage of EXECUTION_STAGES) assert.equal(STAGE_TRANSITIONS[stage].includes(stage), false, 'no self transition');
  // a container may not start without having been journaled
  assert.equal(STAGE_TRANSITIONS.PLANNED.includes('START_AUTHORIZED'), false);
  assert.equal(STAGE_TRANSITIONS.PLANNED.includes('RUNNING'), false);
  assert.equal(STAGE_TRANSITIONS.RUNNING.includes('PLANNED'), false);
});

test('files and directories are owner-only and the journal leaves no temp files behind', () => {
  const fx = freshJournal();
  try {
    const r = fx.journal.createPlanned(planned(1));
    fx.journal.transition(runId(1), r.revision, 'CREATED', { containerId: cid('c') });
    assert.equal(fs.statSync(fx.root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(`${fx.root}/records`).mode & 0o777, 0o700);
    assert.equal(fs.statSync(recordPath(fx.root, runId(1))).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${fx.root}/meta.json`).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${fx.root}/writer.lock`).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(`${fx.root}/records`), [`${runId(1)}.json`]);
    assert.deepEqual(fx.journal.scan().leftoverTemp, []);
  } finally { fx.cleanup(); }
});

test('the journal stores no credentials: every value matches a closed pattern', () => {
  const fx = freshJournal();
  try {
    const r = fx.journal.createPlanned(planned(1));
    fx.journal.transition(runId(1), r.revision, 'CREATED', { containerId: cid('c') });
    const text = fs.readFileSync(recordPath(fx.root, runId(1)), 'utf8') + fs.readFileSync(`${fx.root}/meta.json`, 'utf8');
    assert.doesNotMatch(text, /token|secret|password|api[_-]?key|bearer|authorization|BEGIN [A-Z ]*KEY|sk-[A-Za-z0-9]/i);
    for (const secretish of ['sk-ant-api03-abc', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'Bearer abc.def']) {
      assert.throws(() => fx.journal.createPlanned({ ...planned(2), imageDigest: secretish }), icode('INVALID_INPUT'));
      assert.throws(() => fx.journal.createPlanned({ ...planned(2), taskId: secretish }), icode('INVALID_INPUT'));
    }
    for (const secretish of ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'Bearer abc.def', 'a=b;c']) assert.throws(() => fx.journal.createPlanned({ ...planned(2), sandboxId: secretish }), icode('INVALID_INPUT'));
  } finally { fx.cleanup(); }
});

test('a container id can be recorded only on PLANNED -> CREATED, exactly once, and never duplicated', () => {
  const fx = freshJournal();
  try {
    const a = fx.journal.createPlanned(planned(1));
    assert.throws(() => fx.journal.transition(runId(1), a.revision, 'CREATED'), icode('INVALID_INPUT'));
    assert.throws(() => fx.journal.transition(runId(1), a.revision, 'CREATED', { containerId: 'short' }), icode('INVALID_INPUT'));
    assert.throws(() => fx.journal.transition(runId(1), a.revision, 'UNKNOWN', { containerId: cid('c') }), icode('INVALID_INPUT'));
    const created = fx.journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') });
    assert.equal(created.containerId, cid('c'));
    assert.throws(() => fx.journal.transition(runId(1), created.revision, 'STOPPING', { containerId: cid('d') }), icode('INVALID_INPUT'));
    const b = fx.journal.createPlanned(planned(2));
    assert.throws(() => fx.journal.transition(runId(2), b.revision, 'CREATED', { containerId: cid('c') }), code('DUPLICATE_CONTAINER'));
    assert.equal(fx.journal.get(runId(2)).stage, 'PLANNED');
  } finally { fx.cleanup(); }
});

test('compare-and-set revisions: a stale writer view is rejected and nothing changes', () => {
  const fx = freshJournal();
  try {
    const r1 = fx.journal.createPlanned(planned(1));
    const r2 = fx.journal.transition(runId(1), r1.revision, 'CREATED', { containerId: cid('c') });
    assert.equal(r2.revision, 2);
    assert.throws(() => fx.journal.transition(runId(1), r1.revision, 'UNKNOWN'), code('STALE_REVISION'));
    assert.throws(() => fx.journal.transition(runId(1), 0, 'UNKNOWN'), code('STALE_REVISION'));
    assert.throws(() => fx.journal.transition(runId(1), '2', 'UNKNOWN'), code('STALE_REVISION'));
    assert.throws(() => fx.journal.transition(runId(1), r2.revision + 1, 'UNKNOWN'), code('STALE_REVISION'));
    assert.equal(fx.journal.get(runId(1)).revision, 2);
    assert.throws(() => fx.journal.transition(runId(1), 2, 'RUNNING'), icode('ILLEGAL_TRANSITION'));
    assert.throws(() => fx.journal.transition(runId(9), 1, 'UNKNOWN'), code('NOT_FOUND'));
    assert.equal(fx.journal.get(runId(9)), null);
  } finally { fx.cleanup(); }
});

test('execution generations: a task gets generation 1, then 2 only after the first is DESTROYED; UNKNOWN blocks a retry', () => {
  const fx = freshJournal();
  try {
    const a = fx.journal.createPlanned(planned(1));
    assert.throws(() => fx.journal.createPlanned({ ...planned(2), taskId: taskId(1) }), code('ACTIVE_EXECUTION_EXISTS'));
    const created = fx.journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') });
    const destroyed = fx.journal.transition(runId(1), created.revision, 'DESTROYED');
    assert.equal(destroyed.stage, 'DESTROYED');
    const again = fx.journal.createPlanned({ ...planned(2), taskId: taskId(1) });
    assert.equal(again.executionGeneration, 2);
    fx.journal.transition(runId(2), again.revision, 'UNKNOWN');
    assert.throws(() => fx.journal.createPlanned({ ...planned(3), taskId: taskId(1) }), code('ACTIVE_EXECUTION_EXISTS'), 'an UNKNOWN execution blocks the task until an operator resolves it');
    // other tasks are unaffected
    assert.equal(fx.journal.createPlanned(planned(4)).executionGeneration, 1);
  } finally { fx.cleanup(); }
});

test('run ids and sandbox ids are never reused, even after DESTROYED', () => {
  const fx = freshJournal();
  try {
    const a = fx.journal.createPlanned(planned(1));
    const c = fx.journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') });
    fx.journal.transition(runId(1), c.revision, 'DESTROYED');
    assert.throws(() => fx.journal.createPlanned(planned(1)), code('DUPLICATE_RUN'));
    assert.throws(() => fx.journal.createPlanned({ ...planned(5), sandboxId: runId(1) }), code('DUPLICATE_SANDBOX'));
  } finally { fx.cleanup(); }
});

test('start authorization: only a CREATED record whose container id is already durable can be authorized, exactly once', () => {
  const fx = freshJournal();
  try {
    const a = fx.journal.createPlanned(planned(1));
    assert.throws(() => fx.journal.authorizeStart(runId(1), a.revision), icode('ILLEGAL_TRANSITION'), 'PLANNED has no container id: no start');
    assert.throws(() => fx.journal.transition(runId(1), a.revision, 'START_AUTHORIZED'), code('ILLEGAL_TRANSITION'));
    const c = fx.journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') });
    assert.throws(() => fx.journal.transition(runId(1), c.revision, 'START_AUTHORIZED'), code('ILLEGAL_TRANSITION'), 'only authorizeStart() may write START_AUTHORIZED');
    const auth = fx.journal.authorizeStart(runId(1), c.revision);
    assert.ok(Object.isFrozen(auth));
    assert.equal(auth.containerId, cid('c'));
    // the permission is durable BEFORE it is returned
    assert.equal(readRecordFile(fx.root, runId(1)).stage, 'START_AUTHORIZED');
    assert.equal(fx.journal.assertStartAuthorized(auth).stage, 'START_AUTHORIZED');
    // double execution contract: a second authorization of the same run is impossible
    assert.throws(() => fx.journal.authorizeStart(runId(1), c.revision), code('STALE_REVISION'));
    assert.throws(() => fx.journal.authorizeStart(runId(1), auth.revision), icode('ILLEGAL_TRANSITION'));
    assert.throws(() => fx.journal.authorizeStart(runId(1), 99), code('STALE_REVISION'));
  } finally { fx.cleanup(); }
});

test('an authorization is invalid once the record moved on, is forged, or belongs to another journal', () => {
  const fx = freshJournal(); const other = freshJournal();
  try {
    const a = fx.journal.createPlanned(planned(1));
    const c = fx.journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') });
    const auth = fx.journal.authorizeStart(runId(1), c.revision);
    for (const forged of [null, undefined, {}, { ...auth, revision: auth.revision + 1 }, { ...auth, containerId: cid('d') }, { ...auth, epoch: auth.epoch + 1 }, { ...auth, sandboxId: runId(7) }, { ...auth, taskId: taskId(7) }, { ...auth, stateRootId: '0'.repeat(32) }, { ...auth, runId: 'nope' }, { ...auth, runId: runId(8) }]) {
      assert.throws(() => fx.journal.assertStartAuthorized(forged), (e) => e instanceof JournalError, JSON.stringify(forged));
    }
    assert.throws(() => other.journal.assertStartAuthorized(auth), (e) => e instanceof JournalError);
    fx.journal.transition(runId(1), auth.revision, 'STOPPING');
    assert.throws(() => fx.journal.assertStartAuthorized(auth), code('START_NOT_AUTHORIZED'), 'a stop/cancel after authorization revokes it');
  } finally { fx.cleanup(); other.cleanup(); }
});

test('restart: an authorization from the previous process epoch is dead and the journal never silently re-arms a launch', () => {
  const dir = tempRoot();
  try {
    const first = openJournal(dir.root);
    const a = first.createPlanned(planned(1));
    const c = first.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') });
    const auth = first.authorizeStart(runId(1), c.revision);
    first.close();
    const second = openJournal(dir.root);
    assert.equal(second.epoch, first.epoch + 1);
    assert.equal(second.stateRootId, first.stateRootId);
    assert.throws(() => second.assertStartAuthorized(auth), code('START_NOT_AUTHORIZED'));
    assert.equal(second.get(runId(1)).stage, 'START_AUTHORIZED', 'the interrupted state is preserved verbatim for recovery to classify');
    assert.throws(() => second.authorizeStart(runId(1), auth.revision), icode('ILLEGAL_TRANSITION'));
    second.close();
  } finally { dir.cleanup(); }
});

test('crash after journal write but before start: the CREATED record survives and is not auto-started', () => {
  const dir = tempRoot();
  try {
    const first = openJournal(dir.root);
    const a = first.createPlanned(planned(1));
    first.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') });
    // crash: the process dies without close()/unlock
    const second = openJournal(dir.root, { isProcessAlive: () => false, pid: 4242 });
    assert.equal(second.get(runId(1)).stage, 'CREATED');
    assert.equal(second.get(runId(1)).containerId, cid('c'));
    second.close();
  } finally { dir.cleanup(); }
});

test('after close() the journal refuses every operation', () => {
  const fx = freshJournal();
  try {
    fx.journal.createPlanned(planned(1));
    fx.journal.close();
    fx.journal.close();
    for (const op of [() => fx.journal.get(runId(1)), () => fx.journal.scan(), () => fx.journal.createPlanned(planned(2)), () => fx.journal.transition(runId(1), 1, 'UNKNOWN'), () => fx.journal.authorizeStart(runId(1), 1)]) {
      assert.throws(op, code('JOURNAL_NOT_OWNER'));
    }
  } finally { fx.cleanup(); }
});

test('run ids that are not server-shaped are refused before any path is built', () => {
  const fx = freshJournal();
  try {
    for (const id of ['../meta', '../../etc/passwd', 'RUN-20260101-00000001/../../x', 'RUN-20260101-0000000g', '', null, undefined, 5, {}, 'RUN-20260101-00000001.json', 'RUN-20260101-00000001\0']) {
      assert.throws(() => fx.journal.get(id), code('INVALID_ID'), String(id));
      assert.throws(() => fx.journal.transition(id, 1, 'UNKNOWN'), code('INVALID_ID'), String(id));
    }
  } finally { fx.cleanup(); }
});

test('identity input is validated even when the object has a hostile prototype or odd shape', () => {
  assert.throws(() => buildPlannedRecord(Object.create({ taskId: taskId(1) }), { stateRootId: 'f'.repeat(32), writerEpoch: 1, executionGeneration: 1, now: '2026-01-01T00:00:00.000Z' }), icode('INVALID_INPUT'));
  assert.throws(() => buildPlannedRecord({ ...planned(1), role: 'verifier', imageDigest: DIGEST.toUpperCase() }, { stateRootId: 'f'.repeat(32), writerEpoch: 1, executionGeneration: 1, now: '2026-01-01T00:00:00.000Z' }), icode('INVALID_INPUT'));
  assert.equal(buildPlannedRecord({ ...planned(1), role: 'verifier' }, { stateRootId: 'f'.repeat(32), writerEpoch: 1, executionGeneration: 1, now: '2026-01-01T00:00:00.000Z' }).containerName, 'cc-sandbox-verifier-run-20260101-00000001');
});

test('drift guard: the identity layer mirrors the sandbox policy naming, id pattern and ownership labels', async () => {
  const policy = await import('../server/sandbox/sandboxPolicy.mjs');
  const identity = await import('../server/execution/identity/executionIdentity.mjs');
  assert.equal(identity.SANDBOX_ID.source, policy.SANDBOX_ID.source);
  assert.equal(identity.SANDBOX_ID.flags, policy.SANDBOX_ID.flags);
  for (const role of identity.IDENTITY_ROLES) {
    assert.ok(policy.SANDBOX_ROLES.includes(role));
    for (const id of [runId(1), 'ABCDEF-123456', 'a1b2c3']) assert.equal(identity.sandboxName(role, id), policy.sandboxName(role, id));
    const source = fs.readFileSync(new URL('../server/sandbox/sandboxPolicy.mjs', import.meta.url), 'utf8');
    for (const template of ['--label=cc.sandbox=1', '--label=cc.sandbox.id=${sandboxId}', '--label=cc.sandbox.role=${role}']) assert.ok(source.includes(template), template);
    assert.deepEqual(identity.expectedLabels(runId(1), role), { 'cc.sandbox': '1', 'cc.sandbox.id': runId(1), 'cc.sandbox.role': role });
  }
});

test('the class API exposes no Docker, start, stop, remove or adoption operation', () => {
  const methods = Object.getOwnPropertyNames(ExecutionIdentityJournal.prototype).filter((n) => n !== 'constructor').sort();
  assert.deepEqual(methods, ['assertStartAuthorized', 'authorizeStart', 'close', 'createPlanned', 'epoch', 'get', 'scan', 'stateRootId', 'transition']);
});
