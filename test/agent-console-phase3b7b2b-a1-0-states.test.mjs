import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TaskStore } from '../server/tasks/taskStore.mjs';
import { TASK_TRANSITIONS, assertTaskTransition } from '../server/tasks/stateTransitions.mjs';
import { ACTIVE_TASK_STATUSES, EVIDENCE_KINDS, TASK_STATUSES, validateDevelopmentTask } from '../server/tasks/types.mjs';

// OFFLINE ONLY. The AWAITING_APPROVAL / PUBLISHING task states: the transition table, restart recovery, the completion guard,
// and static proof that no resume, route, approval consumption or execution capability was added.

const taskId = 'CC-20261003-12345678';
const draft = (id = taskId) => ({ taskId: id, projectId: 'demo', workstream: 'general', title: 'Fix', goal: 'Fixture', agent: 'codex', executionProfile: 'STANDARD', risk: 'LOW', allowedActions: ['READ_REPO'], baseBranch: 'main', baseSha: null, status: 'DRAFT', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', runIds: [], review: { decision: 'PENDING', decidedAt: null, note: null } });
const scratch = (fn) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-a10-states-')); try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
const drive = (store, id, to) => { for (const status of to) store.update(id, { status, ...(status === 'RUNNING' ? { baseSha: 'a'.repeat(40) } : {}) }); };
const file = (dir, id = taskId) => path.join(dir, `${id}.json`);

// ------------------------------------------------------------ the canonical table

test('the pre-existing transitions are exactly preserved (V1 default behaviour unchanged)', () => {
  const errors = ['BLOCKED', 'FAILED', 'CANCELLED', 'UNKNOWN'];
  const before = {
    DRAFT: ['QUEUED', 'BLOCKED', 'FAILED', 'CANCELLED'], QUEUED: ['STARTING', ...errors], STARTING: ['RUNNING', ...errors], RUNNING: ['VERIFYING', ...errors],
    COMPLETED: [], FAILED: [], BLOCKED: [], CANCELLED: [], UNKNOWN: [],
  };
  for (const [from, tos] of Object.entries(before)) assert.deepEqual([...TASK_TRANSITIONS[from]], tos, from);
  // VERIFYING keeps every old exit and gains only AWAITING_APPROVAL
  assert.deepEqual([...TASK_TRANSITIONS.VERIFYING].sort(), ['AWAITING_APPROVAL', 'BLOCKED', 'CANCELLED', 'COMPLETED', 'FAILED', 'UNKNOWN']);
  assert.doesNotThrow(() => assertTaskTransition('VERIFYING', 'COMPLETED'));
});

test('the new states and their exact exits', () => {
  assert.deepEqual([...TASK_TRANSITIONS.AWAITING_APPROVAL].sort(), ['BLOCKED', 'CANCELLED', 'PUBLISHING', 'UNKNOWN']);
  assert.deepEqual([...TASK_TRANSITIONS.PUBLISHING].sort(), ['AWAITING_APPROVAL', 'BLOCKED', 'COMPLETED', 'FAILED', 'UNKNOWN']);
  // the only way into PUBLISHING is out of AWAITING_APPROVAL; the only way into AWAITING_APPROVAL is VERIFYING or PUBLISHING
  assert.deepEqual(Object.entries(TASK_TRANSITIONS).filter(([, tos]) => tos.includes('PUBLISHING')).map(([f]) => f), ['AWAITING_APPROVAL']);
  assert.deepEqual(Object.entries(TASK_TRANSITIONS).filter(([, tos]) => tos.includes('AWAITING_APPROVAL')).map(([f]) => f).sort(), ['PUBLISHING', 'VERIFYING']);
  for (const [from, to] of [['DRAFT', 'AWAITING_APPROVAL'], ['RUNNING', 'AWAITING_APPROVAL'], ['QUEUED', 'PUBLISHING'], ['VERIFYING', 'PUBLISHING'], ['RUNNING', 'PUBLISHING'],
    ['AWAITING_APPROVAL', 'COMPLETED'], ['AWAITING_APPROVAL', 'FAILED'], ['AWAITING_APPROVAL', 'RUNNING'], ['AWAITING_APPROVAL', 'VERIFYING'], ['AWAITING_APPROVAL', 'DRAFT'],
    ['PUBLISHING', 'CANCELLED'], ['PUBLISHING', 'RUNNING'], ['PUBLISHING', 'VERIFYING'], ['PUBLISHING', 'DRAFT'],
    ['COMPLETED', 'AWAITING_APPROVAL'], ['FAILED', 'AWAITING_APPROVAL'], ['BLOCKED', 'AWAITING_APPROVAL'], ['CANCELLED', 'PUBLISHING'], ['UNKNOWN', 'AWAITING_APPROVAL'], ['UNKNOWN', 'PUBLISHING']]) {
    assert.throws(() => assertTaskTransition(from, to), /transition/, `${from} -> ${to}`);
  }
  for (const to of ['AWAITING_APPROVAL', 'PUBLISHING', 'COMPLETED']) assert.doesNotThrow(() => assertTaskTransition(to === 'COMPLETED' ? 'PUBLISHING' : to === 'PUBLISHING' ? 'AWAITING_APPROVAL' : 'VERIFYING', to));
});

test('terminal states stay terminal, there is no automatic approval state and no APPROVED status', () => {
  for (const s of ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'UNKNOWN']) assert.deepEqual([...TASK_TRANSITIONS[s]], [], s);
  assert.equal(TASK_STATUSES.includes('APPROVED'), false);
  assert.equal(TASK_STATUSES.some((s) => /APPROV(?!AL$)|RESUM|RETRY/.test(s)), false);
  assert.deepEqual([...TASK_STATUSES], ['DRAFT', 'QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL', 'PUBLISHING', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED', 'UNKNOWN']);
  assert.deepEqual(Object.keys(TASK_TRANSITIONS).sort(), [...TASK_STATUSES].sort(), 'every status has an explicit transition row');
});

test('AWAITING_APPROVAL is not active (survives a restart); PUBLISHING is active (becomes UNKNOWN)', () => {
  assert.deepEqual([...ACTIVE_TASK_STATUSES], ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'PUBLISHING']);
  assert.equal(ACTIVE_TASK_STATUSES.includes('AWAITING_APPROVAL'), false);
  for (const status of ['AWAITING_APPROVAL', 'PUBLISHING']) assert.deepEqual(validateDevelopmentTask({ ...draft(), status }), [], status);
  assert.notDeepEqual(validateDevelopmentTask({ ...draft(), status: 'APPROVED' }), []);
});

test('the evidence kind list is unchanged', () => {
  assert.equal(EVIDENCE_KINDS.length, 17);
  assert.deepEqual([...EVIDENCE_KINDS], ['worktree_created', 'branch_created', 'files_changed', 'command_result', 'commit', 'push', 'pr', 'guard_violation', 'agent_report', 'error',
    'sandbox_policy', 'sandbox_created', 'sandbox_started', 'sandbox_stopped', 'sandbox_destroyed', 'approval_required', 'approval_consumed']);
});

// ------------------------------------------------------------ persistence and restart

test('G1: AWAITING_APPROVAL persists across restarts, byte for byte, and never moves by itself', () => scratch((dir) => {
  const store = new TaskStore({ dir }); store.create(draft());
  drive(store, taskId, ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL']);
  const bytes = fs.readFileSync(file(dir));
  assert.equal(store.get(taskId).status, 'AWAITING_APPROVAL');
  for (let i = 0; i < 3; i += 1) {
    const reopened = new TaskStore({ dir });
    assert.deepEqual(reopened.recoveredTaskIds, [], 'not recovered, because nothing about it claims a live execution');
    assert.equal(reopened.get(taskId).status, 'AWAITING_APPROVAL');
    assert.deepEqual(fs.readFileSync(file(dir)), bytes, 'the file was not even rewritten');
  }
  assert.equal(new TaskStore({ dir }).list().tasks[0].status, 'AWAITING_APPROVAL');
}));

test('G2: PUBLISHING becomes UNKNOWN on restart, is never retried, and is terminal afterwards', () => scratch((dir) => {
  const store = new TaskStore({ dir }); store.create(draft());
  drive(store, taskId, ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL', 'PUBLISHING']);
  assert.equal(store.get(taskId).status, 'PUBLISHING');
  const reopened = new TaskStore({ dir });
  assert.deepEqual(reopened.recoveredTaskIds, [taskId]);
  const recovered = reopened.get(taskId);
  assert.equal(recovered.status, 'UNKNOWN');
  assert.equal(recovered.commitSha, undefined); assert.equal(recovered.pr, undefined); assert.equal(recovered.completedAt, undefined, 'no inferred completion');
  for (const to of ['COMPLETED', 'AWAITING_APPROVAL', 'PUBLISHING', 'QUEUED', 'DRAFT', 'FAILED']) assert.throws(() => reopened.update(taskId, { status: to }), /transition/, to);
  assert.deepEqual(new TaskStore({ dir }).recoveredTaskIds, [], 'recovery is idempotent');
}));

test('restart recovery of a mixed store: only the active states change', () => scratch((dir) => {
  const store = new TaskStore({ dir });
  const ids = ['CC-20261003-00000001', 'CC-20261003-00000002', 'CC-20261003-00000003', 'CC-20261003-00000004'];
  ids.forEach((id) => store.create(draft(id)));
  drive(store, ids[0], ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL']);
  drive(store, ids[1], ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL', 'PUBLISHING']);
  drive(store, ids[2], ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING']);
  const reopened = new TaskStore({ dir });
  assert.deepEqual(reopened.recoveredTaskIds.sort(), [ids[1], ids[2]]);
  assert.deepEqual(ids.map((id) => reopened.get(id).status), ['AWAITING_APPROVAL', 'UNKNOWN', 'UNKNOWN', 'DRAFT']);
}));

test('PUBLISHING can return to AWAITING_APPROVAL (a later step) and an unreadable task file does not block recovery of the others', () => scratch((dir) => {
  const store = new TaskStore({ dir }); store.create(draft());
  drive(store, taskId, ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL', 'PUBLISHING', 'AWAITING_APPROVAL']);
  assert.equal(store.get(taskId).status, 'AWAITING_APPROVAL');
  fs.writeFileSync(file(dir, 'CC-20261003-0000ffff'), '{broken', { mode: 0o600 });
  const reopened = new TaskStore({ dir });
  assert.equal(reopened.get(taskId).status, 'AWAITING_APPROVAL');
  assert.deepEqual(reopened.list().unreadable, ['CC-20261003-0000ffff.json']);
  assert.equal(fs.readFileSync(file(dir, 'CC-20261003-0000ffff'), 'utf8'), '{broken', 'never repaired');
}));

// ------------------------------------------------------------ the completion guard

test('PUBLISHING cannot be COMPLETED on a bare status change; it needs a commit and a verified PR record; the V1 VERIFYING -> COMPLETED path is untouched', () => scratch((dir) => {
  const store = new TaskStore({ dir }); store.create(draft());
  drive(store, taskId, ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL', 'PUBLISHING']);
  const before = fs.readFileSync(file(dir));
  const pr = { number: 1, url: 'fake://github/1', state: 'FAKE_OPEN', verifiedAt: '2026-10-03T00:00:01.000Z' };
  for (const patch of [{ status: 'COMPLETED' }, { status: 'COMPLETED', commitSha: 'b'.repeat(40) }, { status: 'COMPLETED', pr }, { status: 'COMPLETED', commitSha: 'b'.repeat(40), pr: { ...pr, verifiedAt: undefined } }]) {
    assert.throws(() => store.update(taskId, patch), (e) => e instanceof Error, JSON.stringify(Object.keys(patch)));
    assert.deepEqual(fs.readFileSync(file(dir)), before, 'a refused completion leaves the task bytes unchanged');
  }
  assert.equal(store.update(taskId, { status: 'COMPLETED', commitSha: 'b'.repeat(40), pr }).status, 'COMPLETED');
  // default V1 path, unchanged
  const other = 'CC-20261003-00000009';
  store.create(draft(other)); drive(store, other, ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING']);
  assert.equal(store.update(other, { status: 'COMPLETED', completedAt: '2026-10-03T00:00:02.000Z' }).status, 'COMPLETED');
}));

test('a refused or illegal update preserves the persisted bytes (new transitions included)', () => scratch((dir) => {
  const store = new TaskStore({ dir }); store.create(draft());
  drive(store, taskId, ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL']);
  const before = fs.readFileSync(file(dir));
  for (const patch of [{ status: 'COMPLETED' }, { status: 'RUNNING' }, { status: 'APPROVED' }, { status: 'DRAFT' }, { pending: 'PND-x' }, { approvalId: 'APR-0123456789abcdef' }, { cwd: '/etc' }]) {
    assert.throws(() => store.update(taskId, patch), (e) => e instanceof Error, JSON.stringify(patch));
    assert.deepEqual(fs.readFileSync(file(dir)), before);
  }
}));

// ------------------------------------------------------------ scope: nothing that can resume, route, approve or execute

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('G7-G9: no resume, no approval consumption, no new route and no new execution capability exist', () => {
  // The files this phase is not allowed to touch carry no reference to the new pending-action machinery.
  for (const f of ['server.ts', 'server/execution/orchestrator.mjs', 'server/execution/approvalGate.mjs', 'server/execution/worktreeManager.mjs', 'server/sandbox/dockerSandboxRuntime.mjs', 'server/execution/containerAgentAdapter.mjs', 'server/tasks/taskRoutes.mjs']) {
    assert.doesNotMatch(read(f), /continuation|pendingAction|PendingAction|AWAITING_APPROVAL|PUBLISHING/, f);
  }
  const routes = read('server/tasks/taskRoutes.mjs');
  assert.deepEqual([...routes.matchAll(/router\.(get|post|put|patch|delete)\('([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`), ['post /', 'get /', 'get /:taskId']);
  // Nothing outside the continuation modules and tests imports them.
  const importers = [];
  const walk = (dir) => { for (const e of fs.readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) { const rel = `${dir}/${e.name}`; if (e.isDirectory()) { if (!['node_modules', '.git', 'dist'].includes(e.name)) walk(rel); } else if (/\.(mjs|ts|tsx|js)$/.test(e.name) && /continuation\/pendingAction/.test(read(rel))) importers.push(rel); } };
  for (const d of ['server', 'src']) walk(d);
  for (const f of ['server.ts']) assert.equal(importers.includes(f), false);
  assert.deepEqual(importers.filter((f) => !f.startsWith('server/execution/continuation/')), [], 'no production code imports the pending-action modules yet');
  // the continuation modules do not call the approval store or the gate
  const mods = read('server/execution/continuation/pendingActionStore.mjs') + read('server/execution/continuation/pendingActionTypes.mjs');
  assert.doesNotMatch(mods.replace(/\/\/.*$/gm, ''), /ApprovalStore|ApprovalGate|\.authorize\(|\.require\(|\.grant\(|\.consumed/);
});
