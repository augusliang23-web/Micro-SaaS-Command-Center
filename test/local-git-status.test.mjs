import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchLocalGitStatus, findLocalClone, fetchLocalDiff, LocalGitError } from '../server/localGitStatus.mjs';

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

test('fetchLocalGitStatus fetches from the remote before checking status', async () => {
  const calls = [];
  const execFileFn = (command, args, options, callback) => {
    calls.push(args);
    callback(null, porcelain(), '');
  };
  await fetchLocalGitStatus('/repo', { execFileFn });
  assert.deepEqual(calls[0], ['-C', '/repo', 'fetch', '--quiet']);
  assert.deepEqual(calls[1], ['-C', '/repo', 'status', '--porcelain=v2', '--branch']);
});

test('fetchLocalGitStatus still returns status when fetch fails (e.g. offline), flagged as fetchFailed', async () => {
  const execFileFn = (command, args, options, callback) => {
    if (args.includes('fetch')) {
      callback({ code: 1 }, '', 'fatal: unable to access: Could not resolve host: github.com');
      return;
    }
    callback(null, porcelain({ ahead: 1 }), '');
  };
  const status = await fetchLocalGitStatus('/repo', { execFileFn });
  assert.equal(status.ahead, 1);
  assert.equal(status.fetchFailed, true);
});

test('fetchLocalGitStatus does not set fetchFailed when fetch succeeds', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback(null, porcelain(), '');
  };
  const status = await fetchLocalGitStatus('/repo', { execFileFn });
  assert.equal(status.fetchFailed, undefined);
});

test('fetchLocalGitStatus rejects with "not_found" when fetch itself reports not a git repository', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback({ code: 1 }, '', 'fatal: not a git repository (or any of the parent directories): .git');
  };
  await assert.rejects(fetchLocalGitStatus('/not/a/repo', { execFileFn }), (error) => {
    assert.ok(error instanceof LocalGitError);
    assert.equal(error.kind, 'not_found');
    return true;
  });
});

test('fetchLocalDiff returns both the unpushed and uncommitted diff content', async () => {
  const execFileFn = (command, args, options, callback) => {
    if (args.includes('@{upstream}...HEAD')) {
      callback(null, 'diff --git a/x b/x\n+unpushed change\n', '');
      return;
    }
    callback(null, 'diff --git a/y b/y\n+uncommitted change\n', '');
  };
  const diff = await fetchLocalDiff('/repo', { execFileFn });
  assert.match(diff.unpushedDiff, /unpushed change/);
  assert.match(diff.uncommittedDiff, /uncommitted change/);
  assert.equal(diff.unpushedTruncated, false);
  assert.equal(diff.uncommittedTruncated, false);
});

test('fetchLocalDiff never throws — a failing side just yields empty diff content', async () => {
  const execFileFn = (command, args, options, callback) => {
    if (args.includes('@{upstream}...HEAD')) {
      callback({ code: 128 }, '', 'fatal: no upstream configured for branch');
      return;
    }
    callback(null, 'diff --git a/y b/y\n+uncommitted change\n', '');
  };
  const diff = await fetchLocalDiff('/repo', { execFileFn });
  assert.equal(diff.unpushedDiff, '');
  assert.match(diff.uncommittedDiff, /uncommitted change/);
});

test('fetchLocalDiff truncates diff content beyond the size cap', async () => {
  const bigDiff = 'x'.repeat(20000);
  const execFileFn = (command, args, options, callback) => {
    callback(null, bigDiff, '');
  };
  const diff = await fetchLocalDiff('/repo', { execFileFn });
  assert.equal(diff.unpushedTruncated, true);
  assert.equal(diff.uncommittedTruncated, true);
  assert.ok(diff.unpushedDiff.length < bigDiff.length);
});

test('findLocalClone finds the clone whose origin remote matches the repo', async () => {
  const execFileFn = (command, args, options, callback) => {
    if (command === 'find') {
      callback(null, '/root/other/.git\n/root/my-repo/.git\n', '');
      return;
    }
    const dir = args[args.indexOf('-C') + 1];
    if (args.includes('log')) {
      callback(null, '1700000000\n', '');
      return;
    }
    if (dir === '/root/other') {
      callback(null, 'https://github.com/someone/else.git\n', '');
    } else if (dir === '/root/my-repo') {
      callback(null, 'https://github.com/me/my-repo.git\n', '');
    } else {
      callback(new Error(`unexpected dir: ${dir}`), '', '');
    }
  };
  const result = await findLocalClone('me/my-repo', { roots: ['/root'], execFileFn });
  assert.equal(result, '/root/my-repo');
});

test('findLocalClone matches an ssh-style remote URL', async () => {
  const execFileFn = (command, args, options, callback) => {
    if (command === 'find') {
      callback(null, '/root/my-repo/.git\n', '');
      return;
    }
    if (args.includes('log')) {
      callback(null, '1700000000\n', '');
      return;
    }
    callback(null, 'git@github.com:me/my-repo.git\n', '');
  };
  const result = await findLocalClone('me/my-repo', { roots: ['/root'], execFileFn });
  assert.equal(result, '/root/my-repo');
});

test('findLocalClone prefers the most recently committed-to clone when multiple local clones match', async () => {
  // Real-world case caught during manual verification: pm-dashboard-uat existed at
  // two local paths, one 3 weeks stale and one with a commit from 2 hours ago —
  // "first match wins" silently picked the stale one.
  const execFileFn = (command, args, options, callback) => {
    if (command === 'find') {
      callback(null, '/root/stale-clone/.git\n/root/active-clone/.git\n', '');
      return;
    }
    const dir = args[args.indexOf('-C') + 1];
    if (args.includes('remote')) {
      callback(null, 'https://github.com/me/my-repo.git\n', '');
      return;
    }
    // git log -1 --format=%at
    if (dir === '/root/stale-clone') {
      callback(null, '1600000000\n', ''); // older
    } else {
      callback(null, '1700000000\n', ''); // newer
    }
  };
  const result = await findLocalClone('me/my-repo', { roots: ['/root'], execFileFn });
  assert.equal(result, '/root/active-clone');
});

test('findLocalClone returns null when no scanned clone matches', async () => {
  const execFileFn = (command, args, options, callback) => {
    if (command === 'find') {
      callback(null, '/root/other/.git\n', '');
      return;
    }
    callback(null, 'https://github.com/someone/else.git\n', '');
  };
  const result = await findLocalClone('me/my-repo', { roots: ['/root'], execFileFn });
  assert.equal(result, null);
});

test('findLocalClone resolves to null instead of throwing when find itself fails', async () => {
  const execFileFn = (command, args, options, callback) => {
    callback({ code: 'ENOENT' }, '', '');
  };
  const result = await findLocalClone('me/my-repo', { roots: ['/root'], execFileFn });
  assert.equal(result, null);
});

test('findLocalClone passes the expected find command across all given roots', async () => {
  let capturedArgs;
  const execFileFn = (command, args, options, callback) => {
    if (command === 'find') {
      capturedArgs = args;
      callback(null, '', '');
    }
  };
  await findLocalClone('me/my-repo', { roots: ['/root/a', '/root/b'], execFileFn });
  assert.deepEqual(capturedArgs, ['/root/a', '/root/b', '-maxdepth', '4', '-name', '.git']);
});
