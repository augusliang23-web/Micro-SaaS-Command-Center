import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRealGithubRepo,
  aggregateCiStatus,
  aggregateReviewDecision,
  fetchPullRequestStatus,
  fetchChangedFiles,
} from '../server/githubPullStatus.mjs';

test('isRealGithubRepo accepts owner/repo slugs and rejects fixture placeholders', () => {
  assert.equal(isRealGithubRepo('augusliang23-web/pm-dashboard-uat'), true);
  assert.equal(isRealGithubRepo('github.com/my-org/prosync-core'), false);
  assert.equal(isRealGithubRepo('not a repo'), false);
  assert.equal(isRealGithubRepo(''), false);
  assert.equal(isRealGithubRepo(undefined), false);
});

test('aggregateCiStatus: no runs is none, in-progress wins over completed, failure beats success', () => {
  assert.equal(aggregateCiStatus([]), 'none');
  assert.equal(
    aggregateCiStatus([{ status: 'completed', conclusion: 'success' }, { status: 'in_progress' }]),
    'running',
  );
  assert.equal(
    aggregateCiStatus([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ]),
    'failing',
  );
  assert.equal(
    aggregateCiStatus([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'skipped' },
    ]),
    'passing',
  );
});

test('aggregateReviewDecision: dedupes by reviewer, changes-requested wins, no reviews needs review', () => {
  assert.equal(aggregateReviewDecision([]), 'review_required');
  assert.equal(
    aggregateReviewDecision([
      { user: { login: 'a' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-09-01T00:00:00Z' },
      { user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-09-02T00:00:00Z' },
    ]),
    'approved',
  );
  assert.equal(
    aggregateReviewDecision([
      { user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-09-01T00:00:00Z' },
      { user: { login: 'b' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-09-01T00:00:00Z' },
    ]),
    'changes_requested',
  );
  assert.equal(
    aggregateReviewDecision([{ user: { login: 'a' }, state: 'COMMENTED', submitted_at: '2026-09-01T00:00:00Z' }]),
    'review_required',
  );
});

test('fetchPullRequestStatus returns open-PR state with CI and review aggregates', async () => {
  const calls = [];
  const execFileFn = (command, args, options, callback) => {
    calls.push(args[1]);
    const path = args[1];
    if (path.includes('pulls?state=open')) {
      callback(null, JSON.stringify([{ number: 42, html_url: 'https://x/42', draft: false, head: { sha: 'abc' } }]), '');
    } else if (path.includes('check-runs')) {
      callback(null, JSON.stringify({ check_runs: [{ status: 'completed', conclusion: 'success' }] }), '');
    } else if (path.includes('reviews')) {
      callback(null, JSON.stringify([{ user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-09-01T00:00:00Z' }]), '');
    } else {
      callback(new Error('unexpected path'), '', '');
    }
  };

  const status = await fetchPullRequestStatus('me/repo', { execFileFn });
  assert.equal(status.state, 'open');
  assert.equal(status.prNumber, 42);
  assert.equal(status.ciStatus, 'passing');
  assert.equal(status.reviewDecision, 'approved');
  assert.equal(status.isDraft, false);
});

test('fetchPullRequestStatus reports "merged" only when the branch tip IS that PR\'s merge commit', async () => {
  const execFileFn = (command, args, options, callback) => {
    const path = args[1];
    if (path.includes('pulls?state=open')) {
      callback(null, JSON.stringify([]), '');
    } else if (path.includes('pulls?state=closed')) {
      callback(
        null,
        JSON.stringify([
          { number: 10, html_url: 'https://x/10', merged_at: null, merge_commit_sha: null },
          { number: 9, html_url: 'https://x/9', merged_at: '2026-09-01T00:00:00Z', merge_commit_sha: 'tip123' },
        ]),
        '',
      );
    } else if (path.includes('/commits?per_page=1')) {
      callback(null, JSON.stringify([{ sha: 'tip123', commit: { author: { date: '2026-09-01T00:00:00Z' } } }]), '');
    } else {
      callback(new Error(`unexpected path: ${path}`), '', '');
    }
  };

  const status = await fetchPullRequestStatus('me/repo', { execFileFn });
  assert.equal(status.state, 'merged');
  assert.equal(status.prNumber, 9);
});

test('fetchPullRequestStatus reports "active" when the branch has moved past the last known merged PR (direct pushes)', async () => {
  const execFileFn = (command, args, options, callback) => {
    const path = args[1];
    if (path.includes('pulls?state=open')) {
      return callback(null, JSON.stringify([]), '');
    }
    if (path.includes('pulls?state=closed')) {
      return callback(
        null,
        JSON.stringify([{ number: 1, html_url: 'https://x/1', merged_at: '2026-09-05T00:00:00Z', merge_commit_sha: 'old-merge-sha' }]),
        '',
      );
    }
    if (path.includes('/commits?per_page=1')) {
      return callback(
        null,
        JSON.stringify([
          {
            sha: 'newer-direct-push-sha',
            html_url: 'https://x/commit/newer',
            commit: { message: 'chore: isolate local UAT emulator tooling', author: { date: '2026-09-06T08:02:18Z' } },
          },
        ]),
        '',
      );
    }
    if (path.includes('check-runs')) {
      return callback(null, JSON.stringify({ check_runs: [] }), '');
    }
    callback(new Error(`unexpected path: ${path}`), '', '');
  };

  const status = await fetchPullRequestStatus('me/repo', { execFileFn });
  assert.equal(status.state, 'active');
  assert.equal(status.lastCommitMessage, 'chore: isolate local UAT emulator tooling');
  assert.equal(status.ciStatus, 'none');
  assert.equal(status.lastCommitSha, 'newer-direct-push-sha');
});

test('fetchPullRequestStatus returns none when the repo has no commits at all', async () => {
  const execFileFn = (command, args, options, callback) => {
    const path = args[1];
    if (path.includes('state=open')) return callback(null, JSON.stringify([]), '');
    if (path.includes('state=closed')) return callback(null, JSON.stringify([]), '');
    if (path.includes('/commits?per_page=1')) return callback(null, JSON.stringify([]), '');
    callback(new Error(`unexpected path: ${path}`), '', '');
  };

  const status = await fetchPullRequestStatus('me/repo', { execFileFn });
  assert.deepEqual(status, { state: 'none' });
});

test('fetchPullRequestStatus rejects a non owner/repo slug without shelling out', async () => {
  await assert.rejects(
    fetchPullRequestStatus('github.com/my-org/fixture-repo', {
      execFileFn: () => {
        throw new Error('should not be called');
      },
    }),
    /Not a valid owner\/repo slug/,
  );
});

test('fetchChangedFiles(prNumber) normalizes the PR files array response', async () => {
  const execFileFn = (command, args, options, callback) => {
    const path = args[1];
    if (path.includes('pulls/42/files')) {
      callback(
        null,
        JSON.stringify([
          { filename: 'src/foo.ts', status: 'modified', additions: 5, deletions: 2, patch: '@@ -1 +1 @@' },
          { filename: 'src/bar.ts', status: 'added', additions: 10, deletions: 0, patch: '@@ -0,0 +1,10 @@' },
        ]),
        '',
      );
    } else {
      callback(new Error(`unexpected path: ${path}`), '', '');
    }
  };

  const files = await fetchChangedFiles('me/repo', { prNumber: 42 }, { execFileFn });
  assert.equal(files.length, 2);
  assert.equal(files[0].filename, 'src/foo.ts');
  assert.equal(files[0].status, 'modified');
  assert.equal(files[0].additions, 5);
  assert.equal(files[0].deletions, 2);
  assert.equal(files[0].patch, '@@ -1 +1 @@');
});

test('fetchChangedFiles(sha) normalizes the commit object\'s files array', async () => {
  const execFileFn = (command, args, options, callback) => {
    const path = args[1];
    if (path.includes('commits/abc123')) {
      callback(
        null,
        JSON.stringify({
          sha: 'abc123',
          files: [{ filename: 'server.ts', status: 'modified', additions: 3, deletions: 1 }],
        }),
        '',
      );
    } else {
      callback(new Error(`unexpected path: ${path}`), '', '');
    }
  };

  const files = await fetchChangedFiles('me/repo', { sha: 'abc123' }, { execFileFn });
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'server.ts');
  assert.equal(files[0].additions, 3);
  assert.equal(files[0].deletions, 1);
});

test('fetchChangedFiles rejects when neither prNumber nor sha is given, and when repo is not a real slug', async () => {
  const execFileFn = () => {
    throw new Error('should not be called');
  };
  await assert.rejects(fetchChangedFiles('me/repo', {}, { execFileFn }), /Either prNumber or sha is required/);
  await assert.rejects(
    fetchChangedFiles('github.com/my-org/fixture-repo', { prNumber: 1 }, { execFileFn }),
    /Not a valid owner\/repo slug/,
  );
});
