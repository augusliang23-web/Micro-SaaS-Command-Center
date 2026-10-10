// Local presentation fixtures only. No API, persisted approval or live telemetry authority.
export type Page = 'overview' | 'map' | 'command' | 'cost';
export type DemoProject = { name: string; description: string; milestone: string; blocker: string; next: string };
export type DemoTask = {
  id: string; title: string; reference: string; branch: string; description: string;
  dependencies: string[]; lane: 'foundation' | 'ui' | 'cost'; x: number;
  source: 'historical' | 'demo'; status: string;
};
export const PROJECTS: DemoProject[] = [
  { name: 'PM Dashboard', description: '專案進度與團隊協作', milestone: '團隊工作流程（示範）', blocker: '等待介面回饋（示範）', next: '檢視專案成本範例' },
  { name: 'SwipeRight', description: '產品探索與驗證', milestone: '需求整理（示範）', blocker: '成本資料尚未提供', next: '整理下一個驗證問題' },
  { name: 'SaaS Cost Guard', description: '成本可見性與風險提示', milestone: '成本呈現（示範）', blocker: '未串接任何帳單來源', next: '確認預算與上限的差異' },
  { name: 'ProSync', description: '跨渠道庫存與訂單協作', milestone: '操作流程原型（示範）', blocker: '待確認操作流程（示範）', next: '整理人工確認步驟' },
  { name: 'Micro-SaaS Command Center', description: '從想法到可審查的下一步', milestone: 'Track B · UI/UX Prototype', blocker: '真實 agent 執行尚未授權', next: '體驗分支圖與規劃交接' },
];
const parallel: DemoTask[] = [
  { id: 'ui', title: 'UI/UX Development', reference: 'DEMO-UI-01', branch: 'demo/uiux', description: '體驗四個主要頁面與專案、任務的跨頁交接。這是示範節點，並非 GitHub PR。', dependencies: ['main'], lane: 'ui', x: 390, source: 'demo', status: '待審查（示範）' },
  { id: 'cost', title: 'Cost Guard Integration', reference: 'DEMO-COST-01', branch: 'demo/cost-guard', description: '示範成本資訊的導覽與來源標示；不代表成本後端已整合。', dependencies: ['main'], lane: 'cost', x: 740, source: 'demo', status: '待規劃（示範）' },
];
export function tasksFor(project: string): DemoTask[] {
  if (project !== 'Micro-SaaS Command Center') return [
    { id: 'scope', title: `${project} · 需求確認`, reference: 'DEMO-SCOPE-01', branch: 'demo/discovery', description: '本地需求探索範例；尚未查詢真實任務或分支。', dependencies: ['main'], lane: 'foundation', x: 390, source: 'demo', status: '待確認（示範）' },
    ...parallel,
  ];
  return [
    { id: 'pr25', title: 'Docker Offline Foundation', reference: 'PR #25', branch: 'claude/agent-console-phase3b7b1-docker-offline-foundation', description: '已知的歷史基礎層依賴。此頁只重現依賴關係，沒有查詢目前 PR 狀態。', dependencies: ['main'], lane: 'foundation', x: 250, source: 'historical', status: '現況未查詢' },
    { id: 'pr26', title: 'Real Docker Fake Agent Tests', reference: 'PR #26', branch: 'claude/agent-console-phase3b7b2a-real-docker-gap-tests', description: '歷史 stacked PR，基於 PR #25。此原型不執行 Docker 或 agent。', dependencies: ['pr25'], lane: 'foundation', x: 620, source: 'historical', status: '現況未查詢' },
    { id: 'pr27', title: 'Execution Identity Foundation', reference: 'PR #27', branch: 'claude/agent-console-phase3b7b2b-a0-execution-identity', description: '歷史 execution identity 基礎層，基於 PR #26。沒有即時 GitHub、merge 或採用權限。', dependencies: ['pr26'], lane: 'foundation', x: 990, source: 'historical', status: '現況未查詢' },
    ...parallel,
  ];
}
export const SNAPSHOT = '2026-10-10 · 本地示範快照';
export type Limit = { label: string; used: number; limit: number; unit: string };
export type CostSample = { project: string; usd: number | null; budget: number | null; account: string | null; free: Limit | null };
export const COSTS: CostSample[] = [
  { project: 'PM Dashboard', usd: 36.8, budget: 80, account: 'DEMO-BILLING-A', free: { label: '資料讀取', used: 18000, limit: 50000, unit: 'reads / day' } },
  { project: 'SwipeRight', usd: null, budget: null, account: null, free: null },
  { project: 'SaaS Cost Guard', usd: 18.5, budget: 40, account: 'DEMO-BILLING-A', free: { label: '運算時間', used: 3600, limit: 10000, unit: 'seconds / month' } },
  { project: 'ProSync', usd: 73.1, budget: 100, account: 'DEMO-BILLING-B', free: { label: '資料讀取', used: 44000, limit: 50000, unit: 'reads / day' } },
  { project: 'Micro-SaaS Command Center', usd: 8.9, budget: 30, account: 'DEMO-BILLING-B', free: { label: '運算時間', used: 1200, limit: 10000, unit: 'seconds / month' } },
];
export const money = (value: number | null) => value === null ? 'Not available' : `$${value.toFixed(2)}`;
export const headroom = (used: number | null, limit: number | null) => used === null || limit === null || limit <= 0 ? null : Math.max(0, (1 - used / limit) * 100);
export const costFor = (project: string): CostSample => COSTS.find(c => c.project === project) ?? { project, usd: null, budget: null, account: null, free: null };
export const COLORS = ['#0f766e', '#8b5cf6', '#d97706', '#2563eb', '#64748b'];
