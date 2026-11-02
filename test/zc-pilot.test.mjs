import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK, issueBody, validateTask } from '../tools/zc-pilot/contract.mjs';
import { createIntakeService } from '../tools/zc-pilot/service.mjs';
import { createGithubAdapter } from '../tools/zc-pilot/github.mjs';
import { createPilotHandler } from '../tools/zc-pilot/server.mjs';

const fixture = () => ({ number: 106, html_url: 'https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/106', title: TASK.title, body: issueBody(), state: 'open', user: {login:'augusliang23-web'}, created_at:'2026-11-01T15:00:00Z', updated_at:'2026-11-01T15:00:00Z' });
function setup({allowWrite=true, rows=[], write}={}) {
 let writes=0;
 const github={list:async()=>structuredClone(rows),checkBase:async()=>{},create:async()=>{
  writes++;if(write)return write();const issue=fixture();rows.push(issue);return issue;
 }};
 return { service:createIntakeService({github,allowWrite}), count:()=>writes,rows };
}
test('contract rejects changed permissions, extra fields and unsupported versions',()=>{
 assert.equal(validateTask(structuredClone(TASK)),true);
 for(const edit of [x=>x.schema='zc.task/v2',x=>x.capabilities.push('provider:run'),x=>x.chatId='forged',x=>x.target.baseSha='a'.repeat(40)]){
  const x=structuredClone(TASK);edit(x);assert.equal(validateTask(x),false);
 }
 assert.throws(()=>TASK.capabilities.push('provider:run'));
});
test('empty GitHub source is NOT_CREATED, never running or accepted',async()=>{
 const {service}=setup();const r=await service.read();
 assert.equal(r.intake,'NOT_CREATED');assert.equal(r.worker,'NOT_CONNECTED');
 assert.equal(r.dispatch,'HOLD');assert.equal(r.ownerUat,'PENDING');assert.equal(r.implementation,'NOT_STARTED');
});
test('default read-only denies creation before GitHub write',async()=>{
 const {service,count}=setup({allowWrite:false});await assert.rejects(service.create(),/READ_ONLY/);assert.equal(count(),0);
});
test('concurrent and repeated clicks create one issue then read it back',async()=>{
 const {service,count}=setup();const r=await Promise.all([service.create(),service.create()]);
 assert.equal(count(),1);assert.equal(r[0].issue.number,106);assert.equal(r[1].intake,'RECORDED');
 assert.equal((await service.create()).issue.number,106);assert.equal(count(),1);
 assert.equal(r[0].events[0].schema,'zc.event/v1');assert.equal(r[0].events[0].kind,'INTAKE_RECORDED');
 assert.equal(r[0].worker,'NOT_CONNECTED');
});
test('edited same-key issue and duplicate records hold without creating',async()=>{
 for(const rows of [[{...fixture(),body:issueBody()+'\nforged'}],[fixture(),{...fixture(),number:107}]]){
  const {service,count}=setup({rows});await assert.rejects(service.create(),/INVALID_RECORD|DUPLICATE_RECORDS/);assert.equal(count(),0);
 }
});
test('wrong source URL, creator and invalid date never become recorded',async()=>{
 for(const edit of [x=>x.html_url='https://evil.test/106',x=>x.user.login='other',x=>x.created_at='not-a-date',x=>x.pull_request={}]){
  const x=fixture();edit(x);const {service}=setup({rows:[x]});await assert.rejects(service.read(),/INVALID_RECORD/);
 }
});
test('uncertain write cannot automatically retry, but real read-back may recover',async()=>{
 const {service,count,rows}=setup({write:async()=>{throw new Error('timeout');}});
 await assert.rejects(service.create(),/WRITE_UNCERTAIN/);await assert.rejects(service.create(),/WRITE_UNCERTAIN/);assert.equal(count(),1);
 rows.push(fixture());assert.equal((await service.read()).intake,'RECORDED');assert.equal((await service.create()).issue.number,106);assert.equal(count(),1);
});
test('failed source or drifted base prevents write',async()=>{
 for(const github of [{list:async()=>{throw new Error('UNAVAILABLE');}}, {list:async()=>[],checkBase:async()=>{throw new Error('BASE_DRIFT');}}]){
  let writes=0;github.create=async()=>{writes++;return fixture();};
  const s=createIntakeService({github,allowWrite:true});await assert.rejects(s.create());assert.equal(writes,0);
 }
});

const repoMeta={id:1352468489,full_name:'augusliang23-web/Micro-SaaS-Command-Center',html_url:'https://github.com/augusliang23-web/Micro-SaaS-Command-Center',default_branch:'main'};
test('adapter rejects source lookalike before reading issues',async()=>{
 const calls=[];const a=createGithubAdapter({request:async(method,path)=>{calls.push(path);return {...repoMeta,id:123};}});
 await assert.rejects(a.list(),/SOURCE_IDENTITY/);assert.equal(calls.length,1);
});
test('adapter reads all issue pages, refuses incomplete pagination and only emits fixed POST',async()=>{
 const calls=[];const request=async(method,path,payload)=>{
  calls.push({method,path,payload});
  if(path.endsWith('Micro-SaaS-Command-Center'))return repoMeta;
  if(method==='POST')return fixture();
  return new URL(path,'https://api.github.com/').searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>({number:i+1})):[];
 };
 const a=createGithubAdapter({request});assert.equal((await a.list()).length,100);
 assert.equal(calls.at(-1).path,'repos/augusliang23-web/Micro-SaaS-Command-Center/issues?state=all&per_page=100&page=2');
 await a.create();assert.deepEqual(calls.at(-1),{method:'POST',path:'repos/augusliang23-web/Micro-SaaS-Command-Center/issues',payload:{title:TASK.title,body:issueBody()}});
 const full=createGithubAdapter({request:async(m,p)=>p.endsWith('Micro-SaaS-Command-Center')?repoMeta:Array.from({length:100},()=>({number:1}))});
 await assert.rejects(full.list(),/PAGINATION_INCOMPLETE/);
});
test('adapter detects changed PM base and never retries failed writes',async()=>{
 let posts=0;const a=createGithubAdapter({request:async(m,p)=>{
  if(m==='POST'){posts++;throw new Error('FAIL');}
  if(p.endsWith('commits/main'))return {sha:'a'.repeat(40)};
  if(p.endsWith('/pm-dashboard'))return {id:1221937556,full_name:'augusliang23-web/pm-dashboard',html_url:'https://github.com/augusliang23-web/pm-dashboard',default_branch:'main'};
  return repoMeta;
 }});
 await assert.rejects(a.checkBase(),/BASE_DRIFT/);await assert.rejects(a.create());assert.equal(posts,1);
});
function handlerSetup(allowWrite=true){
 const {service,count}=setup({allowWrite});const handle=createPilotHandler({service,port:3134,csrfToken:'test-session-token'});
 const request=(options={})=>handle({method:'POST',path:'/api/tasks',headers:{host:'127.0.0.1:3134',origin:'http://127.0.0.1:3134','content-type':'application/json','x-zc-csrf':'test-session-token'},body:JSON.stringify({schema:'zc.intake/v1',taskId:'zc-pilot-01-pm-reduced-motion'}),...options});
 return {request,count};
}
test('HTTP guards deny cross-origin, Host, token, method, content-type and scope escalation before write',async()=>{
 for(const mutation of [
  x=>x.headers.origin='https://evil.test',x=>delete x.headers.origin,
  x=>x.headers.host='evil.test:3134',x=>x.headers['x-zc-csrf']='wrong',
  x=>x.headers['content-type']='text/plain',x=>x.method='DELETE',
  x=>x.body='{}',x=>x.body=JSON.stringify({schema:'zc.intake/v1',taskId:TASK.taskId,command:'run'}),
  x=>x.body='x'.repeat(1025),x=>x.body='{',x=>x.path='/api/tasks?repo=evil',
 ]){
  const {request,count}=handlerSetup();const opts={headers:{host:'127.0.0.1:3134',origin:'http://127.0.0.1:3134','content-type':'application/json','x-zc-csrf':'test-session-token'}};mutation(opts);
  const r=await request(opts);assert.ok(r.status>=400);assert.equal(count(),0);
 }
});
test('HTTP create/read response exposes real intake separately from worker and UAT',async()=>{
 const {request,count}=handlerSetup();const result=await request();assert.equal(result.status,200);assert.equal(result.body.intake,'RECORDED');
 assert.equal(result.body.worker,'NOT_CONNECTED');assert.equal(result.body.ownerUat,'PENDING');assert.equal(count(),1);
 const get=await request({method:'GET',path:'/api/tasks',body:''});assert.equal(get.body.issue.number,106);
 const readonly=handlerSetup(false);assert.equal((await readonly.request()).status,403);assert.equal(readonly.count(),0);
});
test('HTTP unavailable GitHub clears status instead of preserving fake success',async()=>{
 const service=createIntakeService({github:{list:async()=>{throw new Error('sensitive raw diagnostics');}}});
 const h=createPilotHandler({service,port:3134,csrfToken:'token'});
 const r=await h({method:'GET',path:'/api/tasks',headers:{host:'127.0.0.1:3134'},body:''});
 assert.equal(r.status,503);assert.equal(r.body.intake,'UNKNOWN');assert.equal(r.body.worker,'NOT_CONNECTED');assert.ok(!JSON.stringify(r).includes('sensitive'));
});
