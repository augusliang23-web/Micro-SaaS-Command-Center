import type { DevelopmentHistory } from './gitHistoryTypes';
const DAY = 86_400_000;
export type ActivityWindow = { start: number; end: number; available: boolean };
/** Presentation bounds, never rewritten events. Use the final observed cluster (gaps <=7 days,
 * at most 28 days), with 12%/six-hour padding capped at the snapshot. A GitHub updatedAt
 * is a reported PR metadata update, not proof of commits, agent work or deployment.
 * Old PR creation/outlier commit dates cannot stretch this view into a six-month calendar.
 */
export function activityWindow(history: Pick<DevelopmentHistory, 'pulls' | 'fetchedAt'>): ActivityWindow {
  const anchor = Date.parse(history.fetchedAt);
  if (!Number.isFinite(anchor)) return { start: 0, end: 0, available: false };
  const times = [...new Set(history.pulls.flatMap(pr => [pr.createdAt, pr.updatedAt, pr.mergedAt, pr.closedAt])
    .map(iso => Date.parse(iso ?? '')).filter(t => Number.isFinite(t) && t <= anchor))].sort((a,b) => a-b);
  if (!times.length) return { start: anchor - DAY, end: anchor, available: false };
  const last = times[times.length - 1];
  let first = last;
  for (let i = times.length - 2; i >= 0; i--) {
    if (last - times[i] > 28 * DAY || first - times[i] > 7 * DAY) break;
    first = times[i];
  }
  const pad = Math.max(DAY / 4, (last - first) * .12);
  return { start: first - pad, end: Math.min(anchor, last + pad), available: true };
}
