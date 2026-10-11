import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
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

test('two-item global navigation with workspace capabilities available from project cards',()=>{
 render(<App/>);expect(within(screen.getByRole('navigation',{name:'主要頁面'})).getAllByRole('button').map(b=>b.textContent)).toEqual(['專案總覽','Cost Guard']);
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
