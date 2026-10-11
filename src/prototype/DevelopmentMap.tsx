import { GitBranch, Info } from 'lucide-react';
import { useLayoutEffect, useRef, ReactNode } from 'react';
import { DemoTask, TOPOLOGY_DATE } from './data';
const laneConfig = {
  foundation: { title: 'Track A · stacked PRs', color: '#0f766e' },
  'track-b': { title: 'Track B · 基於 main 的獨立分支', color: '#2563eb' },
  ui: { title: 'DEMO-ONLY · UI/UX 探索', color: '#8b5cf6' },
  cost: { title: 'DEMO-ONLY · 成本探索', color: '#d97706' },
};
const curve = (x1:number,y1:number,x2:number,y2:number) => `M ${x1} ${y1} C ${x1+(x2-x1)/2} ${y1}, ${x1+(x2-x1)/2} ${y2}, ${x2} ${y2}`;
export function DevelopmentMap({ tasks, selected, select, panel }: { tasks: DemoTask[]; selected: string; select:(id:string)=>void; panel?:ReactNode }) {
  const task=tasks.find(t=>t.id===selected); const viewport=useRef<HTMLDivElement>(null);
  const lanes=(Object.keys(laneConfig) as Array<keyof typeof laneConfig>).filter(id=>tasks.some(t=>t.lane===id));
  const y=(lane:DemoTask['lane'])=>110+lanes.indexOf(lane)*220;
  const width=Math.max(1100,...tasks.map(t=>t.x+410)); const height=lanes.length*220+110;
  const ancestry=new Set<string>();
  function visit(id:string) { if(ancestry.has(id))return;ancestry.add(id);tasks.find(t=>t.id===id)?.dependencies.forEach(visit); }
  if(task)visit(task.id);
  useLayoutEffect(()=>{if(viewport.current)viewport.current.scrollLeft=task?Math.max(0,task.x+155-viewport.current.clientWidth/2):0;},[task?.x]);
  const known=tasks.some(t=>t.source==='historical');
  return <>
    <div className="p-page-heading"><div><p className="p-eyebrow">DEVELOPMENT MAP</p><h1>讓每條開發分支都有方向。</h1><p>選擇任務，沿著真正的依賴整理下一步。支援平行分支，不要求固定 GitFlow 命名。</p></div><span className="p-pill"><GitBranch size={14}/> 有界本地快照</span></div>
    <div className="p-map-note"><Info size={16}/><span>{known ? `拓樸快照 ${TOPOLOGY_DATE} · 未即時查詢。Track A：#25 → #26 → #27 → #28；Track B：main → #30。DEMO-ONLY 為另列範例。` : '此專案尚未取得已查詢拓樸，以下只顯示 DEMO-ONLY 範例。'}</span></div>
    <div className={`p-map-layout ${task?'has-detail':''}`}>
      <section className="p-graph-panel" aria-label="開發分支圖"><div className="p-graph-top"><strong>分支與任務</strong><span>圖內捲動 · 選取節點高亮上游依賴</span></div>
        <div className="p-graph-scroll" ref={viewport} tabIndex={0} role="region" aria-label="可捲動開發圖"><div className="p-graph-canvas" style={{width,height}}>
          <svg className="p-graph-lines" width={width} height={height} role="img" aria-label="歷史與示範依賴連線">
            <path d={`M 60 40 H ${width-60}`} stroke="#94a3b8" strokeWidth="3" fill="none"/>
            {tasks.flatMap(t=>t.dependencies.map(dep=>{
              const parent=tasks.find(p=>p.id===dep);const highlighted=Boolean(task&&ancestry.has(t.id)&&ancestry.has(dep));
              const label=parent?`${parent.reference} → ${t.reference}（歷史依賴）`:`main → ${t.reference}（${t.source==='demo'?'DEMO':'歷史依賴'}）`;
              return <path key={`${dep}-${t.id}`} aria-label={label} data-highlighted={highlighted} d={curve(parent?parent.x+310:100,parent?y(parent.lane)+70:40,t.x,y(t.lane)+70)} stroke={laneConfig[t.lane].color} strokeWidth={highlighted?5:2.5} opacity={task&&!highlighted?0.25:1} fill="none"/>;
            }))}
            <circle cx="100" cy="40" r="7" fill="#64748b"/>
          </svg>
          <span className="p-main-label">main · {known?'25692a9…（快照基準）':'範例基準'}</span>
          {lanes.map(id=><span key={id} className="p-lane-label" style={{top:y(id)-28,color:laneConfig[id].color}}>{id==='foundation'&&!known?'DEMO-ONLY · 規格探索':laneConfig[id].title}</span>)}
          {tasks.map(t=><button key={t.id} aria-pressed={selected===t.id} className={`p-task-node ${selected===t.id?'is-selected':''} ${t.id!==selected&&ancestry.has(t.id)?'is-dependency':''}`} style={{left:t.x,top:y(t.lane),borderTopColor:laneConfig[t.lane].color}} onClick={()=>select(t.id)} aria-label={`${t.title} · ${t.reference} · ${t.status}`}>
            <span className="p-node-meta">{t.reference}<span>{t.source==='demo'?'DEMO-ONLY':'GitHub 快照'}</span></span><strong>{t.title}</strong><span className="p-node-status"><i style={{background:laneConfig[t.lane].color}}/>{t.status}</span>
          </button>)}
        </div></div><div className="p-graph-footer"><span>實線：base/head 依賴 · 沒有合併紀錄</span><span>GitHub 快照 ≠ 即時狀態 · DEMO-ONLY ≠ 既有 PR</span></div>
      </section>
      {task && panel}

    </div>
  </>;
}
