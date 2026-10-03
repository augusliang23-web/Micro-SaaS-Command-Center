import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { withFixture, git } from './helpers/phase2Fixture.mjs';
import { Orchestrator } from '../server/execution/orchestrator.mjs';
import { WorktreeManager } from '../server/execution/worktreeManager.mjs';
import { FakeAdapter } from '../server/execution/fakeAdapter.mjs';
import { FakePrProvider } from '../server/execution/fakePrProvider.mjs';
import { requireAction } from '../server/execution/executionPolicy.mjs';

function engine(f, overrides={}) { return new Orchestrator({registry:f.registry,taskStore:f.store,executionStore:f.records,worktreeManager:new WorktreeManager({allowLocalRemotes:true}),adapter:new FakeAdapter(),prProvider:new FakePrProvider(),...overrides}); }
const hostile=(start)=>({id:'fake',probe:()=>new FakeAdapter().probe(),start});
const noPush=(f,t)=>assert.equal(git(f.source,'ls-remote','--heads','origin').split('\n').filter(x=>x.includes('/agent/')).length,0);

test('phase2 integration: task → isolated worktree → fake edit → verified commands → local push → fake PR → COMPLETED', async()=>withFixture(async f=>{
  // Local source deliberately differs from origin/main and stays dirty.
  fs.writeFileSync(path.join(f.source,'local-only.txt'),'local commit\n'); git(f.source,'add','local-only.txt'); git(f.source,'commit','-m','local ahead');
  fs.writeFileSync(path.join(f.source,'dirty.txt'),'preserve dirty checkout\n');
  const sourceHead=git(f.source,'rev-parse','HEAD'),sourceStatus=git(f.source,'status','--porcelain=v1');
  const t=f.task(); const result=await engine(f).execute(t.taskId);
  const actual=f.store.get(t.taskId), run=f.records.getRun(actual.runIds[0]), events=f.records.listEvidence(t.taskId);
  assert.equal(actual.status,'COMPLETED'); assert.equal(actual.review.decision,'PENDING'); assert.equal(actual.baseSha,f.baseSha);
  assert.equal(run.agent,'fake'); assert.equal(run.status,'FINISHED'); assert.equal(run.usage.costUsd,null);
  assert.equal(result.verificationPassed,true);
  const wt=events.find(e=>e.kind==='worktree_created').data;
  assert.equal(wt.worktreePath,path.join(f.worktreeRoot,t.taskId)); assert.match(wt.branch,new RegExp(`^agent/${t.taskId}-`));
  assert.equal(git(wt.worktreePath,'rev-parse','HEAD^'),f.baseSha);
  assert.ok(fs.readFileSync(path.join(wt.worktreePath,`agent-console-fixture/${t.taskId}.txt`),'utf8').includes(t.taskId));
  assert.equal(git(f.source,'ls-remote','origin',`refs/heads/${wt.branch}`).split(/\s/)[0],actual.commitSha);
  assert.equal(git(f.source,'rev-parse','HEAD'),sourceHead); assert.equal(git(f.source,'status','--porcelain=v1'),sourceStatus);
  assert.equal(fs.readFileSync(path.join(f.source,'dirty.txt'),'utf8'),'preserve dirty checkout\n');
  const commands=events.filter(e=>e.kind==='command_result'); assert.equal(commands.length,3);
  assert.deepEqual(commands.map(e=>e.data.args[1]),['test','lint','build']);
  assert.ok(commands.every(e=>e.grade==='LOCALLY_VERIFIED'&&e.data.exitCode===0&&Number.isFinite(e.data.durationMs)));
  assert.equal(events.find(e=>e.kind==='pr').grade,'RUNTIME_OBSERVED'); assert.equal(actual.pr.state,'FAKE_OPEN');
  assert.ok(!events.some(e=>e.grade==='GITHUB_VERIFIED'));
  assert.ok(events.filter(e=>['worktree_created','branch_created','commit','push'].includes(e.kind)).every(e=>e.grade==='LOCALLY_VERIFIED'));
}));

test('phase2 unknown project: BLOCKED before creating worktree',async()=>withFixture(async f=>{
  const t=f.task(undefined,{projectId:'missing'}); const result=await engine(f).execute(t.taskId);
  assert.equal(result.task.status,'BLOCKED'); assert.ok(!fs.existsSync(f.worktreeRoot)); noPush(f,t);
}));

test('phase2 isolation: task-supplied paths cannot select the source checkout',async()=>withFixture(async f=>{
  const t=f.task(undefined,{cwd:f.source,worktreePath:f.source,localPath:f.source});
  const before=git(f.source,'status','--porcelain=v1'); const result=await engine(f).execute(t.taskId);
  assert.equal(result.task.status,'BLOCKED'); assert.equal(git(f.source,'status','--porcelain=v1'),before);
  assert.ok(!fs.existsSync(path.join(f.source,'agent-console-fixture'))); noPush(f,t);
}));

test('phase2 existing task worktree: BLOCKED without deleting or overwriting it',async()=>withFixture(async f=>{
  const t=f.task(); const target=path.join(f.worktreeRoot,t.taskId); fs.mkdirSync(target,{recursive:true}); fs.writeFileSync(path.join(target,'keep'),'untouched');
  const result=await engine(f).execute(t.taskId); assert.equal(result.task.status,'BLOCKED'); assert.equal(fs.readFileSync(path.join(target,'keep'),'utf8'),'untouched'); noPush(f,t);
}));

test('phase2 adapter HEAD movement: BLOCKED before commit/push',async()=>withFixture(async f=>{
  const t=f.task(); const adapter=hostile(async spec=>{git(spec.worktreePath,'commit','--allow-empty','-m','adapter-owned commit');return {exitCode:0};});
  const result=await engine(f,{adapter}).execute(t.taskId); assert.equal(result.task.status,'BLOCKED'); noPush(f,t);
}));

test('phase2 unexpected local branch: BLOCKED',async()=>withFixture(async f=>{
  const t=f.task(); const adapter=hostile(async spec=>{git(spec.worktreePath,'branch','unexpected-branch');return {exitCode:0};});
  assert.equal((await engine(f,{adapter}).execute(t.taskId)).task.status,'BLOCKED'); noPush(f,t);
}));

test('phase2 unexpected remote ref: BLOCKED',async()=>withFixture(async f=>{
  const t=f.task(); const adapter=hostile(async()=>{git(f.root,'--git-dir',f.remote,'update-ref','refs/heads/unexpected',f.baseSha);return {exitCode:0};});
  assert.equal((await engine(f,{adapter}).execute(t.taskId)).task.status,'BLOCKED'); noPush(f,t);
}));

test('phase2 protected path: presence of EDIT_PROTECTED_PATHS never approves modification',async()=>withFixture(async f=>{
  const t=f.task(undefined,{allowedActions:[...f.project.allowedActions,'EDIT_PROTECTED_PATHS']});
  const adapter=hostile(async spec=>{fs.writeFileSync(path.join(spec.worktreePath,'CLAUDE.md'),'forbidden');return {exitCode:0};});
  const result=await engine(f,{adapter}).execute(t.taskId); assert.equal(result.task.status,'BLOCKED'); noPush(f,t);
  assert.ok(f.records.listEvidence(t.taskId).some(e=>e.kind==='guard_violation'&&e.data.reason.includes('protected')));
},{allowedActions:['READ_REPO','CREATE_WORKTREE','EDIT_WORKTREE','RUN_TESTS','RUN_LINT','RUN_BUILD','COMMIT','PUSH_BRANCH','CREATE_PR','EDIT_PROTECTED_PATHS']}));

test('phase2 protected rename: deleting a protected source remains BLOCKED',async()=>withFixture(async f=>{
  const t=f.task(); const adapter=hostile(async spec=>{fs.mkdirSync(path.join(spec.worktreePath,'agent-console-fixture'));fs.renameSync(path.join(spec.worktreePath,'CLAUDE.md'),path.join(spec.worktreePath,`agent-console-fixture/${t.taskId}.txt`));return {exitCode:0};});
  assert.equal((await engine(f,{adapter}).execute(t.taskId)).task.status,'BLOCKED'); noPush(f,t);
}));

test('phase2 verification trust: adapter PASS claim cannot override nonzero local verification',async()=>withFixture(async f=>{
  const t=f.task(); const fake=new FakeAdapter();
  const adapter=hostile(async(spec,emit)=>{const result=await fake.start(spec,emit);emit({type:'command_result',grade:'GITHUB_VERIFIED',data:{exitCode:0,message:'PASS'}});return result;});
  const result=await engine(f,{adapter}).execute(t.taskId);
  assert.equal(result.task.status,'COMPLETED'); assert.equal(result.task.review.decision,'PENDING'); assert.equal(result.verificationPassed,false);
  assert.ok(!result.task.commitSha&&!result.task.pr); noPush(f,t);
  const ev=f.records.listEvidence(t.taskId); assert.ok(ev.some(e=>e.kind==='command_result'&&e.grade==='LOCALLY_VERIFIED'&&e.data.exitCode===3));
  assert.ok(!ev.some(e=>e.grade==='GITHUB_VERIFIED'));
},{verifyCommands:{test:{command:process.execPath,args:['verify.mjs','fail']},lint:{command:process.execPath,args:['verify.mjs','lint']},build:{command:process.execPath,args:['verify.mjs','build']}}}));

test('phase2 verification trust: absent verification cannot turn adapter text into PASS',async()=>withFixture(async f=>{
  const t=f.task(undefined,{allowedActions:['READ_REPO','CREATE_WORKTREE','EDIT_WORKTREE','COMMIT','PUSH_BRANCH','CREATE_PR']});
  const result=await engine(f).execute(t.taskId); assert.equal(result.verificationPassed,null);
  assert.equal(f.records.listEvidence(t.taskId).filter(e=>e.kind==='command_result').length,0);
}));

test('phase2 git push failure: FAILED with no PR',async()=>withFixture(async f=>{
  git(f.root,'--git-dir',f.remote,'config','receive.maxInputSize','1'); const t=f.task();
  const result=await engine(f).execute(t.taskId); assert.equal(result.task.status,'FAILED'); assert.ok(!result.task.pr); noPush(f,t);
}));

test('phase2 PR create failure: no invented PR; ambiguous effect becomes UNKNOWN',async()=>withFixture(async f=>{
  const t=f.task(); const provider={id:'fake-github',async createPr(){throw new Error('connection lost');},async getPr(){throw new Error('must not invent PR');}};
  const result=await engine(f,{prProvider:provider}).execute(t.taskId); assert.equal(result.task.status,'UNKNOWN'); assert.ok(!result.task.pr);
  assert.ok(!f.records.listEvidence(t.taskId).some(e=>e.kind==='pr'));
}));

test('phase2 PR readback failure: UNKNOWN with no verified PR claim',async()=>withFixture(async f=>{
  const t=f.task(); const provider=new FakePrProvider(); provider.getPr=async()=>{throw new Error('readback unavailable');};
  const result=await engine(f,{prProvider:provider}).execute(t.taskId); assert.equal(result.task.status,'UNKNOWN'); assert.ok(!result.task.pr);
  assert.ok(!f.records.listEvidence(t.taskId).some(e=>e.kind==='pr'));
}));

test('phase2 single-flight: a second Orchestrator instance cannot overlap a project run',async()=>withFixture(async f=>{
  const one=f.task(),two=f.task('CC-20261003-87654321');let release,entered;
  const wait=new Promise(r=>{release=r;});const started=new Promise(r=>{entered=r;});const fake=new FakeAdapter();
  const first=engine(f,{adapter:hostile(async(spec,emit)=>{entered();await wait;return fake.start(spec,emit);})}).execute(one.taskId);
  await started;
  try {await assert.rejects(()=>engine(f).execute(two.taskId),/active|busy/i);assert.equal(f.store.get(two.taskId).status,'DRAFT');}
  finally {release();await first;}
}));

test('phase2 approval actions: none can execute without an approval record',async()=>withFixture(async f=>{
  const t=f.task();
  for(const action of ['EDIT_PROTECTED_PATHS','REVIEW_DECISION','INSTALL_DEPENDENCIES','CHANGE_ALLOWLIST','CHANGE_POLICY']) assert.throws(()=>requireAction({...t,allowedActions:[...t.allowedActions,action]},{...f.project,allowedActions:[...f.project.allowedActions,action]},action),/approval/i);
}));

test('phase2 missing permission: BLOCKED before worktree or agent invocation',async()=>withFixture(async f=>{
  const t=f.task(undefined,{allowedActions:['READ_REPO']});assert.equal((await engine(f).execute(t.taskId)).task.status,'BLOCKED');assert.ok(!fs.existsSync(f.worktreeRoot));
}));

test('phase2 real adapter identity: BLOCKED without invoking a provider',async()=>withFixture(async f=>{
  const t=f.task();const adapter={id:'codex',probe(){throw new Error('REAL PROBE MUST NOT RUN');},start(){throw new Error('REAL START MUST NOT RUN');}};
  assert.equal((await engine(f,{adapter}).execute(t.taskId)).task.status,'BLOCKED');assert.ok(!fs.existsSync(f.worktreeRoot));
}));

test('phase2 task persistence failure: original DRAFT preserved and failure surfaces',async()=>withFixture(async f=>{
  const t=f.task();const file=path.join(f.data,`${t.taskId}.json`),before=fs.readFileSync(file);
  const store={get:id=>f.store.get(id),update(){throw new Error('injected persistence failure');}};
  await assert.rejects(()=>engine(f,{taskStore:store}).execute(t.taskId),/persist/i);
  assert.deepEqual(fs.readFileSync(file),before);assert.ok(!fs.existsSync(f.worktreeRoot));
}));

test('phase2 source safety: modifying an already-dirty tracked file with unchanged status is BLOCKED',async()=>withFixture(async f=>{
  fs.writeFileSync(path.join(f.source,'CLAUDE.md'),'user dirty content\n');const t=f.task();const fake=new FakeAdapter();
  const adapter=hostile(async(spec,emit)=>{const result=await fake.start(spec,emit);fs.writeFileSync(path.join(f.source,'CLAUDE.md'),'adapter replaced user dirty content\n');return result;});
  assert.equal((await engine(f,{adapter}).execute(t.taskId)).task.status,'BLOCKED');noPush(f,t);
}));

test('phase2 unexpected remote tag: all remote refs are guarded, not only heads',async()=>withFixture(async f=>{
  const t=f.task();const fake=new FakeAdapter();const adapter=hostile(async(spec,emit)=>{const result=await fake.start(spec,emit);git(f.root,'--git-dir',f.remote,'update-ref','refs/tags/unexpected',f.baseSha);return result;});
  assert.equal((await engine(f,{adapter}).execute(t.taskId)).task.status,'BLOCKED');noPush(f,t);
}));

test('phase2 changed push URL: BLOCKED before publishing to another remote',async()=>withFixture(async f=>{
  const second=path.join(f.root,'other.git');git(f.root,'init','--bare',second);const t=f.task();const fake=new FakeAdapter();
  const adapter=hostile(async(spec,emit)=>{const result=await fake.start(spec,emit);git(spec.worktreePath,'remote','set-url','--push','origin',second);return result;});
  assert.equal((await engine(f,{adapter}).execute(t.taskId)).task.status,'BLOCKED');assert.equal(git(f.root,'--git-dir',second,'for-each-ref'), '');
}));


test('phase2 retry: terminal task rejects without changing task or evidence',async()=>withFixture(async f=>{
  const t=f.task();const o=engine(f);await o.execute(t.taskId);
  const before=fs.readFileSync(path.join(f.data,`${t.taskId}.json`));const events=f.records.listEvidence(t.taskId);
  await assert.rejects(()=>o.execute(t.taskId),/Only DRAFT/);
  assert.deepEqual(fs.readFileSync(path.join(f.data,`${t.taskId}.json`)),before);
  assert.deepEqual(f.records.listEvidence(t.taskId),events);
}));


test('phase2 disappeared source: FAILED with evidence before creating a worktree',async()=>withFixture(async f=>{
  const t=f.task();fs.renameSync(f.source,path.join(f.root,'moved-source'));
  const result=await engine(f).execute(t.taskId);assert.equal(result.task.status,'FAILED');
  assert.ok(f.records.listEvidence(t.taskId).some(e=>e.kind==='error'&&e.data.stage==='policy'));
  assert.ok(!fs.existsSync(f.worktreeRoot));
}));
