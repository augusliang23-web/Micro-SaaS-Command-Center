import {useCallback,useEffect,useRef,useState} from 'react';
import {FIXED_TARGETS} from './zc08bStatusModel.mjs';
import {statusFromGitHub,unknownStatus} from './projectStatusModel.mjs';
import {MONITOR_POLL_MS} from './liveMonitorModel.mjs';
import {formatSgt} from '../prototype/gitHistoryModel';

type Target=typeof FIXED_TARGETS[number];
type Read={body?:any;error?:boolean};
const STREAMS=['ZC-06C','ZC-07','ZC-08','ZC-09'];

/** Seven fixed PRs only; two concurrent requests, abort on leave, no hidden/offline polling.
 * 30s checks reuse the server's five-minute cache. Explicit refresh bypasses it.
 */
export function ProjectWorkstreams(){
 const [reads,setReads]=useState<Record<string,Read>>({});
 const [busy,setBusy]=useState(false);
 const [now,setNow]=useState(Date.now());
 const active=useRef<AbortController|null>(null);
 const run=useCallback(async(force=false)=>{
  if(active.current||document.visibilityState==='hidden'||!navigator.onLine)return;
  const controller=new AbortController();active.current=controller;setBusy(true);
  let cursor=0;
  const worker=async()=>{
   while(cursor<FIXED_TARGETS.length&&!controller.signal.aborted){
    const target=FIXED_TARGETS[cursor++];
    try{
     const response=await fetch(`/api/github/development-history/pull?repo=${encodeURIComponent(target.repo)}&number=${target.pr}${force?'&refresh=1':''}`,
      {method:'GET',cache:'no-store',signal:controller.signal});
     const body=await response.json();
     if(!response.ok||body.source!=='GitHub'||body.repository!==target.repo||body.number!==target.pr||
      body.pull?.headSha!==body.zcEvidence?.evidence?.head)throw Error('Unverified response');
     if(!controller.signal.aborted){setNow(Date.now());setReads(prev=>({...prev,[target.id]:{body}}));}
    }catch{
     if(!controller.signal.aborted)setReads(prev=>({...prev,[target.id]:{...prev[target.id],error:true}}));
    }
   }
  };
  try{await Promise.all([worker(),worker()]);}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 },[]);
 useEffect(()=>{
  void run();
  const timer=window.setInterval(()=>{setNow(Date.now());void run();},MONITOR_POLL_MS);
  const onReturn=()=>{setNow(Date.now());void run();};
  const offline=()=>{active.current?.abort();active.current=null;setBusy(false);
   setReads(prev=>Object.fromEntries(Object.entries(prev).map(([id,r])=>[id,{...r,error:true}])));};
  window.addEventListener('offline',offline);window.addEventListener('online',onReturn);
  document.addEventListener('visibilitychange',onReturn);
  return()=>{active.current?.abort();active.current=null;window.clearInterval(timer);
   window.removeEventListener('offline',offline);window.removeEventListener('online',onReturn);document.removeEventListener('visibilitychange',onReturn);};
 },[run]);
 const row=(target:Target)=>{
  const read=reads[target.id];
  const status=read?.error?{...unknownStatus(target,'SOURCE_UNAVAILABLE'),status:read.body?'STALE':'UNKNOWN'}:
   statusFromGitHub(target,read?.body?.zcEvidence?.evidence,now);
  const observations='codex' in status?status.codex:[];
  return <li key={target.id}>
   <a href={`https://github.com/${target.repo}/pull/${target.pr}`} target="_blank" rel="noreferrer">{target.repo.split('/')[1]} #{target.pr}</a>
   <span>Commit：<code>{status.head??'UNKNOWN'}</code></span>
   <span>CI：{'ciUrl' in status?<a href={status.ciUrl} target="_blank" rel="noreferrer">{status.ci}</a>:status.ci}</span>
   <span>Codex QA：{status.review}（未驗證無待處理 findings）</span>
   {observations?.map((r:any)=><a key={r.url} href={r.url} target="_blank" rel="noreferrer">Codex {r.state} · {r.relation} · {r.headSha.slice(0,8)}</a>)}
   <span>來源：GitHub · {status.status} · {'observedAt' in status?formatSgt(status.observedAt):'Not checked'}</span>
   <span>Agent：NOT_CONNECTED · Gate：未評定</span>
  </li>;
 };
 return <section className="v1-workstreams" aria-label="Zero-Copy workstreams">
  <header><div><h2>Zero-Copy · 四條工作線</h2><p>來源每 30 秒檢查；GitHub 快取最多 5 分鐘。CI PASS ≠ Gate 通過；審查留言不代表 findings 已解決。</p></div>
   <button type="button" disabled={busy||!navigator.onLine} onClick={()=>void run(true)}>{busy?'查詢工作線…':'刷新工作線 GitHub 證據'}</button></header>
  <div className="v1-workstream-grid">{STREAMS.map(name=><section key={name} aria-label={name}>
   <h3>{name}</h3><ul>{FIXED_TARGETS.filter(t=>t.workstream===name).map(row)}</ul>
  </section>)}</div>
 </section>;
}
