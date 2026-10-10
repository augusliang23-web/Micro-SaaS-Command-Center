import { TASK_ID_PATTERN, RUN_ID_PATTERN, canSupportPass } from '../../tasks/types.mjs';
import { diffDigestOf } from '../approvalGate.mjs';
import { validTimestamp } from '../identity/executionIdentity.mjs';

// Phase 3B7B2B-A1-0: the PENDING ACTION data contract. DATA AND VALIDATION ONLY.
//
// A pending action records, durably, what a human would be asked to approve for a finished, verified task: which exact Git objects,
// which publishing step is next, and which execution produced them. It is NOT an authorization token: it has no approver, no approval
// id and no capability, nothing in it can be presented to ApprovalGate, and nothing in this phase consumes an approval, resumes a task,
// pushes a branch or contacts Docker. Every value is computed by the server (never by an agent or a browser); free text, prompts,
// agent output, commands, paths and credentials have no field to live in. Source code contents are never stored (only hashes).

export const PENDING_SCHEMA_VERSION = 1;
// Same trust classification as the approval records. Duplicated, not imported, so this contract stays independent; a test compares them.
export const PENDING_AUTHENTICITY = 'UNAUTHENTICATED_LOCAL_APPROVAL';
export const PENDING_ACTIONS = Object.freeze(['COMMIT', 'PUSH_BRANCH', 'CREATE_PR']);
export const STEP_STATES = Object.freeze(['PENDING', 'CLAIMED', 'CONSUMED', 'DONE']);
export const PENDING_STATUSES = Object.freeze(['OPEN', 'REVOKED', 'COMPLETED', 'INTERRUPTED', 'SUPERSEDED']);
export const IDENTITY_STATES = Object.freeze(['NOT_JOURNALED', 'JOURNALED']);
export const MAX_PENDING_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PENDING_LIFETIME_MS = 60 * 60 * 1000;
export const MAX_REVISION = 32;
export const MAX_MANIFEST_FILES = 200;
export const MAX_MANIFEST_FILE_BYTES = 1024 * 1024;
export const MAX_RECORD_BYTES = 128 * 1024;

export const PENDING_ID_PATTERN = /^PND-[0-9a-f]{32}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EVIDENCE_ID = /^EV-[0-9a-f]{32}$/;
const STATE_ROOT_ID = /^[0-9a-f]{32}$/;
const BRANCH = /^agent\/CC-\d{8}-[0-9a-f]{8}-[a-z0-9-]+$/;

export const RECORD_KEYS = Object.freeze([
  'schemaVersion', 'pendingId', 'revision', 'taskId', 'projectId', 'runId', 'executionIdentity', 'action', 'branch', 'baseSha',
  'expectedHead', 'treeSha', 'diffDigest', 'manifest', 'verification', 'guardSnapshot', 'steps', 'status', 'authenticity',
  'createdAt', 'updatedAt', 'expiresAt',
]);
const IDENTITY_KEYS = ['state', 'stateRootId', 'executionGeneration', 'runId'];
const VERIFICATION_KEYS = ['evidenceId', 'kind', 'grade', 'passed'];
const GUARD_KEYS = ['sourceHead', 'sourceStatusDigest', 'sourceFingerprint', 'remoteDigest', 'remoteBeforeDigest', 'branchesBeforeDigest'];
const FILE_KEYS_LIVE = ['path', 'sha256', 'size', 'exec'];
const FILE_KEYS_DELETED = ['path', 'deleted'];

export class PendingActionError extends Error {
  constructor(code, message) { super(message); this.name = 'PendingActionError'; this.code = code; }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exactKeys = (v, keys) => isPlain(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const isCount = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 1 && v <= max;

const safeRelativePath = (p) => typeof p === 'string' && p !== '' && p.length <= 512 && !/[\0\\]/.test(p) && !p.startsWith('/') && p !== '.'
  && !p.split('/').some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git');

// ---------------------------------------------------------------- validation

function validateManifest(manifest, problems) {
  if (!exactKeys(manifest, ['files']) || !Array.isArray(manifest.files)) { problems.push('manifest must be exactly { files: [...] }'); return null; }
  const { files } = manifest;
  if (files.length < 1 || files.length > MAX_MANIFEST_FILES) { problems.push('manifest must list between 1 and 200 files'); return null; }
  const seen = new Set();
  for (const f of files) {
    const deleted = isPlain(f) && f.deleted === true;
    if (!exactKeys(f, deleted ? FILE_KEYS_DELETED : FILE_KEYS_LIVE) || !safeRelativePath(f.path) || seen.has(f.path)) { problems.push('manifest entry is malformed, unsafe or duplicated'); return null; }
    seen.add(f.path);
    if (!deleted && !(SHA256.test(f.sha256) && Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= MAX_MANIFEST_FILE_BYTES && typeof f.exec === 'boolean')) { problems.push('manifest entry content fields are malformed'); return null; }
  }
  return files;
}

/** Returns problems; an empty list means structurally valid AND internally consistent. Never throws. */
export function validatePendingRecord(r) {
  const problems = [];
  if (!isPlain(r)) return ['record is not an object'];
  if (!exactKeys(r, RECORD_KEYS)) {
    const extra = Object.keys(r).filter((k) => !RECORD_KEYS.includes(k)).length;
    const missing = RECORD_KEYS.filter((k) => !Object.hasOwn(r, k)).length;
    return [`record keys are not exactly the schema (extra: ${extra}, missing: ${missing})`];
  }
  if (r.schemaVersion !== PENDING_SCHEMA_VERSION) problems.push('unsupported schemaVersion');
  if (typeof r.pendingId !== 'string' || !PENDING_ID_PATTERN.test(r.pendingId)) problems.push('pendingId is malformed');
  if (!isCount(r.revision, MAX_REVISION)) problems.push('revision is invalid');
  if (typeof r.taskId !== 'string' || !TASK_ID_PATTERN.test(r.taskId)) problems.push('taskId is malformed');
  if (typeof r.projectId !== 'string' || !PROJECT_ID.test(r.projectId)) problems.push('projectId is malformed');
  if (typeof r.runId !== 'string' || !RUN_ID_PATTERN.test(r.runId)) problems.push('runId is malformed');
  if (typeof r.branch !== 'string' || !BRANCH.test(r.branch) || r.branch.length > 200 || !r.branch.startsWith(`agent/${r.taskId}-`)) problems.push('branch must be the generated task branch');
  for (const k of ['baseSha', 'expectedHead', 'treeSha']) if (typeof r[k] !== 'string' || !SHA1.test(r[k])) problems.push(`${k} must be a 40-hex object id`);
  if (typeof r.diffDigest !== 'string' || !SHA256.test(r.diffDigest)) problems.push('diffDigest is malformed');
  if (r.authenticity !== PENDING_AUTHENTICITY) problems.push('authenticity label is wrong');
  if (!PENDING_STATUSES.includes(r.status)) problems.push('status is unknown');

  // execution identity: NOT_JOURNALED proves nothing; JOURNALED is a reference that must name this very run
  const id = r.executionIdentity;
  if (!exactKeys(id, IDENTITY_KEYS) || !IDENTITY_STATES.includes(id.state)) problems.push('executionIdentity is malformed');
  else if (id.state === 'NOT_JOURNALED') {
    if (id.stateRootId !== null || id.executionGeneration !== null || id.runId !== null) problems.push('a NOT_JOURNALED identity may not carry journal references');
  } else if (typeof id.stateRootId !== 'string' || !STATE_ROOT_ID.test(id.stateRootId) || !isCount(id.executionGeneration) || id.runId !== r.runId) {
    problems.push('a JOURNALED identity must carry stateRootId, executionGeneration and this run id');
  }

  const v = r.verification;
  if (!exactKeys(v, VERIFICATION_KEYS) || typeof v.evidenceId !== 'string' || !EVIDENCE_ID.test(v.evidenceId) || v.kind !== 'command_result' || v.passed !== true || !canSupportPass(v.grade)) {
    problems.push('verification must reference passing command_result evidence graded LOCALLY_VERIFIED or higher');
  }
  const g = r.guardSnapshot;
  if (!exactKeys(g, GUARD_KEYS) || !SHA1.test(g.sourceHead) || GUARD_KEYS.slice(1).some((k) => typeof g[k] !== 'string' || !SHA256.test(g[k]))) problems.push('guardSnapshot must be a source HEAD and five SHA-256 digests');

  const files = validateManifest(r.manifest, problems);
  if (files && typeof r.diffDigest === 'string') {
    try { if (diffDigestOf(files) !== r.diffDigest) problems.push('diffDigest does not match the manifest'); } catch { problems.push('manifest cannot be digested'); }
  }

  // steps: strictly ordered, one in flight at most, action = the first step not DONE
  const steps = r.steps;
  if (!exactKeys(steps, PENDING_ACTIONS) || PENDING_ACTIONS.some((a) => !STEP_STATES.includes(steps[a]))) problems.push('steps must give each of COMMIT, PUSH_BRANCH, CREATE_PR a known state');
  else {
    PENDING_ACTIONS.forEach((a, i) => {
      if (steps[a] !== 'PENDING' && PENDING_ACTIONS.slice(0, i).some((earlier) => steps[earlier] !== 'DONE')) problems.push(`step ${a} is ahead of an unfinished earlier step`);
    });
    const next = PENDING_ACTIONS.find((a) => steps[a] !== 'DONE') ?? null;
    if (r.action !== next) problems.push('action must be the first step that is not DONE (null when all are DONE)');
    const allDone = next === null;
    if ((r.status === 'COMPLETED') !== allDone) problems.push('status COMPLETED holds exactly when every step is DONE');
    if (['REVOKED', 'SUPERSEDED'].includes(r.status) && PENDING_ACTIONS.some((a) => ['CLAIMED', 'CONSUMED'].includes(steps[a]))) problems.push('a pending action cannot be revoked or superseded while a step is in flight');
    // the expected HEAD is the base until the commit step is DONE, then the new commit
    if (typeof r.expectedHead === 'string' && SHA1.test(r.expectedHead) && SHA1.test(r.baseSha ?? '')) {
      if (steps.COMMIT === 'DONE' ? r.expectedHead === r.baseSha : r.expectedHead !== r.baseSha) problems.push('expectedHead must be baseSha until COMMIT is DONE and a different commit afterwards');
    }
  }

  for (const k of ['createdAt', 'updatedAt', 'expiresAt']) if (!validTimestamp(r[k])) problems.push(`${k} is malformed`);
  if (validTimestamp(r.createdAt) && validTimestamp(r.updatedAt) && r.updatedAt < r.createdAt) problems.push('updatedAt precedes createdAt');
  if (validTimestamp(r.createdAt) && validTimestamp(r.expiresAt)) {
    const life = Date.parse(r.expiresAt) - Date.parse(r.createdAt);
    if (life <= 0 || life > MAX_PENDING_LIFETIME_MS) problems.push('pending lifetime is invalid');
  }
  return problems;
}

export const isExpired = (record, nowIso) => Date.parse(nowIso) >= Date.parse(record.expiresAt);

// ---------------------------------------------------------------- pure transitions

const IMMUTABLE = ['schemaVersion', 'pendingId', 'taskId', 'projectId', 'runId', 'executionIdentity', 'branch', 'baseSha', 'treeSha', 'diffDigest', 'manifest', 'verification', 'guardSnapshot', 'authenticity', 'createdAt', 'expiresAt'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CREATE_KEYS = ['taskId', 'projectId', 'runId', 'executionIdentity', 'branch', 'baseSha', 'treeSha', 'diffDigest', 'manifest', 'verification', 'guardSnapshot'];

/** Builds revision 1. `input` carries exactly the server-computed facts; the id, steps, status, expectedHead and times are not caller-controlled. */
export function buildInitialRecord(input, { pendingId, now, ttlMs = DEFAULT_PENDING_LIFETIME_MS }) {
  if (!exactKeys(input, CREATE_KEYS)) throw new PendingActionError('INVALID_INPUT', `A pending action takes exactly: ${CREATE_KEYS.join(', ')}`);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_PENDING_LIFETIME_MS) throw new PendingActionError('INVALID_INPUT', 'Pending lifetime must be between 1 second and 24 hours');
  if (!validTimestamp(now)) throw new PendingActionError('INVALID_INPUT', 'The clock returned an invalid time');
  const record = {
    schemaVersion: PENDING_SCHEMA_VERSION, pendingId, revision: 1, taskId: input.taskId, projectId: input.projectId, runId: input.runId,
    executionIdentity: input.executionIdentity, action: 'COMMIT', branch: input.branch, baseSha: input.baseSha, expectedHead: input.baseSha,
    treeSha: input.treeSha, diffDigest: input.diffDigest, manifest: input.manifest, verification: input.verification, guardSnapshot: input.guardSnapshot,
    steps: { COMMIT: 'PENDING', PUSH_BRANCH: 'PENDING', CREATE_PR: 'PENDING' }, status: 'OPEN', authenticity: PENDING_AUTHENTICITY,
    createdAt: now, updatedAt: now, expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
  };
  const problems = validatePendingRecord(record);
  if (problems.length) throw new PendingActionError('INVALID_INPUT', `Invalid pending action: ${problems.join('; ')}`);
  return record;
}

/** One step moves exactly one state forward, only for the current action, only while OPEN. Claiming an expired pending action is refused. */
export function applyStepAdvance(prev, { action, to, commitSha }, now) {
  const refuse = (code, message) => { throw new PendingActionError(code, message); };
  if (!PENDING_ACTIONS.includes(action)) refuse('INVALID_INPUT', 'Unknown action');
  if (!STEP_STATES.includes(to)) refuse('INVALID_INPUT', 'Unknown step state');
  if (prev.status !== 'OPEN') refuse('NOT_OPEN', `The pending action is ${prev.status}`);
  if (prev.revision >= MAX_REVISION) refuse('REVISION_LIMIT', 'The pending action reached its revision limit');
  if (action !== prev.action) refuse('ACTION_ORDER', `The next action is ${prev.action}, not ${action}`);
  if (STEP_STATES.indexOf(to) !== STEP_STATES.indexOf(prev.steps[action]) + 1) refuse('STEP_TRANSITION', `Illegal step transition ${prev.steps[action]} -> ${to}`);
  if (to === 'CLAIMED' && isExpired(prev, now)) refuse('EXPIRED', 'The pending action has expired');
  const next = { ...prev, steps: { ...prev.steps, [action]: to }, revision: prev.revision + 1, updatedAt: now < prev.updatedAt ? prev.updatedAt : now };
  if (action === 'COMMIT' && to === 'DONE') {
    if (typeof commitSha !== 'string' || !SHA1.test(commitSha) || commitSha === prev.baseSha) refuse('INVALID_INPUT', 'COMMIT DONE requires the new 40-hex commit id');
    next.expectedHead = commitSha;
  } else if (commitSha !== undefined) refuse('INVALID_INPUT', 'commitSha is accepted only when COMMIT becomes DONE');
  next.action = PENDING_ACTIONS.find((a) => next.steps[a] !== 'DONE') ?? null;
  if (next.action === null) next.status = 'COMPLETED';
  const problems = validatePendingRecord(next);
  if (problems.length) refuse('INVALID_TRANSITION', problems.join('; '));
  return next;
}

/** OPEN -> REVOKED | SUPERSEDED | INTERRUPTED. COMPLETED is reached only by finishing the last step. */
export function applyStatusChange(prev, to, now) {
  const refuse = (code, message) => { throw new PendingActionError(code, message); };
  if (!['REVOKED', 'SUPERSEDED', 'INTERRUPTED'].includes(to)) refuse('STATUS_TRANSITION', `A status cannot be set to ${String(to)} directly`);
  if (prev.status !== 'OPEN') refuse('NOT_OPEN', `The pending action is already ${prev.status}`);
  if (prev.revision >= MAX_REVISION) refuse('REVISION_LIMIT', 'The pending action reached its revision limit');
  const next = { ...prev, status: to, revision: prev.revision + 1, updatedAt: now < prev.updatedAt ? prev.updatedAt : now };
  const problems = validatePendingRecord(next);
  if (problems.length) refuse('INVALID_TRANSITION', problems.join('; '));
  return next;
}

/**
 * Validates a whole revision history (oldest first). A pending action is trusted only as a coherent chain: contiguous revisions,
 * immutable facts unchanged, and every step an allowed single move. Returns problems.
 */
export function validatePendingChain(chain) {
  const problems = [];
  if (!Array.isArray(chain) || chain.length === 0) return ['history is empty'];
  chain.forEach((rec, i) => {
    const own = validatePendingRecord(rec);
    if (own.length) { problems.push(`revision ${i + 1}: ${own.join('; ')}`); return; }
    if (rec.revision !== i + 1) { problems.push(`revision numbering is not contiguous at ${i + 1}`); return; }
    if (i === 0) {
      if (rec.status !== 'OPEN' || PENDING_ACTIONS.some((a) => rec.steps[a] !== 'PENDING') || rec.updatedAt !== rec.createdAt) problems.push('revision 1 must be a fresh OPEN record');
      return;
    }
    const prev = chain[i - 1];
    if (IMMUTABLE.some((k) => !same(prev[k], rec[k]))) { problems.push(`revision ${rec.revision} changed an immutable fact`); return; }
    if (rec.updatedAt < prev.updatedAt) problems.push(`revision ${rec.revision} moves time backwards`);
    const stepChanges = PENDING_ACTIONS.filter((a) => prev.steps[a] !== rec.steps[a]);
    if (stepChanges.length === 1) {
      try {
        const expected = applyStepAdvance(prev, { action: stepChanges[0], to: rec.steps[stepChanges[0]], ...(stepChanges[0] === 'COMMIT' && rec.steps.COMMIT === 'DONE' ? { commitSha: rec.expectedHead } : {}) }, rec.updatedAt < prev.updatedAt ? prev.updatedAt : rec.updatedAt);
        if (!same(expected, rec)) problems.push(`revision ${rec.revision} is not the result of a single legal step`);
      } catch (error) {
        // an expired pending may still record the later steps of a claim that began in time
        if (error.code === 'EXPIRED') problems.push(`revision ${rec.revision} claimed an expired pending action`); else problems.push(`revision ${rec.revision}: ${error.message}`);
      }
    } else if (stepChanges.length === 0) {
      if (rec.status === prev.status) problems.push(`revision ${rec.revision} changes nothing`);
      else {
        try { if (!same(applyStatusChange(prev, rec.status, rec.updatedAt < prev.updatedAt ? prev.updatedAt : rec.updatedAt), rec)) problems.push(`revision ${rec.revision} is not a single legal status change`); } catch (error) { problems.push(`revision ${rec.revision}: ${error.message}`); }
      }
    } else problems.push(`revision ${rec.revision} changes more than one step`);
  });
  return problems;
}

// ---------------------------------------------------------------- execution identity assessment (pure)

/**
 * Whether a pending action's execution identity is PROVEN by an A0 journal scan. NOT_JOURNALED never is: it means only that the container
 * identity was not recorded through the durable startup protocol; it does not mean no container existed and it does not mean cleanup was
 * verified. Even a proven identity is NOT cleanup evidence and NOT an authorization: a later phase must still require authoritative
 * completion and cleanup evidence.
 */
export function assessExecutionIdentity(record, journalRecords) {
  const no = (reason) => ({ proven: false, reason });
  if (!isPlain(record) || !isPlain(record.executionIdentity)) return no('INVALID_RECORD');
  if (record.executionIdentity.state !== 'JOURNALED') return no('NOT_JOURNALED_NO_PROVEN_IDENTITY');
  if (!Array.isArray(journalRecords)) return no('JOURNAL_UNAVAILABLE');
  const id = record.executionIdentity;
  const own = journalRecords.filter((j) => isPlain(j) && j.taskId === record.taskId);
  const match = own.find((j) => j.runId === id.runId && j.stateRootId === id.stateRootId && j.executionGeneration === id.executionGeneration);
  if (!match) return no('JOURNAL_RECORD_NOT_FOUND');
  if (match.runId !== record.runId) return no('RUN_MISMATCH');
  if (own.some((j) => j.stage !== 'DESTROYED')) return no('UNSETTLED_EXECUTION_FOR_TASK');
  return { proven: true, reason: 'JOURNAL_RECORD_CONSISTENT' };
}
