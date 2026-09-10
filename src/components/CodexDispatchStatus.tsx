import { Loader2, ShieldAlert, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { CodexHandoffStatus } from '../hooks/useCodexHandoff';

interface CodexDispatchStatusProps {
  requestError: string | null;
  proposeStatus: CodexHandoffStatus | null;
  executeStatus: CodexHandoffStatus | null;
  canExecute: boolean;
  executing: boolean;
  onExecute: () => void;
  planLabel?: string;
}

/**
 * Renders the shared propose-plan / approve-and-execute / result UI for the
 * Codex App Server Propose -> human review -> Execute flow. Used by both
 * CodexHandoffPanel and ChatGPTBridgeModal so the two entry points into the
 * same real dispatch mechanism look and behave identically.
 */
export function CodexDispatchStatus({
  requestError,
  proposeStatus,
  executeStatus,
  canExecute,
  executing,
  onExecute,
  planLabel = '計畫',
}: CodexDispatchStatusProps) {
  return (
    <>
      {requestError && (
        <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded p-2 flex gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>{requestError}</span>
        </div>
      )}

      {proposeStatus && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px] font-mono bg-stone-50 border border-stone-200 rounded p-2.5">
          <dt className="text-stone-500">State</dt>
          <dd className="text-stone-900 font-semibold" data-testid="codex-handoff-state">{proposeStatus.execution_state}</dd>
          <dt className="text-stone-500">Handoff</dt>
          <dd className="text-stone-700 break-all">{proposeStatus.handoff_id}</dd>
          <dt className="text-stone-500">AI Agent task</dt>
          <dd className="text-stone-700 break-all">{proposeStatus.thread_id || proposeStatus.turn_id || 'Pending'}</dd>
          <dt className="text-stone-500">Model</dt>
          <dd className="text-stone-700">{proposeStatus.actual_model || 'Not reported'}</dd>
          {(proposeStatus.normalized_blocker || proposeStatus.error) && (
            <>
              <dt className="text-stone-500">Blocker</dt>
              <dd className="text-rose-700">{proposeStatus.normalized_blocker || proposeStatus.error}</dd>
            </>
          )}
          {proposeStatus.terminal_result && (
            <>
              <dt className="text-stone-500">{planLabel}</dt>
              <dd className="text-stone-700 whitespace-pre-wrap max-h-44 overflow-auto">{proposeStatus.terminal_result}</dd>
            </>
          )}
        </dl>
      )}

      {canExecute && (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded p-2.5">
          <div className="text-[11px] text-emerald-900 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>看完上面的計畫，確定要讓 AI 真的動手改檔案（不會 commit/push）嗎？</span>
          </div>
          <button
            type="button"
            onClick={onExecute}
            disabled={Boolean(executing)}
            className="px-3 py-1.5 text-[11px] font-mono bg-emerald-700 hover:bg-emerald-800 disabled:bg-stone-400 text-white rounded flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
          >
            {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            核准並執行
          </button>
        </div>
      )}

      {executeStatus && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px] font-mono bg-stone-50 border border-stone-200 rounded p-2.5">
          <dt className="text-stone-500">執行狀態</dt>
          <dd className="text-stone-900 font-semibold">{executeStatus.execution_state}</dd>
          {(executeStatus.normalized_blocker || executeStatus.error) && (
            <>
              <dt className="text-stone-500">Blocker</dt>
              <dd className="text-rose-700">{executeStatus.normalized_blocker || executeStatus.error}</dd>
            </>
          )}
          {executeStatus.terminal_result && (
            <>
              <dt className="text-stone-500">結果</dt>
              <dd className="text-stone-700 whitespace-pre-wrap max-h-44 overflow-auto">{executeStatus.terminal_result}</dd>
            </>
          )}
        </dl>
      )}
    </>
  );
}
