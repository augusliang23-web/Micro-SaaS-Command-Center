import { EVIDENCE_GRADES } from '../tasks/types.mjs';

/**
 * Provider-neutral agent adapter contract (Phase 3A; internal, unwired).
 *
 *   id:      string
 *   probe(): Promise<AdapterProbe>                 // never throws for "unavailable"
 *   start(spec, emit): Promise<RunResult>          // spec is server-built; emit(AgentEvent)
 *   cancel(runId): Promise<{terminated:boolean}>   // resolves only after process exit is observed
 *
 * Adapters do NOT own git, commits, PRs, verification, task state or review
 * state. They report what the runtime did; the Orchestrator owns evidence
 * grades above RUNTIME_OBSERVED.
 */

export const AGENT_EVENT_TYPES = Object.freeze(['started', 'output', 'tool', 'usage', 'denied', 'error', 'raw', 'finished']);
export const RUN_OUTCOMES = Object.freeze(['completed', 'failed', 'cancelled', 'blocked', 'unknown']);
export const UNKNOWN_MODEL = 'UNKNOWN';

/**
 * The only place an adapter event gets an evidence grade. The grade depends on
 * the event TYPE chosen by adapter code, never on anything the agent wrote, so
 * an agent cannot select (or inflate) its own grade. The ceiling for any
 * adapter event is RUNTIME_OBSERVED; agent prose is AGENT_CLAIM.
 */
export function gradeForEvent(type) {
  return type === 'output' ? 'AGENT_CLAIM' : 'RUNTIME_OBSERVED';
}

export const ADAPTER_GRADE_CEILING = 'RUNTIME_OBSERVED';
export function isWithinAdapterCeiling(grade) {
  const rank = EVIDENCE_GRADES.indexOf(grade);
  return rank >= 0 && grade !== 'UNKNOWN' && rank <= EVIDENCE_GRADES.indexOf(ADAPTER_GRADE_CEILING);
}

/** @typedef {{ structuredEvents:boolean, streaming:'message'|'token'|'none', cancellation:'signal'|'graceful'|'none',
 *   modelSelection:boolean, usageTelemetry:'tokens'|'none', costTelemetry:'none'|'estimated'|'authoritative',
 *   sandbox:'tool-policy'|'os'|'none', editOnly:boolean, shell:boolean, git:boolean, network:boolean }} AdapterCapabilities */

const CAPABILITY_KEYS = ['structuredEvents', 'streaming', 'cancellation', 'modelSelection', 'usageTelemetry', 'costTelemetry', 'sandbox', 'editOnly', 'shell', 'git', 'network'];

/** Structural check of a probe result; returns problems. */
export function validateProbe(probe) {
  const problems = [];
  if (!probe || typeof probe !== 'object') return ['probe must be an object'];
  if (typeof probe.id !== 'string' || !probe.id) problems.push('id is required');
  if (typeof probe.available !== 'boolean') problems.push('available must be boolean');
  if (probe.available === false && typeof probe.reason !== 'string') problems.push('unavailable probe needs a reason');
  if (probe.available === true) {
    if (typeof probe.version !== 'string' || !probe.version) problems.push('version is required when available');
    for (const key of CAPABILITY_KEYS) if (!(key in (probe.capabilities ?? {}))) problems.push(`capabilities.${key} is missing`);
  }
  return problems;
}
