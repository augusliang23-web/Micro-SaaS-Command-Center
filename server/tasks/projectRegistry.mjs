import { readFileSync } from 'node:fs';
import path from 'node:path';

import { AGENTS } from './types.mjs';
import { ACTION_POLICY, classifyAction } from './actionPolicy.mjs';

// The only source of filesystem paths, branches, commands and binaries.
// Browser requests carry a projectId and nothing else of this kind.

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const VERIFY_COMMAND_KEYS = ['test', 'lint', 'build'];
const BINARY_KEYS = ['claude', 'codex'];

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isCleanAbsolutePath = (value) =>
  isNonEmptyString(value) && path.isAbsolute(value) && path.normalize(value) === value &&!value.includes('\0');
const isSafeRelativePath = (value) =>
  isNonEmptyString(value) && !path.isAbsolute(value) && !value.split('/').includes('..') && !value.includes('\0');

function validateProject(project, index) {
  const label = `projects[${index}]`;
  if (!isRecord(project)) throw new Error(`${label} must be an object`);
  if (!PROJECT_ID.test(project.projectId ?? '')) throw new Error(`${label}.projectId is invalid`);
  const where = `${label} (${project.projectId})`;
  if (!REPOSITORY.test(project.repository ?? '')) throw new Error(`${where}.repository must be owner/name`);
  if (!isCleanAbsolutePath(project.localPath)) throw new Error(`${where}.localPath must be a clean absolute path`);
  if (!isCleanAbsolutePath(project.worktreeRoot)) throw new Error(`${where}.worktreeRoot must be a clean absolute path`);
  if (!BRANCH.test(project.defaultBranch ?? '') || project.defaultBranch.includes('..') || project.defaultBranch.endsWith('/') || project.defaultBranch.endsWith('.lock')) {
    throw new Error(`${where}.defaultBranch is invalid`);
  }
  if (!Array.isArray(project.allowedAgents) || project.allowedAgents.length === 0 || !project.allowedAgents.every((a) => AGENTS.includes(a))) {
    throw new Error(`${where}.allowedAgents must be a non-empty list of known agents`);
  }
  if (!Array.isArray(project.allowedActions) || !project.allowedActions.every((a) => classifyAction(a, ACTION_POLICY) !== null)) {
    throw new Error(`${where}.allowedActions must contain only known actions`);
  }
  // A project file can narrow the policy but never widen it past the V1 rules.
  const forbidden = project.allowedActions.find((a) => classifyAction(a, ACTION_POLICY) === 'FORBIDDEN_IN_V1');
  if (forbidden) throw new Error(`${where}.allowedActions may not include ${forbidden} (FORBIDDEN_IN_V1)`);
  if (!isRecord(project.verifyCommands) || !Object.keys(project.verifyCommands).every((k) => VERIFY_COMMAND_KEYS.includes(k)) || !Object.values(project.verifyCommands).every(isNonEmptyString)) {
    throw new Error(`${where}.verifyCommands must map test/lint/build to command strings`);
  }
  if (project.setupCommand !== undefined && !isNonEmptyString(project.setupCommand)) {
    throw new Error(`${where}.setupCommand must be a non-empty string when present`);
  }
  if (!Array.isArray(project.protectedPaths) || !project.protectedPaths.every(isSafeRelativePath)) {
    throw new Error(`${where}.protectedPaths must be repository-relative paths`);
  }
  if (!isRecord(project.agentBinaries) || !Object.keys(project.agentBinaries).every((k) => BINARY_KEYS.includes(k)) || !Object.values(project.agentBinaries).every(isCleanAbsolutePath)) {
    throw new Error(`${where}.agentBinaries must map claude/codex to absolute paths`);
  }
  return {
    projectId: project.projectId,
    repository: project.repository,
    localPath: project.localPath,
    defaultBranch: project.defaultBranch,
    worktreeRoot: project.worktreeRoot,
    allowedAgents: [...project.allowedAgents],
    allowedActions: [...project.allowedActions],
    verifyCommands: { ...project.verifyCommands },
    ...(project.setupCommand !== undefined ? { setupCommand: project.setupCommand } : {}),
    protectedPaths: [...project.protectedPaths],
    agentBinaries: { ...project.agentBinaries },
  };
}

export class ProjectRegistry {
  #projects;

  /** Throws on any malformed input: a bad registry must never half-load. */
  constructor(config) {
    if (!isRecord(config) || !Array.isArray(config.projects) || config.projects.length === 0) {
      throw new Error('Project registry must contain a non-empty "projects" array');
    }
    const projects = new Map();
    config.projects.forEach((raw, index) => {
      const project = validateProject(raw, index);
      if (projects.has(project.projectId)) throw new Error(`Duplicate projectId: ${project.projectId}`);
      projects.set(project.projectId, Object.freeze(project));
    });
    this.#projects = projects;
  }

  /** Server-internal view, including paths and commands. Never send this to the browser. */
  get(projectId) {
    return typeof projectId === 'string' ? (this.#projects.get(projectId) ?? null) : null;
  }

  /** Browser-safe projection: no paths, binaries or commands. */
  publicList() {
    return [...this.#projects.values()].map((p) => ({
      projectId: p.projectId,
      repository: p.repository,
      defaultBranch: p.defaultBranch,
      allowedAgents: [...p.allowedAgents],
    }));
  }
}

export function loadProjectRegistry(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Project registry could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return new ProjectRegistry(parsed);
}
