// ZC-08A: read-only presentation contract for cached GitHub development history.
// Never infer AI-agent execution, CI or Codex review from a PR status/commit.
export const MONITOR_POLL_MS = 30_000;
export const MONITOR_STALE_AFTER_MS = 6 * 60_000; // existing backend cache TTL = 5 minutes
const validIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);

export function validateMonitorHistory(candidate, expectedRepo) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      candidate.source !== 'GitHub' || candidate.repository !== expectedRepo ||
      !validIso(candidate.fetchedAt) ||
      !['complete','partial'].includes(candidate.status) ||
      !Array.isArray(candidate.pulls)) return false;
  return candidate.pulls.every(p => p && typeof p === 'object' &&
    Number.isInteger(p.number) && p.number > 0 &&
    ['open','draft','merged','closed_unmerged'].includes(p.status) &&
    typeof p.title === 'string' && typeof p.url === 'string' &&
    p.url === 'https://github.com/' + expectedRepo + '/pull/' + p.number &&
    (p.headSha === null || validSha(p.headSha)) &&
    (p.updatedAt === null || validIso(p.updatedAt)));
}

// A retry is NOT evidence that the source has recovered. Preserve the last
// failure until a newly fetched snapshot passes strict validation.
export function beginMonitorRefresh(previous, repo, requestedAt) {
  return { ...previous, repo, busy: true, lastRequest: requestedAt };
}

export function historyFreshness(history, nowMs = Date.now()) {
  if (!history || !validIso(history.fetchedAt) || !Number.isFinite(nowMs))
    return { state: 'UNKNOWN', ageSeconds: null };
  const age = nowMs - Date.parse(history.fetchedAt);
  if (age < -60_000 || age > MONITOR_STALE_AFTER_MS)
    return { state: 'STALE', ageSeconds: Math.max(0, Math.floor(age / 1000)) };
  return { state: history.status === 'complete' ? 'AVAILABLE' : 'PARTIAL',
    ageSeconds: Math.max(0, Math.floor(age / 1000)) };
}

export function monitorSummary(history, nowMs = Date.now()) {
  const freshness = historyFreshness(history, nowMs);
  if (!history || !Array.isArray(history.pulls))
    return { ...freshness, prCount: null, open: null, draft: null, events: [], agent: 'UNKNOWN', ci: 'NOT_CHECKED', codex: 'NOT_CHECKED' };
  const pulls = history.pulls
    .filter(p => p && Number.isInteger(p.number) && ['open','draft','merged','closed_unmerged'].includes(p.status))
    .map(p => ({ kind: 'PR_UPDATED', number: p.number, title: p.title,
      status: p.status, headSha: p.headSha, updatedAt: p.updatedAt, url: p.url }))
    .filter(e => validIso(e.updatedAt))
    .sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.number - a.number);
  return { ...freshness, prCount: history.pulls.length,
    open: history.pulls.filter(p => p.status === 'open' || p.status === 'draft').length,
    draft: history.pulls.filter(p => p.status === 'draft').length,
    events: pulls.slice(0,12),
    agent: 'UNKNOWN', ci: 'NOT_CHECKED', codex: 'NOT_CHECKED' };
}
