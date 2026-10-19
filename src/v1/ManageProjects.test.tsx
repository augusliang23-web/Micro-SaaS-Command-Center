// V1.2B 管理專案 UI tests. Every response comes from an in-memory MOCK backend defined below, which runs the real V1.2A pure
// commands over SYNTHETIC projects. This is not live-server, real-data or Safari evidence.
import {readFileSync} from 'node:fs';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,test,vi} from 'vitest';
import {ManageProjects,parseProjectsResponse} from './ManageProjects';
import {initialProjects} from '../mockData';
import {applyProjectCommand} from '../../server/projectManagementCommands.mjs';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const flush=()=>act(async()=>{await Promise.resolve();await new Promise(r=>setTimeout(r,0));});
const synthetic=(id:string,over:Record<string,unknown>={})=>({...initialProjects[0],id,name:`SYN ${id}`,repository:`synthetic-owner/${id}`,tags:['t'],stage:'Beta',tagline:'synthetic',...over});

type Call={url:string;method:string;body:unknown;headers:Record<string,string>};
/** In-memory backend with the real command semantics, a version counter and optional injected refusals. */
function backend(initial:Record<string,unknown>[]|null,{fail}:{fail?:(command:Record<string,unknown>,n:number)=>{status:number;body:unknown}|'network'|null}={}){
 let state:Record<string,unknown>|null=initial===null?null:{projects:initial,attentionItems:[],nba:{},snapshot:{}};
 let n=0;const version=()=>String(n).padStart(64,'0');const calls:Call[]=[];let posts=0;
 const json=(status:number,body:unknown)=>Promise.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));
 vi.spyOn(globalThis,'fetch').mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);const method=(init?.method??'GET').toUpperCase();
  const body=typeof init?.body==='string'?JSON.parse(init.body):undefined;
  calls.push({url,method,body,headers:Object.fromEntries(Object.entries((init?.headers??{}) as Record<string,string>))});
  if(url==='/api/projects'&&method==='GET'){
   if(!state)return json(404,{error:'No saved state yet.',code:'NO_STATE'});
   const pm=state.projectManagement as {removed?:unknown[]}|undefined;
   return json(200,{version:version(),projects:state.projects,removed:(pm?.removed??[]).map((e)=>({...(e as object),previousLifecycle:(e as {previousLifecycle?:string}).previousLifecycle??null}))});
  }
  if(url==='/api/projects/commands'&&method==='POST'){
   posts+=1;
   const injected=fail?.(body.command,posts);
   if(injected==='network')return Promise.reject(new TypeError('network'));
   if(injected)return json(injected.status,injected.body);
   if(!state)return json(404,{error:'No saved state yet.',code:'NO_STATE'});
   if(body.expectedVersion!==version())return json(409,{error:'changed',code:'CONFLICT',currentVersion:version()});
   const {confirmProjectId:_c,...command}=body.command;
   try{
    const out=applyProjectCommand(state,command,{now:'2026-10-19T12:00:00.000Z',newId:()=>`proj-new-${n}`});
    if(out.state!==state){state=out.state;n+=1;}
    return json(200,{version:version(),result:out.result});
   }catch(e){const err=e as {code:string;message:string};return json(err.code==='NOT_FOUND'?404:err.code.startsWith('INVALID')||err.code==='FIELD_NOT_EDITABLE'?400:409,{error:err.message,code:err.code});}
  }
  return json(500,{error:'unexpected'});
 });
 return {calls,posts:()=>calls.filter(c=>c.method==='POST'),current:()=>state,bump:()=>{n+=1;}};
}
const label=(p:Record<string,unknown>)=>p.dataMode==='demo'?'DEMO · 本機 saved state':'REGISTERED · 本機 saved state';
const mount=(onChanged=vi.fn())=>{render(<ManageProjects onChanged={onChanged} identityLabel={label}/>);return onChanged;};
const row=(name:string)=>screen.getByRole('article',{name:`管理 ${name}`});
const tab=(name:RegExp)=>fireEvent.click(screen.getByRole('tab',{name}));
const type=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});

describe('loading: explicit absence, no demo fallback',()=>{
 test('missing saved state shows Not available, no add button and never a POST',async()=>{
  const b=backend(null);mount();await flush();
  expect(screen.getByRole('status')).toHaveTextContent('不會自動建立檔案，也不會產生範例專案');
  expect(screen.queryByRole('button',{name:/新增專案/})).toBeNull();expect(b.posts()).toHaveLength(0);
  for(const p of initialProjects)expect(document.body).not.toHaveTextContent(p.name);
 });
 test.each([
  ['missing version',{projects:[],removed:[]}],
  ['incomplete project',{version:'x',projects:[{id:'a',name:'half'}],removed:[]}],
  ['malformed removed entry',{version:'x',projects:[],removed:[{project:{id:'a'}}]}],
 ])('an invalid read model (%s) is unavailable',(_n,body)=>{expect(parseProjectsResponse(body).status).toBe('unavailable');});
 test('a server error is shown as unavailable without inventing projects',async()=>{
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({error:'x',code:'CORRUPT_STATE'}),{status:500}));
  mount();await flush();expect(screen.getByRole('alert')).toHaveTextContent('無法安全讀取');expect(screen.queryAllByRole('article')).toHaveLength(0);
 });
});

describe('Add / Edit / Archive / Restore / Remove / Recover',()=>{
 test('add sends ONE versioned JSON command, shows the project after the confirmed save and notifies the overview',async()=>{
  const b=backend([synthetic('a')]);const onChanged=mount();await flush();
  fireEvent.click(screen.getByRole('button',{name:/新增專案/}));
  type('專案名稱（必填）','Fresh One');type('標籤（以逗號分隔）','x, y');type('GitHub repository（選填，格式 owner/repo）',' synthetic-owner/fresh ');
  const submit=screen.getByRole('button',{name:'新增並儲存'});
  fireEvent.click(submit);fireEvent.click(submit);await flush();
  expect(b.posts()).toHaveLength(1);
  expect(b.posts()[0].headers).toEqual({'Content-Type':'application/json'});
  expect(b.posts()[0].body).toEqual({expectedVersion:'0'.repeat(64),command:{type:'add',input:{name:'Fresh One',tagline:'',stage:'Prototype',tags:['x','y'],repository:'synthetic-owner/fresh'}}});
  expect(row('Fresh One')).toHaveTextContent('synthetic-owner/fresh');expect(screen.getByRole('status')).toHaveTextContent('已新增專案並儲存');
  expect(onChanged).toHaveBeenCalledTimes(1);
 });
 test('edit sends only changed presentation fields; repository is shown read-only', async()=>{
  const b=backend([synthetic('a')]);mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/編輯/}));
  expect(within(row('SYN a')).getByText(/不能在這裡變更/)).toBeVisible();
  expect(within(row('SYN a')).queryByLabelText(/repository/i)).toBeNull();
  type('專案名稱（必填）','Renamed');fireEvent.click(screen.getByRole('button',{name:'儲存變更'}));await flush();
  expect(b.posts()[0].body).toMatchObject({command:{type:'edit',id:'a',patch:{name:'Renamed'}}});
  expect(Object.keys((b.posts()[0].body as {command:{patch:object}}).command.patch)).toEqual(['name']);
  expect(row('Renamed')).toBeVisible();
 });
 test('an edit with no change sends nothing',async()=>{
  const b=backend([synthetic('a')]);mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/編輯/}));fireEvent.click(screen.getByRole('button',{name:'儲存變更'}));await flush();
  expect(b.posts()).toHaveLength(0);expect(screen.getByRole('status')).toHaveTextContent('沒有任何變更');
 });
 test('archive moves a project to 已封存 with its id kept; restore brings it back',async()=>{
  const b=backend([synthetic('a'),synthetic('b')]);mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/封存/}));await flush();
  expect(screen.queryByRole('article',{name:'管理 SYN a'})).toBeNull();
  tab(/已封存（1）/);expect(row('SYN a')).toHaveTextContent('ID a');
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/還原/}));await flush();
  tab(/使用中（2）/);expect(row('SYN a')).toBeVisible();
  expect(b.posts().map(p=>(p.body as {command:{type:string}}).command.type)).toEqual(['archive','restore']);
 });
 test('remove needs the exact name typed, explains nothing external is deleted, and recover brings the record back',async()=>{
  const b=backend([synthetic('a')]);mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/移除/}));
  const dialog=screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('不會刪除 GitHub repository、分支、PR、本機程式碼、雲端資源');
  const confirm=within(dialog).getByRole('button',{name:'確認移除'});
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText(/請輸入專案名稱/),{target:{value:'SYN '}});expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText(/請輸入專案名稱/),{target:{value:'SYN a'}});expect(confirm).toBeEnabled();
  fireEvent.click(confirm);await flush();
  expect(b.posts()[0].body).toMatchObject({command:{type:'remove',id:'a',confirmProjectId:'a'}});
  expect(screen.queryByRole('dialog')).toBeNull();
  tab(/已移除（1）/);expect(row('SYN a')).toHaveTextContent('移除時間');
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/救回/}));await flush();
  tab(/使用中（1）/);expect(row('SYN a')).toBeVisible();
 });
 test('Escape closes the remove dialog without sending anything',async()=>{
  const b=backend([synthetic('a')]);mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/移除/}));fireEvent.keyDown(window,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();expect(b.posts()).toHaveLength(0);
 });
 test('demo records are visibly untrusted and stay demo after an action',async()=>{
  const b=backend([synthetic('d',{dataMode:'demo',repository:'github.com/my-org/demo'})]);mount();await flush();
  expect(row('SYN d')).toHaveTextContent('此紀錄不是已登記專案（DEMO');
  fireEvent.click(within(row('SYN d')).getByRole('button',{name:/封存/}));await flush();
  expect(((b.current()!.projects as Record<string,unknown>[])[0]).dataMode).toBe('demo');
 });
});

describe('labels',()=>{
 test('a LOCAL label (owner-added, no repository) is not shown as untrusted; an unverifiable one is',async()=>{
  backend([synthetic('l',{repository:''}),synthetic('u',{repository:''})]);
  render(<ManageProjects onChanged={vi.fn()} identityLabel={(p)=>p.id==='l'?'LOCAL · 由管理專案新增，尚未設定 repository（Not connected）':'身分無法確認（…），已封閉'}/>);await flush();
  expect(row('SYN l')).not.toHaveTextContent('此紀錄不是已登記專案');expect(row('SYN u')).toHaveTextContent('此紀錄不是已登記專案');
 });
});

describe('refusals are shown, never retried, never optimistic',()=>{
 test('stale browser data: a 409 CONFLICT reloads the latest data and is not retried',async()=>{
  const b=backend([synthetic('a')]);mount();await flush();
  b.bump(); // another tab changed the file after this page read it
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/封存/}));await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('已重新載入最新資料');
  expect(b.posts()).toHaveLength(1);
  expect(b.calls.filter(c=>c.url==='/api/projects')).toHaveLength(2);
  expect(row('SYN a')).toBeVisible(); // still active: nothing pretended to succeed
 });
 test.each([
  [423,{error:'x',code:'LOCKED'},'另一個寫入正在進行'],
  [500,{error:'x',code:'WRITE_FAILED'},'存檔失敗，原本的資料沒有變更'],
  [500,{error:'x',code:'BACKUP_FAILED'},'無法先建立備份'],
  [403,{error:'x',code:'ORIGIN_REQUIRED'},'安全檢查拒絕'],
  [409,{error:'x',code:'DUPLICATE_REPOSITORY'},'另一個專案已經使用這個 repository'],
 ])('HTTP %s %o is reported and nothing is retried',async(status,body,text)=>{
  const b=backend([synthetic('a')],{fail:()=>({status,body})});const onChanged=mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/封存/}));await flush();
  expect(screen.getByRole('alert')).toHaveTextContent(text);expect(b.posts()).toHaveLength(1);expect(onChanged).not.toHaveBeenCalled();
 });
 test('a network failure is not treated as success; the page reloads to show the real state',async()=>{
  const b=backend([synthetic('a')],{fail:()=> 'network'});mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/封存/}));await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('無法確認是否已儲存');expect(b.calls.filter(c=>c.url==='/api/projects')).toHaveLength(2);
 });
 test('every action button is disabled while a command is in flight',async()=>{
  backend([synthetic('a'),synthetic('b')]);
  const fetchSpy=vi.mocked(globalThis.fetch);const original=fetchSpy.getMockImplementation()!;
  fetchSpy.mockImplementation((input,init)=>String(input)==='/api/projects/commands'?new Promise<Response>(()=>{}):original(input,init));
  mount();await flush();
  fireEvent.click(within(row('SYN a')).getByRole('button',{name:/封存/}));await flush();
  for(const btn of screen.getAllByRole('button').filter(x=>!x.getAttribute('role')))expect(btn).toBeDisabled();
  expect(fetchSpy.mock.calls.filter(([u])=>String(u)==='/api/projects/commands')).toHaveLength(1);
 });
});

describe('static boundary',()=>{
 test('ManageProjects never calls GitHub, tasks, bridge or the legacy state writer',()=>{
  const code=readFileSync(`${process.cwd()}/src/v1/ManageProjects.tsx`,'utf8');
  expect(code).not.toMatch(/\/api\/(state|tasks|bridge|github)|api\.github\.com|method:\s*['"](PUT|DELETE|PATCH)/);
 });
});
