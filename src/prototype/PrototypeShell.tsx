import {ReactNode,useState,useCallback,useLayoutEffect,useRef} from 'react';
import {LayoutGrid,Wallet,Terminal,FlaskConical,ArrowLeft,Plus} from 'lucide-react';
import {PROJECTS,Page,tasksFor,DemoTask} from './data';
import {Overview} from './Overview';
import {DevelopmentMap} from './DevelopmentMap';
import {CostGuard} from './CostGuard';
import {NodeCommandPanel,PromptDraft,emptyDraft,promptBytes,MAX_PROMPT_BYTES} from './NodeCommandPanel';
import {PromptEntry} from './PromptHistory';
import './prototype.css';
const PAGES=[{id:'overview',label:'專案總覽',icon:LayoutGrid},{id:'cost',label:'Cost Guard',icon:Wallet}] as const;
type RegisteredContext={id?:string;name:string;repository:string};
export function PrototypeShell({registeredOverview}:{registeredOverview:(remember:(context:RegisteredContext)=>void)=>ReactNode}) {
  const [demo,setDemo]=useState(()=>new URLSearchParams(window.location.search).get('mode')==='demo');
  const [page,setPage]=useState<Page>('overview');const [project,setProject]=useState('Micro-SaaS Command Center');
  const [registered,setRegistered]=useState<RegisteredContext|null>(null);const [taskId,setTaskId]=useState('');
  const [drafts,setDrafts]=useState<Record<string,PromptDraft>>({});const [histories,setHistories]=useState<Record<string,PromptEntry[]>>({});
  const [candidates,setCandidates]=useState<Record<string,DemoTask[]>>({});const sequence=useRef(0);
  const [adding,setAdding]=useState(false);const [newTitle,setNewTitle]=useState('');const [newRequirement,setNewRequirement]=useState('');
  const [openCommand,setOpenCommand]=useState(false);
  const registeredContext=registered?.name===project?registered:null;
  const projectKey=JSON.stringify(registeredContext?['registered',registeredContext.id??registeredContext.repository,registeredContext.repository]:['demo',project]);
  const canonical=!registeredContext||/^(?:https?:\/\/)?(?:github\.com\/)?augusliang23-web\/Micro-SaaS-Command-Center\/?$/.test(registeredContext.repository);
  const tasks=[...tasksFor(project,canonical),...(candidates[projectKey]??[])];const task=tasks.find(t=>t.id===taskId);
  const key=JSON.stringify([projectKey,taskId]);
  const repository=registeredContext?.repository??(project==='Micro-SaaS Command Center'?'augusliang23-web/Micro-SaaS-Command-Center':undefined);
  useLayoutEffect(()=>{(document.scrollingElement??document.documentElement).scrollTop=0;},[page,demo]);
  const clearSelection=()=>{setTaskId('');setAdding(false);setOpenCommand(false);};
  const rememberRegistered=useCallback((context:RegisteredContext)=>{setRegistered(context);setProject(context.name);setTaskId('');setAdding(false);},[]);
  const chooseProject=(name:string)=>{if(name!==project){setProject(name);clearSelection();setNewTitle('');setNewRequirement('');}};
  const navigate=(destination:Page,name=project)=>{chooseProject(name);setPage(destination);setDemo(true);};
  const select=(id:string)=>{setTaskId(id);setOpenCommand(false);};
  const titleInvalid=!newTitle.trim()||newTitle.length>80;const requirementInvalid=!newRequirement.trim()||promptBytes(newRequirement)>MAX_PROMPT_BYTES;
  const createCandidate=()=>{
    if(titleInvalid||requirementInvalid)return;
    const id=`local-${++sequence.current}`;
    const candidate:DemoTask={id,title:newTitle,reference:`LOCAL-DEMO-${sequence.current}`,branch:'Not available（未建立 Git branch）',description:'本次工作階段的本地 DEMO 候選。不建立 GitHub Issue、branch、PR、核准或 agent run。',dependencies:['main'],lane:'ui',x:Math.max(220,...tasks.filter(t=>t.lane==='ui').map(t=>t.x+350)),source:'demo',status:'本地候選 · 未核准'};
    setCandidates(c=>({...c,[projectKey]:[...(c[projectKey]??[]),candidate]}));
    setDrafts(d=>({...d,[JSON.stringify([projectKey,id])]:{...emptyDraft(),request:newRequirement}}));
    setTaskId(id);setAdding(false);setOpenCommand(true);setNewTitle('');setNewRequirement('');
  };
  const panel=task?<NodeCommandPanel key={key} project={project} repository={repository} task={task} tasks={tasks} draft={drafts[key]??emptyDraft()} change={d=>setDrafts(prev=>({...prev,[key]:d}))} entries={histories[key]??[]} save={entry=>{const saved={...entry,id:++sequence.current};setHistories(h=>({...h,[key]:[...(h[key]??[]),saved]}));}} initialTab={openCommand?'AI 指令':'任務資訊'}/>:null;
  return <div className="prototype-shell">
    <header className="p-header"><div className="p-brand"><span><Terminal size={20}/></span><div><strong>COMMAND CENTER</strong><small>Micro-SaaS workspace</small></div></div>
      <nav aria-label="主要頁面">{PAGES.map(p=><button key={p.id} aria-current={page===p.id||(p.id==='overview'&&page==='workspace')?'page':undefined} onClick={()=>{if(demo||p.id==='cost')navigate(p.id);else setPage('overview');}}><p.icon size={16}/>{p.label}</button>)}</nav>
      <button className="p-mode" onClick={()=>{setDemo(!demo);setPage('overview');}}><FlaskConical size={15}/>{demo?'返回已登記專案':'進入 DEMO'}</button>
    </header>
    {demo?<>
      <div className="p-demo-bar"><span><FlaskConical size={15}/><strong>DEMO DATA</strong> 本地原型／有界快照 · 無 AI 執行或帳單連線</span><label htmlFor="p-project">目前專案<select aria-label="目前專案" id="p-project" value={project} onChange={e=>chooseProject(e.target.value)}>{PROJECTS.map(p=><option key={p.name}>{p.name}</option>)}{!PROJECTS.some(p=>p.name===project)&&<option>{project}</option>}</select></label></div>
      <main className="p-main">
        {page==='overview'&&<Overview selected={project} navigate={navigate}/>}
        {page==='cost'&&<CostGuard project={project} select={chooseProject}/>}
        {page==='workspace'&&<>
          <div className="p-workspace-heading"><button className="p-secondary" onClick={()=>navigate('overview')}><ArrowLeft size={14}/>返回專案總覽</button><h1>{project} 工作區</h1><button className="p-primary" onClick={()=>setAdding(!adding)}><Plus size={15}/>+ 新增開發任務</button></div>
          <p className="p-source">{repository?`Repository context：${repository}`:'Repository：Not available'} · 節點內整理需求與手動交接，不建立任何真實執行。</p>
          {adding&&<section className="p-new-task" aria-label="新增本地任務"><h2>新增本地 DEMO 候選</h2><p className="p-muted">只在本次工作階段顯示，不建立 GitHub Issue、branch、PR 或核准。</p><label className="p-field">任務名稱<input aria-label="任務名稱" value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></label><label className="p-field">新任務需求<textarea aria-label="新任務需求" value={newRequirement} onChange={e=>setNewRequirement(e.target.value)} rows={4}/></label>{newTitle.length>80&&<p role="alert">任務名稱上限為 80 字元，請自行縮減。</p>}{promptBytes(newRequirement)>MAX_PROMPT_BYTES&&<p role="alert">需求超過 64 KiB 上限，請自行縮減。</p>}<button className="p-primary" disabled={titleInvalid||requirementInvalid} onClick={createCandidate}>建立本地 DEMO 候選</button></section>}
          {!task&&<p className="p-workspace-empty">選取任務／PR 節點，即可在旁邊查看資訊、輸入 AI 指令與 Prompt 紀錄；沒有既有任務時，可新增本地候選。</p>}
          <DevelopmentMap tasks={tasks} selected={taskId} select={select} panel={panel}/>
        </>}
      </main>
      <footer className="p-footer"><span>所有貼入文字均未驗證，不構成核准或執行權限。</span><span>REAL_AGENT_EXECUTION = NOT_AUTHORIZED</span></footer>
    </>:<><div className="p-real-bar">已登記專案總覽 · 保留來源查詢與 UNKNOWN 邊界。{registered&&<span>選定 context：{registered.name}</span>}<button onClick={()=>navigate('workspace')}>進入專案工作區</button><button onClick={()=>navigate('overview')}>體驗 DEMO 專案</button></div><div className="p-registered-overview">{registeredOverview(rememberRegistered)}</div></>}
  </div>;
}
