import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LayoutGrid, Network, ShieldCheck } from 'lucide-react';
import { isUsableSavedState } from '../savedState.mjs';
import { isRealProject } from '../verdict.mjs';
import { GitDevelopmentMap, type RailEntry } from '../prototype/GitDevelopmentMap';
import { identityKey, liveRepositoryFor } from '../prototype/gitHistoryModel';
import type { LiveIdentity } from '../prototype/gitHistoryTypes';
import '../prototype/prototype.css';
import './readOnly.css';

/**
 * Command Center V1 runtime entry: a read-only project overview and the live GitHub Development Map.
 *
 * Frontend boundary: this tree only ever issues GET requests (`/api/state` once on mount, then the Development Map's
 * `/api/github/development-history[/pull]`). It never mounts the legacy `App`, so the legacy saved-state PUT effect and the
 * task-creation and AI-bridge callers are not reachable from here. The backend routes themselves are unchanged.
 */

type SavedProject = {
  id: string; name: string; repository: string; stage: string; health: string;
  currentTask: string; currentGateLabel: string; blocker: string | null; lastActivity: string | null;
};
/**
 * How a saved project's identity was established. Only `registered` may use the live viewer.
 * - demo: explicit `dataMode: 'demo'` marker (the repository's existing isRealProject contract).
 * - unverified: any other `dataMode` value, or a repository that is not `owner/name`; fail closed.
 */
type IdentityKind = 'registered' | 'demo' | 'unverified';
type Registered = { identity: LiveIdentity; saved: SavedProject; kind: IdentityKind };
type SavedLoad =
  | { status: 'loading' }
  | { status: 'ready'; projects: Registered[]; readAt: string }
  | { status: 'empty'; readAt: string }
  | { status: 'unavailable'; reason: string };
type Page = 'overview' | 'map';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Saved state has no authoritative "registered" marker. Following the existing isRealProject contract, an ABSENT `dataMode`
 * means a legacy registered project and `'demo'` is the explicit DEMO marker. Fixture provenance is NOT a signal: migrated
 * and newly connected real projects carry fixture provenance too. Any other `dataMode` is unknown, so it fails closed.
 */
export function identityKindOf(p: Record<string, unknown>): IdentityKind {
  const mode = p.dataMode;
  if (mode === undefined || mode === null) return isRealProject(p) ? 'registered' : 'unverified';
  if (typeof mode === 'string' && mode.trim().toLowerCase() === 'demo') return 'demo';
  return 'unverified';
}

/**
 * Registered identities come only from validated saved state. A blank or duplicated project id yields NO stable id, which keeps
 * the project out of the live viewer (liveRepositoryFor requires one); a name or repository is never used to guess identity.
 */
export function registeredFromSavedState(saved: { projects: Array<Record<string, unknown>> }): Registered[] {
  const counts = new Map<string, number>();
  for (const p of saved.projects) { const id = text(p.id).trim(); if (id) counts.set(id, (counts.get(id) ?? 0) + 1); }
  return saved.projects.map((p) => {
    const id = text(p.id).trim();
    const stable = id && counts.get(id) === 1 ? id : undefined;
    const repository = text(p.repository).trim() || undefined;
    const kind = identityKindOf(p);
    return {
      kind,
      // Only a `registered` project may carry the REGISTERED source; liveRepositoryFor refuses everything else.
      identity: { source: kind === 'registered' ? 'REGISTERED' : 'DEMO', projectId: stable, repository, displayName: text(p.name) || 'Unnamed project' },
      saved: {
        id, name: text(p.name), repository: text(p.repository), stage: text(p.stage), health: text(p.health),
        currentTask: text(p.currentTask), currentGateLabel: text(p.currentGateLabel),
        blocker: typeof p.blocker === 'string' ? p.blocker : null, lastActivity: typeof p.lastActivity === 'string' ? p.lastActivity : null,
      },
    };
  });
}

function useSavedProjects(): SavedLoad {
  const [state, setState] = useState<SavedLoad>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/state', { method: 'GET', signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        const readAt = new Date().toISOString();
        if (res.status === 404 && body?.error === 'No saved state yet.') { setState({ status: 'empty', readAt }); return; }
        if (!res.ok) { setState({ status: 'unavailable', reason: `HTTP ${res.status}` }); return; }
        if (!isUsableSavedState(body)) { setState({ status: 'unavailable', reason: '已儲存的專案資料格式無效' }); return; }
        setState({ status: 'ready', projects: registeredFromSavedState(body), readAt });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'unavailable', reason: '無法連線到本機 Command Center 伺服器' }); });
    return () => controller.abort();
  }, []);
  return state;
}

/** Eligible to QUERY GitHub (allowlisted registered identity). This is not evidence that a query has succeeded. */
const canQuery = (identity: LiveIdentity) => liveRepositoryFor(identity) !== null;
const QUERYABLE_TAG = 'GitHub 可查詢 · 尚未驗證';
const tagFor = (entry: Registered) => (canQuery(entry.identity) ? QUERYABLE_TAG : entry.kind === 'demo' ? 'DEMO · NOT CONNECTED' : entry.kind === 'unverified' ? 'NOT CONNECTED · 身分無法確認' : 'NOT CONNECTED');
const SOURCE_TEXT: Record<IdentityKind, string> = {
  registered: 'REGISTERED · 本機 saved state（GET /api/state）',
  demo: 'DEMO · 本機 saved state（dataMode: demo），不可連線 GitHub',
  unverified: '身分無法確認（dataMode 或 repository 不符合已登記專案契約），已封閉',
};

function Unavailable({ load }: { load: SavedLoad }) {
  if (load.status === 'loading') return <p className="v1-banner" role="status">正在讀取已登記專案（GET /api/state）…</p>;
  if (load.status === 'empty') return <p className="v1-banner is-warn" role="status"><AlertTriangle size={15} />Not available：本機尚無已登記專案資料。不會以範例資料代替。</p>;
  return <p className="v1-banner is-warn" role="alert"><AlertTriangle size={15} />Not available：{load.status === 'unavailable' ? load.reason : ''}。不會以範例資料代替。</p>;
}

function ProjectCard({ entry, open }: { entry: Registered; open: () => void }) {
  const { identity, saved } = entry;
  const live = canQuery(identity);
  return <article className="v1-card" aria-label={`專案 ${identity.displayName}`}>
    <header>
      <h3>{identity.displayName}</h3>
      <span className={`v1-badge ${live ? 'is-live' : ''}`}>{tagFor(entry)}</span>
    </header>
    <dl>
      <div><dt>Source</dt><dd>{SOURCE_TEXT[entry.kind]}</dd></div>
      <div><dt>Project ID</dt><dd>{identity.projectId ?? 'Not available（缺少或重複，不以名稱推測）'}</dd></div>
      <div><dt>Repository</dt><dd>{saved.repository.trim() ? saved.repository : 'Not available'}</dd></div>
      <div><dt>已儲存狀態</dt><dd>{[saved.stage, saved.health].filter(Boolean).join(' · ') || 'Not available'}（已儲存，未獨立驗證）</dd></div>
      <div><dt>已儲存任務</dt><dd>{saved.currentTask || 'Not available'}{saved.currentGateLabel ? ` · ${saved.currentGateLabel}` : ''}</dd></div>
      <div><dt>已儲存 blocker</dt><dd>{saved.blocker ? `${saved.blocker}（已儲存，未獨立驗證）` : '未記錄（不代表目前沒有 blocker）'}</dd></div>
      <div><dt>已儲存最近活動</dt><dd>{saved.lastActivity ?? 'Not available'}</dd></div>
      <div><dt>GitHub 資料</dt><dd>{live ? 'Not checked · 開啟開發地圖後才會讀取，並顯示 Last checked' : 'Not connected · 此專案沒有唯讀 GitHub 歷史來源'}</dd></div>
    </dl>
    {live
      ? <button type="button" className="p-primary" onClick={open}><Network size={14} />開啟開發地圖</button>
      : <p className="v1-muted">Not connected：不顯示分支、PR 或 commit 歷史。</p>}
  </article>;
}

export function ReadOnlyCommandCenter() {
  const load = useSavedProjects();
  const [page, setPage] = useState<Page>('overview');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const projects = load.status === 'ready' ? load.projects : [];
  const rail: RailEntry[] = useMemo(() => projects.map((p) => ({ identity: p.identity, label: p.identity.displayName, tag: tagFor(p) })), [projects]);
  const selected = projects.find((p) => identityKey(p.identity) === selectedKey)?.identity ?? projects.find((p) => canQuery(p.identity))?.identity ?? projects[0]?.identity ?? null;
  const openMap = (identity?: LiveIdentity) => { if (identity) setSelectedKey(identityKey(identity)); setPage('map'); };

  return <div className="v1-shell">
    <header className="v1-header">
      <div className="v1-brand"><ShieldCheck size={18} /><div><strong>COMMAND CENTER</strong><small>V1 · 唯讀開發進度</small></div></div>
      <nav aria-label="主要頁面">
        <button type="button" aria-current={page === 'overview' ? 'page' : undefined} onClick={() => setPage('overview')}><LayoutGrid size={15} />專案總覽</button>
        <button type="button" aria-current={page === 'map' ? 'page' : undefined} onClick={() => openMap()}><Network size={15} />開發地圖</button>
      </nav>
    </header>
    <div className="v1-bar"><strong>READ-ONLY</strong> 本畫面只讀取資料：不編輯、不建立任務、不推進 gate、不執行 agent、不呼叫 AI 供應商。後端舊有的寫入路由仍存在，但此畫面不會使用它們。</div>
    {page === 'overview'
      ? <main className="v1-main">
          <div className="v1-title"><p className="p-eyebrow">PROJECT OVERVIEW</p><h1>已登記專案</h1>
            <p className="v1-muted">專案資料來自本機 saved state，不等同 GitHub 即時事實；只有通過允許清單的專案可開啟 GitHub 開發地圖。{load.status === 'ready' && <> 讀取時間（瀏覽器時鐘）：{load.readAt}</>}</p></div>
          {load.status !== 'ready' || projects.length === 0
            ? <Unavailable load={load.status === 'ready' ? { status: 'empty', readAt: load.readAt } : load} />
            : <div className="v1-grid">{projects.map((p, i) => <ProjectCard key={`${p.identity.projectId ?? 'no-id'}-${i}`} entry={p} open={() => openMap(p.identity)} />)}</div>}
        </main>
      : <>
          <div className="p-live-bar"><span><strong>GitHub 唯讀</strong> 只有成功讀取後才會顯示來源與 Last checked；沒有 AI 對話、Prompt 或 agent 執行。</span></div>
          {selected
            ? <main className="p-main g-main"><GitDevelopmentMap identity={selected} rail={rail} selectIdentity={(identity) => setSelectedKey(identityKey(identity))} /></main>
            : <main className="v1-main"><Unavailable load={load} /></main>}
        </>}
    <footer className="v1-footer"><span>GitHub 遠端分支 ≠ 本機 worktree ≠ 部署環境。</span><span>REAL_AGENT_EXECUTION = NOT_AUTHORIZED</span></footer>
  </div>;
}

export default ReadOnlyCommandCenter;
