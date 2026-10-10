// Canonical task transitions. Retries are not in V1. Phase 3B7B2B-A1-0 adds the AWAITING_APPROVAL / PUBLISHING states and their legal
// moves as DATA ONLY: nothing in this phase performs a resume. VERIFYING -> COMPLETED (the default V1 flow) is unchanged.
const errors = ['BLOCKED', 'FAILED', 'CANCELLED', 'UNKNOWN'];
export const TASK_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['QUEUED', 'BLOCKED', 'FAILED', 'CANCELLED']),
  QUEUED: Object.freeze(['STARTING', ...errors]),
  STARTING: Object.freeze(['RUNNING', ...errors]),
  RUNNING: Object.freeze(['VERIFYING', ...errors]),
  VERIFYING: Object.freeze(['COMPLETED', 'AWAITING_APPROVAL', ...errors]),
  // Paused for a human decision. No execution is live. Not cancellable once PUBLISHING starts (Git steps are not interruptible).
  AWAITING_APPROVAL: Object.freeze(['PUBLISHING', 'BLOCKED', 'CANCELLED', 'UNKNOWN']),
  PUBLISHING: Object.freeze(['AWAITING_APPROVAL', 'COMPLETED', 'BLOCKED', 'FAILED', 'UNKNOWN']),
  COMPLETED: Object.freeze([]), FAILED: Object.freeze([]), BLOCKED: Object.freeze([]),
  CANCELLED: Object.freeze([]), UNKNOWN: Object.freeze([]),
});
export function assertTaskTransition(from, to) {
  if (!Object.hasOwn(TASK_TRANSITIONS, from) || !Object.hasOwn(TASK_TRANSITIONS, to) || (from !== to && !TASK_TRANSITIONS[from].includes(to))) {
    throw new Error(`Illegal task transition: ${String(from)} → ${String(to)}`);
  }
}
