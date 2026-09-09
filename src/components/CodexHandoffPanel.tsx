import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, ShieldAlert, ShieldCheck, CheckCircle2 } from 'lucide-react';

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

const FULL_PROHIBITED_ACTIONS = [
  'auto_merge',
  'production_deploy',
  'billing_changes',
  'secrets_changes',
  'destructive_actions',
  'self_approval',
  'git_commit',
  'git_push',
];

function objectiveContext(project: MicroSaaSProject) {
  const parts = [`Current task: ${project.currentTask}`];
  if (project.blocker) parts.push(`Current blocker: ${project.blocker}`);
  if (project.nextAction) parts.push(`Suggested next action: ${project.nextAction}`);
  return parts.join(' · ');
}

function proposeDispatch(project: MicroSaaSProject) {
  const taskId = `${project.id}-propose-${Date.now()}`;
  return {
    project_id: project.id,
    task_id: taskId,
    canonical_task_ref: `command-center://projects/${project.id}/tasks/${taskId}`,
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
    objective: `Without modifying anything, inspect this repository and propose a concrete plan to address the following: ${objectiveContext(
      project,
    )}. List the specific files you would change and, for each, a short description of the change. Do not execute the plan — only propose it.`,
    scope: ['read repository metadata and source', 'propose a file-by-file change plan, do not execute it'],
    acceptance_criteria: [
      'plan lists specific files to change',
      'plan describes what changes for each file and why',
      'no files are actually modified',
    ],
    constraints: ['read-only', 'do not modify files', 'do not create commits, branches, PRs, deployments, or releases'],
    prohibited_actions: FULL_PROHIBITED_ACTIONS,
    context_refs: [`Command Center project ${project.id}`, `Current task context: ${project.currentTask}`],
    architecture_refs: ['Bridge V0.4 Zero-Copy Codex Handoff MVP Design'],
    required_completion_evidence: ['proposed file-by-file change plan'],
    callback_expectation: 'Return the proposed plan and lifecycle state to Command Center.',
  };
}

function executeDispatch(project: MicroSaaSProject, approvedPlan: string) {
  const taskId = `${project.id}-execute-${Date.now()}`;
  return {
    project_id: project.id,
    task_id: taskId,
    canonical_task_ref: `command-center://projects/${project.id}/tasks/${taskId}`,
    target_surface: 'CODE_EXECUTOR',
    task_classification: 'WORKSPACE_WRITE_EXECUTION',
    governance_classification: 'LOW_RISK_EXPLICIT_ACTION',
    risk_level: 'LOW',
    reasoning_level: 'HIGH',
    execution_authority: {
      explicit_user_action: true,
      authorized_by: 'local_user',
      authorized_actions: ['repository_read', 'file_write', 'command_execute'],
    },
    objective: `Execute exactly this human-approved plan, and no more: ${approvedPlan}`,
    scope: ['edit the files described in the approved plan', 'run tests/build/lint to verify the change'],
    acceptance_criteria: [
      'the described files are changed as planned',
      'relevant tests are run and their result is reported',
      'no commit or push is made',
    ],
    constraints: [
      'no-commit-no-push',
      'do not run git commit',
      'do not run git push',
      'stay within the scope of the approved plan',
    ],
    prohibited_actions: FULL_PROHIBITED_ACTIONS,
    context_refs: [`Command Center project ${project.id}`, `Approved plan:\n${approvedPlan}`],
    architecture_refs: ['Bridge V0.4 Zero-Copy Codex Handoff MVP Design'],
    required_completion_evidence: ['summary of files changed', 'test/build result'],
    callback_expectation: 'Return the execution result and lifecycle state to Command Center.',
  };
}

export function CodexHandoffPanel({ project }: { project: MicroSaaSProject }) {
  const [proposeStatus, setProposeStatus] = useState<CodexHandoffStatus | null>(null);
  const [executeStatus, setExecuteStatus] = useState<CodexHandoffStatus | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState<'propose' | 'execute' | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, []);

  const poll = async (handoffId: string, setStatus: (s: CodexHandoffStatus) => void) => {
    try {
      const response = await fetch(`/api/bridge/codex-handoffs/${encodeURIComponent(handoffId)}`, {
        headers: { Accept: 'application/json' },
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'Unable to read AI Agent handoff status.');
      setStatus(next);
      if (!TERMINAL_STATES.has(next.execution_state)) {
        pollTimer.current = window.setTimeout(() => void poll(handoffId, setStatus), 750);
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  };

  const runPropose = async () => {
    setDispatching('propose');
    setRequestError(null);
    setExecuteStatus(null);
    try {
      const response = await fetch('/api/bridge/codex-handoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(proposeDispatch(project)),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'AI Agent handoff could not start.');
      setProposeStatus(next);
      if (!TERMINAL_STATES.has(next.execution_state)) void poll(next.handoff_id, setProposeStatus);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setDispatching(null);
    }
  };

  const runExecute = async () => {
    if (!proposeStatus?.terminal_result) return;
    setDispatching('execute');
    setRequestError(null);
    try {
      const response = await fetch('/api/bridge/codex-handoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(executeDispatch(project, proposeStatus.terminal_result)),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'AI Agent handoff could not start.');
      setExecuteStatus(next);
      if (!TERMINAL_STATES.has(next.execution_state)) void poll(next.handoff_id, setExecuteStatus);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setDispatching(null);
    }
  };

  const proposing = dispatching === 'propose' || (proposeStatus && !TERMINAL_STATES.has(proposeStatus.execution_state));
  const executing = dispatching === 'execute' || (executeStatus && !TERMINAL_STATES.has(executeStatus.execution_state));
  const planReady = proposeStatus?.execution_state === 'COMPLETED' && Boolean(proposeStatus.terminal_result);
  const canExecute = planReady && !executeStatus;

  return (
    <div className="mt-3 border-t border-stone-200 pt-3 space-y-3" data-testid="codex-handoff-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-stone-800">Native AI Agent handoff</div>
          <div className="text-[10px] text-stone-500">
            AI 會先規劃、你確認過才會真的執行；只能改檔案跟跑測試，不會自動 commit 或 push
          </div>
        </div>
        <button
          type="button"
          onClick={runPropose}
          disabled={Boolean(proposing || executing)}
          className="px-3 py-1.5 text-[11px] font-mono bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 text-white rounded flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          請 AI 先規劃怎麼做
        </button>
      </div>

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
              <dt className="text-stone-500">計畫</dt>
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
            onClick={runExecute}
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
    </div>
  );
}
