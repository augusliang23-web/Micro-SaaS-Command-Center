import { ArrowUpRight, GitBranch, Wallet, Clock3, Network } from 'lucide-react';
import { PROJECTS, SNAPSHOT, Page, costFor, headroom, money, tasksFor } from './data';
export function Overview({ selected, navigate, openLiveHistory }: { selected: string; navigate: (page: Page, project: string) => void; openLiveHistory?: () => void }) {
  return <>
    <div className="p-page-heading"><div><p className="p-eyebrow">PROJECT OVERVIEW</p><h1>你的開發組合，一眼掌握。</h1><p>先看見阻塞，再決定下一步。這裡的任務、狀態與成本都是本地範例。</p></div><span className="p-pill"><Clock3 size={14} /> {SNAPSHOT}</span></div>
    <div className="p-stats">
      <div><span>示範專案</span><strong>05</strong><small>與已登記專案資料分開呈現</small></div>
      <div><span>選定專案的任務範例</span><strong>{String(tasksFor(selected).length).padStart(2, '0')}</strong><small>包含平行探索分支</small></div>
      <div><span>執行權限</span><strong className="p-stat-text">尚未授權</strong><small>此工作區只產生本地預覽</small></div>
    </div>
    <div className="p-section-heading"><h2>你的專案</h2><span>DEMO · 名稱沿用工作區；資訊不足時不猜測真實狀態</span></div>
    <section className="p-project-grid" aria-label="DEMO 專案總覽">
      {PROJECTS.map((p, index) => {
        const cost = costFor(p.name); const remaining = headroom(cost.usd, cost.budget);
        return <article key={p.name} aria-label={`${p.name} 示範專案`} className={`p-project-card ${selected === p.name ? 'is-selected' : ''}`}>
          <div className="p-card-top"><span className="p-project-mark" style={{ background: COLORS_LOCAL[index] }}>{p.name.slice(0, 1)}</span><span className="p-pill">DEMO</span></div>
          <h3>{p.name}</h3><p className="p-muted">{p.description}</p>
          <dl className="p-info-list"><div><dt>開發狀態</dt><dd>等待確認（示範）</dd></div><div><dt>里程碑</dt><dd>{p.milestone}</dd></div><div><dt>任務</dt><dd>{tasksFor(p.name).length} 個任務範例</dd></div><div><dt>阻塞</dt><dd>{p.blocker}</dd></div></dl>
          <div className="p-next"><ArrowUpRight size={15} /><div><span>下一步</span><p>{p.next}</p></div></div>
          <button className="p-cost-link" onClick={() => navigate('cost', p.name)} aria-label="查看 Cost Guard"><Wallet size={15} /><span>成本樣本 · {money(cost.usd)} USD</span><span>{remaining === null ? 'Not enough data' : `預算餘裕 ${remaining.toFixed(0)}%`}</span></button>
          <div className="p-card-actions"><button onClick={() => navigate('workspace', p.name)}><GitBranch size={15} /> 進入工作區</button>{p.name === 'PM Dashboard' && openLiveHistory && <button onClick={openLiveHistory} aria-label="開啟 PM Dashboard 真實 GitHub 開發地圖（REGISTERED，唯讀）"><Network size={15} /> LIVE 開發地圖</button>}</div>
          <small className="p-source">來源：本地 DEMO fixture · 非即時狀態<br />最後檢視：{SNAPSHOT}</small>
        </article>;
      })}
    </section>
  </>;
}
const COLORS_LOCAL = ['#e0f2fe', '#ede9fe', '#d1fae5', '#fef3c7', '#e2e8f0'];
