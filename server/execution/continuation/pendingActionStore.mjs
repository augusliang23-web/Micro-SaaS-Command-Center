import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { TASK_ID_PATTERN } from '../../tasks/types.mjs';
import {
  MAX_RECORD_BYTES, MAX_REVISION, PENDING_ID_PATTERN, PendingActionError, applyStatusChange, applyStepAdvance, buildInitialRecord,
  validatePendingChain, validatePendingRecord,
} from './pendingActionTypes.mjs';

// Phase 3B7B2B-A1-0: PendingActionStore. Durable storage for pending actions. OFFLINE DATA FOUNDATION ONLY: no approval is consumed, no
// task is resumed, no Git command runs, no Docker call is made, no route exists. The store stores and validates; it never decides.
//
// Layout under one server-chosen root (owner-only):
//   records/<pendingId>/<revision, 10 digits>.json   one IMMUTABLE file per revision, mode 0600
//   tasks/<taskId>.open                              exclusive marker: this task has a pending action (see "invariants")
//
// Compare-and-set without a lock: a new revision is written to a temp file and then PUBLISHED with link(2), which fails with EEXIST if
// that revision already exists. Two writers (threads, processes) racing for revision N+1 therefore resolve atomically: exactly one wins,
// the other gets STALE_REVISION. A replayed revision is the same EEXIST. History is never overwritten, so a crash can only leave a temp file.
//
// Failure vocabulary (a failed or ambiguous write is never reported as success):
//   WRITE_FAILED     definitely NOT applied (failed before the revision was published)
//   WRITE_AMBIGUOUS  the revision MAY be on disk (failed after publication); callers must treat the outcome as UNKNOWN, never retry blindly
//
// Invariants this store DOES enforce (also across processes, through exclusive creation):
//   * a pendingId is unique;  * at most one pending action per TASK is held at a time (the task marker);  * revisions are contiguous,
//   immutable facts never change, and every step is a single legal move (checked on EVERY read of the whole chain).
// Invariants it does NOT enforce (documented dependencies of A1-1): any PROJECT-level exclusion (several tasks of one project may each
// hold a pending action, so parallel development branches stay possible; serialising the publishing of one repository needs a
// project-level lock or transaction coordinator that does not exist yet), the link between a pending action and the task's status, and
// ROLLBACK DETECTION: deleting the newest revision file makes the previous revision current again. Records are unsigned.

export class PendingStoreError extends PendingActionError {
  constructor(code, message) { super(code, message); this.name = 'PendingStoreError'; }
}
const fail = (code, message) => { throw new PendingStoreError(code, message); };

const REVISION_FILE = /^(\d{10})\.json$/;
const TEMP_FILE = /^\d{10}\.json\.tmp-\d+-[0-9a-f]{8}$/;
const MARKER_FILE = /^(CC-\d{8}-[0-9a-f]{8})\.open$/;
const MARKER_TEMP = /^CC-\d{8}-[0-9a-f]{8}\.open\.tmp-\d+-[0-9a-f]{8}$/;
const revisionName = (n) => `${String(n).padStart(10, '0')}.json`;

export class PendingActionStore {
  #fs; #root; #records; #tasks; #now; #uid; #pid; #randomHex;

  constructor({ root, fsImpl = fs, now = () => new Date().toISOString(), uid = process.getuid?.(), pid = process.pid, randomHex = (n) => randomBytes(n).toString('hex') } = {}) {
    this.#fs = fsImpl; this.#now = now; this.#uid = uid; this.#pid = pid; this.#randomHex = randomHex;
    if (typeof root !== 'string' || !path.isAbsolute(root) || /[\0\n\r]/.test(root) || path.normalize(root) !== root || root.endsWith('/') || root === path.parse(root).root) {
      fail('STORE_PATH', 'The pending-action root must be a normalized absolute directory path');
    }
    this.#root = root; this.#records = path.join(root, 'records'); this.#tasks = path.join(root, 'tasks');
    this.#assertCanonicalAncestor(root); // BEFORE any mkdir: nothing may be created through a symlinked parent
    for (const dir of [root, this.#records, this.#tasks]) this.#prepareDirectory(dir);
  }

  // ------------------------------------------------------------ filesystem safety

  /** The nearest EXISTING ancestor of the root must already be canonical, so a recursive mkdir can never write through a symlink. */
  #assertCanonicalAncestor(root) {
    let cursor = path.dirname(root);
    for (;;) {
      let exists = true;
      try { this.#fs.lstatSync(cursor); } catch (error) { if (error?.code === 'ENOENT') exists = false; else throw error; }
      if (exists) break;
      cursor = path.dirname(cursor);
    }
    if (this.#fs.realpathSync(cursor) !== cursor) fail('STORE_PATH', 'The store path is not canonical (a symlink is in the path)');
  }

  #prepareDirectory(dir) {
    try { this.#fs.mkdirSync(dir, { mode: 0o700, recursive: dir === this.#root }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    this.#checkDirectory(dir);
  }

  #checkDirectory(dir) {
    const stat = this.#fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('STORE_PATH', 'A store directory is a symlink or not a directory');
    if (this.#uid !== undefined && stat.uid !== this.#uid) fail('STORE_PERMISSIONS', 'A store directory is not owned by the current user');
    if ((stat.mode & 0o077) !== 0) fail('STORE_PERMISSIONS', 'A store directory is accessible to other users (mode must be 0700)');
    if (this.#fs.realpathSync(dir) !== dir) fail('STORE_PATH', 'The store path is not canonical (a symlink is in the path)');
  }

  /** Reads one regular, single-link, owner-only, size-bounded file without following symlinks. Null when absent. */
  #readText(file) {
    let fd;
    try {
      // O_NONBLOCK: a FIFO planted at a record path must fail the type check, never block the process.
      try { fd = this.#fs.openSync(file, this.#fs.constants.O_RDONLY | this.#fs.constants.O_NOFOLLOW | this.#fs.constants.O_NONBLOCK); } catch (error) {
        if (error?.code === 'ENOENT') return null;
        if (error?.code === 'ELOOP') fail('RECORD_CORRUPT', 'A store file is a symlink');
        throw error;
      }
      const stat = this.#fs.fstatSync(fd);
      if (!stat.isFile()) fail('RECORD_CORRUPT', 'A store entry is not a regular file');
      if (stat.nlink !== 1) fail('RECORD_CORRUPT', 'A store file has additional hard links');
      if (this.#uid !== undefined && stat.uid !== this.#uid) fail('RECORD_CORRUPT', 'A store file is not owned by the current user');
      if ((stat.mode & 0o077) !== 0) fail('RECORD_CORRUPT', 'A store file is accessible to other users');
      if (stat.size > MAX_RECORD_BYTES) fail('RECORD_CORRUPT', 'A store file is larger than allowed');
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < stat.size) {
        const read = this.#fs.readSync(fd, buffer, offset, stat.size - offset, offset);
        if (!Number.isInteger(read) || read <= 0) fail('RECORD_CORRUPT', 'A store file could not be read completely');
        offset += read;
      }
      return buffer.toString('utf8');
    } finally {
      if (fd !== undefined) { try { this.#fs.closeSync(fd); } catch { /* read-only descriptor */ } }
    }
  }

  #readJson(file) {
    const text = this.#readText(file);
    if (text === null) return null;
    try { return JSON.parse(text); } catch { return fail('RECORD_CORRUPT', 'A store file is not valid JSON'); }
  }

  #dirFsync(dir) {
    const fd = this.#fs.openSync(dir, 'r');
    try { this.#fs.fsyncSync(fd); } finally { this.#fs.closeSync(fd); }
  }

  /** Writes `value` to a temp file in `dir`, fsyncs it, and returns its path. Throws WRITE_FAILED (nothing published). */
  #stage(dir, finalName, value) {
    const temp = path.join(dir, `${finalName}.tmp-${this.#pid}-${this.#randomHex(4)}`);
    const payload = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    if (payload.length > MAX_RECORD_BYTES) fail('WRITE_FAILED', 'The record is larger than allowed');
    let fd;
    try {
      fd = this.#fs.openSync(temp, 'wx', 0o600);
      let offset = 0;
      while (offset < payload.length) {
        const written = this.#fs.writeSync(fd, payload, offset, payload.length - offset);
        if (!Number.isInteger(written) || written <= 0 || written > payload.length - offset) fail('WRITE_FAILED', 'A write did not make valid progress');
        offset += written;
      }
      this.#fs.fsyncSync(fd);
      this.#fs.closeSync(fd);
      fd = undefined;
      return temp;
    } catch (error) {
      if (fd !== undefined) { try { this.#fs.closeSync(fd); } catch { /* already failing */ } }
      try { this.#fs.rmSync(temp, { force: true }); } catch { /* a leftover temp file is reported by list() */ }
      throw error instanceof PendingStoreError ? error : new PendingStoreError('WRITE_FAILED', `A write failed before publication: ${error?.code ?? 'error'}`);
    }
  }

  /**
   * Publishes `temp` as `finalPath` ONLY IF it does not exist (link fails with EEXIST), then removes the temp name, flushes the directory and
   * reads the file back. `onExists` is the error to raise for an existing target. After publication every failure is WRITE_AMBIGUOUS.
   */
  #publish(dir, temp, finalPath, expectedValue, onExists) {
    try { this.#fs.linkSync(temp, finalPath); } catch (error) {
      try { this.#fs.rmSync(temp, { force: true }); } catch { /* reported as leftover */ }
      if (error?.code === 'EEXIST') throw onExists();
      throw new PendingStoreError('WRITE_FAILED', `Publication failed: ${error?.code ?? 'error'}`);
    }
    try {
      this.#fs.rmSync(temp, { force: true });
      this.#dirFsync(dir);
      if (JSON.stringify(this.#readJson(finalPath)) !== JSON.stringify(expectedValue)) throw new Error('read-back differs');
    } catch {
      throw new PendingStoreError('WRITE_AMBIGUOUS', 'The write may be on disk but could not be confirmed; treat the outcome as UNKNOWN');
    }
  }

  // ------------------------------------------------------------ reading

  #recordDir(pendingId) {
    if (typeof pendingId !== 'string' || !PENDING_ID_PATTERN.test(pendingId)) fail('INVALID_ID', 'pendingId is malformed');
    return path.join(this.#records, pendingId);
  }

  /** Strictly loads and validates the whole history of one pending action. Throws RECORD_CORRUPT on anything unexpected. */
  #loadChain(pendingId) {
    const dir = this.#recordDir(pendingId);
    try { this.#fs.lstatSync(dir); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    this.#checkDirectory(dir); // before reading: a symlinked pending directory is never followed
    const names = this.#fs.readdirSync(dir).sort();
    const chain = []; const leftoverTemp = [];
    for (const name of names) {
      const match = REVISION_FILE.exec(name);
      if (match) {
        const record = this.#readJson(path.join(dir, name));
        if (record === null) fail('RECORD_CORRUPT', 'A revision file vanished while reading');
        chain.push(record);
        if (Number(match[1]) !== chain.length) fail('RECORD_CORRUPT', 'Revision files are not contiguous from 1');
      } else if (TEMP_FILE.test(name)) leftoverTemp.push(name);
      else fail('RECORD_CORRUPT', 'An unexpected entry is in a pending-action directory');
    }
    if (chain.length === 0) fail('RECORD_CORRUPT', 'A pending-action directory has no published revision');
    for (const record of chain) if (record?.pendingId !== pendingId) fail('RECORD_CORRUPT', 'A revision names a different pending action');
    const problems = validatePendingChain(chain);
    if (problems.length) fail('RECORD_CORRUPT', `Pending action ${pendingId} is invalid: ${problems.join('; ').slice(0, 400)}`);
    return { record: chain.at(-1), revisions: chain.length, leftoverTemp };
  }

  /** Returns the current record, or null if it does not exist. Throws RECORD_CORRUPT for anything invalid; never repairs. */
  get(pendingId) { return this.#loadChain(pendingId)?.record ?? null; }

  /** Read-only history, oldest first (for audit and tests). */
  history(pendingId) {
    const loaded = this.#loadChain(pendingId);
    if (!loaded) return null;
    const dir = this.#recordDir(pendingId);
    return Array.from({ length: loaded.revisions }, (_, i) => this.#readJson(path.join(dir, revisionName(i + 1))));
  }

  /** Corrupt or unexpected entries are REPORTED (never skipped silently, never repaired). */
  list() {
    const pendings = []; const corrupt = []; const leftoverTemp = [];
    for (const name of this.#fs.readdirSync(this.#records).sort()) {
      if (!PENDING_ID_PATTERN.test(name)) { corrupt.push({ id: name, reason: 'unexpected entry in the records directory' }); continue; }
      try {
        const loaded = this.#loadChain(name);
        pendings.push(loaded.record);
        leftoverTemp.push(...loaded.leftoverTemp.map((t) => `${name}/${t}`));
      } catch (error) { corrupt.push({ id: name, reason: error?.message ?? 'unreadable' }); }
    }
    for (const name of this.#fs.readdirSync(this.#tasks).sort()) {
      if (MARKER_TEMP.test(name)) leftoverTemp.push(`tasks/${name}`);
      else if (!MARKER_FILE.test(name)) corrupt.push({ id: `tasks/${name}`, reason: 'unexpected entry in the tasks directory' });
    }
    return { pendings, corrupt, leftoverTemp };
  }

  /** The pending action currently held by a task, or null. A marker that names a missing or corrupt record throws (fail closed). */
  getByTask(taskId) {
    const marker = this.#readMarker(taskId);
    if (marker === null) return null;
    const record = this.get(marker);
    if (record === null) fail('RECORD_CORRUPT', 'The task marker names a pending action that does not exist');
    if (record.taskId !== taskId) fail('RECORD_CORRUPT', 'The task marker names another task\'s pending action');
    return record;
  }

  #markerFile(taskId) {
    if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) fail('INVALID_ID', 'taskId is malformed');
    return path.join(this.#tasks, `${taskId}.open`);
  }

  #readMarker(taskId) {
    const marker = this.#readJson(this.#markerFile(taskId));
    if (marker === null) return null;
    if (!marker || typeof marker !== 'object' || Object.keys(marker).sort().join() !== 'pendingId,schemaVersion,taskId' || marker.schemaVersion !== 1 || marker.taskId !== taskId || !PENDING_ID_PATTERN.test(marker.pendingId ?? '')) {
      fail('RECORD_CORRUPT', 'A task marker is malformed');
    }
    return marker.pendingId;
  }

  // ------------------------------------------------------------ writing

  /**
   * Creates revision 1. The id is chosen by the store. Refuses a task that already holds a pending action. The marker is created
   * exclusively BEFORE the record; if that is all that survives a crash it names a missing record and every later create for the task
   * fails closed (TASK_ALREADY_PENDING) until an operator removes it.
   */
  create(input, { ttlMs } = {}) {
    const pendingId = `PND-${this.#randomHex(16)}`;
    if (!PENDING_ID_PATTERN.test(pendingId)) fail('INVALID_ID', 'The generated pendingId is malformed');
    const record = buildInitialRecord(input, { pendingId, now: this.#now(), ...(ttlMs === undefined ? {} : { ttlMs }) });
    const markerFile = this.#markerFile(record.taskId);
    this.#claimTask(record.taskId, pendingId, markerFile);
    const dir = this.#recordDir(pendingId);
    let madeDir = false; // never delete a directory this call did not create
    try {
      try { this.#fs.mkdirSync(dir, { mode: 0o700 }); madeDir = true; } catch (error) {
        throw error?.code === 'EEXIST' ? new PendingStoreError('DUPLICATE_PENDING', 'This pending identity already exists') : new PendingStoreError('WRITE_FAILED', `The pending directory could not be created: ${error?.code ?? 'error'}`);
      }
      const temp = this.#stage(dir, revisionName(1), record);
      this.#publish(dir, temp, path.join(dir, revisionName(1)), record, () => new PendingStoreError('DUPLICATE_PENDING', 'This pending identity already exists'));
    } catch (error) {
      if (error.code !== 'WRITE_AMBIGUOUS') { // definitely not applied: release the claim so the task is not blocked by a record that never existed
        if (madeDir) { try { this.#fs.rmSync(dir, { recursive: true, force: true }); } catch { /* reported by list() */ } }
        try { if (this.#readMarker(record.taskId) === pendingId) this.#fs.rmSync(markerFile, { force: true }); } catch { /* the marker then fails closed */ }
      }
      throw error;
    }
    return this.#loadChain(pendingId).record;
  }

  #claimTask(taskId, pendingId, markerFile) {
    const marker = { schemaVersion: 1, taskId, pendingId };
    const attempt = () => {
      const temp = this.#stage(this.#tasks, `${taskId}.open`, marker);
      this.#publish(this.#tasks, temp, markerFile, marker, () => new PendingStoreError('TASK_ALREADY_PENDING', 'This task already holds a pending action'));
    };
    try { attempt(); return; } catch (error) {
      if (error.code !== 'TASK_ALREADY_PENDING') throw error;
    }
    // A marker whose pending action ended as REVOKED or SUPERSEDED is released and the claim retried exactly once. Anything else
    // (OPEN, COMPLETED, INTERRUPTED, missing, corrupt) keeps the task held: fail closed.
    const heldBy = this.#readMarker(taskId);
    const held = heldBy === null ? null : this.get(heldBy);
    if (!held || !['REVOKED', 'SUPERSEDED'].includes(held.status)) fail('TASK_ALREADY_PENDING', 'This task already holds a pending action');
    this.#fs.rmSync(markerFile, { force: true });
    attempt();
  }

  /**
   * Moves the CURRENT action one state forward (PENDING -> CLAIMED -> CONSUMED -> DONE). It only RECORDS a state; it consumes no approval,
   * runs no Git command and authorizes nothing. `expectedRevision` is the compare-and-set token.
   */
  advanceStep(pendingId, expectedRevision, step) {
    return this.#commit(pendingId, expectedRevision, (prev, now) => applyStepAdvance(prev, step, now));
  }

  /** OPEN -> REVOKED | SUPERSEDED | INTERRUPTED. Records a decision; it does not execute anything. */
  setStatus(pendingId, expectedRevision, status) {
    const next = this.#commit(pendingId, expectedRevision, (prev, now) => applyStatusChange(prev, status, now));
    if (['REVOKED', 'SUPERSEDED'].includes(next.status)) {
      // Releasing the task is best effort; a marker that survives is handled by #claimTask and only ever blocks (fails closed).
      try { if (this.#readMarker(next.taskId) === next.pendingId) this.#fs.rmSync(this.#markerFile(next.taskId), { force: true }); } catch { /* fail closed */ }
    }
    return next;
  }

  #commit(pendingId, expectedRevision, build) {
    const loaded = this.#loadChain(pendingId);
    if (!loaded) fail('NOT_FOUND', 'No such pending action');
    const prev = loaded.record;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== prev.revision) fail('STALE_REVISION', `The pending action is at revision ${prev.revision}, not ${String(expectedRevision)}`);
    if (prev.revision >= MAX_REVISION) fail('REVISION_LIMIT', 'The pending action reached its revision limit');
    const next = build(prev, this.#now());
    const problems = validatePendingRecord(next);
    if (problems.length) fail('INVALID_TRANSITION', problems.join('; '));
    const dir = this.#recordDir(pendingId);
    const temp = this.#stage(dir, revisionName(next.revision), next);
    this.#publish(dir, temp, path.join(dir, revisionName(next.revision)), next, () => new PendingStoreError('STALE_REVISION', 'Another writer published this revision first'));
    return this.#loadChain(pendingId).record;
  }
}
