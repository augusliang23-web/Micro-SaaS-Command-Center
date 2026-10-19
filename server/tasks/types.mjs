// Agent Console domain contracts (Phase 1: data only, nothing here executes).
//
// Execution state, review decision and evidence are deliberately separate
// concepts: a COMPLETED task can have failing tests, and a PASS badge may only
// ever come from evidence graded LOCALLY_VERIFIED or higher.

import { classifyAction } from './actionPolicy.mjs';

export const AGENTS = Object.freeze(['claude-code', 'codex']);
// Internal run identities do not widen the browser-selectable task agents.
export const RUN_AGENTS = Object.freeze([...AGENTS, 'fake']);
export const EXECUTION_PROFILES = Object.freeze(['FAST', 'STANDARD', 'DEEP', 'CRITICAL']);
export const DEFAULT_EXECUTION_PROFILE = 'STANDARD';
export const RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);

export const TASK_STATUSES = Object.freeze([
  'DRAFT',
  'QUEUED',
  'STARTING',
  'RUNNING',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BLOCKED',
  'UNKNOWN',
]);
// States that claim an execution is live. Nothing persisted on disk can prove
// that after a restart, so these load as UNKNOWN.
export const ACTIVE_TASK_STATUSES = Object.freeze(['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING']);
export const REVIEW_DECISIONS = Object.freeze(['PENDING', 'APPROVED', 'CHANGES_REQUIRED', 'HOLD']);

export const RUN_STATUSES = Object.freeze(['STARTING', 'RUNNING', 'FINISHED', 'FAILED', 'CANCELLED', 'UNKNOWN']);

// Ordered weakest -> strongest. UNKNOWN is outside the ladder and never passes.
export const EVIDENCE_GRADES = Object.freeze([
  'AGENT_CLAIM',
  'RUNTIME_OBSERVED',
  'LOCALLY_VERIFIED',
  'GITHUB_VERIFIED',
  'EXTERNAL_AUTHORITATIVE',
  'UNKNOWN',
]);
export const EVIDENCE_KINDS = Object.freeze([
  'worktree_created',
  'branch_created',
  'files_changed',
  'command_result',
  'commit',
  'push',
  'pr',
  'guard_violation',
  'agent_report',
  'error',
  // Phase 3B7B1 Docker path. Sandbox kinds come only from authoritative container readback; approval kinds are at most RUNTIME_OBSERVED.
  'sandbox_policy',
  'sandbox_created',
  'sandbox_started',
  'sandbox_stopped',
  'sandbox_destroyed',
  'approval_required',
  'approval_consumed',
]);
const PASS_THRESHOLD = EVIDENCE_GRADES.indexOf('LOCALLY_VERIFIED');

export function canSupportPass(grade) {
  const rank = EVIDENCE_GRADES.indexOf(grade);
  return grade !== 'UNKNOWN' && rank >= PASS_THRESHOLD;
}

export const USAGE_GRADES = Object.freeze(['UNAVAILABLE', 'ESTIMATED', 'OBSERVED', 'AUTHORITATIVE']);

/** Usage when nothing trustworthy is known. Cost is null, never 0. */
export function unavailableUsage() {
  return { tokens: null, costUsd: null, grade: 'UNAVAILABLE' };
}

export const TASK_ID_PATTERN = /^CC-\d{8}-[0-9a-f]{8}$/;
export const RUN_ID_PATTERN = /^RUN-\d{8}-[0-9a-f]{8}$/;

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isIsoDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isCount = (value) => Number.isInteger(value) && value >= 0;

function fail(errors, message) {
  errors.push(message);
}

/**
 * @typedef {Object} DevelopmentTask
 * @property {string} taskId
 * @property {string} projectId
 * @property {string} workstream
 * @property {string} title
 * @property {string} goal
 * @property {'claude-code'|'codex'} agent
 * @property {'FAST'|'STANDARD'|'DEEP'|'CRITICAL'} executionProfile
 * @property {'LOW'|'MEDIUM'|'HIGH'} risk
 * @property {string[]} allowedActions  Snapshot of what was requested; approval-category actions are still gated at use.
 * @property {string} baseBranch        From the server-side registry.
 * @property {string|null} baseSha      null = not resolved yet (UNKNOWN); only a later orchestrator may set it.
 * @property {string} status
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {string[]} runIds
 * @property {string} [commitSha]
 * @property {{number:number,url:string,state:string,verifiedAt:string}} [pr]
 * @property {{decision:string,decidedAt:string|null,note:string|null}} review
 */

/** Structural validation of a persisted/constructed task. Returns a list of problems. */
export function validateDevelopmentTask(task) {
  const errors = [];
  if (!isRecord(task)) return ['task must be an object'];
  if (!TASK_ID_PATTERN.test(task.taskId ?? '')) fail(errors, 'taskId is malformed');
  for (const field of ['projectId', 'workstream', 'title', 'goal', 'baseBranch']) {
    if (!isNonEmptyString(task[field])) fail(errors, `${field} must be a non-empty string`);
  }
  if (!AGENTS.includes(task.agent)) fail(errors, 'agent is not a known agent');
  if (!EXECUTION_PROFILES.includes(task.executionProfile)) fail(errors, 'executionProfile is invalid');
  if (!RISK_LEVELS.includes(task.risk)) fail(errors, 'risk is invalid');
  if (!Array.isArray(task.allowedActions) || !task.allowedActions.every(isNonEmptyString)) {
    fail(errors, 'allowedActions must be an array of strings');
  } else {
    for (const action of task.allowedActions) {
      const category = classifyAction(action);
      if (category === null || category === 'FORBIDDEN_IN_V1') {
        fail(errors, `allowedActions contains an unknown or forbidden action: ${action}`);
      }
    }
  }
  if (task.baseSha !== null && !(typeof task.baseSha === 'string' && /^[0-9a-f]{40}$/i.test(task.baseSha))) {
    fail(errors, 'baseSha must be null or a 40-hex SHA');
  }
  if (!TASK_STATUSES.includes(task.status)) fail(errors, 'status is invalid');
  for (const field of ['createdAt', 'updatedAt']) {
    if (!isIsoDate(task[field])) fail(errors, `${field} must be an ISO date`);
  }
  for (const field of ['startedAt', 'completedAt']) {
    if (task[field] !== undefined && !isIsoDate(task[field])) fail(errors, `${field} must be an ISO date`);
  }
  if (!Array.isArray(task.runIds) || !task.runIds.every((id) => RUN_ID_PATTERN.test(id))) {
    fail(errors, 'runIds must be an array of run ids');
  }
  if (task.commitSha !== undefined && !(typeof task.commitSha === 'string' && /^[0-9a-f]{40}$/i.test(task.commitSha))) {
    fail(errors, 'commitSha must be a 40-hex SHA');
  }
  if (task.pr !== undefined) {
    const pr = task.pr;
    if (!isRecord(pr) || !Number.isInteger(pr.number) || pr.number < 1 || !isNonEmptyString(pr.url) || !isNonEmptyString(pr.state) || !isIsoDate(pr.verifiedAt)) {
      fail(errors, 'pr must be {number, url, state, verifiedAt}');
    }
  }
  const review = task.review;
  if (!isRecord(review) || !REVIEW_DECISIONS.includes(review.decision)) {
    fail(errors, 'review.decision is invalid');
  } else if (review.decidedAt !== null && !isIsoDate(review.decidedAt)) {
    fail(errors, 'review.decidedAt must be null or an ISO date');
  }
  return errors;
}

/**
 * @typedef {Object} AgentRun
 * @property {string} runId
 * @property {string} taskId
 * @property {'claude-code'|'codex'} agent
 * @property {string} [adapterVersion]
 * @property {string} [requestedModel]
 * @property {string} [requestedEffort]
 * @property {string} [actualModel]      Only what the runtime reported.
 * @property {string} [sessionId]
 * @property {string} status
 * @property {string} [startedAt]
 * @property {string} [endedAt]
 * @property {number} [exitCode]
 * @property {{tokens:{input:number,output:number,cached?:number}|null,costUsd:number|null,grade:string}} usage
 */

export function validateAgentRun(run) {
  const errors = [];
  if (!isRecord(run)) return ['run must be an object'];
  if (!RUN_ID_PATTERN.test(run.runId ?? '')) fail(errors, 'runId is malformed');
  if (!TASK_ID_PATTERN.test(run.taskId ?? '')) fail(errors, 'taskId is malformed');
  if (!RUN_AGENTS.includes(run.agent)) fail(errors, 'agent is not a known run agent');
  if (!RUN_STATUSES.includes(run.status)) fail(errors, 'status is invalid');
  for (const field of ['startedAt', 'endedAt']) {
    if (run[field] !== undefined && !isIsoDate(run[field])) fail(errors, `${field} must be an ISO date`);
  }
  if (run.exitCode !== undefined && !Number.isInteger(run.exitCode)) fail(errors, 'exitCode must be an integer');
  const usage = run.usage;
  if (!isRecord(usage) || !USAGE_GRADES.includes(usage.grade)) {
    fail(errors, 'usage.grade is invalid');
  } else {
    if (usage.tokens !== null) {
      const t = usage.tokens;
      if (!isRecord(t) || !isCount(t.input) || !isCount(t.output) || (t.cached !== undefined && !isCount(t.cached))) {
        fail(errors, 'usage.tokens must be null or {input, output, cached?} counts');
      }
    }
    if (usage.costUsd !== null && !(typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd) && usage.costUsd >= 0)) {
      fail(errors, 'usage.costUsd must be null or a non-negative number');
    }
    // Unknown must stay unknown: an UNAVAILABLE grade can never carry a number,
    // so a missing cost cannot be rendered as $0.
    if (usage.grade === 'UNAVAILABLE' && (usage.costUsd !== null || usage.tokens !== null)) {
      fail(errors, 'UNAVAILABLE usage must have null tokens and costUsd');
    }
  }
  return errors;
}

/**
 * @typedef {Object} Evidence
 * @property {string} evidenceId
 * @property {string} taskId
 * @property {string} [runId]
 * @property {string} kind
 * @property {string} grade
 * @property {unknown} data
 * @property {string} observedAt
 */

export function validateEvidence(evidence) {
  const errors = [];
  if (!isRecord(evidence)) return ['evidence must be an object'];
  if (!isNonEmptyString(evidence.evidenceId)) fail(errors, 'evidenceId is required');
  if (!TASK_ID_PATTERN.test(evidence.taskId ?? '')) fail(errors, 'taskId is malformed');
  if (evidence.runId !== undefined && !RUN_ID_PATTERN.test(evidence.runId)) fail(errors, 'runId is malformed');
  if (!EVIDENCE_KINDS.includes(evidence.kind)) fail(errors, 'kind is invalid');
  if (!EVIDENCE_GRADES.includes(evidence.grade)) fail(errors, 'grade is invalid');
  if (evidence.data === undefined) fail(errors, 'data is required');
  if (!isIsoDate(evidence.observedAt)) fail(errors, 'observedAt must be an ISO date');
  return errors;
}

/** Build a new DRAFT task from already-validated input plus server-resolved values. */
export function createDraftTask({ taskId, input, project, now }) {
  return {
    taskId,
    projectId: project.projectId,
    workstream: input.workstream,
    title: input.title,
    goal: input.goal,
    agent: input.agent,
    executionProfile: input.executionProfile,
    risk: input.risk,
    allowedActions: [...input.requestedActions],
    baseBranch: project.defaultBranch,
    baseSha: null,
    status: 'DRAFT',
    createdAt: now,
    updatedAt: now,
    runIds: [],
    review: { decision: 'PENDING', decidedAt: null, note: null },
  };
}
