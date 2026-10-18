// Entirely synthetic snapshots. No real GitHub, deployment or agent execution evidence.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { GitDevelopmentMap } from '../prototype/GitDevelopmentMap';
import { buildHybridMap } from '../prototype/hybridMapModel';
import type { DevelopmentHistory, HistoryPull } from '../prototype/gitHistoryTypes';
const at = '2026-10-18T00:00:00Z';
const repo = 'augusliang23-web/pm-dashboard';
const pull = (number: number, baseRef = 'trunk', status: HistoryPull['status'] = 'merged'): HistoryPull => ({
 number, title: `Synthetic feature ${number}`, url: `https://example.test/pull/${number}`, author: 'synthetic',
 state: status === 'open' || status === 'draft' ? 'open' : 'closed', isDraft: status === 'draft', merged: status === 'merged', status,
 createdAt: at, updatedAt: at, closedAt: status === 'merged' ? at : null, mergedAt: status === 'merged' ? at : null,
 baseRef, baseSha: 'root', headRef: `feature/${number}`, headSha: `h${number}`, headRepo: repo, mergeCommitSha: status === 'merged' ? `m${number}` : null,
});
function history(): DevelopmentHistory {
 const commits = [['root', []], ['h1', ['root']], ['m1', ['root','h1']], ['tip', ['m1']], ['h2', ['root']], ['m2', ['root','h2']], ['h3', ['root']], ['m3', ['root','h3']]] as [string,string[]][];
 return {source:'GitHub', repository:repo, repositoryUrl:`https://github.com/${repo}`, defaultBranch:'trunk', startedAt:at, fetchedAt:at, status:'complete', warnings:[],
 coverage:{branches:{count:3,pages:1,complete:true}, pulls:{count:3,open:0,draft:0,merged:3,closedUnmerged:0,pages:1,complete:true}, commits:{count:8,defaultBranchCommits:4,defaultBranchComplete:true},focusRefs:{compared:0,requested:0,truncated:false},localWorktrees:'not_checked',deployments:'not_checked',ci:'not_checked'},
 consistency:{atomic:false,status:'consistent',rereadAt:at,driftedRefs:[],prHeadMismatches:[]},
 branches:[{name:'trunk',headSha:'tip',protected:true},{name:'integration/custom',headSha:'m2',protected:false},{name:'production-pages',headSha:'m3',protected:false}],
 pulls:[pull(1),pull(2,'integration/custom'),pull(3,'production-pages')], commits:commits.map(([sha,parents])=>({sha,parents,message:'synthetic',authorDate:at,committerDate:at,author:null,url:null})), defaultBranchShas:['tip','m1','root'],refs:{},comparisons:[]};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
test('main inclusion needs ancestry; integration and production-pages merges prove neither main nor deployment',()=>{
 const rows=buildHybridMap(history());
 expect(rows[0].main.state).toBe('verified');expect(rows[0].main.evidence).toContain('m1');expect(rows[0].main.evidence).toContain('tip');
 expect(rows[1].main.state).toBe('not_verified');expect(rows[2].main.state).toBe('not_verified');
 expect(rows[0].relationship.kind).toBe('verified');expect(rows[1].relationship.kind).toBe('verified');
 const h=history();h.pulls[0].mergeCommitSha=null;
 expect(buildHybridMap(h)[0].main.evidence).toContain('PR head ancestor');
});
test('partial, missing, stale, drifted, inconsistent or malformed history fails closed',()=>{
 const cases: ((h:DevelopmentHistory)=>void)[] = [h=>{h.status='partial';},h=>{h.refs={trunk:{headSha:'old',commitsFetched:4,complete:true}};},h=>{h.refs={trunk:{headSha:'tip',commitsFetched:4,complete:false}};},h=>{h.warnings=['incomplete read'];}, h=>{h.coverage.commits.defaultBranchComplete=false;},h=>{h.consistency=undefined;},h=>{h.consistency!.status='unverified';},h=>{h.consistency!.driftedRefs=[{ref:'trunk',observed:'tip',reread:'new',relevant:true}];},h=>{h.branches[0].headSha=null;},h=>{h.defaultBranchShas=['m1'];},h=>{h.commits=h.commits.filter(c=>c.sha!=='root');},h=>{h.commits.push({...h.commits[0],parents:['tip']});},h=>{h.commits[0].parents=['tip'];},h=>{h.consistency!.prHeadMismatches=[{number:1,headRef:'feature/1',prHeadSha:'h1',branchHeadSha:'new'}];}];
 for(const change of cases){const h=history();change(h);expect(buildHybridMap(h)[0].main.state).toBe('unknown');}
 expect(buildHybridMap(history(),true)[0].main.state).toBe('unknown');
 const h=history();h.pulls[0].mergeCommitSha='missing';h.pulls[0].headSha='missing';expect(buildHybridMap(h)[0].main.state).toBe('unknown');
});
test('reported metadata is dashed; missing, ambiguous and cyclic routes stay UNKNOWN',()=>{
 const h=history();h.pulls=[pull(4,'integration/custom','draft')];
 expect(buildHybridMap(h)[0].relationship.kind).toBe('reported');
 h.pulls[0].baseRef='missing';expect(buildHybridMap(h)[0].relationship.kind).toBe('unknown');
 h.pulls=[pull(4,'feature/5','open'),pull(5,'feature/4','draft'),pull(6,'feature/4','open')];expect(buildHybridMap(h).every(r=>r.relationship.kind==='unknown')).toBe(true);
 h.pulls=[pull(4,'feature/5','open'),pull(5,'trunk','draft'),{...pull(6,'trunk','open'),headRef:'feature/5'}];expect(buildHybridMap(h)[0].relationship.kind).toBe('unknown');
});
async function mount(h=history()) {
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>String(input).includes('/pull?') ? new Response('{}',{status:503}) : new Response(JSON.stringify(h),{status:200}));
 const identity={source:'REGISTERED' as const,projectId:'synthetic',repository:repo,displayName:'Synthetic project'};
 render(<GitDevelopmentMap identity={identity} rail={[]} selectIdentity={()=>{}}/>);
 await screen.findByRole('region',{name:'開發時間軸'});
 expect(screen.getByRole('tab',{name:'開發時間軸'})).toHaveAttribute('aria-selected','true');
 fireEvent.click(screen.getByRole('tab',{name:'開發全貌 / Hybrid'}));
 return {fetcher,region:screen.getByRole('region',{name:'開發全貌 / Hybrid'})};
}
test('selecting a visual node opens a nonmodal inspector; full details require a separate action and restore focus',async()=>{
 const {region,fetcher}=await mount();const user=userEvent.setup();
 const canvas=within(region).getByRole('region',{name:'Git 視覺流程圖'});
 expect(within(canvas).getByRole('region',{name:'開發 / Feature'})).toBeInTheDocument();
 expect(within(canvas).getByRole('region',{name:'整合 / Integration'})).toBeInTheDocument();
 expect(within(canvas).getByRole('region',{name:'主分支 / trunk'})).toBeInTheDocument();
 expect(within(canvas).getByRole('region',{name:'其他發布分支'})).toBeInTheDocument();
 expect(screen.queryByRole('region',{name:'Repository 摘要'})).not.toBeInTheDocument();
 expect(screen.queryByRole('region',{name:'資訊卡'})).not.toBeInTheDocument();
 expect(canvas).not.toHaveTextContent('merge commit ancestor');expect(canvas).not.toHaveTextContent('m1');
 expect(within(region).getByLabelText('UAT')).toHaveTextContent('Not checked');expect(within(region).getByLabelText('Production')).toHaveTextContent('Not checked');
 const opener=within(canvas).getByRole('button',{name:/PR #2 ·/});opener.focus();await user.keyboard('{Enter}');
 const inspector=within(region).getByRole('complementary',{name:'PR 情境檢視器'});
 expect(inspector).toHaveTextContent('feature/2');expect(inspector).toHaveTextContent('integration/custom');
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(fetcher).toHaveBeenCalledTimes(1);
 expect(within(canvas).getByTestId('hybrid-pr-2')).toHaveClass('is-selected');expect(within(canvas).getByTestId('hybrid-pr-1')).toHaveClass('is-dim');
 expect(canvas.querySelectorAll('[data-edge-kind="verified"]')).toHaveLength(1);
 const detailButton=within(inspector).getByRole('button',{name:'開啟完整 PR 詳情'});detailButton.focus();await user.keyboard('{Enter}');
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('Synthetic feature 2');
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(detailButton).toHaveFocus();expect(inspector).toBeInTheDocument();
 await user.keyboard('{Escape}');expect(within(region).queryByRole('complementary')).not.toBeInTheDocument();expect(opener).toHaveFocus();
 for(const name of ['Git 拓樸','清單','開發時間軸','開發全貌 / Hybrid']){fireEvent.click(screen.getByRole('tab',{name}));expect(screen.getByRole('tab',{name})).toHaveAttribute('aria-selected','true');}
 expect(fetcher.mock.calls.every(([u])=>String(u).startsWith('/api/github/development-history'))).toBe(true);
});
test('20 PRs start grouped, expand and filter without invented active or deployment status at narrow size',async()=>{
 const h=history();h.pulls=Array.from({length:20},(_,i)=>pull(i+10,'integration/custom',i%2?'open':'draft'));
 const old=window.innerWidth;Object.defineProperty(window,'innerWidth',{configurable:true,value:375});
 try {const {region}=await mount(h);const canvas=within(region).getByRole('region',{name:'Git 視覺流程圖'});
 expect(within(canvas).queryAllByRole('button',{name:/PR #/})).toHaveLength(0);
 const expand=within(canvas).getByRole('button',{name:/展開.*20.*PR/});expect(expand).toHaveAttribute('aria-expanded','false');fireEvent.click(expand);
 expect(within(canvas).getAllByRole('button',{name:/PR #/})).toHaveLength(20);
 fireEvent.click(within(canvas).getByRole('button',{name:/PR #10 ·/}));
 expect(canvas.querySelectorAll('[data-edge-kind="reported"]')).toHaveLength(1);
 fireEvent.click(within(canvas).getByRole('button',{name:/收折.*20.*PR/}));
 expect(within(canvas).queryAllByRole('button',{name:/PR #/})).toHaveLength(0);
 fireEvent.click(within(canvas).getByRole('button',{name:/展開.*20.*PR/}));
 expect(region.textContent).not.toMatch(/WORKING|正在開發|CI passed|DEPLOYED/);
 const summary=within(region).getByRole('region',{name:'本次已取得資料摘要'});expect(summary).toHaveTextContent('OPEN10');expect(summary).toHaveTextContent('DRAFT10');
 fireEvent.change(screen.getByRole('textbox',{name:'搜尋 PR 或分支'}),{target:{value:'#10'}});
 expect(within(canvas).getAllByRole('button',{name:/PR #/})).toHaveLength(1);
 } finally {Object.defineProperty(window,'innerWidth',{configurable:true,value:old});}
});
test('a failed refresh downgrades prior positive main evidence to UNKNOWN',async()=>{
 const {fetcher,region}=await mount();fetcher.mockResolvedValueOnce(new Response('{}',{status:503}));
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));await act(async()=>{await Promise.resolve();});
 fireEvent.click(within(region).getByRole('button',{name:/PR #1 ·/}));
 expect(within(region).getByRole('complementary')).toHaveTextContent('UNKNOWN');expect(region).not.toHaveTextContent('IN MAIN');
});

test('PR head inclusion is separate from MERGED, and squash ancestry may verify the recorded merge SHA',()=>{
 const h=history();h.pulls[0]={...pull(1,'trunk','open'),headSha:'h1'};
 expect(buildHybridMap(h)[0].main.state).toBe('verified');expect(buildHybridMap(h)[0].relationship.kind).toBe('reported');
 h.pulls[0]=pull(1);h.commits.find(c=>c.sha==='m1')!.parents=['root'];
 expect(buildHybridMap(h)[0].main.state).toBe('verified');expect(buildHybridMap(h)[0].relationship.kind).toBe('reported');
});
test('stacked selection highlights only its route, marks its reported parent and persists across tabs',async()=>{
 const h=history();h.pulls=[pull(4,'feature/5','open'),pull(5,'trunk','draft'),pull(6,'trunk','open')];
 const {region}=await mount(h);const user=userEvent.setup();const node=within(region).getByRole('button',{name:/PR #4 ·/});node.focus();await user.keyboard(' ');
 expect(within(region).getByTestId('hybrid-pr-5')).toHaveClass('is-related');expect(within(region).getByTestId('hybrid-pr-6')).toHaveClass('is-dim');
 expect(region.querySelectorAll('[data-edge-kind="reported"]')).toHaveLength(1);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('tab',{name:'清單'}));fireEvent.click(screen.getByRole('tab',{name:'開發全貌 / Hybrid'}));
 expect(screen.getByTestId('hybrid-pr-4')).toHaveClass('is-selected');
});

test('8 PR visual state separates release branch from deployment and uses the actual default branch label',async()=>{
 const h=history();h.pulls.push(...Array.from({length:5},(_,i)=>pull(i+10,'integration/custom',i%2?'draft':'open')));
 const {region}=await mount(h);const canvas=within(region).getByRole('region',{name:'Git 視覺流程圖'});
 expect(within(canvas).getAllByRole('button',{name:/PR #/})).toHaveLength(8);
 expect(within(canvas).getByRole('region',{name:'其他發布分支'})).toHaveTextContent('production-pages');
 expect(within(canvas).getByRole('region',{name:'主分支 / trunk'})).toHaveTextContent('IN trunk — VERIFIED');expect(canvas).not.toHaveTextContent('IN MAIN');
 const deployment=within(region).getByRole('region',{name:'部署 / 驗收'});expect(deployment.querySelector('svg')).toBeNull();expect(within(deployment).getAllByText('Not checked')).toHaveLength(2);
 const summary=within(region).getByRole('region',{name:'本次已取得資料摘要'});expect(summary).toHaveTextContent('MERGED3');expect(summary).toHaveTextContent('IN trunk VERIFIED1');
});
test('UNKNOWN routes have no graphical edge, including cycles and partial default evidence',async()=>{
 const h=history();h.pulls=[pull(4,'feature/5','open'),pull(5,'feature/4','draft')];h.status='partial';
 const {region}=await mount(h);fireEvent.click(within(region).getByRole('button',{name:/PR #4 ·/}));
 expect(region.querySelectorAll('[data-edge-kind]')).toHaveLength(0);expect(within(region).getByRole('complementary')).toHaveTextContent('UNKNOWN');
 expect(within(region).getByRole('region',{name:'本次已取得資料摘要'})).toHaveTextContent('Partial');
});

test('SVG endpoints follow actual node bounds and remeasure when the layout changes',async()=>{
 let narrow=false;
 const rect=(x:number,y:number,w:number,h:number)=>({left:x,top:y,right:x+w,bottom:y+h,x,y,width:w,height:h,toJSON:()=>({})} as DOMRect);
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){
   if(this.classList.contains('hf-canvas'))return rect(0,0,1200,800);
   if(this.dataset.flowNode==='pr:2')return narrow?rect(20,500,200,80):rect(300,200,200,80);
   if(this.dataset.flowNode==='branch:integration/custom')return narrow?rect(20,300,200,60):rect(300,100,200,60);
   return rect(0,0,0,0);
 });
 const {region}=await mount();fireEvent.click(within(region).getByRole('button',{name:/PR #2 ·/}));
 const path=region.querySelector('[data-edge-kind="verified"] > path')!;
 expect(path).toHaveAttribute('d','M 400 200 C 400 180, 400 180, 400 160');
 narrow=true;fireEvent(window,new Event('resize'));
 expect(path).toHaveAttribute('d','M 120 500 C 120 430, 120 430, 120 360');
});
test('merged to integration and verified in trunk are independent facts, with only that PR receiving inclusion edges',async()=>{
 const h=history();h.commits.find(c=>c.sha==='tip')!.parents=['m1','m2'];h.defaultBranchShas=['tip','m1','m2','root'];
 const {region}=await mount(h);fireEvent.click(within(region).getByRole('button',{name:/PR #2 ·/}));
 const inspector=within(region).getByRole('complementary');expect(inspector).toHaveTextContent('MERGED');expect(inspector).toHaveTextContent('IN trunk — VERIFIED');expect(inspector).toHaveTextContent('integration/custom');
 const edges=region.querySelectorAll('[data-edge-kind="verified"]');expect(edges).toHaveLength(2);
 expect([...edges].map(e=>e.getAttribute('data-from'))).toEqual(['pr:2','pr:2']);
 expect([...edges].map(e=>e.getAttribute('data-to'))).toEqual(['branch:integration/custom','branch:trunk']);
});

test('an OPEN PR remains a feature proposal even when its known head is already in the default branch',async()=>{
 const h=history();h.pulls[0]={...pull(1,'trunk','open'),headSha:'h1'};
 const {region}=await mount(h);const feature=within(region).getByRole('region',{name:'開發 / Feature'});
 const node=within(feature).getByRole('button',{name:/PR #1 ·/});expect(node).toHaveTextContent('OPEN');expect(node).toHaveTextContent('IN trunk — VERIFIED');
 fireEvent.click(node);expect(region.querySelectorAll('[data-edge-kind="reported"]')).toHaveLength(1);expect(region.querySelectorAll('[data-edge-kind="verified"]')).toHaveLength(1);
});
