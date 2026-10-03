import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../server/tasks/taskStore.mjs';
import { ExecutionStore } from '../server/tasks/executionStore.mjs';
import { assertTaskTransition } from '../server/tasks/stateTransitions.mjs';
import { AGENTS, validateAgentRun, unavailableUsage } from '../server/tasks/types.mjs';

const taskId = 'CC-20261003-12345678';
const runId = 'RUN-20261003-12345678';
const draft = () => ({ taskId, projectId: 'demo', workstream: 'general', title: 'Fix', goal: 'Fixture', agent: 'codex', executionProfile: 'STANDARD', risk: 'LOW', allowedActions: ['READ_REPO'], baseBranch: 'main', baseSha: null, status: 'DRAFT', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', runIds: [], review: { decision: 'PENDING', decidedAt: null, note: null } });
const run = () => ({ runId, taskId, agent: 'fake', adapterVersion: '1', status: 'RUNNING', startedAt: '2026-10-03T00:00:00.000Z', usage: unavailableUsage() });
const evidence = (id = 'ev-1') => ({ evidenceId: id, taskId, runId, kind: 'agent_report', grade: 'RUNTIME_OBSERVED', data: { message: 'Tests passed — untrusted' }, observedAt: '2026-10-03T00:00:00.000Z' });
async function scratch(fn) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p2-store-')); try { await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }

test('transitions: canonical flow is legal and terminal states never resume', () => {
  for (const [from, to] of [['DRAFT','QUEUED'],['QUEUED','STARTING'],['STARTING','RUNNING'],['RUNNING','VERIFYING'],['VERIFYING','COMPLETED'],['DRAFT','BLOCKED'],['VERIFYING','FAILED'],['RUNNING','UNKNOWN']]) assert.doesNotThrow(() => assertTaskTransition(from, to));
  for (const [from, to] of [['DRAFT','COMPLETED'],['FAILED','RUNNING'],['COMPLETED','RUNNING'],['UNKNOWN','QUEUED'],['BOGUS','RUNNING']]) assert.throws(() => assertTaskTransition(from, to), /transition/);
});

test('task update: identity and request authority are immutable; illegal transitions preserve original bytes', async () => scratch((dir) => {
  const store = new TaskStore({ dir }); store.create(draft());
  const file = path.join(dir, `${taskId}.json`); const before = fs.readFileSync(file);
  for (const patch of [{taskId:'CC-20261003-87654321'}, {projectId:'other'}, {allowedActions:['MERGE']}, {review:{decision:'APPROVED'}}, {status:'COMPLETED'}, {cwd:'/etc'}]) {
    assert.throws(() => store.update(taskId, patch)); assert.deepEqual(fs.readFileSync(file), before);
  }
  store.update(taskId, {status:'QUEUED',baseSha:'a'.repeat(40)});
  assert.equal(store.get(taskId).status, 'QUEUED'); assert.equal(store.get(taskId).baseSha, 'a'.repeat(40));
}));

test('task update: validates full result and preserves target on a failed partial write', async () => scratch((dir) => {
  new TaskStore({dir}).create(draft()); const file = path.join(dir, `${taskId}.json`); const before = fs.readFileSync(file);
  let calls=0;
  const fsImpl={...fs, writeSync(fd,b,offset,length){if(calls++)throw new Error('partial failure'); return fs.writeSync(fd,b,offset,Math.min(7,length));}};
  const store=new TaskStore({dir,fsImpl});
  assert.throws(() => store.update(taskId,{status:'QUEUED'}), /partial failure/);
  assert.deepEqual(fs.readFileSync(file),before); assert.deepEqual(store.get(taskId),draft());
  assert.deepEqual(fs.readdirSync(dir),[`${taskId}.json`]);
  assert.throws(() => store.update(taskId,{baseSha:'bad'}), /invalid/);
}));

test('fake run: internal identity is valid, browser AGENTS stays unchanged, unavailable cost stays null', async () => scratch((dir) => {
  assert.deepEqual(AGENTS,['claude-code','codex']); assert.deepEqual(validateAgentRun(run()),[]);
  const store=new ExecutionStore({dir}); store.saveRun(run());
  assert.equal(store.getRun(runId).agent,'fake'); assert.equal(store.getRun(runId).usage.costUsd,null);
  assert.throws(()=>store.saveRun({...run(),usage:{tokens:null,costUsd:0,grade:'UNAVAILABLE'}}),/invalid/i);
}));

test('run restart: persisted active fake run becomes UNKNOWN without inferred completion', async () => scratch((dir) => {
  const store=new ExecutionStore({dir}); store.saveRun(run());
  const reopened=new ExecutionStore({dir}); assert.equal(reopened.getRun(runId).status,'UNKNOWN');
  assert.equal(new ExecutionStore({dir}).getRun(runId).status,'UNKNOWN');
}));

test('evidence: append-only records preserve grades, reject duplicates and invalid task/run associations', async () => scratch((dir) => {
  const store=new ExecutionStore({dir}); store.saveRun(run()); store.appendEvidence(evidence());
  store.appendEvidence({...evidence('ev-2'),kind:'command_result',grade:'LOCALLY_VERIFIED',data:{command:'node',args:['check.mjs'],exitCode:1,durationMs:3}});
  assert.deepEqual(new ExecutionStore({dir}).listEvidence(taskId).map(e=>e.grade),['RUNTIME_OBSERVED','LOCALLY_VERIFIED']);
  assert.throws(()=>store.appendEvidence(evidence()),/duplicate/i);
  assert.throws(()=>store.appendEvidence({...evidence('bad'),taskId:'CC-20261003-87654321'}),/association/i);
  assert.throws(()=>store.appendEvidence({...evidence('bad'),grade:'PASS'}),/invalid/i);
  assert.throws(()=>store.listEvidence('../../outside'),/taskId/);
}));

test('evidence: partial-write append failure leaves prior JSONL byte-identical', async () => scratch((dir) => {
  const store=new ExecutionStore({dir}); store.saveRun({...run(),status:'FINISHED'}); store.appendEvidence(evidence());
  const file=path.join(dir,`${taskId}.events.jsonl`); const before=fs.readFileSync(file); let calls=0;
  const fsImpl={...fs,writeSync(fd,b,offset,length){if(calls++)throw new Error('append failed');return fs.writeSync(fd,b,offset,Math.min(7,length));}};
  const failing=new ExecutionStore({dir,fsImpl});
  assert.throws(()=>failing.appendEvidence(evidence('ev-2')),/append failed/);
  assert.deepEqual(fs.readFileSync(file),before); assert.equal(store.listEvidence(taskId).length,1);
  assert.ok(!fs.readdirSync(dir).some(n=>n.includes('.tmp-')));
}));
