import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export class LocalGitError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'LocalGitError';
    this.kind = kind; // 'not_found' | 'no_upstream' | 'failed'
  }
}

function parsePorcelainV2(stdout) {
  const lines = stdout.split('\n').filter((line) => line.length > 0);
  let branch = null;
  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  let uncommittedCount = 0;

  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim();
    } else if (line.startsWith('# branch.upstream ')) {
      hasUpstream = true;
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (!line.startsWith('#')) {
      uncommittedCount += 1;
    }
  }

  return { branch, hasUpstream, ahead, behind, uncommittedCount };
}

/**
 * Read-only local git status for a project's on-disk clone: how far ahead/
 * behind its upstream it is, and how many files have uncommitted changes.
 * Never writes (no commit/push/pull/fetch) — this only ever calls `git status`.
 */
export function fetchLocalGitStatus(localPath, { execFileFn = execFile } = {}) {
  if (typeof localPath !== 'string' || localPath.trim() === '') {
    return Promise.reject(new LocalGitError('A local path is required.', 'failed'));
  }

  return new Promise((resolve, reject) => {
    execFileFn(
      'git',
      ['-C', localPath, 'status', '--porcelain=v2', '--branch'],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ENOENT') {
            reject(new LocalGitError('git was not found on the server PATH.', 'failed'));
            return;
          }
          if (/not a git repository|no such file or directory/i.test(stderr || '')) {
            reject(new LocalGitError(`"${localPath}" is not a git repository.`, 'not_found'));
            return;
          }
          reject(new LocalGitError((stderr || error.message || '').trim(), 'failed'));
          return;
        }

        const status = parsePorcelainV2(stdout);
        if (status.branch === null) {
          reject(new LocalGitError('Could not determine the current branch.', 'failed'));
          return;
        }
        if (!status.hasUpstream) {
          reject(
            new LocalGitError(
              `Branch "${status.branch}" has no upstream configured — cannot compare against the remote.`,
              'no_upstream',
            ),
          );
          return;
        }
        const { branch, ahead, behind, uncommittedCount } = status;
        resolve({ branch, ahead, behind, uncommittedCount });
      },
    );
  });
}

function execFileP(execFileFn, command, args) {
  return new Promise((resolve) => {
    execFileFn(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function defaultSearchRoots() {
  const fromEnv = process.env.COMMAND_CENTER_LOCAL_REPO_ROOTS;
  if (fromEnv) {
    const roots = fromEnv
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (roots.length > 0) return roots;
  }
  return [path.join(os.homedir(), 'Developer')];
}

function matchesRepoRemote(remoteUrl, repo) {
  const normalized = remoteUrl.trim().replace(/\.git$/, '').toLowerCase();
  const target = repo.toLowerCase();
  const candidates = [`https://github.com/${target}`, `git@github.com:${target}`, `ssh://git@github.com/${target}`];
  return candidates.includes(normalized);
}

/**
 * Best-effort search for a local clone of `repo` (an owner/repo slug) under
 * a bounded set of directories. Never throws — any failure (find/git
 * missing, permission-denied subdirs, no match) resolves to `null` so this
 * can never block a caller that treats it as an optional convenience.
 */
export async function findLocalClone(repo, { roots, execFileFn = execFile } = {}) {
  const searchRoots = roots && roots.length > 0 ? roots : defaultSearchRoots();

  // No `-type d` filter: a git worktree's ".git" is a plain file (pointing
  // at the main checkout's gitdir), not a directory — filtering by type
  // would silently skip worktrees, and `git -C <dir>` works fine against
  // either kind, so there's no reason to exclude them.
  const { stdout } = await execFileP(execFileFn, 'find', [...searchRoots, '-maxdepth', '4', '-name', '.git']);
  const gitDirs = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Collect every matching clone rather than returning the first one found:
  // a real machine can easily have more than one local clone of the same
  // repo (an old copy left behind, a second worktree, ...) and the one
  // `find` happens to list first is not necessarily the one actually in
  // use. Break ties by most recent commit — the clone someone is actively
  // working in is virtually always the one with the freshest history.
  const matches = [];
  for (const gitDir of gitDirs) {
    const cloneDir = gitDir.replace(/\/\.git$/, '');
    const { error, stdout: remoteOut } = await execFileP(execFileFn, 'git', ['-C', cloneDir, 'remote', 'get-url', 'origin']);
    if (error || !remoteOut.trim() || !matchesRepoRemote(remoteOut, repo)) continue;

    const { stdout: timeOut } = await execFileP(execFileFn, 'git', ['-C', cloneDir, 'log', '-1', '--format=%at']);
    const lastCommitAt = Number.parseInt(timeOut.trim(), 10) || 0;
    matches.push({ cloneDir, lastCommitAt });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.lastCommitAt - a.lastCommitAt);
  return matches[0].cloneDir;
}
