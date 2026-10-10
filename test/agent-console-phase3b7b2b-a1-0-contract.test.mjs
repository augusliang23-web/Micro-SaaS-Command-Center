import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import fs from 'node:fs';

import {
  PENDING_ACTIONS, PENDING_AUTHENTICITY, PENDING_STATUSES, RECORD_KEYS, STEP_STATES, PendingActionError, applyStatusChange, applyStepAdvance,
  assessExecutionIdentity, buildInitialRecord, isExpired, validatePendingChain, validatePendingRecord,
} from '../server/execution/continuation/pendingActionTypes.mjs';
import { APPROVAL_AUTHENTICITY } from '../server/execution/approvalGate.mjs';
import { NOT_JOURNALED, digest, evidenceId, h, manifestOf, pendingInput, runId, taskId } from './helpers/pendingFixture.mjs';
import { guarded } from './helpers/pendingFixture.mjs';
const test = guarded(nodeTest);

// OFFLINE ONLY. The pending-action data contract: strict validation, pure transitions, history chains, identity assessment.

const NOW = '2026-01-01T00:00:00.000Z';
const base = (over = {}) => buildInitialRecord(pendingInput(1, over), { pendingId: `PND-${'1'.repeat(32)}`, now: NOW });
const code = (c) => (e) => e instanceof PendingActionError && e.code === c;
const bad = (record, label) => assert.notDeepEqual(validatePendingRecord(record), [], label);

test('a freshly built record is valid, OPEN, all steps PENDING, expectedHead = baseSha, never an authorization', () => {
  const r = base();
  assert.deepEqual(validatePendingRecord(r), []);
  assert.deepEqual(Object.keys(r).sort(), [...RECORD_KEYS].sort());
  assert.equal(r.status, 'OPEN'); assert.equal(r.revision, 1); assert.equal(r.action, 'COMMIT');
  assert.deepEqual(r.steps, { COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' });
  assert.equal(r.expectedHead, r.baseSha);
  assert.equal(r.authenticity, 'UNAUTHENTICATED_LOCAL_APPROVAL');
  assert.equal(Date.parse(r.expiresAt) - Date.parse(r.createdAt), 60 * 60 * 1000);
  // not an authorization token: nothing that could satisfy or name an approval
  for (const k of ['approvalId', 'approvedBy', 'approval', 'token', 'secret', 'permit', 'signature', 'command', 'argv', 'path', 'worktreePath', 'prompt', 'output', 'env']) assert.equal(Object.hasOwn(r, k), false, k);
});

test('the trust label equals the approval gate classification (drift guard)', () => {
  assert.equal(PENDING_AUTHENTICITY, APPROVAL_AUTHENTICITY);
});

test('create input: exactly the server-computed facts; id, steps, status, head and times cannot be supplied', () => {
  const ctx = { pendingId: `PND-${'1'.repeat(32)}`, now: NOW };
  for (const extra of [{ pendingId: `PND-${'2'.repeat(32)}` }, { revision: 5 }, { status: 'COMPLETED' }, { steps: { COMMIT: 'DONE' } }, { expectedHead: h('f') }, { action: 'CREATE_PR' }, { createdAt: NOW }, { expiresAt: NOW }, { worktreePath: '/etc' }, { command: 'rm -rf /' }, { approvedBy: { id: 'x', source: 'HUMAN_OPERATOR' } }, { prompt: 'do it' }]) {
    assert.throws(() => buildInitialRecord({ ...pendingInput(1), ...extra }, ctx), code('INVALID_INPUT'), Object.keys(extra)[0]);
  }
  for (const k of Object.keys(pendingInput(1))) { const i = pendingInput(1); delete i[k]; assert.throws(() => buildInitialRecord(i, ctx), code('INVALID_INPUT'), k); }
  assert.throws(() => buildInitialRecord(null, ctx), code('INVALID_INPUT'));
  assert.throws(() => buildInitialRecord([], ctx), code('INVALID_INPUT'));
  for (const ttlMs of [0, 999, -1, 1.5, '3600000', 24 * 3600 * 1000 + 1, NaN]) assert.throws(() => buildInitialRecord(pendingInput(1), { ...ctx, ttlMs }), code('INVALID_INPUT'), String(ttlMs));
  assert.throws(() => buildInitialRecord(pendingInput(1), { ...ctx, now: 'yesterday' }), code('INVALID_INPUT'));
  assert.deepEqual(validatePendingRecord(buildInitialRecord(pendingInput(1), { ...ctx, ttlMs: 24 * 3600 * 1000 })), []);
});

test('every scalar field is validated strictly', () => {
  const cases = {
    schemaVersion: [0, 2, '1', null], pendingId: ['PND-1', `pnd-${'1'.repeat(32)}`, `PND-${'G'.repeat(32)}`, '../x', null],
    revision: [0, -1, 1.5, '1', 33, null], taskId: ['CC-1', '../x', null, 5], projectId: ['', '-x', 'a/b', 'a b', 'x'.repeat(65), null],
    runId: ['RUN-1', 'x', null], branch: ['main', 'agent/CC-20260101-00000001', `agent/${taskId(2)}-fix`, 'agent/CC-20260101-00000001-Fix', `agent/${taskId(1)}-x/../y`, `agent/${taskId(1)}-${'a'.repeat(200)}`],
    baseSha: ['abc', 'A'.repeat(40), h('a', 39), h('a', 41), null], expectedHead: ['x', h('a', 64), null], treeSha: ['x', null, h('z')], diffDigest: ['x', h('a', 63), h('A', 64), null],
    authenticity: ['SIGNED', 'AUTHENTICATED', '', null], status: ['DONE', 'open', '', null],
    createdAt: ['2026-01-01', 'x', null, '2026-02-30T00:00:00.000Z'], updatedAt: ['x', null], expiresAt: ['x', null],
  };
  for (const [field, values] of Object.entries(cases)) for (const value of values) bad({ ...base(), [field]: value }, `${field}=${String(value).slice(0, 30)}`);
  bad({ ...base(), extra: 1 }, 'extra key'); bad(null, 'null'); bad([], 'array'); bad('x', 'string');
  const missing = base(); delete missing.manifest; bad(missing, 'missing key');
  bad(Object.assign(Object.create(null), base()), 'null prototype');
});

test('taskId is checked on its own: an id that merely PREFIXES a valid-looking branch is still not a task id', () => {
  const longId = `${taskId(1)}-extra`;
  const r = { ...base(), taskId: longId, branch: `agent/${longId}-fix` };
  assert.match(r.branch, /^agent\/CC-\d{8}-[0-9a-f]{8}-[a-z0-9-]+$/, 'the branch pattern alone would accept it');
  bad(r, 'taskId with a suffix');
});

test('timestamps: updatedAt may not precede createdAt; lifetime must be positive and at most 24 hours', () => {
  bad({ ...base(), updatedAt: '2025-12-31T23:59:59.999Z' }, 'updatedAt before createdAt');
  bad({ ...base(), expiresAt: NOW }, 'expires at creation');
  bad({ ...base(), expiresAt: '2025-12-31T00:00:00.000Z' }, 'expired before created');
  bad({ ...base(), expiresAt: '2026-01-02T00:00:00.001Z' }, 'over 24h');
  assert.equal(isExpired(base(), '2026-01-01T00:59:59.999Z'), false);
  assert.equal(isExpired(base(), '2026-01-01T01:00:00.000Z'), true);
});

test('manifest: bounded, safe relative paths, exact entry shapes, and the digest must match', () => {
  const ok = pendingInput(1);
  const withFiles = (files) => { let diffDigest = ok.diffDigest; try { diffDigest = manifestDigest(files); } catch { /* the digest itself refuses it */ } return { manifest: { files }, diffDigest }; };
  const file = (over = {}) => ({ path: 'a.txt', sha256: digest('x'), size: 1, exec: false, ...over });
  for (const [label, files] of Object.entries({
    empty: [], 'too many': Array.from({ length: 201 }, (_, i) => file({ path: `f${i}.txt` })), 'duplicate path': [file(), file()],
    absolute: [file({ path: '/etc/passwd' })], dotdot: [file({ path: '../x' })], 'dot segment': [file({ path: 'a/./b' })], 'empty segment': [file({ path: 'a//b' })],
    '.git': [file({ path: '.git/config' })], nested: [file({ path: 'x/.GIT/hooks/pre-commit' })], backslash: [file({ path: 'a\\b' })], nul: [file({ path: 'a\0b' })],
    'long path': [file({ path: 'a'.repeat(513) })], 'bad sha': [file({ sha256: 'x' })], 'negative size': [file({ size: -1 })], 'huge size': [file({ size: 2 * 1024 * 1024 })],
    'exec not boolean': [file({ exec: 1 })], 'extra file key': [file({ blob: h('a') })], 'deleted with content': [{ path: 'a', deleted: true, sha256: digest('x') }], 'deleted false': [{ path: 'a', deleted: false }],
  })) {
    bad({ ...base(), ...withFiles(files) }, label);
  }
  bad({ ...base(), manifest: { files: [file()], extra: 1 }, diffDigest: manifestDigest([file()]) }, 'manifest extra key');
  bad({ ...base(), manifest: { files: 'x' } }, 'files not array');
  assert.deepEqual(validatePendingRecord({ ...base(), ...withFiles([file()]) }), [], 'the helper builds a VALID record, so every case above fails only for its own reason');
  assert.deepEqual(validatePendingRecord({ ...base(), ...withFiles([file({ size: 1024 * 1024 })]) }), [], 'exactly the per-file limit is allowed');
  bad({ ...base(), manifest: [] }, 'manifest not object');
  // consistent digest of another manifest is still a valid, different record; a stale digest is not
  const other = manifestOf(2);
  bad({ ...base(), manifest: other.manifest }, 'digest of a different manifest');
  assert.deepEqual(validatePendingRecord({ ...base(), manifest: other.manifest, diffDigest: other.diffDigest }), []);
  assert.deepEqual(validatePendingRecord({ ...base(), ...(() => { const files = [{ path: 'gone.txt', deleted: true }]; return { manifest: { files }, diffDigest: manifestDigest(files) }; })() }), [], 'a deleted path is a legal entry');
});
import { diffDigestOf as manifestDigest } from '../server/execution/approvalGate.mjs';

test('verification reference: required, passing command_result evidence graded LOCALLY_VERIFIED or higher', () => {
  const v = (over) => ({ evidenceId: evidenceId(), kind: 'command_result', grade: 'LOCALLY_VERIFIED', passed: true, ...over });
  for (const [label, verification] of Object.entries({
    missing: undefined, null: null, 'evidence id': v({ evidenceId: 'EV-1' }), 'evidence id caps': v({ evidenceId: `EV-${'E'.repeat(32)}` }), 'wrong kind': v({ kind: 'agent_report' }),
    'agent claim grade': v({ grade: 'AGENT_CLAIM' }), 'observed only': v({ grade: 'RUNTIME_OBSERVED' }), 'unknown grade': v({ grade: 'UNKNOWN' }), 'made up grade': v({ grade: 'TRUSTED' }),
    'not passed': v({ passed: false }), 'passed string': v({ passed: 'true' }), 'extra field': v({ message: 'tests passed' }),
  })) bad({ ...base(), verification }, label);
  const dropped = base(); delete dropped.verification; bad(dropped, 'key deleted');
  for (const grade of ['LOCALLY_VERIFIED', 'GITHUB_VERIFIED', 'EXTERNAL_AUTHORITATIVE']) assert.deepEqual(validatePendingRecord({ ...base(), verification: v({ grade }) }), [], grade);
});

test('guard snapshot: a source HEAD and five SHA-256 digests only (no free text)', () => {
  const g = pendingInput(1).guardSnapshot;
  for (const k of Object.keys(g)) { for (const value of ['x', null, 5, g[k].toUpperCase(), `${g[k]}0`]) bad({ ...base(), guardSnapshot: { ...g, [k]: value } }, `${k}=${String(value).slice(0, 12)}`); const m = { ...g }; delete m[k]; bad({ ...base(), guardSnapshot: m }, `missing ${k}`); }
  bad({ ...base(), guardSnapshot: { ...g, remote: 'git@github.com:x/y.git' } }, 'extra key');
  bad({ ...base(), guardSnapshot: null }, 'null');
});

test('execution identity: NOT_JOURNALED carries no references; JOURNALED must name this very run', () => {
  assert.deepEqual(validatePendingRecord(base()), []);
  const journaled = { state: 'JOURNALED', stateRootId: 'a'.repeat(32), executionGeneration: 1, runId: runId(1) };
  assert.deepEqual(validatePendingRecord(base({ executionIdentity: journaled })), []);
  for (const [label, executionIdentity] of Object.entries({
    'unknown state': { ...NOT_JOURNALED, state: 'VERIFIED' }, 'not journaled with root': { ...NOT_JOURNALED, stateRootId: 'a'.repeat(32) }, 'not journaled with generation': { ...NOT_JOURNALED, executionGeneration: 1 },
    'not journaled with run': { ...NOT_JOURNALED, runId: runId(1) }, 'journaled without root': { ...journaled, stateRootId: null }, 'journaled bad root': { ...journaled, stateRootId: 'zz' },
    'journaled no generation': { ...journaled, executionGeneration: null }, 'journaled generation 0': { ...journaled, executionGeneration: 0 },
    'journaled other run': { ...journaled, runId: runId(2) }, 'journaled null run': { ...journaled, runId: null }, 'extra key': { ...NOT_JOURNALED, verified: true }, 'missing key': { state: 'NOT_JOURNALED' },
    'a verified flag': { ...journaled, verified: true }, string: 'NOT_JOURNALED', null: null,
  })) bad({ ...base(), executionIdentity }, label);
});

test('NOT_JOURNALED never grants trust; JOURNALED is trusted only when the journal agrees and every execution of the task is DESTROYED', () => {
  const nj = base();
  assert.deepEqual(assessExecutionIdentity(nj, []), { proven: false, reason: 'NOT_JOURNALED_NO_PROVEN_IDENTITY' });
  // not even a perfectly matching, DESTROYED journal record upgrades a NOT_JOURNALED identity
  const matching = [{ taskId: taskId(1), runId: runId(1), stateRootId: 'a'.repeat(32), executionGeneration: 1, stage: 'DESTROYED' }];
  assert.equal(assessExecutionIdentity(nj, matching).proven, false);
  assert.equal(assessExecutionIdentity(nj, null).proven, false);
  const id = { state: 'JOURNALED', stateRootId: 'a'.repeat(32), executionGeneration: 1, runId: runId(1) };
  const j = base({ executionIdentity: id });
  assert.deepEqual(assessExecutionIdentity(j, matching), { proven: true, reason: 'JOURNAL_RECORD_CONSISTENT' });
  assert.equal(assessExecutionIdentity(j, null).reason, 'JOURNAL_UNAVAILABLE');
  assert.equal(assessExecutionIdentity(j, []).reason, 'JOURNAL_RECORD_NOT_FOUND');
  for (const [label, rec] of Object.entries({ 'other root': { stateRootId: 'b'.repeat(32) }, 'other generation': { executionGeneration: 2 }, 'other run': { runId: runId(2) }, 'other task': { taskId: taskId(2) } })) {
    assert.equal(assessExecutionIdentity(j, [{ ...matching[0], ...rec }]).proven, false, label);
  }
  for (const stage of ['PLANNED', 'CREATED', 'START_AUTHORIZED', 'RUNNING', 'STOPPING', 'STOPPED', 'UNKNOWN']) assert.equal(assessExecutionIdentity(j, [{ ...matching[0], stage }]).proven, false, stage);
  assert.equal(assessExecutionIdentity(j, [...matching, { ...matching[0], runId: runId(9), executionGeneration: 2, stage: 'UNKNOWN' }]).reason, 'UNSETTLED_EXECUTION_FOR_TASK');
  for (const garbage of [null, undefined, 5, 'x', {}, { executionIdentity: null }]) assert.equal(assessExecutionIdentity(garbage, matching).proven, false);
});

test('steps: ordered, at most one in flight, no skipping; action is the first step not DONE; COMPLETED iff all DONE', () => {
  const s = (steps, over = {}) => ({ ...base(), steps, ...over });
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'CLAIMED', CREATE_PR: 'PENDING' }, { action: 'PUSH_BRANCH' }), 'push ahead of commit');
  bad(s({ COMMIT: 'DONE', PUSH_BRANCH: 'PENDING', CREATE_PR: 'CONSUMED' }, { action: 'PUSH_BRANCH', expectedHead: h('d') }), 'pr ahead of push');
  bad(s({ COMMIT: 'CLAIMED', PUSH_BRANCH: 'CLAIMED', CREATE_PR: 'PENDING' }), 'two in flight');
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'DONE' }, { action: 'COMMIT' }), 'last step done first');
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { action: 'PUSH_BRANCH' }), 'action does not match');
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { action: null }), 'null action while steps remain');
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { action: 'MERGE' }), 'unknown action');
  bad(s({ COMMIT: 'DONE', PUSH_BRANCH: 'DONE', CREATE_PR: 'DONE' }, { action: 'CREATE_PR', status: 'COMPLETED', expectedHead: h('d') }), 'done but action set');
  bad(s({ COMMIT: 'DONE', PUSH_BRANCH: 'DONE', CREATE_PR: 'DONE' }, { action: null, status: 'OPEN', expectedHead: h('d') }), 'all done but still OPEN');
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { status: 'COMPLETED' }), 'COMPLETED with steps remaining');
  bad(s({ COMMIT: 'EXECUTED', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }), 'unknown state');
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING' }), 'missing step');
  bad(s({ COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING', MERGE: 'PENDING' }), 'extra step');
  bad(s(null), 'null steps');
  bad(s({ COMMIT: 'CLAIMED', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { status: 'REVOKED' }), 'revoked while claimed');
  bad(s({ COMMIT: 'CONSUMED', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { status: 'SUPERSEDED' }), 'superseded while consumed');
  assert.deepEqual(validatePendingRecord(s({ COMMIT: 'CLAIMED', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { status: 'INTERRUPTED' })), [], 'an in-flight step may be INTERRUPTED');
  assert.deepEqual(validatePendingRecord(s({ COMMIT: 'DONE', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, { action: 'PUSH_BRANCH', expectedHead: h('d'), status: 'REVOKED' })), [], 'between steps a revoke is legal');
});

test('expectedHead: the base until COMMIT is DONE, a different commit afterwards', () => {
  const afterCommit = { ...base(), steps: { COMMIT: 'DONE', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, action: 'PUSH_BRANCH' };
  bad(afterCommit, 'still the base after the commit');
  assert.deepEqual(validatePendingRecord({ ...afterCommit, expectedHead: h('d') }), []);
  bad({ ...base(), expectedHead: h('d') }, 'moved before the commit');
});

test('step advance: one state at a time, current action only, OPEN only, commit id required exactly at COMMIT DONE', () => {
  let r = base();
  const adv = (rec, step, now = NOW) => applyStepAdvance(rec, step, now);
  assert.throws(() => adv(r, { action: 'PUSH_BRANCH', to: 'CLAIMED' }), code('ACTION_ORDER'));
  assert.throws(() => adv(r, { action: 'CREATE_PR', to: 'CLAIMED' }), code('ACTION_ORDER'));
  assert.throws(() => adv(r, { action: 'COMMIT', to: 'CONSUMED' }), code('STEP_TRANSITION'));
  assert.throws(() => adv(r, { action: 'COMMIT', to: 'DONE' }), code('STEP_TRANSITION'));
  assert.throws(() => adv(r, { action: 'COMMIT', to: 'PENDING' }), code('STEP_TRANSITION'));
  assert.throws(() => adv(r, { action: 'MERGE', to: 'CLAIMED' }), code('INVALID_INPUT'));
  assert.throws(() => adv(r, { action: 'COMMIT', to: 'EXECUTED' }), code('INVALID_INPUT'));
  assert.throws(() => adv(r, { action: 'COMMIT', to: 'CLAIMED', commitSha: h('d') }), code('INVALID_INPUT'));
  r = adv(r, { action: 'COMMIT', to: 'CLAIMED' }, '2026-01-01T00:00:01.000Z');
  assert.equal(r.revision, 2); assert.equal(r.steps.COMMIT, 'CLAIMED'); assert.equal(r.action, 'COMMIT');
  assert.throws(() => adv(r, { action: 'COMMIT', to: 'CLAIMED' }), code('STEP_TRANSITION'), 'no replay of the same state');
  r = adv(r, { action: 'COMMIT', to: 'CONSUMED' }, '2026-01-01T00:00:02.000Z');
  for (const commitSha of [undefined, 'x', h('a'), h('D', 40), 5]) assert.throws(() => adv(r, { action: 'COMMIT', to: 'DONE', commitSha }), code('INVALID_INPUT'), String(commitSha));
  r = adv(r, { action: 'COMMIT', to: 'DONE', commitSha: h('d') }, '2026-01-01T00:00:03.000Z');
  assert.equal(r.expectedHead, h('d')); assert.equal(r.action, 'PUSH_BRANCH'); assert.equal(r.status, 'OPEN');
  for (const to of ['CLAIMED', 'CONSUMED', 'DONE']) r = adv(r, { action: 'PUSH_BRANCH', to }, '2026-01-01T00:00:04.000Z');
  assert.equal(r.action, 'CREATE_PR');
  for (const to of ['CLAIMED', 'CONSUMED', 'DONE']) r = adv(r, { action: 'CREATE_PR', to }, '2026-01-01T00:00:05.000Z');
  assert.equal(r.action, null); assert.equal(r.status, 'COMPLETED'); assert.equal(r.revision, 10);
  assert.deepEqual(validatePendingRecord(r), []);
  assert.throws(() => adv(r, { action: 'COMMIT', to: 'CLAIMED' }), code('NOT_OPEN'));
});

test('a transition never launders an inconsistent input record', () => {
  const sloppy = { ...base(), steps: { COMMIT: 'PENDING', PUSH_BRANCH: 'CLAIMED', CREATE_PR: 'PENDING' } };
  assert.notDeepEqual(validatePendingRecord(sloppy), []);
  assert.throws(() => applyStepAdvance(sloppy, { action: 'COMMIT', to: 'CLAIMED' }, NOW), code('INVALID_TRANSITION'));
  assert.throws(() => applyStatusChange({ ...sloppy, status: 'OPEN' }, 'REVOKED', NOW), code('INVALID_TRANSITION'));
});

test('step advance: closed or expired records refuse; time never moves backwards', () => {
  const r = base();
  for (const to of ['REVOKED', 'SUPERSEDED', 'INTERRUPTED']) assert.throws(() => applyStepAdvance(applyStatusChange(r, to, NOW), { action: 'COMMIT', to: 'CLAIMED' }, NOW), code('NOT_OPEN'), to);
  assert.throws(() => applyStepAdvance(r, { action: 'COMMIT', to: 'CLAIMED' }, '2026-01-01T01:00:00.000Z'), code('EXPIRED'));
  assert.equal(applyStepAdvance(r, { action: 'COMMIT', to: 'CLAIMED' }, '2026-01-01T00:59:59.999Z').revision, 2);
  assert.equal(applyStepAdvance(r, { action: 'COMMIT', to: 'CLAIMED' }, '2025-01-01T00:00:00.000Z').updatedAt, r.updatedAt, 'a clock that went backwards cannot make updatedAt precede createdAt');
});

test('status changes: OPEN -> REVOKED | SUPERSEDED | INTERRUPTED only; COMPLETED cannot be set; terminal statuses stay terminal', () => {
  const r = base();
  for (const to of ['REVOKED', 'SUPERSEDED', 'INTERRUPTED']) {
    const next = applyStatusChange(r, to, NOW);
    assert.equal(next.status, to); assert.equal(next.revision, 2);
    for (const again of PENDING_STATUSES) assert.throws(() => applyStatusChange(next, again, NOW), (e) => e instanceof PendingActionError, `${to} -> ${again}`);
  }
  for (const to of ['COMPLETED', 'OPEN', 'DONE', '', null, undefined]) assert.throws(() => applyStatusChange(r, to, NOW), code('STATUS_TRANSITION'), String(to));
  const claimed = applyStepAdvance(r, { action: 'COMMIT', to: 'CLAIMED' }, NOW);
  assert.throws(() => applyStatusChange(claimed, 'REVOKED', NOW), code('INVALID_TRANSITION'), 'too late: a step is in flight');
  assert.throws(() => applyStatusChange(claimed, 'SUPERSEDED', NOW), code('INVALID_TRANSITION'));
  assert.equal(applyStatusChange(claimed, 'INTERRUPTED', NOW).status, 'INTERRUPTED');
});

test('history chains: contiguous, immutable facts, single legal moves; any splice, rollback or edit is detected', () => {
  const r1 = base();
  const r2 = applyStepAdvance(r1, { action: 'COMMIT', to: 'CLAIMED' }, '2026-01-01T00:00:01.000Z');
  const r3 = applyStepAdvance(r2, { action: 'COMMIT', to: 'CONSUMED' }, '2026-01-01T00:00:02.000Z');
  assert.deepEqual(validatePendingChain([r1, r2, r3]), []);
  const broken = (chain, label) => assert.notDeepEqual(validatePendingChain(chain), [], label);
  broken([], 'empty'); broken(null, 'null'); broken([r2], 'does not start at revision 1'); broken([r1, r3], 'gap');
  broken([r1, r1], 'replayed revision'); broken([r1, r2, r2], 'duplicate revision'); broken([r1, r3, r2], 'out of order');
  broken([r1, { ...r2, treeSha: h('9') }], 'immutable treeSha changed'); broken([r1, { ...r2, branch: `agent/${taskId(1)}-other` }], 'immutable branch changed');
  broken([r1, { ...r2, manifest: manifestOf(2).manifest, diffDigest: manifestOf(2).diffDigest }], 'manifest swapped consistently');
  broken([r1, { ...r2, expiresAt: '2026-01-01T05:00:00.000Z' }], 'lifetime extended'); broken([r1, { ...r2, executionIdentity: { state: 'JOURNALED', stateRootId: 'a'.repeat(32), executionGeneration: 1, runId: runId(1) } }], 'identity upgraded to JOURNALED');
  broken([r1, { ...r2, verification: { ...r2.verification, evidenceId: evidenceId('9') } }], 'verification reference swapped');
  broken([r1, { ...r2, steps: { COMMIT: 'CONSUMED', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' } }], 'step skipped');
  broken([r1, { ...r2, steps: { COMMIT: 'DONE', PUSH_BRANCH: 'DONE', CREATE_PR: 'PENDING' }, action: 'CREATE_PR', expectedHead: h('d') }], 'two steps at once');
  broken([r1, { ...r2, revision: 2, steps: r1.steps }], 'a revision that changes nothing');
  broken([r1, r2, { ...r3, steps: r1.steps, action: 'COMMIT' }], 'rollback of a step');
  broken([r1, { ...r2, updatedAt: '2025-01-01T00:00:00.000Z' }], 'time moves backwards');
  broken([{ ...r1, revision: 1, status: 'REVOKED' }], 'revision 1 not OPEN');
  broken([{ ...r1, steps: r2.steps, action: 'COMMIT' }], 'revision 1 with progress');
  broken([r1, { ...r2, status: 'REVOKED' }], 'a step change disguised as a status change');
  broken([r1, { ...applyStatusChange(r1, 'REVOKED', NOW), steps: { COMMIT: 'CLAIMED', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' } }], 'status and step changed together');
  broken([r1, { ...r1, revision: 2, updatedAt: NOW }], 'identical content under a new revision');
  broken([{ ...r1, revision: 2 }], 'a history that starts at revision 2');
  // after the commit, the expected head is part of the record's identity: it may not drift in a later revision
  const c3 = r3; let c4 = applyStepAdvance(c3, { action: 'COMMIT', to: 'DONE', commitSha: h('d') }, '2026-01-01T00:00:03.000Z');
  const c5 = applyStepAdvance(c4, { action: 'PUSH_BRANCH', to: 'CLAIMED' }, '2026-01-01T00:00:04.000Z');
  assert.deepEqual(validatePendingChain([r1, r2, r3, c4, c5]), []);
  broken([r1, r2, r3, c4, { ...c5, expectedHead: h('e') }], 'expectedHead drifts after the commit');
  broken([r1, r2, r3, c4, { ...applyStatusChange(c4, 'REVOKED', '2026-01-01T00:00:04.000Z'), expectedHead: h('e') }], 'expectedHead drifts in a status change');
  broken([r1, r2, r3, { ...c4, expectedHead: h('a') }], 'COMMIT DONE that keeps the base as head');
});

test('the contract has no authorization surface: no resume, approve, consume, grant, push or execute API', async () => {
  const types = await import('../server/execution/continuation/pendingActionTypes.mjs');
  const store = await import('../server/execution/continuation/pendingActionStore.mjs');
  const names = [...Object.keys(types), ...Object.getOwnPropertyNames(store.PendingActionStore.prototype)];
  assert.deepEqual(names.filter((n) => /resume|approve|authori[sz]e|consume|grant|execute|push|commit(?!Sha)|publish|run|start|cancel|spawn|exec/i.test(n) && !['PENDING_ACTIONS', 'applyStepAdvance', 'assessExecutionIdentity'].includes(n)), []);
  assert.deepEqual(Object.getOwnPropertyNames(store.PendingActionStore.prototype).filter((n) => n !== 'constructor').sort(), ['advanceStep', 'create', 'get', 'getByTask', 'history', 'list', 'setStatus']);
});

test('the pending modules use no process, network, Docker, Git, environment or credential API', () => {
  const read = (f) => fs.readFileSync(new URL(`../server/execution/continuation/${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const code2 = read('pendingActionStore.mjs') + read('pendingActionTypes.mjs');
  for (const re of [/child_process/, /node:(net|http|https|dgram|dns|tls|worker_threads|cluster)/, /\bfetch\(/, /process\.env/, /docker/i, /simple-git|['"]git['"]/, /sandbox/i, /keychain/i, /\.ssh|\.aws|\.npmrc|credential/i, /\beval\(|new Function/, /spawn|execFile|execSync/]) assert.doesNotMatch(code2, re, String(re));
  assert.ok(PENDING_ACTIONS.length === 3 && STEP_STATES.length === 4);
});
