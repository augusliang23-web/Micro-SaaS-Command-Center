import { execFile } from 'node:child_process';

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
