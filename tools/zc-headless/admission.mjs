import {readFileSync, appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {TASK, EVIDENCE_REPO, EVIDENCE_REPO_ID, validateTask} from '../zc-pilot/contract.mjs';

// GitHub event admission only. This module NEVER claims a job or calls a model.
// Issue body, labels and author are task data, not execution authorization.
export const ADMISSION_SCHEMA='zc.admission/v1';
export const ADMISSION_LABEL='zc:headless-review';
const MAX_BODY=24*1024, MAX_EVENT=128*1024;
const safeNumber=x=>Number.isSafeInteger(x)&&x>0&&x<10000000;
const result=(disposition,reason,issue=null)=>({
  schema:ADMISSION_SCHEMA,source:'GITHUB_ISSUES_EVENT',disposition,reason,
  taskId:disposition==='HOLD_NOT_AUTHORIZED'?TASK.taskId:null,
  issueUrl:issue?('https://github.com/'+EVIDENCE_REPO+'/issues/'+issue):null,
  agent:'NOT_CONNECTED',dispatch:'HOLD',executionAuthorized:false,
  writes:0,modelCalls:0,readyForWorker:false
});

export function admitIssueEvent(event,{repository=EVIDENCE_REPO,eventName='issues'}={}){
  if(repository!==EVIDENCE_REPO||eventName!=='issues')return result('HOLD_INVALID_SOURCE','UNEXPECTED_EVENT_SOURCE');
  if(!event||typeof event!=='object'||Array.isArray(event))return result('HOLD_INVALID_SOURCE','MALFORMED_EVENT');
  if(!['opened','labeled','edited'].includes(event.action))return result('IGNORED','UNSUPPORTED_ACTION');
  const r=event.repository,issue=event.issue;
  if(!r||r.id!==EVIDENCE_REPO_ID||r.full_name!==EVIDENCE_REPO||
    r.html_url!=='https://github.com/'+EVIDENCE_REPO)
    return result('HOLD_INVALID_SOURCE','REPOSITORY_IDENTITY_MISMATCH');
  if(!issue||!safeNumber(issue.number)||issue.html_url!=='https://github.com/'+EVIDENCE_REPO+'/issues/'+issue.number||
    issue.pull_request||issue.state!=='open')
    return result('HOLD_INVALID_SOURCE','ISSUE_IDENTITY_MISMATCH');
  if(event.action==='labeled'&&event.label?.name!==ADMISSION_LABEL)return result('IGNORED','UNRELATED_LABEL');
  if(typeof issue.body!=='string'||!issue.body.includes('<!-- zc-task:'))return result('IGNORED','NOT_ZC_TASK');
  if(Buffer.byteLength(issue.body)>MAX_BODY)return result('HOLD_UNSUPPORTED_TASK','TASK_BODY_TOO_LARGE',issue.number);
  const marker='<!-- zc-task:'+TASK.idempotencyKey+' -->';
  const markers=issue.body.match(/<!-- zc-task:[^\n]* -->/g)??[];
  if(markers.length!==1||markers[0]!==marker)return result('HOLD_UNSUPPORTED_TASK','INVALID_TASK_MARKER',issue.number);
  const fence=String.fromCharCode(96).repeat(3);
  if(issue.body.split(fence).length!==3)return result('HOLD_UNSUPPORTED_TASK','INVALID_JSON_FENCE',issue.number);
  const start=fence+'json\n',end='\n'+fence;
  const startAt=issue.body.indexOf(start),endAt=issue.body.indexOf(end,startAt+start.length);
  if(startAt<0||endAt<0||endAt<=startAt||issue.body.indexOf(start,startAt+1)!==-1)
    return result('HOLD_UNSUPPORTED_TASK','INVALID_JSON_ENVELOPE',issue.number);
  let task;
  try{task=JSON.parse(issue.body.slice(startAt+start.length,endAt));}
  catch{return result('HOLD_UNSUPPORTED_TASK','INVALID_TASK_JSON',issue.number);}
  if(issue.title!==TASK.title||!validateTask(task))
    return result('HOLD_UNSUPPORTED_TASK','TASK_NOT_IN_ALLOWLIST',issue.number);
  // The original job was already delivered: another issue with identical task data is not a new authorization.
  if(issue.number!==107)return result('HOLD_UNSUPPORTED_TASK','DUPLICATE_OR_UNREGISTERED_TASK',issue.number);
  // The existing Pilot01 task intentionally says NOT_GRANTED.
  // A GitHub label, issue edit or Grok text can NEVER upgrade this authorization.
  return result('HOLD_NOT_AUTHORIZED','TRUSTED_EXECUTION_GRANT_REQUIRED',issue.number);
}

export function parseEventBytes(text,opts){
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_EVENT)
    return result('HOLD_INVALID_SOURCE','EVENT_TOO_LARGE_OR_MALFORMED');
  let event;try{event=JSON.parse(text);}catch{return result('HOLD_INVALID_SOURCE','INVALID_EVENT_JSON');}
  return admitIssueEvent(event,opts);
}

export function runGithubAdmission(env=process.env){
  let output;
  try{
    if(typeof env.GITHUB_EVENT_PATH!=='string'||!env.GITHUB_EVENT_PATH)
      throw Error('EVENT_PATH_MISSING');
    output=parseEventBytes(readFileSync(env.GITHUB_EVENT_PATH,'utf8'),{
      repository:env.GITHUB_REPOSITORY,eventName:env.GITHUB_EVENT_NAME
    });
  }catch{output=result('HOLD_INVALID_SOURCE','EVENT_UNAVAILABLE');}
  // Emit only bounded normalized data; never echo task/issue body, secret or prompt.
  if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,
    '### ZC Headless Admission (read-only)\n\n'+
    '- Disposition: **'+output.disposition+'**\n'+
    '- Reason: '+output.reason+'\n'+
    '- Agent: NOT_CONNECTED; dispatch HOLD; provider calls 0\n'+
    '- This is not a worker, QA approval, Merge or Deploy.\n');
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,'disposition='+output.disposition+'\n');
  return output;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const output=runGithubAdmission();
  process.stdout.write(JSON.stringify(output)+'\n');
  if(output.disposition==='HOLD_INVALID_SOURCE')process.exitCode=2;
}
