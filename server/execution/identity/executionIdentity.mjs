import { TASK_ID_PATTERN, RUN_ID_PATTERN } from '../../tasks/types.mjs';

// Phase 3B7B2B-A0: the durable execution identity record. DATA AND VALIDATION ONLY: nothing here starts, stops or removes a container.
//
// Every field is server-generated. A browser request never supplies a container id, a container name, a label or a host path;
// the only inputs of buildPlannedRecord() are server identifiers (taskId, runId, sandboxId), a role from a closed set and an
// image digest taken from the server's pinned image registry. Every field is checked against a strict pattern, which also keeps
// free text (and therefore secrets) out of the journal. Unknown keys are refused.

export const IDENTITY_SCHEMA_VERSION = 1;
export const IDENTITY_ROLES = Object.freeze(['agent', 'verifier']);
// These mirror the sandbox policy module (SANDBOX_ID, sandboxName, the `cc.sandbox*` labels). They are copied, not imported,
// because this layer must stay independent of the sandbox runtime (the repository's scope test allows only the verifier to import it);
// test/agent-console-phase3b7b2b-a0-journal.test.mjs compares them with the policy so they cannot drift apart.
export const SANDBOX_ID = /^[A-Za-z0-9][A-Za-z0-9-]{5,40}$/;
export const sandboxName = (role, sandboxId) => `cc-sandbox-${role}-${sandboxId.toLowerCase()}`;
export const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
export const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const STATE_ROOT_ID_PATTERN = /^[0-9a-f]{32}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Stage names describe what the journal can PROVE, in order:
//   PLANNED          intent recorded, durable BEFORE `docker create`. No container id exists yet.
//   CREATED          the exact container id is recorded, durable BEFORE the container may start.
//   START_AUTHORIZED the single, one-time permission to launch; written by authorizeStart() only.
//   RUNNING / STOPPING / STOPPED / DESTROYED   lifecycle observed by a later phase.
//   UNKNOWN          interrupted or ambiguous. Terminal here: leaving it needs an operator action that a later phase defines.
export const EXECUTION_STAGES = Object.freeze(['PLANNED', 'CREATED', 'START_AUTHORIZED', 'RUNNING', 'STOPPING', 'STOPPED', 'DESTROYED', 'UNKNOWN']);
export const TERMINAL_STAGES = Object.freeze(['DESTROYED', 'UNKNOWN']);

export const STAGE_TRANSITIONS = Object.freeze({
  PLANNED: Object.freeze(['CREATED', 'UNKNOWN']),
  CREATED: Object.freeze(['START_AUTHORIZED', 'STOPPING', 'DESTROYED', 'UNKNOWN']),
  START_AUTHORIZED: Object.freeze(['RUNNING', 'STOPPING', 'UNKNOWN']),
  RUNNING: Object.freeze(['STOPPING', 'STOPPED', 'UNKNOWN']),
  STOPPING: Object.freeze(['STOPPED', 'UNKNOWN']),
  STOPPED: Object.freeze(['DESTROYED', 'UNKNOWN']),
  DESTROYED: Object.freeze([]),
  UNKNOWN: Object.freeze([]),
});

export const RECORD_KEYS = Object.freeze([
  'schemaVersion', 'taskId', 'runId', 'sandboxId', 'role', 'containerId', 'containerName', 'imageDigest', 'labels',
  'executionGeneration', 'revision', 'writerEpoch', 'stage', 'createdAt', 'updatedAt', 'stateRootId',
]);
export const LABEL_KEYS = Object.freeze(['cc.sandbox', 'cc.sandbox.id', 'cc.sandbox.role']);

/** The ownership labels the sandbox policy puts on every container (see buildCreateArgs). Derived, never supplied. */
export function expectedLabels(sandboxId, role) {
  return { 'cc.sandbox': '1', 'cc.sandbox.id': sandboxId, 'cc.sandbox.role': role };
}

export class IdentityError extends Error {
  constructor(code, message) { super(message); this.name = 'IdentityError'; this.code = code; }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const isCount = (value) => Number.isSafeInteger(value) && value >= 1;
const sameKeys = (value, keys) => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};
export const validTimestamp = (value) => {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

/** Returns a list of problems; an empty list means the record is structurally valid. It never throws. */
export function validateIdentityRecord(record, { stateRootId } = {}) {
  const problems = [];
  if (!isPlainObject(record)) return ['record is not an object'];
  if (!sameKeys(record, RECORD_KEYS)) {
    const extra = Object.keys(record).filter((key) => !RECORD_KEYS.includes(key));
    const missing = RECORD_KEYS.filter((key) => !Object.hasOwn(record, key));
    problems.push(`record keys are not exactly the schema (extra: ${extra.length}, missing: ${missing.length})`);
    return problems;
  }
  if (record.schemaVersion !== IDENTITY_SCHEMA_VERSION) problems.push('unsupported schemaVersion');
  if (typeof record.taskId !== 'string' || !TASK_ID_PATTERN.test(record.taskId)) problems.push('taskId is malformed');
  if (typeof record.runId !== 'string' || !RUN_ID_PATTERN.test(record.runId)) problems.push('runId is malformed');
  if (typeof record.sandboxId !== 'string' || !SANDBOX_ID.test(record.sandboxId)) problems.push('sandboxId is malformed');
  if (!IDENTITY_ROLES.includes(record.role)) problems.push('role is not allowed');
  if (!EXECUTION_STAGES.includes(record.stage)) problems.push('stage is unknown');
  if (record.containerId !== null && !(typeof record.containerId === 'string' && CONTAINER_ID_PATTERN.test(record.containerId))) problems.push('containerId is malformed');
  if (typeof record.imageDigest !== 'string' || !IMAGE_DIGEST_PATTERN.test(record.imageDigest)) problems.push('imageDigest is malformed');
  if (!isCount(record.executionGeneration)) problems.push('executionGeneration is invalid');
  if (!isCount(record.revision)) problems.push('revision is invalid');
  if (!isCount(record.writerEpoch)) problems.push('writerEpoch is invalid');
  if (typeof record.stateRootId !== 'string' || !STATE_ROOT_ID_PATTERN.test(record.stateRootId)) problems.push('stateRootId is malformed');
  else if (stateRootId !== undefined && record.stateRootId !== stateRootId) problems.push('stateRootId does not match this journal');
  if (!validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)) problems.push('timestamps are malformed');
  else if (record.updatedAt < record.createdAt) problems.push('updatedAt precedes createdAt');
  // Derived fields must equal what the sandbox policy would produce, so a record cannot name an arbitrary container.
  if (problems.length === 0) {
    let name = null;
    try { name = sandboxName(record.role, record.sandboxId); } catch { /* reported below */ }
    if (record.containerName !== name) problems.push('containerName does not match the sandbox naming policy');
    const labels = record.labels;
    if (!isPlainObject(labels) || !sameKeys(labels, LABEL_KEYS)) problems.push('labels are not exactly the ownership labels');
    else {
      const expected = expectedLabels(record.sandboxId, record.role);
      if (LABEL_KEYS.some((key) => labels[key] !== expected[key])) problems.push('labels do not match the sandbox and role');
    }
    // The container id exists exactly from CREATED on; PLANNED never has one; UNKNOWN may or may not.
    if (record.stage === 'PLANNED' && record.containerId !== null) problems.push('a PLANNED record may not carry a container id');
    if (!['PLANNED', 'UNKNOWN'].includes(record.stage) && record.containerId === null) problems.push('stage requires a container id');
  }
  return problems;
}

export function assertStageTransition(from, to) {
  if (!EXECUTION_STAGES.includes(from) || !EXECUTION_STAGES.includes(to)) throw new IdentityError('ILLEGAL_TRANSITION', 'Unknown execution stage');
  if (!STAGE_TRANSITIONS[from].includes(to)) throw new IdentityError('ILLEGAL_TRANSITION', `Illegal execution stage transition ${from} -> ${to}`);
}

/** A trustworthy journal is a coherent set, not merely individually valid JSON files. */
export function validateIdentityRecords(records, options = {}) {
  if (!Array.isArray(records)) return ['records is not an array'];
  const problems = [];
  const seen = Object.fromEntries(['runId', 'sandboxId', 'containerId', 'containerName'].map(k => [k, new Set()]));
  const tasks = new Map(); const roots = new Set();
  for (const record of records) {
    if (validateIdentityRecord(record, options).length) { problems.push('invalid record in identity set'); continue; }
    roots.add(record.stateRootId);
    for (const key of Object.keys(seen)) {
      if (record[key] === null) continue;
      if (seen[key].has(record[key])) problems.push(`duplicate ${key}`);
      seen[key].add(record[key]);
    }
    tasks.set(record.taskId, [...(tasks.get(record.taskId) ?? []), record]);
  }
  if (roots.size > 1) problems.push('identity set mixes state roots');
  for (const executions of tasks.values()) {
    const ordered = [...executions].sort((a,b) => a.executionGeneration - b.executionGeneration);
    ordered.forEach((record,index) => {
      if (record.executionGeneration !== index + 1) problems.push('duplicate or non-contiguous execution generation');
      const previous = ordered[index - 1];
      if (previous && previous.stage !== 'DESTROYED') problems.push('conflicting active executions for one task');
      if (previous && (record.createdAt < previous.updatedAt || record.writerEpoch < previous.writerEpoch)) problems.push('invalid execution generation history');
    });
  }
  return [...new Set(problems)];
}

/**
 * Builds the first record of an execution. Only server-generated identifiers are accepted; any extra key (a container id, a
 * container name, labels, a path ...) is refused rather than ignored, so a caller cannot smuggle a value in.
 */
export function buildPlannedRecord(input, { stateRootId, writerEpoch, executionGeneration, now }) {
  const allowed = ['taskId', 'runId', 'sandboxId', 'role', 'imageDigest'];
  if (!isPlainObject(input) || !sameKeys(input, allowed)) throw new IdentityError('INVALID_INPUT', `A planned record takes exactly: ${allowed.join(', ')}`);
  const record = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    taskId: input.taskId,
    runId: input.runId,
    sandboxId: input.sandboxId,
    role: input.role,
    containerId: null,
    containerName: null,
    imageDigest: input.imageDigest,
    labels: null,
    executionGeneration,
    revision: 1,
    writerEpoch,
    stage: 'PLANNED',
    createdAt: now,
    updatedAt: now,
    stateRootId,
  };
  // Derivations need a well-formed sandboxId/role; malformed values are reported by validation below.
  if (typeof input.sandboxId === 'string' && SANDBOX_ID.test(input.sandboxId) && IDENTITY_ROLES.includes(input.role)) {
    record.containerName = sandboxName(input.role, input.sandboxId);
    record.labels = expectedLabels(input.sandboxId, input.role);
  }
  const problems = validateIdentityRecord(record);
  if (problems.length > 0) throw new IdentityError('INVALID_INPUT', `Invalid execution identity: ${problems.join('; ')}`);
  return record;
}
