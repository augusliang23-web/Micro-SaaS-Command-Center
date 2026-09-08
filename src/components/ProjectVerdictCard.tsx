import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, HelpCircle, CheckCircle2, Clock, ChevronDown, ChevronRight, GitPullRequest, RefreshCw } from 'lucide-react';
import { MicroSaaSProject, GithubPullStatus } from '../types';
import { getModelBadgeStyle, getGateStatusBadgeStyle, isRealGithubRepo, outcomeBadgeStyle } from '../utils';
import { getVerdict, getVerdictStyle } from '../verdict.mjs';

const VERDICT_ICON: Record<string, React.ElementType> = {
  danger: AlertCircle,
  decision: HelpCircle,
  ready: CheckCircle2,
  waiting: Clock,
};

interface ProjectVerdictCardProps {
  project: MicroSaaSProject;
  isSelected: boolean;
  onSelect: () => void;
  /** Small label rendered above the card, e.g. "🎯 8 個專案中最需要你注意的" for a hero placement. */
  eyebrow?: string;
}

export const ProjectVerdictCard: React.FC<ProjectVerdictCardProps> = ({ project, isSelected, onSelect, eyebrow }) => {
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
    <div>
      {eyebrow && (
        <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-stone-500">{eyebrow}</div>
      )}
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
    </div>
  );
};
