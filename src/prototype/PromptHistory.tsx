export type PromptEntry = {
  id: number; content: string; source: 'USER_DRAFT_UNVERIFIED' | 'USER_PASTED_UNVERIFIED';
  state: 'Draft' | 'Imported'; createdAt: string; agent?: string; model?: string;
};
export function PromptHistory({ entries, copy }: { entries: PromptEntry[]; copy:(text:string)=>Promise<void> }) {
  return <section role="region" aria-label="Prompt 紀錄內容" className="p-prompt-history">
    <p className="p-muted">本次工作階段暫存，重新整理後清除。</p>
    {!entries.length && <p>這個節點還沒有 Prompt 紀錄。</p>}
    {entries.map((entry,index)=><article key={entry.id} aria-label={`Prompt ${index+1}`}>
      <h3>Prompt {index+1} · {entry.state}</h3><span className="p-pill">{entry.source}</span>
      <p className="p-source">工作階段內建立：{new Date(entry.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Singapore',hour12:false})} +08:00</p>
      <p className="p-muted">Agent（使用者提供，未驗證）：{entry.agent ?? 'Not available'}<br/>Model（使用者提供，未驗證）：{entry.model ?? 'Not available'}</p>
      <label className="p-field">Prompt {index+1} 原文<textarea aria-label={`Prompt ${index+1} 原文`} value={entry.content} readOnly rows={6}/></label>
      <button className="p-secondary" onClick={()=>void copy(entry.content)}>複製 Prompt</button>
    </article>)}
  </section>;
}
