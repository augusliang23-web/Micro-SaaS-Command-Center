// V1 read-only shell tests. All fetch responses are deterministic MOCK test inputs created below; they are not live
// GitHub or live server evidence. The project fixtures borrow the shape of the repository's mock data purely so the
// existing savedState contract (`isUsableSavedState`) accepts them; they are never shown as registered truth by V1.
import {readFileSync} from 'node:fs';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,test,vi} from 'vitest';
import {ReadOnlyCommandCenter,registeredFromSavedState} from './ReadOnlyCommandCenter';
import {initialProjects,initialAttentionItems,initialNextBestAction,initialExecutionSnapshot} from '../mockData';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const PM_REPO='augusliang23-web/pm-dashboard';
const project=(over:Record<string,unknown>)=>({...initialProjects[0],...over});
const savedState=(projects:unknown[])=>({projects,attentionItems:initialAttentionItems,nba:initialNextBestAction,snapshot:initialExecutionSnapshot});
const PM=project({id:'reg-pm',name:'PM Dashboard',repository:PM_REPO,blocker:'等待 UAT 核准',currentTask:'V2.3 收尾'});
const OTHER=project({id:'reg-other',name:'Other App',repository:'someone/other-app',blocker:null});

type Call={url:string;method:string};
function mockFetch(handler:(url:string,call:Call)=>{status:number;body:unknown}|'pending'|'network-error'){
 const calls:Call[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);const call={url,method:(init?.method??'GET').toUpperCase()};calls.push(call);
  const r=handler(url,call);
  if(r==='pending')return new Promise<Response>(()=>{});
  if(r==='network-error')return Promise.reject(new TypeError('network'));
  return Promise.resolve(new Response(JSON.stringify(r.body),{status:r.status,headers:{'Content-Type':'application/json'}}));
 });
 return calls;
}
const state=(projects:unknown[])=>(url:string)=>url==='/api/state'?{status:200,body:savedState(projects)}:url.startsWith('/api/github/development-history')?'pending' as const:{status:500,body:{}};
const flush=()=>act(async()=>{await Promise.resolve();await new Promise(r=>setTimeout(r,0));});
const nav=(name:string)=>fireEvent.click(within(screen.getByRole('navigation',{name:'主要頁面'})).getByRole('button',{name}));
const card=(name:string)=>screen.getByRole('article',{name:`專案 ${name}`});

describe('V1 project overview data handling',()=>{
 test('A. registered projects load from validated saved state with explicit identity, source and saved labels',async()=>{
  const calls=mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  const pm=card('PM Dashboard');
  expect(pm).toHaveTextContent('REGISTERED · 本機 saved state');expect(pm).toHaveTextContent('reg-pm');expect(pm).toHaveTextContent(PM_REPO);
  expect(pm).toHaveTextContent('等待 UAT 核准（已儲存，未獨立驗證）');expect(pm).toHaveTextContent('Not checked');
  expect(card('Other App')).toHaveTextContent('未記錄（不代表目前沒有 blocker）');
  expect(calls).toEqual([{url:'/api/state',method:'GET'}]);
 });
 test('B. missing saved state (404) shows Not available and never falls back to mock projects',async()=>{
  mockFetch(()=>({status:404,body:{error:'No saved state yet.'}}));render(<ReadOnlyCommandCenter/>);await flush();
  expect(screen.getByRole('status')).toHaveTextContent('Not available');expect(screen.queryAllByRole('article')).toHaveLength(0);
  for(const p of initialProjects)expect(document.body).not.toHaveTextContent(p.name);
 });
 test.each([
  ['malformed body',()=>({status:200,body:{projects:'nope'}})],
  ['project missing required fields',()=>({status:200,body:savedState([{id:'x',name:'Half'}])})],
  ['server error',()=>({status:500,body:{error:'boom'}})],
  ['unreachable server',()=>'network-error' as const],
 ])('C. invalid or unavailable saved state (%s) shows Not available and no registered data',async(_n,handler)=>{
  mockFetch(handler);render(<ReadOnlyCommandCenter/>);await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('Not available');expect(screen.queryAllByRole('article')).toHaveLength(0);
  for(const p of initialProjects)expect(document.body).not.toHaveTextContent(p.name);
 });
 test('C. an empty project list is Not available, not an invented portfolio',async()=>{
  mockFetch(state([]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(screen.getByRole('status')).toHaveTextContent('Not available');expect(screen.queryAllByRole('article')).toHaveLength(0);
 });
});

describe('V1 identity isolation and live allowlist',()=>{
 test('D/F. same display name with another repository, a missing repository or a duplicated id are never live',async()=>{
  const calls=mockFetch(state([
   project({id:'reg-pm-lookalike',name:'PM Dashboard',repository:'someone/pm-dashboard'}),
   project({id:'reg-norepo',name:'PM Dashboard',repository:''}),
   project({id:'dup',name:'Dup A',repository:PM_REPO}),project({id:'dup',name:'Dup B',repository:PM_REPO}),
  ]));render(<ReadOnlyCommandCenter/>);await flush();
  const cards=screen.getAllByRole('article');expect(cards).toHaveLength(4);
  for(const c of cards){expect(c).toHaveTextContent('NOT CONNECTED');expect(within(c).queryByRole('button',{name:'開啟開發地圖'})).toBeNull();}
  expect(card('Dup A')).toHaveTextContent('Not available（缺少或重複');
  nav('開發地圖');await flush();
  expect(calls.filter(c=>c.url.includes('development-history'))).toHaveLength(0);
 });
 test('D. registered identity is built from id + repository only, REGISTERED, and a display name cannot confer a repository',()=>{
  const [a]=registeredFromSavedState({projects:[{id:'  ',name:PM_REPO,repository:''}]});
  expect(a.identity).toEqual({source:'REGISTERED',projectId:undefined,repository:undefined,displayName:PM_REPO});
 });
 test('E. only the exact allowlisted registered PM Dashboard opens the live viewer (one GET for that repository)',async()=>{
  const calls=mockFetch(state([OTHER,PM]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(within(card('Other App')).queryByRole('button',{name:'開啟開發地圖'})).toBeNull();
  fireEvent.click(within(card('PM Dashboard')).getByRole('button',{name:'開啟開發地圖'}));await flush();
  const history=calls.filter(c=>c.url.includes('/api/github/development-history'));
  expect(history).toHaveLength(1);expect(history[0].method).toBe('GET');expect(history[0].url).toContain(`repo=${encodeURIComponent(PM_REPO)}`);
  expect(screen.getByText('REGISTERED · LIVE GITHUB READ-ONLY')).toBeVisible();
 });
 test('F. selecting a non-allowlisted project in the map shows Not available and issues no GitHub request',async()=>{
  const calls=mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  nav('開發地圖');await flush();
  fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getByRole('button',{name:/Other App/}));await flush();
  expect(screen.getByLabelText('開發地圖不可用')).toHaveTextContent('Not available');
  expect(document.body).not.toHaveTextContent('LIVE GITHUB READ-ONLY 唯讀歷史圖');
  expect(calls.filter(c=>c.url.includes('development-history')).every(c=>c.url.includes(encodeURIComponent(PM_REPO)))).toBe(true);
  expect(calls.some(c=>c.url.includes('someone'))).toBe(false);
 });
 test('F. with no registered projects the Development Map page is Not available',async()=>{
  const calls=mockFetch(()=>({status:404,body:{error:'No saved state yet.'}}));render(<ReadOnlyCommandCenter/>);await flush();
  nav('開發地圖');await flush();expect(screen.getByRole('status')).toHaveTextContent('Not available');
  expect(calls.every(c=>c.url==='/api/state')).toBe(true);
 });
});

describe('V1 feature isolation and read-only frontend',()=>{
 test('G. normal navigation has only the overview and the Development Map, with no AI, Prompt or Cost Guard Demo UI',async()=>{
  mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  const names=()=>within(screen.getByRole('navigation',{name:'主要頁面'})).getAllByRole('button').map(b=>b.textContent);
  expect(names()).toEqual(['專案總覽','開發地圖']);
  // Negative disclaimers ("無 AI 對話、Prompt 或 agent 執行") are allowed; no control, tab or demo surface may exist.
  const forbidden=[/AI 指令/,/Prompt/,/Cost Guard/i,/DEMO/,/新增/,/進入工作區/,/執行/];
  const check=()=>{
   for(const f of forbidden)for(const el of [...screen.queryAllByRole('button'),...screen.queryAllByRole('tab'),...screen.queryAllByRole('link')])expect(el.textContent??'').not.toMatch(f);
   expect(document.body.textContent).not.toMatch(/DEMO DATA|Cost Guard|AI 指令|加入 Prompt 紀錄/i);
  };
  check();nav('開發地圖');await flush();check();nav('專案總覽');await flush();check();
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
 });
 test('G. the V1 entry does not import or mount demo, AI or legacy-app sources',()=>{
  const files=['src/main.tsx','src/v1/ReadOnlyCommandCenter.tsx','src/prototype/GitDevelopmentMap.tsx','src/prototype/gitHistoryModel.ts','src/prototype/gitHistoryTypes.ts'];
  const imports=files.flatMap(f=>[...readFileSync(`${process.cwd()}/${f}`,'utf8').matchAll(/^\s*import[^;]*?from\s+['"]([^'"]+)['"]/gms)].map(m=>`${f} -> ${m[1]}`));
  for(const banned of ['NodeCommandPanel','AiCommand','PromptHistory','CostGuard','PrototypeShell','prototype/data','mockData','/App','./App'])
   expect(imports.filter(i=>i.includes(banned)),`${banned} must not be imported`).toEqual([]);
  expect(readFileSync(`${process.cwd()}/src/main.tsx`,'utf8')).toContain('ReadOnlyCommandCenter');
 });
 test('H. opening V1 and moving between overview and map issues only GET requests to the two read endpoints',async()=>{
  const calls=mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  nav('開發地圖');await flush();nav('專案總覽');await flush();
  fireEvent.click(within(card('PM Dashboard')).getByRole('button',{name:'開啟開發地圖'}));await flush();
  fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));await flush();
  expect(calls.length).toBeGreaterThan(1);
  for(const c of calls){expect(c.method).toBe('GET');expect(c.url.startsWith('/api/state')||c.url.startsWith('/api/github/development-history')).toBe(true);}
  expect(calls.some(c=>/\/api\/(tasks|bridge)/.test(c.url))).toBe(false);
 });
 test('H. the V1 sources contain no write-capable HTTP calls',()=>{
  for(const f of ['src/v1/ReadOnlyCommandCenter.tsx','src/prototype/GitDevelopmentMap.tsx']){
   const code=readFileSync(`${process.cwd()}/${f}`,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
   expect(code).not.toMatch(/method:\s*['"](?:PUT|POST|DELETE|PATCH)/i);expect(code).not.toMatch(/\/api\/(tasks|bridge)/);
  }
 });
});
