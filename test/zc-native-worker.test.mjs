import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildNativeSpec,checkNativeEligibility,isToolItem,validatePatch,NativeSession,BEFORE,AFTER} from '../tools/zc-pilot/nativeClient.mjs';
import {spawn} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createNativeJob,JOB_ID} from '../tools/zc-pilot/nativeJob.mjs';
import {createPilotHandler} from '../tools/zc-pilot/server.mjs';
import {createGithubAdapter} from '../tools/zc-pilot/github.mjs';
import {TASK,issueBody} from '../tools/zc-pilot/contract.mjs';

test('native process drops credentials and binds native profile without global config writes',()=>{
 const s=buildNativeSpec('/private/tmp/fixture',{HOME:'/Users/example',PATH:'/bin',OPENAI_API_KEY:'never',GH_TOKEN:'never',AWS_SECRET_ACCESS_KEY:'never'});
 assert.equal(s.command,'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');
 assert.deepEqual(Object.keys(s.env).sort(),['HOME','PATH']);
 assert.ok(s.args.includes('forced_login_method="chatgpt"'));
 assert.ok(s.args.includes('default_permissions="zc-patch"'));
 assert.ok(s.args.some(x=>x.startsWith('permissions.zc-patch.filesystem={')&&x.includes('":root"="deny"')));
 assert.ok(!s.args.some(x=>x.startsWith('sandbox_mode=')));
});
const models={data:[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null};
const limits={ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:20},secondary:{usedPercent:30}}};
test('unknown auth/quota/model/effort fails before a model turn',()=>{
 assert.doesNotThrow(()=>checkNativeEligibility({account:{account:{type:'chatgpt'}},models,limits}));
 for(const x of [
  {account:{account:{type:'apiKey'}},models,limits},
  {account:{account:null},models,limits},
  {account:{account:{type:'chatgpt'}},models:{data:[]},limits},
  {account:{account:{type:'chatgpt'}},models:{data:[{model:'gpt-6-luna',supportedReasoningEfforts:[]}]},limits},
  {account:{account:{type:'chatgpt'}},models,limits:{rateLimits:{primary:{usedPercent:100}}}},
  {account:{account:{type:'chatgpt'}},models,limits:{}},
  ...[false,null,undefined].map(ordinaryUsageAllowed=>({account:{account:{type:'chatgpt'}},models,limits:{...limits,ordinaryUsageAllowed}})),
  {account:{account:{type:'chatgpt'}},models,limits:{...limits,rateLimits:{...limits.rateLimits,spendControlReached:true}}},
  {account:{account:{type:'chatgpt'}},models,limits:{...limits,rateLimitsByLimitId:{codex:{...limits.rateLimits,rateLimitReachedType:'rate_limit_reached'}}}},
 ])assert.throws(()=>checkNativeEligibility(x));
});
test('user/agent/reasoning items are not counted as tools; unknown items are blocked',()=>{
 for(const type of ['userMessage','agentMessage','reasoning'])assert.equal(isToolItem(type),false);
 for(const type of ['commandExecution','fileChange','mcpToolCall','futureTool',undefined])assert.equal(isToolItem(type),true);
});
test('only the exact approved CSS proposal can mutate one source line',()=>{
 const patch={path:'index.html',oldText:BEFORE,newText:AFTER};
 assert.equal(validatePatch(patch,'prefix\n'+BEFORE+'\nsuffix'),'prefix\n'+AFTER+'\nsuffix');
 for(const edit of [x=>x.path='../index.html',x=>x.newText+='\n<script>bad()</script>',x=>x.extra=true,x=>x.oldText='']){
  const x=structuredClone(patch);edit(x);assert.throws(()=>validatePatch(x,BEFORE));
 }
 assert.throws(()=>validatePatch(patch,BEFORE+BEFORE));
});

async function fixture(options={}){
 const root=await mkdtemp(path.join(tmpdir(),'zc-job-test-'));let calls=0;
 const ops={verify:async()=>{},reserve:async()=>({url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107#issuecomment-1'}),prepare:async()=>({source:BEFORE,cwd:'/private/tmp/fixture'}),produce:async()=>{calls++;return {patch:{path:'index.html',oldText:BEFORE,newText:AFTER},model:'gpt-6-luna',effort:'low',toolTypes:[]};},applyAndTest:async()=>({commit:'a'.repeat(40),tree:'f421278d6eb5bdd12f0adbaaa9634a70e45f5104',tests:'PASS',prUrl:'https://github.com/augusliang23-web/pm-dashboard/pull/96'}),publish:async()=>({url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107#issuecomment-2'}),...options};
 const job=await createNativeJob({root,enabled:true,ops});return {job,root,ops,count:()=>calls};
}
test('concurrent native requests share one reserved job and truthful stage events',async()=>{
 const {job,count}=await fixture();await Promise.all([job.start(),job.start()]);await job.wait();
 const x=job.status();assert.equal(count(),1);assert.equal(x.jobId,JOB_ID);assert.equal(x.state,'DELIVERED');assert.equal(x.ownerUat,'PENDING');assert.equal(x.result.tests,'PASS');
 assert.ok(x.events.some(e=>e.kind==='SOURCE_EDITED_AND_TESTED'));assert.ok(!JSON.stringify(x).includes('threadId'));
});
test('restart from local reservation never re-invokes a provider',async()=>{
 const x=await fixture();await x.job.start();await x.job.wait();
 const restarted=await createNativeJob({root:x.root,enabled:true,ops:x.ops});await assert.rejects(restarted.start(),/EXISTING_RESERVATION/);assert.equal(x.count(),1);
});
test('another local claimant makes the losing instance visibly HOLD',async()=>{
 const x=await fixture();const second=await createNativeJob({root:x.root,enabled:true,ops:x.ops});
 await x.job.start();await x.job.wait();await assert.rejects(second.start(),/EXISTING_RESERVATION/);
 assert.equal(second.status().state,'HOLD');assert.equal(x.count(),1);
});
test('ambiguous reservation or provider failure holds and never retries',async()=>{
 for(const bad of [{reserve:async()=>{throw new Error('UNKNOWN');}},{produce:async()=>{throw new Error('UNKNOWN');}}]){
  const {job,root}=await fixture(bad);await job.start();await job.wait();assert.equal(job.status().state,'HOLD');
  await assert.rejects(job.start(),/EXISTING_RESERVATION/);
  const journal=await readFile(root+'/journal.jsonl','utf8');assert.ok(journal.includes('HOLD'));
 }
});
test('source verification failure cannot reserve or invoke a model',async()=>{
 let writes=0;const {job,count}=await fixture({verify:async()=>{throw new Error('SOURCE_DRIFT');},reserve:async()=>{writes++;}});
 await job.start();await job.wait();assert.equal(job.status().state,'HOLD');assert.equal(writes,0);assert.equal(count(),0);
});
test('native HTTP dispatch requires its own server capability, exact scope and browser token',async()=>{
 const x=await fixture();
 const service={allowWrite:false,read:async()=>({}),create:async()=>{throw new Error('DENIED');}};
 const handle=createPilotHandler({service,nativeJob:x.job,port:3134,csrfToken:'token'});
 const request={method:'POST',path:'/api/jobs',headers:{host:'127.0.0.1:3134',origin:'http://127.0.0.1:3134','x-zc-csrf':'token','content-type':'application/json'},body:JSON.stringify({schema:'zc.dispatch/v1',taskId:'zc-pilot-01-pm-reduced-motion',jobId:JOB_ID})};
 for(const change of [q=>q.headers.origin='https://evil.test',q=>q.headers['x-zc-csrf']='wrong',q=>q.body='{}',q=>q.path='/api/jobs?extra=run']){
  const q=structuredClone(request);change(q);assert.ok((await handle(q)).status>=400);assert.equal(x.count(),0);
 }
 assert.equal((await handle(request)).status,202);await x.job.wait();assert.equal(x.count(),1);
 assert.equal((await handle({...request,method:'GET',body:''})).body.state,'DELIVERED');
 const readonly=createPilotHandler({service,port:3134,csrfToken:'token'});assert.equal((await readonly(request)).status,403);
});
test('GitHub reservation blocks an existing job marker without another write',async()=>{
 let posts=0;const a=createGithubAdapter({request:async(method,url)=>{
  if(method==='POST'){posts++;throw new Error('MUST_NOT_WRITE');}
  if(url.endsWith('Micro-SaaS-Command-Center'))return {id:1352468489,full_name:'augusliang23-web/Micro-SaaS-Command-Center',html_url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center',default_branch:'main'};
  if(url.endsWith('/issues/107'))return {number:107,title:TASK.title,body:issueBody(),state:'open',user:{login:'augusliang23-web'},html_url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'};
  return [{body:'<!-- zc-job:zc-native-pm-pilot-01 -->'}];
 }});
 await assert.rejects(a.reserveNativeJob(JOB_ID,{grantId:'github-cc-issue-108-owner-native-pilot'}),/EXISTING_GITHUB_RESERVATION/);assert.equal(posts,0);
});
test('publishing cannot claim a matching existing PR after its head drifts',async()=>{
 let posts=0;
 const a=createGithubAdapter({request:async(method,url,payload)=>{
  if(method==='POST'){posts++;return {id:123,user:{login:'augusliang23-web'},body:payload.body,html_url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107#issuecomment-123'};}
  if(url.endsWith('/pm-dashboard'))return {id:1221937556,full_name:'augusliang23-web/pm-dashboard',html_url:'https://github.com/augusliang23-web/pm-dashboard',default_branch:'main'};
  if(url.endsWith('/commits/main'))return {sha:TASK.target.baseSha};
  if(url.endsWith('/pulls/96'))return {number:96,state:'open',draft:true,merged:false,html_url:'https://github.com/augusliang23-web/pm-dashboard/pull/96',head:{sha:'b'.repeat(40),repo:{id:1221937556}},base:{sha:TASK.target.baseSha}};
  if(url.endsWith('Micro-SaaS-Command-Center'))return {id:1352468489,full_name:'augusliang23-web/Micro-SaaS-Command-Center',html_url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center',default_branch:'main'};
  if(url.endsWith('/issues/107'))return {number:107,title:TASK.title,body:issueBody(),state:'open',user:{login:'augusliang23-web'},html_url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'};
  return [];
 }});
 await assert.rejects(a.publishNativeJob({jobId:JOB_ID,taskId:TASK.taskId,result:{tree:'f421278d6eb5bdd12f0adbaaa9634a70e45f5104'}}),/NATIVE_TARGET_DRIFT/);assert.equal(posts,0);
});
test('native error/retry notification rejects pending work and future requests',async()=>{
 for(const willRetry of [true,false]){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const s=new NativeSession('/private/tmp',{spawnImpl:()=>child});
  const pending=s.request('turn/start',{});
  child.stdout.write(JSON.stringify({method:'error',params:{willRetry,error:{message:'fixture'}}})+'\n');
  await assert.rejects(pending,willRetry?/NATIVE_RETRY_BLOCKED/:/NATIVE_TURN_ERROR/);
  await assert.rejects(s.request('turn/start',{}));child.emit('exit',0);await s.close();
 }
});
test('native close stops a descendant even when its leader exits first',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'zc-native-cleanup-'));const heartbeat=path.join(root,'heartbeat');await writeFile(heartbeat,'');
 const childCode=`const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),10);`;
 const parentCode=`const{spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`;
 let leader;const s=new NativeSession(root,{spawnImpl:(_cmd,_args,options)=>(leader=spawn(process.execPath,['-e',parentCode],options))});
 try{
  for(let i=0;i<100&&(await readFile(heartbeat,'utf8')).length===0;i++)await new Promise(r=>setTimeout(r,10));
  assert.ok((await readFile(heartbeat,'utf8')).length>0,'descendant is running before close');
  await s.close();const size=(await readFile(heartbeat,'utf8')).length;await new Promise(r=>setTimeout(r,80));assert.equal((await readFile(heartbeat,'utf8')).length,size);
 }finally{try{process.kill(-leader.pid,'SIGKILL');}catch{}}
});
