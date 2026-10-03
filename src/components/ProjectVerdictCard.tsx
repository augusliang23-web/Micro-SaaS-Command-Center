import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, HelpCircle, CheckCircle2, Clock, ChevronDown, ChevronRight, GitPullRequest, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { MicroSaaSProject, GithubPullStatus, GithubChangedFile, LocalGitStatus, ChangeSummaryRecord } from '../types';
import {
  getModelBadgeStyle,
  getGateStatusBadgeStyle,
  isRealGithubRepo,
  outcomeBadgeStyle,
  describeLocalStatus,
  localStatusToneStyle,
  formatChangeSummaryRef,
  summaryDisplayDate,
} from '../utils';
import { getVerdictStyle, formatRelativeTime } from '../verdict.mjs';
import { useProjectStatus } from '../hooks/useProjectVerdicts';
import { DeleteProjectModal } from './DeleteProjectModal';

const VERDICT_ICON: Record<string, React.ElementType> = {
  danger: AlertCircle,
  decision: HelpCircle,
  ready: CheckCircle2,
  waiting: Clock,
  idle: Clock,
  unknown: HelpCircle,
};

interface ProjectVerdictCardProps {
  project: MicroSaaSProject;
  isSelected: boolean;
  onSelect: () => void;
  /** Small label rendered above the card, e.g. "🎯 8 個專案中最需要你注意的" for a hero placement. */
  eyebrow?: string;
  onDelete?: (projectId: string) => void;
  onUpdateLocalPath?: (projectId: string, localPath: string) => void;
  onSaveChangeSummary?: (projectId: string, record: ChangeSummaryRecord) => void;
}

export const ProjectVerdictCard: React.FC<ProjectVerdictCardProps> = ({
  project,
  isSelected,
  onSelect,
  eyebrow,
  onDelete,
  onUpdateLocalPath,
  onSaveChangeSummary,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { verdict, githubState, isLoadingGithub, loadGithubState } = useProjectStatus(project);
  const [changedFiles, setChangedFiles] = useState<GithubChangedFile[] | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [localStatus, setLocalStatus] = useState<LocalGitStatus | null>(null);
  const [isLoadingLocalStatus, setIsLoadingLocalStatus] = useState(false);
  const [localStatusError, setLocalStatusError] = useState<string | null>(null);
  const [isEditingLocalPath, setIsEditingLocalPath] = useState(false);
  const [isFindingLocalPath, setIsFindingLocalPath] = useState(false);
  const [localPathInput, setLocalPathInput] = useState(project.localPath || '');
  const isLinkedToRealRepo = isRealGithubRepo(project.repository);

  const changeRef =
    githubState?.state === 'open' || githubState?.state === 'merged'
      ? { pr: githubState.prNumber }
      : githubState?.state === 'active' && githubState.lastCommitSha
      ? { sha: githubState.lastCommitSha }
      : null;

  const refKey = changeRef ? (changeRef.pr ? `pr:${changeRef.pr}` : `sha:${changeRef.sha}`) : null;
  const allSummaries = [...(project.changeSummaries || [])].sort(
    (a, b) => new Date(summaryDisplayDate(b)).getTime() - new Date(summaryDisplayDate(a)).getTime(),
  );
  const latestSummaryForRef = refKey ? allSummaries.find((r) => r.refKey === refKey) ?? null : null;

  useEffect(() => {
    if (!expanded || !changeRef || changedFiles !== null || isLoadingFiles) return;
    setIsLoadingFiles(true);
    const params = new URLSearchParams({ repo: project.repository });
    if (changeRef.pr) params.set('pr', String(changeRef.pr));
    if (changeRef.sha) params.set('sha', changeRef.sha);
    fetch(`/api/github/changed-files?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setChangedFiles(data?.files ?? []))
      .catch(() => setChangedFiles([]))
      .finally(() => setIsLoadingFiles(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, changeRef?.pr, changeRef?.sha]);

  const handleSummarizeChanges = useCallback(() => {
    if (!changeRef || !refKey) return;
    setIsSummarizing(true);
    setSummaryError(null);
    fetch('/api/bridge/summarize-changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: project.repository,
        prNumber: changeRef.pr,
        sha: changeRef.sha,
        localPath: project.localPath || undefined,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || '摘要失敗');
        onSaveChangeSummary?.(project.id, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          refKey,
          summary: data.summary,
          provider: data.provider,
          fileCount: data.fileCount ?? 0,
          includedLocalDiff: !!data.includedLocalDiff,
          generatedAt: new Date().toISOString(),
          commitDate:
            githubState?.state === 'active'
              ? githubState.lastCommitAt
              : githubState?.state === 'merged'
              ? githubState.mergedAt
              : undefined,
        });
      })
      .catch((err) => setSummaryError(err instanceof Error ? err.message : '摘要失敗'))
      .finally(() => setIsSummarizing(false));
  }, [changeRef, refKey, project.repository, project.id, project.localPath, githubState, onSaveChangeSummary]);

  useEffect(() => {
    if (!expanded || !project.localPath || isEditingLocalPath) return;
    if (localStatus !== null || localStatusError !== null || isLoadingLocalStatus) return;
    setIsLoadingLocalStatus(true);
    fetch(`/api/local-git/status?path=${encodeURIComponent(project.localPath)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || '無法讀取本機狀態');
        setLocalStatus(data);
      })
      .catch((err) => setLocalStatusError(err instanceof Error ? err.message : '無法讀取本機狀態'))
      .finally(() => setIsLoadingLocalStatus(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, project.localPath, isEditingLocalPath]);

  const handleSaveLocalPath = () => {
    const trimmed = localPathInput.trim();
    if (!trimmed) return;
    onUpdateLocalPath?.(project.id, trimmed);
    setIsEditingLocalPath(false);
    setLocalStatus(null);
    setLocalStatusError(null);
  };

  const handleAutoFindLocalPath = () => {
    setIsFindingLocalPath(true);
    fetch(`/api/local-git/find?repo=${encodeURIComponent(project.repository)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.localPath) setLocalPathInput(data.localPath);
      })
      .catch(() => {})
      .finally(() => setIsFindingLocalPath(false));
  };

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
    <article aria-label={project.name} data-status={verdict.status}>
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
          <p className="text-xs text-stone-500 mt-2">GitHub · {verdict.sourceState} · Last checked: {verdict.checkedAt ? new Date(verdict.checkedAt).toLocaleString() : '尚未查詢'}</p>
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

          {onDelete && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              title="刪除這個專案"
              className="text-stone-300 hover:text-rose-600 transition-colors cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
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
                {verdict.source === 'github' ? `— GitHub 查詢快照：${verdict.sourceState}` : '— 底層工程狀態，一般不用看'}
              </span>
            </div>

            {verdict.source === 'github' && githubState && githubState.state !== 'none' && (
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
              </div>
            )}
            {verdict.source === 'github' &&
              githubState &&
              githubState.state !== 'none' &&
              (onUpdateLocalPath || project.localPath) && (
                <div className="mt-3 pt-3 border-t border-dashed border-stone-200 font-sans">
                  <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1.5">本機狀態</div>
                  {!project.localPath || isEditingLocalPath ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        value={localPathInput}
                        onChange={(e) => setLocalPathInput(e.target.value)}
                        placeholder="這個專案在你電腦上的資料夾路徑"
                        className="text-[11px] px-2 py-1 rounded border border-stone-300 flex-1 min-w-[220px] font-mono"
                      />
                      <button
                        onClick={handleAutoFindLocalPath}
                        disabled={isFindingLocalPath}
                        className="text-[11px] px-2.5 py-1 rounded border border-stone-300 text-stone-600 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isFindingLocalPath ? '尋找中…' : '自動尋找'}
                      </button>
                      <button
                        onClick={handleSaveLocalPath}
                        disabled={!localPathInput.trim()}
                        className="text-[11px] px-2.5 py-1 rounded bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        儲存
                      </button>
                      {project.localPath && (
                        <button
                          onClick={() => {
                            setIsEditingLocalPath(false);
                            setLocalPathInput(project.localPath || '');
                          }}
                          className="text-[11px] text-stone-400 hover:text-stone-700 cursor-pointer"
                        >
                          取消
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      {isLoadingLocalStatus && <span className="text-[11px] text-stone-400">讀取中…</span>}
                      {!isLoadingLocalStatus && localStatusError && (
                        <span className="text-[11px] px-2 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200">
                          {localStatusError}
                        </span>
                      )}
                      {!isLoadingLocalStatus &&
                        !localStatusError &&
                        localStatus &&
                        (() => {
                          const { text, tone } = describeLocalStatus(localStatus);
                          const toneStyle = localStatusToneStyle(tone);
                          return (
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded border ${toneStyle.bg} ${toneStyle.text} ${toneStyle.border}`}
                            >
                              {text}
                            </span>
                          );
                        })()}
                      {onUpdateLocalPath && (
                        <button
                          onClick={() => setIsEditingLocalPath(true)}
                          className="text-[11px] text-stone-400 hover:text-stone-700 underline cursor-pointer"
                        >
                          修改路徑
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            {verdict.source === 'github' && githubState && githubState.state !== 'none' && changeRef && (
              <div className="mt-3 pt-3 border-t border-dashed border-stone-200 font-sans">
                <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1.5">與前一版本相比的改動</div>
                {isLoadingFiles && <div className="text-[11px] text-stone-400">讀取中…</div>}
                {!isLoadingFiles && changedFiles && changedFiles.length === 0 && (
                  <div className="text-[11px] text-stone-400">查無檔案變更資訊</div>
                )}
                {!isLoadingFiles && changedFiles && changedFiles.length > 0 && (
                  <ul className="space-y-1">
                    {changedFiles.map((f) => (
                      <li key={f.filename} className="flex items-center gap-2 text-[11px]">
                        <span className="text-stone-700 truncate" title={f.filename}>
                          {f.filename}
                        </span>
                        <span className="shrink-0 text-emerald-700">+{f.additions}</span>
                        <span className="shrink-0 text-rose-700">-{f.deletions}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  onClick={handleSummarizeChanges}
                  disabled={isSummarizing || !changedFiles || changedFiles.length === 0}
                  className="mt-2.5 flex items-center gap-1.5 text-[11px] font-bold text-stone-600 hover:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Sparkles className="h-3 w-3" />
                  {isSummarizing ? 'AI 摘要中…' : latestSummaryForRef ? '重新產生摘要' : '請 AI 摘要這次修改（含本機差異）'}
                </button>
                {summaryError && <div className="mt-1.5 text-[11px] text-rose-700">{summaryError}</div>}
                {latestSummaryForRef && (
                  <div className="mt-2.5 text-[12px] text-stone-700 leading-relaxed bg-stone-50 border border-stone-200 rounded-lg p-3 whitespace-pre-wrap">
                    <p className="text-xs text-stone-500 mb-2">AI 歷史摘要（非檢查或部署結果）</p>
                    {latestSummaryForRef.summary}
                    <div className="mt-2 text-[10px] text-stone-400 not-italic">
                      更新於 {formatRelativeTime(summaryDisplayDate(latestSummaryForRef))}
                      {latestSummaryForRef.includedLocalDiff ? '，已包含本機差異' : ''}
                    </div>
                  </div>
                )}
                {allSummaries.filter((r) => r.id !== latestSummaryForRef?.id).length > 0 && (
                  <div className="mt-2.5">
                    <button
                      onClick={() => setShowHistory((v) => !v)}
                      className="text-[11px] text-stone-400 hover:text-stone-700 underline cursor-pointer"
                    >
                      {showHistory ? '收起歷史摘要記錄' : `查看歷史摘要記錄（${allSummaries.filter((r) => r.id !== latestSummaryForRef?.id).length}）`}
                    </button>
                    {showHistory && (
                      <ul className="mt-2 space-y-2">
                        {allSummaries
                          .filter((r) => r.id !== latestSummaryForRef?.id)
                          .map((r) => (
                            <li
                              key={r.id}
                              className="text-[12px] text-stone-600 leading-relaxed bg-stone-50 border border-stone-200 rounded-lg p-3 whitespace-pre-wrap"
                            >
                              <div className="text-[10px] text-stone-400 mb-1">
                                {formatChangeSummaryRef(r.refKey)}
                                {' · '}
                                {formatRelativeTime(summaryDisplayDate(r))}
                                {r.includedLocalDiff ? '，已包含本機差異' : ''}
                              </div>
                              {r.summary}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
            {!(verdict.source === 'github' && githubState && githubState.state !== 'none') && (
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[11px] px-2 py-0.5 rounded border ${gateStyle.bg} ${gateStyle.text} ${gateStyle.border}`}
                >
                  保存資料（非最新證據） Gate: {project.currentGate}
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
      {onDelete && (
        <DeleteProjectModal
          project={project}
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirmDelete={onDelete}
        />
      )}
    </article>
  );
};
