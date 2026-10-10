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

/** Raised when the outcome of a cancel/cleanup cannot be proven. The suite must STOP (see createSuiteGuard); it is never a pass. */
export class UnknownOutcomeError extends Error { constructor(message) { super(`UNKNOWN: ${message}`); this.name = 'UnknownOutcomeError'; this.code = 'UNKNOWN'; } }
export class WaitTimeoutError extends Error { constructor(what, ms) { super(`timed out after ${ms} ms waiting for ${what}`); this.name = 'WaitTimeoutError'; this.code = 'WAIT_TIMEOUT'; } }

/** Bounded await: rejects with WaitTimeoutError, clears its timer, and never leaves an unhandled rejection from the original promise. */
export async function bounded(promise, ms, what) {
  let timer;
  const original = Promise.resolve(promise);
  original.catch(() => {}); // a late rejection after the timeout must not become an unhandled rejection
  try { return await Promise.race([original, new Promise((_, reject) => { timer = setTimeout(() => reject(new WaitTimeoutError(what, ms)), ms); })]); }
  finally { clearTimeout(timer); }
}

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
  const stateRoot = realTmp('cc-p3b7b2-state-');
  const owned = new OwnedDocker({ inner, imageRef: PINNED_REF, stateRoot });
  const runtimes = [];
  const newRuntime = (extra = {}) => { const r = new DockerSandboxRuntime({ docker: owned, images: FAKE_AGENT_IMAGES, stateRoot, commandCenterRoot: process.cwd(), ...extra }); runtimes.push(r); return r; };
  const h = {
    mode, real: mode === 'real', inner, owned, stateRoot, preserved: [], stateRootPreserved: false, closeBoundMs: 30_000,
    runtime: newRuntime(), newRuntime,
    newAdapter: (runtime = h.runtime) => new ContainerFakeAgentAdapter({ runtime, limits: LIMITS }),
    /** A synthetic scratch workspace, registered as the ONLY kind of workspace the wrapper will bind. */
    newScratch() { const scratch = makeScratch(); owned.registerWorkspace(scratch.wt); return scratch; },
    reserveRun: (runId) => owned.reserveRun(runId),
    reserveSandbox: (id) => owned.reserveSandbox(id),
    /** dry mode only: what a real container's write into the bind-mounted workspace would do. */
    setEffect(fn) { if (!h.real) inner.effect = fn; },
    /** dry mode only: make the fake container stay running until released. Real mode: the command itself sleeps. */
    longRun() {
      if (h.real) return { release() {} };
      let release; inner.hold = new Promise((r) => { release = r; }); inner.onStop = () => release();
      return { release };
    },
    /**
     * Exact-id cleanup of EVERY owned container (one failing id never stops the others). Only when all are confirmed absent are the
     * local state root and mask directories deleted; otherwise they are PRESERVED as evidence and the leftovers are returned.
     */
    async dispose() {
      const leftovers = await owned.cleanupAll();
      if (leftovers.length === 0) { try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* best effort */ } } else h.stateRootPreserved = true;
      return leftovers;
    },
  };
  return h;
}

/** Destroys the exact sandbox, force-removes every owned id, and deletes the scratch workspace ONLY when absence is proven. */
async function closeOut(h, { runtime, sandboxId, scratch } = {}) {
  if (sandboxId && runtime) { try { await bounded(runtime.destroy(sandboxId), h.closeBoundMs, 'runtime.destroy'); } catch { /* the id sweep below is authoritative */ } }
  const leftovers = await h.owned.cleanupAll();
  if (leftovers.length === 0) { try { scratch?.cleanup(); } catch { /* best effort */ } } else if (scratch) h.preserved.push(scratch.root);
  return leftovers;
}
function assertClosed(leftovers, what) { if (leftovers.length) throw new UnknownOutcomeError(`${what}: owned container(s) not confirmed absent: ${leftovers.join(',')}; local state preserved`); }

/**
 * Suite guard: after any UNKNOWN outcome or unconfirmed cleanup the suite STOPS — later scenarios are reported skipped, never run
 * against a daemon that may still hold an owned container.
 */
export function createSuiteGuard() {
  const guard = {
    halted: null,
    async run(h, fn, t) {
      if (guard.halted) { t?.skip?.(`suite halted: ${guard.halted}`); return 'skipped'; }
      let failure = null;
      try { await fn(h); } catch (error) { failure = error; }
      let leftovers = [];
      try { leftovers = await h.dispose(); } catch (error) { leftovers = ['dispose-failed']; failure ??= error; }
      if (failure instanceof UnknownOutcomeError || failure instanceof WaitTimeoutError || leftovers.length) guard.halted = failure?.message ?? `unconfirmed cleanup: ${leftovers}`;
      if (failure) throw failure;
      if (leftovers.length) throw new UnknownOutcomeError(`owned containers not confirmed absent: ${leftovers}`);
      return 'passed';
    },
  };
  return guard;
}

const runtimeSpec = (h, scratch, sandboxId, command) => ({
  sandboxId, role: 'agent', worktreePath: scratch.wt, command,
  policy: { network: 'NO_NETWORK', image: FAKE_AGENT_IMAGE_ALIAS, writablePaths: ['/workspace', '/tmp'], ...LIMITS },
});

async function gone(h, id, what) { const state = await h.owned.existence(id); if (state !== 'ABSENT') throw new UnknownOutcomeError(`${what}: the exact owned container is ${state}, not proven absent`); }

// =====================================================================================================================
// GAP 1 — ContainerFakeAgentAdapter against the daemon
// =====================================================================================================================

export async function adapterRealRun(h) {
  const scratch = h.newScratch();
  let leftovers = [];
  h.setEffect((ws) => writeFixture(ws, TASK_A, FIXTURE_CONTENT(TASK_A)));
  const hostGitBefore = fs.readFileSync(path.join(scratch.wt, '.git'), 'utf8');
  const secretBefore = fs.readFileSync(scratch.secret, 'utf8');
  try {
    const sp = { taskId: TASK_A, runId: h.reserveRun(newRunId()), worktreePath: scratch.wt, fixturePath: fixtureOf(TASK_A) };
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
  } finally { leftovers = await closeOut(h, { scratch }); }
  assertClosed(leftovers, 'adapter run');
}

/** Real container writes the fixture; the Orchestrator verifies the tree and commits to a TEMP local bare remote with fake PR. */
export async function endToEnd(h, { fault = false } = {}) {
  await withFixture(async (f) => {
    h.setEffect((ws) => writeFixture(ws, TASK_A, FIXTURE_CONTENT(TASK_A)));
    f.task(TASK_A);
    h.owned.registerWorkspace(path.join(f.worktreeRoot, TASK_A)); // the one worktree the Orchestrator will create
    const approvals = approvalSetup();
    try {
      const inner = h.newAdapter();
      // The Orchestrator generates its own run ids: each exact name is reserved at the moment the run starts, before any Docker call.
      const adapter = { id: inner.id, probe: () => inner.probe(), cancel: (r) => inner.cancel(r), start: (spec, emit) => { h.reserveRun(spec.runId); return inner.start(spec, emit); } };
      const orchestrator = new Orchestrator({
        registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: new WorktreeManager({ allowLocalRemotes: true }),
        adapter, prProvider: new FakePrProvider(), publishGate: approvals.gate,
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
  const sandboxId = h.reserveSandbox(newSandboxId());
  const p = await runtime.prepare(runtimeSpec(h, scratch, sandboxId, command));
  assert.equal(p.state, 'PREPARED', JSON.stringify(p));
  return { sandboxId, id: p.containerId, p };
}

/** A start() promise that can never reject or be left dangling: it resolves to { ok, v | e }. */
const settle = (promise) => Promise.resolve(promise).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

/**
 * op: 'stop' | 'destroy'. Controlled pause of the final pre-start inspect response.
 * GUARANTEES (even when stop/destroy throws, returns an unconfirmed state, or never answers): the paused inspect is released, every
 * asynchronous wait is bounded, the pending start() is settled or reported UNKNOWN, an unprovable outcome is UNKNOWN (never success),
 * and exact-id cleanup is attempted for every owned container before anything is reported.
 */
export async function fenceBeforeLaunch(h, op, { waitMs = 10_000, settleMs = 15_000 } = {}) {
  const scratch = h.newScratch();
  const rt = h.runtime;
  let sandboxId; let id; let pause = null; let starting = null; let failure = null; let strandedStart = false;
  try {
    const sb = await prepared(h, rt, scratch, ['/bin/sleep', '30']);
    sandboxId = sb.sandboxId; id = sb.id;
    pause = h.owned.armPause(1); // the first inspect-by-id after this point is start()'s last pre-launch read
    starting = settle(rt.start(sandboxId));
    await bounded(pause.reached, waitMs, 'start() to reach its pre-launch inspect');
    assert.equal(h.owned.count('start'), 0, 'paused before any launch');
    const res = await bounded(rt[op](sandboxId), settleMs, `runtime.${op}`);
    const want = op === 'stop' ? 'STOPPED' : 'DESTROYED';
    if (res?.state !== want) throw new UnknownOutcomeError(`${op} was not confirmed (${res?.state}/${res?.code ?? ''}); termination is uncertain`);
    assert.equal(h.owned.count('start'), 0, `still no launch after ${op} was confirmed`);
    pause.release();
    const settled = await bounded(starting, settleMs, 'the paused start() to settle');
    if (!settled.ok) throw settled.e;
    const out = settled.v;
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
  } catch (error) { failure = error; }
  // ---- guaranteed, whatever happened above ----
  pause?.release();
  if (starting) {
    try { const settled = await bounded(starting, settleMs, 'the pending start() to settle after release'); if (!settled.ok && !failure) failure = settled.e; } catch (error) { strandedStart = true; failure ??= error; }
  }
  const leftovers = await closeOut(h, { runtime: rt, sandboxId, scratch });
  if (leftovers.length || strandedStart) throw new UnknownOutcomeError(`${op} scenario: ${leftovers.length ? `owned container(s) not confirmed absent (${leftovers.join(',')}); ` : ''}${strandedStart ? 'a pending start() never settled; ' : ''}local state preserved${failure ? ` (first failure: ${String(failure.message).slice(0, 120)})` : ''}`);
  if (failure) throw failure;
  if (id) await gone(h, id, 'after cleanup');
}

/** `docker start` has already been issued: stop must wait (bounded) for the launch to settle and must leave nothing running. */
export async function issuedLaunchStop(h) {
  const scratch = h.newScratch();
  const lr = h.longRun();
  let id; let sandboxId; let starting = null; let failure = null;
  try {
    const sb = await prepared(h, h.runtime, scratch, ['/bin/sleep', '30']);
    id = sb.id; sandboxId = sb.sandboxId;
    starting = settle(h.runtime.start(sb.sandboxId));
    await waitFor(() => h.owned.count('start') === 1, { what: 'the docker start to be issued' });
    const t0 = Date.now();
    const res = await bounded(h.runtime.stop(sb.sandboxId), 20_000, 'runtime.stop');
    if (res.state !== 'STOPPED') throw new UnknownOutcomeError(`stop was not confirmed (${res.state}/${res.code ?? ''})`);
    assert.ok(Date.now() - t0 < 20_000, 'bounded wait');
    assert.equal(res.evidence[0].kind, 'sandbox_stopped'); assert.equal(res.evidence[0].grade, 'LOCALLY_VERIFIED'); assert.equal(res.evidence[0].data.containerId, id);
    const settled = await bounded(starting, 20_000, 'the start() to settle after stop');
    if (settled.ok) assert.ok(['EXITED', 'UNKNOWN', 'BLOCKED'].includes(settled.v.state));
    for (let i = 0; i < 4; i += 1) { // no late launch: still not running 1 second later
      const st = await h.owned.realState(id);
      assert.equal(st?.state.Running, false, `observation ${i}: not running`);
      await sleep(h.real ? 300 : 10);
    }
    assert.equal(h.owned.count('start'), 1, 'exactly the one launch that was issued before the stop');
  } catch (error) { failure = error; }
  lr.release();
  const leftovers = await closeOut(h, { runtime: h.runtime, sandboxId, scratch });
  assertClosed(leftovers, 'issued-launch stop');
  if (starting) { try { await bounded(starting, 15_000, 'start() after cleanup'); } catch (error) { failure ??= new UnknownOutcomeError(`a pending start() never settled: ${error.message}`); } }
  if (failure) throw failure;
  if (id) await gone(h, id, 'after cleanup');
}

/** FAULT-INJECTED: Docker is not told to stop (stop/kill swallowed). The container really keeps running => UNKNOWN. */
export async function unconfirmedStop(h) {
  const scratch = h.newScratch();
  const lr = h.longRun();
  const rt = h.newRuntime({ launchSettleMs: 700 });
  let id; let sandboxId; let starting = null; let failure = null;
  try {
    const sb = await prepared(h, rt, scratch, ['/bin/sleep', '30']);
    id = sb.id; sandboxId = sb.sandboxId;
    starting = settle(rt.start(sb.sandboxId));
    await waitFor(() => h.owned.count('start') === 1, { what: 'the docker start to be issued' });
    await waitFor(async () => (await h.owned.realState(id))?.state.Running === true, { what: 'the container to be running' });
    h.owned.swallow = new Set(['stop', 'kill']);
    const res = await bounded(rt.stop(sb.sandboxId), 20_000, 'runtime.stop');
    assert.ok(h.owned.swallowed > 0, 'FAULT-INJECTED: stop/kill were swallowed');
    assert.equal(res.state, 'UNKNOWN'); assert.equal(res.code, 'STOP_NOT_CONFIRMED');
    assert.deepEqual(res.evidence, [], 'no stopped evidence for an unconfirmed stop');
    assert.equal((await h.owned.realState(id))?.state.Running, true, 'REAL: the container really is still running');
  } catch (error) { failure = error; }
  h.owned.swallow = new Set();
  const leftovers = await closeOut(h, { runtime: rt, sandboxId, scratch });
  lr.release();
  if (starting) { try { await bounded(starting, 15_000, 'start() after forced removal'); } catch (error) { failure ??= new UnknownOutcomeError(`a pending start() never settled: ${error.message}`); } }
  assertClosed(leftovers, 'unconfirmed-stop scenario');
  if (failure) throw failure;
  if (id) await gone(h, id, 'after cleanup');
}

/** FAULT-INJECTED: `rm` swallowed, so the container really is still present => destroy is UNKNOWN. */
export async function unconfirmedDestroy(h) {
  const scratch = h.newScratch();
  let id; let sandboxId; let failure = null;
  try {
    const sb = await prepared(h, h.runtime, scratch, ['/bin/true']);
    id = sb.id; sandboxId = sb.sandboxId;
    h.owned.swallow = new Set(['rm']);
    const res = await bounded(h.runtime.destroy(sb.sandboxId), 20_000, 'runtime.destroy');
    assert.ok(h.owned.swallowed > 0, 'FAULT-INJECTED: rm was swallowed');
    assert.equal(res.state, 'UNKNOWN'); assert.equal(res.code, 'DESTROY_NOT_CONFIRMED');
    assert.equal(await h.owned.existence(id), 'PRESENT', 'REAL: the container is still there, so DESTROYED would have been false');
  } catch (error) { failure = error; }
  h.owned.swallow = new Set();
  const leftovers = await closeOut(h, { runtime: h.runtime, sandboxId, scratch });
  assertClosed(leftovers, 'unconfirmed-destroy scenario');
  if (failure) throw failure;
  if (id) await gone(h, id, 'after cleanup');
}

// =====================================================================================================================
// GAP 3 — raw execution readback for the agent role
// =====================================================================================================================

const isDockerTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) > 0;

/** REAL daemon readback of a normally exiting agent-role container: every field present, correctly typed and consistent. */
export async function rawReadbackReal(h) {
  const scratch = h.newScratch();
  let id; let sandboxId; let failure = null;
  try {
    const sb = await prepared(h, h.runtime, scratch, ['/bin/true']);
    id = sb.id; sandboxId = sb.sandboxId;
    const out = await bounded(h.runtime.start(sb.sandboxId), 30_000, 'runtime.start');
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
  } catch (error) { failure = error; }
  const leftovers = await closeOut(h, { runtime: h.runtime, sandboxId, scratch });
  assertClosed(leftovers, 'raw readback scenario');
  if (failure) throw failure;
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
  let failure = null;
  const preserved = [];
  for (const [label, damage] of Object.entries(DAMAGE)) {
    const scratch = h.newScratch();
    h.setEffect(() => {});
    const before = h.owned.faultsApplied;
    h.owned.faults = damage; // FAULT-INJECTED
    try {
      const sp = { taskId: TASK_A, runId: h.reserveRun(newRunId()), worktreePath: scratch.wt, fixturePath: fixtureOf(TASK_A) };
      const r = await h.newAdapter(h.newRuntime({ launchSettleMs: 3000 })).start(sp, () => {});
      assert.ok(h.owned.faultsApplied > before, `${label}: FAULT-INJECTED response was delivered`);
      assert.equal(r.outcome, 'unknown', `${label}: ${JSON.stringify({ outcome: r.outcome, reason: r.reason })}`);
      assert.equal(r.exitCode, null, label);
      assert.ok(!r.container.evidence.some((e) => e.kind === 'sandbox_started'), `${label}: no sandbox_started evidence`);
      assert.ok(!JSON.stringify(r.container.evidence).includes('"oomKilled":false'), `${label}: an unknown OOM flag was never recorded as false`);
      results.push(label);
    } catch (error) { failure = error; } finally {
      h.owned.faults = null;
      const leftovers = await closeOut(h, { scratch });
      if (leftovers.length) preserved.push(...leftovers);
    }
    if (failure || preserved.length) break; // never continue to another live case after a failure or an uncertain cleanup
  }
  assertClosed(preserved, 'readback fault matrix');
  if (failure) throw failure;
  assert.equal(results.length, Object.keys(DAMAGE).length);
}
