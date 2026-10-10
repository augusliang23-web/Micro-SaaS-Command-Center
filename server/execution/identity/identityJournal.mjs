import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { RUN_ID_PATTERN } from '../../tasks/types.mjs';
import {
  IDENTITY_SCHEMA_VERSION, STATE_ROOT_ID_PATTERN, TERMINAL_STAGES, CONTAINER_ID_PATTERN,
  assertStageTransition, buildPlannedRecord, validateIdentityRecord,
} from './executionIdentity.mjs';

// Phase 3B7B2B-A0: ExecutionIdentityJournal. A durable, single-writer record of which container belongs to which execution.
// OFFLINE FOUNDATION ONLY: it never talks to Docker, never starts, stops or removes anything, and is not wired to any route.
//
// Layout (all under one server-owned root, mode 0700, owned by the current user):
//   meta.json          { schemaVersion, stateRootId, epoch }   epoch grows by one every time a process opens the journal
//   writer.lock        the single-writer lock (exclusive create); held until close()
//   records/<runId>.json   one identity record per execution; never deleted, never re-created
//
// Honest limits: records are unsigned. A process running as the same user can forge them, so this is protection against crashes,
// races and mistakes, not a trust anchor (the same model as the unsigned local approvals). Corruption is detected, never repaired.

export class JournalError extends Error {
  constructor(code, message) { super(message); this.name = 'JournalError'; this.code = code; }
}
const fail = (code, message) => { throw new JournalError(code, message); };

const MAX_FILE_BYTES = 16 * 1024;
const RECORD_FILE = /^(RUN-\d{8}-[0-9a-f]{8})\.json$/;
const TEMP_FILE = /^RUN-\d{8}-[0-9a-f]{8}\.json\.tmp-\d+-[0-9a-f]{8}$/;
const META_KEYS = ['schemaVersion', 'stateRootId', 'epoch'];
const LOCK_KEYS = ['schemaVersion', 'token', 'pid', 'hostname', 'acquiredAt'];

const hex = (bytes) => randomBytes(bytes).toString('hex');
const sameKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));

function defaultIsProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== 'ESRCH'; }
}

export class ExecutionIdentityJournal {
  #fs; #root; #recordsDir; #now; #pid; #hostname; #isProcessAlive; #uid;
  #token = null; #stateRootId = null; #epoch = 0; #closed = false;

  /** Opening takes the single-writer lock. Throws JOURNAL_LOCKED if another live process (or instance) holds it. */
  constructor({ root, fsImpl = fs, now = () => new Date().toISOString(), pid = process.pid, hostname = os.hostname(), isProcessAlive = defaultIsProcessAlive, uid = process.getuid?.() } = {}) {
    this.#fs = fsImpl; this.#now = now; this.#pid = pid; this.#hostname = hostname; this.#isProcessAlive = isProcessAlive; this.#uid = uid;
    if (typeof root !== 'string' || !path.isAbsolute(root) || /[\0\n\r]/.test(root) || path.normalize(root) !== root || root.endsWith('/') || root === path.parse(root).root) {
      fail('JOURNAL_PATH', 'The journal root must be a normalized absolute directory path');
    }
    this.#root = root;
    this.#recordsDir = path.join(root, 'records');
    this.#prepareDirectory(root);
    this.#prepareDirectory(this.#recordsDir);
    this.#acquireLock();
    try { this.#openMeta(); } catch (error) { this.#releaseLock(); throw error; }
  }

  get stateRootId() { return this.#stateRootId; }
  get epoch() { return this.#epoch; }

  // ---------------------------------------------------------------- filesystem safety

  #prepareDirectory(dir) {
    try { this.#fs.mkdirSync(dir, { mode: 0o700, recursive: dir === this.#root }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const stat = this.#fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('JOURNAL_PATH', 'A journal directory is a symlink or not a directory');
    if (this.#uid !== undefined && stat.uid !== this.#uid) fail('JOURNAL_PERMISSIONS', 'A journal directory is not owned by the current user');
    if ((stat.mode & 0o077) !== 0) fail('JOURNAL_PERMISSIONS', 'A journal directory is accessible to other users (mode must be 0700)');
    if (this.#fs.realpathSync(dir) !== dir) fail('JOURNAL_PATH', 'The journal path is not canonical (a symlink is in the path)');
  }

  /** Reads one regular, single-link, owner-only file without following symlinks. Returns null when absent. */
  #readText(file) {
    let fd;
    try {
      // O_NONBLOCK: opening a FIFO planted at a record path must fail the type check below instead of blocking the process forever.
      try { fd = this.#fs.openSync(file, this.#fs.constants.O_RDONLY | this.#fs.constants.O_NOFOLLOW | this.#fs.constants.O_NONBLOCK); } catch (error) {
        if (error?.code === 'ENOENT') return null;
        if (error?.code === 'ELOOP') fail('JOURNAL_CORRUPT', 'A journal file is a symlink');
        throw error;
      }
      const stat = this.#fs.fstatSync(fd);
      if (!stat.isFile()) fail('JOURNAL_CORRUPT', 'A journal entry is not a regular file');
      if (stat.nlink !== 1) fail('JOURNAL_CORRUPT', 'A journal file has additional hard links');
      if (this.#uid !== undefined && stat.uid !== this.#uid) fail('JOURNAL_CORRUPT', 'A journal file is not owned by the current user');
      if ((stat.mode & 0o077) !== 0) fail('JOURNAL_CORRUPT', 'A journal file is accessible to other users');
      if (stat.size > MAX_FILE_BYTES) fail('JOURNAL_CORRUPT', 'A journal file is larger than allowed');
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < stat.size) {
        const read = this.#fs.readSync(fd, buffer, offset, stat.size - offset, offset);
        if (!Number.isInteger(read) || read <= 0) fail('JOURNAL_CORRUPT', 'A journal file could not be read completely');
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
    try { return JSON.parse(text); } catch { return fail('JOURNAL_CORRUPT', 'A journal file is not valid JSON'); }
  }

  /** Atomic replace: temp file (exclusive, 0600) -> fsync -> rename -> directory fsync. A failed directory fsync is an error. */
  #atomicWrite(file, value) {
    const temp = `${file}.tmp-${this.#pid}-${hex(4)}`;
    const payload = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    if (payload.length > MAX_FILE_BYTES) fail('JOURNAL_IO', 'A journal record is larger than allowed');
    let fd;
    try {
      fd = this.#fs.openSync(temp, 'wx', 0o600);
      let offset = 0;
      while (offset < payload.length) {
        const written = this.#fs.writeSync(fd, payload, offset, payload.length - offset);
        if (!Number.isInteger(written) || written <= 0 || written > payload.length - offset) fail('JOURNAL_IO', 'A journal write did not make valid progress');
        offset += written;
      }
      this.#fs.fsyncSync(fd);
      this.#fs.closeSync(fd);
      fd = undefined;
      this.#fs.renameSync(temp, file);
    } catch (error) {
      if (fd !== undefined) { try { this.#fs.closeSync(fd); } catch { /* already failing */ } }
      try { this.#fs.rmSync(temp, { force: true }); } catch { /* a leftover temp file is reported by scan() */ }
      throw error instanceof JournalError ? error : new JournalError('JOURNAL_IO', `A journal write failed: ${error?.code ?? 'error'}`);
    }
    try {
      const dirFd = this.#fs.openSync(path.dirname(file), 'r');
      try { this.#fs.fsyncSync(dirFd); } finally { this.#fs.closeSync(dirFd); }
    } catch { fail('JOURNAL_IO', 'The journal directory could not be flushed to disk'); }
  }

  // ---------------------------------------------------------------- single-writer lock

  #lockFile() { return path.join(this.#root, 'writer.lock'); }

  #createLock() {
    const token = hex(16);
    const body = { schemaVersion: IDENTITY_SCHEMA_VERSION, token, pid: this.#pid, hostname: this.#hostname, acquiredAt: this.#now() };
    let fd;
    try {
      fd = this.#fs.openSync(this.#lockFile(), 'wx', 0o600);
      this.#fs.writeSync(fd, Buffer.from(`${JSON.stringify(body)}\n`, 'utf8'));
      this.#fs.fsyncSync(fd);
    } catch (error) {
      if (error?.code === 'EEXIST') return null;
      throw new JournalError('JOURNAL_IO', `The writer lock could not be created: ${error?.code ?? 'error'}`);
    } finally {
      if (fd !== undefined) { try { this.#fs.closeSync(fd); } catch { /* best effort */ } }
    }
    return token;
  }

  #readLock() {
    const lock = this.#readJson(this.#lockFile());
    if (lock !== null && !(sameKeys(lock, LOCK_KEYS) && typeof lock.token === 'string' && Number.isSafeInteger(lock.pid) && typeof lock.hostname === 'string')) {
      fail('JOURNAL_LOCKED', 'The writer lock exists but is malformed; operator intervention is required');
    }
    return lock;
  }

  /**
   * Fail closed: an existing lock is taken over ONLY when it names this host and a process that is provably gone. The takeover is
   * serialized by a second exclusive file; if a crash leaves that file behind, the journal stays locked until an operator removes it.
   */
  #acquireLock() {
    const direct = this.#createLock();
    if (direct) { this.#token = direct; return; }
    const existing = this.#readLock();
    if (existing === null) fail('JOURNAL_LOCKED', 'The writer lock changed while opening; retry');
    if (existing.hostname !== this.#hostname || this.#isProcessAlive(existing.pid)) fail('JOURNAL_LOCKED', 'Another Command Center process holds the journal');
    const takeover = path.join(this.#root, 'takeover.lock');
    let fd;
    try { fd = this.#fs.openSync(takeover, 'wx', 0o600); } catch (error) {
      if (error?.code === 'EEXIST') fail('JOURNAL_LOCKED', 'A lock takeover is already in progress or was interrupted; operator intervention is required');
      throw error;
    }
    try {
      this.#fs.closeSync(fd);
      const again = this.#readLock();
      if (again === null || again.token !== existing.token) fail('JOURNAL_LOCKED', 'The writer lock changed during takeover');
      this.#fs.rmSync(this.#lockFile());
      const created = this.#createLock();
      if (!created) fail('JOURNAL_LOCKED', 'Another process took the writer lock during takeover');
      this.#token = created;
    } finally {
      try { this.#fs.rmSync(takeover, { force: true }); } catch { /* reported by the next open as an interrupted takeover */ }
    }
  }

  #assertOwner() {
    if (this.#closed || this.#token === null) fail('JOURNAL_NOT_OWNER', 'The journal is closed');
    const lock = this.#readLock();
    if (lock === null || lock.token !== this.#token) fail('JOURNAL_NOT_OWNER', 'This process no longer holds the journal writer lock');
  }

  #releaseLock() {
    try {
      const lock = this.#readLock();
      if (lock && lock.token === this.#token) this.#fs.rmSync(this.#lockFile());
    } catch { /* leave a stale lock rather than remove someone else's */ }
    this.#token = null;
  }

  close() { if (!this.#closed) { this.#releaseLock(); this.#closed = true; } }

  // ---------------------------------------------------------------- meta (state root identity, process epoch)

  #openMeta() {
    const file = path.join(this.#root, 'meta.json');
    const meta = this.#readJson(file);
    if (meta === null) {
      // A missing meta file next to existing records is tampering or loss, never a fresh journal.
      if (this.#fs.readdirSync(this.#recordsDir).length > 0) fail('JOURNAL_CORRUPT', 'meta.json is missing but records exist');
      this.#stateRootId = hex(16);
      this.#epoch = 1;
    } else {
      if (!sameKeys(meta, META_KEYS) || meta.schemaVersion !== IDENTITY_SCHEMA_VERSION || !STATE_ROOT_ID_PATTERN.test(meta.stateRootId ?? '') || !Number.isSafeInteger(meta.epoch) || meta.epoch < 1) {
        fail('JOURNAL_CORRUPT', 'meta.json is invalid');
      }
      this.#stateRootId = meta.stateRootId;
      this.#epoch = meta.epoch + 1;
    }
    this.#atomicWrite(file, { schemaVersion: IDENTITY_SCHEMA_VERSION, stateRootId: this.#stateRootId, epoch: this.#epoch });
  }

  // ---------------------------------------------------------------- reading

  #recordFile(runId) {
    if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) fail('INVALID_ID', 'runId is malformed');
    return path.join(this.#recordsDir, `${runId}.json`);
  }

  #readRecord(runId) {
    const record = this.#readJson(this.#recordFile(runId));
    if (record === null) return null;
    const problems = validateIdentityRecord(record, { stateRootId: this.#stateRootId });
    if (problems.length > 0) fail('JOURNAL_CORRUPT', `Record ${runId} is invalid: ${problems.join('; ')}`);
    if (record.runId !== runId) fail('JOURNAL_CORRUPT', `Record ${runId} names a different run`);
    return record;
  }

  /** Strict read of one record. Throws JOURNAL_CORRUPT rather than returning something unverified. */
  get(runId) {
    this.#assertOwner();
    return this.#readRecord(runId);
  }

  /**
   * Reads everything. Corrupt or unexpected entries are REPORTED, not skipped silently and never repaired; leftover temp files from
   * an interrupted write are listed separately (they are not records). Records are returned only for readable, valid entries.
   */
  scan() {
    this.#assertOwner();
    const records = []; const corrupt = []; const leftoverTemp = [];
    for (const name of this.#fs.readdirSync(this.#recordsDir).sort()) {
      const match = RECORD_FILE.exec(name);
      if (match) {
        try { records.push(this.#readRecord(match[1])); } catch (error) { corrupt.push({ file: name, reason: error?.message ?? 'unreadable' }); }
      } else if (TEMP_FILE.test(name)) leftoverTemp.push(name);
      else corrupt.push({ file: name, reason: 'unexpected entry in the records directory' });
    }
    return { records, corrupt, leftoverTemp, stateRootId: this.#stateRootId, epoch: this.#epoch };
  }

  #healthyScan() {
    const scan = this.scan();
    if (scan.corrupt.length > 0) fail('JOURNAL_CORRUPT', `The journal has ${scan.corrupt.length} corrupt entr${scan.corrupt.length === 1 ? 'y' : 'ies'}; no execution may be planned or authorized`);
    return scan;
  }

  // ---------------------------------------------------------------- writing

  /**
   * Records the INTENT to create a container, durably, before `docker create`. Refuses a reused runId or sandboxId, and refuses a
   * second execution for a task whose earlier execution is not DESTROYED (an UNKNOWN one blocks it too: fail closed).
   */
  createPlanned(input) {
    this.#assertOwner();
    const { records } = this.#healthyScan();
    if (records.some((r) => r.runId === input?.runId)) fail('DUPLICATE_RUN', 'This run already has an identity record');
    if (records.some((r) => r.sandboxId === input?.sandboxId)) fail('DUPLICATE_SANDBOX', 'This sandbox id is already recorded');
    const sameTask = records.filter((r) => r.taskId === input?.taskId);
    if (sameTask.some((r) => r.stage !== 'DESTROYED')) fail('ACTIVE_EXECUTION_EXISTS', 'This task already has an execution that is not DESTROYED');
    const executionGeneration = sameTask.reduce((max, r) => Math.max(max, r.executionGeneration), 0) + 1;
    const record = buildPlannedRecord(input, { stateRootId: this.#stateRootId, writerEpoch: this.#epoch, executionGeneration, now: this.#now() });
    return this.#commit(record, null);
  }

  /** Compare-and-set stage change. START_AUTHORIZED is reachable only through authorizeStart(). */
  transition(runId, expectedRevision, toStage, { containerId } = {}) {
    this.#assertOwner();
    if (toStage === 'START_AUTHORIZED') fail('ILLEGAL_TRANSITION', 'START_AUTHORIZED is reachable only through authorizeStart()');
    return this.#advance(runId, expectedRevision, toStage, containerId);
  }

  /**
   * The one-time launch permission. The returned, frozen authorization names the exact record revision that is already on disk;
   * it is valid only for this process epoch and only while that exact revision is still the current one.
   */
  authorizeStart(runId, expectedRevision) {
    this.#assertOwner();
    this.#healthyScan();
    const next = this.#advance(runId, expectedRevision, 'START_AUTHORIZED', undefined);
    return Object.freeze({ taskId: next.taskId, runId: next.runId, sandboxId: next.sandboxId, containerId: next.containerId, revision: next.revision, epoch: this.#epoch, stateRootId: this.#stateRootId });
  }

  /** Re-reads the disk. A launch is allowed only if this exact authorization is still the current, durable state. */
  assertStartAuthorized(authorization) {
    this.#assertOwner();
    const denied = (why) => fail('START_NOT_AUTHORIZED', `Launch is not authorized: ${why}`);
    if (!authorization || typeof authorization !== 'object') return denied('no authorization');
    const record = this.#readRecord(authorization.runId);
    if (record === null) return denied('no durable record');
    if (authorization.epoch !== this.#epoch || authorization.stateRootId !== this.#stateRootId) return denied('authorization belongs to another process epoch or journal');
    if (record.stage !== 'START_AUTHORIZED') return denied(`record is ${record.stage}`);
    if (record.revision !== authorization.revision || record.writerEpoch !== this.#epoch) return denied('record changed after authorization');
    if (record.containerId !== authorization.containerId || record.taskId !== authorization.taskId || record.sandboxId !== authorization.sandboxId) return denied('identity mismatch');
    return record;
  }

  #advance(runId, expectedRevision, toStage, containerId) {
    const current = this.#readRecord(runId);
    if (current === null) fail('NOT_FOUND', 'No such execution record');
    if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) fail('STALE_REVISION', 'The record changed since it was read');
    assertStageTransition(current.stage, toStage);
    const next = { ...current, stage: toStage, revision: current.revision + 1, writerEpoch: this.#epoch, updatedAt: this.#now() };
    if (current.stage === 'PLANNED' && toStage === 'CREATED') {
      if (typeof containerId !== 'string' || !CONTAINER_ID_PATTERN.test(containerId)) fail('INVALID_INPUT', 'CREATED requires the exact 64-hex container id');
      if (this.#healthyScan().records.some((r) => r.containerId === containerId)) fail('DUPLICATE_CONTAINER', 'This container id is already recorded');
      next.containerId = containerId;
    } else if (containerId !== undefined) fail('INVALID_INPUT', 'A container id can be recorded only when moving PLANNED -> CREATED');
    return this.#commit(next, current);
  }

  #commit(record, previous) {
    const problems = validateIdentityRecord(record, { stateRootId: this.#stateRootId });
    if (problems.length > 0) fail('INVALID_INPUT', `Refusing to persist an invalid record: ${problems.join('; ')}`);
    if (previous && (record.revision !== previous.revision + 1)) fail('STALE_REVISION', 'Revision must advance by exactly one');
    const file = this.#recordFile(record.runId);
    if (!previous && this.#fs.existsSync(file)) fail('DUPLICATE_RUN', 'This run already has an identity record');
    this.#atomicWrite(file, record);
    const onDisk = this.#readRecord(record.runId);
    if (JSON.stringify(onDisk) !== JSON.stringify(record)) fail('JOURNAL_IO', 'The record read back from disk differs from what was written');
    return onDisk;
  }
}

export const isTerminalStage = (stage) => TERMINAL_STAGES.includes(stage);
