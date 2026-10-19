// V1.2C GitHub connection UI tests. All responses come from deterministic MOCK handlers in this file over SYNTHETIC projects;
// this is not live-server, real GitHub, real data or Safari evidence. The real server is tested in test/v1-2-github-connection.test.mjs.
import {readFileSync} from 'node:fs';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,test,vi} from 'vitest';
import {ReadOnlyCommandCenter} from './ReadOnlyCommandCenter';
import {ManageProjects} from './ManageProjects';
import {githubAuthorizationsFor} from '../prototype/gitHistoryModel';
import {initialProjects,initialAttentionItems,initialNextBestAction,initialExecutionSnapshot} from '../mockData';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const PM='augusliang23-web/pm-dashboard';
const flush=()=>act(async()=>{await Promise.resolve();await new Promise(r=>setTimeout(r,0));});
const base=(id:string,over:Record<string,unknown>={})=>{const {dataMode:_d,...p}={...initialProjects[0],id,name:`SYN ${id}`,repository:'',...over} as Record<string,unknown>;return 'dataMode' in over?{...p,dataMode:over.dataMode}:p;};
const conn=(repository:string,over:Record<string,unknown>={})=>({lifecycle:'active',githubConnection:{status:'connected',repository,generation:1,source:'user-verified',connectedAt:'2026-10-19T00:00:00.000Z',verifiedRepositoryId:5,revokedAt:null,revokedReason:null,...over}});
const revoked=(repository:string,reason:string,lifecycle='active')=>({lifecycle,githubConnection:{status:'disconnected',repository,generation:2,source:'user-verified',connectedAt:'2026-10-19T00:00:00.000Z',verifiedRepositoryId:5,revokedAt:'2026-10-19T01:00:00.000Z',revokedReason:reason}});
const saved=(projects:unknown[])=>({projects,attentionItems:initialAttentionItems,nba:initialNextBestAction,snapshot:initialExecutionSnapshot});

type Call={url:string;method:string;body?:unknown};
function mockState(projects:unknown[]){
 const calls:Call[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);calls.push({url,method:(init?.method??'GET').toUpperCase()});
  if(url==='/api/state')return Promise.resolve(new Response(JSON.stringify(saved(projects)),{status:200}));
  return new Promise<Response>(()=>{}); // history stays pending: these tests only check what is REQUESTED
 });
 return calls;
}
const history=(calls:Call[])=>calls.filter(c=>c.url.includes('/api/github/development-history'));
const card=(name:string)=>screen.getByRole('article',{name:`專案 ${name}`});
const nav=(name:string)=>fireEvent.click(within(screen.getByRole('navigation',{name:'主要頁面'})).getByRole('button',{name}));

describe('overview: connection status mirrors the server rules and never over-claims',()=>{
 test('a connected project is eligible, says "Connected" and Not checked, and its read is bound to its project id',async()=>{
  const calls=mockState([base('p1',{repository:'synthetic-owner/app',management:conn('synthetic-owner/app')})]);
  render(<ReadOnlyCommandCenter/>);await flush();
  const c=card('SYN p1');
  expect(c).toHaveTextContent('Connected（已核准連線） · Not checked');expect(c).not.toHaveTextContent(/LIVE|已讀取|Healthy deployment/);
  fireEvent.click(within(c).getByRole('button',{name:'開啟開發地圖'}));await flush();
  expect(history(calls).map(h=>h.url)).toEqual(['/api/github/development-history?repo=synthetic-owner%2Fapp&projectId=p1']);
 });
 test.each([
  ['disconnected','已中斷 GitHub 連線'],['archived','封存時已撤銷'],['removed','移除時已撤銷'],
 ])('a %s connection is Not connected with its reason, and nothing is requested',async(reason,text)=>{
  const calls=mockState([base('p1',{repository:'synthetic-owner/app',management:revoked('synthetic-owner/app',reason)})]);
  render(<ReadOnlyCommandCenter/>);await flush();
  expect(card('SYN p1')).toHaveTextContent(text);expect(within(card('SYN p1')).queryByRole('button',{name:'開啟開發地圖'})).toBeNull();
  nav('開發地圖');await flush();expect(history(calls)).toHaveLength(0);
 });
 test('an archived project keeps its saved connection out of the overview and the map, with no request',async()=>{
  const calls=mockState([base('p1',{repository:'synthetic-owner/app',management:{...conn('synthetic-owner/app'),lifecycle:'archived'}}),base('p2')]);
  render(<ReadOnlyCommandCenter/>);await flush();
  expect(screen.queryByRole('article',{name:'專案 SYN p1'})).toBeNull();nav('開發地圖');await flush();expect(history(calls)).toHaveLength(0);
 });
 test('a hand-edited record for another repository, two claimants of one repository, or a demo record are never eligible',()=>{
  const projects=[
   base('a',{repository:'synthetic-owner/x',management:conn(PM)}),
   base('b',{repository:'synthetic-owner/dup',management:conn('synthetic-owner/dup')}),base('c',{repository:'synthetic-owner/dup',management:conn('synthetic-owner/dup')}),
   base('d',{repository:'synthetic-owner/demo',dataMode:'demo',management:conn('synthetic-owner/demo')}),
   base('e',{repository:'synthetic-owner/e',management:{lifecycle:'active',githubConnection:{status:'connected'}}}),
  ];
  expect(githubAuthorizationsFor(projects)).toEqual([null,null,null,null,null]);
 });
 test('the unique legacy PM Dashboard record stays eligible under the documented compatibility rule',async()=>{
  const calls=mockState([base('reg-pm',{name:'PM Dashboard',repository:PM})]);
  render(<ReadOnlyCommandCenter/>);await flush();
  expect(card('PM Dashboard')).toHaveTextContent('Connected（V1.1 相容：PM Dashboard）');
  fireEvent.click(within(card('PM Dashboard')).getByRole('button',{name:'開啟開發地圖'}));await flush();
  expect(history(calls)[0].url).toBe(`/api/github/development-history?repo=${encodeURIComponent(PM)}&projectId=reg-pm`);
  expect(githubAuthorizationsFor([base('reg-pm',{repository:PM})],[base('reg-pm',{repository:'synthetic-owner/z'})])).toEqual([null]); // id reused by a removed record
 });
});

// ------------------------------------------------------------------------------------------------ 管理專案 connection flows
type Auth={projectId:string;repository:string;source:string;generation:number};
function manageBackend(initial:Record<string,unknown>[],{fail}:{fail?:(command:Record<string,unknown>)=>{status:number;body:unknown}|null}={}){
 let projects=initial;let auths:Auth[]=[];let n=0;const calls:Call[]=[];
 const json=(status:number,body:unknown)=>Promise.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));
 const version=()=>String(n).padStart(64,'0');
 vi.spyOn(globalThis,'fetch').mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);const method=(init?.method??'GET').toUpperCase();const body=typeof init?.body==='string'?JSON.parse(init.body):undefined;
  calls.push({url,method,body});
  if(url==='/api/projects')return json(200,{version:version(),projects,removed:[],githubAuthorizations:auths});
  if(url==='/api/projects/commands'&&method==='POST'){
   const injected=fail?.(body.command);if(injected)return json(injected.status,injected.body);
   if(body.expectedVersion!==version())return json(409,{error:'changed',code:'CONFLICT'});
   const c=body.command as {type:string;id:string;repository?:string};
   projects=projects.map(p=>p.id!==c.id?p:c.type==='disconnect'?{...p,management:revoked(String(p.repository),'disconnected')}:{...p,repository:c.repository,management:conn(String(c.repository))});
   auths=c.type==='disconnect'?auths.filter(a=>a.projectId!==c.id):[...auths.filter(a=>a.projectId!==c.id),{projectId:c.id,repository:String(c.repository),source:'user-verified',generation:1}];
   n+=1;return json(200,{version:version(),result:{projectId:c.id,changed:true}});
  }
  return json(500,{error:'unexpected'});
 });
 return {calls,posts:()=>calls.filter(c=>c.method==='POST')};
}
const label=(p:Record<string,unknown>)=>p.dataMode==='demo'?'DEMO · 本機 saved state':'REGISTERED · 本機 saved state';
const gh=(name:string)=>screen.getByLabelText(`GitHub 連線 ${name}`);

describe('管理專案: Connect / Disconnect / Change',()=>{
 test('connect sends ONE versioned command (never a verified identity) and shows the server-confirmed status',async()=>{
  const b=manageBackend([base('p1')]);const onChanged=vi.fn();
  render(<ManageProjects onChanged={onChanged} identityLabel={label}/>);await flush();
  expect(gh('SYN p1')).toHaveTextContent('GitHub：Not connected');
  fireEvent.click(within(gh('SYN p1')).getByRole('button',{name:/連線 GitHub/}));
  expect(gh('SYN p1')).toHaveTextContent('一次唯讀查詢');
  fireEvent.change(screen.getByLabelText('GitHub repository（owner/repo）'),{target:{value:' synthetic-owner/app '}});
  const submit=screen.getByRole('button',{name:'驗證並連線'});fireEvent.click(submit);fireEvent.click(submit);await flush();
  expect(b.posts()).toHaveLength(1);
  expect(b.posts()[0].body).toEqual({expectedVersion:'0'.repeat(64),command:{type:'connect',id:'p1',repository:'synthetic-owner/app'}});
  expect(gh('SYN p1')).toHaveTextContent('Connected · synthetic-owner/app（已由伺服器驗證） · 尚未讀取歷史');
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(b.calls.some(c=>/api\.github\.com|development-history/.test(c.url))).toBe(false);
 });
 test('a failed GitHub verification is shown, nothing changes and nothing is retried',async()=>{
  const b=manageBackend([base('p1')],{fail:()=>({status:502,body:{error:'x',code:'GITHUB_VERIFICATION_FAILED',kind:'missing'}})});
  render(<ManageProjects onChanged={vi.fn()} identityLabel={label}/>);await flush();
  fireEvent.click(within(gh('SYN p1')).getByRole('button',{name:/連線 GitHub/}));
  fireEvent.change(screen.getByLabelText('GitHub repository（owner/repo）'),{target:{value:'synthetic-owner/missing'}});
  fireEvent.click(screen.getByRole('button',{name:'驗證並連線'}));await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('無法在 GitHub 驗證這個 repository');expect(b.posts()).toHaveLength(1);
  expect(gh('SYN p1')).toHaveTextContent('GitHub：Not connected');
 });
 test('disconnect needs a confirmation dialog; Escape cancels without a request',async()=>{
  const b=manageBackend([base('p1',{repository:'synthetic-owner/app',management:conn('synthetic-owner/app')})]);
  render(<ManageProjects onChanged={vi.fn()} identityLabel={label}/>);await flush();
  // backend starts with no auths: connect state is server-driven, so seed one through a connect first
  fireEvent.click(within(gh('SYN p1')).getByRole('button',{name:/連線 GitHub/}));
  fireEvent.click(screen.getByRole('button',{name:'驗證並連線'}));await flush();
  fireEvent.click(within(gh('SYN p1')).getByRole('button',{name:/中斷 GitHub 連線/}));
  expect(screen.getByRole('dialog')).toHaveTextContent('不會修改或刪除 GitHub 上的任何東西');
  fireEvent.keyDown(window,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(gh('SYN p1')).getByRole('button',{name:/中斷 GitHub 連線/}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'確認中斷'}));await flush();
  expect(b.posts().map(p=>(p.body as {command:{type:string}}).command.type)).toEqual(['connect','disconnect']);
  expect(gh('SYN p1')).toHaveTextContent('Not connected · 已中斷（synthetic-owner/app）');
 });
 test('change requires typing the current repository and sends the confirmation with the new repository',async()=>{
  const b=manageBackend([base('p1',{repository:'synthetic-owner/app',management:revoked('synthetic-owner/app','disconnected')})]);
  render(<ManageProjects onChanged={vi.fn()} identityLabel={label}/>);await flush();
  fireEvent.click(within(gh('SYN p1')).getByRole('button',{name:/更換 repository/}));
  fireEvent.change(screen.getByLabelText('新的 GitHub repository（owner/repo）'),{target:{value:'synthetic-owner/app-v2'}});
  const submit=screen.getByRole('button',{name:'驗證並更換'});expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/請輸入目前的 repository/),{target:{value:'synthetic-owner/app'}});expect(submit).toBeEnabled();
  fireEvent.click(submit);await flush();
  expect(b.posts()[0].body).toMatchObject({command:{type:'change',id:'p1',repository:'synthetic-owner/app-v2',confirmPreviousRepository:'synthetic-owner/app'}});
  expect(gh('SYN p1')).toHaveTextContent('Connected · synthetic-owner/app-v2');
 });
 test('demo records and archived projects offer no connection controls',async()=>{
  manageBackend([base('d',{dataMode:'demo',repository:'synthetic-owner/demo'}),base('a',{management:{lifecycle:'archived'}})]);
  render(<ManageProjects onChanged={vi.fn()} identityLabel={label}/>);await flush();
  expect(gh('SYN d')).toHaveTextContent('不能連線 GitHub');expect(within(gh('SYN d')).queryAllByRole('button')).toHaveLength(0);
  fireEvent.click(screen.getByRole('tab',{name:/已封存/}));
  expect(gh('SYN a')).toHaveTextContent('還原後需要重新連線');expect(within(gh('SYN a')).queryAllByRole('button')).toHaveLength(0);
 });
});

describe('static boundary',()=>{
 test('connection UI never calls GitHub or the history API directly and never sends a verified identity',()=>{
  const code=readFileSync(`${process.cwd()}/src/v1/ManageProjects.tsx`,'utf8');
  expect(code).not.toMatch(/api\.github\.com|development-history|verified\s*:/);
 });
});
