import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  RefreshCw,
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
import { MicroSaaSProject, GateStepInfo, TestOutcome, ReviewOutcome, FeatureItem, GithubPullStatus } from '../types';
import { BridgeWorkflowRail } from './BridgeWorkflowRail';
import { ChatGPTBridgeModal } from './ChatGPTBridgeModal';
import { CiCdWorkflowModal } from './CiCdWorkflowModal';
import { FeatureDeliveryMatrix } from './FeatureDeliveryMatrix';
import {
  getHealthBadgeStyle,
  getStageBadgeStyle,
  getModelBadgeStyle,
  getWaitingStateBadge,
  isRealGithubRepo,
} from '../utils';
import { provenanceLabel } from '../statusProvenance.mjs';
import { getVerdict, getVerdictStyle } from '../verdict.mjs';

const VERDICT_ICON: Record<string, React.ElementType> = {
  danger: AlertCircle,
  decision: HelpCircle,
  ready: CheckCircle2,
  waiting: Clock,
};

function ProvenanceBadge({ provenance }: { provenance?: { authority: string; confidence: string } }) {
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-900">
      {provenanceLabel(provenance)}
    </span>
  );
}

interface ProjectDetailDrawerProps {
  project: MicroSaaSProject | null;
  onClose: () => void;
  onResolveBlocker: (projectId: string, resolution: string) => void;
  onApproveCurrentGate: (projectId: string) => void;
  onAdvanceToNextGate: (projectId: string) => void;
  onStartNewIteration?: (projectId: string, type: 'major' | 'minor' | 'hotfix') => void;
  onUpdateFeatures?: (projectId: string, updatedFeatures: FeatureItem[]) => void;
  onConfirmSelectiveRelease?: (
    projectId: string,
    selectedFeatureIds: string[],
    releaseVersion: string,
    releaseNotes: string
  ) => void;
  onShowToast?: (msg: string) => void;
}

export const ProjectDetailDrawer: React.FC<ProjectDetailDrawerProps> = ({
  project,
  onClose,
  onResolveBlocker,
  onApproveCurrentGate,
  onAdvanceToNextGate,
  onStartNewIteration,
  onUpdateFeatures,
  onConfirmSelectiveRelease,
  onShowToast,
}) => {
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);
  const [decisionOption, setDecisionOption] = useState<string>('option1');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isChatGPTModalOpen, setIsChatGPTModalOpen] = useState(false);
  const [isCiCdModalOpen, setIsCiCdModalOpen] = useState(false);
  const [iterationPromptOpen, setIterationPromptOpen] = useState(false);
  const [githubState, setGithubState] = useState<GithubPullStatus | null>(null);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [showTechDetail, setShowTechDetail] = useState(false);

  const loadGithubState = useCallback(() => {
    if (!project || !isRealGithubRepo(project.repository)) {
      setGithubState(null);
      return;
    }
    setIsLoadingGithub(true);
    fetch(`/api/github/pull-status?repo=${encodeURIComponent(project.repository)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGithubState(data))
      .catch(() => setGithubState(null))
      .finally(() => setIsLoadingGithub(false));
  }, [project]);

  useEffect(() => {
    setGithubState(null);
    setShowTechDetail(false);
    loadGithubState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  if (!project) return null;

  const verdict = getVerdict(project, githubState ?? undefined);
  const verdictStyle = getVerdictStyle(verdict.level);
  const VerdictIcon = VERDICT_ICON[verdict.level];
  const showTrustBadge = verdict.source === 'github' && githubState;
  const isTrustworthy =
    showTrustBadge &&
    (githubState!.state === 'merged' ||
      (githubState!.state === 'open' && !githubState!.isDraft && githubState!.ciStatus === 'passing' && githubState!.reviewDecision !== 'changes_requested'));
  const isDirectPush = showTrustBadge && githubState!.state === 'active';
  const githubLinkUrl = githubState?.prUrl || githubState?.lastCommitUrl;

  // Derive active gate: user-selected gate or current active gate
  const activeGateId = selectedGateId || project.currentGate;
  const selectedGate: GateStepInfo =
    project.gates.find((g) => g.id === activeGateId) ||
    project.gates.find((g) => g.id === project.currentGate) ||
    project.gates[0] || {
      id: 'DISCUSS',
      label: 'Discuss & Ideate',
      shortLabel: 'DISCUSS',
      status: 'CURRENT',
    };

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
              title="Open AI Advisor Handover Session"
            >
              <Bot className="h-3.5 w-3.5 text-emerald-700" />
              <span>請 AI 顧問討論</span>
            </button>
            <button
              onClick={handleCopyPrompt}
              className="px-2.5 py-1.5 text-xs font-mono bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="Copy Project Context for AI Advisor / AI Agent"
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
          {/* Primary verdict block — plain-language, same engine as the Portfolio card */}
          <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs">
            <div className="flex items-start gap-3.5">
              <div
                className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: verdictStyle.iconBg, color: verdictStyle.iconColor }}
              >
                <VerdictIcon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold leading-snug" style={{ color: verdictStyle.headlineColor }}>
                    {verdict.headline}
                  </h2>
                  {isTrustworthy && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <Check className="h-3 w-3" /> 已通過標準檢查
                    </span>
                  )}
                  {isDirectPush && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200">
                      <AlertTriangle className="h-3 w-3" /> 直接更新，未經審查
                    </span>
                  )}
                </div>
                <p className="text-sm text-stone-700 leading-relaxed mt-2">{verdict.explanation}</p>
                {githubLinkUrl && (
                  <a
                    href={githubLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-sm font-bold"
                  >
                    在 GitHub 上查看 <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {verdict.hasAction && !verdict.isWaiting && verdict.level !== 'decision' && (
                <a
                  href={githubLinkUrl || undefined}
                  target={githubLinkUrl ? '_blank' : undefined}
                  rel="noreferrer"
                  className="px-4 py-2 text-sm font-bold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-lg transition-colors cursor-pointer inline-block"
                >
                  {verdict.actionLabel}
                </a>
              )}
              {verdict.isWaiting && (
                <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3.5 py-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-pulse" />
                  <span className="text-xs font-bold text-sky-900">{verdict.actionLabel}</span>
                </div>
              )}
              {isRealGithubRepo(project.repository) && (
                <button
                  onClick={loadGithubState}
                  disabled={isLoadingGithub}
                  title="重新查詢 GitHub 最新狀態"
                  className="text-stone-300 hover:text-stone-600 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingGithub ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </section>

          {/* Decision UI: only meaningful on the manual path — GitHub-driven danger/waiting
              verdicts have no "pick one of two options" shape to offer */}
          {verdict.source === 'manual' && verdict.level === 'decision' && project.blocker && (
            <section className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 font-mono flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                  請選一個做法：
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
                    <strong>方案 A（建議）：</strong>跳過重複的資料，並列出一份清單讓你之後檢查。
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
                    <strong>方案 B：</strong>用新資料直接覆蓋舊的，以 Email 判斷是不是同一位客戶。
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                <button
                  onClick={() => setIsChatGPTModalOpen(true)}
                  className="px-3 py-2 text-xs font-mono bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Bot className="h-3.5 w-3.5 text-emerald-700" />
                  <span>請 AI 幫忙討論</span>
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
                  <span>送出決定，讓 AI 繼續</span>
                </button>
              </div>
            </section>
          )}

          {/* Technical detail toggle */}
          <button
            onClick={() => setShowTechDetail((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
          >
            <span>{showTechDetail ? '收合技術細節' : '顯示技術細節'}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTechDetail ? 'rotate-180' : ''}`} />
          </button>

          {showTechDetail && (
          <>
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

            {/* Production Live & Next Iteration Trigger Banner */}
            {project.currentGate === 'DONE' && (
              <div className="bg-emerald-50/70 border border-emerald-300 rounded-lg p-4 mt-2 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-950 font-mono">
                      🚀 Production 發布已完成，隨時可發起下一輪改版迭代 (New Iteration Run)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                    Live Baseline: {project.environment.production.version || 'v1.0.0'}
                  </span>
                </div>

                <p className="text-xs text-stone-600 leading-relaxed font-mono">
                  改版並非直接退回舊關卡，而是建立獨立新分支並依據需求型態自動分流至 <strong>Phase 1 (新架構 PRD)</strong> 或 <strong>Phase 2 (快速 Hotfix/維護)</strong>。
                </p>

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    onClick={() => onStartNewIteration?.(project.id, 'major')}
                    className="px-3 py-1.5 text-xs font-mono font-semibold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-md flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>發起重大改版 (走 Phase 1 對齊)</span>
                  </button>

                  <button
                    onClick={() => onStartNewIteration?.(project.id, 'hotfix')}
                    className="px-3 py-1.5 text-xs font-mono font-semibold bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-300 rounded-md flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-700" />
                    <span>緊急 Hotfix 修復 (直進 Phase 2 CI)</span>
                  </button>

                  <button
                    onClick={() => setIsCiCdModalOpen(true)}
                    className="px-2.5 py-1.5 text-xs font-mono text-stone-600 hover:text-stone-900 underline ml-auto cursor-pointer"
                  >
                    查看改版流程圖解說明 ➔
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 2: Bridge Workflow Lifecycle Visualization */}
          <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-stone-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                  2. Bridge ↔ CI/CD 8-Gate 流水線軌道
                </h3>
                <ProvenanceBadge provenance={project.provenance?.gate} />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCiCdModalOpen(true)}
                  className="text-xs font-mono text-sky-800 hover:text-sky-950 underline px-2 py-0.5 rounded hover:bg-sky-50 transition-colors cursor-pointer"
                >
                  🔗 查看 CI/CD 標準階段映射說明
                </button>
              </div>
            </div>

            {/* Workflow Rail */}
            <div className="bg-[#FAF9F6] p-4 rounded-xl border border-stone-200">
              <BridgeWorkflowRail
                gates={project.gates}
                currentGateId={project.currentGate}
                selectedGateId={selectedGate.id}
                onSelectGate={(gate) => setSelectedGateId(gate.id)}
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
                    onClick={() => {
                      setSelectedGateId(null);
                      onAdvanceToNextGate(project.id);
                    }}
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
                  <ProvenanceBadge provenance={project.provenance?.github} />
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

            {/* Environment Status & Version Tracking */}
            <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-stone-700" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                    4. 環境架構與版本改版監控 (Environments & Versioning)
                  </h3>
                  <ProvenanceBadge provenance={project.provenance?.environment} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-stone-500 bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
                    Dual-Track: Stage ➔ Prod
                  </span>
                </div>
              </div>

              {/* Version Evolution / Upgrade Pathway Banner */}
              <div className="bg-stone-50 p-3.5 rounded-lg border border-stone-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-stone-600 font-semibold flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-stone-700" />
                    版本改版流向 (Release Upgrade Path)
                  </span>
                  <span className="text-[11px] text-stone-500">
                    類型: <strong className="uppercase text-stone-800">{project.environment.releaseType || 'minor'} release</strong>
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 p-2.5 bg-white rounded border border-stone-200 text-xs font-mono">
                  {/* Step 1: Prod current */}
                  <div className="text-center flex-1">
                    <div className="text-[10px] text-stone-400">目前線上 (Prod)</div>
                    <div className="font-bold text-emerald-800 text-sm mt-0.5">
                      {project.environment.production.version || 'v0.0.0'}
                    </div>
                  </div>

                  <ArrowRight className="h-4 w-4 text-stone-400 shrink-0" />

                  {/* Step 2: Stage RC */}
                  <div className="text-center flex-1 bg-amber-50/70 p-1.5 rounded border border-amber-200">
                    <div className="text-[10px] text-amber-800 font-medium">預發測試 (Stage)</div>
                    <div className="font-bold text-amber-900 text-sm mt-0.5">
                      {project.environment.staging?.version || project.environment.uat?.version || 'v0.1.0-rc'}
                    </div>
                  </div>

                  <ArrowRight className="h-4 w-4 text-stone-400 shrink-0" />

                  {/* Step 3: Target Release */}
                  <div className="text-center flex-1">
                    <div className="text-[10px] text-stone-400">目標發布 (Target)</div>
                    <div className="font-bold text-stone-900 text-sm mt-0.5">
                      {project.environment.targetReleaseVersion || 'v1.0.0'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* 1. Production block */}
                <div className="bg-stone-50 p-3.5 rounded-lg border border-stone-200 space-y-2 text-xs font-mono flex flex-col justify-between">
                  <div className="space-y-2">
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
                        Production (正式生產環境)
                      </span>
                      <span
                        className={`text-[11px] font-bold px-1.5 py-0.2 rounded border ${
                          project.environment.production.status === 'Healthy' || project.environment.production.status === 'Live'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-stone-100 text-stone-600 border-stone-300'
                        }`}
                      >
                        {project.environment.production.version || '未發布'}
                      </span>
                    </div>

                    <div className="space-y-1 text-stone-500 text-[11px] pt-1">
                      <div className="flex items-center justify-between">
                        <span>環境狀態:</span>
                        <span className="text-stone-800 font-semibold">{project.environment.production.status}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>最近上線:</span>
                        <span className="text-stone-700">{project.environment.production.lastDeployed}</span>
                      </div>
                      {project.environment.production.metrics && (
                        <div className="flex items-center justify-between">
                          <span>即時指標:</span>
                          <span className="text-emerald-800 font-medium">
                            {project.environment.production.metrics.uptime} • {project.environment.production.metrics.p95Latency}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {project.environment.production.url ? (
                    <div className="pt-2 border-t border-stone-200">
                      <a
                        href={project.environment.production.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-emerald-800 bg-emerald-50 hover:bg-emerald-100 p-2 rounded border border-emerald-200 flex items-center justify-between transition-colors"
                      >
                        <span className="font-semibold truncate">{project.environment.production.url}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 ml-1" />
                      </a>
                    </div>
                  ) : (
                    <div className="pt-2 text-[11px] text-stone-400">尚未完成初次 Production 部署</div>
                  )}
                </div>

                {/* 2. Staging block */}
                {(() => {
                  const stg = project.environment.staging || project.environment.uat || {
                    status: 'Ready',
                    lastRefreshed: 'Just now',
                    version: 'v0.1.0-alpha',
                    branch: 'main',
                    url: 'https://staging.dev',
                  };
                  return (
                    <div className="bg-stone-50 p-3.5 rounded-lg border border-stone-200 space-y-2 text-xs font-mono flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-stone-900 flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                stg.status === 'Ready' || stg.status === 'Active'
                                  ? 'bg-amber-500'
                                  : stg.status === 'Not Deployed'
                                  ? 'bg-stone-400'
                                  : 'bg-rose-500'
                              }`}
                            />
                            Stage / UAT (預發測試環境)
                          </span>
                          <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-900 border border-amber-300">
                            {stg.version || 'v0.0.0-rc'}
                          </span>
                        </div>

                        <div className="space-y-1 text-stone-500 text-[11px] pt-1">
                          <div className="flex items-center justify-between">
                            <span>驗證狀態:</span>
                            <span className="text-amber-900 font-semibold">{stg.status} (Isolated Preview)</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>測試分支:</span>
                            <span className="text-stone-800 font-medium">{stg.branch || 'main'}</span>
                          </div>
                          {'commit' in stg && (stg as any).commit && (
                            <div className="flex items-center justify-between">
                              <span>Commit Hash:</span>
                              <span className="text-stone-700 bg-stone-200 px-1 py-0.2 rounded text-[10px]">
                                {(stg as any).commit}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span>最新刷新:</span>
                            <span className="text-stone-700">{stg.lastRefreshed}</span>
                          </div>
                        </div>
                      </div>

                      {stg.url ? (
                        <div className="pt-2 border-t border-stone-200 flex items-center gap-2">
                          <a
                            href={stg.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-amber-900 bg-amber-50 hover:bg-amber-100 p-2 rounded border border-amber-200 flex items-center justify-between transition-colors flex-1"
                          >
                            <span className="font-semibold truncate">預發測試網址</span>
                            <ExternalLink className="h-3 w-3 shrink-0 ml-1" />
                          </a>
                          <button
                            onClick={() => onAdvanceToNextGate(project.id)}
                            className="px-2.5 py-2 text-[11px] font-bold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded border border-stone-900 transition-colors cursor-pointer shadow-xs whitespace-nowrap"
                            title="驗證無誤後推進關卡或上線"
                          >
                            {project.currentGate === 'APPROVE'
                              ? '🚀 1-Click Promote'
                              : '推進關卡'}
                          </button>
                        </div>
                      ) : (
                        <div className="pt-2 text-[11px] text-stone-400">尚未啟用 Stage 測試環境</div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </section>
          </div>

          {/* SECTION 5: 功能交付與 Feature Flag 矩陣 (Feature Delivery Matrix & Selective Release) */}
          <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-stone-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                  5. 功能交付與 Feature Flag 矩陣 (Feature Delivery Matrix)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-stone-500 bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
                Selective Release & Flag Management
              </span>
            </div>

            <FeatureDeliveryMatrix
              project={project}
              onUpdateFeatures={(pId, updated) => onUpdateFeatures?.(pId, updated)}
              onConfirmSelectiveRelease={(pId, featIds, ver, notes) =>
                onConfirmSelectiveRelease?.(pId, featIds, ver, notes)
              }
              onShowToast={(msg) => onShowToast?.(msg)}
            />
          </section>

          {/* SECTION 6: Context Memory Timeline (Returning after days) */}
          <section className="bg-white border border-stone-300/90 rounded-xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-stone-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono">
                  6. Context Memory Timeline
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
          </>
          )}
        </div>

        {/* AI Advisor Modal */}
        <ChatGPTBridgeModal
          project={project}
          isOpen={isChatGPTModalOpen}
          onClose={() => setIsChatGPTModalOpen(false)}
        />

        {/* CI/CD Pipeline Mapping Modal */}
        <CiCdWorkflowModal
          isOpen={isCiCdModalOpen}
          onClose={() => setIsCiCdModalOpen(false)}
          currentProject={project}
        />
      </div>
    </div>
  );
};
