import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TASK,EVIDENCE_REPO,EVIDENCE_REPO_ID,issueBody} from '../tools/zc-pilot/contract.mjs';
import {admitIssueEvent,parseEventBytes,runGithubAdmission,ADMISSION_SCHEMA,ADMISSION_LABEL} from '../tools/zc-headless/admission.mjs';

function fixture(){
  return {action:'opened',repository:{id:EVIDENCE_REPO_ID,full_name:EVIDENCE_REPO,
    html_url:'https://github.com/'+EVIDENCE_REPO},issue:{
    number:107,html_url:'https://github.com/'+EVIDENCE_REPO+'/issues/107',
    title:TASK.title,body:issueBody(),state:'open'}};
}
const disposition=(event,opts)=>admitIssueEvent(event,opts).disposition;
const swapTask=(event,mutate)=>{
  const task=structuredClone(TASK);mutate(task);
  event.issue.body=event.issue.body.replace(JSON.stringify(TASK,null,2),JSON.stringify(task,null,2));
  return event;
};
test('one exact existing GitHub task becomes admitted data but never dispatch',()=>{
  const x=admitIssueEvent(fixture());
  assert.equal(x.schema,ADMISSION_SCHEMA);
  assert.equal(x.disposition,'HOLD_NOT_AUTHORIZED');
  assert.equal(x.reason,'TRUSTED_EXECUTION_GRANT_REQUIRED');
  assert.equal(x.taskId,TASK.taskId);
  assert.equal(x.issueUrl,'https://github.com/'+EVIDENCE_REPO+'/issues/107');
  assert.equal(x.agent,'NOT_CONNECTED');
  assert.equal(x.dispatch,'HOLD');
  assert.equal(x.executionAuthorized,false);
  assert.equal(x.readyForWorker,false);
  assert.equal(x.modelCalls,0);
  assert.equal(x.writes,0);
});
test('the same event is deterministically replay-safe, no side effects',()=>{
  const a=fixture();assert.deepEqual(admitIssueEvent(a),admitIssueEvent(a));
});
test('edited issue can be read again but does not grant execution',()=>{
  const x=fixture();x.action='edited';assert.equal(disposition(x),'HOLD_NOT_AUTHORIZED');
});
test('only designated label can drive a labeled event',()=>{
  const x=fixture();x.action='labeled';x.label={name:'random'};
  assert.equal(disposition(x),'IGNORED');
  x.label.name=ADMISSION_LABEL;assert.equal(disposition(x),'HOLD_NOT_AUTHORIZED');
});
test('non-ZC issues are ignored without parsing arbitrary prose',()=>{
  const x=fixture();x.issue.body='normal issue body';assert.equal(disposition(x),'IGNORED');
});
test('unsupported event action is ignored',()=>{
  const x=fixture();x.action='deleted';assert.equal(disposition(x),'IGNORED');
});
test('repository full name cannot be spoofed',()=>{
  const x=fixture();x.repository.full_name=EVIDENCE_REPO+'-lookalike';
  assert.equal(disposition(x),'HOLD_INVALID_SOURCE');
});
test('numeric repository ID remains authoritative',()=>{
  const x=fixture();x.repository.id++;
  assert.equal(disposition(x),'HOLD_INVALID_SOURCE');
});
test('canonical repository URL is checked',()=>{
  const x=fixture();x.repository.html_url='https://evil.example/owner/repo';
  assert.equal(disposition(x),'HOLD_INVALID_SOURCE');
});
test('environment repository mismatch fails closed',()=>{
  assert.equal(disposition(fixture(),{repository:'other/repo',eventName:'issues'}),'HOLD_INVALID_SOURCE');
});
test('environment event kind mismatch fails closed',()=>{
  assert.equal(disposition(fixture(),{repository:EVIDENCE_REPO,eventName:'pull_request'}),'HOLD_INVALID_SOURCE');
});
test('issue number cannot be an invalid integer or zero',()=>{
  for(const n of [0,-1,1.5,'107',NaN]){
    const x=fixture();x.issue.number=n;
    assert.equal(disposition(x),'HOLD_INVALID_SOURCE');
  }
});
test('pull requests cannot impersonate task issues',()=>{
  const x=fixture();x.issue.pull_request={url:'fake'};
  assert.equal(disposition(x),'HOLD_INVALID_SOURCE');
});
test('canonical issue link and state are checked',()=>{
  const x=fixture();x.issue.html_url+='?x=1';
  assert.equal(disposition(x),'HOLD_INVALID_SOURCE');
  const y=fixture();y.issue.state='closed';assert.equal(disposition(y),'HOLD_INVALID_SOURCE');
});
test('duplicate task markers are rejected',()=>{
  const x=fixture();x.issue.body+='\n<!-- zc-task:'+TASK.idempotencyKey+' -->';
  assert.equal(disposition(x),'HOLD_UNSUPPORTED_TASK');
});
test('wrong task marker cannot create an allowed task',()=>{
  const x=fixture();x.issue.body=x.issue.body.replace(TASK.idempotencyKey,'other-task');
  assert.equal(disposition(x),'HOLD_UNSUPPORTED_TASK');
});
test('extra JSON fences or malformed JSON are rejected',()=>{
  const x=fixture();x.issue.body+='\n'+String.fromCharCode(96).repeat(3)+'json\n{}\n'+String.fromCharCode(96).repeat(3);
  assert.equal(disposition(x),'HOLD_UNSUPPORTED_TASK');
  const y=fixture();y.issue.body=y.issue.body.replace(JSON.stringify(TASK,null,2),'not-json');
  assert.equal(disposition(y),'HOLD_UNSUPPORTED_TASK');
});
test('arbitrary file or command expansion is never treated as authorized',()=>{
  for(const mutate of [
    t=>t.scope.allowedFiles.push('.github/workflows/evil.yml'),
    t=>t.capabilities.push('native:arbitrary-shell'),
    t=>{t.executionAuthorization='GRANTED';},
    t=>{t.source='grok';},
    t=>{t.target.repository='attacker/repo';},
    t=>{t.maxFixAttempts=1000;}
  ])assert.equal(disposition(swapTask(fixture(),mutate)),'HOLD_UNSUPPORTED_TASK');
});
test('recreating the same task under a new issue number is never admitted',()=>{
  const x=fixture();x.issue.number=109;
  x.issue.html_url='https://github.com/'+EVIDENCE_REPO+'/issues/109';
  const out=admitIssueEvent(x);
  assert.equal(out.disposition,'HOLD_UNSUPPORTED_TASK');
  assert.equal(out.reason,'DUPLICATE_OR_UNREGISTERED_TASK');
});
test('changing title cannot impersonate approved fixed task',()=>{
  const x=fixture();x.issue.title='different';assert.equal(disposition(x),'HOLD_UNSUPPORTED_TASK');
});
test('oversized task body is rejected, never copied into output',()=>{
  const x=fixture();x.issue.body+='x'.repeat(24576);
  const output=admitIssueEvent(x);
  assert.equal(output.disposition,'HOLD_UNSUPPORTED_TASK');
  assert.ok(!JSON.stringify(output).includes('xxxx'));
});
test('malformed raw event is fail-closed',()=>{
  assert.equal(parseEventBytes('{').disposition,'HOLD_INVALID_SOURCE');
  assert.equal(parseEventBytes('a'.repeat(128*1024+1)).disposition,'HOLD_INVALID_SOURCE');
  assert.equal(parseEventBytes(JSON.stringify(fixture())).disposition,'HOLD_NOT_AUTHORIZED');
});
test('missing event path does not become success',()=>{
  assert.equal(runGithubAdmission({GITHUB_REPOSITORY:EVIDENCE_REPO,GITHUB_EVENT_NAME:'issues'}).disposition,'HOLD_INVALID_SOURCE');
});
test('real CLI-like read writes a bounded summary and machine disposition only',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'zc-headless-test-'));
  const eventFile=path.join(root,'event.json'),summary=path.join(root,'summary.md'),output=path.join(root,'output');
  writeFileSync(eventFile,JSON.stringify(fixture()));
  const x=runGithubAdmission({
    GITHUB_EVENT_PATH:eventFile,GITHUB_REPOSITORY:EVIDENCE_REPO,GITHUB_EVENT_NAME:'issues',
    GITHUB_STEP_SUMMARY:summary,GITHUB_OUTPUT:output
  });
  assert.equal(x.disposition,'HOLD_NOT_AUTHORIZED');
  assert.match(readFileSync(output,'utf8'),/^disposition=HOLD_NOT_AUTHORIZED\n$/);
  const txt=readFileSync(summary,'utf8');
  assert.match(txt,/dispatch HOLD/);
  assert.ok(!txt.includes(TASK.scope.goal));
});
