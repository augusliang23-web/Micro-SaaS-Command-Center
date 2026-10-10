import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ExecutionIdentityJournal, JournalError } from '../server/execution/identity/identityJournal.mjs';
import { cid, planned, runId, taskId, freshJournal, openJournal, readRecordFile, recordPath, tempRoot } from './helpers/identityFixture.mjs';

// OFFLINE ONLY. Single-writer locking, concurrent writers, corruption (fail closed), interrupted writes and filesystem attacks
// (symlinks, hard links, traversal, permissions). No Docker, network, agent or credential.

const code = (c) => (e) => e instanceof JournalError && e.code === c;
const JOURNAL_URL = new URL('../server/execution/identity/identityJournal.mjs', import.meta.url).href;

const createdRun = (journal, n = 1) => {
  const a = journal.createPlanned(planned(n));
  return journal.transition(runId(n), a.revision, 'CREATED', { containerId: cid(n === 1 ? 'c' : String(n)) });
};

// ------------------------------------------------------------ single writer / concurrent writers

test('a second journal on the same root is refused while the first holds the lock', () => {
  const fx = freshJournal();
  try {
    assert.throws(() => openJournal(fx.root), code('JOURNAL_LOCKED'));
    assert.throws(() => openJournal(fx.root, { pid: 999999, isProcessAlive: () => true }), code('JOURNAL_LOCKED'));
    fx.journal.close();
    const next = openJournal(fx.root);
    assert.equal(next.epoch, 2);
    next.close();
  } finally { fx.cleanup(); }
});

test('the lock of a live process on another host is never taken over', () => {
  const fx = freshJournal({ hostname: 'host-a' });
  try {
    assert.throws(() => openJournal(fx.root, { hostname: 'host-b', isProcessAlive: () => false }), code('JOURNAL_LOCKED'));
  } finally { fx.cleanup(); }
});

test('a crashed holder (dead pid, same host) is taken over exactly once and the epoch advances', () => {
  const dir = tempRoot();
  try {
    const crashed = openJournal(dir.root, { pid: 777, hostname: 'h' });
    createdRun(crashed);
    const survivor = openJournal(dir.root, { pid: 888, hostname: 'h', isProcessAlive: (pid) => pid !== 777 });
    assert.equal(survivor.epoch, crashed.epoch + 1);
    assert.equal(survivor.get(runId(1)).stage, 'CREATED');
    assert.equal(fs.existsSync(`${dir.root}/takeover.lock`), false);
    // the crashed instance (zombie) can no longer write
    assert.throws(() => crashed.createPlanned(planned(2)), code('JOURNAL_NOT_OWNER'));
    assert.throws(() => crashed.transition(runId(1), 2, 'UNKNOWN'), code('JOURNAL_NOT_OWNER'));
    assert.equal(survivor.get(runId(1)).revision, 2);
    // and a third process cannot take over from the live survivor
    assert.throws(() => openJournal(dir.root, { pid: 999, hostname: 'h', isProcessAlive: () => true }), code('JOURNAL_LOCKED'));
    survivor.close();
  } finally { dir.cleanup(); }
});

test('an interrupted takeover or a malformed lock leaves the journal locked until an operator acts', () => {
  const dir = tempRoot();
  try {
    const crashed = openJournal(dir.root, { pid: 777, hostname: 'h' });
    void crashed;
    fs.writeFileSync(`${dir.root}/takeover.lock`, '', { mode: 0o600 });
    assert.throws(() => openJournal(dir.root, { pid: 888, hostname: 'h', isProcessAlive: () => false }), code('JOURNAL_LOCKED'));
    fs.rmSync(`${dir.root}/takeover.lock`);
    for (const bad of ['', 'not json', '{}', JSON.stringify({ schemaVersion: 1, token: 5, pid: 1, hostname: 'h', acquiredAt: 'x' }), JSON.stringify({ schemaVersion: 1, token: 't', pid: 1, hostname: 'h', acquiredAt: 'x', extra: 1 })]) {
      fs.writeFileSync(`${dir.root}/writer.lock`, bad, { mode: 0o600 });
      assert.throws(() => openJournal(dir.root, { pid: 888, hostname: 'h', isProcessAlive: () => false }), (e) => e instanceof JournalError && ['JOURNAL_LOCKED', 'JOURNAL_CORRUPT'].includes(e.code), bad);
    }
  } finally { dir.cleanup(); }
});

test('a writer that lost its lock (lock file replaced) cannot write: stale-writer fencing', () => {
  const fx = freshJournal();
  try {
    createdRun(fx.journal);
    const lock = JSON.parse(fs.readFileSync(`${fx.root}/writer.lock`, 'utf8'));
    fs.writeFileSync(`${fx.root}/writer.lock`, JSON.stringify({ ...lock, token: 'f'.repeat(32) }), { mode: 0o600 });
    assert.throws(() => fx.journal.transition(runId(1), 2, 'UNKNOWN'), code('JOURNAL_NOT_OWNER'));
    assert.throws(() => fx.journal.createPlanned(planned(2)), code('JOURNAL_NOT_OWNER'));
    assert.throws(() => fx.journal.authorizeStart(runId(1), 2), code('JOURNAL_NOT_OWNER'));
    fs.writeFileSync(`${fx.root}/writer.lock`, JSON.stringify(lock), { mode: 0o600 });
    assert.equal(fx.journal.get(runId(1)).revision, 2, 'nothing was written while fenced');
    fs.rmSync(`${fx.root}/writer.lock`);
    assert.throws(() => fx.journal.get(runId(1)), code('JOURNAL_NOT_OWNER'));
    fs.writeFileSync(`${fx.root}/writer.lock`, JSON.stringify(lock), { mode: 0o600 });
  } finally { fx.cleanup(); }
});

test('close() releases only its own lock', () => {
  const fx = freshJournal();
  try {
    const lock = JSON.parse(fs.readFileSync(`${fx.root}/writer.lock`, 'utf8'));
    fs.writeFileSync(`${fx.root}/writer.lock`, JSON.stringify({ ...lock, token: 'e'.repeat(32) }), { mode: 0o600 });
    fx.journal.close();
    assert.equal(fs.existsSync(`${fx.root}/writer.lock`), true, "another holder's lock is left in place");
    fs.rmSync(`${fx.root}/writer.lock`);
  } finally { fx.cleanup(); }
});

test('two real OS processes: exactly one can open the journal; the loser fails closed with JOURNAL_LOCKED', () => {
  const fx = freshJournal();
  try {
    createdRun(fx.journal);
    const script = `import { ExecutionIdentityJournal } from ${JSON.stringify(JOURNAL_URL)};
      try { new ExecutionIdentityJournal({ root: ${JSON.stringify(fx.root)} }); console.log('OPENED'); } catch (e) { console.log('REFUSED:' + e.code); }`;
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 });
    assert.match(run().stdout, /REFUSED:JOURNAL_LOCKED/);
    fx.journal.close();
    const after = run();
    assert.match(after.stdout, /OPENED/, 'a clean exit of the first writer lets the next process in');
    // the child exited without close(): its pid is dead, so the lock is a provable stale lock and is taken over
    const reopened = openJournal(fx.root);
    assert.equal(reopened.epoch, 3);
    assert.equal(reopened.get(runId(1)).stage, 'CREATED');
    reopened.close();
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------ interrupted writes

const faulty = (fail) => {
  const real = { ...fs, constants: fs.constants };
  const calls = { fsync: 0, rename: 0, write: 0 };
  return {
    ...real,
    fsyncSync: (fd) => { calls.fsync += 1; fail.fsync?.(calls.fsync); return fs.fsyncSync(fd); },
    renameSync: (a, b) => { calls.rename += 1; fail.rename?.(calls.rename, a, b); return fs.renameSync(a, b); },
    writeSync: (fd, buf, off, len, pos) => { calls.write += 1; return fail.write ? fail.write(calls.write, fd, buf, off, len, pos) : fs.writeSync(fd, buf, off, len, pos); },
    openSync: (p, f, m) => { if (fail.openDir && typeof f === 'string' && f === 'r') fail.openDir(); return fs.openSync(p, f, m); },
    calls,
  };
};

test('interrupted write: fsync failure leaves the previous record intact and no temp file', () => {
  const dir = tempRoot();
  try {
    let armed = false;
    const journal = openJournal(dir.root, { fsImpl: faulty({ fsync: () => { if (armed) throw Object.assign(new Error('EIO'), { code: 'EIO' }); } }) });
    const a = journal.createPlanned(planned(1));
    armed = true;
    assert.throws(() => journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') }), code('JOURNAL_IO'));
    armed = false;
    assert.equal(journal.get(runId(1)).stage, 'PLANNED');
    assert.equal(journal.get(runId(1)).revision, 1);
    assert.deepEqual(fs.readdirSync(`${dir.root}/records`), [`${runId(1)}.json`]);
    journal.close();
  } finally { dir.cleanup(); }
});

test('interrupted write: rename failure leaves the previous record intact and no temp file', () => {
  const dir = tempRoot();
  try {
    let armed = false;
    const journal = openJournal(dir.root, { fsImpl: faulty({ rename: () => { if (armed) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); } }) });
    const a = journal.createPlanned(planned(1));
    armed = true;
    assert.throws(() => journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') }), code('JOURNAL_IO'));
    armed = false;
    assert.equal(journal.get(runId(1)).stage, 'PLANNED');
    assert.deepEqual(fs.readdirSync(`${dir.root}/records`), [`${runId(1)}.json`]);
    journal.close();
  } finally { dir.cleanup(); }
});

test('interrupted write: a short or zero-progress write is an error, never a silently truncated record', () => {
  const dir = tempRoot();
  try {
    let mode = 'ok';
    const journal = openJournal(dir.root, { fsImpl: faulty({ write: (n, fd, buf, off, len, pos) => (mode === 'zero' ? 0 : mode === 'over' ? len + 5 : fs.writeSync(fd, buf, off, len, pos)) }) });
    const a = journal.createPlanned(planned(1));
    for (const m of ['zero', 'over']) {
      mode = m;
      assert.throws(() => journal.transition(runId(1), a.revision, 'CREATED', { containerId: cid('c') }), code('JOURNAL_IO'), m);
    }
    mode = 'ok';
    assert.equal(journal.get(runId(1)).stage, 'PLANNED');
    assert.deepEqual(fs.readdirSync(`${dir.root}/records`), [`${runId(1)}.json`]);
    journal.close();
  } finally { dir.cleanup(); }
});

test('a failed directory flush is an error and authorizeStart returns NO authorization; a retry cannot launch twice', () => {
  const dir = tempRoot();
  try {
    let armed = false;
    const fsImpl = faulty({ openDir: () => { if (armed) throw Object.assign(new Error('EIO'), { code: 'EIO' }); } });
    const journal = openJournal(dir.root, { fsImpl });
    const c = createdRun(journal);
    armed = true;
    let auth = null;
    assert.throws(() => { auth = journal.authorizeStart(runId(1), c.revision); }, code('JOURNAL_IO'));
    assert.equal(auth, null, 'no launch permission was handed out');
    armed = false;
    // the record may already say START_AUTHORIZED; the permission was never returned, so the run can never launch: recovery sees an interrupted start
    assert.equal(journal.get(runId(1)).stage, 'START_AUTHORIZED');
    assert.throws(() => journal.authorizeStart(runId(1), c.revision), (e) => e instanceof JournalError);
    assert.throws(() => journal.authorizeStart(runId(1), c.revision + 1), (e) => e?.code === 'ILLEGAL_TRANSITION');
    journal.close();
  } finally { dir.cleanup(); }
});

test('crash between temp write and rename: the leftover temp file is reported, never read as a record, and the record is intact', () => {
  const dir = tempRoot();
  try {
    const first = openJournal(dir.root, { pid: 111, hostname: 'h' });
    createdRun(first);
    fs.writeFileSync(`${dir.root}/records/${runId(1)}.json.tmp-111-deadbeef`, '{"truncated":', { mode: 0o600 });
    const second = openJournal(dir.root, { pid: 222, hostname: 'h', isProcessAlive: () => false });
    const scan = second.scan();
    assert.deepEqual(scan.leftoverTemp, [`${runId(1)}.json.tmp-111-deadbeef`]);
    assert.deepEqual(scan.corrupt, []);
    assert.equal(scan.records.length, 1);
    assert.equal(scan.records[0].stage, 'CREATED');
    assert.equal(fs.existsSync(`${dir.root}/records/${runId(1)}.json.tmp-111-deadbeef`), true, 'never silently deleted');
    second.close();
  } finally { dir.cleanup(); }
});

test('a torn (non-atomic) record, as a crashed foreign writer could leave, is corruption and fails closed', () => {
  const dir = tempRoot();
  try {
    const first = openJournal(dir.root, { pid: 111, hostname: 'h' });
    createdRun(first);
    const text = fs.readFileSync(recordPath(dir.root, runId(1)), 'utf8');
    fs.writeFileSync(recordPath(dir.root, runId(1)), text.slice(0, Math.floor(text.length / 2)), { mode: 0o600 });
    const second = openJournal(dir.root, { pid: 222, hostname: 'h', isProcessAlive: () => false });
    assert.equal(second.scan().corrupt.length, 1);
    assert.throws(() => second.get(runId(1)), code('JOURNAL_CORRUPT'));
    second.close();
  } finally { dir.cleanup(); }
});

// ------------------------------------------------------------ corruption fails closed

const corruptWith = (mutate) => {
  const fx = freshJournal();
  createdRun(fx.journal);
  createdRun(fx.journal, 2);
  mutate(fx);
  return fx;
};
const CORRUPTIONS = {
  'invalid JSON': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), '{nope', { mode: 0o600 }),
  'empty file': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), '', { mode: 0o600 }),
  'JSON array': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), '[]', { mode: 0o600 }),
  'extra key': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), JSON.stringify({ ...readRecordFile(root, runId(1)), extra: 'x' }), { mode: 0o600 }),
  'missing key': ({ root }) => { const r = readRecordFile(root, runId(1)); delete r.labels; fs.writeFileSync(recordPath(root, runId(1)), JSON.stringify(r), { mode: 0o600 }); },
  'wrong stateRootId (copied from another journal)': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), JSON.stringify({ ...readRecordFile(root, runId(1)), stateRootId: '0'.repeat(32) }), { mode: 0o600 }),
  'record names a different run': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), JSON.stringify({ ...readRecordFile(root, runId(2)) }), { mode: 0o600 }),
  'container id tampered to a non-hex value': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), JSON.stringify({ ...readRecordFile(root, runId(1)), containerId: '../../etc' }), { mode: 0o600 }),
  'labels altered': ({ root }) => { const r = readRecordFile(root, runId(1)); r.labels['cc.sandbox'] = '0'; fs.writeFileSync(recordPath(root, runId(1)), JSON.stringify(r), { mode: 0o600 }); },
  'oversized file (valid JSON padded past the limit)': ({ root }) => fs.writeFileSync(recordPath(root, runId(1)), `${fs.readFileSync(recordPath(root, runId(1)), 'utf8')}${' '.repeat(40_000)}`, { mode: 0o600 }),
  'group/world readable': ({ root }) => fs.chmodSync(recordPath(root, runId(1)), 0o644),
  'unexpected file in records/': ({ root }) => fs.writeFileSync(`${root}/records/notes.txt`, 'x', { mode: 0o600 }),
  'directory named like a record': ({ root }) => { fs.rmSync(recordPath(root, runId(1))); fs.mkdirSync(recordPath(root, runId(1))); },
};
for (const [name, mutate] of Object.entries(CORRUPTIONS)) {
  test(`corruption fails closed: ${name}`, () => {
    const fx = corruptWith(mutate);
    try {
      const scan = fx.journal.scan();
      assert.ok(scan.corrupt.length >= 1, 'reported');
      if (!name.startsWith('unexpected file')) assert.equal(scan.records.some((r) => r.runId === runId(1)), false, 'a corrupt record is never returned as valid');
      assert.equal(scan.records.some((r) => r.runId === runId(2)), true, 'unrelated valid records are still readable for classification');
      assert.throws(() => fx.journal.createPlanned(planned(3)), code('JOURNAL_CORRUPT'));
      assert.throws(() => fx.journal.authorizeStart(runId(2), 2), code('JOURNAL_CORRUPT'));
    } finally { fx.cleanup(); }
  });
}

test('corruption of the corrupt record is not repaired or deleted by the journal', () => {
  const fx = corruptWith(CORRUPTIONS['invalid JSON']);
  try {
    fx.journal.scan();
    assert.equal(fs.readFileSync(recordPath(fx.root, runId(1)), 'utf8'), '{nope');
  } finally { fx.cleanup(); }
});

test('meta.json: missing with records present, malformed, or tampered => the journal refuses to open', () => {
  const dir = tempRoot();
  try {
    const j = openJournal(dir.root);
    createdRun(j);
    j.close();
    const meta = fs.readFileSync(`${dir.root}/meta.json`, 'utf8');
    fs.rmSync(`${dir.root}/meta.json`);
    assert.throws(() => openJournal(dir.root), code('JOURNAL_CORRUPT'));
    for (const bad of ['{', '{}', JSON.stringify({ schemaVersion: 2, stateRootId: 'a'.repeat(32), epoch: 1 }), JSON.stringify({ schemaVersion: 1, stateRootId: 'zz', epoch: 1 }), JSON.stringify({ schemaVersion: 1, stateRootId: 'a'.repeat(32), epoch: 0 }), JSON.stringify({ schemaVersion: 1, stateRootId: 'a'.repeat(32), epoch: 1.5 }), JSON.stringify({ schemaVersion: 1, stateRootId: 'a'.repeat(32), epoch: 1, x: 1 })]) {
      fs.writeFileSync(`${dir.root}/meta.json`, bad, { mode: 0o600 });
      assert.throws(() => openJournal(dir.root), code('JOURNAL_CORRUPT'), bad);
      assert.equal(fs.existsSync(`${dir.root}/writer.lock`), false, 'a failed open releases its lock');
    }
    fs.writeFileSync(`${dir.root}/meta.json`, meta, { mode: 0o600 });
    openJournal(dir.root).close();
  } finally { dir.cleanup(); }
});

test('a records directory that exists but whose meta.json was replaced by another journal is detected through stateRootId', () => {
  const a = freshJournal(); const b = freshJournal();
  try {
    createdRun(a.journal);
    a.journal.close();
    fs.copyFileSync(`${b.root}/meta.json`, `${a.root}/meta.json`);
    const reopened = openJournal(a.root);
    assert.equal(reopened.scan().corrupt.length, 1);
    assert.throws(() => reopened.createPlanned(planned(5)), code('JOURNAL_CORRUPT'));
    reopened.close();
  } finally { a.cleanup(); b.cleanup(); }
});

// ------------------------------------------------------------ symlink, hard link, traversal, permission attacks

test('the journal root may not be a symlink, sit behind a symlink, be relative, or be non-canonical', () => {
  const dir = tempRoot();
  try {
    fs.mkdirSync(`${dir.base}/real`, { mode: 0o700 });
    fs.symlinkSync(`${dir.base}/real`, `${dir.base}/link`);
    assert.throws(() => openJournal(`${dir.base}/link`), code('JOURNAL_PATH'));
    assert.throws(() => openJournal(`${dir.base}/link/sub`), (e) => e instanceof JournalError || e?.code === 'EEXIST' || e?.code === 'ENOENT');
    for (const bad of ['relative/journal', './journal', '', '/', `${dir.base}/a/../journal`, `${dir.base}//journal`, `${dir.base}/journal/`, `${dir.base}/x\0y`, null, undefined, 5]) {
      assert.throws(() => openJournal(bad), code('JOURNAL_PATH'), String(bad));
    }
    assert.equal(fs.existsSync(`${dir.base}/a`), false, 'a non-normalized root is refused BEFORE any directory is created');
    assert.equal(fs.existsSync(`${dir.base}/journal`), false);
  } finally { dir.cleanup(); }
});

test('the records directory may not be a symlink; nothing is written through it', () => {
  const dir = tempRoot();
  try {
    const outside = `${dir.base}/outside`;
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.mkdirSync(dir.root, { mode: 0o700 });
    fs.symlinkSync(outside, `${dir.root}/records`);
    assert.throws(() => openJournal(dir.root), code('JOURNAL_PATH'));
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { dir.cleanup(); }
});

test('a record that is a symlink to an outside file is corruption; the target is never read, followed or modified', () => {
  const fx = freshJournal();
  try {
    createdRun(fx.journal);
    createdRun(fx.journal, 2);
    const outside = `${fx.base}/outside.json`;
    fs.writeFileSync(outside, fs.readFileSync(recordPath(fx.root, runId(1))), { mode: 0o600 });
    fs.rmSync(recordPath(fx.root, runId(1)));
    fs.symlinkSync(outside, recordPath(fx.root, runId(1)));
    const before = fs.readFileSync(outside, 'utf8');
    assert.equal(fx.journal.scan().corrupt.length, 1);
    assert.throws(() => fx.journal.get(runId(1)), code('JOURNAL_CORRUPT'));
    assert.throws(() => fx.journal.createPlanned(planned(9)), code('JOURNAL_CORRUPT'));
    assert.equal(fs.readFileSync(outside, 'utf8'), before);
    assert.equal(fs.lstatSync(recordPath(fx.root, runId(1))).isSymbolicLink(), true, 'the link itself is left for the operator');
  } finally { fx.cleanup(); }
});

test('a pre-planted symlink at the temp or lock path cannot redirect a write', () => {
  const fx = freshJournal();
  try {
    const victim = `${fx.base}/victim`;
    fs.writeFileSync(victim, 'untouched', { mode: 0o600 });
    // the lock path is taken by a symlink: the journal refuses it rather than writing through it
    fx.journal.close();
    fs.symlinkSync(victim, `${fx.root}/writer.lock`);
    assert.throws(() => openJournal(fx.root), (e) => e instanceof JournalError);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
    fs.rmSync(`${fx.root}/writer.lock`);
    // a symlinked meta.json is corruption
    fs.rmSync(`${fx.root}/meta.json`);
    fs.symlinkSync(victim, `${fx.root}/meta.json`);
    assert.throws(() => openJournal(fx.root), code('JOURNAL_CORRUPT'));
    assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
  } finally { fx.cleanup(); }
});

test('a FIFO planted at a record path is corruption and never blocks the process', () => {
  const fx = freshJournal();
  try {
    createdRun(fx.journal, 2);
    const made = spawnSync('/usr/bin/mkfifo', ['-m', '600', recordPath(fx.root, runId(1))]);
    assert.equal(made.status, 0, 'mkfifo must be available to run this test');
    assert.equal(fs.statSync(recordPath(fx.root, runId(1))).isFIFO(), true);
    const scan = fx.journal.scan();
    assert.equal(scan.corrupt.length, 1);
    assert.throws(() => fx.journal.get(runId(1)), code('JOURNAL_CORRUPT'));
  } finally { fx.cleanup(); }
});

test('a record owned by another user is corruption (uid check on the opened file)', () => {
  const dir = tempRoot();
  try {
    let skew = false;
    const recordFds = new Set();
    const fsImpl = {
      ...fs, constants: fs.constants,
      openSync: (p, f, m) => { const fd = fs.openSync(p, f, m); if (String(p).includes('/records/RUN-') && !String(p).includes('.tmp-')) recordFds.add(fd); else recordFds.delete(fd); return fd; },
      fstatSync: (fd) => { const st = fs.fstatSync(fd); return skew && recordFds.has(fd) ? Object.create(st, { uid: { value: st.uid + 1 } }) : st; },
    };
    const journal = openJournal(dir.root, { fsImpl });
    createdRun(journal);
    skew = true;
    assert.equal(journal.scan().corrupt.length, 1);
    skew = false;
    assert.equal(journal.scan().corrupt.length, 0);
    journal.close();
  } finally { dir.cleanup(); }
});

test('takeover race: if the lock is replaced by a live holder while a takeover is in progress, the takeover is abandoned', () => {
  const dir = tempRoot();
  try {
    const crashed = openJournal(dir.root, { pid: 777, hostname: 'h' });
    void crashed;
    const lockPath = `${dir.root}/writer.lock`;
    const stale = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const racing = { ...fs, constants: fs.constants, openSync: (p, f, m) => {
      const fd = fs.openSync(p, f, m);
      if (String(p).endsWith('takeover.lock')) fs.writeFileSync(lockPath, JSON.stringify({ ...stale, token: 'a'.repeat(32), pid: 31337 }), { mode: 0o600 });
      return fd;
    } };
    assert.throws(() => openJournal(dir.root, { pid: 888, hostname: 'h', fsImpl: racing, isProcessAlive: (pid) => pid === 31337 }), code('JOURNAL_LOCKED'));
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, 31337, "the other process's new lock was not removed");
    assert.equal(fs.existsSync(`${dir.root}/takeover.lock`), false);
  } finally { dir.cleanup(); }
});

test('a hard-linked record (a second name for the same inode) is corruption', () => {
  const fx = freshJournal();
  try {
    createdRun(fx.journal);
    fs.linkSync(recordPath(fx.root, runId(1)), `${fx.base}/alias.json`);
    assert.equal(fx.journal.scan().corrupt.length, 1);
    assert.throws(() => fx.journal.get(runId(1)), code('JOURNAL_CORRUPT'));
  } finally { fx.cleanup(); }
});

test('directory permissions: a group/world-accessible journal directory is refused, never silently chmod-ed', () => {
  const dir = tempRoot();
  try {
    fs.mkdirSync(dir.root, { mode: 0o755 }); fs.chmodSync(dir.root, 0o755);
    assert.throws(() => openJournal(dir.root), code('JOURNAL_PERMISSIONS'));
    assert.equal(fs.statSync(dir.root).mode & 0o777, 0o755);
    fs.chmodSync(dir.root, 0o700);
    openJournal(dir.root).close();
    fs.chmodSync(`${dir.root}/records`, 0o750);
    assert.throws(() => openJournal(dir.root), code('JOURNAL_PERMISSIONS'));
    assert.equal(fs.existsSync(`${dir.root}/writer.lock`) && JSON.parse(fs.readFileSync(`${dir.root}/writer.lock`, 'utf8')).pid === process.pid, false, 'a refused open takes no lock');
  } finally { dir.cleanup(); }
});

test('a foreign owner is refused (uid check)', () => {
  const dir = tempRoot();
  try {
    const wrongUid = (process.getuid?.() ?? 0) + 12345;
    assert.throws(() => openJournal(dir.root, { uid: wrongUid }), code('JOURNAL_PERMISSIONS'));
  } finally { dir.cleanup(); }
});

test('traversal attempts through identifiers never create a path outside records/', () => {
  const fx = freshJournal();
  try {
    for (const bad of [{ taskId: '../../x' }, { runId: '../../RUN-20260101-00000001' }, { sandboxId: '../escape' }, { sandboxId: 'a/../../b-c-d-e-f' }, { runId: 'RUN-20260101-00000001/../../../tmp/x' }]) {
      assert.throws(() => fx.journal.createPlanned({ ...planned(1), ...bad }), (e) => e?.code === 'INVALID_INPUT' || e?.code === 'INVALID_ID', JSON.stringify(bad));
    }
    assert.deepEqual(fs.readdirSync(`${fx.root}/records`), []);
    assert.deepEqual(fs.readdirSync(fx.base).sort(), ['journal']);
  } finally { fx.cleanup(); }
});

test('the journal does not use or require Docker, a socket, a network or a credential file', () => {
  const sources = ['executionIdentity.mjs', 'identityJournal.mjs', 'recoveryClassifier.mjs'].map((f) => fs.readFileSync(fileURLToPath(new URL(`../server/execution/identity/${f}`, import.meta.url)), 'utf8'));
  const code = sources.join('\n').replace(/\/\/.*$/gm, '');
  for (const re of [/child_process/, /dockerClient/, /docker\.sock/, /\bfetch\(/, /node:(net|http|https|dgram|dns)/, /process\.env/, /Keychain|keychain/, /\.ssh|\.aws|\.npmrc/]) assert.doesNotMatch(code, re, String(re));
  assert.equal(os.homedir() !== '' && !code.includes(os.homedir()), true);
  assert.ok(ExecutionIdentityJournal);
  void path; void taskId;
});

test('R2 valid but conflicting identities corrupt scan after restart and block all authorization',()=>{
  const cases=[
    ['sandbox',(a,b)=>({...b,sandboxId:a.sandboxId,containerName:a.containerName,labels:{...a.labels}})],
    ['container',(a,b)=>({...b,containerId:a.containerId})],
    ['name',(a,b)=>({...b,sandboxId:a.sandboxId.toLowerCase(),containerName:a.containerName,labels:{...b.labels,'cc.sandbox.id':a.sandboxId.toLowerCase()}})],
    ['generation',(a,b)=>({...b,taskId:a.taskId,executionGeneration:1})],
    ['active',(a,b)=>({...b,taskId:a.taskId,executionGeneration:2})],
    ['gap',(a,b)=>({...b,taskId:a.taskId,executionGeneration:3})],
  ];
  for(const [label,change] of cases){const dir=tempRoot();let j;try{
    j=openJournal(dir.root);let a=j.createPlanned({...planned(1),sandboxId:'ABCDEF-123456'});a=j.transition(a.runId,a.revision,'CREATED',{containerId:cid('c')});let b=createdRun(j,2);j.close();
    if(label==='gap'){a={...a,stage:'DESTROYED'};fs.writeFileSync(recordPath(dir.root,a.runId),JSON.stringify(a),{mode:0o600});}
    b=change(a,b);fs.writeFileSync(recordPath(dir.root,b.runId),JSON.stringify(b),{mode:0o600});const before=fs.readFileSync(recordPath(dir.root,b.runId),'utf8');
    j=openJournal(dir.root);assert.ok(j.scan().corrupt.length>0,label);assert.throws(()=>j.createPlanned(planned(3)),code('JOURNAL_CORRUPT'));assert.throws(()=>j.authorizeStart(a.runId,a.revision),code('JOURNAL_CORRUPT'));assert.equal(fs.readFileSync(recordPath(dir.root,b.runId),'utf8'),before);
  }finally{j?.close();dir.cleanup();}}
});

test('R4 every malformed lock field blocks takeover and writer ownership checks',()=>{
  const mutations=[l=>({...l,schemaVersion:2}),l=>({...l,token:''}),l=>({...l,token:'x'.repeat(32)}),l=>({...l,token:'a'.repeat(32)+'\n'}),l=>({...l,hostname:'h\n'}),l=>({...l,pid:-1}),l=>({...l,pid:0}),l=>({...l,pid:'777'}),l=>({...l,pid:1.5}),l=>({...l,pid:Number.MAX_SAFE_INTEGER+1}),l=>({...l,token:'A'.repeat(32)}),l=>({...l,hostname:'bad host'}),l=>({...l,hostname:'a..b'}),l=>({...l,hostname:'/tmp/h'}),l=>({...l,acquiredAt:'2026-01-01T00:00:00Z'}),l=>({...l,hostname:''}),l=>({...l,acquiredAt:'bad'}),l=>({...l,acquiredAt:'2026-02-30T00:00:00.000Z'}),l=>{const x={...l};delete x.token;return x;},l=>({...l,extra:true})];
  for(const mutate of mutations){const fx=freshJournal({pid:777,hostname:'h'});try{const file=path.join(fx.root,'writer.lock');const lock=JSON.parse(fs.readFileSync(file,'utf8'));const body=JSON.stringify(mutate(lock));fs.writeFileSync(file,body,{mode:0o600});let aliveChecks=0;assert.throws(()=>openJournal(fx.root,{pid:888,hostname:'h',isProcessAlive:()=>{aliveChecks++;return false;}}),code('JOURNAL_LOCKED'));assert.equal(aliveChecks,0);assert.throws(()=>fx.journal.scan(),code('JOURNAL_LOCKED'));assert.equal(fs.readFileSync(file,'utf8'),body);}finally{fx.cleanup();}}
});

test('R5 exclusive temporary collision refuses without overwriting or deleting the planted file',()=>{
  const dir=tempRoot();let j,temp;let armed=false;
  const io={...fs,openSync(file,...args){if(armed&&file.includes(`${runId(1)}.json.tmp-`)){temp=file;fs.writeFileSync(file,'COLLISION_SENTINEL',{mode:0o600});}return fs.openSync(file,...args);}};
  try{j=openJournal(dir.root,{fsImpl:io});armed=true;assert.throws(()=>j.createPlanned(planned(1)),code('JOURNAL_IO'));assert.equal(fs.readFileSync(temp,'utf8'),'COLLISION_SENTINEL');assert.equal(fs.existsSync(recordPath(dir.root,runId(1))),false);}finally{j?.close();dir.cleanup();}
});

test('R5 a structurally valid different read-back record is refused',()=>{
  const dir=tempRoot();let j;let armed=false;
  const io={...fs,renameSync(from,to){fs.renameSync(from,to);if(armed&&to===recordPath(dir.root,runId(1))){const r=JSON.parse(fs.readFileSync(to,'utf8'));fs.writeFileSync(to,JSON.stringify({...r,revision:r.revision+7}),{mode:0o600});}}};
  try{j=openJournal(dir.root,{fsImpl:io});armed=true;assert.throws(()=>j.createPlanned(planned(1)),code('JOURNAL_IO'));}finally{j?.close();dir.cleanup();}
});

test('R5 clock rollback is rejected before invalid bytes reach durable storage',()=>{
  const dir=tempRoot();let j;let time=Date.UTC(2026,0,1);
  try{j=openJournal(dir.root,{now:()=>new Date(time).toISOString()});const r=createdRun(j);const before=fs.readFileSync(recordPath(dir.root,r.runId),'utf8');time-=1000;assert.throws(()=>j.transition(r.runId,r.revision,'UNKNOWN'),e=>e.code==='INVALID_INPUT');assert.equal(fs.readFileSync(recordPath(dir.root,r.runId),'utf8'),before);}finally{j?.close();dir.cleanup();}
});

test('start tickets reject same-revision on-disk stage and writer epoch changes', () => {
  for (const change of [r => ({ ...r, stage: 'STOPPING' }), r => ({ ...r, writerEpoch: r.writerEpoch + 1 })]) {
    const fx = freshJournal();
    try {
      const r = createdRun(fx.journal);
      const ticket = fx.journal.authorizeStart(r.runId, r.revision);
      const file = recordPath(fx.root, r.runId);
      const altered = JSON.stringify(change(readRecordFile(fx.root, r.runId)));
      fs.writeFileSync(file, altered, { mode: 0o600 });
      assert.equal(fx.journal.scan().corrupt.length, 0, 'the adversarial record is structurally valid');
      assert.throws(() => fx.journal.assertStartAuthorized(ticket), code('START_NOT_AUTHORIZED'));
      assert.equal(fs.readFileSync(file, 'utf8'), altered);
    } finally { fx.cleanup(); }
  }
});

test('unrelated corruption blocks both new authorization and an existing durable start ticket', () => {
  const fx = freshJournal();
  try {
    const a = createdRun(fx.journal);
    const ticket = fx.journal.authorizeStart(a.runId, a.revision);
    const b = createdRun(fx.journal, 2);
    fs.writeFileSync(recordPath(fx.root, runId(9)), '{', { mode: 0o600 });
    assert.throws(() => fx.journal.authorizeStart(b.runId, b.revision), code('JOURNAL_CORRUPT'));
    assert.throws(() => fx.journal.assertStartAuthorized(ticket), code('JOURNAL_CORRUPT'));
  } finally { fx.cleanup(); }
});

test('a record appearing after directory enumeration cannot be overwritten by createPlanned', () => {
  const dir = tempRoot(); let journal; let armed = false; let planted;
  const io = { ...fs, readdirSync(directory, ...args) {
    const names = fs.readdirSync(directory, ...args);
    if (armed && directory === path.join(dir.root, 'records')) {
      armed = false;
      planted = JSON.stringify({ ...seed, revision: 9 });
      fs.writeFileSync(recordPath(dir.root, runId(1)), planted, { mode: 0o600 });
    }
    return names;
  } };
  let seed;
  try {
    journal = openJournal(dir.root, { fsImpl: io });
    seed = journal.createPlanned(planned(1));
    fs.rmSync(recordPath(dir.root, runId(1)));
    armed = true;
    assert.throws(() => journal.createPlanned(planned(1)), code('DUPLICATE_RUN'));
    assert.equal(fs.readFileSync(recordPath(dir.root, runId(1)), 'utf8'), planted);
  } finally { journal?.close(); dir.cleanup(); }
});

test('a readable non-regular record is refused before parsing', () => {
  const dir = tempRoot(); let journal; let armed = false; const fds = new Set();
  const io = { ...fs, openSync(file, ...args) {
    const fd = fs.openSync(file, ...args);
    if (file === recordPath(dir.root, runId(1))) fds.add(fd); else fds.delete(fd);
    return fd;
  }, fstatSync(fd) {
    const stat = fs.fstatSync(fd);
    return armed && fds.has(fd) ? Object.create(stat, { isFile: { value: () => false } }) : stat;
  } };
  try {
    journal = openJournal(dir.root, { fsImpl: io });
    createdRun(journal); armed = true;
    assert.throws(() => journal.get(runId(1)), code('JOURNAL_CORRUPT'));
    assert.ok(journal.scan().corrupt.length > 0);
  } finally { journal?.close(); dir.cleanup(); }
});

test('malformed lock refusal preserves operator-required error and closed journals do not inspect it', () => {
  const fx = freshJournal();
  try {
    const file = path.join(fx.root, 'writer.lock');
    fs.writeFileSync(file, '{}', { mode: 0o600 });
    assert.throws(() => fx.journal.scan(), code('JOURNAL_LOCKED'));
    fx.journal.close();
    assert.throws(() => fx.journal.scan(), code('JOURNAL_NOT_OWNER'));
    assert.equal(fs.readFileSync(file, 'utf8'), '{}');
  } finally { fx.cleanup(); }
});

test('lock creation refuses invalid own identity and uncertain process liveness cannot justify takeover', () => {
  for (const overrides of [{ pid: 0 }, { pid: 1.5 }, { pid: Number.MAX_SAFE_INTEGER + 1 }, { hostname: 'bad host' }, { now: () => '2026-02-30T00:00:00.000Z' }]) {
    const dir = tempRoot();
    try {
      assert.throws(() => openJournal(dir.root, overrides), code('JOURNAL_LOCKED'));
      assert.equal(fs.existsSync(path.join(dir.root, 'writer.lock')), false);
    } finally { dir.cleanup(); }
  }
  for (const alive of [null, undefined, 0, 'false']) {
    const fx = freshJournal({ pid: 777, hostname: 'h' });
    try {
      const before = fs.readFileSync(path.join(fx.root, 'writer.lock'), 'utf8');
      assert.throws(() => openJournal(fx.root, { pid: 888, hostname: 'h', isProcessAlive: () => alive }), code('JOURNAL_LOCKED'));
      assert.equal(fs.readFileSync(path.join(fx.root, 'writer.lock'), 'utf8'), before);
    } finally { fx.cleanup(); }
  }
});

test('same-token replacement by a different writer is fenced and never released by close', () => {
  for (const change of [l => ({ ...l, pid: l.pid + 1 }), l => ({ ...l, hostname: 'another-host' })]) {
    const fx = freshJournal();
    try {
      const file = path.join(fx.root, 'writer.lock');
      const replacement = JSON.stringify(change(JSON.parse(fs.readFileSync(file, 'utf8'))));
      fs.writeFileSync(file, replacement, { mode: 0o600 });
      assert.throws(() => fx.journal.scan(), code('JOURNAL_NOT_OWNER'));
      fx.journal.close();
      assert.equal(fs.readFileSync(file, 'utf8'), replacement);
    } finally { fx.cleanup(); }
  }
});

test('clock rollback between valid revisions is rejected before persistence', () => {
  const dir = tempRoot(); let j; let time = Date.UTC(2026, 0, 1);
  try {
    j = openJournal(dir.root, { now: () => new Date(time).toISOString() });
    const plannedRecord = j.createPlanned(planned(1));
    time += 1000;
    const created = j.transition(plannedRecord.runId, plannedRecord.revision, 'CREATED', { containerId: cid('c') });
    const before = fs.readFileSync(recordPath(dir.root, created.runId), 'utf8');
    time -= 500;
    assert.throws(() => j.transition(created.runId, created.revision, 'UNKNOWN'), e => e.code === 'INVALID_INPUT');
    assert.equal(fs.readFileSync(recordPath(dir.root, created.runId), 'utf8'), before);
  } finally { j?.close(); dir.cleanup(); }
});

test('a listed record disappearing during scan is corruption, not an empty healthy journal', () => {
  const dir = tempRoot(); let journal; let armed = false;
  const io = { ...fs, readdirSync(directory, ...args) {
    const names = fs.readdirSync(directory, ...args);
    if (armed && directory === path.join(dir.root, 'records')) {
      armed = false; fs.rmSync(recordPath(dir.root, runId(1)));
    }
    return names;
  } };
  try {
    journal = openJournal(dir.root, { fsImpl: io });
    journal.createPlanned(planned(1)); armed = true;
    const scan = journal.scan();
    assert.ok(scan.corrupt.length > 0);
    assert.deepEqual(scan.records, []);
  } finally { journal?.close(); dir.cleanup(); }
});
