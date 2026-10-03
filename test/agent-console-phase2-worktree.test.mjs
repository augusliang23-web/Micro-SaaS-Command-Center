import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { withFixture, git } from './helpers/phase2Fixture.mjs';
import { WorktreeManager } from '../server/execution/worktreeManager.mjs';
const manager=()=>new WorktreeManager({allowLocalRemotes:true});

test('worktree isolation: a registry root inside source or symlinked into source fails before creation',async()=>withFixture(async f=>{
  const t=f.task();const inside=path.join(f.source,'nested-worktrees');
  await assert.rejects(()=>manager().prepare({...f.project,worktreeRoot:inside},t),/outside source/);
  assert.ok(!fs.existsSync(inside));const link=path.join(f.root,'source-alias');fs.symlinkSync(f.source,link);
  await assert.rejects(()=>manager().prepare({...f.project,worktreeRoot:link},t),/outside source/);
  assert.equal(git(f.source,'status','--porcelain=v1'),'');
}));

test('worktree isolation: existing local or remote task branches fail closed',async()=>withFixture(async f=>{
  const t=f.task();const branch=`agent/${t.taskId}-fixture-edit`;
  git(f.source,'branch',branch);await assert.rejects(()=>manager().prepare(f.project,t),/branch already exists/);
  git(f.source,'branch','-D',branch);git(f.root,'--git-dir',f.remote,'update-ref',`refs/heads/${branch}`,f.baseSha);
  await assert.rejects(()=>manager().prepare(f.project,t),/branch already exists/);
  assert.ok(!fs.existsSync(path.join(f.worktreeRoot,t.taskId)));
}));

test('worktree identity: redirecting a managed context to source is rejected',async()=>withFixture(async f=>{
  const t=f.task();const m=manager();const ctx=await m.prepare(f.project,t);ctx.worktreePath=f.source;
  await assert.rejects(()=>m.guard(ctx,f.project),/path|worktree/);
}));

test('protected guard: ignored .env remains protected',async()=>withFixture(async f=>{
  const t=f.task();const m=manager();const ctx=await m.prepare(f.project,t);
  fs.writeFileSync(path.join(ctx.worktreePath,'.gitignore'),'.env\n');fs.writeFileSync(path.join(ctx.worktreePath,'.env'),'fixture only\n');
  await assert.rejects(()=>m.guard(ctx,f.project),/protected path: \.env/);
}));

test('push restriction: actual push method rejects main before invoking git push',async()=>withFixture(async f=>{
  const t=f.task();const m=manager();const ctx=await m.prepare(f.project,t);ctx.branch='main';
  const before=git(f.source,'ls-remote','--refs','origin');await assert.rejects(()=>m.push(ctx,t,f.project),/generated agent/);
  assert.equal(git(f.source,'ls-remote','--refs','origin'),before);
}));

test('remote identity: local fixture transport requires an explicit internal override',async()=>withFixture(async f=>{
  const t=f.task();await assert.rejects(()=>new WorktreeManager().prepare(f.project,t),/registered repository/);
  assert.ok(!fs.existsSync(f.worktreeRoot));
}));

test('source safety: untracked content changes with the same status are detected',async()=>withFixture(async f=>{
  const untracked=path.join(f.source,'user-notes.txt');fs.writeFileSync(untracked,'original notes');const t=f.task();const m=manager();const ctx=await m.prepare(f.project,t);
  fs.writeFileSync(untracked,'changed notes');await assert.rejects(()=>m.guard(ctx,f.project),/content changed/);
}));


test('HEAD guard: adapter commit is rejected even when only the task branch moved',async()=>withFixture(async f=>{
  const t=f.task();const m=manager();const ctx=await m.prepare(f.project,t);
  git(ctx.worktreePath,'commit','--allow-empty','-m','adapter commit');
  await assert.rejects(()=>m.guard(ctx,f.project),/moved HEAD/);
}));

test('protected guard: registry can protect the normally allowed fixture directory',async()=>withFixture(async f=>{
  const t=f.task();const m=manager();const ctx=await m.prepare(f.project,t);
  fs.mkdirSync(path.join(ctx.worktreePath,'agent-console-fixture'));
  fs.writeFileSync(path.join(ctx.worktreePath,ctx.fixturePath),'fixture');
  await assert.rejects(()=>m.guard(ctx,f.project),/protected path/);
},{protectedPaths:['./agent-console-fixture/']}));


test('base persistence: exact fetched SHA is persisted before any task branch or worktree exists',async()=>withFixture(async f=>{
  const t=f.task();const m=manager();let seen=false;
  const ctx=await m.prepare(f.project,t,sha=>{
    seen=true;assert.equal(sha,f.baseSha);assert.ok(!fs.existsSync(path.join(f.worktreeRoot,t.taskId)));
    assert.ok(!git(f.source,'for-each-ref','refs/heads/agent/'));
    f.store.update(t.taskId,{baseSha:sha});
  });
  assert.ok(seen);assert.equal(f.store.get(t.taskId).baseSha,ctx.baseSha);
}));

test('base persistence: failure stops before branch/worktree creation',async()=>withFixture(async f=>{
  const t=f.task();const m=manager();await assert.rejects(()=>m.prepare(f.project,t,()=>{throw new Error('base persistence failure');}),/base persistence failure/);
  assert.ok(!fs.existsSync(path.join(f.worktreeRoot,t.taskId)));assert.ok(!git(f.source,'for-each-ref','refs/heads/agent/'));
}));


test('source safety: changed or newly created ignored protected files are detected',async()=>withFixture(async f=>{
  fs.writeFileSync(path.join(f.source,'.gitignore'),'.env\n');git(f.source,'add','.gitignore');git(f.source,'commit','-m','ignore local environment');
  const t=f.task();const m=manager();const ctx=await m.prepare(f.project,t);
  fs.writeFileSync(path.join(f.source,'.env'),'original private fixture');
  await assert.rejects(()=>m.guard(ctx,f.project),/content changed/);
  const next=f.task('CC-20261003-11112222');const nextCtx=await m.prepare(f.project,next);
  fs.writeFileSync(path.join(f.source,'.env'),'modified private fixture');
  await assert.rejects(()=>m.guard(nextCtx,f.project),/content changed/);
}));
