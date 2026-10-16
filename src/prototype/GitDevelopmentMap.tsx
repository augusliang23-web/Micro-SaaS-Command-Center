import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, CalendarRange, ChevronDown, ChevronRight, Database, ExternalLink, GitBranch, GitMerge,
  GitPullRequest, List, Network, RefreshCw, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { DevelopmentHistory, HistoryCommit, HistoryErrorKind, HistoryPull, LiveIdentity, PullDetail } from './gitHistoryTypes';
import {
  LANES, LaneId, RANGE_LABEL, RangeId, STATE_LABEL, STATUS_LABEL, StateFilter, MERGE_EVIDENCE_LABEL,
  ancestryClaim, branchKind, buildTimeline, buildTopology, commitAssociations, driftedRefNames, formatSgt, identityKey, indexCommits, prHeadMismatch, reconcilePullDetail, reviewIsPartial,
  laneById, laneForBranch, liveRepositoryFor, matchesState, mergeEvidence, rangeStart, relatedPulls, shortSha,
  stackChildren, stackParent, timelineX,
} from './gitHistoryModel';

type LoadState = {
  key: string; status: 'loading' | 'ready' | 'error'; data?: DevelopmentHistory;
  error?: { kind: HistoryErrorKind; message: string; resetAt?: string | null }; refreshing: boolean;
};
const ERROR_TEXT: Record<HistoryErrorKind, string> = {
  not_authenticated: 'GitHub CLI 尚未授權（gh auth）。資料 Unavailable；不會改用 DEMO 資料。',
  forbidden: '此 repository 不在唯讀允許清單內。',
  missing: 'GitHub 找不到資源（repository 或 branch 可能已刪除）。',
  rate_limited: 'GitHub API 速率限制已達上限，請稍後重新整理。',
  not_found: '伺服器找不到 GitHub CLI（gh）。',
  timeout: 'GitHub 讀取逾時，可重試。',
  aborted: '讀取已取消。',
  failed: 'GitHub 讀取失敗，可重試。',
  network: '無法連線到本機 Command Center 伺服器。',
};

/** Fetches one repository's history; stale or cancelled responses never land. */
export function useDevelopmentHistory(repo: string | null, key: string) {
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
    fetch(`/api/github/development-history?repo=${encodeURIComponent(repo)}${refresh ? '&refresh=1' : ''}`, { signal: c.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (mine !== seq.current || c.signal.aborted) return;
        if (!res.ok || !body) { fail({ kind: (body?.kind as HistoryErrorKind) ?? 'failed', message: body?.error ?? `HTTP ${res.status}`, resetAt: body?.resetAt }); return; }
        if (body.repository !== repo || !Array.isArray(body.pulls) || !Array.isArray(body.branches)) { fail({ kind: 'failed', message: 'Response repository mismatch.' }); return; }
        setState({ key, status: 'ready', data: body as DevelopmentHistory, refreshing: false });
      })
      .catch(() => { if (mine === seq.current && !c.signal.aborted) fail({ kind: 'network', message: 'Network error' }); });
  }, [repo, key]);
  useEffect(() => { load(false); return () => controller.current?.abort(); }, [load]);
  return { state: state.key === key ? state : ({ key, status: 'loading', refreshing: true } as LoadState), refresh: () => load(true) };
}

// The key includes the parent snapshot version (its fetch time): when the list
// snapshot is replaced, the old detail is discarded and re-read, so CI/review
// data can never outlive the snapshot it was shown beside.
function usePullDetail(repo: string | null, scopeKey: string, number: number | null, snapshotVersion: string) {
  const key = JSON.stringify([scopeKey, number, snapshotVersion]);
  const [state, setState] = useState<{ key: string; detail?: PullDetail; error?: string }>({ key });
  useEffect(() => {
    if (!repo || !number) return;
    const c = new AbortController();
    setState({ key });
    fetch(`/api/github/development-history/pull?repo=${encodeURIComponent(repo)}&number=${number}`, { signal: c.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (c.signal.aborted) return;
        if (!res.ok || !body || body.repository !== repo || body.number !== number) setState({ key, error: body?.error ?? `HTTP ${res.status}` });
        else setState({ key, detail: body });
      })
      .catch(() => { if (!c.signal.aborted) setState({ key, error: 'Network error' }); });
    return () => c.abort();
  }, [repo, key, number]);
  return state.key === key ? state : { key };
}

const CI_LABEL = { not_checked: 'Not checked', none: 'No CI checks', passing: 'CI passed', failing: 'CI failed', running: 'CI running', pending: 'CI pending', unknown: 'CI unknown（不完整或無法判定）' } as const;
const REVIEW_LABEL = { not_checked: 'Not checked', no_reviews: '沒有已送出的 review', partial: 'Partial / UNKNOWN', approved: 'Approved', changes_requested: 'Changes requested', commented_only: '僅留言（無核准）' } as const;
const ZOOMS = [3, 6, 10, 16, 26, 40];
const AXIS = 34;
const TOPO_COL_W = 30;
const TOPO_ROW_H = 30;
type View = 'timeline' | 'topology' | 'list';
type Selection = { kind: 'pr'; number: number } | { kind: 'commit'; sha: string } | null;
export type RailEntry = { identity: LiveIdentity; label: string; tag: string };

export function GitDevelopmentMap({ identity, rail, selectIdentity }: { identity: LiveIdentity; rail: RailEntry[]; selectIdentity: (identity: LiveIdentity) => void }) {
  const key = identityKey(identity);
  const repo = liveRepositoryFor(identity);
  return <div className="g-shell">
    <nav className="g-rail" aria-label="專案（開發地圖）">
      <p className="g-rail-title">PROJECTS</p>
      {rail.map((entry) => {
        const active = identityKey(entry.identity) === key;
        return <button key={identityKey(entry.identity)} aria-current={active ? 'page' : undefined} onClick={() => selectIdentity(entry.identity)}>
          <span className="g-rail-mark">{entry.label.slice(0, 1)}</span><span><strong>{entry.label}</strong><small>{entry.tag}</small></span>
        </button>;
      })}
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
    <p className="g-banner is-warn"><AlertTriangle size={15} />Not available：此專案尚未連線到唯讀 GitHub 歷史來源。不顯示其他專案的資料，也不以名稱推測 repository。</p>
  </section>;
}

function LiveHistory({ identity, repo }: { identity: LiveIdentity; repo: string }) {
  const key = identityKey(identity);
  const { state, refresh } = useDevelopmentHistory(repo, key);
  const data = state.data;
  const [view, setView] = useState<View>('timeline');
  const [range, setRange] = useState<RangeId>('6m');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [lanes, setLanes] = useState<Set<LaneId>>(() => new Set(LANES.map((l) => l.id)));
  const [collapsed, setCollapsed] = useState<Set<LaneId>>(() => new Set());
  const [zoom, setZoom] = useState(2);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
  const dataStatus = state.status === 'loading' && !data ? 'Loading' : state.status === 'error' ? (data ? 'Needs refresh' : 'Unavailable') : data?.status === 'complete' ? 'Complete' : 'Partial history';
  const toggle = (set: Set<LaneId>, id: LaneId) => { const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); return next; };

  return <>
    <header className="g-header">
      <div>
        <p className="p-eyebrow">DEVELOPMENT MAP · PM DASHBOARD</p>
        <h1>{identity.displayName}</h1>
        <p className="g-badges"><span className="g-badge is-live">REGISTERED · LIVE GITHUB READ-ONLY</span><span className="g-badge">Project ID：{identity.projectId}</span></p>
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
      <Summary data={data} />
      <div className="g-toolbar" role="toolbar" aria-label="開發地圖控制">
        <div className="g-seg" role="tablist" aria-label="檢視">
          {([['timeline', '開發時間軸', CalendarRange], ['topology', 'Git 拓樸', Network], ['list', '清單', List]] as const).map(([id, label, Icon]) =>
            <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}><Icon size={14} />{label}</button>)}
        </div>
        <div className="g-seg" role="group" aria-label="時間範圍">
          {(Object.keys(RANGE_LABEL) as RangeId[]).map((r) => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>)}
        </div>
        {view !== 'topology' && <label className="g-select">狀態<select aria-label="PR 狀態篩選" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
          {(Object.keys(STATE_LABEL) as StateFilter[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select></label>}
        {view !== 'topology' && <label className="g-select">搜尋<input aria-label="搜尋 PR 或分支" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="#55、v23…" /></label>}
        {view === 'timeline' && <div className="g-seg" role="group" aria-label="縮放">
          <button aria-label="縮小" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}><ZoomOut size={14} /></button>
          <button aria-label="放大" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}><ZoomIn size={14} /></button>
        </div>}
      </div>
      {view !== 'topology' && <div className="g-lane-filter" role="group" aria-label="分支群組篩選">
        {LANES.map((l) => <button key={l.id} aria-pressed={lanes.has(l.id)} onClick={() => setLanes((s) => toggle(s, l.id))} style={{ ['--lane' as string]: l.color }}><i />{l.title}</button>)}
      </div>}
      <div className={`g-layout ${selection ? 'has-detail' : ''}`}>
        <section className="g-graph-panel" aria-label={view === 'topology' ? 'Git 拓樸圖' : view === 'list' ? 'PR 清單' : '開發時間軸'}>
          {view === 'timeline' && <Timeline data={data} range={range} stateFilter={stateFilter} lanes={lanes} collapsed={collapsed} toggleCollapsed={(id) => setCollapsed((s) => toggle(s, id))} pxPerDay={ZOOMS[zoom]} query={query} selection={selection} select={setSelection} />}
          {view === 'topology' && <Topology data={data} range={range} selection={selection} select={setSelection} />}
          {view === 'list' && <PullList data={data} stateFilter={stateFilter} query={query} range={range} selection={selection} select={setSelection} />}
        </section>
        {selection && <DetailPanel data={data} repo={repo} scopeKey={key} selection={selection} select={setSelection} close={() => setSelection(null)} refresh={refresh} />}
      </div>
      <BottomCards data={data} select={setSelection} />
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

function Timeline({ data, range, stateFilter, lanes, collapsed, toggleCollapsed, pxPerDay, query, selection, select }: {
  data: DevelopmentHistory; range: RangeId; stateFilter: StateFilter; lanes: Set<LaneId>; collapsed: Set<LaneId>; toggleCollapsed: (id: LaneId) => void;
  pxPerDay: number; query: string; selection: Selection; select: (s: Selection) => void;
}) {
  const layout = useMemo(() => buildTimeline(data, { range, state: stateFilter, lanes, collapsed, pxPerDay, query }), [data, range, stateFilter, lanes, collapsed, pxPerDay, query]);
  const index = useMemo(() => indexCommits(data.commits), [data]);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, [range, pxPerDay]);
  const selectedPr = selection?.kind === 'pr' ? data.pulls.find((p) => p.number === selection.number) ?? null : null;
  const related = selectedPr ? relatedPulls(selectedPr, data.pulls) : null;
  const byNumber = new Map(layout.items.map((i) => [i.pr.number, i]));
  const selectedItem = selectedPr ? byNumber.get(selectedPr.number) : undefined;
  // Opening the detail panel narrows the graph; keep the selected card in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !selectedItem) return;
    const labels = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
    const left = labels + selectedItem.x - (el.clientWidth + labels) / 2 + Math.min(selectedItem.width, el.clientWidth - labels) / 2;
    el.scrollLeft = Math.max(0, Math.min(left, el.scrollWidth - el.clientWidth));
  }, [selectedItem?.pr.number, selectedItem?.x]);
  // Only main and production-pages are drawn as branch lines; other lanes are name groups.
  const laneLineY = (id: LaneId) => { if (id !== 'main' && id !== 'production-pages') return null; const lane = layout.lanes.find((l) => l.id === id); return lane ? AXIS + lane.y + 30 : null; };
  const xOf = (iso: string) => timelineX(layout, iso);
  const ppShas = new Set(data.comparisons.find((c) => c.head === 'production-pages')?.commitShas ?? []);
  const laneCommits = (id: 'main' | 'production-pages') => {
    const shas = id === 'main' ? data.defaultBranchShas : [...ppShas];
    return shas.map((s) => index.get(s)).filter((c): c is HistoryCommit => Boolean(c?.committerDate && Date.parse(c.committerDate) >= layout.start));
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
        const sx = item.x + item.barWidth; const tx = xOf(pr.mergedAt);
        connectors.push({ d: `M ${sx} ${sy} C ${sx + 30} ${sy}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`, kind: evidence === 'verified_merge_commit' ? 'verified-merge' : 'pr-record', label: `PR #${pr.number} 合併到 ${pr.baseRef}：${MERGE_EVIDENCE_LABEL[evidence]}`, color, dim, focus });
      }
    } else if (pr.state === 'open') {
      const parent = stackParent(pr, data.pulls);
      const parentItem = parent ? byNumber.get(parent.number) : undefined;
      const ty = parentItem ? AXIS + parentItem.y + 44 : laneLineY(laneForBranch(pr.baseRef, data.defaultBranch)) ?? sy - 22;
      {
        const tx = parentItem ? parentItem.x + 24 : item.x - 18;
        connectors.push({ d: `M ${item.x} ${sy} C ${item.x - 30} ${sy}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`, kind: 'reported-base', label: `PR #${pr.number} 回報的 base：${pr.baseRef}${parent ? `（PR #${parent.number} 的 head）` : ''} · PR metadata，非 fork point 證據`, color, dim, focus });
      }
    }
  }
  const fetchedX = xOf(data.fetchedAt);
  return <>
    <div className="g-graph-top"><strong>開發時間軸 · {RANGE_LABEL[range]}</strong><span>橫軸：實際日期（Asia/Singapore，UTC+8）· 顯示 {layout.items.length} / {layout.total} 個 PR{layout.hiddenByRange ? ` · ${layout.hiddenByRange} 個在範圍外` : ''}</span></div>
    <div className="g-frame" ref={scroller} tabIndex={0} role="region" aria-label="可捲動的開發時間軸（水平：日期；垂直：分支群組）">
      <div className="g-lane-labels" style={{ height: layout.height + AXIS }}>
        {layout.lanes.map((lane) => { const meta = laneById(lane.id); const fixed = lane.id === 'main' || lane.id === 'production-pages';
          return <div key={lane.id} className={`g-lane-label ${fixed ? 'is-fixed' : ''}`} style={{ top: AXIS + lane.y, height: lane.height, ['--lane' as string]: meta.color }}>
            {fixed ? <strong>{meta.title}</strong> : <button aria-expanded={!lane.collapsed} onClick={() => toggleCollapsed(lane.id)}>{lane.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<strong>{meta.title}</strong></button>}
            <small>{fixed ? meta.note : `${lane.count} PR · ${meta.note}`}</small>
          </div>; })}
      </div>
      <div className="g-canvas" style={{ width: layout.width, height: layout.height + AXIS }}>
          <div className="g-axis" style={{ width: layout.width }}>{layout.ticks.map((t) => <span key={t.x} className="g-tick-label" style={{ left: t.x }}>{t.label}</span>)}<span className="g-now" style={{ left: timelineX(layout, data.fetchedAt) }}>Last checked {formatSgt(data.fetchedAt, false)}</span></div>
          {layout.ticks.map((t) => <i key={t.x} className="g-tick" style={{ left: t.x }} />)}
          {layout.lanes.map((lane, i) => <div key={lane.id} className={`g-band ${i % 2 ? 'is-alt' : ''}`} style={{ top: AXIS + lane.y, height: lane.height }} />)}
          <svg className="g-lines" width={layout.width} height={layout.height + AXIS} aria-hidden={false} role="img" aria-label="PR 與分支關係連線">
            {(['main', 'production-pages'] as const).map((id) => { const y = laneLineY(id); return y === null ? null : <line key={id} x1={8} x2={fetchedX} y1={y} y2={y} stroke={laneById(id).color} strokeWidth={id === 'main' ? 5 : 4} strokeLinecap="round" />; })}
            {connectors.map((c, i) => <path key={i} d={c.d} data-kind={c.kind} aria-label={c.label} stroke={c.kind === 'pr-record' ? '#94a3b8' : c.color} strokeWidth={(c.kind === 'verified-merge' ? 2.4 : 1.8) + (c.focus ? 1.2 : 0)} strokeDasharray={c.kind === 'verified-merge' ? undefined : c.kind === 'reported-base' ? '6 5' : '2 4'} fill="none" opacity={c.focus ? 1 : c.dim ? 0.08 : c.kind === 'reported-base' ? 0.75 : 0.28}><title>{c.label}</title></path>)}
            <line x1={fetchedX} x2={fetchedX} y1={AXIS - 6} y2={layout.height + AXIS} stroke="#0f172a" strokeDasharray="3 4" opacity={0.35} />
          </svg>
          {(['main', 'production-pages'] as const).map((id) => { const y = laneLineY(id); if (y === null) return null;
            return laneCommits(id).map((c) => { const merge = c.parents.length > 1; const x = xOf(c.committerDate!);
              return merge || c.sha === data.branches.find((b) => b.name === id)?.headSha
                ? <button key={`${id}-${c.sha}`} className={`g-commit-dot ${merge ? 'is-merge' : 'is-head'} ${selection?.kind === 'commit' && selection.sha === c.sha ? 'is-selected' : ''}`} style={{ left: x, top: y, ['--lane' as string]: laneById(id).color }} aria-label={`${id} commit ${shortSha(c.sha)} · ${c.message} · commit 時間 ${formatSgt(c.committerDate)}`} title={`${shortSha(c.sha)} ${c.message}`} onClick={() => select({ kind: 'commit', sha: c.sha })} />
                : <i key={`${id}-${c.sha}`} className="g-commit-tick" style={{ left: x, top: y, background: laneById(id).color }} />; }); })}
          {layout.items.map((item) => { const pr = item.pr; const dim = related && !related.has(pr.number);
            return <button key={pr.number} className={`g-pr-card is-${pr.status} kind-${branchKind(pr.headRef, data.defaultBranch)} ${selection?.kind === 'pr' && selection.number === pr.number ? 'is-selected' : ''} ${dim ? 'is-dim' : ''} ${related?.has(pr.number) && selection?.kind === 'pr' && selection.number !== pr.number ? 'is-related' : ''}`}
              style={{ left: item.x, top: AXIS + item.y, width: item.width, ['--lane' as string]: laneById(item.lane).color }} aria-pressed={selection?.kind === 'pr' && selection.number === pr.number} aria-label={prLabel(pr)} title={pr.title} onClick={() => select({ kind: 'pr', number: pr.number })}>
              <span className="g-pr-top"><b>#{pr.number}</b><span className={`g-chip is-${pr.status}`}>{STATUS_LABEL[pr.status]}</span><span className="g-pr-branch">{pr.headRef}</span></span>
              <span className="g-pr-title">{pr.title}</span>
              <span className="g-pr-track" aria-hidden="true"><i style={{ width: item.barWidth }} className={pr.state === 'open' ? 'is-open' : ''} /></span>
            </button>; })}
      </div>
    </div>
    <div className="g-legend"><span><i className="is-solid" />實線：已驗證 merge commit（parent 含 PR head）</span><span><i className="is-dashed" />虛線：PR 回報的 base（PR metadata，非 fork point）</span><span><i className="is-dotted" />點線：僅 PR 合併紀錄，無 Git parent 證據</span><span>卡片底部條＝實際 PR 期間（建立 → 合併／關閉／Last checked）</span></div>
  </>;
}

function Topology({ data, range, selection, select }: { data: DevelopmentHistory; range: RangeId; selection: Selection; select: (s: Selection) => void }) {
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
              aria-label={`commit ${shortSha(n.commit.sha)} · ${n.commit.message} · commit 時間 ${formatSgt(n.commit.committerDate)}${merge ? ' · merge commit' : ''}`} title={`${shortSha(n.commit.sha)} ${n.commit.message}`} onClick={() => select({ kind: 'commit', sha: n.commit.sha })} />
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

function PullList({ data, stateFilter, query, range, selection, select }: { data: DevelopmentHistory; stateFilter: StateFilter; query: string; range: RangeId; selection: Selection; select: (s: Selection) => void }) {
  const start = rangeStart(range, data.fetchedAt, data.pulls.reduce<string | null>((m, p) => (p.createdAt && (!m || p.createdAt < m) ? p.createdAt : m), null));
  const q = query.trim().toLowerCase();
  const rows = data.pulls.filter((p) => matchesState(p, stateFilter) && Date.parse(p.mergedAt ?? p.closedAt ?? data.fetchedAt) >= start && (!q || `${p.number} ${p.title} ${p.headRef} ${p.baseRef}`.toLowerCase().includes(q))).sort((a, b) => b.number - a.number);
  return <>
    <div className="g-graph-top"><strong>PR 清單</strong><span>{rows.length} / {data.pulls.length} 個 PR · 時間為 SGT</span></div>
    <div className="g-table-wrap" tabIndex={0} role="region" aria-label="可捲動 PR 清單">
      <table className="g-table"><thead><tr><th>PR</th><th>狀態</th><th>head → base</th><th>建立</th><th>合併 / 關閉</th></tr></thead>
        <tbody>{rows.map((p) => <tr key={p.number} className={selection?.kind === 'pr' && selection.number === p.number ? 'is-selected' : ''}>
          <td><button className="g-link" onClick={() => select({ kind: 'pr', number: p.number })} aria-label={prLabel(p)}>#{p.number} {p.title}</button></td>
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

function DetailPanel({ data, repo, scopeKey, selection, select, close, refresh }: { data: DevelopmentHistory; repo: string; scopeKey: string; selection: NonNullable<Selection>; select: (s: Selection) => void; close: () => void; refresh: () => void }) {
  const index = useMemo(() => indexCommits(data.commits), [data]);
  const pr = selection.kind === 'pr' ? data.pulls.find((p) => p.number === selection.number) ?? null : null;
  const detail = usePullDetail(pr ? repo : null, scopeKey, pr?.number ?? null, data.fetchedAt);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [close]);
  const branchNames = new Set(data.branches.map((b) => b.name));
  const branchHead = (name: string | null) => data.branches.find((b) => b.name === name)?.headSha ?? null;
  if (selection.kind === 'pr' && !pr) {
    return <aside className="g-detail" aria-label="PR 詳細資訊">
      <div className="g-detail-head"><p className="p-eyebrow"><GitPullRequest size={13} /> PULL REQUEST</p><button aria-label="關閉詳細資訊" onClick={close}><X size={16} /></button></div>
      <h2>PR #{selection.number}</h2>
      <p className="g-banner is-warn" role="status"><AlertTriangle size={15} />PR #{selection.number} 不在最新快照中（Last checked {formatSgt(data.fetchedAt)}）。它可能已被移除或超出讀取範圍；不推測原因。</p>
    </aside>;
  }
  if (pr) {
    const parent = stackParent(pr, data.pulls);
    const children = stackChildren(pr, data.pulls);
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
    let reviewText: string = loading;
    if (d && rec) {
      if (rec.headMismatch || !rec.headsKnown) reviewText = rec.headMismatch ? 'Not verified · 快照已過期，請先重新整理' : 'Not verified · 缺少 head SHA，無法確認 review 屬於顯示的 head';
      else if (d.reviews.status === 'not_checked') reviewText = 'Not checked（review 讀取失敗）';
      else if (reviewIsPartial(d.reviews)) reviewText = `Partial / UNKNOWN（僅讀到 ${d.reviews.count ?? '?'} 筆，review 歷史不完整，不是已驗證的決定${d.reviews.observed && d.reviews.observed !== 'no_reviews' && d.reviews.observed !== 'partial' ? `；已讀部分：${REVIEW_LABEL[d.reviews.observed]}` : ''}）`;
      else reviewText = `${REVIEW_LABEL[d.reviews.status]}${d.reviews.count ? `（${d.reviews.count} 筆）` : ''}`;
    }
    const ancestryText = ancestry.state === 'yes' ? `已驗證：${pr.baseRef} 目前 head ${shortSha(ancestry.baseHead)} 是 PR head 的祖先`
      : ancestry.state === 'no' ? `已驗證：${pr.baseRef} 目前 head ${shortSha(ancestry.baseHead)} 不是 PR head 的祖先（base 已前進或分歧）`
      : ancestry.reason === 'base_moved' ? `UNKNOWN（快照期間 base 分支 ${pr.baseRef} 的 head 已移動）`
      : ancestry.reason === 'pr_head_moved' ? `UNKNOWN（快照期間 PR head 分支 ${pr.headRef} 已移動）`
      : ancestry.reason === 'pr_head_mismatch' ? 'UNKNOWN（PR 清單與分支清單的 head 不一致）'
      : 'UNKNOWN（相關 commit 未全部取得）';
    return <aside className="g-detail" aria-label="PR 詳細資訊">
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
        <Field label="Stacked 關係（PR metadata）">{parent ? <button className="g-link" onClick={() => select({ kind: 'pr', number: parent.number })}>base = PR #{parent.number} 的 head</button> : `base = ${pr.baseRef}`}{children.length ? <> · 上層：{children.map((c) => <button key={c.number} className="g-link" onClick={() => select({ kind: 'pr', number: c.number })}>#{c.number}</button>)}</> : null}</Field>
        <Field label="Git ancestry（commit parents）">{ancestryText}</Field>
        {mismatch && <Field label="Snapshot 一致性">PR 清單與分支清單的 head 不一致（PR {shortSha(mismatch.prHeadSha)} vs 分支 {shortSha(mismatch.branchHeadSha)}）：此 PR 的 ancestry 視為 UNKNOWN。</Field>}
        {pr.merged && <Field label="合併證據">{MERGE_EVIDENCE_LABEL[evidence]}{pr.mergeCommitSha ? <> · <button className="g-link g-mono" onClick={() => select({ kind: 'commit', sha: pr.mergeCommitSha! })}>{shortSha(pr.mergeCommitSha)}</button></> : null}</Field>}
        <Field label="部署 / 本機 Worktree">Not checked · MERGED ≠ DEPLOYED · OPEN ≠ 正在開發</Field>
        <Field label="Last checked">{formatSgt(data.fetchedAt)}{d ? ` · 詳細資料 ${formatSgt(d.fetchedAt)}` : ''}</Field>
        <Field label="Data completeness">{data.status === 'complete' ? 'Complete（清單與比較皆完整）' : 'Partial history'}</Field>
      </dl>
      <a className="p-primary g-open" href={pr.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />在 GitHub 開啟 PR #{pr.number}</a>
    </aside>;
  }
  const sha = selection.kind === 'commit' ? selection.sha : '';
  const commit = index.get(sha);
  const assoc = commitAssociations(sha, data, new Set(data.defaultBranchShas));
  return <aside className="g-detail" aria-label="Commit 詳細資訊">
    <div className="g-detail-head"><p className="p-eyebrow"><GitMerge size={13} /> COMMIT</p><button aria-label="關閉詳細資訊" onClick={close}><X size={16} /></button></div>
    <h2 className="g-mono">{shortSha(sha)}</h2>
    {commit ? <dl className="g-fields">
      <Field label="Full SHA"><span className="g-mono">{sha}</span></Field>
      <Field label="Message">{commit.message}</Field>
      <Field label="Author date">{formatSgt(commit.authorDate)}</Field>
      <Field label="Commit date">{formatSgt(commit.committerDate)}</Field>
      <Field label="Parent SHAs">{commit.parents.length ? commit.parents.map((p) => <button key={p} className="g-link g-mono" onClick={() => select({ kind: 'commit', sha: p })}>{shortSha(p)}{index.has(p) ? '' : '（未取得）'}</button>) : 'Root commit（無 parent）'}</Field>
      <Field label="Associated PR">{[...assoc.mergeOf.map((p) => ({ p, why: 'merge commit' })), ...assoc.headOf.map((p) => ({ p, why: 'PR head' }))].map(({ p, why }) => <button key={`${why}-${p.number}`} className="g-link" onClick={() => select({ kind: 'pr', number: p.number })}>#{p.number}（{why}）</button>)}{!assoc.mergeOf.length && !assoc.headOf.length ? 'Not verifiable（無 PR 以此為 head 或 merge commit）' : null}</Field>
      <Field label="Branch context">{assoc.branchHeads.length ? `目前為 ${assoc.branchHeads.join(', ')} 的 head` : '不是任何遠端分支目前的 head'} · {assoc.onDefaultBranch ? `在已取得的 ${data.defaultBranch} 歷史中` : `不在已取得的 ${data.defaultBranch} 歷史中`}</Field>
    </dl> : <p className="g-banner is-warn">Not available：此 commit 不在已取得的歷史中。</p>}
    {commit?.url && <a className="p-primary g-open" href={commit.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />在 GitHub 開啟 commit</a>}
  </aside>;
}

const MILESTONES = [13, 23, 33, 34, 35, 40, 47, 48];
function BottomCards({ data, select }: { data: DevelopmentHistory; select: (s: Selection) => void }) {
  const open = data.pulls.filter((p) => p.state === 'open');
  const roots = open.filter((p) => !stackParent(p, data.pulls)).sort((a, b) => (a.baseRef ?? '').localeCompare(b.baseRef ?? '') || a.number - b.number);
  const renderTree = (pr: HistoryPull, depth: number): ReactNode => <li key={pr.number} style={{ paddingLeft: depth * 14 }}>
    <button className="g-link" onClick={() => select({ kind: 'pr', number: pr.number })}>#{pr.number}</button> <span className={`g-chip is-${pr.status}`}>{STATUS_LABEL[pr.status]}</span> {pr.title}
    {depth === 0 && <small className="g-mono"> ← base {pr.baseRef}</small>}
    {stackChildren(pr, data.pulls).length > 0 && <ul>{stackChildren(pr, data.pulls).map((c) => renderTree(c, depth + 1))}</ul>}
  </li>;
  const merges = data.pulls.filter((p) => p.mergedAt).sort((a, b) => Date.parse(b.mergedAt!) - Date.parse(a.mergedAt!)).slice(0, 6);
  const index = indexCommits(data.commits);
  const unknownHeads = data.branches.filter((b) => !b.headSha || !index.has(b.headSha));
  return <section className="g-cards" aria-label="資訊卡">
    <article><h3><GitBranch size={15} />OPEN PR 堆疊（{open.length}）</h3><p className="g-muted">依 PR 回報的 base/head 分組；OPEN ≠ 正在開發，CI／review 需點選 PR 才查詢。</p><ul className="g-tree">{roots.map((r) => renderTree(r, 0))}</ul></article>
    <article><h3><GitMerge size={15} />最近合併</h3><ul className="g-plain">{merges.map((p) => <li key={p.number}><button className="g-link" onClick={() => select({ kind: 'pr', number: p.number })}>#{p.number}</button> → {p.baseRef} · {formatSgt(p.mergedAt)}</li>)}</ul>
      <h3 className="g-sub">指定里程碑 PR（日期取自 GitHub）</h3><ul className="g-plain">{MILESTONES.map((n) => { const p = data.pulls.find((x) => x.number === n); return <li key={n}>{p ? <><button className="g-link" onClick={() => select({ kind: 'pr', number: n })}>#{n}</button> {STATUS_LABEL[p.status]} · {p.mergedAt ? `合併 ${formatSgt(p.mergedAt, false)}` : `建立 ${formatSgt(p.createdAt, false)}`}</> : `#${n} · Not available`}</li>; })}</ul></article>
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
