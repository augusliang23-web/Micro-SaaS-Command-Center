// V1.2A project management data contract: input validation, audited defaults for new projects, lifecycle metadata and the
// whole-state invariants every command result must satisfy. Pure functions only: no filesystem, network, process or clock
// access (callers pass `now` and id generators in). Not imported by server.ts; nothing here is reachable from the V1 server.
//
// Compatibility rules (see docs/v1-2-project-management-foundation.md):
//  - Every resulting state must pass BOTH existing readers: server isValidState (envelope) and src isUsableSavedState (full
//    legacy project shape). A command whose result would fail either is refused; nothing is ever repaired or migrated.
//  - `dataMode` is provenance and is never written. A new project has no `dataMode` (the existing "registered" contract) and
//    an existing value is never changed, so a demo or unverified record can never be promoted by a command.
//  - Lifecycle lives in a new per-project `management` object. A project without one is ACTIVE (every legacy record).
//  - Removed projects leave `projects` intact and move to the top-level `projectManagement.removed` list, which V1.1 ignores.

import { isUsableSavedState } from '../src/savedState.mjs';
import { isValidState } from './localStateStore.mjs';

export const MANAGEMENT_SCHEMA_VERSION = 1;
export const LIFECYCLE = Object.freeze({ ACTIVE: 'active', ARCHIVED: 'archived' });
export const LIMITS = Object.freeze({
  maxStateBytes: 5 * 1024 * 1024,
  maxProjects: 500, // projects + removed
  nameMaxChars: 120,
  taglineMaxChars: 500,
  maxTags: 20,
  tagMaxChars: 40,
  maxManagementEvents: 50,
});
export const STAGES = Object.freeze(['Prototype', 'Alpha', 'Beta', 'Production']);
export const EDITABLE_FIELDS = Object.freeze(['name', 'tagline', 'stage', 'tags']);

export class ProjectDataError extends Error {
  /** @param {string} code stable machine-readable reason, e.g. CONFLICT, INVALID_INPUT, ILLEGAL_TRANSITION */
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProjectDataError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new ProjectDataError(code, message, details); };
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// C0/C1 controls, plus bidi overrides/isolates and line/paragraph separators that can disguise displayed text.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/**
 * Validates and canonicalises one user-entered text field. Rejects non-strings, malformed UTF-16 (lone surrogates cannot be
 * stored as UTF-8), control/bidi characters and over-long values; trims and NFC-normalises. Length is in code points.
 */
export function cleanText(value, { field, maxChars, allowEmpty = false }) {
  if (typeof value !== 'string') fail('INVALID_INPUT', `${field} must be a string.`, { field });
  if (!value.isWellFormed()) fail('INVALID_INPUT', `${field} contains malformed Unicode.`, { field });
  const text = value.normalize('NFC').trim();
  if (UNSAFE_CHARS.test(text)) fail('INVALID_INPUT', `${field} contains control or direction-override characters.`, { field });
  if (!allowEmpty && text.length === 0) fail('INVALID_INPUT', `${field} must not be blank.`, { field });
  if ([...text].length > maxChars) fail('INVALID_INPUT', `${field} is longer than ${maxChars} characters.`, { field });
  return text;
}

export function cleanTags(value) {
  if (!Array.isArray(value)) fail('INVALID_INPUT', 'tags must be an array of strings.', { field: 'tags' });
  if (value.length > LIMITS.maxTags) fail('INVALID_INPUT', `At most ${LIMITS.maxTags} tags are allowed.`, { field: 'tags' });
  const tags = value.map((tag) => cleanText(tag, { field: 'tags', maxChars: LIMITS.tagMaxChars }));
  if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) fail('INVALID_INPUT', 'tags must not repeat.', { field: 'tags' });
  return tags;
}

export function cleanStage(value) {
  if (!STAGES.includes(value)) fail('INVALID_INPUT', `stage must be one of ${STAGES.join(', ')}.`, { field: 'stage' });
  return value;
}

// GitHub owner: 1-39 alphanumerics/hyphens, no leading/trailing/double hyphen. Repo: 1-100 of [A-Za-z0-9._-], not "." or "..",
// no ".git" suffix. Only the exact `owner/repo` form is accepted: URLs, SSH remotes and paths are refused, never parsed or guessed.
const OWNER = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
export function canonicalRepository(value) {
  if (typeof value !== 'string') fail('INVALID_INPUT', 'repository must be a string in owner/repo form.', { field: 'repository' });
  const text = value.trim();
  const parts = text.split('/');
  if (parts.length !== 2 || !OWNER.test(parts[0]) || !REPO.test(parts[1]) || parts[1] === '.' || parts[1] === '..' || /\.git$/i.test(parts[1])) {
    fail('INVALID_INPUT', 'repository must be exactly owner/repo (no URL, no .git suffix).', { field: 'repository' });
  }
  return text;
}

/** Comparison key for duplicate detection: GitHub owner/repo names are case-insensitive. */
export const repositoryKey = (repository) => (typeof repository === 'string' ? repository.trim().toLowerCase() : '');

export function assertProjectId(id) {
  if (typeof id !== 'string' || id.length === 0 || id !== id.trim()) fail('INVALID_ID', 'Project id must be a non-blank string.');
  return id;
}

/** ACTIVE unless a valid `management.lifecycle` says ARCHIVED. An unrecognised value fails closed instead of guessing. */
export function lifecycleOf(project) {
  const management = project?.management;
  if (management === undefined) return LIFECYCLE.ACTIVE;
  if (!isRecord(management)) fail('INVALID_STATE', 'A project has a malformed management record.', { projectId: project?.id });
  const lifecycle = management.lifecycle ?? LIFECYCLE.ACTIVE;
  if (lifecycle !== LIFECYCLE.ACTIVE && lifecycle !== LIFECYCLE.ARCHIVED) {
    fail('INVALID_STATE', 'A project has an unknown lifecycle value.', { projectId: project?.id });
  }
  return lifecycle;
}

// V1.2C: per-project GitHub connection intent, stored as management.githubConnection in the same versioned file. It records
// what the owner approved; it is never evidence that a GitHub read succeeded. Authority is derived from it (and the narrow
// legacy rule) by server/githubConnectionRegistry.mjs on every request.
export const CONNECTION_STATUS = Object.freeze({ CONNECTED: 'connected', DISCONNECTED: 'disconnected' });
export const CONNECTION_SOURCES = Object.freeze(['user-verified', 'legacy-pm-dashboard-compat']);
export const REVOKE_REASONS = Object.freeze(['disconnected', 'archived', 'removed']);
const isTimestamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** The validated connection record, or null when the project has none. A malformed record fails closed (INVALID_STATE). */
export function connectionOf(project) {
  const management = project?.management;
  if (!isRecord(management) || management.githubConnection === undefined) return null;
  const c = management.githubConnection;
  const bad = () => fail('INVALID_STATE', 'A project has a malformed GitHub connection record.', { projectId: project?.id });
  if (!isRecord(c)) bad();
  const known = ['status', 'repository', 'generation', 'source', 'connectedAt', 'verifiedRepositoryId', 'revokedAt', 'revokedReason'];
  if (Object.keys(c).some((k) => !known.includes(k))) bad();
  if (c.status !== CONNECTION_STATUS.CONNECTED && c.status !== CONNECTION_STATUS.DISCONNECTED) bad();
  try { if (canonicalRepository(c.repository) !== c.repository) bad(); } catch { bad(); }
  if (!Number.isInteger(c.generation) || c.generation < 1) bad();
  if (!CONNECTION_SOURCES.includes(c.source)) bad();
  if (!(c.connectedAt === null || isTimestamp(c.connectedAt))) bad();
  if (!(c.verifiedRepositoryId === null || (Number.isInteger(c.verifiedRepositoryId) && c.verifiedRepositoryId > 0))) bad();
  if (c.status === CONNECTION_STATUS.CONNECTED && (c.revokedAt !== null || c.revokedReason !== null || !isTimestamp(c.connectedAt))) bad();
  if (c.status === CONNECTION_STATUS.DISCONNECTED && (!isTimestamp(c.revokedAt) || !REVOKE_REASONS.includes(c.revokedReason))) bad();
  return c;
}

/** Returns the management record with one appended event (bounded history) and the given field overrides. */
export function nextManagement(project, { now, event, lifecycle }) {
  const previous = isRecord(project?.management) ? project.management : {};
  const events = Array.isArray(previous.events) ? previous.events : [];
  return {
    ...previous,
    schemaVersion: MANAGEMENT_SCHEMA_VERSION,
    lifecycle: lifecycle ?? lifecycleOf(project),
    ...(lifecycle === LIFECYCLE.ARCHIVED ? { archivedAt: now } : {}),
    ...(lifecycle === LIFECYCLE.ACTIVE && own(previous, 'archivedAt') ? { archivedAt: null } : {}),
    updatedAt: now,
    events: [...events, { type: event, at: now }].slice(-LIMITS.maxManagementEvents),
  };
}

/**
 * Audited defaults for a project created by Add. Every field the legacy reader requires is present. Values describe
 * "nothing recorded yet" and are never evidence: no gate is completed, no agent/model is assigned, no test/review outcome,
 * no blocker claim, no Git, CI or deployment observation. `dataMode` is deliberately absent (see header).
 */
export function buildNewProject({ id, name, tagline = '', stage = 'Prototype', tags = [], repository = '' }, { now }) {
  return {
    id,
    name,
    tagline,
    repository,
    stage,
    health: 'Attention', // enum-constrained placeholder: a new project has not been reviewed. V1 labels it "saved, not verified".
    workflowType: 'standard',
    currentTask: '',
    currentGate: 'DISCUSS',
    currentGateLabel: 'Not started',
    testOutcome: 'N/A',
    reviewOutcome: 'N/A',
    nextAction: '',
    blocker: null,
    waitingState: 'AUTOMATION_IDLE',
    model: 'Not Assigned',
    reasoningEffort: 'None',
    routingReason: 'No agent routing has been recorded for this project.',
    lastActivity: now,
    tags,
    gates: [],
    activityHistory: [],
    executionContext: { branch: '', model: 'Not Assigned', reasoningEffort: 'None', risk: 'Low', routingReason: 'No agent routing has been recorded.', bridgeRunId: '' },
    environment: {
      production: { status: 'Not Deployed', lastDeployed: 'Not recorded' },
      staging: { status: 'Not Deployed', lastRefreshed: 'Not recorded' },
    },
    management: { schemaVersion: MANAGEMENT_SCHEMA_VERSION, lifecycle: LIFECYCLE.ACTIVE, createdAt: now, updatedAt: now, events: [{ type: 'added', at: now }] },
  };
}

/** The removed-projects area. Absent means empty. Its shape is checked strictly because restore depends on it. */
export function removedOf(state) {
  const area = state.projectManagement;
  if (area === undefined) return [];
  if (!isRecord(area) || !Array.isArray(area.removed)) fail('INVALID_STATE', 'projectManagement is malformed.');
  for (const entry of area.removed) {
    if (!isRecord(entry) || !isRecord(entry.project) || typeof entry.removedAt !== 'string') fail('INVALID_STATE', 'A removed-project entry is malformed.');
  }
  return area.removed;
}

/**
 * Whole-state invariant used on every command input AND output: both legacy readers accept it, every project and removed
 * entry has a usable lifecycle, and the record count is bounded. Ids are not required to be unique on input (legacy data may
 * already contain duplicates); commands refuse to target an ambiguous id and never create a new duplicate.
 */
export function assertUsableState(state) {
  if (!isValidState(state) || !isUsableSavedState(state)) fail('INVALID_STATE', 'Saved state does not match the V1 saved-state contract.');
  const removed = removedOf(state);
  for (const project of state.projects) { lifecycleOf(project); connectionOf(project); }
  for (const entry of removed) { lifecycleOf(entry.project); connectionOf(entry.project); }
  if (!isUsableSavedState({ ...state, projects: removed.map((e) => e.project) })) fail('INVALID_STATE', 'A removed project does not match the saved-project contract.');
  if (state.projects.length + removed.length > LIMITS.maxProjects) fail('LIMIT_EXCEEDED', `More than ${LIMITS.maxProjects} projects.`);
  return state;
}

/** Deterministic serialisation used for every write (same format as the legacy writer: 2-space JSON, key order preserved). */
export function serializeState(state) {
  const text = JSON.stringify(state, null, 2);
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxStateBytes) fail('LIMIT_EXCEEDED', 'Saved state would exceed the size limit.');
  return text;
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
/** Parses stored bytes. Invalid UTF-8, a BOM, or invalid JSON is CORRUPT; it is reported, never repaired or replaced. */
export function parseStateBytes(bytes) {
  // Checked on the raw bytes: TextDecoder silently strips a leading BOM.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('CORRUPT_STATE', 'Saved state starts with a byte-order mark.');
  let text;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    fail('CORRUPT_STATE', 'Saved state is not valid UTF-8.');
  }
  try {
    return JSON.parse(text);
  } catch {
    return fail('CORRUPT_STATE', 'Saved state is not valid JSON.');
  }
}
