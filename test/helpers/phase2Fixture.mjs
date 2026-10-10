import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ProjectRegistry } from '../../server/tasks/projectRegistry.mjs';
import { TaskStore } from '../../server/tasks/taskStore.mjs';
import { ExecutionStore } from '../../server/tasks/executionStore.mjs';
import { createDraftTask } from '../../server/tasks/types.mjs';
export function git(cwd, ...args) { return execFileSync('/usr/bin/git', ['-c','core.hooksPath=/dev/null',...args], {cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); }
export async function withFixture(fn, overrides = {}, { keepRoot } = {}) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cc-p2-integration-')));
  const source=path.join(root,'source'), remote=path.join(root,'remote.git'), worktreeRoot=path.join(root,'worktrees'), data=path.join(root,'data');
  fs.mkdirSync(source); git(root,'init','--bare',remote); git(source,'init','-b','main');
  git(source,'config','user.name','Scratch Tests'); git(source,'config','user.email','scratch@example.invalid');
  fs.writeFileSync(path.join(source,'CLAUDE.md'),'protected original\n');
  fs.writeFileSync(path.join(source,'verify.mjs'),"console.log('checked '+process.argv[2]); process.exit(process.argv[2]==='fail'?3:0);\n");
  git(source,'add','--all'); git(source,'commit','-m','scratch baseline'); git(source,'remote','add','origin',remote); git(source,'push','-u','origin','main');
  const baseSha=git(source,'rev-parse','HEAD');
  const command=(stage)=>({command:process.execPath,args:['verify.mjs',stage]});
  const project={projectId:'scratch',repository:'scratch/demo',localPath:source,defaultBranch:'main',worktreeRoot,allowedAgents:['codex','claude-code'],allowedActions:['READ_REPO','CREATE_WORKTREE','EDIT_WORKTREE','RUN_TESTS','RUN_LINT','RUN_BUILD','COMMIT','PUSH_BRANCH','CREATE_PR'],verifyCommands:{test:command('test'),lint:command('lint'),build:command('build')},setupCommand:'DO_NOT_EXECUTE_SETUP',protectedPaths:['CLAUDE.md','.env','.github/workflows'],agentBinaries:{},...overrides};
  const registry=new ProjectRegistry({projects:[project]}); const store=new TaskStore({dir:data}); const records=new ExecutionStore({dir:data});
  function task(id='CC-20261003-12345678', patch={}) { const t=createDraftTask({taskId:id,input:{workstream:'general',title:'Fixture edit',goal:'Only scratch work',agent:'codex',executionProfile:'STANDARD',risk:'LOW',requestedActions:project.allowedActions.filter(a=>!['EDIT_PROTECTED_PATHS','INSTALL_DEPENDENCIES'].includes(a))},project:registry.get('scratch'),now:'2026-10-03T00:00:00.000Z'}); store.create({...t,...patch}); return store.get(id); }
  try { return await fn({root,source,remote,worktreeRoot,data,baseSha,project:registry.get('scratch'),registry,store,records,task,command}); }
  finally { if (!(typeof keepRoot === 'function' && keepRoot() === true)) fs.rmSync(root,{recursive:true,force:true}); } // keepRoot is opt-in (Phase 3B7B2A): every other caller still removes its root unconditionally
}
