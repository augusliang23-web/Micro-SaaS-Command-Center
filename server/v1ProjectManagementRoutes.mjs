// V1.2B project management API: one versioned read and ONE mutating route over the V1.2A store.
//
//   GET  /api/projects            -> { version, projects, removed }   (strictly validated; 404 when no saved state exists)
//   POST /api/projects/commands   -> { version, result }             (add | edit | archive | restore | remove | recover |
//                                                                      connect | disconnect | change)
//
// V1.2C: connect/change first pass the same domain checks as the command (no GitHub call for a request that would be refused),
// then ONE bounded read-only `gh api --method GET repos/{owner}/{repo}` confirms the repository and the user's read access, and
// only then is the server-built `verified` identity added to the command. A client can never send `verified`.
//
// The request policy (Host, Origin/Referer), the method gate and createProjectWriteGate (positive same-origin Origin, JSON media
// type, Content-Length cap) run BEFORE this router; see server/v1RequestPolicy.mjs. This router reads the body itself with a hard
// byte cap, accepts only an allowlisted command shape, and never accepts a path, storage target, id generator, clock, token or
// whole state from the caller: the store, its directory, the clock and the UUID generator are server-side.
// Responses never contain file paths, stack traces or file contents beyond the saved projects themselves.

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import { prepareConnection } from './projectManagementCommands.mjs';
import { ProjectDataError } from './projectManagementSchema.mjs';
import { createProjectStore } from './projectManagementStore.mjs';
import { authorizationSummary } from './githubConnectionRegistry.mjs';
import { ghApiPage } from './githubDevelopmentHistory.mjs';
import { GithubCliError } from './githubRepos.mjs';

export const MAX_COMMAND_BYTES = 16 * 1024;
const NO_STATE_MESSAGE = 'No saved state yet.';

const STATUS_BY_CODE = {
  INVALID_INPUT: 400, INVALID_ID: 400, FIELD_NOT_EDITABLE: 400, INVALID_COMMAND: 400, INVALID_REQUEST: 400,
  NOT_FOUND: 404, NO_STATE: 404,
  CONFLICT: 409, DUPLICATE_REPOSITORY: 409, ID_COLLISION: 409, ILLEGAL_TRANSITION: 409, AMBIGUOUS_ID: 409, LIMIT_EXCEEDED: 409,
  UNTRUSTED_IDENTITY: 409, ALREADY_CONNECTED: 409, NOT_CONNECTED: 409, REPOSITORY_MISMATCH: 409,
  GITHUB_VERIFICATION_FAILED: 502,
  PAYLOAD_TOO_LARGE: 413,
  LOCKED: 423,
};
// Server-side failures get a fixed message: the store's own text may name files.
const SERVER_MESSAGES = {
  CORRUPT_STATE: 'Saved state is unreadable. Nothing was changed.',
  INVALID_STATE: 'Saved state does not match the expected format. Nothing was changed.',
  UNSAFE_TARGET: 'The saved-state file failed a safety check. Nothing was changed.',
  WRITE_FAILED: 'Saving failed. The previous saved state is unchanged.',
  BACKUP_FAILED: 'Saving was stopped because a backup could not be written. The previous saved state is unchanged.',
  // V1.2 remediation F1: the file was already replaced when this failed, so the outcome is unknown, never "unchanged".
  COMMIT_OUTCOME_UNKNOWN: 'The change may or may not have been saved; this could not be confirmed. Reload the current state before trying again.',
};

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const reject = (code, message) => { throw new ProjectDataError(code, message); };

function sendError(res, error, extra = {}) {
  if (error instanceof ProjectDataError) {
    const status = STATUS_BY_CODE[error.code] ?? 500;
    const message = status === 500 ? (SERVER_MESSAGES[error.code] ?? 'The request could not be completed.') : error.message;
    const body = { error: message, code: error.code };
    if (error.code === 'CONFLICT' && typeof error.details?.currentVersion === 'string') body.currentVersion = error.details.currentVersion;
    if (error.code === 'GITHUB_VERIFICATION_FAILED' && typeof error.details?.kind === 'string') body.kind = error.details.kind;
    res.status(status).json({ ...body, ...extra });
    return;
  }
  res.status(500).json({ error: 'The request could not be completed.', code: 'INTERNAL' });
}

/** Exact allowed keys per command. Anything else (including id generators, clocks, paths or a whole state) is refused. */
const COMMAND_KEYS = {
  add: ['type', 'input'],
  edit: ['type', 'id', 'patch'],
  archive: ['type', 'id'],
  restore: ['type', 'id'],
  remove: ['type', 'id', 'confirmProjectId'],
  recover: ['type', 'id'],
  connect: ['type', 'id', 'repository'],
  disconnect: ['type', 'id'],
  change: ['type', 'id', 'repository', 'confirmPreviousRepository'],
};
const ADD_KEYS = ['name', 'tagline', 'stage', 'tags', 'repository'];

/** Validates the request envelope and returns `{ expectedVersion, command }` in the shape the V1.2A store expects. */
export function parseCommandRequest(body) {
  if (!isRecord(body)) reject('INVALID_REQUEST', 'The request body must be a JSON object.');
  const extra = Object.keys(body).filter((k) => k !== 'expectedVersion' && k !== 'command');
  if (extra.length) reject('INVALID_REQUEST', 'The request has unsupported fields.');
  const { expectedVersion, command } = body;
  if (typeof expectedVersion !== 'string' || !/^(absent|[0-9a-f]{64})$/.test(expectedVersion)) reject('INVALID_REQUEST', 'expectedVersion is required.');
  if (!isRecord(command) || typeof command.type !== 'string' || !Object.prototype.hasOwnProperty.call(COMMAND_KEYS, command.type)) {
    reject('INVALID_COMMAND', 'Unknown project command.');
  }
  const allowed = COMMAND_KEYS[command.type];
  if (Object.keys(command).some((k) => !allowed.includes(k)) || allowed.some((k) => !(k in command))) {
    reject('INVALID_REQUEST', `The ${command.type} command has missing or unsupported fields.`);
  }
  if (command.type === 'add' && (!isRecord(command.input) || Object.keys(command.input).some((k) => !ADD_KEYS.includes(k)))) {
    reject('INVALID_REQUEST', 'The add command has unsupported fields.');
  }
  if (command.type === 'edit' && !isRecord(command.patch)) reject('INVALID_REQUEST', 'The edit command needs a patch object.');
  if ('id' in command && typeof command.id !== 'string') reject('INVALID_REQUEST', 'id must be a string.');
  if ('repository' in command && typeof command.repository !== 'string') reject('INVALID_REQUEST', 'repository must be a string.');
  if ('confirmPreviousRepository' in command && typeof command.confirmPreviousRepository !== 'string') reject('INVALID_REQUEST', 'confirmPreviousRepository must be a string.');
  if (command.type === 'remove' && command.confirmProjectId !== command.id) reject('INVALID_REQUEST', 'Removing a project needs confirmProjectId equal to its id.');
  const { confirmProjectId: _confirmed, ...forStore } = command;
  return { expectedVersion, command: forStore };
}

/** Reads at most `limit` bytes of the request body; more is PAYLOAD_TOO_LARGE. Bytes must be strict UTF-8 JSON. */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject_) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, value) => { if (!done) { done = true; fn(value); } };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(reject_, new ProjectDataError('PAYLOAD_TOO_LARGE', 'The request body is too large.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        finish(resolve, JSON.parse(text));
      } catch {
        finish(reject_, new ProjectDataError('INVALID_REQUEST', 'The request body is not valid JSON.'));
      }
    });
    req.on('error', () => finish(reject_, new ProjectDataError('INVALID_REQUEST', 'The request body could not be read.')));
  });
}

export const VERIFY_TIMEOUT_MS = 10_000;
const VERIFY_KIND_MESSAGE = {
  not_authenticated: 'GitHub CLI is not signed in, so the repository cannot be verified. Not connected.',
  forbidden: 'GitHub refused access to this repository. Not connected.',
  missing: 'GitHub did not return this repository (it may not exist, or this account cannot read it). Not connected.',
  rate_limited: 'GitHub rate limit reached. Not connected; try again later.',
  timeout: 'GitHub did not answer in time. Not connected.',
  aborted: 'The verification was cancelled. Not connected.',
};

/**
 * Default verifier: one read-only metadata GET through the existing gh CLI session. Any failure, or an answer that is not a
 * repository with a full_name and numeric id, fails closed. Tokens are never read or returned.
 */
export async function verifyRepositoryWithGh(repository, { signal } = {}) {
  try {
    const { data } = await ghApiPage(`repos/${repository}`, { signal, timeoutMs: VERIFY_TIMEOUT_MS });
    if (!isRecord(data) || typeof data.full_name !== 'string' || !Number.isInteger(data.id)) throw new GithubCliError('Unexpected repository response.', 'failed');
    return { fullName: data.full_name, id: data.id };
  } catch (error) {
    const kind = error instanceof GithubCliError ? error.kind : 'failed';
    throw new ProjectDataError('GITHUB_VERIFICATION_FAILED', VERIFY_KIND_MESSAGE[kind] ?? 'The repository could not be verified on GitHub. Not connected.', { kind });
  }
}

/**
 * Default store location: `<cwd>/data`, the same directory the V1 `GET /api/state` reads. A missing directory means there is no
 * saved state (it is never created here).
 */
export function defaultStoreFactory() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) return null;
  return createProjectStore({ dataDir });
}

/**
 * @param {object} [deps]
 * @param {() => ReturnType<typeof createProjectStore> | null} [deps.storeFactory] returns the store, or null when no data directory exists
 */
export function createV1ProjectManagementRouter({ storeFactory = defaultStoreFactory, verifyRepository = verifyRepositoryWithGh } = {}) {
  const router = express.Router({ caseSensitive: false, strict: true });

  router.get('/projects', (req, res) => {
    try {
      const store = storeFactory();
      const snapshot = store ? store.read() : { state: null };
      if (snapshot.state === null) {
        res.status(404).json({ error: NO_STATE_MESSAGE, code: 'NO_STATE' });
        return;
      }
      const removed = Array.isArray(snapshot.state.projectManagement?.removed) ? snapshot.state.projectManagement.removed : [];
      res.json({
        version: snapshot.version,
        projects: snapshot.state.projects,
        removed: removed.map((e) => ({ project: e.project, removedAt: e.removedAt, previousLifecycle: e.previousLifecycle ?? null })),
        // The server's own projection of who may read GitHub history now. It is re-derived on every history request.
        githubAuthorizations: authorizationSummary(snapshot.state),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/projects/commands', async (req, res) => {
    try {
      const { expectedVersion, command } = parseCommandRequest(await readJsonBody(req, MAX_COMMAND_BYTES));
      const store = storeFactory();
      if (!store) reject('NO_STATE', NO_STATE_MESSAGE);
      if (command.type === 'connect' || command.type === 'change') {
        // Refuse stale or invalid requests BEFORE contacting GitHub; then verify; then the version-checked write re-validates all.
        const { state, version } = store.read();
        if (state === null) reject('NO_STATE', NO_STATE_MESSAGE);
        if (version !== expectedVersion) throw new ProjectDataError('CONFLICT', 'The saved state changed since it was read; re-read and retry.', { currentVersion: version });
        const { repository } = prepareConnection(state, command);
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        command.verified = await verifyRepository(repository, { signal: controller.signal });
      }
      const { version, result } = store.apply({ expectedVersion, command });
      res.json({ version, result });
    } catch (error) {
      // F1: an uncertain commit is reconciled by a fresh, validated read. The response says what is current now (or that the
      // state cannot be read); it never retries the command and never claims the previous state is unchanged.
      if (error instanceof ProjectDataError && error.code === 'COMMIT_OUTCOME_UNKNOWN') {
        let reconciliation = { outcome: 'unknown', stateReadable: false, currentVersion: null };
        try {
          const store = storeFactory();
          const current = store ? store.read() : null;
          if (current && current.state !== null) reconciliation = { outcome: 'unknown', stateReadable: true, currentVersion: current.version };
        } catch { /* stays unreadable */ }
        sendError(res, error, reconciliation);
        return;
      }
      sendError(res, error);
    }
  });

  return router;
}
