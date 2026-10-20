// Pure presentation model for the read-only GitHub development history.
// Nothing here invents Git facts: verified edges come only from commit
// parents; PR base/head refs stay labelled as reported PR metadata.
import type { DevelopmentHistory, HistoryAuthorization, HistoryCommit, HistoryPull, LiveIdentity, PullDetail, ReviewerDecision } from './gitHistoryTypes';

import { activityWindow } from './activityTimelineModel';

/** V1.2C: the only repository the strict legacy rule can grant (no hard-coded allowlist otherwise). */
export const LEGACY_COMPAT_REPOSITORY = 'augusliang23-web/pm-dashboard';
const CANONICAL_REPO = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)\/[A-Za-z0-9._-]{1,100}$/;
const SGT_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

type SavedRecord = Record<string, unknown>;
const recordOf = (v: unknown): v is SavedRecord => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Mirror of server/githubConnectionRegistry.mjs, used only to decide what the UI offers and requests. Returns one entry per
 * project (same order), null when the project must not be read. The server independently refuses anything not authorized.
 * Rules: trusted provenance (no dataMode), active lifecycle, id non-blank and unique across current AND removed projects, and
 * EITHER a saved `connected` record for exactly its repository OR the single legacy PM Dashboard record (no dataMode, no
 * management, exact repository). A repository claimed by two projects is denied for both.
 */
/** F2 conflict key, identical to server/githubConnectionRegistry.mjs#repositoryClaimKey: one repository in any spelling. */
export function repositoryClaimKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/^git@github\.com:/, '').replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//, '').replace(/\/+$/, '').replace(/\.git$/, '');
}
const isTimestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
/** A complete, currently-connected record; anything missing or malformed is NOT connected (V1.2 remediation F6). */
function connectedRecord(c: SavedRecord, repository: string): HistoryAuthorization | null {
  if (c.status !== 'connected' || c.repository !== repository || !CANONICAL_REPO.test(repository)) return null;
  if (!Number.isInteger(c.generation) || (c.generation as number) < 1 || !isTimestamp(c.connectedAt) || c.revokedAt !== null || c.revokedReason !== null) return null;
  if (c.source === 'user-verified') return Number.isInteger(c.verifiedRepositoryId) && (c.verifiedRepositoryId as number) > 0 ? { source: 'user-verified', generation: c.generation as number } : null;
  if (c.source === 'legacy-pm-dashboard-compat') return repository === LEGACY_COMPAT_REPOSITORY ? { source: 'legacy-pm-dashboard-compat', generation: c.generation as number } : null;
  return null;
}

export function githubAuthorizationsFor(projects: SavedRecord[], removed: SavedRecord[] = []): (HistoryAuthorization | null)[] {
  const counts = new Map<string, number>();
  for (const p of [...projects, ...removed]) { const id = str(p.id); if (id.trim()) counts.set(id, (counts.get(id) ?? 0) + 1); }
  // F2: repository claims over ALL current and removed records (any lifecycle, connection, provenance) BEFORE any projection.
  const claims = new Map<string, number>();
  for (const p of [...projects, ...removed]) {
    const m = recordOf(p.management) ? p.management : undefined;
    const c = m && recordOf(m.githubConnection) ? m.githubConnection : undefined;
    for (const key of new Set([repositoryClaimKey(p.repository), repositoryClaimKey(c?.repository)].filter(Boolean))) claims.set(key, (claims.get(key) ?? 0) + 1);
  }
  const uniqueClaim = (repository: unknown) => claims.get(repositoryClaimKey(repository)) === 1;
  const legacy = projects.filter((p) => p.dataMode === undefined && p.management === undefined && p.repository === LEGACY_COMPAT_REPOSITORY);
  const legacyId = legacy.length === 1 && str(legacy[0].id).trim() && counts.get(str(legacy[0].id)) === 1 && uniqueClaim(LEGACY_COMPAT_REPOSITORY) ? str(legacy[0].id) : null;
  return projects.map((p): HistoryAuthorization | null => {
    const id = str(p.id);
    if (p.dataMode !== undefined || !id.trim() || id !== id.trim() || counts.get(id) !== 1 || !uniqueClaim(p.repository)) return null;
    const m = recordOf(p.management) ? p.management : undefined;
    if (m && m.lifecycle !== undefined && m.lifecycle !== 'active') return null;
    if (m && m.githubConnection !== undefined) return recordOf(m.githubConnection) ? connectedRecord(m.githubConnection, str(p.repository)) : null;
    return id === legacyId ? { source: 'legacy-pm-dashboard-compat', generation: 0 } : null;
  });
}

/**
 * The repository to request for a REGISTERED identity with a stable id and an exact canonical `owner/repo` (no URL, prefix or
 * whitespace normalisation: the server matches the exact string, so the UI does too).
 * - `authorization` object: the caller projected saved state (the shell always does) and this project is authorized.
 * - `authorization: null`: projected and NOT authorized (disconnected, archived, duplicate, ...).
 * - `authorization` absent: the caller supplied no projection; only the strict legacy repository is treated as readable.
 * Whatever the UI decides, the server re-derives and enforces authority on every request.
 */
export function liveRepositoryFor(identity: LiveIdentity | null | undefined): string | null {
  if (!identity || identity.source !== 'REGISTERED' || !identity.projectId?.trim() || identity.authorization === null) return null;
  const repo = identity.repository ?? '';
  if (!CANONICAL_REPO.test(repo)) return null;
  return identity.authorization || repo === LEGACY_COMPAT_REPOSITORY ? repo : null;
}
/** Includes the authorization, so a reconnect (new generation) remounts the viewer and drops every cached result. */
export const identityKey = (identity: LiveIdentity) => JSON.stringify([identity.source, identity.projectId ?? null, identity.repository ?? null, identity.authorization?.source ?? null, identity.authorization?.generation ?? null]);

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

// ---------- Stacked PRs (reported metadata, never verified ancestry) ----------
/**
 * A "stack" is only PR METADATA: an OPEN PR whose head branch NAME equals another PR's base branch NAME. Branch names
 * are not commits, so this is never evidence of Git ancestry (see ancestryClaim for that). Because the names come
 * from GitHub and can repeat, loop or point at themselves, the relationships are NOT assumed to form a tree.
 *
 * Invariants of the graph built below:
 *  - every OPEN PR appears in exactly one place, so none is dropped or duplicated;
 *  - a PR has at most ONE verified (unique, non-cyclic) parent; otherwise it is a root flagged with an issue;
 *  - `parent` links can never loop (cycle members have no parent), so a traversal always terminates;
 *  - nothing is invented: ambiguous, self-referencing and cyclic relationships are marked UNKNOWN, not guessed;
 *  - the result depends only on the set of PRs, not on their order.
 */
export type StackIssue = 'cycle' | 'self_reference' | 'ambiguous_parent';
export type StackNode = {
  pr: HistoryPull;
  /** The single verified parent PR number, or null (root, or an UNKNOWN relationship). */
  parent: number | null;
  children: number[];
  issue: StackIssue | null;
  /** The PRs involved in the issue (cycle members, or the competing parent candidates). */
  peers: number[];
};
export type StackGraph = { nodes: Map<number, StackNode>; roots: number[] };
export type StackRow = { pr: HistoryPull; depth: number; issue: StackIssue | null; peers: number[] };

export function buildStackGraph(pulls: HistoryPull[]): StackGraph {
  const open = new Map<number, HistoryPull>();
  for (const p of pulls) if (p.state === 'open' && !open.has(p.number)) open.set(p.number, p);
  const numbers = [...open.keys()].sort((a, b) => a - b);
  const byHead = new Map<string, number[]>();
  for (const n of numbers) {
    const head = open.get(n)!.headRef;
    if (head) byHead.set(head, [...(byHead.get(head) ?? []), n]);
  }
  const nodes = new Map<number, StackNode>();
  const rawParent = new Map<number, number>();
  for (const n of numbers) {
    const pr = open.get(n)!;
    const node: StackNode = { pr, parent: null, children: [], issue: null, peers: [] };
    nodes.set(n, node);
    if (!pr.baseRef) continue;
    if (pr.headRef && pr.baseRef === pr.headRef) { node.issue = 'self_reference'; node.peers = [n]; continue; }
    const candidates = (byHead.get(pr.baseRef) ?? []).filter((c) => c !== n);
    if (candidates.length === 1) rawParent.set(n, candidates[0]!);
    else if (candidates.length > 1) { node.issue = 'ambiguous_parent'; node.peers = candidates; }
  }
  // Cycle detection over the single-parent links: iterative, so deep chains cannot overflow the stack.
  const mark = new Map<number, 1 | 2>();
  for (const start of numbers) {
    if (mark.has(start)) continue;
    const path: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !mark.has(cur)) { mark.set(cur, 1); path.push(cur); cur = rawParent.get(cur); }
    if (cur !== undefined && mark.get(cur) === 1) {
      const cycle = path.slice(path.indexOf(cur)).sort((a, b) => a - b);
      for (const m of cycle) { const node = nodes.get(m)!; node.issue = 'cycle'; node.peers = cycle; }
    }
    for (const m of path) mark.set(m, 2);
  }
  for (const n of numbers) {
    const node = nodes.get(n)!;
    const parent = rawParent.get(n);
    if (parent !== undefined && node.issue === null) { node.parent = parent; nodes.get(parent)!.children.push(n); }
  }
  const roots = numbers.filter((n) => nodes.get(n)!.parent === null);
  const healthy = roots.filter((n) => nodes.get(n)!.issue === null).sort((a, b) => (nodes.get(a)!.pr.baseRef ?? '').localeCompare(nodes.get(b)!.pr.baseRef ?? '') || a - b);
  return { nodes, roots: [...healthy, ...roots.filter((n) => nodes.get(n)!.issue !== null)] };
}

/** Depth-first rows (parents before children, children by PR number). Iterative: depth cannot overflow the stack. */
export function flattenStack(graph: StackGraph): StackRow[] {
  const rows: StackRow[] = [];
  const stack: { n: number; depth: number }[] = [...graph.roots].reverse().map((n) => ({ n, depth: 0 }));
  while (stack.length) {
    const { n, depth } = stack.pop()!;
    const node = graph.nodes.get(n)!;
    rows.push({ pr: node.pr, depth, issue: node.issue, peers: node.peers });
    for (let i = node.children.length - 1; i >= 0; i--) stack.push({ n: node.children[i]!, depth: depth + 1 });
  }
  return rows;
}

const graphCache = new WeakMap<HistoryPull[], StackGraph>();
function stackGraphFor(pulls: HistoryPull[]): StackGraph {
  let g = graphCache.get(pulls);
  if (!g) { g = buildStackGraph(pulls); graphCache.set(pulls, g); }
  return g;
}
export function stackStatus(pr: HistoryPull, pulls: HistoryPull[]): { state: 'ok' | StackIssue; peers: number[] } {
  const node = stackGraphFor(pulls).nodes.get(pr.number);
  return node && node.issue ? { state: node.issue, peers: node.peers } : { state: 'ok', peers: [] };
}
/** Reported stacking: the ONE verified open PR whose head ref equals this PR's base ref; null when unknown or ambiguous. */
export function stackParent(pr: HistoryPull, pulls: HistoryPull[]): HistoryPull | null {
  const g = stackGraphFor(pulls);
  const node = g.nodes.get(pr.number);
  if (node) return node.parent === null ? null : g.nodes.get(node.parent)!.pr;
  if (!pr.baseRef) return null; // not an OPEN PR: the same unique-candidate rule, without a graph position
  const candidates = [...g.nodes.values()].filter((x) => x.pr.number !== pr.number && x.pr.headRef === pr.baseRef);
  return candidates.length === 1 ? candidates[0]!.pr : null;
}
export function stackChildren(pr: HistoryPull, pulls: HistoryPull[]) {
  const g = stackGraphFor(pulls);
  const node = g.nodes.get(pr.number);
  if (node) return node.children.map((n) => g.nodes.get(n)!.pr);
  return pr.headRef ? [...g.nodes.values()].filter((x) => x.pr.baseRef === pr.headRef && x.parent === null && x.issue === null).map((x) => x.pr) : [];
}
export function relatedPulls(pr: HistoryPull, pulls: HistoryPull[]): Set<number> {
  const related = new Set<number>([pr.number]);
  const seen = new Set<number>();
  let cursor: HistoryPull | null = pr;
  while (cursor && !seen.has(cursor.number)) { seen.add(cursor.number); related.add(cursor.number); cursor = stackParent(cursor, pulls); }
  const queue = [pr];
  while (queue.length) for (const child of stackChildren(queue.shift()!, pulls)) if (!related.has(child.number)) { related.add(child.number); queue.push(child); }
  for (const peer of stackStatus(pr, pulls).peers) related.add(peer); // members of the same unverified relationship
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
export type TimelineItem = { pr: HistoryPull; lane: LaneId; /** true date position of the PR's creation */ x: number; /** card left edge; shifted left only to keep the card inside the plot */ cardX: number; barWidth: number; width: number; row: number; y: number; endIso: string; clippedStart?: boolean; clippedEnd?: boolean };
export type TimelineLane = { id: LaneId; y: number; height: number; rows: number; count: number; collapsed: boolean };
export type TimelineLayout = {
  start: number; end: number; pxPerDay: number; fit: boolean; width: number; height: number;
  lanes: TimelineLane[]; items: TimelineItem[]; ticks: { x: number; label: string }[];
  hiddenByRange: number; total: number; activityAvailable?: boolean;
};
export const LANE_BASE_HEIGHT = 56;
export const ROW_HEIGHT = 58;
export const CARD_MIN_WIDTH = 196;
export const PLOT_GUTTER_LEFT = 12;
export const PLOT_GUTTER_RIGHT = 20;
export const MIN_FIT_PX_PER_DAY = 4; // below this, Auto Fit stops compressing and the plot scrolls internally
export const MAX_PX_PER_DAY = 1e12; // numeric safety only; real spans never come close (a 1 ms span on a 1000 px plot is ~1e11)
export const FALLBACK_PLOT_WIDTH = 960; // used only before the container has been measured
const MIN_TICK_SPACING = 84; // day-or-longer tick labels
const MIN_TIME_TICK_SPACING = 116; // labels that include a time of day are wider
const MINUTE = 60_000;
const TIME_TICK_STEPS = [1, 5, 15, 30, 60, 180, 360, 720].map((m) => m * MINUTE);
const DAY_TICK_STEPS = [1, 2, 7, 14];
export const ZOOM_FACTOR = 1.5;
export const MIN_MANUAL_PX_PER_DAY = 1;
export const MAX_CANVAS_WIDTH = 120_000; // keeps the zoomed canvas far below browser size limits
export const MIN_AXIS_WIDTH = 120;

/**
 * Length of the real interval in days. A zero-length, inverted or invalid interval has nothing to scale, so it is
 * treated as one nominal day: the plot still renders, and no time relationship is invented.
 */
export function effectiveSpanDays(start: number, end: number): number {
  const ms = end - start;
  return Number.isFinite(ms) && ms > 0 ? ms / DAY_MS : 1;
}
/** px/day that spreads the real date span [start, end] across the drawable plot width. Dates are never distorted. */
export function fitPxPerDay(opts: { start: number; end: number; plotWidth: number }): number {
  const plotWidth = opts.plotWidth > 0 && Number.isFinite(opts.plotWidth) ? opts.plotWidth : FALLBACK_PLOT_WIDTH;
  const usable = Math.max(1, plotWidth - PLOT_GUTTER_LEFT - PLOT_GUTTER_RIGHT);
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_FIT_PX_PER_DAY, usable / effectiveSpanDays(opts.start, opts.end)));
}
/**
 * Next manual scale. Zoom in always multiplies and zoom out always divides the CURRENT effective scale, whatever
 * mode it came from. Returns null at a numeric boundary so the control can be disabled instead of reversing.
 */
export function zoomStep(current: number, direction: 1 | -1, spanDays: number): number | null {
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(spanDays) || spanDays <= 0) return null;
  const next = direction > 0 ? current * ZOOM_FACTOR : current / ZOOM_FACTOR;
  if (direction > 0) return next * spanDays + PLOT_GUTTER_LEFT + PLOT_GUTTER_RIGHT > MAX_CANVAS_WIDTH ? null : next;
  return next < MIN_MANUAL_PX_PER_DAY || next * spanDays < MIN_AXIS_WIDTH ? null : next;
}
/**
 * Earliest valid timestamp among the FETCHED pull request creations and commit dates (ISO string), or null when there is none.
 * Invalid or missing timestamps are ignored. This is a bound on what was fetched, never proof of the repository's first activity.
 */
export function earliestFetchedTimestamp(history: Pick<DevelopmentHistory, 'pulls' | 'commits'>): string | null {
  let best: { iso: string; ms: number } | null = null;
  const consider = (iso: string | null | undefined) => {
    if (typeof iso !== 'string') return;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && (!best || ms < best.ms)) best = { iso, ms };
  };
  for (const p of history.pulls) consider(p.createdAt);
  for (const commit of history.commits) consider(commit.committerDate);
  return (best as { iso: string } | null)?.iso ?? null;
}
export const timelineSpan = (history: DevelopmentHistory, range: RangeId, activityFocus = false) => activityFocus ? activityWindow(history) : ({
  start: rangeStart(range, history.fetchedAt, earliestFetchedTimestamp(history)),
  end: Date.parse(history.fetchedAt),
});
/** A month may be called PR-free only when the PR list was read to its end AND the whole snapshot is Complete. */
export const prAbsenceVerifiable = (history: Pick<DevelopmentHistory, 'status' | 'coverage'>): boolean =>
  history.status === 'complete' && history.coverage?.pulls?.complete === true;
/**
 * Time-of-day ticks for sub-day spans, then day ticks (1/2/7/14) while they stay legible, otherwise SGT calendar-month
 * starts. Sub-day ticks sit on SGT wall-clock multiples of their step.
 */
export function timelineTicks(start: number, end: number, pxPerDay: number, x: (ms: number) => number) {
  const ticks: { x: number; label: string }[] = [];
  const iso = (t: number) => new Date(t).toISOString();
  const timeStep = TIME_TICK_STEPS.find((ms) => (ms / DAY_MS) * pxPerDay >= MIN_TIME_TICK_SPACING);
  if (timeStep !== undefined && timeStep < DAY_MS) {
    for (let t = Math.ceil((start + SGT_OFFSET_MS) / timeStep) * timeStep - SGT_OFFSET_MS; t <= end; t += timeStep) {
      ticks.push({ x: x(t), label: formatSgt(iso(t), true).replace(/ SGT$/, '') });
    }
    if (ticks.length) return ticks;
  }
  const step = DAY_TICK_STEPS.find((d) => d * pxPerDay >= MIN_TICK_SPACING);
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
export function buildTimeline(history: DevelopmentHistory, opts: { range: RangeId; activityFocus?: boolean; state: StateFilter; lanes: Set<LaneId>; collapsed: Set<LaneId>; /** manual zoom; omit for Auto Fit */ pxPerDay?: number; /** drawable plot width used by Auto Fit */ plotWidth?: number; query?: string }): TimelineLayout {
  const fetchedAt = history.fetchedAt;
  const span = timelineSpan(history, opts.range, opts.activityFocus);
  const { start, end } = span;
  const fit = opts.pxPerDay === undefined;
  const pxPerDay = opts.pxPerDay ?? fitPxPerDay({ start, end, plotWidth: opts.plotWidth ?? 0 });
  const x = (ms: number) => PLOT_GUTTER_LEFT + ((ms - start) / DAY_MS) * pxPerDay;
  // The plot ends at Last checked (plus a small gutter): no card minimum or tail extends the date axis.
  const width = Math.ceil(Math.max(fit && opts.plotWidth && opts.plotWidth > 0 ? opts.plotWidth : 0, x(end) + PLOT_GUTTER_RIGHT));
  const q = (opts.query ?? '').trim().toLowerCase();
  const stateMatches = history.pulls.filter((p) => matchesState(p, opts.state) && (!q || `${p.number} ${p.title} ${p.headRef} ${p.baseRef}`.toLowerCase().includes(q)));
  const inRange = stateMatches.filter((p) => {
    const created = Date.parse(p.createdAt ?? ''), ended = Date.parse(pullEnd(p, fetchedAt));
    return Number.isFinite(created) && Number.isFinite(ended) && ended >= created && ended >= start && created <= end;
  });
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
      const barWidth = Math.max(6, x(Math.min(end, Date.parse(endIso))) - left);
      const w = Math.max(CARD_MIN_WIDTH, barWidth);
      // A card near the right edge slides left to stay inside the plot; its duration bar keeps the true date position.
      const cardX = Math.max(0, Math.min(left, width - w - 2));
      let row = rowEnds.findIndex((e) => e + 10 <= cardX);
      if (row < 0) { row = rowEnds.length; rowEnds.push(0); }
      rowEnds[row] = cardX + w;
      laneItems.push({ pr, lane: lane.id, x: left, cardX, barWidth, width: w, row, y: 0, endIso, clippedStart: Date.parse(pr.createdAt!) < start, clippedEnd: Date.parse(endIso) > end });
    }
    const rows = collapsed ? 0 : rowEnds.length;
    const height = LANE_BASE_HEIGHT + rows * ROW_HEIGHT;
    for (const item of laneItems) item.y = y + LANE_BASE_HEIGHT - 6 + item.row * ROW_HEIGHT;
    if (!collapsed) items.push(...laneItems);
    lanes.push({ id: lane.id, y, height, rows, count: lanePulls.length, collapsed });
    y += height;
  }
  return { start, end, pxPerDay, fit, width, height: y, lanes, items, ticks: timelineTicks(start, end, pxPerDay, x), hiddenByRange: stateMatches.length - inRange.length, total: history.pulls.length, activityAvailable: opts.activityFocus ? ('available' in span && span.available === true) : undefined };
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
// ---------- Review provenance (B1.4 P2-1) ----------
export type ReviewProvenanceState =
  | 'CURRENT_HEAD_APPROVAL' | 'HISTORICAL_APPROVAL' | 'REVIEW_HEAD_UNKNOWN' | 'CHANGES_REQUESTED'
  | 'NO_REVIEWS' | 'PARTIAL_REVIEW_HISTORY' | 'NOT_CHECKED' | 'COMMENTED_ONLY' | 'APPROVAL_DISMISSED'
  | 'NEEDS_REFRESH';
export type ReviewProvenance = { state: ReviewProvenanceState; head: string | null; reviewers: ReviewerDecision[] };
const sameCommit = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
/**
 * What the review data may honestly say about the PR head the panel is showing. The commit each review was
 * made on is compared HERE, with the head of the same read, instead of trusting a status word from the server.
 * A matching review record is evidence of a review only; it is not proof that GitHub currently permits a merge.
 * Missing or inconsistent data fails closed.
 */
export function reviewProvenance(detail: PullDetail, rec: Reconciliation): ReviewProvenance {
  const r = detail.reviews;
  const head = detail.pull.headSha;
  const out = (state: ReviewProvenanceState, reviewers: ReviewerDecision[] = []): ReviewProvenance => ({ state, head, reviewers });
  if (rec.headMismatch) return out('NEEDS_REFRESH'); // snapshot head != fresh head: never reuse a review for the shown head
  if (!rec.headsKnown) return out('REVIEW_HEAD_UNKNOWN');
  if (r.status === 'not_checked') return out('NOT_CHECKED');
  if (reviewIsPartial(r)) return out('PARTIAL_REVIEW_HISTORY', Array.isArray(r.reviewers) ? r.reviewers : []);
  if (r.status === 'no_reviews') return out('NO_REVIEWS');
  if (r.status === 'commented_only') return out('COMMENTED_ONLY');
  const reviewers = Array.isArray(r.reviewers) ? r.reviewers : null;
  // A blocker is never hidden, even if the provenance detail is missing.
  if (reviewers === null) return out(r.status === 'changes_requested' ? 'CHANGES_REQUESTED' : 'REVIEW_HEAD_UNKNOWN');
  // The server compared the reviews with the head of its own read; if that is not the head shown here, nothing can be tied to it.
  const comparedHead = r.headSha ?? null;
  const consistent = comparedHead === null || sameCommit(comparedHead, head);
  const recomputed = reviewers.map((x) => ({ ...x, relation: !consistent || !x.commitId || !head ? 'unknown' as const : sameCommit(x.commitId, head) ? 'current_head' as const : 'historical' as const }));
  const approvals = recomputed.filter((x) => x.state === 'APPROVED');
  if (recomputed.some((x) => x.state === 'CHANGES_REQUESTED')) return out('CHANGES_REQUESTED', recomputed);
  if (approvals.some((x) => x.relation === 'current_head')) return out('CURRENT_HEAD_APPROVAL', recomputed);
  if (approvals.some((x) => x.relation === 'historical')) return out('HISTORICAL_APPROVAL', recomputed);
  if (approvals.length > 0) return out('REVIEW_HEAD_UNKNOWN', recomputed);
  if (recomputed.some((x) => x.state === 'DISMISSED')) return out('APPROVAL_DISMISSED', recomputed);
  // Anything else (including a legacy "approved" with no per-review commit) is not a verified decision.
  return out('REVIEW_HEAD_UNKNOWN', recomputed);
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
