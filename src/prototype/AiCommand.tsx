import { ArrowRight, FileText, LockKeyhole, Sparkles } from 'lucide-react';
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
export function AiCommand({ project, tasks, taskId, selectTask, prompt, editPrompt, plan, generate }: {
  project: string; tasks: DemoTask[]; taskId: string; selectTask: (id: string) => void;
  prompt: string; editPrompt: (text: string) => void; plan: Plan | null; generate: () => void;
}) {
  const task = tasks.find(t => t.id === taskId);
  return <>
    <div className="p-page-heading"><div><p className="p-eyebrow">AI COMMAND</p><h1>把想法整理成下一步。</h1><p>用你的語言描述需求，先看規劃，再決定如何執行。</p></div><span className="p-pill"><LockKeyhole size={14}/> 本地預覽 · 無 AI 呼叫</span></div>
    <div className="p-command-layout"><section className="p-editor">
      <div className="p-section-heading"><h2><Sparkles size={18}/> 給下一步一個清楚的起點</h2><span>DEMO</span></div>
      <div className="p-prompt-context" role="region" aria-label="指令 context"><strong>專案：{project}</strong><span>{task ? `${task.reference} · ${task.title}` : "尚未選擇分支 / 任務"}</span>{!task && <p>仍可輸入需求；規劃將只使用目前專案，分支與任務尚待確認。</p>}</div><label className="p-field" htmlFor="p-task">分支 / 任務<select aria-label="分支 / 任務" id="p-task" value={taskId} onChange={e => selectTask(e.target.value)}><option value="">尚未選擇任務</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.reference} · {t.title}</option>)}</select></label>
      <label className="p-field" htmlFor="p-prompt">你的指令<textarea aria-label="你的指令" id="p-prompt" value={prompt} onChange={e=>editPrompt(e.target.value)} maxLength={8000} rows={8} placeholder="例如：幫我在 Development Map 加上多個平行開發分支，每個節點顯示任務標題，並且可以點擊查看 PR 詳細資訊。" /></label>
      <div className="p-editor-footer"><small>草稿只留在本頁工作階段，不寫入後端或瀏覽器儲存。</small><span>{prompt.length} / 8000</span></div>
      <button className="p-primary" disabled={!prompt.trim()} onClick={generate}>產生示範規劃 <ArrowRight size={17}/></button>
      <div className="p-plan" role="region" aria-label="規劃預覽">
        {plan ? <><span className="p-pill">DEMO PLANNING PREVIEW</span><h3>從需求到可審查的工作</h3><p className="p-quoted">{plan.prompt}</p><ol>{plan.steps.map(step=><li key={step}>{step}</li>)}</ol><p className="p-muted">由本地固定規則整理，並非真實 AI 模型產出。</p></> : <div className="p-empty"><FileText size={27}/><h3>規劃會出現在這裡</h3><p>輸入繁體中文需求，再產生可供討論的示範步驟。</p></div>}
      </div>
    </section><aside className="p-detail p-command-context"><p className="p-eyebrow">CURRENT CONTEXT</p><h2>{project}</h2><span className="p-pill">DEMO 專案 context</span><dl className="p-info-list"><div><dt>目前任務</dt><dd>{task?.title ?? '尚未選擇任務'}</dd></div><div><dt>分支</dt><dd className="p-code">{task?.branch ?? 'Not available'}</dd></div><div><dt>依賴</dt><dd>{task?.dependencies.map(id=>tasks.find(t=>t.id===id)?.reference??id).join('、') ?? 'Not available'}</dd></div><div><dt>建議 Agent</dt><dd>{plan ? 'Codex（示範建議）' : '產生規劃後顯示'}</dd></div><div><dt>建議 Model</dt><dd>{plan?.model ?? '等待 Control Plane 選定'}</dd></div><div><dt>核准狀態</dt><dd>未核准 · 等待 Control Plane</dd></div><div><dt>下一步</dt><dd>審查規劃與驗收條件</dd></div></dl><button className="p-primary" disabled>Execute with Agent</button><p className="p-safety"><LockKeyhole size={16}/> B0 未授權真實 agent 執行。這裡不會啟動 Codex、Claude Code 或外部 API。</p></aside></div>
  </>;
}
