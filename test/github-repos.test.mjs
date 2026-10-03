import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { formatRelativeTime, mapGithubRepo, fetchGithubRepos, GithubCliError } from '../server/githubRepos.mjs';
import { evaluateGithubRequest, createGithubRouter, parseRecentCommitsLimit } from '../server/githubRoutes.mjs';

test('formatRelativeTime buckets recent timestamps into human phrases', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  assert.equal(formatRelativeTime(new Date('2026-09-05T11:59:30Z'), now), 'Just now');
  assert.equal(formatRelativeTime(new Date('2026-09-05T10:00:00Z'), now), '2 hours ago');
  assert.equal(formatRelativeTime(new Date('2026-09-04T12:00:00Z'), now), 'Yesterday');
  assert.equal(formatRelativeTime(new Date('2026-09-01T12:00:00Z'), now), '4 days ago');
  assert.equal(formatRelativeTime(new Date('2026-08-20T12:00:00Z'), now), '2 weeks ago');
  assert.equal(formatRelativeTime(new Date('2025-10-05T12:00:00Z'), now), '11 months ago');
  assert.equal(formatRelativeTime(new Date('2025-09-05T12:00:00Z'), now), '1 year ago');
});

test('mapGithubRepo maps the GitHub REST shape onto UnconnectedGitHubRepo', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const mapped = mapGithubRepo(
    {
      id: 12345,
      name: 'invoice-radar',
      full_name: 'augusliang23/invoice-radar',
      description: null,
      private: true,
      language: null,
      default_branch: 'main',
      stargazers_count: 12,
      pushed_at: '2026-09-05T10:00:00Z',
    },
    now,
  );

  assert.deepEqual(mapped, {
    id: '12345',
    name: 'invoice-radar',
    fullName: 'augusliang23/invoice-radar',
    description: '',
    isPrivate: true,
    language: 'Unknown',
    defaultBranch: 'main',
    stars: 12,
    lastPushed: '2 hours ago',
  });
});

test('fetchGithubRepos resolves mapped repos from the gh CLI JSON output', async () => {
  const repos = await fetchGithubRepos({
    execFileFn: (command, args, options, callback) => {
      assert.equal(command, 'gh');
      assert.deepEqual(args, ['api', '/user/repos?per_page=100&sort=pushed&direction=desc']);
      callback(null, JSON.stringify([{ id: 1, name: 'a', full_name: 'me/a', private: false }]), '');
    },
  });
  assert.equal(repos.length, 1);
  assert.equal(repos[0].fullName, 'me/a');
});

test('fetchGithubRepos rejects with a not_found GithubCliError when gh is missing', async () => {
  await assert.rejects(
    fetchGithubRepos({
      execFileFn: (command, args, options, callback) => {
        callback(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), '', '');
      },
    }),
    (error) => error instanceof GithubCliError && error.kind === 'not_found',
  );
});

test('fetchGithubRepos rejects with a not_authenticated GithubCliError on auth failure', async () => {
  await assert.rejects(
    fetchGithubRepos({
      execFileFn: (command, args, options, callback) => {
        callback(new Error('exit 1'), '', 'gh: not logged in to any GitHub hosts');
      },
    }),
    (error) => error instanceof GithubCliError && error.kind === 'not_authenticated',
  );
});

test('evaluateGithubRequest allows originless and loopback requests, rejects others', () => {
  assert.equal(evaluateGithubRequest({ origin: null }).ok, true);
  assert.equal(evaluateGithubRequest({ origin: 'http://127.0.0.1:3000' }).ok, true);
  const decision = evaluateGithubRequest({ origin: 'https://evil.example' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

test('createGithubRouter is constructible with an injected fetchRepos dependency', () => {
  const router = createGithubRouter({ fetchRepos: async () => [] });
  assert.equal(typeof router, 'function');
});

test('createGithubRouter also accepts an injected fetchPullStatus dependency', () => {
  const router = createGithubRouter({ fetchPullStatus: async () => ({ state: 'none' }) });
  assert.equal(typeof router, 'function');
});

test('parseRecentCommitsLimit normalizes to a whole number in 1..50, else 30', () => {
  assert.equal(parseRecentCommitsLimit('2.7'), 2);
  assert.equal(parseRecentCommitsLimit('50'), 50);
  assert.equal(parseRecentCommitsLimit('1e3'), 50);
  for (const raw of ['0.5', '0', '-3', 'abc', '', ' ', 'Infinity', undefined, ['5']]) {
    assert.equal(parseRecentCommitsLimit(raw), 30, `raw=${JSON.stringify(raw)}`);
  }
});

test('GET /recent-commits passes an integer limit to GitHub', async () => {
  const seen = [];
  const app = express();
  app.use('/api/github', createGithubRouter({ fetchCommits: async (repo, { limit }) => (seen.push(limit), []) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    for (const limit of ['7.9', '0.5', '999']) {
      const res = await fetch(`http://127.0.0.1:${port}/api/github/recent-commits?repo=me/repo&limit=${limit}`);
      assert.equal(res.status, 200);
    }
  } finally {
    server.close();
  }
  assert.deepEqual(seen, [7, 30, 50]);
});
