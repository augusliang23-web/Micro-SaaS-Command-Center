import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { PendingActionStore, PendingStoreError } from '../server/execution/continuation/pendingActionStore.mjs';
import { PendingActionError, applyStepAdvance, buildInitialRecord } from '../server/execution/continuation/pendingActionTypes.mjs';
import { clock, counterHex, finishAll, freshStore, h, pendingInput, readRev, revisionFile, taskId, tempRoot, sizedInput } from './helpers/pendingFixture.mjs';
import { guarded } from './helpers/pendingFixture.mjs';
const test = guarded(nodeTest);

// OFFLINE ONLY. Durable storage: atomic publication, compare-and-set, replay, concurrency, interrupted and failed writes, corruption,
// filesystem attacks, restart, and the per-task / per-project invariants. No Docker, Git, approval or network.

const code = (c) => (e) => e instanceof PendingActionError && e.code === c;
const STORE_URL = new URL('../server/execution/continuation/pendingActionStore.mjs', import.meta.url).href;
const step = (action, to, extra = {}) => ({ action, to, ...extra });
const idOf = (store, n = 1) => store.create(pendingInput(n));

const faulty = (hooks) => ({
  ...fs, constants: fs.constants,
  openSync: (p, f, m) => { hooks.open?.(p, f); return fs.openSync(p, f, m); },
  writeSync: (...a) => { hooks.write?.(); return fs.writeSync(...a); },
  fsyncSync: (fd) => { hooks.fsync?.(); return fs.fsyncSync(fd); },
  linkSync: (a, b) => { hooks.link?.(a, b); return fs.linkSync(a, b); },
  rmSync: (p, o) => { hooks.rm?.(p); return fs.rmSync(p, o); },
});
const eio = () => Object.assign(new Error('EIO'), { code: 'EIO' });

// ------------------------------------------------------------ basics

test('create: the store chooses the id, revision 1 is durable, files are owner-only, nothing else is left behind', () => {
  const fx = freshStore();
  try {
    const r = idOf(fx.store);
    assert.match(r.pendingId, /^PND-[0-9a-f]{32}$/);
    assert.equal(r.revision, 1); assert.equal(r.status, 'OPEN');
    assert.equal(fs.statSync(fx.root).mode & 0o777, 0o700);
    for (const d of ['records', 'tasks', `records/${r.pendingId}`]) assert.equal(fs.statSync(path.join(fx.root, d)).mode & 0o777, 0o700, d);
    assert.equal(fs.statSync(revisionFile(fx.root, r.pendingId, 1)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(markerPath(fx.root)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(revisionFile(fx.root, r.pendingId, 1)).nlink, 1);
    assert.deepEqual(fs.readdirSync(path.join(fx.root, 'records', r.pendingId)), ['0000000001.json']);
    assert.deepEqual(fx.store.get(r.pendingId), r);
    assert.deepEqual(fx.store.getByTask(taskId(1)), r);
    assert.equal(fx.store.get(`PND-${'f'.repeat(32)}`), null);
    assert.equal(fx.store.getByTask(taskId(9)), null);
    assert.deepEqual(fx.store.list(), { pendings: [r], corrupt: [], leftoverTemp: [] });
  } finally { fx.cleanup(); }
});

test('the whole step sequence persists as an immutable, contiguous history and completes only at the last step', () => {
  const fx = freshStore();
  try {
    const first = idOf(fx.store);
    const done = finishAll(fx.store, first);
    assert.equal(done.status, 'COMPLETED'); assert.equal(done.action, null); assert.equal(done.revision, 10);
    const history = fx.store.history(first.pendingId);
    assert.equal(history.length, 10);
    assert.deepEqual(history.map((r) => r.revision), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(readRev(fx.root, first.pendingId, 1), first, 'revision 1 was never rewritten');
    assert.equal(history[3].expectedHead, h('d'));
    assert.deepEqual(fs.readdirSync(path.join(fx.root, 'records', first.pendingId)).length, 10);
    assert.throws(() => fx.store.advanceStep(first.pendingId, 10, step('COMMIT', 'CLAIMED')), code('NOT_OPEN'));
    assert.throws(() => fx.store.setStatus(first.pendingId, 10, 'REVOKED'), code('NOT_OPEN'));
  } finally { fx.cleanup(); }
});

test('restart: a new store over the same root sees exactly the same state; nothing runs or advances by itself', () => {
  const fx = freshStore();
  try {
    let r = idOf(fx.store);
    r = fx.store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED'));
    const reopened = new PendingActionStore({ root: fx.root, now: clock(Date.UTC(2027, 0, 1)) });
    assert.deepEqual(reopened.get(r.pendingId), r);
    assert.equal(reopened.get(r.pendingId).steps.COMMIT, 'CLAIMED', 'a claimed step is not "recovered" into anything: it stays as recorded');
    assert.deepEqual(reopened.list().pendings, [r]);
    assert.equal(reopened.advanceStep(r.pendingId, 2, step('COMMIT', 'CONSUMED')).revision, 3);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------ compare-and-set, replay, concurrent writers

test('compare-and-set: a stale or replayed revision is rejected and changes nothing', () => {
  const fx = freshStore();
  try {
    const r = idOf(fx.store);
    const r2 = fx.store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED'));
    const before = fs.readFileSync(revisionFile(fx.root, r.pendingId, 2), 'utf8');
    for (const expected of [1, 0, 3, -1, 2.5, '2', null, undefined, NaN]) {
      assert.throws(() => fx.store.advanceStep(r.pendingId, expected, step('COMMIT', 'CONSUMED')), code('STALE_REVISION'), String(expected));
      assert.throws(() => fx.store.setStatus(r.pendingId, expected, 'REVOKED'), code('STALE_REVISION'), String(expected));
    }
    assert.throws(() => fx.store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('STALE_REVISION'), 'replay of the original request');
    assert.equal(fs.readFileSync(revisionFile(fx.root, r.pendingId, 2), 'utf8'), before);
    assert.deepEqual(fx.store.get(r.pendingId), r2);
    assert.equal(fs.existsSync(revisionFile(fx.root, r.pendingId, 3)), false);
  } finally { fx.cleanup(); }
});

test('operations on an unknown pending action are NOT_FOUND; malformed ids are INVALID_ID', () => {
  const fx = freshStore();
  try {
    assert.throws(() => fx.store.advanceStep(`PND-${'a'.repeat(32)}`, 1, step('COMMIT', 'CLAIMED')), code('NOT_FOUND'));
    assert.throws(() => fx.store.setStatus(`PND-${'a'.repeat(32)}`, 1, 'REVOKED'), code('NOT_FOUND'));
    for (const id of ['../x', '../../etc/passwd', 'PND-1', '', null, undefined, 5, {}, `PND-${'a'.repeat(32)}/../x`, `PND-${'A'.repeat(32)}`]) {
      assert.throws(() => fx.store.get(id), code('INVALID_ID'), String(id));
      assert.throws(() => fx.store.advanceStep(id, 1, step('COMMIT', 'CLAIMED')), code('INVALID_ID'), String(id));
      assert.throws(() => fx.store.history(id), code('INVALID_ID'), String(id));
    }
    for (const id of ['../x', 'CC-1', '', null, 5, `${taskId(1)}/../x`]) assert.throws(() => fx.store.getByTask(id), code('INVALID_ID'), String(id));
  } finally { fx.cleanup(); }
});

test('conflicting writers (two store instances, one root): the loser that loses AT publication gets STALE_REVISION; exactly one revision exists', () => {
  const dir = tempRoot();
  try {
    const a = new PendingActionStore({ root: dir.root, now: clock() });
    const created = a.create(pendingInput(1));
    let b = null;
    let raced = false;
    const slow = new PendingActionStore({ root: dir.root, now: clock(), fsImpl: faulty({ link: () => { if (!raced) { raced = true; b.advanceStep(created.pendingId, 1, step('COMMIT', 'CLAIMED')); } } }) });
    b = new PendingActionStore({ root: dir.root, now: clock() });
    assert.throws(() => slow.setStatus(created.pendingId, 1, 'REVOKED'), code('STALE_REVISION'));
    const now = a.get(created.pendingId);
    assert.equal(now.revision, 2); assert.equal(now.steps.COMMIT, 'CLAIMED'); assert.equal(now.status, 'OPEN');
    assert.deepEqual(fs.readdirSync(path.join(dir.root, 'records', created.pendingId)), ['0000000001.json', '0000000002.json'], 'the loser left no temp file and no half revision');
  } finally { dir.cleanup(); }
});

test('real concurrency: six OS processes race for revision 2 of one pending action; exactly one wins and the history stays valid', async () => {
  const fx = freshStore();
  try {
    const r = idOf(fx.store);
    const script = `import { PendingActionStore } from ${JSON.stringify(STORE_URL)};
      const s = new PendingActionStore({ root: ${JSON.stringify(fx.root)}, now: () => '2026-01-01T00:00:30.000Z' });
      try { s.advanceStep(${JSON.stringify(r.pendingId)}, 1, { action: 'COMMIT', to: 'CLAIMED' }); console.log('OK'); } catch (e) { console.log('ERR:' + e.code); }`;
    const run = () => new Promise((resolve) => { const c = spawn(process.execPath, ['--input-type=module', '-e', script]); let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('close', () => resolve(out.trim())); });
    const results = await Promise.all(Array.from({ length: 6 }, run));
    assert.equal(results.filter((x) => x === 'OK').length, 1, JSON.stringify(results));
    // every loser is refused as STALE_REVISION, or (reading during the winner's publication window) fails closed as RECORD_CORRUPT: never a second success
    assert.ok(results.filter((x) => x !== 'OK').every((x) => ['ERR:STALE_REVISION', 'ERR:RECORD_CORRUPT'].includes(x)), JSON.stringify(results));
    const final = fx.store.get(r.pendingId);
    assert.equal(final.revision, 2); assert.equal(final.steps.COMMIT, 'CLAIMED');
    assert.equal(fx.store.list().corrupt.length, 0);
    assert.deepEqual(fs.readdirSync(path.join(fx.root, 'records', r.pendingId)), ['0000000001.json', '0000000002.json']);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------ identities, per-task and per-project invariants

test('duplicate pending identity is rejected without touching the existing record or leaving a claim for the second task', () => {
  const dir = tempRoot();
  try {
    const store = new PendingActionStore({ root: dir.root, now: clock(), randomHex: () => '1'.repeat(32) });
    const first = store.create(pendingInput(1));
    const bytes = fs.readFileSync(revisionFile(dir.root, first.pendingId, 1));
    assert.throws(() => store.create(pendingInput(2)), code('DUPLICATE_PENDING'));
    assert.equal(fs.existsSync(revisionFile(dir.root, first.pendingId, 1)), true, 'existing revision must survive');
    assert.deepEqual(fs.readFileSync(revisionFile(dir.root, first.pendingId, 1)), bytes);
    assert.equal(fs.existsSync(path.join(dir.root, 'tasks', `${taskId(2)}.open`)), false, 'the failed create did not leave task 2 blocked');
    assert.equal(store.get(first.pendingId).taskId, taskId(1));
    assert.equal(store.list().pendings.length, 1);
  } finally { dir.cleanup(); }
});

test('a hostile or malformed generated id is refused (the id source is not trusted either)', () => {
  const dir = tempRoot();
  try {
    for (const bad of ['../../etc', 'x', '']) {
      const store = new PendingActionStore({ root: dir.root, now: clock(), randomHex: () => bad });
      assert.throws(() => store.create(pendingInput(1)), (e) => e instanceof PendingActionError);
    }
    assert.deepEqual(fs.readdirSync(path.join(dir.root, 'records')), []);
    assert.deepEqual(fs.readdirSync(path.join(dir.root, 'tasks')), []);
  } finally { dir.cleanup(); }
});

test('one pending action per TASK: a second create is refused; only REVOKED or SUPERSEDED release the task', () => {
  const fx = freshStore();
  try {
    const a = idOf(fx.store);
    assert.throws(() => idOf(fx.store), code('TASK_ALREADY_PENDING'));
    assert.equal(fx.store.list().pendings.length, 1);
    fx.store.setStatus(a.pendingId, 1, 'REVOKED');
    const b = idOf(fx.store);
    assert.notEqual(b.pendingId, a.pendingId);
    assert.equal(fx.store.getByTask(taskId(1)).pendingId, b.pendingId);
    fx.store.setStatus(b.pendingId, 1, 'SUPERSEDED');
    const c = idOf(fx.store);
    assert.equal(fx.store.getByTask(taskId(1)).pendingId, c.pendingId);
    assert.equal(fx.store.get(a.pendingId).status, 'REVOKED', 'history of released pending actions is kept');
    // INTERRUPTED and COMPLETED keep the task held for good
    fx.store.setStatus(c.pendingId, 1, 'INTERRUPTED');
    assert.throws(() => idOf(fx.store), code('TASK_ALREADY_PENDING'));
    const done = fx.store.create(pendingInput(2));
    finishAll(fx.store, done);
    assert.throws(() => fx.store.create(pendingInput(2)), code('TASK_ALREADY_PENDING'));
  } finally { fx.cleanup(); }
});

test('a surviving marker for a REVOKED pending action is retained on the next create; a marker for anything else, missing or corrupt fails closed', () => {
  const fx = freshStore();
  try {
    const a = idOf(fx.store);
    const marker = markerPath(fx.root);
    const markerBytes = fs.readFileSync(marker);
    fx.store.setStatus(a.pendingId, 1, 'REVOKED');
    fs.writeFileSync(marker, markerBytes, { mode: 0o600 }); // the best-effort release "crashed"
    assert.equal(idOf(fx.store).taskId, taskId(1));
  } finally { fx.cleanup(); }
  const gone = freshStore();
  try {
    const a = idOf(gone.store);
    fs.rmSync(path.join(gone.root, 'records', a.pendingId), { recursive: true });
    assert.throws(() => idOf(gone.store), code('TASK_ALREADY_PENDING'), 'a marker naming a missing record blocks the task');
    assert.throws(() => gone.store.getByTask(taskId(1)), code('RECORD_CORRUPT'));
  } finally { gone.cleanup(); }
  const forged = freshStore();
  try {
    const own = idOf(forged.store);
    const other = forged.store.create(pendingInput(2));
    const marker = markerPath(forged.root);
    const put = (value) => fs.writeFileSync(marker, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
    const good = { schemaVersion: 1, generation: 1, taskId: taskId(1), pendingId: own.pendingId };
    put(good); assert.equal(forged.store.getByTask(taskId(1)).pendingId, own.pendingId);
    put({ ...good, pendingId: other.pendingId });
    assert.throws(() => forged.store.getByTask(taskId(1)), code('RECORD_CORRUPT'), "a marker naming another task's record");
    for (const [label, bad] of Object.entries({
      'extra key': { ...good, extra: 1 }, 'missing pendingId': { schemaVersion: 1, taskId: taskId(1) }, 'wrong schemaVersion': { ...good, schemaVersion: 2 },
      'names another task': { ...good, taskId: taskId(2) }, 'bad pendingId': { ...good, pendingId: 'x' }, empty: '', 'not JSON': '{', array: '[]', null: 'null',
    })) {
      put(bad);
      assert.throws(() => forged.store.getByTask(taskId(1)), code('RECORD_CORRUPT'), label);
      assert.throws(() => idOf(forged.store), (e) => e instanceof PendingActionError, label);
    }
  } finally { forged.cleanup(); }
});

test('revoking or superseding preserves all marker generations; other endings block reclaim', () => {
  const fx = freshStore();
  try {
    let generation = 0;
    for (const to of ['REVOKED', 'SUPERSEDED']) {
      const r = idOf(fx.store); generation += 1;
      const marker = markerPath(fx.root, 1, generation);
      assert.equal(fs.existsSync(marker), true);
      fx.store.setStatus(r.pendingId, 1, to);
      assert.equal(fs.existsSync(marker), true, to);
    }
    const r = idOf(fx.store);
    fx.store.setStatus(r.pendingId, 1, 'INTERRUPTED');
    assert.equal(fs.existsSync(markerPath(fx.root, 1, 3)), true);
    assert.throws(() => idOf(fx.store), code('TASK_ALREADY_PENDING'));
  } finally { fx.cleanup(); }
});

test('several pending actions in ONE project are allowed (parallel branches), independent and individually valid; no project-wide restriction exists', () => {
  const fx = freshStore();
  try {
    const rs = [1, 2, 3].map((n) => fx.store.create(pendingInput(n, { projectId: 'demo' })));
    assert.equal(new Set(rs.map((r) => r.projectId)).size, 1);
    assert.equal(new Set(rs.map((r) => r.pendingId)).size, 3);
    const a = fx.store.advanceStep(rs[0].pendingId, 1, step('COMMIT', 'CLAIMED'));
    const c = fx.store.setStatus(rs[2].pendingId, 1, 'REVOKED');
    assert.equal(a.steps.COMMIT, 'CLAIMED');
    assert.equal(fx.store.get(rs[1].pendingId).revision, 1, 'a sibling is untouched');
    assert.equal(c.status, 'REVOKED');
    assert.deepEqual(fx.store.list().pendings.map((r) => r.taskId).sort(), [taskId(1), taskId(2), taskId(3)]);
    // two tasks in a project may each be mid-flight: this store does NOT serialise them (an A1-1 dependency)
    const second = fx.store.advanceStep(rs[1].pendingId, 1, step('COMMIT', 'CLAIMED'));
    assert.equal(second.steps.COMMIT, 'CLAIMED');
  } finally { fx.cleanup(); }
});

test('invalid create input writes nothing: no directory, no marker, no temp file', () => {
  const fx = freshStore();
  try {
    for (const input of [null, {}, { ...pendingInput(1), approvedBy: 'me' }, { ...pendingInput(1), taskId: '../x' }, { ...pendingInput(1), runId: 'x' }, { ...pendingInput(1), baseSha: 'x' },
      { ...pendingInput(1), verification: undefined }, { ...pendingInput(1), verification: { evidenceId: 'EV-1', kind: 'command_result', grade: 'LOCALLY_VERIFIED', passed: true } },
      { ...pendingInput(1), verification: { ...pendingInput(1).verification, grade: 'AGENT_CLAIM' } }, { ...pendingInput(1), manifest: { files: [] } }]) {
      assert.throws(() => fx.store.create(input), (e) => e instanceof PendingActionError);
    }
    assert.throws(() => fx.store.create(pendingInput(1), { ttlMs: 5 }), code('INVALID_INPUT'));
    assert.deepEqual(fs.readdirSync(path.join(fx.root, 'records')), []);
    assert.deepEqual(fs.readdirSync(path.join(fx.root, 'tasks')), []);
  } finally { fx.cleanup(); }
});

test('the revision limit is enforced', () => {
  const near = { ...buildInitialRecord(pendingInput(1), { pendingId: `PND-${'1'.repeat(32)}`, now: '2026-01-01T00:00:00.000Z' }), revision: 32 };
  assert.throws(() => applyStepAdvance(near, { action: 'COMMIT', to: 'CLAIMED' }, '2026-01-01T00:00:01.000Z'), code('REVISION_LIMIT'));
});

// ------------------------------------------------------------ interrupted and failed writes (fail closed, never "success")

test('failed write before publication (data write fails): WRITE_FAILED, the previous revision is intact, no temp file remains', () => {
  const dir = tempRoot();
  try {
    let armed = false;
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl: faulty({ write: () => { if (armed) throw eio(); } }) });
    const r = store.create(pendingInput(1));
    armed = true;
    assert.throws(() => store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('WRITE_FAILED'));
    armed = false;
    assert.deepEqual(store.get(r.pendingId), r);
    assert.deepEqual(fs.readdirSync(path.join(dir.root, 'records', r.pendingId)), ['0000000001.json']);
    assert.equal(store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')).revision, 2, 'a definite failure leaves the same revision retryable');
  } finally { dir.cleanup(); }
});

test('failed write before publication (file fsync fails): WRITE_FAILED and nothing is published', () => {
  const dir = tempRoot();
  try {
    let armed = false;
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl: faulty({ fsync: () => { if (armed) throw eio(); } }) });
    const r = store.create(pendingInput(1));
    armed = true;
    assert.throws(() => store.setStatus(r.pendingId, 1, 'REVOKED'), code('WRITE_FAILED'));
    armed = false;
    assert.equal(store.get(r.pendingId).status, 'OPEN');
    assert.deepEqual(fs.readdirSync(path.join(dir.root, 'records', r.pendingId)), ['0000000001.json']);
  } finally { dir.cleanup(); }
});

test('failed publication (link fails for a reason other than EEXIST): WRITE_FAILED; a failed CREATE retains its immutable claim and blocks retries', () => {
  const dir = tempRoot();
  try {
    let armed = true;
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl: faulty({ link: (a, b) => { if (armed && String(b).includes('/records/')) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); } }) });
    assert.throws(() => store.create(pendingInput(1)), code('WRITE_FAILED'));
    assert.deepEqual(fs.readdirSync(path.join(dir.root, 'records')), [], 'the half-created pending directory was removed');
    assert.equal(fs.readdirSync(path.join(dir.root, 'tasks')).length, 1, 'the immutable claim survives failure');
    assert.throws(() => store.create(pendingInput(1)), code('TASK_ALREADY_PENDING'));
    armed = false;
    const r = store.create(pendingInput(2));
    armed = true;
    assert.throws(() => store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('WRITE_FAILED'));
    assert.deepEqual(fs.readdirSync(path.join(dir.root, 'records', r.pendingId)), ['0000000001.json']);
  } finally { dir.cleanup(); }
});

test('directory fsync failure after publication: WRITE_AMBIGUOUS (never success); the revision may exist; a blind retry is refused as stale', () => {
  const dir = tempRoot();
  try {
    let armed = false;
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl: faulty({ open: (p, f) => { if (armed && f === 'r') throw eio(); } }) });
    const r = store.create(pendingInput(1));
    armed = true;
    assert.throws(() => store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('WRITE_AMBIGUOUS'));
    armed = false;
    assert.equal(store.get(r.pendingId).revision, 2, 'the revision reached the disk');
    assert.throws(() => store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('STALE_REVISION'), 'no double application');
    assert.equal(store.list().corrupt.length, 0);
  } finally { dir.cleanup(); }
});

test('ambiguous CREATE: reported ambiguous, the claim and record are kept (not rolled back), the task stays held', () => {
  const dir = tempRoot();
  try {
    let armed = true;
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl: faulty({ open: (p, f) => { if (armed && f === 'r' && String(p).includes('/records/')) throw eio(); } }) });
    assert.throws(() => store.create(pendingInput(1)), code('WRITE_AMBIGUOUS'));
    armed = false;
    assert.equal(store.list().pendings.length, 1, 'the record may exist and is not deleted');
    assert.throws(() => store.create(pendingInput(1)), code('TASK_ALREADY_PENDING'));
    assert.equal(store.getByTask(taskId(1)).status, 'OPEN');
  } finally { dir.cleanup(); }
});

test('a failure to remove the temp name after publication is ambiguous and the extra hard link is then detected as corruption', () => {
  const dir = tempRoot();
  try {
    let armed = false;
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl: faulty({ rm: (p) => { if (armed && String(p).includes('.tmp-')) throw eio(); } }) });
    const r = store.create(pendingInput(1));
    armed = true;
    assert.throws(() => store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('WRITE_AMBIGUOUS'));
    armed = false;
    assert.throws(() => store.get(r.pendingId), code('RECORD_CORRUPT'), 'fail closed: a revision with two names is not trusted');
  } finally { dir.cleanup(); }
});

test('a write that reports no progress or more than it wrote is an error, never a silently short record', () => {
  for (const kind of ['zero', 'over']) {
    const dir = tempRoot();
    try {
      let armed = false; let calls = 0;
      const fsImpl = { ...fs, constants: fs.constants, writeSync: (fd, buf, off, len, pos) => {
        if (!armed) return fs.writeSync(fd, buf, off, len, pos);
        calls += 1;
        if (kind === 'zero') return calls === 1 ? 0 : fs.writeSync(fd, buf, off, len, pos);
        fs.writeSync(fd, buf, off, len, pos); return len + 5;
      } };
      const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl });
      const r = store.create(pendingInput(1));
      armed = true;
      assert.throws(() => store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('WRITE_FAILED'), kind);
      armed = false;
      assert.deepEqual(fs.readdirSync(path.join(dir.root, 'records', r.pendingId)), ['0000000001.json'], kind);
    } finally { dir.cleanup(); }
  }
});

test('a read-back that differs from what was published is ambiguous, never success', () => {
  const dir = tempRoot();
  try {
    let armed = false; let flipped = false; let publishedFd = null;
    const fsImpl = { ...fs, constants: fs.constants,
      linkSync: (a, b) => { fs.linkSync(a, b); if (armed && String(b).endsWith('0000000002.json')) publishedFd = true; },
      readSync: (fd, buf, off, len, pos) => { const n = fs.readSync(fd, buf, off, len, pos); if (armed && publishedFd && !flipped && n > 0) { const text = buf.toString('utf8', off, off + n); const swapped = text.replace('"revision": 2', '"revision": 3'); if (swapped !== text) { flipped = true; buf.write(swapped, off); } } return n; } };
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl });
    const r = store.create(pendingInput(1));
    armed = true;
    assert.throws(() => store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('WRITE_AMBIGUOUS'));
    assert.equal(flipped, true, 'the injected difference was actually applied');
    armed = false;
    assert.equal(store.get(r.pendingId).revision, 2, 'the real revision on disk is fine; only the confirmation failed');
  } finally { dir.cleanup(); }
});

test('crash after the temp file was written but before publication: the leftover is reported, never read as a revision, never deleted', () => {
  const fx = freshStore();
  try {
    const r = idOf(fx.store);
    const leftover = path.join(fx.root, 'records', r.pendingId, '0000000002.json.tmp-4242-deadbeef');
    fs.writeFileSync(leftover, '{"half":', { mode: 0o600 });
    fs.writeFileSync(path.join(fx.root, 'tasks', `${taskId(9)}.0000000001.open.tmp-4242-deadbeef`), '{', { mode: 0o600 });
    assert.deepEqual(fx.store.get(r.pendingId), r);
    const list = fx.store.list();
    assert.deepEqual(list.corrupt, []);
    assert.deepEqual(list.leftoverTemp.sort(), [`${r.pendingId}/0000000002.json.tmp-4242-deadbeef`, `tasks/${taskId(9)}.0000000001.open.tmp-4242-deadbeef`]);
    assert.equal(fx.store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')).revision, 2, 'a stale temp file does not block or satisfy the next revision');
    assert.equal(fs.existsSync(leftover), true);
  } finally { fx.cleanup(); }
});

test('a torn revision (non-atomic foreign writer) is corruption, not a pending action', () => {
  const fx = freshStore();
  try {
    const r = idOf(fx.store);
    const text = fs.readFileSync(revisionFile(fx.root, r.pendingId, 1), 'utf8');
    fs.writeFileSync(revisionFile(fx.root, r.pendingId, 2), text.slice(0, text.length / 2), { mode: 0o600 });
    assert.throws(() => fx.store.get(r.pendingId), code('RECORD_CORRUPT'));
    assert.throws(() => fx.store.advanceStep(r.pendingId, 1, step('COMMIT', 'CLAIMED')), code('RECORD_CORRUPT'));
    assert.equal(fx.store.list().corrupt.length, 1);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------ corruption fails closed (also after restart)

const seeded = (n = 3) => {
  const fx = freshStore();
  const r = idOf(fx.store);
  let cur = r;
  const steps = [step('COMMIT', 'CLAIMED'), step('COMMIT', 'CONSUMED'), step('COMMIT', 'DONE', { commitSha: h('d') }), step('PUSH_BRANCH', 'CLAIMED')];
  for (const s of steps.slice(0, n - 1)) cur = fx.store.advanceStep(cur.pendingId, cur.revision, s);
  const sibling = fx.store.create(pendingInput(2));
  return { ...fx, id: r.pendingId, sibling };
};
const rewrite = (fx, rev, mutate) => { const rec = readRev(fx.root, fx.id, rev); mutate(rec); fs.writeFileSync(revisionFile(fx.root, fx.id, rev), JSON.stringify(rec, null, 2), { mode: 0o600 }); };
const CORRUPTIONS = {
  'invalid JSON': (fx) => fs.writeFileSync(revisionFile(fx.root, fx.id, 3), '{nope', { mode: 0o600 }),
  'empty file': (fx) => fs.writeFileSync(revisionFile(fx.root, fx.id, 3), '', { mode: 0o600 }),
  'JSON array': (fx) => fs.writeFileSync(revisionFile(fx.root, fx.id, 3), '[]', { mode: 0o600 }),
  'extra key (a smuggled approval id)': (fx) => rewrite(fx, 3, (r) => { r.approvalId = 'APR-0123456789abcdef'; }),
  'missing key': (fx) => rewrite(fx, 3, (r) => { delete r.guardSnapshot; }),
  'malformed record (bad sha)': (fx) => rewrite(fx, 3, (r) => { r.treeSha = 'xyz'; }),
  'verification reference removed': (fx) => rewrite(fx, 3, (r) => { delete r.verification; }),
  'verification downgraded to an agent claim': (fx) => rewrite(fx, 3, (r) => { r.verification.grade = 'AGENT_CLAIM'; }),
  'NOT_JOURNALED rewritten as JOURNALED (identity association invalid)': (fx) => rewrite(fx, 3, (r) => { r.executionIdentity = { state: 'JOURNALED', stateRootId: 'a'.repeat(32), executionGeneration: 1, runId: r.runId }; }),
  'JOURNALED naming another run': (fx) => rewrite(fx, 1, (r) => { r.executionIdentity = { state: 'JOURNALED', stateRootId: 'a'.repeat(32), executionGeneration: 1, runId: 'RUN-20260101-0000ffff' }; }),
  'immutable tree changed in the latest revision': (fx) => rewrite(fx, 3, (r) => { r.treeSha = h('9'); }),
  'immutable manifest changed in the latest revision': (fx) => rewrite(fx, 3, (r) => { r.manifest.files[0].size += 1; }),
  'earlier revision rewritten': (fx) => rewrite(fx, 1, (r) => { r.branch = `agent/${r.taskId}-evil`; }),
  'step skipped (CLAIMED -> DONE)': (fx) => rewrite(fx, 3, (r) => { r.steps.COMMIT = 'DONE'; r.expectedHead = h('d'); r.action = 'PUSH_BRANCH'; }),
  'action ordering violated (PUSH before COMMIT)': (fx) => rewrite(fx, 3, (r) => { r.steps.PUSH_BRANCH = 'CLAIMED'; }),
  'invalid status': (fx) => rewrite(fx, 3, (r) => { r.status = 'APPROVED'; }),
  'revision replayed (revision 2 copied over revision 3)': (fx) => fs.copyFileSync(revisionFile(fx.root, fx.id, 2), revisionFile(fx.root, fx.id, 3)),
  'revision number lies': (fx) => rewrite(fx, 3, (r) => { r.revision = 9; }),
  'pendingId of another record': (fx) => rewrite(fx, 3, (r) => { r.pendingId = `PND-${'9'.repeat(32)}`; }),
  'file names lie about the order (revision 2 renamed to 3)': (fx) => fs.renameSync(revisionFile(fx.root, fx.id, 2), revisionFile(fx.root, fx.id, 3).replace('0000000003', '0000000004')),
  'gap in the history (revision 2 deleted)': (fx) => fs.rmSync(revisionFile(fx.root, fx.id, 2)),
  'oversized file (valid JSON padded past the limit)': (fx) => fs.writeFileSync(revisionFile(fx.root, fx.id, 3), `${fs.readFileSync(revisionFile(fx.root, fx.id, 3), 'utf8')}${' '.repeat(270_000)}`, { mode: 0o600 }),
  'group/world readable': (fx) => fs.chmodSync(revisionFile(fx.root, fx.id, 3), 0o644),
  'revision file is a symlink': (fx) => { const out = path.join(fx.base, 'outside.json'); fs.copyFileSync(revisionFile(fx.root, fx.id, 3), out); fs.rmSync(revisionFile(fx.root, fx.id, 3)); fs.symlinkSync(out, revisionFile(fx.root, fx.id, 3)); },
  'revision file has a second hard link': (fx) => fs.linkSync(revisionFile(fx.root, fx.id, 3), path.join(fx.base, 'alias.json')),
  'revision path is a directory': (fx) => { fs.rmSync(revisionFile(fx.root, fx.id, 3)); fs.mkdirSync(revisionFile(fx.root, fx.id, 3)); },
  'unexpected file in the pending directory': (fx) => fs.writeFileSync(path.join(fx.root, 'records', fx.id, 'notes.txt'), 'x', { mode: 0o600 }),
  'unexpected non-revision JSON': (fx) => fs.writeFileSync(path.join(fx.root, 'records', fx.id, '0000000004.json.bak'), '{}', { mode: 0o600 }),
  'pending directory has no revision': (fx) => { for (const n of fs.readdirSync(path.join(fx.root, 'records', fx.id))) fs.rmSync(path.join(fx.root, 'records', fx.id, n)); },
};
for (const [name, mutate] of Object.entries(CORRUPTIONS)) {
  test(`corruption fails closed (and survives a restart): ${name}`, () => {
    const fx = seeded(3);
    try {
      mutate(fx);
      const snapshot = fs.readdirSync(path.join(fx.root, 'records', fx.id)).map((n) => [n, (() => { try { return fs.readFileSync(path.join(fx.root, 'records', fx.id, n)); } catch { return null; } })()]);
      for (const store of [fx.store, new PendingActionStore({ root: fx.root, now: clock(Date.UTC(2027, 0, 1)) })]) {
        assert.throws(() => store.get(fx.id), code('RECORD_CORRUPT'));
        assert.throws(() => store.history(fx.id), code('RECORD_CORRUPT'));
        assert.throws(() => store.advanceStep(fx.id, 3, step('COMMIT', 'DONE', { commitSha: h('d') })), code('RECORD_CORRUPT'));
        assert.throws(() => store.setStatus(fx.id, 3, 'REVOKED'), code('RECORD_CORRUPT'));
        const list = store.list();
        assert.equal(list.corrupt.length, 1, 'reported, not skipped silently');
        assert.equal(list.corrupt[0].id, fx.id);
        assert.deepEqual(list.pendings.map((p) => p.pendingId), [fx.sibling.pendingId], 'unrelated pending actions stay readable');
        assert.equal(store.get(fx.sibling.pendingId).revision, 1);
      }
      assert.deepEqual(fs.readdirSync(path.join(fx.root, 'records', fx.id)).map((n) => [n, (() => { try { return fs.readFileSync(path.join(fx.root, 'records', fx.id, n)); } catch { return null; } })()]), snapshot, 'no automatic repair');
    } finally { fx.cleanup(); }
  });
}

test('KNOWN LIMIT (documented, not claimed as protected): deleting the NEWEST revision makes the previous one current again', () => {
  const fx = seeded(3);
  try {
    fs.rmSync(revisionFile(fx.root, fx.id, 3));
    assert.equal(fx.store.get(fx.id).revision, 2, 'rollback by deletion cannot be detected by the store alone (records are unsigned); A1-1 must pair this store with separate exclusive decision markers');
  } finally { fx.cleanup(); }
});

test('a FIFO planted at a revision path is corruption and never blocks the process (checked in a child with a hard timeout)', () => {
  const fx = seeded(3);
  try {
    fs.rmSync(revisionFile(fx.root, fx.id, 3));
    const made = spawnSync('/usr/bin/mkfifo', ['-m', '600', revisionFile(fx.root, fx.id, 3)]);
    assert.equal(made.status, 0);
    const script = `import { PendingActionStore } from ${JSON.stringify(STORE_URL)};
      const s = new PendingActionStore({ root: ${JSON.stringify(fx.root)} });
      try { s.get(${JSON.stringify(fx.id)}); console.log('READ'); } catch (e) { console.log('REFUSED:' + e.code); }`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL' });
    assert.equal(child.error, undefined, 'the child did not hang on the FIFO');
    assert.equal(child.status, 0);
    assert.match(child.stdout, /REFUSED:RECORD_CORRUPT/);
  } finally { fx.cleanup(); }
});

test('revision file NAMES must be contiguous even when the contents are (revision 2 renamed to 3)', () => {
  const fx = seeded(2);
  try {
    assert.equal(fx.store.get(fx.id).revision, 2);
    fs.renameSync(revisionFile(fx.root, fx.id, 2), revisionFile(fx.root, fx.id, 3));
    assert.throws(() => fx.store.get(fx.id), code('RECORD_CORRUPT'));
    assert.equal(fx.store.list().corrupt.length, 1);
  } finally { fx.cleanup(); }
});

test('a valid revision copied into another pending directory is refused (its pendingId does not match the directory)', () => {
  const fx = seeded(2);
  try {
    const stranger = `PND-${'9'.repeat(32)}`;
    fs.mkdirSync(path.join(fx.root, 'records', stranger), { mode: 0o700 });
    fs.copyFileSync(revisionFile(fx.root, fx.sibling.pendingId, 1), revisionFile(fx.root, stranger, 1));
    assert.throws(() => fx.store.get(stranger), code('RECORD_CORRUPT'));
    assert.equal(fx.store.list().corrupt.map((c) => c.id).join(), stranger);
  } finally { fx.cleanup(); }
});

test('a symlinked pending directory is never followed', () => {
  const fx = seeded(3);
  try {
    const outside = path.join(fx.base, 'elsewhere');
    fs.renameSync(path.join(fx.root, 'records', fx.id), outside);
    fs.symlinkSync(outside, path.join(fx.root, 'records', fx.id));
    assert.throws(() => fx.store.get(fx.id), (e) => e instanceof PendingActionError);
    assert.throws(() => fx.store.advanceStep(fx.id, 3, step('COMMIT', 'DONE', { commitSha: h('d') })), (e) => e instanceof PendingActionError);
    assert.equal(fx.store.list().corrupt.length, 1);
    assert.equal(fs.readdirSync(outside).length, 3, 'nothing was written through the link');
  } finally { fx.cleanup(); }
});

test('a record owned by another user is corruption (uid check on the opened file)', () => {
  const dir = tempRoot();
  try {
    let skew = false;
    const fds = new Set();
    const fsImpl = { ...fs, constants: fs.constants, openSync: (p, f, m) => { const fd = fs.openSync(p, f, m); if (String(p).includes('/records/PND-')) fds.add(fd); else fds.delete(fd); return fd; }, fstatSync: (fd) => { const st = fs.fstatSync(fd); return skew && fds.has(fd) ? Object.create(st, { uid: { value: st.uid + 1 } }) : st; } };
    const store = new PendingActionStore({ root: dir.root, now: clock(), fsImpl });
    const r = store.create(pendingInput(1));
    skew = true;
    assert.throws(() => store.get(r.pendingId), code('RECORD_CORRUPT'));
    skew = false;
    assert.equal(store.get(r.pendingId).revision, 1);
  } finally { dir.cleanup(); }
});

test('unexpected entries in records/ or tasks/ are reported, never ignored', () => {
  const fx = freshStore();
  try {
    idOf(fx.store);
    fs.writeFileSync(path.join(fx.root, 'records', 'junk.txt'), 'x', { mode: 0o600 });
    fs.writeFileSync(path.join(fx.root, 'tasks', 'junk.txt'), 'x', { mode: 0o600 });
    fs.mkdirSync(path.join(fx.root, 'records', 'PND-short'), { mode: 0o700 });
    const list = fx.store.list();
    assert.deepEqual(list.corrupt.map((c) => c.id).sort(), ['PND-short', 'junk.txt', 'tasks/junk.txt']);
    assert.equal(list.pendings.length, 1);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------ storage root safety

test('the storage root must be a server-controlled, normalized, canonical, owner-only directory', () => {
  const dir = tempRoot();
  try {
    for (const bad of ['relative/pending', './pending', '', '/', `${dir.base}/a/../pending`, `${dir.base}//pending`, `${dir.base}/pending/`, `${dir.base}/x\0y`, null, undefined, 5]) {
      assert.throws(() => new PendingActionStore({ root: bad }), code('STORE_PATH'), String(bad));
    }
    assert.equal(fs.existsSync(`${dir.base}/a`), false, 'refused before anything was created');
    assert.equal(fs.existsSync(`${dir.base}/pending`), false);
    fs.mkdirSync(`${dir.base}/real`, { mode: 0o700 });
    fs.symlinkSync(`${dir.base}/real`, `${dir.base}/link`);
    assert.throws(() => new PendingActionStore({ root: `${dir.base}/link` }), code('STORE_PATH'));
    assert.throws(() => new PendingActionStore({ root: `${dir.base}/link/sub` }), (e) => e instanceof PendingActionError || e?.code === 'ENOENT');
    assert.deepEqual(fs.readdirSync(`${dir.base}/real`), [], 'nothing was created through the link');
    fs.mkdirSync(`${dir.base}/open`, { mode: 0o755 }); fs.chmodSync(`${dir.base}/open`, 0o755);
    assert.throws(() => new PendingActionStore({ root: `${dir.base}/open` }), code('STORE_PERMISSIONS'));
    assert.equal(fs.statSync(`${dir.base}/open`).mode & 0o777, 0o755, 'never silently chmod-ed');
    assert.throws(() => new PendingActionStore({ root: dir.root, uid: (process.getuid?.() ?? 0) + 12345 }), code('STORE_PERMISSIONS'));
  } finally { dir.cleanup(); }
});

test('records/ and tasks/ may not be symlinks or open to other users', () => {
  const dir = tempRoot();
  try {
    const first = new PendingActionStore({ root: dir.root, now: clock() });
    void first;
    const outside = path.join(dir.base, 'out');
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.rmSync(path.join(dir.root, 'tasks'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir.root, 'tasks'));
    assert.throws(() => new PendingActionStore({ root: dir.root }), code('STORE_PATH'));
    fs.rmSync(path.join(dir.root, 'tasks'));
    fs.mkdirSync(path.join(dir.root, 'tasks'), { mode: 0o700 });
    fs.chmodSync(path.join(dir.root, 'records'), 0o750);
    assert.throws(() => new PendingActionStore({ root: dir.root }), code('STORE_PERMISSIONS'));
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { dir.cleanup(); }
});

test('source scope: the pending modules import only the task types, the pure diff-digest function, the identity timestamp validator and node fs/path/crypto', () => {
  const text = fs.readFileSync(new URL('../server/execution/continuation/pendingActionStore.mjs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../server/execution/continuation/pendingActionTypes.mjs', import.meta.url), 'utf8');
  const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['../../tasks/types.mjs', '../../tasks/types.mjs', '../approvalGate.mjs', '../identity/executionIdentity.mjs', './pendingActionTypes.mjs', 'node:crypto', 'node:fs', 'node:path'].sort());
  assert.ok(PendingStoreError);
});

// Security remediation: regressions first, with deterministic filesystem interleavings.
const markerPath = (root, n = 1, generation = 1) => path.join(root, 'tasks', `${taskId(n)}.${String(generation).padStart(10, '0')}.open`);

test('R1 published generations survive revoke and failed create, and are never reclaimed by deletion', () => {
  const fx = freshStore();
  try {
    const first = idOf(fx.store);
    assert.equal(fs.existsSync(markerPath(fx.root)), true, 'generation 1 must be published');
    const bytes = fs.readFileSync(markerPath(fx.root));
    fx.store.setStatus(first.pendingId, 1, 'REVOKED');
    const next = idOf(fx.store);
    assert.equal(fs.existsSync(markerPath(fx.root)), true, 'published generation must survive');
    assert.deepEqual(fs.readFileSync(markerPath(fx.root)), bytes);
    assert.equal(JSON.parse(fs.readFileSync(markerPath(fx.root, 1, 2))).pendingId, next.pendingId);
  } finally { fx.cleanup(); }
});

test('R2 deterministic temp collision preserves preexisting bytes and refuses publication', () => {
  const fx = freshStore({ randomHex: counterHex() });
  try {
    const r = idOf(fx.store);
    const colliding = new PendingActionStore({ root: fx.root, now: clock(), randomHex: () => 'deadbeef' });
    const tmp = `${revisionFile(fx.root, r.pendingId, 2)}.tmp-${process.pid}-deadbeef`;
    fs.writeFileSync(tmp, 'owned-by-other-invocation', { mode: 0o600 });
    assert.throws(() => colliding.setStatus(r.pendingId, 1, 'REVOKED'), code('WRITE_FAILED'));
    assert.equal(fs.existsSync(tmp), true, 'preexisting collision file must survive');
    assert.equal(fs.readFileSync(tmp, 'utf8'), 'owned-by-other-invocation');
    assert.equal(fs.existsSync(revisionFile(fx.root, r.pendingId, 2)), false);
    assert.equal(fx.store.get(r.pendingId).revision, 1);
  } finally { fx.cleanup(); }
});

for (const bytes of [138114, 262143, 262144, 262145]) {
  test(`R3 serialized record boundary ${bytes} bytes with UTF-8 paths`, () => {
    const fx = freshStore();
    try {
      const input = sizedInput(bytes);
      const measured = Buffer.byteLength(JSON.stringify(buildInitialRecord(input, { pendingId: `PND-${'1'.repeat(32)}`, now: '2026-01-01T00:00:00.000Z' }), null, 2) + '\n');
      assert.equal(measured, bytes);
      assert.equal(input.manifest.files.length, 200);
      assert.ok(input.manifest.files.every((f) => f.path.length === 512));
      if (bytes <= 262144) {
        const r = fx.store.create(input);
        assert.equal(fs.statSync(revisionFile(fx.root, r.pendingId, 1)).size, bytes);
      } else {
        assert.throws(() => fx.store.create(input), code('WRITE_FAILED'));
        assert.deepEqual(fs.readdirSync(path.join(fx.root, 'records')), []);
        assert.deepEqual(fs.readdirSync(path.join(fx.root, 'tasks')), []);
      }
    } finally { fx.cleanup(); }
  });
}

test('R3 next revision growing beyond the bound is refused before temp creation and publication', () => {
  const fx = freshStore();
  try {
    const r = fx.store.create(sizedInput(262144));
    assert.throws(() => fx.store.setStatus(r.pendingId, 1, 'INTERRUPTED'), code('WRITE_FAILED'));
    assert.deepEqual(fs.readdirSync(path.join(fx.root, 'records', r.pendingId)), ['0000000001.json']);
    assert.deepEqual(fx.store.get(r.pendingId), r);
  } finally { fx.cleanup(); }
});

// Each child uses the actual store and real files. A pipe barrier fixes the publication interleaving without timing guesses.
function processClaim(root, n = 1, mode = 'barrier', revokeId = null) {
  const fixtureUrl = new URL('./helpers/pendingFixture.mjs', import.meta.url).href;
  const script = `import fs from 'node:fs';
    import { PendingActionStore } from ${JSON.stringify(STORE_URL)};
    import { pendingInput } from ${JSON.stringify(fixtureUrl)};
    const mode = ${JSON.stringify(mode)};
    const gate = (label = 'READY') => { process.stdout.write(label + '\\n'); const byte = Buffer.alloc(1); if (fs.readSync(0, byte, 0, 1, null) !== 1) process.exit(78); };
    const beforePublish = (b) => {
      if (String(b).endsWith('.open') || (mode === 'revoke' && String(b).endsWith('0000000002.json'))) {
        if (mode === 'crash-before') process.exit(77);
        if (mode === 'barrier' || mode === 'revoke') gate();
      }
    };
    const io = { ...fs, constants: fs.constants,
      readdirSync: (p) => { const names = fs.readdirSync(p); if (mode === 'barrier' && String(p).endsWith('/tasks')) gate('SNAPSHOT'); return names; },
      mkdirSync: (p, o) => { if (mode === 'crash-after' && String(p).includes('/records/PND-')) process.exit(77); return fs.mkdirSync(p, o); },
      linkSync: (a, b) => { beforePublish(b); return fs.linkSync(a, b); },
      renameSync: (a, b) => { beforePublish(b); return fs.renameSync(a, b); }
    };
    const s = new PendingActionStore({ root: ${JSON.stringify(root)}, fsImpl: io, now: () => '2026-01-01T00:00:30.000Z' });
    try {
      const r = ${revokeId ? `s.setStatus(${JSON.stringify(revokeId)}, 1, 'REVOKED')` : `s.create(pendingInput(${n}))`};
      process.stdout.write('OK:' + r.pendingId + '\\n');
    } catch(e) {
      if (!(e instanceof Error) || !e.code) throw e;
      process.stdout.write('ERR:' + e.code + '\\n');
    }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let stderr = ''; let readyResolve; let readyReject; let snapshotResolve; let snapshotReject;
  const snapshot = new Promise((resolve, reject) => { snapshotResolve = resolve; snapshotReject = reject; });
  // A rejected snapshot is observed even for modes without a snapshot barrier.
  snapshot.catch(() => {});
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => { child.kill('SIGKILL'); readyReject(new Error('child barrier timeout')); snapshotReject(new Error('child snapshot timeout')); }, 15000);
  child.stdout.on('data', (d) => { output += d; if (output.includes('READY\n')) readyResolve(); if (output.includes('SNAPSHOT\n')) snapshotResolve(); });
  child.stderr.on('data', (d) => { stderr += d; });
  const done = new Promise((resolve, reject) => {
    child.on('error', (e) => { clearTimeout(timer); readyReject(e); snapshotReject(e); reject(e); });
    child.on('close', (status, signal) => { clearTimeout(timer); if (mode === 'barrier' && !output.includes('READY\n')) readyReject(new Error('child exited before publication barrier')); else readyResolve(); if (mode === 'barrier' && !output.includes('SNAPSHOT\n')) snapshotReject(new Error('child exited before history snapshot barrier')); else snapshotResolve(); resolve({ output, stderr, status, signal }); });
  });
  return { ready, snapshot, continueSnapshot: () => child.stdin.write('x'), done, release: () => child.stdin.end('x'), kill: () => child.kill('SIGKILL') };
}

for (const terminal of [null, 'REVOKED', 'SUPERSEDED']) {
  test(`R1 independent OS processes claim the same generation from ${terminal ?? 'empty history'} exactly once`, async () => {
    const fx = freshStore(); let children = [];
    try {
      if (terminal) { const old = idOf(fx.store); fx.store.setStatus(old.pendingId, 1, terminal); }
      children = [processClaim(fx.root), processClaim(fx.root)];
      await Promise.all(children.map((c) => c.snapshot)); children.forEach((c) => c.continueSnapshot());
      await Promise.all(children.map((c) => c.ready));
      children.forEach((c) => c.release());
      const outcomes = await Promise.all(children.map((c) => c.done));
      for (const r of outcomes) { assert.equal(r.status, 0, r.stderr); assert.equal(r.signal, null); assert.equal(r.stderr, ''); }
      assert.equal(outcomes.filter((r) => /OK:PND-/.test(r.output)).length, 1, JSON.stringify(outcomes));
      assert.equal(outcomes.filter((r) => /ERR:TASK_ALREADY_PENDING/.test(r.output)).length, 1, JSON.stringify(outcomes));
      assert.equal(fx.store.getByTask(taskId(1)).status, 'OPEN');
      assert.equal(fs.readdirSync(path.join(fx.root, 'tasks')).length, terminal ? 2 : 1);
    } finally { children.forEach((c) => c.kill()); fx.cleanup(); }
  });
}

test('R1 revoke versus create: uncommitted revoke blocks; published revoke allows exactly one later claim', async () => {
  const fx = freshStore(); let child;
  try {
    const old = idOf(fx.store);
    child = processClaim(fx.root, 1, 'revoke', old.pendingId);
    await child.ready;
    assert.throws(() => idOf(fx.store), code('TASK_ALREADY_PENDING'));
    child.release();
    const result = await child.done;
    assert.equal(result.status, 0, result.stderr); assert.match(result.output, /OK:/);
    const next = idOf(fx.store);
    assert.notEqual(next.pendingId, old.pendingId);
    assert.throws(() => idOf(fx.store), code('TASK_ALREADY_PENDING'));
  } finally { child?.kill(); fx.cleanup(); }
});

for (const mode of ['crash-before', 'crash-after']) {
  test(`R1 process ${mode} marker publication leaves interrupted history that fails closed`, async () => {
    const fx = freshStore();
    try {
      const child = processClaim(fx.root, 1, mode); const outcome = await child.done;
      assert.equal(outcome.status, 77, outcome.stderr);
      assert.equal(fs.readdirSync(path.join(fx.root, 'records')).length, 0);
      assert.equal(fs.readdirSync(path.join(fx.root, 'tasks')).length, 1);
      assert.throws(() => idOf(fx.store), code('TASK_ALREADY_PENDING'));
      assert.throws(() => fx.store.getByTask(taskId(1)), code('RECORD_CORRUPT'));
    } finally { fx.cleanup(); }
  });
}

test('R1 different tasks pass independent process barriers within the same project', async () => {
  const fx = freshStore(); let children = [];
  try {
    children = [processClaim(fx.root, 1), processClaim(fx.root, 2)];
    await Promise.all(children.map((c) => c.snapshot)); children.forEach((c) => c.continueSnapshot());
    await Promise.all(children.map((c) => c.ready)); children.forEach((c) => c.release());
    for (const r of await Promise.all(children.map((c) => c.done))) { assert.equal(r.status, 0, r.stderr); assert.match(r.output, /OK:/); }
    assert.equal(fx.store.getByTask(taskId(1)).status, 'OPEN');
    assert.equal(fx.store.getByTask(taskId(2)).status, 'OPEN');
  } finally { children.forEach((c) => c.kill()); fx.cleanup(); }
});

for (const invalid of ['legacy', 'gap', 'duplicate-id', 'bad-generation', 'nonterminal-predecessor', 'UNKNOWN']) {
  test(`R1 strict marker history rejects ${invalid}`, () => {
    const fx = freshStore();
    try {
      const a = idOf(fx.store);
      const first = markerPath(fx.root); const marker = JSON.parse(fs.readFileSync(first));
      if (invalid === 'legacy') fs.renameSync(first, path.join(fx.root, 'tasks', `${taskId(1)}.open`));
      if (invalid === 'gap') fs.renameSync(first, markerPath(fx.root, 1, 2));
      if (invalid === 'duplicate-id') {
        fx.store.setStatus(a.pendingId, 1, 'REVOKED');
        fs.writeFileSync(markerPath(fx.root, 1, 2), JSON.stringify({ ...marker, generation: 2 }), { mode: 0o600 });
      }
      if (invalid === 'bad-generation') fs.writeFileSync(first, JSON.stringify({ ...marker, generation: 2 }), { mode: 0o600 });
      if (invalid === 'nonterminal-predecessor') {
        const input = pendingInput(1); const id = `PND-${'f'.repeat(32)}`;
        fs.mkdirSync(path.join(fx.root, 'records', id), { mode: 0o700 });
        fs.writeFileSync(revisionFile(fx.root, id, 1), JSON.stringify(buildInitialRecord(input, { pendingId: id, now: a.createdAt })), { mode: 0o600 });
        fs.writeFileSync(markerPath(fx.root, 1, 2), JSON.stringify({ ...marker, generation: 2, pendingId: id }), { mode: 0o600 });
      }
      if (invalid === 'UNKNOWN') {
        const r = readRev(fx.root, a.pendingId, 1); r.status = 'UNKNOWN';
        fs.writeFileSync(revisionFile(fx.root, a.pendingId, 1), JSON.stringify(r), { mode: 0o600 });
      }
      assert.throws(() => fx.store.getByTask(taskId(1)), code('RECORD_CORRUPT'));
      assert.throws(() => idOf(fx.store), code('TASK_ALREADY_PENDING'));
    } finally { fx.cleanup(); }
  });
}

test('directory canonical check catches an ancestor replacement after constructor preflight', () => {
  const dir = tempRoot();
  const ancestor = path.join(dir.base, 'ancestor'); const moved = path.join(dir.base, 'moved');
  fs.mkdirSync(ancestor, { mode: 0o700 }); let swapped = false;
  const root = path.join(ancestor, 'pending');
  const io = { ...fs, constants: fs.constants, realpathSync: (p) => {
    const canonical = fs.realpathSync(p);
    if (!swapped && p === ancestor) { swapped = true; fs.renameSync(ancestor, moved); fs.symlinkSync(moved, ancestor); }
    return canonical;
  } };
  try { assert.throws(() => new PendingActionStore({ root, fsImpl: io }), code('STORE_PATH')); }
  finally { dir.cleanup(); }
});
