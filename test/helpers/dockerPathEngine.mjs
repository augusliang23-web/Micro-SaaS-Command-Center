import fs from 'node:fs';
import path from 'node:path';

import { git } from './phase2Fixture.mjs';
import { Orchestrator } from '../../server/execution/orchestrator.mjs';
import { WorktreeManager } from '../../server/execution/worktreeManager.mjs';
import { FakePrProvider } from '../../server/execution/fakePrProvider.mjs';
import { ContainerFakeAgentAdapter } from '../../server/execution/containerAgentAdapter.mjs';
import { EffectDocker, FIXTURE_CONTENT, approvalSetup, branchOf, expectedFixtureDigest, expectedTreeFor, makeRuntime } from './dockerPathFixture.mjs';

export const TASK_A = 'CC-20261003-12345678';
export const TASK_B = 'CC-20261003-87654321';
export const approver = { source: 'CONTROL_PLANE', id: 'control-plane-reviewer' };
export const fixtureOf = (taskId) => `agent-console-fixture/${taskId}.txt`;
export const writeFixture = (ws, taskId, content) => { fs.mkdirSync(path.join(ws, 'agent-console-fixture'), { recursive: true }); fs.writeFileSync(path.join(ws, fixtureOf(taskId)), content, { mode: 0o600 }); };

/** Builds the Docker-path engine over an in-memory fake Docker. No daemon, no network, no real agent. */
export function dockerEngine(f, opts = {}) {
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
  return { fake, rt, approvals, adapter: base, orchestrator, source: f.source, done: () => { rt.dispose(); approvals.done(); } };
}
export async function withEngine(f, opts, fn) { const e = dockerEngine(f, opts); try { return await fn(e); } finally { e.done(); } }

export const treeFor = (e, taskId, baseSha, content = FIXTURE_CONTENT(taskId)) => expectedTreeFor({ repo: e.source, baseSha, entries: [{ path: fixtureOf(taskId), content }] });
export const grant = (e, taskId, actions, extra = {}) => actions.map((action) => e.approvals.store.grant({
  taskId, action, diffDigest: extra.diffDigest ?? expectedFixtureDigest(taskId), treeSha: extra.treeSha ?? treeFor(e, taskId, extra.baseSha), baseSha: extra.baseSha, branch: extra.branch ?? branchOf(taskId), approvedBy: approver, ...(extra.ttlMs ? { ttlMs: extra.ttlMs } : {}),
}));
export const remoteBranches = (f) => git(f.source, 'ls-remote', '--heads', 'origin').split('\n').filter((l) => l.includes('/agent/'));
export const kinds = (f, id) => f.records.listEvidence(id).map((e) => e.kind);
export const worktreeHead = (f, id) => git(path.join(f.worktreeRoot, id), 'rev-parse', 'HEAD');
export const reasons = (f, id) => f.records.listEvidence(id).filter((e) => ['guard_violation', 'error', 'approval_required'].includes(e.kind)).map((e) => `${e.kind}:${e.data.reason ?? e.data.code ?? ''}`);

