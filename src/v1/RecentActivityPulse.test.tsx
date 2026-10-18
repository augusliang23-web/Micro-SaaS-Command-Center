// Deterministic HEAD-commit evidence and synthetic clock only; no real GitHub or browser UAT.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GitDevelopmentMap } from '../prototype/GitDevelopmentMap';
import { projectRecentActivity } from '../prototype/recentActivityModel';
import type { DevelopmentHistory, HistoryPull } from '../prototype/gitHistoryTypes';
const NOW=Date.parse('2026-10-19T00:00:00Z'), HOUR=3600000, repo='augusliang23-web/pm-dashboard';
const sha=(n:number)=>n.toString(16).padStart(40,'0');
const iso=(ms:number)=>new Date(ms).toISOString();
function fixture(count=8):DevelopmentHistory {
 const ages=[2,8,18,1,1,1,25,1];
 const pulls:HistoryPull[]=Array.from({length:count},(_,i)=>{const n=i+1,closed=n===4||n===5;return {number:n,title:`Synthetic PR ${n}`,url:`https://example.test/pr/${n}`,author:'synthetic',state:closed?'closed':'open',isDraft:n===2,merged:n===4,status:n===4?'merged':n===5?'closed_unmerged':n===2?'draft':'open',createdAt:iso(NOW-48*HOUR),updatedAt:iso(NOW),mergedAt:n===4?iso(NOW-HOUR):null,closedAt:closed?iso(NOW-HOUR):null,baseRef:'main',baseSha:sha(100),headRef:`feature/${n}`,headSha:sha(n),headRepo:repo,mergeCommitSha:n===4?sha(104):null};});
 const commits=[{sha:sha(100),parents:[],message:'synthetic root',authorDate:iso(NOW-HOUR),committerDate:iso(NOW-HOUR),author:null,url:null},...pulls.filter(p=>p.number!==6).map(p=>({sha:p.headSha!,parents:[sha(100)],message:'synthetic head',authorDate:iso(NOW),committerDate:p.number===8?'bad':iso(NOW-(ages[p.number-1]??25)*HOUR),author:null,url:null}))];
 return {source:'GitHub',repository:repo,repositoryUrl:`https://github.com/${repo}`,defaultBranch:'main',startedAt:iso(NOW),fetchedAt:iso(NOW),status:'complete',warnings:[],coverage:{branches:{count:count+1,pages:1,complete:true},pulls:{count,open:count-2,draft:1,merged:1,closedUnmerged:1,pages:1,complete:true},commits:{count:commits.length,defaultBranchCommits:1,defaultBranchComplete:true},focusRefs:{compared:0,requested:0,truncated:false},localWorktrees:'not_checked',deployments:'not_checked',ci:'not_checked'},consistency:{atomic:false,status:'consistent',rereadAt:iso(NOW),driftedRefs:[],prHeadMismatches:[]},branches:[{name:'main',headSha:sha(100),protected:true},...pulls.map(p=>({name:p.headRef!,headSha:p.headSha,protected:false}))],pulls,commits,defaultBranchShas:[sha(100)],refs:{},comparisons:[]};
}
const project=(h=fixture(),hours:6|12|24=12,now=NOW,blocked=false)=>projectRecentActivity(h,repo,now,hours,blocked);
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
test('only exact observed OPEN/DRAFT HEAD committerDate qualifies in each 6/12/24-hour window',()=>{
 const h=fixture();const before=JSON.stringify(h);
 expect([...project(h,6).byPull].filter(([,a])=>a.state==='recent').map(([n])=>n)).toEqual([1]);
 expect([...project(h,12).byPull].filter(([,a])=>a.state==='recent').map(([n])=>n)).toEqual([1,2]);
 expect([...project(h,24).byPull].filter(([,a])=>a.state==='recent').map(([n])=>n)).toEqual([1,2,3]);
 expect(project(h).byPull.get(4)?.state).toBe('not_checked');expect(project(h).byPull.get(5)?.state).toBe('not_checked');
 expect(project(h).byPull.get(1)?.explanation).toContain('2026-10-19 06:00 SGT');expect(project(h).byPull.get(1)?.explanation).toContain('Last checked');
 expect(project(h).byPull.get(1)?.label).toBe('近 12 小時有 Commit');expect(JSON.stringify(h)).toBe(before);
});
test.each([
 ['missing head',(h:DevelopmentHistory)=>{h.pulls[0].headSha=null;}],
 ['invalid SHA',(h:DevelopmentHistory)=>{h.pulls[0].headSha='bad';}],
 ['unfetched head',(h:DevelopmentHistory)=>{h.commits=h.commits.filter(c=>c.sha!==sha(1));}],
 ['duplicate SHA',(h:DevelopmentHistory)=>{h.commits.push({...h.commits[1],committerDate:iso(NOW)});}],
 ['wrong branch head',(h:DevelopmentHistory)=>{h.branches[1].headSha=sha(999);}],
 ['unobserved head branch',(h:DevelopmentHistory)=>{h.branches=h.branches.filter(b=>b.name!=='feature/1');}],
 ['wrong head repo',(h:DevelopmentHistory)=>{h.pulls[0].headRepo='someone/else';}],
 ['head mismatch',(h:DevelopmentHistory)=>{h.consistency!.prHeadMismatches=[{number:1,headRef:'feature/1',prHeadSha:sha(1),branchHeadSha:sha(999)}];}],
 ['future commit',(h:DevelopmentHistory)=>{h.commits[1].committerDate=iso(NOW+60000);}],
 ['timestamp without timezone',(h:DevelopmentHistory)=>{h.commits[1].committerDate='2026-10-18T22:00:00';}],
 ['invalid calendar date',(h:DevelopmentHistory)=>{h.commits[1].committerDate='2026-02-30T22:00:00Z';}],
] as const)('%s cannot create a positive PR signal',(_label,change)=>{
 const h=fixture();change(h);expect(project(h).byPull.get(1)?.state).toBe('unknown');
});
test.each([
 ['partial',(h:DevelopmentHistory)=>{h.status='partial';}],
 ['pull coverage',(h:DevelopmentHistory)=>{h.coverage.pulls.complete=false;}],
 ['truncated focus',(h:DevelopmentHistory)=>{h.coverage.focusRefs.truncated=true;}],
 ['partial ref',(h:DevelopmentHistory)=>{h.refs={'feature/1':{headSha:sha(1),commitsFetched:1,complete:false}};}],
 ['warnings',(h:DevelopmentHistory)=>{h.warnings=['incomplete read'];}],
 ['inconsistent',(h:DevelopmentHistory)=>{h.consistency!.status='inconsistent';}],
 ['unverified',(h:DevelopmentHistory)=>{h.consistency=undefined;}],
 ['relevant drift',(h:DevelopmentHistory)=>{h.consistency!.driftedRefs=[{ref:'feature/1',observed:sha(1),reread:sha(999),relevant:true}];}],
 ['future snapshot',(h:DevelopmentHistory)=>{h.fetchedAt=iso(NOW+3*60000);}],
 ['future consistency reread',(h:DevelopmentHistory)=>{h.consistency!.rereadAt=iso(NOW+HOUR);}],
] as const)('%s snapshot fails closed',(_label,change)=>{
 const h=fixture();change(h);expect(project(h).byPull.get(1)?.state).not.toBe('recent');
});
test('unrelated recent commits, authorDate and PR updatedAt alone are not HEAD commit activity',()=>{
 const h=fixture();h.commits[1].committerDate=iso(NOW-25*HOUR);h.commits[1].authorDate=iso(NOW);h.pulls[0].updatedAt=iso(NOW);
 h.commits.push({...h.commits[1],sha:sha(999),committerDate:iso(NOW)});
 expect(project(h).byPull.get(1)?.state).toBe('outside');expect(projectRecentActivity(h,'wrong/repo',NOW,12).byPull.get(1)?.state).not.toBe('recent');
 expect(projectRecentActivity(undefined,repo,NOW,12).state).toBe('not_checked');
 expect(project(h,12,NOW+16*60000).state).toBe('needs_refresh');expect(project(h,12,NOW,true).byPull.get(1)?.state).not.toBe('recent');
 const skew=fixture();skew.fetchedAt=iso(NOW+60000);expect(project(skew).byPull.get(1)?.state).toBe('recent');
});
async function mount(h=fixture()){
 vi.useFakeTimers();vi.setSystemTime(NOW);
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).includes('/pull?')?new Response('{}',{status:503}):new Response(JSON.stringify(h)));
 const identity={source:'REGISTERED' as const,projectId:'synthetic',repository:repo,displayName:'Synthetic'};
 await act(async()=>{render(<GitDevelopmentMap identity={identity} rail={[]} selectIdentity={()=>{}}/>);});
 return fetcher;
}
const card=(n:number)=>screen.getByRole('button',{name:new RegExp(`^PR #${n} ·`)});
const switchHybrid=()=>fireEvent.click(screen.getByRole('tab',{name:'開發全貌 / Hybrid'}));
test('Timeline/Hybrid share the enabled 12h default, selectors, accessible timestamp and separate viewport controls',async()=>{
 await mount();expect(card(1)).toHaveClass('has-recent-commit');expect(card(2)).toHaveClass('has-recent-commit');expect(card(3)).not.toHaveClass('has-recent-commit');
 expect(card(1)).toHaveAccessibleDescription(/Head Commit.*2026-10-19 06:00 SGT.*Last checked/);
 expect(screen.getByRole('button',{name:'聚焦開發活動'})).toHaveAttribute('aria-pressed','true');
 fireEvent.change(screen.getByRole('combobox',{name:'近期 Commit 時窗'}),{target:{value:'6'}});expect(card(2)).not.toHaveClass('has-recent-commit');
 switchHybrid();expect(card(1)).toHaveClass('has-recent-commit');expect(screen.getByRole('combobox',{name:'近期 Commit 時窗'})).toHaveValue('6');
 fireEvent.change(screen.getByRole('combobox',{name:'近期 Commit 時窗'}),{target:{value:'24'}});expect(card(3)).toHaveClass('has-recent-commit');
 fireEvent.click(card(1));expect(card(1)).toHaveClass('is-selected');expect(screen.getByRole('complementary')).toHaveTextContent('Head Commit');
 const full=screen.getByRole('button',{name:'開啟完整 PR 詳情'});full.focus();await act(async()=>{fireEvent.click(full);});expect(screen.getByRole('dialog',{name:'PR 詳細資訊'})).toBeInTheDocument();
 fireEvent.keyDown(window,{key:'Escape'});expect(full).toHaveFocus();expect(card(1)).toHaveClass('has-recent-commit');
 fireEvent.click(screen.getByRole('button',{name:'近期 Commit 提示'}));expect(card(1)).not.toHaveClass('has-recent-commit');
 fireEvent.click(screen.getByRole('tab',{name:'開發時間軸'}));expect(screen.getByRole('combobox',{name:'近期 Commit 時窗'})).toHaveValue('24');expect(card(1)).not.toHaveClass('has-recent-commit');
});
test('mounted pulse expires with real-clock recency and snapshot freshness, without fetching in its timer',async()=>{
 const h=fixture();h.commits[1].committerDate=iso(NOW-12*HOUR+60000);const fetcher=await mount(h);
 expect(card(1)).toHaveClass('has-recent-commit');await act(async()=>{await vi.advanceTimersByTimeAsync(2*60000);});expect(card(1)).not.toHaveClass('has-recent-commit');
 expect(card(2)).toHaveClass('has-recent-commit');await act(async()=>{await vi.advanceTimersByTimeAsync(14*60000);});expect(card(2)).not.toHaveClass('has-recent-commit');
 expect(screen.getByLabelText('Commit 活動資料狀態')).toHaveTextContent('Needs refresh');expect(fetcher).toHaveBeenCalledTimes(1);
 cleanup();expect(vi.getTimerCount()).toBe(0);
});
test('foreground/visibility changes and failed refresh remove pulse immediately, without automatic API polling',async()=>{
 const fetcher=await mount();expect(card(1)).toHaveClass('has-recent-commit');
 vi.setSystemTime(NOW+16*60000);fireEvent(document,new Event('visibilitychange'));expect(card(1)).not.toHaveClass('has-recent-commit');expect(fetcher).toHaveBeenCalledTimes(1);
 vi.setSystemTime(NOW);fireEvent(window,new Event('focus'));expect(card(1)).toHaveClass('has-recent-commit');
 fetcher.mockResolvedValueOnce(new Response('{}',{status:503}));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'重新整理 GitHub 資料'}));});
 expect(card(1)).not.toHaveClass('has-recent-commit');expect(screen.getByLabelText('Commit 活動資料狀態')).toHaveTextContent('Needs refresh');
});
test('20-PR grouping keeps routes; pulse is individually shown after expansion, never inferred for a group',async()=>{
 await mount(fixture(20));switchHybrid();const graph=screen.getByRole('region',{name:'Git 視覺流程圖'});
 expect(graph.querySelector('.has-recent-commit')).toBeNull();expect(graph.querySelector('[data-edge-count]')).not.toBeNull();
 fireEvent.click(within(graph).getByRole('button',{name:/展開 main.*20.*PR/}));expect(card(1)).toHaveClass('has-recent-commit');expect(graph.querySelectorAll('.has-recent-commit')).toHaveLength(2);
 expect(screen.getByRole('region',{name:'部署 / 驗收'})).not.toHaveTextContent('Commit');
});
test('pulse CSS uses slow non-layout animation and a static reduced-motion alternative',()=>{
 const css=readFileSync('src/prototype/prototype.css','utf8');const style=document.createElement('style');
 style.textContent=css.slice(css.indexOf('/* Recent Commit activity'));document.head.appendChild(style);
 try {const rules=[...style.sheet!.cssRules];const normal=rules.find(r=>r instanceof CSSStyleRule&&r.selectorText==='.has-recent-commit::after') as CSSStyleRule;
 const seconds=Number(normal.style.animation.match(/([\d.]+)s/)?.[1]);expect(seconds).toBeGreaterThanOrEqual(3);expect(seconds).toBeLessThanOrEqual(5);expect(normal.style.position).toBe('absolute');expect(normal.style['pointer-events']).toBe('none');
 const reduced=rules.find(r=>r instanceof CSSMediaRule&&r.conditionText.includes('prefers-reduced-motion')) as CSSMediaRule;
 const reducedPulse=[...reduced.cssRules].find(r=>r instanceof CSSStyleRule&&r.selectorText==='.has-recent-commit::after') as CSSStyleRule;expect(reducedPulse.style.animation).toBe('none');
 } finally {style.remove();}
});
