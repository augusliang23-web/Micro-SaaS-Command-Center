import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runProcess } from './processRunner.mjs';
import { BoundaryError, requireAction, assertPushBranch } from './executionPolicy.mjs';
import { TASK_ID_PATTERN } from '../tasks/types.mjs';

const split = text => text.split('\0').filter(Boolean);
function exists(file) { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function prospectiveRealPath(file) {
  let ancestor = path.resolve(file); const parts = [];
  while (!exists(ancestor)) { parts.unshift(path.basename(ancestor)); const parent = path.dirname(ancestor); if (parent === ancestor) throw new BoundaryError('No existing worktree root ancestor'); ancestor = parent; }
  return path.join(fs.realpathSync(ancestor), ...parts);
}
function isProtected(file, project) {
  return project.protectedPaths.some(raw => { const p = path.posix.normalize(raw).replace(/\/$/,''); return p === '.' || file === p || file.startsWith(`${p}/`); });
}
function within(parent, child) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }

export function taskWorktreePath(root, task) {
  if (typeof task.taskId !== 'string' || task.taskId.length !== 20 || !TASK_ID_PATTERN.test(task.taskId)) throw new BoundaryError('Invalid taskId');
  return path.join(root, task.taskId);
}

export class WorktreeManager {
  #contexts = new WeakSet(); #local; #runner;
  constructor({ allowLocalRemotes = false, runner = runProcess } = {}) { this.#local = allowLocalRemotes; this.#runner = runner; }
  async #git(cwd, args) {
    const result = await this.#runner({ command: '/usr/bin/git', args: ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgSign=false','-c','protocol.ext.allow=never', ...args], cwd });
    if (result.exitCode !== 0) throw new Error(`Git ${args[0]} failed (${result.exitCode ?? result.signal}): ${result.stderr.trim()}`);
    return result.stdout;
  }
  async #remote(project, source) {
    const fetch = (await this.#git(source, ['remote','get-url','origin'])).trim();
    const pushes = (await this.#git(source, ['remote','get-url','--push','--all','origin'])).trim().split('\n');
    if (pushes.length !== 1 || pushes[0] !== fetch) throw new BoundaryError('Unexpected remote push target');
    const https = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+?)(?:\.git)?$/.exec(fetch);
    const ssh = /^git@github\.com:([^\s]+\/[^\s]+?)(?:\.git)?$/.exec(fetch);
    const remoteRepository = https?.[1] ?? ssh?.[1];
    const local = path.isAbsolute(fetch) || fetch.startsWith('file:///');
    if (remoteRepository !== project.repository && !(this.#local && local)) throw new BoundaryError('Remote does not match registered repository');
    return fetch;
  }
  async #branches(source) { return await this.#git(source, ['for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/tags']); }
  async #remoteHeads(source) { return await this.#git(source, ['ls-remote','--refs','origin']); }
  async #sourceFingerprint(source, project) {
    const hash = createHash('sha256');
    for (const args of [
      ['diff','--binary','--no-ext-diff','--no-textconv','--cached','HEAD','--'],
      ['diff','--binary','--no-ext-diff','--no-textconv','--'],
    ]) hash.update(await this.#git(source,args)).update('\0');
    const untracked = split(await this.#git(source,['ls-files','--others','--exclude-standard','-z']));
    // Preserve ignored user/governance files without hashing dependency caches.
    const protectedIgnored = split(await this.#git(source,['ls-files','--others','--ignored','--exclude-standard','-z'])).filter(file => isProtected(file,project));
    for (const file of [...new Set([...untracked,...protectedIgnored])].sort()) {
      const target = path.join(source,file); const stat = fs.lstatSync(target);
      hash.update(file).update('\0').update(String(stat.mode)).update('\0');
      hash.update(stat.isSymbolicLink() ? fs.readlinkSync(target) : fs.readFileSync(target)).update('\0');
    }
    return hash.digest('hex');
  }
  async prepare(project, task, persistBase = () => {}) {
    if (typeof task.taskId !== 'string' || !TASK_ID_PATTERN.test(task.taskId)) throw new BoundaryError('Invalid taskId');
    if (Object.keys(task).some(k => /cwd|localPath|worktreePath|binaryPath|filesystemPath|executionBranch/.test(k))) throw new BoundaryError('Task cannot select worktree or source path');
    requireAction(task, project, 'READ_REPO'); requireAction(task, project, 'CREATE_WORKTREE');
    const source = fs.realpathSync(project.localPath);
    if (fs.realpathSync((await this.#git(source, ['rev-parse','--show-toplevel'])).trim()) !== source) throw new BoundaryError('Registered path is not the repository root');
    const root = prospectiveRealPath(project.worktreeRoot);
    if (within(source, root)) throw new BoundaryError('Worktree root must be outside source checkout');
    const worktreePath = taskWorktreePath(root, task);
    if (exists(worktreePath)) throw new BoundaryError('Task worktree already exists unexpectedly');
    const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32) || 'task';
    const branch = `agent/${task.taskId}-${slug}`; assertPushBranch(branch, task.taskId);
    await this.#git(source, ['check-ref-format','--branch',branch]);
    const remote = await this.#remote(project, source);
    const sourceHead = (await this.#git(source, ['rev-parse','HEAD'])).trim();
    const sourceStatus = await this.#git(source, ['status','--porcelain=v1','-z','--untracked-files=all']);
    const sourceFingerprint = await this.#sourceFingerprint(source,project);
    const branchesBefore = await this.#branches(source);
    const remoteBefore = await this.#remoteHeads(source);
    if (branchesBefore.split('\n').some(line => line.startsWith(`refs/heads/${branch} `)) || remoteBefore.includes(`refs/heads/${branch}\n`)) throw new BoundaryError('Task branch already exists unexpectedly');
    await this.#git(source, ['fetch','--no-tags','origin',`+refs/heads/${project.defaultBranch}:refs/remotes/origin/${project.defaultBranch}`]);
    const baseSha = (await this.#git(source, ['rev-parse','--verify',`refs/remotes/origin/${project.defaultBranch}^{commit}`])).trim();
    if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new BoundaryError('Unresolved base SHA');
    // Durable task identity must exist before creating either branch or worktree.
    await persistBase(baseSha);
    fs.mkdirSync(root, { recursive: true });
    if (fs.realpathSync(project.worktreeRoot) !== root) throw new BoundaryError('Worktree root changed during preparation');
    await this.#git(source, ['worktree','add','-b',branch,worktreePath,baseSha]);
    const context = { source, root, worktreePath, branch, baseSha, expectedHead: baseSha, sourceHead, sourceStatus, sourceFingerprint, remote, remoteBefore, branchesBefore, taskId: task.taskId, fixturePath: `agent-console-fixture/${task.taskId}.txt` };
    this.#contexts.add(context);
    await this.guard(context, project);
    return context;
  }
  async changedPaths(context) {
    const tracked = split(await this.#git(context.worktreePath, ['diff','--no-ext-diff','--no-textconv','--name-only','--no-renames','-z',context.baseSha,'--']));
    const others = split(await this.#git(context.worktreePath, ['ls-files','--others','-z']));
    return [...new Set([...tracked, ...others])];
  }
  async guard(context, project) {
    if (!this.#contexts.has(context)) throw new BoundaryError('Unrecognized worktree context');
    if (fs.realpathSync(project.localPath) !== context.source || fs.realpathSync(project.worktreeRoot) !== context.root || fs.realpathSync(context.worktreePath) !== path.join(context.root,context.taskId)) throw new BoundaryError('Worktree path or repository changed');
    if (fs.realpathSync((await this.#git(context.worktreePath, ['rev-parse','--show-toplevel'])).trim()) !== context.worktreePath) throw new BoundaryError('Wrong worktree');
    const common = (await this.#git(context.worktreePath,['rev-parse','--path-format=absolute','--git-common-dir'])).trim();
    const sourceCommon = (await this.#git(context.source,['rev-parse','--path-format=absolute','--git-common-dir'])).trim();
    if (fs.realpathSync(common) !== fs.realpathSync(sourceCommon)) throw new BoundaryError('Worktree is not the registered repository');
    if ((await this.#git(context.worktreePath,['rev-parse','HEAD'])).trim() !== context.expectedHead) throw new BoundaryError('Adapter moved HEAD');
    if ((await this.#git(context.worktreePath,['branch','--show-current'])).trim() !== context.branch) throw new BoundaryError('Unexpected task branch');
    if ((await this.#git(context.source,['rev-parse','HEAD'])).trim() !== context.sourceHead || await this.#git(context.source,['status','--porcelain=v1','-z','--untracked-files=all']) !== context.sourceStatus) throw new BoundaryError('Source checkout changed');
    if (await this.#sourceFingerprint(context.source,project) !== context.sourceFingerprint) throw new BoundaryError('Source checkout content changed');
    if (await this.#remote(project,context.source) !== context.remote) throw new BoundaryError('Remote target changed');
    const branches = (await this.#branches(context.source)).split('\n').filter(line => line && !line.startsWith(`refs/heads/${context.branch} `)).join('\n');
    if (branches !== context.branchesBefore.trim()) throw new BoundaryError('Unexpected local branch or branch movement');
    if (await this.#remoteHeads(context.source) !== context.remoteBefore) throw new BoundaryError('Unexpected remote ref');
    const changes = await this.changedPaths(context);
    const protectedPath = changes.find(file => isProtected(file,project));
    if (protectedPath) throw new BoundaryError(`Changed protected path: ${protectedPath}`);
    const unexpected = changes.find(file => file !== context.fixturePath);
    if (unexpected) throw new BoundaryError(`Fake adapter changed an unexpected path: ${unexpected}`);
    return changes;
  }
  async commit(context, task, project) {
    requireAction(task,project,'COMMIT'); await this.guard(context,project);
    await this.#git(context.worktreePath,['add','--',context.fixturePath]);
    await this.#git(context.worktreePath,['commit','-m',`Agent Console ${task.taskId}: deterministic fixture edit`]);
    const sha = (await this.#git(context.worktreePath,['rev-parse','HEAD'])).trim();
    if ((await this.#git(context.worktreePath,['rev-parse','HEAD^'])).trim() !== context.baseSha) throw new BoundaryError('Unexpected commit parent');
    context.expectedHead = sha; await this.guard(context,project);
    return sha;
  }
  async push(context, task, project) {
    requireAction(task,project,'PUSH_BRANCH'); assertPushBranch(context.branch,task.taskId); await this.guard(context,project);
    await this.#git(context.worktreePath,['push','origin',`refs/heads/${context.branch}:refs/heads/${context.branch}`]);
    const actual = await this.#remoteHeads(context.source);
    const lines = actual.split('\n').filter(Boolean); const own = lines.find(line => line.endsWith(`\trefs/heads/${context.branch}`));
    if (!own || own.split('\t')[0] !== context.expectedHead || lines.filter(line=>line!==own).join('\n') !== context.remoteBefore.trim()) throw new BoundaryError('Remote push readback did not match task commit');
    context.remoteBefore = actual;
    await this.guard(context,project);
    return context.expectedHead;
  }
}
