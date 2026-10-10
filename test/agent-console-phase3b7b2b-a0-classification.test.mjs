import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { classifyExecutions as classifyRaw, CLASSIFICATIONS } from '../server/execution/identity/recoveryClassifier.mjs';
import { OTHER_DIGEST, cid, container, planned, runId, freshJournal, openJournal, tempRoot } from './helpers/identityFixture.mjs';

// OFFLINE ONLY: classification over fake Docker data. No daemon is contacted; nothing is adopted, stopped or removed.

const input = (fx, containers, extra = {}) => { const s = fx.journal.scan(); return { records: s.records, corrupt: s.corrupt, containers, listingComplete: true, ...extra }; };
const one = (result, pred) => { const hit = result.entries.filter(pred); assert.equal(hit.length, 1, JSON.stringify(result.entries)); return hit[0]; };
const classifyExecutions = (evidence) => {
  let result;
  assert.doesNotThrow(() => { result = classifyRaw(evidence); }, 'malformed evidence must be classified, never crash the caller');
  return result;
};

function created(journal, n, ch) {
  const a = journal.createPlanned(planned(n));
  return journal.transition(runId(n), a.revision, 'CREATED', { containerId: cid(ch) });
}

test('KNOWN: exact id, name, labels and image digest agree; the interrupted execution is still UNKNOWN and needs reporting', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const result = classifyExecutions(input(fx, [container(r)]));
    const e = one(result, (x) => x.containerId === cid('c'));
    assert.equal(e.classification, 'KNOWN');
    assert.equal(e.executionOutcome, 'UNKNOWN');
    assert.equal(e.runId, runId(1));
    assert.equal(e.recommendedAction, 'REPORT_TO_OPERATOR');
    assert.equal(e.eligibleForVerifiedAdoption, true);
    assert.equal(result.autoCleanup, false);
    assert.equal(result.blocked, false);
  } finally { fx.cleanup(); }
});

test('ORPHAN: ownership labels but no journal record at all is reported, never cleaned up', () => {
  const fx = freshJournal();
  try {
    const stray = { id: cid('e'), name: 'cc-sandbox-agent-run-20260101-0000ffff', labels: { 'cc.sandbox': '1', 'cc.sandbox.id': 'run-20260101-0000ffff', 'cc.sandbox.role': 'agent' }, imageDigest: OTHER_DIGEST };
    const result = classifyExecutions(input(fx, [stray]));
    const e = one(result, (x) => x.containerId === cid('e'));
    assert.equal(e.classification, 'ORPHAN');
    assert.equal(e.operatorIntervention, true);
    assert.equal(e.eligibleForVerifiedAdoption, false);
    assert.equal(e.recommendedAction, 'REPORT_TO_OPERATOR');
    assert.equal(result.autoCleanup, false);
  } finally { fx.cleanup(); }
});

test('MISSING: a recorded container absent from a COMPLETE listing; only a DESTROYED record is SETTLED', () => {
  const fx = freshJournal();
  try {
    const a = created(fx.journal, 1, 'c');
    const b = created(fx.journal, 2, 'd');
    fx.journal.transition(runId(2), b.revision, 'DESTROYED');
    fx.journal.createPlanned(planned(3));
    const result = classifyExecutions(input(fx, []));
    const running = one(result, (x) => x.runId === runId(1));
    assert.equal(running.classification, 'MISSING');
    assert.equal(running.executionOutcome, 'UNKNOWN');
    assert.equal(running.operatorIntervention, true);
    const gone = one(result, (x) => x.runId === runId(2));
    assert.equal(gone.classification, 'MISSING');
    assert.equal(gone.executionOutcome, 'SETTLED');
    assert.equal(gone.operatorIntervention, false);
    const planned3 = one(result, (x) => x.runId === runId(3));
    assert.equal(planned3.classification, 'MISSING', 'crash before docker create: nothing exists');
    assert.equal(planned3.executionOutcome, 'UNKNOWN');
    void a;
  } finally { fx.cleanup(); }
});

test('OTHER: containers that do not claim our ownership are not ours, not inspected, not reported as actionable', () => {
  const fx = freshJournal();
  try {
    const others = [
      { id: cid('1'), name: 'postgres', labels: {}, imageDigest: null },
      { id: cid('2'), name: 'web', labels: { app: 'x', 'com.docker.compose.project': 'p' }, imageDigest: OTHER_DIGEST },
    ];
    const result = classifyExecutions(input(fx, others));
    assert.deepEqual(result.entries.map((e) => e.classification), ['OTHER', 'OTHER']);
    assert.ok(result.entries.every((e) => e.operatorIntervention === false && e.recommendedAction === 'NONE' && e.eligibleForVerifiedAdoption === false));
  } finally { fx.cleanup(); }
});

test('label spoofing: a container with our exact labels, name and image but a different id is UNKNOWN, never KNOWN and never adoptable', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const spoof = container(r, { id: cid('f') });
    const result = classifyExecutions(input(fx, [spoof]));
    const e = one(result, (x) => x.containerId === cid('f'));
    assert.equal(e.classification, 'UNKNOWN');
    assert.equal(e.reason, 'CONTAINER_ID_MISMATCH_FOR_RECORD');
    assert.equal(e.eligibleForVerifiedAdoption, false);
    assert.equal(result.entries.some((x) => x.classification === 'KNOWN'), false);
    // the real container is absent in this listing; the record is accounted for by the spoof entry, not silently MISSING-and-clean
    assert.equal(result.entries.some((x) => x.classification === 'ORPHAN'), false, 'a lookalike is not an orphan to be cleaned');
  } finally { fx.cleanup(); }
});

test('label spoofing: right id but any wrong name, image or label is UNKNOWN', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const cases = {
      name: container(r, { name: 'cc-sandbox-agent-other' }),
      imageDigest: container(r, { imageDigest: OTHER_DIGEST }),
      imageMissing: container(r, { imageDigest: null }),
      'label:cc.sandbox.id': container(r, { labels: { ...r.labels, 'cc.sandbox.id': 'run-20260101-00000099' } }),
      'label:cc.sandbox.role': container(r, { labels: { ...r.labels, 'cc.sandbox.role': 'verifier' } }),
      'label:cc.sandbox': container(r, { labels: { ...r.labels, 'cc.sandbox': '0' } }),
    };
    for (const [field, c] of Object.entries(cases)) {
      const e = one(classifyExecutions(input(fx, [c])), (x) => x.containerId === cid('c'));
      assert.equal(e.classification, 'UNKNOWN', field);
      assert.match(e.reason, /^IDENTITY_MISMATCH:/, field);
      assert.equal(e.eligibleForVerifiedAdoption, false);
    }
  } finally { fx.cleanup(); }
});

test('crash after docker create but before the journal write: the container looks like the PLANNED record but is UNKNOWN, never adopted', () => {
  const fx = freshJournal();
  try {
    const p = fx.journal.createPlanned(planned(1));
    const live = { id: cid('9'), name: p.containerName, labels: { ...p.labels }, imageDigest: p.imageDigest };
    const result = classifyExecutions(input(fx, [live]));
    const e = one(result, (x) => x.containerId === cid('9'));
    assert.equal(e.classification, 'UNKNOWN');
    assert.equal(e.reason, 'CREATED_BEFORE_JOURNALED');
    assert.equal(e.operatorIntervention, true);
    assert.equal(e.eligibleForVerifiedAdoption, false);
    assert.equal(result.entries.filter((x) => x.runId === runId(1)).length, 1, 'the planned record is not additionally reported MISSING');
  } finally { fx.cleanup(); }
});

test('partial or odd ownership claims are UNKNOWN, not ORPHAN and not OTHER', () => {
  const fx = freshJournal();
  try {
    const odd = [
      { id: cid('1'), name: 'x', labels: { 'cc.sandbox': 'true' }, imageDigest: null },
      { id: cid('2'), name: 'y', labels: { 'cc.sandbox': '1' }, imageDigest: null },
      { id: cid('3'), name: 'cc-sandbox-agent-zzzzzz', labels: {}, imageDigest: null },
      { id: cid('4'), name: 'z', labels: { 'cc.sandbox.role': 'agent' }, imageDigest: null },
    ];
    const result = classifyExecutions(input(fx, odd));
    assert.deepEqual(result.entries.map((e) => e.classification), ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    assert.ok(result.entries.every((e) => e.operatorIntervention));
  } finally { fx.cleanup(); }
});

test('duplicates are ambiguous: the same container id or name listed twice, or two journal records naming one id, is UNKNOWN', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const twice = classifyExecutions(input(fx, [container(r), container(r)]));
    assert.equal(twice.blocked, true);
    assert.ok(twice.entries.every((e) => e.classification === 'UNKNOWN' && !e.eligibleForVerifiedAdoption));
    const sameId = classifyExecutions(input(fx, [container(r), container(r, { name: 'cc-sandbox-agent-run-20260101-00000abc' })]));
    assert.equal(sameId.blocked, true);
    assert.equal(sameId.entries.some((e) => e.classification === 'KNOWN'), false, 'one id listed under two names is ambiguous');
    assert.equal(sameId.entries.some((e) => e.classification === 'MISSING'), false);
    const sameName = classifyExecutions(input(fx, [container(r), container(r, { id: cid('b') })]));
    assert.equal(sameName.blocked, true);
    assert.equal(sameName.entries.some((e) => e.classification === 'KNOWN'), false);
    const r2 = { ...r, runId: runId(2), sandboxId: runId(2), containerName: 'cc-sandbox-agent-run-20260101-00000002', labels: { ...r.labels, 'cc.sandbox.id': runId(2) } };
    const dupRecords = classifyExecutions({ records: [r, r2], corrupt: [], containers: [container(r)], listingComplete: true });
    assert.equal(dupRecords.entries.some((e) => e.classification === 'KNOWN'), false);
    assert.equal(dupRecords.blocked, true);
    assert.ok(dupRecords.entries.every((e) => e.reason === 'INVALID_JOURNAL_SET'));
  } finally { fx.cleanup(); }
});

test('malformed container data or malformed records are UNKNOWN and never throw', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const garbage = [null, 5, 'x', [], {}, { id: 'short', name: 'a', labels: {} }, { id: cid('1'), name: '', labels: {} }, { id: cid('1'), name: 'a', labels: null }, { id: cid('1'), name: 'a', labels: { k: 5 } }, { id: cid('1'), name: 'a', labels: {}, imageDigest: 'busybox:latest' }];
    const result = classifyExecutions({ records: [r], corrupt: [], containers: garbage, listingComplete: true });
    assert.equal(result.entries.filter((e) => e.reason === 'MALFORMED_CONTAINER').length, garbage.length);
    const unreadable = classifyExecutions({ records: [r], corrupt: [], containers: [{ id: r.containerId, name: '', labels: {} }], listingComplete: true });
    assert.equal(unreadable.blocked, true);
    assert.ok(unreadable.entries.every((e) => e.classification === 'UNKNOWN'), 'a present-but-unreadable container is not an absent one');
    const bad = classifyExecutions({ records: [{ nope: true }, null, r], corrupt: [], containers: [container(r)], listingComplete: true });
    assert.equal(bad.entries.filter((e) => e.reason === 'INVALID_RECORD').length, 2);
    assert.equal(bad.blocked, true);
    assert.ok(bad.entries.every((e) => e.classification === 'UNKNOWN' && e.executionOutcome === 'UNKNOWN' && e.operatorIntervention && !e.eligibleForVerifiedAdoption));
  } finally { fx.cleanup(); }
});

test('an incomplete Docker listing blocks every claim: nothing is MISSING, ORPHAN, OTHER or KNOWN', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    for (const listingComplete of [false, undefined, null, 'true', 1]) {
      const result = classifyExecutions({ records: [r], corrupt: [], containers: [container(r), { id: cid('1'), name: 'x', labels: {}, imageDigest: null }], listingComplete });
      assert.equal(result.blocked, true);
      assert.ok(result.entries.every((e) => e.classification === 'UNKNOWN' && e.reason === 'DOCKER_LISTING_INCOMPLETE'), String(listingComplete));
    }
    const noArrays = classifyExecutions({ records: null, corrupt: [], containers: undefined, listingComplete: true });
    assert.equal(noArrays.blocked, true);
  } finally { fx.cleanup(); }
});

test('a corrupt journal blocks every claim and no container is classified as safe', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    fs.writeFileSync(`${fx.root}/records/${runId(1)}.json.junk`, 'x', { mode: 0o600 });
    const result = classifyExecutions(input(fx, [container(r)]));
    assert.equal(result.blocked, true);
    assert.ok(result.entries.every((e) => e.classification === 'UNKNOWN' && e.reason === 'JOURNAL_CORRUPT'));
    assert.equal(result.entries.length, 2);
  } finally { fx.cleanup(); }
});

test('DESTROYED record but the container is still present is inconsistent: UNKNOWN, not KNOWN, not adoptable', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const d = fx.journal.transition(runId(1), r.revision, 'DESTROYED');
    const e = one(classifyExecutions(input(fx, [container(d)])), (x) => x.containerId === cid('c'));
    assert.equal(e.classification, 'UNKNOWN');
    assert.equal(e.reason, 'DESTROYED_RECORD_BUT_CONTAINER_PRESENT');
    assert.equal(e.eligibleForVerifiedAdoption, false);
  } finally { fx.cleanup(); }
});

test('restart classification over the real journal: crash points mapped to outcomes', () => {
  const dir = tempRoot();
  try {
    const before = openJournal(dir.root, { pid: 1, hostname: 'h' });
    // 1 crash while planned (before docker create)   2 crash after journal write, before start   3 crash while running
    // 4 crash during stop                              5 clean DESTROYED
    before.createPlanned(planned(1));
    created(before, 2, 'a');
    const r3 = created(before, 3, 'b'); const auth3 = before.authorizeStart(runId(3), r3.revision);
    before.transition(runId(3), auth3.revision, 'RUNNING');
    const r4 = created(before, 4, 'd'); const auth4 = before.authorizeStart(runId(4), r4.revision);
    const run4 = before.transition(runId(4), auth4.revision, 'RUNNING');
    before.transition(runId(4), run4.revision, 'STOPPING');
    const r5 = created(before, 5, 'e'); before.transition(runId(5), r5.revision, 'DESTROYED');

    const after = openJournal(dir.root, { pid: 2, hostname: 'h', isProcessAlive: () => false });
    const { records, corrupt } = after.scan();
    const listing = records.filter((r) => ['2', '3', '4'].includes(String(Number(r.runId.slice(-8))))).map((r) => container(r));
    const result = classifyExecutions({ records, corrupt, containers: [...listing, { id: cid('9'), name: 'unrelated', labels: {}, imageDigest: null }], listingComplete: true });
    const by = (n) => result.entries.find((e) => e.runId === runId(n));
    assert.equal(by(1).classification, 'MISSING'); assert.equal(by(1).executionOutcome, 'UNKNOWN');
    for (const n of [2, 3, 4]) { assert.equal(by(n).classification, 'KNOWN', `run ${n}`); assert.equal(by(n).executionOutcome, 'UNKNOWN'); }
    assert.equal(by(5).executionOutcome, 'SETTLED');
    assert.equal(result.entries.find((e) => e.containerId === cid('9')).classification, 'OTHER');
    assert.equal(result.summary.KNOWN, 3);
    after.close();
  } finally { dir.cleanup(); }
});

test('the result is frozen, offers no removal action and never claims auto cleanup', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const stray = { id: cid('e'), name: 'cc-sandbox-agent-run-20260101-0000ffff', labels: { 'cc.sandbox': '1', 'cc.sandbox.id': 'run-20260101-0000ffff', 'cc.sandbox.role': 'agent' }, imageDigest: null };
    const result = classifyExecutions(input(fx, [container(r), stray, { id: cid('1'), name: 'x', labels: {}, imageDigest: null }]));
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.entries) && result.entries.every(Object.isFrozen));
    assert.equal(result.autoCleanup, false);
    const allowed = ['NONE', 'REPORT_TO_OPERATOR', 'OPERATOR_REVIEW'];
    assert.ok(result.entries.every((e) => allowed.includes(e.recommendedAction)));
    assert.deepEqual(Object.keys(result.summary), [...CLASSIFICATIONS]);
    assert.equal(Object.values(result.summary).reduce((a, b) => a + b, 0), result.entries.length);
    assert.throws(() => { result.autoCleanup = true; }, TypeError);
  } finally { fx.cleanup(); }
});

test('only KNOWN entries are ever eligible for verified adoption, and only with a recorded exact id', () => {
  const fx = freshJournal();
  try {
    const r = created(fx.journal, 1, 'c');
    const mixed = [container(r), container(r, { id: cid('f'), name: 'cc-sandbox-agent-run-20260101-00000001' })];
    const result = classifyExecutions(input(fx, mixed));
    for (const e of result.entries) assert.equal(e.eligibleForVerifiedAdoption, e.classification === 'KNOWN' && e.containerId === r.containerId);
  } finally { fx.cleanup(); }
});

test('R1 exact recorded ID present with changed ownership is never OTHER plus SETTLED', () => {
  const fx=freshJournal();
  try {
    let r=created(fx.journal,1,'c');r=fx.journal.transition(r.runId,r.revision,'DESTROYED');
    for(const over of [{name:'foreign'},{labels:{}},{labels:{...r.labels,'cc.sandbox':'0'}},{labels:{...r.labels,'cc.sandbox.role':'verifier'}},{imageDigest:OTHER_DIGEST}]){
      const result=classifyExecutions(input(fx,[container(r,over)]));
      assert.equal(result.entries.some(e=>e.executionOutcome==='SETTLED'||e.classification==='OTHER'),false);
      const e=result.entries.find(e=>e.runId===r.runId);
      assert.equal(e.classification,'UNKNOWN');assert.equal(e.executionOutcome,'UNKNOWN');assert.equal(e.operatorIntervention,true);assert.equal(e.eligibleForVerifiedAdoption,false);
    }
    const absent=classifyExecutions(input(fx,[]));assert.equal(absent.entries[0].reason,'DESTROYED_AND_ABSENT');assert.equal(absent.entries[0].executionOutcome,'SETTLED');
  } finally {fx.cleanup();}
});

test('R3 terminal UNKNOWN never becomes trusted or adoption eligible even with exact identity',()=>{
  const fx=freshJournal();try{
    let r=created(fx.journal,1,'c');r=fx.journal.transition(r.runId,r.revision,'UNKNOWN');
    for(const c of [container(r),container(r,{name:'foreign'})]){const result=classifyExecutions(input(fx,[c]));const e=result.entries.find(e=>e.runId===r.runId);assert.equal(e.classification,'UNKNOWN');assert.equal(e.executionOutcome,'UNKNOWN');assert.equal(e.operatorIntervention,true);assert.equal(e.eligibleForVerifiedAdoption,false);assert.equal(e.containerId,r.containerId);}
    assert.throws(()=>fx.journal.authorizeStart(r.runId,r.revision));
  }finally{fx.cleanup();}
});

test('global corrupt or ambiguous recovery input never yields KNOWN or SETTLED',()=>{
  const fx=freshJournal();try{
    const r=created(fx.journal,1,'c');const destroyed={...r,stage:'DESTROYED'};
    const cases=[{records:[r,null]},{records:[destroyed,{}],containers:[]},{corrupt:[{reason:'invalid'}]},{corrupt:null},{records:null},{containers:[container(r),{id:cid('e')}]},{containers:[container(r),container(r)]},{listingComplete:false}];
    for(const over of cases){const result=classifyExecutions({records:[r],corrupt:[],containers:[container(r)],listingComplete:true,...over});assert.equal(result.blocked,true);assert.equal(result.entries.some(e=>e.classification==='KNOWN'||e.executionOutcome==='SETTLED'||e.eligibleForVerifiedAdoption),false);}
  }finally{fx.cleanup();}
});

test('R2 classifier independently blocks all coherent-looking cross-record conflicts', () => {
  const fx = freshJournal();
  try {
    const a = created(fx.journal, 1, 'c');
    const b = created(fx.journal, 2, 'b');
    const changes = [
      { ...b, sandboxId: a.sandboxId, containerName: a.containerName, labels: { ...a.labels } },
      { ...b, containerId: a.containerId },
      { ...b, taskId: a.taskId, executionGeneration: 1 },
      { ...b, taskId: a.taskId, executionGeneration: 2 },
      { ...b, taskId: a.taskId, executionGeneration: 3 },
      { ...b, stateRootId: 'f'.repeat(32) },
    ];
    for (const conflicting of changes) {
      const result = classifyExecutions({ records: [a, conflicting], corrupt: [], containers: [container(a), container(conflicting)], listingComplete: true });
      assert.equal(result.blocked, true);
      assert.ok(result.entries.every(e => e.classification === 'UNKNOWN' && e.operatorIntervention && !e.eligibleForVerifiedAdoption));
    }
    const destroyed = fx.journal.transition(a.runId, a.revision, 'DESTROYED');
    const lawful = { ...b, taskId: a.taskId, executionGeneration: 2, createdAt: destroyed.updatedAt, updatedAt: destroyed.updatedAt };
    const clean = classifyExecutions({ records: [destroyed, lawful], corrupt: [], containers: [container(lawful)], listingComplete: true });
    assert.equal(clean.blocked, false);
    assert.equal(clean.entries.find(e => e.runId === a.runId).executionOutcome, 'SETTLED');
    assert.equal(clean.entries.find(e => e.runId === b.runId).classification, 'KNOWN');
    for (const invalid of [{ ...lawful, createdAt: a.createdAt }, { ...lawful, writerEpoch: lawful.writerEpoch + 1, executionGeneration: 4 }]) {
      const result = classifyExecutions({ records: [destroyed, invalid], corrupt: [], containers: [], listingComplete: true });
      assert.equal(result.blocked, true);
      assert.ok(result.entries.every(e => e.executionOutcome === 'UNKNOWN'));
    }
  } finally { fx.cleanup(); }
});

test('sparse arrays are incomplete malformed evidence, never proof of container absence', () => {
  const fx = freshJournal();
  try {
    const a = created(fx.journal, 1, 'c');
    const destroyed = fx.journal.transition(a.runId, a.revision, 'DESTROYED');
    for (const input of [{ records: [destroyed], containers: Array(1) }, { records: Array(1), containers: [] }]) {
      const result = classifyExecutions({ ...input, corrupt: [], listingComplete: true });
      assert.equal(result.blocked, true);
      assert.ok(result.entries.every(e => e.classification === 'UNKNOWN' && e.executionOutcome === 'UNKNOWN'));
    }
  } finally { fx.cleanup(); }
});
