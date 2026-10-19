// Synthetic, deterministic snapshots only. These checks are not Safari visual acceptance.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { GitDevelopmentMap } from '../prototype/GitDevelopmentMap';
import userEvent from '@testing-library/user-event';
import { activityWindow } from '../prototype/activityTimelineModel';
import { buildTimeline, LANES, timelineX } from '../prototype/gitHistoryModel';
import type { DevelopmentHistory, HistoryPull } from '../prototype/gitHistoryTypes';
const fetchedAt='2026-10-18T12:00:00Z';
const repo='augusliang23-web/pm-dashboard';
function fixture(count=8):DevelopmentHistory {
 const pulls:HistoryPull[]=Array.from({length:count},(_,i)=>{const n=i+1;const merged=n<=3;return {number:n,title:`Synthetic change ${n}`,url:`https://example.test/pr/${n}`,author:'synthetic',state:merged?'closed':'open',isDraft:n%2===0&&!merged,merged,status:merged?'merged':n%2===0?'draft':'open',createdAt:n===4?'2026-04-01T00:00:00Z':`2026-10-${15+i%3}T00:00:00Z`,updatedAt:merged?'2026-10-18T06:00:00Z':'2026-10-17T12:00:00Z',closedAt:merged?'2026-10-18T06:00:00Z':null,mergedAt:merged?'2026-10-18T06:00:00Z':null,baseRef:n===1?'trunk':n===3?'production-pages':n===6?'feature/4':n===8?'missing':'integration/custom',baseSha:'root',headRef:`feature/${n}`,headSha:`h${n}`,headRepo:repo,mergeCommitSha:merged?`m${n}`:null};});
 const commits=[{sha:'root',parents:[],message:'synthetic root',authorDate:'2026-04-01T00:00:00Z',committerDate:'2026-04-01T00:00:00Z',author:null,url:null},...pulls.map(p=>({sha:p.headSha!,parents:['root'],message:'synthetic',authorDate:p.createdAt,committerDate:p.createdAt,author:null,url:null})),...[1,2,3].map(n=>({sha:`m${n}`,parents:['root',`h${n}`],message:'synthetic merge',authorDate:'2026-10-18T06:00:00Z',committerDate:'2026-10-18T06:00:00Z',author:null,url:null})),{sha:'tip',parents:['m1'],message:'synthetic tip',authorDate:fetchedAt,committerDate:fetchedAt,author:null,url:null}];
 return {source:'GitHub',repository:repo,repositoryUrl:`https://github.com/${repo}`,defaultBranch:'trunk',startedAt:fetchedAt,fetchedAt,status:'complete',warnings:[],coverage:{branches:{count:3,pages:1,complete:true},pulls:{count,open:count-3,draft:pulls.filter(p=>p.isDraft).length,merged:3,closedUnmerged:0,pages:1,complete:true},commits:{count:commits.length,defaultBranchCommits:4,defaultBranchComplete:true},focusRefs:{compared:0,requested:0,truncated:false},localWorktrees:'not_checked',deployments:'not_checked',ci:'not_checked'},consistency:{atomic:false,status:'consistent',rereadAt:fetchedAt,driftedRefs:[],prHeadMismatches:[]},branches:[{name:'trunk',headSha:'tip',protected:true},{name:'integration/custom',headSha:'m2',protected:false},{name:'production-pages',headSha:'m3',protected:false}],pulls,commits,defaultBranchShas:['tip','m1','root'],refs:{},comparisons:[]};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const opts={range:'6m' as const,state:'all' as const,lanes:new Set(LANES.map(l=>l.id)),collapsed:new Set<never>(),plotWidth:1000};
async function mount(h=fixture()){
 vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).includes('/pull?')?new Response('{}',{status:503}):new Response(JSON.stringify(h)));
 const identity={source:'REGISTERED' as const,projectId:'synthetic',repository:repo,displayName:'Synthetic'};
 render(<GitDevelopmentMap identity={identity} rail={[]} selectIdentity={()=>{}}/>);await screen.findByRole('region',{name:'開發時間軸'});
}
const hybrid=()=>{fireEvent.click(screen.getByRole('tab',{name:'開發全貌 / Hybrid'}));return screen.getByRole('region',{name:'Git 視覺流程圖'});};
test('activity focus uses the observed recent event cluster rather than old commits or a long-lived PR creation',()=>{
 const h=fixture();const before=JSON.stringify(h);const window=activityWindow(h);
 expect(window.start).toBeGreaterThan(Date.parse('2026-10-13T00:00:00Z'));expect(window.start).toBeLessThan(Date.parse('2026-10-15T00:00:00Z'));expect(window.end).toBeLessThanOrEqual(Date.parse(fetchedAt));
 const focused=buildTimeline(h,{...opts,activityFocus:true});const calendar=buildTimeline(h,opts);
 expect(calendar.start).toBe(Date.parse('2026-04-17T16:00:00Z'));expect(focused.end-focused.start).toBeLessThan(7*86400000);
 const recent=focused.items.filter(i=>i.pr.number!==4);expect(Math.max(...recent.map(i=>i.x))-Math.min(...recent.map(i=>i.x))).toBeGreaterThan(450);
 expect(focused.items.find(i=>i.pr.number===4)?.clippedStart).toBe(true);expect(h.pulls[3].createdAt).toBe('2026-04-01T00:00:00Z');
 expect(timelineX(focused,'2026-10-17T00:00:00Z')-timelineX(focused,'2026-10-16T00:00:00Z')).toBeCloseTo(focused.pxPerDay);
 for(const a of focused.items)for(const b of focused.items)if(a.pr.number!==b.pr.number&&a.lane===b.lane&&a.row===b.row)expect(a.cardX+a.width<=b.cardX||b.cardX+b.width<=a.cardX).toBe(true);
 expect(JSON.stringify(h)).toBe(before);
});
test('focus handles identical events, stale/empty/missing/invalid history and excludes future outliers without browser now',()=>{
 const h=fixture();h.pulls.forEach(p=>{p.createdAt='2026-10-17T12:00:00Z';p.updatedAt=p.createdAt;p.mergedAt=null;p.closedAt=null;});
 const same=activityWindow(h);expect(same.end).toBeGreaterThan(same.start);expect(same.end).toBeLessThanOrEqual(Date.parse(fetchedAt));
 h.pulls[0].updatedAt='2099-01-01T00:00:00Z';expect(activityWindow(h)).toEqual(same);
 h.fetchedAt='2027-10-18T12:00:00Z';expect(activityWindow(h).end-activityWindow(h).start).toBeLessThan(2*86400000);
 h.pulls=[];expect(Number.isFinite(activityWindow(h).start)).toBe(true);expect(activityWindow(h).available).toBe(false);
 h.fetchedAt='bad';expect(activityWindow(h).available).toBe(false);
 const invalid=fixture();invalid.pulls[0].createdAt='bad';invalid.pulls[1].createdAt=null;invalid.status='partial';
 const layout=buildTimeline(invalid,{...opts,activityFocus:true});expect(layout.items.every(i=>Number.isFinite(i.x)&&Number.isFinite(i.width))).toBe(true);
});
test('Timeline defaults to activity focus, explicit six months remains calendar chronology and zoom/Auto Fit work',async()=>{
 await mount();expect(screen.getByRole('button',{name:'聚焦開發活動'})).toHaveAttribute('aria-pressed','true');
 const canvas=()=>document.querySelector<HTMLElement>('.g-canvas')!;
 expect(canvas()).toHaveAttribute('data-range-mode','activity');expect(screen.getByRole('button',{name:/PR #4 ·/})).toHaveTextContent('視窗外開始');
 const scale=Number(canvas().dataset.pxPerDay);fireEvent.click(screen.getByRole('button',{name:'放大'}));expect(Number(canvas().dataset.pxPerDay)).toBeGreaterThan(scale);
 fireEvent.click(screen.getByRole('button',{name:'Auto Fit'}));expect(canvas()).toHaveAttribute('data-fit','auto');
 fireEvent.click(screen.getByRole('button',{name:'6 個月'}));expect(canvas()).toHaveAttribute('data-range-mode','calendar');expect(canvas()).toHaveAttribute('data-start',String(Date.parse('2026-04-17T16:00:00Z')));
 fireEvent.click(screen.getByRole('button',{name:'聚焦開發活動'}));expect(Number(canvas().dataset.pxPerDay)).toBeGreaterThan(scale*.99);
});
test('all eight PRs stay in the source lane and supported destination arrows are visible without selection',async()=>{
 await mount();const graph=hybrid();expect(within(graph).getByRole('region',{name:'開發 / Feature'}).querySelectorAll('.hf-pr')).toHaveLength(8);
 expect(within(graph).getByRole('region',{name:'主分支 / trunk'}).querySelector('.hf-pr')).toBeNull();
 expect(graph.querySelector('[data-from="pr:1"][data-to="branch:trunk"][data-edge-kind="verified"]')).not.toBeNull();
 expect(graph.querySelector('[data-from="pr:2"][data-to="branch:integration/custom"][data-edge-kind="verified"]')).not.toBeNull();
 expect(graph.querySelector('[data-from="pr:3"][data-to="branch:production-pages"][data-edge-kind="verified"]')).not.toBeNull();
 expect(graph.querySelector('[data-from="pr:4"][data-edge-kind="reported"]')).not.toBeNull();expect(graph.querySelector('[data-from="pr:8"]')).toBeNull();
 expect(graph.querySelector('[data-from="pr:6"][data-to="stack:4"]')).not.toBeNull();
 for(const edge of graph.querySelectorAll('[data-edge-kind] > path'))expect(edge).toHaveAttribute('marker-end');
 fireEvent.click(within(graph).getByRole('button',{name:/PR #2 ·/}));expect(graph.querySelector('[data-from="pr:2"]')).toHaveClass('is-highlighted');expect(graph.querySelector('[data-from="pr:1"]')).toHaveClass('is-dim');
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('complementary',{name:'PR 情境檢視器'})).toHaveTextContent('NOT VERIFIED IN trunk');
});
test('20-PR collapsed overview retains counted provenance routes, expands without losing them, and separates deployment',async()=>{
 await mount(fixture(20));const graph=hybrid();expect(graph.querySelectorAll('[data-edge-kind]').length).toBeGreaterThan(0);expect(graph.querySelector('[data-from="group:integration/custom"][data-edge-kind="reported"]')).toHaveAttribute('data-edge-count','15');
 const expand=within(graph).getByRole('button',{name:/展開 integration\/custom.*PR/});fireEvent.click(expand);expect(graph.querySelector('[data-from="pr:2"]')).not.toBeNull();
 const deploy=screen.getByRole('region',{name:'部署 / 驗收'});expect(deploy.querySelector('svg')).toBeNull();expect(within(deploy).getAllByText('Not checked')).toHaveLength(2);
 expect(graph.querySelector('[data-from^="branch:"]')).toBeNull();
});

test('activity clipping retains the original PR date in details, restores keyboard focus and keeps filter bounds stable',async()=>{
 await mount();const user=userEvent.setup();const canvas=document.querySelector<HTMLElement>('.g-canvas')!;const start=canvas.dataset.start;
 const opener=screen.getByRole('button',{name:/PR #4 ·/});opener.focus();await user.keyboard('{Enter}');
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('2026-04-01 08:00 SGT');
 await user.keyboard('{Escape}');expect(opener).toHaveFocus();expect(canvas).toHaveAttribute('data-range-mode','activity');
 fireEvent.change(screen.getByRole('textbox',{name:'搜尋 PR 或分支'}),{target:{value:'Synthetic change 4'}});expect(canvas.dataset.start).toBe(start);expect(screen.getByRole('button',{name:/PR #4 ·/})).toHaveTextContent('視窗外開始');
});
