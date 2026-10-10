import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { BoundaryError } from './executionPolicy.mjs';
import { ACTION_POLICY, classifyAction } from '../tasks/actionPolicy.mjs';
import { TASK_ID_PATTERN } from '../tasks/types.mjs';

/**
 * Phase 3B7B1 approval gate for the Docker execution path.
 *
 * On the Docker path COMMIT, PUSH_BRANCH and CREATE_PR are never automatic. Each needs ONE single-use approval record that is
 * bound to: the task identity, the action, the exact diff (a SHA-256 over every changed path and content hash), the base
 * commit and the task branch. A record that is missing, expired, not yet valid, mismatched, malformed, already consumed or
 * ambiguous blocks the action. Consuming is atomic (exclusive-create marker) and happens BEFORE the action, so an approval
 * cannot be replayed even when the action then fails.
 *
 * HONEST LIMIT: records live in a local directory owned by the same user. They are labelled UNAUTHENTICATED_LOCAL_APPROVAL
 * and are NOT signed. They stop the execution agent and mistakes; they do not stop a process that can write that directory.
 * No signing key, permit or attestation exists in this phase. Approvals never raise an evidence grade above RUNTIME_OBSERVED.
 */

export const APPROVAL_AUTHENTICITY = 'UNAUTHENTICATED_LOCAL_APPROVAL';
export const GATED_ACTIONS = Object.freeze(['COMMIT', 'PUSH_BRANCH', 'CREATE_PR']);
export const APPROVER_SOURCES = Object.freeze(['CONTROL_PLANE', 'HUMAN_OPERATOR']);
export const MAX_APPROVAL_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const MAX_MANIFEST_FILES = 200;
const MAX_MANIFEST_FILE_BYTES = 1024 * 1024;

/** The Docker path never inherits the automatic COMMIT/PUSH/CREATE_PR permissions of the fake Phase 2 path. */
export const DOCKER_PATH_ACTION_POLICY = Object.freeze({
  ...ACTION_POLICY,
  COMMIT: 'CONTROL_PLANE_APPROVAL',
  PUSH_BRANCH: 'CONTROL_PLANE_APPROVAL',
  CREATE_PR: 'CONTROL_PLANE_APPROVAL',
});

export class ApprovalError extends BoundaryError {
  constructor(code, message) { super(message); this.name = 'ApprovalError'; this.approvalCode = code; }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const APPROVAL_ID = /^APR-[0-9a-f]{16}$/;
const APPROVER_ID = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,63}$/;
// An approver identity can never be (or look like) the execution agent.
const AGENT_LIKE = /(agent|claude|codex|fake|bot|assistant|\bai\b|sandbox|container)/i;
const BRANCH = /^agent\/CC-\d{8}-[0-9a-f]{8}-[a-z0-9-]+$/;
const RECORD_KEYS = ['approvalId', 'taskId', 'action', 'diffDigest', 'treeSha', 'baseSha', 'branch', 'issuedAt', 'expiresAt', 'approvedBy', 'authenticity'];
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const parseIso = (value) => (typeof value === 'string' && ISO.test(value) ? Date.parse(value) : NaN);

// ---- Exact-diff binding --------------------------------------------------------------------------------------------

/** Canonical digest of a manifest file list. Pure; the same function is used to compute and to re-check. */
export function diffDigestOf(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_MANIFEST_FILES) throw new BoundaryError('Diff manifest must list between 1 and 200 files');
  const seen = new Set();
  const normalized = files.map((f) => {
    if (!isRecord(f) || typeof f.path !== 'string' || f.path === '' || seen.has(f.path)) throw new BoundaryError('Malformed or duplicate diff manifest entry');
    seen.add(f.path);
    if (f.deleted === true) return { path: f.path, deleted: true };
    if (!SHA256.test(f.sha256 ?? '') || !Number.isInteger(f.size) || f.size < 0 || typeof f.exec !== 'boolean') throw new BoundaryError('Malformed diff manifest entry');
    return { path: f.path, sha256: f.sha256, size: f.size, exec: f.exec };
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(JSON.stringify({ v: 1, files: normalized }));
}

const safeRelativePath = (p) => typeof p === 'string' && p !== '' && !p.includes('\0') && !p.includes('\\') && !path.posix.isAbsolute(p)
  && path.posix.normalize(p) === p && p !== '.' && !p.startsWith('../') && !/^\.git(\/|$)/i.test(p) && !p.split('/').some((s) => s.toLowerCase() === '.git');

/**
 * Host-side manifest of the changed paths. Reads each file without following symlinks and rejects anything that is not a plain
 * regular file with one hard link; a deleted path is recorded as deleted. Nothing from the worktree is ever executed.
 */
export function computeDiffManifest({ worktreePath, paths, baseSha, fsImpl = fs }) {
  if (!SHA1.test(baseSha ?? '')) throw new BoundaryError('Diff manifest needs a 40-hex base commit');
  if (!Array.isArray(paths) || paths.length === 0) throw new BoundaryError('No changes to approve');
  if (paths.length > MAX_MANIFEST_FILES) throw new BoundaryError('Too many changed files to bind an approval');
  const root = fsImpl.realpathSync(worktreePath);
  const files = [];
  for (const rel of [...new Set(paths)].sort()) {
    if (!safeRelativePath(rel)) throw new BoundaryError(`Unsafe changed path: ${String(rel).slice(0, 60)}`);
    const parts = rel.split('/');
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      cursor = path.join(cursor, part);
      let stat;
      try { stat = fsImpl.lstatSync(cursor); } catch (e) { if (e.code === 'ENOENT') { cursor = null; break; } throw e; }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BoundaryError(`Changed path crosses a non-directory or symlink: ${rel}`);
    }
    const full = path.join(root, rel);
    let stat;
    try { stat = cursor === null ? null : fsImpl.lstatSync(full); } catch (e) { if (e.code === 'ENOENT') stat = null; else throw e; }
    if (stat === null) { files.push({ path: rel, deleted: true }); continue; }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new BoundaryError(`Changed path is not a regular file: ${rel}`);
    if (stat.nlink !== 1) throw new BoundaryError(`Changed file has multiple hard links: ${rel}`);
    if (stat.size > MAX_MANIFEST_FILE_BYTES) throw new BoundaryError(`Changed file is too large to bind an approval: ${rel}`);
    const fd = fsImpl.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fsImpl.fstatSync(fd);
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1) throw new BoundaryError(`Changed file changed while it was read: ${rel}`);
      const bytes = Buffer.alloc(opened.size);
      let off = 0;
      while (off < bytes.length) {
        const n = fsImpl.readSync(fd, bytes, off, bytes.length - off, off);
        if (!Number.isInteger(n) || n <= 0) throw new BoundaryError(`Short read of changed file: ${rel}`);
        off += n;
      }
      const exec = (opened.mode & 0o111) !== 0;
      // `blob` is the Git blob id of exactly these bytes (no filters): it lets the expected Git tree be computed independently of the index.
      files.push({ path: rel, sha256: sha256(bytes), size: bytes.length, exec, mode: exec ? '100755' : '100644', blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') });
    } finally { fsImpl.closeSync(fd); }
  }
  return { baseSha, files, fileCount: files.length, diffDigest: diffDigestOf(files) };
}

// ---- Approval records ----------------------------------------------------------------------------------------------

/** Structural validation of a stored/constructed approval. Returns problems; empty means well-formed. */
export function validateApprovalRecord(a) {
  const problems = [];
  if (!isRecord(a)) return ['approval must be an object'];
  for (const k of Object.keys(a)) if (!RECORD_KEYS.includes(k)) problems.push(`unknown field ${k.slice(0, 30)}`);
  for (const k of RECORD_KEYS) if (!Object.hasOwn(a, k)) problems.push(`${k} is required`);
  if (problems.length) return problems;
  if (!APPROVAL_ID.test(a.approvalId)) problems.push('approvalId is malformed');
  if (!TASK_ID_PATTERN.test(a.taskId)) problems.push('taskId is malformed');
  if (!GATED_ACTIONS.includes(a.action)) problems.push('action is not an approvable action');
  if (!SHA256.test(a.diffDigest)) problems.push('diffDigest is malformed');
  if (!SHA1.test(a.treeSha)) problems.push('treeSha is malformed');
  if (!SHA1.test(a.baseSha)) problems.push('baseSha is malformed');
  if (!BRANCH.test(a.branch) || !a.branch.startsWith(`agent/${a.taskId}-`)) problems.push('branch must be the generated task branch');
  const issued = parseIso(a.issuedAt); const expires = parseIso(a.expiresAt);
  if (!Number.isFinite(issued)) problems.push('issuedAt is malformed');
  if (!Number.isFinite(expires)) problems.push('expiresAt is malformed');
  if (Number.isFinite(issued) && Number.isFinite(expires) && (expires <= issued || expires - issued > MAX_APPROVAL_TTL_MS)) problems.push('approval lifetime is invalid');
  if (!isRecord(a.approvedBy) || Object.keys(a.approvedBy).sort().join() !== 'id,source' || !APPROVER_SOURCES.includes(a.approvedBy.source)
    || typeof a.approvedBy.id !== 'string' || !APPROVER_ID.test(a.approvedBy.id) || AGENT_LIKE.test(a.approvedBy.id)) problems.push('approvedBy must name a control-plane or human approver, never an agent');
  if (a.authenticity !== APPROVAL_AUTHENTICITY) problems.push('authenticity label is wrong');
  return problems;
}

export class ApprovalStore {
  #dir; #fs; #now;
  constructor({ dir, fsImpl = fs, now = () => new Date().toISOString() }) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Approval directory must be an absolute path');
    this.#dir = dir; this.#fs = fsImpl; this.#now = now;
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fsImpl.chmodSync(dir, 0o700);
  }
  #nowMs() { const t = Date.parse(this.#now()); if (!Number.isFinite(t)) throw new ApprovalError('CLOCK_INVALID', 'Approval clock is invalid'); return t; }
  #write(file, text) {
    const fd = this.#fs.openSync(file, 'wx', 0o600); // exclusive: an existing record or marker is never overwritten
    try {
      const bytes = Buffer.from(text, 'utf8'); let off = 0;
      while (off < bytes.length) {
        const n = this.#fs.writeSync(fd, bytes, off, bytes.length - off);
        if (!Number.isInteger(n) || n <= 0) throw new Error('Approval write made no progress');
        off += n;
      }
      this.#fs.fsyncSync(fd);
    } finally { this.#fs.closeSync(fd); }
  }

  /**
   * TRUSTED-CALLER ONLY (future Control Plane / operator surface). Never reachable from an adapter, an agent event, a task field
   * or a browser request. The store, not the caller, chooses the approval id.
   */
  grant({ taskId, action, diffDigest, treeSha, baseSha, branch, approvedBy, ttlMs = DEFAULT_APPROVAL_TTL_MS }) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_APPROVAL_TTL_MS) throw new ApprovalError('TTL_INVALID', 'Approval lifetime must be between 1 second and 15 minutes');
    const now = this.#nowMs();
    const record = {
      approvalId: `APR-${randomBytes(8).toString('hex')}`, taskId, action, diffDigest, treeSha, baseSha, branch,
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString(), approvedBy, authenticity: APPROVAL_AUTHENTICITY,
    };
    const problems = validateApprovalRecord(record);
    if (problems.length) throw new ApprovalError('APPROVAL_MALFORMED', `Invalid approval: ${problems.join('; ')}`);
    this.#write(path.join(this.#dir, `${record.approvalId}.json`), JSON.stringify(record, null, 2));
    return record;
  }

  #load(file) {
    try {
      const text = this.#fs.readFileSync(path.join(this.#dir, file), 'utf8');
      const record = JSON.parse(text);
      return validateApprovalRecord(record).length === 0 && file === `${record.approvalId}.json` ? record : null;
    } catch { return null; }
  }
  #consumed(approvalId) { return this.#fs.existsSync(path.join(this.#dir, `${approvalId}.consumed`)); }

  /**
   * Find exactly one valid, unconsumed approval for (task, action) that matches the expected subject, then burn it atomically.
   * Returns { ok:true, approval } or { ok:false, code, reasons }. Anything ambiguous fails closed.
   */
  authorize({ taskId, action, expect }) {
    if (!TASK_ID_PATTERN.test(taskId ?? '') || !GATED_ACTIONS.includes(action) || !isRecord(expect)) return { ok: false, code: 'REQUEST_INVALID', reasons: ['REQUEST_INVALID'] };
    if (!SHA256.test(expect.diffDigest ?? '') || !SHA1.test(expect.treeSha ?? '') || !SHA1.test(expect.baseSha ?? '') || typeof expect.branch !== 'string') return { ok: false, code: 'REQUEST_INVALID', reasons: ['REQUEST_INVALID'] };
    let now;
    try { now = this.#nowMs(); } catch { return { ok: false, code: 'CLOCK_INVALID', reasons: ['CLOCK_INVALID'] }; }
    let names;
    try { names = this.#fs.readdirSync(this.#dir).filter((f) => /^APR-[0-9a-f]{16}\.json$/.test(f)); } catch { return { ok: false, code: 'STORE_UNREADABLE', reasons: ['STORE_UNREADABLE'] }; }
    const candidates = names.map((f) => this.#load(f)).filter((r) => r && r.taskId === taskId && r.action === action);
    if (candidates.length === 0) return { ok: false, code: 'APPROVAL_MISSING', reasons: ['APPROVAL_MISSING'] };
    const valid = []; const reasons = new Set();
    for (const c of candidates) {
      const why = [];
      if (c.diffDigest !== expect.diffDigest || c.treeSha !== expect.treeSha || c.baseSha !== expect.baseSha || c.branch !== expect.branch) why.push('APPROVAL_MISMATCH');
      if (parseIso(c.expiresAt) <= now) why.push('APPROVAL_EXPIRED');
      if (parseIso(c.issuedAt) > now + CLOCK_SKEW_MS) why.push('APPROVAL_NOT_YET_VALID');
      if (this.#consumed(c.approvalId)) why.push('APPROVAL_CONSUMED');
      if (why.length === 0) valid.push(c); else why.forEach((w) => reasons.add(w));
    }
    if (valid.length === 0) {
      const order = ['APPROVAL_MISMATCH', 'APPROVAL_EXPIRED', 'APPROVAL_NOT_YET_VALID', 'APPROVAL_CONSUMED'];
      return { ok: false, code: order.find((c) => reasons.has(c)) ?? 'APPROVAL_MISSING', reasons: [...reasons] };
    }
    if (valid.length > 1) return { ok: false, code: 'APPROVAL_AMBIGUOUS', reasons: ['APPROVAL_AMBIGUOUS'] };
    const [approval] = valid;
    try {
      this.#write(path.join(this.#dir, `${approval.approvalId}.consumed`), JSON.stringify({ approvalId: approval.approvalId, taskId, action, diffDigest: approval.diffDigest, consumedAt: new Date(now).toISOString() }));
    } catch (error) {
      return { ok: false, code: error.code === 'EEXIST' ? 'APPROVAL_CONSUMED' : 'CONSUME_FAILED', reasons: [error.code === 'EEXIST' ? 'APPROVAL_CONSUMED' : 'CONSUME_FAILED'] };
    }
    return { ok: true, approval };
  }
}

/** What the Orchestrator sees: it can require an approval but can never grant one. */
export class ApprovalGate {
  #store;
  constructor({ store }) {
    if (!(store instanceof ApprovalStore)) throw new Error('An ApprovalStore is required');
    this.#store = store;
  }
  /** Throws ApprovalError (a BoundaryError) unless exactly one matching approval was found and burned. */
  require({ task, project, action, expect }) {
    if (classifyAction(action, DOCKER_PATH_ACTION_POLICY) !== 'CONTROL_PLANE_APPROVAL' || !GATED_ACTIONS.includes(action)) throw new ApprovalError('ACTION_NOT_GATED', `Action ${String(action).slice(0, 40)} is not an approvable Docker-path action`);
    if (!task?.allowedActions?.includes(action) || !project?.allowedActions?.includes(action)) throw new ApprovalError('ACTION_NOT_ALLOWED', `Action ${action} is not allowed for this task`);
    const result = this.#store.authorize({ taskId: task.taskId, action, expect });
    if (!result.ok) throw new ApprovalError(result.code, `${action} blocked: ${result.code}`);
    return result.approval;
  }
}
