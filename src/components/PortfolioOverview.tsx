import React, { useCallback, useEffect, useState } from 'react';
import {
  Layers,
  ArrowUpDown,
  Plus,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  Clock,
  GitPullRequest,
  RefreshCw,
} from 'lucide-react';
import { MicroSaaSProject, ProjectHealth } from '../types';
import { getModelBadgeStyle, getGateStatusBadgeStyle } from '../utils';
import { getVerdict, getVerdictStyle } from '../verdict.mjs';

interface PortfolioOverviewProps {
  projects: MicroSaaSProject[];
  selectedProjectId: string | null;
  onSelectProject: (project: MicroSaaSProject) => void;
  onOpenConnectRepo?: () => void;
}

const VERDICT_ICON: Record<string, React.ElementType> = {
  danger: AlertCircle,
  decision: HelpCircle,
  ready: CheckCircle2,
  waiting: Clock,
};

// Only real ConnectRepoModal-picked repos look like "owner/name"; the
// built-in fixture projects use a "github.com/my-org/..." placeholder and
// have no real repo behind them to fetch PR/CI status for.
function isRealGithubRepo(repository: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repository);
}

interface GithubPullStatus {
  state: 'open' | 'merged' | 'active' | 'none';
  prNumber?: number;
  prUrl?: string;
  isDraft?: boolean;
  ciStatus?: 'passing' | 'failing' | 'running' | 'none';
  reviewDecision?: 'approved' | 'changes_requested' | 'review_required';
  lastCommitMessage?: string;
  lastCommitAt?: string;
  lastCommitUrl?: string;
}

function outcomeBadgeStyle(outcome: string): { bg: string; text: string; border: string } {
  switch (outcome) {
    case 'PASS':
    case 'APPROVED':
      return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' };
    case 'RUNNING':
    case 'IN_REVIEW':
      return { bg: 'bg-sky-50', text: 'text-sky-900', border: 'border-sky-200' };
    case 'FAIL':
    case 'CHANGES_REQUIRED':
      return { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-200' };
    default:
      return { bg: 'bg-stone-100', text: 'text-stone-500', border: 'border-stone-200' };
  }
}

interface ProjectVerdictCardProps {
  project: MicroSaaSProject;
  isSelected: boolean;
  onSelect: () => void;
}

const ProjectVerdictCard: React.FC<ProjectVerdictCardProps> = ({ project, isSelected, onSelect }) => {
  const [expanded, setExpanded] = useState(false);
  const [githubState, setGithubState] = useState<GithubPullStatus | null>(null);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const isLinkedToRealRepo = isRealGithubRepo(project.repository);

  const loadGithubState = useCallback(() => {
    if (!isLinkedToRealRepo) return;
    setIsLoadingGithub(true);
    fetch(`/api/github/pull-status?repo=${encodeURIComponent(project.repository)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGithubState(data))
      .catch(() => setGithubState(null))
      .finally(() => setIsLoadingGithub(false));
  }, [isLinkedToRealRepo, project.repository]);

  useEffect(() => {
    loadGithubState();
  }, [loadGithubState]);

  const verdict = getVerdict(project, githubState ?? undefined);
  const style = getVerdictStyle(verdict.level);
  const Icon = VERDICT_ICON[verdict.level];
  const modelStyle = getModelBadgeStyle(project.model);
  const gateStyle = getGateStatusBadgeStyle(
    project.gates.find((g) => g.id === project.currentGate)?.status || 'PENDING'
  );
  const testStyle = outcomeBadgeStyle(project.testOutcome);
  const reviewStyle = outcomeBadgeStyle(project.reviewOutcome);
  const prRef = project.executionContext.githubPR || project.executionContext.githubIssue;
  const githubCiStyle = outcomeBadgeStyle(
    githubState?.ciStatus === 'passing' ? 'PASS' : githubState?.ciStatus === 'failing' ? 'FAIL' : githubState?.ciStatus === 'running' ? 'RUNNING' : ''
  );
  const githubReviewStyle = outcomeBadgeStyle(
    githubState?.reviewDecision === 'approved'
      ? 'APPROVED'
      : githubState?.reviewDecision === 'changes_requested'
      ? 'CHANGES_REQUIRED'
      : ''
  );

  return (
    <div
      className={`bg-white rounded-2xl border p-5 transition-all ${
        isSelected ? 'border-stone-800 shadow-xs' : 'border-stone-200 hover:border-stone-300'
      }`}
      style={{ borderColor: isSelected ? undefined : style.borderColor }}
    >
      {/* Identity row */}
      <div className="flex items-start gap-3.5">
        <div
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: style.iconBg, color: style.iconColor }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-bold text-sm text-stone-900">{project.name}</span>
            <span className="text-xs text-stone-400 truncate">{project.tagline}</span>
          </div>
        </div>
      </div>

      {/* Verdict headline + explanation */}
      <div className="mt-3.5">
        <div className="text-base font-bold leading-snug" style={{ color: style.headlineColor }}>
          {verdict.headline}
        </div>
        <p className="text-sm text-stone-700 leading-relaxed mt-1.5">{verdict.explanation}</p>
      </div>

      {/* Action row */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {verdict.hasAction && (
          <button
            onClick={onSelect}
            className="px-4 py-2 text-sm font-bold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-lg transition-colors cursor-pointer"
          >
            {verdict.actionLabel}
          </button>
        )}
        {verdict.isWaiting && (
          <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3.5 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-pulse" />
            <span className="text-xs font-bold text-sky-900">{verdict.actionLabel}</span>
          </div>
        )}

        {isLinkedToRealRepo && (
          <button
            onClick={loadGithubState}
            disabled={isLoadingGithub}
            title="重新查詢 GitHub 最新狀態"
            className="text-stone-300 hover:text-stone-600 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingGithub ? 'animate-spin' : ''}`} />
          </button>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto flex items-center gap-1 text-xs text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
        >
          <span>{expanded ? '收合技術細節' : '技術細節'}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Expandable technical detail — everything the previous jargon-forward view showed */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-dashed border-stone-200 font-mono">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] text-stone-400 uppercase tracking-wider">技術細節</span>
            <span className="text-[9px] text-stone-300">
              {verdict.source === 'github' ? '— 即時查詢 GitHub 得到的真實狀態' : '— 底層工程狀態，一般不用看'}
            </span>
          </div>

          {verdict.source === 'github' && githubState && githubState.state !== 'none' ? (
            <div className="flex items-center gap-2 flex-wrap">
              {githubState.state === 'active' ? (
                <>
                  <span className="text-[11px] px-2 py-0.5 rounded border bg-stone-100 text-stone-700 border-stone-300">
                    直接推送到主分支（非 PR）
                  </span>
                  {githubState.lastCommitUrl && (
                    <a
                      href={githubState.lastCommitUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded border bg-sky-50 text-sky-900 border-sky-200 hover:bg-sky-100 max-w-[220px] truncate"
                      title={githubState.lastCommitMessage}
                    >
                      {githubState.lastCommitMessage}
                    </a>
                  )}
                  <span className={`text-[11px] px-2 py-0.5 rounded border ${githubCiStyle.bg} ${githubCiStyle.text} ${githubCiStyle.border}`}>
                    CI: {githubState.ciStatus === 'none' ? '尚無自動檢查' : githubState.ciStatus}
                  </span>
                </>
              ) : (
                <>
                  {githubState.prUrl && (
                    <a
                      href={githubState.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded border bg-sky-50 text-sky-900 border-sky-200 flex items-center gap-1 hover:bg-sky-100"
                    >
                      <GitPullRequest className="h-3 w-3" />
                      PR #{githubState.prNumber}
                    </a>
                  )}
                  <span className="text-[11px] px-2 py-0.5 rounded border bg-stone-100 text-stone-700 border-stone-300">
                    {githubState.state === 'merged' ? '已合併' : githubState.isDraft ? '草稿中' : '開發中'}
                  </span>
                  {githubState.state === 'open' && (
                    <>
                      <span className={`text-[11px] px-2 py-0.5 rounded border ${githubCiStyle.bg} ${githubCiStyle.text} ${githubCiStyle.border}`}>
                        CI: {githubState.ciStatus === 'none' ? '尚無自動檢查' : githubState.ciStatus}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded border ${githubReviewStyle.bg} ${githubReviewStyle.text} ${githubReviewStyle.border}`}>
                        Review: {githubState.reviewDecision || 'review_required'}
                      </span>
                    </>
                  )}
                </>
              )}
              <span
                className="text-[11px] px-2 py-0.5 rounded border"
                style={{ backgroundColor: modelStyle.bg, color: modelStyle.accent, borderColor: modelStyle.border }}
              >
                Model: {project.model}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[11px] px-2 py-0.5 rounded border ${gateStyle.bg} ${gateStyle.text} ${gateStyle.border}`}
              >
                Gate: {project.currentGate}
              </span>
              {prRef && (
                <span className="text-[11px] px-2 py-0.5 rounded border bg-sky-50 text-sky-900 border-sky-200 flex items-center gap-1">
                  <GitPullRequest className="h-3 w-3" />
                  {prRef}
                </span>
              )}
              <span
                className={`text-[11px] px-2 py-0.5 rounded border ${testStyle.bg} ${testStyle.text} ${testStyle.border}`}
              >
                Test: {project.testOutcome}
              </span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded border ${reviewStyle.bg} ${reviewStyle.text} ${reviewStyle.border}`}
              >
                Review: {project.reviewOutcome}
              </span>
              <span
                className="text-[11px] px-2 py-0.5 rounded border"
                style={{ backgroundColor: modelStyle.bg, color: modelStyle.accent, borderColor: modelStyle.border }}
              >
                Model: {project.model}
              </span>
            </div>
          )}
          <button
            onClick={onSelect}
            className="mt-3 text-[11px] text-stone-500 hover:text-stone-800 underline flex items-center gap-0.5 cursor-pointer"
          >
            開啟完整專案詳情 <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
};

export const PortfolioOverview: React.FC<PortfolioOverviewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenConnectRepo,
}) => {
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [healthFilter, setHealthFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'activity' | 'health' | 'name'>('activity');

  const filteredProjects = projects
    .filter((p) => {
      if (stageFilter !== 'ALL' && p.stage !== stageFilter) return false;
      if (healthFilter !== 'ALL' && p.health !== healthFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'health') {
        const order: Record<ProjectHealth, number> = { Blocked: 0, 'At Risk': 1, Attention: 2, Healthy: 3 };
        return order[a.health] - order[b.health];
      }
      return 0; // default order
    });

  return (
    <section className="bg-white border border-stone-300 rounded-xl overflow-hidden shadow-xs">
      {/* Header & Controls */}
      <div className="p-4 sm:p-5 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF9F6]">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-stone-700" />
            <h2 className="text-sm font-semibold text-stone-900 font-mono uppercase tracking-wider">
              專案總覽
            </h2>
            <span className="text-xs font-mono text-stone-600 bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
              {filteredProjects.length} 個專案
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            每個專案一句話告訴你現在該做什麼；不需要懂技術，AI 已經幫你判斷好了。
          </p>
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <span className="text-stone-500">階段:</span>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">全部階段</option>
              <option value="Prototype">Prototype</option>
              <option value="Alpha">Alpha</option>
              <option value="Beta">Beta</option>
              <option value="Production">Production</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <span className="text-stone-500">狀態:</span>
            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">全部狀態</option>
              <option value="Attention">需關注</option>
              <option value="Blocked">已阻礙</option>
              <option value="At Risk">有風險</option>
              <option value="Healthy">正常</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <ArrowUpDown className="h-3 w-3 text-stone-400" />
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="activity">依活動排序</option>
              <option value="health">依緊急程度排序</option>
              <option value="name">依名稱排序</option>
            </select>
          </div>

          {onOpenConnectRepo && (
            <button
              onClick={onOpenConnectRepo}
              className="px-2.5 py-1 text-xs font-mono font-medium rounded bg-stone-900 text-stone-50 hover:bg-stone-800 flex items-center gap-1 transition-colors shadow-xs cursor-pointer ml-1"
            >
              <Plus className="h-3 w-3" />
              <span>+ 接入新專案</span>
            </button>
          )}
        </div>
      </div>

      {/* Verdict card list */}
      <div className="p-4 sm:p-5 flex flex-col gap-4">
        {filteredProjects.map((project) => (
          <ProjectVerdictCard
            key={project.id}
            project={project}
            isSelected={selectedProjectId === project.id}
            onSelect={() => onSelectProject(project)}
          />
        ))}
      </div>
    </section>
  );
};
