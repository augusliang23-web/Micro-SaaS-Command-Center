import { DemoTask } from './data';
export type Plan = { prompt: string; project: string; taskId: string; steps: string[]; model: string };
export function makeDemoPlan(prompt: string, project: string, task: DemoTask | undefined): Plan {
  const security = /權限|認證|安全|帳單|金流/.test(prompt);
  return { prompt: prompt.trim(), project, taskId: task?.id ?? '', model: security ? 'GPT-6.1 Sol · High（示範建議）' : 'GPT-6.1 Sol · Medium（示範建議）', steps: [
    `確認 ${project} 的目標、範圍與不做事項。`,
    task ? `核對「${task.title}」的相依關係與驗收條件。` : '選定任務與分支，記錄目前無法確認的資訊。',
    security ? '先取得安全邊界與人工審查，再提出實作方案。' : '準備最小介面改動與可重現的操作測試。',
    '交回 Control Plane 審查；本預覽不建立執行或核准。',
  ] };
}
export function DemoPlanningPreview({ plan, reference }: { plan: Plan | null; reference: string }) {
  return <div className="p-plan" role="region" aria-label="規劃預覽">
    {plan ? <><span className="p-pill">DEMO PLANNING PREVIEW</span><h3>{reference} · 本地規劃</h3><p className="p-quoted">{plan.prompt}</p><ol>{plan.steps.map(step=><li key={step}>{step}</li>)}</ol><p className="p-muted">固定規則整理，並非真實 AI 或核准；{plan.model}</p></> : <p className="p-muted">輸入新需求後，可查看固定規則的 DEMO 規劃。</p>}
  </div>;
}
