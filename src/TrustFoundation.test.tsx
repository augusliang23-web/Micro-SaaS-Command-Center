import { githubSnapshot } from './test/githubSnapshots.mjs';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import App from './App';
import { initialProjects, initialAttentionItems, initialNextBestAction, initialExecutionSnapshot } from './mockData';
import { MicroSaaSProject } from './types';

const real = (id: string): MicroSaaSProject => ({...initialProjects[0], id, name:id, repository:`owner/${id}`, health:'Healthy', waitingState:'AI_RUNNING'});
const state = (projects: MicroSaaSProject[]) => ({projects, attentionItems:initialAttentionItems, nba:initialNextBestAction,snapshot:initialExecutionSnapshot});
const response = (data: unknown, ok=true) => ({ok,json:async()=>data}) as Response;
afterEach(()=> {cleanup();vi.restoreAllMocks();});

// Wrong source wiring, demo inclusion or independent refetches would break this
// rendered test: card, counters, filters, recommendation and drawer stay aligned.
test('real portfolio shares canonical states and excludes all demos from counts and recommendation', async()=>{
 const calls:string[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const url=String(input);calls.push(url);
  if(url==='/api/state')return response(state([real('Idle'),real('Review'),real('Running'),real('Blocked'),real('Unknown'),...initialProjects]));
  if(url.includes('owner%2FIdle'))return response(githubSnapshot({state:'none'}));
  if(url.includes('owner%2FReview'))return response(githubSnapshot({state:'open',ciStatus:'none',reviewDecision:'review_required'}));
  if(url.includes('owner%2FRunning'))return response(githubSnapshot({state:'open',ciStatus:'running'}));
  if(url.includes('owner%2FBlocked'))return response(githubSnapshot({state:'open',ciStatus:'failing'}));
  return response(null,false);
 });
 render(<App/>);
 const portfolio=screen.getByRole('region',{name:'專案總覽清單'});
 await waitFor(()=>expect(within(portfolio).getByRole('article',{name:'Idle'})).toHaveAttribute('data-status','IDLE'));
 expect(screen.getByRole('button',{name:'全部 (5)'})).toBeVisible();
 expect(screen.getAllByRole('button',{name:'待你關注 (3)'}).length).toBe(2);
 expect(screen.queryByRole('article',{name:'ProSync'})).not.toBeInTheDocument();
 expect(within(portfolio).getByRole('article',{name:'Review'})).toHaveTextContent('尚未取得自動檢查結果');
 expect(screen.queryByText(/都檢查過了|Live Sync|AI 正在處理/)).not.toBeInTheDocument();
 expect(screen.getAllByRole('article',{name:'Blocked'}).length).toBe(2); // recommendation + portfolio
 fireEvent.click(screen.getAllByRole('button',{name:'待你關注 (3)'})[0]);
 expect(within(portfolio).getAllByRole('article').map(a=>a.getAttribute('aria-label')).sort()).toEqual(['Blocked','Review','Unknown']);
 fireEvent.click(screen.getByRole('button',{name:'自動檢查中 (1)'}));
 expect(within(portfolio).getAllByRole('article').map(a=>a.getAttribute('aria-label'))).toEqual(['Running']);
 fireEvent.click(screen.getByRole('button',{name:'全部 (5)'}));
 fireEvent.change(screen.getByLabelText('專案狀態'),{target:{value:'IDLE'}});
 expect(within(portfolio).getAllByRole('article').map(a=>a.getAttribute('aria-label'))).toEqual(['Idle']);
 fireEvent.click(within(portfolio).getByRole('button',{name:'查看專案'}));
 const drawer=screen.getByRole('dialog',{name:'Idle'});
 expect(within(drawer).getAllByText('目前沒有進行中的工作').length).toBeGreaterThan(0);
 expect(within(drawer).queryByText(/Health:|AI Executing|已通過標準檢查/)).not.toBeInTheDocument();
 expect(calls.filter(u=>u.includes('/pull-status')).length).toBe(5); // no card/drawer refetch
});

test('failed refresh invalidates successful state everywhere with no fixture fallback', async()=>{
 let failed=false;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  if(String(input)==='/api/state')return response(state([real('Project')]));
  return failed ? response(null,false) : response(githubSnapshot({state:'open',ciStatus:'running'}));
 });
 render(<App/>);
 const portfolio=screen.getByRole('region',{name:'專案總覽清單'});
 await waitFor(()=>expect(within(portfolio).getByRole('article')).toHaveAttribute('data-status','IN_PROGRESS'));
 failed=true;
 fireEvent.click(screen.getAllByRole('button',{name:'重新查詢 GitHub 最新狀態'})[0]);
 await waitFor(()=>expect(within(portfolio).getByRole('article')).toHaveTextContent('UNAVAILABLE'));
 expect(within(portfolio).getByRole('article')).toHaveAttribute('data-status','UNKNOWN');
 expect(screen.getByRole('button',{name:'自動檢查中 (0)'})).toBeVisible();
 expect(screen.getAllByRole('button',{name:'待你關注 (1)'}).length).toBe(2);
 fireEvent.click(screen.getByRole('button',{name:'無法確認'}));
 expect(within(portfolio).getAllByRole('article').length).toBe(1);
 fireEvent.click(within(portfolio).getByRole('button',{name:'查看資料來源'}));
 expect(screen.getByRole('dialog')).toHaveTextContent('UNAVAILABLE');
 expect(screen.getByRole('dialog')).not.toHaveTextContent('自動檢查執行中');
});

test('failed saved-state load does not overwrite the persisted dataset', async()=>{
 const calls:RequestInit[]=[];
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,options)=>{calls.push(options||{});return response(null,false);});
 render(<App/>);
 await new Promise(resolve=>setTimeout(resolve,650));
 expect(calls.some(c=>c.method==='PUT')).toBe(false);
 expect(screen.getByText(/專案清單：UNAVAILABLE/)).toBeVisible();
});

test.each([{}, {projects:[],attentionItems:[]}, state([{} as MicroSaaSProject])])('malformed saved data disables autosave rather than replacing data with fixtures', async(bad)=>{
 const calls:RequestInit[]=[];
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,options)=>{calls.push(options||{});return response(bad);});
 render(<App/>);
 await new Promise(resolve=>setTimeout(resolve,650));
 expect(calls.some(c=>c.method==='PUT')).toBe(false);
 expect(screen.getByText(/專案清單：UNAVAILABLE/)).toBeVisible();
});

test('known missing saved state supports a fresh empty portfolio without counting demos', async()=>{
 vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,options)=> options?.method==='PUT' ? response({ok:true}) : ({ok:false,status:404,json:async()=>({error:'No saved state yet.'})} as Response));
 render(<App/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'全部 (0)'})).toBeVisible());
 expect(screen.getByText(/尚未連結真實專案/)).toBeVisible();
});
