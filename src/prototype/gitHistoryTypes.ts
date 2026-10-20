// Shapes returned by GET /api/github/development-history (read-only GitHub source).
export type PullStatus = 'open' | 'draft' | 'merged' | 'closed_unmerged';
export type HistoryBranch = { name: string; headSha: string | null; protected: boolean };
export type HistoryPull = {
  number: number; title: string; url: string; author: string | null;
  state: 'open' | 'closed'; isDraft: boolean; merged: boolean; status: PullStatus;
  createdAt: string | null; updatedAt: string | null; closedAt: string | null; mergedAt: string | null;
  baseRef: string | null; baseSha: string | null; headRef: string | null; headSha: string | null;
  headRepo: string | null; mergeCommitSha: string | null;
};
export type HistoryCommit = {
  sha: string; parents: string[]; message: string; authorDate: string | null;
  committerDate: string | null; author: string | null; url: string | null;
};
export type HistoryComparison = {
  base: string; head: string; status: string | null; aheadBy: number | null; behindBy: number | null;
  totalCommits: number | null; mergeBaseSha: string | null; commitShas: string[]; complete: boolean; error: string | null;
};
export type SnapshotConsistency = {
  atomic: false; // the read is never an atomic GitHub snapshot
  status: 'consistent' | 'inconsistent' | 'unverified';
  rereadAt: string | null;
  driftedRefs: { ref: string; observed: string | null; reread: string | null; relevant: boolean }[];
  prHeadMismatches: { number: number; headRef: string; prHeadSha: string; branchHeadSha: string }[];
};
export type DevelopmentHistory = {
  source: 'GitHub'; repository: string; repositoryUrl: string; defaultBranch: string;
  startedAt: string; fetchedAt: string; status: 'complete' | 'partial'; cache?: 'hit' | 'miss' | 'refreshed';
  coverage: {
    branches: { count: number; pages: number; complete: boolean };
    pulls: { count: number; open: number; draft: number; merged: number; closedUnmerged: number; pages: number; complete: boolean };
    commits: { count: number; defaultBranchCommits: number; defaultBranchComplete: boolean };
    focusRefs: { compared: number; requested: number; truncated: boolean };
    localWorktrees: 'not_checked'; deployments: 'not_checked'; ci: 'not_checked';
  };
  warnings: string[];
  consistency?: SnapshotConsistency;
  branches: HistoryBranch[];
  pulls: HistoryPull[];
  commits: HistoryCommit[];
  defaultBranchShas: string[];
  refs: Record<string, { headSha: string | null; commitsFetched: number; complete: boolean; mergeBaseSha?: string | null }>;
  comparisons: HistoryComparison[];
};
export type CiStatus = 'not_checked' | 'none' | 'passing' | 'failing' | 'running' | 'pending' | 'unknown';
// Review provenance (B1.4): an approval is only ever described relative to the commit it was made on.
export type ReviewStatus =
  | 'not_checked' | 'no_reviews' | 'partial' | 'commented_only' | 'changes_requested'
  | 'current_head_approval' | 'historical_approval' | 'review_head_unknown' | 'approval_dismissed';
export type ReviewRelation = 'current_head' | 'historical' | 'unknown';
/** The effective (latest decisive) review of one reviewer, with the commit it was submitted against. */
export type ReviewerDecision = {
  reviewer: string | null; reviewId: number | null; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
  commitId: string | null; submittedAt: string | null; relation: ReviewRelation;
};
export type PullDetail = {
  source: 'GitHub'; repository: string; number: number; fetchedAt: string;
  pull: HistoryPull & { changedFiles: number | null; additions: number | null; deletions: number | null; commits: number | null };
  ci: { status: CiStatus; total: number | null; headSha: string | null };
  reviews: { status: ReviewStatus; count: number | null; complete: boolean; headSha?: string | null; reviewers?: ReviewerDecision[]; observed?: ReviewStatus };
};
export type HistoryErrorKind = 'not_authenticated' | 'forbidden' | 'missing' | 'rate_limited' | 'not_found' | 'timeout' | 'aborted' | 'failed' | 'network' | 'authorization_changed';
/**
 * V1.2C: why the UI expects this project to be readable. It mirrors the server's registry projection for display and request
 * decisions only; the server re-derives and enforces authority on every history request.
 */
export type HistoryAuthorization = { source: 'user-verified' | 'legacy-pm-dashboard-compat'; generation: number };
export type LiveIdentity = { source: 'REGISTERED' | 'DEMO'; projectId?: string; repository?: string; displayName: string; authorization?: HistoryAuthorization | null };
