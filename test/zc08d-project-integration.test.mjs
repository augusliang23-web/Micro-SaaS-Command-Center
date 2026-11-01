import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDevelopmentHistory, fetchPullDetail, DEVELOPMENT_HISTORY_REPOS } from '../server/githubDevelopmentHistory.mjs';
import { normalizeMockStatus } from '../src/v1/zc08bStatusModel.mjs';
import { statusFromGitHub } from '../src/v1/projectStatusModel.mjs';
import { FIXED_TARGETS } from '../src/v1/zc08bStatusModel.mjs';
import { createGithubRouter } from '../server/githubRoutes.mjs';
import express from 'express';

const repo = 'augusliang23-web/Micro-SaaS-Command-Center';
const head = 'a'.repeat(40), next = 'b'.repeat(40);
const info = { id:1352468489, full_name:repo, html_url:`https://github.com/${repo}`, default_branch:'main' };
const pull = {number:97, html_url:`https://github.com/${repo}/pull/97`, state:'open', draft:true,
 head:{sha:head,repo:info},base:{repo:info},title:'test'};
function fake(over = {}) {
 const calls=[]; let reads=0;
 const execFileFn=(cmd,args,opts,cb)=>{
  const path=args.at(-1); calls.push({cmd,args});
  let data;
  if(path===`repos/${repo}`) data=over.info??info;
  else if(path.endsWith('/pulls/97')) data=over.drift && reads++ ? {...pull,head:{...pull.head,sha:next}} : over.pull??pull;
  else if(path.includes('/actions/runs?')) data=over.runs??{total_count:1,workflow_runs:[{id:1,name:'ZC08A isolated Live Monitor QA',path:'.github/workflows/zc08a-isolated-qa.yml',head_sha:head,status:'completed',conclusion:'success',run_number:1,run_attempt:1,html_url:`https://github.com/${repo}/actions/runs/1`}]};
  else if(path.includes('/reviews?')) data=over.reviews??[];
  else if(path.includes('/check-runs?')) data={total_count:0,check_runs:[]};
  else if(path.includes('/branches?')) data=[];
  else if(path.includes('/pulls?')||path.includes('/commits?')) data=[];
  else { cb(new Error('Unexpected path '+path),'',''); return; }
  cb(null,'HTTP/2.0 200 OK\r\n\r\n'+JSON.stringify(data),'');
 };
 return {execFileFn,calls};
}
test('approved exact four-repository allowlist includes Inventory and both ZC sources',()=>{
 assert.deepEqual([...DEVELOPMENT_HISTORY_REPOS],['augusliang23-web/pm-dashboard','alin36242-web/inventory-management-tool','augusliang23-web/cc-h15a-claude-dispatch-lab',repo]);
});
test('numeric source mismatch stops before branch, PR or commit reads',async()=>{
 const f=fake({info:{...info,id:1}});
 await assert.rejects(fetchDevelopmentHistory(repo,f),/identity/i);
 assert.equal(f.calls.length,1);
});
test('redirected full_name fails even when repository id matches',async()=>{
 const f=fake({info:{...info,full_name:'other/transferred'}});
 await assert.rejects(fetchDevelopmentHistory(repo,f),/identity/i);
 assert.equal(f.calls.length,1);
});
test('fixed ZC PR detail supplies exact-head CI without inventing Codex or Agent activity',async()=>{
 const f=fake(); const d=await fetchPullDetail(repo,97,f);
 assert.equal(d.zcEvidence?.head,head); assert.equal(d.zcEvidence?.ci,'PASS');
 assert.equal(d.zcEvidence?.review,'UNKNOWN'); assert.equal(d.zcEvidence?.agent,'NOT_CONNECTED');
 assert.ok(f.calls.length<=7);
 for(const c of f.calls){assert.equal(c.cmd,'gh');assert.deepEqual(c.args.slice(0,3),['api','--method','GET']);}
});
test('PR head drift during status reads invalidates PASS',async()=>{
 const d=await fetchPullDetail(repo,97,fake({drift:true}));
 assert.equal(d.zcEvidence?.ci,'UNKNOWN');assert.equal(d.zcEvidence?.status,'STALE');
});
test('foreign PR base identity is rejected before status reads',async()=>{
 const f=fake({pull:{...pull,base:{repo:{...info,id:1}}}});
 await assert.rejects(fetchPullDetail(repo,97,f),/identity/i);
 assert.equal(f.calls.length,2);
});
test('truncated workflow list cannot produce PASS',async()=>{
 const d=await fetchPullDetail(repo,97,fake({runs:{total_count:51,workflow_runs:[]}}));
 assert.equal(d.zcEvidence?.ci,'UNKNOWN');
});
test('offline #102 target is reused with synthetic provenance',()=>{
 const s=normalizeMockStatus({targetId:'ZC08B1'});
 assert.equal(s.id,'ZC08B1');assert.equal(s.provenance,'SYNTHETIC_FIXTURE_ONLY');
});
test('expired or future source evidence cannot show PASS or a current Codex observation',async()=>{
 const d=await fetchPullDetail(repo,97,fake()); const evidence=d.zcEvidence.evidence;
 const target=FIXED_TARGETS.find(t=>t.id==='ZC08A');
 for(const delta of [-1,300001]){
  const s=statusFromGitHub(target,evidence,Date.parse(evidence.observedAt)+delta);
  assert.equal(s.status,'STALE'); assert.equal(s.ci,'UNKNOWN'); assert.equal(s.codex,undefined);
 }
});
test('a historical Codex COMMENTED observation never means clean QA or current approval',async()=>{
 const d=await fetchPullDetail(repo,97,fake({reviews:[{id:12,user:{login:'chatgpt-codex-connector[bot]'},state:'COMMENTED',commit_id:next}]}));
 assert.equal(d.zcEvidence.codex[0].relation,'HISTORICAL');assert.equal(d.zcEvidence.review,'UNKNOWN');
 assert.equal(d.zcEvidence.status,'PARTIAL');
});
test('a failed explicit refresh invalidates only that target cache; polling cannot revive old PASS',async()=>{
 let calls=0,fail=false;
 const app=express();app.use(createGithubRouter({fetchHistoryPull:async(r,n)=>{
  calls++;if(fail)throw Error('Synthetic unavailable');
  return {source:'GitHub',repository:r,number:n,zcEvidence:{evidence:{consistent:true}}};
 }}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}/development-history/pull?repo=${repo}&number=97`;
 try{
  assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url)).status,200);assert.equal(calls,1);
  fail=true;assert.equal((await fetch(url+'&refresh=1')).status,500);
  assert.equal((await fetch(url)).status,500);assert.equal(calls,3);
 }finally{await new Promise(r=>server.close(r));}
});
for(const route of ['history','status'])test(`concurrent ${route}: an older in-flight read cannot repopulate cache after failed force refresh`,async()=>{
 let calls=0,releaseFirst,started;
 const firstStarted=new Promise(resolve=>{started=resolve;});
 const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
 const read=async(r,n)=>{
  const mine=++calls;
  if(mine===1){started();await firstGate;}
  else throw Error('Synthetic refresh unavailable');
  return {source:'GitHub',repository:r,number:n,ci:'PASS',zcEvidence:{evidence:{consistent:true}}};
 };
 const app=express();app.use(createGithubRouter({fetchHistory:read,fetchHistoryPull:read}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}/development-history${route==='status'?'/pull':''}?repo=${repo}${route==='status'?'&number=97':''}`;
 const old=fetch(url);
 try{
  await firstStarted;
  assert.equal((await fetch(url+'&refresh=1')).status,500);
  releaseFirst();await old;
  assert.equal((await fetch(url)).status,500);
  assert.equal(calls,3);
 }finally{releaseFirst();await old;await new Promise(r=>server.close(r));}
});
