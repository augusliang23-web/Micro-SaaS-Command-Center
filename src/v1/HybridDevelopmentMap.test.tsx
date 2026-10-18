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
test('Hybrid keeps stages Not checked, shows evidence and opens existing details with keyboard and Escape focus',async()=>{
 const {region,fetcher}=await mount();const user=userEvent.setup();
 expect(within(region).getByLabelText('UAT')).toHaveTextContent('Not checked');expect(within(region).getByLabelText('Production')).toHaveTextContent('Not checked');
 expect(region).toHaveTextContent('IN MAIN — VERIFIED');expect(region).toHaveTextContent('NOT VERIFIED IN MAIN');expect(region).toHaveTextContent('Last checked');
 const opener=within(region).getByRole('button',{name:/PR #2 ·/});opener.focus();await user.keyboard('{Enter}');
 expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toHaveTextContent('Synthetic feature 2');
 expect(within(region).getByTestId('hybrid-pr-2')).toHaveClass('is-selected');expect(within(region).getByTestId('hybrid-pr-1')).toHaveClass('is-dim');
 expect(region.querySelectorAll('.g-hybrid-link.is-highlighted')).toHaveLength(1);
 expect(region).toHaveTextContent('feature/2 → integration/custom');
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(opener).toHaveFocus();
 for(const name of ['Git 拓樸','清單','開發時間軸']){fireEvent.click(screen.getByRole('tab',{name}));expect(screen.getByRole('tab',{name})).toHaveAttribute('aria-selected','true');}
 expect(screen.getByRole('button',{name:'放大'})).toBeVisible();
 expect(fetcher.mock.calls.every(([u])=>String(u).startsWith('/api/github/development-history'))).toBe(true);
});
test('20 PRs remain separate readable routes at narrow size, with no working state inferred from OPEN/DRAFT',async()=>{
 const h=history();h.pulls=Array.from({length:20},(_,i)=>pull(i+10,'integration/custom',i%2?'open':'draft'));
 const old=window.innerWidth;Object.defineProperty(window,'innerWidth',{configurable:true,value:375});
 try {const {region}=await mount(h);expect(within(region).getAllByRole('button',{name:/PR #/})).toHaveLength(20);
 expect(region.textContent).not.toMatch(/WORKING|正在開發|CI passed|DEPLOYED/);expect(region.querySelector('svg')).toBeNull();
 expect(region.querySelectorAll('[data-kind="reported"]')).toHaveLength(20);
 } finally {Object.defineProperty(window,'innerWidth',{configurable:true,value:old});}
});
test('a failed refresh downgrades prior positive main evidence to UNKNOWN',async()=>{
 const {fetcher,region}=await mount();fetcher.mockResolvedValueOnce(new Response('{}',{status:503}));
 fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));await act(async()=>{await Promise.resolve();});
 expect(within(region).queryByText('IN MAIN — VERIFIED')).not.toBeInTheDocument();expect(region).toHaveTextContent('UNKNOWN');
});

test('PR head inclusion is separate from MERGED, and squash ancestry may verify the recorded merge SHA',()=>{
 const h=history();h.pulls[0]={...pull(1,'trunk','open'),headSha:'h1'};
 expect(buildHybridMap(h)[0].main.state).toBe('verified');expect(buildHybridMap(h)[0].relationship.kind).toBe('reported');
 h.pulls[0]=pull(1);h.commits.find(c=>c.sha==='m1')!.parents=['root'];
 expect(buildHybridMap(h)[0].main.state).toBe('verified');expect(buildHybridMap(h)[0].relationship.kind).toBe('reported');
});
test('stacked selection highlights only its route, marks its reported parent and persists across tabs',async()=>{
 const h=history();h.pulls=[pull(4,'feature/5','open'),pull(5,'trunk','draft'),pull(6,'trunk','open')];
 const {region}=await mount(h);fireEvent.click(within(region).getByRole('button',{name:/PR #4 ·/}));
 expect(within(region).getByTestId('hybrid-pr-5')).toHaveClass('is-related');expect(within(region).getByTestId('hybrid-pr-6')).toHaveClass('is-dim');
 expect(region.querySelectorAll('.g-hybrid-link.is-highlighted')).toHaveLength(1);
 fireEvent.click(screen.getByRole('tab',{name:'清單'}));fireEvent.click(screen.getByRole('tab',{name:'開發全貌 / Hybrid'}));
 expect(screen.getByTestId('hybrid-pr-4')).toHaveClass('is-selected');
});
