import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Clock3, ExternalLink, GitPullRequest, RefreshCw } from 'lucide-react';
import type { DevelopmentHistory, LiveIdentity } from '../prototype/gitHistoryTypes';
import { liveRepositoryFor } from '../prototype/gitHistoryModel';
import { historyFreshness, monitorSummary, MONITOR_POLL_MS, validateMonitorHistory } from './liveMonitorModel.mjs';
import './liveMonitor.css';

type MonitorState = {
  repo: string | null; history: DevelopmentHistory | null; checkedAt: string | null;
  busy: boolean; error: string | null; lastRequest: string | null;
};
const NO_SOURCE = 'NOT CONNECTED：此專案尚未通過唯讀 GitHub 允許清單。';
const date = (iso: string | null | undefined) => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '無法確認';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
};

export function LiveDevelopmentMonitor({ identity }: { identity: LiveIdentity | null }) {
  const repo = liveRepositoryFor(identity);
  const [state, setState] = useState<MonitorState>({
    repo: null, history: null, checkedAt: null, busy: false, error: null, lastRequest: null,
  });
  const [now, setNow] = useState(Date.now());
  const active = useRef<AbortController | null>(null);
  const run = useCallback(async (force = false) => {
    if (!repo || active.current || document.visibilityState === 'hidden' || !navigator.onLine) return;
    const controller = new AbortController();
    active.current = controller;
    setState(s => ({ ...s, repo, busy: true, error: null, lastRequest: new Date().toISOString() }));
    try {
      const suffix = force ? '&refresh=1' : '';
      const response = await fetch('/api/github/development-history?repo=' + encodeURIComponent(repo) + suffix,
        { method: 'GET', signal: controller.signal, cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw Error(response.status === 403 ? 'Repository not allowlisted' :
        response.status === 429 ? 'GitHub rate limit reached' : 'HTTP ' + response.status);
      if (!validateMonitorHistory(body, repo)) throw Error('GitHub snapshot unavailable or invalid');
      if (controller.signal.aborted) return;
      setState({ repo, history: body as DevelopmentHistory, checkedAt: new Date().toISOString(),
        busy: false, error: null, lastRequest: new Date().toISOString() });
    } catch (e) {
      if (controller.signal.aborted) return;
      // Retain last known snapshot for inspection but mark it unverified.
      setState(s => ({ ...s, repo, busy: false,
        error: e instanceof Error ? e.message : 'Unknown connection error',
        checkedAt: new Date().toISOString() }));
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [repo]);
  useEffect(() => {
    active.current?.abort(); active.current = null;
    setState({ repo, history: null, checkedAt: null, busy: false, error: null, lastRequest: null });
    if (!repo) return;
    void run(false);
    const tick = window.setInterval(() => void run(false), MONITOR_POLL_MS);
    const onReturn = () => { if (document.visibilityState === 'visible' && navigator.onLine) void run(false); };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('online', onReturn);
    return () => {
      active.current?.abort(); active.current = null;
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('online', onReturn);
    };
  }, [repo, run]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const view = state.repo === repo ? state : {
    repo, history: null, checkedAt: null, busy: false, error: null, lastRequest: null,
  };
  const summary = monitorSummary(view.history, now);
  const freshness = historyFreshness(view.history, now);
  const noVerifiedSource = !repo || !view.history || view.error || freshness.state === 'STALE';
  const freshnessText = !repo ? 'NOT CONNECTED' : view.error ? 'UNAVAILABLE' :
    !view.history ? (view.busy ? 'CHECKING' : 'UNKNOWN') :
    freshness.state === 'STALE' ? 'STALE' : freshness.state === 'PARTIAL' ? 'PARTIAL' : 'AVAILABLE';

  return <main className="v1-main cc-live-monitor" aria-label="Live Development Monitor">
    <div className="cc-live-heading">
      <div>
        <p className="p-eyebrow">LIVE DEVELOPMENT MONITOR · READ ONLY</p>
        <h1>開發狀態監控台</h1>
        <p className="v1-muted">每 30 秒檢查本機唯讀資料；後端 GitHub 歷史快取約 5 分鐘，不等於每 30 秒取得新的遠端狀態。</p>
      </div>
      <button type="button" onClick={() => void run(true)}
        disabled={!repo || view.busy || !navigator.onLine}
        className="cc-live-refresh"><RefreshCw size={15} />{view.busy ? '查詢中…' : '立即向 GitHub 刷新'}</button>
    </div>
    <div className="cc-live-source" role="status">
      <span className={'cc-live-state ' + (noVerifiedSource ? 'cc-live-state-unknown' : '')}>
        <Activity size={14} />{freshnessText}
      </span>
      <span>來源：{repo ?? '未連線'}</span>
      <span>GitHub 快照：{date(view.history?.fetchedAt)}</span>
      <span>本機檢查：{date(view.checkedAt)}</span>
    </div>
    {!repo && <p role="alert" className="cc-live-warning"><AlertTriangle size={16} />{NO_SOURCE} 不會使用 DEMO 資料。</p>}
    {view.error && <p role="alert" className="cc-live-warning"><AlertTriangle size={16} />資料取得失敗：{view.error}。以下若有舊資料，僅供參考。</p>}
    {freshness.state === 'STALE' && <p role="status" className="cc-live-warning"><Clock3 size={16} />來源快照已過期，不代表目前工作仍在進行。</p>}
    <section className="cc-live-stats" aria-label="狀態指標">
      <article><small>PR 總數</small><strong>{view.history && !view.error ? summary.prCount : '—'}</strong><span>來自 GitHub 歷史快照</span></article>
      <article><small>進行中的 PR</small><strong>{view.history && !view.error ? summary.open : '—'}</strong><span>Open／Draft ≠ Agent Running</span></article>
      <article><small>執行中的 Agent</small><strong>未知</strong><span>尚未接入 Agent heartbeat</span></article>
      <article><small>CI／Codex QA</small><strong>未查詢</strong><span>本來源不提供即時 QA 證據</span></article>
    </section>
    <section className="cc-live-events" aria-label="最近 PR 事件">
      <header><GitPullRequest size={16} /><h2>最近 PR 更新</h2><span>不是 Agent 工作日誌</span></header>
      {view.history && summary.events.length > 0
        ? <ol>{summary.events.map((e: {number:number;title:string;status:string;updatedAt:string|null;url:string;headSha:string|null}) =>
          <li key={e.number}>
            <span className="cc-live-event-dot" aria-hidden="true" />
            <div className="cc-live-event-info">
              <a href={e.url} target="_blank" rel="noreferrer noopener">#{e.number} · {e.title}<ExternalLink size={12}/></a>
              <small>{e.status.toUpperCase()} · Commit {e.headSha?.slice(0,8) ?? '未知'} · {date(e.updatedAt)}</small>
            </div>
          </li>)}</ol>
        : <p className="v1-muted cc-live-empty">{view.busy ? '正在查詢…' : '尚無可驗證的 PR 更新資料。'}</p>}
    </section>
    <p className="cc-live-note">
      安全說明：此階段只讀取已授權的 GitHub 歷史。若無 Agent 心跳、exact-HEAD CI 與 Codex 證據，不能顯示 Running／PASS。
      ZC-06C 與 ZC-07 仍需另行審核 GitHub 唯讀連線。
    </p>
  </main>;
}
