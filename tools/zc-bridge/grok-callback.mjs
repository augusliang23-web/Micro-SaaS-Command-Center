import {createHash} from 'node:crypto';
import {BRIDGE_REPO,BRIDGE_REPO_ID} from './task-queue.mjs';

// Grok callback normalization from snapshots. Not an event subscriber, Routine,
// QA approval or evidence fetcher. All payloads are untrusted until re-fetched.
const STATES=new Set(['pr-opened','pr-pushed','ci-passed','ci-failed']);
const isSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const jobId=x=>typeof x==='string'&&/^zc-[a-z0-9]+(?:-[a-z0-9]+){1,7}$/.test(x)&&x.length<=72;
const positive=x=>Number.isSafeInteger(x)&&x>0&&x<100000000;
function result(reason,pr=null,key=null){
  return Object.freeze({
    schema:'zc.bridge.callback/v1',reason,
    disposition:reason==='CANDIDATE_FOR_GROK_REVIEW'?'READ_ONLY_REVIEW_CANDIDATE':'HOLD',
    prNumber:pr,wakeKey:key,
    sourceAuthority:'UNVERIFIED_EVENT_SNAPSHOT',
    gitHubReFetch:'REQUIRED',
    independentQA:'NOT_VERIFIED',
    grokRoutine:'NOT_CONNECTED',
    userNotified:false,readyToMerge:false,readyToDeploy:false,
    dispatch:'HOLD',modelCalls:0,gitHubWrites:0
  });
}
export function inspectReturnEvent(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!STATES.has(input.eventKind))
    return result('UNSUPPORTED_EVENT_KIND');
  const {eventKind,repository,pr,ci}=input;
  if(repository?.id!==BRIDGE_REPO_ID||repository?.full_name!==BRIDGE_REPO||
     repository?.html_url!==`https://github.com/${BRIDGE_REPO}`)
    return result('REPOSITORY_IDENTITY_INVALID');
  if(!pr||!positive(pr.number)||pr.state!=='open'||pr.draft!==true||
     pr.html_url!==`https://github.com/${BRIDGE_REPO}/pull/${pr.number}`||
     pr.base?.repo?.id!==BRIDGE_REPO_ID||pr.base?.repo?.full_name!==BRIDGE_REPO||
     pr.head?.repo?.id!==BRIDGE_REPO_ID||pr.head?.repo?.full_name!==BRIDGE_REPO||
     !isSha(pr.head?.sha))
    return result('PR_SOURCE_INVALID');
  // Existing draft PRs do not automatically qualify; require marker bound
  // to a task Issue. Marker is untrusted data and NEVER a permission grant.
  if(typeof pr.body!=='string'||Buffer.byteLength(pr.body,'utf8')>16*1024)
    return result('PR_MARKER_INVALID',pr.number);
  const markers=pr.body.match(/<!-- zc\.bridge-result\/v1 task=[^\n]*? -->/g)??[];
  if(markers.length!==1)return result('PR_MARKER_INVALID',pr.number);
  const match=/^<!-- zc\.bridge-result\/v1 task=(zc-[a-z0-9-]+) issue=(\d+) -->$/.exec(markers[0]);
  if(!match||!jobId(match[1])||!positive(Number(match[2]))||
     !pr.body.includes(`https://github.com/${BRIDGE_REPO}/issues/${match[2]}`))
    return result('PR_MARKER_INVALID',pr.number);
  if(eventKind.startsWith('ci-')){
    if(!ci||ci.headSha!==pr.head.sha||ci.prNumber!==pr.number||
       ci.status!=='completed'||
       ci.conclusion!==(eventKind==='ci-passed'?'success':'failure'))
      return result('CI_SHA_OR_TERMINAL_MISMATCH',pr.number);
  }else if(ci!==undefined){
    // CI is not evidence in an opened/pushed event. Reject ambiguous payloads.
    return result('UNEXPECTED_CI_SNAPSHOT',pr.number);
  }
  const stage=eventKind.startsWith('ci-')?'CI_TERMINAL':'PR_RECEIVED';
  const wakeKey=createHash('sha256')
    .update(`${BRIDGE_REPO_ID}:${pr.number}:${pr.head.sha}:${stage}`)
    .digest('hex');
  return result('CANDIDATE_FOR_GROK_REVIEW',pr.number,wakeKey);
}
