import { execFile } from 'node:child_process';
import { GithubCliError, ghApiJson } from './githubRepos.mjs';

export function isRealGithubRepo(repository) {
  return typeof repository === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repository);
}

export function aggregateCiStatus(checkRuns) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) return 'none';
  const failed = ['failure', 'timed_out', 'cancelled', 'action_required'];
  if (checkRuns.some((run) => failed.includes(run.conclusion))) return 'failing';
  if (checkRuns.some((run) => !['completed', 'in_progress', 'queued'].includes(run.status))) return 'unknown';
  if (checkRuns.some((run) => run.status === 'in_progress')) return 'running';
  if (checkRuns.some((run) => run.status === 'queued')) return 'pending';
  return checkRuns.every((run) => run.conclusion === 'success') ? 'passing' : 'unknown';
}

// The first check-runs page is not proof of the complete check set.
function aggregateCiResponse(response) {
  if (!response || !Array.isArray(response.check_runs) || !Number.isInteger(response.total_count) || response.total_count < 0) return 'unknown';
  const result = aggregateCiStatus(response.check_runs);
  if (result === 'failing') return result; // A known failure remains a blocker.
  return response.check_runs.length === response.total_count ? result : 'unknown';
}

export function aggregateReviewDecision(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return 'review_required';
  const latestByUser = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login || review.state === 'COMMENTED') continue;
    const prev = latestByUser.get(login);
    if (!prev || new Date(review.submitted_at) > new Date(prev.submitted_at)) {
      latestByUser.set(login, review);
    }
  }
  const states = [...latestByUser.values()].map((r) => r.state);
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.includes('APPROVED')) return 'approved';
  return 'review_required';
}

/**
 * Read-only snapshot of a repo's most relevant PR for the verdict engine:
 * the newest open PR if one exists, else the newest merged PR, else 'none'.
 * Never writes to GitHub (no comments, merges, labels, approvals).
 */
export async function fetchPullRequestStatus(repo, { execFileFn = execFile } = {}) {
  if (!isRealGithubRepo(repo)) {
    throw new GithubCliError(`Not a valid owner/repo slug: ${repo}`, 'failed');
  }

  const openPrs = await ghApiJson(`repos/${repo}/pulls?state=open&per_page=1&sort=updated&direction=desc`, {
    execFileFn,
  });

  if (Array.isArray(openPrs) && openPrs.length > 0) {
    const pr = openPrs[0];
    const sha = pr.head?.sha;
    const [ciStatus, reviews] = await Promise.all([
      sha
        ? ghApiJson(`repos/${repo}/commits/${sha}/check-runs?per_page=100`, { execFileFn }).then(aggregateCiResponse)
        : Promise.resolve('unknown'),
      ghApiJson(`repos/${repo}/pulls/${pr.number}/reviews`, { execFileFn }),
    ]);

    return {
      state: 'open',
      prNumber: pr.number,
      prUrl: pr.html_url,
      isDraft: Boolean(pr.draft),
      ciStatus,
      reviewDecision: aggregateReviewDecision(reviews),
    };
  }

  const [closedPrs, latestCommits] = await Promise.all([
    ghApiJson(`repos/${repo}/pulls?state=closed&per_page=5&sort=updated&direction=desc`, { execFileFn }),
    ghApiJson(`repos/${repo}/commits?per_page=1`, { execFileFn }),
  ]);
  const merged = Array.isArray(closedPrs) ? closedPrs.find((pr) => pr.merged_at) : null;
  const latestCommit = Array.isArray(latestCommits) ? latestCommits[0] : null;

  if (!latestCommit) {
    return { state: 'none' };
  }

  // If the tip of the default branch IS that merged PR's merge commit,
  // nothing has happened since — safe to report it as the current state.
  // Otherwise there has been activity (direct pushes, or another merge)
  // that never went through a PR we can inspect — many real repos mix
  // direct commits with occasional PRs, and treating "the last PR" as the
  // whole truth would silently hide that activity.
  if (merged && merged.merge_commit_sha === latestCommit.sha) {
    return {
      state: 'merged',
      prNumber: merged.number,
      prUrl: merged.html_url,
      mergedAt: merged.merged_at,
    };
  }

  const ciStatus = await ghApiJson(`repos/${repo}/commits/${latestCommit.sha}/check-runs?per_page=100`, { execFileFn }).then(
    aggregateCiResponse,
  );
  return {
    state: 'active',
    lastCommitMessage: (latestCommit.commit?.message || '').split('\n')[0],
    lastCommitAt: latestCommit.commit?.author?.date || latestCommit.commit?.committer?.date,
    lastCommitUrl: latestCommit.html_url,
    lastCommitSha: latestCommit.sha,
    ciStatus,
  };
}

/**
 * Read-only list of the repo's most recent commits on its default branch,
 * for backfilling AI summaries against commits that predate this feature or
 * were never manually summarized. Never writes to GitHub.
 */
export async function fetchRecentCommits(repo, { limit = 30 } = {}, { execFileFn = execFile } = {}) {
  if (!isRealGithubRepo(repo)) {
    throw new GithubCliError(`Not a valid owner/repo slug: ${repo}`, 'failed');
  }

  const commits = await ghApiJson(`repos/${repo}/commits?per_page=${limit}`, { execFileFn });
  return Array.isArray(commits)
    ? commits.map((c) => ({
        sha: c.sha,
        message: (c.commit?.message || '').split('\n')[0],
        date: c.commit?.author?.date || c.commit?.committer?.date,
        url: c.html_url,
      }))
    : [];
}

function normalizeChangedFile(file) {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    patch: file.patch,
  };
}

/**
 * Read-only list of files changed by a PR (all commits) or by a single commit
 * (direct-push case, no open PR). Exactly one of prNumber/sha must be given.
 */
export async function fetchChangedFiles(repo, { prNumber, sha } = {}, { execFileFn = execFile } = {}) {
  if (!isRealGithubRepo(repo)) {
    throw new GithubCliError(`Not a valid owner/repo slug: ${repo}`, 'failed');
  }
  if (!prNumber && !sha) {
    throw new GithubCliError('Either prNumber or sha is required', 'failed');
  }

  if (prNumber) {
    const files = await ghApiJson(`repos/${repo}/pulls/${prNumber}/files?per_page=100`, { execFileFn });
    return Array.isArray(files) ? files.map(normalizeChangedFile) : [];
  }

  const commit = await ghApiJson(`repos/${repo}/commits/${sha}`, { execFileFn });
  return Array.isArray(commit.files) ? commit.files.map(normalizeChangedFile) : [];
}
