import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRealGithubRepo,
  aggregateCiStatus,
  aggregateReviewDecision,
  fetchPullRequestStatus,
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

test('fetchPullRequestStatus falls back to the newest merged PR when nothing is open', async () => {
  const execFileFn = (command, args, options, callback) => {
    const path = args[1];
    if (path.includes('pulls?state=open')) {
      callback(null, JSON.stringify([]), '');
    } else if (path.includes('pulls?state=closed')) {
      callback(
        null,
        JSON.stringify([
          { number: 10, html_url: 'https://x/10', merged_at: null },
          { number: 9, html_url: 'https://x/9', merged_at: '2026-09-01T00:00:00Z' },
        ]),
        '',
      );
    } else {
      callback(new Error('unexpected path'), '', '');
    }
  };

  const status = await fetchPullRequestStatus('me/repo', { execFileFn });
  assert.equal(status.state, 'merged');
  assert.equal(status.prNumber, 9);
});

test('fetchPullRequestStatus returns none when there is no open or merged PR', async () => {
  const execFileFn = (command, args, options, callback) => {
    const path = args[1];
    if (path.includes('state=open')) return callback(null, JSON.stringify([]), '');
    if (path.includes('state=closed')) return callback(null, JSON.stringify([]), '');
    callback(new Error('unexpected path'), '', '');
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
