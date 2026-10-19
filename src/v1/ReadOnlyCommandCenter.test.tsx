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
  const [a,b]=registeredFromSavedState({projects:[{id:'  ',name:PM_REPO,repository:'someone/x'},{id:'ok',name:PM_REPO,repository:''}]});
  expect(a.identity).toEqual({source:'REGISTERED',projectId:undefined,repository:'someone/x',displayName:PM_REPO,authorization:null}); // V1.2C: always projected
  expect(b.identity.source).not.toBe('REGISTERED'); // no usable repository: identity cannot be established, fail closed
 });
 test('E. only the exact allowlisted registered PM Dashboard opens the live viewer (one GET for that repository)',async()=>{
  const calls=mockFetch(state([OTHER,PM]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(within(card('Other App')).queryByRole('button',{name:'開啟開發地圖'})).toBeNull();
  fireEvent.click(within(card('PM Dashboard')).getByRole('button',{name:'開啟開發地圖'}));await flush();
  const history=calls.filter(c=>c.url.includes('/api/github/development-history'));
  expect(history).toHaveLength(1);expect(history[0].method).toBe('GET');expect(history[0].url).toContain(`repo=${encodeURIComponent(PM_REPO)}`);
  expect(screen.getByText('REGISTERED')).toBeVisible();expect(screen.getByTestId('g-source-badge')).toHaveTextContent('正在查詢'); // request pending: no read claim yet
 });
 test('F. selecting a non-allowlisted project in the map shows Not available and issues no GitHub request',async()=>{
  const calls=mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  nav('開發地圖');await flush();
  fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getByRole('button',{name:/Other App/}));await flush();
  expect(screen.getByLabelText('開發地圖不可用')).toHaveTextContent('Not available');
  expect(screen.queryByTestId('g-source-badge')).toBeNull();expect(document.body).not.toHaveTextContent(/LIVE/);
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
 // V1.2 candidate (intentional change): navigation gains "管理專案". The overview and the Development Map stay read-only.
 test('G. navigation is overview, 管理專案 and Development Map; overview and map have no AI, Prompt, Cost Guard, Demo or edit UI',async()=>{
  mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  const names=()=>within(screen.getByRole('navigation',{name:'主要頁面'})).getAllByRole('button').map(b=>b.textContent);
  expect(names()).toEqual(['專案總覽','管理專案','開發地圖']);
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
  files.push('src/v1/ManageProjects.tsx');
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

// ---------------- B1.4 review remediation: P1 explicit DEMO identity, P2 no LIVE claim before verification ----------------
const DEMO_PM=project({id:'demo-pm-1',name:'PM Dashboard',repository:PM_REPO,dataMode:'demo'});
const historyCalls=(calls:Call[])=>calls.filter(c=>c.url.includes('/api/github/development-history'));

describe('P1 explicit DEMO projects never become REGISTERED or live',()=>{
 test('a dataMode "demo" project with the exact allowlisted repository is classified DEMO and cannot open the live map',async()=>{
  const calls=mockFetch(state([DEMO_PM]));render(<ReadOnlyCommandCenter/>);await flush();
  const c=card('PM Dashboard');
  expect(c).toHaveTextContent('DEMO');expect(c).not.toHaveTextContent('REGISTERED');expect(c).not.toHaveTextContent('LIVE');expect(c).not.toHaveTextContent('GitHub 可查詢');
  expect(within(c).queryByRole('button',{name:'開啟開發地圖'})).toBeNull();
  nav('開發地圖');await flush();
  expect(historyCalls(calls)).toHaveLength(0);
  expect(screen.getByLabelText('開發地圖不可用')).toBeVisible();
 });
 test('registeredFromSavedState maps dataMode "demo" to a DEMO identity and keeps legacy projects REGISTERED',()=>{
  const [demo,legacy]=registeredFromSavedState({projects:[DEMO_PM,PM]});
  expect(demo.identity.source).toBe('DEMO');expect(legacy.identity.source).toBe('REGISTERED');expect(legacy.identity.projectId).toBe('reg-pm');
  expect(registeredFromSavedState({projects:[{...DEMO_PM,dataMode:' DEMO '}]})[0].identity.source).toBe('DEMO');
 });
 test('an unrecognised dataMode value fails closed: not REGISTERED, not live',async()=>{
  const calls=mockFetch(state([project({id:'odd',name:'Odd',repository:PM_REPO,dataMode:'sample'}),project({id:'odd2',name:'Odd2',repository:PM_REPO,dataMode:7})]));
  render(<ReadOnlyCommandCenter/>);await flush();
  for(const n of ['Odd','Odd2']){expect(card(n)).not.toHaveTextContent('REGISTERED');expect(card(n)).toHaveTextContent('身分無法確認');expect(within(card(n)).queryByRole('button',{name:'開啟開發地圖'})).toBeNull();}
  nav('開發地圖');await flush();expect(historyCalls(calls)).toHaveLength(0);
 });
 test('migration fixture provenance is not evidence of DEMO: a legacy registered PM stays eligible',async()=>{
  expect((PM as {provenance:{github:{authority:string}}}).provenance.github.authority).toBe('fixture');
  mockFetch(state([PM]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(card('PM Dashboard')).toHaveTextContent('REGISTERED');expect(within(card('PM Dashboard')).getByRole('button',{name:'開啟開發地圖'})).toBeVisible();
 });
 test('a same-name DEMO project beside the registered PM stays isolated: one history request, for the registered project only',async()=>{
  const calls=mockFetch(state([DEMO_PM,PM]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getAllByRole('button',{name:'開啟開發地圖'})).toHaveLength(1);
  nav('開發地圖');await flush();
  expect(historyCalls(calls)).toHaveLength(1);
  expect(screen.getByLabelText('資料來源')).toHaveTextContent(PM_REPO);
  const rail=within(screen.getByRole('navigation',{name:'專案（開發地圖）'}));
  fireEvent.click(rail.getAllByRole('button').find(b=>/DEMO/.test(b.getAttribute('aria-label')??''))!);await flush();
  expect(historyCalls(calls)).toHaveLength(1);expect(screen.getByLabelText('開發地圖不可用')).toBeVisible();
  expect(calls.every(c=>c.method==='GET')).toBe(true);
 });
});

describe('P2 eligibility to query is not presented as verified LIVE',()=>{
 test('the project card says 可查詢 · 尚未驗證 and does not say LIVE before any GitHub request succeeds',async()=>{
  mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  const pm=card('PM Dashboard');
  expect(pm).toHaveTextContent('GitHub 可查詢 · 尚未驗證');expect(pm).not.toHaveTextContent('LIVE');
  expect(card('Other App')).toHaveTextContent('NOT CONNECTED');expect(card('Other App')).not.toHaveTextContent('可查詢');
 });
 test('on the map page, before the GitHub response, the rail and banner make no LIVE claim from the V1 shell',async()=>{
  mockFetch(state([PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  nav('開發地圖');await flush(); // history request is still pending
  for(const b of within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getAllByRole('button'))expect(b.getAttribute('aria-label')).not.toMatch(/LIVE/);
  expect(document.querySelector('.p-live-bar')?.textContent ?? '').not.toMatch(/LIVE/);
  expect(screen.getByLabelText('資料來源')).toHaveTextContent('Not checked');
 });
});

// ---------------- V1.2B candidate: lifecycle-aware overview and honest status for projects added by 管理專案 ----------------
const managed=(over:Record<string,unknown>,management:Record<string,unknown>)=>project({...over,management});
const ADDED=managed({id:'proj-new',name:'Brand New',repository:'',health:'Attention',stage:'Prototype',currentTask:'',currentGateLabel:'Not started',lastActivity:'2026-10-19T12:00:00.000Z'},
 {schemaVersion:1,lifecycle:'active',createdAt:'2026-10-19T12:00:00.000Z',updatedAt:'2026-10-19T12:00:00.000Z',events:[{type:'added',at:'2026-10-19T12:00:00.000Z'}]});
const ARCHIVED_PM=managed({id:'reg-pm',name:'PM Dashboard',repository:PM_REPO},{schemaVersion:1,lifecycle:'archived',archivedAt:'2026-10-19T12:00:00.000Z',updatedAt:'2026-10-19T12:00:00.000Z',events:[{type:'archived',at:'2026-10-19T12:00:00.000Z'}]});

describe('V1.2B overview lifecycle filtering and placeholder honesty',()=>{
 test('archived projects leave the overview and the Development Map rail; a count points to 管理專案; no history request for them',async()=>{
  const calls=mockFetch(state([ARCHIVED_PM,OTHER]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(screen.getAllByRole('article')).toHaveLength(1);expect(screen.queryByRole('article',{name:'專案 PM Dashboard'})).toBeNull();
  expect(document.body).toHaveTextContent('另有 1 個已封存專案');
  nav('開發地圖');await flush();
  const rail=within(screen.getByRole('navigation',{name:'專案（開發地圖）'}));
  expect(rail.queryAllByRole('button').some(b=>/PM Dashboard/.test(b.textContent??''))).toBe(false);
  expect(historyCalls(calls)).toHaveLength(0);
 });
 test('when every project is archived the overview says so instead of claiming there is no saved data',async()=>{
  mockFetch(state([ARCHIVED_PM]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(screen.getByRole('status')).toHaveTextContent('目前沒有使用中的專案（全部已封存）');expect(document.body).not.toHaveTextContent('本機尚無已登記專案資料');
 });
 test('a project added by 管理專案 shows UNKNOWN / Not checked, not its legacy health placeholder, and is Not connected',async()=>{
  mockFetch(state([ADDED]));render(<ReadOnlyCommandCenter/>);await flush();
  const c=card('Brand New');
  expect(c).toHaveTextContent('健康狀態 UNKNOWN · Not checked');expect(c).toHaveTextContent('2026-10-19T12:00:00.000Z 由管理專案新增');
  expect(c).not.toHaveTextContent('Attention');expect(c).not.toHaveTextContent(/Healthy|At Risk|LIVE|GitHub 可查詢/);
  expect(c).toHaveTextContent('NOT CONNECTED');expect(within(c).queryByRole('button',{name:'開啟開發地圖'})).toBeNull();
 });
 test('a project added by 管理專案 without a repository is LOCAL · Not connected, not "identity unverifiable", and never live',async()=>{
  const calls=mockFetch(state([ADDED]));render(<ReadOnlyCommandCenter/>);await flush();
  const c=card('Brand New');
  expect(c).toHaveTextContent('LOCAL · 由管理專案新增，尚未設定 repository（Not connected）');expect(c).not.toHaveTextContent('身分無法確認');
  expect(registeredFromSavedState({projects:[ADDED]})[0].identity.source).not.toBe('REGISTERED');
  nav('開發地圖');await flush();expect(historyCalls(calls)).toHaveLength(0);
 });
 test('a repository-less record NOT created by 管理專案 still fails closed as identity unverifiable',async()=>{
  mockFetch(state([project({id:'old-norepo',name:'Old No Repo',repository:''})]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(card('Old No Repo')).toHaveTextContent('身分無法確認');expect(card('Old No Repo')).not.toHaveTextContent('LOCAL');
 });
 test('a legacy project without management metadata is unchanged: active, REGISTERED and still live-eligible',async()=>{
  mockFetch(state([PM]));render(<ReadOnlyCommandCenter/>);await flush();
  expect(card('PM Dashboard')).toHaveTextContent('REGISTERED');expect(card('PM Dashboard')).toHaveTextContent('（已儲存，未獨立驗證）');
  expect(within(card('PM Dashboard')).getByRole('button',{name:'開啟開發地圖'})).toBeVisible();
 });
 test('the 管理專案 page loads GET /api/projects only; nothing is written without an explicit action',async()=>{
  const calls=mockFetch((url)=>url==='/api/state'?{status:200,body:savedState([PM])}:url==='/api/projects'?{status:200,body:{version:'a'.repeat(64),projects:[PM],removed:[]}}:{status:500,body:{}});
  render(<ReadOnlyCommandCenter/>);await flush();nav('管理專案');await flush();
  expect(screen.getByRole('heading',{name:'管理專案'})).toBeVisible();expect(document.querySelector('.v1-bar')).toHaveTextContent('LOCAL WRITE');
  expect(calls.every(c=>c.method==='GET')).toBe(true);expect(calls.map(c=>c.url)).toEqual(['/api/state','/api/projects']);
 });
 test('static: the only write in the V1 tree is ManageProjects POST to the exact /api/projects/commands path',()=>{
  const strip=(f:string)=>readFileSync(`${process.cwd()}/${f}`,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  const manage=strip('src/v1/ManageProjects.tsx');
  expect(manage.match(/method:\s*['"](PUT|POST|DELETE|PATCH)/gi)).toEqual(["method: 'POST"]);
  expect(manage).toContain("COMMAND_URL = '/api/projects/commands'");
  expect(manage).not.toMatch(/\/api\/(state|tasks|bridge|github)|api\.github\.com/);
 });
});
