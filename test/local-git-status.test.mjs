import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchLocalGitStatus, LocalGitError } from '../server/localGitStatus.mjs';

function porcelain({ branch = 'main', upstream = 'origin/main', ahead = 0, behind = 0, files = [] } = {}) {
  const lines = ['# branch.oid abc123', `# branch.head ${branch}`];
  if (upstream) lines.push(`# branch.upstream ${upstream}`, `# branch.ab +${ahead} -${behind}`);
  for (const file of files) {
    lines.push(`1 .M N... 100644 100644 100644 abc123 abc123 ${file}`);
  }
  return lines.join('\n') + '\n';
}

test('fetchLocalGitStatus reports a clean, in-sync branch', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback(null, porcelain(), '');
  };
  const status = await fetchLocalGitStatus('/repo', { execFileFn });
  assert.deepEqual(status, { branch: 'main', ahead: 0, behind: 0, uncommittedCount: 0 });
});

test('fetchLocalGitStatus reports commits ahead of the remote', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback(null, porcelain({ ahead: 2 }), '');
  };
  const status = await fetchLocalGitStatus('/repo', { execFileFn });
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 0);
});

test('fetchLocalGitStatus reports commits behind the remote', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback(null, porcelain({ behind: 3 }), '');
  };
  const status = await fetchLocalGitStatus('/repo', { execFileFn });
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 3);
});

test('fetchLocalGitStatus reports uncommitted file changes', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback(null, porcelain({ files: ['src/foo.ts', 'src/bar.ts'] }), '');
  };
  const status = await fetchLocalGitStatus('/repo', { execFileFn });
  assert.equal(status.uncommittedCount, 2);
});

test('fetchLocalGitStatus passes "git -C <path> status --porcelain=v2 --branch"', async () => {
  let capturedArgs;
  const execFileFn = (command, args, options, callback) => {
    capturedArgs = args;
    callback(null, porcelain(), '');
  };
  await fetchLocalGitStatus('/my/repo', { execFileFn });
  assert.deepEqual(capturedArgs, ['-C', '/my/repo', 'status', '--porcelain=v2', '--branch']);
});

test('fetchLocalGitStatus rejects with "not_found" when the path is not a git repository', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback(
      { code: 1 },
      '',
      'fatal: not a git repository (or any of the parent directories): .git',
    );
  };
  await assert.rejects(fetchLocalGitStatus('/not/a/repo', { execFileFn }), (error) => {
    assert.ok(error instanceof LocalGitError);
    assert.equal(error.kind, 'not_found');
    return true;
  });
});

test('fetchLocalGitStatus rejects with "no_upstream" when the branch has no upstream configured', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback(null, porcelain({ upstream: null }), '');
  };
  await assert.rejects(fetchLocalGitStatus('/repo', { execFileFn }), (error) => {
    assert.ok(error instanceof LocalGitError);
    assert.equal(error.kind, 'no_upstream');
    return true;
  });
});

test('fetchLocalGitStatus rejects without shelling out when no path is given', async () => {
  await assert.rejects(
    fetchLocalGitStatus('', {
      execFileFn: () => {
        throw new Error('should not be called');
      },
    }),
    (error) => {
      assert.ok(error instanceof LocalGitError);
      assert.equal(error.kind, 'failed');
      return true;
    },
  );
});
