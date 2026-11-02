// ZC-MVP-B1 Local Bridge core: single-slot executor (mock-only).
// Issue #119. OFFLINE: runs only an injected adapter, which in B1 can only be
// the Mock Adapter driving a fake child inside a mkdtemp fixture.
//
// One run walks the state machine in ./state-machine.mjs. Every state change is
// persisted by the journal (fsync) BEFORE the next side effect starts:
//   gates -> claim(nonce burned) -> workspace -> RUNNING persisted -> adapter
//   -> tripwire -> classify -> scope check -> report -> READY_FOR_REVIEW
// Nothing in a request can supply a command, an argument or an executable.
// The result always states: no dispatch, no provider call, no GitHub write, no
// Mac settings write, never ready to merge.
// Provenance: new design for ZC-MVP-B1 (Issue #118 sections 4.2/5.2/6.5).
import fs from 'node:fs';
import path from 'node:path';
import {BridgeError, fail, exact, isRecord, digest} from './state-machine.mjs';
import {TASK_ID} from './journal.mjs';
import {
  validateScopePaths, takeSnapshot, compareSnapshots, fileDigest,
} from './scope-guard.mjs';
import {
  assertFixtureRoot, safeEnvironment, supervisedRun, SUPERVISOR_LIMITS,
} from './process-supervisor.mjs';

const NONCE = /^[a-f0-9]{32}$/;
const SEED_PATH = /^[A-Za-z0-9._/-]{1,170}$/;
const REQUEST_KEYS = ['task_id', 'attempt', 'max_attempts', 'nonce', 'risk_level',
  'scope_paths', 'timeout_ms', 'seed'];
const SAFETY = Object.freeze({
  mode: 'MOCK_ONLY_OFFLINE', simulated: true, actual_dispatch: false,
  provider_calls: 0, github_writes: 0, mac_settings_writes: 0,
  ready_to_merge: false, owner_approval_required: true,
});

const result = (state, reason, extra = {}) => Object.freeze({
  ...SAFETY, state, reason, claimed: false, attempt: null, changed_files: [],
  violations: [], evidence_digest: null, ...extra,
});

// Returns {ok:true, req} or {ok:false, state, reason}. Risk above "medium" is a
// REJECTED outcome; every other shape problem is also REJECTED (never claimed).
function validateRequest(req) {
  if (!exact(req, REQUEST_KEYS)) return {ok: false, reason: 'INVALID_REQUEST'};
  if (typeof req.task_id !== 'string' || req.task_id.length > 72 || !TASK_ID.test(req.task_id))
    return {ok: false, reason: 'INVALID_REQUEST'};
  if (!Number.isInteger(req.max_attempts) || req.max_attempts < 1 || req.max_attempts > 3 ||
      !Number.isInteger(req.attempt) || req.attempt < 1 || req.attempt > req.max_attempts)
    return {ok: false, reason: 'INVALID_REQUEST'};
  if (typeof req.nonce !== 'string' || !NONCE.test(req.nonce))
    return {ok: false, reason: 'INVALID_REQUEST'};
  if (req.risk_level === 'high') return {ok: false, reason: 'RISK_NOT_ALLOWED'};
  if (req.risk_level !== 'low' && req.risk_level !== 'medium')
    return {ok: false, reason: 'INVALID_REQUEST'};
  try { validateScopePaths(req.scope_paths); }
  catch (e) { return {ok: false, reason: e.code ?? 'INVALID_REQUEST'}; }
  if (!Number.isInteger(req.timeout_ms) || req.timeout_ms < SUPERVISOR_LIMITS.minTimeoutMs ||
      req.timeout_ms > SUPERVISOR_LIMITS.maxTimeoutMs)
    return {ok: false, reason: 'INVALID_REQUEST'};
  if (!isRecord(req.seed) || Object.keys(req.seed).length > 16)
    return {ok: false, reason: 'INVALID_REQUEST'};
  for (const [p, content] of Object.entries(req.seed)) {
    const segs = p.split('/');
    if (!SEED_PATH.test(p) || segs.some(s => s === '' || s === '.' || s === '..') ||
        typeof content !== 'string' || content.length > 65536)
      return {ok: false, reason: 'INVALID_REQUEST'};
  }
  return {ok: true, req};
}

export class Executor {
  #fixtureRoot; #journal; #control; #adapter; #reporter; #clock;
  #sentinels; #quotaBreakerMs; #busy = false;

  constructor({fixtureRoot, journal, control, adapter, reporter, clock = () => new Date(),
    sentinels = [], quotaBreakerMs = 3600000} = {}) {
    assertFixtureRoot(fixtureRoot);
    if (!journal || !control || !adapter || !reporter) fail('EXECUTOR_CONFIG_INVALID');
    if (!Array.isArray(sentinels) || sentinels.length > 8 ||
        sentinels.some(s => typeof s !== 'string' || !path.isAbsolute(s) ||
          !s.startsWith(fixtureRoot + path.sep)))
      fail('EXECUTOR_CONFIG_INVALID');
    if (!Number.isInteger(quotaBreakerMs) || quotaBreakerMs < 1000) fail('EXECUTOR_CONFIG_INVALID');
    this.#fixtureRoot = fixtureRoot;
    this.#journal = journal;
    this.#control = control;
    this.#adapter = adapter;
    this.#reporter = reporter;
    this.#clock = clock;
    this.#sentinels = [...sentinels];
    this.#quotaBreakerMs = quotaBreakerMs;
  }

  async run(request) {
    // Concurrency is exactly 1 per executor; the journal enforces it across
    // executors and restarts (BRIDGE_BUSY / RECONCILE_REQUIRED_BLOCKS_CLAIM).
    if (this.#busy) return result('HELD', 'EXECUTOR_BUSY');
    this.#busy = true;
    try { return await this.#run(request); }
    catch (e) {
      // Unknown failure after a claim is uncertain; the journal (and its lock,
      // if a write was in flight) keeps the evidence. Never leak error text.
      return result('HELD', e instanceof BridgeError ? e.code : 'INTERNAL_ERROR',
        {journal_uncertain: true});
    } finally { this.#busy = false; }
  }

  async #run(request) {
    // 1. Local control and breaker gates: before any validation side effect.
    const ctl = this.#control.status();
    if (ctl.stop) return result('HELD', ctl.unsafe ? 'CONTROL_UNSAFE' : 'CONTROL_STOP');
    if (ctl.pause) return result('HELD', 'CONTROL_PAUSE');
    if (this.#control.quotaBreakerOpen(new Date(this.#clock()).toISOString()))
      return result('HELD', 'QUOTA_BREAKER_OPEN');

    // 2. Request validation (the only task data that reaches this module).
    const v = validateRequest(request);
    if (!v.ok) return result('REJECTED', v.reason);
    const req = v.req;
    const scope = validateScopePaths(req.scope_paths);

    // 3. Durable claim: nonce burned, CLAIMED fsynced.
    let rec;
    try {
      rec = this.#journal.claim({
        task_id: req.task_id, attempt: req.attempt,
        max_attempts: req.max_attempts, nonce: req.nonce,
      });
    } catch (e) {
      return result('HELD', e instanceof BridgeError ? e.code : 'CLAIM_FAILED');
    }
    let seq = rec.sequence;
    const tag = `${req.task_id}-${req.attempt}`;
    const step = (event, reason = null) => {
      const t = this.#journal.transition(req.task_id, req.attempt, seq, event, {reason});
      seq = t.record.sequence;
      return t;
    };
    const done = (state, reason, extra = {}) => result(state, reason,
      {claimed: true, attempt: req.attempt, ...extra});

    // 4. Workspace + baseline + tripwire digests.
    const workspace = path.join(this.#fixtureRoot, `workspace-${tag}`);
    step('PREPARE');
    let before;
    let sentinelBefore;
    try {
      fs.mkdirSync(workspace, {mode: 0o700});
      fs.chmodSync(workspace, 0o700);
      for (const [rel, content] of Object.entries(req.seed)) {
        const target = path.join(workspace, rel);
        fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
        fs.writeFileSync(target, content, {flag: 'wx', mode: 0o600});
      }
      before = takeSnapshot(workspace);
      sentinelBefore = this.#sentinels.map(s => fileDigest(s));
    } catch {
      step('PREP_FAILED', 'WORKSPACE_PREP_FAILED');
      return done('FAILED_PREP', 'WORKSPACE_PREP_FAILED');
    }

    // 5. RUNNING is durable before the adapter can do anything.
    step('PREPARED');

    // 6. Adapter run under the supervisor. STOP aborts it.
    const timeoutMs = req.timeout_ms;
    const supervise = async ({scriptSource, args = []}) => {
      if (typeof scriptSource !== 'string' || scriptSource.length > SUPERVISOR_LIMITS.maxScriptBytes)
        fail('ADAPTER_SCRIPT_INVALID');
      const script = path.join(this.#fixtureRoot, `child-${tag}.mjs`);
      fs.writeFileSync(script, scriptSource, {flag: 'wx', mode: 0o600});
      return supervisedRun({
        command: process.execPath, args: [script, ...args], cwd: workspace,
        env: safeEnvironment({tmp: this.#fixtureRoot}), fixtureRoot: this.#fixtureRoot,
        timeoutMs, shouldAbort: () => this.#control.status().stop,
      });
    };
    let report;
    try {
      report = await this.#adapter.start(
        {task_id: req.task_id, attempt: req.attempt, workspace, fixtureRoot: this.#fixtureRoot},
        {supervise});
    } catch {
      step('ADAPTER_FAILURE', 'ADAPTER_THREW');
      return done('FAILED_ADAPTER', 'ADAPTER_THREW');
    }
    const adapterInfo = {adapter: report?.adapter ?? null, outcome: report?.outcome ?? null};

    // 7. Tripwire first: a changed sentinel outranks every other outcome.
    const sentinelAfter = this.#sentinels.map(s => fileDigest(s));
    if (sentinelAfter.some((d, i) => d !== sentinelBefore[i])) {
      this.#control.requestStop('TRIPWIRE');
      step('STOP', 'TRIPWIRE');
      return done('STOPPED', 'TRIPWIRE', {adapter: adapterInfo});
    }
    const outcome = report?.outcome;
    if (outcome === 'aborted' || (outcome === 'completed' && this.#control.status().stop)) {
      step('STOP', 'CONTROL_STOP');
      return done('STOPPED', 'CONTROL_STOP', {adapter: adapterInfo});
    }
    if (outcome === 'unconfirmed_exit') {
      step('RECONCILE', 'PROCESS_EXIT_UNCONFIRMED');
      return done('RECONCILE_REQUIRED', 'PROCESS_EXIT_UNCONFIRMED', {adapter: adapterInfo});
    }
    if (outcome === 'timeout') {
      step('TIMEOUT', 'TASK_TIMEOUT');
      return done('TIMED_OUT', 'TASK_TIMEOUT', {adapter: adapterInfo});
    }
    if (outcome === 'quota') {
      const until = new Date(new Date(this.#clock()).getTime() + this.#quotaBreakerMs).toISOString();
      this.#control.openQuotaBreaker(until);
      step('QUOTA', 'QUOTA_EXHAUSTED');
      return done('FAILED_QUOTA', 'QUOTA_EXHAUSTED', {adapter: adapterInfo});
    }
    if (outcome === 'denied') {
      step('ADAPTER_FAILURE', 'DENIED_ACTIONS');
      return done('FAILED_ADAPTER', 'DENIED_ACTIONS', {adapter: adapterInfo});
    }
    if (outcome !== 'completed') {
      const reason = outcome === 'crashed' ? 'ADAPTER_CRASHED'
        : outcome === 'protocol_error' ? 'ADAPTER_PROTOCOL_ERROR' : 'ADAPTER_FAILED';
      step('ADAPTER_FAILURE', reason);
      return done('FAILED_ADAPTER', reason, {adapter: adapterInfo});
    }

    // 8. Verify the workspace against the baseline and the allowlist.
    step('EXIT_CLEAN');
    let verdict;
    try {
      verdict = compareSnapshots(before, takeSnapshot(workspace), {allowed: scope});
    } catch {
      step('SCOPE_VIOLATION', 'SNAPSHOT_FAILED');
      this.#discard(workspace);
      return done('FAILED_SCOPE', 'SNAPSHOT_FAILED', {adapter: adapterInfo});
    }
    if (!verdict.ok) {
      step('SCOPE_VIOLATION', 'SCOPE_VIOLATION');
      this.#discard(workspace);
      return done('FAILED_SCOPE', 'SCOPE_VIOLATION',
        {violations: verdict.violations, adapter: adapterInfo});
    }
    step('VERIFIED');
    const evidence = digest({
      task_id: req.task_id, attempt: req.attempt, changed: verdict.changed,
      outcome: adapterInfo.outcome,
    });

    // 9. Report. A failing reporter defers; it never re-runs the task.
    const summary = {task_id: req.task_id, attempt: req.attempt, changed_files: verdict.changed,
      evidence_digest: evidence, simulated: true};
    try {
      await this.#reporter.report(summary);
    } catch {
      step('REPORT_DEFERRED', 'REPORT_PENDING');
      return done('REPORT_PENDING', 'REPORT_PENDING',
        {changed_files: verdict.changed, evidence_digest: evidence, adapter: adapterInfo});
    }
    step('REPORT_OK');
    return done('READY_FOR_REVIEW', 'MOCK_COMPLETE_FOR_REVIEW',
      {changed_files: verdict.changed, evidence_digest: evidence, adapter: adapterInfo});
  }

  // Discards only a directory this run created directly under the fixture root.
  #discard(workspace) {
    try {
      const st = fs.lstatSync(workspace);
      if (st.isDirectory() && !st.isSymbolicLink() &&
          path.dirname(workspace) === this.#fixtureRoot)
        fs.rmSync(workspace, {recursive: true, force: true});
    } catch { /* leave it for the operator; the state is already terminal */ }
  }
}
