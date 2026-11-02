import {inspectQueue,TASK_MARKER,BRIDGE_REPO,BRIDGE_REPO_ID} from './task-queue.mjs';

// Pure transport boundary, NOT a live poller. Caller must independently
// authenticate GitHub API transport and supply fully read, bounded pages.
// No network/credentials/commands/models are reachable from this module.
const MAX_PAGES=3,MAX_PAGE_SIZE=20;
function hold(reason){
  return Object.freeze({
    schema:'zc.bridge.poll-plan/v1',gate:'HOLD',reason,
    scannedIssues:0,taskCandidates:0,queue:null,
    source:'UNVERIFIED_API_SNAPSHOT',worker:'NOT_CONNECTED',
    dispatch:'HOLD',readyToCode:false,modelCalls:0,gitHubWrites:0
  });
}
const isInt=x=>Number.isSafeInteger(x)&&x>0;
export function planReadOnlyPoll({repository,pages}={}){
  if(!repository||repository.id!==BRIDGE_REPO_ID||
    repository.full_name!==BRIDGE_REPO||
    repository.html_url!==`https://github.com/${BRIDGE_REPO}`)
    return hold('REPOSITORY_IDENTITY_INVALID');
  if(!Array.isArray(pages)||pages.length<1||pages.length>MAX_PAGES)
    return hold('PAGE_COUNT_INVALID');
  const all=[],seen=new Set();
  for(let k=0;k<pages.length;k++){
    const p=pages[k];
    if(!p||p.page!==k+1||typeof p.hasNext!=='boolean'||
       !Array.isArray(p.items)||p.items.length>MAX_PAGE_SIZE||
       (p.hasNext&&p.items.length===0)||
       (k<pages.length-1&&!p.hasNext)||
       (k===pages.length-1&&p.hasNext))
      return hold('PAGINATION_INCOMPLETE_OR_MALFORMED');
    for(const item of p.items){
      if(!item||!isInt(item.number)||seen.has(item.number)||
         item.repository?.id!==BRIDGE_REPO_ID||
         item.repository?.full_name!==BRIDGE_REPO||
         item.html_url!==`https://github.com/${BRIDGE_REPO}/issues/${item.number}`)
        return hold('ISSUE_SOURCE_OR_DUPLICATE_INVALID');
      seen.add(item.number);all.push(item);
    }
  }
  // Non-task Issues, including the Grok G0 #116 connection probe, are not
  // candidates. An attempted task with invalid schema is never silently
  // ignored; queue inspector returns a HOLD for the individual candidate.
  const candidates=all.filter(x=>typeof x.body==='string'&&x.body.startsWith(TASK_MARKER));
  const queue=inspectQueue(candidates);
  if(queue.gate!=='READ_ONLY')return hold('QUEUE_REJECTED');
  return Object.freeze({
    schema:'zc.bridge.poll-plan/v1',gate:'READ_ONLY',
    reason:'NO_TRUSTED_EXECUTION_GRANT',
    scannedIssues:all.length,taskCandidates:candidates.length,
    queue,
    source:'UNVERIFIED_API_SNAPSHOT',worker:'NOT_CONNECTED',
    dispatch:'HOLD',readyToCode:false,modelCalls:0,gitHubWrites:0
  });
}
