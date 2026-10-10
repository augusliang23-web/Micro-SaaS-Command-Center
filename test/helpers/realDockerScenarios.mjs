/**
 * Phase 3B7B2A scenarios for the three real-Docker gaps. Each scenario takes a HARNESS and runs identically against
 *   - mode 'real': the real local Docker daemon (integration test file; needs separate Control Plane review before it is run), and
 *   - mode 'dry' : an in-memory fake Docker (offline dry run that proves the scenario and the OwnedDocker policy are coherent).
 * Assertions that only a real daemon can satisfy are guarded by `h.real`. Observations from Docker are labelled REAL;
 * everything produced through `faults` / `swallow` is labelled FAULT-INJECTED and is counted so a test can prove it happened.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { OwnedDocker } from './ownedDocker.mjs';
import { makeScratch, realTmp } from './dockerScratch.mjs';
import { FIXTURE_CONTENT, approvalSetup } from './dockerPathFixture.mjs';
import { TASK_A, fixtureOf, grant, kinds, remoteBranches, worktreeHead, writeFixture } from './dockerPathEngine.mjs';
import { withFixture } from './phase2Fixture.mjs';
import { DockerSandboxRuntime } from '../../server/sandbox/dockerSandboxRuntime.mjs';
import { TEST_IMAGES } from '../../server/sandbox/sandboxImages.mjs';
import { FAKE_AGENT_IMAGES, FAKE_AGENT_IMAGE_ALIAS } from '../../server/sandbox/fakeAgentImages.mjs';
import { ContainerFakeAgentAdapter } from '../../server/execution/containerAgentAdapter.mjs';
import { Orchestrator } from '../../server/execution/orchestrator.mjs';
import { WorktreeManager } from '../../server/execution/worktreeManager.mjs';
import { FakePrProvider } from '../../server/execution/fakePrProvider.mjs';

export const PINNED_REF = TEST_IMAGES['busybox-test'].reference;
// Bounded CPU, memory, PIDs, output and run time for every container these scenarios create.
export const LIMITS = Object.freeze({ cpus: 0.5, memoryMb: 64, pids: 32, timeoutMs: 20_000, outputBytes: 65_536 });
const HEX64 = /^[0-9a-f]{64}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const newSandboxId = () => `p3b7b2-${randomBytes(5).toString('hex')}`;
export const newRunId = () => `RUN-99990101-${randomBytes(4).toString('hex')}`;

export async function waitFor(fn, { ms = 8000, step = 10, what = 'condition' } = {}) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(step);
  }
}

/** The inner client is a real DockerClient (mode 'real') or an EffectDocker (mode 'dry'). */
export function createHarness({ inner, mode }) {
  assert.ok(mode === 'real' || mode === 'dry');
  const owned = new OwnedDocker({ inner, imageRef: PINNED_REF });
  const stateRoot = realTmp('cc-p3b7b2-state-');
  const runtimes = [];
  const newRuntime = (extra = {}) => { const r = new DockerSandboxRuntime({ docker: owned, images: FAKE_AGENT_IMAGES, stateRoot, commandCenterRoot: process.cwd(), ...extra }); runtimes.push(r); return r; };
  const h = {
    mode, real: mode === 'real', inner, owned, stateRoot,
    runtime: newRuntime(), newRuntime,
    newAdapter: (runtime = h.runtime) => new ContainerFakeAgentAdapter({ runtime, limits: LIMITS }),
    /** dry mode only: what a real container's write into the bind-mounted workspace would do. */
    setEffect(fn) { if (!h.real) inner.effect = fn; },
    /** dry mode only: make the fake container stay running until released. Real mode: the command itself sleeps. */
    longRun() {
      if (h.real) return { release() {} };
      let release; inner.hold = new Promise((r) => { release = r; }); inner.onStop = () => release();
      return { release };
    },
    async dispose() { const leftovers = await owned.cleanupAll(); try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* best effort */ } return leftovers; },
  };
  return h;
}

const runtimeSpec = (h, scratch, sandboxId, command) => ({
  sandboxId, role: 'agent', worktreePath: scratch.wt, command,
  policy: { network: 'NO_NETWORK', image: FAKE_AGENT_IMAGE_ALIAS, writablePaths: ['/workspace', '/tmp'], ...LIMITS },
});

async function gone(h, id, what) { assert.equal(await h.owned.existence(id), 'ABSENT', `${what}: the exact owned container is absent`); }

// =====================================================================================================================
// GAP 1 — ContainerFakeAgentAdapter against the daemon
// =====================================================================================================================

export async function adapterRealRun(h) {
  const scratch = makeScratch();
  h.setEffect((ws) => writeFixture(ws, TASK_A, FIXTURE_CONTENT(TASK_A)));
  const hostGitBefore = fs.readFileSync(path.join(scratch.wt, '.git'), 'utf8');
  const secretBefore = fs.readFileSync(scratch.secret, 'utf8');
  try {
    const sp = { taskId: TASK_A, runId: newRunId(), worktreePath: scratch.wt, fixturePath: fixtureOf(TASK_A) };
    const events = [];
    const r = await h.newAdapter().start(sp, (e) => events.push(e));
    assert.equal(r.outcome, 'completed', JSON.stringify({ outcome: r.outcome, reason: r.reason }));
    assert.equal(r.exitCode, 0); assert.equal(r.cleanup, 'CONFIRMED');
    assert.deepEqual(events.map((e) => e.type).filter((t) => t !== 'output'), ['started', 'finished']);

    // Complete execution evidence, every item earned by authoritative readback of the exact container.
    const byKind = Object.fromEntries(r.container.evidence.map((e) => [e.kind, e]));
    for (const k of ['sandbox_policy', 'sandbox_created', 'sandbox_started', 'sandbox_destroyed']) assert.ok(byKind[k], k);
    assert.ok(r.container.evidence.every((e) => e.grade === 'LOCALLY_VERIFIED'));
    const id = byKind.sandbox_created.data.containerId;
    assert.match(id, HEX64); assert.ok(h.owned.owned.has(id), 'the container id is one this test created');
    assert.equal(byKind.sandbox_started.data.containerId, id); assert.equal(byKind.sandbox_destroyed.data.containerId, id);
    assert.equal(byKind.sandbox_started.data.exitCode, 0); assert.equal(byKind.sandbox_started.data.oomKilled, false);
    assert.equal(byKind.sandbox_created.data.imageDigest, TEST_IMAGES['busybox-test'].digest);

    // REAL observations: Docker's own answer about the exact container (taken by id, before any fault; none is armed here).
    const seen = h.owned.observed.filter((o) => o.id === id);
    assert.ok(seen.length >= 2, 'prepare readback and the post-run readback were both observed');
    const first = seen[0];
    assert.equal(first.labels['cc.sandbox'], '1'); assert.equal(first.labels['cc.sandbox.role'], 'agent'); assert.equal(first.labels['cc.sandbox.id'], sp.runId);
    assert.equal(first.host.networkMode, 'none'); assert.equal(first.host.privileged, false);
    assert.deepEqual(first.host.capDrop, ['ALL']); assert.ok(!first.host.capAdd?.length);
    assert.deepEqual(first.host.securityOpt, ['no-new-privileges']); assert.equal(first.host.readonlyRootfs, true);
    assert.match(first.user, /^[1-9]\d*:\d+$/, 'a numeric non-root user');
    assert.deepEqual(first.mountDestinations.map((m) => m.destination), ['/workspace', '/workspace/.git'], 'only the task workspace and the masked .git');
    assert.deepEqual(first.mountDestinations.map((m) => m.rw), [true, false]);
    assert.ok(!JSON.stringify(first).includes('docker.sock'));
    assert.ok(first.envNames.every((n) => ['HOME', 'PATH'].includes(n)), `unexpected environment names: ${first.envNames}`);
    assert.ok(first.host.pidsLimit === LIMITS.pids && first.host.memory === LIMITS.memoryMb * 1024 * 1024 && first.host.nanoCpus === 500_000_000, 'resource limits as configured');

    // The synthetic modification, and nothing else, reached the host.
    assert.equal(fs.readFileSync(path.join(scratch.wt, sp.fixturePath), 'utf8'), FIXTURE_CONTENT(TASK_A));
    assert.equal(fs.readFileSync(path.join(scratch.wt, '.git'), 'utf8'), hostGitBefore, 'the host .git pointer is untouched');
    assert.equal(fs.readFileSync(scratch.secret, 'utf8'), secretBefore, 'the synthetic outside file is untouched');
    if (h.real) {
      assert.equal(fs.statSync(path.join(scratch.wt, sp.fixturePath)).uid, process.getuid(), 'owned by the host user, not root');
      assert.deepEqual(fs.readdirSync(scratch.wt).sort(), ['.git', 'a.txt', 'agent-console-fixture']);
    }
    await gone(h, id, 'after the adapter run');
  } finally { scratch.cleanup(); }
}

/** Real container writes the fixture; the Orchestrator verifies the tree and commits to a TEMP local bare remote with fake PR. */
export async function endToEnd(h, { fault = false } = {}) {
  await withFixture(async (f) => {
    h.setEffect((ws) => writeFixture(ws, TASK_A, FIXTURE_CONTENT(TASK_A)));
    f.task(TASK_A);
    const approvals = approvalSetup();
    try {
      const orchestrator = new Orchestrator({
        registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: new WorktreeManager({ allowLocalRemotes: true }),
        adapter: h.newAdapter(), prProvider: new FakePrProvider(), publishGate: approvals.gate,
      });
      const made = grant({ approvals, source: f.source }, TASK_A, ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], { baseSha: f.baseSha });
      if (fault) h.owned.faults = (st) => { delete st.OOMKilled; delete st.StartedAt; delete st.FinishedAt; }; // FAULT-INJECTED
      const r = await orchestrator.execute(TASK_A);
      h.owned.faults = null;
      const events = f.records.listEvidence(TASK_A);
      const consumed = (a) => fs.existsSync(path.join(approvals.dir, `${a.approvalId}.consumed`));
      if (!fault) {
        assert.equal(r.task.status, 'COMPLETED', JSON.stringify(events.filter((e) => ['error', 'guard_violation', 'approval_required'].includes(e.kind)).map((e) => e.data)));
        assert.deepEqual(events.filter((e) => e.kind === 'approval_consumed').map((e) => e.data.action), ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR']);
        assert.ok(events.filter((e) => e.kind.startsWith('sandbox_')).every((e) => e.grade === 'LOCALLY_VERIFIED' && HEX64.test(e.data.containerId ?? '') && h.owned.owned.has(e.data.containerId)));
        assert.ok(!events.some((e) => ['GITHUB_VERIFIED', 'EXTERNAL_AUTHORITATIVE'].includes(e.grade)));
        assert.ok(made.every(consumed));
        assert.equal(remoteBranches(f).length, 1);
      } else {
        assert.ok(h.owned.faultsApplied > 0, 'FAULT-INJECTED: the corrupted readback was actually delivered');
        assert.equal(r.task.status, 'UNKNOWN');
        assert.equal(f.records.getRun(f.store.get(TASK_A).runIds[0]).status, 'UNKNOWN');
        assert.ok(!kinds(f, TASK_A).includes('sandbox_started'), 'no success-grade sandbox_started evidence');
        assert.ok(!kinds(f, TASK_A).some((k) => ['commit', 'push', 'pr', 'approval_consumed'].includes(k)));
        assert.ok(!JSON.stringify(events).includes('"oomKilled":false'));
        assert.ok(!made.some(consumed), 'no Git approval was consumed');
        assert.equal(worktreeHead(f, TASK_A), f.baseSha);
        assert.deepEqual(remoteBranches(f), []);
      }
      for (const id of h.owned.owned) await gone(h, id, 'after the end-to-end run');
    } finally { h.owned.faults = null; approvals.done(); }
  });
}

// =====================================================================================================================
// GAP 2 — cancellation launch fence
// =====================================================================================================================

async function prepared(h, runtime, scratch, command) {
  const sandboxId = newSandboxId();
  const p = await runtime.prepare(runtimeSpec(h, scratch, sandboxId, command));
  assert.equal(p.state, 'PREPARED', JSON.stringify(p));
  return { sandboxId, id: p.containerId, p };
}

/** op: 'stop' | 'destroy'. REAL daemon, controlled pause of the final pre-start inspect response. */
export async function fenceBeforeLaunch(h, op) {
  const scratch = makeScratch();
  const rt = h.runtime;
  let id; let sandboxId;
  try {
    const sb = await prepared(h, rt, scratch, ['/bin/sleep', '30']);
    id = sb.id; sandboxId = sb.sandboxId;
    const pause = h.owned.armPause(1); // the first inspect-by-id after this point is start()'s last pre-launch read
    const starting = rt.start(sb.sandboxId);
    await Promise.race([pause.reached, sleep(10_000).then(() => { throw new Error('start() never reached its pre-launch inspect'); })]);
    assert.equal(h.owned.count('start'), 0, 'paused before any launch');
    const res = await rt[op](sb.sandboxId);
    assert.equal(res.state, op === 'stop' ? 'STOPPED' : 'DESTROYED', `${op} confirmed`);
    assert.equal(h.owned.count('start'), 0, `still no launch after ${op} was confirmed`);
    pause.release();
    const out = await starting;
    assert.equal(out.state, 'BLOCKED', `${op}: ${JSON.stringify({ state: out.state, code: out.code })}`);
    assert.ok(['CANCELLED_BEFORE_LAUNCH', 'CONTAINER_CHANGED'].includes(out.code), `${op}: ${out.code}`);
    await sleep(h.real ? 600 : 20);
    assert.equal(h.owned.count('start'), 0, 'no Docker start command was ever issued');
    if (op === 'stop') {
      const st = await h.owned.realState(id); // REAL observation
      assert.ok(st, 'the stopped container still exists');
      assert.equal(st.state.Running, false); assert.equal(st.state.Status, 'created', 'it was never started');
    } else {
      await gone(h, id, 'after destroy');
    }
  } finally {
    if (sandboxId) await rt.destroy(sandboxId).catch(() => {}); // exact owned sandbox; also removes its mask state
    if (id) await h.owned.forceRemove(id);
    scratch.cleanup();
  }
  if (id) await gone(h, id, 'after cleanup');
}

/** `docker start` has already been issued: stop must wait (bounded) for the launch to settle and must leave nothing running. */
export async function issuedLaunchStop(h) {
  const scratch = makeScratch();
  const lr = h.longRun();
  let id;
  try {
    const sb = await prepared(h, h.runtime, scratch, ['/bin/sleep', '30']);
    id = sb.id;
    const starting = h.runtime.start(sb.sandboxId);
    await waitFor(() => h.owned.count('start') === 1, { what: 'the docker start to be issued' });
    const t0 = Date.now();
    const res = await h.runtime.stop(sb.sandboxId);
    assert.equal(res.state, 'STOPPED', JSON.stringify(res));
    assert.ok(Date.now() - t0 < 20_000, 'bounded wait');
    assert.equal(res.evidence[0].kind, 'sandbox_stopped'); assert.equal(res.evidence[0].grade, 'LOCALLY_VERIFIED'); assert.equal(res.evidence[0].data.containerId, id);
    const after = await starting;
    assert.ok(['EXITED', 'UNKNOWN', 'BLOCKED'].includes(after.state));
    assert.notEqual(after.outcome, 'FINISHED_AND_RUNNING');
    for (let i = 0; i < 4; i += 1) { // no late launch: still not running 1 second later
      const st = await h.owned.realState(id);
      assert.equal(st?.state.Running, false, `observation ${i}: not running`);
      await sleep(h.real ? 300 : 10);
    }
    assert.equal(h.owned.count('start'), 1, 'exactly the one launch that was issued before the stop');
  } finally { lr.release(); if (id) await h.owned.forceRemove(id); scratch.cleanup(); }
  if (id) await gone(h, id, 'after cleanup');
}

/** FAULT-INJECTED: Docker is not told to stop (stop/kill swallowed). The container really keeps running => UNKNOWN. */
export async function unconfirmedStop(h) {
  const scratch = makeScratch();
  const lr = h.longRun();
  const rt = h.newRuntime({ launchSettleMs: 700 });
  let id; let starting;
  try {
    const sb = await prepared(h, rt, scratch, ['/bin/sleep', '30']);
    id = sb.id;
    starting = rt.start(sb.sandboxId);
    await waitFor(() => h.owned.count('start') === 1, { what: 'the docker start to be issued' });
    await waitFor(async () => (await h.owned.realState(id))?.state.Running === true, { what: 'the container to be running' });
    h.owned.swallow = new Set(['stop', 'kill']);
    const res = await rt.stop(sb.sandboxId);
    assert.ok(h.owned.swallowed > 0, 'FAULT-INJECTED: stop/kill were swallowed');
    assert.equal(res.state, 'UNKNOWN'); assert.equal(res.code, 'STOP_NOT_CONFIRMED');
    assert.deepEqual(res.evidence, [], 'no stopped evidence for an unconfirmed stop');
    assert.equal((await h.owned.realState(id))?.state.Running, true, 'REAL: the container really is still running');
  } finally {
    h.owned.swallow = new Set();
    if (id) await h.owned.forceRemove(id);
    lr.release();
    if (starting) await starting.catch(() => {});
    scratch.cleanup();
  }
  if (id) await gone(h, id, 'after cleanup');
}

/** FAULT-INJECTED: `rm` swallowed, so the container really is still present => destroy is UNKNOWN. */
export async function unconfirmedDestroy(h) {
  const scratch = makeScratch();
  let id;
  try {
    const sb = await prepared(h, h.runtime, scratch, ['/bin/true']);
    id = sb.id;
    h.owned.swallow = new Set(['rm']);
    const res = await h.runtime.destroy(sb.sandboxId);
    assert.ok(h.owned.swallowed > 0, 'FAULT-INJECTED: rm was swallowed');
    assert.equal(res.state, 'UNKNOWN'); assert.equal(res.code, 'DESTROY_NOT_CONFIRMED');
    assert.equal(await h.owned.existence(id), 'PRESENT', 'REAL: the container is still there, so DESTROYED would have been false');
  } finally { h.owned.swallow = new Set(); if (id) await h.owned.forceRemove(id); scratch.cleanup(); }
  if (id) await gone(h, id, 'after cleanup');
}

// =====================================================================================================================
// GAP 3 — raw execution readback for the agent role
// =====================================================================================================================

const isDockerTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) > 0;

/** REAL daemon readback of a normally exiting agent-role container: every field present, correctly typed and consistent. */
export async function rawReadbackReal(h) {
  const scratch = makeScratch();
  let id; let sandboxId;
  try {
    const sb = await prepared(h, h.runtime, scratch, ['/bin/true']);
    id = sb.id; sandboxId = sb.sandboxId;
    const out = await h.runtime.start(sb.sandboxId);
    assert.equal(out.state, 'EXITED', JSON.stringify({ state: out.state, code: out.code }));
    assert.equal(out.containerId, id);
    const st = out.executionReadback; // raw State object exactly as Docker reported it (REAL)
    for (const key of ['ExitCode', 'Running', 'Status', 'OOMKilled', 'StartedAt', 'FinishedAt']) assert.ok(Object.hasOwn(st, key), `State.${key} present`);
    assert.equal(out.containerReadback.Id, id, 'Container ID');
    assert.ok(Number.isInteger(st.ExitCode) && st.ExitCode === 0);
    assert.equal(st.Running, false); assert.equal(st.Status, 'exited'); assert.equal(typeof st.OOMKilled, 'boolean'); assert.equal(st.OOMKilled, false);
    assert.ok(isDockerTime(st.StartedAt) && isDockerTime(st.FinishedAt), `timestamps parse (${typeof st.StartedAt})`);
    assert.ok(Date.parse(st.FinishedAt) >= Date.parse(st.StartedAt), 'FinishedAt is not before StartedAt');
    assert.deepEqual({ ok: out.executionReadbackCheck.ok, missing: out.executionReadbackCheck.missing, failures: out.executionReadbackCheck.failures }, { ok: true, missing: [], failures: [] });
    assert.equal(out.policyReadback.ok, true);
    const started = out.evidence.find((e) => e.kind === 'sandbox_started');
    assert.equal(started.grade, 'LOCALLY_VERIFIED'); assert.equal(started.data.oomKilled, false); assert.equal(started.data.exitCode, 0);
    assert.equal(out.oomKilled, false);
    assert.equal((await h.runtime.inspect(sb.sandboxId)).state, 'EXITED');
  } finally { if (sandboxId) await h.runtime.destroy(sandboxId).catch(() => {}); if (id) await h.owned.forceRemove(id); scratch.cleanup(); }
  if (id) await gone(h, id, 'after cleanup');
}

export const DAMAGE = Object.freeze({
  'OOMKilled missing': (st) => { delete st.OOMKilled; },
  'StartedAt missing': (st) => { delete st.StartedAt; },
  'FinishedAt missing': (st) => { delete st.FinishedAt; },
  'ExitCode missing': (st) => { delete st.ExitCode; },
  'Running missing': (st) => { delete st.Running; },
  'Status missing': (st) => { delete st.Status; },
  'OOMKilled wrong type': (st) => { st.OOMKilled = 'false'; },
  'OOMKilled null': (st) => { st.OOMKilled = null; },
  'ExitCode wrong type': (st) => { st.ExitCode = '0'; },
  'ExitCode fractional': (st) => { st.ExitCode = 0.5; },
  'StartedAt garbage': (st) => { st.StartedAt = 'garbage'; },
  'FinishedAt wrong type': (st) => { st.FinishedAt = 42; },
  'Docker zero time': (st) => { st.StartedAt = '0001-01-01T00:00:00Z'; },
  'FinishedAt before StartedAt': (st) => { st.FinishedAt = '2020-01-01T00:00:00Z'; },
  'Running true after exit': (st) => { st.Running = true; },
  'Status dead': (st) => { st.Status = 'dead'; },
});

/** FAULT-INJECTED responses on top of a REAL run: each damaged readback must be UNKNOWN with no success evidence. */
export async function rawReadbackFaults(h) {
  const results = [];
  for (const [label, damage] of Object.entries(DAMAGE)) {
    const scratch = makeScratch();
    h.setEffect(() => {});
    const before = h.owned.faultsApplied;
    h.owned.faults = damage; // FAULT-INJECTED
    try {
      const sp = { taskId: TASK_A, runId: newRunId(), worktreePath: scratch.wt, fixturePath: fixtureOf(TASK_A) };
      const r = await h.newAdapter(h.newRuntime({ launchSettleMs: 3000 })).start(sp, () => {});
      assert.ok(h.owned.faultsApplied > before, `${label}: FAULT-INJECTED response was delivered`);
      assert.equal(r.outcome, 'unknown', `${label}: ${JSON.stringify({ outcome: r.outcome, reason: r.reason })}`);
      assert.equal(r.exitCode, null, label);
      assert.ok(!r.container.evidence.some((e) => e.kind === 'sandbox_started'), `${label}: no sandbox_started evidence`);
      assert.ok(!JSON.stringify(r.container.evidence).includes('"oomKilled":false'), `${label}: an unknown OOM flag was never recorded as false`);
      results.push(label);
    } finally { h.owned.faults = null; scratch.cleanup(); }
  }
  assert.equal(results.length, Object.keys(DAMAGE).length);
  const leftovers = await h.owned.cleanupAll();
  assert.deepEqual(leftovers, [], 'every owned container confirmed absent');
}

