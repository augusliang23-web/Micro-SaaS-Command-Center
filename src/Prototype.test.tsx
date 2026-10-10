import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { initialProjects, initialAttentionItems, initialNextBestAction, initialExecutionSnapshot } from './mockData';
import { githubSnapshot } from './test/githubSnapshots.mjs';
import App from './App';

beforeEach(() => { window.history.replaceState(null, '', '/?mode=demo'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
const open = (page: string) => fireEvent.click(within(screen.getByRole('navigation', { name: '主要頁面' })).getByRole('button', { name: page }));
const project = (name: string) => fireEvent.change(screen.getByLabelText('目前專案'), { target: { value: name } });

test('explicit demo renders all four primary navigation pages', () => {
  render(<App />);
  expect(screen.getByText('DEMO DATA')).toBeVisible();
  for (const [page, heading] of [['專案總覽', '你的開發組合，一眼掌握。'], ['Development Map', '讓每條開發分支都有方向。'], ['AI Command', '把想法整理成下一步。'], ['Cost Guard', '在成本越界之前，看見餘裕。']]) {
    open(page); expect(screen.getByRole('heading', { name: heading })).toBeVisible();
  }
});

test('all five named project samples are available and selected context survives navigation', () => {
  render(<App />);
  const selector = screen.getByLabelText('目前專案');
  for (const name of ['PM Dashboard','SwipeRight','SaaS Cost Guard','ProSync','Micro-SaaS Command Center']) expect(within(selector).getByRole('option',{name})).toBeInTheDocument();
  project('PM Dashboard'); open('Development Map'); open('AI Command'); open('Cost Guard'); open('專案總覽');
  expect(selector).toHaveValue('PM Dashboard');
});

test('map exposes every task title and two example parallel branches', () => {
  render(<App />); open('Development Map');
  const map = screen.getByRole('region', { name: '開發分支圖' });
  for (const title of ['Docker Offline Foundation', 'Real Docker Fake Agent Tests', 'Execution Identity Foundation', 'UI/UX Development', 'Cost Guard Integration']) expect(within(map).getByRole('button', { name: new RegExp(title) })).toBeVisible();
  expect(within(map).getAllByText('DEMO-ONLY').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/歷史參考，現況未查詢/)).toBeVisible();
});

test('historical stacked dependencies do not imply a live GitHub status or completed merges', () => {
  render(<App />); open('Development Map');
  fireEvent.click(screen.getByRole('button', { name: /Execution Identity Foundation/ }));
  const detail = screen.getByRole('region', { name: '任務詳細' });
  expect(detail).toHaveTextContent('PR #26'); expect(detail).toHaveTextContent('歷史參考');
  fireEvent.click(screen.getByRole('button', { name: /Real Docker Fake Agent Tests/ }));
  expect(detail).toHaveTextContent('PR #25');
  expect(screen.getByText(/假設合併，未發生/)).toBeVisible();
});

test('workflow A hands PR27 and Chinese prompt into local planning without execution', () => {
  const network = vi.spyOn(globalThis, 'fetch'); render(<App />);
  const card = screen.getByRole('article', { name: 'Micro-SaaS Command Center 示範專案' });
  fireEvent.click(within(card).getByRole('button', { name: '開啟 Development Map' }));
  fireEvent.click(screen.getByRole('button', { name: /Execution Identity Foundation/ }));
  fireEvent.click(screen.getByRole('button', { name: '交給 AI Command' }));
  expect(screen.getByLabelText('目前專案')).toHaveValue('Micro-SaaS Command Center');
  expect(screen.getByLabelText('分支 / 任務')).toHaveValue('pr27');
  const prompt = '幫我在 Development Map 加上多個平行開發分支，每個節點顯示任務標題。';
  fireEvent.change(screen.getByLabelText('你的指令'), { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: '產生示範規劃' }));
  expect(screen.getByRole('region', { name: '規劃預覽' })).toHaveTextContent('DEMO PLANNING PREVIEW');
  expect(screen.getByRole('region', { name: '規劃預覽' })).toHaveTextContent(prompt);
  expect(screen.getByRole('button', { name: 'Execute with Agent' })).toBeDisabled();
  expect(network).not.toHaveBeenCalled();
});

test('workflow B project card opens matching cost detail and returns without losing selection', () => {
  render(<App />);
  fireEvent.click(within(screen.getByRole('article',{name:'PM Dashboard 示範專案'})).getByRole('button',{name:'查看 Cost Guard'}));
  expect(screen.getByRole('region',{name:'專案成本詳細'})).toHaveTextContent('PM Dashboard');
  open('專案總覽'); expect(screen.getByLabelText('目前專案')).toHaveValue('PM Dashboard');
});

test('workflow C preserves demo UI task context when opening AI Command', () => {
  render(<App />); open('Development Map');
  fireEvent.click(screen.getByRole('button',{name:/UI\/UX Development/}));
  expect(screen.getByRole('region',{name:'任務詳細'})).toHaveTextContent('DEMO-ONLY');
  fireEvent.click(screen.getByRole('button',{name:'交給 AI Command'}));
  expect(screen.getByLabelText('分支 / 任務')).toHaveValue('ui');
});

test('empty prompt cannot generate a plan and execution remains disabled', () => {
  render(<App />); open('AI Command');
  expect(screen.getByRole('button',{name:'產生示範規劃'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Execute with Agent'})).toBeDisabled();
  expect(screen.getByText(/B0 未授權真實 agent 執行/)).toBeVisible();
});

test('editing prompt invalidates the previous planning preview', () => {
  render(<App />); open('AI Command');
  fireEvent.change(screen.getByLabelText('你的指令'),{target:{value:'修正卡片排版'}});
  fireEvent.click(screen.getByRole('button',{name:'產生示範規劃'}));
  expect(screen.getByRole('region',{name:'規劃預覽'})).toHaveTextContent('修正卡片排版');
  fireEvent.change(screen.getByLabelText('你的指令'),{target:{value:'改成修正成本圖'}});
  expect(screen.queryByText('DEMO PLANNING PREVIEW')).not.toBeInTheDocument();
});

test('project switch invalidates task and plan context instead of carrying an unrelated PR', () => {
  render(<App />); open('Development Map');
  fireEvent.click(screen.getByRole('button',{name:/Execution Identity Foundation/}));
  fireEvent.click(screen.getByRole('button',{name:'交給 AI Command'}));
  project('PM Dashboard');
  expect(within(screen.getByLabelText('分支 / 任務')).queryByRole('option',{name:/PR #27/})).not.toBeInTheDocument();
});

test('prompt draft survives page navigation but is not saved to backend or browser storage', () => {
  const fetch = vi.spyOn(globalThis,'fetch'); const save = vi.spyOn(Storage.prototype,'setItem');
  render(<App />); open('AI Command');
  fireEvent.change(screen.getByLabelText('你的指令'),{target:{value:'繁體中文草稿'}});
  open('Cost Guard'); open('AI Command');
  expect(screen.getByLabelText('你的指令')).toHaveValue('繁體中文草稿');
  expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});

test('cost distribution uses USD samples only and explains incomplete coverage', () => {
  render(<App />); open('Cost Guard');
  expect(screen.getByRole('img',{name:/USD 示範成本分布/})).toBeVisible();
  expect(screen.getByText(/4 \/ 5 個專案金額可用/)).toBeVisible();
  expect(screen.getByText(/預算告警不會自動停止花費/)).toBeVisible();
});

test('missing cost data never becomes zero, complete usage or invented billing account', () => {
  render(<App />); project('SwipeRight'); open('Cost Guard');
  const detail=screen.getByRole('region',{name:'專案成本詳細'});
  expect(detail).toHaveTextContent('Not available'); expect(detail).toHaveTextContent('Not enough data');
  expect(detail).not.toHaveTextContent('$0');
  expect(within(detail).queryByRole('progressbar')).not.toBeInTheDocument();
});

test('demo overview exposes blockers, next action, source and project-specific cost navigation', () => {
  render(<App />);
  const card=screen.getByRole('article',{name:'Micro-SaaS Command Center 示範專案'});
  for(const label of ['里程碑','任務','阻塞','下一步','來源','DEMO']) expect(card).toHaveTextContent(label);
  fireEvent.click(within(card).getByRole('button',{name:'開啟 AI Command'}));
  expect(screen.getByRole('heading',{name:'把想法整理成下一步。'})).toBeVisible();
});

test('demo never mounts backend-backed registered overview, even on failed API availability', () => {
  const network=vi.spyOn(globalThis,'fetch');render(<App />);
  open('AI Command'); open('Development Map'); open('Cost Guard'); open('專案總覽');
  expect(network).not.toHaveBeenCalled();
  expect(screen.queryByRole('region',{name:'專案總覽清單'})).not.toBeInTheDocument();
});

test('selected map node exposes its selected state to assistive technology', () => {
  render(<App/>);open('Development Map');
  const node=screen.getByRole('button',{name:/Execution Identity Foundation · PR #27/});
  fireEvent.click(node);expect(node).toHaveAttribute('aria-pressed','true');
});

test('dependency connections encode PR25 to PR26 to PR27 and parallel branches start independently', () => {
  render(<App/>);open('Development Map');
  for(const relation of ['PR #25 → PR #26（歷史依賴）','PR #26 → PR #27（歷史依賴）','main → DEMO-UI-01（DEMO）','main → DEMO-COST-01（DEMO）']) expect(screen.getByLabelText(relation)).toBeInTheDocument();
});


test('selected registered project transfers into demo pages without treating its cost as live billing', async () => {
  window.history.replaceState(null,'','/');
  const registered={...initialProjects[0],id:'registered-pm',name:'PM Dashboard',repository:'owner/pm-dashboard'};
  vi.spyOn(globalThis,'fetch').mockImplementation(async input=>({ok:true,json:async()=>String(input)==='/api/state'?{projects:[registered],attentionItems:initialAttentionItems,nba:initialNextBestAction,snapshot:initialExecutionSnapshot}:githubSnapshot({state:'none'})}) as Response);
  render(<App/>);
  const portfolio=screen.getByRole('region',{name:'專案總覽清單'});
  await waitFor(()=>expect(within(portfolio).getByRole('article',{name:'PM Dashboard'})).toHaveAttribute('data-status','IDLE'));
  fireEvent.click(within(portfolio).getByRole('button',{name:'查看專案'}));
  fireEvent.click(screen.getByRole('button',{name:'關閉專案詳情'}));
  open('Development Map');
  expect(screen.getByLabelText('目前專案')).toHaveValue('PM Dashboard');
  open('Cost Guard');
  expect(screen.getByRole('region',{name:'專案成本詳細'})).toHaveTextContent('DEMO DATA');
  expect(screen.getByRole('region',{name:'專案成本詳細'})).toHaveTextContent('PM Dashboard');
});

test('switching primary pages restores the top of the page instead of inheriting a scrolled card position', () => {
  render(<App/>);document.documentElement.scrollTop=350;
  open('Cost Guard');expect(document.documentElement.scrollTop).toBe(0);
});
