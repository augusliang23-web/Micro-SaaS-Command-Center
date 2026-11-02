// ZC-MVP-B1 (Issue #119): crash-safe journal and one-time claim. Offline only.
// All writes happen inside a private mkdtemp fixture; nothing outside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Journal, assertPrivateDirectory, validateRecord, JOURNAL_VERSION} from '../tools/zc-bridge-core/journal.mjs';
import {BridgeError, digest, canonical} from '../tools/zc-bridge-core/state-machine.mjs';

const nonce = n => n.toString(16).padStart(32, '0');
const TASK = 'zc-journal-fixture';
const TASK2 = 'zc-journal-other';

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zc-bridge-core-')));
  const dir = path.join(root, 'journal');
  fs.mkdirSync(dir, {mode: 0o700});
  fs.chmodSync(dir, 0o700);
  let t = Date.parse('2026-11-02T00:00:00.000Z');
  const clock = () => new Date((t += 1000));
  const journal = new Journal(dir, {clock});
  return {root, dir, clock, journal, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}
const code = c => e => e instanceof BridgeError && e.code === c;
const claim = (j, o = {}) => j.claim({task_id: TASK, attempt: 1, max_attempts: 3, nonce: nonce(1), ...o});
const drive = (j, task, attempt, events) => {
  let seq = j.load(task, attempt).sequence;
  let last;
  for (const e of events) { last = j.transition(task, attempt, seq, e); seq = last.record.sequence; }
  return last;
};
const RUN = ['PREPARE', 'PREPARED'];
const TO_READY = [...RUN, 'EXIT_CLEAN', 'VERIFIED', 'REPORT_OK'];

test('claim persists a CLAIMED record with private permissions', () => {
  const f = fixture();
  try {
    const r = claim(f.journal);
    assert.equal(r.state, 'CLAIMED');
    assert.equal(r.sequence, 0);
    assert.equal(r.journal_version, JOURNAL_VERSION);
    const files = fs.readdirSync(f.dir).sort();
    assert.deepEqual(files, [`attempt-${TASK}-1.json`, `nonce-${nonce(1)}.used`]);
    for (const n of files) assert.equal(fs.statSync(path.join(f.dir, n)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700);
    assert.equal(fs.existsSync(path.join(f.dir, 'writer.lock')), false);
  } finally { f.cleanup(); }
});

test('the record is durable across a fresh Journal instance (restart)', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const again = new Journal(f.dir, {clock: f.clock});
    assert.equal(again.load(TASK, 1).state, 'CLAIMED');
    assert.equal(again.list().length, 1);
  } finally { f.cleanup(); }
});

test('nonce is burned atomically: reuse is refused', () => {
  const f = fixture();
  try {
    claim(f.journal);
    drive(f.journal, TASK, 1, [...RUN, 'TIMEOUT']);
    assert.throws(() => claim(f.journal, {task_id: TASK2}), code('NONCE_REUSED'));
  } finally { f.cleanup(); }
});

test('same task and attempt cannot be claimed twice', () => {
  const f = fixture();
  try {
    claim(f.journal);
    drive(f.journal, TASK, 1, [...RUN, 'TIMEOUT']);
    assert.throws(() => claim(f.journal, {nonce: nonce(2)}), code('TASK_ALREADY_CLAIMED'));
  } finally { f.cleanup(); }
});

test('only one attempt may be non-terminal at a time (any task)', () => {
  const f = fixture();
  try {
    claim(f.journal);
    assert.throws(() => claim(f.journal, {task_id: TASK2, nonce: nonce(2)}), code('BRIDGE_BUSY'));
    drive(f.journal, TASK, 1, RUN);
    assert.throws(() => claim(f.journal, {task_id: TASK2, nonce: nonce(2)}), code('BRIDGE_BUSY'));
  } finally { f.cleanup(); }
});

test('attempts are sequential and capped by max_attempts', () => {
  const f = fixture();
  try {
    claim(f.journal, {max_attempts: 2});
    drive(f.journal, TASK, 1, [...RUN, 'ADAPTER_FAILURE']);
    assert.throws(() => claim(f.journal, {attempt: 2, max_attempts: 2, nonce: nonce(1)}), code('NONCE_REUSED'));
    assert.throws(() => claim(f.journal, {attempt: 2, max_attempts: 3, nonce: nonce(2)}), code('MAX_ATTEMPTS_CHANGED'));
    const second = claim(f.journal, {attempt: 2, max_attempts: 2, nonce: nonce(2)});
    assert.equal(second.attempt, 2);
    drive(f.journal, TASK, 2, [...RUN, 'ADAPTER_FAILURE']);
    assert.throws(() => claim(f.journal, {attempt: 3, max_attempts: 2, nonce: nonce(3)}), code('INVALID_CLAIM'));
  } finally { f.cleanup(); }
});

test('attempt numbers cannot skip ahead', () => {
  const f = fixture();
  try {
    assert.throws(() => claim(f.journal, {attempt: 2}), code('ATTEMPT_OUT_OF_SEQUENCE'));
  } finally { f.cleanup(); }
});

test('a completed task cannot be claimed again', () => {
  const f = fixture();
  try {
    claim(f.journal);
    drive(f.journal, TASK, 1, TO_READY);
    assert.throws(() => claim(f.journal, {attempt: 2, nonce: nonce(2)}), code('TASK_ALREADY_COMPLETED'));
  } finally { f.cleanup(); }
});

test('invalid claim inputs are refused before any write', () => {
  const f = fixture();
  try {
    const bad = [
      {task_id: 'Bad Id'}, {task_id: '../x'}, {task_id: 'x'.repeat(80)}, {task_id: 'zc-a'},
      {attempt: 0}, {attempt: 4}, {attempt: 1.5}, {max_attempts: 0}, {max_attempts: 4},
      {nonce: 'zz'}, {nonce: 'A'.repeat(32)}, {nonce: 5}, {nonce: undefined},
    ];
    for (const b of bad) assert.throws(() => claim(f.journal, b), code('INVALID_CLAIM'));
    assert.deepEqual(fs.readdirSync(f.dir), []);
  } finally { f.cleanup(); }
});

test('transitions persist and follow the state machine to READY_FOR_REVIEW', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const last = drive(f.journal, TASK, 1, TO_READY);
    assert.equal(last.accepted, true);
    assert.equal(last.record.state, 'READY_FOR_REVIEW');
    assert.deepEqual(last.record.history.map(h => h.state),
      ['CLAIMED', 'PREPARING', 'RUNNING', 'VERIFYING', 'REPORTING', 'READY_FOR_REVIEW']);
    assert.equal(last.record.sequence, 5);
  } finally { f.cleanup(); }
});

test('a stale sequence is refused', () => {
  const f = fixture();
  try {
    claim(f.journal);
    f.journal.transition(TASK, 1, 0, 'PREPARE');
    assert.throws(() => f.journal.transition(TASK, 1, 0, 'PREPARED'), code('STALE_JOURNAL'));
  } finally { f.cleanup(); }
});

test('terminal records cannot be changed', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const t = drive(f.journal, TASK, 1, [...RUN, 'TIMEOUT']);
    assert.throws(() => f.journal.transition(TASK, 1, t.record.sequence, 'PREPARE'), code('TERMINAL_JOURNAL'));
  } finally { f.cleanup(); }
});

test('an illegal or unknown event persists the hold target (fail closed)', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const t = f.journal.transition(TASK, 1, 0, 'EXIT_CLEAN');
    assert.equal(t.accepted, false);
    assert.equal(t.record.state, 'RECONCILE_REQUIRED');
    assert.equal(t.record.reason, 'EVENT_NOT_ALLOWED_IN_STATE');
    assert.equal(f.journal.load(TASK, 1).state, 'RECONCILE_REQUIRED');
    const f2 = fixture();
    try {
      claim(f2.journal);
      const u = f2.journal.transition(TASK, 1, 0, 'HACK');
      assert.deepEqual([u.accepted, u.record.state, u.record.reason], [false, 'RECONCILE_REQUIRED', 'UNKNOWN_EVENT']);
    } finally { f2.cleanup(); }
  } finally { f.cleanup(); }
});

test('transition rejects malformed arguments', () => {
  const f = fixture();
  try {
    claim(f.journal);
    for (const args of [['bad id', 1, 0, 'PREPARE'], [TASK, 0, 0, 'PREPARE'], [TASK, 4, 0, 'PREPARE'], [TASK, 1, 'x', 'PREPARE']])
      assert.throws(() => f.journal.transition(...args), code('INVALID_JOURNAL_UPDATE'));
    assert.throws(() => f.journal.transition(TASK, 1, 0, 'PREPARE', {reason: 'lowercase'}), code('INVALID_JOURNAL_UPDATE'));
    assert.throws(() => f.journal.transition(TASK2, 1, 0, 'PREPARE'), code('JOURNAL_MISSING'));
  } finally { f.cleanup(); }
});

test('recover() turns a RUNNING attempt into RECONCILE_REQUIRED via INTERRUPTED (M13)', () => {
  const f = fixture();
  try {
    claim(f.journal);
    drive(f.journal, TASK, 1, RUN);
    const restarted = new Journal(f.dir, {clock: f.clock});
    const out = restarted.recover();
    assert.deepEqual(out, [{task_id: TASK, attempt: 1, state: 'RECONCILE_REQUIRED'}]);
    const rec = restarted.load(TASK, 1);
    assert.deepEqual(rec.history.map(h => h.state).slice(-3), ['RUNNING', 'INTERRUPTED', 'RECONCILE_REQUIRED']);
    assert.equal(rec.reason, 'RESTART_RECOVERY');
  } finally { f.cleanup(); }
});

test('recover() handles CLAIMED and leaves terminal records alone', () => {
  const f = fixture();
  try {
    claim(f.journal);
    drive(f.journal, TASK, 1, [...RUN, 'TIMEOUT']);
    claim(f.journal, {task_id: TASK2, nonce: nonce(2)});
    const out = f.journal.recover();
    assert.deepEqual(out, [{task_id: TASK2, attempt: 1, state: 'RECONCILE_REQUIRED'}]);
    assert.equal(f.journal.load(TASK, 1).state, 'TIMED_OUT');
    assert.deepEqual(f.journal.recover(), []);
  } finally { f.cleanup(); }
});

test('after recovery nothing is re-dispatched: new claims stay blocked', () => {
  const f = fixture();
  try {
    claim(f.journal);
    drive(f.journal, TASK, 1, RUN);
    f.journal.recover();
    assert.throws(() => claim(f.journal, {task_id: TASK2, nonce: nonce(2)}), code('RECONCILE_REQUIRED_BLOCKS_CLAIM'));
    assert.throws(() => claim(f.journal, {attempt: 2, nonce: nonce(3)}), code('RECONCILE_REQUIRED_BLOCKS_CLAIM'));
  } finally { f.cleanup(); }
});

test('a tampered record fails its checksum', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const file = path.join(f.dir, `attempt-${TASK}-1.json`);
    const env = JSON.parse(fs.readFileSync(file, 'utf8'));
    env.record.state = 'READY_FOR_REVIEW';
    fs.writeFileSync(file, canonical(env));
    assert.throws(() => f.journal.load(TASK, 1), code('INVALID_JOURNAL_RECORD'));
    assert.throws(() => claim(f.journal, {task_id: TASK2, nonce: nonce(9)}), code('INVALID_JOURNAL_RECORD'));
  } finally { f.cleanup(); }
});

test('a self-consistent but illegal history is rejected', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const file = path.join(f.dir, `attempt-${TASK}-1.json`);
    const env = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = env.record.updated_at;
    env.record.history = [{state: 'CLAIMED', at}, {state: 'READY_FOR_REVIEW', at}];
    env.record.state = 'READY_FOR_REVIEW';
    env.record.sequence = 1;
    env.checksum = digest(env.record);
    fs.writeFileSync(file, canonical(env));
    assert.throws(() => f.journal.load(TASK, 1), code('INVALID_JOURNAL_RECORD'));
  } finally { f.cleanup(); }
});

test('a record whose content disagrees with its file name is rejected', () => {
  const f = fixture();
  try {
    claim(f.journal);
    fs.renameSync(path.join(f.dir, `attempt-${TASK}-1.json`), path.join(f.dir, `attempt-${TASK2}-1.json`));
    assert.throws(() => f.journal.list(), code('INVALID_JOURNAL_RECORD'));
  } finally { f.cleanup(); }
});

test('record file with loose permissions, a hard link or a symlink is rejected', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const file = path.join(f.dir, `attempt-${TASK}-1.json`);
    fs.chmodSync(file, 0o644);
    assert.throws(() => f.journal.load(TASK, 1), code('INVALID_JOURNAL_RECORD'));
    fs.chmodSync(file, 0o600);
    fs.linkSync(file, path.join(f.root, 'hardlink'));
    assert.throws(() => f.journal.load(TASK, 1), code('INVALID_JOURNAL_RECORD'));
    fs.unlinkSync(path.join(f.root, 'hardlink'));
    const real = path.join(f.root, 'real.json');
    fs.renameSync(file, real);
    fs.symlinkSync(real, file);
    assert.throws(() => f.journal.load(TASK, 1), code('INVALID_JOURNAL_RECORD'));
  } finally { f.cleanup(); }
});

test('unexpected directory entries fail closed', () => {
  const f = fixture();
  try {
    claim(f.journal);
    fs.writeFileSync(path.join(f.dir, 'notes.txt'), 'x', {mode: 0o600});
    assert.throws(() => f.journal.list(), code('UNEXPECTED_JOURNAL_ENTRY'));
    assert.throws(() => claim(f.journal, {task_id: TASK2, nonce: nonce(2)}), code('UNEXPECTED_JOURNAL_ENTRY'));
    assert.deepEqual(f.journal.inspect().unexpected, ['UNKNOWN_ENTRY']);
  } finally { f.cleanup(); }
});

test('a leftover writer.lock blocks every operation until an operator looks', () => {
  const f = fixture();
  try {
    claim(f.journal);
    fs.writeFileSync(path.join(f.dir, 'writer.lock'), '', {mode: 0o600});
    assert.throws(() => f.journal.load(TASK, 1), code('JOURNAL_LOCKED'));
    assert.throws(() => f.journal.list(), code('JOURNAL_LOCKED'));
    assert.throws(() => claim(f.journal, {task_id: TASK2, nonce: nonce(2)}), code('JOURNAL_LOCKED'));
    assert.throws(() => f.journal.transition(TASK, 1, 0, 'PREPARE'), code('JOURNAL_LOCKED'));
    assert.throws(() => f.journal.recover(), code('JOURNAL_LOCKED'));
    const report = f.journal.inspect();
    assert.equal(report.locked, true);
    assert.deepEqual(report.records, [{task_id: TASK, attempt: 1, state: 'CLAIMED'}]);
  } finally { f.cleanup(); }
});

test('a failed write mid-persist leaves the lock and reports uncertainty', () => {
  const f = fixture();
  try {
    claim(f.journal);
    let armed = false;
    const io = {...fs, writeSync: (...a) => { if (armed) throw new Error('disk full'); return fs.writeSync(...a); }};
    const j = new Journal(f.dir, {io, clock: f.clock});
    armed = true;
    assert.throws(() => j.transition(TASK, 1, 0, 'PREPARE'), code('JOURNAL_WRITE_UNCERTAIN'));
    armed = false;
    assert.equal(fs.existsSync(path.join(f.dir, 'writer.lock')), true);
    assert.throws(() => f.journal.load(TASK, 1), code('JOURNAL_LOCKED'));
    const report = f.journal.inspect();
    assert.equal(report.locked, true);
    assert.deepEqual(report.unexpected, ['TEMP_RESIDUE']);
  } finally { f.cleanup(); }
});

test('a failed rename also leaves the lock (no silent success)', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const io = {...fs, renameSync: () => { throw new Error('boom'); }};
    const j = new Journal(f.dir, {io, clock: f.clock});
    assert.throws(() => j.transition(TASK, 1, 0, 'PREPARE'), code('JOURNAL_WRITE_UNCERTAIN'));
    assert.equal(fs.existsSync(path.join(f.dir, 'writer.lock')), true);
  } finally { f.cleanup(); }
});

test('validation errors before persistence release the lock', () => {
  const f = fixture();
  try {
    claim(f.journal);
    assert.throws(() => f.journal.transition(TASK, 1, 5, 'PREPARE'), code('STALE_JOURNAL'));
    assert.equal(fs.existsSync(path.join(f.dir, 'writer.lock')), false);
    assert.equal(f.journal.load(TASK, 1).sequence, 0);
  } finally { f.cleanup(); }
});

test('a failed nonce burn does not produce a claim record', () => {
  const f = fixture();
  try {
    const io = {...fs, writeSync: () => { throw new Error('disk full'); }};
    const j = new Journal(f.dir, {io, clock: f.clock});
    assert.throws(() => claim(j), code('JOURNAL_WRITE_UNCERTAIN'));
    assert.equal(fs.readdirSync(f.dir).some(n => n.startsWith('attempt-')), false);
  } finally { f.cleanup(); }
});

test('clock regression is refused', () => {
  const f = fixture();
  try {
    claim(f.journal);
    const back = new Journal(f.dir, {clock: () => new Date('2020-01-01T00:00:00.000Z')});
    assert.throws(() => back.transition(TASK, 1, 0, 'PREPARE'), code('CLOCK_REGRESSION'));
    const bad = new Journal(f.dir, {clock: () => 'not a date'});
    assert.throws(() => bad.transition(TASK, 1, 0, 'PREPARE'), code('INVALID_CLOCK'));
    drive(f.journal, TASK, 1, [...RUN, 'TIMEOUT']);
    assert.throws(() => claim(back, {task_id: TASK2, nonce: nonce(2)}), code('CLOCK_REGRESSION'));
  } finally { f.cleanup(); }
});

test('the journal directory must be private, canonical and ours', () => {
  const f = fixture();
  try {
    assert.doesNotThrow(() => assertPrivateDirectory(f.dir));
    const loose = path.join(f.root, 'loose');
    fs.mkdirSync(loose, {mode: 0o755});
    fs.chmodSync(loose, 0o755);
    assert.throws(() => new Journal(loose), code('UNSAFE_DIRECTORY'));
    const link = path.join(f.root, 'link');
    fs.symlinkSync(f.dir, link);
    assert.throws(() => new Journal(link), code('UNSAFE_DIRECTORY'));
    const viaParent = `${f.root}/journal/../journal`;
    assert.throws(() => new Journal(viaParent), code('UNSAFE_DIRECTORY'));
    assert.throws(() => new Journal('relative/dir'), code('UNSAFE_DIRECTORY'));
    assert.throws(() => new Journal(path.join(f.root, 'missing')), code('UNSAFE_DIRECTORY'));
    assert.throws(() => new Journal(path.join(f.dir, `attempt-${TASK}-1.json`)), code('UNSAFE_DIRECTORY'));
    assert.throws(() => new Journal(undefined), code('UNSAFE_DIRECTORY'));
  } finally { f.cleanup(); }
});

test('a directory that becomes unsafe after construction is refused', () => {
  const f = fixture();
  try {
    claim(f.journal);
    fs.chmodSync(f.dir, 0o755);
    assert.throws(() => f.journal.load(TASK, 1), code('UNSAFE_DIRECTORY'));
    assert.throws(() => claim(f.journal, {task_id: TASK2, nonce: nonce(2)}), code('UNSAFE_DIRECTORY'));
    assert.equal(f.journal.inspect().error, 'UNSAFE_DIRECTORY');
  } finally { f.cleanup(); }
});

test('a platform without O_NOFOLLOW is a hard HOLD, never a downgrade', () => {
  const f = fixture();
  try {
    const io = {...fs, constants: {...fs.constants, O_NOFOLLOW: undefined}};
    assert.throws(() => new Journal(f.dir, {io}), code('NOFOLLOW_UNSUPPORTED'));
    assert.throws(() => assertPrivateDirectory(f.dir, io), code('NOFOLLOW_UNSUPPORTED'));
  } finally { f.cleanup(); }
});

test('validateRecord rejects malformed shapes', () => {
  const f = fixture();
  try {
    const good = claim(f.journal);
    assert.doesNotThrow(() => validateRecord(structuredClone(good)));
    const mutate = fn => { const r = structuredClone(good); fn(r); return r; };
    const bads = [
      mutate(r => { r.extra = 1; }), mutate(r => { r.nonce = 'x'; }),
      mutate(r => { r.history = []; }), mutate(r => { r.history[0].state = 'RUNNING'; }),
      mutate(r => { r.sequence = 3; }), mutate(r => { r.state = 'NOPE'; }),
      mutate(r => { r.reason = 'lower'; }), mutate(r => { r.attempt = 9; }),
      mutate(r => { r.updated_at = 'yesterday'; }), mutate(r => { r.task_id = 'bad'; }),
      mutate(r => { r.journal_version = 'OLD'; }), null, [], 'x',
    ];
    for (const b of bads) assert.throws(() => validateRecord(b), code('INVALID_JOURNAL_RECORD'));
  } finally { f.cleanup(); }
});

test('returned records are copies, not live references', () => {
  const f = fixture();
  try {
    const r = claim(f.journal);
    r.state = 'READY_FOR_REVIEW';
    assert.equal(f.journal.load(TASK, 1).state, 'CLAIMED');
    const l = f.journal.list();
    l[0].state = 'X';
    assert.equal(f.journal.list()[0].state, 'CLAIMED');
  } finally { f.cleanup(); }
});

test('inspect() never throws and reports corrupt records', () => {
  const f = fixture();
  try {
    claim(f.journal);
    fs.writeFileSync(path.join(f.dir, `attempt-${TASK}-1.json`), '{not json', {mode: 0o600});
    const report = f.journal.inspect();
    assert.equal(report.error, null);
    assert.deepEqual(report.records, [{file: `attempt-${TASK}-1.json`, error: 'INVALID_JOURNAL_RECORD'}]);
  } finally { f.cleanup(); }
});
