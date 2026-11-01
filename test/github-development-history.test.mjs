import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import {
  DEVELOPMENT_HISTORY_REPOS,
  HISTORY_LIMITS,
  classifyGhFailure,
  createHistoryCache,
  fetchDevelopmentHistory,
  fetchPaginated,
  fetchPullDetail,
  isAllowlistedHistoryRepo,
  nextPageNumber,
  normalizeBranch,
  normalizePull,
  parseGhIncludeOutput,
  parseLinkHeader,
  selectFocusRefs,
  summarizeReviews,
} from '../server/githubDevelopmentHistory.mjs';
import { aggregateCiResponse } from '../server/githubPullStatus.mjs';
import { createGithubRouter } from '../server/githubRoutes.mjs';
import { GithubCliError } from '../server/githubRepos.mjs';

const REPO = 'augusliang23-web/pm-dashboard';
const REPO_INFO={id:1221937556,full_name:REPO,html_url:`https://github.com/${REPO}`,default_branch:'main'};

// Versioned fixture: PR fields copied from a read-only GitHub snapshot of
// augusliang23-web/pm-dashboard taken 2026-10-15T23:57:20Z (67 branches,
// 57 PRs, 12 open at that moment). These are observations for unit tests,
// NOT expected live values — live counts are re-read at validation time.
// [number, title, state, draft, created, updated, closed, merged, base, head, headSha, mergeSha]
const SNAPSHOT_2026_10_15 = [
  [13, 'Consolidate PROD/UAT source and bootstrap CI', 'closed', false, '2026-09-24T01:26:19Z', '2026-09-24T01:43:01Z', '2026-09-24T01:43:01Z', '2026-09-24T01:43:01Z', 'main', 'migration/consolidated-source-ci', '0b008da97b46ab0cf5bf673fbf33dd0b0741d02a', 'f7b69b6ca25b244efa3d0fadae3a70a487ae8f0e'],
  [23, 'B8: integrate accepted UAT PDF Cloud Run service URL', 'closed', false, '2026-09-27T00:23:29Z', '2026-09-27T00:56:04Z', '2026-09-27T00:56:04Z', '2026-09-27T00:56:04Z', 'main', 'claude/b8-uat-pdf-url-integration', '34a2dae82f7e2d0d783eafff3633c04843a9cec0', 'c2f9a4dd4b811a48f3dfd833adfd1baaf38a3c26'],
  [33, 'feat: add per-user Manage Weeks permission foundation', 'closed', false, '2026-10-03T00:38:15Z', '2026-10-03T04:08:35Z', '2026-10-03T04:08:35Z', '2026-10-03T04:08:35Z', 'main', 'claude/week-manage-permission-foundation', 'c66d0d24b950e03a0804662447c4509547c6312a', '4e0283e7eca0333153c914fbecd936d96944dbec'],
  [34, 'feat: add Admin user permissions management', 'closed', false, '2026-10-03T04:27:37Z', '2026-10-03T04:48:45Z', '2026-10-03T04:48:45Z', '2026-10-03T04:48:45Z', 'main', 'claude/user-permissions-ui', '1ffe3f1a1c9df54230ab62a7b6d4d2835fc3717a', '0db63dfcef466864353ce47c7d25ff58836e7942'],
  [35, 'Prepare Cloud Functions Node 22 migration candidate', 'closed', false, '2026-10-03T08:54:21Z', '2026-10-03T09:45:30Z', '2026-10-03T09:45:30Z', '2026-10-03T09:45:30Z', 'main', 'codex/functions-node22-candidate', '5e27ecc621d3a4182aab1df4851fae46213dff87', '606fe7e3462d16e7fc9364efccfcafc5c4688db0'],
  [36, 'release: prepare User Permissions Production promotion', 'open', false, '2026-10-03T14:21:09Z', '2026-10-03T14:37:52Z', null, null, 'main', 'claude/production-user-permissions-promotion', '3a9a728b2dcbf79b5f4536498580e3cbdb9407a4', null],
  [37, 'release: port User Permissions UI to production-pages', 'open', false, '2026-10-03T14:21:15Z', '2026-10-03T14:21:15Z', null, null, 'production-pages', 'claude/production-pages-user-permissions', 'febf2cf85a9188652aaadecfc0c6e3882c7178ac', null],
  [40, 'release: port User Permissions V2 to production-pages', 'closed', false, '2026-10-04T04:17:04Z', '2026-10-06T08:46:13Z', '2026-10-06T08:46:13Z', '2026-10-06T08:46:12Z', 'production-pages', 'claude/production-pages-user-permissions-v2', '015e8b2afcc48851f87c7ec8b1adeb9482a20fe0', 'a9648a16e9261b85a9f1c49f2e43ef9a08863112'],
  [47, 'feat: one-paste Copilot weekly update in the project editor', 'closed', false, '2026-10-09T23:00:03Z', '2026-10-10T00:37:34Z', '2026-10-10T00:37:34Z', '2026-10-10T00:37:34Z', 'main', 'claude/weekly-update-one-paste-uat', '479855e6217f5a127e8da46c7a8185f3a6c159b1', 'a12368b739571dcfcc1d632cb082c97789d97927'],
  [48, 'feat: port One-Paste weekly update (PR #47) to Production Pages', 'closed', false, '2026-10-10T00:14:12Z', '2026-10-10T00:53:47Z', '2026-10-10T00:53:47Z', '2026-10-10T00:53:46Z', 'production-pages', 'claude/weekly-one-paste-production-pages', 'e221c61eb6d890352e3cfc49b987a034519293a2', '9c4254142cdd59f28854ec78cf095681e916324f'],
  [50, 'feat: V2.3 Delivery Trends presentation components (draft, not wired)', 'open', true, '2026-10-14T03:09:33Z', '2026-10-14T03:09:33Z', null, null, 'main', 'claude/v23-delivery-presentation', 'cd573dc5f0cdc3197e42abf8f3c3a75e1bb89f4b', null],
  [51, 'feat: V2.3 shared delivery metrics engine and verified PDF package', 'open', true, '2026-10-14T05:19:42Z', '2026-10-14T05:22:52Z', null, null, 'main', 'codex/v23-shared-metrics-engine', 'e8817619538b4399e81932c8e7ac7c0be41edd8a', null],
  [52, 'feat: V2.3 historical data pipeline and PDF metrics preparation', 'open', true, '2026-10-14T05:57:01Z', '2026-10-14T13:30:11Z', null, null, 'integration/v23-foundation', 'codex/v23-history-pipeline', 'c8cd5d8b6c65e604421c038f79bf34b81ab6f3fb', null],
  [53, 'feat: V2.3 UAT-only Delivery Trends page + PDF section integration (draft)', 'open', true, '2026-10-14T07:22:32Z', '2026-10-14T14:06:56Z', null, null, 'integration/v23-foundation', 'claude/v23-product-integration', 'e06da6ec8f1a92d4b48cd552303c27a3ca8c6382', null],
  [54, 'feat: unify UAT Draft Publish and preserve original Archive lifecycle', 'open', true, '2026-10-14T13:52:23Z', '2026-10-15T00:34:12Z', null, null, 'main', 'codex/new-project-draft-publish', '4be45fb07dfc6656fcfebedb4874e2488b41e801', null],
  [55, 'feat: V2.3 Phase 2C browser reliability and UAT automation (stacked, draft)', 'open', true, '2026-10-14T14:39:09Z', '2026-10-14T14:39:09Z', null, null, 'claude/v23-product-integration', 'claude/v23-browser-e2e-hardening', '669ab2dbb02ccdcfa9b9b217ca5a5704a9eaa88c', null],
  [56, 'feat: V2.3 Gate 2 integrated UAT review candidate', 'open', true, '2026-10-14T23:57:17Z', '2026-10-15T00:02:08Z', null, null, 'integration/v23-foundation', 'integration/v23-e2e-candidate', 'aed4e72942e7e0d571070debe006b5023ad99853', null],
  [57, 'feat: V2.3 Gate 2 closeout (F-1, PR #55 import, week selection) — stacked draft', 'open', true, '2026-10-15T00:33:08Z', '2026-10-15T00:33:08Z', null, null, 'integration/v23-e2e-candidate', 'claude/v23-gate2-closeout', '7c02e7f44e4aac72c9a1a948512ea2bdbcdbd940', null],
  [58, 'release(uat): PDF backend candidate — enable Delivery Performance on UAT only (draft)', 'open', true, '2026-10-15T05:42:11Z', '2026-10-15T05:42:11Z', null, null, 'claude/v23-gate2-closeout', 'claude/v23-uat-backend-activation', '0ad92930682d86fb009b1a3f9bcbb0e669c348cd', null],
  [59, 'release(uat): frontend candidate — enable Delivery Performance PDF option on UAT only (draft)', 'open', true, '2026-10-15T05:42:13Z', '2026-10-15T05:42:13Z', null, null, 'claude/v23-gate2-closeout', 'claude/v23-uat-frontend-activation', '1473475e78e5ff0ae9a466398ae98d35a588e117', null],
];
const ghPull = ([number, title, state, draft, created, updated, closed, merged, base, head, headSha, mergeSha]) => ({
  number, title, state, draft, created_at: created, updated_at: updated, closed_at: closed, merged_at: merged,
  html_url: `https://github.com/${REPO}/pull/${number}`, user: { login: 'augusliang23-web' },
  base: { ref: base, sha: `base-${number}`, repo: REPO_INFO },
  head: { ref: head, sha: headSha, repo: REPO_INFO },
  merge_commit_sha: mergeSha,
});
const PULLS = SNAPSHOT_2026_10_15.map(ghPull);
// The PR #13 merge commit and its real parents (main side, PR head side).
const MERGE_13 = { sha: 'f7b69b6ca25b244efa3d0fadae3a70a487ae8f0e', parents: [{ sha: 'e1f0e5c7177d83c8e6d4d14cc1e01d47791ab340' }, { sha: '0b008da97b46ab0cf5bf673fbf33dd0b0741d02a' }], html_url: 'u', commit: { message: 'Merge pull request #13', author: { date: '2026-09-24T01:43:01Z' }, committer: { date: '2026-09-24T01:43:01Z' } } };
const commit = (sha, parents, date) => ({ sha, parents: parents.map((p) => ({ sha: p })), html_url: `https://github.com/${REPO}/commit/${sha}`, commit: { message: `msg ${sha}`, author: { date }, committer: { date } } });

// Branches still present at snapshot time; PR #13's head
// (migration/consolidated-source-ci) is deliberately kept to also test a
// head ref that IS present, while PR #23's head is absent here.
const BRANCHES = ['main', 'production-pages', 'integration/v23-foundation', 'claude/v23-product-integration', 'claude/v23-browser-e2e-hardening', 'integration/v23-e2e-candidate', 'claude/v23-gate2-closeout', 'claude/v23-uat-backend-activation', 'claude/v23-uat-frontend-activation', 'migration/consolidated-source-ci']
  .map((name, i) => ({
    name,
    // Heads match the PR list (as in a quiet repository); main and production-pages use fixed SHAs.
    commit: { sha: name === 'main' ? 'm3' : name === 'production-pages' ? 'pp1' : PULLS.find((p) => p.state === 'open' && p.head.ref === name)?.head.sha ?? `sha-${i}` },
    protected: name === 'main',
  }));

function ghOutput(body, { status = 200, headers = {} } = {}) {
  const lines = [`HTTP/2.0 ${status} OK`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
  return `${lines.join('\r\n')}\r\n\r\n${JSON.stringify(body)}`;
}

/** Fake `gh` that answers GET paths from a route table and records every call. */
function fakeGh(routes) {
  const calls = [];
  const execFileFn = (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    const path = args[args.length - 1];
    for (const [pattern, handler] of routes) {
      if (pattern.test(path)) {
        const out = handler(path);
        if (out instanceof Error || out?.error) { cb(out.error ?? out, out.stdout ?? '', out.stderr ?? ''); return; }
        cb(null, out, '');
        return;
      }
    }
    cb(Object.assign(new Error('unrouted'), { code: 1 }), ghOutput({ message: 'Not Found' }, { status: 404 }), 'gh: Not Found (HTTP 404)');
  };
  return { execFileFn, calls };
}

function standardRoutes(overrides = []) {
  return [
    ...overrides,
    [/^repos\/augusliang23-web\/pm-dashboard$/, () => ghOutput(REPO_INFO)],
    [/\/branches\?/, () => ghOutput(BRANCHES)],
    [/\/pulls\?state=all/, () => ghOutput(PULLS)],
    [/\/commits\?sha=/, () => ghOutput([commit('m3', ['m2'], '2026-10-14T05:13:33Z'), commit('m2', ['m1'], '2026-10-10T00:37:33Z'), MERGE_13, commit('m1', [], '2026-04-26T21:42:44Z')].map((c, i) => (i === 2 ? c : c)))],
    [/\/compare\//, (path) => ghOutput({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, merge_base_commit: { sha: 'm3' }, commits: [commit(`c-${decodeURIComponent(path.split('...')[1].split('?')[0])}`, ['m3'], '2026-10-15T00:00:00Z')] })],
  ];
}

test('allowlist is exactly the four owner-approved repositories', () => {
  assert.deepEqual([...DEVELOPMENT_HISTORY_REPOS], [REPO,'alin36242-web/inventory-management-tool','augusliang23-web/cc-h15a-claude-dispatch-lab','augusliang23-web/Micro-SaaS-Command-Center']);
  assert.equal(isAllowlistedHistoryRepo(REPO), true);
  for (const bad of ['augusliang23-web/pm-dashboard-uat', 'augusliang23-web/Micro-SaaS-Command-Center-lookalike', 'github.com/augusliang23-web/pm-dashboard', 'PM Dashboard', '', undefined]) {
    assert.equal(isAllowlistedHistoryRepo(bad), false, String(bad));
  }
});

test('A/D/E/F: real PR normalization keeps created/merged/closed distinct and OPEN has no merge date', () => {
  const byNumber = new Map(PULLS.map((p) => [p.number, normalizePull(p)]));
  const pr13 = byNumber.get(13);
  assert.equal(pr13.status, 'merged');
  assert.equal(pr13.createdAt, '2026-09-24T01:26:19Z');
  assert.equal(pr13.mergedAt, '2026-09-24T01:43:01Z');
  assert.notEqual(pr13.createdAt, pr13.mergedAt);
  assert.equal(pr13.mergeCommitSha, 'f7b69b6ca25b244efa3d0fadae3a70a487ae8f0e');
  const pr40 = byNumber.get(40);
  assert.equal(pr40.baseRef, 'production-pages');
  assert.equal(pr40.mergedAt, '2026-10-06T08:46:12Z');
  assert.equal(pr40.closedAt, '2026-10-06T08:46:13Z'); // closed_at and merged_at are different source fields
  for (const n of [36, 37, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]) {
    const pr = byNumber.get(n);
    assert.equal(pr.state, 'open');
    assert.equal(pr.mergedAt, null, `#${n} must not have a merge date`);
    assert.equal(pr.mergeCommitSha, null);
    assert.equal(pr.merged, false);
  }
  assert.equal(byNumber.get(36).status, 'open'); // open, not draft
  assert.equal(byNumber.get(55).status, 'draft');
  // A closed PR without merged_at is closed-unmerged, never "merged".
  assert.equal(normalizePull({ ...PULLS[0], merged_at: null, state: 'closed' }).status, 'closed_unmerged');
});

test('G: stacked V2.3 base/head relationships come straight from PR metadata', () => {
  const pr = (n) => normalizePull(PULLS.find((p) => p.number === n));
  const expected = { 52: 'integration/v23-foundation', 53: 'integration/v23-foundation', 54: 'main', 55: 'claude/v23-product-integration', 56: 'integration/v23-foundation', 57: 'integration/v23-e2e-candidate', 58: 'claude/v23-gate2-closeout', 59: 'claude/v23-gate2-closeout' };
  for (const [n, base] of Object.entries(expected)) assert.equal(pr(Number(n)).baseRef, base, `#${n}`);
  assert.equal(pr(55).baseRef, pr(53).headRef); // #55 stacked on #53
  assert.equal(pr(57).baseRef, pr(56).headRef); // #57 stacked on #56
  assert.equal(pr(58).baseRef, pr(57).headRef);
  assert.equal(pr(59).baseRef, pr(57).headRef);
});

test('B: branch normalization keeps name, head SHA and protection only', () => {
  assert.deepEqual(normalizeBranch({ name: 'main', commit: { sha: 'abc' }, protected: true, extra: 1 }), { name: 'main', headSha: 'abc', protected: true });
  assert.deepEqual(normalizeBranch({ name: 'x' }), { name: 'x', headSha: null, protected: false });
});

test('Link header and gh -i output parsing', () => {
  const links = parseLinkHeader('<https://api.github.com/repositories/1/commits?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=100&page=7>; rel="last"');
  assert.equal(nextPageNumber(links.next), 2);
  assert.equal(nextPageNumber(undefined), null);
  const parsed = parseGhIncludeOutput(ghOutput([1], { headers: { Link: '<x>; rel="next"', 'X-RateLimit-Remaining': '42' } }));
  assert.equal(parsed.status, 200);
  assert.equal(parsed.headers['x-ratelimit-remaining'], '42');
  assert.deepEqual(JSON.parse(parsed.body), [1]);
});

test('every request is GET-only, repo-bound, and next links cannot redirect to another path', async () => {
  const { execFileFn, calls } = fakeGh([[/\/branches/, (path) => ghOutput([{ name: path }], { headers: path.includes('page=2') ? {} : { Link: '<https://api.github.com/repositories/999/branches?per_page=100&page=2>; rel="next"' } })]]);
  const result = await fetchPaginated(`repos/${REPO}/branches`, { maxPages: 5, execFileFn });
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.deepEqual(calls.map((c) => c.args.at(-1)), [`repos/${REPO}/branches?per_page=100`, `repos/${REPO}/branches?per_page=100&page=2`]);
  for (const c of calls) {
    assert.equal(c.cmd, 'gh');
    assert.deepEqual(c.args.slice(0, 4), ['api', '--method', 'GET', '-i']);
    assert.ok(c.opts.timeout > 0, 'every request has a timeout');
  }
});

test('L/T: pagination beyond the bound is reported as Partial, never Complete', async () => {
  const { execFileFn } = fakeGh(standardRoutes([[/\/branches\?/, (path) => ghOutput(BRANCHES, { headers: { Link: `<https://api.github.com/repositories/1/branches?page=${Number((path.match(/page=(\d+)/) || [0, 1])[1]) + 1}>; rel="next"` } })]]));
  const history = await fetchDevelopmentHistory(REPO, { execFileFn });
  assert.equal(history.coverage.branches.complete, false);
  assert.equal(history.coverage.branches.pages, HISTORY_LIMITS.maxBranchPages);
  assert.equal(history.status, 'partial');
  assert.match(history.warnings.join(' '), /Branch list truncated/);
});

test('full snapshot read: provenance, counts derived from data, verified DAG inputs, out-of-scope fields not checked', async () => {
  const { execFileFn, calls } = fakeGh(standardRoutes());
  const history = await fetchDevelopmentHistory(REPO, { execFileFn, now: () => new Date('2026-10-16T00:00:00Z') });
  assert.equal(history.source, 'GitHub');
  assert.equal(history.repository, REPO);
  assert.equal(history.fetchedAt, '2026-10-16T00:00:00.000Z');
  assert.equal(history.status, 'complete');
  assert.equal(history.coverage.pulls.count, PULLS.length);
  assert.equal(history.coverage.pulls.open, 12);
  assert.equal(history.coverage.pulls.draft, 10);
  assert.equal(history.coverage.branches.count, BRANCHES.length);
  assert.equal(history.coverage.localWorktrees, 'not_checked');
  assert.equal(history.coverage.deployments, 'not_checked');
  const merge13 = history.commits.find((c) => c.sha === MERGE_13.sha);
  assert.deepEqual(merge13.parents, ['e1f0e5c7177d83c8e6d4d14cc1e01d47791ab340', '0b008da97b46ab0cf5bf673fbf33dd0b0741d02a']);
  assert.ok(merge13.parents.includes(history.pulls.find((p) => p.number === 13).headSha), 'PR #13 merge commit has the PR head as a parent');
  // Compare reads only for focus refs that exist as branches.
  const compared = calls.map((c) => c.args.at(-1)).filter((p) => p.includes('/compare/'));
  assert.ok(compared.some((p) => p.includes('m3...pp1')), 'production-pages is compared by its observed SHA');
  assert.ok(compared.some((p) => p.includes(PULLS.find((x) => x.number === 57).head.sha)), 'open PR head compared by SHA');
  assert.ok(history.comparisons.every((c) => c.base === 'main' && c.mergeBaseSha === 'm3'));
  assert.ok(!('baseRepo' in history.pulls[0]), 'internal fields are not exposed');
});

test('O/P: missing branches are not compared, and a deleted historical head ref stays as PR metadata', () => {
  const pulls = PULLS.map((p) => ({ ...normalizePull(p), baseRepo: REPO }));
  const branches = BRANCHES.map(normalizeBranch);
  const focus = selectFocusRefs({ defaultBranch: 'main', branches, pulls });
  // claude/v23-delivery-presentation (#50 head) is absent from this branch fixture.
  assert.ok(!focus.refs.includes('claude/v23-delivery-presentation'));
  assert.ok(focus.refs.includes('production-pages'));
  assert.ok(focus.refs.includes('integration/v23-foundation'));
  assert.equal(focus.refs.includes('main'), false);
  // PR #23's head branch is absent but the PR record is kept unchanged.
  const pr23 = pulls.find((p) => p.number === 23);
  assert.equal(pr23.headRef, 'claude/b8-uat-pdf-url-integration');
  assert.equal(branches.some((b) => b.name === pr23.headRef), false);
  const bounded = selectFocusRefs({ defaultBranch: 'main', branches, pulls, limit: 2 });
  assert.equal(bounded.refs.length, 2);
  assert.equal(bounded.truncated, true);
});

test('M/N: authorization, rate-limit, timeout, abort and 404 are classified distinctly', () => {
  assert.equal(classifyGhFailure({ error: { code: 1 }, stdout: ghOutput({}, { status: 401 }), stderr: 'gh: Bad credentials (HTTP 401)' }).kind, 'not_authenticated');
  const rl = classifyGhFailure({ error: { code: 1 }, stdout: ghOutput({}, { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1792112400' } }), stderr: 'gh: API rate limit exceeded (HTTP 403)' });
  assert.equal(rl.kind, 'rate_limited');
  assert.equal(rl.resetAt, new Date(1792112400 * 1000).toISOString());
  assert.equal(classifyGhFailure({ error: { killed: true, signal: 'SIGTERM' } }).kind, 'timeout');
  assert.equal(classifyGhFailure({ error: { name: 'AbortError', code: 'ABORT_ERR' } }).kind, 'aborted');
  assert.equal(classifyGhFailure({ error: { code: 'ENOENT' } }).kind, 'not_found');
  assert.equal(classifyGhFailure({ error: { code: 1 }, stdout: ghOutput({}, { status: 404 }), stderr: 'gh: Not Found (HTTP 404)' }).kind, 'missing');
});

test('auth failure aborts the whole read instead of returning partial or fixture data', async () => {
  const { execFileFn } = fakeGh([[/./, () => ({ error: Object.assign(new Error('x'), { code: 1 }), stdout: ghOutput({}, { status: 401 }), stderr: 'gh: Bad credentials (HTTP 401)' })]]);
  await assert.rejects(fetchDevelopmentHistory(REPO, { execFileFn }), (e) => e instanceof GithubCliError && e.kind === 'not_authenticated');
  await assert.rejects(fetchDevelopmentHistory('augusliang23-web/other', { execFileFn }), (e) => e.kind === 'forbidden');
});

test('a pre-aborted request never spawns gh', async () => {
  const { execFileFn, calls } = fakeGh(standardRoutes());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchDevelopmentHistory(REPO, { execFileFn, signal: controller.signal }), (e) => e.kind === 'aborted');
  assert.equal(calls.length, 0);
});

test('R: PR detail distinguishes Not checked, No CI checks and CI passed', async () => {
  const base = (checks) => fakeGh([
    [/^repos\/augusliang23-web\/pm-dashboard$/, () => ghOutput(REPO_INFO)],
    [/\/pulls\/55$/, () => ghOutput({ ...PULLS.find((p) => p.number === 55), changed_files: 12, additions: 889, deletions: 8, commits: 2 })],
    [/\/check-runs/, checks],
    [/\/reviews/, () => ghOutput([])],
  ]);
  const none = await fetchPullDetail(REPO, 55, { execFileFn: base(() => ghOutput({ total_count: 0, check_runs: [] })).execFileFn, aggregateCi: aggregateCiResponse });
  assert.equal(none.ci.status, 'none');
  const passed = await fetchPullDetail(REPO, 55, { execFileFn: base(() => ghOutput({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] })).execFileFn, aggregateCi: aggregateCiResponse });
  assert.equal(passed.ci.status, 'passing');
  const failedRead = await fetchPullDetail(REPO, 55, { execFileFn: base(() => ({ error: Object.assign(new Error('x'), { code: 1 }), stdout: '', stderr: 'gh: Server Error (HTTP 502)' })).execFileFn, aggregateCi: aggregateCiResponse });
  assert.equal(failedRead.ci.status, 'not_checked');
  assert.equal(none.reviews.status, 'no_reviews');
  assert.equal(none.pull.changedFiles, 12);
  assert.equal(summarizeReviews([{ user: { login: 'a' }, state: 'COMMENTED', submitted_at: '2026-10-01T00:00:00Z' }], 'h').status, 'commented_only');
  // B1.4: an approval that names no commit is no longer a bare "approved".
  assert.equal(summarizeReviews([{ user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-10-01T00:00:00Z' }], 'h').status, 'review_head_unknown');
});

test('cache is per repository, expires, and is cleared on demand', () => {
  let t = 0;
  const cache = createHistoryCache({ ttlMs: 1000, now: () => t });
  cache.set(REPO, { repository: REPO });
  assert.deepEqual(cache.get(REPO), { repository: REPO });
  assert.equal(cache.get('other/repo'), null);
  t = 1001;
  assert.equal(cache.get(REPO), null);
});

async function withRouter(deps, fn) {
  const app = express();
  app.use('/api/github', createGithubRouter(deps));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/github`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('route: only GET on the allowlisted repo; errors map to explicit statuses; refresh bypasses cache', async () => {
  let calls = 0;
  let mode = 'ok';
  const fetchHistory = async (repo) => {
    calls += 1;
    if (mode === 'auth') throw new GithubCliError('not authed', 'not_authenticated');
    if (mode === 'rate') { const e = new GithubCliError('rate', 'rate_limited'); e.resetAt = '2026-10-16T01:00:00.000Z'; throw e; }
    if (mode === 'timeout') throw new GithubCliError('slow', 'timeout');
    return { repository: repo, fetchedAt: `t${calls}`, status: 'complete' };
  };
  await withRouter({ fetchHistory }, async (base) => {
    const other = await fetch(`${base}/development-history?repo=augusliang23-web/Micro-SaaS-Command-Center-lookalike`);
    assert.equal(other.status, 403);
    assert.equal(calls, 0);
    const first = await (await fetch(`${base}/development-history?repo=${REPO}`)).json();
    const second = await (await fetch(`${base}/development-history?repo=${REPO}`)).json();
    assert.equal(first.cache, 'miss');
    assert.equal(second.cache, 'hit');
    assert.equal(second.fetchedAt, first.fetchedAt, 'cached response keeps its original fetch time');
    const refreshed = await (await fetch(`${base}/development-history?repo=${REPO}&refresh=1`)).json();
    assert.equal(refreshed.cache, 'refreshed');
    assert.equal(calls, 2);
    const post = await fetch(`${base}/development-history?repo=${REPO}`, { method: 'POST' });
    assert.equal(post.status, 404, 'no write method is routed');
    const foreign = await fetch(`${base}/development-history?repo=${REPO}`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    mode = 'auth';
    const auth = await fetch(`${base}/development-history?repo=${REPO}&refresh=1`);
    assert.equal(auth.status, 401);
    assert.equal((await auth.json()).status, 'unavailable');
    mode = 'rate';
    const rate = await fetch(`${base}/development-history?repo=${REPO}&refresh=1`);
    assert.equal(rate.status, 429);
    assert.equal((await rate.json()).resetAt, '2026-10-16T01:00:00.000Z');
    mode = 'timeout';
    assert.equal((await fetch(`${base}/development-history?repo=${REPO}&refresh=1`)).status, 504);
  });
});

test('route: a history response for another repository is rejected, never cached', async () => {
  await withRouter({ fetchHistory: async () => ({ repository: 'someone/else' }) }, async (base) => {
    const res = await fetch(`${base}/development-history?repo=${REPO}`);
    assert.equal(res.status, 502);
  });
});

test('route: PR detail validates number and repository', async () => {
  const seen = [];
  await withRouter({ fetchHistoryPull: async (repo, number) => { seen.push([repo, number]); return {source:'GitHub',repository:repo,number}; } }, async (base) => {
    assert.equal((await fetch(`${base}/development-history/pull?repo=${REPO}&number=abc`)).status, 400);
    assert.equal((await fetch(`${base}/development-history/pull?repo=x/y&number=5`)).status, 403);
    assert.equal((await fetch(`${base}/development-history/pull?repo=${REPO}&number=55`)).status, 200);
  });
  assert.deepEqual(seen, [[REPO, 55]]);
});

test('V: the history module exposes no write or execution capability', async () => {
  const mod = await import('../server/githubDevelopmentHistory.mjs');
  const names = Object.keys(mod).join(' ');
  assert.doesNotMatch(names, /merge|approve|dispatch|execute|run|write|post|create(?!HistoryCache)/i);
});

// ---------------- P2 provenance remediation: negative controls ----------------
// These were written first and run against B1 commit 17a5623, where they fail.

const review = (login, state, at) => ({ user: { login }, state, submitted_at: at });
const reviewPage = (n) => Array.from({ length: 100 }, (_, i) => review(`u${n}-${i}`, 'APPROVED', `2026-10-${String(10 + n).padStart(2, '0')}T00:00:00Z`));

function detailRoutes({ reviews }) {
  return [
    [/^repos\/augusliang23-web\/pm-dashboard$/, () => ghOutput(REPO_INFO)],
    [/\/pulls\/55$/, () => ghOutput({ ...PULLS.find((p) => p.number === 55), changed_files: 1, additions: 1, deletions: 0, commits: 1 })],
    [/\/check-runs/, () => ghOutput({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] })],
    [/\/reviews/, reviews],
  ];
}

test('P2-2 negative control: a truncated review history is Partial, never a verified Approved', async () => {
  // Pages 1-3 are all APPROVED; a CHANGES_REQUESTED review exists on an unread page 4.
  const reviews = (path) => {
    const page = Number((path.match(/page=(\d+)/) || [0, 1])[1]);
    return ghOutput(reviewPage(page), { headers: { Link: `<https://api.github.com/repositories/1/pulls/55/reviews?per_page=100&page=${page + 1}>; rel="next"` } });
  };
  const detail = await fetchPullDetail(REPO, 55, { execFileFn: fakeGh(detailRoutes({ reviews })).execFileFn, aggregateCi: aggregateCiResponse });
  assert.equal(detail.reviews.complete, false);
  assert.equal(detail.reviews.status, 'partial');
  assert.equal(detail.reviews.count, 300);
});

test('P2-2: review states stay distinct — none, partial, approved, changes requested', async () => {
  const run = async (items, link) => (await fetchPullDetail(REPO, 55, {
    execFileFn: fakeGh(detailRoutes({ reviews: () => ghOutput(items, link ? { headers: { Link: '<https://api.github.com/repositories/1/pulls/55/reviews?page=2>; rel="next"' } } : {}) })).execFileFn,
    aggregateCi: aggregateCiResponse,
  })).reviews;
  assert.equal((await run([])).status, 'no_reviews');
  const PR55_HEAD = PULLS.find((p) => p.number === 55).head.sha;
  // B1.4: an approval is "current_head_approval" only when its commit_id is the PR head read in the same request.
  assert.equal((await run([{ ...review('a', 'APPROVED', '2026-10-01T00:00:00Z'), commit_id: PR55_HEAD }])).status, 'current_head_approval');
  assert.equal((await run([review('a', 'APPROVED', '2026-10-01T00:00:00Z')])).status, 'review_head_unknown');
  assert.equal((await run([review('a', 'CHANGES_REQUESTED', '2026-10-01T00:00:00Z')])).status, 'changes_requested');
  assert.equal((await run([review('a', 'APPROVED', '2026-10-01T00:00:00Z')], true)).status, 'partial');
  const failed = (await fetchPullDetail(REPO, 55, { execFileFn: fakeGh(detailRoutes({ reviews: () => ({ error: Object.assign(new Error('x'), { code: 1 }), stdout: '', stderr: 'gh: Server Error (HTTP 502)' }) })).execFileFn, aggregateCi: aggregateCiResponse })).reviews;
  assert.equal(failed.status, 'not_checked');
});

test('P2-2: an observed CHANGES_REQUESTED stays visible even when the list is incomplete', async () => {
  const items = [review('a', 'CHANGES_REQUESTED', '2026-10-01T00:00:00Z')];
  const reviews = (await fetchPullDetail(REPO, 55, {
    execFileFn: fakeGh(detailRoutes({ reviews: () => ghOutput(items, { headers: { Link: '<https://api.github.com/repositories/1/pulls/55/reviews?page=2>; rel="next"' } }) })).execFileFn,
    aggregateCi: aggregateCiResponse,
  })).reviews;
  assert.equal(reviews.status, 'partial');
  assert.equal(reviews.observed, 'changes_requested'); // a blocker seen in the read pages is not hidden
});

test('P2-1: CI is reported with the exact head SHA it was read for', async () => {
  const detail = await fetchPullDetail(REPO, 55, { execFileFn: fakeGh(detailRoutes({ reviews: () => ghOutput([]) })).execFileFn, aggregateCi: aggregateCiResponse });
  assert.equal(detail.ci.headSha, detail.pull.headSha);
  assert.equal(detail.pull.headSha, PULLS.find((p) => p.number === 55).head.sha);
});

// Moving-ref fixtures: branch heads that match their open PR heads.
const SHA = (name) => `sha-${name.replace(/\//g, '_')}`;
function movingRoutes({ branchReads, compareLog, mainCommits }) {
  const headFor = (name) => (name === 'main' ? 'm3' : name === 'production-pages' ? 'pp1' : PULLS.find((p) => p.state === 'open' && p.head.ref === name)?.head.sha ?? SHA(name));
  // 'unrelated/old-branch' is not main, production-pages or any open PR head/base: it is never compared.
  const names = ['main', 'production-pages', 'integration/v23-foundation', 'claude/v23-product-integration', 'claude/v23-browser-e2e-hardening', 'integration/v23-e2e-candidate', 'claude/v23-gate2-closeout', 'claude/v23-uat-backend-activation', 'claude/v23-uat-frontend-activation', 'unrelated/old-branch'];
  let reads = 0;
  return [
    [/^repos\/augusliang23-web\/pm-dashboard$/, () => ghOutput(REPO_INFO)],
    [/\/branches\?/, () => {
      const moved = branchReads(reads++);
      const present = [...names.filter((name) => !(moved.__remove ?? []).includes(name)), ...Object.keys(moved.__add ?? {})];
      return ghOutput(present.map((name) => ({ name, commit: { sha: moved.__add?.[name] ?? moved[name] ?? headFor(name) }, protected: false })));
    }],
    [/\/pulls\?state=all/, () => ghOutput(PULLS)],
    [/\/commits\?sha=/, (path) => { mainCommits?.push(path); return ghOutput([commit('m3', ['m2'], '2026-10-14T05:13:33Z'), commit('m2', [], '2026-10-10T00:37:33Z')]); }],
    [/\/compare\//, (path) => { compareLog.push(path); return ghOutput({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, merge_base_commit: { sha: 'm3' }, commits: [commit(`c-${path.split('...')[1].split('?')[0]}`, ['m3'], '2026-10-15T00:00:00Z')] }); }],
  ];
}

test('Snapshot: compare and main history are pinned to the exact SHAs observed in the branch list', async () => {
  const compareLog = [];
  const mainLog = [];
  const { execFileFn } = fakeGh(movingRoutes({ branchReads: () => ({}), compareLog, mainCommits: mainLog }));
  await fetchDevelopmentHistory(REPO, { execFileFn });
  assert.ok(compareLog.length > 0);
  for (const path of compareLog) { assert.match(path, /compare\/m3\.\.\.[\w.-]+\?/, `unpinned compare: ${path}`); assert.doesNotMatch(path, /%2F/, `compare uses a branch name: ${path}`); }
  assert.ok(compareLog.some((p) => p.includes('m3...pp1')));
  assert.ok(mainLog.every((p) => p.includes('sha=m3')), `main history not pinned: ${mainLog}`);
});

test('Snapshot: a branch that moves during the read makes the snapshot Partial / inconsistent, never Complete', async () => {
  const compareLog = [];
  // First branch read sees the observed heads; the re-read sees production-pages and a V2.3 branch moved.
  const { execFileFn } = fakeGh(movingRoutes({ compareLog, branchReads: (n) => (n === 0 ? {} : { 'production-pages': 'pp2', 'claude/v23-product-integration': 'moved-head' }) }));
  const history = await fetchDevelopmentHistory(REPO, { execFileFn, now: () => new Date('2026-10-16T00:00:00Z') });
  assert.equal(history.status, 'partial');
  assert.equal(history.consistency.atomic, false);
  assert.equal(history.consistency.status, 'inconsistent');
  assert.deepEqual(history.consistency.driftedRefs.map((r) => r.ref).sort(), ['claude/v23-product-integration', 'production-pages']);
  assert.deepEqual(history.consistency.driftedRefs.find((r) => r.ref === 'production-pages'), { ref: 'production-pages', observed: 'pp1', reread: 'pp2', relevant: true });
  assert.match(history.warnings.join(' '), /moved during the read/i);
  assert.ok(history.consistency.rereadAt);
});

test('Snapshot: a stable read reports consistent but still never claims to be atomic', async () => {
  const { execFileFn } = fakeGh(movingRoutes({ compareLog: [], branchReads: () => ({}) }));
  const history = await fetchDevelopmentHistory(REPO, { execFileFn });
  assert.equal(history.status, 'complete');
  assert.equal(history.consistency.status, 'consistent');
  assert.equal(history.consistency.atomic, false);
  assert.deepEqual(history.consistency.driftedRefs, []);
  assert.deepEqual(history.consistency.prHeadMismatches, []);
});

test('Snapshot: an OPEN PR whose head differs from its branch head is flagged and the snapshot is Partial', async () => {
  // PR list says #55 head = 669ab…; branch list already shows a newer head.
  const { execFileFn } = fakeGh(movingRoutes({ compareLog: [], branchReads: () => ({ 'claude/v23-browser-e2e-hardening': 'newer-head' }) }));
  const history = await fetchDevelopmentHistory(REPO, { execFileFn });
  assert.equal(history.status, 'partial');
  const mismatch = history.consistency.prHeadMismatches.find((m) => m.number === 55);
  assert.deepEqual(mismatch, { number: 55, headRef: 'claude/v23-browser-e2e-hardening', prHeadSha: PULLS.find((p) => p.number === 55).head.sha, branchHeadSha: 'newer-head' });
});

// ---------------- Final provenance hardening: P2-4 snapshot completeness ----------------
// Any branch-list drift makes the repository snapshot Partial. A comparison whose
// refs did not move keeps its own pinned, complete status (edge proof != snapshot completeness).
const drift = (reads) => async () => {
  const { execFileFn } = fakeGh(movingRoutes({ compareLog: [], branchReads: reads }));
  return fetchDevelopmentHistory(REPO, { execFileFn, now: () => new Date('2026-10-16T00:00:00Z') });
};
const refsOf = (h) => h.consistency.driftedRefs.map((r) => `${r.ref}:${r.relevant}`).sort();

test('P2-4 negative control: an unrelated branch moving makes the snapshot Partial, not Complete', async () => {
  const history = await drift((n) => (n === 0 ? {} : { 'unrelated/old-branch': 'pushed-meanwhile' }))();
  assert.equal(history.status, 'partial');
  assert.equal(history.consistency.status, 'inconsistent');
  assert.deepEqual(history.consistency.driftedRefs, [{ ref: 'unrelated/old-branch', observed: SHA('unrelated/old-branch'), reread: 'pushed-meanwhile', relevant: false }]);
  assert.match(history.warnings.join(' '), /moved during the read: unrelated\/old-branch/);
  // Edge proof is separate: every comparison is still pinned to observed SHAs and complete.
  assert.ok(history.comparisons.length > 0);
  assert.ok(history.comparisons.every((c) => c.complete && c.baseSha === 'm3' && c.headSha && c.error === null));
  assert.deepEqual(history.consistency.prHeadMismatches, []);
});

test('P2-4: a new branch appearing during the read makes the snapshot Partial', async () => {
  const history = await drift((n) => (n === 0 ? {} : { __add: { 'feature/just-created': 'new-sha' } }))();
  assert.equal(history.status, 'partial');
  assert.deepEqual(history.consistency.driftedRefs, [{ ref: 'feature/just-created', observed: null, reread: 'new-sha', relevant: false }]);
});

test('P2-4: a branch disappearing during the read makes the snapshot Partial', async () => {
  const history = await drift((n) => (n === 0 ? {} : { __remove: ['unrelated/old-branch'] }))();
  assert.equal(history.status, 'partial');
  assert.deepEqual(history.consistency.driftedRefs, [{ ref: 'unrelated/old-branch', observed: SHA('unrelated/old-branch'), reread: null, relevant: false }]);
});

test('P2-4: the default branch moving is Partial and marked as an edge-relevant ref', async () => {
  const history = await drift((n) => (n === 0 ? {} : { main: 'm4' }))();
  assert.equal(history.status, 'partial');
  assert.deepEqual(refsOf(history), ['main:true']);
});

test('P2-4: a stacked PR base branch moving is Partial and edge-relevant', async () => {
  const history = await drift((n) => (n === 0 ? {} : { 'claude/v23-product-integration': 'moved-base' }))();
  assert.equal(history.status, 'partial');
  assert.deepEqual(refsOf(history), ['claude/v23-product-integration:true']);
});

test('P2-4: relevant and unrelated drift together are both reported; none is dropped', async () => {
  const history = await drift((n) => (n === 0 ? {} : { 'unrelated/old-branch': 'x', 'production-pages': 'pp2' }))();
  assert.deepEqual(refsOf(history), ['production-pages:true', 'unrelated/old-branch:false']);
  assert.equal(history.status, 'partial');
});

test('P2-4: a stable snapshot is Complete/consistent but still not atomic', async () => {
  const history = await drift(() => ({}))();
  assert.equal(history.status, 'complete');
  assert.equal(history.consistency.status, 'consistent');
  assert.equal(history.consistency.atomic, false);
  assert.deepEqual(history.consistency.driftedRefs, []);
});

// ---------------- B1.4 remediation: review provenance (commit_id) ----------------
// P2-1 (independent review): the backend collapsed GitHub reviews into one aggregate string and dropped each
// review's commit_id, so an approval of an OLD commit could be shown as an approval of the CURRENT head.
// These tests were written first and run against a45a01d, where the "defect" cases fail.
const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const rv = (id, login, state, at, commitId) => ({ id, user: login === null ? null : { login }, state, submitted_at: at, ...(commitId === undefined ? {} : { commit_id: commitId }) });

/** PR #55 read at `headSha` (null = the payload has no head SHA). */
function detailAt(headSha, reviewRoute, { checks } = {}) {
  const pull = { ...PULLS.find((p) => p.number === 55), changed_files: 1, additions: 1, deletions: 0, commits: 1 };
  pull.head = { ...pull.head, sha: headSha };
  return fetchPullDetail(REPO, 55, {
    execFileFn: fakeGh([
      [/^repos\/augusliang23-web\/pm-dashboard$/, () => ghOutput(REPO_INFO)],
      [/\/pulls\/55$/, () => ghOutput(pull)],
      [/\/check-runs/, checks ?? (() => ghOutput({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] }))],
      [/\/reviews/, reviewRoute],
    ]).execFileFn,
    aggregateCi: aggregateCiResponse,
  });
}
const reviewsOf = async (headSha, items, opts) => (await detailAt(headSha, () => ghOutput(items, opts))).reviews;
const NEXT_PAGE = { headers: { Link: '<https://api.github.com/repositories/1/pulls/55/reviews?page=2>; rel="next"' } };

test('B1.4 P2-1 CASE A: approval on the current head establishes current-head review provenance', async () => {
  const r = await reviewsOf(HEAD_A, [rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)]);
  assert.equal(r.status, 'current_head_approval');
  assert.equal(r.headSha, HEAD_A);
  assert.deepEqual(r.reviewers.map(({ reviewer, state, commitId, relation }) => ({ reviewer, state, commitId, relation })), [{ reviewer: 'bob', state: 'APPROVED', commitId: HEAD_A, relation: 'current_head' }]);
});

test('B1.4 P2-1 CASE B (original defect): approval on an OLDER commit is a historical approval, never current', async () => {
  const r = await reviewsOf(HEAD_B, [rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)]);
  assert.notEqual(r.status, 'approved');
  assert.equal(r.status, 'historical_approval');
  assert.equal(r.reviewers[0].relation, 'historical');
  assert.equal(r.reviewers[0].commitId, HEAD_A);
  assert.equal(r.headSha, HEAD_B);
});

test('B1.4 P2-1 CASE C: an approval with no commit_id cannot be tied to any commit', async () => {
  for (const missing of [undefined, null, '']) {
    const r = await reviewsOf(HEAD_B, [rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', missing)]);
    assert.equal(r.status, 'review_head_unknown', `commit_id=${JSON.stringify(missing)}`);
    assert.equal(r.reviewers[0].relation, 'unknown');
  }
  // The PR payload itself has no head SHA: nothing can be current.
  const noHead = await reviewsOf(null, [rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)]);
  assert.equal(noHead.status, 'review_head_unknown');
});

test('B1.4 P2-1 CASE D: an incomplete review list never yields an unqualified approval', async () => {
  const r = await reviewsOf(HEAD_A, [rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)], NEXT_PAGE);
  assert.equal(r.status, 'partial');
  assert.equal(r.complete, false);
  // What was read stays inspectable but is explicitly qualified as observed, not decided.
  assert.equal(r.observed, 'current_head_approval');
});

test('B1.4 P2-1 CASE E: approval followed by CHANGES_REQUESTED leaves no hidden blocker', async () => {
  const sameReviewer = await reviewsOf(HEAD_A, [rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A), rv(2, 'bob', 'CHANGES_REQUESTED', '2026-10-16T02:00:00Z', HEAD_A)]);
  assert.equal(sameReviewer.status, 'changes_requested');
  assert.deepEqual(sameReviewer.reviewers.map((x) => x.state), ['CHANGES_REQUESTED']);
  // Different reviewers: the blocker wins, and the other approval stays visible and attributable.
  const mixed = await reviewsOf(HEAD_A, [rv(1, 'ann', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A), rv(2, 'bob', 'CHANGES_REQUESTED', '2026-10-16T02:00:00Z', HEAD_A)]);
  assert.equal(mixed.status, 'changes_requested');
  assert.deepEqual(mixed.reviewers.map((x) => [x.reviewer, x.state]), [['ann', 'APPROVED'], ['bob', 'CHANGES_REQUESTED']]);
  // A later approval by the same reviewer supersedes their own earlier request.
  const superseded = await reviewsOf(HEAD_A, [rv(1, 'bob', 'CHANGES_REQUESTED', '2026-10-16T01:00:00Z', HEAD_A), rv(2, 'bob', 'APPROVED', '2026-10-16T02:00:00Z', HEAD_A)]);
  assert.equal(superseded.status, 'current_head_approval');
  // A changes-request on an older commit still blocks until it is dismissed or superseded.
  const oldBlocker = await reviewsOf(HEAD_B, [rv(1, 'bob', 'CHANGES_REQUESTED', '2026-10-16T01:00:00Z', HEAD_A)]);
  assert.equal(oldBlocker.status, 'changes_requested');
  assert.equal(oldBlocker.reviewers[0].relation, 'historical');
});

test('B1.4 P2-1 CASE E2: a review from a deleted account is never dropped', async () => {
  const r = await reviewsOf(HEAD_A, [rv(7, null, 'CHANGES_REQUESTED', '2026-10-16T01:00:00Z', HEAD_A), rv(8, 'ann', 'APPROVED', '2026-10-16T02:00:00Z', HEAD_A)]);
  assert.equal(r.status, 'changes_requested');
  assert.equal(r.reviewers.length, 2);
});

test('B1.4 P2-1 CASE F: a dismissed approval is not an active approval', async () => {
  const r = await reviewsOf(HEAD_A, [rv(1, 'bob', 'DISMISSED', '2026-10-16T01:00:00Z', HEAD_A)]);
  assert.equal(r.status, 'approval_dismissed');
  assert.notEqual(r.status, 'current_head_approval');
  assert.equal(r.reviewers[0].state, 'DISMISSED');
  // Another reviewer's live approval is still reported as such, while the dismissal stays visible.
  const withOther = await reviewsOf(HEAD_A, [rv(1, 'bob', 'DISMISSED', '2026-10-16T01:00:00Z', HEAD_A), rv(2, 'ann', 'APPROVED', '2026-10-16T02:00:00Z', HEAD_A)]);
  assert.equal(withOther.status, 'current_head_approval');
  assert.deepEqual(withOther.reviewers.map((x) => [x.reviewer, x.state]), [['ann', 'APPROVED'], ['bob', 'DISMISSED']]);
});

test('B1.4 P2-1 CASE G: several reviewers approving different commits stay individually attributable', async () => {
  const r = await reviewsOf(HEAD_B, [rv(1, 'ann', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A), rv(2, 'bob', 'APPROVED', '2026-10-16T02:00:00Z', HEAD_B), rv(3, 'cy', 'APPROVED', '2026-10-16T03:00:00Z')]);
  assert.equal(r.status, 'current_head_approval'); // at least one approval is demonstrably on the head
  assert.deepEqual(r.reviewers.map((x) => [x.reviewer, x.commitId, x.relation]), [['ann', HEAD_A, 'historical'], ['bob', HEAD_B, 'current_head'], ['cy', null, 'unknown']]);
  const noneCurrent = await reviewsOf(HEAD_B, [rv(1, 'ann', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A), rv(3, 'cy', 'APPROVED', '2026-10-16T03:00:00Z')]);
  assert.equal(noneCurrent.status, 'historical_approval');
});

test('B1.4 P2-1 CASE I: CI on the current head and an approval of an older commit are reported independently', async () => {
  const d = await detailAt(HEAD_B, () => ghOutput([rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)]));
  assert.equal(d.ci.status, 'passing');
  assert.equal(d.ci.headSha, HEAD_B);
  assert.equal(d.reviews.status, 'historical_approval');
});

test('B1.4 P2-1 CASE J: a failed review read is Not checked, not Approved', async () => {
  const d = await detailAt(HEAD_A, () => ({ error: Object.assign(new Error('x'), { code: 1 }), stdout: '', stderr: 'gh: Server Error (HTTP 502)' }));
  assert.equal(d.reviews.status, 'not_checked');
  assert.equal(d.reviews.reviewers, undefined);
});

test('B1.4 P2-1 CASE K: a later successful read recovers a valid current-head status', async () => {
  const failed = await detailAt(HEAD_A, () => ({ error: Object.assign(new Error('x'), { code: 1 }), stdout: '', stderr: 'gh: Server Error (HTTP 502)' }));
  assert.equal(failed.reviews.status, 'not_checked');
  const recovered = await detailAt(HEAD_A, () => ghOutput([rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)]));
  assert.equal(recovered.reviews.status, 'current_head_approval');
});

test('B1.4 P2-1 positive control: the classification is not degenerate (every state is reachable)', async () => {
  const reach = new Set();
  for (const [head, items, opts] of [
    [HEAD_A, [], undefined],
    [HEAD_A, [rv(1, 'a', 'COMMENTED', '2026-10-16T01:00:00Z', HEAD_A)], undefined],
    [HEAD_A, [rv(1, 'a', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)], undefined],
    [HEAD_B, [rv(1, 'a', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)], undefined],
    [HEAD_B, [rv(1, 'a', 'APPROVED', '2026-10-16T01:00:00Z')], undefined],
    [HEAD_A, [rv(1, 'a', 'CHANGES_REQUESTED', '2026-10-16T01:00:00Z', HEAD_A)], undefined],
    [HEAD_A, [rv(1, 'a', 'DISMISSED', '2026-10-16T01:00:00Z', HEAD_A)], undefined],
    [HEAD_A, [rv(1, 'a', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)], NEXT_PAGE],
  ]) reach.add((await reviewsOf(head, items, opts)).status);
  assert.deepEqual([...reach].sort(), ['approval_dismissed', 'changes_requested', 'commented_only', 'current_head_approval', 'historical_approval', 'no_reviews', 'partial', 'review_head_unknown']);
});

test('B1.4 P2-1: summarizeReviews no longer returns a bare approval (it needs the head SHA)', () => {
  const items = [rv(1, 'a', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A)];
  assert.equal(summarizeReviews(items, HEAD_A).status, 'current_head_approval');
  assert.equal(summarizeReviews(items, HEAD_B).status, 'historical_approval');
  assert.equal(summarizeReviews(items, null).status, 'review_head_unknown');
  assert.equal(summarizeReviews([], HEAD_A).status, 'no_reviews');
});

test('B1.4 P2-1: submitted_at ordering decides the effective review; invalid states are ignored, input order does not matter', () => {
  const list = [rv(1, 'bob', 'APPROVED', '2026-10-16T01:00:00Z', HEAD_A), rv(2, 'bob', 'CHANGES_REQUESTED', '2026-10-16T02:00:00Z', HEAD_A), rv(3, 'bob', 'WHATEVER', '2026-10-16T03:00:00Z', HEAD_A), rv(4, 'bob', 'COMMENTED', '2026-10-16T04:00:00Z', HEAD_A)];
  assert.equal(summarizeReviews(list, HEAD_A).status, 'changes_requested');
  assert.equal(summarizeReviews([...list].reverse(), HEAD_A).status, 'changes_requested');
});

// ---------------- B1.4 remediation: server read-only boundary (inspection tests) ----------------
import { readFileSync } from 'node:fs';
import { ghApiPage } from '../server/githubDevelopmentHistory.mjs';

test('B1.4 server: every history route is GET-only and no write verb is routed anywhere on the GitHub router', () => {
  const router = createGithubRouter();
  const routes = router.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods).filter((m) => l.route.methods[m]) }));
  assert.ok(routes.some((r) => r.path === '/development-history'));
  assert.ok(routes.some((r) => r.path === '/development-history/pull'));
  for (const r of routes) assert.deepEqual(r.methods, ['get'], `${r.path} must be GET only`);
});

test('B1.4 server: the repository allowlist is exact — arrays, case, slashes, traversal and look-alikes are all refused before any read', async () => {
  let calls = 0;
  await withRouter({ fetchHistory: async (repo) => { calls += 1; return { repository: repo }; }, fetchHistoryPull: async () => { calls += 1; return {}; } }, async (base) => {
    // positive control: the exact repository still works
    assert.equal((await fetch(`${base}/development-history?repo=${REPO}`)).status, 200);
    assert.equal(calls, 1);
    const bad = [
      'repo=augusliang23-web/PM-Dashboard', `repo=${REPO}/`, `repo=%2F${REPO}`, `repo=${REPO}%2F..%2Fother`, `repo=${REPO}%00`, `repo=${REPO}.git`,
      `repo=${REPO}&repo=augusliang23-web/other`, 'repo[]=augusliang23-web/pm-dashboard', 'repo=', '', `repo=https://github.com/${REPO}`,
    ];
    for (const q of bad) {
      assert.equal((await fetch(`${base}/development-history?${q}`)).status, 403, q);
      assert.equal((await fetch(`${base}/development-history/pull?${q}${q ? '&' : ''}number=5`)).status, 403, q);
    }
    assert.equal(calls, 1, 'a refused request never reaches the GitHub reader');
  });
});

test('B1.4 server: the PR number is a strict positive decimal integer', async () => {
  const seen = [];
  await withRouter({ fetchHistoryPull: async (repo, number) => { seen.push(number); return {source:'GitHub',repository:repo,number}; } }, async (base) => {
    assert.equal((await fetch(`${base}/development-history/pull?repo=${REPO}&number=55`)).status, 200);
    for (const n of ['0', '-1', '1.5', '1e3', '55abc', '%2055', '', '12345678', '0x10', '55&number=56']) {
      const res = await fetch(`${base}/development-history/pull?repo=${REPO}&number=${n}`);
      assert.ok([400].includes(res.status) || n === '55&number=56', `number=${n} -> ${res.status}`);
    }
    // a repeated parameter is an array, not a number
    assert.equal((await fetch(`${base}/development-history/pull?repo=${REPO}&number=55&number=56`)).status, 400);
  });
  assert.deepEqual(seen, [55]);
});

test('B1.4 server: query parameters cannot turn a read into a mutation — every spawned gh call is a fixed GET on the allowlisted repository', async () => {
  const { execFileFn, calls } = fakeGh([
    ...standardRoutes(),
    [/\/pulls\/55$/, () => ghOutput({ ...PULLS.find((p) => p.number === 55), changed_files: 1, additions: 1, deletions: 0, commits: 1 })],
    [/\/check-runs/, () => ghOutput({ total_count: 0, check_runs: [] })],
    [/\/reviews/, () => ghOutput([])],
  ]);
  await fetchDevelopmentHistory(REPO, { execFileFn });
  await fetchPullDetail(REPO, 55, { execFileFn, aggregateCi: aggregateCiResponse });
  assert.ok(calls.length > 5);
  for (const { cmd, args, opts } of calls) {
    assert.equal(cmd, 'gh');
    assert.deepEqual(args.slice(0, 4), ['api', '--method', 'GET', '-i']);
    assert.equal(args.length, 5, 'no extra flags such as -f/-F/--input that would add a request body');
    assert.match(args[4], /^repos\/augusliang23-web\/pm-dashboard(\/|\?|$)/);
    assert.equal(opts?.shell, undefined, 'never through a shell');
  }
});

test('B1.4 server: ghApiPage refuses anything that is not a plain repos/ path', async () => {
  const { execFileFn, calls } = fakeGh([[/./, () => ghOutput({})]]);
  for (const path of ['user', '/repos/x/y', 'repos/x y', 'repos/x\ny', 'graphql', '', undefined, 42, 'orgs/x/repos']) {
    await assert.rejects(ghApiPage(path, { execFileFn }), (e) => e instanceof GithubCliError, String(path));
  }
  assert.equal(calls.length, 0);
});

test('B1.4 server: the history module has no filesystem, shell, process-spawn or agent capability (static inspection)', () => {
  const src = readFileSync(new URL('../server/githubDevelopmentHistory.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['../src/v1/projectCatalog.mjs','../src/v1/projectStatusModel.mjs','../src/v1/zc08bStatusModel.mjs','./githubRepos.mjs','node:child_process']);
  for(const name of ['projectCatalog','projectStatusModel','zc08bStatusModel']){
    const pure=readFileSync(new URL(`../src/v1/${name}.mjs`,import.meta.url),'utf8');
    assert.doesNotMatch(pure,/from ['"]node:|\bfetch\s*\(|process\.env|writeFile|execFile\s*\(/);
  }
  assert.match(src, /import \{ execFile \} from 'node:child_process'/);
  assert.doesNotMatch(src, /\b(spawn|spawnSync|execSync|execFileSync|fork)\s*\(/);
  assert.doesNotMatch(src, /shell\s*:\s*true/);
  assert.doesNotMatch(src, /writeFile|appendFile|createWriteStream|unlink|rmSync|mkdir|process\.env/);
  assert.doesNotMatch(src, /--method['"]?\s*,\s*['"](POST|PUT|PATCH|DELETE)/i);
  assert.equal([...src.matchAll(/'--method', '(\w+)'/g)].map((m) => m[1]).join(','), 'GET');
  const routes = readFileSync(new URL('../server/githubRoutes.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /router\.(post|put|patch|delete|all)\(/);
});

// ---------------- Issue #44: ambiguous review ordering fails closed ----------------
// Deterministic, synthetic review records (not GitHub evidence). HEAD is the PR head the reviews are compared with.
{
  const HEAD = 'a'.repeat(40);
  const OLD = 'b'.repeat(40);
  const T = '2026-10-01T00:00:00Z';
  const rv = (state, over = {}) => ({ user: { login: 'alice' }, state, commit_id: HEAD, submitted_at: T, ...over });
  const permutations = (list) => (list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])));
  const everyOrder = (list, head = HEAD) => permutations(list).map((order) => summarizeReviews(order, head));
  const approvalsIn = (summary) => summary.reviewers.filter((r) => r.state === 'APPROVED');

  test('#44 A/B: same reviewer, same timestamp, missing ids, APPROVED vs CHANGES_REQUESTED -> blocker kept in either input order', () => {
    const list = [rv('APPROVED'), rv('CHANGES_REQUESTED')];
    for (const s of everyOrder(list)) {
      assert.equal(s.status, 'changes_requested');
      assert.notEqual(s.status, 'current_head_approval');
      assert.equal(approvalsIn(s).length, 0, 'an approval that cannot be ordered must not stay in the serialized reviewers');
      assert.ok(s.reviewers.some((r) => r.state === 'CHANGES_REQUESTED'));
    }
    assert.deepEqual(everyOrder(list)[0], everyOrder(list)[1], 'result must not depend on array order');
  });

  test('#44 C: same timestamp with valid distinct numeric ids -> the larger id is the later review, in any order', () => {
    const approvedLater = [rv('CHANGES_REQUESTED', { id: 10 }), rv('APPROVED', { id: 11 })];
    for (const s of everyOrder(approvedLater)) { assert.equal(s.status, 'current_head_approval'); assert.equal(s.reviewers[0].reviewId, 11); }
    const blockerLater = [rv('APPROVED', { id: 10 }), rv('CHANGES_REQUESTED', { id: 11 })];
    for (const s of everyOrder(blockerLater)) assert.equal(s.status, 'changes_requested');
    for (const s of everyOrder([rv('APPROVED', { id: '12' }), rv('CHANGES_REQUESTED', { id: '9' })])) assert.equal(s.status, 'current_head_approval'); // numeric strings compare as numbers, not text
  });

  test('#44 D: same timestamp with invalid, equal or partial ids fails closed in every order', () => {
    const cases = [
      [rv('APPROVED', { id: 'x' }), rv('CHANGES_REQUESTED', { id: 'y' })],
      [rv('APPROVED', { id: null }), rv('CHANGES_REQUESTED', { id: 7 })],
      [rv('APPROVED', { id: 7 }), rv('CHANGES_REQUESTED', { id: 7 })],
      [rv('APPROVED', { id: -1 }), rv('CHANGES_REQUESTED', { id: 0 })],
      [rv('APPROVED', { id: 1.5 }), rv('CHANGES_REQUESTED', { id: 2.5 })],
    ];
    for (const list of cases) for (const s of everyOrder(list)) { assert.equal(s.status, 'changes_requested', JSON.stringify(list)); assert.equal(approvalsIn(s).length, 0); }
  });

  test('#44 E: missing or invalid timestamps never let the first-seen APPROVED win', () => {
    const cases = [
      [rv('APPROVED', { submitted_at: undefined }), rv('CHANGES_REQUESTED', { submitted_at: undefined })],
      [rv('APPROVED', { submitted_at: 'not-a-date' }), rv('CHANGES_REQUESTED', { submitted_at: 'also-bad' })],
      [rv('APPROVED', { submitted_at: null, id: 1 }), rv('CHANGES_REQUESTED', { submitted_at: null, id: 2 })], // ids do not order records whose timestamps are unusable
      [rv('APPROVED'), rv('CHANGES_REQUESTED', { submitted_at: 'garbage' })],
    ];
    for (const list of cases) for (const s of everyOrder(list)) { assert.equal(s.status, 'changes_requested', JSON.stringify(list)); assert.equal(approvalsIn(s).length, 0); }
  });

  test('#44 F: ambiguous APPROVED vs DISMISSED never yields an active current-head approval', () => {
    const list = [rv('APPROVED'), rv('DISMISSED')];
    for (const s of everyOrder(list)) { assert.equal(s.status, 'approval_dismissed'); assert.equal(approvalsIn(s).length, 0); }
    for (const s of everyOrder([rv('APPROVED', { id: 1 }), rv('DISMISSED', { id: 2 })])) assert.equal(s.status, 'approval_dismissed');
    for (const s of everyOrder([rv('APPROVED', { id: 2 }), rv('DISMISSED', { id: 1 })])) assert.equal(s.status, 'current_head_approval');
    // CHANGES_REQUESTED outranks DISMISSED and APPROVED when all three are tied.
    for (const s of everyOrder([rv('APPROVED'), rv('DISMISSED'), rv('CHANGES_REQUESTED')])) assert.equal(s.status, 'changes_requested');
  });

  test('#44: tied APPROVED records on different commits take the least-trusted relation (order invariant)', () => {
    const list = [rv('APPROVED', { commit_id: HEAD }), rv('APPROVED', { commit_id: OLD })];
    for (const s of everyOrder(list)) assert.equal(s.status, 'historical_approval');
    for (const s of everyOrder([rv('APPROVED', { commit_id: HEAD }), rv('APPROVED', { commit_id: null })])) assert.equal(s.status, 'review_head_unknown');
  });

  test('#44 G/I/J/K: historical, head-less, current-head and legitimately superseded reviews keep their semantics', () => {
    assert.equal(summarizeReviews([rv('APPROVED', { commit_id: OLD })], HEAD).status, 'historical_approval');
    assert.equal(summarizeReviews([rv('APPROVED', { commit_id: null })], HEAD).status, 'review_head_unknown');
    assert.equal(summarizeReviews([rv('APPROVED', { commit_id: '' })], HEAD).status, 'review_head_unknown');
    assert.equal(summarizeReviews([rv('APPROVED')], HEAD).status, 'current_head_approval');
    assert.equal(summarizeReviews([rv('APPROVED')], null).status, 'review_head_unknown');
    const superseded = [rv('CHANGES_REQUESTED', { id: 1, submitted_at: '2026-10-01T00:00:00Z' }), rv('APPROVED', { id: 2, submitted_at: '2026-10-02T00:00:00Z' })];
    for (const s of everyOrder(superseded)) assert.equal(s.status, 'current_head_approval');
    const revoked = [rv('APPROVED', { submitted_at: '2026-10-01T00:00:00Z' }), rv('CHANGES_REQUESTED', { submitted_at: '2026-10-02T00:00:00Z' })];
    for (const s of everyOrder(revoked)) assert.equal(s.status, 'changes_requested');
    // A decided, different timestamp wins over ids that point the other way (ids only break exact timestamp ties).
    for (const s of everyOrder([rv('APPROVED', { id: 99, submitted_at: '2026-10-01T00:00:00Z' }), rv('CHANGES_REQUESTED', { id: 1, submitted_at: '2026-10-02T00:00:00Z' })])) assert.equal(s.status, 'changes_requested');
  });

  test('#44 L: mixed reviewers, anonymous accounts, COMMENTED-only and no reviews keep their semantics', () => {
    const mixed = [rv('APPROVED', { user: { login: 'alice' } }), rv('CHANGES_REQUESTED', { user: { login: 'bob' } })];
    for (const s of everyOrder(mixed)) { assert.equal(s.status, 'changes_requested'); assert.equal(s.reviewers.length, 2); }
    // two different reviewers tied at the same instant are NOT competing: each keeps their own decision
    for (const s of everyOrder([rv('APPROVED', { user: { login: 'alice' } }), rv('APPROVED', { user: { login: 'bob' } })])) assert.deepEqual(s.reviewers.map((r) => r.reviewer), ['alice', 'bob']);
    // deleted accounts are kept individually, so a blocker cannot vanish and an approval cannot hide it
    const anon = [rv('APPROVED', { user: null, id: 1 }), rv('CHANGES_REQUESTED', { user: null, id: 2 })];
    for (const s of everyOrder(anon)) { assert.equal(s.status, 'changes_requested'); assert.equal(s.reviewers.length, 2); }
    assert.equal(summarizeReviews([rv('COMMENTED')], HEAD).status, 'commented_only');
    assert.equal(summarizeReviews([rv('COMMENTED'), rv('APPROVED', { id: 5 })], HEAD).status, 'current_head_approval');
    assert.equal(summarizeReviews([], HEAD).status, 'no_reviews');
    assert.equal(summarizeReviews(undefined, HEAD).status, 'no_reviews');
  });

  test('#44 H: a truncated review list stays PARTIAL in the served detail whatever the tie rule decides', () => {
    // fetchPullDetail marks truncated review pages partial before any ordering matters; the ordering only fills `observed`.
    const src = readFileSync(new URL('../server/githubDevelopmentHistory.mjs', import.meta.url), 'utf8');
    assert.match(src, /status: reviewsComplete \? observedReview\.status : 'partial'/);
    assert.match(src, /\.\.\.\(reviewsComplete \? \{\} : \{ observed: observedReview\.status \}\)/);
  });

  test('#44: the ordering rule is pure (no new GitHub request) and keeps the serialized reviewer shape', () => {
    const s = summarizeReviews([rv('APPROVED', { id: 3 })], HEAD);
    assert.deepEqual(Object.keys(s).sort(), ['reviewers', 'status']);
    assert.deepEqual(Object.keys(s.reviewers[0]).sort(), ['commitId', 'relation', 'reviewId', 'reviewer', 'state', 'submittedAt']);
    const src = readFileSync(new URL('../server/githubDevelopmentHistory.mjs', import.meta.url), 'utf8');
    const start = src.indexOf('const DECISIVE_REVIEW_STATES');
    const end = src.indexOf('/** Per-process memory cache');
    assert.ok(start > 0 && end > start, 'review ordering section not found');
    assert.doesNotMatch(src.slice(start, end), /execFile|ghApi|fetch\(|spawn|process\.env/); // no GitHub, process or environment access
  });
}
