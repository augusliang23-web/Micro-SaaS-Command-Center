import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FolderCog, LayoutGrid, Network, ShieldCheck } from 'lucide-react';
import { isUsableSavedState } from '../savedState.mjs';
import { isRealProject } from '../verdict.mjs';
import { GitDevelopmentMap, type RailEntry } from '../prototype/GitDevelopmentMap';
import { githubAuthorizationsFor, identityKey, liveRepositoryFor } from '../prototype/gitHistoryModel';
import type { LiveIdentity } from '../prototype/gitHistoryTypes';
import { ManageProjects } from './ManageProjects';
import '../prototype/prototype.css';
import './readOnly.css';

/**
 * Command Center V1.2 candidate entry: the project overview, the live GitHub Development Map and "管理專案".
 *
 * Frontend boundary: the overview and the Development Map only issue GET requests (`/api/state`, then the Development Map's
 * `/api/github/development-history[/pull]`). The ONLY write is ManageProjects' POST /api/projects/commands, sent from the
 * "管理專案" page after an explicit user action. The legacy `App` (saved-state PUT, tasks, AI bridge) is never mounted.
 * Archived projects are hidden from the overview and the Development Map; removed projects are not in `projects` at all.
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
type Lifecycle = 'active' | 'archived';
/** Set only for projects created by "管理專案": their legacy status fields are placeholders, never evidence. */
type ManagedCreation = { createdAt: string } | null;
type Revocation = 'disconnected' | 'archived' | 'removed' | null;
type Registered = { identity: LiveIdentity; saved: SavedProject; kind: IdentityKind; lifecycle: Lifecycle; created: ManagedCreation; localOnly: boolean; revoked: Revocation };
type SavedLoad =
  | { status: 'loading' }
  | { status: 'ready'; projects: Registered[]; readAt: string }
  | { status: 'empty'; readAt: string }
  | { status: 'unavailable'; reason: string };
type Page = 'overview' | 'manage' | 'map';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** V1.2 lifecycle: archived only when management.lifecycle is exactly 'archived'; a project without management is active. */
export function lifecycleOf(p: Record<string, unknown>): Lifecycle {
  return record(p.management) && p.management.lifecycle === 'archived' ? 'archived' : 'active';
}
/** A project added by "管理專案" carries management.createdAt and an 'added' first event. */
export function managedCreationOf(p: Record<string, unknown>): ManagedCreation {
  const m = p.management;
  if (!record(m) || typeof m.createdAt !== 'string' || !Array.isArray(m.events) || !record(m.events[0]) || m.events[0].type !== 'added') return null;
  return { createdAt: m.createdAt };
}
/**
 * Added by 管理專案 with no provenance marker and no repository yet: the owner's own local record, not an unverifiable one.
 * Presentation only: its identity source stays non-REGISTERED, so it can never reach the live GitHub viewer.
 */
export function isLocalOnly(p: Record<string, unknown>): boolean {
  return managedCreationOf(p) !== null && (p.dataMode === undefined || p.dataMode === null) && !text(p.repository).trim();
}
export const LOCAL_TEXT = 'LOCAL · 由管理專案新增，尚未設定 repository（Not connected）';
/** Why a saved connection is no longer active (it is never silently restored). */
export function revocationOf(p: Record<string, unknown>): Revocation {
  const m = p.management;
  if (!record(m) || !record(m.githubConnection) || m.githubConnection.status !== 'disconnected') return null;
  const reason = m.githubConnection.revokedReason;
  return reason === 'disconnected' || reason === 'archived' || reason === 'removed' ? reason : null;
}
const REVOKED_TEXT: Record<Exclude<Revocation, null>, string> = {
  disconnected: 'Not connected · 已中斷 GitHub 連線（需在「管理專案」重新連線）',
  archived: 'Not connected · 封存時已撤銷 GitHub 連線（還原後需重新連線）',
  removed: 'Not connected · 移除時已撤銷 GitHub 連線（救回後需重新連線）',
};

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
export function registeredFromSavedState(saved: { projects: Array<Record<string, unknown>>; projectManagement?: unknown }): Registered[] {
  // V1.2C: GitHub eligibility mirrors the server registry (connection record or the strict legacy PM rule); the server enforces it.
  const area = record(saved.projectManagement) && Array.isArray(saved.projectManagement.removed) ? saved.projectManagement.removed : [];
  const removed = area.filter(record).map((e) => e.project).filter(record);
  const authorizations = githubAuthorizationsFor(saved.projects, removed);
  const counts = new Map<string, number>();
  for (const p of saved.projects) { const id = text(p.id).trim(); if (id) counts.set(id, (counts.get(id) ?? 0) + 1); }
  return saved.projects.map((p, index) => {
    const id = text(p.id).trim();
    const stable = id && counts.get(id) === 1 ? id : undefined;
    const repository = text(p.repository).trim() || undefined;
    const kind = identityKindOf(p);
    return {
      kind,
      lifecycle: lifecycleOf(p),
      created: managedCreationOf(p),
      localOnly: isLocalOnly(p),
      revoked: revocationOf(p),
      // Only a `registered` project may carry the REGISTERED source; liveRepositoryFor also requires an authorization.
      identity: {
        source: kind === 'registered' ? 'REGISTERED' : 'DEMO', projectId: stable, repository, displayName: text(p.name) || 'Unnamed project',
        authorization: kind === 'registered' ? authorizations[index] : null, // always projected: never the no-projection fallback
      },
      saved: {
        id, name: text(p.name), repository: text(p.repository), stage: text(p.stage), health: text(p.health),
        currentTask: text(p.currentTask), currentGateLabel: text(p.currentGateLabel),
        blocker: typeof p.blocker === 'string' ? p.blocker : null, lastActivity: typeof p.lastActivity === 'string' ? p.lastActivity : null,
      },
    };
  });
}

function useSavedProjects(reloadKey: number): SavedLoad {
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
  }, [reloadKey]);
  return state;
}

/** Eligible to QUERY GitHub (allowlisted registered identity). This is not evidence that a query has succeeded. */
const canQuery = (identity: LiveIdentity) => liveRepositoryFor(identity) !== null;
const QUERYABLE_TAG = 'GitHub 可查詢 · 尚未驗證';
const tagFor = (entry: Registered) => (canQuery(entry.identity) ? QUERYABLE_TAG : entry.localOnly ? 'NOT CONNECTED' : entry.kind === 'demo' ? 'DEMO · NOT CONNECTED' : entry.kind === 'unverified' ? 'NOT CONNECTED · 身分無法確認' : 'NOT CONNECTED');
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
      <div><dt>Source</dt><dd>{entry.localOnly ? LOCAL_TEXT : SOURCE_TEXT[entry.kind]}</dd></div>
      <div><dt>Project ID</dt><dd>{identity.projectId ?? 'Not available（缺少或重複，不以名稱推測）'}</dd></div>
      <div><dt>Repository</dt><dd>{saved.repository.trim() ? saved.repository : 'Not available'}</dd></div>
      {entry.created
        ? <div><dt>已儲存狀態</dt><dd>{saved.stage || 'Not available'} · 健康狀態 UNKNOWN · Not checked（{entry.created.createdAt} 由管理專案新增；尚未記錄任何檢查）</dd></div>
        : <div><dt>已儲存狀態</dt><dd>{[saved.stage, saved.health].filter(Boolean).join(' · ') || 'Not available'}（已儲存，未獨立驗證）</dd></div>}
      <div><dt>已儲存任務</dt><dd>{saved.currentTask || 'Not available'}{saved.currentGateLabel ? ` · ${saved.currentGateLabel}` : ''}</dd></div>
      <div><dt>已儲存 blocker</dt><dd>{saved.blocker ? `${saved.blocker}（已儲存，未獨立驗證）` : '未記錄（不代表目前沒有 blocker）'}</dd></div>
      <div><dt>已儲存最近活動</dt><dd>{saved.lastActivity ?? 'Not available'}</dd></div>
      <div><dt>GitHub 資料</dt><dd>{live
        ? `${identity.authorization?.source === 'legacy-pm-dashboard-compat' ? 'Connected（V1.1 相容：PM Dashboard）' : 'Connected（已核准連線）'} · Not checked · 開啟開發地圖後才會讀取，並顯示 Last checked`
        : entry.revoked ? REVOKED_TEXT[entry.revoked] : 'Not connected · 此專案沒有唯讀 GitHub 歷史來源'}</dd></div>
    </dl>
    {live
      ? <button type="button" className="p-primary" onClick={open}><Network size={14} />開啟開發地圖</button>
      : <p className="v1-muted">Not connected：不顯示分支、PR 或 commit 歷史。</p>}
  </article>;
}

export function ReadOnlyCommandCenter() {
  const [reloadKey, setReloadKey] = useState(0);
  const load = useSavedProjects(reloadKey);
  const [page, setPage] = useState<Page>('overview');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const all = load.status === 'ready' ? load.projects : [];
  // Archived projects stay in saved state (and in "管理專案") but leave the overview and the Development Map.
  const projects = useMemo(() => all.filter((p) => p.lifecycle === 'active'), [all]);
  const archivedCount = all.length - projects.length;
  const describe = (p: Record<string, unknown>) => (isLocalOnly(p) ? LOCAL_TEXT : SOURCE_TEXT[identityKindOf(p)]);
  const rail: RailEntry[] = useMemo(() => projects.map((p) => ({ identity: p.identity, label: p.identity.displayName, tag: tagFor(p) })), [projects]);
  const selected = projects.find((p) => identityKey(p.identity) === selectedKey)?.identity ?? projects.find((p) => canQuery(p.identity))?.identity ?? projects[0]?.identity ?? null;
  const openMap = (identity?: LiveIdentity) => { if (identity) setSelectedKey(identityKey(identity)); setPage('map'); };

  return <div className="v1-shell">
    <header className="v1-header">
      <div className="v1-brand"><ShieldCheck size={18} /><div><strong>COMMAND CENTER</strong><small>V1.2 候選 · 本機專案管理</small></div></div>
      <nav aria-label="主要頁面">
        <button type="button" aria-current={page === 'overview' ? 'page' : undefined} onClick={() => setPage('overview')}><LayoutGrid size={15} />專案總覽</button>
        <button type="button" aria-current={page === 'manage' ? 'page' : undefined} onClick={() => setPage('manage')}><FolderCog size={15} />管理專案</button>
        <button type="button" aria-current={page === 'map' ? 'page' : undefined} onClick={() => openMap()}><Network size={15} />開發地圖</button>
      </nav>
    </header>
    {page === 'manage'
      ? <div className="v1-bar"><strong>LOCAL WRITE</strong> 管理專案只會在你確認後修改本機 saved state（新增、編輯、封存、還原、移除、救回）。不寫入 GitHub、不建立任務、不執行 agent、不呼叫 AI 供應商。</div>
      : <div className="v1-bar"><strong>READ-ONLY</strong> 本畫面只讀取資料：不編輯、不建立任務、不推進 gate、不執行 agent、不呼叫 AI 供應商。專案的新增與修改只在「管理專案」頁面進行。</div>}
    {page === 'manage'
      ? <ManageProjects identityLabel={describe} onChanged={() => setReloadKey((k) => k + 1)} />
      : page === 'overview'
      ? <main className="v1-main">
          <div className="v1-title"><p className="p-eyebrow">PROJECT OVERVIEW</p><h1>已登記專案</h1>
            <p className="v1-muted">專案資料來自本機 saved state，不等同 GitHub 即時事實；只有通過允許清單的專案可開啟 GitHub 開發地圖。{load.status === 'ready' && <> 讀取時間（瀏覽器時鐘）：{load.readAt}</>}</p></div>
          {load.status === 'ready' && projects.length === 0 && archivedCount > 0
            ? <p className="v1-banner" role="status">目前沒有使用中的專案（全部已封存）。</p>
            : load.status !== 'ready' || projects.length === 0
            ? <Unavailable load={load.status === 'ready' ? { status: 'empty', readAt: load.readAt } : load} />
            : <div className="v1-grid">{projects.map((p, i) => <ProjectCard key={`${p.identity.projectId ?? 'no-id'}-${i}`} entry={p} open={() => openMap(p.identity)} />)}</div>}
          {archivedCount > 0 && <p className="v1-muted v1m-archived-note">另有 {archivedCount} 個已封存專案，不在總覽與開發地圖中顯示；可在「管理專案」的「已封存」查看或還原。</p>}
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
