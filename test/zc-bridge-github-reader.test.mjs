import test from 'node:test';
import assert from 'node:assert/strict';
import {readGitHubIssueQueue} from '../tools/zc-bridge/github-reader.mjs';
import {BRIDGE_REPO,BRIDGE_REPO_ID,TASK_MARKER} from '../tools/zc-bridge/task-queue.mjs';

const base='https://api.github.com/repos/'+BRIDGE_REPO;
const repo=()=>({id:BRIDGE_REPO_ID,full_name:BRIDGE_REPO,html_url:'https://github.com/'+BRIDGE_REPO});
const body=t=>TASK_MARKER+'\n```json\n'+JSON.stringify(t)+'\n```';
const task=()=>({
  schema:'zc.task/v1',taskId:'zc-safe-queue-01',repositoryId:BRIDGE_REPO_ID,
  repository:BRIDGE_REPO,baseSha:'f'.repeat(40),
  goal:'Fix one narrow offline source fixture with no other files changed',
  paths:['test/zc-fixture.test.mjs'],verificationSuite:'node22-offline-tests',
  limits:{maxMinutes:5,maxTurns:1,maxRetries:0}
});
const issue=(number,bodyText)=>({
  number,body:bodyText,state:'open',
  html_url:`https://github.com/${BRIDGE_REPO}/issues/${number}`
});
const respond=(data,{link='',status=200,contentType='application/json'}={})=>
  new Response(JSON.stringify(data),{status,headers:{'content-type':contentType,link}});
function mock({repoValue=repo(),issues=[issue(116,'<!-- zc.connection-probe/v1 -->')],status=200,link='',fail=false}={}){
  const requests=[];
  const request=async args=>{
    requests.push(args);
    if(fail)throw Error('SECRET_TOKEN_WILL_NOT_LEAK');
    if(args.url===base)return respond(repoValue);
    if(args.url===base+'/issues?state=open&per_page=20&page=1')
      return respond(issues,{status,link});
    throw Error('UNEXPECTED_URL');
  };
  return {request,requests};
}
test('missing authenticated adapter never invokes global network',async()=>{
  const r=await readGitHubIssueQueue();
  assert.equal(r.reason,'TRUSTED_READ_TRANSPORT_MISSING');
  assert.equal(r.dispatch,'HOLD');
});
test('read GitHub repo and Issues using only two fixed GET URLs; G0 #116 excluded',async()=>{
  const m=mock(),r=await readGitHubIssueQueue({request:m.request});
  assert.equal(r.gate,'READ_ONLY');assert.equal(r.poll.taskCandidates,0);
  assert.equal(r.poll.scannedIssues,1);
  assert.equal(r.dispatch,'HOLD');assert.equal(r.worker,'NOT_CONNECTED');
  assert.deepEqual(m.requests.map(x=>x.url),[base,base+'/issues?state=open&per_page=20&page=1']);
  assert.ok(m.requests.every(x=>x.method==='GET'&&x.redirect==='error'));
  assert.ok(m.requests.every(x=>!JSON.stringify(x.headers).includes('Authorization')));
});
test('valid Grok task data remains PENDING_TRUSTED_GRANT even after read',async()=>{
  const m=mock({issues:[issue(121,body(task()))]});
  const r=await readGitHubIssueQueue({request:m.request});
  assert.equal(r.gate,'READ_ONLY');
  assert.equal(r.poll.queue.items[0].disposition,'PENDING_TRUSTED_GRANT');
  assert.equal(r.readyToCode,false);
  assert.equal(r.transport,'NOT_AUTHENTICATED_BY_THIS_MODULE');
});
test('numeric repository ID mismatch causes read HOLD and no Issue request',async()=>{
  const altered=repo();altered.id=1;
  const m=mock({repoValue:altered});
  const r=await readGitHubIssueQueue({request:m.request});
  assert.equal(r.reason,'REPOSITORY_IDENTITY_INVALID');
  assert.equal(m.requests.length,1);
});
test('failed network, HTTP error and incorrect content type fail closed',async()=>{
  for(const m of [
    mock({fail:true}),mock({status:403}),mock({status:200,issues:[],link:''})
  ]){
    const r=await readGitHubIssueQueue({request:m.request});
    assert.equal(r.dispatch,'HOLD');
  }
  const request=async ({url})=>url===base?respond(repo()):respond([],{contentType:'text/plain'});
  assert.equal((await readGitHubIssueQueue({request})).reason,'BOUNDED_GITHUB_READ_FAILED');
});
test('a next page is fetched through fixed canonical URL, never the Link URL',async()=>{
  const requests=[];
  const first='<https://api.github.com/repos/evil/secret?token=EXFIL>; rel="next"';
  const request=async args=>{
    requests.push(args.url);
    if(args.url===base)return respond(repo());
    if(args.url.endsWith('page=1'))return respond([issue(116,'probe')],{link:first});
    if(args.url.endsWith('page=2'))return respond([issue(121,body(task()))]);
    throw Error('UNEXPECTED_URL');
  };
  const r=await readGitHubIssueQueue({request});
  assert.equal(r.poll.scannedIssues,2);
  assert.equal(r.poll.taskCandidates,1);
  assert.ok(requests.every(x=>x.startsWith(base)));
  assert.ok(!requests.some(x=>x.includes('EXFIL')));
});
test('pagination beyond fixed third page is a safe HOLD',async()=>{
  const req=async ({url})=>url===base?respond(repo()):
    respond([issue(Number(url.at(-1))+100,'probe')],{link:'<https://api.github.com/whatever>; rel="next"'});
  const r=await readGitHubIssueQueue({request:req});
  assert.equal(r.gate,'HOLD');
  assert.equal(r.poll.reason,'PAGINATION_INCOMPLETE_OR_MALFORMED');
});
test('untrusted issues never leak their bodies or tokens',async()=>{
  const m=mock({issues:[issue(116,'SecretTOKEN=DO_NOT_LEAK')]});
  const r=await readGitHubIssueQueue({request:m.request});
  assert.ok(!JSON.stringify(r).includes('DO_NOT_LEAK'));
});
test('oversized API response is discarded, not processed',async()=>{
  const request=async ({url})=>url===base?respond(repo()):
    respond([issue(116,'x'.repeat(300*1024))]);
  const r=await readGitHubIssueQueue({request});
  assert.equal(r.reason,'BOUNDED_GITHUB_READ_FAILED');
});
test('spoofed issue URL is rejected despite trusted repo endpoint',async()=>{
  const bad=issue(121,body(task()));bad.html_url='https://github.evil/attacker/121';
  const m=mock({issues:[bad]});
  const r=await readGitHubIssueQueue({request:m.request});
  assert.equal(r.poll.reason,'ISSUE_SOURCE_OR_DUPLICATE_INVALID');
});
