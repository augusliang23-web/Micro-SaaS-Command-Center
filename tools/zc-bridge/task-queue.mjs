import {createHash} from 'node:crypto';

// Offline, untrusted GitHub task DATA validation. Not a worker, authenticator,
// GitHub API client, signature verifier, or model dispatcher.
export const BRIDGE_REPO='augusliang23-web/Micro-SaaS-Command-Center';
export const BRIDGE_REPO_ID=1352468489;
export const TASK_MARKER='<!-- zc.bridge-task/v1 -->';
const SCHEMA='zc.bridge.admission/v1';
const MAX_BODY=16*1024;
const keysEqual=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
const isSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const validId=x=>typeof x==='string'&&/^zc-[a-z0-9]+(?:-[a-z0-9]+){1,7}$/.test(x)&&x.length<=72;
const isIssueNumber=x=>Number.isSafeInteger(x)&&x>0&&x<100000000;
const isSafePath=x=>typeof x==='string'&&x.length<180&&
  /^(?:tools|test|docs)\/[a-zA-Z0-9._/-]+$/.test(x)&&
  !x.split('/').some(s=>s==='.'||s==='..'||s===''||s.startsWith('.'))&&
  !x.includes('//')&&!x.includes('\\');
const digest=x=>createHash('sha256').update(x).digest('hex');
function decision(reason,issue=null,hash=null){
  return Object.freeze({
    schema:SCHEMA,reason,
    disposition:reason==='TASK_DATA_VALID'?'PENDING_TRUSTED_GRANT':'HOLD',
    issueNumber:issue,taskDigest:hash,
    taskAuthority:'UNTRUSTED_ISSUE_DATA',
    trustedGrant:'NOT_VERIFIED',identity:'NOT_ATTESTED',
    baseCommit:'NOT_VERIFIED',isolation:'UNVERIFIED',
    claim:'NOT_RESERVED',worker:'NOT_CONNECTED',
    dispatch:'HOLD',readyToCode:false,modelCalls:0,gitHubWrites:0
  });
}
export function inspectTaskIssue(issue,{repoId=BRIDGE_REPO_ID,repoName=BRIDGE_REPO}={}){
  if(repoId!==BRIDGE_REPO_ID||repoName!==BRIDGE_REPO)return decision('REPOSITORY_CONTEXT_MISMATCH');
  if(!issue||typeof issue!=='object'||Array.isArray(issue)||!isIssueNumber(issue.number)||
     issue.state!=='open'||issue.pull_request||
     issue.repository?.id!==BRIDGE_REPO_ID||
     issue.repository?.full_name!==BRIDGE_REPO||
     issue.html_url!==`https://github.com/${BRIDGE_REPO}/issues/${issue.number}`)
    return decision('ISSUE_IDENTITY_INVALID');
  const body=issue.body;
  if(typeof body!=='string'||Buffer.byteLength(body,'utf8')>MAX_BODY)
    return decision('TASK_BODY_INVALID',issue.number);
  // Whole-body structure is fixed to prevent shadow instructions and ambiguous
  // multiple JSON fences. No executable content is ever taken from issue prose.
  const prefix=TASK_MARKER+'\n'+ '```json\n';
  const suffix='\n```';
  const canonical=body.endsWith('\n')?body.slice(0,-1):body;
  if(!canonical.startsWith(prefix)||!canonical.endsWith(suffix)||canonical.split('```').length!==3)
    return decision('TASK_ENVELOPE_INVALID',issue.number);
  let task;
  try{task=JSON.parse(canonical.slice(prefix.length,-suffix.length));}
  catch{return decision('TASK_JSON_INVALID',issue.number);}
  const fields=['schema','taskId','repositoryId','repository','baseSha','goal','paths','verificationSuite','limits'];
  if(!keysEqual(task,fields)||task.schema!=='zc.task/v1'||!validId(task.taskId)||
     task.repositoryId!==BRIDGE_REPO_ID||task.repository!==BRIDGE_REPO||
     !isSha(task.baseSha)||typeof task.goal!=='string'||task.goal.length<12||task.goal.length>2000||
     /[\u0000-\u001f\u007f]/.test(task.goal)||
     !Array.isArray(task.paths)||task.paths.length<1||task.paths.length>8||
     task.paths.some(x=>!isSafePath(x))||new Set(task.paths).size!==task.paths.length||
     !task.paths.every((x,i,a)=>i===0||a[i-1]<x)||
     task.verificationSuite!=='node22-offline-tests'||
     !keysEqual(task.limits,['maxMinutes','maxTurns','maxRetries'])||
     !Number.isSafeInteger(task.limits.maxMinutes)||task.limits.maxMinutes<1||task.limits.maxMinutes>20||
     !Number.isSafeInteger(task.limits.maxTurns)||task.limits.maxTurns<1||task.limits.maxTurns>4||
     task.limits.maxRetries!==0)
    return decision('TASK_SCHEMA_OR_SCOPE_INVALID',issue.number);
  // Task hash is ONLY an idempotency hint, NOT a trusted execution grant.
  return decision('TASK_DATA_VALID',issue.number,digest(JSON.stringify(task)));
}
export function inspectQueue(issues,opts={}){
  if(!Array.isArray(issues)||issues.length>50)
    return {schema:'zc.bridge.queue/v1',gate:'HOLD',reason:'QUEUE_INVALID',items:[]};
  const numbers=new Set(),hashes=new Set(),items=[];
  for(const issue of issues){
    const d=inspectTaskIssue(issue,opts);
    if(d.issueNumber!==null){
      if(numbers.has(d.issueNumber)||d.taskDigest!==null&&hashes.has(d.taskDigest))
        return {schema:'zc.bridge.queue/v1',gate:'HOLD',reason:'DUPLICATE_QUEUE_ENTRY',items:[]};
      numbers.add(d.issueNumber);
      if(d.taskDigest!==null)hashes.add(d.taskDigest);
    }
    items.push(d);
  }
  return {
    schema:'zc.bridge.queue/v1',gate:'READ_ONLY',
    reason:'NO_TASK_AUTHORIZATION',items:items.sort((a,b)=>(a.issueNumber??0)-(b.issueNumber??0)),
    dispatch:'HOLD',worker:'NOT_CONNECTED',modelCalls:0,gitHubWrites:0
  };
}
