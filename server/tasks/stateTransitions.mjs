// Canonical task transitions. Retries and approval continuations are not in V1.
const errors = ['BLOCKED', 'FAILED', 'CANCELLED', 'UNKNOWN'];
export const TASK_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['QUEUED', 'BLOCKED', 'FAILED', 'CANCELLED']),
  QUEUED: Object.freeze(['STARTING', ...errors]),
  STARTING: Object.freeze(['RUNNING', ...errors]),
  RUNNING: Object.freeze(['VERIFYING', ...errors]),
  VERIFYING: Object.freeze(['COMPLETED', ...errors]),
  COMPLETED: Object.freeze([]), FAILED: Object.freeze([]), BLOCKED: Object.freeze([]),
  CANCELLED: Object.freeze([]), UNKNOWN: Object.freeze([]),
});
export function assertTaskTransition(from, to) {
  if (!Object.hasOwn(TASK_TRANSITIONS, from) || !Object.hasOwn(TASK_TRANSITIONS, to) || (from !== to && !TASK_TRANSITIONS[from].includes(to))) {
    throw new Error(`Illegal task transition: ${String(from)} → ${String(to)}`);
  }
}
