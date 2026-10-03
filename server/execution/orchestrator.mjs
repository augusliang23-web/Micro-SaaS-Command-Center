import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { BoundaryError, requireAction, validateExecutionTask } from './executionPolicy.mjs';
import { WorktreeManager } from './worktreeManager.mjs';
import { FakeAdapter } from './fakeAdapter.mjs';
import { FakePrProvider } from './fakePrProvider.mjs';
import { runVerification } from './verificationRunner.mjs';
import { unavailableUsage } from '../tasks/types.mjs';

// Shared across Orchestrator instances, scoped to the physical registered repo.
// Not a distributed lock; persisted live states recover to UNKNOWN on restart.
const activeProjects = new Map();
class PersistenceFailure extends Error {
  constructor(cause) { super(`Execution persistence failed: ${cause.message}`, { cause }); this.code = 'PERSISTENCE_FAILED'; }
}
const persist = action => { try { return action(); } catch (error) { throw new PersistenceFailure(error); } };

/** Internal-only engine. No route mounts this module or calls execute(). */
export class Orchestrator {
  #registry; #tasks; #records; #worktrees; #adapter; #prs; #now;
  constructor({ registry, taskStore, executionStore, worktreeManager = new WorktreeManager(), adapter = new FakeAdapter(), prProvider = new FakePrProvider(), now = () => new Date().toISOString() }) {
    this.#registry = registry; this.#tasks = taskStore; this.#records = executionStore; this.#worktrees = worktreeManager; this.#adapter = adapter; this.#prs = prProvider; this.#now = now;
  }
  async execute(taskId) {
    let task = this.#tasks.get(taskId);
    if (!task) throw new BoundaryError('Task not found');
    if (task.status !== 'DRAFT') throw new BoundaryError('Only DRAFT tasks can start; retry is not implemented');
    const project = this.#registry.get(task.projectId);
    let lockKey, lease;
    let run, context, stage = 'policy', verification = null;
    const record = (kind, grade, data) => persist(() => this.#records.appendEvidence({ evidenceId: `EV-${randomBytes(16).toString('hex')}`, taskId, ...(run ? {runId:run.runId} : {}), kind, grade, data, observedAt: this.#now() }));
    const update = patch => { task = persist(() => this.#tasks.update(taskId,{...patch,updatedAt:this.#now()})); return task; };
    const saveRun = patch => { run = persist(() => this.#records.saveRun({ ...run, ...patch })); };
    try {
      lockKey = project ? fs.realpathSync(project.localPath) : `unknown:${task.projectId}`;
      if (activeProjects.has(lockKey)) {
        const busy = new BoundaryError('Project already has an active execution (busy)');
        busy.code = 'PROJECT_BUSY'; throw busy;
      }
      lease = Symbol(taskId); activeProjects.set(lockKey,lease);
      validateExecutionTask(task,project);
      if (this.#adapter.id !== 'fake' || this.#prs.id !== 'fake-github') throw new BoundaryError('Phase 2 only permits internal fake adapter and fake PR provider');
      const probe = await this.#adapter.probe();
      if (probe.id !== 'fake' || probe.available !== true || probe.capabilities?.editOnly !== true || ['shell','git','network'].some(k=>probe.capabilities[k] !== false)) throw new BoundaryError('Fake adapter probe failed closed');
      update({status:'QUEUED'});
      const startedAt = this.#now();
      update({status:'STARTING',startedAt});
      const runId = `RUN-${startedAt.slice(0,10).replaceAll('-','')}-${randomBytes(4).toString('hex')}`;
      saveRun({runId,taskId,agent:'fake',adapterVersion:probe.version,status:'STARTING',startedAt,usage:unavailableUsage()});
      update({runIds:[...task.runIds,runId]});
      stage = 'worktree'; context = await this.#worktrees.prepare(project,task,baseSha => update({baseSha}));
      record('worktree_created','LOCALLY_VERIFIED',{worktreePath:context.worktreePath,branch:context.branch,baseSha:context.baseSha});
      record('branch_created','LOCALLY_VERIFIED',{branch:context.branch,baseSha:context.baseSha});
      update({status:'RUNNING'}); saveRun({status:'RUNNING'});
      stage = 'adapter';
      const result = await this.#adapter.start({taskId,worktreePath:context.worktreePath,fixturePath:context.fixturePath}, event => {
        // Adapter event kinds, grades, PASS claims and paths are never authority.
        record(event?.type === 'files_changed' ? 'files_changed' : 'agent_report','RUNTIME_OBSERVED',{source:'fake-adapter',event});
      });
      if (result?.exitCode !== 0) { saveRun({status:'FAILED',exitCode:result?.exitCode,endedAt:this.#now()}); throw new Error('Fake adapter did not finish normally'); }
      saveRun({status:'FINISHED',exitCode:0,endedAt:this.#now()});
      stage = 'guard'; await this.#worktrees.guard(context,project);
      update({status:'VERIFYING'});
      stage = 'verification'; verification = await runVerification({task,project,worktreePath:context.worktreePath,record});
      await this.#worktrees.guard(context,project);
      if (verification.passed === false) {
        update({status:'COMPLETED',completedAt:this.#now()});
        return {task,verificationPassed:false};
      }
      stage = 'commit'; requireAction(task,project,'COMMIT');
      const commitSha = await this.#worktrees.commit(context,task,project);
      record('commit','LOCALLY_VERIFIED',{commitSha,branch:context.branch}); update({commitSha});
      stage = 'push'; requireAction(task,project,'PUSH_BRANCH');
      const remoteSha = await this.#worktrees.push(context,task,project);
      record('push','LOCALLY_VERIFIED',{branch:context.branch,commitSha:remoteSha,remote:context.remote});
      requireAction(task,project,'CREATE_PR');
      stage = 'pr';
      const spec = {taskId,repository:project.repository,baseBranch:project.defaultBranch,headBranch:context.branch,headSha:commitSha,title:`${taskId}: ${task.title}`};
      const created = await this.#prs.createPr(spec);
      const readback = await this.#prs.getPr({repository:project.repository,number:created.number});
      if (readback.repository !== spec.repository || readback.baseBranch !== spec.baseBranch || readback.headBranch !== spec.headBranch || readback.headSha !== commitSha || readback.number !== created.number || !Number.isInteger(readback.number) || readback.number < 1 || readback.state !== 'FAKE_OPEN' || !readback.url?.startsWith('fake://github/')) throw new Error('PR readback does not match task identity');
      const verifiedAt = this.#now();
      record('pr','RUNTIME_OBSERVED',{provider:'fake-github',...readback,verifiedAt});
      update({pr:{number:readback.number,url:readback.url,state:readback.state,verifiedAt}});
      update({status:'COMPLETED',completedAt:this.#now()});
      return {task,verificationPassed:verification.passed};
    } catch (error) {
      if (error.code === 'PROJECT_BUSY') throw error; // A rejected concurrent request never changes its DRAFT task.
      if (error instanceof PersistenceFailure) throw error; // Preserve the last durable task, never fabricate a terminal write.
      const status = stage === 'pr' ? (error.definitelyNotCreated === true ? 'FAILED' : 'UNKNOWN') : error instanceof BoundaryError ? 'BLOCKED' : 'FAILED';
      record(error instanceof BoundaryError ? 'guard_violation' : 'error','RUNTIME_OBSERVED',{stage,reason:error.message});
      if (run && ['STARTING','RUNNING'].includes(run.status)) saveRun({status:status === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED',endedAt:this.#now()});
      update({status,completedAt:this.#now()});
      return {task,verificationPassed:verification?.passed ?? null};
    } finally { if (lease && activeProjects.get(lockKey) === lease) activeProjects.delete(lockKey); }
  }
}
