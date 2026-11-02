import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectReturnEvent} from '../tools/zc-bridge/grok-callback.mjs';
import {BRIDGE_REPO,BRIDGE_REPO_ID} from '../tools/zc-bridge/task-queue.mjs';

const repo=()=>({id:BRIDGE_REPO_ID,full_name:BRIDGE_REPO,html_url:`https://github.com/${BRIDGE_REPO}`});
const nested=()=>({id:BRIDGE_REPO_ID,full_name:BRIDGE_REPO});
const marker='<!-- zc.bridge-result/v1 task=zc-safe-pilot-02 issue=123 -->';
function fixture(eventKind='pr-opened'){
  const sha='b'.repeat(40);
  const input={
    eventKind,repository:repo(),pr:{
      number:333,state:'open',draft:true,
      html_url:`https://github.com/${BRIDGE_REPO}/pull/333`,
      base:{repo:nested(),ref:'zc/zc-pilot02d-offline-bridge'},
      head:{repo:nested(),sha},
      body:marker+'\nhttps://github.com/'+BRIDGE_REPO+'/issues/123'
    }
  };
  if(eventKind.startsWith('ci-'))
    input.ci={headSha:sha,prNumber:333,status:'completed',conclusion:eventKind==='ci-passed'?'success':'failure'};
  return input;
}
test('PR opened is a candidate wake-up only, not verified QA or notification',()=>{
  const d=inspectReturnEvent(fixture());
  assert.equal(d.reason,'CANDIDATE_FOR_GROK_REVIEW');
  assert.equal(d.disposition,'READ_ONLY_REVIEW_CANDIDATE');
  assert.equal(d.grokRoutine,'NOT_CONNECTED');
  assert.equal(d.gitHubReFetch,'REQUIRED');
  assert.equal(d.independentQA,'NOT_VERIFIED');
  assert.equal(d.userNotified,false);
  assert.equal(d.readyToMerge,false);
  assert.equal(d.readyToDeploy,false);
  assert.equal(d.dispatch,'HOLD');
  assert.equal(d.modelCalls,0);
  assert.equal(d.gitHubWrites,0);
  assert.match(d.wakeKey,/^[a-f0-9]{64}$/);
});
test('PR push generates same review stage for same SHA, different SHA changes wake key',()=>{
  const x=fixture(),a=inspectReturnEvent(x);
  const y=fixture('pr-pushed'),b=inspectReturnEvent(y);
  assert.equal(a.wakeKey,b.wakeKey);
  y.pr.head.sha='c'.repeat(40);
  assert.notEqual(inspectReturnEvent(y).wakeKey,a.wakeKey);
});
test('CI failure and subsequent success must both reach Grok for the same SHA',()=>{
  const success=inspectReturnEvent(fixture('ci-passed'));
  const failed=inspectReturnEvent(fixture('ci-failed'));
  assert.equal(success.reason,'CANDIDATE_FOR_GROK_REVIEW');
  assert.equal(failed.reason,'CANDIDATE_FOR_GROK_REVIEW');
  assert.notEqual(success.wakeKey,failed.wakeKey);
  assert.notEqual(success.wakeKey,inspectReturnEvent(fixture('pr-opened')).wakeKey);
  assert.equal(success.wakeKey,inspectReturnEvent(fixture('ci-passed')).wakeKey);
  assert.equal(failed.wakeKey,inspectReturnEvent(fixture('ci-failed')).wakeKey);
});
test('wrong event name, repo numeric identity and lookalike URL blocked',()=>{
  assert.equal(inspectReturnEvent(fixture('issue-opened')).reason,'UNSUPPORTED_EVENT_KIND');
  assert.equal(inspectReturnEvent(null).reason,'UNSUPPORTED_EVENT_KIND');
  for(const mutate of [
    x=>x.repository.id=1,
    x=>x.repository.full_name='other/repo',
    x=>x.repository.html_url='https://github.evil/'+BRIDGE_REPO
  ]){
    const x=fixture();mutate(x);
    assert.equal(inspectReturnEvent(x).reason,'REPOSITORY_IDENTITY_INVALID');
  }
});
test('source PR must be open Draft from same repo, matching canonical URL',()=>{
  for(const mutate of [
    x=>x.pr.state='closed',x=>x.pr.draft=false,
    x=>x.pr.number=0,
    x=>x.pr.html_url='https://github.evil/'+BRIDGE_REPO+'/pull/333',
    x=>x.pr.head.sha='bad',
    x=>x.pr.head.repo.id=4,x=>x.pr.base.repo.full_name='other/repo'
  ]){
    const x=fixture();mutate(x);
    assert.equal(inspectReturnEvent(x).reason,'PR_SOURCE_INVALID');
  }
});
test('missing, duplicate, spoofed or malformed PR markers blocked',()=>{
  for(const mutate of [
    x=>x.pr.body='A completely unmarked PR',
    x=>x.pr.body+= '\n'+marker,
    x=>x.pr.body=x.pr.body.replace('issue=123','issue=abc'),
    x=>x.pr.body=x.pr.body.replace('zc-safe-pilot-02','zc-../../../x'),
    x=>x.pr.body=x.pr.body.replace('/issues/123','/issues/124'),
    x=>x.pr.body='x'.repeat(17*1024)
  ]){
    const x=fixture();mutate(x);
    assert.equal(inspectReturnEvent(x).reason,'PR_MARKER_INVALID');
  }
});
test('similar issue URL with numeric suffix does not authenticate task linkage',()=>{
  const x=fixture();
  x.pr.body=x.pr.body.replace('/issues/123','/issues/1234');
  assert.equal(inspectReturnEvent(x).reason,'PR_MARKER_INVALID');
});
test('CI event must match PR exact SHA/number and successful terminal state',()=>{
  for(const mutate of [
    x=>x.ci.headSha='c'.repeat(40),
    x=>x.ci.prNumber=999,
    x=>x.ci.status='in_progress',
    x=>x.ci.conclusion='failure'
  ]){
    const x=fixture('ci-passed');mutate(x);
    assert.equal(inspectReturnEvent(x).reason,'CI_SHA_OR_TERMINAL_MISMATCH');
  }
});
test('forged CI payload on PR-opened cannot be used as quality evidence',()=>{
  const x=fixture();x.ci={headSha:x.pr.head.sha,conclusion:'success'};
  assert.equal(inspectReturnEvent(x).reason,'UNEXPECTED_CI_SNAPSHOT');
});
test('response never echoes untrusted PR body or arbitrary prompt text',()=>{
  const x=fixture();
  x.pr.body+='\nSECRET_PRIVATE_SUPPLIED_BY_ISSUE';
  const d=inspectReturnEvent(x);
  assert.ok(!JSON.stringify(d).includes('SECRET_PRIVATE_SUPPLIED_BY_ISSUE'));
});
