import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, ShieldAlert } from 'lucide-react';

import type { MicroSaaSProject } from '../types';

type ExecutionState =
  | 'NOT_STARTED'
  | 'QUEUED'
  | 'WORKING'
  | 'AWAITING_INPUT'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED_PROVIDER'
  | 'BLOCKED_ENVIRONMENT';

interface CodexHandoffStatus {
  handoff_id: string;
  thread_id: string | null;
  turn_id: string | null;
  provider: string;
  handoff_strategy: string;
  actual_model: string | null;
  execution_state: ExecutionState;
  last_meaningful_activity: string;
  normalized_blocker: string | null;
  terminal_result: string | null;
  error: string | null;
}

const TERMINAL_STATES = new Set<ExecutionState>([
  'AWAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'BLOCKED_PROVIDER',
  'BLOCKED_ENVIRONMENT',
]);

function readOnlyDispatch(project: MicroSaaSProject) {
  return {
    project_id: project.id,
    task_id: `${project.id}-read-only-smoke`,
    canonical_task_ref: `command-center://projects/${project.id}/tasks/read-only-smoke`,
    target_surface: 'CODE_EXECUTOR',
    task_classification: 'READ_ONLY_REPOSITORY_INSPECTION',
    governance_classification: 'LOW_RISK_EXPLICIT_ACTION',
    risk_level: 'LOW',
    reasoning_level: 'HIGH',
    execution_authority: {
      explicit_user_action: true,
      authorized_by: 'local_user',
      authorized_actions: ['repository_read'],
    },
    objective: `Inspect ${project.name}'s allowlisted repository. Report its current branch, exact HEAD SHA, working-tree state, and a concise top-level structure summary without modifying files.`,
    scope: ['read repository metadata', 'report branch, HEAD, working-tree state, and top-level structure'],
    acceptance_criteria: [
      'report current branch',
      'report exact HEAD SHA',
      'report clean or dirty working-tree state',
      'summarize top-level repository structure',
    ],
    constraints: ['read-only', 'do not modify files', 'do not create commits, branches, PRs, deployments, or releases'],
    prohibited_actions: [
      'auto_merge',
      'production_deploy',
      'billing_changes',
      'secrets_changes',
      'destructive_actions',
      'self_approval',
    ],
    context_refs: [`Command Center project ${project.id}`, `Current task context: ${project.currentTask}`],
    architecture_refs: ['Bridge V0.4 Zero-Copy Codex Handoff MVP Design'],
    required_completion_evidence: ['branch', 'HEAD SHA', 'working-tree state', 'top-level structure'],
    callback_expectation: 'Return the read-only inspection result and lifecycle state to Command Center.',
  };
}

export function CodexHandoffPanel({ project }: { project: MicroSaaSProject }) {
  const [status, setStatus] = useState<CodexHandoffStatus | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, []);

  const poll = async (handoffId: string) => {
    try {
      const response = await fetch(`/api/bridge/codex-handoffs/${encodeURIComponent(handoffId)}`, {
        headers: { Accept: 'application/json' },
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'Unable to read AI Agent handoff status.');
      setStatus(next);
      if (!TERMINAL_STATES.has(next.execution_state)) {
        pollTimer.current = window.setTimeout(() => void poll(handoffId), 750);
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  };

  const runWithCodex = async () => {
    setDispatching(true);
    setRequestError(null);
    try {
      const response = await fetch('/api/bridge/codex-handoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(readOnlyDispatch(project)),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'AI Agent handoff could not start.');
      setStatus(next);
      if (!TERMINAL_STATES.has(next.execution_state)) void poll(next.handoff_id);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setDispatching(false);
    }
  };

  const active = dispatching || (status && !TERMINAL_STATES.has(status.execution_state));

  return (
    <div className="mt-3 border-t border-stone-200 pt-3 space-y-3" data-testid="codex-handoff-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-stone-800">Native AI Agent handoff</div>
          <div className="text-[10px] text-stone-500">Local read-only inspection · explicit action required</div>
        </div>
        <button
          type="button"
          onClick={runWithCodex}
          disabled={Boolean(active)}
          className="px-3 py-1.5 text-[11px] font-mono bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 text-white rounded flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run with AI Agent
        </button>
      </div>

      {requestError && (
        <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded p-2 flex gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>{requestError}</span>
        </div>
      )}

      {status && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px] font-mono bg-stone-50 border border-stone-200 rounded p-2.5">
          <dt className="text-stone-500">State</dt>
          <dd className="text-stone-900 font-semibold" data-testid="codex-handoff-state">{status.execution_state}</dd>
          <dt className="text-stone-500">Handoff</dt>
          <dd className="text-stone-700 break-all">{status.handoff_id}</dd>
          <dt className="text-stone-500">AI Agent task</dt>
          <dd className="text-stone-700 break-all">{status.thread_id || status.turn_id || 'Pending'}</dd>
          <dt className="text-stone-500">Provider</dt>
          <dd className="text-stone-700">{status.provider}</dd>
          <dt className="text-stone-500">Strategy</dt>
          <dd className="text-stone-700">{status.handoff_strategy}</dd>
          <dt className="text-stone-500">Model</dt>
          <dd className="text-stone-700">{status.actual_model || 'Not reported'}</dd>
          <dt className="text-stone-500">Activity</dt>
          <dd className="text-stone-700">{status.last_meaningful_activity}</dd>
          {(status.normalized_blocker || status.error) && (
            <>
              <dt className="text-stone-500">Blocker</dt>
              <dd className="text-rose-700">{status.normalized_blocker || status.error}</dd>
            </>
          )}
          {status.terminal_result && (
            <>
              <dt className="text-stone-500">Result</dt>
              <dd className="text-stone-700 whitespace-pre-wrap max-h-44 overflow-auto">{status.terminal_result}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
