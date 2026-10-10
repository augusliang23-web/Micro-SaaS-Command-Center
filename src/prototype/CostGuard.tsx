import { ArrowUpRight, Info, ShieldCheck, Wallet } from 'lucide-react';
import { COLORS, COSTS, CostSample, SNAPSHOT, costFor, headroom, money } from './data';
function LimitBar({ label, used, limit, unit }: { label: string; used: number | null; limit: number | null; unit: string }) {
  const remaining = headroom(used, limit);
  return <div className="p-limit"><div><strong>{label}</strong><span>{remaining === null ? 'Not available' : `餘裕 ${remaining.toFixed(0)}%`}</span></div>
    {remaining === null ? <p className="p-muted">Not enough data · 尚未提供適用門檻</p> : <><div className="p-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, 100-remaining))}><i style={{width:`${100-remaining}%`, background:remaining<20?'#d97706':'#0f766e'}}/></div><small>{used?.toLocaleString()} / {limit?.toLocaleString()} {unit}</small></>}
  </div>;
}
function Distribution() {
  const known = COSTS.filter((c): c is CostSample & { usd: number } => c.usd !== null);
  const total = known.reduce((sum,c)=>sum+c.usd,0); let offset=0; const circumference=2*Math.PI*65;
  return <section className="p-distribution"><div><p className="p-eyebrow">SAMPLED DISTRIBUTION</p><h2>專案成本分布</h2><p className="p-muted">只比較同一期間的 USD 樣本金額，不混入讀取次數或運算時間。</p><p className="p-source">4 / 5 個專案金額可用；缺少資料的專案不計入分布。<br/>這不是完整帳單或可驗證的實際費用。</p></div>
    <div className="p-donut" role="img" aria-label="USD 示範成本分布"><svg viewBox="0 0 180 180" aria-hidden="true"><circle cx="90" cy="90" r="65" fill="none" stroke="#f1f5f9" strokeWidth="20"/>{known.map((c,i)=>{const arc=c.usd/total*circumference;const start=offset;offset+=arc;return <circle key={c.project} cx="90" cy="90" r="65" fill="none" stroke={COLORS[i]} strokeWidth="20" strokeDasharray={`${arc} ${circumference-arc}`} strokeDashoffset={-start} transform="rotate(-90 90 90)"/>;})}</svg><div><strong>{money(total)}</strong><span>USD · DEMO</span></div></div>
    <ul className="p-cost-legend">{known.map((c,i)=><li key={c.project}><i style={{background:COLORS[i]}}/><span>{c.project}</span><strong>{(c.usd/total*100).toFixed(1)}%</strong></li>)}</ul>
  </section>;
}
export function CostGuard({ project, select }: { project: string; select: (project: string) => void }) {
  const sample = costFor(project); const known=COSTS.filter(c=>c.usd!==null);
  const closestBudget=Math.min(...known.map(c=>headroom(c.usd,c.budget) ?? 100));
  const closestFree=Math.min(...COSTS.filter(c=>c.free).map(c=>headroom(c.free!.used,c.free!.limit)!));
  return <>
    <div className="p-page-heading"><div><p className="p-eyebrow">COST GUARD</p><h1>在成本越界之前，看見餘裕。</h1><p>以專案為中心，區分成本樣本、預算告警與真正的花費上限。</p></div><span className="p-pill"><ShieldCheck size={14}/> DEMO · 無帳單連線</span></div>
    <div className="p-stats p-cost-stats"><div><span>樣本金額 · USD / month</span><strong>{money(known.reduce((sum,c)=>sum+c.usd!,0))}</strong><small>只加總可用樣本，不代表完整費用</small></div><div><span>需要關注的範例專案</span><strong>02</strong><small>一個接近用量門檻，一個資訊不足</small></div><div><span>最近的免費門檻</span><strong>{closestFree.toFixed(0)}%<em> 餘裕</em></strong><small>各自適用門檻的剩餘比例</small></div><div><span>最近的預算告警</span><strong>{closestBudget.toFixed(0)}%<em> 餘裕</em></strong><small>Hard cap 未配置，未啟用強制停止</small></div></div>
    <Distribution/>
    <div className="p-section-heading"><h2>各專案成本樣本</h2><span>{SNAPSHOT} · DEMO fixture</span></div>
    <div className="p-cost-cards">{COSTS.map(c=>{const free=c.free?headroom(c.free.used,c.free.limit):null;const remaining=headroom(c.usd,c.budget);return <button key={c.project} onClick={()=>select(c.project)} className={`p-cost-card ${project===c.project?'is-selected':''}`} aria-label={`選擇 ${c.project} 成本`}><span className="p-cost-card-name"><Wallet size={16}/><strong>{c.project}</strong><ArrowUpRight size={15}/></span><span className="p-amount">{money(c.usd)}<small> USD / month · DEMO</small></span><span>Billing Account · {c.account ?? 'Not available'}</span><span>Usage · {c.free ? `${c.free.used.toLocaleString()} ${c.free.unit}` : 'Not enough data'}</span><span>預算餘裕 · {remaining === null ? 'Not available' : `${remaining.toFixed(0)}%`}</span><span className="p-pill">{c.usd===null?'需要補資料':free!==null&&free<20?'需要注意（示範）':'有餘裕（示範）'}</span><small>來源：本地 DEMO fixture · {SNAPSHOT}</small></button>;})}</div>
    <section className="p-cost-detail" aria-label="專案成本詳細"><div className="p-section-heading"><div><p className="p-eyebrow">PROJECT DETAIL</p><h2>{sample.project}</h2></div><span className="p-pill">DEMO DATA · USD</span></div><p className="p-muted">Billing Account：{sample.account ?? 'Not available'} · {SNAPSHOT}</p><div className="p-limit-grid"><LimitBar label="免費用量門檻（示範）" used={sample.free?.used ?? null} limit={sample.free?.limit ?? null} unit={sample.free?.unit ?? ''}/><LimitBar label="預算告警（示範）" used={sample.usd} limit={sample.budget} unit="USD / month"/><div className="p-limit"><strong>Hard cap · Not available</strong><p className="p-muted">未配置、未啟用。沒有可驗證的強制停止機制。</p></div></div><div className="p-map-note"><Info size={16}/><span>預算告警不會自動停止花費。硬上限需要另外的執行機制；這個原型未啟用任何限制。範例免費門檻並非雲端官方限額。</span></div></section>
  </>;
}
