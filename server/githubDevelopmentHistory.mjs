import { execFile } from 'node:child_process';
import { GithubCliError } from './githubRepos.mjs';

/**
 * Read-only development-history snapshot for ONE allowlisted repository.
 *
 * Every GitHub call is a `gh api <GET path>` through the user's existing
 * authenticated GitHub CLI. Nothing here writes to GitHub, reads tokens, or
 * touches a local checkout. Each response carries explicit provenance
 * (source, repository, fetchedAt) and completeness flags so the UI can label
 * partial data instead of presenting it as the whole history.
 */

export const DEVELOPMENT_HISTORY_REPOS = Object.freeze(['augusliang23-web/pm-dashboard']);

export const HISTORY_LIMITS = Object.freeze({
  perPage: 100,
  maxBranchPages: 5, // 500 branches
  maxPullPages: 5, // 500 PRs
  maxDefaultBranchCommitPages: 10, // 1,000 commits of default-branch history
  maxCompareCommits: 250, // GitHub's compare endpoint cap per response
  maxFocusRefs: 30,
  requestTimeoutMs: 20_000,
  concurrency: 4,
  cacheTtlMs: 5 * 60_000,
});

export function isAllowlistedHistoryRepo(repo) {
  return typeof repo === 'string' && DEVELOPMENT_HISTORY_REPOS.includes(repo);
}

/** Parses an RFC 5988 Link header into { next, last, ... } URLs. */
export function parseLinkHeader(value) {
  const links = {};
  if (!value) return links;
  for (const part of value.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

/**
 * Splits `gh api -i` output into status, lower-cased headers and JSON body.
 * gh prints the HTTP status line, headers, a blank line, then the body.
 */
export function parseGhIncludeOutput(stdout) {
  const text = String(stdout ?? '');
  const sep = text.search(/\r?\n\r?\n/);
  const head = sep >= 0 ? text.slice(0, sep) : text;
  const body = sep >= 0 ? text.slice(sep).replace(/^\r?\n\r?\n/, '') : '';
  const lines = head.split(/\r?\n/);
  const statusMatch = (lines[0] || '').match(/^HTTP\/[\d.]+\s+(\d{3})/);
  const headers = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { status: statusMatch ? Number(statusMatch[1]) : null, headers, body };
}

export function classifyGhFailure({ error, stdout, stderr }) {
  if (error?.code === 'ENOENT') return new GithubCliError('GitHub CLI (gh) was not found on the server PATH.', 'not_found');
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return new GithubCliError('GitHub request was cancelled.', 'aborted');
  if (error?.killed || error?.signal === 'SIGTERM') return new GithubCliError('GitHub request timed out.', 'timeout');
  const parsed = parseGhIncludeOutput(stdout);
  const err = String(stderr || '');
  const rateLimited =
    /rate limit/i.test(err) ||
    parsed.status === 429 ||
    (parsed.status === 403 && parsed.headers['x-ratelimit-remaining'] === '0');
  if (rateLimited) {
    const reset = Number(parsed.headers['x-ratelimit-reset']);
    const e = new GithubCliError('GitHub API rate limit reached.', 'rate_limited');
    if (Number.isFinite(reset) && reset > 0) e.resetAt = new Date(reset * 1000).toISOString();
    return e;
  }
  if (parsed.status === 401 || /not logged|auth login|authentication|HTTP 401|Bad credentials/i.test(err)) {
    return new GithubCliError('GitHub CLI is not authenticated. Run `gh auth login`.', 'not_authenticated');
  }
  if (parsed.status === 404 || /HTTP 404|Not Found/i.test(err)) return new GithubCliError('GitHub resource not found.', 'missing');
  return new GithubCliError(err.trim() || error?.message || 'GitHub CLI request failed.', 'failed');
}

/** One GET page via `gh api -i`, returning parsed JSON and pagination links. */
export function ghApiPage(path, { execFileFn = execFile, signal, timeoutMs = HISTORY_LIMITS.requestTimeoutMs } = {}) {
  if (typeof path !== 'string' || !path.startsWith('repos/') || /\s/.test(path)) {
    return Promise.reject(new GithubCliError('Refusing unexpected GitHub API path.', 'failed'));
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GithubCliError('GitHub request was cancelled.', 'aborted'));
      return;
    }
    execFileFn(
      'gh',
      ['api', '--method', 'GET', '-i', path],
      { maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs, signal },
      (error, stdout, stderr) => {
        if (error) {
          reject(classifyGhFailure({ error, stdout, stderr }));
          return;
        }
        const parsed = parseGhIncludeOutput(stdout);
        try {
          resolve({ data: JSON.parse(parsed.body), links: parseLinkHeader(parsed.headers.link), headers: parsed.headers });
        } catch {
          reject(new GithubCliError('Failed to parse GitHub CLI response.', 'failed'));
        }
      },
    );
  });
}

export function nextPageNumber(nextUrl) {
  if (!nextUrl) return null;
  try {
    const n = Number(new URL(nextUrl).searchParams.get('page'));
    return Number.isInteger(n) && n > 1 ? n : null;
  } catch {
    return null;
  }
}

/** Follows rel="next" up to maxPages. `complete` is false when pages remain. */
export async function fetchPaginated(path, { maxPages, perPage = HISTORY_LIMITS.perPage, ...opts }) {
  const items = [];
  const base = `${path}${path.includes('?') ? '&' : '?'}per_page=${perPage}`;
  let pages = 0;
  let nextPage = 1;
  // GitHub's next links may use repositories/<id>/ paths; only the page
  // number is taken from them so every request stays bound to `path`.
  while (nextPage && pages < maxPages) {
    const page = await ghApiPage(nextPage === 1 ? base : `${base}&page=${nextPage}`, opts);
    pages += 1;
    if (!Array.isArray(page.data)) throw new GithubCliError('Unexpected GitHub list response shape.', 'failed');
    items.push(...page.data);
    nextPage = nextPageNumber(page.links.next);
  }
  return { items, pages, complete: !nextPage };
}

export function normalizeBranch(item) {
  return { name: item.name, headSha: item.commit?.sha ?? null, protected: Boolean(item.protected) };
}

export function normalizePull(item) {
  const merged = Boolean(item.merged_at);
  return {
    number: item.number,
    title: item.title ?? '',
    url: item.html_url,
    author: item.user?.login ?? null,
    state: item.state === 'open' ? 'open' : 'closed',
    isDraft: Boolean(item.draft),
    merged,
    // A state the UI can render without inferring anything: merged vs
    // closed-without-merge is decided only by GitHub's merged_at field.
    status: item.state === 'open' ? (item.draft ? 'draft' : 'open') : merged ? 'merged' : 'closed_unmerged',
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
    closedAt: item.closed_at ?? null,
    mergedAt: item.merged_at ?? null,
    baseRef: item.base?.ref ?? null,
    baseSha: item.base?.sha ?? null,
    headRef: item.head?.ref ?? null,
    headSha: item.head?.sha ?? null,
    headRepo: item.head?.repo?.full_name ?? null,
    mergeCommitSha: merged ? (item.merge_commit_sha ?? null) : null,
  };
}

export function normalizeCommit(item) {
  return {
    sha: item.sha,
    parents: Array.isArray(item.parents) ? item.parents.map((p) => p.sha) : [],
    message: (item.commit?.message || '').split('\n')[0],
    authorDate: item.commit?.author?.date ?? null,
    committerDate: item.commit?.committer?.date ?? null,
    author: item.author?.login ?? item.commit?.author?.name ?? null,
    url: item.html_url ?? null,
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Refs whose commits are fetched as verified ancestry: production-pages,
 * every open PR's head and base, deduplicated and bounded. The default branch
 * history is fetched directly; every other focus ref is read through
 * compare(default...ref), which returns its commits not on the default branch
 * plus the GitHub-computed merge base.
 */
export function selectFocusRefs({ defaultBranch, branches, pulls, limit = HISTORY_LIMITS.maxFocusRefs }) {
  const existing = new Set(branches.map((b) => b.name));
  const wanted = [];
  const add = (ref) => {
    if (ref && ref !== defaultBranch && existing.has(ref) && !wanted.includes(ref)) wanted.push(ref);
  };
  add('production-pages');
  for (const pr of pulls.filter((p) => p.state === 'open').sort((a, b) => a.number - b.number)) {
    // Fork heads do not exist as branches in this repository.
    if (!pr.headRepo || pr.headRepo === pr.baseRepo) add(pr.headRef);
    add(pr.baseRef);
  }
  return { refs: wanted.slice(0, limit), truncated: wanted.length > limit, requested: wanted.length };
}

export async function fetchDevelopmentHistory(repo, { execFileFn = execFile, signal, now = () => new Date() } = {}) {
  if (!isAllowlistedHistoryRepo(repo)) {
    throw new GithubCliError(`Repository is not allowlisted for development history: ${repo}`, 'forbidden');
  }
  const opts = { execFileFn, signal };
  const startedAt = now().toISOString();
  const warnings = [];

  const repoInfo = (await ghApiPage(`repos/${repo}`, opts)).data;
  const defaultBranch = repoInfo?.default_branch || 'main';

  // Branches and PRs are read first; every later read is pinned to the exact
  // SHAs observed here so commits/compares describe one fixed set of heads.
  const [branchPage, pullPage] = await Promise.all([
    fetchPaginated(`repos/${repo}/branches`, { ...opts, maxPages: HISTORY_LIMITS.maxBranchPages }),
    fetchPaginated(`repos/${repo}/pulls?state=all&sort=created&direction=desc`, { ...opts, maxPages: HISTORY_LIMITS.maxPullPages }),
  ]);
  const branches = branchPage.items.map(normalizeBranch).sort((a, b) => a.name.localeCompare(b.name));
  const pulls = pullPage.items
    .map((item) => ({ ...normalizePull(item), baseRepo: item.base?.repo?.full_name ?? repo }))
    .sort((a, b) => a.number - b.number);
  const defaultHeadSha = branches.find((b) => b.name === defaultBranch)?.headSha ?? null;
  if (!defaultHeadSha) warnings.push(`${defaultBranch} head was not observed in the branch list; history is read by name and cannot be pinned.`);
  const mainPage = await fetchPaginated(`repos/${repo}/commits?sha=${encodeURIComponent(defaultHeadSha ?? defaultBranch)}`, {
    ...opts,
    maxPages: HISTORY_LIMITS.maxDefaultBranchCommitPages,
  });
  if (!branchPage.complete) warnings.push(`Branch list truncated after ${branchPage.pages} pages.`);
  if (!pullPage.complete) warnings.push(`Pull request list truncated after ${pullPage.pages} pages.`);
  if (!mainPage.complete) warnings.push(`${defaultBranch} history truncated after ${mainPage.items.length} commits.`);

  const focus = selectFocusRefs({ defaultBranch, branches, pulls });
  if (focus.truncated) warnings.push(`Only ${focus.refs.length} of ${focus.requested} focus refs were compared.`);

  const headOf = (name) => branches.find((b) => b.name === name)?.headSha ?? null;
  const comparisons = await mapLimit(focus.refs, HISTORY_LIMITS.concurrency, async (ref) => {
    const refSha = headOf(ref);
    const baseSpec = defaultHeadSha ?? defaultBranch;
    if (!refSha) {
      warnings.push(`Compare ${defaultBranch}...${ref} skipped: head SHA not observed.`);
      return { base: defaultBranch, head: ref, status: null, aheadBy: null, behindBy: null, totalCommits: null, mergeBaseSha: null, commits: [], complete: false, error: 'missing' };
    }
    try {
      const { data } = await ghApiPage(
        `repos/${repo}/compare/${encodeURIComponent(baseSpec)}...${encodeURIComponent(refSha)}?per_page=${HISTORY_LIMITS.maxCompareCommits}`,
        opts,
      );
      const commits = Array.isArray(data.commits) ? data.commits.map(normalizeCommit) : [];
      const total = Number.isInteger(data.total_commits) ? data.total_commits : null;
      const complete = total !== null && commits.length >= total;
      if (!complete) warnings.push(`Compare ${defaultBranch}...${ref} returned ${commits.length} of ${total ?? 'unknown'} commits.`);
      return {
        base: defaultBranch,
        head: ref,
        baseSha: defaultHeadSha,
        headSha: refSha,
        status: data.status ?? null,
        aheadBy: data.ahead_by ?? null,
        behindBy: data.behind_by ?? null,
        totalCommits: total,
        mergeBaseSha: data.merge_base_commit?.sha ?? null,
        commits,
        complete,
        error: null,
      };
    } catch (error) {
      if (error instanceof GithubCliError && ['aborted', 'not_authenticated', 'rate_limited'].includes(error.kind)) throw error;
      warnings.push(`Compare ${defaultBranch}...${ref} unavailable: ${error.kind ?? 'failed'}.`);
      return { base: defaultBranch, head: ref, status: null, aheadBy: null, behindBy: null, totalCommits: null, mergeBaseSha: null, commits: [], complete: false, error: error.kind ?? 'failed' };
    }
  });

  // Moving-ref check. GitHub offers no transaction across these GETs, so the
  // branch list is read again: any ref whose head changed, appeared or vanished
  // is reported. The result is never described as an atomic snapshot.
  const consistency = await assessConsistency({ repo, opts, branches, pulls, defaultBranch, focusRefs: focus.refs, now, warnings });

  const commitMap = new Map();
  for (const commit of mainPage.items.map(normalizeCommit)) commitMap.set(commit.sha, commit);
  for (const comparison of comparisons) for (const commit of comparison.commits) if (!commitMap.has(commit.sha)) commitMap.set(commit.sha, commit);

  const defaultShas = mainPage.items.map((c) => c.sha);
  const refs = {
    [defaultBranch]: {
      headSha: branches.find((b) => b.name === defaultBranch)?.headSha ?? defaultShas[0] ?? null,
      commitsFetched: defaultShas.length,
      complete: mainPage.complete,
    },
  };
  for (const comparison of comparisons) {
    refs[comparison.head] = {
      headSha: branches.find((b) => b.name === comparison.head)?.headSha ?? null,
      commitsFetched: comparison.commits.length,
      complete: comparison.complete,
      mergeBaseSha: comparison.mergeBaseSha,
    };
  }

  const complete = branchPage.complete && pullPage.complete && mainPage.complete && !focus.truncated && comparisons.every((c) => c.complete) && consistency.status === 'consistent' && Boolean(defaultHeadSha);
  return {
    source: 'GitHub',
    repository: repo,
    repositoryUrl: repoInfo?.html_url ?? `https://github.com/${repo}`,
    defaultBranch,
    startedAt,
    fetchedAt: now().toISOString(),
    status: complete ? 'complete' : 'partial',
    coverage: {
      branches: { count: branches.length, pages: branchPage.pages, complete: branchPage.complete },
      pulls: {
        count: pulls.length,
        open: pulls.filter((p) => p.state === 'open').length,
        draft: pulls.filter((p) => p.state === 'open' && p.isDraft).length,
        merged: pulls.filter((p) => p.merged).length,
        closedUnmerged: pulls.filter((p) => p.status === 'closed_unmerged').length,
        pages: pullPage.pages,
        complete: pullPage.complete,
      },
      commits: { count: commitMap.size, defaultBranchCommits: defaultShas.length, defaultBranchComplete: mainPage.complete },
      focusRefs: { compared: focus.refs.length, requested: focus.requested, truncated: focus.truncated },
      // Explicitly out of scope for this read: never inferred from remote data.
      localWorktrees: 'not_checked',
      deployments: 'not_checked',
      ci: 'not_checked',
    },
    warnings,
    consistency,
    branches,
    pulls: pulls.map(({ baseRepo, ...pr }) => pr),
    commits: [...commitMap.values()],
    defaultBranchShas: defaultShas,
    refs,
    comparisons: comparisons.map(({ commits, ...c }) => ({ ...c, commitShas: commits.map((x) => x.sha) })),
  };
}


/**
 * Re-reads the branch list after the dependent reads and reports drift.
 * Any drift makes the whole snapshot inconsistent (top-level Partial).
 * `relevant` marks refs that edges or ancestry claims depend on (the default
 * branch and every compared focus ref); unrelated drift does not by itself
 * invalidate an edge whose refs did not move. Open PRs whose head SHA differs from
 * their head branch's observed head are listed too: the PR list and branch
 * list were read at different instants, so any claim that joins them is UNKNOWN.
 */
export async function assessConsistency({ repo, opts, branches, pulls, defaultBranch, focusRefs, now, warnings }) {
  const relevantRefs = new Set([defaultBranch, ...focusRefs]);
  const observed = new Map(branches.map((b) => [b.name, b.headSha]));
  let reread;
  try {
    reread = new Map((await fetchPaginated(`repos/${repo}/branches`, { ...opts, maxPages: HISTORY_LIMITS.maxBranchPages })).items.map((i) => [i.name, i.commit?.sha ?? null]));
  } catch (error) {
    if (error instanceof GithubCliError && ['aborted', 'not_authenticated', 'rate_limited'].includes(error.kind)) throw error;
    warnings.push('Branch heads could not be re-read; snapshot consistency is not verified.');
    return { atomic: false, status: 'unverified', rereadAt: null, driftedRefs: [], prHeadMismatches: [] };
  }
  const driftedRefs = [];
  for (const name of new Set([...observed.keys(), ...reread.keys()])) {
    const before = observed.get(name) ?? null;
    const after = reread.get(name) ?? null;
    if (before !== after) driftedRefs.push({ ref: name, observed: before, reread: after, relevant: relevantRefs.has(name) });
  }
  driftedRefs.sort((a, b) => a.ref.localeCompare(b.ref));
  const prHeadMismatches = [];
  for (const pr of pulls) {
    if (pr.state !== 'open' || !pr.headRef) continue;
    if (pr.headRepo && pr.headRepo !== pr.baseRepo) continue; // fork heads are not branches here
    const branchHead = observed.get(pr.headRef);
    if (branchHead && pr.headSha && branchHead !== pr.headSha) {
      prHeadMismatches.push({ number: pr.number, headRef: pr.headRef, prHeadSha: pr.headSha, branchHeadSha: branchHead });
    }
  }
  // Snapshot completeness: ANY observed drift (moved, new or removed branch) makes the repository
  // snapshot inconsistent/Partial. `relevant` only tells the UI which per-edge claims are affected.
  const inconsistent = driftedRefs.length > 0 || prHeadMismatches.length > 0;
  if (driftedRefs.length) warnings.push(`Branch heads moved during the read: ${driftedRefs.map((r) => r.ref).join(', ')}.`);
  if (prHeadMismatches.length) warnings.push(`PR head differs from branch head for: ${prHeadMismatches.map((m) => `#${m.number}`).join(', ')}.`);
  return { atomic: false, status: inconsistent ? 'inconsistent' : 'consistent', rereadAt: now().toISOString(), driftedRefs, prHeadMismatches };
}

/**
 * On-demand detail for ONE PR: the single-PR record (changed file counts),
 * check runs for its head SHA and submitted reviews (with each review's commit_id). All GET; never comments,
 * approves, merges or re-runs checks.
 */
export async function fetchPullDetail(repo, number, { execFileFn = execFile, signal, now = () => new Date(), aggregateCi } = {}) {
  if (!isAllowlistedHistoryRepo(repo)) {
    throw new GithubCliError(`Repository is not allowlisted for development history: ${repo}`, 'forbidden');
  }
  if (!Number.isInteger(number) || number < 1) throw new GithubCliError('PR number must be a positive integer.', 'failed');
  const opts = { execFileFn, signal };
  const pr = (await ghApiPage(`repos/${repo}/pulls/${number}`, opts)).data;
  const headSha = pr?.head?.sha;
  const [checks, reviews] = await Promise.all([
    headSha
      ? ghApiPage(`repos/${repo}/commits/${headSha}/check-runs?per_page=100`, opts).then((r) => r.data).catch((e) => {
          if (e.kind === 'aborted') throw e;
          return null;
        })
      : Promise.resolve(null),
    fetchPaginated(`repos/${repo}/pulls/${number}/reviews`, { ...opts, maxPages: 3 }).catch((e) => {
      if (e.kind === 'aborted') throw e;
      return null;
    }),
  ]);
  const reviewItems = reviews?.items ?? null;
  const reviewsComplete = reviews?.complete === true;
  const observedReview = reviewItems === null ? null : summarizeReviews(reviewItems, headSha ?? null);
  return {
    source: 'GitHub',
    repository: repo,
    number,
    fetchedAt: now().toISOString(),
    pull: { ...normalizePull(pr), changedFiles: pr?.changed_files ?? null, additions: pr?.additions ?? null, deletions: pr?.deletions ?? null, commits: pr?.commits ?? null },
    // 'not_checked' only when the request itself failed; 'none' means GitHub
    // reported zero check runs for this SHA — the two are never merged.
    // ci.headSha is the SHA the check runs were read for, always the same
    // head the pull record above reported.
    ci: checks === null ? { status: 'not_checked', total: null, headSha: headSha ?? null } : { status: aggregateCi ? aggregateCi(checks) : 'unknown', total: checks.total_count ?? null, headSha },
    reviews:
      reviewItems === null
        ? { status: 'not_checked', count: null, complete: false }
        : {
            // A decision derived from a truncated list is not a verdict: later
            // pages may hold newer or conflicting reviews. `observed` keeps
            // what the read pages showed (a blocker stays visible).
            status: reviewsComplete ? observedReview.status : 'partial',
            count: reviewItems.length,
            complete: reviewsComplete,
            // The PR head these reviews are compared with (same read as `pull.headSha`) and each effective review's
            // own commit_id: provenance is preserved, not collapsed into one word.
            headSha: headSha ?? null,
            reviewers: observedReview.reviewers,
            ...(reviewsComplete ? {} : { observed: observedReview.status }),
          },
  };
}

/**
 * Review provenance (B1.4 P2-1). GitHub returns, for every submitted review, the `commit_id` it was
 * made against. A review summary that drops that field cannot tell an approval of the CURRENT head from
 * an approval of a commit that has since been superseded, so it is kept here and compared with the PR head
 * read in the same request. A review record is evidence of a review only: it is never proof that GitHub
 * would currently permit a merge (required checks, required reviewers, branch rules and dismissal of stale
 * reviews are not evaluated here) and never evidence of deployment.
 *
 * Effective review per reviewer = their latest decisive review (APPROVED, CHANGES_REQUESTED or DISMISSED);
 * COMMENTED never supersedes a decision, unknown states are ignored. Reviews from a deleted account
 * (no login) are kept individually so that a blocker cannot disappear.
 */
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

function reviewRelation(commitId, headSha) {
  if (typeof commitId !== 'string' || commitId === '' || typeof headSha !== 'string' || headSha === '') return 'unknown';
  return commitId.toLowerCase() === headSha.toLowerCase() ? 'current_head' : 'historical';
}

function laterReview(a, b) {
  const ta = Date.parse(a.submitted_at);
  const tb = Date.parse(b.submitted_at);
  const na = Number.isNaN(ta) ? -Infinity : ta;
  const nb = Number.isNaN(tb) ? -Infinity : tb;
  if (na !== nb) return na > nb;
  const ia = Number(a.id);
  const ib = Number(b.id);
  return Number.isFinite(ia) && Number.isFinite(ib) ? ia > ib : false;
}

export function summarizeReviews(reviews, headSha) {
  if (!Array.isArray(reviews) || reviews.length === 0) return { status: 'no_reviews', reviewers: [] };
  const latest = new Map();
  let commented = false;
  reviews.forEach((review, index) => {
    if (review?.state === 'COMMENTED') commented = true;
    if (!DECISIVE_REVIEW_STATES.has(review?.state)) return;
    const login = review.user?.login;
    const key = login ? `user:${login}` : `anonymous:${review.id ?? `index-${index}`}`;
    const prev = latest.get(key);
    if (!prev || laterReview(review, prev)) latest.set(key, review);
  });
  const reviewers = [...latest.values()]
    .map((r) => ({
      reviewer: r.user?.login ?? null,
      reviewId: r.id ?? null,
      state: r.state,
      commitId: typeof r.commit_id === 'string' && r.commit_id !== '' ? r.commit_id : null,
      submittedAt: r.submitted_at ?? null,
      relation: reviewRelation(r.commit_id, headSha),
    }))
    .sort((a, b) => (a.reviewer ?? '\uffff').localeCompare(b.reviewer ?? '\uffff') || Number(a.reviewId) - Number(b.reviewId));
  const approvals = reviewers.filter((r) => r.state === 'APPROVED');
  let status;
  if (reviewers.some((r) => r.state === 'CHANGES_REQUESTED')) status = 'changes_requested';
  else if (approvals.some((r) => r.relation === 'current_head')) status = 'current_head_approval';
  else if (approvals.some((r) => r.relation === 'historical')) status = 'historical_approval';
  else if (approvals.length > 0) status = 'review_head_unknown';
  else if (reviewers.some((r) => r.state === 'DISMISSED')) status = 'approval_dismissed';
  else status = commented ? 'commented_only' : 'no_reviews';
  return { status, reviewers };
}

/** Per-process memory cache keyed by exact repository; no disk persistence. */
export function createHistoryCache({ ttlMs = HISTORY_LIMITS.cacheTtlMs, now = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (now() - hit.storedAt > ttlMs) {
        entries.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value) {
      entries.set(key, { value, storedAt: now() });
    },
    clear() {
      entries.clear();
    },
  };
}
