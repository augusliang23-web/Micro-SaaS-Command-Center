import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { withFixture, git } from './helpers/phase2Fixture.mjs';
import { Orchestrator } from '../server/execution/orchestrator.mjs';
import { WorktreeManager } from '../server/execution/worktreeManager.mjs';
import { FakeAdapter } from '../server/execution/fakeAdapter.mjs';
import { FakePrProvider } from '../server/execution/fakePrProvider.mjs';
import { ContainerFakeAgentAdapter, REAL_AGENT_EXECUTION } from '../server/execution/containerAgentAdapter.mjs';
import { ApprovalGate, ApprovalStore, GATED_ACTIONS, diffDigestOf } from '../server/execution/approvalGate.mjs';
import { EffectDocker, FIXTURE_CONTENT, approvalSetup, branchOf, expectedFixtureDigest, makeRuntime, sha256 } from './helpers/dockerPathFixture.mjs';

const TASK_A = 'CC-20261003-12345678';
const TASK_B = 'CC-20261003-87654321';
const approver = { source: 'CONTROL_PLANE', id: 'control-plane-reviewer' };
const fixtureOf = (taskId) => `agent-console-fixture/${taskId}.txt`;
const writeFixture = (ws, taskId, content) => { fs.mkdirSync(path.join(ws, 'agent-console-fixture'), { recursive: true }); fs.writeFileSync(path.join(ws, fixtureOf(taskId)), content, { mode: 0o600 }); };

/** Builds the Docker-path engine over an in-memory fake Docker. No daemon, no network, no real agent. */
function dockerEngine(f, opts = {}) {
  const taskId = opts.taskId ?? TASK_A;
  const fake = opts.fake ?? new EffectDocker();
  if (!('effect' in opts) || opts.effect !== null) fake.effect = opts.effect ?? ((ws) => writeFixture(ws, taskId, opts.content ?? FIXTURE_CONTENT(taskId)));
  const rt = makeRuntime({ fake, ...(opts.homeDir ? { homeDir: opts.homeDir } : {}) });
  const approvals = approvalSetup();
  const base = new ContainerFakeAgentAdapter({ runtime: rt.runtime, ...(opts.adapterOptions ?? {}) });
  const adapter = opts.wrapAdapter ? opts.wrapAdapter(base) : base;
  const orchestrator = new Orchestrator({
    registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: opts.worktreeManager ?? new WorktreeManager({ allowLocalRemotes: true }),
    adapter, prProvider: new FakePrProvider(), publishGate: opts.noGate ? null : approvals.gate,
  });
  return { fake, rt, approvals, adapter: base, orchestrator, done: () => { rt.dispose(); approvals.done(); } };
}
async function withEngine(f, opts, fn) { const e = dockerEngine(f, opts); try { return await fn(e); } finally { e.done(); } }

const grant = (e, taskId, actions, extra = {}) => actions.map((action) => e.approvals.store.grant({
  taskId, action, diffDigest: extra.diffDigest ?? expectedFixtureDigest(taskId), baseSha: extra.baseSha, branch: extra.branch ?? branchOf(taskId), approvedBy: approver, ...(extra.ttlMs ? { ttlMs: extra.ttlMs } : {}),
}));
const remoteBranches = (f) => git(f.source, 'ls-remote', '--heads', 'origin').split('\n').filter((l) => l.includes('/agent/'));
const kinds = (f, id) => f.records.listEvidence(id).map((e) => e.kind);
const worktreeHead = (f, id) => git(path.join(f.worktreeRoot, id), 'rev-parse', 'HEAD');
const reasons = (f, id) => f.records.listEvidence(id).filter((e) => ['guard_violation', 'error', 'approval_required'].includes(e.kind)).map((e) => `${e.kind}:${e.data.reason ?? e.data.code ?? ''}`);

// ---------- Path separation: the Docker path is opt-in and fake-only ----------

test('docker path: constructing it needs a real ApprovalGate (not a store, a stub or a flag)', async () => withFixture(async (f) => {
  const store = approvalSetup();
  try {
    for (const bad of [store.store, {}, { require() {} }, true, 'gate', 1]) {
      assert.throws(() => new Orchestrator({ registry: f.registry, taskStore: f.store, executionStore: f.records, publishGate: bad }), /ApprovalGate/);
    }
    assert.doesNotThrow(() => new Orchestrator({ registry: f.registry, taskStore: f.store, executionStore: f.records, publishGate: store.gate }));
  } finally { store.done(); }
}));

test('docker path: only the fake container adapter is accepted; every other adapter is BLOCKED before start', async () => withFixture(async (f) => {
  for (const [label, adapter] of [['phase2 fake', new FakeAdapter()], ['claude-code', { id: 'claude-code', probe: async () => ({ id: 'claude-code', available: true }), start: async () => { throw new Error('must not start'); } }],
    ['codex', { id: 'codex', probe: async () => ({ id: 'codex', available: true }), start: async () => { throw new Error('must not start'); } }]]) {
    const id = label === 'phase2 fake' ? TASK_A : label === 'claude-code' ? TASK_B : 'CC-20261003-0000000a';
    const t = f.task(id);
    const approvals = approvalSetup();
    try {
      const o = new Orchestrator({ registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: new WorktreeManager({ allowLocalRemotes: true }), adapter, prProvider: new FakePrProvider(), publishGate: approvals.gate });
      const r = await o.execute(t.taskId);
      assert.equal(r.task.status, 'BLOCKED', label);
      assert.ok(f.records.listEvidence(t.taskId).some((e) => e.kind === 'guard_violation' && /Docker path permits only/.test(e.data.reason)), label);
      assert.ok(!fs.existsSync(path.join(f.worktreeRoot, t.taskId)), `${label}: no worktree`);
    } finally { approvals.done(); }
  }
  assert.equal(REAL_AGENT_EXECUTION, 'NOT_AUTHORIZED');
}));

test('phase 2 path is unchanged: the container adapter is refused there, and the fake path still completes without approvals', async () => withFixture(async (f) => {
  const t = f.task(TASK_A);
  const rt = makeRuntime();
  try {
    const o = new Orchestrator({ registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: new WorktreeManager({ allowLocalRemotes: true }), adapter: new ContainerFakeAgentAdapter({ runtime: rt.runtime }), prProvider: new FakePrProvider() });
    const r = await o.execute(t.taskId);
    assert.equal(r.task.status, 'BLOCKED');
    assert.ok(f.records.listEvidence(t.taskId).some((e) => /Phase 2 only permits internal fake adapter/.test(e.data.reason ?? '')));
    assert.equal(rt.fake.callsOf('create').length, 0);
  } finally { rt.dispose(); }
  const t2 = f.task(TASK_B);
  const r2 = await new Orchestrator({ registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: new WorktreeManager({ allowLocalRemotes: true }), adapter: new FakeAdapter(), prProvider: new FakePrProvider() }).execute(t2.taskId);
  assert.equal(r2.task.status, 'COMPLETED', 'Phase 2 keeps COMMIT/PUSH_BRANCH/CREATE_PR automatic on the fake path');
}));

// ---------- Approval required before COMMIT / PUSH_BRANCH / CREATE_PR ----------

test('no approval: the run executes in the container, then BLOCKS before any Git write, reporting the exact diff to approve', async () => withFixture(async (f) => {
  const t = f.task(TASK_A);
  await withEngine(f, {}, async (e) => {
    const r = await e.orchestrator.execute(t.taskId);
    assert.equal(r.task.status, 'BLOCKED');
    const events = f.records.listEvidence(t.taskId);
    const need = events.find((x) => x.kind === 'approval_required');
    assert.ok(need);
    assert.equal(need.grade, 'RUNTIME_OBSERVED');
    assert.equal(need.data.action, 'COMMIT'); assert.equal(need.data.code, 'APPROVAL_MISSING');
    assert.equal(need.data.diffDigest, expectedFixtureDigest(TASK_A)); assert.equal(need.data.baseSha, f.baseSha); assert.equal(need.data.branch, branchOf(TASK_A));
    assert.deepEqual(need.data.files, [fixtureOf(TASK_A)]);
    assert.equal(worktreeHead(f, TASK_A), f.baseSha, 'no commit was made');
    assert.deepEqual(remoteBranches(f), [], 'nothing was pushed');
    assert.equal(f.store.get(TASK_A).commitSha, undefined); assert.equal(f.store.get(TASK_A).pr, undefined);
    assert.ok(!kinds(f, TASK_A).some((k) => ['commit', 'push', 'pr', 'approval_consumed'].includes(k)));
    assert.equal(e.fake.containers.size, 0, 'the container was destroyed');
    const run = f.records.getRun(f.store.get(TASK_A).runIds[0]);
    assert.equal(run.status, 'FINISHED'); assert.equal(run.agent, 'fake');
    assert.ok(events.filter((x) => x.kind.startsWith('sandbox_')).every((x) => x.grade === 'LOCALLY_VERIFIED'));
    const reports = events.filter((x) => x.kind === 'agent_report');
    assert.ok(reports.length > 0 && reports.every((x) => ['AGENT_CLAIM', 'RUNTIME_OBSERVED'].includes(x.grade) && x.data.source === 'docker-fake-adapter'));
  });
}));

test('fully approved: three single-use approvals bound to this diff carry the task through commit, push and fake PR', async () => withFixture(async (f) => {
  const t = f.task(TASK_A);
  await withEngine(f, {}, async (e) => {
    const approvals = grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
    const r = await e.orchestrator.execute(t.taskId);
    assert.equal(r.task.status, 'COMPLETED');
    const events = f.records.listEvidence(t.taskId);
    const consumed = events.filter((x) => x.kind === 'approval_consumed');
    assert.deepEqual(consumed.map((x) => x.data.action), ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR']);
    assert.ok(consumed.every((x) => x.grade === 'RUNTIME_OBSERVED' && x.data.authenticity === 'UNAUTHENTICATED_LOCAL_APPROVAL' && x.data.diffDigest === expectedFixtureDigest(TASK_A)));
    assert.deepEqual(consumed.map((x) => x.data.approvalId).sort(), approvals.map((a) => a.approvalId).sort());
    const sha = f.store.get(TASK_A).commitSha;
    assert.equal(git(f.source, 'ls-remote', 'origin', `refs/heads/${branchOf(TASK_A)}`).split(/\s/)[0], sha);
    assert.equal(f.store.get(TASK_A).pr.state, 'FAKE_OPEN');
    assert.ok(!events.some((x) => ['GITHUB_VERIFIED', 'EXTERNAL_AUTHORITATIVE'].includes(x.grade)));
    const order = kinds(f, TASK_A);
    assert.ok(order.indexOf('sandbox_destroyed') < order.indexOf('approval_consumed'), 'the container is gone before any Git write');
    for (const a of approvals) assert.ok(fs.existsSync(path.join(e.approvals.dir, `${a.approvalId}.consumed`)));
    // Replay: the same approvals can never authorize anything again.
    const again = e.approvals.store.authorize({ taskId: TASK_A, action: 'COMMIT', expect: { diffDigest: expectedFixtureDigest(TASK_A), baseSha: f.baseSha, branch: branchOf(TASK_A) } });
    assert.equal(again.code, 'APPROVAL_CONSUMED');
    await assert.rejects(e.orchestrator.execute(t.taskId), /Only DRAFT tasks can start/);
  });
}));

test('approvals are bound to the task: approvals for another task, and replay on a new task, do not authorize', async () => withFixture(async (f) => {
  f.task(TASK_A); f.task(TASK_B);
  await withEngine(f, { taskId: TASK_B }, async (e) => {
    grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
    const r = await e.orchestrator.execute(TASK_B);
    assert.equal(r.task.status, 'BLOCKED');
    assert.equal(f.records.listEvidence(TASK_B).find((x) => x.kind === 'approval_required').data.code, 'APPROVAL_MISSING');
    assert.deepEqual(remoteBranches(f), []);
  });
}));

test('mismatched approvals (diff, base commit, branch) are refused and nothing is committed', async () => {
  for (const [label, extra] of [['diff', { diffDigest: diffDigestOf([{ path: fixtureOf(TASK_A), sha256: sha256('other'), size: 5, exec: false }]) }], ['base', { baseSha: 'f'.repeat(40) }], ['branch', { branch: branchOf(TASK_A, 'different-name') }]]) {
    await withFixture(async (f) => {
      f.task(TASK_A);
      await withEngine(f, {}, async (e) => {
        grant(e, TASK_A, ['COMMIT'], { baseSha: f.baseSha, ...extra });
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'BLOCKED', label);
        assert.equal(f.records.listEvidence(TASK_A).find((x) => x.kind === 'approval_required').data.code, 'APPROVAL_MISMATCH', label);
        assert.equal(worktreeHead(f, TASK_A), f.baseSha, label);
        assert.deepEqual(remoteBranches(f), [], label);
      });
    });
  }
});

test('an expired approval is refused', async () => withFixture(async (f) => {
  f.task(TASK_A);
  await withEngine(f, {}, async (e) => {
    grant(e, TASK_A, ['COMMIT'], { baseSha: f.baseSha, ttlMs: 5000 });
    e.approvals.clock.advance(5000);
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'BLOCKED');
    assert.equal(f.records.listEvidence(TASK_A).find((x) => x.kind === 'approval_required').data.code, 'APPROVAL_EXPIRED');
    assert.equal(worktreeHead(f, TASK_A), f.baseSha);
  });
}));

test('each action needs its own approval: a commit approval does not authorize a push, and a push approval does not authorize a commit', async () => {
  await withFixture(async (f) => {
    f.task(TASK_A);
    await withEngine(f, {}, async (e) => {
      grant(e, TASK_A, ['COMMIT'], { baseSha: f.baseSha });
      const r = await e.orchestrator.execute(TASK_A);
      assert.equal(r.task.status, 'BLOCKED');
      const need = f.records.listEvidence(TASK_A).filter((x) => x.kind === 'approval_required');
      assert.equal(need.at(-1).data.action, 'PUSH_BRANCH');
      assert.notEqual(worktreeHead(f, TASK_A), f.baseSha, 'the approved commit happened locally');
      assert.deepEqual(remoteBranches(f), [], 'but the unapproved push did not');
      assert.equal(f.store.get(TASK_A).pr, undefined);
    });
  });
  await withFixture(async (f) => {
    f.task(TASK_A);
    await withEngine(f, {}, async (e) => {
      grant(e, TASK_A, ['PUSH_BRANCH', 'CREATE_PR'], { baseSha: f.baseSha });
      const r = await e.orchestrator.execute(TASK_A);
      assert.equal(r.task.status, 'BLOCKED');
      assert.equal(worktreeHead(f, TASK_A), f.baseSha);
      assert.equal(f.records.listEvidence(TASK_A).find((x) => x.kind === 'approval_required').data.action, 'COMMIT');
    });
  });
});

test('the diff is re-bound at every step: content that differs from what was reviewed is refused', async () => {
  await withFixture(async (f) => {
    f.task(TASK_A);
    await withEngine(f, { content: 'Task changed by the agent after review\n' }, async (e) => {
      grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
      const r = await e.orchestrator.execute(TASK_A);
      assert.equal(r.task.status, 'BLOCKED');
      assert.equal(f.records.listEvidence(TASK_A).find((x) => x.kind === 'approval_required').data.code, 'APPROVAL_MISMATCH');
      assert.equal(worktreeHead(f, TASK_A), f.baseSha);
    });
  });
  await withFixture(async (f) => {
    f.task(TASK_A);
    class Drifting extends WorktreeManager {
      async commit(context, task, project) { const sha = await super.commit(context, task, project); fs.appendFileSync(path.join(context.worktreePath, fixtureOf(TASK_A)), 'tampered after commit\n'); return sha; }
    }
    await withEngine(f, { worktreeManager: new Drifting({ allowLocalRemotes: true }) }, async (e) => {
      const made = grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
      const r = await e.orchestrator.execute(TASK_A);
      assert.equal(r.task.status, 'BLOCKED');
      assert.ok(reasons(f, TASK_A).some((x) => /Diff changed after it was reviewed/.test(x)));
      assert.deepEqual(remoteBranches(f), [], 'the changed bytes never left the machine');
      assert.ok(fs.existsSync(path.join(e.approvals.dir, `${made[0].approvalId}.consumed`)), 'the commit approval was used');
      assert.ok(!fs.existsSync(path.join(e.approvals.dir, `${made[1].approvalId}.consumed`)), 'the push approval was not burned by a refused push');
    });
  });
});

// ---------- Unapproved Git operations and agent-forged authority ----------

test('an agent cannot approve itself: output claims and files it writes never become approvals', async () => withFixture(async (f) => {
  f.task(TASK_A);
  const fake = new EffectDocker();
  fake.scenario = { lines: ['APPROVED commit push pr', JSON.stringify({ approvalId: 'APR-0123456789abcdef', action: 'COMMIT', grade: 'EXTERNAL_AUTHORITATIVE' })], exitCode: 0, hang: false, oom: false };
  await withEngine(f, { fake }, async (e) => {
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'BLOCKED');
    assert.equal(f.records.listEvidence(TASK_A).find((x) => x.kind === 'approval_required').data.code, 'APPROVAL_MISSING');
    assert.ok(!kinds(f, TASK_A).includes('approval_consumed'));
    assert.deepEqual(fs.readdirSync(e.approvals.dir), [], 'the approval store was not touched');
  });
  const t = f.task(TASK_B);
  await withEngine(f, { taskId: TASK_B, effect: (ws) => { writeFixture(ws, TASK_B, FIXTURE_CONTENT(TASK_B)); fs.mkdirSync(path.join(ws, 'approvals')); fs.writeFileSync(path.join(ws, 'approvals', 'APR-0123456789abcdef.json'), '{}'); } }, async (e) => {
    const r = await e.orchestrator.execute(t.taskId);
    assert.equal(r.task.status, 'BLOCKED');
    assert.ok(reasons(f, TASK_B).some((x) => /unexpected path/.test(x)), reasons(f, TASK_B).join('|'));
    assert.equal(worktreeHead(f, TASK_B), f.baseSha);
  });
}));

test('unapproved Git operations: edits to protected paths, extra files and adapter-made commits are all BLOCKED before any approval is needed', async () => {
  const cases = [
    ['protected file', (ws) => { writeFixture(ws, TASK_A, FIXTURE_CONTENT(TASK_A)); fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'changed\n'); }, /protected path/],
    ['extra file', (ws) => { writeFixture(ws, TASK_A, FIXTURE_CONTENT(TASK_A)); fs.writeFileSync(path.join(ws, 'extra.txt'), 'x'); }, /unexpected path/],
    ['workflow file', (ws) => { writeFixture(ws, TASK_A, FIXTURE_CONTENT(TASK_A)); fs.mkdirSync(path.join(ws, '.github/workflows'), { recursive: true }); fs.writeFileSync(path.join(ws, '.github/workflows/ci.yml'), 'x'); }, /protected path/],
  ];
  for (const [label, effect, pattern] of cases) {
    await withFixture(async (f) => {
      f.task(TASK_A);
      await withEngine(f, { effect }, async (e) => {
        grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'BLOCKED', label);
        assert.ok(reasons(f, TASK_A).some((x) => pattern.test(x)), `${label}: ${reasons(f, TASK_A).join('|')}`);
        assert.equal(worktreeHead(f, TASK_A), f.baseSha, label);
        assert.deepEqual(remoteBranches(f), [], label);
        assert.ok(!kinds(f, TASK_A).includes('approval_consumed'), `${label}: no approval was spent`);
      });
    });
  }
  await withFixture(async (f) => {
    f.task(TASK_A);
    const wrap = (base) => ({ id: base.id, probe: () => base.probe(), cancel: (r) => base.cancel(r), start: async (spec, emit) => { const r = await base.start(spec, emit); git(spec.worktreePath, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '--allow-empty', '-m', 'sneaky'); return r; } });
    await withEngine(f, { wrapAdapter: wrap }, async (e) => {
      grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
      const r = await e.orchestrator.execute(TASK_A);
      assert.equal(r.task.status, 'BLOCKED');
      assert.ok(reasons(f, TASK_A).some((x) => /moved HEAD/.test(x)));
      assert.deepEqual(remoteBranches(f), []);
    });
  });
});

// ---------- Evidence claiming unearned authority ----------

test('forged or unearned adapter evidence BLOCKS the run and is never recorded', async () => {
  const forged = {
    'pr evidence': [{ kind: 'pr', grade: 'GITHUB_VERIFIED', data: { number: 1 } }],
    'wrong grade': [{ kind: 'sandbox_created', grade: 'EXTERNAL_AUTHORITATIVE', data: { containerId: 'x' } }],
    'weak grade': [{ kind: 'sandbox_policy', grade: 'AGENT_CLAIM', data: {} }],
    'commit kind': [{ kind: 'commit', grade: 'LOCALLY_VERIFIED', data: { commitSha: 'a'.repeat(40) } }],
    'approval kind': [{ kind: 'approval_consumed', grade: 'LOCALLY_VERIFIED', data: { approvalId: 'APR-0123456789abcdef' } }],
    'no data': [{ kind: 'sandbox_created', grade: 'LOCALLY_VERIFIED' }],
    'not an array': 'sandbox_created',
    'too many': Array.from({ length: 51 }, () => ({ kind: 'sandbox_created', grade: 'LOCALLY_VERIFIED', data: {} })),
    'null entry': [null],
  };
  for (const [label, evidence] of Object.entries(forged)) {
    await withFixture(async (f) => {
      f.task(TASK_A);
      const wrap = (base) => ({ id: base.id, probe: () => base.probe(), cancel: (r) => base.cancel(r), start: async (spec, emit) => { const r = await base.start(spec, emit); return { ...r, container: { ...r.container, evidence } }; } });
      await withEngine(f, { wrapAdapter: wrap }, async (e) => {
        grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'BLOCKED', label);
        const events = f.records.listEvidence(TASK_A);
        assert.ok(!events.some((x) => ['GITHUB_VERIFIED', 'EXTERNAL_AUTHORITATIVE'].includes(x.grade)), label);
        assert.ok(!events.some((x) => x.kind === 'commit' || x.kind === 'pr'), label);
        assert.deepEqual(remoteBranches(f), [], label);
      });
    });
  }
});

test('an adapter result claiming success without a confirmed cleanup is UNKNOWN, and no approval is spent', async () => {
  for (const [label, patch] of [['cleanup not confirmed', { cleanup: 'NOT_CONFIRMED' }], ['cleanup missing', { cleanup: undefined }], ['cleanup bogus', { cleanup: 'confirmed' }], ['outcome unknown', { outcome: 'unknown', exitCode: null }]]) {
    await withFixture(async (f) => {
      f.task(TASK_A);
      const wrap = (base) => ({ id: base.id, probe: () => base.probe(), cancel: (r) => base.cancel(r), start: async (spec, emit) => ({ ...(await base.start(spec, emit)), ...patch }) });
      await withEngine(f, { wrapAdapter: wrap }, async (e) => {
        const made = grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'UNKNOWN', label);
        assert.equal(f.records.getRun(f.store.get(TASK_A).runIds[0]).status, 'UNKNOWN', label);
        assert.equal(worktreeHead(f, TASK_A), f.baseSha, label);
        for (const a of made) assert.ok(!fs.existsSync(path.join(e.approvals.dir, `${a.approvalId}.consumed`)), label);
      });
    });
  }
});

test('cleanup failures: an unremovable container makes the task UNKNOWN even with every approval present', async () => withFixture(async (f) => {
  f.task(TASK_A);
  const fake = new EffectDocker(); fake.ignoreRm = true;
  await withEngine(f, { fake }, async (e) => {
    const made = grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'UNKNOWN');
    assert.ok(reasons(f, TASK_A).some((x) => /cleanup not confirmed/i.test(x)), reasons(f, TASK_A).join('|'));
    assert.equal(worktreeHead(f, TASK_A), f.baseSha);
    for (const a of made) assert.ok(!fs.existsSync(path.join(e.approvals.dir, `${a.approvalId}.consumed`)));
  });
}));

// ---------- Container-level refusals reach the task as BLOCKED, never as success ----------

test('unauthorized container privileges: the task is BLOCKED, the container is removed and never started', async () => {
  for (const [label, mutate] of [['privileged', (i) => { i.HostConfig.Privileged = true; }], ['docker socket', (i) => { i.HostConfig.Binds = ['/var/run/docker.sock:/var/run/docker.sock']; }], ['host network', (i) => { i.HostConfig.NetworkMode = 'host'; }], ['root user', (i) => { i.Config.User = '0:0'; }]]) {
    await withFixture(async (f) => {
      f.task(TASK_A);
      const fake = new EffectDocker(); fake.mutateInspect = (info) => { if (info.Config?.Labels?.['cc.sandbox.role'] === 'agent') mutate(info); };
      await withEngine(f, { fake }, async (e) => {
        grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'BLOCKED', label);
        assert.equal(fake.callsOf('start').length, 0, label);
        assert.equal(fake.containers.size, 0, label);
        assert.equal(worktreeHead(f, TASK_A), f.baseSha, label);
        assert.equal(f.records.getRun(f.store.get(TASK_A).runIds[0]).status, 'FAILED', label);
      });
    });
  }
});

test('unauthorized workspace identity: a worktree under a sensitive home directory is BLOCKED before any container exists', async () => withFixture(async (f) => {
  f.task(TASK_A);
  // The sandbox's notion of "home" is the task worktree itself, so the workspace would BE the home directory.
  await withEngine(f, { homeDir: path.join(f.worktreeRoot, TASK_A) }, async (e) => {
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'BLOCKED');
    assert.ok(reasons(f, TASK_A).some((x) => /FORBIDDEN_WORKSPACE|home directory/.test(x)), reasons(f, TASK_A).join('|'));
    assert.equal(e.fake.callsOf('create').length, 0);
  });
}));

test('docker unavailable or the image identity is wrong: the task is BLOCKED before a worktree is even created', async () => {
  for (const [label, tweak] of [['daemon down', (fk) => { fk.unavailable = true; }], ['digest', (fk) => { fk.imageDigestOk = false; }], ['platform', (fk) => { fk.imagePlatform = { Os: 'linux', Architecture: 'amd64' }; }], ['image missing', (fk) => { fk.imagePresent = false; }]]) {
    await withFixture(async (f) => {
      f.task(TASK_A);
      const fake = new EffectDocker(); tweak(fake);
      await withEngine(f, { fake }, async (e) => {
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'BLOCKED', label);
        assert.ok(!fs.existsSync(path.join(f.worktreeRoot, TASK_A)), label);
        assert.equal(fake.callsOf('create').length, 0, label);
      });
    });
  }
});

// ---------- Execution limits, timeout and cancellation reach the task state ----------

test('timeouts, resource kills and nonzero exits FAIL the task; nothing is committed and no approval is spent', async () => {
  for (const [label, scenario] of [['timeout', { lines: [], exitCode: 0, hang: true, oom: false }], ['oom', { lines: [], exitCode: 137, hang: false, oom: true }], ['nonzero', { lines: [], exitCode: 3, hang: false, oom: false }], ['output limit', { lines: [], exitCode: 0, hang: false, oom: false, limit: 'stdout' }]]) {
    await withFixture(async (f) => {
      f.task(TASK_A);
      const fake = new EffectDocker(); fake.scenario = scenario;
      await withEngine(f, { fake }, async (e) => {
        const made = grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'FAILED', label);
        assert.equal(f.records.getRun(f.store.get(TASK_A).runIds[0]).status, 'FAILED', label);
        assert.equal(worktreeHead(f, TASK_A), f.baseSha, label);
        assert.equal(fake.containers.size, 0, label);
        for (const a of made) assert.ok(!fs.existsSync(path.join(e.approvals.dir, `${a.approvalId}.consumed`)), label);
      });
    });
  }
});

test('cancellation: a cancelled run ends CANCELLED, the container is stopped and destroyed, and nothing is committed', async () => withFixture(async (f) => {
  f.task(TASK_A);
  const fake = new EffectDocker();
  let release; fake.hold = new Promise((r) => { release = r; }); fake.onStop = () => release();
  let runId = null;
  const wrap = (base) => ({ id: base.id, probe: () => base.probe(), cancel: (r) => base.cancel(r), start: (spec, emit) => { runId = spec.runId; return base.start(spec, emit); } });
  await withEngine(f, { fake, wrapAdapter: wrap }, async (e) => {
    const made = grant(e, TASK_A, GATED_ACTIONS, { baseSha: f.baseSha });
    const running = e.orchestrator.execute(TASK_A);
    for (let i = 0; i < 400 && fake.callsOf('start').length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.ok(runId, 'the run started');
    assert.deepEqual(await e.adapter.cancel(runId), { terminated: true });
    const r = await running;
    assert.equal(r.task.status, 'CANCELLED');
    assert.equal(f.records.getRun(f.store.get(TASK_A).runIds[0]).status, 'CANCELLED');
    assert.equal(fake.containers.size, 0);
    assert.equal(worktreeHead(f, TASK_A), f.baseSha);
    assert.deepEqual(remoteBranches(f), []);
    for (const a of made) assert.ok(!fs.existsSync(path.join(e.approvals.dir, `${a.approvalId}.consumed`)));
    assert.ok(f.records.listEvidence(TASK_A).some((x) => x.kind === 'sandbox_stopped' && x.grade === 'LOCALLY_VERIFIED'));
  });
}));

// ---------- Real agents stay off ----------

test('real agents stay NOT_AUTHORIZED: a task that names claude-code or codex still only ever runs the fake container script', async () => {
  for (const agent of ['claude-code', 'codex']) {
    await withFixture(async (f) => {
      f.task(TASK_A, { agent });
      await withEngine(f, {}, async (e) => {
        const r = await e.orchestrator.execute(TASK_A);
        assert.equal(r.task.status, 'BLOCKED');
        const run = f.records.getRun(f.store.get(TASK_A).runIds[0]);
        assert.equal(run.agent, 'fake');
        const create = e.fake.callsOf('create')[0];
        assert.ok(!create.some((a) => /claude|codex|anthropic|openai/i.test(a)), 'no real agent binary, image or credential is named');
        assert.ok(create.includes('--network=none'));
      });
    });
  }
});

test('approval store is never reachable from adapter inputs: the adapter spec carries no approval or store reference', async () => withFixture(async (f) => {
  f.task(TASK_A);
  let seen = null;
  const wrap = (base) => ({ id: base.id, probe: () => base.probe(), cancel: (r) => base.cancel(r), start: (spec, emit) => { seen = spec; return base.start(spec, emit); } });
  await withEngine(f, { wrapAdapter: wrap }, async (e) => {
    await e.orchestrator.execute(TASK_A);
    assert.deepEqual(Object.keys(seen).sort(), ['fixturePath', 'runId', 'taskId', 'worktreePath']);
    assert.ok(e.approvals.store instanceof ApprovalStore && e.approvals.gate instanceof ApprovalGate);
  });
}));
