// Development Map viewer regression suite for the V1 candidate.
// Ported from the reviewed Prototype.test.tsx (PR #40, 7a865a0) viewer sections. Every GitHub payload below is a
// deterministic, explicitly synthetic/mock test input: none of it is live GitHub evidence and none of it proves that
// the integrated application works against the real GitHub API (that is deferred to B1.5).
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,test,vi} from 'vitest';
import {GitDevelopmentMap,type RailEntry} from '../prototype/GitDevelopmentMap';
import type {LiveIdentity} from '../prototype/gitHistoryTypes';

afterEach(()=>{cleanup();vi.restoreAllMocks();});

// Test-input identities (the V1 shell derives REGISTERED identities from saved state; DEMO ones exist only here to prove isolation).
const LIVE_PM_DASHBOARD:LiveIdentity={source:'REGISTERED',projectId:'registered-pm-dashboard',repository:'augusliang23-web/pm-dashboard',displayName:'PM Dashboard'};
const DEMO_PM:LiveIdentity={source:'DEMO',projectId:'demo-pm',displayName:'PM Dashboard'};
const DEMO_SWIPE:LiveIdentity={source:'DEMO',projectId:'demo-swipe',displayName:'SwipeRight'};
const RAIL:RailEntry[]=[{identity:LIVE_PM_DASHBOARD,label:'PM Dashboard',tag:'LIVE · GitHub 唯讀'},{identity:DEMO_PM,label:'PM Dashboard',tag:'DEMO · 未連線'},{identity:DEMO_SWIPE,label:'SwipeRight',tag:'DEMO · 未連線'}];
function Harness(){const [identity,setIdentity]=useState<LiveIdentity>(LIVE_PM_DASHBOARD);return <GitDevelopmentMap identity={identity} rail={RAIL} selectIdentity={setIdentity}/>;}
// ---------------- Track B B1 · live read-only PM Dashboard development map ----------------
import {timelineSpan,timelineX,fitPxPerDay,PLOT_GUTTER_LEFT,PLOT_GUTTER_RIGHT,MIN_FIT_PX_PER_DAY,formatSgt,liveRepositoryFor,stackParent,stackChildren,relatedPulls,indexCommits,isAncestor,mergeEvidence,buildTimeline,LANES,reconcilePullDetail,ancestryClaim,reviewProvenance,buildStackGraph,flattenStack,stackStatus} from '../prototype/gitHistoryModel';
import type {DevelopmentHistory,HistoryPull,HistoryCommit} from '../prototype/gitHistoryTypes';

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
const openLive=()=>{}; // the viewer is mounted directly; shell navigation is covered in ReadOnlyCommandCenter.test.tsx
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
 // V1.2C: no URL/prefix normalisation; the server matches the exact owner/repo string, so a URL-like spelling is never live.
 expect(liveRepositoryFor({source:'REGISTERED',projectId:'x',repository:'github.com/augusliang23-web/pm-dashboard',displayName:'Any'})).toBeNull();
 expect(liveRepositoryFor({...LIVE_PM_DASHBOARD,authorization:null})).toBeNull(); // projected and not authorized (e.g. disconnected)
 expect(liveRepositoryFor({source:'REGISTERED',projectId:'x',repository:'someone/app',displayName:'Any'})).toBeNull(); // no projection: only the legacy repository
 expect(liveRepositoryFor({source:'REGISTERED',projectId:'x',repository:'someone/app',displayName:'Any',authorization:{source:'user-verified',generation:1}})).toBe('someone/app');
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
 const {spy,pending}=mockFetch();render(<Harness/>);openLive();
 expect(screen.getByTestId('g-source-badge')).toHaveTextContent('GitHub 唯讀 · 正在查詢'); // allowlisted, not yet fetched
 expect(pending).toHaveLength(1);expect(pending[0].url).toBe(`/api/github/development-history?repo=${encodeURIComponent(PM)}&projectId=registered-pm-dashboard`); // V1.2C: bound to the project
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
 const {pending}=mockFetch();render(<Harness/>);openLive();pending[0].resolve(makeHistory());await flush();
 fireEvent.click(screen.getByRole('button',{name:/^PR #55 ·/}));
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
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
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('No CI checks');
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).not.toHaveTextContent('CI passed');
});

test('B1 E/H: merged PR detail uses merged_at and draws a solid edge only for a verified merge commit',async()=>{
 const {pending}=mockFetch();render(<Harness/>);openLive();pending[0].resolve(makeHistory());await flush();fireEvent.click(screen.getByRole('button',{name:'6 個月'}));
 expect(screen.getByLabelText(/PR #13 合併到 main：已驗證/)).toHaveAttribute('data-kind','verified-merge');
 fireEvent.click(screen.getByRole('button',{name:/^PR #13 ·/}));
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('2026-09-24 09:26 SGT');expect(panel).toHaveTextContent('合併（merged_at）2026-09-24 09:43 SGT');
 expect(panel).toHaveTextContent('已驗證：merge commit 的 parent 包含 PR head');
 expect(panel).toHaveTextContent('（上次檢查時不在遠端分支清單；不推測是否曾刪除）');
 cleanup();vi.restoreAllMocks();
 const second=mockFetch();render(<Harness/>);openLive();
 second.pending[0].resolve(makeHistory({commits:makeHistory().commits.filter(x=>x.sha!=='M13')}));await flush();fireEvent.click(screen.getByRole('button',{name:'6 個月'}));
 expect(screen.getByLabelText(/PR #13 合併到 main：UNKNOWN/)).toHaveAttribute('data-kind','pr-record');
});

test('B1 M/N: GitHub auth and rate-limit failures show Unavailable without DEMO substitution',async()=>{
 const {pending}=mockFetch();render(<Harness/>);openLive();
 pending[0].resolve({error:'GitHub CLI is not authenticated.',kind:'not_authenticated',status:'unavailable'},401);await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('GitHub CLI 尚未授權');expect(screen.getByLabelText('資料來源')).toHaveTextContent('Unavailable');
 expect(screen.queryAllByRole('button',{name:/^PR #/})).toHaveLength(0);expect(screen.queryByText(/DEMO DATA/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 expect(pending[1].url).toContain('refresh=1');
 pending[1].resolve({error:'rate',kind:'rate_limited',resetAt:'2026-10-16T01:00:00.000Z',status:'unavailable'},429);await flush();
 expect(screen.getByRole('alert')).toHaveTextContent('速率限制');expect(screen.getByRole('alert')).toHaveTextContent('2026-10-16 09:00 SGT');
});

test('B1 T: partial history and a failed refresh are labeled, never shown as complete',async()=>{
 const {pending}=mockFetch();render(<Harness/>);openLive();
 pending[0].resolve(makeHistory({status:'partial',warnings:['main history truncated after 1000 commits.']}));await flush();
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('Partial history');expect(screen.getByText(/main history truncated/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));pending[1].resolve({error:'slow',kind:'timeout'},504);await flush();
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('Needs refresh');expect(screen.getByRole('alert')).toHaveTextContent('上一次成功讀取的資料');
 expect(screen.getAllByRole('button',{name:/^PR #/}).length).toBeGreaterThan(0);
});

test('B1 J/Q: switching projects cancels the request and a late PM response never lands in DEMO',async()=>{
 const {pending}=mockFetch();render(<Harness/>);openLive();
 fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getAllByRole('button',{name:/PM Dashboard/})[1]);
 expect(screen.getByLabelText('開發地圖不可用')).toHaveTextContent('DEMO PROJECT');
 pending[0].resolve(makeHistory());await flush();
 expect(screen.queryAllByRole('button',{name:/^PR #/})).toHaveLength(0);expect(document.body.textContent).not.toContain('claude/v23-browser-e2e-hardening');
 expect(pending).toHaveLength(1); // DEMO identity issues no GitHub read
 fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getByRole('button',{name:/SwipeRight/}));
 expect(screen.getByLabelText('開發地圖不可用')).toHaveTextContent('SwipeRight');
});

test('B1 Q: refresh is single-flight and an older response resolving late never replaces newer data',async()=>{
 const {pending}=mockFetch();render(<Harness/>);openLive();pending[0].resolve(makeHistory());await flush();
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
 const {pending}=mockFetch();render(<Harness/>);openLive();pending[0].resolve(makeHistory());await flush();
 expect(screen.getByLabelText('Repository 摘要')).toHaveTextContent('本機 WorktreeNot checked');
 expect(screen.queryByRole('textbox',{name:/指令|Prompt/})).not.toBeInTheDocument();
 expect(screen.queryByRole('tab',{name:/AI 指令|Prompt/})).not.toBeInTheDocument();
 for(const b of screen.getAllByRole('button'))expect(b.textContent).not.toMatch(/執行|Execute|Generate|Dispatch|AI Command|\bMerge\b|Approve|\bDeploy\b/i);
 expect(document.body.textContent).not.toMatch(/\/Users\/|worktrees\//);
});

test('B1: Git topology draws only verified parent edges and reports heads outside the fetched DAG',async()=>{
 const {pending}=mockFetch();render(<Harness/>);openLive();pending[0].resolve(makeHistory());await flush();
 fireEvent.click(screen.getByRole('tab',{name:/Git 拓樸/}));
 const graph=screen.getByRole('region',{name:'Git 拓樸圖'});
 expect(within(graph).getByLabelText('已驗證 parent：h13 → M13')).toHaveAttribute('data-kind','verified-parent');
 expect(within(graph).getByLabelText(/orphan 的 parent missing 不在目前視窗/)).toHaveAttribute('data-kind','outside-window');
 expect(graph).toHaveTextContent('1 個 branch head 不在已取得的 commit 圖中 → ancestry UNKNOWN');
 fireEvent.click(within(graph).getByRole('button',{name:/^commit M13 ·/}));
 const panel=screen.getByRole('dialog',{name:'Commit 詳細資訊'});
 expect(panel).toHaveTextContent('#13（merge commit）');expect(panel).toHaveTextContent('2026-09-24 09:43 SGT');expect(panel).toHaveTextContent(`在已取得的 main 歷史中`);
 fireEvent.click(screen.getByRole('tab',{name:/清單/}));
 expect(screen.getByRole('region',{name:'可捲動 PR 清單'})).toHaveAttribute('tabindex','0');
 expect(screen.getByRole('button',{name:/^PR #55 ·/})).toBeVisible();
});

test('B1: graph is keyboard reachable, scrollable regions are focusable and filters narrow the view',async()=>{
 const {pending}=mockFetch();render(<Harness/>);openLive();pending[0].resolve(makeHistory());await flush();fireEvent.click(screen.getByRole('button',{name:'6 個月'}));
 expect(screen.getByRole('region',{name:/可捲動的開發時間軸/})).toHaveAttribute('tabindex','0');
 const card=screen.getByRole('button',{name:/^PR #57 ·/});card.focus();expect(card).toHaveFocus();
 fireEvent.change(screen.getByLabelText('PR 狀態篩選'),{target:{value:'merged'}});
 expect(screen.queryByRole('button',{name:/^PR #57 ·/})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:/^PR #13 ·/})).toBeVisible();
 fireEvent.change(screen.getByLabelText('PR 狀態篩選'),{target:{value:'all'}});
 fireEvent.click(within(screen.getByRole('group',{name:'分支群組篩選'})).getByRole('button',{name:/V2.3 feature/}));
 expect(screen.queryByRole('button',{name:/^PR #55 ·/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/^PR #56 ·/}));fireEvent.keyDown(window,{key:'Escape'});
 expect(screen.queryByRole('dialog',{name:'PR 詳細資訊'})).not.toBeInTheDocument();
});

// (omitted in V1: the DEMO project cards belong to the prototype shell; V1 identity isolation is tested in ReadOnlyCommandCenter.test.tsx)

// ---------------- P2 provenance remediation: negative controls ----------------
// Written first and run against B1 commit 17a5623, where the SHA/CI, state-change,
// refresh-invalidation, partial-review and drift tests fail.
const SHA_A='e1';const SHA_B='e2';
const detailWith=(number:number,over:{pull?:Partial<HistoryPull>;ci?:{status:string;total:number|null;headSha:string|null};reviews?:{status:string;count:number|null;complete:boolean;observed?:string;headSha?:string|null;reviewers?:unknown[]}}={})=>{
 const base=detailFor(number,'passing');
 return {...base,pull:{...base.pull,...over.pull},ci:over.ci??base.ci,reviews:over.reviews??base.reviews};
};
const openPr=async(n=55,history=makeHistory())=>{const m=mockFetch();render(<Harness/>);openLive();m.pending[0].resolve(history);await flush();fireEvent.click(screen.getByRole('button',{name:'6 個月'}));fireEvent.click(screen.getByRole('button',{name:new RegExp(`^PR #${n} ·`)}));return m;};
const detailReq=(m:{pending:Pending[]},n=55)=>m.pending.filter(p=>p.url.includes('/development-history/pull')&&p.url.includes(`number=${n}`)).at(-1)!;

test('P2-1 negative control: snapshot head SHA A + fresh head SHA B with CI PASS never shows PASS against SHA A',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_B},ci:{status:'passing',total:5,headSha:SHA_B}}));await flush();
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
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
 const ci=within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci');
 expect(ci).toHaveTextContent('Not verified');expect(ci).not.toHaveTextContent(/^CI passed/);
});

test('P2-1: matching SHAs show CI normally with the SHA it was read for and no false stale warning',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55));await flush();
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(within(panel).getByTestId('pr-ci')).toHaveTextContent(`CI passed（5 個 check run） · head ${SHA_A}`);
 expect(panel).not.toHaveTextContent('Needs refresh');expect(panel).not.toHaveTextContent('Stale data');
});

test('P2-1: refreshing the snapshot keeps the selected PR and re-reads its detail instead of reusing the old one',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55));await flush();
 expect(within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci')).toHaveTextContent('CI passed');
 const before=m.pending.length;
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 const snapshot=m.pending.at(-1)!;expect(snapshot.url).toContain('refresh=1');
 snapshot.resolve(makeHistory({fetchedAt:'2026-10-16T03:00:00.000Z',pulls:makeHistory().pulls.map(p=>p.number===55?{...p,headSha:SHA_B}:p)}));await flush();
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
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
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('狀態已變更');expect(panel).toHaveTextContent(label);expect(panel).toHaveTextContent('Needs refresh');
});

test('P2-1: a refreshed snapshot that no longer contains the selected PR is reported, not silently cleared',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55));await flush();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 m.pending.at(-1)!.resolve(makeHistory({pulls:makeHistory().pulls.filter(p=>p.number!==55)}));await flush();
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('PR #55 不在最新快照中');
});

test('P2-2 negative control: incomplete review pagination shows Partial / UNKNOWN, never Approved',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{reviews:{status:'partial',count:300,complete:false,observed:'approved'}}));await flush();
 const review=within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-review');
 expect(review).toHaveTextContent('Partial');expect(review).toHaveTextContent('UNKNOWN');expect(review).toHaveTextContent('300');
 expect(review).not.toHaveTextContent(/^Approved/);expect(review).not.toHaveTextContent('undefined');
});

test('P2-2: a legacy detail that says approved with complete=false is still rendered Partial',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{reviews:{status:'approved',count:300,complete:false}}));await flush();
 const review=within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-review');
 expect(review).toHaveTextContent('Partial');expect(review).not.toHaveTextContent(/^Approved/);
});

test.each([
 ['no_reviews','沒有已送出的 review'],['not_checked','Not checked'],['changes_requested','Changes requested（'],
])('P2-2: complete review state %s keeps its own label',async(status,text)=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{reviews:{status,count:status==='no_reviews'?0:2,complete:status!=='not_checked'}}));await flush();
 const review=within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-review');
 expect(review).toHaveTextContent(text);expect(review).not.toHaveTextContent('Partial');
});

test('Snapshot: drifted refs and PR/branch head mismatches downgrade status and turn ancestry UNKNOWN',async()=>{
 const drifted=makeHistory({status:'partial',warnings:['Branch heads moved during the read: claude/v23-product-integration.'],
  consistency:{atomic:false,status:'inconsistent',rereadAt:'2026-10-15T23:57:30.000Z',driftedRefs:[{ref:'claude/v23-product-integration',observed:'p1',reread:'p9',relevant:true}],prHeadMismatches:[{number:55,headRef:'claude/v23-browser-e2e-hardening',prHeadSha:'e1',branchHeadSha:'e9'}]}});
 const m=await openPr(55,drifted);
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
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
const ciOf=()=>within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci');
const reviewOf=()=>within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-review');

test('P2-3 negative control: missing snapshot SHA + current head B + CI PASS on B never shows an unqualified PASS',async()=>{
 const m=await openPr(55,withSnapshotHead(null));
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_B},ci:{status:'passing',total:5,headSha:SHA_B}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(ciOf()).not.toHaveTextContent(/^CI passed/);expect(ciOf()).not.toHaveTextContent('CI passed（5 個 check run） · head');
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
 expect(reviewOf()).toHaveTextContent('Not verified');
});

test('P2-3: missing current PR SHA is Not verified and Needs refresh',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:{headSha:null},ci:{status:'passing',total:5,headSha:SHA_A}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(ciOf()).not.toHaveTextContent(/^CI passed/);
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
});

test('P2-3: missing CI SHA is Not verified and Needs refresh',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{ci:{status:'passing',total:5,headSha:null}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(ciOf()).not.toHaveTextContent(/^CI passed/);
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
});

test('P2-3: every SHA missing at once still fails closed',async()=>{
 const m=await openPr(55,withSnapshotHead(null));
 detailReq(m).resolve(detailWith(55,{pull:{headSha:null},ci:{status:'passing',total:5,headSha:null}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('Needs refresh');
});

test('P2-3: mismatched SHAs stay Not verified / Stale; matching SHAs are the only path to an unqualified result',async()=>{
 const m=await openPr();
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_A},ci:{status:'passing',total:5,headSha:SHA_B}}));await flush();
 expect(ciOf()).toHaveTextContent('Not verified');
 cleanup();vi.restoreAllMocks();
 const ok=await openPr();
 detailReq(ok).resolve(detailWith(55));await flush();
 expect(ciOf()).toHaveTextContent(`CI passed（5 個 check run） · head ${SHA_A}`);expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).not.toHaveTextContent('Needs refresh');
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
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
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

// ---------------- Track B B1.1 · timeline focus UX ----------------
// Geometry is deterministic: jsdom has no layout, so clientWidth emulates what the
// CSS would do (rail width via --g-rail-w; the OLD has-detail grid column shrinks the chart).
let WINDOW_W=1366;const CONTENT_PAD=56;const OLD_DETAIL_COLUMN=354;
let roCallbacks=new Set<()=>void>();
class MockResizeObserver{cb:()=>void;constructor(cb:()=>void){this.cb=cb;roCallbacks.add(cb);}observe(){}unobserve(){}disconnect(){roCallbacks.delete(this.cb);}}
const railWidth=(el:Element)=>parseFloat((el.closest('.g-shell') as HTMLElement|null)?.style.getPropertyValue('--g-rail-w')||'220');
const frameClient=()=>(document.querySelector('.g-frame') as HTMLElement).clientWidth;
function mockGeometry(){
 roCallbacks=new Set();vi.stubGlobal('ResizeObserver',MockResizeObserver);
 vi.spyOn(Element.prototype,'clientWidth','get').mockImplementation(function(this:Element){
  if(!this.classList.contains('g-frame'))return 0;
  const grid=this.closest('.g-layout');
  return WINDOW_W-railWidth(this)-CONTENT_PAD-2-(grid?.classList.contains('has-detail')?OLD_DETAIL_COLUMN:0);
 });
 vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('g-lane-labels')?(this.classList.contains('is-compact')?76:168):0;});
}
const fireResize=()=>act(async()=>{roCallbacks.forEach(cb=>cb());await Promise.resolve();});
const setRange=(label:'1 個月'|'3 個月'|'6 個月'|'全部歷史')=>fireEvent.click(within(screen.getByRole('group',{name:'時間範圍'})).getByRole('button',{name:label}));
const drawable=()=>frameClient()-(document.querySelector('.g-lane-labels') as HTMLElement).offsetWidth;
const lastCheckedLeft=()=>parseFloat((document.querySelector('.g-now') as HTMLElement).style.left);
// Legacy calendar/regression scenarios explicitly choose their original six-month window.
const loadLive=async(history=makeHistory())=>{const m=mockFetch();render(<Harness/>);openLive();m.pending[0].resolve(history);await flush();setRange('6 個月');return m;};
afterEach(()=>{vi.unstubAllGlobals();roCallbacks=new Set();WINDOW_W=1366;window.innerWidth=1024;});

test('B1.1 negative control A: choosing 1 month must stretch the date axis across the drawable plot width',async()=>{
 mockGeometry();await loadLive();setRange('1 個月');await fireResize();
 expect(lastCheckedLeft()/drawable()).toBeGreaterThanOrEqual(0.9); // old fixed 10 px/day leaves ~65% of the plot blank
});

test('B1.1 negative control B: collapsing the project rail must actually narrow it and release width to the graph',async()=>{
 mockGeometry();await loadLive();
 const before=frameClient();
 fireEvent.click(screen.getByRole('button',{name:'收折側邊欄'}));await fireResize();
 expect(document.querySelector('.g-shell')).toHaveStyle('--g-rail-w: 64px');
 expect(frameClient()-before).toBeGreaterThanOrEqual(150);
});

test('B1.1 negative control C: selecting PR #55 must not shrink the graph container (details float over it)',async()=>{
 mockGeometry();await loadLive();
 const before=frameClient();
 fireEvent.click(screen.getByRole('button',{name:/^PR #55 ·/}));await fireResize();
 expect(frameClient()).toBe(before); // old has-detail grid column removes 354px
 expect(document.querySelector('.g-layout')).not.toHaveClass('has-detail');
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'}).closest('.g-layout')).toBeNull();
});

const DAY=86_400_000;
const canvas=()=>document.querySelector('.g-canvas') as HTMLElement;
const ppd=()=>parseFloat(canvas().dataset.pxPerDay!);
const canvasWidth=()=>parseFloat(canvas().style.width);
const expectedFit=(range:'1m'|'3m'|'6m'|'all')=>{const {start,end}=timelineSpan(makeHistory(),range);return fitPxPerDay({start,end,plotWidth:drawable()});};
const cardEls=()=>[...document.querySelectorAll<HTMLElement>('.g-pr-card')];
const dialogOpen=()=>screen.queryByRole('dialog',{name:/詳細資訊/});
const clickPr=(n:number)=>fireEvent.click(screen.getByRole('button',{name:new RegExp(`^PR #${n} ·`)}));

test.each([['1 個月','1m'],['3 個月','3m'],['6 個月','6m'],['全部歷史','all']] as const)('B1.1 auto fit %s: the real date span fills the drawable plot, no card minimum extends the axis',async(label,range)=>{
 mockGeometry();await loadLive();setRange(label);await fireResize();
 expect(canvas().dataset.fit).toBe('auto');
 expect(ppd()).toBeCloseTo(expectedFit(range),5);
 expect(lastCheckedLeft()/drawable()).toBeGreaterThanOrEqual(0.9);
 expect(lastCheckedLeft()).toBeLessThanOrEqual(drawable()-PLOT_GUTTER_RIGHT+1); // Last checked sits at the right boundary, not beyond it
 expect(canvasWidth()).toBeLessThanOrEqual(drawable()+1); // no unexplained blank tail
 for(const card of cardEls())expect(parseFloat(card.style.left)+parseFloat(card.style.width)).toBeLessThanOrEqual(canvasWidth()); // right-edge cards slide left, the axis does not grow
});

test('B1.1 explicit six-month auto fit fills the plot',async()=>{
 mockGeometry();await loadLive();
 expect(canvas().dataset.fit).toBe('auto');expect(lastCheckedLeft()/drawable()).toBeGreaterThanOrEqual(0.9);
 expect(screen.getByRole('button',{name:'Auto Fit'})).toHaveAttribute('aria-pressed','true');
});

test('B1.1 shorter ranges use a larger px/day than longer ones, with dates unchanged',async()=>{
 mockGeometry();await loadLive();
 const scales:Record<string,number>={};
 for(const [label,r] of [['1 個月','1m'],['3 個月','3m'],['6 個月','6m']] as const){setRange(label);await fireResize();scales[r]=ppd();}
 expect(scales['1m']).toBeGreaterThan(scales['3m']);expect(scales['3m']).toBeGreaterThanOrEqual(scales['6m']);
});

test('B1.1 all history with a long history and a narrow plot stops at the readable floor and scrolls internally',async()=>{
 mockGeometry();WINDOW_W=700;
 const long=makeHistory({pulls:makeHistory().pulls.map(p=>p.number===13?{...p,createdAt:'2026-04-27T01:00:00Z'}:p)});
 await loadLive(long);setRange('全部歷史');await fireResize();
 expect(ppd()).toBe(MIN_FIT_PX_PER_DAY);expect(canvasWidth()).toBeGreaterThan(drawable()); // controlled horizontal scrolling, cards stay readable
 expect(document.querySelector('.g-frame')).toHaveAttribute('tabindex','0');
});

test('B1.1 a span shorter than one day and an empty filter result still render without distortion',async()=>{
 mockGeometry();
 const hourly=makeHistory({fetchedAt:'2026-10-15T23:57:20.883Z',pulls:makeHistory().pulls.map(p=>({...p,createdAt:'2026-10-15T21:00:00Z',updatedAt:'2026-10-15T21:00:00Z',mergedAt:p.merged?'2026-10-15T22:00:00Z':null,closedAt:p.merged?'2026-10-15T22:00:00Z':null}))});
 await loadLive(hourly);setRange('全部歷史');await fireResize();
 expect(lastCheckedLeft()).toBeLessThanOrEqual(drawable());expect(Number.isFinite(ppd())).toBe(true);
 fireEvent.change(screen.getByLabelText('搜尋 PR 或分支'),{target:{value:'zzzz-no-match'}});
 expect(cardEls()).toHaveLength(0);expect(document.querySelectorAll('.g-tick-label').length).toBeGreaterThan(0);
});

test('B1.1 window resize recalculates the scale and keeps the plot full',async()=>{
 mockGeometry();await loadLive();setRange('1 個月');await fireResize();
 const wide=ppd();
 WINDOW_W=1000;await fireResize();
 expect(ppd()).toBeLessThan(wide);expect(ppd()).toBeCloseTo(expectedFit('1m'),5);expect(lastCheckedLeft()/drawable()).toBeGreaterThanOrEqual(0.9);
});

test('B1.1 project rail collapse then expand: width changes, graph gains space and refits, no refetch, project kept',async()=>{
 mockGeometry();const m=await loadLive();setRange('1 個月');await fireResize();
 const rail=screen.getByRole('navigation',{name:'專案（開發地圖）'});
 const toggle=within(rail).getByRole('button',{name:'收折側邊欄'});
 expect(toggle).toHaveAttribute('aria-expanded','true');expect(document.querySelector('.g-shell')).toHaveStyle('--g-rail-w: 220px');
 const wideFrame=frameClient();const scaleBefore=ppd();
 fireEvent.click(toggle);await fireResize();
 const open=within(rail).getByRole('button',{name:'展開側邊欄'});
 expect(open).toHaveAttribute('aria-expanded','false');expect(document.querySelector('.g-shell')).toHaveStyle('--g-rail-w: 64px');
 expect(frameClient()).toBeGreaterThan(wideFrame);expect(ppd()).toBeGreaterThan(scaleBefore);expect(lastCheckedLeft()/drawable()).toBeGreaterThanOrEqual(0.9);
 expect(within(rail).getByRole('button',{name:/PM Dashboard · LIVE/})).toHaveAttribute('aria-current','page'); // selected project still marked, with an accessible name
 expect(screen.getByRole('heading',{name:'PM Dashboard'})).toBeVisible();
 fireEvent.click(open);await fireResize();
 expect(document.querySelector('.g-shell')).toHaveStyle('--g-rail-w: 220px');expect(frameClient()).toBe(wideFrame);expect(ppd()).toBeCloseTo(scaleBefore,5);
 expect(m.pending.filter(p=>p.url.includes('development-history?'))).toHaveLength(1); // collapsing/expanding never refetched GitHub
});

test('B1.1 rail is keyboard operable and does not switch project',async()=>{
 mockGeometry();await loadLive();
 const toggle=screen.getByRole('button',{name:'收折側邊欄'});toggle.focus();expect(toggle).toHaveFocus();
 fireEvent.click(toggle);expect(screen.getByRole('button',{name:'展開側邊欄'})).toHaveAttribute('aria-expanded','false');
 expect(screen.getByRole('heading',{name:'PM Dashboard'})).toBeVisible();expect(screen.getByText('REGISTERED')).toBeVisible();expect(screen.getByTestId('g-source-badge')).toHaveTextContent('GitHub 唯讀');
});

test('B1.1 compact branch labels narrow the label column, keep main and production-pages identifiable, and refit',async()=>{
 mockGeometry();await loadLive();setRange('1 個月');await fireResize();
 const labels=document.querySelector('.g-lane-labels') as HTMLElement;const before=drawable();const scaleBefore=ppd();
 fireEvent.click(screen.getByRole('button',{name:'收合分支標籤'}));await fireResize();
 expect(labels).toHaveClass('is-compact');expect(labels.offsetWidth).toBe(76);
 expect(drawable()).toBeGreaterThan(before);expect(ppd()).toBeGreaterThan(scaleBefore);expect(lastCheckedLeft()/drawable()).toBeGreaterThanOrEqual(0.9);
 expect(within(labels).getByText('main')).toHaveAttribute('title','main');
 expect(within(labels).getByText('prod')).toHaveAttribute('title','production-pages');
 fireEvent.click(screen.getByRole('button',{name:'展開分支標籤'}));await fireResize();expect(labels).not.toHaveClass('is-compact');expect(labels.offsetWidth).toBe(168);
});

test('B1.1 zoom in and zoom out switch to manual; Auto Fit restores the responsive scale; a new range resets to Auto Fit',async()=>{
 mockGeometry();await loadLive();setRange('1 個月');await fireResize();
 const fitScale=ppd();
 fireEvent.click(screen.getByRole('button',{name:'放大'}));
 expect(canvas().dataset.fit).toBe('manual');expect(screen.getByRole('button',{name:'Auto Fit'})).toHaveAttribute('aria-pressed','false');expect(ppd()).toBeGreaterThan(fitScale);
 fireEvent.click(screen.getByRole('button',{name:'Auto Fit'}));await fireResize();
 expect(canvas().dataset.fit).toBe('auto');expect(ppd()).toBeCloseTo(fitScale,5);
 fireEvent.click(screen.getByRole('button',{name:'縮小'}));
 expect(canvas().dataset.fit).toBe('manual');expect(ppd()).toBeLessThan(fitScale);
 setRange('3 個月');await fireResize();expect(canvas().dataset.fit).toBe('auto');
 fireEvent.click(screen.getByRole('button',{name:'放大'}));fireEvent.click(screen.getByRole('button',{name:'放大'}));
 setRange('6 個月');await fireResize();expect(canvas().dataset.fit).toBe('auto'); // changing the range always restarts at Auto Fit
});

test('B1.1 real date alignment: ticks, Last checked and commit dots sit at their true SGT positions',async()=>{
 mockGeometry();await loadLive();setRange('1 個月');await fireResize();
 const {start,end}=timelineSpan(makeHistory(),'1m');const scale=ppd();
 const x=(ms:number)=>PLOT_GUTTER_LEFT+((ms-start)/DAY)*scale;
 const ticks=[...document.querySelectorAll<HTMLElement>('.g-tick-label')];expect(ticks.length).toBeGreaterThan(2);
 for(const t of ticks){const day=t.textContent!;expect(day).toMatch(/^2026-\d\d-\d\d$/);expect(parseFloat(t.style.left)).toBeCloseTo(x(Date.parse(`${day}T00:00:00+08:00`)),1);}
 expect(lastCheckedLeft()).toBeCloseTo(x(end),1);
 const dot=screen.getByRole('button',{name:/^main commit M13 ·/});
 expect(parseFloat(dot.style.left)).toBeCloseTo(x(Date.parse('2026-09-24T01:43:01Z')),1);
 expect(formatSgt('2026-09-24T01:43:01Z')).toBe('2026-09-24 09:43 SGT');
});

test('B1.1 Git relationships are unchanged by auto-fit: verified, record-only and reported-base edges keep their kinds',async()=>{
 mockGeometry();await loadLive();setRange('1 個月');await fireResize();
 expect(screen.getByLabelText(/PR #13 合併到 main：已驗證/)).toHaveAttribute('data-kind','verified-merge');
 expect(screen.getByLabelText(/PR #55 回報的 base：claude\/v23-product-integration（PR #53 的 head）/)).toHaveAttribute('data-kind','reported-base');
 cleanup();vi.restoreAllMocks();mockGeometry();
 await loadLive(makeHistory({commits:makeHistory().commits.filter(c=>c.sha!=='M13')}));setRange('1 個月');await fireResize();
 expect(screen.getByLabelText(/PR #13 合併到 main：UNKNOWN/)).toHaveAttribute('data-kind','pr-record'); // UNKNOWN never becomes a solid edge
});

// ---- floating detail ----
test('B1.1 default state has no detail panel; selecting a PR opens a non-modal floating dialog that does not shrink the graph',async()=>{
 mockGeometry();await loadLive();
 expect(dialogOpen()).toBeNull();expect(document.querySelector('.g-detail')).toBeNull();
 const before=frameClient();const scaleBefore=ppd();
 clickPr(55);await fireResize();
 const dialog=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(dialog).toHaveAttribute('aria-modal','false');expect(dialog).toHaveClass('g-floating');expect(dialog.closest('.g-layout')).toBeNull();
 expect(within(dialog).getByRole('heading',{name:/#55/})).toBeVisible();expect(within(dialog).getByRole('link',{name:/在 GitHub 開啟 PR #55/})).toHaveAttribute('href',expect.stringContaining('/pull/55'));
 expect(frameClient()).toBe(before);expect(ppd()).toBe(scaleBefore);
 clickPr(57);expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('#57'); // another node updates the same dialog
 expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

test('B1.1 selecting a commit opens the floating dialog too',async()=>{
 mockGeometry();await loadLive();
 fireEvent.click(screen.getByRole('button',{name:/^main commit M13 ·/}));
 const dialog=screen.getByRole('dialog',{name:'Commit 詳細資訊'});expect(dialog).toHaveTextContent('2026-09-24 09:43 SGT');expect(dialog).toHaveTextContent('#13（merge commit）');
 expect(document.querySelector('.g-layout')).not.toHaveClass('has-detail');
});

test('B1.1 topology and list selections also use the floating dialog',async()=>{
 mockGeometry();await loadLive();
 fireEvent.click(screen.getByRole('tab',{name:/清單/}));fireEvent.click(screen.getByRole('button',{name:/^PR #55 ·/}));
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'}).closest('.g-layout')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));
 fireEvent.click(screen.getByRole('tab',{name:/Git 拓樸/}));fireEvent.click(within(screen.getByRole('region',{name:'Git 拓樸圖'})).getByRole('button',{name:/^commit M13 ·/}));
 expect(screen.getByRole('dialog',{name:'Commit 詳細資訊'})).toBeVisible();expect(document.querySelector('.g-layout')).not.toHaveClass('has-detail');
});

test('B1.1 close button, Escape and outside click each close the dialog; node clicks and in-dialog clicks do not',async()=>{
 mockGeometry();await loadLive();
 clickPr(55);fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));expect(dialogOpen()).toBeNull();
 clickPr(55);fireEvent.keyDown(window,{key:'Escape'});expect(dialogOpen()).toBeNull();
 clickPr(55);fireEvent.pointerDown(document.body);expect(dialogOpen()).toBeNull();
 clickPr(55);fireEvent.pointerDown(screen.getByRole('dialog',{name:'PR 詳細資訊'}));expect(dialogOpen()).not.toBeNull(); // inside the panel
 fireEvent.pointerDown(screen.getByRole('button',{name:/^PR #57 ·/}));expect(dialogOpen()).not.toBeNull(); // a node click switches nodes instead of closing
});

test('B1.1 focus moves into the dialog on open and returns to the originating node on close',async()=>{
 mockGeometry();await loadLive();
 const card=screen.getByRole('button',{name:/^PR #55 ·/});card.focus();fireEvent.click(card);
 const dialog=screen.getByRole('dialog',{name:'PR 詳細資訊'});expect(dialog).toHaveFocus();
 fireEvent.keyDown(window,{key:'Escape'});expect(dialogOpen()).toBeNull();expect(screen.getByRole('button',{name:/^PR #55 ·/})).toHaveFocus();
});

test('B1.1 when the originating node no longer exists, focus falls back to the scrollable timeline',async()=>{
 mockGeometry();await loadLive();
 clickPr(55);
 fireEvent.change(screen.getByLabelText('PR 狀態篩選'),{target:{value:'merged'}}); // #55 (draft) disappears while its dialog is open
 expect(screen.queryByRole('button',{name:/^PR #55 ·/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));
 expect(document.activeElement).toBe(document.querySelector('.g-frame'));
});

test('B1.1 mobile: details open as a modal bottom sheet with backdrop, focus trap and a close button',async()=>{
 mockGeometry();window.innerWidth=390;WINDOW_W=390;await loadLive();
 clickPr(55);
 const sheet=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(sheet).toHaveClass('is-sheet');expect(sheet).toHaveAttribute('aria-modal','true');expect(screen.getByTestId('g-backdrop')).toBeInTheDocument();
 expect(within(sheet).getByRole('button',{name:'關閉詳細資訊'})).toBeVisible();expect(sheet).toHaveTextContent('Repository');expect(sheet).toHaveTextContent('Git ancestry');
 const focusables=sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');const last=focusables[focusables.length-1];const first=focusables[0];
 last.focus();fireEvent.keyDown(sheet,{key:'Tab'});expect(first).toHaveFocus(); // focus cannot escape behind the sheet
 first.focus();fireEvent.keyDown(sheet,{key:'Tab',shiftKey:true});expect(last).toHaveFocus();
 fireEvent.click(screen.getByTestId('g-backdrop'));expect(dialogOpen()).toBeNull();expect(screen.queryByTestId('g-backdrop')).toBeNull();
 clickPr(55);fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));expect(dialogOpen()).toBeNull();
 expect(document.querySelector('.g-frame')).toHaveAttribute('tabindex','0'); // the timeline keeps its own scrolling
});

test('B1.1 closing the dialog preserves scroll position, scale, range, filters, search and the history snapshot',async()=>{
 mockGeometry();const m=await loadLive();
 setRange('3 個月');await fireResize();fireEvent.click(screen.getByRole('button',{name:'放大'}));
 fireEvent.change(screen.getByLabelText('PR 狀態篩選'),{target:{value:'active'}});
 fireEvent.change(screen.getByLabelText('搜尋 PR 或分支'),{target:{value:'v23'}});
 fireEvent.click(within(screen.getByRole('group',{name:'分支群組篩選'})).getByRole('button',{name:/Permissions/}));
 const frame=document.querySelector('.g-frame') as HTMLElement;frame.scrollLeft=120;frame.scrollTop=40;fireEvent.scroll(frame);
 const scale=ppd();const fetched=screen.getByLabelText('資料來源').textContent;
 clickPr(55);await fireResize();fireEvent.keyDown(window,{key:'Escape'});await fireResize();
 expect(frame.scrollLeft).toBe(120);expect(frame.scrollTop).toBe(40);
 expect(ppd()).toBe(scale);expect(canvas().dataset.fit).toBe('manual');
 expect(screen.getByLabelText('PR 狀態篩選')).toHaveValue('active');expect(screen.getByLabelText('搜尋 PR 或分支')).toHaveValue('v23');
 expect(within(screen.getByRole('group',{name:'時間範圍'})).getByRole('button',{name:'3 個月'})).toHaveAttribute('aria-pressed','true');
 expect(within(screen.getByRole('group',{name:'分支群組篩選'})).getByRole('button',{name:/Permissions/})).toHaveAttribute('aria-pressed','false');
 expect(screen.getByLabelText('資料來源').textContent).toBe(fetched);
 expect(m.pending.filter(p=>p.url.includes('development-history?'))).toHaveLength(1);
});

test('B1.1 manual zoom keeps the same moment centred instead of jumping',async()=>{
 mockGeometry();await loadLive();setRange('6 個月');await fireResize();
 fireEvent.click(screen.getByRole('button',{name:'放大'}));fireEvent.click(screen.getByRole('button',{name:'放大'}));
 const frame=document.querySelector('.g-frame') as HTMLElement;frame.scrollLeft=300;fireEvent.scroll(frame);
 const {start}=timelineSpan(makeHistory(),'6m');const view=drawable();
 const centre=(scroll:number,scale:number)=>start+((scroll+view/2-PLOT_GUTTER_LEFT)/scale)*DAY;
 const before=centre(300,ppd());
 fireEvent.click(screen.getByRole('button',{name:'放大'}));
 expect(centre(frame.scrollLeft,ppd())).toBeCloseTo(before,-4); // within ~10s of the same centre time
});

test('B1.1 opening, closing and collapsing only issue GET reads on the allowlisted history endpoints',async()=>{
 mockGeometry();const m=await loadLive();
 clickPr(55);m.pending.filter(p=>p.url.includes('/pull?')).forEach(p=>p.resolve(detailFor(55,'passing')));await flush();
 fireEvent.keyDown(window,{key:'Escape'});fireEvent.click(screen.getByRole('button',{name:'收折側邊欄'}));
 const calls=(globalThis.fetch as unknown as {mock:{calls:[RequestInfo,RequestInit?][]}}).mock.calls;
 for(const [u,init] of calls){expect(String(u)).toMatch(/^\/api\/github\/development-history/);expect(init?.method??'GET').toBe('GET');}
 expect(calls.filter(([u])=>!String(u).includes('/pull?'))).toHaveLength(1);
});

test('B1.1 switching project while the dialog is open closes it and leaks nothing from PM Dashboard',async()=>{
 mockGeometry();const m=await loadLive();clickPr(55);
 expect(dialogOpen()).not.toBeNull();
 fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getByRole('button',{name:/SwipeRight/}));
 expect(dialogOpen()).toBeNull();expect(screen.getByLabelText('開發地圖不可用')).toHaveTextContent('SwipeRight');
 m.pending.filter(p=>p.url.includes('/pull?')).forEach(p=>p.resolve(detailFor(55,'passing')));await flush();
 expect(dialogOpen()).toBeNull();expect(document.body.textContent).not.toContain('claude/v23-browser-e2e-hardening');
});

test('B1.1 CI and review provenance are unchanged inside the floating dialog',async()=>{
 mockGeometry();const m=await loadLive();clickPr(55);
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_B},ci:{status:'passing',total:5,headSha:SHA_B},reviews:{status:'partial',count:300,complete:false,observed:'approved'}}));await flush();
 const dialog=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(within(dialog).getByTestId('pr-ci')).toHaveTextContent('Stale data');expect(within(dialog).getByTestId('pr-ci')).not.toHaveTextContent(/^CI passed/);
 expect(within(dialog).getByTestId('pr-review')).toHaveTextContent('Not verified');expect(dialog).toHaveTextContent('Needs refresh');
});

test('B1.1 no agent, prompt or model controls exist in the focus UX',async()=>{
 mockGeometry();await loadLive();clickPr(55);
 for(const b of screen.getAllByRole('button'))expect(b.textContent+(b.getAttribute('aria-label')??'')).not.toMatch(/執行|Execute|Generate|Dispatch|AI Command|Prompt|\bMerge\b|Approve|\bDeploy\b/i);
 expect(screen.queryByRole('textbox',{name:/指令|Prompt/})).toBeNull();
});

// ---------------- B1.1 six-P2 remediation: negative controls (written first, run against PR #37 HEAD 4e36fff) ----------------
import {readFileSync} from 'node:fs';
const shortHistory=(fetchedAt:string,createdAts:string[])=>{
 const base=makeHistory();
 return makeHistory({fetchedAt,pulls:base.pulls.slice(0,createdAts.length).map((p,i)=>({...p,createdAt:createdAts[i],updatedAt:createdAts[i],mergedAt:p.merged?createdAts[i]:null,closedAt:p.merged?createdAts[i]:null}))});
};
const fillOf=()=>lastCheckedLeft()/drawable();
// 'all' starts at the SGT midnight of the earliest PR, so fetchedAt shortly after 16:00Z gives a sub-day span.
const SHORT_CASES:[string,string,string[]][]=[
 ['30-minute history','2026-10-15T16:30:00.000Z',['2026-10-15T16:05:00Z','2026-10-15T16:12:00Z','2026-10-15T16:20:00Z']],
 ['1-hour history','2026-10-15T17:00:00.000Z',['2026-10-15T16:05:00Z','2026-10-15T16:30:00Z','2026-10-15T16:50:00Z']],
 ['1-day history','2026-10-16T15:30:00.000Z',['2026-10-15T16:10:00Z','2026-10-16T02:00:00Z','2026-10-16T12:00:00Z']],
 ['dense history (many PRs in minutes)','2026-10-15T16:30:00.000Z',['2026-10-15T16:01:00Z','2026-10-15T16:02:00Z','2026-10-15T16:03:00Z','2026-10-15T16:04:00Z','2026-10-15T16:05:00Z','2026-10-15T16:06:00Z','2026-10-15T16:07:00Z','2026-10-15T16:08:00Z','2026-10-15T16:09:00Z','2026-10-15T16:10:00Z']],
];
test.each(SHORT_CASES)('P2-1 negative control: %s fills the drawable plot, stays inside it and keeps readable ticks',async(_n,fetchedAt,created)=>{
 mockGeometry();await loadLive(shortHistory(fetchedAt,created));setRange('全部歷史');await fireResize();
 expect(canvas().dataset.fit).toBe('auto');
 expect(fillOf()).toBeGreaterThanOrEqual(0.9); // old clamp: 1-day minimum span and 60 px/day cap leave ~3–7%
 expect(canvasWidth()).toBeLessThanOrEqual(drawable()+1);
 for(const card of cardEls())expect(parseFloat(card.style.left)+parseFloat(card.style.width)).toBeLessThanOrEqual(canvasWidth());
 const labels=[...document.querySelectorAll('.g-tick-label')].map(t=>t.textContent);
 expect(labels.length).toBeGreaterThanOrEqual(2);expect(new Set(labels).size).toBe(labels.length); // sub-day spans get time-of-day ticks
});

test('P2-1: fitPxPerDay fits actual positive spans and handles zero, inverted and invalid intervals safely',()=>{
 const plotWidth=920;const MIN=60_000;
 for(const spanMs of [30*MIN,60*MIN,1440*MIN,30*1440*MIN]){
  const scale=fitPxPerDay({start:0,end:spanMs,plotWidth});
  expect(PLOT_GUTTER_LEFT+(spanMs/DAY)*scale+PLOT_GUTTER_RIGHT).toBeCloseTo(plotWidth,3); // the span spans exactly the plot
 }
 for(const bad of [{start:5,end:5},{start:9,end:1},{start:NaN,end:1},{start:0,end:Infinity}]){
  const scale=fitPxPerDay({...bad,plotWidth});expect(Number.isFinite(scale)).toBe(true);expect(scale).toBeGreaterThan(0);
 }
 expect(Number.isFinite(fitPxPerDay({start:0,end:DAY,plotWidth:0}))).toBe(true);
 expect(Number.isFinite(fitPxPerDay({start:0,end:DAY,plotWidth:-5}))).toBe(true);
});

test('P2-1: an empty history and a zero-length interval render without NaN or overflow',async()=>{
 mockGeometry();
 await loadLive(makeHistory({pulls:[],fetchedAt:'2026-10-15T16:00:00.000Z'})); // fetched exactly at SGT midnight: start === end
 setRange('全部歷史');await fireResize();
 expect(Number.isFinite(ppd())).toBe(true);expect(Number.isFinite(lastCheckedLeft())).toBe(true);expect(canvasWidth()).toBeLessThanOrEqual(drawable()+1);
 expect(cardEls()).toHaveLength(0);
});

const ZOOM_CASES:[string,number,'1 個月'|'3 個月'|'6 個月'|'全部歷史'][]=[
 ['fit above 60 px/day (the old cap)',2800,'1 個月'],['fit ≈ 29 px/day',1366,'1 個月'],['fit ≈ 10 px/day',1366,'3 個月'],['fit at the 4 px/day floor',700,'全部歷史'],
];
test.each(ZOOM_CASES)('P2-2 negative control: from Auto Fit (%s) Zoom In increases and Zoom Out decreases the effective scale',async(_n,width,range)=>{
 mockGeometry();WINDOW_W=width;
 const long=makeHistory({pulls:makeHistory().pulls.map(p=>p.number===13?{...p,createdAt:'2026-04-27T01:00:00Z'}:p)});
 await loadLive(range==='全部歷史'?long:makeHistory());setRange(range);await fireResize();
 const fit=ppd();
 fireEvent.click(screen.getByRole('button',{name:'放大'}));expect(canvas().dataset.fit).toBe('manual');
 expect(ppd()).toBeGreaterThan(fit); // old: 60 -> 40 px/day shrinks the graph
 fireEvent.click(screen.getByRole('button',{name:'Auto Fit'}));await fireResize();expect(ppd()).toBeCloseTo(fit,5);
 fireEvent.click(screen.getByRole('button',{name:'縮小'}));
 expect(ppd()).toBeLessThan(fit);
});

test('P2-2: repeated zoom in and out is strictly monotonic and reversible, then Auto Fit restores the fit',async()=>{
 mockGeometry();WINDOW_W=2800;await loadLive();setRange('1 個月');await fireResize();
 const fit=ppd();const seen=[fit];
 for(let i=0;i<3;i++){fireEvent.click(screen.getByRole('button',{name:'放大'}));seen.push(ppd());}
 for(let i=1;i<seen.length;i++)expect(seen[i]).toBeGreaterThan(seen[i-1]);
 for(let i=0;i<3;i++){fireEvent.click(screen.getByRole('button',{name:'縮小'}));const now=ppd();expect(now).toBeLessThan(seen[seen.length-1-i]);}
 expect(ppd()).toBeCloseTo(fit,5);
 fireEvent.click(screen.getByRole('button',{name:'Auto Fit'}));await fireResize();expect(canvas().dataset.fit).toBe('auto');expect(ppd()).toBeCloseTo(fit,5);
});

test('P2-2: at a numeric boundary the zoom button is disabled instead of reversing direction',async()=>{
 mockGeometry();await loadLive();setRange('1 個月');await fireResize();
 for(let i=0;i<40&&!(screen.getByRole('button',{name:'放大'}) as HTMLButtonElement).disabled;i++){const before=ppd();fireEvent.click(screen.getByRole('button',{name:'放大'}));expect(ppd()).toBeGreaterThan(before);}
 expect(screen.getByRole('button',{name:'放大'})).toBeDisabled();expect(canvasWidth()).toBeLessThan(250_000);
 for(let i=0;i<80&&!(screen.getByRole('button',{name:'縮小'}) as HTMLButtonElement).disabled;i++){const before=ppd();fireEvent.click(screen.getByRole('button',{name:'縮小'}));expect(ppd()).toBeLessThan(before);}
 expect(screen.getByRole('button',{name:'縮小'})).toBeDisabled();expect(ppd()).toBeGreaterThan(0);
});

const detailRequests=(m:{pending:Pending[]},n=55)=>m.pending.filter(p=>p.url.includes('/development-history/pull')&&p.url.includes(`number=${n}`));
test('P2-3 negative control: closing and reopening the same PR on the same snapshot reuses the detail (no second GET)',async()=>{
 const m=await openPr();expect(detailRequests(m)).toHaveLength(1);
 detailReq(m).resolve(detailWith(55));await flush();
 expect(within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci')).toHaveTextContent('CI passed');
 fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));expect(screen.queryByRole('dialog')).toBeNull();
 clickPr(55);await flush();
 expect(detailRequests(m)).toHaveLength(1); // old: 2
 expect(within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci')).toHaveTextContent('CI passed（5 個 check run） · head e1'); // shown immediately from the cache
});

test('P2-3: a refreshed snapshot invalidates the cache; the SHA fail-closed guard still applies to cached detail',async()=>{
 const m=await openPr();detailReq(m).resolve(detailWith(55));await flush();
 fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 m.pending.at(-1)!.resolve(makeHistory({fetchedAt:'2026-10-16T03:00:00.000Z',pulls:makeHistory().pulls.map(p=>p.number===55?{...p,headSha:SHA_B}:p)}));await flush();
 clickPr(55);await flush();
 expect(detailRequests(m)).toHaveLength(2); // new snapshot version => a fresh detail request is allowed
 expect(within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci')).toHaveTextContent('Not checked'); // the old CI is not reused
 detailReq(m).resolve(detailWith(55,{pull:{headSha:SHA_A},ci:{status:'passing',total:5,headSha:SHA_A}}));await flush();
 const dialog=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(within(dialog).getByTestId('pr-ci')).toHaveTextContent('Stale data');expect(within(dialog).getByTestId('pr-ci')).not.toHaveTextContent(/^CI passed/);
 fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));clickPr(55);await flush();
 expect(detailRequests(m)).toHaveLength(2);expect(within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci')).toHaveTextContent('Stale data'); // cached, still fail-closed
});

test('P2-3: the cache does not leak across projects or sessions',async()=>{
 const m=await openPr();detailReq(m).resolve(detailWith(55));await flush();fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));
 const rail=()=>within(screen.getByRole('navigation',{name:'專案（開發地圖）'}));
 fireEvent.click(rail().getByRole('button',{name:/SwipeRight/}));expect(screen.getByLabelText('開發地圖不可用')).toBeVisible();
 fireEvent.click(rail().getByRole('button',{name:/PM Dashboard · LIVE/}));
 const history=m.pending.filter(p=>p.url.includes('development-history?')).at(-1)!;history.resolve(makeHistory());await flush();
 clickPr(55);await flush();
 expect(detailRequests(m)).toHaveLength(2); // a new project session starts with an empty cache
 expect(within(screen.getByRole('dialog',{name:'PR 詳細資訊'})).getByTestId('pr-ci')).toHaveTextContent('Not checked');
});

// The 最近合併 card also lists milestone PRs after the merges, so the first match is the merge entry.
const bottom=(label:string,card='OPEN PR 堆疊')=>within(screen.getByRole('heading',{name:new RegExp(`^${card}`)}).closest('article') as HTMLElement).getAllByRole('button',{name:label})[0];
const ENTRIES:[string,()=>Promise<HTMLElement>][]=[
 ['timeline PR card',async()=>screen.getByRole('button',{name:/^PR #55 ·/})],
 ['timeline commit node',async()=>screen.getByRole('button',{name:/^main commit M13 ·/})],
 ['PR list link',async()=>{fireEvent.click(screen.getByRole('tab',{name:/清單/}));return screen.getByRole('button',{name:/^PR #55 ·/});}],
 ['Git topology node',async()=>{fireEvent.click(screen.getByRole('tab',{name:/Git 拓樸/}));return within(screen.getByRole('region',{name:'Git 拓樸圖'})).getByRole('button',{name:/^commit M13 ·/});}],
 ['bottom info card (OPEN PR stack)',async()=>bottom('#55')],
 ['bottom info card (recent merge)',async()=>bottom('#13','最近合併')],
];
const CLOSERS:[string,()=>void][]=[
 ['Close button',()=>fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}))],
 ['Escape',()=>fireEvent.keyDown(window,{key:'Escape'})],
 ['outside click',()=>fireEvent.pointerDown(document.body)],
];
describe.each(ENTRIES)('P2-4 focus origin: %s',(_label,getEntry)=>{
 test.each(CLOSERS)('closed by %s returns focus to the element that opened the panel',async(_c,close)=>{
  mockGeometry();await loadLive();
  const frame=document.querySelector('.g-frame') as HTMLElement;frame.scrollTop=40;frame.scrollLeft=0;
  const opener=await getEntry();fireEvent.click(opener);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  close();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener); // old: bottom-card openers land on the timeline card
  if(frame.isConnected)expect(frame.scrollTop).toBe(40); // restoring focus must not move the graph
 });
});

test('P2-4: when the opener is gone, focus falls back to the visible scrollable region instead of the page body',async()=>{
 mockGeometry();await loadLive();
 fireEvent.click(screen.getByRole('button',{name:/^PR #55 ·/})); // opened from a timeline card ...
 fireEvent.click(screen.getByRole('tab',{name:/Git 拓樸/}));     // ... whose view is then replaced, disconnecting the opener
 expect(screen.queryByRole('button',{name:/^PR #55 ·/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'關閉詳細資訊'}));
 expect(document.activeElement).toBe(screen.getByRole('region',{name:'可水平捲動的 Git 拓樸'}));
});

test('P2-5 negative control: a desktop panel that becomes a mobile modal pulls focus inside and traps the keyboard',async()=>{
 mockGeometry();await loadLive();
 clickPr(55);const dialog=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(dialog).toHaveAttribute('aria-modal','false');expect(screen.queryByTestId('g-backdrop')).toBeNull();
 const background=screen.getByRole('button',{name:'Auto Fit'});background.focus();expect(background).toHaveFocus();
 window.innerWidth=390;await act(async()=>{window.dispatchEvent(new Event('resize'));await Promise.resolve();});
 const sheet=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(sheet).toHaveAttribute('aria-modal','true');expect(screen.getByTestId('g-backdrop')).toBeInTheDocument();
 expect(sheet.contains(document.activeElement)).toBe(true); // old: focus stays on the background Auto Fit button
 background.focus();expect(sheet.contains(document.activeElement)).toBe(true); // a background control cannot keep focus
 const items=sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');const first=items[0];const last=items[items.length-1];
 last.focus();fireEvent.keyDown(sheet,{key:'Tab'});expect(first).toHaveFocus();
 first.focus();fireEvent.keyDown(sheet,{key:'Tab',shiftKey:true});expect(last).toHaveFocus();
 for(const control of [screen.getByRole('button',{name:'放大'}),screen.getByLabelText('PR 狀態篩選'),screen.getByRole('tab',{name:/清單/})]){control.focus();expect(sheet.contains(document.activeElement)).toBe(true);}
});

test('P2-5: going back to desktop restores the non-modal behaviour',async()=>{
 mockGeometry();window.innerWidth=390;await loadLive();clickPr(55);
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveAttribute('aria-modal','true');
 window.innerWidth=1024;await act(async()=>{window.dispatchEvent(new Event('resize'));await Promise.resolve();});
 const dialog=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(dialog).toHaveAttribute('aria-modal','false');expect(screen.queryByTestId('g-backdrop')).toBeNull();expect(dialog).not.toHaveClass('is-sheet');
 const background=screen.getByRole('button',{name:'Auto Fit'});background.focus();expect(background).toHaveFocus(); // background is usable again
 fireEvent.pointerDown(document.body);expect(screen.queryByRole('dialog')).toBeNull();
});

// ---- P2-6: the CSS cascade, computed from the real stylesheet text ----
type CssRule={selectors:string[];decl:Record<string,string>;maxWidth:number|null;order:number};
function parseCss(text:string):CssRule[]{
 const css=text.replace(/\/\*[\s\S]*?\*\//g,'');const rules:CssRule[]=[];let i=0;let order=0;
 const skipBlock=()=>{let depth=0;do{if(css[i]==='{')depth++;if(css[i]==='}')depth--;i++;}while(depth>0&&i<css.length);};
 const block=(maxWidth:number|null)=>{
  while(i<css.length){
   while(/\s/.test(css[i]??'x'))i++;
   if(i>=css.length)return;
   if(css[i]==='}'){i++;return;}
   const open=css.indexOf('{',i);const head=css.slice(i,open).trim();
   if(head.startsWith('@media')){const m=head.replace(/\s/g,'').match(/max-width:(\d+)px/);i=open+1;block(m?Number(m[1]):-1);continue;}
   if(head.startsWith('@')){i=open;skipBlock();continue;}
   const close=css.indexOf('}',open);const decl:Record<string,string>={};
   for(const d of css.slice(open+1,close).split(';')){const k=d.indexOf(':');if(k>0)decl[d.slice(0,k).trim()]=d.slice(k+1).trim().replace(/\s*!important/,'');}
   rules.push({selectors:head.split(',').map(x=>x.trim()),decl,maxWidth,order:order++});i=close+1;
  }
 };
 block(null);return rules;
}
const cascade=(rules:CssRule[],selector:string,prop:string,viewport:number)=>{
 let winner:string|undefined;let best=-1;
 const specificity=(s:string)=>(s.match(/\.[\w-]+|\[[^\]]+\]/g)??[]).length*10+(s.match(/(^|[\s>+~])[a-z][\w-]*/gi)??[]).length;
 for(const r of rules){
  if(r.maxWidth!==null&&(r.maxWidth<0||viewport>r.maxWidth))continue;
  if(!r.selectors.includes(selector))continue;
  const value=r.decl[prop]??(prop==='overflow-x'||prop==='overflow-y'?r.decl.overflow:undefined);
  if(value===undefined)continue;
  const weight=specificity(selector)*100000+r.order;if(weight>=best){best=weight;winner=value;}
 }
 return winner;
};
const stylesheet=parseCss(readFileSync(`${process.cwd()}/src/prototype/prototype.css`,'utf8'));

test('P2-6 negative control: at 390 px the project rail is a horizontal, scrollable strip; at 1366 px a vertical rail',()=>{
 for(const [selector,prop,mobile,desktop] of [
  ['.g-rail','flex-direction','row','column'],['.g-rail-list','flex-direction','row','column'],['.g-rail','overflow-x','auto','hidden'],
 ] as const){
  expect(cascade(stylesheet,selector,prop,390),`${selector} ${prop} @390`).toBe(mobile); // old: column / hidden win because they are declared later
  expect(cascade(stylesheet,selector,prop,1366),`${selector} ${prop} @1366`).toBe(desktop);
 }
 expect(cascade(stylesheet,'.g-rail-list button','width',390)).toBe('auto');
 expect(cascade(stylesheet,'.g-shell','grid-template-columns',390)).toBe('minmax(0,1fr)');
 expect(cascade(stylesheet,'.g-shell','grid-template-columns',1366)).toBe('var(--g-rail-w,220px) minmax(0,1fr)');
});

test('P2-6: the collapsed-rail variants never override the mobile direction or overflow, and the sheet rules stay mobile-safe',()=>{
 for(const r of stylesheet.filter(x=>x.selectors.some(s=>s.includes('is-rail-collapsed')&&s.includes('.g-rail')&&!s.includes('g-rail-')||s==='.is-rail-collapsed .g-rail'))){
  expect(r.decl['flex-direction']).toBeUndefined();expect(r.decl.overflow).toBeUndefined();expect(r.decl['overflow-x']).toBeUndefined();
 }
 expect(cascade(stylesheet,'.g-floating','position',390)).toBe('fixed');
 expect(cascade(stylesheet,'.g-floating','width',390)).toBe('auto');expect(cascade(stylesheet,'.g-floating','bottom',390)).toBe('0');
});

// ---- information design: Commit is not PR ----
test('Commit ≠ PR: the legend names months without any PR as source facts and never links commits to PRs',async()=>{
 mockGeometry();
 const long=makeHistory({pulls:makeHistory().pulls.map(p=>p.number===13?{...p,createdAt:'2026-04-27T01:00:00Z',mergedAt:'2026-04-27T02:00:00Z',closedAt:'2026-04-27T02:00:00Z'}:p)});
 await loadLive(long);setRange('全部歷史');await fireResize();
 const note=screen.getByTestId('no-pr-months');
 for(const month of ['2026-05','2026-06','2026-07','2026-08','2026-09'])expect(note).toHaveTextContent(month);
 expect(note).not.toHaveTextContent('2026-04');expect(note).not.toHaveTextContent('2026-10');
 expect(note).toHaveTextContent('不是 PR');expect(note).toHaveTextContent('非資料缺漏');
});

// ---------------- B1.3 · data-trust correction (D1 partial PR coverage, D2 All History boundary) ----------------
const withCoverage=(h:DevelopmentHistory,pulls:Partial<DevelopmentHistory['coverage']['pulls']>,over:Partial<DevelopmentHistory>={}):DevelopmentHistory=>({...h,...over,coverage:{...h.coverage,pulls:{...h.coverage.pulls,...pulls}}});
const lateOnly=(createdAt='2026-04-27T01:00:00Z')=>makeHistory({pulls:makeHistory().pulls.map(p=>p.number===13?{...p,createdAt,mergedAt:'2026-04-27T02:00:00Z',closedAt:'2026-04-27T02:00:00Z'}:p)});
const noPrNote=()=>screen.getByTestId('no-pr-months');
const MONTHS=['2026-05','2026-06','2026-07','2026-08','2026-09'];

test('B1.3 D1-A complete PR coverage and a Complete snapshot still list the verified empty months',async()=>{
 mockGeometry();await loadLive(lateOnly());setRange('全部歷史');await fireResize();
 for(const m of MONTHS)expect(noPrNote()).toHaveTextContent(m);
 expect(noPrNote()).toHaveTextContent('非資料缺漏');expect(noPrNote()).not.toHaveTextContent('無法確認');
});
test('B1.3 D1-B incomplete PR coverage (older PR page missing) never declares a month empty',async()=>{
 mockGeometry();
 const h=withCoverage(lateOnly(),{complete:false},{status:'partial',warnings:['Pull request list truncated after 5 pages.']});
 await loadLive(h);setRange('全部歷史');await fireResize();
 for(const m of MONTHS)expect(noPrNote()).not.toHaveTextContent(m);
 expect(noPrNote()).not.toHaveTextContent('非資料缺漏');expect(noPrNote()).toHaveTextContent('無法確認');expect(noPrNote()).toHaveTextContent('不是 PR');
});
test('B1.3 D1-C missing or unknown PR coverage is not treated as complete',async()=>{
 mockGeometry();
 await loadLive(withCoverage(lateOnly(),{complete:undefined as unknown as boolean}));setRange('全部歷史');await fireResize();
 for(const m of MONTHS)expect(noPrNote()).not.toHaveTextContent(m);
 expect(noPrNote()).not.toHaveTextContent('非資料缺漏');expect(noPrNote()).toHaveTextContent('無法確認');
});
test('B1.3 D1-D a Partial snapshot makes no absence claim even when the PR list itself paged to the end',async()=>{
 mockGeometry();
 await loadLive(withCoverage(lateOnly(),{complete:true},{status:'partial',warnings:['main history truncated after 1000 commits.']}));setRange('全部歷史');await fireResize();
 for(const m of MONTHS)expect(noPrNote()).not.toHaveTextContent(m);
 expect(noPrNote()).not.toHaveTextContent('非資料缺漏');expect(noPrNote()).toHaveTextContent('無法確認');
});
test('B1.3 D1-E empty months follow Asia/Singapore calendar months across the UTC midnight boundary',async()=>{
 mockGeometry();
 // 2026-05-31T17:30Z is 2026-06-01 01:30 in Singapore: June has a PR, May does not.
 await loadLive(lateOnly('2026-05-31T17:30:00Z'));setRange('6 個月');await fireResize();
 expect(noPrNote()).toHaveTextContent('2026-05');expect(noPrNote()).toHaveTextContent('2026-07');expect(noPrNote()).not.toHaveTextContent('2026-06');
});

const T=(iso:string)=>Date.parse(iso);
const SGT_DAY=(iso:string)=>T(iso)-((T(iso)+8*3_600_000)%86_400_000);
const spanHistory=(commitDates:string[],prDates:string[],over:Partial<DevelopmentHistory>={})=>{
 const base=makeHistory();
 return makeHistory({commits:commitDates.map((d,i)=>c(`x${i}`,[],d)),pulls:prDates.map((d,i)=>({...base.pulls[i%base.pulls.length],number:100+i,createdAt:d})),...over});
};
test('B1.3 D2 All History starts at the earliest fetched commit when it precedes the first PR',()=>{
 const h=spanHistory(['2026-03-01T00:00:00Z','2026-06-01T00:00:00Z'],['2026-05-01T00:00:00Z']);
 expect(timelineSpan(h,'all').start).toBe(SGT_DAY('2026-03-01T00:00:00Z'));
 expect(formatSgt(new Date(timelineSpan(h,'all').start).toISOString(),false)).toBe('2026-03-01');
});
test('B1.3 D2 the earliest PR wins when it is older than every fetched commit',()=>{
 expect(timelineSpan(spanHistory(['2026-06-01T00:00:00Z'],['2026-04-01T00:00:00Z','2026-05-01T00:00:00Z']),'all').start).toBe(SGT_DAY('2026-04-01T00:00:00Z'));
});
test('B1.3 D2 empty commit list, empty PR list and empty history all fall back safely',()=>{
 const h=makeHistory();
 expect(timelineSpan(spanHistory([],['2026-05-01T00:00:00Z']),'all').start).toBe(SGT_DAY('2026-05-01T00:00:00Z'));
 expect(timelineSpan(spanHistory(['2026-03-01T00:00:00Z'],[]),'all').start).toBe(SGT_DAY('2026-03-01T00:00:00Z'));
 const empty=timelineSpan(spanHistory([],[]),'all');
 expect(empty.start).toBe(SGT_DAY(h.fetchedAt));expect(empty.start).toBeLessThanOrEqual(empty.end);
});
test('B1.3 D2 invalid or missing timestamps are ignored, never used as the start',()=>{
 const h=spanHistory(['not-a-date','','2026-04-10T00:00:00Z'],['also-bad','2026-05-01T00:00:00Z']);
 h.commits.push({...c('nodate',[],'2026-01-01T00:00:00Z'),committerDate:null as unknown as string});
 const { start }=timelineSpan(h,'all');
 expect(Number.isFinite(start)).toBe(true);expect(start).toBe(SGT_DAY('2026-04-10T00:00:00Z'));
 expect(Number.isFinite(timelineSpan(spanHistory(['bad'],['bad']),'all').start)).toBe(true);
});
test('B1.3 D2 SGT conversion: a commit just after UTC 16:00 belongs to the next Singapore day',()=>{
 const { start }=timelineSpan(spanHistory(['2026-02-28T16:30:00Z'],['2026-05-01T00:00:00Z']),'all');
 expect(start).toBe(T('2026-02-28T16:00:00Z'));expect(formatSgt(new Date(start).toISOString(),false)).toBe('2026-03-01');
});
test('B1.3 D2 a partial snapshot does not change the start, and 1/3/6 month ranges are untouched',()=>{
 const full=spanHistory(['2026-03-01T00:00:00Z'],['2026-05-01T00:00:00Z']);
 const partial=withCoverage(full,{complete:false},{status:'partial'});
 expect(timelineSpan(partial,'all').start).toBe(timelineSpan(full,'all').start);
 for(const r of ['1m','3m','6m'] as const)expect(timelineSpan(partial,r)).toEqual(timelineSpan(makeHistory({fetchedAt:full.fetchedAt}),r));
});
const commitMarks=()=>document.querySelectorAll('.g-commit-tick, .g-commit-dot').length;
test('B1.3 D2 All History draws the known main commits that precede the first PR (same marks as 6 months here)',async()=>{
 mockGeometry();await loadLive();
 setRange('6 個月');await fireResize();const sixMonths=commitMarks();
 setRange('全部歷史');await fireResize();
 expect(sixMonths).toBeGreaterThanOrEqual(6);expect(commitMarks()).toBe(sixMonths); // m1 (2026-04-26) and m2 (2026-09-20) precede PR #13 (2026-09-24)
});
test('B1.3 D2 All History is labelled as fetched history, not complete repository history',async()=>{
 mockGeometry();await loadLive();setRange('全部歷史');await fireResize();
 const scope=screen.getByTestId('all-history-scope');
 expect(scope).toHaveTextContent('已取得');expect(scope).not.toHaveTextContent('Partial');
 expect(scope).not.toHaveTextContent('完整 repository 歷史 ✓');
});
test('B1.3 D2 a Partial snapshot keeps the Partial / UNKNOWN wording in the All History scope note',async()=>{
 mockGeometry();
 await loadLive(withCoverage(makeHistory(),{complete:false},{status:'partial'}));setRange('全部歷史');await fireResize();
 const scope=screen.getByTestId('all-history-scope');
 expect(scope).toHaveTextContent('Partial');expect(scope).toHaveTextContent('不代表完整 repository 歷史');
 setRange('6 個月');expect(screen.queryByTestId('all-history-scope')).toBeNull();
});

test('B1.3 P2 a Complete snapshot followed by a failed refresh no longer asserts month-level absence as current fact',async()=>{
 mockGeometry();
 const m=await loadLive(lateOnly());setRange('全部歷史');await fireResize();
 for(const month of MONTHS)expect(noPrNote()).toHaveTextContent(month); // fresh Complete snapshot: claim allowed
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));m.pending[1].resolve({error:'slow',kind:'timeout'},504);await flush();
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('Needs refresh');
 for(const month of MONTHS)expect(noPrNote()).not.toHaveTextContent(month);
 expect(noPrNote()).not.toHaveTextContent('非資料缺漏');expect(noPrNote()).toHaveTextContent('重新整理失敗');expect(noPrNote()).toHaveTextContent('無法確認');expect(noPrNote()).toHaveTextContent('不是 PR');
});
test('B1.3 P2 a successful refresh after a failed one restores the verified month claim',async()=>{
 mockGeometry();
 const m=await loadLive(lateOnly());setRange('全部歷史');await fireResize();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));m.pending[1].resolve({error:'slow',kind:'timeout'},504);await flush();
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));m.pending[2].resolve(lateOnly());await flush();
 for(const month of MONTHS)expect(noPrNote()).toHaveTextContent(month);expect(noPrNote()).toHaveTextContent('非資料缺漏');
});

// ---------------- B1.4 · source badge reflects the actual GitHub retrieval state ----------------
const sourceBadge=()=>screen.getByTestId('g-source-badge');
const headerText=()=>(document.querySelector('.g-header') as HTMLElement).textContent??'';
const lastChecked=()=>within(screen.getByLabelText('資料來源')).getByText('Last checked').nextElementSibling as HTMLElement;
const clickRefresh=()=>fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
describe('B1.4 source badge: allowlisted is not fetched, a previous snapshot is not the latest state',()=>{
 test('1. initial loading shows a neutral querying label and no LIVE claim',()=>{
  const {pending}=mockFetch();render(<Harness/>);
  expect(pending).toHaveLength(1);expect(sourceBadge()).toHaveTextContent('GitHub 唯讀 · 正在查詢');
  expect(headerText()).not.toMatch(/LIVE/i);expect(sourceBadge()).not.toHaveClass('is-live');
 });
 test('2. an initial API error shows GitHub 資料不可用 and no LIVE claim',async()=>{
  const {pending}=mockFetch();render(<Harness/>);pending[0].resolve({error:'x',kind:'not_authenticated'},401);await flush();
  expect(sourceBadge()).toHaveTextContent('GitHub 資料不可用');expect(headerText()).not.toMatch(/LIVE/i);expect(sourceBadge()).not.toHaveClass('is-live');
  expect(lastChecked()).toHaveTextContent('Not checked');
 });
 test('3. a complete response shows the successful read label with Complete and Last checked',async()=>{
  await loadLive();
  expect(sourceBadge()).toHaveTextContent('GitHub 唯讀 · 已讀取 · Complete');expect(sourceBadge()).toHaveClass('is-live');
  expect(lastChecked()).toHaveTextContent(formatSgt(makeHistory().fetchedAt));expect(headerText()).toContain('REGISTERED');
 });
 test('4. a partial response keeps Partial and never says Complete',async()=>{
  await loadLive(withCoverage(makeHistory(),{complete:false},{status:'partial',warnings:['Pull request list truncated after 5 pages.']}));
  expect(sourceBadge()).toHaveTextContent('Partial');expect(sourceBadge()).not.toHaveTextContent('Complete');
 });
 test('5. a refresh in progress is labelled as pending over the previous successful snapshot',async()=>{
  const m=await loadLive();clickRefresh();
  expect(m.pending).toHaveLength(2);
  expect(sourceBadge()).toHaveTextContent('重新整理中');expect(sourceBadge()).toHaveTextContent('上一次成功');
  expect(sourceBadge()).not.toHaveTextContent('已讀取');expect(sourceBadge()).not.toHaveClass('is-live');
  expect(lastChecked()).toHaveTextContent(formatSgt(makeHistory().fetchedAt));
 });
 test('6. a failed refresh shows Needs refresh and keeps the previous Last checked',async()=>{
  const m=await loadLive();clickRefresh();m.pending[1].resolve({error:'slow',kind:'timeout'},504);await flush();
  expect(sourceBadge()).toHaveTextContent('Needs refresh');expect(sourceBadge()).not.toHaveTextContent('已讀取');expect(headerText()).not.toMatch(/LIVE/i);
  expect(lastChecked()).toHaveTextContent(formatSgt(makeHistory().fetchedAt));expect(screen.getByLabelText('資料來源')).toHaveTextContent('Needs refresh');
 });
 test('7. a successful retry restores the read label with the new Last checked',async()=>{
  const m=await loadLive();clickRefresh();m.pending[1].resolve({error:'slow',kind:'timeout'},504);await flush();
  clickRefresh();expect(sourceBadge()).toHaveTextContent('重新整理中');
  const fresh=makeHistory({fetchedAt:'2026-10-16T03:00:00.000Z'});m.pending[2].resolve(fresh);await flush();
  expect(sourceBadge()).toHaveTextContent('GitHub 唯讀 · 已讀取 · Complete');expect(lastChecked()).toHaveTextContent(formatSgt(fresh.fetchedAt));
  expect(screen.queryByRole('alert')).toBeNull();
 });
 test('8. a DEMO identity never shows a source badge and issues no GitHub request',()=>{
  const {pending}=mockFetch();render(<Harness/>);
  fireEvent.click(within(screen.getByRole('navigation',{name:'專案（開發地圖）'})).getAllByRole('button').find(b=>/DEMO/.test(b.getAttribute('aria-label')??''))!);
  expect(screen.queryByTestId('g-source-badge')).toBeNull();expect(pending).toHaveLength(1); // only the initial registered request
 });
});

// ---------------- B1.4 remediation: review provenance (P2-1) ----------------
// Independent review finding: an approval of commit A kept being shown as an approval while the PR head was B.
// The cases below were written first and run against a45a01d (see the PR report for the failing assertions).
const rvw=(reviewer:string|null,state:'APPROVED'|'CHANGES_REQUESTED'|'DISMISSED',commitId:string|null,reviewId=1)=>({reviewer,reviewId,state,commitId,submittedAt:'2026-10-16T00:00:00Z',relation:'unknown'});
const reviewDetail=(headSha:string,status:string,reviewers:unknown[]|undefined,extra:{complete?:boolean;comparedHead?:string|null;count?:number}={})=>detailWith(55,{pull:{headSha},ci:{status:'passing',total:5,headSha},reviews:{status,count:extra.count??(reviewers?.length??0),complete:extra.complete??true,...(extra.comparedHead===undefined?{headSha}:{headSha:extra.comparedHead}),...(reviewers===undefined?{}:{reviewers})}});
const showReview=async(detail:ReturnType<typeof detailWith>,history=makeHistory())=>{const m=await openPr(55,history);detailReq(m).resolve(detail);await flush();return m;};

test('B1.4 P2-1 CASE A: an approval on the current head is shown as a current-head review record, not as merge readiness',async()=>{
 await showReview(reviewDetail(SHA_A,'current_head_approval',[rvw('bob','APPROVED',SHA_A)]));
 const r=reviewOf();
 expect(r).toHaveTextContent('Current-head approval');expect(r).toHaveTextContent(`目前 head ${SHA_A}`);
 expect(r).toHaveTextContent('不代表 GitHub 允許合併或可部署');
 expect(within(r).getByTestId('pr-review-reviewers')).toHaveTextContent(`bob · Approved · commit ${SHA_A} · ＝目前 head`);
 expect(r).not.toHaveTextContent(/merge ready|deploy ready|可以合併/i);
 expect(ciOf()).toHaveTextContent('CI passed');
});

test('B1.4 P2-1 CASE B (original defect): approval of an older commit is Historical, never an approval of the current head',async()=>{
 await showReview(reviewDetail(SHA_A,'historical_approval',[rvw('bob','APPROVED','e0')]));
 const r=reviewOf();
 expect(r).toHaveTextContent('Historical approval');expect(r).toHaveTextContent(`不是目前 head ${SHA_A}`);
 expect(r).not.toHaveTextContent('Current-head approval');expect(r).not.toHaveTextContent(/^Approved/);
 expect(within(r).getByTestId('pr-review-reviewers')).toHaveTextContent('commit e0');expect(r).toHaveTextContent('較早 commit（非目前 head）');
});

test('B1.4 P2-1 CASE B2: the viewer re-checks the commit itself — a server status that says current-head is not trusted over the review commit_id',async()=>{
 await showReview(reviewDetail(SHA_A,'current_head_approval',[rvw('bob','APPROVED','e0')]));
 expect(reviewOf()).toHaveTextContent('Historical approval');expect(reviewOf()).not.toHaveTextContent('Current-head approval');
});

test('B1.4 P2-1 CASE B3: reviews compared with a different head than the one shown cannot be tied to it',async()=>{
 await showReview(reviewDetail(SHA_A,'current_head_approval',[rvw('bob','APPROVED',SHA_A)],{comparedHead:'e9'}));
 expect(reviewOf()).toHaveTextContent('Not verified');expect(reviewOf()).not.toHaveTextContent('Current-head approval');
});

test('B1.4 P2-1 CASE C: an approval with no commit_id is Not verified',async()=>{
 await showReview(reviewDetail(SHA_A,'review_head_unknown',[rvw('bob','APPROVED',null)]));
 const r=reviewOf();expect(r).toHaveTextContent('Not verified');expect(r).toHaveTextContent('commit_id');expect(r).not.toHaveTextContent('Current-head approval');
 expect(r).toHaveTextContent('缺少 commit_id，無法比對');
});

test('B1.4 P2-1 CASE C2: a legacy detail with a bare "approved" and no per-review commit fails closed',async()=>{
 await showReview(reviewDetail(SHA_A,'approved',undefined));
 expect(reviewOf()).toHaveTextContent('Not verified');expect(reviewOf()).not.toHaveTextContent(/^Approved/);expect(reviewOf()).not.toHaveTextContent('Current-head approval');
 // ...but a request for changes is never hidden by missing provenance.
 cleanup();
 await showReview(reviewDetail(SHA_A,'changes_requested',undefined,{count:1}));
 expect(reviewOf()).toHaveTextContent('Changes requested（');
});

test('B1.4 P2-1 CASE D: incomplete pagination is Partial and never an unqualified approval',async()=>{
 await showReview(reviewDetail(SHA_A,'partial',[rvw('bob','APPROVED',SHA_A)],{complete:false,count:300}));
 const r=reviewOf();expect(r).toHaveTextContent('Partial / UNKNOWN');expect(r).not.toHaveTextContent('Current-head approval（');expect(r).not.toHaveTextContent(/^Current-head approval/);
});

test('B1.4 P2-1 CASE E: approval followed by changes requested leaves no hidden blocker, and the approval stays attributable',async()=>{
 await showReview(reviewDetail(SHA_A,'changes_requested',[rvw('ann','APPROVED',SHA_A,1),rvw('bob','CHANGES_REQUESTED',SHA_A,2)]));
 const r=reviewOf();expect(r).toHaveTextContent('Changes requested');expect(r).not.toHaveTextContent('Current-head approval');
 expect(within(r).getByTestId('pr-review-reviewers')).toHaveTextContent('ann · Approved');expect(within(r).getByTestId('pr-review-reviewers')).toHaveTextContent('bob · Changes requested');
});

test('B1.4 P2-1 CASE F: a dismissed approval is not shown as an active approval',async()=>{
 await showReview(reviewDetail(SHA_A,'approval_dismissed',[rvw('bob','DISMISSED',SHA_A)]));
 const r=reviewOf();expect(r).toHaveTextContent('Approval dismissed');expect(r).not.toHaveTextContent('Current-head approval');expect(r).not.toHaveTextContent('Historical approval');
});

test('B1.4 P2-1 CASE G: reviewers who approved different commits are each attributed to their own commit',async()=>{
 await showReview(reviewDetail(SHA_A,'current_head_approval',[rvw('ann','APPROVED','e0',1),rvw('bob','APPROVED',SHA_A,2),rvw('cy','APPROVED',null,3),rvw(null,'CHANGES_REQUESTED','e0',4)].slice(0,3)));
 const list=within(reviewOf()).getByTestId('pr-review-reviewers');
 expect(list).toHaveTextContent('ann · Approved · commit e0 · 較早 commit');expect(list).toHaveTextContent(`bob · Approved · commit ${SHA_A} · ＝目前 head`);expect(list).toHaveTextContent('cy · Approved · commit Not available · 缺少 commit_id');
 expect(reviewOf()).toHaveTextContent('Current-head approval');
});

test('B1.4 P2-1 CASE G2: a review from a deleted account is shown, not dropped',async()=>{
 await showReview(reviewDetail(SHA_A,'changes_requested',[rvw(null,'CHANGES_REQUESTED','e0',4)]));
 expect(reviewOf()).toHaveTextContent('已刪除帳號');expect(reviewOf()).toHaveTextContent('Changes requested');
});

test('B1.4 P2-1 CASE H: a head that moved between snapshot and detail reuses no approval, and a refresh recovers it (CASE K)',async()=>{
 const m=await showReview(reviewDetail(SHA_B,'current_head_approval',[rvw('bob','APPROVED',SHA_B)]));
 let panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('Needs refresh');expect(reviewOf()).toHaveTextContent('Not verified');expect(reviewOf()).not.toHaveTextContent('Current-head approval');
 expect(within(reviewOf()).queryByTestId('pr-review-reviewers')).not.toBeInTheDocument();
 // CASE K: the next snapshot carries the new head; the re-read detail can now be tied to it.
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 const moved=makeHistory({fetchedAt:'2026-10-16T00:05:00.000Z',pulls:makeHistory().pulls.map(p=>p.number===55?{...p,headSha:SHA_B}:p)});
 m.pending.at(-1)!.resolve(moved);await flush();
 detailReq(m).resolve({...reviewDetail(SHA_B,'current_head_approval',[rvw('bob','APPROVED',SHA_B)]),fetchedAt:'2026-10-16T00:06:00.000Z'});await flush();
 panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(reviewOf()).toHaveTextContent('Current-head approval');expect(reviewOf()).toHaveTextContent(`目前 head ${SHA_B}`);expect(panel).not.toHaveTextContent('Needs refresh');
});

test('B1.4 P2-1 CASE H2: a cached approval is never applied to a newer PR head (new snapshot starts empty)',async()=>{
 const m=await showReview(reviewDetail(SHA_A,'current_head_approval',[rvw('bob','APPROVED',SHA_A)]));
 expect(reviewOf()).toHaveTextContent('Current-head approval');
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));
 const moved=makeHistory({fetchedAt:'2026-10-16T00:05:00.000Z',pulls:makeHistory().pulls.map(p=>p.number===55?{...p,headSha:SHA_B}:p)});
 m.pending.at(-1)!.resolve(moved);await flush();
 // Until the detail is re-read for the new snapshot, nothing from the old head is shown as an approval.
 expect(reviewOf()).not.toHaveTextContent('Current-head approval');expect(reviewOf()).toHaveTextContent('Not checked');
});

test('B1.4 P2-1 CASE I: CI and review keep independent states (CI passed on the head, approval of an older commit)',async()=>{
 await showReview(reviewDetail(SHA_A,'historical_approval',[rvw('bob','APPROVED','e0')]));
 expect(ciOf()).toHaveTextContent('CI passed');expect(ciOf()).not.toHaveTextContent(/review|approval/i);
 expect(reviewOf()).toHaveTextContent('Historical approval');expect(reviewOf()).not.toHaveTextContent(/CI passed/);
 // and the other direction: failing CI does not change the review statement
 cleanup();
 const base=reviewDetail(SHA_A,'current_head_approval',[rvw('bob','APPROVED',SHA_A)]);
 await showReview({...base,ci:{status:'failing',total:5,headSha:SHA_A}});
 expect(ciOf()).toHaveTextContent('CI failed');expect(reviewOf()).toHaveTextContent('Current-head approval');
});

test('B1.4 P2-1 CASE J: a failed review read is Not checked, never an approval',async()=>{
 await showReview(reviewDetail(SHA_A,'not_checked',undefined,{complete:false}));
 expect(reviewOf()).toHaveTextContent('Not checked');expect(reviewOf()).not.toHaveTextContent(/approval|Approved/);
});

test('B1.4 P2-1: no reviews and comment-only reviews are their own states',async()=>{
 await showReview(reviewDetail(SHA_A,'no_reviews',[]));expect(reviewOf()).toHaveTextContent('沒有已送出的 review');
 cleanup();
 await showReview(reviewDetail(SHA_A,'commented_only',[]));expect(reviewOf()).toHaveTextContent('僅留言（無核准）');
});

test('B1.4 P2-1: missing PR head or snapshot head makes any approval Not verified',async()=>{
 await showReview(reviewDetail(SHA_A,'current_head_approval',[rvw('bob','APPROVED',SHA_A)]),withSnapshotHead(null));
 expect(reviewOf()).toHaveTextContent('Not verified');expect(reviewOf()).not.toHaveTextContent('Current-head approval');
});

test('B1.4 P2-1 model: reviewProvenance covers every state with fail-closed defaults',()=>{
 const h=makeHistory();const p=h.pulls.find(x=>x.number===55)!;
 const prov=(status:string,reviewers:unknown[]|undefined,over:{head?:string;complete?:boolean}={})=>{const d=reviewDetail(over.head??SHA_A,status,reviewers,{complete:over.complete}) as never as import('../prototype/gitHistoryTypes').PullDetail;return reviewProvenance(d,reconcilePullDetail(p,d)).state;};
 expect(prov('current_head_approval',[rvw('a','APPROVED',SHA_A)])).toBe('CURRENT_HEAD_APPROVAL');
 expect(prov('current_head_approval',[rvw('a','APPROVED','OLD')])).toBe('HISTORICAL_APPROVAL');
 expect(prov('current_head_approval',[rvw('a','APPROVED',null)])).toBe('REVIEW_HEAD_UNKNOWN');
 expect(prov('current_head_approval',[])).toBe('REVIEW_HEAD_UNKNOWN');
 expect(prov('current_head_approval',[rvw('a','APPROVED',SHA_A.toUpperCase())])).toBe('CURRENT_HEAD_APPROVAL');
 expect(prov('changes_requested',[rvw('a','APPROVED',SHA_A),rvw('b','CHANGES_REQUESTED','OLD')])).toBe('CHANGES_REQUESTED');
 expect(prov('approval_dismissed',[rvw('a','DISMISSED',SHA_A)])).toBe('APPROVAL_DISMISSED');
 expect(prov('partial',[rvw('a','APPROVED',SHA_A)],{complete:false})).toBe('PARTIAL_REVIEW_HISTORY');
 expect(prov('not_checked',undefined)).toBe('NOT_CHECKED');
 expect(prov('no_reviews',[])).toBe('NO_REVIEWS');
 expect(prov('current_head_approval',[rvw('a','APPROVED',SHA_B)],{head:SHA_B})).toBe('NEEDS_REFRESH');
});

// ---------------- B1.4 remediation: cyclic / ambiguous PR stacks (P2-2) ----------------
// Independent review finding: stack relationships come from PR metadata (base/head branch NAMES), which can be
// cyclic, self-referencing or ambiguous. The recursive renderer assumed a tree and crashed the whole dashboard
// ("Maximum call stack size exceeded"). Written first and run against the pre-fix source (see the PR report).
const sp=(n:number,base:string,head:string)=>pr(n,`stack test ${n}`,'draft','2026-10-15T01:00:00Z',null,base,head,`sx${n}`);
const historyWith=(...extra:HistoryPull[])=>makeHistory({pulls:[...makeHistory().pulls,...extra]});
const stackArticle=()=>within(screen.getByRole('heading',{name:/OPEN PR 堆疊/}).closest('article') as HTMLElement);
const stackButtons=()=>stackArticle().getAllByRole('button').map(b=>b.textContent??'').filter(t=>/^#\d+$/.test(t));
const count=(list:string[],n:number)=>list.filter(t=>t===`#${n}`).length;
const UNKNOWN_STACK='Stack relationship UNKNOWN';

test('B1.4 P2-2 CASE A/B: valid linear and branched stacks keep their structure',async()=>{
 await openPr(55,makeHistory());
 const nums=stackButtons();
 // #53 → #55 (linear) and #56 → #57 → #58, #59 (branched); every OPEN PR appears exactly once.
 for(const n of [36,52,53,54,55,56,57,58,59])expect(count(nums,n),`#${n}`).toBe(1);
 expect(nums.indexOf('#53')).toBeLessThan(nums.indexOf('#55'));
 expect(nums.indexOf('#56')).toBeLessThan(nums.indexOf('#57'));
 expect(nums.indexOf('#57')).toBeLessThan(nums.indexOf('#58'));expect(nums.indexOf('#57')).toBeLessThan(nums.indexOf('#59'));
 expect(stackArticle().queryByText(UNKNOWN_STACK,{exact:false})).not.toBeInTheDocument(); // healthy data is not labelled unknown
});

test('B1.4 P2-2 CASE C/K (original reproduction): a cycle reachable from a normal root does not crash the dashboard',async()=>{
 // X(main←x100), A(x100←y100), B(y100←x100): B reports head "x100" again, so following reported children loops forever.
 await openPr(55,historyWith(sp(100,'main','x100'),sp(101,'x100','y100'),sp(102,'y100','x100')));
 const nums=stackButtons();
 for(const n of [100,101,102])expect(count(nums,n),`#${n} shown exactly once`).toBe(1);
 expect(stackArticle().getByText(UNKNOWN_STACK,{exact:false})).toBeInTheDocument();
 expect(screen.getByLabelText('資料來源')).toBeInTheDocument(); // the rest of the dashboard is still alive
});

test('B1.4 P2-2 CASE D: a disconnected cycle keeps every PR accessible (none silently dropped)',async()=>{
 await openPr(55,historyWith(sp(110,'q110','p110'),sp(111,'p110','q110')));
 const nums=stackButtons();
 expect(count(nums,110)).toBe(1);expect(count(nums,111)).toBe(1);
 expect(stackArticle().getByText(UNKNOWN_STACK,{exact:false})).toBeInTheDocument();
 expect(stackArticle().getAllByText(/循環|cyclic/i,{exact:false}).length).toBeGreaterThan(0);
});

test('B1.4 P2-2 CASE E: a self-referencing PR is shown once and explained',async()=>{
 await openPr(55,historyWith(sp(120,'s120','s120')));
 expect(count(stackButtons(),120)).toBe(1);
 expect(stackArticle().getAllByText(/自我參照|self/i,{exact:false}).length).toBeGreaterThan(0);
});

test('B1.4 P2-2 CASE F: duplicate head branches stay ambiguous — the child is not duplicated under both',async()=>{
 await openPr(55,historyWith(sp(130,'main','dup'),sp(131,'main','dup'),sp(132,'dup','c132')));
 const nums=stackButtons();
 for(const n of [130,131,132])expect(count(nums,n),`#${n}`).toBe(1);
 expect(stackArticle().getByText(UNKNOWN_STACK,{exact:false})).toBeInTheDocument();
 expect(stackArticle().getAllByText(/多個|ambiguous/i,{exact:false}).length).toBeGreaterThan(0);
});

test('B1.4 P2-2 CASE G: a missing parent PR is not invented',async()=>{
 await openPr(55,historyWith(sp(140,'feature/missing-parent','m140')));
 const nums=stackButtons();expect(count(nums,140)).toBe(1);
 expect(stackArticle().getByText('← base feature/missing-parent')).toBeInTheDocument();
 expect(stackArticle().queryByText(UNKNOWN_STACK,{exact:false})).not.toBeInTheDocument();
 const h=historyWith(sp(140,'feature/missing-parent','m140'));expect(stackParent(h.pulls.find(p=>p.number===140)!,h.pulls)).toBeNull();
});

test('B1.4 P2-2 CASE H: an unrelated valid tree stays fully usable next to a malformed cycle',async()=>{
 await openPr(55,historyWith(sp(110,'q110','p110'),sp(111,'p110','q110')));
 const nums=stackButtons();
 for(const n of [56,57,58,59,53,55])expect(count(nums,n),`#${n}`).toBe(1);
 expect(nums.indexOf('#56')).toBeLessThan(nums.indexOf('#57'));expect(nums.indexOf('#57')).toBeLessThan(nums.indexOf('#58'));
 fireEvent.click(stackArticle().getByRole('button',{name:'#58'}));
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('base = PR #57 的 head');
});

test('B1.4 P2-2 CASE L: a PR inside an invalid stack stays selectable by keyboard and its details open',async()=>{
 const user=(await import('@testing-library/user-event')).default.setup();
 await openPr(55,historyWith(sp(110,'q110','p110'),sp(111,'p110','q110')));
 const button=stackArticle().getByRole('button',{name:'#110'});
 button.focus();expect(button).toHaveFocus();
 await user.keyboard('{Enter}');
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('#110');expect(panel).toHaveTextContent(UNKNOWN_STACK);
 expect(panel).toHaveTextContent('#111'); // the other member of the cycle is named, so the relationship can be inspected
});

test('B1.4 P2-2 CASE J (UI): several hundred PRs, including cycles, render without a stack overflow',async()=>{
 const chain=Array.from({length:300},(_,i)=>sp(1000+i,i===0?'main':`c${1000+i-1}`,`c${1000+i}`));
 const cycles=Array.from({length:60},(_,i)=>[sp(2000+2*i,`d${2001+2*i}`,`d${2000+2*i}`),sp(2001+2*i,`d${2000+2*i}`,`d${2001+2*i}`)]).flat();
 const started=Date.now();
 await openPr(55,historyWith(...chain,...cycles));
 const nums=stackButtons();
 expect(nums.length).toBeGreaterThanOrEqual(300+120);
 for(const n of [1000,1299,2000,2119])expect(count(nums,n)).toBe(1);
 expect(Date.now()-started).toBeLessThan(15000);
},30000);

test('B1.4 P2-2 model: the stack graph is deterministic, accounts for every OPEN PR once, and marks every unverified relationship',()=>{
 const pulls=historyWith(sp(100,'main','x100'),sp(101,'x100','y100'),sp(102,'y100','x100'),sp(110,'q110','p110'),sp(111,'p110','q110'),sp(120,'s120','s120'),sp(130,'main','dup'),sp(131,'main','dup'),sp(132,'dup','c132')).pulls;
 const g=buildStackGraph(pulls);
 const open=pulls.filter(p=>p.state==='open').map(p=>p.number).sort((a,b)=>a-b);
 const rendered=flattenStack(g).map(r=>r.pr.number);
 expect([...rendered].sort((a,b)=>a-b)).toEqual(open); // each OPEN PR exactly once
 const shuffled=[...pulls].sort((a,b)=>((a.number*7919)%101)-((b.number*7919)%101));
 expect(JSON.stringify(flattenStack(buildStackGraph(shuffled)))).toBe(JSON.stringify(flattenStack(g))); // input order never matters
 const issue=(n:number)=>g.nodes.get(n)!.issue;
 expect(issue(110)).toBe('cycle');expect(issue(111)).toBe('cycle');expect(issue(120)).toBe('self_reference');
 expect(issue(132)).toBe('ambiguous_parent');expect(issue(56)).toBeNull();expect(issue(57)).toBeNull();
 expect(g.nodes.get(110)!.peers).toEqual([110,111]);
 expect(g.nodes.get(132)!.peers).toEqual([130,131]);
});

test('B1.4 P2-2 model: scale — a thousand PRs build quickly and never recurse deeply',()=>{
 const chain=Array.from({length:800},(_,i)=>sp(1000+i,i===0?'main':`c${1000+i-1}`,`c${1000+i}`));
 const cycles=Array.from({length:100},(_,i)=>[sp(3000+2*i,`d${3001+2*i}`,`d${3000+2*i}`),sp(3001+2*i,`d${3000+2*i}`,`d${3001+2*i}`)]).flat();
 const pulls=[...chain,...cycles];
 const t=Date.now();const g=buildStackGraph(pulls);const rows=flattenStack(g);
 expect(rows).toHaveLength(1000);expect(Date.now()-t).toBeLessThan(1000);
 expect(rows.find(r=>r.pr.number===1799)!.depth).toBe(799);
 for(let i=0;i<50;i++){stackParent(chain[799]!,pulls);stackChildren(chain[400]!,pulls);} // cached: repeated queries stay cheap
});

test('B1.4 P2-2 model: stackParent/stackChildren keep their original meaning for valid stacks and never return unverified links',()=>{
 const h=makeHistory();const get=(n:number)=>h.pulls.find(p=>p.number===n)!;
 expect(stackParent(get(55),h.pulls)?.number).toBe(53);expect(stackChildren(get(57),h.pulls).map(p=>p.number)).toEqual([58,59]);
 const bad=historyWith(sp(110,'q110','p110'),sp(111,'p110','q110'),sp(130,'main','dup'),sp(131,'main','dup'),sp(132,'dup','c132')).pulls;
 expect(stackParent(bad.find(p=>p.number===110)!,bad)).toBeNull(); // a cycle is not a verified parent
 expect(stackParent(bad.find(p=>p.number===132)!,bad)).toBeNull(); // two candidate parents: none is invented
 expect(stackChildren(bad.find(p=>p.number===130)!,bad)).toEqual([]);
 expect(stackStatus(bad.find(p=>p.number===132)!,bad)).toMatchObject({state:'ambiguous_parent',peers:[130,131]});
 expect(stackStatus(get(55),h.pulls)).toMatchObject({state:'ok'});
 expect(relatedPulls(bad.find(p=>p.number===110)!,bad).has(110)).toBe(true); // related-highlighting survives a cycle
});

// ---------------- B1.4 remediation: focused trust-boundary regressions (identity, separation, late responses) ----------------
test('B1.4 identity: only the exact allowlisted repository qualifies — look-alikes never do, and accepted spellings resolve to the exact slug',()=>{
 const id=(repository:string|undefined,over:Partial<LiveIdentity>={}):LiveIdentity=>({source:'REGISTERED',projectId:'p1',repository,displayName:'PM Dashboard',...over});
 expect(liveRepositoryFor(id(PM))).toBe(PM); // positive control: the exact string still works
 // V1.2C: no normalisation at all. The server authorizes the EXACT saved owner/repo, so whitespace, URL prefixes and trailing slashes are never live.
 for(const same of [`${PM}/`,`https://github.com/${PM}`,` ${PM} `,`github.com/${PM}`])expect(liveRepositoryFor(id(same)),JSON.stringify(same)).toBeNull();
 for(const variant of ['AugusLiang23-Web/PM-Dashboard',`/${PM}`,`${PM}.git`,`${PM}-fork`,`other/${PM}`,`${PM}//`,`${PM}/..`,`${PM}?x=1`,'pm-dashboard','augusliang23-web','',`http://evil.example/${PM}`])expect(liveRepositoryFor(id(variant)),JSON.stringify(variant)).toBeNull();
 expect(liveRepositoryFor(id(undefined))).toBeNull();
 expect(liveRepositoryFor(id(PM,{projectId:undefined}))).toBeNull(); // no stable id: never inferred from the name
 expect(liveRepositoryFor(id(PM,{projectId:'  '}))).toBeNull();
 expect(liveRepositoryFor(id(PM,{source:'DEMO'}))).toBeNull();
 expect(liveRepositoryFor(id(PM,{displayName:PM,projectId:undefined}))).toBeNull(); // a display name equal to the repository confers nothing
});

test('B1.4 late responses: a slow PR detail that resolves after another PR was selected never lands in the new panel',async()=>{
 const m=await openPr(55);
 const late=detailReq(m,55);
 fireEvent.click(screen.getByRole('button',{name:/^PR #56 ·/}));
 const next=detailReq(m,56);expect(next).toBeDefined();
 late.resolve(reviewDetail(SHA_A,'current_head_approval',[rvw('bob','APPROVED',SHA_A)]));await flush();
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('#56');expect(reviewOf()).toHaveTextContent('Not checked');expect(reviewOf()).not.toHaveTextContent('Current-head approval');expect(ciOf()).toHaveTextContent('Not checked');
 // the right response still lands in the right panel (positive control)
 next.resolve(detailWith(56,{reviews:{status:'no_reviews',count:0,complete:true}}));await flush();
 expect(reviewOf()).toHaveTextContent('沒有已送出的 review');
});

test('B1.4 separation: a MERGED PR is not DEPLOYED, review and CI are separate, stack is metadata and ancestry is separate evidence',async()=>{
 const m=await openPr(13);
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('部署 / 本機 Worktree');expect(panel).toHaveTextContent('Not checked · MERGED ≠ DEPLOYED');
 expect(panel).toHaveTextContent('Stacked 關係（PR metadata）');expect(panel).toHaveTextContent('Git ancestry（commit parents）');
 expect((panel.textContent??'').replace('MERGED ≠ DEPLOYED','')).not.toMatch(/deployed|已部署|live in production|merge ready/i);
 // CI passing says nothing about review, and a merged PR with no reviews is still not "approved"
 detailReq(m,13).resolve({...detailFor(13,'passing'),number:13});await flush();
 expect(ciOf()).toHaveTextContent('CI passed');expect(reviewOf()).toHaveTextContent('沒有已送出的 review');
 expect(reviewOf()).not.toHaveTextContent(/approval|Approved/);expect(ciOf()).not.toHaveTextContent(/review|approv/i);
 expect(panel).toHaveTextContent('合併證據');expect(panel).not.toHaveTextContent('Needs refresh');
});

test('B1.4 separation: an OPEN PR is not described as actively developed, and draft/open status is its own field',async()=>{
 await openPr(55);
 const panel=screen.getByRole('dialog',{name:'PR 詳細資訊'});
 expect(panel).toHaveTextContent('OPEN ≠ 正在開發');expect(panel).not.toHaveTextContent(/進行中|actively|正在開發中/i);
});
