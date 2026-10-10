import { GitBranch, ArrowRight, Info, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { DemoTask, SNAPSHOT } from './data';
const laneY = { foundation: 155, ui: 335, cost: 510 };
const laneColor = { foundation: '#0f766e', ui: '#8b5cf6', cost: '#d97706' };
const curve = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} C ${x1 + (x2-x1)/2} ${y1}, ${x1 + (x2-x1)/2} ${y2}, ${x2} ${y2}`;
export function DevelopmentMap({ tasks, selected, select, handoff }: { tasks: DemoTask[]; selected: string; select: (id: string) => void; handoff: () => void }) {
  const task = tasks.find(t => t.id === selected);
  const viewport = useRef<HTMLDivElement>(null);
  const taskX = task?.x;
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollLeft = taskX === undefined ? 0 : Math.max(0, taskX + 125 - viewport.current.clientWidth / 2);
  }, [taskX]);
  return <>
    <div className="p-page-heading"><div><p className="p-eyebrow">DEVELOPMENT MAP</p><h1>讓每條開發分支都有方向。</h1><p>看見相依關係與平行探索，點選任務即可交接規劃。</p></div><span className="p-pill"><GitBranch size={14} /> 本地依賴圖</span></div>
    <div className="p-map-note"><Info size={16} /><span>PR #25 → #26 → #27 是已知依賴的歷史參考，現況未查詢。其他分支為 DEMO-ONLY。</span></div>
    <div className={`p-map-layout ${task ? 'has-detail' : ''}`}>
      <section className="p-graph-panel" aria-label="開發分支圖"><div className="p-graph-top"><strong>分支與任務</strong><span>左右捲動查看完整時間軸 →</span></div>
        <div className="p-graph-scroll" ref={viewport}><div className="p-graph-canvas">
          <svg className="p-graph-lines" width="1500" height="685" role="img" aria-label="歷史與示範依賴連線">
            <path d="M 100 55 H 1420" stroke="#94a3b8" strokeWidth="3" fill="none" />
            {tasks.flatMap(t => t.dependencies.map(dep => {
              const parent = tasks.find(p => p.id === dep); const x = parent ? parent.x + 250 : 150; const y = parent ? laneY[parent.lane] + 48 : 55;
              const label = parent ? `${parent.reference} → ${t.reference}（歷史依賴）` : `main → ${t.reference}（${t.source === 'demo' ? 'DEMO' : '歷史依賴'}）`;
              return <path key={`${dep}-${t.id}`} aria-label={label} d={curve(x, y, t.x, laneY[t.lane]+48)} stroke={laneColor[t.lane]} strokeWidth="3" fill="none" />;
            }))}
            {tasks.filter(t => t.source === 'demo' && t.lane !== 'foundation').map((t, i) => <path key={`merge-${t.id}`} d={curve(t.x+250, laneY[t.lane]+48, 1320+i*70, 55)} stroke={laneColor[t.lane]} strokeWidth="2" strokeDasharray="6 6" fill="none" />)}
            <circle cx="150" cy="55" r="7" fill="#64748b" /><circle cx="1390" cy="55" r="7" fill="white" stroke="#94a3b8" strokeWidth="2" />
          </svg>
          <span className="p-main-label">main · 基準示意</span><span className="p-merge-label">假設合併，未發生（DEMO）</span>
          <span className="p-lane-label" style={{ top: 119, color: laneColor.foundation }}>基礎層 · stacked dependencies</span>
          <span className="p-lane-label" style={{ top: 299, color: laneColor.ui }}>UI/UX · 平行探索</span>
          <span className="p-lane-label" style={{ top: 474, color: laneColor.cost }}>Cost Guard · 平行探索</span>
          {tasks.map(t => <button key={t.id} aria-pressed={selected === t.id} className={`p-task-node ${selected === t.id ? 'is-selected' : ''}`} style={{ left: t.x, top: laneY[t.lane], borderTopColor: laneColor[t.lane] }} onClick={() => select(t.id)} aria-label={`${t.title} · ${t.reference} · ${t.status}`}>
            <span className="p-node-meta">{t.reference}<span>{t.source === 'demo' ? 'DEMO-ONLY' : '歷史參考'}</span></span><strong>{t.title}</strong><span className="p-node-status"><i style={{ background: laneColor[t.lane] }} />{t.status}</span>
          </button>)}
        </div></div>
        <div className="p-graph-footer"><span><i style={{background:laneColor.foundation}} /> 基礎層</span><span><i style={{background:laneColor.ui}} /> UI/UX</span><span><i style={{background:laneColor.cost}} /> 成本探索</span><span>實線：依賴 · 虛線：DEMO 合併示意</span></div>
      </section>
      {task && <aside className="p-detail" role="region" aria-label="任務詳細"><div className="p-section-heading"><span className="p-eyebrow">TASK CONTEXT</span><button className="p-icon-button" aria-label="關閉任務詳細" onClick={() => select('')}><X size={18}/></button></div>
        <h2>{task.title}</h2><span className="p-pill">{task.reference} · {task.source === 'demo' ? 'DEMO-ONLY' : '歷史參考'}</span><p>{task.description}</p>
        <dl className="p-info-list"><div><dt>狀態</dt><dd>{task.status}</dd></div><div><dt>分支</dt><dd className="p-code">{task.branch}</dd></div><div><dt>Agent / Model</dt><dd>Not available</dd></div><div><dt>依賴</dt><dd>{task.dependencies.map(id => tasks.find(t=>t.id===id)?.reference ?? id).join('、')}</dd></div><div><dt>阻塞</dt><dd>等待 Control Plane 審查；未授權執行</dd></div><div><dt>最後更新</dt><dd>{task.source === 'historical' ? '未取得即時更新；歷史參考' : SNAPSHOT}</dd></div><div><dt>下一步</dt><dd>整理需求與驗收條件，提交規劃預覽</dd></div></dl>
        <button className="p-primary" onClick={handoff}>交給 AI Command <ArrowRight size={16}/></button><small className="p-source">只傳遞本地專案與任務 context，不建立執行。</small>
      </aside>}
    </div>
  </>;
}
