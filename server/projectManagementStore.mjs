// V1.2A isolated persistence for app-state.json: optimistic concurrency, an exclusive lock, crash-safe atomic replacement and
// bounded verified backups. Nothing runs on import and nothing here is mounted by server.ts; a caller must construct a store
// for an explicit directory. Every refusal is a ProjectDataError and leaves the existing file untouched.
//
// Write protocol (commit):
//   1. lock      create `<file>.lock` with O_EXCL (0600). Held by someone else => LOCKED (never broken automatically).
//   2. check     re-read the target; its SHA-256 must equal the caller's expectedVersion ('absent' when no file) => else CONFLICT.
//   3. validate  the next state must pass assertUsableState and the size limit.
//   4. backup    rotate `<file>.bak.1..3` and write the current bytes to `.bak.1` (atomic + verified) before touching the target.
//   5. stage     write a unique temp file IN THE SAME DIRECTORY (O_EXCL, 0600), fsync, close, re-read and verify the hash.
//   6. replace   rename the temp file over the target (atomic on one filesystem), fsync the directory where supported.
//   7. verify    re-read the target and compare hashes; release the lock (also on every failure path).
//
// Failure semantics (V1.2 remediation F1): any failure BEFORE step 6's rename leaves the previous file byte-identical and is
// reported as WRITE_FAILED / BACKUP_FAILED. Any failure AFTER the rename (directory sync, read-back, hash mismatch) is
// COMMIT_OUTCOME_UNKNOWN: the new bytes may already be the current state, so nothing may claim "unchanged".
//
// Reads (V1.2 remediation F4): a reader opens the file with O_NOFOLLOW and checks the OPENED inode (fstat), so the checks and
// the bytes always describe the same file. On APFS a reader that races another process's atomic rename can open the replaced
// inode after it was unlinked (fstat nlink 0); that, and only that, is re-opened a bounded number of times. nlink >= 2 (a real
// hard link), symlinks, other owners, group/other-writable files and non-regular files are refused immediately, as before.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import nodeFs from 'node:fs';
import path from 'node:path';

import { applyProjectCommand } from './projectManagementCommands.mjs';
import { LIMITS, ProjectDataError, assertUsableState, parseStateBytes, serializeState } from './projectManagementSchema.mjs';

export const STATE_FILE_NAME = 'app-state.json';
export const ABSENT_VERSION = 'absent';
export const BACKUP_GENERATIONS = 3;

const fail = (code, message, details) => { throw new ProjectDataError(code, message, details); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const notFound = (error) => error && error.code === 'ENOENT';

/** The filesystem calls the store uses. Tests replace individual functions to simulate disk failures. */
export const defaultIo = Object.freeze({
  lstatSync: nodeFs.lstatSync,
  realpathSync: nodeFs.realpathSync,
  readFileSync: nodeFs.readFileSync,
  openSync: nodeFs.openSync,
  writeSync: nodeFs.writeSync,
  fsyncSync: nodeFs.fsyncSync,
  fstatSync: nodeFs.fstatSync,
  closeSync: nodeFs.closeSync,
  renameSync: nodeFs.renameSync,
  unlinkSync: nodeFs.unlinkSync,
});

/**
 * @param {object} options
 * @param {string} options.dataDir absolute path of an existing, owner-only-writable directory that holds app-state.json
 * @param {object} [options.io] filesystem functions (tests only)
 * @param {() => string} [options.now] ISO clock (tests inject a fixed one)
 * @param {() => string} [options.newId] project id generator
 */
/** Bounded re-opens when a reader observes the replaced inode of a concurrent atomic rename (nlink 0). */
export const REPLACED_INODE_RETRIES = 5;
const READ_FLAGS = nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW | nodeFs.constants.O_NONBLOCK;

export function createProjectStore({ dataDir, io = defaultIo, now = () => new Date().toISOString(), newId = () => `proj-${randomUUID()}` } = {}) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const dir = resolveDataDir(dataDir, io, uid);
  const target = path.join(dir, STATE_FILE_NAME);
  const lockPath = `${target}.lock`;
  const backupPath = (n) => `${target}.bak.${n}`;

  /** The checks every state/backup file must pass: a regular file we own, exactly one link, not group/other writable, bounded. */
  function checkStat(st, file) {
    const name = path.basename(file);
    if (st.isSymbolicLink() || !st.isFile()) fail('UNSAFE_TARGET', 'A state or backup path is not a regular file.', { file: name });
    if (st.nlink === 0) fail('UNSAFE_TARGET', 'A state or backup file was replaced or removed while it was being checked.', { file: name });
    if (st.nlink !== 1) fail('UNSAFE_TARGET', 'A state or backup file has extra hard links.', { file: name });
    if (uid !== null && st.uid !== uid) fail('UNSAFE_TARGET', 'A state or backup file is owned by another user.', { file: name });
    if ((st.mode & 0o022) !== 0) fail('UNSAFE_TARGET', 'A state or backup file is writable by group or others.', { file: name });
    if (st.size > LIMITS.maxStateBytes) fail('LIMIT_EXCEEDED', 'A state or backup file is larger than the size limit.', { file: name });
    return st;
  }

  /** Destination check by path (lstat), used by writers under the lock before a rename. Absent is fine. */
  function inspectFile(file) {
    let st;
    try {
      st = io.lstatSync(file);
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
    return checkStat(st, file);
  }

  /**
   * Reads a state/backup file through one O_NOFOLLOW descriptor: the checks run on that descriptor's inode and the bytes come
   * from the same descriptor. Absent -> null. Only an opened inode with nlink 0 (replaced by a concurrent atomic rename) is
   * re-opened, at most REPLACED_INODE_RETRIES times; every other check failure is immediate.
   */
  function readBytes(file) {
    for (let attempt = 0; ; attempt += 1) {
      let fd;
      try {
        fd = io.openSync(file, READ_FLAGS);
      } catch (error) {
        if (notFound(error)) return null;
        if (error?.code === 'ELOOP') fail('UNSAFE_TARGET', 'A state or backup path is a symbolic link.', { file: path.basename(file) });
        throw error;
      }
      try {
        const st = io.fstatSync(fd);
        if (st.nlink === 0 && st.isFile() && attempt < REPLACED_INODE_RETRIES) continue; // replaced while opening: read the current file
        checkStat(st, file);
        return io.readFileSync(fd);
      } finally {
        io.closeSync(fd);
      }
    }
  }

  /** Current raw version of the target (its hash even if its content is corrupt), or ABSENT_VERSION. */
  function rawVersion() {
    const bytes = readBytes(target);
    return bytes === null ? ABSENT_VERSION : sha256(bytes);
  }

  /** Reads and fully validates the current state. Corrupt/invalid content is an error, never replaced with defaults. */
  function read() {
    const bytes = readBytes(target);
    if (bytes === null) return { state: null, version: ABSENT_VERSION };
    const state = parseStateBytes(bytes);
    assertUsableState(state);
    return { state, version: sha256(bytes) };
  }

  function writeAll(fd, buffer) {
    let offset = 0;
    while (offset < buffer.length) {
      const written = io.writeSync(fd, buffer, offset, buffer.length - offset);
      if (!(written > 0)) fail('WRITE_FAILED', 'A write made no progress.');
      offset += written;
    }
  }

  function fsyncDir() {
    let fd;
    try {
      fd = io.openSync(dir, 'r');
      io.fsyncSync(fd);
    } catch (error) {
      // Directory fsync is not supported everywhere; the rename itself is still atomic.
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(error?.code)) throw error;
    } finally {
      if (fd !== undefined) io.closeSync(fd);
    }
  }

  /** Atomically replaces `file` with `bytes` via a unique same-directory temp file; verifies the result by hash. */
  function atomicWrite(file, bytes) {
    const temp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
    const expected = sha256(bytes);
    let fd;
    let staged = false;
    try {
      fd = io.openSync(temp, 'wx', 0o600); // O_CREAT|O_EXCL: never follows or reuses an existing path
      staged = true;
      writeAll(fd, bytes);
      io.fsyncSync(fd);
      io.closeSync(fd);
      fd = undefined;
      if (sha256(io.readFileSync(temp)) !== expected) fail('WRITE_FAILED', 'Staged file does not match what was written.');
      inspectFile(file); // re-check the destination immediately before replacing it
      io.renameSync(temp, file);
      staged = false;
    } catch (error) {
      if (fd !== undefined) {
        try { io.closeSync(fd); } catch { /* already failing */ }
      }
      if (staged) {
        try { io.unlinkSync(temp); } catch { /* our own temp file; a leftover is harmless and never read */ }
      }
      if (error instanceof ProjectDataError) throw error;
      fail('WRITE_FAILED', 'Writing the state file failed; the previous file is unchanged.', { cause: error?.code ?? String(error) });
    }
    // The rename succeeded: from here on the new bytes may already be the current file. Nothing below may say "unchanged".
    const unknown = (reason, cause) => fail('COMMIT_OUTCOME_UNKNOWN', 'The file was replaced but the result could not be confirmed.', { reason, ...(cause ? { cause } : {}) });
    try {
      fsyncDir();
    } catch (error) {
      unknown('directory-sync-failed', error?.code ?? String(error));
    }
    let after;
    try {
      after = readBytes(file);
    } catch (error) {
      unknown('read-back-failed', error?.code ?? String(error));
    }
    if (after === null) unknown('read-back-missing');
    if (sha256(after) !== expected) unknown('read-back-mismatch');
  }

  function rotateBackups(currentBytes) {
    for (let n = 1; n <= BACKUP_GENERATIONS; n += 1) inspectFile(backupPath(n));
    for (let n = BACKUP_GENERATIONS - 1; n >= 1; n -= 1) {
      try {
        io.renameSync(backupPath(n), backupPath(n + 1));
      } catch (error) {
        if (!notFound(error)) fail('BACKUP_FAILED', 'Rotating backups failed; the state file was not changed.', { cause: error?.code });
      }
    }
    try {
      atomicWrite(backupPath(1), currentBytes);
    } catch (error) {
      fail('BACKUP_FAILED', 'Writing the backup failed; the state file was not changed.', { cause: error?.code });
    }
  }

  function withLock(fn) {
    let fd;
    const token = randomBytes(16).toString('hex');
    try {
      fd = io.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') fail('LOCKED', 'Another writer holds the state lock (or a crashed writer left it). Not breaking it automatically.');
      throw error;
    }
    try {
      writeAll(fd, Buffer.from(JSON.stringify({ pid: process.pid, token, createdAt: now() })));
      io.closeSync(fd);
      fd = undefined;
      return fn();
    } finally {
      if (fd !== undefined) {
        try { io.closeSync(fd); } catch { /* ignore */ }
      }
      // We created this lock with O_EXCL. Remove it unless it now carries another writer's token.
      let foreign = false;
      try { foreign = JSON.parse(io.readFileSync(lockPath, 'utf8')).token !== token; } catch { foreign = false; }
      if (!foreign) {
        try { io.unlinkSync(lockPath); } catch { /* already gone */ }
      }
    }
  }

  /**
   * Replaces the state if, and only if, the file still has `expectedVersion`. Returns the new version.
   * `expectedVersion` is required: there is no unconditional (last-write-wins) write.
   */
  function commit({ expectedVersion, nextState }) {
    if (typeof expectedVersion !== 'string' || expectedVersion.length === 0) fail('INVALID_INPUT', 'expectedVersion is required.');
    assertUsableState(nextState);
    const bytes = Buffer.from(serializeState(nextState), 'utf8');
    return withLock(() => {
      const currentBytes = readBytes(target);
      const currentVersion = currentBytes === null ? ABSENT_VERSION : sha256(currentBytes);
      if (currentVersion !== expectedVersion) fail('CONFLICT', 'The saved state changed since it was read; re-read and retry.', { currentVersion });
      if (currentBytes !== null) rotateBackups(currentBytes);
      atomicWrite(target, bytes);
      return { version: sha256(bytes) };
    });
  }

  /** Read -> apply one pure command -> conditional commit. A no-op command writes nothing. */
  function apply({ expectedVersion, command }) {
    const { state, version } = read();
    if (state === null) fail('NO_STATE', 'There is no saved state to change. Create one explicitly with createInitialState().');
    if (version !== expectedVersion) fail('CONFLICT', 'The saved state changed since it was read; re-read and retry.', { currentVersion: version });
    const { state: nextState, result } = applyProjectCommand(state, command, { now: now(), newId });
    if (nextState === state) return { version, result };
    return { ...commit({ expectedVersion, nextState }), result };
  }

  /** Creates a new EMPTY state file only when none exists. Never invoked implicitly and never creates demo data. */
  function createInitialState() {
    return commit({ expectedVersion: ABSENT_VERSION, nextState: { projects: [], attentionItems: [], nba: {}, snapshot: {} } });
  }

  /** Validated metadata of each backup generation (no contents). */
  function listBackups() {
    const out = [];
    for (let n = 1; n <= BACKUP_GENERATIONS; n += 1) {
      const bytes = readBytes(backupPath(n));
      if (bytes === null) continue;
      let valid = true;
      try { assertUsableState(parseStateBytes(bytes)); } catch { valid = false; }
      out.push({ generation: n, version: sha256(bytes), bytes: bytes.length, valid });
    }
    return out;
  }

  /**
   * Restores backup `generation` over the current file if the current file still has `expectedCurrentVersion` (its raw hash,
   * which works for a corrupt file too). The bytes being replaced are first preserved as `<file>.pre-restore-<hash>`.
   */
  function restoreBackup({ generation = 1, expectedCurrentVersion }) {
    if (!Number.isInteger(generation) || generation < 1 || generation > BACKUP_GENERATIONS) fail('INVALID_INPUT', 'Unknown backup generation.');
    if (typeof expectedCurrentVersion !== 'string') fail('INVALID_INPUT', 'expectedCurrentVersion is required.');
    return withLock(() => {
      const backup = readBytes(backupPath(generation));
      if (backup === null) fail('NOT_FOUND', 'That backup generation does not exist.');
      assertUsableState(parseStateBytes(backup));
      const currentBytes = readBytes(target);
      const currentVersion = currentBytes === null ? ABSENT_VERSION : sha256(currentBytes);
      if (currentVersion !== expectedCurrentVersion) fail('CONFLICT', 'The saved state changed since it was inspected.', { currentVersion });
      if (currentBytes !== null) {
        const keep = `${target}.pre-restore-${currentVersion.slice(0, 16)}`;
        const existing = readBytes(keep);
        if (existing === null) atomicWrite(keep, currentBytes);
        else if (sha256(existing) !== currentVersion) fail('UNSAFE_TARGET', 'A different pre-restore file already exists.');
      }
      atomicWrite(target, backup);
      return { version: sha256(backup) };
    });
  }

  return { dataDir: dir, statePath: target, read, rawVersion, commit, apply, createInitialState, listBackups, restoreBackup };
}

/** The data directory must be an absolute, existing, real (not symlinked) directory owned by us and not group/other writable. */
function resolveDataDir(dataDir, io, uid) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) fail('UNSAFE_TARGET', 'dataDir must be an absolute path.');
  let st;
  try {
    st = io.lstatSync(dataDir);
  } catch {
    return fail('UNSAFE_TARGET', 'dataDir does not exist.');
  }
  if (st.isSymbolicLink() || !st.isDirectory()) fail('UNSAFE_TARGET', 'dataDir must be a real directory, not a symlink.');
  if (uid !== null && st.uid !== uid) fail('UNSAFE_TARGET', 'dataDir is owned by another user.');
  if ((st.mode & 0o022) !== 0) fail('UNSAFE_TARGET', 'dataDir is writable by group or others.');
  return io.realpathSync(dataDir); // parent components may legitimately be symlinks (macOS /tmp); all writes use the real path
}
