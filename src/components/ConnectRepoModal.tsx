import React, { useCallback, useEffect, useState } from 'react';
import {
  Github,
  X,
  Search,
  Check,
  Plus,
  GitBranch,
  ShieldCheck,
  Zap,
  ShieldAlert,
  Layers,
  Sparkles,
  ExternalLink,
  Lock,
  Globe,
  Radio,
  ArrowRight,
  Code2,
  Workflow,
  Cpu,
} from 'lucide-react';
import {
  MicroSaaSProject,
  ProjectStage,
  CodexModelName,
  ReasoningEffort,
  BridgeGateId,
} from '../types';
import { projectProvenance } from '../mockData';

export interface UnconnectedGitHubRepo {
  id: string;
  name: string;
  fullName: string;
  description: string;
  isPrivate: boolean;
  language: string;
  defaultBranch: string;
  stars: number;
  lastPushed: string;
}

interface ConnectRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRepoNames: string[];
  onConnectRepo: (newProject: MicroSaaSProject) => void;
}

export const ConnectRepoModal: React.FC<ConnectRepoModalProps> = ({
  isOpen,
  onClose,
  existingRepoNames,
  onConnectRepo,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<UnconnectedGitHubRepo | null>(null);
  const [stage, setStage] = useState<ProjectStage>('Prototype');
  const [customTagline, setCustomTagline] = useState('');
  const [initialGate, setInitialGate] = useState<BridgeGateId>('DISCUSS');
  const [isManualInput, setIsManualInput] = useState(false);
  const [manualRepoName, setManualRepoName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [repos, setRepos] = useState<UnconnectedGitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoLoadError, setRepoLoadError] = useState<string | null>(null);

  const loadRepos = useCallback(() => {
    setIsLoadingRepos(true);
    setRepoLoadError(null);
    fetch('/api/github/repos')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `無法載入 GitHub 倉庫（HTTP ${res.status}）。`);
        }
        return res.json();
      })
      .then((data) => {
        setRepos(Array.isArray(data.repos) ? data.repos : []);
      })
      .catch((error: unknown) => {
        setRepoLoadError(error instanceof Error ? error.message : '無法載入 GitHub 倉庫。');
      })
      .finally(() => {
        setIsLoadingRepos(false);
      });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadRepos();
  }, [isOpen, loadRepos]);

  if (!isOpen) return null;

  // Filter out repos that are already added
  const availableRepos = repos.filter(
    (repo) =>
      !existingRepoNames.some(
        (existing) =>
          existing.toLowerCase() === repo.name.toLowerCase() ||
          existing.toLowerCase() === repo.fullName.toLowerCase()
      )
  );

  const filteredRepos = availableRepos.filter((repo) => {
    const q = searchQuery.toLowerCase();
    return (
      repo.name.toLowerCase().includes(q) ||
      repo.fullName.toLowerCase().includes(q) ||
      repo.description.toLowerCase().includes(q) ||
      repo.language.toLowerCase().includes(q)
    );
  });

  const handleSelectRepo = (repo: UnconnectedGitHubRepo) => {
    setSelectedRepo(repo);
    setIsManualInput(false);
    setCustomTagline(repo.description);
  };

  const handleSwitchToManual = () => {
    setSelectedRepo(null);
    setIsManualInput(true);
  };

  const handleConfirmConnect = () => {
    let repoFullName = '';
    let repoName = '';
    let description = '';
    let language = 'TypeScript';
    let branch = 'main';

    if (isManualInput) {
      if (!manualRepoName.trim()) return;
      repoFullName = manualRepoName.includes('/') ? manualRepoName.trim() : `augusliang23/${manualRepoName.trim()}`;
      repoName = repoFullName.split('/')[1] || repoFullName;
      description = manualDescription.trim() || 'Connected micro-SaaS repository monitored by Bridge.';
    } else if (selectedRepo) {
      repoFullName = selectedRepo.fullName;
      repoName = selectedRepo.name;
      description = customTagline || selectedRepo.description;
      language = selectedRepo.language;
      branch = selectedRepo.defaultBranch;
    } else {
      return;
    }

    // Default to dynamic routing with initial gate assignment
    const newProject: MicroSaaSProject = {
      id: `proj-${repoName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`,
      name: repoName
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      tagline: description,
      stage: stage,
      health: 'Healthy',
      workflowType: 'standard',
      currentTask: 'Initial Bridge Repository Onboarding & Architecture Spec',
      nextAction: 'Review Bridge context spec and start initial discussion gate',
      blocker: null,
      waitingState: 'WAITING_FOR_HUMAN',
      currentGate: initialGate,
      currentGateLabel:
        initialGate === 'DISCUSS'
          ? 'Discussion & Spec'
          : initialGate === 'SPECIFY'
          ? 'Technical PRD'
          : initialGate === 'ROUTE'
          ? 'Model Routing'
          : 'Implementation',
      testOutcome: 'PENDING',
      reviewOutcome: 'PENDING',
      model: 'Terra', // Dynamic initial default, auto-routes per task
      reasoningEffort: 'Medium',
      routingReason: `Dynamic Model Routing Active: Auto-routes each task to Luna, Terra, or Sol based on task blast radius.`,
      repository: repoFullName,
      lastActivity: 'Just now',
      tags: [language, stage, 'GitHub App', 'Dynamic Routing'],
      gates: [
        {
          id: 'DISCUSS',
          label: 'Discussion & Alignment',
          shortLabel: 'DISCUSS',
          status: initialGate === 'DISCUSS' ? 'CURRENT' : 'COMPLETED',
          detail: 'Initial product goal alignment and AI advisor context established.',
          timestamp: 'Just now',
        },
        {
          id: 'SPECIFY',
          label: 'Technical PRD & Schema',
          shortLabel: 'SPECIFY',
          status: initialGate === 'SPECIFY' ? 'CURRENT' : 'PENDING',
          detail: 'Architecture spec, data contract, and safety test plan.',
        },
        {
          id: 'ROUTE',
          label: 'Dynamic Model Routing',
          shortLabel: 'ROUTE',
          status: initialGate === 'ROUTE' ? 'CURRENT' : 'PENDING',
          detail: `Automated model tiering (Luna / Terra / Sol) according to per-task impact analysis.`,
        },
        {
          id: 'IMPLEMENT',
          label: 'Autonomous Implementation',
          shortLabel: 'IMPLEMENT',
          status: initialGate === 'IMPLEMENT' ? 'CURRENT' : 'PENDING',
          detail: 'AI agent autonomous code generation and branch execution.',
        },
        {
          id: 'TEST',
          label: 'Automated Test Suite',
          shortLabel: 'TEST',
          status: 'PENDING',
          testOutcome: 'PENDING',
          detail: 'Regression tests, linting, and security scan.',
        },
        {
          id: 'REVIEW',
          label: 'Independent Code Review',
          shortLabel: 'REVIEW',
          status: 'PENDING',
          reviewOutcome: 'PENDING',
          detail: 'Secondary independent AI safety & code review.',
        },
        {
          id: 'APPROVE',
          label: 'Human-in-the-loop Signoff',
          shortLabel: 'APPROVE',
          status: 'PENDING',
          detail: 'Human operator 1-click merge and deployment gate.',
        },
        {
          id: 'DONE',
          label: 'Released to Environment',
          shortLabel: 'DONE',
          status: 'PENDING',
          detail: 'Artifact pushed to production/UAT staging.',
        },
      ],
      environment: {
        production: {
          status: 'Not Deployed',
          lastDeployed: 'Pending initial release',
        },
        staging: {
          status: 'Not Deployed',
          lastRefreshed: 'Not yet connected',
          branch: branch,
        },
        uat: {
          status: 'Not Deployed',
          lastRefreshed: 'Not yet connected',
          branch: branch,
        },
        targetReleaseVersion: 'v0.1.0',
        releaseType: 'major',
      },
      executionContext: {
        githubPR: 'None yet',
        branch: branch,
        model: 'Terra',
        reasoningEffort: 'Medium',
        risk: 'Medium',
        routingReason: `Local Prototype shell created; no task has been dispatched yet.`,
        bridgeRunId: `local-sim-${Math.floor(1000 + Math.random() * 9000)}`,
      },
      provenance: projectProvenance(`proj-${repoName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`),
      activityHistory: [
        {
          id: `act-init-${Date.now()}`,
          timestamp: 'Just now',
          author: 'Human (You)',
          action: 'Repository Connected',
          detail: `Connected GitHub repository ${repoFullName} to Micro-SaaS Command Center with dynamic model routing.`,
          gate: initialGate,
        },
      ],
    };

    onConnectRepo(newProject);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-3xl bg-[#F7F6F2] border border-stone-300 rounded-xl shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[90vh] text-stone-800">
        {/* Modal Header */}
        <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-stone-900 text-stone-50">
              <Github className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-stone-900 font-mono uppercase tracking-wider">
                  接入 GitHub 倉庫（Connect Repository）
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300">
                  倉庫清單：即時 GitHub 資料
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                從您的 GitHub 帳號中選擇尚未納入監控的 Micro-SaaS 倉庫。接入後產生的 8-Gate Bridge 工作流卡片是本地模擬狀態，尚未與該倉庫的真實 Issue / PR / CI 連動。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs font-mono">
          {/* Step 1: Select Repo Source */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
                <span>1. 選擇 GitHub 倉庫</span>
                <span className="text-stone-500 text-[11px] font-normal">
                  ({isLoadingRepos ? '載入中...' : `${availableRepos.length} 個倉庫尚未接入`})
                </span>
              </label>
              <button
                type="button"
                onClick={() => (isManualInput ? setIsManualInput(false) : handleSwitchToManual())}
                className="text-stone-600 hover:text-stone-900 underline text-[11px] cursor-pointer"
              >
                {isManualInput ? '← 返回倉庫列表' : '+ 手動輸入其他 Repository URL'}
              </button>
            </div>

            {isManualInput ? (
              <div className="bg-white border border-stone-300 rounded-lg p-4 space-y-3 shadow-xs">
                <div>
                  <label className="text-stone-700 block mb-1 font-semibold">
                    GitHub Repository (owner/repo):
                  </label>
                  <input
                    type="text"
                    value={manualRepoName}
                    onChange={(e) => setManualRepoName(e.target.value)}
                    placeholder="e.g. augusliang23/my-new-saas-tool"
                    className="w-full bg-stone-50 border border-stone-300 rounded px-3 py-2 text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-600 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-stone-700 block mb-1 font-semibold">
                    專案簡述 / Tagline:
                  </label>
                  <input
                    type="text"
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    placeholder="e.g. AI-powered customer churn detection agent"
                    className="w-full bg-stone-50 border border-stone-300 rounded px-3 py-2 text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-600 text-xs font-mono"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Search in user repos */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜尋您的 GitHub Repositories (名稱、語言、說明)..."
                    className="w-full pl-8 pr-3 py-2 bg-white border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-600 text-xs shadow-xs"
                  />
                </div>

                {/* Repo List */}
                {isLoadingRepos && (
                  <div className="text-center py-6 border border-dashed border-stone-300 rounded-lg bg-white text-stone-500">
                    正在從 GitHub 讀取您的倉庫...
                  </div>
                )}

                {!isLoadingRepos && repoLoadError && (
                  <div className="text-center py-6 border border-dashed border-red-300 rounded-lg bg-red-50 text-red-700 space-y-2 px-4">
                    <p>{repoLoadError}</p>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={loadRepos}
                        className="underline hover:text-red-900 cursor-pointer font-semibold"
                      >
                        重試
                      </button>
                      <button
                        type="button"
                        onClick={handleSwitchToManual}
                        className="underline hover:text-red-900 cursor-pointer font-semibold"
                      >
                        改為手動輸入
                      </button>
                    </div>
                  </div>
                )}

                {!isLoadingRepos && !repoLoadError && (
                <div className="grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto pr-1">
                  {filteredRepos.map((repo) => {
                    const isSelected = selectedRepo?.id === repo.id;
                    return (
                      <div
                        key={repo.id}
                        onClick={() => handleSelectRepo(repo)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                          isSelected
                            ? 'bg-stone-900 text-stone-50 border-stone-900 shadow-xs'
                            : 'bg-white text-stone-800 border-stone-200 hover:border-stone-400'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold font-mono text-xs truncate">
                              {repo.fullName}
                            </span>
                            {repo.isPrivate ? (
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded border flex items-center gap-1 ${
                                  isSelected
                                    ? 'bg-stone-800 text-stone-300 border-stone-700'
                                    : 'bg-stone-100 text-stone-600 border-stone-200'
                                }`}
                              >
                                <Lock className="h-2.5 w-2.5" /> Private
                              </span>
                            ) : (
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded border flex items-center gap-1 ${
                                  isSelected
                                    ? 'bg-stone-800 text-stone-300 border-stone-700'
                                    : 'bg-stone-100 text-stone-600 border-stone-200'
                                }`}
                              >
                                <Globe className="h-2.5 w-2.5" /> Public
                              </span>
                            )}
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded ${
                                isSelected
                                  ? 'bg-stone-800 text-stone-300'
                                  : 'bg-stone-100 text-stone-600'
                              }`}
                            >
                              {repo.language}
                            </span>
                          </div>
                          <p
                            className={`text-[11px] line-clamp-1 ${
                              isSelected ? 'text-stone-300' : 'text-stone-500'
                            }`}
                          >
                            {repo.description}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded border font-mono flex items-center gap-1 ${
                              isSelected
                                ? 'bg-stone-800 text-stone-200 border-stone-700'
                                : 'bg-stone-100 text-stone-700 border-stone-300'
                            }`}
                          >
                            <Cpu className="h-3 w-3 text-stone-500" />
                            動態三層分流
                          </span>
                          <div
                            className={`text-[10px] mt-1 ${
                              isSelected ? 'text-stone-400' : 'text-stone-400'
                            }`}
                          >
                            更新於: {repo.lastPushed}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {filteredRepos.length === 0 && (
                    <div className="text-center py-6 border border-dashed border-stone-300 rounded-lg bg-white">
                      <p className="text-stone-500">沒有找到符合條件的 GitHub 倉庫。</p>
                      <button
                        onClick={handleSwitchToManual}
                        className="mt-2 text-stone-800 underline hover:text-stone-900 font-semibold cursor-pointer"
                      >
                        點此手動輸入 Repository 名稱
                      </button>
                    </div>
                  )}
                </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Configure Bridge & Automatic Model Routing Setup */}
          {(selectedRepo || isManualInput) && (
            <div className="space-y-4 pt-3 border-t border-stone-200 animate-fadeIn">
              <label className="font-bold text-stone-900 uppercase tracking-wider block">
                2. 配置專案階段與自動模型路由矩陣
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Stage */}
                <div className="bg-white p-3 rounded-lg border border-stone-200 space-y-1.5 shadow-xs">
                  <span className="text-[11px] text-stone-500 block font-semibold">產品生命週期階段:</span>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value as ProjectStage)}
                    className="w-full bg-stone-50 border border-stone-300 rounded px-2 py-1.5 text-stone-800 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="Prototype">Prototype (原型驗證)</option>
                    <option value="Alpha">Alpha (功能開發)</option>
                    <option value="Beta">Beta (公開測試)</option>
                    <option value="Production">Production (線上運營)</option>
                  </select>
                </div>

                {/* Initial Gate */}
                <div className="bg-white p-3 rounded-lg border border-stone-200 space-y-1.5 shadow-xs">
                  <span className="text-[11px] text-stone-500 block font-semibold">初始 Bridge 關卡:</span>
                  <select
                    value={initialGate}
                    onChange={(e) => setInitialGate(e.target.value as BridgeGateId)}
                    className="w-full bg-stone-50 border border-stone-300 rounded px-2 py-1.5 text-stone-800 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="DISCUSS">DISCUSS (架構探討 / AI 顧問)</option>
                    <option value="SPECIFY">SPECIFY (PRD / 規格文件)</option>
                    <option value="ROUTE">ROUTE (模型動態路由指派)</option>
                    <option value="IMPLEMENT">IMPLEMENT (AI 代理自主寫代碼)</option>
                  </select>
                </div>
              </div>

              {/* Automatic Dynamic Routing Matrix Ready */}
              <div className="bg-white p-3.5 rounded-lg border border-stone-300 space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-700" />
                    自動任務模型路由矩陣（Per-Task Dynamic Allocation）
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 font-medium">
                    ● 自動指派模式
                  </span>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  專案接入後，系統在執行每個具體 Issue / PR 任務時，會依據任務的風險與影響範圍自動路由：
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="p-2 rounded bg-stone-50 border border-stone-200 space-y-1">
                    <div className="font-bold text-stone-800 flex items-center gap-1">
                      <Zap className="h-3 w-3 text-stone-500" /> Luna Tier
                    </div>
                    <p className="text-[10px] text-stone-500">文件、Lint、Config 升級等低風險確定性任務</p>
                  </div>
                  <div className="p-2 rounded bg-sky-50 border border-sky-200 space-y-1">
                    <div className="font-bold text-sky-950 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3 text-sky-700" /> Terra Tier
                    </div>
                    <p className="text-[10px] text-sky-800">一般 CRUD 功能特徵、單元測試生成與代碼審查</p>
                  </div>
                  <div className="p-2 rounded bg-amber-50 border border-amber-200 space-y-1">
                    <div className="font-bold text-amber-950 flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3 text-amber-700" /> Sol Tier
                    </div>
                    <p className="text-[10px] text-amber-900">Auth 權限、Stripe 金流、Schema 遷移與故障除錯</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-white border-t border-stone-200 px-6 py-3 flex items-center justify-between">
          <span className="text-[11px] text-stone-500 font-mono">
            {selectedRepo ? `已選定：${selectedRepo.fullName}` : isManualInput && manualRepoName ? `手動：${manualRepoName}` : '請選擇要接入的倉庫'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-mono bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-md transition-colors cursor-pointer shadow-xs"
            >
              取消
            </button>
            <button
              onClick={handleConfirmConnect}
              disabled={!selectedRepo && (!isManualInput || !manualRepoName.trim())}
              className="px-4 py-1.5 text-xs font-mono font-semibold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-md flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>確定接入專案</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
