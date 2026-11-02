import {planReadOnlyPoll} from './poll-plan.mjs';
import {BRIDGE_REPO,BRIDGE_REPO_ID} from './task-queue.mjs';

// Authenticated GitHub transport is NOT implemented here. A trusted caller
// must inject a narrowly-scoped request function. No token/env read, no HTTP
// write, no shell/model, no background service. Always returns dispatch HOLD.
const ORIGIN='https://api.github.com';
const PREFIX=`${ORIGIN}/repos/${BRIDGE_REPO}`;
const MAX_PAGES=3, PAGE_SIZE=20, MAX_BYTES=256*1024;
function blocked(reason){
  return Object.freeze({
    schema:'zc.bridge.github-read/v1',gate:'HOLD',reason,
    transport:'NOT_AUTHENTICATED_BY_THIS_MODULE',
    poll:null,dispatch:'HOLD',readyToCode:false,
    worker:'NOT_CONNECTED',modelCalls:0,gitHubWrites:0
  });
}
async function boundedJson(response){
  if(!response||response.status!==200||response.redirected||
    !/\b(?:application\/json|application\/vnd\.github\+json)\b/i.test(response.headers?.get?.('content-type')??'')||
    !response.body?.getReader)throw Error('RESPONSE_INVALID');
  const reader=response.body.getReader(),bytes=[];
  let size=0,done=false;
  try{
    while(!done){
      const part=await reader.read();
      done=part.done;
      if(!done){
        if(!(part.value instanceof Uint8Array))throw Error('BYTES_INVALID');
        size+=part.value.byteLength;
        if(size>MAX_BYTES)throw Error('BODY_TOO_LARGE');
        bytes.push(part.value);
      }
    }
  }finally{reader.releaseLock();}
  const all=new Uint8Array(size);let offset=0;
  for(const part of bytes){all.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}
export async function readGitHubIssueQueue({request}={}){
  if(typeof request!=='function')return blocked('TRUSTED_READ_TRANSPORT_MISSING');
  const fetchOne=async url=>{
    if(url!==PREFIX&&!/^https:\/\/api\.github\.com\/repos\/augusliang23-web\/Micro-SaaS-Command-Center\/issues\?state=open&per_page=20&page=[123]$/.test(url))
      throw Error('NONCANONICAL_URL');
    // This method does not pass credentials; a separate pinned transport must
    // attach narrowly scoped credentials only for the exact GitHub API origin.
    const response=await request({url,method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json'}});
    const data=await boundedJson(response);
    return {data,link:response.headers.get('link')??''};
  };
  try{
    const rep=(await fetchOne(PREFIX)).data;
    if(rep?.id!==BRIDGE_REPO_ID||rep?.full_name!==BRIDGE_REPO||
       rep?.html_url!==`https://github.com/${BRIDGE_REPO}`)
      return blocked('REPOSITORY_IDENTITY_INVALID');
    const pages=[];
    for(let page=1;page<=MAX_PAGES;page++){
      const url=`${PREFIX}/issues?state=open&per_page=${PAGE_SIZE}&page=${page}`;
      const {data,link}=await fetchOne(url);
      if(!Array.isArray(data)||data.length>PAGE_SIZE)throw Error('ISSUE_ARRAY_INVALID');
      // Never follow a Link URL; only use it to check a bounded fixed next page.
      const hasNext=/<[^<>]+>;\s*rel="next"/.test(link);
      const items=data.map(i=>({
        number:i?.number,state:i?.state,body:i?.body,
        html_url:i?.html_url,pull_request:i?.pull_request,
        repository:{id:rep.id,full_name:rep.full_name}
      }));
      pages.push({page,hasNext,items});
      if(!hasNext)break;
    }
    const poll=planReadOnlyPoll({repository:rep,pages});
    return Object.freeze({
      schema:'zc.bridge.github-read/v1',gate:poll.gate,reason:poll.reason,
      transport:'NOT_AUTHENTICATED_BY_THIS_MODULE',
      poll,worker:'NOT_CONNECTED',dispatch:'HOLD',
      readyToCode:false,modelCalls:0,gitHubWrites:0
    });
  }catch{return blocked('BOUNDED_GITHUB_READ_FAILED');}
}
