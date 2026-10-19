// V1.2A project management commands: pure transforms of a saved state. No filesystem, network or clock access; the input is
// never mutated (unrelated projects and top-level fields are carried over by reference, so they serialise identically).
// Every command validates the whole input first and the whole result last (assertUsableState); any doubt is refused with a
// ProjectDataError, never resolved by guessing. Reached only through the V1.2 project command route.
// V1.2C adds connect / disconnect / change for the GitHub connection. Those three need a `verified` repository identity that
// ONLY the server adds after its own read-only GitHub metadata check; a client cannot supply it (the route allowlist refuses it).

import {
  EDITABLE_FIELDS,
  LIFECYCLE,
  LIMITS,
  ProjectDataError,
  assertProjectId,
  assertUsableState,
  buildNewProject,
  canonicalRepository,
  cleanStage,
  cleanTags,
  cleanText,
  CONNECTION_STATUS,
  connectionOf,
  lifecycleOf,
  nextManagement,
  removedOf,
  repositoryKey,
} from './projectManagementSchema.mjs';
import { legacyCompatProjectId } from './githubConnectionRegistry.mjs';

const fail = (code, message, details) => { throw new ProjectDataError(code, message, details); };
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function assertNow(now) {
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) fail('INVALID_INPUT', 'now must be an ISO timestamp.');
  return now;
}

/** The single project with this id. Missing => NOT_FOUND; duplicated (legacy data) => AMBIGUOUS_ID, never "the first one". */
function locate(state, id) {
  assertProjectId(id);
  const indexes = state.projects.flatMap((p, i) => (p.id === id ? [i] : []));
  if (indexes.length === 0) fail('NOT_FOUND', 'No project has this id.', { projectId: id });
  if (indexes.length > 1) fail('AMBIGUOUS_ID', 'More than one project has this id; refusing to guess.', { projectId: id });
  return indexes[0];
}

const idInUse = (state, id) => state.projects.some((p) => p.id === id) || removedOf(state).some((e) => e.project.id === id);

function assertRepositoryFree(projects, repository, { exceptIndex = -1 } = {}) {
  const key = repositoryKey(repository);
  if (!key) return;
  const clash = projects.findIndex((p, i) => i !== exceptIndex && repositoryKey(p.repository) === key);
  if (clash !== -1) fail('DUPLICATE_REPOSITORY', 'Another project already uses this repository.', { projectId: projects[clash].id });
}

function withProjects(state, projects, removed) {
  const next = { ...state, projects };
  if (removed !== undefined) {
    const area = state.projectManagement;
    next.projectManagement = { ...(isRecord(area) ? area : {}), removed };
  }
  return assertUsableState(next);
}

function replaceAt(projects, index, project) {
  const next = projects.slice();
  next[index] = project;
  return next;
}

/** Connected now: a saved `connected` record, or the strict legacy PM Dashboard rule (which has no saved record). */
function isEffectivelyConnected(state, project) {
  const c = connectionOf(project);
  if (c) return c.status === CONNECTION_STATUS.CONNECTED;
  return project.id === legacyCompatProjectId(state);
}

/** The connection record a write must carry so that authority never silently changes as a side effect. */
function connectionRecord(previous, fields) {
  return {
    status: fields.status,
    repository: fields.repository,
    generation: (previous?.generation ?? 0) + 1,
    source: fields.source,
    connectedAt: fields.connectedAt ?? null,
    verifiedRepositoryId: fields.verifiedRepositoryId ?? null,
    revokedAt: fields.revokedAt ?? null,
    revokedReason: fields.revokedReason ?? null,
  };
}

/** Archive/remove revoke an effective connection (including the legacy rule); restore/recover never bring it back. */
function revokedConnectionFor(state, project, reason, now) {
  if (!isEffectivelyConnected(state, project)) return undefined;
  const previous = connectionOf(project);
  return connectionRecord(previous, {
    status: CONNECTION_STATUS.DISCONNECTED, repository: previous?.repository ?? project.repository,
    source: previous?.source ?? 'legacy-pm-dashboard-compat', connectedAt: previous?.connectedAt ?? null,
    verifiedRepositoryId: previous?.verifiedRepositoryId ?? null, revokedAt: now, revokedReason: reason,
  });
}

/**
 * Decision B: the first write that gives the legacy PM Dashboard record a `management` object would otherwise end its legacy
 * authority silently. An Edit keeps it by persisting the same authority as an auditable record (source legacy-pm-dashboard-compat).
 */
function persistedLegacyConnection(state, project, now) {
  if (project.management !== undefined || project.id !== legacyCompatProjectId(state)) return undefined;
  return connectionRecord(null, { status: CONNECTION_STATUS.CONNECTED, repository: project.repository, source: 'legacy-pm-dashboard-compat', connectedAt: now });
}

const withConnection = (management, connection) => (connection === undefined ? management : { ...management, githubConnection: connection });

/**
 * Add a project. `newId()` must return a fresh opaque id (the store passes a random UUID based one); a collision with any
 * current or removed id is refused rather than retried silently. A repository is optional: without one the project is saved
 * but stays NOT CONNECTED. Duplicate repositories among current projects are refused (case-insensitive).
 */
export function addProject(state, input, { now, newId }) {
  assertUsableState(state);
  assertNow(now);
  if (!isRecord(input)) fail('INVALID_INPUT', 'Add input must be an object.');
  const unknown = Object.keys(input).filter((k) => !['name', 'tagline', 'stage', 'tags', 'repository'].includes(k));
  if (unknown.length) fail('INVALID_INPUT', 'Add input has unsupported fields.', { fields: unknown });
  const id = assertProjectId(typeof newId === 'function' ? newId() : undefined);
  if (idInUse(state, id)) fail('ID_COLLISION', 'Generated id is already in use.', { projectId: id });
  const fields = {
    id,
    name: cleanText(input.name, { field: 'name', maxChars: LIMITS.nameMaxChars }),
    tagline: input.tagline === undefined ? '' : cleanText(input.tagline, { field: 'tagline', maxChars: LIMITS.taglineMaxChars, allowEmpty: true }),
    stage: input.stage === undefined ? 'Prototype' : cleanStage(input.stage),
    tags: input.tags === undefined ? [] : cleanTags(input.tags),
    repository: input.repository === undefined || input.repository === '' ? '' : canonicalRepository(input.repository),
  };
  assertRepositoryFree(state.projects, fields.repository);
  if (state.projects.length + removedOf(state).length + 1 > LIMITS.maxProjects) fail('LIMIT_EXCEEDED', `More than ${LIMITS.maxProjects} projects.`);
  const project = buildNewProject(fields, { now });
  return { state: withProjects(state, [...state.projects, project]), result: { projectId: id, changed: true } };
}

/**
 * Edit presentation fields only (name, tagline, stage, tags). Identity (id, repository, dataMode), lifecycle and every other
 * field are not editable here; naming one is refused, not ignored. A patch that changes nothing returns the SAME state object.
 */
export function editProject(state, { id, patch }, { now }) {
  assertUsableState(state);
  assertNow(now);
  if (!isRecord(patch) || Object.keys(patch).length === 0) fail('INVALID_INPUT', 'Edit patch must name at least one field.');
  const forbidden = Object.keys(patch).filter((k) => !EDITABLE_FIELDS.includes(k));
  if (forbidden.length) fail('FIELD_NOT_EDITABLE', 'Only name, tagline, stage and tags can be edited.', { fields: forbidden });
  const index = locate(state, id);
  const current = state.projects[index];
  const clean = {};
  if ('name' in patch) clean.name = cleanText(patch.name, { field: 'name', maxChars: LIMITS.nameMaxChars });
  if ('tagline' in patch) clean.tagline = cleanText(patch.tagline, { field: 'tagline', maxChars: LIMITS.taglineMaxChars, allowEmpty: true });
  if ('stage' in patch) clean.stage = cleanStage(patch.stage);
  if ('tags' in patch) clean.tags = cleanTags(patch.tags);
  const changed = Object.keys(clean).filter((k) => !sameJson(current[k], clean[k]));
  if (changed.length === 0) return { state, result: { projectId: id, changed: false } };
  const management = withConnection(nextManagement(current, { now, event: 'edited' }), persistedLegacyConnection(state, current, now));
  const project = { ...current, ...Object.fromEntries(changed.map((k) => [k, clean[k]])), management };
  return { state: withProjects(state, replaceAt(state.projects, index, project)), result: { projectId: id, changed: true, fields: changed } };
}

/** ACTIVE -> ARCHIVED. Non-destructive: the record, its id and history stay in `projects`. */
export function archiveProject(state, { id }, { now }) {
  assertUsableState(state);
  assertNow(now);
  const index = locate(state, id);
  const current = state.projects[index];
  if (lifecycleOf(current) !== LIFECYCLE.ACTIVE) fail('ILLEGAL_TRANSITION', 'Only an active project can be archived.', { projectId: id });
  const management = withConnection(nextManagement(current, { now, event: 'archived', lifecycle: LIFECYCLE.ARCHIVED }), revokedConnectionFor(state, current, 'archived', now));
  const project = { ...current, management };
  return { state: withProjects(state, replaceAt(state.projects, index, project)), result: { projectId: id, changed: true } };
}

/** ARCHIVED -> ACTIVE. */
export function restoreProject(state, { id }, { now }) {
  assertUsableState(state);
  assertNow(now);
  const index = locate(state, id);
  const current = state.projects[index];
  if (lifecycleOf(current) !== LIFECYCLE.ARCHIVED) fail('ILLEGAL_TRANSITION', 'Only an archived project can be restored.', { projectId: id });
  const project = { ...current, management: nextManagement(current, { now, event: 'restored', lifecycle: LIFECYCLE.ACTIVE }) };
  return { state: withProjects(state, replaceAt(state.projects, index, project)), result: { projectId: id, changed: true } };
}

/**
 * Local-only soft remove: the complete record moves from `projects` to `projectManagement.removed` with its position and
 * lifecycle. Nothing outside the saved state is touched (no GitHub repository, clone, path, PR or credential). Its id stays
 * reserved. There is deliberately no hard-delete command in V1.2A.
 */
export function removeProject(state, { id }, { now }) {
  assertUsableState(state);
  assertNow(now);
  const index = locate(state, id);
  const current = state.projects[index];
  const lifecycle = lifecycleOf(current);
  const project = { ...current, management: withConnection(nextManagement(current, { now, event: 'removed', lifecycle }), revokedConnectionFor(state, current, 'removed', now)) };
  const entry = { project, removedAt: now, previousIndex: index, previousLifecycle: lifecycle };
  const projects = state.projects.filter((_, i) => i !== index);
  return { state: withProjects(state, projects, [...removedOf(state), entry]), result: { projectId: id, changed: true } };
}

/**
 * Brings a removed project back, at its previous position (clamped) and with its previous lifecycle. Refused if its id or
 * repository has since been taken by a current project.
 */
export function recoverRemovedProject(state, { id }, { now }) {
  assertUsableState(state);
  assertNow(now);
  assertProjectId(id);
  const removed = removedOf(state);
  const matches = removed.flatMap((e, i) => (e.project.id === id ? [i] : []));
  if (matches.length === 0) fail('NOT_FOUND', 'No removed project has this id.', { projectId: id });
  if (matches.length > 1) fail('AMBIGUOUS_ID', 'More than one removed project has this id; refusing to guess.', { projectId: id });
  if (state.projects.some((p) => p.id === id)) fail('ID_COLLISION', 'A current project already uses this id.', { projectId: id });
  const entry = removed[matches[0]];
  assertRepositoryFree(state.projects, entry.project.repository);
  const project = { ...entry.project, management: nextManagement(entry.project, { now, event: 'recovered' }) };
  const at = Number.isInteger(entry.previousIndex) && entry.previousIndex >= 0 ? Math.min(entry.previousIndex, state.projects.length) : state.projects.length;
  const projects = [...state.projects.slice(0, at), project, ...state.projects.slice(at)];
  return { state: withProjects(state, projects, removed.filter((_, i) => i !== matches[0])), result: { projectId: id, changed: true } };
}

// ------------------------------------------------------------------------------------------------ V1.2C GitHub connection

/**
 * Shared checks for connect/change, run BEFORE any GitHub request (the route calls it as a pre-check) and again inside the
 * command. Returns the target project and the canonical repository the server must verify.
 */
export function prepareConnection(state, command) {
  assertUsableState(state);
  const { type, id } = command;
  const index = locate(state, id);
  const current = state.projects[index];
  if (removedOf(state).some((e) => e.project.id === id)) fail('AMBIGUOUS_ID', 'A removed project uses the same id; refusing to guess.', { projectId: id });
  if (current.dataMode !== undefined) fail('UNTRUSTED_IDENTITY', 'Only a registered project (no dataMode) can be connected to GitHub.', { projectId: id });
  if (lifecycleOf(current) !== LIFECYCLE.ACTIVE) fail('ILLEGAL_TRANSITION', 'Restore the project before connecting it to GitHub.', { projectId: id });
  const repository = canonicalRepository(command.repository);
  if (type === 'connect') {
    if (isEffectivelyConnected(state, current)) fail('ALREADY_CONNECTED', 'This project is already connected. Disconnect or change the repository instead.', { projectId: id });
    if (current.repository && repositoryKey(current.repository) !== repositoryKey(repository)) {
      fail('REPOSITORY_MISMATCH', 'This project already names another repository. Use "change repository" to switch.', { projectId: id });
    }
  } else {
    if (!current.repository) fail('NOT_CONNECTED', 'This project has no repository to change. Use "connect" instead.', { projectId: id });
    if (command.confirmPreviousRepository !== current.repository) fail('INVALID_INPUT', 'Confirm the current repository exactly to change it.', { field: 'confirmPreviousRepository' });
    if (repositoryKey(repository) === repositoryKey(current.repository)) fail('INVALID_INPUT', 'The new repository is the same as the current one.', { field: 'repository' });
  }
  const key = repositoryKey(repository);
  const others = [...state.projects.filter((_, i) => i !== index), ...removedOf(state).map((e) => e.project)];
  const clash = others.find((p) => repositoryKey(p.repository) === key || repositoryKey(connectionOf(p)?.repository) === key);
  if (clash) fail('DUPLICATE_REPOSITORY', 'Another current or removed project already uses this repository.', { projectId: clash.id });
  return { index, current, repository };
}

/** The server's verified identity must name the same repository; GitHub's exact full_name becomes the stored spelling. */
function verifiedRepository(verified, repository) {
  if (!isRecord(verified) || typeof verified.fullName !== 'string' || !Number.isInteger(verified.id) || verified.id < 1) {
    fail('INVALID_INPUT', 'The repository has not been verified by the server.');
  }
  let fullName;
  try { fullName = canonicalRepository(verified.fullName); } catch { fail('INVALID_INPUT', 'The verified repository name is invalid.'); }
  if (fullName !== verified.fullName || repositoryKey(fullName) !== repositoryKey(repository)) fail('REPOSITORY_MISMATCH', 'GitHub reported a different repository (renamed or redirected); not connected.');
  return { fullName, id: verified.id };
}

function applyConnection(state, command, { now }, event) {
  assertNow(now);
  const { index, current, repository } = prepareConnection(state, command);
  const v = verifiedRepository(command.verified, repository);
  const githubConnection = connectionRecord(connectionOf(current), { status: CONNECTION_STATUS.CONNECTED, repository: v.fullName, source: 'user-verified', connectedAt: now, verifiedRepositoryId: v.id });
  const project = { ...current, repository: v.fullName, management: { ...nextManagement(current, { now, event }), githubConnection } };
  return { state: withProjects(state, replaceAt(state.projects, index, project)), result: { projectId: current.id, changed: true, repository: v.fullName } };
}

/** Not connected -> connected for the server-verified repository. The project id never changes. */
export function connectGithub(state, command, ctx) {
  return applyConnection(state, { ...command, type: 'connect' }, ctx, 'github-connected');
}

/** Switches to another server-verified repository; the old authority ends in the same atomic write. */
export function changeGithubRepository(state, command, ctx) {
  return applyConnection(state, { ...command, type: 'change' }, ctx, 'github-repository-changed');
}

/** Connected (saved record or legacy rule) -> disconnected. History reads stop on the next request. */
export function disconnectGithub(state, { id }, { now }) {
  assertUsableState(state);
  assertNow(now);
  const index = locate(state, id);
  const current = state.projects[index];
  if (!isEffectivelyConnected(state, current)) fail('NOT_CONNECTED', 'This project is not connected to GitHub.', { projectId: id });
  const githubConnection = revokedConnectionFor(state, current, 'disconnected', now);
  const project = { ...current, management: { ...nextManagement(current, { now, event: 'github-disconnected' }), githubConnection } };
  return { state: withProjects(state, replaceAt(state.projects, index, project)), result: { projectId: id, changed: true } };
}

export const PROJECT_COMMANDS = Object.freeze({
  add: addProject,
  edit: editProject,
  archive: archiveProject,
  restore: restoreProject,
  remove: removeProject,
  recover: recoverRemovedProject,
  connect: connectGithub,
  disconnect: disconnectGithub,
  change: changeGithubRepository,
});

/** Dispatch by name; an unknown command is refused. */
export function applyProjectCommand(state, command, ctx) {
  if (!isRecord(command) || !Object.prototype.hasOwnProperty.call(PROJECT_COMMANDS, command.type)) fail('INVALID_COMMAND', 'Unknown project command.');
  const { type, ...payload } = command;
  return PROJECT_COMMANDS[type](state, type === 'add' ? payload.input : payload, ctx);
}
