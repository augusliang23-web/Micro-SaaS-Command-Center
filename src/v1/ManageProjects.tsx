import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Archive, ArchiveRestore, Github, Pencil, Plus, RotateCcw, Trash2, Unlink } from 'lucide-react';
import { isUsableSavedState } from '../savedState.mjs';

/**
 * V1.2 candidate "管理專案" page. Reads GET /api/projects (versioned) and sends exactly one kind of write: POST
 * /api/projects/commands with the version it last read. It never retries a refused command, never invents projects when saved
 * state is missing or invalid, and never makes a GitHub request itself. V1.2C: Connect / Change send a command; the SERVER then
 * performs one read-only GitHub metadata check before saving. The connection status shown here is the server's own projection.
 */

type Project = Record<string, unknown> & { id: string; name: string; repository: string; stage: string; tagline: string; tags: string[] };
type RemovedEntry = { project: Project; removedAt: string; previousLifecycle: string | null };
export type ServerAuthorization = { projectId: string; repository: string; source: string; generation: number };
type Load =
  | { status: 'loading' }
  | { status: 'ready'; version: string; projects: Project[]; removed: RemovedEntry[]; authorizations: ServerAuthorization[] }
  | { status: 'empty' }
  | { status: 'unavailable'; reason: string };
type Tab = 'active' | 'archived' | 'removed';
type Notice = { kind: 'ok' | 'error'; text: string } | null;
type Command =
  | { type: 'add'; input: Record<string, unknown> }
  | { type: 'edit'; id: string; patch: Record<string, unknown> }
  | { type: 'archive' | 'restore' | 'recover'; id: string }
  | { type: 'remove'; id: string; confirmProjectId: string }
  | { type: 'connect'; id: string; repository: string }
  | { type: 'disconnect'; id: string }
  | { type: 'change'; id: string; repository: string; confirmPreviousRepository: string };

export const STAGES = ['Prototype', 'Alpha', 'Beta', 'Production'] as const;
export const COMMAND_URL = '/api/projects/commands';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const lifecycleOf = (p: Record<string, unknown>) => (isRecord(p.management) && p.management.lifecycle === 'archived' ? 'archived' : 'active');
const parseTags = (text: string) => text.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
const usableProjects = (list: unknown) => isUsableSavedState({ projects: list, attentionItems: [], nba: {}, snapshot: {} });

/** Validates the GET /api/projects body with the same saved-project contract V1 uses. Anything else is unavailable. */
export function parseProjectsResponse(body: unknown): Load {
  if (!isRecord(body) || typeof body.version !== 'string' || !Array.isArray(body.projects) || !Array.isArray(body.removed)) {
    return { status: 'unavailable', reason: '專案資料格式無效' };
  }
  const removed = body.removed as unknown[];
  if (!usableProjects(body.projects) || !removed.every((e) => isRecord(e) && typeof e.removedAt === 'string') || !usableProjects(removed.map((e) => (e as RemovedEntry).project))) {
    return { status: 'unavailable', reason: '專案資料格式無效' };
  }
  const auth = body.githubAuthorizations ?? [];
  const validAuth = Array.isArray(auth) && auth.every((a) => isRecord(a) && typeof a.projectId === 'string' && typeof a.repository === 'string' && typeof a.source === 'string' && Number.isInteger(a.generation));
  if (!validAuth) return { status: 'unavailable', reason: '專案資料格式無效' };
  return { status: 'ready', version: body.version, projects: body.projects as Project[], removed: removed as RemovedEntry[], authorizations: auth as ServerAuthorization[] };
}

const MESSAGES: Record<string, string> = {
  CONFLICT: '資料在你讀取之後已被變更（例如另一個分頁）。已重新載入最新資料，請確認後再操作一次。',
  DUPLICATE_REPOSITORY: '另一個專案已經使用這個 repository。資料沒有變更。',
  ILLEGAL_TRANSITION: '這個專案目前的狀態不能執行此操作。已重新載入最新資料。',
  NOT_FOUND: '找不到這個專案（可能已被變更）。已重新載入最新資料。',
  AMBIGUOUS_ID: '有多個專案使用相同的 ID，為安全起見不執行。資料沒有變更。',
  ID_COLLISION: '專案 ID 衝突，資料沒有變更。請再試一次。',
  LIMIT_EXCEEDED: '已達專案數量或資料大小上限。資料沒有變更。',
  LOCKED: '另一個寫入正在進行（或上次寫入未正常結束而留下鎖定）。資料沒有變更，請稍後再試。',
  ORIGIN_REQUIRED: '請求被安全檢查拒絕（來源不符）。資料沒有變更。',
  UNSUPPORTED_MEDIA_TYPE: '請求格式不被接受。資料沒有變更。',
  PAYLOAD_TOO_LARGE: '內容太長，請縮短後再試。資料沒有變更。',
  WRITE_FAILED: '存檔失敗，原本的資料沒有變更。',
  BACKUP_FAILED: '無法先建立備份，所以沒有存檔。原本的資料沒有變更。',
  DURABILITY_UNCONFIRMED: '變更已寫入，但無法確認磁碟同步完成。已重新載入，請確認結果。',
  CORRUPT_STATE: '已儲存的資料無法安全讀取，沒有做任何變更。不會用範例資料代替。',
  INVALID_STATE: '已儲存的資料格式不符合規則，沒有做任何變更。不會用範例資料代替。',
  UNSAFE_TARGET: '存檔位置未通過安全檢查，沒有做任何變更。',
  NO_STATE: '本機尚無已儲存的專案資料，無法管理專案。',
  GITHUB_VERIFICATION_FAILED: '無法在 GitHub 驗證這個 repository（可能不存在、這個帳號沒有讀取權限、gh 未登入、速率限制或逾時）。沒有連線，資料沒有變更。',
  ALREADY_CONNECTED: '這個專案已經連線。請先中斷，或使用「更換 repository」。資料沒有變更。',
  NOT_CONNECTED: '這個專案目前沒有連線。資料沒有變更。',
  REPOSITORY_MISMATCH: 'Repository 與專案記錄或 GitHub 回報的名稱不一致（可能已改名或轉移）。沒有連線，資料沒有變更。',
  UNTRUSTED_IDENTITY: '只有已登記專案可以連線 GitHub（DEMO 或身分無法確認的紀錄不行）。資料沒有變更。',
};
const INPUT_CODES = new Set(['INVALID_INPUT', 'INVALID_ID', 'FIELD_NOT_EDITABLE', 'INVALID_COMMAND', 'INVALID_REQUEST']);
const RELOAD_CODES = new Set(['CONFLICT', 'ILLEGAL_TRANSITION', 'NOT_FOUND', 'DURABILITY_UNCONFIRMED']);
const SUCCESS: Record<Command['type'], string> = {
  add: '已新增專案並儲存。', edit: '已儲存變更。', archive: '已封存專案（紀錄與 ID 都保留）。', restore: '已還原專案。',
  remove: '已移除專案（只影響本機資料，可在「已移除」救回）。', recover: '已救回專案。',
  connect: '已連線 GitHub（伺服器已驗證此 repository；開發地圖讀取時才會查詢歷史）。',
  disconnect: '已中斷 GitHub 連線。這個專案不會再讀取 GitHub 歷史。',
  change: '已更換 repository。舊 repository 的讀取權限已撤銷，新的 repository 已由伺服器驗證。',
};
const REVOKED: Record<string, string> = { disconnected: '已中斷', archived: '封存時已撤銷', removed: '移除時已撤銷' };

export function ManageProjects({ onChanged, identityLabel }: { onChanged: () => void; identityLabel: (p: Record<string, unknown>) => string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [tab, setTab] = useState<Tab>('active');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Project | null>(null);
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<{ id: string; mode: 'connect' | 'change' } | null>(null);
  const [disconnecting, setDisconnecting] = useState<Project | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/projects', { method: 'GET' });
      const body = await res.json().catch(() => null);
      if (res.status === 404 && isRecord(body) && body.code === 'NO_STATE') { setLoad({ status: 'empty' }); return; }
      if (!res.ok) { setLoad({ status: 'unavailable', reason: isRecord(body) && typeof body.code === 'string' && MESSAGES[body.code] ? MESSAGES[body.code] : `HTTP ${res.status}` }); return; }
      setLoad(parseProjectsResponse(body));
    } catch {
      setLoad({ status: 'unavailable', reason: '無法連線到本機 Command Center 伺服器' });
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  /** Sends ONE command with the last-read version. A refusal is shown as-is; nothing is retried automatically. */
  async function send(command: Command): Promise<boolean> {
    if (busy || load.status !== 'ready') return false;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(COMMAND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: load.version, command }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && isRecord(body) && isRecord(body.result)) {
        setNotice({ kind: 'ok', text: body.result.changed === false ? '沒有任何變更。' : SUCCESS[command.type] });
        await reload();
        onChanged();
        return true;
      }
      const code = isRecord(body) && typeof body.code === 'string' ? body.code : '';
      const detail = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      setNotice({ kind: 'error', text: INPUT_CODES.has(code) ? `輸入不符合規則，資料沒有變更：${detail}` : MESSAGES[code] ?? `操作失敗（HTTP ${res.status}），資料沒有變更。` });
      if (RELOAD_CODES.has(code)) await reload();
      return false;
    } catch {
      setNotice({ kind: 'error', text: '無法連線到本機伺服器，無法確認是否已儲存。已重新載入最新資料。' });
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const ready = load.status === 'ready' ? load : null;
  const active = ready ? ready.projects.filter((p) => lifecycleOf(p) === 'active') : [];
  const archived = ready ? ready.projects.filter((p) => lifecycleOf(p) === 'archived') : [];
  const removed = ready ? ready.removed : [];
  const authorizationOf = (p: Project) => ready?.authorizations.find((a) => a.projectId === p.id && a.repository === p.repository) ?? null;

  return <main className="v1-main" aria-busy={busy}>
    <div className="v1-title">
      <p className="p-eyebrow">MANAGE PROJECTS · V1.2 候選</p>
      <h1>管理專案</h1>
      <p className="v1-muted">只修改本機 saved state。不會建立、修改或刪除任何 GitHub repository、分支、PR、本機程式碼或雲端資源；新專案在 GitHub 連線（Phase C）前一律 Not connected。</p>
    </div>
    {notice && <p className={`v1-banner ${notice.kind === 'error' ? 'is-warn' : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'error' && <AlertTriangle size={15} />}{notice.text}</p>}
    {load.status === 'loading' && <p className="v1-banner" role="status">正在讀取專案資料（GET /api/projects）…</p>}
    {load.status === 'empty' && <p className="v1-banner is-warn" role="status"><AlertTriangle size={15} />Not available：本機尚無 saved state（data/app-state.json）。為了安全，這個版本不會自動建立檔案，也不會產生範例專案。</p>}
    {load.status === 'unavailable' && <p className="v1-banner is-warn" role="alert"><AlertTriangle size={15} />Not available：{load.reason}。不會以範例資料代替，也不會進行任何變更。</p>}
    {ready && <>
      <div className="v1m-toolbar">
        <div role="tablist" aria-label="專案狀態" className="v1m-tabs">
          {([['active', '使用中', active.length], ['archived', '已封存', archived.length], ['removed', '已移除', removed.length]] as const).map(([key, label, count]) =>
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setEditing(null); }}>{label}（{count}）</button>)}
        </div>
        <button type="button" className="p-primary" disabled={busy} onClick={() => setAdding((v) => !v)} aria-expanded={adding}><Plus size={14} />新增專案</button>
      </div>
      {adding && <ProjectForm mode="add" busy={busy} onCancel={() => setAdding(false)} onSubmit={async (input) => { if (await send({ type: 'add', input })) setAdding(false); }} />}
      <section role="tabpanel" aria-label={tab === 'active' ? '使用中專案' : tab === 'archived' ? '已封存專案' : '已移除專案'} className="v1m-list">
        {tab !== 'removed' && (tab === 'active' ? active : archived).length === 0 && <p className="v1-muted">{tab === 'active' ? '沒有使用中的專案。' : '沒有已封存的專案。'}</p>}
        {tab === 'removed' && removed.length === 0 && <p className="v1-muted">沒有已移除的專案。</p>}
        {tab !== 'removed' && (tab === 'active' ? active : archived).map((p) =>
          <ProjectRow key={p.id} project={p} label={identityLabel(p)}>
            {editing === p.id
              ? <ProjectForm mode="edit" busy={busy} project={p} onCancel={() => setEditing(null)} onSubmit={async (patch) => {
                  if (Object.keys(patch).length === 0) { setNotice({ kind: 'ok', text: '沒有任何變更。' }); setEditing(null); return; }
                  if (await send({ type: 'edit', id: p.id, patch })) setEditing(null);
                }} />
              : <div className="v1m-actions">
                  <button type="button" disabled={busy} onClick={() => setEditing(p.id)}><Pencil size={13} />編輯</button>
                  {tab === 'active'
                    ? <button type="button" disabled={busy} onClick={() => void send({ type: 'archive', id: p.id })}><Archive size={13} />封存</button>
                    : <button type="button" disabled={busy} onClick={() => void send({ type: 'restore', id: p.id })}><ArchiveRestore size={13} />還原</button>}
                  <button type="button" className="is-danger" disabled={busy} onClick={() => setRemoving(p)}><Trash2 size={13} />移除…</button>
                </div>}
            {editing !== p.id && <GithubControls project={p} archived={tab === 'archived'} authorization={authorizationOf(p)} busy={busy}
              open={connecting?.id === p.id ? connecting.mode : null}
              onOpen={(mode) => setConnecting({ id: p.id, mode })} onCancel={() => setConnecting(null)} onDisconnect={() => setDisconnecting(p)}
              onSubmit={async (command) => { if (await send(command)) setConnecting(null); }} />}
          </ProjectRow>)}
        {tab === 'removed' && removed.map((e) =>
          <ProjectRow key={e.project.id} project={e.project} label={identityLabel(e.project)} note={`移除時間：${e.removedAt}`}>
            <div className="v1m-actions"><button type="button" disabled={busy} onClick={() => void send({ type: 'recover', id: e.project.id })}><RotateCcw size={13} />救回</button></div>
          </ProjectRow>)}
      </section>
    </>}
    {disconnecting && <DisconnectDialog project={disconnecting} busy={busy} onCancel={() => setDisconnecting(null)} onConfirm={async () => {
      if (await send({ type: 'disconnect', id: disconnecting.id })) setDisconnecting(null);
    }} />}
    {removing && <RemoveDialog project={removing} busy={busy} onCancel={() => setRemoving(null)} onConfirm={async () => {
      if (await send({ type: 'remove', id: removing.id, confirmProjectId: removing.id })) setRemoving(null);
    }} />}
  </main>;
}

function ProjectRow({ project, label, note, children }: { project: Project; label: string; note?: string; children: ReactNode }) {
  const untrusted = label.startsWith('DEMO') || label.includes('身分無法確認');
  return <article className="v1m-row" aria-label={`管理 ${project.name}`}>
    <div className="v1m-row-main">
      <h3>{project.name}</h3>
      <p className="v1-muted">{[label, project.repository || (label.startsWith('LOCAL') ? '' : '未設定 repository（Not connected）'), project.stage, `ID ${project.id}`].filter(Boolean).join(' · ')}</p>
      {untrusted && <p className="v1m-warn">此紀錄不是已登記專案（{label}）。任何操作都不會讓它變成已登記專案，也不會連線 GitHub。</p>}
      {note && <p className="v1-muted">{note}</p>}
    </div>
    {children}
  </article>;
}

type FormProps =
  | { mode: 'add'; busy: boolean; onCancel: () => void; onSubmit: (input: Record<string, unknown>) => Promise<void>; project?: undefined }
  | { mode: 'edit'; busy: boolean; onCancel: () => void; onSubmit: (patch: Record<string, unknown>) => Promise<void>; project: Project };

function ProjectForm(props: FormProps) {
  const p = props.project;
  const [name, setName] = useState(p?.name ?? '');
  const [tagline, setTagline] = useState(p?.tagline ?? '');
  const [stage, setStage] = useState<string>(p?.stage ?? 'Prototype');
  const [tags, setTags] = useState((p?.tags ?? []).join(', '));
  const [repository, setRepository] = useState('');
  const prefix = props.mode === 'add' ? 'add' : `edit-${p?.id}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (props.mode === 'add') {
      const input: Record<string, unknown> = { name, tagline, stage, tags: parseTags(tags) };
      if (repository.trim()) input.repository = repository.trim();
      void props.onSubmit(input);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (name !== props.project.name) patch.name = name;
    if (tagline !== props.project.tagline) patch.tagline = tagline;
    if (stage !== props.project.stage) patch.stage = stage;
    if (JSON.stringify(parseTags(tags)) !== JSON.stringify(props.project.tags)) patch.tags = parseTags(tags);
    void props.onSubmit(patch);
  }

  return <form className="v1m-form" onSubmit={submit} aria-label={props.mode === 'add' ? '新增專案' : `編輯 ${p?.name}`}>
    <label htmlFor={`${prefix}-name`}>專案名稱（必填）</label>
    <input id={`${prefix}-name`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
    <label htmlFor={`${prefix}-tagline`}>簡介</label>
    <input id={`${prefix}-tagline`} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={500} />
    <label htmlFor={`${prefix}-stage`}>階段</label>
    <select id={`${prefix}-stage`} value={stage} onChange={(e) => setStage(e.target.value)}>
      {!STAGES.includes(stage as (typeof STAGES)[number]) && <option value={stage}>{stage}</option>}
      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
    <label htmlFor={`${prefix}-tags`}>標籤（以逗號分隔）</label>
    <input id={`${prefix}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} />
    {props.mode === 'add'
      ? <>
          <label htmlFor={`${prefix}-repo`}>GitHub repository（選填，格式 owner/repo）</label>
          <input id={`${prefix}-repo`} value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="owner/repo" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <p className="v1-muted">只記錄名稱，不會連線或讀取 GitHub。新專案顯示 Not connected，健康狀態為 UNKNOWN / Not checked。</p>
        </>
      : <p className="v1-muted">Repository：{p?.repository || '未設定'}（不能在這裡變更，需在 Phase C 以重新連線流程處理）</p>}
    <div className="v1m-actions">
      <button type="submit" className="p-primary" disabled={props.busy}>{props.busy ? '儲存中…' : props.mode === 'add' ? '新增並儲存' : '儲存變更'}</button>
      <button type="button" disabled={props.busy} onClick={props.onCancel}>取消</button>
    </div>
  </form>;
}

function RemoveDialog({ project, busy, onCancel, onConfirm }: { project: Project; busy: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return <div className="v1m-overlay">
    <div role="dialog" aria-modal="true" aria-labelledby="v1m-remove-title" className="v1m-dialog">
      <h2 id="v1m-remove-title">移除「{project.name}」？</h2>
      <p>這只會把專案從本機 saved state 的專案清單移到「已移除」，完整紀錄與 ID 會保留，之後可以救回。</p>
      <p><strong>不會</strong>刪除 GitHub repository、分支、PR、本機程式碼、雲端資源或任何帳號資料。</p>
      <p className="v1-muted">ID：{project.id} · Repository：{project.repository || '未設定'}</p>
      <label htmlFor="v1m-remove-confirm">請輸入專案名稱「{project.name}」以確認</label>
      <input id="v1m-remove-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
      <div className="v1m-actions">
        <button type="button" className="is-danger" disabled={busy || typed !== project.name} onClick={() => void onConfirm()}>{busy ? '移除中…' : '確認移除'}</button>
        <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </div>
  </div>;
}

/** V1.2C GitHub connection status and controls. Status comes from the server's projection; nothing here contacts GitHub. */
function GithubControls({ project, archived, authorization, busy, open, onOpen, onCancel, onDisconnect, onSubmit }: {
  project: Project; archived: boolean; authorization: ServerAuthorization | null; busy: boolean; open: 'connect' | 'change' | null;
  onOpen: (mode: 'connect' | 'change') => void; onCancel: () => void; onDisconnect: () => void; onSubmit: (command: Command) => Promise<void>;
}) {
  const management = isRecord(project.management) ? project.management : null;
  const saved = management && isRecord(management.githubConnection) ? management.githubConnection : null;
  const trusted = project.dataMode === undefined;
  const status = authorization
    ? `Connected · ${authorization.repository}${authorization.source === 'legacy-pm-dashboard-compat' ? '（V1.1 相容規則）' : '（已由伺服器驗證）'} · 尚未讀取歷史（開發地圖讀取時才會查詢）`
    : saved && saved.status === 'disconnected' ? `Not connected · ${REVOKED[String(saved.revokedReason)] ?? '已中斷'}（${String(saved.repository)}）`
    : 'Not connected';
  return <div className="v1m-github" aria-label={`GitHub 連線 ${project.name}`}>
    <p className="v1-muted"><Github size={12} /> GitHub：{status}</p>
    {!trusted && <p className="v1-muted">此紀錄不是已登記專案，不能連線 GitHub。</p>}
    {trusted && archived && <p className="v1-muted">已封存的專案不會讀取 GitHub；還原後需要重新連線。</p>}
    {trusted && !archived && open === null && <div className="v1m-actions">
      {authorization
        ? <>
            <button type="button" disabled={busy} onClick={onDisconnect}><Unlink size={13} />中斷 GitHub 連線…</button>
            <button type="button" disabled={busy} onClick={() => onOpen('change')}><Github size={13} />更換 repository…</button>
          </>
        : <>
            <button type="button" disabled={busy} onClick={() => onOpen('connect')}><Github size={13} />連線 GitHub…</button>
            {project.repository && <button type="button" disabled={busy} onClick={() => onOpen('change')}><Github size={13} />更換 repository…</button>}
          </>}
    </div>}
    {trusted && !archived && open !== null && <ConnectForm project={project} mode={open} busy={busy} onCancel={onCancel} onSubmit={onSubmit} />}
  </div>;
}

function ConnectForm({ project, mode, busy, onCancel, onSubmit }: { project: Project; mode: 'connect' | 'change'; busy: boolean; onCancel: () => void; onSubmit: (command: Command) => Promise<void> }) {
  const [repository, setRepository] = useState(mode === 'connect' ? project.repository : '');
  const [confirm, setConfirm] = useState('');
  const id = `gh-${mode}-${project.id}`;
  function submit(event: FormEvent) {
    event.preventDefault();
    void onSubmit(mode === 'connect'
      ? { type: 'connect', id: project.id, repository: repository.trim() }
      : { type: 'change', id: project.id, repository: repository.trim(), confirmPreviousRepository: confirm });
  }
  return <form className="v1m-form" onSubmit={submit} aria-label={mode === 'connect' ? `連線 GitHub ${project.name}` : `更換 repository ${project.name}`}>
    <label htmlFor={`${id}-repo`}>{mode === 'connect' ? 'GitHub repository（owner/repo）' : '新的 GitHub repository（owner/repo）'}</label>
    <input id={`${id}-repo`} value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="owner/repo" required autoCapitalize="off" autoCorrect="off" spellCheck={false}
      readOnly={mode === 'connect' && !!project.repository} />
    {mode === 'change' && <>
      <label htmlFor={`${id}-confirm`}>請輸入目前的 repository「{project.repository}」以確認更換</label>
      <input id={`${id}-confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
    </>}
    <p className="v1-muted">按下後，伺服器會用你現有的 gh 登入，對 GitHub 做<strong>一次唯讀查詢</strong>確認這個 repository 存在且可讀取；成功才會儲存。不會寫入 GitHub。{mode === 'change' ? ' 舊 repository 的讀取權限會在同一次儲存中撤銷，專案 ID 不變。' : ''}</p>
    <div className="v1m-actions">
      <button type="submit" className="p-primary" disabled={busy || !repository.trim() || (mode === 'change' && confirm !== project.repository)}>{busy ? '驗證中…' : mode === 'connect' ? '驗證並連線' : '驗證並更換'}</button>
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
    </div>
  </form>;
}

function DisconnectDialog({ project, busy, onCancel, onConfirm }: { project: Project; busy: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return <div className="v1m-overlay">
    <div role="dialog" aria-modal="true" aria-labelledby="v1m-disconnect-title" className="v1m-dialog">
      <h2 id="v1m-disconnect-title">中斷「{project.name}」的 GitHub 連線？</h2>
      <p>之後開發地圖不會再讀取 {project.repository} 的歷史；已快取的結果也不再提供。專案與 repository 名稱會保留，之後可以重新連線。</p>
      <p><strong>不會</strong>修改或刪除 GitHub 上的任何東西。</p>
      <div className="v1m-actions">
        <button type="button" className="is-danger" disabled={busy} onClick={() => void onConfirm()}>{busy ? '處理中…' : '確認中斷'}</button>
        <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </div>
  </div>;
}

export default ManageProjects;
