// ZC-MVP-B1 Local Bridge core: crash-safe attempt journal and one-time claim.
// Issue #119. MOCK-ONLY, OFFLINE: filesystem only, no network, no subprocess.
//
// Provenance (design reference / re-implementation, nothing copied verbatim):
//   repo   augusliang23-web/cc-h15a-claude-dispatch-lab
//   path   bridge/journal.mjs (writer.lock + checksum + temp/rename + RECONCILE
//          idea). Its security.mjs/claims.mjs/foundation.mjs dependencies are
//          NOT imported; small helpers live in ./state-machine.mjs instead.
//   commit b577bbae9e26c8751db9fe389753c4dda1b5cdac
//
// Layout of a journal directory (must be private: 0700, owned by this user):
//   attempt-<task_id>-<n>.json   one record per attempt   (0600, checksummed)
//   nonce-<32 hex>.used          one-time nonce burn      (0600, O_EXCL)
//   writer.lock                  present only during a write
// Anything else in the directory is treated as corruption and fails closed.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {
  BridgeError, fail, exact, isTimestamp, canonical, digest, isState,
  isTerminal, canTransition, applyEvent,
} from './state-machine.mjs';

export const JOURNAL_VERSION = 'ZC_BRIDGE_CORE_JOURNAL_V1';
export const TASK_ID = /^zc-[a-z0-9]+(?:-[a-z0-9]+){1,7}$/;
const NONCE = /^[a-f0-9]{32}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const ATTEMPT_FILE = /^attempt-(zc-[a-z0-9]+(?:-[a-z0-9]+){1,7})-([1-3])\.json$/;
const NONCE_FILE = /^nonce-[a-f0-9]{32}\.used$/;
const TEMP_FILE = /^\.tmp-[a-f0-9]{32}\.json$/;
const MAX_RECORD_BYTES = 65536;

const taskIdOk = x => typeof x === 'string' && x.length <= 72 && TASK_ID.test(x);

// A private directory: absolute, canonical (no symlinked ancestor at check
// time), a real directory, owned by the current user, mode exactly 0700.
// O_NOFOLLOW support must exist or we refuse to run (HOLD), never degrade.
export function assertPrivateDirectory(dir, io = fs) {
  const uid = process.getuid?.();
  if (uid === undefined) fail('PLATFORM_UNSUPPORTED');
  if (typeof (io.constants ?? fs.constants).O_NOFOLLOW !== 'number')
    fail('NOFOLLOW_UNSUPPORTED');
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) fail('UNSAFE_DIRECTORY');
  let st;
  try {
    st = io.lstatSync(dir);
    if (io.realpathSync(dir) !== dir) fail('UNSAFE_DIRECTORY');
  } catch (e) {
    if (e instanceof BridgeError) throw e;
    return fail('UNSAFE_DIRECTORY');
  }
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid ||
      (st.mode & 0o777) !== 0o700) fail('UNSAFE_DIRECTORY');
}

function writeExclusive(io, file, text, mode = 0o600) {
  const c = io.constants ?? fs.constants;
  const fd = io.openSync(file, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, mode);
  try {
    io.fchmodSync(fd, mode);
    const bytes = Buffer.from(text, 'utf8');
    let off = 0;
    while (off < bytes.length) {
      const n = io.writeSync(fd, bytes, off, bytes.length - off, off);
      if (n <= 0) throw new Error('SHORT_WRITE');
      off += n;
    }
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
}
function syncDirectory(io, dir) {
  const fd = io.openSync(dir, 'r');
  try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
}

const RECORD_KEYS = ['journal_version', 'task_id', 'attempt', 'max_attempts',
  'nonce', 'sequence', 'state', 'history', 'reason', 'updated_at'];

export function validateRecord(r) {
  if (!exact(r, RECORD_KEYS) || r.journal_version !== JOURNAL_VERSION ||
      !taskIdOk(r.task_id) ||
      !Number.isInteger(r.max_attempts) || r.max_attempts < 1 || r.max_attempts > 3 ||
      !Number.isInteger(r.attempt) || r.attempt < 1 || r.attempt > r.max_attempts ||
      typeof r.nonce !== 'string' || !NONCE.test(r.nonce) ||
      !Number.isSafeInteger(r.sequence) || r.sequence < 0 ||
      !isState(r.state) || !Array.isArray(r.history) || r.history.length < 1 ||
      r.history.length > 64 || !isTimestamp(r.updated_at) ||
      !(r.reason === null || (typeof r.reason === 'string' && REASON.test(r.reason))))
    fail('INVALID_JOURNAL_RECORD');
  let prev = null;
  for (const h of r.history) {
    if (!exact(h, ['state', 'at']) || !isState(h.state) || !isTimestamp(h.at))
      fail('INVALID_JOURNAL_RECORD');
    if (prev === null) {
      // A journal record begins at the claim; earlier states are not durable.
      if (h.state !== 'CLAIMED') fail('INVALID_JOURNAL_RECORD');
    } else {
      if (!canTransition(prev.state, h.state) ||
          Date.parse(h.at) < Date.parse(prev.at)) fail('INVALID_JOURNAL_RECORD');
    }
    prev = h;
  }
  if (prev.state !== r.state || r.sequence !== r.history.length - 1 ||
      Date.parse(r.updated_at) < Date.parse(prev.at)) fail('INVALID_JOURNAL_RECORD');
  return r;
}

const clone = r => structuredClone(r);

export class Journal {
  #dir; #io; #clock;
  constructor(dir, {io = fs, clock = () => new Date()} = {}) {
    assertPrivateDirectory(dir, io);
    this.#dir = dir;
    this.#io = io;
    this.#clock = clock;
  }

  #now() {
    const d = this.#clock();
    const t = d instanceof Date ? d : new Date(d);
    if (!Number.isFinite(t.getTime())) fail('INVALID_CLOCK');
    return t.toISOString();
  }
  #p(name) { return path.join(this.#dir, name); }
  #exists(name) {
    try { this.#io.lstatSync(this.#p(name)); return true; }
    catch (e) { if (e?.code === 'ENOENT') return false; return fail('JOURNAL_READ_FAILED'); }
  }

  #readRecord(name, expectTask, expectAttempt) {
    const c = this.#io.constants ?? fs.constants;
    let fd;
    try {
      fd = this.#io.openSync(this.#p(name), c.O_RDONLY | c.O_NOFOLLOW);
      const st = this.#io.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > MAX_RECORD_BYTES ||
          (st.mode & 0o777) !== 0o600 || st.uid !== process.getuid())
        fail('INVALID_JOURNAL_RECORD');
      const env = JSON.parse(this.#io.readFileSync(fd, 'utf8'));
      if (!exact(env, ['record', 'checksum']) || typeof env.checksum !== 'string' ||
          env.checksum !== digest(env.record)) fail('INVALID_JOURNAL_RECORD');
      const r = validateRecord(env.record);
      if (r.task_id !== expectTask || r.attempt !== expectAttempt)
        fail('INVALID_JOURNAL_RECORD');
      return r;
    } catch (e) {
      if (e instanceof BridgeError) throw e;
      return fail('INVALID_JOURNAL_RECORD');
    } finally {
      if (fd !== undefined) { try { this.#io.closeSync(fd); } catch { /* ignore */ } }
    }
  }

  // Strict scan: anything unrecognised fails closed.
  #scan() {
    let names;
    try { names = this.#io.readdirSync(this.#dir); }
    catch { return fail('JOURNAL_READ_FAILED'); }
    const records = [];
    for (const name of names.sort()) {
      const m = ATTEMPT_FILE.exec(name);
      if (m) records.push(this.#readRecord(name, m[1], Number(m[2])));
      else if (name === 'writer.lock' || NONCE_FILE.test(name)) continue;
      else return fail('UNEXPECTED_JOURNAL_ENTRY');
    }
    return records;
  }

  #guardUnlocked() {
    assertPrivateDirectory(this.#dir, this.#io);
    if (this.#exists('writer.lock')) fail('JOURNAL_LOCKED');
  }

  #persist(r) {
    const final = `attempt-${r.task_id}-${r.attempt}.json`;
    const tmp = `.tmp-${randomBytes(16).toString('hex')}.json`;
    writeExclusive(this.#io, this.#p(tmp), canonical({record: r, checksum: digest(r)}));
    this.#io.renameSync(this.#p(tmp), this.#p(final));
    syncDirectory(this.#io, this.#dir);
  }

  // Runs `operation(persist)` under the writer lock. A failure before any
  // persistence releases the lock. Any failure during persistence leaves the
  // lock in place: the outcome is uncertain and a human must reconcile it.
  #withLock(operation) {
    assertPrivateDirectory(this.#dir, this.#io);
    const c = this.#io.constants ?? fs.constants;
    let fd;
    try {
      fd = this.#io.openSync(this.#p('writer.lock'),
        c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 0o600);
    } catch { return fail('JOURNAL_LOCKED'); }
    let persisting = false;
    try {
      this.#io.fsyncSync(fd);
      this.#io.closeSync(fd);
      fd = undefined;
      syncDirectory(this.#io, this.#dir);
      const result = operation(r => {
        persisting = true;
        this.#persist(r);
        persisting = false;
      });
      this.#io.unlinkSync(this.#p('writer.lock'));
      return result;
    } catch (e) {
      if (fd !== undefined) { try { this.#io.closeSync(fd); } catch { /* ignore */ } }
      if (persisting) return fail('JOURNAL_WRITE_UNCERTAIN');
      try { this.#io.unlinkSync(this.#p('writer.lock')); }
      catch { return fail('JOURNAL_WRITE_UNCERTAIN'); }
      if (e instanceof BridgeError) throw e;
      return fail('JOURNAL_OPERATION_FAILED');
    }
  }

  // Durable claim: validates every blocking condition, burns the nonce with an
  // O_EXCL create (atomic one-time use), then persists the CLAIMED record.
  // The nonce stays burned even if the record write later fails (fail closed).
  claim({task_id, attempt, max_attempts, nonce}) {
    if (!taskIdOk(task_id) || !Number.isInteger(max_attempts) || max_attempts < 1 ||
        max_attempts > 3 || !Number.isInteger(attempt) || attempt < 1 ||
        attempt > max_attempts || typeof nonce !== 'string' || !NONCE.test(nonce))
      fail('INVALID_CLAIM');
    return this.#withLock(persist => {
      const all = this.#scan();
      if (all.some(r => r.state === 'RECONCILE_REQUIRED'))
        fail('RECONCILE_REQUIRED_BLOCKS_CLAIM');
      if (all.some(r => !isTerminal(r.state))) fail('BRIDGE_BUSY');
      const mine = all.filter(r => r.task_id === task_id);
      if (mine.some(r => r.state === 'READY_FOR_REVIEW')) fail('TASK_ALREADY_COMPLETED');
      if (mine.some(r => r.attempt === attempt)) fail('TASK_ALREADY_CLAIMED');
      if (mine.some(r => r.max_attempts !== max_attempts)) fail('MAX_ATTEMPTS_CHANGED');
      if (attempt !== mine.length + 1) fail('ATTEMPT_OUT_OF_SEQUENCE');
      const now = this.#now();
      if (all.some(r => Date.parse(r.updated_at) > Date.parse(now))) fail('CLOCK_REGRESSION');
      // Atomic one-time burn.
      try {
        writeExclusive(this.#io, this.#p(`nonce-${nonce}.used`),
          canonical({task_id, attempt, at: now}));
        syncDirectory(this.#io, this.#dir);
      } catch (e) {
        if (e?.code === 'EEXIST') fail('NONCE_REUSED');
        fail('JOURNAL_WRITE_UNCERTAIN');
      }
      const r = validateRecord({
        journal_version: JOURNAL_VERSION, task_id, attempt, max_attempts, nonce,
        sequence: 0, state: 'CLAIMED', history: [{state: 'CLAIMED', at: now}],
        reason: null, updated_at: now,
      });
      persist(r);
      return clone(r);
    });
  }

  // Applies one state-machine event. An illegal/unknown event is not an error:
  // the machine's hold target is persisted (fail closed) and accepted=false.
  transition(task_id, attempt, expectedSequence, event, {reason = null} = {}) {
    if (!taskIdOk(task_id) || !Number.isInteger(attempt) || attempt < 1 || attempt > 3 ||
        !Number.isSafeInteger(expectedSequence) ||
        !(reason === null || (typeof reason === 'string' && REASON.test(reason))))
      fail('INVALID_JOURNAL_UPDATE');
    return this.#withLock(persist => {
      this.#scan();
      const name = `attempt-${task_id}-${attempt}.json`;
      if (!this.#exists(name)) fail('JOURNAL_MISSING');
      const r = this.#readRecord(name, task_id, attempt);
      if (r.sequence !== expectedSequence) fail('STALE_JOURNAL');
      if (isTerminal(r.state)) fail('TERMINAL_JOURNAL');
      const now = this.#now();
      if (Date.parse(now) < Date.parse(r.updated_at)) fail('CLOCK_REGRESSION');
      const next = applyEvent(r.state, event);
      const updated = validateRecord({
        ...r, sequence: r.sequence + 1, state: next.state,
        history: [...r.history, {state: next.state, at: now}],
        reason: next.ok ? reason : (REASON.test(next.reason) ? next.reason : 'INVALID_EVENT'),
        updated_at: now,
      });
      persist(updated);
      return {accepted: next.ok, record: clone(updated)};
    });
  }

  load(task_id, attempt) {
    if (!taskIdOk(task_id) || !Number.isInteger(attempt)) fail('INVALID_LOOKUP');
    this.#guardUnlocked();
    this.#scan();
    const name = `attempt-${task_id}-${attempt}.json`;
    if (!this.#exists(name)) fail('JOURNAL_MISSING');
    return clone(this.#readRecord(name, task_id, attempt));
  }

  list() {
    this.#guardUnlocked();
    return this.#scan().map(clone);
  }

  // Restart recovery. Every non-terminal attempt becomes RECONCILE_REQUIRED
  // (RUNNING passes through INTERRUPTED). It never resumes or re-dispatches.
  recover() {
    return this.#withLock(persist => {
      const out = [];
      for (const r0 of this.#scan()) {
        if (isTerminal(r0.state)) continue;
        let r = r0;
        const steps = r.state === 'RUNNING' ? ['INTERRUPT', 'RECONCILE'] : ['RECONCILE'];
        for (const ev of steps) {
          const now = this.#now();
          if (Date.parse(now) < Date.parse(r.updated_at)) fail('CLOCK_REGRESSION');
          const next = applyEvent(r.state, ev);
          r = validateRecord({
            ...r, sequence: r.sequence + 1, state: next.state,
            history: [...r.history, {state: next.state, at: now}],
            reason: 'RESTART_RECOVERY', updated_at: now,
          });
          persist(r);
        }
        out.push({task_id: r.task_id, attempt: r.attempt, state: r.state});
      }
      return out;
    });
  }

  // Read-only report that never throws and never takes the lock. Use after a
  // crash to see why operations are refused.
  inspect() {
    const report = {locked: false, unexpected: [], records: [], error: null};
    try {
      assertPrivateDirectory(this.#dir, this.#io);
      report.locked = this.#exists('writer.lock');
      for (const name of this.#io.readdirSync(this.#dir).sort()) {
        const m = ATTEMPT_FILE.exec(name);
        if (m) {
          try {
            const r = this.#readRecord(name, m[1], Number(m[2]));
            report.records.push({task_id: r.task_id, attempt: r.attempt, state: r.state});
          } catch (e) {
            report.records.push({file: name, error: e?.code ?? 'INVALID_JOURNAL_RECORD'});
          }
        } else if (name !== 'writer.lock' && !NONCE_FILE.test(name)) {
          report.unexpected.push(TEMP_FILE.test(name) ? 'TEMP_RESIDUE' : 'UNKNOWN_ENTRY');
        }
      }
    } catch (e) {
      report.error = e?.code ?? 'INSPECT_FAILED';
    }
    return report;
  }
}
