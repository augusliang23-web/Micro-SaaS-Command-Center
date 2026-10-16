// Local presentation fixtures only. No API, persisted approval or live telemetry authority.
export type Page = 'overview' | 'workspace' | 'cost' | 'history';
// The single project connected to live, read-only GitHub history in this phase.
// Its identity is explicit (source + stable ID + exact repository); the DEMO
// 'PM Dashboard' card never upgrades into it by name.
export const LIVE_PM_DASHBOARD = { source: 'REGISTERED' as const, projectId: 'registered-pm-dashboard', repository: 'augusliang23-web/pm-dashboard', displayName: 'PM Dashboard' };
export type DemoProject = { name: string; description: string; milestone: string; blocker: string; next: string };
export type DemoTask = {
  id: string; title: string; reference: string; branch: string; description: string;
  dependencies: string[]; lane: 'foundation' | 'track-b' | 'ui' | 'cost'; x: number;
  source: 'historical' | 'demo'; status: string; provenance?: { url: string; observedAt: string; headSha: string; baseSha: string; baseBranch: string; observedState: string };
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
export const TOPOLOGY_DATE = '2026-10-11 07:43 +08:00';
export const KNOWN_TASKS: DemoTask[] = [
  {
    "id": "pr25",
    "title": "Phase 3B7B1: Docker offline execution foundation (fake agent only, approval-gated Git actions)",
    "reference": "PR #25",
    "branch": "claude/agent-console-phase3b7b1-docker-offline-foundation",
    "description": "GitHub 讀回的有界拓樸快照；不是即時狀態，沒有 merge 或執行授權。",
    "dependencies": [
      "main"
    ],
    "lane": "foundation",
    "x": 220,
    "source": "historical",
    "status": "未即時查詢",
    "provenance": {
      "url": "https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/25",
      "observedAt": "2026-10-10T23:43:21Z",
      "headSha": "f5addc4a9cbab419b43ebb38159b07f51daa60ea",
      "baseSha": "25692a9a1fdedaf82910630fb767589aa5dccddf",
      "baseBranch": "main",
      "observedState": "OPEN / Draft"
    }
  },
  {
    "id": "pr26",
    "title": "Phase 3B7B2A: real-Docker fake-agent gap tests (test-only, not yet executed)",
    "reference": "PR #26",
    "branch": "claude/agent-console-phase3b7b2a-real-docker-gap-tests",
    "description": "GitHub 讀回的有界拓樸快照；不是即時狀態，沒有 merge 或執行授權。",
    "dependencies": [
      "pr25"
    ],
    "lane": "foundation",
    "x": 570,
    "source": "historical",
    "status": "未即時查詢",
    "provenance": {
      "url": "https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/26",
      "observedAt": "2026-10-10T23:43:21Z",
      "headSha": "ae3f1e5ae518aa0ed234d96c66934372b8ba213c",
      "baseSha": "f5addc4a9cbab419b43ebb38159b07f51daa60ea",
      "baseBranch": "claude/agent-console-phase3b7b1-docker-offline-foundation",
      "observedState": "OPEN / Draft"
    }
  },
  {
    "id": "pr27",
    "title": "Phase 3B7B2B-A0: durable execution identity foundation (offline)",
    "reference": "PR #27",
    "branch": "claude/agent-console-phase3b7b2b-a0-execution-identity",
    "description": "GitHub 讀回的有界拓樸快照；不是即時狀態，沒有 merge 或執行授權。",
    "dependencies": [
      "pr26"
    ],
    "lane": "foundation",
    "x": 920,
    "source": "historical",
    "status": "未即時查詢",
    "provenance": {
      "url": "https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/27",
      "observedAt": "2026-10-10T23:43:21Z",
      "headSha": "c7c751df3acd5e3be22cc5c2ac7d3001278ab453",
      "baseSha": "ae3f1e5ae518aa0ed234d96c66934372b8ba213c",
      "baseBranch": "claude/agent-console-phase3b7b2a-real-docker-gap-tests",
      "observedState": "OPEN / Draft"
    }
  },
  {
    "id": "pr28",
    "title": "Phase 3B7B2B-A1-0: pending action foundation (offline)",
    "reference": "PR #28",
    "branch": "claude/agent-console-phase3b7b2b-a1-0-pending-action",
    "description": "GitHub 讀回的有界拓樸快照；不是即時狀態，沒有 merge 或執行授權。",
    "dependencies": [
      "pr27"
    ],
    "lane": "foundation",
    "x": 1270,
    "source": "historical",
    "status": "未即時查詢",
    "provenance": {
      "url": "https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/28",
      "observedAt": "2026-10-10T23:43:21Z",
      "headSha": "cf7fc7db9ebdef236a0d2f72a2399fca644ad755",
      "baseSha": "c7c751df3acd5e3be22cc5c2ac7d3001278ab453",
      "baseBranch": "claude/agent-console-phase3b7b2b-a0-execution-identity",
      "observedState": "OPEN / Draft"
    }
  },
  {
    "id": "pr30",
    "title": "Track B B0: Interactive Command Center UI",
    "reference": "PR #30",
    "branch": "feat/track-b-uiux-prototype",
    "description": "GitHub 讀回的有界拓樸快照；不是即時狀態，沒有 merge 或執行授權。",
    "dependencies": [
      "main"
    ],
    "lane": "track-b",
    "x": 220,
    "source": "historical",
    "status": "未即時查詢",
    "provenance": {
      "url": "https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/30",
      "observedAt": "2026-10-10T23:43:21Z",
      "headSha": "6690c220aeacd86d0529bd30bed8c7de4fe9bd50",
      "baseSha": "25692a9a1fdedaf82910630fb767589aa5dccddf",
      "baseBranch": "main",
      "observedState": "OPEN / Draft"
    }
  }
];
export function tasksFor(project: string, allowKnownTopology = true): DemoTask[] {
  if (allowKnownTopology && project === 'Micro-SaaS Command Center') return [...KNOWN_TASKS, ...parallel];
  return [
    { id: 'scope', title: `${project} · 需求確認`, reference: 'DEMO-SCOPE-01', branch: 'demo/discovery', description: '本地需求探索範例；尚未查詢真實任務或分支。', dependencies: ['main'], lane: 'foundation', x: 220, source: 'demo', status: '待確認（示範）' },
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
