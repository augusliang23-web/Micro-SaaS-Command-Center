import { RecentActivityDot } from './RecentActivityDot';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  AlertTriangle, CalendarRange, ChevronDown, ChevronRight, Database, ExternalLink, GitBranch, GitMerge,
  GitPullRequest, List, MoveHorizontal, Network, PanelLeftClose, PanelLeftOpen, RefreshCw, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { DevelopmentHistory, HistoryCommit, HistoryErrorKind, HistoryPull, LiveIdentity, PullDetail } from './gitHistoryTypes';
import {
  LANES, LaneId, RANGE_LABEL, RangeId, STATE_LABEL, STATUS_LABEL, StateFilter, MERGE_EVIDENCE_LABEL,
  PLOT_GUTTER_LEFT, ancestryClaim, effectiveSpanDays, timelineSpan, zoomStep, branchKind, buildTimeline, buildTopology, commitAssociations, prAbsenceVerifiable, driftedRefNames, formatSgt, identityKey, indexCommits, prHeadMismatch, reconcilePullDetail, reviewIsPartial, reviewProvenance, buildStackGraph, flattenStack, stackStatus,
  laneById, laneForBranch, liveRepositoryFor, matchesState, mergeEvidence, rangeStart, relatedPulls, shortSha,
  stackChildren, stackParent, timelineX,
} from './gitHistoryModel';

import { HybridFlowMap } from './HybridFlowMap';
import { ACTIVITY_RECHECK_MS, projectRecentActivity, type CommitWindowHours, type RecentActivitySnapshot } from './recentActivityModel';

type LoadState = {
  key: string; status: 'loading' | 'ready' | 'error'; data?: DevelopmentHistory;
  error?: { kind: HistoryErrorKind; message: string; resetAt?: string | null }; refreshing: boolean;
};
const ERROR_TEXT: Record<HistoryErrorKind, string> = {
  not_authenticated: 'GitHub CLI 尚未授權（gh auth）。資料 Unavailable；不會改用 DEMO 資料。',
  forbidden: '伺服器未授權讀取此 repository（未連線、已中斷、已封存或身分不符）。',
  missing: 'GitHub 找不到資源（repository 或 branch 可能已刪除）。',
  rate_limited: 'GitHub API 速率限制已達上限，請稍後重新整理。',
  not_found: '伺服器找不到 GitHub CLI（gh）。',
  timeout: 'GitHub 讀取逾時，可重試。',
  aborted: '讀取已取消。',
  failed: 'GitHub 讀取失敗，可重試。',
  network: '無法連線到本機 Command Center 伺服器。',
  authorization_changed: 'GitHub 連線在讀取期間已變更或中斷，這次結果已丟棄；請重新整理。',
};
/** V1.2C: every history read names the project, so the server can bind the repository to exactly that project's authority. */
const historyQuery = (repo: string, projectId: string | undefined) => `repo=${encodeURIComponent(repo)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`;

/** Fetches one repository's history; stale or cancelled responses never land. */
export function useDevelopmentHistory(repo: string | null, key: string, projectId?: string) {
  const [state, setState] = useState<LoadState>({ key, status: 'loading', refreshing: true });
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback((refresh: boolean) => {
    controller.current?.abort();
    if (!repo) return;
    const c = new AbortController();
    controller.current = c;
    const mine = ++seq.current;
    setState((s) => (s.key === key ? { ...s, refreshing: true } : { key, status: 'loading', refreshing: true }));
    const fail = (error: LoadState['error']) => setState((s) => ({ key, status: 'error', data: s.key === key ? s.data : undefined, error, refreshing: false }));
    fetch(`/api/github/development-history?${historyQuery(repo, projectId)}${refresh ? '&refresh=1' : ''}`, { signal: c.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (mine !== seq.current || c.signal.aborted) return;
        if (!res.ok || !body) { fail({ kind: (body?.kind as HistoryErrorKind) ?? 'failed', message: body?.error ?? `HTTP ${res.status}`, resetAt: body?.resetAt }); return; }
        if (body.repository !== repo || !Array.isArray(body.pulls) || !Array.isArray(body.branches)) { fail({ kind: 'failed', message: 'Response repository mismatch.' }); return; }
        setState({ key, status: 'ready', data: body as DevelopmentHistory, refreshing: false });
      })
      .catch(() => { if (mine === seq.current && !c.signal.aborted) fail({ kind: 'network', message: 'Network error' }); });
  }, [repo, key, projectId]);
  useEffect(() => { load(false); return () => controller.current?.abort(); }, [load]);
  return { state: state.key === key ? state : ({ key, status: 'loading', refreshing: true } as LoadState), refresh: () => load(true) };
}

// The key includes the parent snapshot version (its fetch time): when the list
// snapshot is replaced, the old detail is discarded and re-read, so CI/review
// data can never outlive the snapshot it was shown beside.
type DetailCache = { owner: string; version: string; map: Map<number, PullDetail> };
/**
 * PR detail cache for ONE project session. LiveHistory is remounted per identity, and the cache is additionally keyed by
 * identity + repository (owner) and by the snapshot version (fetchedAt): a new snapshot, repository or project always
 * starts empty, so CI/review data can never outlive the snapshot it was read against. Errors are never cached.
 */
function useDetailCache(owner: string, version: string): DetailCache {
  const ref = useRef<DetailCache>({ owner, version, map: new Map() });
  if (ref.current.owner !== owner || ref.current.version !== version) ref.current = { owner, version, map: new Map() };
  return ref.current;
}
function usePullDetail(repo: string | null, projectId: string | undefined, scopeKey: string, number: number | null, snapshotVersion: string, cache: DetailCache) {
  const key = JSON.stringify([scopeKey, number, snapshotVersion]);
  const [state, setState] = useState<{ key: string; detail?: PullDetail; error?: string }>({ key });
  const cached = number ? cache.map.get(number) : undefined;
  useEffect(() => {
    if (!repo || !number || cache.map.has(number)) return; // same PR + same snapshot: reuse, no request
    const c = new AbortController();
    setState({ key });
    fetch(`/api/github/development-history/pull?${historyQuery(repo, projectId)}&number=${number}`, { signal: c.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (c.signal.aborted) return;
        if (!res.ok || !body || body.repository !== repo || body.number !== number) { setState({ key, error: body?.error ?? `HTTP ${res.status}` }); return; }
        cache.map.set(number, body);
        setState({ key, detail: body });
      })
      .catch(() => { if (!c.signal.aborted) setState({ key, error: 'Network error' }); });
    return () => c.abort();
  }, [repo, projectId, key, number, cache]);
  if (cached) return { key, detail: cached } as { key: string; detail?: PullDetail; error?: string };
  return state.key === key ? state : { key };
}

const CI_LABEL = { not_checked: 'Not checked', none: 'No CI checks', passing: 'CI passed', failing: 'CI failed', running: 'CI running', pending: 'CI pending', unknown: 'CI unknown（不完整或無法判定）' } as const;
const REVIEW_LABEL = {
  not_checked: 'Not checked', no_reviews: '沒有已送出的 review', partial: 'Partial / UNKNOWN', changes_requested: 'Changes requested', commented_only: '僅留言（無核准）',
  current_head_approval: 'Current-head approval', historical_approval: 'Historical approval', review_head_unknown: 'Approval commit unknown', approval_dismissed: 'Approval dismissed',
} as const;
const REVIEWER_STATE = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', DISMISSED: 'Dismissed' } as const;
const RELATION_LABEL = { current_head: '＝目前 head', historical: '較早 commit（非目前 head）', unknown: '缺少 commit_id，無法比對' } as const;
const AXIS = 34;
const SHEET_MAX_WIDTH = 760; // at or below this viewport width, details open as a bottom sheet
const SHORT_LANE: Record<LaneId, string> = { main: 'main', 'production-pages': 'prod', 'v23-integration': 'V2.3 int', 'v23-feature': 'V2.3 feat', permissions: 'Perm', 'pdf-delivery': 'PDF', other: 'Other' };
const nodeId = (s: NonNullable<Selection>) => (s.kind === 'pr' ? `pr-${s.number}` : `commit-${s.sha}`);
function useIsSheet() {
  const [sheet, setSheet] = useState(() => typeof window !== 'undefined' && window.innerWidth <= SHEET_MAX_WIDTH);
  useEffect(() => {
    const onResize = () => setSheet(window.innerWidth <= SHEET_MAX_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return sheet;
}
const TOPO_COL_W = 30;
const TOPO_ROW_H = 30;
type View = 'timeline' | 'topology' | 'list' | 'hybrid';
type Selection = { kind: 'pr'; number: number } | { kind: 'commit'; sha: string } | null;
export type RailEntry = { identity: LiveIdentity; label: string; tag: string };

export function GitDevelopmentMap({ identity, rail, selectIdentity }: { identity: LiveIdentity; rail: RailEntry[]; selectIdentity: (identity: LiveIdentity) => void }) {
  const key = identityKey(identity);
  const repo = liveRepositoryFor(identity);
  // The rail state lives above LiveHistory: collapsing never remounts it, so no GitHub refetch and no identity change.
  const [railCollapsed, setRailCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= SHEET_MAX_WIDTH);
  return <div className={`g-shell ${railCollapsed ? 'is-rail-collapsed' : ''}`} style={{ ['--g-rail-w' as string]: railCollapsed ? '64px' : '220px' }}>
    <nav className="g-rail" aria-label="專案（開發地圖）">
      <div className="g-rail-head">
        <p className="g-rail-title">PROJECTS</p>
        <button type="button" className="g-rail-toggle" aria-expanded={!railCollapsed} aria-controls="g-rail-list" aria-label={railCollapsed ? '展開側邊欄' : '收折側邊欄'} title={railCollapsed ? '展開側邊欄' : '收折側邊欄'} onClick={() => setRailCollapsed((c) => !c)}>
          {railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className="g-rail-list" id="g-rail-list">
        {rail.map((entry) => {
          const active = identityKey(entry.identity) === key;
          return <button key={identityKey(entry.identity)} type="button" aria-current={active ? 'page' : undefined} aria-label={`${entry.label} · ${entry.tag}`} title={`${entry.label} · ${entry.tag}`} onClick={() => selectIdentity(entry.identity)}>
            <span className="g-rail-mark">{entry.label.slice(0, 1)}</span><span className="g-rail-text"><strong>{entry.label}</strong><small>{entry.tag}</small></span>
          </button>;
        })}
      </div>
      <p className="g-rail-foot">唯讀 · 無 AI 對話 · 無 agent 執行</p>
    </nav>
    <div className="g-content">
      {repo ? <LiveHistory key={key} identity={identity} repo={repo} /> : <NotConnected identity={identity} />}
    </div>
  </div>;
}

function NotConnected({ identity }: { identity: LiveIdentity }) {
  return <section className="g-unavailable" aria-label="開發地圖不可用">
    <p className="p-eyebrow">DEVELOPMENT MAP</p>
    <h1>{identity.displayName}</h1>
    <p><strong>{identity.source === 'DEMO' ? 'DEMO PROJECT' : 'REGISTERED PROJECT'}</strong> · Repository：{identity.repository ?? 'Not available'}</p>
    <p className="g-banner is-warn"><AlertTriangle size={15} />Not available：此專案尚未連線到唯讀 GitHub 歷史來源（可在「管理專案」明確連線）。不顯示其他專案的資料，也不以名稱推測 repository。</p>
  </section>;
}

function LiveHistory({ identity, repo }: { identity: LiveIdentity; repo: string }) {
  const key = identityKey(identity);
  const { state, refresh } = useDevelopmentHistory(repo, key, identity.projectId);
  const data = state.data;
  const [view, setView] = useState<View>('timeline');
  const [focusPR, setFocusPR] = useState<number | null>(null);
  const [range, setRange] = useState<RangeId>('6m');
  const [activityFocus, setActivityFocus] = useState(true);
  const [commitWindowHours, setCommitWindowHours] = useState<CommitWindowHours>(12);
  const [pulseEnabled, setPulseEnabled] = useState(true);
  const [activityNow, setActivityNow] = useState(() => Date.now());
  useEffect(() => {
    if (!data) return;
    const tick = () => setActivityNow(Date.now());
    tick();
    const timer = window.setInterval(tick, ACTIVITY_RECHECK_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [data?.fetchedAt]);
  const recentActivity = useMemo(() => projectRecentActivity(data, repo, activityNow, commitWindowHours, state.status !== 'ready' || state.refreshing), [data, repo, activityNow, commitWindowHours, state.status, state.refreshing]);
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [lanes, setLanes] = useState<Set<LaneId>>(() => new Set(LANES.map((l) => l.id)));
  const [collapsed, setCollapsed] = useState<Set<LaneId>>(() => new Set());
  const [manualScale, setManualScale] = useState(0); // px/day while fit === 'manual'
  const [liveScale, setLiveScale] = useState(0); // effective px/day currently drawn, reported by the timeline
  const [fit, setFit] = useState<'auto' | 'manual'>('auto');
  const [compactLabels, setCompactLabels] = useState(false);
  const originRef = useRef<HTMLElement | null>(null); // the element that actually opened the detail
  const restoreFocus = useRef<{ origin: HTMLElement | null; selection: Selection } | null>(null);
  const detailCache = useDetailCache(JSON.stringify([key, repo]), data?.fetchedAt ?? '');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
  const dataStatus = state.status === 'loading' && !data ? 'Loading' : state.status === 'error' ? (data ? 'Needs refresh' : 'Unavailable') : data?.status === 'complete' ? 'Complete' : 'Partial history';
  // Allowlisted != fetched, and a previous snapshot != the latest state: the badge only claims what the load state proves.
  const sourceBadge = (() => {
    if (data && state.refreshing) return { text: `GitHub 唯讀 · 重新整理中 · 顯示上一次成功快照（${formatSgt(data.fetchedAt)}）`, read: false };
    if (state.status === 'error') return { text: data ? `GitHub 唯讀 · Needs refresh · 上一次成功讀取 ${formatSgt(data.fetchedAt)}` : 'GitHub 資料不可用', read: false };
    if (!data) return { text: 'GitHub 唯讀 · 正在查詢', read: false };
    return { text: `GitHub 唯讀 · 已讀取 · ${data.status === 'complete' ? 'Complete' : 'Partial'}`, read: true };
  })();
  const chooseRange = (r: RangeId) => { setRange(r); setActivityFocus(false); setFit('auto'); }; // a new range always restarts at Auto Fit
  const spanDays = data ? effectiveSpanDays(timelineSpan(data, range, view === 'timeline' && activityFocus).start, timelineSpan(data, range, view === 'timeline' && activityFocus).end) : 1;
  const nextZoom = (dir: 1 | -1) => zoomStep(liveScale, dir, spanDays);
  const zoomBy = (dir: 1 | -1) => {
    const next = nextZoom(dir); // always from the CURRENT effective scale, whether it came from Auto Fit or a manual step
    if (next === null) return;
    setManualScale(next);
    setFit('manual');
  };
  const openDetail = useCallback((next: Selection, origin?: Element | null) => {
    // Remember the real opener, but not links inside the dialog itself (those keep the original opener).
    if (origin instanceof HTMLElement && !origin.closest('[role="dialog"]')) originRef.current = origin;
    setSelection(next);
  }, []);
  const selectionRef = useRef<Selection>(null);
  selectionRef.current = selection;
  const closeDetail = useCallback(() => { restoreFocus.current = { origin: originRef.current, selection: selectionRef.current }; setSelection(null); }, []);
  useEffect(() => { // after the overlay unmounts, return focus to the real opener, else the selected node, else the timeline
    if (selection || !restoreFocus.current) return;
    const { origin, selection: closed } = restoreFocus.current;
    restoreFocus.current = null;
    originRef.current = null;
    const usable = (el: HTMLElement | null) => Boolean(el && el.isConnected && !(el as HTMLButtonElement).disabled && !el.closest('[hidden],[inert]'));
    const target = usable(origin) ? origin : (closed ? document.querySelector<HTMLElement>(`[data-node="${nodeId(closed)}"]`) : null) ?? document.querySelector<HTMLElement>('.g-frame, .g-table-wrap, .g-scroll.is-topo, .g-hybrid');
    target?.focus({ preventScroll: true });
  }, [selection]);
  const toggle = (set: Set<LaneId>, id: LaneId) => { const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); return next; };

  return <>
    <header className="g-header">
      <div>
        <p className="p-eyebrow">DEVELOPMENT MAP · {repo}</p>
        <h1>{identity.displayName}</h1>
        <p className="g-badges"><span className="g-badge">{identity.source}</span><span className={`g-badge ${sourceBadge.read ? 'is-live' : ''}`} data-testid="g-source-badge">{sourceBadge.text}</span><span className="g-badge">Project ID：{identity.projectId}</span></p>
      </div>
      <button className="p-secondary" onClick={refresh} disabled={state.refreshing} aria-label="重新整理 GitHub 資料"><RefreshCw size={14} className={state.refreshing ? 'is-spinning' : ''} />{state.refreshing ? '讀取中…' : '重新整理'}</button>
    </header>
    <dl className="g-provenance" aria-label="資料來源">
      <div><dt>Source</dt><dd>GitHub（gh CLI · 唯讀 GET）</dd></div>
      <div><dt>Repository</dt><dd><a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">{repo}</a></dd></div>
      <div><dt>Last checked</dt><dd>{data ? formatSgt(data.fetchedAt) : 'Not checked'}{data?.cache === 'hit' ? '（伺服器快取 ≤5 分鐘）' : ''}</dd></div>
      <div><dt>Data status</dt><dd><span className={`g-status is-${dataStatus.split(' ')[0].toLowerCase()}`}>{dataStatus}</span></dd></div>
    </dl>
    {data && <p className="g-muted g-note">非原子快照：分支、PR、commit 為多次獨立的 GET 讀取{data.consistency ? (data.consistency.status === 'consistent' ? `；結束前重讀分支 head（${formatSgt(data.consistency.rereadAt)}）：未發現移動` : data.consistency.status === 'inconsistent' ? '；結束前重讀發現分支 head 已移動：整體快照標為 Partial；未受影響的已驗證 Git 關係維持原狀，受影響者標為 UNKNOWN' : '；未能重讀分支 head，一致性未驗證') : ''}。</p>}
    {state.status === 'error' && <p className="g-banner is-error" role="alert"><AlertTriangle size={15} />{ERROR_TEXT[state.error!.kind] ?? ERROR_TEXT.failed}{state.error?.resetAt ? ` 重置時間：${formatSgt(state.error.resetAt)}` : ''}{data ? ' 目前顯示上一次成功讀取的資料（Needs refresh）。' : ''}</p>}
    {state.status === 'loading' && !data && <p className="g-banner" role="status">正在從 GitHub 讀取 {repo} 的分支、PR 與 commit 歷史…</p>}
    {data && data.warnings.length > 0 && <p className="g-banner is-warn"><AlertTriangle size={15} />Partial history：{data.warnings.join(' ')}</p>}
    {data && <>
      {view !== 'hybrid' && <Summary data={data} />}
      <div className="g-toolbar" role="toolbar" aria-label="開發地圖控制">
        <div className="g-seg" role="tablist" aria-label="檢視">
          {([['timeline', '開發時間軸', CalendarRange], ['topology', 'Git 拓樸', Network], ['list', '清單', List], ['hybrid', '開發全貌 / Hybrid', GitBranch]] as const).map(([id, label, Icon]) =>
            <button key={id} role="tab" aria-selected={view === id} onClick={() => { if (id === 'hybrid' && selection?.kind === 'pr') setFocusPR(selection.number); setView(id); }}><Icon size={14} />{label}</button>)}
        </div>
        <div className="g-seg" role="group" aria-label="時間範圍">
          {view === 'timeline' && <button aria-pressed={activityFocus} onClick={() => { setActivityFocus(true); setFit('auto'); }}>聚焦開發活動</button>}
          {(Object.keys(RANGE_LABEL) as RangeId[]).map((r) => <button key={r} aria-pressed={range === r && (view !== 'timeline' || !activityFocus)} onClick={() => chooseRange(r)}>{RANGE_LABEL[r]}</button>)}
        </div>
        {view !== 'topology' && <label className="g-select">狀態<select aria-label="PR 狀態篩選" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
          {(Object.keys(STATE_LABEL) as StateFilter[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select></label>}
        {view !== 'topology' && <label className="g-select">搜尋<input aria-label="搜尋 PR 或分支" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="#55、v23…" /></label>}
        {view === 'timeline' && <div className="g-seg" role="group" aria-label="縮放">
          <button aria-pressed={fit === 'auto'} onClick={() => setFit('auto')} title="依可用寬度自動貼合所選日期範圍"><MoveHorizontal size={14} />Auto Fit</button>
          <button aria-label="縮小" disabled={nextZoom(-1) === null} onClick={() => zoomBy(-1)}><ZoomOut size={14} /></button>
          <button aria-label="放大" disabled={nextZoom(1) === null} onClick={() => zoomBy(1)}><ZoomIn size={14} /></button>
        </div>}
        {view === 'timeline' && <div className="g-seg" role="group" aria-label="分支標籤">
          <button aria-pressed={compactLabels} onClick={() => setCompactLabels((c) => !c)} title={compactLabels ? '展開分支標籤欄' : '收合分支標籤欄'}>{compactLabels ? '展開分支標籤' : '收合分支標籤'}</button>
        </div>}
      </div>
      {(view === 'timeline' || view === 'hybrid') && <section className="pr-activity-controls" aria-label="近期 HEAD Commit 提示">
        <div><button className="p-secondary" aria-label="近期 Commit 提示" aria-pressed={pulseEnabled} onClick={() => { setPulseEnabled(value => !value); setActivityNow(Date.now()); }}>{pulseEnabled ? '近期 Commit 提示：開啟' : '近期 Commit 提示：關閉'}</button>
          <label>Commit 時窗<select aria-label="近期 Commit 時窗" value={commitWindowHours} onChange={event => { setCommitWindowHours(Number(event.target.value) as CommitWindowHours); setActivityNow(Date.now()); }}>{([6,12,24] as const).map(hours => <option key={hours} value={hours}>{hours} 小時</option>)}</select></label>
          <span aria-label="Commit 活動資料狀態">{recentActivity.message}</span></div>
        <p>僅核對 OPEN / DRAFT 的精確 HEAD Commit（committerDate），不表示 Push 時間或 Agent 執行。快照有效期 15 分鐘；Last checked {data ? formatSgt(data.fetchedAt) : 'Not checked'}。與時間軸「聚焦開發活動」分開；群組展開後顯示個別提示。</p>
      </section>}
      {(view === 'timeline' || view === 'list') && <div className="g-lane-filter" role="group" aria-label="分支群組篩選">
        {LANES.map((l) => <button key={l.id} aria-pressed={lanes.has(l.id)} onClick={() => setLanes((s) => toggle(s, l.id))} style={{ ['--lane' as string]: l.color }}><i />{l.title}</button>)}
      </div>}
      <div className="g-layout">
        <section className="g-graph-panel" aria-label={view === 'hybrid' ? '開發全貌 / Hybrid' : view === 'topology' ? 'Git 拓樸圖' : view === 'list' ? 'PR 清單' : '開發時間軸'}>
          {view === 'timeline' && <Timeline recentActivity={recentActivity} pulseEnabled={pulseEnabled} commitWindowHours={commitWindowHours} data={data} range={range} activityFocus={activityFocus} stateFilter={stateFilter} lanes={lanes} collapsed={collapsed} toggleCollapsed={(id) => setCollapsed((s) => toggle(s, id))} fit={fit} manualScale={manualScale} compactLabels={compactLabels} onScale={setLiveScale} query={query} selection={selection} select={openDetail} refreshFailed={state.status === 'error'} />}
          {view === 'topology' && <Topology data={data} range={range} selection={selection} select={openDetail} />}
          {view === 'hybrid' && <HybridFlowMap recentActivity={recentActivity} pulseEnabled={pulseEnabled} commitWindowHours={commitWindowHours} data={data} range={range} stateFilter={stateFilter} query={query} focusPR={focusPR ?? (selection?.kind === 'pr' ? selection.number : null)} onFocusPR={number => { setFocusPR(number); setSelection(null); }} onClearFocus={() => setFocusPR(null)} modalOpen={selection !== null} openDetail={(number, origin) => openDetail({ kind: 'pr', number }, origin)} needsRefresh={state.status === 'error' || state.refreshing} />}
          {view === 'list' && <PullList data={data} stateFilter={stateFilter} query={query} range={range} selection={selection} select={openDetail} />}
        </section>
      </div>
      {selection && <DetailOverlay data={data} repo={repo} projectId={identity.projectId} scopeKey={key} selection={selection} select={openDetail} close={closeDetail} refresh={refresh} cache={detailCache} />}
      {view !== 'hybrid' && <BottomCards data={data} select={openDetail} />}
    </>}
  </>;
}

function Summary({ data }: { data: DevelopmentHistory }) {
  const c = data.coverage;
  const main = data.branches.find((b) => b.name === data.defaultBranch);
  const pp = data.branches.find((b) => b.name === 'production-pages');
  const commitDate = (sha?: string | null) => data.commits.find((x) => x.sha === sha)?.committerDate ?? null;
  return <section className="g-summary" aria-label="Repository 摘要">
    <div><span>遠端分支（GitHub）</span><strong>{c.branches.count}</strong><small>{c.branches.complete ? `完整讀取 · ${c.branches.pages} 頁` : 'Partial · 分頁未讀完'}</small></div>
    <div><span>Pull Requests</span><strong>{c.pulls.count}</strong><small>OPEN {c.pulls.open}（DRAFT {c.pulls.draft}）· MERGED {c.pulls.merged} · 關閉未合併 {c.pulls.closedUnmerged}</small></div>
    <div><span>{data.defaultBranch} head</span><strong className="g-mono">{shortSha(main?.headSha)}</strong><small>commit 時間 {formatSgt(commitDate(main?.headSha))}</small></div>
    <div><span>production-pages head</span><strong className="g-mono">{pp ? shortSha(pp.headSha) : 'Not available'}</strong><small>{pp ? `commit 時間 ${formatSgt(commitDate(pp.headSha))}` : 'Missing branch'}</small></div>
    <div><span>本機 Worktree</span><strong className="g-text">Not checked</strong><small>遠端分支 ≠ 本機 worktree；本階段不檢查本機</small></div>
    <div><span>部署 / CI / 專案健康</span><strong className="g-text">Not checked</strong><small>MERGED ≠ DEPLOYED · 健康狀態 UNKNOWN</small></div>
  </section>;
}

function prLabel(pr: HistoryPull) {
  return `PR #${pr.number} · ${pr.title} · ${STATUS_LABEL[pr.status]} · ${pr.headRef ?? '?'} → ${pr.baseRef ?? '?'} · 建立 ${formatSgt(pr.createdAt)}${pr.mergedAt ? ` · 合併 ${formatSgt(pr.mergedAt)}` : ''}`;
}

function Timeline({ recentActivity, pulseEnabled, commitWindowHours, data, range, activityFocus, stateFilter, lanes, collapsed, toggleCollapsed, fit, manualScale, compactLabels, onScale, query, selection, select, refreshFailed = false }: {
  recentActivity: RecentActivitySnapshot; pulseEnabled: boolean; commitWindowHours: CommitWindowHours; data: DevelopmentHistory; range: RangeId; activityFocus: boolean; stateFilter: StateFilter; lanes: Set<LaneId>; collapsed: Set<LaneId>; toggleCollapsed: (id: LaneId) => void;
  fit: 'auto' | 'manual'; manualScale: number; compactLabels: boolean; onScale: (pxPerDay: number) => void; query: string; selection: Selection; select: (s: Selection, origin?: Element | null) => void;
  /** The last refresh failed: the held snapshot is historical, so it cannot support a current absence claim. */ refreshFailed?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ frame: 0, labels: 0 });
  // Auto Fit measures the real container: frame width minus the sticky branch-label column.
  // ResizeObserver covers window resizes, rail collapse/expand and label-column changes.
  useLayoutEffect(() => {
    const el = scroller.current;
    const labels = labelsRef.current;
    if (!el) return;
    const measure = () => setBox((b) => { const f = el.clientWidth; const l = labels?.offsetWidth ?? 0; return b.frame === f && b.labels === l ? b : { frame: f, labels: l }; });
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (labels) ro.observe(labels);
    return () => ro.disconnect();
  }, [compactLabels]);
  const plotWidth = box.frame > 0 ? Math.max(0, box.frame - box.labels) : 0;
  const layout = useMemo(() => buildTimeline(data, { range, activityFocus, state: stateFilter, lanes, collapsed, pxPerDay: fit === 'manual' ? manualScale : undefined, plotWidth, query }), [data, range, activityFocus, stateFilter, lanes, collapsed, fit, manualScale, plotWidth, query]);
  useLayoutEffect(() => { onScale(layout.pxPerDay); }, [layout.pxPerDay, onScale]);
  const index = useMemo(() => indexCommits(data.commits), [data]);
  const lastScroll = useRef(0);
  const prevScale = useRef<{ ppd: number; start: number } | null>(null);
  useLayoutEffect(() => { if (scroller.current) { scroller.current.scrollLeft = activityFocus ? 0 : scroller.current.scrollWidth; lastScroll.current = scroller.current.scrollLeft; } }, [range, activityFocus]);
  // Keep the same moment centred when the scale changes (zoom, resize, rail collapse) instead of jumping.
  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = prevScale.current;
    prevScale.current = { ppd: layout.pxPerDay, start: layout.start };
    if (!el || !prev) return;
    if (prev.start !== layout.start) { if (activityFocus && fit === 'auto') { el.scrollLeft = 0; lastScroll.current = 0; } return; }
    if (prev.ppd === layout.pxPerDay) return;
    const view = Math.max(0, el.clientWidth - (labelsRef.current?.offsetWidth ?? 0));
    const centreMs = prev.start + ((lastScroll.current + view / 2 - PLOT_GUTTER_LEFT) / prev.ppd) * 86_400_000;
    const next = PLOT_GUTTER_LEFT + ((centreMs - layout.start) / 86_400_000) * layout.pxPerDay - view / 2;
    el.scrollLeft = Math.max(0, next);
    lastScroll.current = el.scrollLeft;
  }, [layout.pxPerDay, layout.start]);
  const selectedPr = selection?.kind === 'pr' ? data.pulls.find((p) => p.number === selection.number) ?? null : null;
  const related = selectedPr ? relatedPulls(selectedPr, data.pulls) : null;
  const byNumber = new Map(layout.items.map((i) => [i.pr.number, i]));
  // Only main and production-pages are drawn as branch lines; other lanes are name groups.
  const laneLineY = (id: LaneId) => { if (id !== 'main' && id !== 'production-pages') return null; const lane = layout.lanes.find((l) => l.id === id); return lane ? AXIS + lane.y + 30 : null; };
  const xOf = (iso: string) => timelineX(layout, iso);
  const ppShas = new Set(data.comparisons.find((c) => c.head === 'production-pages')?.commitShas ?? []);
  const laneCommits = (id: 'main' | 'production-pages') => {
    const shas = id === 'main' ? data.defaultBranchShas : [...ppShas];
    return shas.map((s) => index.get(s)).filter((c): c is HistoryCommit => Boolean(c?.committerDate && Date.parse(c.committerDate) >= layout.start && Date.parse(c.committerDate) <= layout.end));
  };
  const connectors: { d: string; kind: 'verified-merge' | 'pr-record' | 'reported-base'; label: string; color: string; dim: boolean; focus: boolean }[] = [];
  for (const item of layout.items) {
    const pr = item.pr;
    const color = laneById(item.lane).color;
    const dim = Boolean(related && !related.has(pr.number));
    const focus = Boolean(related?.has(pr.number));
    const sy = AXIS + item.y + 44;
    if (pr.merged && pr.mergedAt) {
      const evidence = mergeEvidence(pr, index);
      const parentItem = stackParent(pr, data.pulls) ? byNumber.get(stackParent(pr, data.pulls)!.number) : undefined;
      const ty = laneLineY(laneForBranch(pr.baseRef, data.defaultBranch)) ?? (parentItem ? AXIS + parentItem.y + 44 : null);
      if (ty !== null) {
        const sx = item.x + item.barWidth; const tx = xOf(new Date(Math.min(layout.end, Date.parse(pr.mergedAt))).toISOString());
        connectors.push({ d: `M ${sx} ${sy} C ${sx + 30} ${sy}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`, kind: evidence === 'verified_merge_commit' ? 'verified-merge' : 'pr-record', label: `PR #${pr.number} 合併到 ${pr.baseRef}：${MERGE_EVIDENCE_LABEL[evidence]}`, color, dim, focus });
      }
    } else if (pr.state === 'open') {
      const parent = stackParent(pr, data.pulls);
      const parentItem = parent ? byNumber.get(parent.number) : undefined;
      const ty = parentItem ? AXIS + parentItem.y + 44 : laneLineY(laneForBranch(pr.baseRef, data.defaultBranch)) ?? sy - 22;
      {
        const tx = parentItem ? parentItem.cardX + 24 : item.cardX - 18;
        connectors.push({ d: `M ${item.cardX} ${sy} C ${item.cardX - 30} ${sy}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`, kind: 'reported-base', label: `PR #${pr.number} 回報的 base：${pr.baseRef}${parent ? `（PR #${parent.number} 的 head）` : ''} · PR metadata，非 fork point 證據`, color, dim, focus });
      }
    }
  }
  const fetchedX = xOf(new Date(layout.end).toISOString());
  const checkedInWindow = Date.parse(data.fetchedAt) >= layout.start && Date.parse(data.fetchedAt) <= layout.end;
  // Months in range in which GitHub shows no PR created (a source fact). Months are SGT calendar months.
  const emptyMonths = useMemo(() => {
    const createdMonths = new Set(data.pulls.map((p) => formatSgt(p.createdAt, false).slice(0, 7)));
    const out: string[] = [];
    const first = new Date(layout.start + 8 * 3_600_000);
    const last = new Date(Date.parse(data.fetchedAt) + 8 * 3_600_000);
    for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth()); m += 1) {
      if (m > 11) { m = 0; y += 1; if (y > last.getUTCFullYear()) break; }
      const label = `${y}-${String(m + 1).padStart(2, '0')}`;
      if (!createdMonths.has(label)) out.push(label);
    }
    return out;
  }, [data.pulls, data.fetchedAt, layout.start]);
  return <>
    <div className="g-graph-top"><strong>開發時間軸 · {activityFocus ? '聚焦開發活動' : RANGE_LABEL[range]}</strong><span>橫軸：實際日期（Asia/Singapore，UTC+8）· {layout.fit ? 'Auto Fit' : `手動縮放 ${layout.pxPerDay} px/天`}（{layout.pxPerDay.toFixed(1)} px/天）· 顯示 {layout.items.length} / {layout.total} 個 PR{layout.hiddenByRange ? ` · ${layout.hiddenByRange} 個未定位（範圍外或日期不完整）` : ''}</span>{activityFocus && <span>視窗：{layout.activityAvailable ? `${formatSgt(new Date(layout.start).toISOString())} → ${formatSgt(new Date(layout.end).toISOString())}` : '沒有可用的 PR 活動日期'} · Last checked {formatSgt(data.fetchedAt)} · 依已取得 PR 事件聚焦，非完整歷史</span>}{!activityFocus && range === 'all' && <span data-testid="all-history-scope">{data.status === 'complete' ? '全部歷史＝已取得快照內最早的 commit／PR 起算（all fetched history）。' : 'Partial / UNKNOWN：全部歷史只涵蓋已取得的資料，不代表完整 repository 歷史。'}</span>}</div>
    <div className="g-frame" ref={scroller} tabIndex={0} role="region" aria-label="可捲動的開發時間軸（水平：日期；垂直：分支群組）" onScroll={(e) => { lastScroll.current = e.currentTarget.scrollLeft; }}>
      <div className={`g-lane-labels ${compactLabels ? 'is-compact' : ''}`} ref={labelsRef} style={{ height: layout.height + AXIS }}>
        {layout.lanes.map((lane) => { const meta = laneById(lane.id); const fixed = lane.id === 'main' || lane.id === 'production-pages';
          return <div key={lane.id} className={`g-lane-label ${fixed ? 'is-fixed' : ''}`} style={{ top: AXIS + lane.y, height: lane.height, ['--lane' as string]: meta.color }}>
            {fixed ? <strong title={meta.title}>{compactLabels ? SHORT_LANE[lane.id] : meta.title}</strong> : <button aria-expanded={!lane.collapsed} aria-label={meta.title} title={meta.title} onClick={() => toggleCollapsed(lane.id)}>{lane.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<strong>{compactLabels ? SHORT_LANE[lane.id] : meta.title}</strong></button>}
            <small>{fixed ? meta.note : `${lane.count} PR · ${meta.note}`}</small>
          </div>; })}
      </div>
      <div className="g-canvas" data-range-mode={activityFocus ? 'activity' : 'calendar'} data-start={layout.start} data-end={layout.end} data-fit={layout.fit ? 'auto' : 'manual'} data-px-per-day={layout.pxPerDay} style={{ width: layout.width, height: layout.height + AXIS }}>
          <div className="g-axis" style={{ width: layout.width }}>{(layout.activityAvailable === false ? [] : layout.ticks).map((t) => <span key={t.x} className="g-tick-label" style={{ left: t.x }}>{t.label}</span>)}{checkedInWindow && <span className="g-now" style={{ left: timelineX(layout, data.fetchedAt) }}>Last checked {formatSgt(data.fetchedAt, false)}</span>}</div>
          {layout.ticks.map((t) => <i key={t.x} className="g-tick" style={{ left: t.x }} />)}
          {layout.lanes.map((lane, i) => <div key={lane.id} className={`g-band ${i % 2 ? 'is-alt' : ''}`} style={{ top: AXIS + lane.y, height: lane.height }} />)}
          <svg className="g-lines" width={layout.width} height={layout.height + AXIS} aria-hidden={false} role="img" aria-label="PR 與分支關係連線">
            {(['main', 'production-pages'] as const).map((id) => { const y = laneLineY(id); return y === null ? null : <line key={id} x1={8} x2={fetchedX} y1={y} y2={y} stroke={laneById(id).color} strokeWidth={id === 'main' ? 5 : 4} strokeLinecap="round" />; })}
            {connectors.map((c, i) => <path key={i} d={c.d} data-kind={c.kind} aria-label={c.label} stroke={c.kind === 'pr-record' ? '#94a3b8' : c.color} strokeWidth={(c.kind === 'verified-merge' ? 2.4 : 1.8) + (c.focus ? 1.2 : 0)} strokeDasharray={c.kind === 'verified-merge' ? undefined : c.kind === 'reported-base' ? '6 5' : '2 4'} fill="none" opacity={c.focus ? 1 : c.dim ? 0.08 : c.kind === 'reported-base' ? 0.75 : 0.28}><title>{c.label}</title></path>)}
            {checkedInWindow && <line x1={fetchedX} x2={fetchedX} y1={AXIS - 6} y2={layout.height + AXIS} stroke="#0f172a" strokeDasharray="3 4" opacity={0.35} />}
          </svg>
          {(['main', 'production-pages'] as const).map((id) => { const y = laneLineY(id); if (y === null) return null;
            return laneCommits(id).map((c) => { const merge = c.parents.length > 1; const x = xOf(c.committerDate!);
              return merge || c.sha === data.branches.find((b) => b.name === id)?.headSha
                ? <button key={`${id}-${c.sha}`} className={`g-commit-dot ${merge ? 'is-merge' : 'is-head'} ${selection?.kind === 'commit' && selection.sha === c.sha ? 'is-selected' : ''}`} style={{ left: x, top: y, ['--lane' as string]: laneById(id).color }} data-node={`commit-${c.sha}`} data-select aria-label={`${id} commit ${shortSha(c.sha)} · ${c.message} · commit 時間 ${formatSgt(c.committerDate)}`} title={`${shortSha(c.sha)} ${c.message}`} onClick={(e) => select({ kind: 'commit', sha: c.sha }, e.currentTarget)} />
                : <i key={`${id}-${c.sha}`} className="g-commit-tick" style={{ left: x, top: y, background: laneById(id).color }} />; }); })}
          {layout.items.map((item) => { const pr = item.pr; const dim = related && !related.has(pr.number); const activity = recentActivity.byPull.get(pr.number); const recent = pulseEnabled && activity?.state === 'recent';
            return <button key={pr.number} className={`g-pr-card is-${pr.status} kind-${branchKind(pr.headRef, data.defaultBranch)} ${selection?.kind === 'pr' && selection.number === pr.number ? 'is-selected' : ''} ${dim ? 'is-dim' : ''} ${related?.has(pr.number) && selection?.kind === 'pr' && selection.number !== pr.number ? 'is-related' : ''}`}
              style={{ left: item.cardX, top: AXIS + item.y, width: item.width, ['--lane' as string]: laneById(item.lane).color }} data-node={`pr-${pr.number}`} data-select aria-pressed={selection?.kind === 'pr' && selection.number === pr.number} aria-label={prLabel(pr)} aria-describedby={`timeline-commit-${pr.number}`} title={recent ? `${pr.title} · ${activity.explanation}` : pr.title} onClick={(e) => select({ kind: 'pr', number: pr.number }, e.currentTarget)}>
              <span className="g-pr-top"><span className="pr-number-activity"><RecentActivityDot activity={activity} enabled={pulseEnabled} hours={commitWindowHours} fallback={recentActivity.message} /><b>#{pr.number}</b></span><span className={`g-chip is-${pr.status}`}>{STATUS_LABEL[pr.status]}</span><span className="g-pr-branch">{pr.headRef}</span>{item.clippedStart && <small className="g-clipped">視窗外開始</small>}{item.clippedEnd && <small className="g-clipped">視窗外延續</small>}</span>
              <span className="g-pr-title">{pr.title}</span><span className="pr-activity-sr" id={`timeline-commit-${pr.number}`}>{activity?.explanation ?? recentActivity.message}</span>
              <span className="g-pr-track" aria-hidden="true"><i style={{ marginLeft: item.x - item.cardX, width: Math.max(2, Math.min(item.barWidth, item.width - (item.x - item.cardX))) }} className={pr.state === 'open' ? 'is-open' : ''} /></span>
            </button>; })}
      </div>
    </div>
    <div className="g-legend"><span data-testid="no-pr-months">main／production-pages 上的圓點是 commit，不是 PR，兩者沒有推定關聯；PR 卡片只代表 GitHub PR 的建立到合併／關閉期間。{activityFocus ? '活動聚焦僅顯示視窗內期間；視窗外開始／延續保留原始日期，不代表 PR 在裁切處建立或結束。缺少有效建立／結束日期者無法定位；可選明確日曆範圍查看。' : refreshFailed ? '最近一次重新整理失敗（Needs refresh）：目前顯示的是上一次成功讀取的資料，無法確認目前此範圍內是否有月份沒有 PR。' : prAbsenceVerifiable(data) ? (emptyMonths.length ? `此範圍內沒有建立任何 PR 的月份：${emptyMonths.join('、')}（來源事實，並非資料缺漏）。` : '') : 'GitHub 歷史資料不完整，無法確認此範圍內是否有月份沒有 PR。'}</span><span><i className="is-solid" />實線：已驗證 merge commit（parent 含 PR head）</span><span><i className="is-dashed" />虛線：PR 回報的 base（PR metadata，非 fork point）</span><span><i className="is-dotted" />點線：僅 PR 合併紀錄，無 Git parent 證據</span><span>卡片底部條＝實際 PR 期間（建立 → 合併／關閉／Last checked）</span></div>
  </>;
}

function Topology({ data, range, selection, select }: { data: DevelopmentHistory; range: RangeId; selection: Selection; select: (s: Selection, origin?: Element | null) => void }) {
  const [limit, setLimit] = useState(120);
  const topo = useMemo(() => {
    const heads = [data.defaultBranch, 'production-pages', ...data.pulls.filter((p) => p.state === 'open').map((p) => p.headRef)]
      .map((name) => data.branches.find((b) => b.name === name)?.headSha).filter((s): s is string => Boolean(s));
    return buildTopology(data.commits, [...new Set(heads)]);
  }, [data]);
  const start = rangeStart(range, data.fetchedAt, data.commits.reduce<string | null>((m, c) => (c.committerDate && (!m || c.committerDate < m) ? c.committerDate : m), null));
  const inRange = topo.nodes.filter((n) => Date.parse(n.commit.committerDate ?? '') >= start);
  const shown = inRange.slice(0, limit);
  const pos = new Map(shown.map((n, i) => [n.commit.sha, { x: 40 + (shown.length - 1 - i) * TOPO_COL_W, y: AXIS + 24 + n.col * TOPO_ROW_H, col: n.col }]));
  const width = 120 + shown.length * TOPO_COL_W;
  const height = AXIS + 60 + topo.columns * TOPO_ROW_H;
  const heads = new Map<string, string[]>();
  for (const b of data.branches) if (b.headSha && pos.has(b.headSha)) heads.set(b.headSha, [...(heads.get(b.headSha) ?? []), b.name]);
  const index = useMemo(() => indexCommits(data.commits), [data]);
  const selectedSha = selection?.kind === 'commit' ? selection.sha : selection?.kind === 'pr' ? data.pulls.find((p) => p.number === selection.number)?.headSha ?? null : null;
  const ancestry = useMemo(() => {
    const set = new Set<string>(); if (!selectedSha) return set;
    const stack = [selectedSha]; while (stack.length) { const s = stack.pop()!; if (set.has(s)) continue; set.add(s); stack.push(...(index.get(s)?.parents ?? [])); }
    return set;
  }, [selectedSha, index]);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, [range]);
  const missingHeads = data.branches.filter((b) => !b.headSha || !index.has(b.headSha));
  const colColor = (col: number) => col === 0 ? '#0f766e' : ['#b45309', '#7c3aed', '#2563eb', '#db2777', '#0891b2', '#64748b', '#65a30d'][(col - 1) % 7];
  return <>
    <div className="g-graph-top"><strong>Git 拓樸（commit parents）</strong><span>顯示最新 {shown.length} / {inRange.length} 個 commit（範圍內）· 已取得 {data.commits.length} 個 · 橫軸為拓樸順序，非等距日期</span></div>
    <div className="g-scroll is-topo" ref={scroller} tabIndex={0} role="region" aria-label="可水平捲動的 Git 拓樸">
      <div className="g-canvas" style={{ width, height }}>
        {shown.filter((_, i) => i % 12 === 0).map((n) => <span key={n.commit.sha} className="g-tick-label" style={{ left: pos.get(n.commit.sha)!.x - 30 }}>{formatSgt(n.commit.committerDate, false)}</span>)}
        <svg className="g-lines" width={width} height={height} role="img" aria-label="已驗證 commit parent 連線">
          {topo.edges.filter((e) => pos.has(e.from)).map((e) => { const a = pos.get(e.from)!; const b = pos.get(e.to); const on = ancestry.has(e.from) && ancestry.has(e.to);
            if (!b) return <path key={`${e.from}-${e.to}`} d={`M ${a.x} ${a.y} L ${a.x - 22} ${a.y}`} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1.5} fill="none" data-kind="outside-window" aria-label={`${shortSha(e.from)} 的 parent ${shortSha(e.to)} 不在目前視窗`} />;
            const d = a.y === b.y ? `M ${b.x} ${b.y} L ${a.x} ${a.y}` : `M ${b.x} ${b.y} C ${b.x + TOPO_COL_W * 0.7} ${b.y}, ${a.x - TOPO_COL_W * 0.7} ${a.y}, ${a.x} ${a.y}`;
            return <path key={`${e.from}-${e.to}`} d={d} data-kind="verified-parent" aria-label={`已驗證 parent：${shortSha(e.to)} → ${shortSha(e.from)}`} stroke={colColor(e.firstParent ? a.col : b.col)} strokeWidth={on ? 3.2 : 1.8} opacity={selectedSha && !on ? 0.25 : 0.9} fill="none" />; })}
        </svg>
        {shown.map((n) => { const p = pos.get(n.commit.sha)!; const merge = n.commit.parents.length > 1; const names = heads.get(n.commit.sha);
          return <span key={n.commit.sha}>
            <button className={`g-topo-node ${merge ? 'is-merge' : ''} ${selectedSha === n.commit.sha ? 'is-selected' : ''} ${selectedSha && !ancestry.has(n.commit.sha) ? 'is-dim' : ''}`} style={{ left: p.x, top: p.y, ['--lane' as string]: colColor(n.col) }}
              data-node={`commit-${n.commit.sha}`} data-select aria-label={`commit ${shortSha(n.commit.sha)} · ${n.commit.message} · commit 時間 ${formatSgt(n.commit.committerDate)}${merge ? ' · merge commit' : ''}`} title={`${shortSha(n.commit.sha)} ${n.commit.message}`} onClick={(e) => select({ kind: 'commit', sha: n.commit.sha }, e.currentTarget)} />
            {names && <span className="g-head-label" style={{ left: p.x + 10, top: p.y - 24 }} title={names.join(', ')}>{names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}</span>}
          </span>; })}
      </div>
    </div>
    <div className="g-legend">
      <span><i className="is-solid" />實線＝commit 的實際 parent（GitHub commits / compare API）</span><span><i className="is-dotted" />短虛線＝parent 在目前視窗之外</span>
      {inRange.length > shown.length && <button className="p-secondary" onClick={() => setLimit((l) => l + 120)}>載入較舊 120 個 commit</button>}
      <span>{missingHeads.length} 個 branch head 不在已取得的 commit 圖中 → ancestry UNKNOWN</span>
      {driftedRefNames(data).size > 0 && <span>{driftedRefNames(data).size} 個 ref 在讀取期間移動：其 head 標籤為首次觀察值</span>}
    </div>
  </>;
}

function PullList({ data, stateFilter, query, range, selection, select }: { data: DevelopmentHistory; stateFilter: StateFilter; query: string; range: RangeId; selection: Selection; select: (s: Selection, origin?: Element | null) => void }) {
  const start = rangeStart(range, data.fetchedAt, data.pulls.reduce<string | null>((m, p) => (p.createdAt && (!m || p.createdAt < m) ? p.createdAt : m), null));
  const q = query.trim().toLowerCase();
  const rows = data.pulls.filter((p) => matchesState(p, stateFilter) && Date.parse(p.mergedAt ?? p.closedAt ?? data.fetchedAt) >= start && (!q || `${p.number} ${p.title} ${p.headRef} ${p.baseRef}`.toLowerCase().includes(q))).sort((a, b) => b.number - a.number);
  return <>
    <div className="g-graph-top"><strong>PR 清單</strong><span>{rows.length} / {data.pulls.length} 個 PR · 時間為 SGT</span></div>
    <div className="g-table-wrap" tabIndex={0} role="region" aria-label="可捲動 PR 清單">
      <table className="g-table"><thead><tr><th>PR</th><th>狀態</th><th>head → base</th><th>建立</th><th>合併 / 關閉</th></tr></thead>
        <tbody>{rows.map((p) => <tr key={p.number} className={selection?.kind === 'pr' && selection.number === p.number ? 'is-selected' : ''}>
          <td><button className="g-link" data-node={`pr-${p.number}`} data-select onClick={(e) => select({ kind: 'pr', number: p.number }, e.currentTarget)} aria-label={prLabel(p)}>#{p.number} {p.title}</button></td>
          <td><span className={`g-chip is-${p.status}`}>{STATUS_LABEL[p.status]}</span></td>
          <td className="g-mono">{p.headRef} → {p.baseRef}</td><td>{formatSgt(p.createdAt)}</td>
          <td>{p.mergedAt ? `合併 ${formatSgt(p.mergedAt)}` : p.closedAt ? `關閉 ${formatSgt(p.closedAt)}` : '—（OPEN，無合併日期）'}</td>
        </tr>)}</tbody></table>
    </div>
  </>;
}

function Field({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <div><dt>{label}</dt><dd data-testid={testId}>{children}</dd></div>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
/**
 * Floating detail dialog. It is rendered outside the graph grid, so opening or closing it never changes the
 * chart width. Desktop: non-modal panel on the right (clicking another node updates it). Mobile: modal bottom sheet.
 */
function DetailOverlay({ data, repo, projectId, scopeKey, selection, select, close, refresh, cache }: { data: DevelopmentHistory; repo: string; projectId?: string; scopeKey: string; selection: NonNullable<Selection>; select: (s: Selection, origin?: Element | null) => void; close: () => void; refresh: () => void; cache: DetailCache }) {
  const ref = useRef<HTMLDivElement>(null);
  const sheet = useIsSheet();
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []); // focus moves into the dialog when it opens
  // Becoming a modal while already open (desktop -> mobile resize): pull focus inside now and keep it from landing on
  // anything behind the backdrop. Leaving modal mode removes the guard, so the desktop panel stays non-modal.
  useEffect(() => {
    if (!sheet) return;
    const dialog = ref.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (target && ref.current && !ref.current.contains(target)) ref.current.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [sheet]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Outside click closes, except clicks on a selectable node: those just switch the dialog to that node.
    const onPointerDown = (e: Event) => {
      const target = e.target as Element | null;
      if (!target || ref.current?.contains(target) || target.closest('[data-select]')) return;
      if (sheet) return; // the sheet's backdrop handles its own outside click
      close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointerDown); };
  }, [close, sheet]);
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!sheet || e.key !== 'Tab' || !ref.current) return; // only the modal variant traps focus
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
  return <>
    {sheet && <div className="g-backdrop" data-testid="g-backdrop" onClick={close} />}
    <div ref={ref} className={`g-floating ${sheet ? 'is-sheet' : ''}`} role="dialog" aria-modal={sheet} aria-label={selection.kind === 'pr' ? 'PR 詳細資訊' : 'Commit 詳細資訊'} tabIndex={-1} onKeyDown={trap}>
      <DetailPanel data={data} repo={repo} projectId={projectId} scopeKey={scopeKey} selection={selection} select={select} close={close} refresh={refresh} cache={cache} />
    </div>
  </>;
}

function DetailPanel({ data, repo, projectId, scopeKey, selection, select, close, refresh, cache }: { data: DevelopmentHistory; repo: string; projectId?: string; scopeKey: string; selection: NonNullable<Selection>; select: (s: Selection, origin?: Element | null) => void; close: () => void; refresh: () => void; cache: DetailCache }) {
  const index = useMemo(() => indexCommits(data.commits), [data]);
  const pr = selection.kind === 'pr' ? data.pulls.find((p) => p.number === selection.number) ?? null : null;
  const detail = usePullDetail(pr ? repo : null, projectId, scopeKey, pr?.number ?? null, data.fetchedAt, cache);
  const branchNames = new Set(data.branches.map((b) => b.name));
  const branchHead = (name: string | null) => data.branches.find((b) => b.name === name)?.headSha ?? null;
  if (selection.kind === 'pr' && !pr) {
    return <div className="g-detail">
      <div className="g-detail-head"><p className="p-eyebrow"><GitPullRequest size={13} /> PULL REQUEST</p><button aria-label="關閉詳細資訊" onClick={close}><X size={16} /></button></div>
      <h2>PR #{selection.number}</h2>
      <p className="g-banner is-warn" role="status"><AlertTriangle size={15} />PR #{selection.number} 不在最新快照中（Last checked {formatSgt(data.fetchedAt)}）。它可能已被移除或超出讀取範圍；不推測原因。</p>
    </div>;
  }
  if (pr) {
    const parent = stackParent(pr, data.pulls);
    const children = stackChildren(pr, data.pulls);
    const stack = stackStatus(pr, data.pulls);
    const ancestry = ancestryClaim(data, pr, index);
    const evidence = mergeEvidence(pr, index);
    const mismatch = prHeadMismatch(data, pr.number);
    const d = detail.detail;
    const rec = d ? reconcilePullDetail(pr, d) : null;
    const loading = detail.error ? 'Not checked（讀取失敗）' : 'Not checked（讀取中…）';
    let ciText: string = loading;
    if (d && rec) {
      const total = d.ci.total !== null && d.ci.total !== undefined ? `（${d.ci.total} 個 check run）` : '';
      // Fail closed: an unqualified CI result is rendered only when snapshot head = PR head = CI head.
      if (d.ci.status === 'not_checked') ciText = 'Not checked（CI 讀取失敗）';
      else if (rec.ciApplies) ciText = `${CI_LABEL[d.ci.status]}${total} · head ${shortSha(d.ci.headSha)}`;
      else if (rec.missingSha) ciText = `Not verified · 缺少 head SHA（快照 ${shortSha(rec.snapshotHead)}／目前 ${shortSha(rec.currentHead)}／CI ${shortSha(d.ci.headSha)}），無法證明 CI 屬於顯示的 head`;
      else if (!rec.ciHeadConsistent) ciText = `Not verified · CI 讀取的 head ${shortSha(d.ci.headSha)} 與 PR 目前 head ${shortSha(d.pull.headSha)} 不一致`;
      else if (rec.headMismatch) ciText = `Stale data · 針對 ${shortSha(d.ci.headSha)} 的 CI：${CI_LABEL[d.ci.status]}${total} · 不適用於快照 head ${shortSha(pr.headSha)}`;
      else ciText = 'Not verified · 無法證明 CI 屬於顯示的 head';
    }
    let reviewText: ReactNode = loading;
    if (d && rec) {
      const prov = reviewProvenance(d, rec);
      const head = shortSha(prov.head);
      const count = d.reviews.count ? `（${d.reviews.count} 筆）` : '';
      const reviewerList = prov.reviewers.length > 0 && prov.state !== 'NEEDS_REFRESH'
        ? <ul className="g-plain" data-testid="pr-review-reviewers">{prov.reviewers.map((x) => <li key={`${x.reviewer ?? 'anonymous'}-${x.reviewId ?? x.commitId}`}>{x.reviewer ?? '（已刪除帳號）'} · {REVIEWER_STATE[x.state]} · commit <span className="g-mono">{x.commitId ? shortSha(x.commitId) : 'Not available'}</span> · {RELATION_LABEL[x.relation]}</li>)}</ul>
        : null;
      const NOT_MERGE = '（僅是 review 紀錄，不代表 GitHub 允許合併或可部署）';
      let line: string;
      switch (prov.state) {
        case 'NEEDS_REFRESH': line = 'Not verified · 快照已過期，請先重新整理'; break;
        case 'NOT_CHECKED': line = 'Not checked（review 讀取失敗）'; break;
        case 'NO_REVIEWS': line = '沒有已送出的 review'; break;
        case 'COMMENTED_ONLY': line = '僅留言（無核准）'; break;
        case 'PARTIAL_REVIEW_HISTORY': line = `Partial / UNKNOWN（僅讀到 ${d.reviews.count ?? '?'} 筆，review 歷史不完整，不是已驗證的決定${d.reviews.observed && d.reviews.observed !== 'no_reviews' && d.reviews.observed !== 'partial' ? `；已讀部分：${(REVIEW_LABEL as Record<string, string>)[d.reviews.observed] ?? '未知狀態'}（未驗證）` : ''}）`; break;
        case 'CURRENT_HEAD_APPROVAL': line = `Current-head approval · 核准對應目前 head ${head}${NOT_MERGE}`; break;
        case 'HISTORICAL_APPROVAL': line = `Historical approval · 核准的是較早的 commit，不是目前 head ${head}；不能視為目前 head 的核准`; break;
        case 'APPROVAL_DISMISSED': line = 'Approval dismissed · 核准已被撤銷，不是有效核准'; break;
        case 'CHANGES_REQUESTED': line = `Changes requested${count} · 仍有未解除的修改要求`; break;
        case 'REVIEW_HEAD_UNKNOWN': line = !rec.headsKnown ? 'Not verified · 缺少 head SHA，無法確認 review 屬於顯示的 head' : 'Not verified · 核准紀錄缺少 commit_id 或無法與目前 head 比對，無法確認它對應哪個 commit'; break;
      }
      reviewText = <>{line}{reviewerList}</>;
    }
    const ancestryText = ancestry.state === 'yes' ? `已驗證：${pr.baseRef} 目前 head ${shortSha(ancestry.baseHead)} 是 PR head 的祖先`
      : ancestry.state === 'no' ? `已驗證：${pr.baseRef} 目前 head ${shortSha(ancestry.baseHead)} 不是 PR head 的祖先（base 已前進或分歧）`
      : ancestry.reason === 'base_moved' ? `UNKNOWN（快照期間 base 分支 ${pr.baseRef} 的 head 已移動）`
      : ancestry.reason === 'pr_head_moved' ? `UNKNOWN（快照期間 PR head 分支 ${pr.headRef} 已移動）`
      : ancestry.reason === 'pr_head_mismatch' ? 'UNKNOWN（PR 清單與分支清單的 head 不一致）'
      : 'UNKNOWN（相關 commit 未全部取得）';
    return <div className="g-detail">
      <div className="g-detail-head"><p className="p-eyebrow"><GitPullRequest size={13} /> PULL REQUEST</p><button aria-label="關閉詳細資訊" onClick={close}><X size={16} /></button></div>
      <h2>#{pr.number} {pr.title}</h2>
      <p><span className={`g-chip is-${pr.status}`}>{STATUS_LABEL[pr.status]}</span>{pr.isDraft && pr.state === 'open' ? ' Draft' : ''}</p>
      {rec?.needsRefresh && d && <div className="g-banner is-warn" role="status"><AlertTriangle size={15} /><div>
        <strong>Needs refresh{rec.headMismatch ? ' · Stale data' : ' · Not verified'}</strong>
        {rec.headMismatch && <p>快照 head {shortSha(rec.snapshotHead)}，目前 head {shortSha(rec.currentHead)}：PR 在快取期間有新 commit。下方 CI／review 屬於較新的 head，不能套用到快照顯示的 head。</p>}
        {!rec.headMismatch && rec.missingSha && <p>head SHA 缺漏（快照 {shortSha(rec.snapshotHead)}／目前 {shortSha(rec.currentHead)}／CI {shortSha(d.ci.headSha)}）：無法證明 CI 屬於顯示的 head。</p>}
        {!rec.headMismatch && !rec.missingSha && !rec.ciApplies && d.ci.status !== 'not_checked' && <p>CI 讀取的 head {shortSha(d.ci.headSha)} 與 PR 目前 head {shortSha(d.pull.headSha)} 不一致。</p>}
        {rec.stateChange && <p>狀態已變更：{rec.stateChange.from} → {rec.stateChange.to}（快照 {formatSgt(data.fetchedAt)}；即時 {formatSgt(d.fetchedAt)}）。</p>}
        <button className="g-link" onClick={refresh}>重新讀取快照</button>
      </div></div>}
      <dl className="g-fields">
        <Field label="Repository">{repo}</Field>
        <Field label="Source branch（head）"><span className="g-mono">{pr.headRef}</span>{pr.headRef && !branchNames.has(pr.headRef) ? '（上次檢查時不在遠端分支清單；不推測是否曾刪除）' : ''}</Field>
        <Field label="Target branch（base）"><span className="g-mono">{pr.baseRef}</span>{pr.baseRef && !branchNames.has(pr.baseRef) ? '（Missing branch）' : ''}</Field>
        <Field label="建立（created_at）">{formatSgt(pr.createdAt)}</Field>
        <Field label="最後更新（updated_at）">{formatSgt(pr.updatedAt)}</Field>
        <Field label="合併（merged_at）">{pr.mergedAt ? formatSgt(pr.mergedAt) : 'Not merged'}</Field>
        {pr.closedAt && !pr.merged && <Field label="關閉（closed_at）">{formatSgt(pr.closedAt)}</Field>}
        <Field label="Latest head SHA（快照）"><span className="g-mono">{pr.headSha ?? 'Not available'}</span></Field>
        <Field label="Review" testId="pr-review">{reviewText}</Field>
        <Field label="CI" testId="pr-ci">{ciText}</Field>
        <Field label="Changed files">{d?.pull.changedFiles != null && rec && !rec.headMismatch && rec.headsKnown ? `${d.pull.changedFiles} 個檔案 · +${d.pull.additions} / −${d.pull.deletions} · ${d.pull.commits} commits` : rec && (rec.headMismatch || !rec.headsKnown) ? 'Not verified（快照已過期或缺少 head SHA）' : 'Not available'}</Field>
        <Field label="Stacked 關係（PR metadata）" testId="pr-stack">{stack.state !== 'ok'
          ? <>Stack relationship UNKNOWN — cyclic or ambiguous PR metadata（{stack.state === 'cycle' ? '循環參照' : stack.state === 'self_reference' ? '自我參照：head 與 base 同名' : '多個 PR 的 head 與此 PR 的 base 同名，無法判定 parent'}）{stack.peers.filter((n) => n !== pr.number).length > 0 && <> · 涉及：{stack.peers.filter((n) => n !== pr.number).map((n) => <button key={n} className="g-link" onClick={(e) => select({ kind: 'pr', number: n }, e.currentTarget)}>#{n}</button>)}</>}{children.length ? <> · 上層：{children.map((c) => <button key={c.number} className="g-link" onClick={(e) => select({ kind: 'pr', number: c.number }, e.currentTarget)}>#{c.number}</button>)}</> : null}</>
          : <>{parent ? <button className="g-link" onClick={(e) => select({ kind: 'pr', number: parent.number }, e.currentTarget)}>base = PR #{parent.number} 的 head</button> : `base = ${pr.baseRef}`}{children.length ? <> · 上層：{children.map((c) => <button key={c.number} className="g-link" onClick={(e) => select({ kind: 'pr', number: c.number }, e.currentTarget)}>#{c.number}</button>)}</> : null}</>}</Field>
        <Field label="Git ancestry（commit parents）">{ancestryText}</Field>
        {mismatch && <Field label="Snapshot 一致性">PR 清單與分支清單的 head 不一致（PR {shortSha(mismatch.prHeadSha)} vs 分支 {shortSha(mismatch.branchHeadSha)}）：此 PR 的 ancestry 視為 UNKNOWN。</Field>}
        {pr.merged && <Field label="合併證據">{MERGE_EVIDENCE_LABEL[evidence]}{pr.mergeCommitSha ? <> · <button className="g-link g-mono" onClick={(e) => select({ kind: 'commit', sha: pr.mergeCommitSha! }, e.currentTarget)}>{shortSha(pr.mergeCommitSha)}</button></> : null}</Field>}
        <Field label="部署 / 本機 Worktree">Not checked · MERGED ≠ DEPLOYED · OPEN ≠ 正在開發</Field>
        <Field label="Last checked">{formatSgt(data.fetchedAt)}{d ? ` · 詳細資料 ${formatSgt(d.fetchedAt)}` : ''}</Field>
        <Field label="Data completeness">{data.status === 'complete' ? 'Complete（清單與比較皆完整）' : 'Partial history'}</Field>
      </dl>
      <a className="p-primary g-open" href={pr.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />在 GitHub 開啟 PR #{pr.number}</a>
    </div>;
  }
  const sha = selection.kind === 'commit' ? selection.sha : '';
  const commit = index.get(sha);
  const assoc = commitAssociations(sha, data, new Set(data.defaultBranchShas));
  return <div className="g-detail">
    <div className="g-detail-head"><p className="p-eyebrow"><GitMerge size={13} /> COMMIT</p><button aria-label="關閉詳細資訊" onClick={close}><X size={16} /></button></div>
    <h2 className="g-mono">{shortSha(sha)}</h2>
    {commit ? <dl className="g-fields">
      <Field label="Full SHA"><span className="g-mono">{sha}</span></Field>
      <Field label="Message">{commit.message}</Field>
      <Field label="Author date">{formatSgt(commit.authorDate)}</Field>
      <Field label="Commit date">{formatSgt(commit.committerDate)}</Field>
      <Field label="Parent SHAs">{commit.parents.length ? commit.parents.map((p) => <button key={p} className="g-link g-mono" onClick={(e) => select({ kind: 'commit', sha: p }, e.currentTarget)}>{shortSha(p)}{index.has(p) ? '' : '（未取得）'}</button>) : 'Root commit（無 parent）'}</Field>
      <Field label="Associated PR">{[...assoc.mergeOf.map((p) => ({ p, why: 'merge commit' })), ...assoc.headOf.map((p) => ({ p, why: 'PR head' }))].map(({ p, why }) => <button key={`${why}-${p.number}`} className="g-link" onClick={(e) => select({ kind: 'pr', number: p.number }, e.currentTarget)}>#{p.number}（{why}）</button>)}{!assoc.mergeOf.length && !assoc.headOf.length ? 'Not verifiable（無 PR 以此為 head 或 merge commit）' : null}</Field>
      <Field label="Branch context">{assoc.branchHeads.length ? `目前為 ${assoc.branchHeads.join(', ')} 的 head` : '不是任何遠端分支目前的 head'} · {assoc.onDefaultBranch ? `在已取得的 ${data.defaultBranch} 歷史中` : `不在已取得的 ${data.defaultBranch} 歷史中`}</Field>
    </dl> : <p className="g-banner is-warn">Not available：此 commit 不在已取得的歷史中。</p>}
    {commit?.url && <a className="p-primary g-open" href={commit.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />在 GitHub 開啟 commit</a>}
  </div>;
}

const MILESTONES = [13, 23, 33, 34, 35, 40, 47, 48];
function BottomCards({ data, select }: { data: DevelopmentHistory; select: (s: Selection, origin?: Element | null) => void }) {
  const open = data.pulls.filter((p) => p.state === 'open');
  // Stack rows come from a cycle-safe graph (see buildStackGraph): every OPEN PR is listed exactly once, valid stacks keep
  // their nesting, and cyclic / self-referencing / ambiguous relationships are marked UNKNOWN instead of being followed.
  const stackRows = flattenStack(buildStackGraph(data.pulls));
  const unverified = stackRows.filter((r) => r.issue !== null);
  const ISSUE_CHIP = { cycle: '關係不明 · 循環', self_reference: '關係不明 · 自我參照', ambiguous_parent: '關係不明 · 多個可能的 parent' } as const;
  const merges = data.pulls.filter((p) => p.mergedAt).sort((a, b) => Date.parse(b.mergedAt!) - Date.parse(a.mergedAt!)).slice(0, 6);
  const index = indexCommits(data.commits);
  const unknownHeads = data.branches.filter((b) => !b.headSha || !index.has(b.headSha));
  return <section className="g-cards" aria-label="資訊卡">
    <article><h3><GitBranch size={15} />OPEN PR 堆疊（{open.length}）</h3><p className="g-muted">依 PR 回報的 base/head 分組；OPEN ≠ 正在開發，CI／review 需點選 PR 才查詢。</p>
      {unverified.length > 0 && <p className="g-banner is-warn" role="status"><AlertTriangle size={15} />Stack relationship UNKNOWN — cyclic or ambiguous PR metadata（涉及 {unverified.map((r) => `#${r.pr.number}`).join('、')}）。這些 PR 的 base/head 分支名稱形成循環、自我參照或有多個可能的 parent，因此不顯示為已驗證的堆疊；它們仍可點選查看。</p>}
      <ul className="g-tree">{stackRows.map((r) => <li key={r.pr.number} data-pr-number={r.pr.number} data-depth={r.depth} data-stack-issue={r.issue ?? undefined} style={{ paddingLeft: Math.min(r.depth, 10) * 14 }}>
        <button className="g-link" data-select onClick={(e) => select({ kind: 'pr', number: r.pr.number }, e.currentTarget)}>#{r.pr.number}</button> <span className={`g-chip is-${r.pr.status}`}>{STATUS_LABEL[r.pr.status]}</span> {r.pr.title}
        {r.issue && <small className="g-muted"> · {ISSUE_CHIP[r.issue]}{r.issue !== 'self_reference' ? `（#${r.peers.join('、#')}）` : ''}</small>}
        {r.depth === 0 && <small className="g-mono"> ← base {r.pr.baseRef}</small>}
      </li>)}</ul></article>
    <article><h3><GitMerge size={15} />最近合併</h3><ul className="g-plain">{merges.map((p) => <li key={p.number}><button className="g-link" data-select onClick={(e) => select({ kind: 'pr', number: p.number }, e.currentTarget)}>#{p.number}</button> → {p.baseRef} · {formatSgt(p.mergedAt)}</li>)}</ul>
      <h3 className="g-sub">指定里程碑 PR（日期取自 GitHub）</h3><ul className="g-plain">{MILESTONES.map((n) => { const p = data.pulls.find((x) => x.number === n); return <li key={n}>{p ? <><button className="g-link" data-select onClick={(e) => select({ kind: 'pr', number: n }, e.currentTarget)}>#{n}</button> {STATUS_LABEL[p.status]} · {p.mergedAt ? `合併 ${formatSgt(p.mergedAt, false)}` : `建立 ${formatSgt(p.createdAt, false)}`}</> : `#${n} · Not available`}</li>; })}</ul></article>
    <article><h3><Database size={15} />資料覆蓋</h3><ul className="g-plain">
      <li>分支 {data.coverage.branches.count}（{data.coverage.branches.complete ? '完整' : 'Partial'}）· PR {data.coverage.pulls.count}（{data.coverage.pulls.complete ? '完整' : 'Partial'}）</li>
      <li>{data.defaultBranch} commit {data.coverage.commits.defaultBranchCommits}（{data.coverage.commits.defaultBranchComplete ? '至 root 完整' : 'Partial'}）· 圖中 commit 共 {data.coverage.commits.count}</li>
      <li>比較 {data.coverage.focusRefs.compared} 個焦點分支（production-pages、OPEN PR head/base）</li>
      <li>{unknownHeads.length} 個 branch head 不在 commit 圖中：ancestry UNKNOWN{unknownHeads.length ? `（${unknownHeads.slice(0, 4).map((b) => b.name).join('、')}${unknownHeads.length > 4 ? '…' : ''}）` : ''}</li>
    </ul></article>
    <article><h3><AlertTriangle size={15} />信任邊界</h3><ul className="g-plain">
      <li>Remote Branch ≠ GitHub PR ≠ 本機 Worktree ≠ 部署環境</li><li>本機 Worktree：Not checked · 部署：Not checked</li><li>PR base 只是 PR metadata，不等於 fork point</li><li>REAL_AGENT_EXECUTION = NOT_AUTHORIZED</li>
    </ul></article>
  </section>;
}
