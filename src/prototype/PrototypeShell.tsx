import {ReactNode,useState,useCallback,useLayoutEffect,useRef} from 'react';
import {LayoutGrid,Wallet,Terminal,FlaskConical,ArrowLeft,Plus,Network} from 'lucide-react';
import {PROJECTS,Page,tasksFor,DemoTask,LIVE_PM_DASHBOARD} from './data';
import {GitDevelopmentMap,RailEntry} from './GitDevelopmentMap';
import {Overview} from './Overview';
import {DevelopmentMap} from './DevelopmentMap';
import {CostGuard} from './CostGuard';
import {NodeCommandPanel,PromptDraft,emptyDraft,promptBytes,MAX_PROMPT_BYTES} from './NodeCommandPanel';
import {PromptEntry} from './PromptHistory';
import './prototype.css';
const PAGES=[{id:'overview',label:'專案總覽',icon:LayoutGrid},{id:'history',label:'開發地圖',icon:Network},{id:'cost',label:'Cost Guard',icon:Wallet}] as const;
type RegisteredContext={id?:string;name:string;repository?:string};
type WorkspaceIdentity={source:'REGISTERED'|'DEMO';projectId?:string;repository?:string;displayName:string};
const DEMO_IDS:Record<string,string>={'PM Dashboard':'demo-pm','SwipeRight':'demo-swipe','SaaS Cost Guard':'demo-cost','ProSync':'demo-prosync','Micro-SaaS Command Center':'demo-command-center'};
const demoIdentity=(name:string):WorkspaceIdentity=>({source:'DEMO',projectId:Object.prototype.hasOwnProperty.call(DEMO_IDS,name)?DEMO_IDS[name]:undefined,displayName:name,repository:name==='Micro-SaaS Command Center'?'augusliang23-web/Micro-SaaS-Command-Center':undefined});
const workspaceKey=(identity:WorkspaceIdentity)=>JSON.stringify([identity.source,identity.projectId??null,identity.repository??null]);
const registeredIdentity=(context:RegisteredContext):WorkspaceIdentity=>({source:'REGISTERED',projectId:context.id?.trim()?context.id:undefined,repository:context.repository?.trim()||undefined,displayName:context.name});
const RAIL:RailEntry[]=[{identity:LIVE_PM_DASHBOARD,label:'PM Dashboard',tag:'LIVE · GitHub 唯讀'},...PROJECTS.map(p=>({identity:demoIdentity(p.name),label:p.name,tag:'DEMO · 未連線'}))];
export function PrototypeShell({registeredOverview}:{registeredOverview:(remember:(context:RegisteredContext)=>void)=>ReactNode}) {
  const [demo,setDemo]=useState(()=>new URLSearchParams(window.location.search).get('mode')==='demo');
  const [page,setPage]=useState<Page>('overview');const [identity,setIdentity]=useState<WorkspaceIdentity>(()=>demoIdentity('Micro-SaaS Command Center'));
  const project=identity.displayName;
  const [registered,setRegistered]=useState<RegisteredContext|null>(null);const [taskId,setTaskId]=useState('');
  const [drafts,setDrafts]=useState<Record<string,PromptDraft>>({});const [histories,setHistories]=useState<Record<string,PromptEntry[]>>({});
  const [candidates,setCandidates]=useState<Record<string,DemoTask[]>>({});const sequence=useRef(0);
  const [adding,setAdding]=useState(false);const [newTitle,setNewTitle]=useState('');const [newRequirement,setNewRequirement]=useState('');
  const [openCommand,setOpenCommand]=useState(false);
  const projectKey=workspaceKey(identity);const identityKnown=Boolean(identity.projectId);
  const canonical=identity.source==='DEMO'?identity.projectId==='demo-command-center':Boolean(identity.repository&&/^(?:https?:\/\/)?(?:github\.com\/)?augusliang23-web\/Micro-SaaS-Command-Center\/?$/.test(identity.repository));
  const tasks=[...tasksFor(project,canonical),...(candidates[projectKey]??[])];const task=tasks.find(t=>t.id===taskId);
  const key=JSON.stringify([projectKey,taskId]);
  const repository=identity.repository;
  useLayoutEffect(()=>{(document.scrollingElement??document.documentElement).scrollTop=0;},[page,demo]);
  const clearSelection=()=>{setTaskId('');setAdding(false);setOpenCommand(false);};
  const switchIdentity=(next:WorkspaceIdentity)=>{
    if(workspaceKey(next)!==projectKey){clearSelection();setNewTitle('');setNewRequirement('');}
    setIdentity(next);
  };
  const rememberRegistered=useCallback((context:RegisteredContext)=>{setRegistered(context);setIdentity(registeredIdentity(context));setTaskId('');setAdding(false);setOpenCommand(false);setNewTitle('');setNewRequirement('');},[]);
  const chooseProject=(name:string)=>switchIdentity(demoIdentity(name));
  const navigate=(destination:Page,name=project)=>{chooseProject(name);setPage(destination);setDemo(true);};
  const openHistory=()=>{switchIdentity(LIVE_PM_DASHBOARD);setPage('history');};
  const enterRegistered=()=>{if(!registered)return;switchIdentity(registeredIdentity(registered));setPage('workspace');setDemo(true);};
  const select=(id:string)=>{setTaskId(id);setOpenCommand(false);};
  const titleInvalid=!newTitle.trim()||newTitle.length>80;const requirementInvalid=!newRequirement.trim()||promptBytes(newRequirement)>MAX_PROMPT_BYTES;
  const createCandidate=()=>{
    if(!identityKnown||titleInvalid||requirementInvalid)return;
    const id=`local-${++sequence.current}`;
    const candidate:DemoTask={id,title:newTitle,reference:`LOCAL-DEMO-${sequence.current}`,branch:'Not available（未建立 Git branch）',description:'本次工作階段的本地 DEMO 候選。不建立 GitHub Issue、branch、PR、核准或 agent run。',dependencies:['main'],lane:'ui',x:Math.max(220,...tasks.filter(t=>t.lane==='ui').map(t=>t.x+350)),source:'demo',status:'本地候選 · 未核准'};
    setCandidates(c=>({...c,[projectKey]:[...(c[projectKey]??[]),candidate]}));
    setDrafts(d=>({...d,[JSON.stringify([projectKey,id])]:{...emptyDraft(),request:newRequirement}}));
    setTaskId(id);setAdding(false);setOpenCommand(true);setNewTitle('');setNewRequirement('');
  };
  const panel=identityKnown&&task?<NodeCommandPanel key={key} workspaceSource={identity.source} workspaceId={identity.projectId!} project={project} repository={repository} task={task} tasks={tasks} draft={drafts[key]??emptyDraft()} change={d=>setDrafts(prev=>({...prev,[key]:d}))} entries={histories[key]??[]} save={entry=>{const saved={...entry,id:++sequence.current};setHistories(h=>({...h,[key]:[...(h[key]??[]),saved]}));}} initialTab={openCommand?'AI 指令':'任務資訊'}/>:null;
  return <div className="prototype-shell">
    <header className="p-header"><div className="p-brand"><span><Terminal size={20}/></span><div><strong>COMMAND CENTER</strong><small>Micro-SaaS workspace</small></div></div>
      <nav aria-label="主要頁面">{PAGES.map(p=><button key={p.id} aria-current={page===p.id||(p.id==='overview'&&page==='workspace')?'page':undefined} onClick={()=>{if(p.id==='history')openHistory();else if(demo||p.id==='cost')navigate(p.id);else setPage('overview');}}><p.icon size={16}/>{p.label}</button>)}</nav>
      <button className="p-mode" onClick={()=>{if(page==='history'){chooseProject(PROJECTS[0].name);setDemo(true);setPage('overview');clearSelection();return;}if(!demo)chooseProject(project);clearSelection();setNewTitle('');setNewRequirement('');setDemo(!demo);setPage('overview');}}><FlaskConical size={15}/>{page==='history'?'進入 DEMO':demo?'返回已登記專案':'進入 DEMO'}</button>
    </header>
    {page==='history'?<>
      <div className="p-live-bar"><span><strong>LIVE · GitHub 唯讀</strong> 資料直接讀自 GitHub；沒有 AI 對話、Prompt 或 agent 執行。</span></div>
      <main className="p-main g-main"><GitDevelopmentMap identity={identity} rail={RAIL} selectIdentity={switchIdentity}/></main>
      <footer className="p-footer"><span>GitHub 遠端分支 ≠ 本機 worktree ≠ 部署環境。</span><span>REAL_AGENT_EXECUTION = NOT_AUTHORIZED</span></footer>
    </>:demo?<>
      <div className="p-demo-bar"><span><FlaskConical size={15}/><strong>DEMO DATA</strong> 本地原型／有界快照 · 無 AI 執行或帳單連線</span><label htmlFor="p-project">目前專案<select aria-label="目前專案" id="p-project" value={identity.source==='REGISTERED'?'registered-current':project} onChange={e=>chooseProject(e.target.value)}>{identity.source==='REGISTERED'&&<option value="registered-current" disabled>{project}（REGISTERED）</option>}{PROJECTS.map(p=><option key={p.name}>{p.name}</option>)}</select></label></div>
      <main className="p-main">
        {page==='overview'&&<Overview selected={project} navigate={navigate} openLiveHistory={openHistory}/>}
        {page==='cost'&&<CostGuard project={project} select={chooseProject}/>}
        {page==='workspace'&&<>
          <div className="p-workspace-heading"><button className="p-secondary" onClick={()=>navigate('overview')}><ArrowLeft size={14}/>返回專案總覽</button><h1>{project} 工作區</h1><button className="p-primary" disabled={!identityKnown} onClick={()=>setAdding(!adding)}><Plus size={15}/>+ 新增開發任務</button></div>
          <p className="p-source"><strong>{identity.source==='REGISTERED'?'REGISTERED PROJECT':'DEMO PROJECT'}</strong> · Project ID: {identity.projectId??'Not available'}</p>
          {!identityKnown&&<p role="alert">缺少穩定專案 ID，工作區指令與紀錄操作已封閉；不以名稱或 repository 推測身分。</p>}
          <p className="p-source">{repository?`Repository context：${repository}`:'Repository：Not available'} · 節點內整理需求與手動交接，不建立任何真實執行。</p>
          {adding&&<section className="p-new-task" aria-label="新增本地任務"><h2>新增本地 DEMO 候選</h2><p className="p-muted">只在本次工作階段顯示，不建立 GitHub Issue、branch、PR 或核准。</p><label className="p-field">任務名稱<input aria-label="任務名稱" value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></label><label className="p-field">新任務需求<textarea aria-label="新任務需求" value={newRequirement} onChange={e=>setNewRequirement(e.target.value)} rows={4}/></label>{newTitle.length>80&&<p role="alert">任務名稱上限為 80 字元，請自行縮減。</p>}{promptBytes(newRequirement)>MAX_PROMPT_BYTES&&<p role="alert">需求超過 64 KiB 上限，請自行縮減。</p>}<button className="p-primary" disabled={titleInvalid||requirementInvalid} onClick={createCandidate}>建立本地 DEMO 候選</button></section>}
          {!task&&<p className="p-workspace-empty">選取任務／PR 節點，即可在旁邊查看資訊、輸入 AI 指令與 Prompt 紀錄；沒有既有任務時，可新增本地候選。</p>}
          {identityKnown&&<DevelopmentMap tasks={tasks} selected={taskId} select={select} panel={panel}/>}
        </>}
      </main>
      <footer className="p-footer"><span>所有貼入文字均未驗證，不構成核准或執行權限。</span><span>REAL_AGENT_EXECUTION = NOT_AUTHORIZED</span></footer>
    </>:<><div className="p-real-bar">已登記專案總覽 · 保留來源查詢與 UNKNOWN 邊界。{registered&&<span>選定 context：{registered.name}</span>}<button disabled={!registered} onClick={enterRegistered}>進入專案工作區</button><button onClick={()=>navigate('overview')}>體驗 DEMO 專案</button></div><div className="p-registered-overview">{registeredOverview(rememberRegistered)}</div></>}
  </div>;
}
