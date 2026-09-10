import { useEffect, useRef, useState } from 'react';
import type { MicroSaaSProject } from '../types';

export type CodexExecutionState =
  | 'NOT_STARTED'
  | 'QUEUED'
  | 'WORKING'
  | 'AWAITING_INPUT'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED_PROVIDER'
  | 'BLOCKED_ENVIRONMENT';

export interface CodexHandoffStatus {
  handoff_id: string;
  thread_id: string | null;
  turn_id: string | null;
  provider: string;
  handoff_strategy: string;
  actual_model: string | null;
  execution_state: CodexExecutionState;
  last_meaningful_activity: string;
  normalized_blocker: string | null;
  terminal_result: string | null;
  error: string | null;
}

const TERMINAL_STATES = new Set<CodexExecutionState>([
  'AWAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'BLOCKED_PROVIDER',
  'BLOCKED_ENVIRONMENT',
]);

export const FULL_PROHIBITED_ACTIONS = [
  'auto_merge',
  'production_deploy',
  'billing_changes',
  'secrets_changes',
  'destructive_actions',
  'self_approval',
  'git_commit',
  'git_push',
];

export interface ProposeArgs {
  taskIdSuffix: string;
  objective: string;
  scope: string[];
  acceptanceCriteria: string[];
  contextRefs: string[];
}

export interface ExecuteArgs {
  taskIdSuffix: string;
  scope: string[];
  acceptanceCriteria: string[];
  contextRefs: string[];
}

function proposeDispatch(project: MicroSaaSProject, args: ProposeArgs) {
  const taskId = `${project.id}-${args.taskIdSuffix}-${Date.now()}`;
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
    objective: args.objective,
    scope: args.scope,
    acceptance_criteria: args.acceptanceCriteria,
    constraints: ['read-only', 'do not modify files', 'do not create commits, branches, PRs, deployments, or releases'],
    prohibited_actions: FULL_PROHIBITED_ACTIONS,
    context_refs: args.contextRefs,
    architecture_refs: ['Bridge V0.4 Zero-Copy Codex Handoff MVP Design'],
    required_completion_evidence: ['proposed file-by-file change plan'],
    callback_expectation: 'Return the proposed plan and lifecycle state to Command Center.',
  };
}

function executeDispatch(project: MicroSaaSProject, approvedPlan: string, args: ExecuteArgs) {
  const taskId = `${project.id}-${args.taskIdSuffix}-${Date.now()}`;
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
    scope: args.scope,
    acceptance_criteria: args.acceptanceCriteria,
    constraints: [
      'no-commit-no-push',
      'do not run git commit',
      'do not run git push',
      'stay within the scope of the approved plan',
    ],
    prohibited_actions: FULL_PROHIBITED_ACTIONS,
    context_refs: args.contextRefs,
    architecture_refs: ['Bridge V0.4 Zero-Copy Codex Handoff MVP Design'],
    required_completion_evidence: ['summary of files changed', 'test/build result'],
    callback_expectation: 'Return the execution result and lifecycle state to Command Center.',
  };
}

/**
 * Shared real-dispatch mechanics for the Codex App Server Propose -> human
 * review -> Execute flow. Extracted so every entry point into it (the
 * project drawer's own panel, the AI advisor modal's "apply decision") uses
 * the exact same safety-reviewed request shapes and polling, instead of
 * each growing its own copy.
 */
export function useCodexHandoff(project: MicroSaaSProject | null) {
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

  const runPropose = async (args: ProposeArgs) => {
    if (!project) return;
    setDispatching('propose');
    setRequestError(null);
    setExecuteStatus(null);
    try {
      const response = await fetch('/api/bridge/codex-handoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(proposeDispatch(project, args)),
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

  const runExecute = async (args: ExecuteArgs) => {
    if (!project || !proposeStatus?.terminal_result) return;
    setDispatching('execute');
    setRequestError(null);
    try {
      const response = await fetch('/api/bridge/codex-handoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(executeDispatch(project, proposeStatus.terminal_result, args)),
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

  const proposing = dispatching === 'propose' || (proposeStatus !== null && !TERMINAL_STATES.has(proposeStatus.execution_state));
  const executing = dispatching === 'execute' || (executeStatus !== null && !TERMINAL_STATES.has(executeStatus.execution_state));
  const planReady = proposeStatus?.execution_state === 'COMPLETED' && Boolean(proposeStatus.terminal_result);
  const canExecute = planReady && !executeStatus;

  return {
    proposeStatus,
    executeStatus,
    requestError,
    proposing,
    executing,
    planReady,
    canExecute,
    runPropose,
    runExecute,
  };
}
