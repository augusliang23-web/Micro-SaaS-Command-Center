import {useEffect,useState,ClipboardEvent} from 'react';
import {DemoTask,TOPOLOGY_DATE} from './data';
import {DemoPlanningPreview,makeDemoPlan,Plan} from './AiCommand';
import {PromptEntry,PromptHistory} from './PromptHistory';
export const MAX_PROMPT_BYTES = 64 * 1024;
export const promptBytes=(text:string)=>new TextEncoder().encode(text).byteLength;
export type PromptDraft={mode:'request'|'pasted';request:string;pasted:string};
export const emptyDraft=():PromptDraft=>({mode:'request',request:'',pasted:''});
const displayText=(raw:string)=>raw.replace(/\r\n?/g,'\n');
function rawOffset(raw:string,offset:number) {
  let displayed=0;
  for(let i=0;i<raw.length;i++) {
    if(displayed===offset)return i;
    if(raw[i]==='\r'&&raw[i+1]==='\n')i++;
    displayed++;
  }
  return raw.length;
}
// Textareas normalize line endings. Splice only the edited range into the raw draft.
function applyDisplayEdit(raw:string,next:string) {
  const previous=displayText(raw);let start=0,end=0;
  while(start<previous.length&&start<next.length&&previous[start]===next[start])start++;
  while(end<previous.length-start&&end<next.length-start&&previous[previous.length-1-end]===next[next.length-1-end])end++;
  return raw.slice(0,rawOffset(raw,start))+next.slice(start,next.length-end)+raw.slice(rawOffset(raw,previous.length-end));
}
export function promptMetadata(text:string) {
  const field=(name:string)=>text.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`,'mi'))?.[1].trim();
  return {agent:field('Agent'),model:field('Model')};
}
async function copyText(text:string) {
  if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);
}
export function NodeCommandPanel({project,repository,task,tasks,draft,change,entries,save,initialTab='任務資訊'}:{
  project:string;repository?:string;task:DemoTask;tasks:DemoTask[];draft:PromptDraft;
  change:(draft:PromptDraft)=>void;entries:PromptEntry[];save:(entry:Omit<PromptEntry,'id'>)=>void;
  initialTab?:'任務資訊'|'AI 指令';
}) {
  const [active,setActive]=useState<'任務資訊'|'AI 指令'|'Prompt 紀錄'>(initialTab); const [plan,setPlan]=useState<Plan|null>(null);
  const [feedback,setFeedback]=useState<{error:boolean;text:string}|null>(null);
  const tabs=['任務資訊','AI 指令','Prompt 紀錄'] as const;
  const content=draft[draft.mode];const bytes=promptBytes(content);const tooLarge=bytes>MAX_PROMPT_BYTES;
  const valid=Boolean(content.trim())&&!tooLarge;
  const source=draft.mode==='pasted'?'USER_PASTED_UNVERIFIED':'USER_DRAFT_UNVERIFIED';
  useEffect(()=>{setPlan(null);setFeedback(null);},[draft.request,draft.pasted,draft.mode]);
  const copy=async(text:string)=>{try{await copyText(text);setFeedback({error:false,text:'已複製 Prompt'});}catch{setFeedback({error:true,text:'複製失敗，請手動選取原文複製。'});}};
  const context=()=>[
    `Project: ${project}`,`Repository: ${repository ?? 'Not available'}`,`Task: ${task.title}`,`PR/Task: ${task.reference}`,`Branch: ${task.branch}`,
    `Dependencies: ${task.dependencies.map(id=>tasks.find(t=>t.id===id)?.reference??id).join(', ')}`,
    `Source: ${task.source==='historical'?'GitHub bounded snapshot':'LOCAL DEMO'}`,`Status: ${task.status}`,
    `Last checked: ${task.provenance?.observedAt ?? '本次工作階段 / DEMO'}`,
    ...(task.provenance?[`Source URL: ${task.provenance.url}`,`Snapshot Head: ${task.provenance.headSha}`,`Snapshot Base: ${task.provenance.baseBranch} ${task.provenance.baseSha}`]:[]),
    `Missing information / 缺少資訊: 即時狀態、Agent/Model、執行與核准權限${repository?'':'、Repository'}`,
    'REAL_AGENT_EXECUTION = NOT_AUTHORIZED',
  ].join('\n');
  const copyContext=async()=>{try{await copyText(context());setFeedback({error:false,text:'已複製專案／節點上下文'});}catch{setFeedback({error:true,text:'複製失敗，請手動選取上下文複製。'});}};
  const edit=(value:string)=>change({...draft,[draft.mode]:value});
  // User-initiated paste only. Preserve the raw clipboard text, including CRLF; no clipboard reads outside this event.
  const paste=(e:ClipboardEvent<HTMLTextAreaElement>)=>{
    const raw=e.clipboardData.getData('text/plain');e.preventDefault();
    const el=e.currentTarget;
    edit(content.slice(0,rawOffset(content,el.selectionStart))+raw+content.slice(rawOffset(content,el.selectionEnd)));
  };
  return <aside className="p-detail p-node-command" role="region" aria-label="節點指令面板">
    <p className="p-eyebrow">PROJECT / NODE WORKSPACE</p><h2>{task.title}</h2>
    <div className="p-prompt-context"><strong>{project}</strong><span>{task.reference} · {task.status}</span><span className="p-code">{task.branch}</span><small>{task.source==='historical'?`GitHub 快照 ${TOPOLOGY_DATE} · 未即時查詢`:'LOCAL DEMO · 非 GitHub 任務'}</small></div>
    <div role="tablist" aria-label="節點操作" className="p-node-tabs">{tabs.map((name,index)=><button key={name} role="tab" aria-selected={active===name} aria-controls="node-tab-content" tabIndex={active===name?0:-1} onClick={()=>setActive(name as typeof active)} onKeyDown={e=>{
      let next=index;if(e.key==='ArrowRight')next=(index+1)%3;else if(e.key==='ArrowLeft')next=(index+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;else return;
      e.preventDefault();setActive(tabs[next] as typeof active);(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next])?.focus();
    }}>{name}</button>)}</div>
    {feedback&&<p role={feedback.error?'alert':'status'} className="p-copy-feedback">{feedback.text}</p>}
    <div id="node-tab-content" role="tabpanel" aria-label={active}>
      {active==='任務資訊'&&<><p className="p-muted">{task.description}</p><dl className="p-info-list"><div><dt>PR / Task</dt><dd>{task.reference}</dd></div><div><dt>Repository</dt><dd>{repository??'Not available'}</dd></div><div><dt>依賴</dt><dd>{task.dependencies.map(id=>tasks.find(t=>t.id===id)?.reference??id).join('、')}</dd></div><div><dt>Agent / Model</dt><dd>Not available</dd></div><div><dt>最後查詢</dt><dd>{task.provenance?.observedAt??'本次工作階段 / DEMO'}</dd></div></dl>
        {task.provenance&&<details className="p-provenance"><summary>快照來源與精確版本</summary><p><a href={task.provenance.url} target="_blank" rel="noreferrer">{task.provenance.url}</a></p><p>Base: {task.provenance.baseSha}</p><p>Head: {task.provenance.headSha}</p><p>讀回: {task.provenance.observedAt} · 未即時查詢</p></details>}
        <button className="p-secondary" onClick={()=>void copyContext()}>複製專案／節點上下文</button></>}
      {active==='AI 指令'&&<><div className="p-input-modes"><button aria-pressed={draft.mode==='request'} onClick={()=>change({...draft,mode:'request'})}>輸入新需求</button><button aria-pressed={draft.mode==='pasted'} onClick={()=>change({...draft,mode:'pasted'})}>貼入 Control Plane Prompt</button></div>
        <span className="p-pill">{source}</span><p className="p-muted">{draft.mode==='pasted'?'手動貼入完整 Prompt；來源未驗證，不代表 ChatGPT 自動產出或核准。':'輸入繁體中文需求，僅供本地整理與人工交接。'}</p>
        <label className="p-field">你的指令<textarea aria-label="你的指令" value={content} onChange={e=>edit(applyDisplayEdit(content,e.target.value))} onPaste={paste} rows={8}/></label>
        <p className="p-source">{bytes.toLocaleString()} bytes / 64 KiB UTF-8 · 超過上限時保留原文並阻止操作，不截斷。</p>
        {tooLarge&&<p role="alert" className="p-copy-feedback">內容超過 64 KiB 安全上限，請自行縮減後再保存或複製。</p>}
        <div className="p-panel-actions"><button className="p-secondary" disabled={!valid} onClick={()=>{if(valid){save({content,source,state:draft.mode==='pasted'?'Imported':'Draft',createdAt:new Date().toISOString(),...promptMetadata(content)});setFeedback({error:false,text:'已加入此節點的 Prompt 紀錄'});}}}>加入 Prompt 紀錄</button><button className="p-secondary" disabled={!valid} onClick={()=>void copy(content)}>複製 Prompt</button></div>
        {draft.mode==='request'&&<><button className="p-primary" disabled={!valid} onClick={()=>setPlan(makeDemoPlan(content,project,task))}>產生示範規劃</button><DemoPlanningPreview plan={plan} reference={task.reference}/></>}
        <p className="p-muted">本次工作階段暫存，重新整理後清除。</p></>}
      {active==='Prompt 紀錄'&&<PromptHistory entries={entries} copy={copy}/>}
    </div>
    <div className="p-execution-boundary"><button className="p-primary" disabled>Execute with Agent</button><small>B0.2 未授權真實 agent 執行。貼入內容不授予執行或核准權限，不自動呼叫 ChatGPT／Codex／Claude。</small></div>
  </aside>;
}
