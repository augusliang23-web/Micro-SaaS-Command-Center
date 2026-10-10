import { ReactNode, useState, useCallback, useLayoutEffect } from 'react';
import { ArrowRight, LayoutGrid, GitBranch, MessageSquare, Wallet, Terminal, FlaskConical } from 'lucide-react';
import { PROJECTS, Page, tasksFor } from './data';
import { Overview } from './Overview';
import { DevelopmentMap } from './DevelopmentMap';
import { AiCommand, Plan, makeDemoPlan } from './AiCommand';
import { CostGuard } from './CostGuard';
import './prototype.css';
const PAGES = [{id:'overview',label:'專案總覽',icon:LayoutGrid},{id:'map',label:'Development Map',icon:GitBranch},{id:'command',label:'AI Command',icon:MessageSquare},{id:'cost',label:'Cost Guard',icon:Wallet}] as const;
type RegisteredContext = { name: string; repository: string };
export function PrototypeShell({ registeredOverview }: { registeredOverview: (remember: (context: RegisteredContext) => void) => ReactNode }) {
  const [demo, setDemo] = useState(() => new URLSearchParams(window.location.search).get('mode') === 'demo');
  const [page, setPage] = useState<Page>('overview');
  const [project, setProject] = useState('Micro-SaaS Command Center');
  const [registered, setRegistered] = useState<RegisteredContext|null>(null);
  const [taskId, setTaskId] = useState('');
  const [drafts, setDrafts] = useState<Record<string,string>>({});
  const [plan, setPlan] = useState<Plan|null>(null);
  useLayoutEffect(() => { (document.scrollingElement ?? document.documentElement).scrollTop = 0; }, [page, demo]);
  const rememberRegistered = useCallback((context: RegisteredContext) => { setRegistered(context); setProject(context.name); setTaskId(''); setPlan(null); }, []);
  const tasks = tasksFor(project); const key = `${project}:${taskId}`; const prompt = drafts[key] ?? '';
  const chooseProject = (name: string) => { if (name !== project) { setProject(name); setTaskId(''); setPlan(null); } };
  const chooseTask = (id: string) => { setTaskId(id); setPlan(null); };
  const navigate = (destination: Page, name = project) => { chooseProject(name); setPage(destination); setDemo(true); };
  return <div className="prototype-shell">
    <header className="p-header"><div className="p-brand"><span><Terminal size={20}/></span><div><strong>COMMAND CENTER</strong><small>Micro-SaaS workspace</small></div></div>
      <nav aria-label="主要頁面">{PAGES.map(p=><button key={p.id} aria-current={page===p.id?'page':undefined} onClick={()=>{if(demo || p.id!=='overview')navigate(p.id);else setPage('overview');}}><p.icon size={16}/>{p.label}</button>)}</nav>
      <button className="p-mode" onClick={()=>{setDemo(!demo);setPage('overview');}}><FlaskConical size={15}/>{demo?'返回已登記專案':'進入 DEMO'}</button>
    </header>
    {demo ? <>
      <div className="p-demo-bar"><span><FlaskConical size={15}/><strong>DEMO DATA</strong> 本地示範 · 非即時 GitHub / 帳單 / AI 結果</span><label htmlFor="p-project">目前專案<select aria-label="目前專案" id="p-project" value={project} onChange={e=>chooseProject(e.target.value)}>{PROJECTS.map(p=><option key={p.name}>{p.name}</option>)}{!PROJECTS.some(p=>p.name===project)&&<option>{project}</option>}</select></label></div>
      <main className="p-main"><div className="p-context-actions"><span>{project}{taskId ? ` · ${tasks.find(t=>t.id===taskId)?.reference ?? "未選定任務"}` : " · 尚未選擇任務"}</span><button className="p-primary" onClick={()=>navigate("command")}>向 AI 提需求 <MessageSquare size={15}/></button></div>{registered?.name===project&&<p className="p-source" style={{marginBottom:18}}>專案 context：已登記的 {registered.name} / {registered.repository}。下方狀態、任務與成本仍為 DEMO；不代表即時資料。</p>}{page==='overview'&&<Overview selected={project} navigate={navigate}/>}{page==='map'&&<DevelopmentMap tasks={tasks} selected={taskId} select={chooseTask} handoff={()=>navigate('command')}/>}{page==='command'&&<AiCommand project={project} tasks={tasks} taskId={taskId} selectTask={chooseTask} prompt={prompt} editPrompt={text=>{setDrafts(d=>({...d,[key]:text}));setPlan(null);}} plan={plan} generate={()=>{if(prompt.trim())setPlan(makeDemoPlan(prompt,project,tasks.find(t=>t.id===taskId)));}}/>}{page==='cost'&&<CostGuard project={project} select={chooseProject}/>}</main>
      <footer className="p-footer"><span>原型只協助理解與討論，所有執行都需另行授權。</span><span>DEMO · REAL_AGENT_EXECUTION = NOT_AUTHORIZED</span></footer>
    </> : <><div className="p-real-bar">已登記專案總覽 · 保留既有來源查詢與 UNKNOWN 邊界。{registered && <span>目前 context：{registered.name}</span>}<button onClick={()=>navigate('overview')}>體驗四頁 DEMO <ArrowRight size={14}/></button><button onClick={()=>navigate("command")}>向 AI 提需求 <MessageSquare size={14}/></button></div><div className="p-registered-overview">{registeredOverview(rememberRegistered)}</div></>}
  </div>;
}
