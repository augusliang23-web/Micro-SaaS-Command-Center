// Complete read-only API fixtures. Malformed-payload tests deliberately bypass this.
export function githubSnapshot(data) {
 if (!data || typeof data !== 'object') return data;
 const shared = { prNumber: 9, prUrl: 'https://github.com/owner/repo/pull/9' };
 const defaults = {
  open: { ...shared, isDraft: false, ciStatus: 'none', reviewDecision: 'review_required' },
  merged: { ...shared, mergedAt: '2026-10-02T00:00:00Z' },
  active: { lastCommitSha: 'a'.repeat(40), lastCommitAt: '2026-10-02T00:00:00Z', lastCommitMessage: 'update', lastCommitUrl: 'https://github.com/owner/repo/commit/'+'a'.repeat(40), ciStatus: 'none' },
 };
 return { ...defaults[data.state], ...data };
}
