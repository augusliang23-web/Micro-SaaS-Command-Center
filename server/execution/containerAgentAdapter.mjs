import { BoundaryError } from './executionPolicy.mjs';
import { FAKE_AGENT_IMAGE_ALIAS } from '../sandbox/fakeAgentImages.mjs';
import { RUN_ID_PATTERN, TASK_ID_PATTERN } from '../tasks/types.mjs';

/**
 * Phase 3B7B1 container adapter foundation — FAKE AGENT ONLY.
 *
 * Runs a scripted, server-built command inside the existing DockerSandboxRuntime (role `agent`, NO_NETWORK, digest-pinned
 * allowlisted image, non-root, read-only root, no capabilities, one non-recursive workspace bind). There is no AI, no credential,
 * no provider network and no Git authority in the container. The host owns git, commit, push, PR, verification, task state and
 * every evidence grade above RUNTIME_OBSERVED. A real Claude Code or Codex agent is NOT supported here.
 *
 * Contract (provider-neutral agent adapter): probe() / start(spec, emit) / cancel(runId).
 * start() resolves with { exitCode, outcome, reason, cleanup, container: { id, evidence } }. Only outcome `completed` with exitCode 0 and a CONFIRMED
 * cleanup is success; timeout, cancellation, ambiguity, an unconfirmed stop or an unconfirmed destroy are never success.
 */

export const REAL_AGENT_EXECUTION = 'NOT_AUTHORIZED';
export const ADAPTER_ID = 'docker-fake';
export const FAKE_SCENARIOS = Object.freeze(['edit-fixture', 'noop', 'sleep', 'flood']);
/** The only evidence kinds an adapter may hand to the Orchestrator; each must carry grade LOCALLY_VERIFIED from the runtime's own readback. */
export const CONTAINER_EVIDENCE_KINDS = Object.freeze(['sandbox_policy', 'sandbox_created', 'sandbox_started', 'sandbox_stopped', 'sandbox_destroyed']);
export const OUTCOMES = Object.freeze(['completed', 'failed', 'cancelled', 'unknown']);

const SPEC_KEYS = ['taskId', 'runId', 'worktreePath', 'fixturePath'];
const LIMIT_KEYS = ['cpus', 'memoryMb', 'pids', 'timeoutMs', 'outputBytes'];
const CTOR_KEYS = ['runtime', 'scenario', 'image', 'limits'];
const MAX_EVENT_LINES = 200;
const MAX_LINE_CHARS = 300;
const SECRET_LIKE = /(sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|bearer\s+[A-Za-z0-9._~+/=-]{6,}|(?:token|secret|passw(?:or)?d|api[_-]?key|authorization)\s*[=:]\s*(?:(?:bearer|basic)\s+)?\S+)/gi;
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Output from a container is data, never authority: strip control characters, redact secret-like text and host paths, bound size. */
export function sanitizeLine(line, hostPaths = []) {
  let text = typeof line === 'string' ? line : String(line);
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  for (const p of hostPaths) if (typeof p === 'string' && p.length > 3) text = text.split(p).join('<host-path>');
  text = text.replace(SECRET_LIKE, '[REDACTED]');
  return text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text;
}

/** Scenario → command. The container command is server-built plain data; task, prompt and browser never supply it. */
export function buildScenarioCommand(scenario, { taskId, fixturePath }) {
  if (!FAKE_SCENARIOS.includes(scenario)) throw new BoundaryError('Unknown fake-agent scenario');
  if (scenario === 'edit-fixture') {
    // taskId and fixturePath are validated patterns and are passed as separate argv entries, never interpolated into the script.
    return ['/bin/sh', '-c', 'mkdir -p /workspace/agent-console-fixture && printf "Task %s\\nDeterministic Fake Adapter fixture\\n" "$1" > "/workspace/$2"', 'fake-agent', taskId, fixturePath];
  }
  if (scenario === 'noop') return ['/bin/true'];
  if (scenario === 'sleep') return ['/bin/sleep', '3600'];
  return ['/bin/sh', '-c', 'yes'];
}

export class ContainerFakeAgentAdapter {
  id = ADAPTER_ID;
  #runtime; #scenario; #image; #limits; #runs = new Map();

  constructor(options = {}) {
    if (!isRecord(options)) throw new Error('Options must be an object');
    const unknown = Object.keys(options).filter((k) => !CTOR_KEYS.includes(k));
    if (unknown.length > 0) throw new Error(`Unknown adapter option(s): ${unknown.join(', ')}`); // no env, mounts, docker args, commands or agent names
    const { runtime, scenario = 'edit-fixture', image = FAKE_AGENT_IMAGE_ALIAS, limits = {} } = options;
    if (!runtime || typeof runtime.prepare !== 'function' || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function' || typeof runtime.destroy !== 'function' || typeof runtime.probe !== 'function') throw new Error('A sandbox runtime is required');
    if (!FAKE_SCENARIOS.includes(scenario)) throw new Error('Unknown fake-agent scenario');
    if (image !== FAKE_AGENT_IMAGE_ALIAS) throw new Error('Only the fake-agent image alias is allowed');
    if (!isRecord(limits) || Object.keys(limits).some((k) => !LIMIT_KEYS.includes(k))) throw new Error('Unknown limit field');
    this.#runtime = runtime; this.#scenario = scenario; this.#image = image; this.#limits = Object.freeze({ ...limits });
  }

  /** Never throws for "unavailable". Capabilities describe what this adapter permits, not what an agent claims. */
  async probe() {
    const base = { id: ADAPTER_ID };
    let engine;
    try { engine = await this.#runtime.probe(); } catch { return { ...base, available: false, reason: 'DOCKER_PROBE_FAILED' }; }
    if (!engine?.available) return { ...base, available: false, reason: engine?.reason ?? 'DOCKER_UNAVAILABLE' };
    if (engine.images?.[this.#image]?.present !== true) return { ...base, available: false, reason: engine.images?.[this.#image]?.reason ?? 'IMAGE_UNAVAILABLE' };
    return {
      ...base, available: true, version: 'docker-fake-v1',
      capabilities: {
        structuredEvents: false, streaming: 'message', cancellation: 'graceful', modelSelection: false, usageTelemetry: 'none', costTelemetry: 'none',
        sandbox: 'os', editOnly: true, shell: false, git: false, network: false,
      },
    };
  }

  async start(spec, emit = () => {}) {
    if (!isRecord(spec) || Object.keys(spec).some((k) => !SPEC_KEYS.includes(k)) || SPEC_KEYS.some((k) => !Object.hasOwn(spec, k))) throw new BoundaryError('Container adapter spec must be exactly { taskId, runId, worktreePath, fixturePath }');
    if (!TASK_ID_PATTERN.test(spec.taskId) || !RUN_ID_PATTERN.test(spec.runId)) throw new BoundaryError('Malformed task or run identity');
    if (spec.fixturePath !== `agent-console-fixture/${spec.taskId}.txt`) throw new BoundaryError('Fixture path does not match the task');
    if (typeof spec.worktreePath !== 'string') throw new BoundaryError('Worktree path must be a string');
    if (this.#runs.has(spec.runId)) throw new BoundaryError('This run is already tracked');
    const run = { runId: spec.runId, sandboxId: spec.runId, state: 'PREPARING', cancelRequested: false, stopConfirmed: false, terminated: false, cleanup: null, evidence: [] };
    this.#runs.set(spec.runId, run);
    const hostPaths = [spec.worktreePath];
    let lines = 0;
    const out = (message) => { if (lines++ < MAX_EVENT_LINES) emit({ type: 'output', message: sanitizeLine(message, hostPaths) }); };
    const keep = (result) => { if (Array.isArray(result?.evidence)) run.evidence.push(...result.evidence); return result; };
    let outcome = 'unknown'; let exitCode = null; let reason = 'NOT_RUN'; let blocked = null;
    try {
      const command = buildScenarioCommand(this.#scenario, spec);
      const prepared = keep(await this.#runtime.prepare({
        sandboxId: run.sandboxId, role: 'agent', worktreePath: spec.worktreePath, command,
        policy: { network: 'NO_NETWORK', image: this.#image, writablePaths: ['/workspace', '/tmp'], ...this.#limits },
      }));
      if (prepared.state === 'BLOCKED') { blocked = `${prepared.code}: ${prepared.reason}`; reason = prepared.code; }
      else if (prepared.state !== 'PREPARED') { reason = prepared.code ?? 'PREPARE_UNCONFIRMED'; }
      else if (!prepared.evidence?.some((e) => e.kind === 'sandbox_policy' && e.grade === 'LOCALLY_VERIFIED')) { reason = 'POLICY_EVIDENCE_MISSING'; }
      else if (run.cancelRequested) { outcome = 'cancelled'; reason = 'CANCELLED_BEFORE_START'; }
      else {
        run.state = 'RUNNING';
        emit({ type: 'started' });
        const started = keep(await this.#runtime.start(run.sandboxId, { onLine: out }));
        // Cancelled only when the stop of the exact container was confirmed (or it demonstrably exited); an unconfirmed stop is UNKNOWN.
        if (run.cancelRequested && (run.stopConfirmed || started.state === 'EXITED')) { outcome = 'cancelled'; reason = 'CANCELLED'; }
        else if (started.state === 'BLOCKED') { blocked = `${started.code}: ${started.reason ?? 'blocked'}`; reason = started.code; }
        else if (started.state !== 'EXITED') { reason = started.code ?? 'EXECUTION_UNCONFIRMED'; }
        else if (started.outcome === 'TIMED_OUT') { outcome = 'failed'; reason = 'TIMEOUT'; }
        else if (started.outcome === 'OUTPUT_LIMIT') { outcome = 'failed'; reason = 'OUTPUT_LIMIT'; }
        else if (started.oomKilled === true) { outcome = 'failed'; reason = 'OOM_KILLED'; exitCode = started.exitCode; }
        else if (started.exitCode === 0) { outcome = 'completed'; exitCode = 0; reason = 'EXITED_ZERO'; }
        else { outcome = 'failed'; reason = 'NONZERO_EXIT'; exitCode = started.exitCode; }
      }
    } catch (error) {
      if (error instanceof BoundaryError) blocked = error.message; else { outcome = 'unknown'; reason = 'ADAPTER_ERROR'; }
    } finally {
      // Cleanup always runs, and a created container is never abandoned. Success requires the exact container to be confirmed gone.
      let destroyed;
      try { destroyed = keep(await this.#runtime.destroy(run.sandboxId)); } catch { destroyed = { state: 'UNKNOWN' }; }
      run.cleanup = destroyed.state === 'DESTROYED' ? 'CONFIRMED' : 'NOT_CONFIRMED';
      run.terminated = run.cleanup === 'CONFIRMED';
      run.state = 'DONE';
    }
    if (run.cleanup !== 'CONFIRMED') {
      // The exact container may still exist: whatever else happened, this run can never be reported as a clean success.
      reason = `CLEANUP_NOT_CONFIRMED(${reason})`;
      if (outcome === 'completed') outcome = 'unknown';
    }
    if (outcome !== 'completed' && outcome !== 'failed') exitCode = null;
    if (outcome === 'failed' && !Number.isInteger(exitCode)) exitCode = null;
    emit({ type: 'finished', exitCode });
    if (blocked) {
      const err = new BoundaryError(`Container adapter blocked: ${sanitizeLine(blocked, hostPaths)}`);
      err.cleanup = run.cleanup; err.containerEvidence = run.evidence;
      throw err;
    }
    return { exitCode, outcome, reason, cleanup: run.cleanup, container: { id: run.sandboxId, evidence: run.evidence } };
  }

  /** Resolves `terminated: true` only after the exact container's stop (or prior destruction) was confirmed. */
  async cancel(runId) {
    const run = this.#runs.get(runId);
    if (!run) return { terminated: false, state: 'UNKNOWN', reason: 'NOT_TRACKED' };
    run.cancelRequested = true;
    if (run.state === 'DONE') return { terminated: run.terminated, already: true, ...(run.terminated ? {} : { state: 'UNKNOWN', reason: 'CLEANUP_NOT_CONFIRMED' }) };
    if (run.state === 'PREPARING') return { terminated: false, state: 'PENDING', reason: 'CANCEL_RECORDED_BEFORE_START' };
    let stopped;
    try { stopped = await this.#runtime.stop(run.sandboxId); } catch { stopped = { state: 'UNKNOWN' }; }
    if (Array.isArray(stopped?.evidence)) run.evidence.push(...stopped.evidence);
    if (stopped?.state === 'STOPPED') run.stopConfirmed = true;
    return stopped?.state === 'STOPPED' ? { terminated: true } : { terminated: false, state: 'UNKNOWN', reason: stopped?.code ?? 'STOP_NOT_CONFIRMED' };
  }
}
