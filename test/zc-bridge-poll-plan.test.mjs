import test from 'node:test';
import assert from 'node:assert/strict';
import {planReadOnlyPoll} from '../tools/zc-bridge/poll-plan.mjs';
import {TASK_MARKER,BRIDGE_REPO,BRIDGE_REPO_ID} from '../tools/zc-bridge/task-queue.mjs';

const repository=()=>({id:BRIDGE_REPO_ID,full_name:BRIDGE_REPO,html_url:`https://github.com/${BRIDGE_REPO}`});
const task=id=>({
  schema:'zc.task/v1',taskId:id,repositoryId:BRIDGE_REPO_ID,repository:BRIDGE_REPO,
  baseSha:'b'.repeat(40),goal:'Verify a small isolated safe test fixture change',
  paths:['test/zc-example.test.mjs'],verificationSuite:'node22-offline-tests',
  limits:{maxMinutes:8,maxTurns:2,maxRetries:0}
});
const issue=(number,body)=>({
  number,state:'open',body,
  html_url:`https://github.com/${BRIDGE_REPO}/issues/${number}`,
  repository:{id:BRIDGE_REPO_ID,full_name:BRIDGE_REPO}
});
const body=t=>TASK_MARKER+'\n```json\n'+JSON.stringify(t)+'\n```';
const pages=items=>[{page:1,items,hasNext:false}];
const run=items=>planReadOnlyPoll({repository:repository(),pages:pages(items)});
test('actual G0 #116 marker is never executable task data',()=>{
  const p=run([issue(116,'<!-- zc.connection-probe/v1 -->\nTask schema: NONE\nExecution grant: NONE')]);
  assert.equal(p.gate,'READ_ONLY');assert.equal(p.scannedIssues,1);
  assert.equal(p.taskCandidates,0);assert.deepEqual(p.queue.items,[]);
  assert.equal(p.dispatch,'HOLD');assert.equal(p.worker,'NOT_CONNECTED');
  assert.equal(p.modelCalls,0);assert.equal(p.gitHubWrites,0);
});
test('well-formed candidate is only pending trusted grant',()=>{
  const p=run([issue(120,body(task('zc-safe-task-20')))]);
  assert.equal(p.gate,'READ_ONLY');assert.equal(p.taskCandidates,1);
  assert.equal(p.queue.items[0].disposition,'PENDING_TRUSTED_GRANT');
  assert.equal(p.queue.items[0].readyToCode,false);
  assert.equal(p.readyToCode,false);
  assert.equal(p.source,'UNVERIFIED_API_SNAPSHOT');
});
test('wrong repository and URL cannot be polled',()=>{
  for(const mutate of [
    x=>x.id=9,x=>x.full_name='other/repo',
    x=>x.html_url='https://evil.example/repo'
  ]){
    const r=repository();mutate(r);
    assert.equal(planReadOnlyPoll({repository:r,pages:pages([])}).reason,'REPOSITORY_IDENTITY_INVALID');
  }
});
test('incomplete pagination is a hard hold, not successful empty queue',()=>{
  for(const p of [
    [],[{page:1,hasNext:true,items:[]}],
    [{page:1,hasNext:true,items:[issue(116,'ordinary issue')]}],
    [{page:2,hasNext:false,items:[]}],
    [{page:1,hasNext:false,items:[]},{page:2,hasNext:false,items:[]}],
    Array.from({length:4},(_,i)=>({page:i+1,hasNext:i<3,items:[]}))
  ]){
    const x=planReadOnlyPoll({repository:repository(),pages:p});
    assert.equal(x.gate,'HOLD');
  }
});
test('complete two-page queue gathers candidates and excludes normal Issues',()=>{
  const r=planReadOnlyPoll({repository:repository(),pages:[
    {page:1,hasNext:true,items:[issue(120,body(task('zc-safe-task-20'))),issue(116,'probe')]},
    {page:2,hasNext:false,items:[issue(119,body(task('zc-safe-task-19')))]}
  ]});
  assert.equal(r.gate,'READ_ONLY');assert.equal(r.scannedIssues,3);
  assert.equal(r.taskCandidates,2);
  assert.deepEqual(r.queue.items.map(x=>x.issueNumber),[119,120]);
  assert.equal(r.dispatch,'HOLD');
});
test('duplicate number across pages is rejected even if data differs',()=>{
  const i=issue(120,body(task('zc-safe-task-20')));
  const r=planReadOnlyPoll({repository:repository(),pages:[
    {page:1,hasNext:true,items:[i]},
    {page:2,hasNext:false,items:[{...i,body:'ordinary text'}]}
  ]});
  assert.equal(r.reason,'ISSUE_SOURCE_OR_DUPLICATE_INVALID');
});
test('source spoofing via issue URL and repo identity fails closed',()=>{
  for(const mutate of [
    x=>x.repository.id=42,x=>x.repository.full_name='other/repo',
    x=>x.html_url=`https://github.com/${BRIDGE_REPO}/issues/1200`
  ]){
    const i=issue(120,body(task('zc-safe-task-20')));mutate(i);
    assert.equal(run([i]).reason,'ISSUE_SOURCE_OR_DUPLICATE_INVALID');
  }
});
test('invalid marked Issue is still examined, never discarded silently',()=>{
  const r=run([issue(120,TASK_MARKER+'\nmalicious --dangerously-skip-permissions')]);
  assert.equal(r.taskCandidates,1);
  assert.equal(r.queue.items[0].disposition,'HOLD');
  assert.equal(r.readyToCode,false);
});
test('poll output never returns Issue body or an auth token',()=>{
  const r=run([issue(116,'not-a-task\nTOKEN_SECRET_VALUE')]);
  assert.ok(!JSON.stringify(r).includes('TOKEN_SECRET_VALUE'));
});
test('page maximum and malformed data are rejected',()=>{
  const items=Array.from({length:21},(_,i)=>issue(i+1,'test'));
  const r=run(items);
  assert.equal(r.reason,'PAGINATION_INCOMPLETE_OR_MALFORMED');
});
