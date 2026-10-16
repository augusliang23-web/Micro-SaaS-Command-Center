import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import App from './App';
import {PrototypeShell} from './prototype/PrototypeShell';
import {initialProjects,initialAttentionItems,initialNextBestAction,initialExecutionSnapshot} from './mockData';
import {githubSnapshot} from './test/githubSnapshots.mjs';

beforeEach(()=>window.history.replaceState(null,'','/?mode=demo'));
afterEach(()=>{cleanup();vi.restoreAllMocks();window.history.replaceState(null,'','/');});
const nav=(name:string)=>fireEvent.click(within(screen.getByRole('navigation',{name:'主要頁面'})).getByRole('button',{name}));
const workspace=(name='Micro-SaaS Command Center')=>{nav('專案總覽');fireEvent.click(within(screen.getByRole('article',{name:`${name} 示範專案`})).getByRole('button',{name:'進入工作區'}));};
const node=(title=/pending action foundation/i)=>fireEvent.click(screen.getByRole('button',{name:title}));
const tab=(name='AI 指令')=>fireEvent.click(screen.getByRole('tab',{name}));
const input=(text:string)=>fireEvent.change(screen.getByLabelText('你的指令'),{target:{value:text}});
const save=()=>fireEvent.click(screen.getByRole('button',{name:'加入 Prompt 紀錄'}));
const full='Agent: Codex\nModel: GPT-6 Sol\n- Reasoning Effort: Medium\nGitHub Issue: #32\n\n任務：修改節點。\nDo NOT execute agents.\nSafety: no provider calls\nAcceptance: all tests pass\n';
const clipboard=(reject=false)=>{const writeText=vi.fn(async(_text:string)=>{if(reject)throw Error('denied');});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});return writeText;};

test('global navigation adds the read-only development map; workspace capabilities stay on project cards',()=>{
 render(<App/>);expect(within(screen.getByRole('navigation',{name:'主要頁面'})).getAllByRole('button').map(b=>b.textContent)).toEqual(['專案總覽','開發地圖','Cost Guard']);
 for(const name of ['PM Dashboard','SwipeRight','SaaS Cost Guard','ProSync','Micro-SaaS Command Center'])expect(screen.getByRole('article',{name:`${name} 示範專案`})).toHaveTextContent('進入工作區');
 workspace();expect(screen.getByRole('region',{name:'開發分支圖'})).toBeVisible();expect(screen.getByRole('button',{name:'返回專案總覽'})).toBeVisible();
});

test('workspace is project scoped and no Command Center PR is inherited by SwipeRight',()=>{
 render(<App/>);workspace('SwipeRight');expect(screen.getByRole('heading',{name:'SwipeRight 工作區'})).toBeVisible();
 for(const n of [25,26,27,28,30])expect(screen.queryByRole('button',{name:new RegExp(`PR #${n}`)})).not.toBeInTheDocument();
 expect(screen.getByText(/此專案尚未取得已查詢拓樸/)).toBeVisible();
});

test('known stack, independent PR30 and DEMO parallel branches remain accurate',()=>{
 render(<App/>);workspace();
 for(const edge of ['PR #25 → PR #26（歷史依賴）','PR #26 → PR #27（歷史依賴）','PR #27 → PR #28（歷史依賴）','main → PR #30（歷史依賴）','main → DEMO-COST-01（DEMO）'])expect(screen.getByLabelText(edge)).toBeInTheDocument();
 expect(screen.queryByLabelText('PR #28 → PR #30（歷史依賴）')).not.toBeInTheDocument();
 expect(screen.getByText(/沒有合併紀錄/)).toBeVisible();
});

test('all nodes show complete task titles and unqueried or demo status',()=>{
 render(<App/>);workspace();const graph=screen.getByRole('region',{name:'開發分支圖'});
 for(const title of [/Docker offline execution foundation/i,/real-Docker fake-agent gap tests/i,/durable execution identity/i,/pending action foundation/i,/Track B B0: Interactive Command Center UI/,/UI\/UX Development/,/Cost Guard Integration/])expect(within(graph).getByRole('button',{name:title})).toBeVisible();
 expect(within(graph).getAllByText('未即時查詢')).toHaveLength(5);expect(within(graph).getAllByText('DEMO-ONLY')).toHaveLength(2);
});

test('node selection highlights upstream dependencies only and details stay inline',()=>{
 render(<App/>);workspace();node();expect(screen.getByLabelText('PR #27 → PR #28（歷史依賴）')).toHaveAttribute('data-highlighted','true');expect(screen.getByLabelText('main → PR #30（歷史依賴）')).toHaveAttribute('data-highlighted','false');
 expect(screen.getByRole('region',{name:'節點指令面板'})).toHaveTextContent('PR #28');expect(screen.getByRole('region',{name:'開發分支圖'})).toBeVisible();
});

test('snapshot provenance source, versions and dates are retained',()=>{
 render(<App/>);workspace();node();const panel=screen.getByRole('region',{name:'節點指令面板'});fireEvent.click(within(panel).getByText('快照來源與精確版本'));
 expect(within(panel).getByRole('link')).toHaveAttribute('href','https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/28');expect(panel).toHaveTextContent('cf7fc7db9ebdef236a0d2f72a2399fca644ad755');expect(panel).toHaveTextContent('2026-10-10T23:43:21Z');
});

test('workflow A Chinese node command produces only a local demo preview',()=>{
 const network=vi.spyOn(globalThis,'fetch');render(<App/>);workspace();node();tab();input('幫我修改這個節點的權限檢查邏輯。');fireEvent.click(screen.getByRole('button',{name:'產生示範規劃'}));
 expect(screen.getByRole('region',{name:'規劃預覽'})).toHaveTextContent('DEMO PLANNING PREVIEW');expect(screen.getByRole('region',{name:'規劃預覽'})).toHaveTextContent('PR');expect(screen.getByRole('button',{name:'Execute with Agent'})).toBeDisabled();expect(network).not.toHaveBeenCalled();
});

test('full Control Plane prompt remains byte-for-byte unverified pasted text',()=>{
 render(<App/>);workspace();node(/Track B B0: Interactive Command Center UI/);tab();fireEvent.click(screen.getByRole('button',{name:'貼入 Control Plane Prompt'}));input(full);
 expect(screen.getByLabelText('你的指令')).toHaveValue(full);expect(screen.getByText('USER_PASTED_UNVERIFIED')).toBeVisible();save();tab('Prompt 紀錄');
 expect(screen.getByRole('region',{name:'Prompt 紀錄內容'})).toHaveTextContent('USER_PASTED_UNVERIFIED');expect(screen.getByRole('region',{name:'Prompt 紀錄內容'})).toHaveTextContent('GPT-6 Sol');
 expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue(full);
});

test('oversized paste is not silently truncated and cannot be saved, copied or planned',()=>{
 render(<App/>);workspace();node();tab();fireEvent.click(screen.getByRole('button',{name:'貼入 Control Plane Prompt'}));const text='界'.repeat(23000);input(text);
 expect(screen.getByLabelText('你的指令')).toHaveValue(text);expect(screen.getByRole('alert')).toHaveTextContent('64 KiB');expect(screen.getByRole('button',{name:'加入 Prompt 紀錄'})).toBeDisabled();expect(screen.getByRole('button',{name:'複製 Prompt'})).toBeDisabled();
});

test('two prompts attach to one node, never leak to another node, and return intact',()=>{
 render(<App/>);workspace();node();tab();input('第一個需求');save();input('第二個需求');save();tab('Prompt 紀錄');expect(screen.getAllByRole('article',{name:/Prompt \d/})).toHaveLength(2);
 node(/Track B B0: Interactive Command Center UI/);tab('Prompt 紀錄');expect(screen.queryByRole('article',{name:/Prompt \d/})).not.toBeInTheDocument();
 node();tab('Prompt 紀錄');expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue('第一個需求');expect(screen.getByLabelText('Prompt 2 原文')).toHaveValue('第二個需求');
});

test('same demo node IDs in different projects have isolated histories and drafts',()=>{
 render(<App/>);workspace('PM Dashboard');node(/UI\/UX Development/);tab();input('PM 專屬');save();workspace('SwipeRight');node(/UI\/UX Development/);tab('Prompt 紀錄');expect(screen.queryByText('PM 專屬')).not.toBeInTheDocument();
 tab();expect(screen.getByLabelText('你的指令')).toHaveValue('');workspace('PM Dashboard');node(/UI\/UX Development/);tab('Prompt 紀錄');expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue('PM 專屬');
});

test('input modes preserve separate drafts, and imported text never becomes an authenticated plan',()=>{
 render(<App/>);workspace();node();tab();input('新需求草稿');fireEvent.click(screen.getByRole('button',{name:'貼入 Control Plane Prompt'}));input(full);fireEvent.click(screen.getByRole('button',{name:'輸入新需求'}));expect(screen.getByLabelText('你的指令')).toHaveValue('新需求草稿');fireEvent.click(screen.getByRole('button',{name:'貼入 Control Plane Prompt'}));expect(screen.getByLabelText('你的指令')).toHaveValue(full);expect(screen.getByRole('button',{name:'Execute with Agent'})).toBeDisabled();
});

test('editing input or changing node invalidates the previous plan',()=>{
 render(<App/>);workspace();node();tab();input('需求 A');fireEvent.click(screen.getByRole('button',{name:'產生示範規劃'}));input('需求 B');expect(screen.queryByText('DEMO PLANNING PREVIEW')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'產生示範規劃'}));node(/Track B B0: Interactive Command Center UI/);tab();expect(screen.queryByText('DEMO PLANNING PREVIEW')).not.toBeInTheDocument();
});

test('draft and history are session memory only, no storage and no network',()=>{
 const network=vi.spyOn(globalThis,'fetch');const store=vi.spyOn(Storage.prototype,'setItem');render(<App/>);workspace();node();tab();input('私有草稿');save();nav('Cost Guard');workspace();node();tab('Prompt 紀錄');expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue('私有草稿');expect(screen.getByText('本次工作階段暫存，重新整理後清除。')).toBeVisible();expect(network).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();
});

test('clipboard requires a click and copies exact imported prompt',async()=>{
 const write=clipboard();render(<App/>);workspace();node();tab();fireEvent.click(screen.getByRole('button',{name:'貼入 Control Plane Prompt'}));input(full);expect(write).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'複製 Prompt'}));await waitFor(()=>expect(write).toHaveBeenCalledWith(full));expect(screen.getByRole('status')).toHaveTextContent('已複製');
});

test('context copy includes identity, provenance and missing authority information',async()=>{
 const write=clipboard();render(<App/>);workspace();node();fireEvent.click(screen.getByRole('button',{name:'複製專案／節點上下文'}));await waitFor(()=>expect(write).toHaveBeenCalled());const text=write.mock.calls[0][0];for(const value of ['Micro-SaaS Command Center','PR #28','PR #27','未即時查詢','缺少資訊','NOT_AUTHORIZED'])expect(text).toContain(value);
});

test('clipboard failures are visibly reported without claiming success',async()=>{
 clipboard(true);render(<App/>);workspace();node();tab();input('複製測試');fireEvent.click(screen.getByRole('button',{name:'複製 Prompt'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('複製失敗'));expect(screen.queryByText('已複製 Prompt')).not.toBeInTheDocument();
});

test('history copy uses the stored immutable content rather than the latest draft',async()=>{
 const write=clipboard();render(<App/>);workspace();node();tab();input('已保存版本');save();input('尚未保存版本');tab('Prompt 紀錄');fireEvent.click(within(screen.getByRole('article',{name:'Prompt 1'})).getByRole('button',{name:'複製 Prompt'}));await waitFor(()=>expect(write).toHaveBeenCalledWith('已保存版本'));
});

test('new task needs no PR and creates only a local demo candidate and inline editor',()=>{
 const network=vi.spyOn(globalThis,'fetch');render(<App/>);workspace('SwipeRight');fireEvent.click(screen.getByRole('button',{name:'+ 新增開發任務'}));fireEvent.change(screen.getByLabelText('任務名稱'),{target:{value:'手機體驗改善'}});fireEvent.change(screen.getByLabelText('新任務需求'),{target:{value:'改善平行分支閱讀方式'}});fireEvent.click(screen.getByRole('button',{name:'建立本地 DEMO 候選'}));
 expect(screen.getByRole('region',{name:'節點指令面板'})).toHaveTextContent('LOCAL-DEMO');expect(screen.getByLabelText('你的指令')).toHaveValue('改善平行分支閱讀方式');expect(screen.getByRole('button',{name:'Execute with Agent'})).toBeDisabled();expect(network).not.toHaveBeenCalled();
});

test('Cost Guard remains global, USD only and preserves project selection on return',()=>{
 render(<App/>);fireEvent.click(within(screen.getByRole('article',{name:'PM Dashboard 示範專案'})).getByRole('button',{name:'查看 Cost Guard'}));expect(screen.getByRole('region',{name:'專案成本詳細'})).toHaveTextContent('PM Dashboard');expect(screen.getByRole('img',{name:/USD 示範成本分布/})).toBeVisible();expect(screen.getByText(/4 \/ 5 個專案金額可用/)).toBeVisible();expect(screen.getByText(/預算告警不會自動停止花費/)).toBeVisible();nav('專案總覽');expect(screen.getByLabelText('目前專案')).toHaveValue('PM Dashboard');
});

test('missing cost values do not become zero or fabricated progress',()=>{
 render(<App/>);nav('Cost Guard');fireEvent.click(screen.getByRole('button',{name:'選擇 SwipeRight 成本'}));const d=screen.getByRole('region',{name:'專案成本詳細'});expect(d).toHaveTextContent('Not available');expect(d).not.toHaveTextContent('$0');expect(within(d).queryByRole('progressbar')).not.toBeInTheDocument();
});

test('keyboard selects node and tabs expose selected state with labeled input',async()=>{
 const user=userEvent.setup();render(<App/>);workspace();const n=screen.getByRole('button',{name:/Track B B0: Interactive Command Center UI/});for(let i=0;i<40&&document.activeElement!==n;i++)await user.tab();expect(n).toHaveFocus();await user.keyboard('{Enter}');expect(n).toHaveAttribute('aria-pressed','true');const ai=screen.getByRole('tab',{name:'AI 指令'});ai.focus();await user.keyboard('{Enter}');expect(ai).toHaveAttribute('aria-selected','true');expect(screen.getByLabelText('你的指令')).toBeVisible();
});

test('return to overview retains selection and workspace navigation does not create global editors',()=>{
 render(<App/>);workspace('PM Dashboard');fireEvent.click(screen.getByRole('button',{name:'返回專案總覽'}));expect(screen.getByLabelText('目前專案')).toHaveValue('PM Dashboard');expect(screen.queryByRole('tab',{name:'AI 指令'})).not.toBeInTheDocument();
});

test('registered portfolio handoff preserves a real project name without making costs authoritative',async()=>{
 window.history.replaceState(null,'','/');const real={...initialProjects[0],id:'registered-pm',name:'PM Dashboard',repository:'owner/pm-dashboard'};
 vi.spyOn(globalThis,'fetch').mockImplementation(async input=>({ok:true,json:async()=>String(input)==='/api/state'?{projects:[real],attentionItems:initialAttentionItems,nba:initialNextBestAction,snapshot:initialExecutionSnapshot}:githubSnapshot({state:'none'})}) as Response);
 render(<App/>);const portfolio=screen.getByRole('region',{name:'專案總覽清單'});await waitFor(()=>expect(within(portfolio).getByRole('article',{name:'PM Dashboard'})).toHaveAttribute('data-status','IDLE'));fireEvent.click(within(portfolio).getByRole('button',{name:'查看專案'}));fireEvent.click(screen.getByRole('button',{name:'關閉專案詳情'}));fireEvent.click(screen.getByRole('button',{name:'進入專案工作區'}));expect(screen.getByRole('heading',{name:'PM Dashboard 工作區'})).toBeVisible();nav('Cost Guard');expect(screen.getByRole('region',{name:'專案成本詳細'})).toHaveTextContent('DEMO DATA');
});

test('history disappears after the app session unmounts and is never a durable audit trail',()=>{
 const app=render(<App/>);workspace();node();tab();input('暫存紀錄');save();app.unmount();render(<App/>);workspace();node();tab('Prompt 紀錄');expect(screen.queryByRole('article',{name:'Prompt 1'})).not.toBeInTheDocument();
});

test('empty node input cannot save, copy or generate a plan',()=>{
 render(<App/>);workspace();node();tab();for(const name of ['加入 Prompt 紀錄','複製 Prompt','產生示範規劃'])expect(screen.getByRole('button',{name})).toBeDisabled();
});

test('manual paste preserves CRLF and trailing whitespace in copied history',async()=>{
 const write=clipboard();render(<App/>);workspace();node();tab();fireEvent.click(screen.getByRole('button',{name:'貼入 Control Plane Prompt'}));const raw='Agent: Codex\r\nModel: GPT-6 Sol\r\n\r\n 完整內容  \r\n';
 fireEvent.paste(screen.getByLabelText('你的指令'),{clipboardData:{getData:()=>raw}});save();tab('Prompt 紀錄');fireEvent.click(screen.getByRole('button',{name:'複製 Prompt'}));await waitFor(()=>expect(write).toHaveBeenCalledWith(raw));
});

test('local candidates remain private to their project and survive in-session navigation only',()=>{
 render(<App/>);workspace('SwipeRight');fireEvent.click(screen.getByRole('button',{name:'+ 新增開發任務'}));fireEvent.change(screen.getByLabelText('任務名稱'),{target:{value:'Swipe 專屬候選'}});fireEvent.change(screen.getByLabelText('新任務需求'),{target:{value:'候選需求'}});fireEvent.click(screen.getByRole('button',{name:'建立本地 DEMO 候選'}));workspace('PM Dashboard');expect(screen.queryByRole('button',{name:/Swipe 專屬候選/})).not.toBeInTheDocument();workspace('SwipeRight');expect(screen.getByRole('button',{name:/Swipe 專屬候選/})).toBeVisible();
});

test('editing after CRLF paste preserves every untouched original line ending',async()=>{
 const write=clipboard();render(<App/>);workspace();node();tab();fireEvent.click(screen.getByRole('button',{name:'貼入 Control Plane Prompt'}));const raw='Agent: Codex\r\nModel: GPT-6 Sol\r\n\r\n需求 A  \r\n';
 fireEvent.paste(screen.getByLabelText('你的指令'),{clipboardData:{getData:()=>raw}});fireEvent.change(screen.getByLabelText('你的指令'),{target:{value:raw.replace(/\r\n/g,'\n')+'追加說明'}});save();tab('Prompt 紀錄');fireEvent.click(screen.getByRole('button',{name:'複製 Prompt'}));await waitFor(()=>expect(write).toHaveBeenCalledWith(raw+'追加說明'));
});


const enterRegistered=()=>fireEvent.click(screen.getByRole('button',{name:'進入專案工作區'}));
const candidate=(title:string)=>{fireEvent.click(screen.getByRole('button',{name:'+ 新增開發任務'}));fireEvent.change(screen.getByLabelText('任務名稱'),{target:{value:title}});fireEvent.change(screen.getByLabelText('新任務需求'),{target:{value:'候選私有需求'}});fireEvent.click(screen.getByRole('button',{name:'建立本地 DEMO 候選'}));};

test('P2 regression: same-name demo cannot inherit registered repository, drafts, history or candidates',async()=>{
 window.history.replaceState(null,'','/');const real={...initialProjects[0],id:'registered-pm',name:'PM Dashboard',repository:'owner/private-pm'};
 vi.spyOn(globalThis,'fetch').mockImplementation(async input=>({ok:true,json:async()=>String(input)==='/api/state'?{projects:[real],attentionItems:initialAttentionItems,nba:initialNextBestAction,snapshot:initialExecutionSnapshot}:githubSnapshot({state:'none'})}) as Response);
 const write=clipboard();render(<App/>);await screen.findByRole('article',{name:'PM Dashboard'});fireEvent.click(within(screen.getByRole('article',{name:'PM Dashboard'})).getByRole('button',{name:'查看專案'}));fireEvent.click(screen.getByRole('button',{name:'關閉專案詳情'}));enterRegistered();node(/UI\/UX Development/);tab();input('REGISTERED UNIQUE HISTORY');save();input('REGISTERED UNSAVED DRAFT');candidate('REGISTERED CANDIDATE');
 fireEvent.click(screen.getByRole('button',{name:'返回已登記專案'}));fireEvent.click(screen.getByRole('button',{name:'體驗 DEMO 專案'}));workspace('PM Dashboard');
 expect(screen.queryByText(/owner\/private-pm/)).not.toBeInTheDocument();expect(screen.getByText('DEMO PROJECT')).toBeVisible();expect(screen.queryByRole('region',{name:'節點指令面板'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/REGISTERED CANDIDATE/})).not.toBeInTheDocument();
 node(/UI\/UX Development/);tab();expect(screen.getByLabelText('你的指令')).toHaveValue('');tab('Prompt 紀錄');expect(screen.queryByRole('article',{name:'Prompt 1'})).not.toBeInTheDocument();tab('任務資訊');fireEvent.click(screen.getByRole('button',{name:'複製專案／節點上下文'}));await waitFor(()=>expect(write).toHaveBeenCalled());expect(write.mock.calls.at(-1)?.[0]).not.toContain('owner/private-pm');expect(write.mock.calls.at(-1)?.[0]).toContain('Workspace source: DEMO');
 tab();input('DEMO UNIQUE HISTORY');save();fireEvent.click(screen.getByRole('button',{name:'返回已登記專案'}));enterRegistered();expect(screen.getByText('REGISTERED PROJECT')).toBeVisible();node(/UI\/UX Development/);tab('Prompt 紀錄');expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue('REGISTERED UNIQUE HISTORY');expect(screen.queryByText('DEMO UNIQUE HISTORY')).not.toBeInTheDocument();tab();expect(screen.getByLabelText('你的指令')).toHaveValue('REGISTERED UNSAVED DRAFT');expect(screen.getByRole('button',{name:/REGISTERED CANDIDATE/})).toBeVisible();tab('任務資訊');fireEvent.click(screen.getByRole('button',{name:'複製專案／節點上下文'}));await waitFor(()=>expect(write.mock.calls.at(-1)?.[0]).toContain('owner/private-pm'));expect(write.mock.calls.at(-1)?.[0]).toContain('registered-pm');
});

function identityFixture(projects:Array<{id?:string;name:string;repository:string}>) {
 window.history.replaceState(null,'','/');
 render(<PrototypeShell registeredOverview={remember=><>{projects.map((p,i)=><button key={i} onClick={()=>remember(p)}>選取登記專案 {i+1}</button>)}</>}/>);
}
const registered=(index:number)=>{if(screen.queryByRole('button',{name:'返回已登記專案'}))fireEvent.click(screen.getByRole('button',{name:'返回已登記專案'}));fireEvent.click(screen.getByRole('button',{name:`選取登記專案 ${index}`}));enterRegistered();};

test.each([
 ['different IDs, same repository','registered-pm-2','owner/private-pm'],
 ['same name, different repositories','registered-pm-2','owner/other-pm'],
 ['same ID, changed repository','registered-pm','owner/other-pm'],
])('registered identities separate same node IDs and restore histories: %s',(_label,id,repository)=>{
 identityFixture([{id:'registered-pm',name:'PM Dashboard',repository:'owner/private-pm'},{id,name:'PM Dashboard',repository}]);registered(1);node(/UI\/UX Development/);tab();input('FIRST PRIVATE');save();fireEvent.click(screen.getByRole('button',{name:'產生示範規劃'}));registered(2);expect(screen.queryByRole('region',{name:'節點指令面板'})).not.toBeInTheDocument();node(/UI\/UX Development/);tab();expect(screen.getByLabelText('你的指令')).toHaveValue('');expect(screen.queryByText('DEMO PLANNING PREVIEW')).not.toBeInTheDocument();input('SECOND PRIVATE');save();registered(1);node(/UI\/UX Development/);tab('Prompt 紀錄');expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue('FIRST PRIVATE');registered(2);node(/UI\/UX Development/);tab('Prompt 紀錄');expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue('SECOND PRIVATE');expect(screen.getByRole('button',{name:'Execute with Agent'})).toBeDisabled();
});

test('same-name DEMO dropdown switches identity and invalidates selection and plan',()=>{
 identityFixture([{id:'registered-pm',name:'PM Dashboard',repository:'owner/private-pm'}]);registered(1);node(/UI\/UX Development/);tab();input('REGISTERED');save();fireEvent.click(screen.getByRole('button',{name:'產生示範規劃'}));fireEvent.change(screen.getByLabelText('目前專案'),{target:{value:'PM Dashboard'}});expect(screen.queryByRole('region',{name:'節點指令面板'})).not.toBeInTheDocument();expect(screen.queryByText(/owner\/private-pm/)).not.toBeInTheDocument();expect(screen.getByText('DEMO PROJECT')).toBeVisible();node(/UI\/UX Development/);tab();expect(screen.getByLabelText('你的指令')).toHaveValue('');expect(screen.queryByText('DEMO PLANNING PREVIEW')).not.toBeInTheDocument();
});

test('missing registered repository is unavailable, never inferred from Command Center name',async()=>{
 const write=clipboard();identityFixture([{id:'known-id',name:'Micro-SaaS Command Center',repository:''}]);registered(1);expect(screen.queryByRole('button',{name:/PR #28/})).not.toBeInTheDocument();node(/UI\/UX Development/);fireEvent.click(screen.getByRole('button',{name:'複製專案／節點上下文'}));await waitFor(()=>expect(write).toHaveBeenCalled());expect(write.mock.calls[0][0]).toContain('Repository: Not available');expect(write.mock.calls[0][0]).not.toContain('augusliang23-web/Micro-SaaS-Command-Center');
});

test('missing registered project ID blocks prompt state instead of using name or repository as identity',()=>{
 identityFixture([{name:'PM Dashboard',repository:'owner/private-pm'}]);registered(1);expect(screen.getByRole('alert')).toHaveTextContent('缺少穩定專案 ID');expect(screen.queryByRole('region',{name:'開發分支圖'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'+ 新增開發任務'})).toBeDisabled();
});


test('mode toggle explicitly selects DEMO even when the display name is unchanged',()=>{
 identityFixture([{id:'registered-pm',name:'PM Dashboard',repository:'owner/private-pm'}]);registered(1);node(/UI\/UX Development/);tab();input('PRIVATE');save();fireEvent.click(screen.getByRole('button',{name:'返回已登記專案'}));fireEvent.click(screen.getByRole('button',{name:'進入 DEMO'}));expect(screen.getByLabelText('目前專案')).toHaveValue('PM Dashboard');workspace('PM Dashboard');expect(screen.getByText('DEMO PROJECT')).toBeVisible();node(/UI\/UX Development/);tab();expect(screen.getByLabelText('你的指令')).toHaveValue('');tab('Prompt 紀錄');expect(screen.queryByRole('article',{name:'Prompt 1'})).not.toBeInTheDocument();registered(1);node(/UI\/UX Development/);tab('Prompt 紀錄');expect(screen.getByLabelText('Prompt 1 原文')).toHaveValue('PRIVATE');
});

// ---------------- Track B B1 · live read-only PM Dashboard development map ----------------
import {formatSgt,liveRepositoryFor,stackParent,stackChildren,relatedPulls,indexCommits,isAncestor,mergeEvidence,buildTimeline,LANES,reconcilePullDetail,ancestryClaim} from './prototype/gitHistoryModel';
import type {DevelopmentHistory,HistoryPull,HistoryCommit} from './prototype/gitHistoryTypes';
import {LIVE_PM_DASHBOARD} from './prototype/data';

const PM='augusliang23-web/pm-dashboard';
// PR numbers, titles, refs and timestamps are copied from the read-only GitHub
// snapshot of augusliang23-web/pm-dashboard at 2026-10-15T23:57:20Z. Commit
// SHAs are short synthetic stand-ins so the DAG fixture stays small; they are
// only used to exercise ancestry logic, never shown as real evidence.
const pr=(number:number,title:string,status:HistoryPull['status'],createdAt:string,mergedAt:string|null,baseRef:string,headRef:string,headSha:string,mergeCommitSha:string|null=null):HistoryPull=>({number,title,url:`https://github.com/${PM}/pull/${number}`,author:'augusliang23-web',state:status==='open'||status==='draft'?'open':'closed',isDraft:status==='draft',merged:status==='merged',status,createdAt,updatedAt:mergedAt??createdAt,closedAt:mergedAt,mergedAt,baseRef,baseSha:null,headRef,headSha,headRepo:PM,mergeCommitSha});
const c=(sha:string,parents:string[],date:string):HistoryCommit=>({sha,parents,message:`commit ${sha}`,authorDate:date,committerDate:date,author:'a',url:`https://github.com/${PM}/commit/${sha}`});
function makeHistory(over:Partial<DevelopmentHistory>={}):DevelopmentHistory{
 const pulls=[
  pr(13,'Consolidate PROD/UAT source and bootstrap CI','merged','2026-09-24T01:26:19Z','2026-09-24T01:43:01Z','main','migration/consolidated-source-ci','h13','M13'),
  pr(36,'release: prepare User Permissions Production promotion','open','2026-10-03T14:21:09Z',null,'main','claude/production-user-permissions-promotion','h36'),
  pr(48,'feat: port One-Paste weekly update (PR #47) to Production Pages','merged','2026-10-10T00:14:12Z','2026-10-10T00:53:46Z','production-pages','claude/weekly-one-paste-production-pages','h48','pp1'),
  pr(52,'feat: V2.3 historical data pipeline and PDF metrics preparation','draft','2026-10-14T05:57:01Z',null,'integration/v23-foundation','codex/v23-history-pipeline','h52'),
  pr(53,'feat: V2.3 UAT-only Delivery Trends page + PDF section integration (draft)','draft','2026-10-14T07:22:32Z',null,'integration/v23-foundation','claude/v23-product-integration','p1'),
  pr(54,'feat: unify UAT Draft Publish and preserve original Archive lifecycle','draft','2026-10-14T13:52:23Z',null,'main','codex/new-project-draft-publish','h54'),
  pr(55,'feat: V2.3 Phase 2C browser reliability and UAT automation (stacked, draft)','draft','2026-10-14T14:39:09Z',null,'claude/v23-product-integration','claude/v23-browser-e2e-hardening','e1'),
  pr(56,'feat: V2.3 Gate 2 integrated UAT review candidate','draft','2026-10-14T23:57:17Z',null,'integration/v23-foundation','integration/v23-e2e-candidate','h56'),
  pr(57,'feat: V2.3 Gate 2 closeout (F-1, PR #55 import, week selection) — stacked draft','draft','2026-10-15T00:33:08Z',null,'integration/v23-e2e-candidate','claude/v23-gate2-closeout','h57'),
  pr(58,'release(uat): PDF backend candidate — enable Delivery Performance on UAT only (draft)','draft','2026-10-15T05:42:11Z',null,'claude/v23-gate2-closeout','claude/v23-uat-backend-activation','h58'),
  pr(59,'release(uat): frontend candidate — enable Delivery Performance PDF option on UAT only (draft)','draft','2026-10-15T05:42:13Z',null,'claude/v23-gate2-closeout','claude/v23-uat-frontend-activation','h59'),
 ];
 const commits=[c('m1',[],'2026-04-26T21:42:44Z'),c('h13',['m1'],'2026-09-24T01:20:00Z'),c('m2',['m1'],'2026-09-20T00:00:00Z'),c('M13',['m2','h13'],'2026-09-24T01:43:01Z'),c('m3',['M13'],'2026-10-14T05:13:33Z'),c('h48',['m2'],'2026-10-10T00:10:00Z'),c('pp1',['m2','h48'],'2026-10-10T00:53:46Z'),c('f1',['m3'],'2026-10-14T05:50:00Z'),c('p1',['f1'],'2026-10-14T07:20:00Z'),c('e1',['p1'],'2026-10-14T14:30:00Z'),c('orphan',['missing-parent'],'2026-10-14T15:00:00Z')];
 const branches=[['main','m3'],['production-pages','pp1'],['integration/v23-foundation','f1'],['claude/v23-product-integration','p1'],['claude/v23-browser-e2e-hardening','e1'],['codex/stale-experiment','not-fetched']].map(([name,headSha])=>({name,headSha,protected:name==='main'}));
 return {source:'GitHub',repository:PM,repositoryUrl:`https://github.com/${PM}`,defaultBranch:'main',startedAt:'2026-10-15T23:57:08.000Z',fetchedAt:'2026-10-15T23:57:20.883Z',status:'complete',cache:'miss',
  coverage:{branches:{count:branches.length,pages:1,complete:true},pulls:{count:pulls.length,open:pulls.filter(p=>p.state==='open').length,draft:pulls.filter(p=>p.isDraft).length,merged:2,closedUnmerged:0,pages:1,complete:true},commits:{count:commits.length,defaultBranchCommits:4,defaultBranchComplete:true},focusRefs:{compared:4,requested:4,truncated:false},localWorktrees:'not_checked',deployments:'not_checked',ci:'not_checked'},
  warnings:[],branches,pulls,commits,defaultBranchShas:['m3','M13','m2','m1'],refs:{},comparisons:[{base:'main',head:'production-pages',status:'diverged',aheadBy:2,behindBy:2,totalCommits:2,mergeBaseSha:'m2',commitShas:['pp1','h48'],complete:true,error:null}],...over};
}
const detailFor=(number:number,ci:'none'|'passing'|'not_checked')=>({source:'GitHub',repository:PM,number,fetchedAt:'2026-10-16T00:01:00.000Z',pull:{...makeHistory().pulls.find(p=>p.number===number)!,changedFiles:12,additions:889,deletions:8,commits:2},ci:{status:ci,total:ci==='passing'?5:ci==='none'?0:null,headSha:makeHistory().pulls.find(p=>p.number===number)!.headSha},reviews:{status:'no_reviews',count:0,complete:true}});
type Pending={url:string;resolve:(body:unknown,status?:number)=>void};
function mockFetch(){const pending:Pending[]=[];const spy=vi.spyOn(globalThis,'fetch').mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>new Promise((resolveFetch,reject)=>{const url=String(input);init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));pending.push({url,resolve:(body,status=200)=>resolveFetch(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}))});}));return {spy,pending};}
const openLive=()=>nav('開發地圖');
const flush=()=>act(async()=>{await Promise.resolve();await new Promise(r=>setTimeout(r,0));});

test('B1 C: UTC timestamps convert to Asia/Singapore with the year always shown',()=>{
 expect(formatSgt('2026-09-24T01:43:01Z')).toBe('2026-09-24 09:43 SGT');
 expect(formatSgt('2026-10-14T23:57:17Z')).toBe('2026-10-15 07:57 SGT');
 expect(formatSgt('2026-12-31T16:30:00Z')).toBe('2027-01-01 00:30 SGT');
 expect(formatSgt('2026-10-06T08:46:12Z',false)).toBe('2026-10-06');
 expect(formatSgt(null)).toBe('Not available');expect(formatSgt('garbage')).toBe('Not available');
});

test('B1 G: stacked V2.3 PRs link only through reported base/head refs',()=>{
 const h=makeHistory();const get=(n:number)=>h.pulls.find(p=>p.number===n)!;
 expect(stackParent(get(55),h.pulls)?.number).toBe(53);
 expect(stackParent(get(57),h.pulls)?.number).toBe(56);
 expect(stackParent(get(52),h.pulls)).toBeNull(); // integration/v23-foundation is a branch, not an open PR head
 expect(stackParent(get(54),h.pulls)).toBeNull();
 expect(stackChildren(get(57),h.pulls).map(p=>p.number)).toEqual([58,59]);
 expect([...relatedPulls(get(57),h.pulls)].sort()).toEqual([56,57,58,59]);
 expect(relatedPulls(get(54),h.pulls).has(55)).toBe(false);
});

test('B1 H/I: commit-parent ancestry is verified, and missing history stays UNKNOWN',()=>{
 const h=makeHistory();const idx=indexCommits(h.commits);
 expect(isAncestor(idx,'f1','e1')).toBe(true);
 expect(isAncestor(idx,'e1','m3')).toBe(false);
 expect(isAncestor(idx,'m1','orphan')).toBe('unknown');
 expect(isAncestor(idx,'m1','not-fetched')).toBe('unknown');
 expect(isAncestor(idx,null,'e1')).toBe('unknown');
 const get=(n:number)=>h.pulls.find(p=>p.number===n)!;
 expect(mergeEvidence(get(13),idx)).toBe('verified_merge_commit');
 expect(mergeEvidence(get(48),idx)).toBe('verified_merge_commit');
 expect(mergeEvidence({...get(13),mergeCommitSha:'m3'},idx)).toBe('single_parent_commit');
 expect(mergeEvidence({...get(13),mergeCommitSha:'gone'},idx)).toBe('unknown');
 expect(mergeEvidence(get(55),idx)).toBe('not_merged');
});

test('B1 J/K: only an explicit REGISTERED identity with the exact repository is live',()=>{
 expect(liveRepositoryFor(LIVE_PM_DASHBOARD)).toBe(PM);
 expect(liveRepositoryFor({...LIVE_PM_DASHBOARD,source:'DEMO'})).toBeNull();
 expect(liveRepositoryFor({...LIVE_PM_DASHBOARD,projectId:undefined})).toBeNull();
 expect(liveRepositoryFor({source:'REGISTERED',projectId:'x',repository:'augusliang23-web/pm-dashboard-uat',displayName:'PM Dashboard'})).toBeNull();
 expect(liveRepositoryFor({source:'REGISTERED',projectId:'x',displayName:'PM Dashboard'})).toBeNull();
 expect(liveRepositoryFor({source:'REGISTERED',projectId:'x',repository:'github.com/augusliang23-web/pm-dashboard',displayName:'Any'})).toBe(PM);
});

test('B1 F/T: timeline range is anchored to the verified fetch time and open PRs end at Last checked',()=>{
 const h=makeHistory();const all=new Set(LANES.map(l=>l.id));
 const six=buildTimeline(h,{range:'6m',state:'all',lanes:all,collapsed:new Set(),pxPerDay:10});
 expect(six.items.map(i=>i.pr.number)).toContain(13);
 const later=makeHistory({fetchedAt:'2026-12-01T00:00:00.000Z'});
 const one=buildTimeline(later,{range:'1m',state:'all',lanes:all,collapsed:new Set(),pxPerDay:10});
 expect(one.items.map(i=>i.pr.number)).not.toContain(13);
 expect(one.items.find(i=>i.pr.number===55)!.endIso).toBe(later.fetchedAt); // still OPEN at Last checked
 const merged=buildTimeline(h,{range:'all',state:'merged',lanes:all,collapsed:new Set(),pxPerDay:10});
 expect(merged.items.map(i=>i.pr.number).sort()).toEqual([13,48]);
 const collapsed=buildTimeline(h,{range:'all',state:'all',lanes:all,collapsed:new Set(['v23-feature']),pxPerDay:10});
 expect(collapsed.items.some(i=>i.lane==='v23-feature')).toBe(false);
 expect(collapsed.lanes.find(l=>l.id==='v23-feature')!.count).toBeGreaterThan(0);
});

test('B1: live view reads only the allowlisted repo and shows provenance, counts and Not checked boundaries',async()=>{
 const {spy,pending}=mockFetch();render(<App/>);openLive();
 expect(screen.getByText('REGISTERED · LIVE GITHUB READ-ONLY')).toBeVisible();
 expect(pending).toHaveLength(1);expect(pending[0].url).toBe(`/api/github/development-history?repo=${encodeURIComponent(PM)}`);
 expect(screen.getByRole('status')).toHaveTextContent('正在從 GitHub 讀取');
 pending[0].resolve(makeHistory());await flush();
 const prov=screen.getByLabelText('資料來源');
 expect(prov).toHaveTextContent('GitHub');expect(prov).toHaveTextContent(PM);expect(prov).toHaveTextContent('2026-10-16 07:57 SGT');expect(prov).toHaveTextContent('Complete');
 const summary=screen.getByLabelText('Repository 摘要');
 expect(summary).toHaveTextContent('遠端分支（GitHub）6');expect(summary).toHaveTextContent('OPEN 9（DRAFT 8）');
 expect(within(summary).getAllByText('Not checked')).toHaveLength(2);expect(summary).toHaveTextContent('MERGED ≠ DEPLOYED');
 expect(spy.mock.calls.every(([u])=>String(u).startsWith('/api/github/development-history'))).toBe(true);
 for(const fake of ['PR #18','PR #22','PR #25','237 commits','3 Worktrees','Deployed'])expect(document.body.textContent).not.toContain(fake);
});

test('B1 G/R: selecting a stacked PR shows metadata, verified ancestry and CI only after it is fetched',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();pending[0].resolve(makeHistory());await flush();
 fireEvent.click(screen.getByRole('button',{name:/^PR #55 ·/}));
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('claude/v23-browser-e2e-hardening');expect(panel).toHaveTextContent('claude/v23-product-integration');
 expect(panel).toHaveTextContent('base = PR #53 的 head');expect(panel).toHaveTextContent('Not merged');expect(panel).toHaveTextContent('2026-10-14 22:39 SGT');
 expect(panel).toHaveTextContent('已驗證：claude/v23-product-integration 目前 head p1 是 PR head 的祖先');
 expect(panel).toHaveTextContent('CINot checked（讀取中…）');
 const detail=pending.find(p=>p.url.includes('/development-history/pull'))!;expect(detail.url).toContain('number=55');
 detail.resolve(detailFor(55,'passing'));await flush();
 expect(panel).toHaveTextContent('CI passed（5 個 check run）');expect(panel).toHaveTextContent('沒有已送出的 review');
 expect(screen.getByRole('button',{name:/^PR #53 ·/})).toHaveClass('is-related');expect(screen.getByRole('button',{name:/^PR #54 ·/})).toHaveClass('is-dim');
 expect(screen.getByLabelText(/PR #55 回報的 base：claude\/v23-product-integration（PR #53 的 head）/)).toHaveAttribute('data-kind','reported-base');
 fireEvent.click(screen.getByRole('button',{name:/^PR #56 ·/}));
 pending.filter(p=>p.url.includes('number=56')).forEach(p=>p.resolve(detailFor(56,'none')));await flush();
 expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).toHaveTextContent('No CI checks');
 expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).not.toHaveTextContent('CI passed');
});

test('B1 E/H: merged PR detail uses merged_at and draws a solid edge only for a verified merge commit',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();pending[0].resolve(makeHistory());await flush();
 expect(screen.getByLabelText(/PR #13 合併到 main：已驗證/)).toHaveAttribute('data-kind','verified-merge');
 fireEvent.click(screen.getByRole('button',{name:/^PR #13 ·/}));
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('2026-09-24 09:26 SGT');expect(panel).toHaveTextContent('合併（merged_at）2026-09-24 09:43 SGT');
 expect(panel).toHaveTextContent('已驗證：merge commit 的 parent 包含 PR head');
 expect(panel).toHaveTextContent('（上次檢查時不在遠端分支清單；不推測是否曾刪除）');
 cleanup();vi.restoreAllMocks();
 const second=mockFetch();render(<App/>);openLive();
 second.pending[0].resolve(makeHistory({commits:makeHistory().commits.filter(x=>x.sha!=='M13')}));await flush();
 expect(screen.getByLabelText(/PR #13 合併到 main：UNKNOWN/)).toHaveAttribute('data-kind','pr-record');
});

test('B1 M/N: GitHub auth and rate-limit failures show Unavailable without DEMO substitution',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();
 pending[0].resolve({error:'GitHub CLI is not authenticated.',kind:'not_authenticated',status:'unavailable'},401);await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('GitHub CLI 尚未授權');expect(screen.getByLabelText('資料來源')).toHaveTextContent('Unavailable');
 expect(screen.queryAllByRole('button',{name:/^PR #/})).toHaveLength(0);expect(screen.queryByText(/DEMO DATA/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 expect(pending[1].url).toContain('refresh=1');
 pending[1].resolve({error:'rate',kind:'rate_limited',resetAt:'2026-10-16T01:00:00.000Z',status:'unavailable'},429);await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('速率限制');expect(screen.getByRole('alert')).toHaveTextContent('2026-10-16 09:00 SGT');
});

test('B1 T: partial history and a failed refresh are labeled, never shown as complete',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();
 pending[0].resolve(makeHistory({status:'partial',warnings:['main history truncated after 1000 commits.']}));await flush();
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('Partial history');expect(screen.getByText(/main history truncated/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));pending[1].resolve({error:'slow',kind:'timeout'},504);await flush();
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('Needs refresh');expect(screen.getByRole('alert')).toHaveTextContent('上一次成功讀取的資料');
 expect(screen.getAllByRole('button',{name:/^PR #/}).length).toBeGreaterThan(0);
});

test('B1 J/Q: switching projects cancels the request and a late PM response never lands in DEMO',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();
 fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getAllByRole('button',{name:/PM Dashboard/})[1]);
 expect(screen.getByLabelText('開發地圖不可用')).toHaveTextContent('DEMO PROJECT');
 pending[0].resolve(makeHistory());await flush();
 expect(screen.queryAllByRole('button',{name:/^PR #/})).toHaveLength(0);expect(document.body.textContent).not.toContain('claude/v23-browser-e2e-hardening');
 expect(pending).toHaveLength(1); // DEMO identity issues no GitHub read
 fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getByRole('button',{name:/SwipeRight/}));
 expect(screen.getByLabelText('開發地圖不可用')).toHaveTextContent('SwipeRight');
});

test('B1 Q: refresh is single-flight and an older response resolving late never replaces newer data',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();pending[0].resolve(makeHistory());await flush();
 const refresh=screen.getByRole('button',{name:'重新整理 GitHub 資料'});
 fireEvent.click(refresh);expect(pending[1].url).toContain('refresh=1');
 expect(refresh).toBeDisabled();fireEvent.click(refresh);expect(pending).toHaveLength(2);
 const rail=()=>within(screen.getByRole('navigation',{name:'專案（開發地圖）'}));
 fireEvent.click(rail().getByRole('button',{name:/SwipeRight/}));fireEvent.click(rail().getByRole('button',{name:/LIVE/}));
 const older=pending[1];const newer=pending[2];
 newer.resolve(makeHistory({fetchedAt:'2026-10-16T02:00:00.000Z'}));await flush();
 older.resolve(makeHistory({fetchedAt:'2026-10-16T01:00:00.000Z'}));await flush();
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('2026-10-16 10:00 SGT');
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));pending[3].resolve(makeHistory({repository:'someone/else'}));await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('GitHub 讀取失敗');expect(screen.getByLabelText('資料來源')).toHaveTextContent('Needs refresh');
});

test('B1 S/U/V: no local worktree claim, no deployment claim, no AI or agent controls in the live view',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();pending[0].resolve(makeHistory());await flush();
 expect(screen.getByLabelText('Repository 摘要')).toHaveTextContent('本機 WorktreeNot checked');
 expect(screen.queryByRole('textbox',{name:/指令|Prompt/})).not.toBeInTheDocument();
 expect(screen.queryByRole('tab',{name:/AI 指令|Prompt/})).not.toBeInTheDocument();
 for(const b of screen.getAllByRole('button'))expect(b.textContent).not.toMatch(/執行|Execute|Generate|Dispatch|AI Command|\bMerge\b|Approve|\bDeploy\b/i);
 expect(document.body.textContent).not.toMatch(/\/Users\/|worktrees\//);
});

test('B1: Git topology draws only verified parent edges and reports heads outside the fetched DAG',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();pending[0].resolve(makeHistory());await flush();
 fireEvent.click(screen.getByRole('tab',{name:/Git 拓樸/}));
 const graph=screen.getByRole('region',{name:'Git 拓樸圖'});
 expect(within(graph).getByLabelText('已驗證 parent：h13 → M13')).toHaveAttribute('data-kind','verified-parent');
 expect(within(graph).getByLabelText(/orphan 的 parent missing 不在目前視窗/)).toHaveAttribute('data-kind','outside-window');
 expect(graph).toHaveTextContent('1 個 branch head 不在已取得的 commit 圖中 → ancestry UNKNOWN');
 fireEvent.click(within(graph).getByRole('button',{name:/^commit M13 ·/}));
 const panel=screen.getByRole('complementary',{name:'Commit 詳細資訊'});
 expect(panel).toHaveTextContent('#13（merge commit）');expect(panel).toHaveTextContent('2026-09-24 09:43 SGT');expect(panel).toHaveTextContent(`在已取得的 main 歷史中`);
 fireEvent.click(screen.getByRole('tab',{name:/清單/}));
 expect(screen.getByRole('region',{name:'可捲動 PR 清單'})).toHaveAttribute('tabindex','0');
 expect(screen.getByRole('button',{name:/^PR #55 ·/})).toBeVisible();
});

test('B1: graph is keyboard reachable, scrollable regions are focusable and filters narrow the view',async()=>{
 const {pending}=mockFetch();render(<App/>);openLive();pending[0].resolve(makeHistory());await flush();
 expect(screen.getByRole('region',{name:/可捲動的開發時間軸/})).toHaveAttribute('tabindex','0');
 const card=screen.getByRole('button',{name:/^PR #57 ·/});card.focus();expect(card).toHaveFocus();
 fireEvent.change(screen.getByLabelText('PR 狀態篩選'),{target:{value:'merged'}});
 expect(screen.queryByRole('button',{name:/^PR #57 ·/})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:/^PR #13 ·/})).toBeVisible();
 fireEvent.change(screen.getByLabelText('PR 狀態篩選'),{target:{value:'all'}});
 fireEvent.click(within(screen.getByRole('group',{name:'分支群組篩選'})).getByRole('button',{name:/V2.3 feature/}));
 expect(screen.queryByRole('button',{name:/^PR #55 ·/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/^PR #56 ·/}));fireEvent.keyDown(window,{key:'Escape'});
 expect(screen.queryByRole('complementary',{name:'PR 詳細資訊'})).not.toBeInTheDocument();
});

test('B1: the DEMO PM Dashboard card offers the live map explicitly without upgrading the DEMO workspace',async()=>{
 const {pending}=mockFetch();render(<App/>);
 fireEvent.click(within(screen.getByRole('article',{name:'PM Dashboard 示範專案'})).getByRole('button',{name:/真實 GitHub 開發地圖/}));
 expect(screen.getByText('REGISTERED · LIVE GITHUB READ-ONLY')).toBeVisible();expect(pending[0].url).toContain(encodeURIComponent(PM));
 cleanup();render(<App/>);
 expect(within(screen.getByRole('article',{name:'SwipeRight 示範專案'})).queryByRole('button',{name:/LIVE|真實 GitHub/})).toBeNull();
 workspace('PM Dashboard');expect(screen.getByText('DEMO PROJECT')).toBeVisible();expect(screen.queryByText('REGISTERED · LIVE GITHUB READ-ONLY')).toBeNull();
});

// ---------------- P2 provenance remediation: negative controls ----------------
// Written first and run against B1 commit 17a5623, where the SHA/CI, state-change,
// refresh-invalidation, partial-review and drift tests fail.
const SHA_A='e1';const SHA_B='e2';
const detailWith=(number:number,over:{pull?:Partial<HistoryPull>;ci?:{status:string;total:number|null;headSha:string|null};reviews?:{status:string;count:number|null;complete:boolean;observed?:string}}={})=>{
 const base=detailFor(number,'passing');
 return {...base,pull:{...base.pull,...over.pull},ci:over.ci??base.ci,reviews:over.reviews??base.reviews};
};
const openPr=async(n=55,history=makeHistory())=>{const m=mockFetch();render(<App/>);openLive();m.pending[0].resolve(history);await flush();fireEvent.click(screen.getByRole('button',{name:new RegExp(`^PR #${n} ·`)}));return m;};
const detailReq=(m:{pending:Pending[]},n=55)=>m.pending.filter(p=>p.url.includes('/development-history/pull')&&p.url.includes(`number=${n}`)).at(-1)!;

test('P2-1 negative control: snapshot head SHA A + fresh head SHA B with CI PASS never shows PASS against SHA A',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_B},ci:{status:'passing',total:5,headSha:SHA_B}}));await flush();
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('Needs refresh');expect(panel).toHaveTextContent('Stale data');
 expect(panel).toHaveTextContent(`快照 head ${SHA_A}`);expect(panel).toHaveTextContent(`目前 head ${SHA_B}`);
 expect(within(panel).getByTestId('pr-ci')).toHaveTextContent(`針對 ${SHA_B}`);
 expect(within(panel).getByTestId('pr-ci')).toHaveTextContent('不適用於');
 expect(within(panel).getByTestId('pr-ci')).not.toHaveTextContent(new RegExp(`${SHA_A}.*CI passed|^CI passed`));
 expect(within(panel).getByTestId('pr-review')).toHaveTextContent('Not verified');
});

test('P2-1: CI on a head that is not the displayed head is rejected even if the detail head looks right',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_A},ci:{status:'passing',total:5,headSha:SHA_B}}));await flush();
 const ci=within(screen.getByRole('complementary',{name:'PR 詳細資訊'})).getByTestId('pr-ci');
 expect(ci).toHaveTextContent('Not verified');expect(ci).not.toHaveTextContent(/^CI passed/);
});

test('P2-1: matching SHAs show CI normally with the SHA it was read for and no false stale warning',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55));await flush();
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(within(panel).getByTestId('pr-ci')).toHaveTextContent(`CI passed（5 個 check run） · head ${SHA_A}`);
 expect(panel).not.toHaveTextContent('Needs refresh');expect(panel).not.toHaveTextContent('Stale data');
});

test('P2-1: refreshing the snapshot keeps the selected PR and re-reads its detail instead of reusing the old one',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55));await flush();
 expect(within(screen.getByRole('complementary',{name:'PR 詳細資訊'})).getByTestId('pr-ci')).toHaveTextContent('CI passed');
 const before=m.pending.length;
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 const snapshot=m.pending.at(-1)!;expect(snapshot.url).toContain('refresh=1');
 snapshot.resolve(makeHistory({fetchedAt:'2026-10-16T03:00:00.000Z',pulls:makeHistory().pulls.map(p=>p.number===55?{...p,headSha:SHA_B}:p)}));await flush();
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('#55'); // selection preserved
 expect(m.pending.length).toBeGreaterThan(before+1); // a new detail request followed the new snapshot
 expect(within(panel).getByTestId('pr-ci')).toHaveTextContent('Not checked'); // old CI is not carried over
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_B},ci:{status:'failing',total:5,headSha:SHA_B}}));await flush();
 expect(within(panel).getByTestId('pr-ci')).toHaveTextContent(`CI failed`);expect(within(panel).getByTestId('pr-ci')).toHaveTextContent(`head ${SHA_B}`);
 expect(panel).not.toHaveTextContent('Needs refresh');
});

test.each([
 ['OPEN → MERGED',{status:'merged' as const,state:'closed' as const,merged:true,isDraft:false,mergedAt:'2026-10-16T02:00:00Z',closedAt:'2026-10-16T02:00:00Z'},'DRAFT → MERGED'],
 ['OPEN → CLOSED',{status:'closed_unmerged' as const,state:'closed' as const,merged:false,isDraft:false,mergedAt:null,closedAt:'2026-10-16T02:00:00Z'},'DRAFT → CLOSED · 未合併'],
 ['DRAFT → READY',{status:'open' as const,state:'open' as const,merged:false,isDraft:false},'DRAFT → OPEN'],
])('P2-1 state change %s is shown as Needs refresh with both states',async(_name,change,label)=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:change}));await flush();
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('狀態已變更');expect(panel).toHaveTextContent(label);expect(panel).toHaveTextContent('Needs refresh');
});

test('P2-1: a refreshed snapshot that no longer contains the selected PR is reported, not silently cleared',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55));await flush();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 m.pending.at(-1)!.resolve(makeHistory({pulls:makeHistory().pulls.filter(p=>p.number!==55)}));await flush();
 expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).toHaveTextContent('PR #55 不在最新快照中');
});

test('P2-2 negative control: incomplete review pagination shows Partial / UNKNOWN, never Approved',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{reviews:{status:'partial',count:300,complete:false,observed:'approved'}}));await flush();
 const review=within(screen.getByRole('complementary',{name:'PR 詳細資訊'})).getByTestId('pr-review');
 expect(review).toHaveTextContent('Partial');expect(review).toHaveTextContent('UNKNOWN');expect(review).toHaveTextContent('300');
 expect(review).not.toHaveTextContent(/^Approved/);expect(review).not.toHaveTextContent('undefined');
});

test('P2-2: a legacy detail that says approved with complete=false is still rendered Partial',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{reviews:{status:'approved',count:300,complete:false}}));await flush();
 const review=within(screen.getByRole('complementary',{name:'PR 詳細資訊'})).getByTestId('pr-review');
 expect(review).toHaveTextContent('Partial');expect(review).not.toHaveTextContent(/^Approved/);
});

test.each([
 ['no_reviews','沒有已送出的 review'],['not_checked','Not checked'],['approved','Approved（'],['changes_requested','Changes requested（'],
])('P2-2: complete review state %s keeps its own label',async(status,text)=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{reviews:{status,count:status==='no_reviews'?0:2,complete:status!=='not_checked'}}));await flush();
 const review=within(screen.getByRole('complementary',{name:'PR 詳細資訊'})).getByTestId('pr-review');
 expect(review).toHaveTextContent(text);expect(review).not.toHaveTextContent('Partial');
});

test('Snapshot: drifted refs and PR/branch head mismatches downgrade status and turn ancestry UNKNOWN',async()=>{
 const drifted=makeHistory({status:'partial',warnings:['Branch heads moved during the read: claude/v23-product-integration.'],
  consistency:{atomic:false,status:'inconsistent',rereadAt:'2026-10-15T23:57:30.000Z',driftedRefs:[{ref:'claude/v23-product-integration',observed:'p1',reread:'p9',relevant:true}],prHeadMismatches:[{number:55,headRef:'claude/v23-browser-e2e-hardening',prHeadSha:'e1',branchHeadSha:'e9'}]}});
 const m=await openPr(55,drifted);
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('Partial history');
 expect(panel).toHaveTextContent('UNKNOWN（快照期間 base 分支 claude/v23-product-integration 的 head 已移動）');
 expect(panel).not.toHaveTextContent('已驗證：claude/v23-product-integration');
 expect(panel).toHaveTextContent('PR 清單與分支清單的 head 不一致');
 expect(screen.getByText(/非原子快照/)).toBeVisible();
 expect(m.pending.length).toBeGreaterThan(0);
});

test('Snapshot: a consistent read still labels itself non-atomic',async()=>{
 await openPr(55,makeHistory({consistency:{atomic:false,status:'consistent',rereadAt:'2026-10-15T23:57:30.000Z',driftedRefs:[],prHeadMismatches:[]}}));
 expect(screen.getByText(/非原子快照/)).toBeVisible();expect(screen.getByLabelText('資料來源')).toHaveTextContent('Complete');
});

// ---------------- Final provenance hardening: P2-3 CI SHA fail-closed ----------------
const withSnapshotHead=(head:string|null)=>makeHistory({pulls:makeHistory().pulls.map(p=>p.number===55?{...p,headSha:head}:p)});
const ciOf=()=>within(screen.getByRole('complementary',{name:'PR 詳細資訊'})).getByTestId('pr-ci');
const reviewOf=()=>within(screen.getByRole('complementary',{name:'PR 詳細資訊'})).getByTestId('pr-review');

test('P2-3 negative control: missing snapshot SHA + current head B + CI PASS on B never shows an unqualified PASS',async()=>{
 const m=await openPr(55,withSnapshotHead(null));
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_B},ci:{status:'passing',total:5,headSha:SHA_B}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(ciOf()).not.toHaveTextContent(/^CI passed/);expect(ciOf()).not.toHaveTextContent('CI passed（5 個 check run） · head');
 expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
 expect(reviewOf()).toHaveTextContent('Not verified');
});

test('P2-3: missing current PR SHA is Not verified and Needs refresh',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:{headSha:null},ci:{status:'passing',total:5,headSha:SHA_A}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(ciOf()).not.toHaveTextContent(/^CI passed/);
 expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
});

test('P2-3: missing CI SHA is Not verified and Needs refresh',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{ci:{status:'passing',total:5,headSha:null}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(ciOf()).not.toHaveTextContent(/^CI passed/);
 expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
});

test('P2-3: every SHA missing at once still fails closed',async()=>{
 const m=await openPr(55,withSnapshotHead(null));
 detailReq(m).resolve(detailWith(55,{pull:{headSha:null},ci:{status:'passing',total:5,headSha:null}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
});

test('P2-3: mismatched SHAs stay Not verified / Stale; matching SHAs are the only path to an unqualified result',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_A},ci:{status:'passing',total:5,headSha:SHA_B}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');
 cleanup();vi.restoreAllMocks();
 const ok=await openPr();
 detailReq(ok).resolve(detailWith(55));await flush();
 expect(ciOf()).toHaveTextContent(`CI passed（5 個 check run） · head ${SHA_A}`);expect(screen.getByRole('complementary',{name:'PR 詳細資訊'})).not.toHaveTextContent('Needs refresh');
});

test.each([
 ['snapshot null',null,SHA_B,SHA_B,false,true],
 ['current null',SHA_A,null,SHA_A,false,true],
 ['ci null',SHA_A,SHA_A,null,false,true],
 ['snapshot≠current',SHA_A,SHA_B,SHA_B,false,false],
 ['ci≠current',SHA_A,SHA_A,SHA_B,false,false],
 ['all equal',SHA_A,SHA_A,SHA_A,true,false],
])('P2-3 reconcilePullDetail truth table: %s',(_n,snap,cur,ci,applies,missing)=>{
 const pr=makeHistory().pulls.find(p=>p.number===55)!;
 const detail=detailWith(55,{pull:{headSha:cur},ci:{status:'passing',total:5,headSha:ci}}) as any;
 const rec=reconcilePullDetail({...pr,headSha:snap},detail);
 expect(rec.ciApplies).toBe(applies);
 expect(rec.missingSha).toBe(missing);
 expect(rec.needsRefresh).toBe(!applies); // CI that cannot be tied to the displayed head always asks for a refresh
});

// ---------------- Final provenance hardening: P2-4 completeness vs edge proof ----------------
test('P2-4: unrelated drift makes the snapshot Partial but keeps an unaffected verified edge',async()=>{
 const unrelated=makeHistory({status:'partial',warnings:['Branch heads moved during the read: codex/stale-experiment.'],
  consistency:{atomic:false,status:'inconsistent',rereadAt:'2026-10-15T23:57:30.000Z',driftedRefs:[{ref:'codex/stale-experiment',observed:'not-fetched',reread:'later',relevant:false}],prHeadMismatches:[]}});
 await openPr(55,unrelated);
 const panel=screen.getByRole('complementary',{name:'PR 詳細資訊'});
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('Partial history');
 expect(panel).toHaveTextContent('已驗證：claude/v23-product-integration 目前 head p1 是 PR head 的祖先'); // its own refs did not move
 expect(screen.getByText(/非原子快照/)).toHaveTextContent('整體快照標為 Partial');
 expect(screen.getByText(/非原子快照/)).toHaveTextContent('未受影響的已驗證 Git 關係維持原狀');
});

test('P2-4: a moved base or a moved PR head branch turns that edge UNKNOWN',()=>{
 const h=makeHistory();const idx=indexCommits(h.commits);const pr55=h.pulls.find(p=>p.number===55)!;
 const drifted=(ref:string)=>({...h,consistency:{atomic:false as const,status:'inconsistent' as const,rereadAt:null,driftedRefs:[{ref,observed:'a',reread:'b',relevant:true}],prHeadMismatches:[]}});
 expect(ancestryClaim(h,pr55,idx).state).toBe('yes');
 expect(ancestryClaim(drifted('codex/stale-experiment'),pr55,idx).state).toBe('yes'); // unrelated ref
 expect(ancestryClaim(drifted('claude/v23-product-integration'),pr55,idx)).toMatchObject({state:'unknown',reason:'base_moved'});
 expect(ancestryClaim(drifted('claude/v23-browser-e2e-hardening'),pr55,idx)).toMatchObject({state:'unknown',reason:'pr_head_moved'});
});
