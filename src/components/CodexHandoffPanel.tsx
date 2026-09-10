import { Loader2, Play } from 'lucide-react';

import type { MicroSaaSProject } from '../types';
import { useCodexHandoff } from '../hooks/useCodexHandoff';
import { CodexDispatchStatus } from './CodexDispatchStatus';

function objectiveContext(project: MicroSaaSProject) {
  const parts = [`Current task: ${project.currentTask}`];
  if (project.blocker) parts.push(`Current blocker: ${project.blocker}`);
  if (project.nextAction) parts.push(`Suggested next action: ${project.nextAction}`);
  return parts.join(' · ');
}

export function CodexHandoffPanel({ project }: { project: MicroSaaSProject }) {
  const { proposeStatus, executeStatus, requestError, proposing, executing, canExecute, runPropose, runExecute } =
    useCodexHandoff(project);

  const handlePropose = () =>
    runPropose({
      taskIdSuffix: 'propose',
      objective: `Without modifying anything, inspect this repository and propose a concrete plan to address the following: ${objectiveContext(
        project,
      )}. List the specific files you would change and, for each, a short description of the change. Do not execute the plan — only propose it.`,
      scope: ['read repository metadata and source', 'propose a file-by-file change plan, do not execute it'],
      acceptanceCriteria: [
        'plan lists specific files to change',
        'plan describes what changes for each file and why',
        'no files are actually modified',
      ],
      contextRefs: [`Command Center project ${project.id}`, `Current task context: ${project.currentTask}`],
    });

  const handleExecute = () =>
    runExecute({
      taskIdSuffix: 'execute',
      scope: ['edit the files described in the approved plan', 'run tests/build/lint to verify the change'],
      acceptanceCriteria: [
        'the described files are changed as planned',
        'relevant tests are run and their result is reported',
        'no commit or push is made',
      ],
      contextRefs: [`Command Center project ${project.id}`, `Approved plan:\n${proposeStatus?.terminal_result || ''}`],
    });

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
          onClick={handlePropose}
          disabled={Boolean(proposing || executing)}
          className="px-3 py-1.5 text-[11px] font-mono bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 text-white rounded flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          請 AI 先規劃怎麼做
        </button>
      </div>

      <CodexDispatchStatus
        requestError={requestError}
        proposeStatus={proposeStatus}
        executeStatus={executeStatus}
        canExecute={canExecute}
        executing={executing}
        onExecute={handleExecute}
        planLabel="計畫"
      />
    </div>
  );
}
