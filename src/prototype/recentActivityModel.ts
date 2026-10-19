// Recent observed PR HEAD commit, never push time, Issue activity or live Agent execution.
import type { DevelopmentHistory } from './gitHistoryTypes';
import { formatSgt, indexCommits } from './gitHistoryModel';
export type CommitWindowHours = 6 | 12 | 24;
export const SNAPSHOT_FRESHNESS_MS = 15 * 60_000;
export const SNAPSHOT_CLOCK_SKEW_MS = 2 * 60_000; // future fetchedAt only; never a future commit
export const ACTIVITY_RECHECK_MS = 60_000;
export type RecentCommit = { state: 'recent' | 'outside' | 'unknown' | 'not_checked' | 'needs_refresh'; label: string; explanation: string };
export type RecentActivitySnapshot = { state: 'ready' | 'unknown' | 'not_checked' | 'needs_refresh'; message: string; byPull: Map<number, RecentCommit> };
const validSha = (sha: string | null) => typeof sha === 'string' && /^[a-f0-9]{40}$/i.test(sha);
/** Reject timezone-less or normalized invalid dates rather than relying on the browser timezone. */
function timestamp(value: string | null | undefined): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const year = Number(value.slice(0,4)), month = Number(value.slice(5,7)), day = Number(value.slice(8,10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (month < 1 || month > 12 || day < 1 || day > days[month-1]) return NaN;
  return Date.parse(value);
}
export function projectRecentActivity(history: DevelopmentHistory | undefined, expectedRepository: string, now: number, hours: CommitWindowHours, blocked = false): RecentActivitySnapshot {
  const byPull = new Map<number, RecentCommit>();
  if (!history) return { state: 'not_checked', message: 'Not checked · 尚未取得快照', byPull };
  const h = history;
  const checked = timestamp(h.fetchedAt);
  const index = indexCommits(h.commits);
  let state: RecentActivitySnapshot['state'] = 'ready';
  let message = '快照可檢查 · 每個 PR 另核對 HEAD Commit';
  if (!Number.isFinite(now) || !Number.isFinite(checked) || checked - now > SNAPSHOT_CLOCK_SKEW_MS || ![6,12,24].includes(hours)) {
    state = 'unknown'; message = 'UNKNOWN · 快照時間無效或超出 2 分鐘時鐘容差';
  } else if (blocked || now - checked >= SNAPSHOT_FRESHNESS_MS) {
    state = 'needs_refresh'; message = 'Needs refresh · 快照已達 15 分鐘或重新整理未成功完成';
  } else if (h.source !== 'GitHub' || h.repository !== expectedRepository || h.status !== 'complete'
    || h.coverage.branches.complete !== true || h.coverage.pulls.complete !== true || h.coverage.commits.defaultBranchComplete !== true
    || h.coverage.focusRefs.truncated || h.coverage.focusRefs.compared !== h.coverage.focusRefs.requested || h.warnings.length
    || h.consistency?.status !== 'consistent' || !Number.isFinite(timestamp(h.consistency.rereadAt)) || timestamp(h.consistency.rereadAt) > checked
    || h.consistency.driftedRefs.some(r => r.relevant)
    || index.size !== h.commits.length || new Set(h.pulls.map(p => p.number)).size !== h.pulls.length
    || new Set(h.branches.map(b => b.name)).size !== h.branches.length
    || h.comparisons.some(c => !c.complete || c.error)
    || Object.entries(h.refs).some(([name, ref]) => !ref.complete || h.branches.find(b => b.name === name)?.headSha !== ref.headSha)) {
    state = 'unknown'; message = 'UNKNOWN · 快照、覆蓋或 Git 一致性未完整驗證';
  }
  const lastChecked = `Last checked ${formatSgt(h.fetchedAt)}`;
  for (const pr of h.pulls) {
    const unverified = (reason: string): RecentCommit => ({ state: 'unknown', label: 'UNKNOWN', explanation: `PR #${pr.number} · Commit 活動 UNKNOWN：${reason} · ${lastChecked}` });
    let activity: RecentCommit;
    if (pr.state !== 'open' || pr.merged || !['open','draft'].includes(pr.status)) {
      activity = { state: 'not_checked', label: 'Not checked', explanation: `PR #${pr.number} · Not checked：近期 HEAD Commit 提示只適用 OPEN / DRAFT，不代表此 PR 沒有近期 Commit。${lastChecked}` };
    } else if (state !== 'ready') {
      activity = { state, label: state === 'needs_refresh' ? 'Needs refresh' : 'UNKNOWN', explanation: `${message} · ${lastChecked}` };
    } else {
      const branches = h.branches.filter(b => b.name === pr.headRef);
      const mismatch = h.consistency!.prHeadMismatches.some(m => m.number === pr.number)
        || h.consistency!.driftedRefs.some(r => r.ref === pr.headRef || r.ref === pr.baseRef || r.ref === h.defaultBranch);
      const commit = pr.headSha ? index.get(pr.headSha) : undefined;
      const committed = timestamp(commit?.committerDate);
      if (!validSha(pr.headSha) || !pr.headRef || pr.headRepo !== expectedRepository || branches.length !== 1 || branches[0].headSha !== pr.headSha
        || mismatch || pr.isDraft !== (pr.status === 'draft')) {
        activity = unverified('HEAD SHA／repository／分支對應不可靠');
      } else if (!commit || !Number.isFinite(committed) || committed > now || committed > checked) {
        activity = unverified('未取得精確 HEAD Commit，或 committerDate 無效／在未來');
      } else {
        const age = now - committed;
        const recent = age >= 0 && age < hours * 3_600_000;
        const ago = age < 3_600_000 ? `${Math.floor(age / 60_000)} 分鐘前` : `${Math.floor(age / 3_600_000)} 小時前`;
        activity = { state: recent ? 'recent' : 'outside', label: recent ? `近 ${hours} 小時有 Commit` : 'HEAD Commit 在選定時窗外',
          explanation: `PR #${pr.number} · Head Commit ${commit.sha} · ${formatSgt(commit.committerDate)} · ${ago} · ${lastChecked}。僅 committerDate，非 Push 時間或即時 Agent 執行證據。` };
      }
    }
    byPull.set(pr.number, activity);
  }
  return { state, message, byPull };
}
