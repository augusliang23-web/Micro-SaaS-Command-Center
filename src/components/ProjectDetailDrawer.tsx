import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Shield,
  Layers,
  ArrowRight,
  Sparkles,
  Server,
  Activity,
  FileCode2,
  CornerDownRight,
  Check,
  RotateCcw,
  Copy,
  ChevronRight,
  Terminal,
  Bot,
  MessageSquare,
} from 'lucide-react';
import { MicroSaaSProject, GateStepInfo, TestOutcome, ReviewOutcome } from '../types';
import { BridgeWorkflowRail } from './BridgeWorkflowRail';
import { ChatGPTBridgeModal } from './ChatGPTBridgeModal';
import {
  getHealthBadgeStyle,
  getStageBadgeStyle,
  getModelBadgeStyle,
  getWaitingStateBadge,
} from '../utils';

interface ProjectDetailDrawerProps {
  project: MicroSaaSProject | null;
  onClose: () => void;
  onResolveBlocker: (projectId: string, resolution: string) => void;
  onApproveCurrentGate: (projectId: string) => void;
  onAdvanceToNextGate: (projectId: string) => void;
}

export const ProjectDetailDrawer: React.FC<ProjectDetailDrawerProps> = ({
  project,
  onClose,
  onResolveBlocker,
  onApproveCurrentGate,
  onAdvanceToNextGate,
}) => {
  if (!project) return null;

  const [selectedGate, setSelectedGate] = useState<GateStepInfo>(
    () => project.gates.find((g) => g.id === project.currentGate) || project.gates[0]
  );
  const [decisionOption, setDecisionOption] = useState<string>('option1');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isChatGPTModalOpen, setIsChatGPTModalOpen] = useState(false);

  const healthStyle = getHealthBadgeStyle(project.health);
  const stageStyle = getStageBadgeStyle(project.stage);
  const modelStyle = getModelBadgeStyle(project.model);
  const waitState = getWaitingStateBadge(project.waitingState);

  const handleCopyPrompt = () => {
    const promptText = `Project: ${project.name}\nStage: ${project.stage}\nCurrent Task: ${project.currentTask}\nCurrent Gate: ${project.currentGate}\nModel Assigned: ${project.model}\nBlocker: ${project.blocker || 'None'}\nNext Action: ${project.nextAction}`;
    navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-stone-900/40 backdrop-blur-xs flex justify-end animate-fadeIn">
      {/* Backdrop overlay click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Slide-over Drawer Panel */}
      <div className="relative w-full max-w-4xl bg-[#F7F6F2] border-l border-stone-300 shadow-2xl h-full flex flex-col z-10 overflow-y-auto text-stone-800">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-[#F7F6F2]/95 backdrop-blur-md border-b border-stone-300 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${healthStyle.dot}`} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-stone-900 font-mono tracking-tight">
                  {project.name}
                </h2>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${stageStyle.bg} ${stageStyle.text} ${stageStyle.border}`}>
                  {project.stage}
                </span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${healthStyle.bg} ${healthStyle.text} ${healthStyle.border}`}>
                  Health: {project.health}
                </span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${waitState.bg} ${waitState.text} ${waitState.border}`}>
                  {waitState.label}
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-2">
                <span>{project.tagline}</span>
                <span className="text-stone-400">•</span>
                <span className="font-mono text-stone-600">{project.repository}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsChatGPTModalOpen(true)}
              className="px-2.5 py-1.5 text-xs font-mono bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-md flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              title="Open ChatGPT Bridge Handover Session"
            >
              <Bot className="h-3.5 w-3.5 text-emerald-700" />
              <span>Discuss in ChatGPT</span>
            </button>
            <button
              onClick={handleCopyPrompt}
              className="px-2.5 py-1.5 text-xs font-mono bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="Copy Project Context for ChatGPT / Codex"
            >
              {copiedPrompt ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-stone-500" />}
              <span>{copiedPrompt ? 'Copied' : 'Copy Context'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Drawer Body Container */}
        <div className="p-6 space-y-6 flex-1">
          {/* SECTION 1: Current Focus (Most Important Area) */}
          <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-stone-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                  1. Current Focus & Attention Gates
                </h3>
              </div>
              <span className="text-xs font-mono text-stone-500">
                Last active: {project.lastActivity}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* Current Task */}
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 space-y-1">
                <div className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">
                  Current Task
                </div>
                <div className="text-sm font-semibold text-stone-900 leading-snug">
                  {project.currentTask}
                </div>
                <div className="text-xs text-stone-500 font-mono pt-1">
                  Gate: <span className="text-stone-900 font-bold">{project.currentGate}</span>
                </div>
              </div>

              {/* Next Action */}
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 space-y-1">
                <div className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">
                  Next Action
                </div>
                <div className="text-sm font-medium text-stone-800 leading-snug">
                  {project.nextAction}
                </div>
                <div className="text-xs text-stone-500 font-mono pt-1">
                  Assigned Model: <span className="text-stone-800 font-semibold">{project.model}</span>
                </div>
              </div>

              {/* Blocker */}
              <div
                className={`rounded-lg p-3.5 space-y-1 border ${
                  project.blocker
                    ? 'bg-amber-50/90 border-amber-200'
                    : 'bg-stone-50 border-stone-200'
                }`}
              >
                <div className="text-[10px] font-mono text-amber-900 uppercase tracking-wider flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-700" />
                  <span>Current Blocker</span>
                </div>
                <div className="text-sm font-medium text-amber-950 leading-snug">
                  {project.blocker || 'No blocking issues. Execution running normally.'}
                </div>
                {project.blocker && (
                  <div className="text-[11px] text-amber-800 font-mono pt-1">
                    Action required to proceed.
                  </div>
                )}
              </div>
            </div>

            {/* Interactive Decision Box (If Blocker / Attention exists) */}
            {project.blocker && (
              <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-4 mt-2 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 font-mono flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                    Human Decision Prompt:
                  </span>
                  <span className="text-[11px] font-mono text-stone-500">
                    Will update bridge task metadata & unblock Codex
                  </span>
                </div>

                <div className="space-y-2 text-xs text-stone-800">
                  <label className="flex items-center gap-2 p-2.5 rounded bg-white border border-stone-200 cursor-pointer hover:border-amber-400 transition-colors shadow-xs">
                    <input
                      type="radio"
                      name="decision"
                      checked={decisionOption === 'option1'}
                      onChange={() => setDecisionOption('option1')}
                      className="accent-stone-800 cursor-pointer"
                    />
                    <span>
                      <strong>Option A (Recommended):</strong> Skip duplicate records and generate an import error report for the user.
                    </span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded bg-white border border-stone-200 cursor-pointer hover:border-amber-400 transition-colors shadow-xs">
                    <input
                      type="radio"
                      name="decision"
                      checked={decisionOption === 'option2'}
                      onChange={() => setDecisionOption('option2')}
                      className="accent-stone-800 cursor-pointer"
                    />
                    <span>
                      <strong>Option B:</strong> Overwrite / update existing user records based on matching email address.
                    </span>
                  </label>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                  <button
                    onClick={() => setIsChatGPTModalOpen(true)}
                    className="px-3 py-2 text-xs font-mono bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <Bot className="h-3.5 w-3.5 text-emerald-700" />
                    <span>Ask ChatGPT for Architecture Advice</span>
                  </button>

                  <button
                    onClick={() =>
                      onResolveBlocker(
                        project.id,
                        decisionOption === 'option1'
                          ? 'Policy selected: Skip duplicate email rows with warning report.'
                          : 'Policy selected: Overwrite existing users with duplicate email.'
                      )
                    }
                    className="px-4 py-2 text-xs font-mono font-semibold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-md flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Apply Decision & Unblock</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 2: Bridge Workflow Lifecycle Visualization */}
          <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-stone-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                  2. Bridge Workflow Gate Rail
                </h3>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-stone-600">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> Complete
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-stone-900 animate-pulse" /> Current
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-600" /> Changes Req
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-stone-300" /> Pending
                </span>
              </div>
            </div>

            {/* Workflow Rail */}
            <div className="bg-[#FAF9F6] p-4 rounded-xl border border-stone-200">
              <BridgeWorkflowRail
                gates={project.gates}
                currentGateId={project.currentGate}
                selectedGateId={selectedGate.id}
                onSelectGate={(gate) => setSelectedGate(gate)}
                workflowType={project.workflowType}
              />
            </div>

            {/* Gate Detail Inspector Card */}
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold font-mono text-stone-900">
                    GATE INSPECTOR:
                  </span>
                  <span className="text-sm font-semibold text-stone-900 font-mono">
                    {selectedGate.label} ({selectedGate.shortLabel})
                  </span>
                  <span className="text-[11px] font-mono text-stone-500">
                    Status: <strong className="text-stone-800">{selectedGate.status}</strong>
                  </span>
                </div>

                {selectedGate.timestamp && (
                  <span className="text-xs font-mono text-stone-500">
                    {selectedGate.timestamp}
                  </span>
                )}
              </div>

              {/* Sub-gate Check Highlights (Tests PASS vs Review CHANGES REQUIRED) */}
              {(selectedGate.testOutcome || selectedGate.reviewOutcome) && (
                <div className="flex items-center gap-3 p-2.5 rounded bg-white border border-stone-200 text-xs font-mono flex-wrap">
                  <span className="text-stone-500">Gate Verification:</span>
                  {selectedGate.testOutcome && (
                    <span
                      className={`px-2 py-0.5 rounded border ${
                        selectedGate.testOutcome === 'PASS'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-rose-50 text-rose-800 border-rose-200'
                      }`}
                    >
                      Automated Tests: {selectedGate.testOutcome}
                    </span>
                  )}
                  {selectedGate.reviewOutcome && (
                    <span
                      className={`px-2 py-0.5 rounded border ${
                        selectedGate.reviewOutcome === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : selectedGate.reviewOutcome === 'CHANGES_REQUIRED'
                          ? 'bg-amber-50 text-amber-900 border-amber-200 font-bold'
                          : 'bg-stone-100 text-stone-700 border-stone-200'
                      }`}
                    >
                      Independent Review: {selectedGate.reviewOutcome}
                    </span>
                  )}
                  <span className="text-[11px] text-stone-400 italic ml-auto">
                    Note: Tests PASS does not imply Review PASS
                  </span>
                </div>
              )}

              {/* Gate Details / Logs / Comments */}
              <div className="text-xs text-stone-800 bg-white p-3 rounded border border-stone-200 font-mono leading-relaxed shadow-xs">
                {selectedGate.detail || 'No detailed diagnostic logs for this gate.'}
              </div>

              {/* Artifacts if any */}
              {selectedGate.artifacts && selectedGate.artifacts.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className="text-[11px] font-mono text-stone-500">Artifacts:</span>
                  {selectedGate.artifacts.map((art, idx) => (
                    <span
                      key={idx}
                      className="text-xs font-mono px-2 py-1 rounded bg-white border border-stone-300 text-stone-800 flex items-center gap-1 shadow-xs"
                    >
                      <FileCode2 className="h-3 w-3 text-stone-500" />
                      <span>{art.label}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Advance Gate Button if current gate */}
              {selectedGate.id === project.currentGate && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200 flex-wrap">
                  <button
                    onClick={() => onApproveCurrentGate(project.id)}
                    className="px-3 py-1.5 text-xs font-mono bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold rounded flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Approve Current Gate ({project.currentGate})</span>
                  </button>
                  <button
                    onClick={() => onAdvanceToNextGate(project.id)}
                    className="px-3 py-1.5 text-xs font-mono bg-stone-900 hover:bg-stone-800 text-stone-50 rounded flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <span>Advance to Next Gate</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 3 & 4: Execution Context & Environment Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Execution Context */}
            <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-stone-700" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                    3. Execution Context
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-stone-500">
                  Run ID: {project.executionContext.bridgeRunId}
                </span>
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between py-1 border-b border-stone-100">
                  <span className="text-stone-500">GitHub Issue:</span>
                  <span className="text-stone-800 font-semibold">{project.executionContext.githubIssue || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-stone-100">
                  <span className="text-stone-500">Pull Request:</span>
                  <span className="text-sky-700 font-semibold flex items-center gap-1">
                    <GitPullRequest className="h-3 w-3" />
                    {project.executionContext.githubPR || 'Pending Creation'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-stone-100">
                  <span className="text-stone-500">Git Branch:</span>
                  <span className="text-stone-800 flex items-center gap-1">
                    <GitBranch className="h-3 w-3 text-stone-400" />
                    {project.executionContext.branch}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-stone-100">
                  <span className="text-stone-500">Assigned Model:</span>
                  <span
                    className="px-2 py-0.5 rounded border text-[11px]"
                    style={{
                      backgroundColor: modelStyle.bg,
                      color: modelStyle.accent,
                      borderColor: modelStyle.border,
                    }}
                  >
                    {project.model} (Reasoning: {project.reasoningEffort})
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-stone-100">
                  <span className="text-stone-500">Blast Radius / Risk:</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                      project.executionContext.risk === 'High'
                        ? 'bg-rose-50 text-rose-800 border border-rose-200'
                        : project.executionContext.risk === 'Medium'
                        ? 'bg-amber-50 text-amber-900 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    {project.executionContext.risk} Risk
                  </span>
                </div>

                <div className="pt-1">
                  <div className="text-[11px] text-stone-500 mb-1">Routing Reason:</div>
                  <p className="text-[11px] text-stone-700 bg-stone-50 p-2.5 rounded border border-stone-200 leading-relaxed">
                    "{project.routingReason}"
                  </p>
                </div>
              </div>
            </section>

            {/* Environment Status */}
            <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-stone-700" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                    4. Environment Status
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-stone-500">
                  Live Telemetry
                </span>
              </div>

              {/* Production block */}
              <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        project.environment.production.status === 'Healthy' || project.environment.production.status === 'Live'
                          ? 'bg-emerald-600'
                          : project.environment.production.status === 'Not Deployed'
                          ? 'bg-stone-400'
                          : 'bg-amber-600'
                      }`}
                    />
                    Production Environment
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      project.environment.production.status === 'Healthy' || project.environment.production.status === 'Live'
                        ? 'text-emerald-700'
                        : 'text-stone-500'
                    }`}
                  >
                    {project.environment.production.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-stone-500 text-[11px]">
                  <span>Last Deployment:</span>
                  <span className="text-stone-700">{project.environment.production.lastDeployed}</span>
                </div>
                {project.environment.production.metrics && (
                  <div className="flex items-center justify-between text-stone-500 text-[11px]">
                    <span>Uptime / Latency:</span>
                    <span className="text-emerald-800 font-medium">
                      {project.environment.production.metrics.uptime} • {project.environment.production.metrics.p95Latency}
                    </span>
                  </div>
                )}
                {project.environment.production.url && (
                  <div className="pt-1">
                    <a
                      href={project.environment.production.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-sky-700 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{project.environment.production.url}</span>
                    </a>
                  </div>
                )}
              </div>

              {/* UAT block */}
              <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        project.environment.uat.status === 'Ready' || project.environment.uat.status === 'Active'
                          ? 'bg-emerald-600'
                          : project.environment.uat.status === 'Not Deployed'
                          ? 'bg-stone-400'
                          : 'bg-amber-600'
                      }`}
                    />
                    UAT Staging Environment
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      project.environment.uat.status === 'Ready' || project.environment.uat.status === 'Active'
                        ? 'text-emerald-700'
                        : 'text-stone-500'
                    }`}
                  >
                    {project.environment.uat.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-stone-500 text-[11px]">
                  <span>Last Refresh:</span>
                  <span className="text-stone-700">{project.environment.uat.lastRefreshed}</span>
                </div>
                {project.environment.uat.branch && (
                  <div className="flex items-center justify-between text-stone-500 text-[11px]">
                    <span>Tracked Branch:</span>
                    <span className="text-stone-800">{project.environment.uat.branch}</span>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* SECTION 5: Context Memory Timeline (Returning after days) */}
          <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-stone-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                  5. Context Memory Timeline
                </h3>
              </div>
              <span className="text-[11px] font-mono text-stone-500">
                Rapid context restoration
              </span>
            </div>

            <div className="space-y-3 relative pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-stone-200">
              {project.activityHistory.map((act) => (
                <div key={act.id} className="relative group">
                  <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-stone-700 ring-4 ring-white" />
                  <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <strong className="text-stone-900">{act.author}</strong>
                        <span className="text-stone-600">• {act.action}</span>
                        {act.gate && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-white border border-stone-300 text-stone-600">
                            Gate: {act.gate}
                          </span>
                        )}
                      </div>
                      <span className="text-stone-400 text-[11px]">{act.timestamp}</span>
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed font-mono">
                      {act.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ChatGPT Bridge Modal */}
        <ChatGPTBridgeModal
          project={project}
          isOpen={isChatGPTModalOpen}
          onClose={() => setIsChatGPTModalOpen(false)}
          onApplyResolution={onResolveBlocker}
        />
      </div>
    </div>
  );
};
