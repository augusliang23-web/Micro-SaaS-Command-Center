// Pure presentation model for the read-only GitHub development history.
// Nothing here invents Git facts: verified edges come only from commit
// parents; PR base/head refs stay labelled as reported PR metadata.
import type { DevelopmentHistory, HistoryCommit, HistoryPull, LiveIdentity, PullDetail } from './gitHistoryTypes';

export const LIVE_HISTORY_REPOS = ['augusliang23-web/pm-dashboard'] as const;
const SGT_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

/** Exact allowlist match; a repository-like display name never qualifies. */
export function liveRepositoryFor(identity: LiveIdentity | null | undefined): string | null {
  if (!identity || identity.source !== 'REGISTERED' || !identity.projectId) return null;
  const repo = (identity.repository ?? '').trim().replace(/^(?:https?:\/\/)?(?:github\.com\/)/, '').replace(/\/$/, '');
  return (LIVE_HISTORY_REPOS as readonly string[]).includes(repo) ? repo : null;
}
export const identityKey = (identity: LiveIdentity) => JSON.stringify([identity.source, identity.projectId ?? null, identity.repository ?? null]);

const pad = (n: number) => String(n).padStart(2, '0');
function sgtParts(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + SGT_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
/** Asia/Singapore has no DST, so UTC+8 is exact. Year is always shown. */
export function formatSgt(iso: string | null | undefined, withTime = true): string {
  if (!iso) return 'Not available';
  const p = sgtParts(iso);
  if (!p) return 'Not available';
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return withTime ? `${date} ${pad(p.hh)}:${pad(p.mm)} SGT` : date;
}
export function sgtDayStart(ms: number) {
  return Math.floor((ms + SGT_OFFSET_MS) / DAY_MS) * DAY_MS - SGT_OFFSET_MS;
}

export type LaneId = 'main' | 'production-pages' | 'v23-integration' | 'v23-feature' | 'permissions' | 'pdf-delivery' | 'other';
export const LANES: { id: LaneId; title: string; color: string; note: string }[] = [
  { id: 'main', title: 'main', color: '#0f766e', note: 'GitHub 預設分支' },
  { id: 'production-pages', title: 'production-pages', color: '#b45309', note: 'Production Pages 分支（≠ 部署證據）' },
  { id: 'v23-integration', title: 'V2.3 integration', color: '#7c3aed', note: '名稱分組' },
  { id: 'v23-feature', title: 'V2.3 feature', color: '#2563eb', note: '名稱分組' },
  { id: 'permissions', title: 'Permissions', color: '#db2777', note: '名稱分組' },
  { id: 'pdf-delivery', title: 'PDF / Delivery', color: '#0891b2', note: '名稱分組' },
  { id: 'other', title: 'Other branches', color: '#64748b', note: '名稱分組' },
];
export const laneById = (id: LaneId) => LANES.find((l) => l.id === id)!;

/** Presentation grouping by branch NAME only — never used as a Git relationship. */
export function laneForBranch(name: string | null | undefined, defaultBranch = 'main'): LaneId {
  const n = name ?? '';
  if (n === defaultBranch) return 'main';
  if (n === 'production-pages') return 'production-pages';
  if (/^integration\/v23/i.test(n)) return 'v23-integration';
  if (/v23/i.test(n)) return 'v23-feature';
  if (/permission/i.test(n)) return 'permissions';
  if (/pdf|delivery/i.test(n)) return 'pdf-delivery';
  return 'other';
}
export type BranchKind = 'main' | 'integration' | 'hotfix' | 'feature';
export function branchKind(name: string | null | undefined, defaultBranch = 'main'): BranchKind {
  const n = name ?? '';
  if (n === defaultBranch) return 'main';
  if (n === 'production-pages' || /^(integration|integrate|release)\//i.test(n)) return 'integration';
  if (/hotfix|^fix\//i.test(n)) return 'hotfix';
  return 'feature';
}

export type RangeId = '1m' | '3m' | '6m' | 'all';
export type StateFilter = 'all' | 'active' | 'merged' | 'closed_unmerged';
export const RANGE_LABEL: Record<RangeId, string> = { '1m': '1 個月', '3m': '3 個月', '6m': '6 個月', all: '全部歷史' };
export const STATE_LABEL: Record<StateFilter, string> = { all: '全部', active: '進行中 / Open', merged: '已合併', closed_unmerged: '關閉未合併' };
export const STATUS_LABEL: Record<HistoryPull['status'], string> = { open: 'OPEN', draft: 'DRAFT', merged: 'MERGED', closed_unmerged: 'CLOSED · 未合併' };

/** Range is anchored to the verified fetch time, never the browser clock. */
export function rangeStart(range: RangeId, anchorIso: string, earliestIso?: string | null): number {
  const anchor = Date.parse(anchorIso);
  if (range === 'all') return sgtDayStart(Date.parse(earliestIso ?? anchorIso));
  const d = new Date(anchor);
  d.setUTCMonth(d.getUTCMonth() - Number(range[0]));
  return sgtDayStart(d.getTime());
}
export const pullEnd = (pr: HistoryPull, fetchedAt: string) => pr.mergedAt ?? pr.closedAt ?? fetchedAt;
export function matchesState(pr: HistoryPull, filter: StateFilter) {
  if (filter === 'all') return true;
  if (filter === 'active') return pr.state === 'open';
  return pr.status === filter;
}

/** Reported stacking: an OPEN PR whose head ref equals this PR's base ref. */
export function stackParent(pr: HistoryPull, pulls: HistoryPull[]): HistoryPull | null {
  if (!pr.baseRef) return null;
  const candidates = pulls.filter((p) => p.number !== pr.number && p.headRef === pr.baseRef);
  return candidates.find((p) => p.state === 'open') ?? null;
}
export function stackChildren(pr: HistoryPull, pulls: HistoryPull[]) {
  return pulls.filter((p) => p.state === 'open' && p.number !== pr.number && pr.headRef && p.baseRef === pr.headRef);
}
export function relatedPulls(pr: HistoryPull, pulls: HistoryPull[]): Set<number> {
  const related = new Set<number>([pr.number]);
  const seen = new Set<number>();
  let cursor: HistoryPull | null = pr;
  while (cursor && !seen.has(cursor.number)) { seen.add(cursor.number); related.add(cursor.number); cursor = stackParent(cursor, pulls); }
  const queue = [pr];
  while (queue.length) for (const child of stackChildren(queue.shift()!, pulls)) if (!related.has(child.number)) { related.add(child.number); queue.push(child); }
  return related;
}

export type CommitIndex = Map<string, HistoryCommit>;
export const indexCommits = (commits: HistoryCommit[]): CommitIndex => new Map(commits.map((c) => [c.sha, c]));

/**
 * Verified ancestry from fetched commit parents. Returns 'unknown' whenever
 * the walk reaches a parent that was not fetched, so a missing slice of
 * history can never produce a confident "not an ancestor".
 */
export function isAncestor(index: CommitIndex, ancestor: string | null, descendant: string | null): boolean | 'unknown' {
  if (!ancestor || !descendant) return 'unknown';
  if (!index.has(descendant)) return 'unknown';
  const seen = new Set<string>();
  const stack = [descendant];
  let incomplete = false;
  while (stack.length) {
    const sha = stack.pop()!;
    if (sha === ancestor) return true;
    if (seen.has(sha)) continue;
    seen.add(sha);
    const commit = index.get(sha);
    if (!commit) { incomplete = true; continue; }
    stack.push(...commit.parents);
  }
  return incomplete ? 'unknown' : false;
}

export type MergeEvidence = 'verified_merge_commit' | 'single_parent_commit' | 'unknown' | 'not_merged';
/** A solid merge edge needs a fetched merge commit whose parents include the PR head. */
export function mergeEvidence(pr: HistoryPull, index: CommitIndex): MergeEvidence {
  if (!pr.merged) return 'not_merged';
  const commit = pr.mergeCommitSha ? index.get(pr.mergeCommitSha) : undefined;
  if (!commit) return 'unknown';
  if (commit.parents.length > 1 && pr.headSha && commit.parents.includes(pr.headSha)) return 'verified_merge_commit';
  if (commit.parents.length === 1) return 'single_parent_commit';
  return 'unknown';
}
export const MERGE_EVIDENCE_LABEL: Record<MergeEvidence, string> = {
  verified_merge_commit: '已驗證：merge commit 的 parent 包含 PR head',
  single_parent_commit: '單一 parent（squash／rebase）· 無 Git parent 連線，僅 PR 紀錄',
  unknown: 'UNKNOWN · merge commit 未在已取得歷史中',
  not_merged: '未合併',
};

// ---------- Timeline (View A) ----------
export type TimelineItem = { pr: HistoryPull; lane: LaneId; /** true date position of the PR's creation */ x: number; /** card left edge; shifted left only to keep the card inside the plot */ cardX: number; barWidth: number; width: number; row: number; y: number; endIso: string };
export type TimelineLane = { id: LaneId; y: number; height: number; rows: number; count: number; collapsed: boolean };
export type TimelineLayout = {
  start: number; end: number; pxPerDay: number; fit: boolean; width: number; height: number;
  lanes: TimelineLane[]; items: TimelineItem[]; ticks: { x: number; label: string }[];
  hiddenByRange: number; total: number;
};
export const LANE_BASE_HEIGHT = 56;
export const ROW_HEIGHT = 58;
export const CARD_MIN_WIDTH = 196;
export const PLOT_GUTTER_LEFT = 12;
export const PLOT_GUTTER_RIGHT = 20;
export const MIN_FIT_PX_PER_DAY = 4; // below this, Auto Fit stops compressing and the plot scrolls internally
export const MAX_FIT_PX_PER_DAY = 60;
export const FALLBACK_PLOT_WIDTH = 960; // used only before the container has been measured
const MIN_TICK_SPACING = 84;

/** px/day that spreads the real date span [start, end] across the drawable plot width. Dates are never distorted. */
export function fitPxPerDay(opts: { start: number; end: number; plotWidth: number }): number {
  const plotWidth = opts.plotWidth > 0 && Number.isFinite(opts.plotWidth) ? opts.plotWidth : FALLBACK_PLOT_WIDTH;
  const spanDays = Math.max(1, (opts.end - opts.start) / DAY_MS);
  return Math.min(MAX_FIT_PX_PER_DAY, Math.max(MIN_FIT_PX_PER_DAY, (plotWidth - PLOT_GUTTER_LEFT - PLOT_GUTTER_RIGHT) / spanDays));
}
export const timelineSpan = (history: DevelopmentHistory, range: RangeId) => {
  const earliest = history.pulls.reduce<string | null>((min, p) => (p.createdAt && (!min || p.createdAt < min) ? p.createdAt : min), null);
  return { start: rangeStart(range, history.fetchedAt, earliest), end: Date.parse(history.fetchedAt) };
};
/** Day ticks (1/2/7/14) while they stay legible, otherwise SGT calendar-month starts. */
export function timelineTicks(start: number, end: number, pxPerDay: number, x: (ms: number) => number) {
  const ticks: { x: number; label: string }[] = [];
  const iso = (t: number) => new Date(t).toISOString();
  const step = [1, 2, 7, 14].find((d) => d * pxPerDay >= MIN_TICK_SPACING);
  if (step) {
    for (let t = start; t <= end; t += step * DAY_MS) ticks.push({ x: x(t), label: formatSgt(iso(t), false) });
    return ticks;
  }
  ticks.push({ x: x(start), label: formatSgt(iso(start), false) });
  const first = new Date(start + SGT_OFFSET_MS);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth() + 1;
  for (;;) {
    if (month > 11) { month = 0; year += 1; }
    const t = Date.UTC(year, month, 1) - SGT_OFFSET_MS;
    if (t > end) break;
    if (t > start && x(t) - ticks[ticks.length - 1].x >= MIN_TICK_SPACING) ticks.push({ x: x(t), label: formatSgt(iso(t), false) });
    month += 1;
  }
  return ticks;
}
export function buildTimeline(history: DevelopmentHistory, opts: { range: RangeId; state: StateFilter; lanes: Set<LaneId>; collapsed: Set<LaneId>; /** manual zoom; omit for Auto Fit */ pxPerDay?: number; /** drawable plot width used by Auto Fit */ plotWidth?: number; query?: string }): TimelineLayout {
  const fetchedAt = history.fetchedAt;
  const { start, end } = timelineSpan(history, opts.range);
  const fit = opts.pxPerDay === undefined;
  const pxPerDay = opts.pxPerDay ?? fitPxPerDay({ start, end, plotWidth: opts.plotWidth ?? 0 });
  const x = (ms: number) => PLOT_GUTTER_LEFT + ((ms - start) / DAY_MS) * pxPerDay;
  // The plot ends at Last checked (plus a small gutter): no card minimum or tail extends the date axis.
  const width = Math.ceil(Math.max(fit && opts.plotWidth && opts.plotWidth > 0 ? opts.plotWidth : 0, x(end) + PLOT_GUTTER_RIGHT));
  const q = (opts.query ?? '').trim().toLowerCase();
  const stateMatches = history.pulls.filter((p) => matchesState(p, opts.state) && (!q || `${p.number} ${p.title} ${p.headRef} ${p.baseRef}`.toLowerCase().includes(q)));
  const inRange = stateMatches.filter((p) => p.createdAt && Date.parse(pullEnd(p, fetchedAt)) >= start);
  const lanes: TimelineLane[] = [];
  const items: TimelineItem[] = [];
  let y = 0;
  for (const lane of LANES) {
    if (!opts.lanes.has(lane.id)) continue;
    const lanePulls = inRange.filter((p) => laneForBranch(p.headRef, history.defaultBranch) === lane.id).sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!));
    const collapsed = opts.collapsed.has(lane.id);
    const rowEnds: number[] = [];
    const laneItems: TimelineItem[] = [];
    for (const pr of lanePulls) {
      const left = x(Math.max(start, Date.parse(pr.createdAt!)));
      const endIso = pullEnd(pr, fetchedAt);
      const barWidth = Math.max(6, x(Date.parse(endIso)) - left);
      const w = Math.max(CARD_MIN_WIDTH, barWidth);
      // A card near the right edge slides left to stay inside the plot; its duration bar keeps the true date position.
      const cardX = Math.max(0, Math.min(left, width - w - 2));
      let row = rowEnds.findIndex((e) => e + 10 <= cardX);
      if (row < 0) { row = rowEnds.length; rowEnds.push(0); }
      rowEnds[row] = cardX + w;
      laneItems.push({ pr, lane: lane.id, x: left, cardX, barWidth, width: w, row, y: 0, endIso });
    }
    const rows = collapsed ? 0 : rowEnds.length;
    const height = LANE_BASE_HEIGHT + rows * ROW_HEIGHT;
    for (const item of laneItems) item.y = y + LANE_BASE_HEIGHT - 6 + item.row * ROW_HEIGHT;
    if (!collapsed) items.push(...laneItems);
    lanes.push({ id: lane.id, y, height, rows, count: lanePulls.length, collapsed });
    y += height;
  }
  return { start, end, pxPerDay, fit, width, height: y, lanes, items, ticks: timelineTicks(start, end, pxPerDay, x), hiddenByRange: stateMatches.length - inRange.length, total: history.pulls.length };
}
export function timelineX(layout: Pick<TimelineLayout, 'start' | 'pxPerDay'>, iso: string) {
  return PLOT_GUTTER_LEFT + ((Date.parse(iso) - layout.start) / DAY_MS) * layout.pxPerDay;
}

// ---------- Git topology (View B) ----------
/** Child-before-parent order, newest committer date first among ready commits. */
export function topoOrder(commits: HistoryCommit[]): HistoryCommit[] {
  const index = indexCommits(commits);
  const pendingChildren = new Map<string, number>(commits.map((c) => [c.sha, 0]));
  for (const c of commits) for (const p of c.parents) if (index.has(p)) pendingChildren.set(p, (pendingChildren.get(p) ?? 0) + 1);
  const time = (c: HistoryCommit) => Date.parse(c.committerDate ?? c.authorDate ?? '') || 0;
  let ready = commits.filter((c) => pendingChildren.get(c.sha) === 0);
  const out: HistoryCommit[] = [];
  while (ready.length) {
    ready.sort((a, b) => time(b) - time(a) || a.sha.localeCompare(b.sha));
    const next = ready.shift()!;
    out.push(next);
    for (const p of next.parents) {
      if (!index.has(p)) continue;
      const left = pendingChildren.get(p)! - 1;
      pendingChildren.set(p, left);
      if (left === 0) ready.push(index.get(p)!);
    }
  }
  return out;
}
export type TopoNode = { commit: HistoryCommit; col: number; index: number };
export type TopoEdge = { from: string; to: string; fromCol: number; toCol: number; fromIndex: number; toIndex: number | null; firstParent: boolean };
/**
 * git-log-style column assignment. `seedHeads` pins the default branch to
 * column 0 so main stays easy to find. Edges exist only for real parents.
 */
export function buildTopology(commits: HistoryCommit[], seedHeads: string[]) {
  const ordered = topoOrder(commits);
  const columns: (string | null)[] = seedHeads.map((s) => s);
  const nodes: TopoNode[] = [];
  const colOf = new Map<string, number>();
  ordered.forEach((commit, index) => {
    let col = columns.indexOf(commit.sha);
    if (col < 0) { col = columns.indexOf(null); if (col < 0) { col = columns.length; columns.push(null); } }
    for (let i = 0; i < columns.length; i++) if (i !== col && columns[i] === commit.sha) columns[i] = null;
    columns[col] = commit.parents[0] ?? null;
    for (const parent of commit.parents.slice(1)) {
      if (!columns.includes(parent)) { const free = columns.indexOf(null); if (free >= 0) columns[free] = parent; else columns.push(parent); }
    }
    colOf.set(commit.sha, col);
    nodes.push({ commit, col, index });
  });
  const indexOf = new Map(nodes.map((n) => [n.commit.sha, n.index]));
  const edges: TopoEdge[] = [];
  for (const node of nodes) node.commit.parents.forEach((parent, i) => {
    edges.push({ from: node.commit.sha, to: parent, fromCol: node.col, toCol: colOf.get(parent) ?? node.col, fromIndex: node.index, toIndex: indexOf.get(parent) ?? null, firstParent: i === 0 });
  });
  return { nodes, edges, columns: Math.max(1, ...nodes.map((n) => n.col + 1)) };
}

export type CommitAssociations = { headOf: HistoryPull[]; mergeOf: HistoryPull[]; branchHeads: string[]; onDefaultBranch: boolean };
export function commitAssociations(sha: string, history: DevelopmentHistory, defaultShas: Set<string>): CommitAssociations {
  return {
    headOf: history.pulls.filter((p) => p.headSha === sha),
    mergeOf: history.pulls.filter((p) => p.mergeCommitSha === sha),
    branchHeads: history.branches.filter((b) => b.headSha === sha).map((b) => b.name),
    onDefaultBranch: defaultShas.has(sha),
  };
}
export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : 'Not available');

// ---------- Snapshot vs fresh detail (P2 provenance) ----------
export type Reconciliation = {
  snapshotHead: string | null; currentHead: string | null;
  headMismatch: boolean; stateChange: { from: string; to: string } | null;
  /** Any of the snapshot head, current PR head or CI head is absent. */
  missingSha: boolean;
  /** Snapshot and current PR head are both known (review/file data can be tied to the displayed head). */
  headsKnown: boolean;
  /** snapshot head = current PR head = CI head, all present. The only state that may show CI against the displayed head. */
  ciApplies: boolean; ciHeadConsistent: boolean; needsRefresh: boolean;
};
/**
 * The list snapshot and the on-demand PR detail are separate reads. CI/review
 * data may only be attached to the displayed head SHA when every SHA is present
 * and equal; otherwise the panel must say the data is stale or unverified.
 * Missing information fails closed, never open.
 */
export function reconcilePullDetail(pr: HistoryPull, detail: PullDetail): Reconciliation {
  const snapshotHead = pr.headSha;
  const currentHead = detail.pull.headSha;
  const ciHead = detail.ci.headSha;
  const headsKnown = Boolean(snapshotHead && currentHead);
  const missingSha = !headsKnown || !ciHead;
  const headMismatch = headsKnown && snapshotHead !== currentHead;
  const ciHeadConsistent = Boolean(ciHead && currentHead && ciHead === currentHead);
  const ciApplies = !missingSha && snapshotHead === currentHead && currentHead === ciHead;
  const stateChange = pr.status !== detail.pull.status ? { from: STATUS_LABEL[pr.status], to: STATUS_LABEL[detail.pull.status] } : null;
  const ciChecked = detail.ci.status !== 'not_checked';
  return { snapshotHead, currentHead, headMismatch, stateChange, missingSha, headsKnown, ciApplies, ciHeadConsistent, needsRefresh: headMismatch || Boolean(stateChange) || missingSha || (ciChecked && !ciApplies) };
}
/** Partial wins over any decision: a truncated list cannot prove Approved. */
export function reviewIsPartial(reviews: PullDetail['reviews']): boolean {
  return reviews.status !== 'not_checked' && (reviews.status === 'partial' || reviews.complete === false);
}

export const driftedRefNames = (history: DevelopmentHistory) => new Set(history.consistency?.driftedRefs.map((r) => r.ref) ?? []);
export const prHeadMismatch = (history: DevelopmentHistory, number: number) => history.consistency?.prHeadMismatches.find((m) => m.number === number) ?? null;
/**
 * Ancestry of a PR head vs its base branch head. A claim is judged only by the
 * refs it uses: a moved base, a moved head branch of an open PR, or a list head
 * that disagrees with its branch makes THIS claim UNKNOWN. Drift on unrelated
 * branches makes the whole snapshot Partial (see consistency) but does not
 * downgrade a claim whose participating refs are unchanged.
 */
export type AncestryClaim = { state: 'yes' | 'no' | 'unknown'; baseHead: string | null; reason?: 'base_moved' | 'pr_head_moved' | 'pr_head_mismatch' | 'missing_commits' };
export function ancestryClaim(history: DevelopmentHistory, pr: HistoryPull, index: CommitIndex): AncestryClaim {
  const baseHead = history.branches.find((b) => b.name === pr.baseRef)?.headSha ?? null;
  if (pr.baseRef && driftedRefNames(history).has(pr.baseRef)) return { state: 'unknown', reason: 'base_moved', baseHead };
  if (pr.state === 'open' && pr.headRef && driftedRefNames(history).has(pr.headRef)) return { state: 'unknown', reason: 'pr_head_moved', baseHead };
  if (prHeadMismatch(history, pr.number)) return { state: 'unknown', reason: 'pr_head_mismatch', baseHead };
  const result = isAncestor(index, baseHead, pr.headSha);
  return result === 'unknown' ? { state: 'unknown', reason: 'missing_commits', baseHead } : { state: result ? 'yes' : 'no', baseHead };
}
