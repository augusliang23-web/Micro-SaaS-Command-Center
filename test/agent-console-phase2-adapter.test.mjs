import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeAdapter } from '../server/execution/fakeAdapter.mjs';
import { verificationPassed } from '../server/execution/verificationRunner.mjs';
import { runProcess } from '../server/execution/processRunner.mjs';
import { assertPushBranch } from '../server/execution/executionPolicy.mjs';
import { taskWorktreePath } from '../server/execution/worktreeManager.mjs';
const id='CC-20261003-12345678';
const spec=root=>({taskId:id,worktreePath:root,fixturePath:`agent-console-fixture/${id}.txt`});
async function scratch(fn) {const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cc-p2-adapter-')));try{await fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}

test('fake adapter: deterministic file-only edit and observations, no claimed test PASS',async()=>scratch(async root=>{
  const events=[];const fake=new FakeAdapter();assert.deepEqual((await fake.probe()).capabilities,{editOnly:true,shell:false,git:false,network:false});
  assert.equal((await fake.start(spec(root),e=>events.push(e))).exitCode,0);
  assert.deepEqual(events.map(e=>e.type),['started','files_changed','output','finished']);
  assert.equal(fs.readFileSync(path.join(root,spec(root).fixturePath),'utf8'),`Task ${id}\nDeterministic Fake Adapter fixture\n`);
}));

test('fake adapter: traversal, directory symlink and existing target symlink cannot escape',async()=>scratch(async root=>{
  const outside=path.join(root,'outside'),worktree=path.join(root,'worktree');fs.mkdirSync(outside);fs.mkdirSync(worktree);
  const adapter=new FakeAdapter();
  await assert.rejects(()=>adapter.start({...spec(worktree),fixturePath:'../outside/file'},()=>{}),/fixture/);
  fs.symlinkSync(outside,path.join(worktree,'agent-console-fixture'));
  await assert.rejects(()=>adapter.start(spec(worktree),()=>{}),/symlink/);
  assert.deepEqual(fs.readdirSync(outside),[]);fs.unlinkSync(path.join(worktree,'agent-console-fixture'));fs.mkdirSync(path.join(worktree,'agent-console-fixture'));
  fs.writeFileSync(path.join(outside,'keep'),'original');fs.symlinkSync(path.join(outside,'keep'),path.join(worktree,spec(worktree).fixturePath));
  await assert.rejects(()=>adapter.start(spec(worktree),()=>{}),/EEXIST/);assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'original');
}));

test('worktree isolation: path derivation ignores task supplied roots and uses only the registry root',()=>{
  assert.equal(taskWorktreePath('/registered/worktrees',{taskId:id,worktreePath:'/user/checkout',cwd:'/user/checkout'}),`/registered/worktrees/${id}`);
  assert.throws(()=>taskWorktreePath('/registered/worktrees',{taskId:'../../escape'}),/taskId/);
});

test('push restriction: only the exact task-owned agent prefix is valid',()=>{
  assert.doesNotThrow(()=>assertPushBranch(`agent/${id}-fixture`,id));
  for(const branch of ['main','production','agent/other-task-fixture',`agent/${id}-fixture:refs/heads/main`,`agent/${id}-../escape`]) assert.throws(()=>assertPushBranch(branch,id),/agent/);
});

test('verification trust: agent claims and observed output cannot create PASS',()=>{
  assert.equal(verificationPassed([{kind:'agent_report',grade:'AGENT_CLAIM',data:{exitCode:0,message:'PASS'}}]),false);
  assert.equal(verificationPassed([{kind:'command_result',grade:'RUNTIME_OBSERVED',data:{exitCode:0}}]),false);
  assert.equal(verificationPassed([]),null);
  assert.equal(verificationPassed([{kind:'command_result',grade:'LOCALLY_VERIFIED',data:{exitCode:3}}]),false);
  assert.equal(verificationPassed([{kind:'command_result',grade:'LOCALLY_VERIFIED',data:{exitCode:0}}]),true);
});

test('process runner: metacharacters remain literal argv and timeout never returns success',async()=>scratch(async root=>{
  const literal='$(touch should-not-exist); echo forbidden';
  const result=await runProcess({command:process.execPath,args:['-e','console.log(process.argv[1])',literal],cwd:root});
  assert.equal(result.stdout.trim(),literal);assert.equal(result.exitCode,0);assert.ok(!fs.existsSync(path.join(root,'should-not-exist')));
  const timeout=await runProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:root,timeoutMs:50});
  assert.equal(timeout.exitCode,null);assert.ok(timeout.signal);assert.ok(timeout.durationMs>=40);
}));
