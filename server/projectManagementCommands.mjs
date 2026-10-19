// V1.2A project management commands: pure transforms of a saved state. No filesystem, network or clock access; the input is
// never mutated (unrelated projects and top-level fields are carried over by reference, so they serialise identically).
// Every command validates the whole input first and the whole result last (assertUsableState); any doubt is refused with a
// ProjectDataError, never resolved by guessing. Not imported by server.ts; nothing here is reachable from the V1 server.

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
  lifecycleOf,
  nextManagement,
  removedOf,
  repositoryKey,
} from './projectManagementSchema.mjs';

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
  const project = { ...current, ...Object.fromEntries(changed.map((k) => [k, clean[k]])), management: nextManagement(current, { now, event: 'edited' }) };
  return { state: withProjects(state, replaceAt(state.projects, index, project)), result: { projectId: id, changed: true, fields: changed } };
}

/** ACTIVE -> ARCHIVED. Non-destructive: the record, its id and history stay in `projects`. */
export function archiveProject(state, { id }, { now }) {
  assertUsableState(state);
  assertNow(now);
  const index = locate(state, id);
  const current = state.projects[index];
  if (lifecycleOf(current) !== LIFECYCLE.ACTIVE) fail('ILLEGAL_TRANSITION', 'Only an active project can be archived.', { projectId: id });
  const project = { ...current, management: nextManagement(current, { now, event: 'archived', lifecycle: LIFECYCLE.ARCHIVED }) };
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
  const project = { ...current, management: nextManagement(current, { now, event: 'removed', lifecycle }) };
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

export const PROJECT_COMMANDS = Object.freeze({
  add: addProject,
  edit: editProject,
  archive: archiveProject,
  restore: restoreProject,
  remove: removeProject,
  recover: recoverRemovedProject,
});

/** Dispatch by name; an unknown command is refused. */
export function applyProjectCommand(state, command, ctx) {
  if (!isRecord(command) || !Object.prototype.hasOwnProperty.call(PROJECT_COMMANDS, command.type)) fail('INVALID_COMMAND', 'Unknown project command.');
  const { type, ...payload } = command;
  return PROJECT_COMMANDS[type](state, type === 'add' ? payload.input : payload, ctx);
}
