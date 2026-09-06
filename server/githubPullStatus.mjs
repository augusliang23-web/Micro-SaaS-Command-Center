import { execFile } from 'node:child_process';
import { GithubCliError, ghApiJson } from './githubRepos.mjs';

export function isRealGithubRepo(repository) {
  return typeof repository === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repository);
}

export function aggregateCiStatus(checkRuns) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) return 'none';
  if (checkRuns.some((run) => run.status !== 'completed')) return 'running';
  const failed = ['failure', 'timed_out', 'cancelled', 'action_required'];
  if (checkRuns.some((run) => failed.includes(run.conclusion))) return 'failing';
  return 'passing';
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
    const [checkRuns, reviews] = await Promise.all([
      sha
        ? ghApiJson(`repos/${repo}/commits/${sha}/check-runs`, { execFileFn }).then((r) => r.check_runs || [])
        : Promise.resolve([]),
      ghApiJson(`repos/${repo}/pulls/${pr.number}/reviews`, { execFileFn }),
    ]);

    return {
      state: 'open',
      prNumber: pr.number,
      prUrl: pr.html_url,
      isDraft: Boolean(pr.draft),
      ciStatus: aggregateCiStatus(checkRuns),
      reviewDecision: aggregateReviewDecision(reviews),
    };
  }

  const closedPrs = await ghApiJson(`repos/${repo}/pulls?state=closed&per_page=5&sort=updated&direction=desc`, {
    execFileFn,
  });
  const merged = Array.isArray(closedPrs) ? closedPrs.find((pr) => pr.merged_at) : null;
  if (merged) {
    return {
      state: 'merged',
      prNumber: merged.number,
      prUrl: merged.html_url,
      mergedAt: merged.merged_at,
    };
  }

  return { state: 'none' };
}
