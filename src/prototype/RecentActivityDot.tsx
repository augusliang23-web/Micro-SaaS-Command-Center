import type { CommitWindowHours, RecentCommit } from './recentActivityModel';

/** Presentation only: evidence and freshness remain owned by recentActivityModel. */
export function RecentActivityDot({ activity, enabled, hours, fallback }: {
  activity?: RecentCommit; enabled: boolean; hours: CommitWindowHours; fallback: string;
}) {
  const state = enabled && (activity?.state === 'recent' || activity?.state === 'outside') ? activity.state : 'unknown';
  const label = !enabled ? '提示關閉 · 未判定活動狀態'
    : state === 'recent' ? `最近 ${hours} 小時有 HEAD Commit`
    : state === 'outside' ? `已核對：HEAD Commit 在 ${hours} 小時前`
    : `${activity?.label ?? 'Not checked'} · UNKNOWN`;
  const explanation = enabled ? activity?.explanation ?? fallback : '提示關閉；不表示沒有開發活動。';
  const description = `${label} · ${explanation}`;
  return <span className={`pr-activity-dot is-${state}`} data-activity-state={state} role="img" aria-label={description} title={description} />;
}
