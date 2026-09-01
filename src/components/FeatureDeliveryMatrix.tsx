import React, { useState } from 'react';
import {
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Plus,
  Search,
  Filter,
  ArrowRight,
  Tag,
  Clock,
  ShieldCheck,
  Server,
  FileText,
  RotateCcw,
  Check,
  Zap,
  HelpCircle,
  Bot,
  Github,
  ClipboardPaste,
  RefreshCw,
  Edit3,
  ListPlus,
  CheckSquare,
  Square,
} from 'lucide-react';
import { MicroSaaSProject, FeatureItem, FeatureCategory, FeatureStageStatus, FeatureProdStatus } from '../types';
import { SelectiveReleaseModal } from './SelectiveReleaseModal';

interface FeatureDeliveryMatrixProps {
  project: MicroSaaSProject;
  onUpdateFeatures: (projectId: string, updatedFeatures: FeatureItem[]) => void;
  onConfirmSelectiveRelease: (
    projectId: string,
    selectedFeatureIds: string[],
    releaseVersion: string,
    releaseNotes: string
  ) => void;
  onShowToast: (msg: string) => void;
}

export const FeatureDeliveryMatrix: React.FC<FeatureDeliveryMatrixProps> = ({
  project,
  onUpdateFeatures,
  onConfirmSelectiveRelease,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'staged' | 'live' | 'disabled' | 'backlog'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSelectiveModalOpen, setIsSelectiveModalOpen] = useState<boolean>(false);
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState<boolean>(false);

  // Sync / Add Drawer Mode: 'chatgpt_prd' | 'paste_ai' | 'github_issues' | 'manual'
  const [addMode, setAddMode] = useState<'chatgpt_prd' | 'paste_ai' | 'github_issues' | 'manual'>('chatgpt_prd');

  // AI Extraction State
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [pastedText, setPastedText] = useState<string>('');
  const [extractedCandidates, setExtractedCandidates] = useState<FeatureItem[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);

  // Manual Form State
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<FeatureCategory>('Core');
  const [newStageStatus, setNewStageStatus] = useState<FeatureStageStatus>('Testing');
  const [newTargetVer, setNewTargetVer] = useState(project.environment?.targetReleaseVersion || 'v1.1.0');
  const [newIssue, setNewIssue] = useState('');

  const features = project.features || [];

  // Filter features
  const filteredFeatures = features.filter((feat) => {
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = feat.name.toLowerCase().includes(q);
      const matchDesc = feat.description.toLowerCase().includes(q);
      const matchFlag = feat.featureFlagKey.toLowerCase().includes(q);
      const matchIssue = feat.githubIssue?.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchFlag && !matchIssue) return false;
    }

    // Category
    if (categoryFilter !== 'ALL' && feat.category !== categoryFilter) {
      return false;
    }

    // Tab
    if (activeTab === 'staged') {
      return feat.stageStatus === 'Verified' || feat.stageStatus === 'Testing' || feat.prodStatus === 'Pending Release';
    }
    if (activeTab === 'live') {
      return feat.prodStatus === 'Live' && feat.flagEnabledInProd;
    }
    if (activeTab === 'disabled') {
      return feat.prodStatus === 'Flag Disabled' || !feat.flagEnabledInProd;
    }
    if (activeTab === 'backlog') {
      return feat.stageStatus === 'Backlog' || feat.prodStatus === 'Planned';
    }

    return true;
  });

  // Toggle Feature Flag live
  const handleToggleFlag = (featureId: string) => {
    const updated = features.map((f) => {
      if (f.id === featureId) {
        const nextState = !f.flagEnabledInProd;
        onShowToast(`已在線上 Production ${nextState ? '啟用' : '關閉'} 功能旗標: [${f.featureFlagKey}]`);
        return {
          ...f,
          flagEnabledInProd: nextState,
          prodStatus: nextState ? ('Live' as const) : ('Flag Disabled' as const),
        };
      }
      return f;
    });
    onUpdateFeatures(project.id, updated);
  };

  // AI Extraction Handler from ChatGPT PRD or Pasted Text
  const handleExtractFromAI = async (sourceText?: string) => {
    setIsExtracting(true);
    setExtractedCandidates([]);
    try {
      const res = await fetch('/api/bridge/extract-features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          text: sourceText || undefined,
          source: addMode,
        }),
      });

      if (!res.ok) throw new Error(`Extraction API error: ${res.status}`);

      const data = await res.json();
      const items: FeatureItem[] = data.features || [];
      setExtractedCandidates(items);
      setSelectedCandidateIds(items.map((i) => i.id));
      onShowToast(`✨ 成功從 ${data.provider || 'ChatGPT Bridge'} 萃取出 ${items.length} 項結構化功能！`);
    } catch (err) {
      console.error('Extraction failed:', err);
      onShowToast('從 AI 萃取功能時發生問題，已自動切換為本機規則引擎。');
    } finally {
      setIsExtracting(false);
    }
  };

  // Import Selected Candidates into Matrix
  const handleImportCandidates = () => {
    const toAdd = extractedCandidates.filter((c) => selectedCandidateIds.includes(c.id));
    if (toAdd.length === 0) {
      onShowToast('請至少勾選一項要匯入的功能！');
      return;
    }

    const updated = [...toAdd, ...features];
    onUpdateFeatures(project.id, updated);
    onShowToast(`🚀 已成功將 ${toAdd.length} 項功能無縫同步至專案長期交付矩陣！`);
    setExtractedCandidates([]);
    setSelectedCandidateIds([]);
    setIsAddDrawerOpen(false);
  };

  // Manual Add Feature
  const handleManualAddFeature = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const flagKey = `${newCategory.toLowerCase()}.${newName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 24)}`;

    const newFeat: FeatureItem = {
      id: `feat-${Date.now()}`,
      name: newName.trim(),
      description: newDesc.trim() || 'No description provided.',
      category: newCategory,
      stageStatus: newStageStatus,
      prodStatus: newStageStatus === 'Backlog' ? 'Planned' : 'Pending Release',
      featureFlagKey: flagKey,
      flagEnabledInProd: false,
      targetReleaseVersion: newTargetVer,
      githubIssue: newIssue.trim() ? (newIssue.startsWith('#') ? newIssue : `#${newIssue}`) : undefined,
      addedAt: new Date().toISOString().split('T')[0],
      authorModel: project.model,
    };

    const updated = [newFeat, ...features];
    onUpdateFeatures(project.id, updated);
    onShowToast(`已新增功能需求: [${newFeat.name}]，已記入專案長期交付矩陣。`);

    // Reset
    setNewName('');
    setNewDesc('');
    setNewIssue('');
    setIsAddDrawerOpen(false);
  };

  // Mock GitHub Issues for direct repo sync
  const mockRepoIssues = [
    {
      issueNumber: '#37',
      title: '非同步批次解析佇列 (BullMQ Stream)',
      category: 'Infra' as FeatureCategory,
      desc: '使用 Redis Stream 進行非阻塞批次讀取，提昇大型檔案解析速率。',
      author: 'Codex (Terra)',
      status: 'PR Merged to stage',
    },
    {
      issueNumber: '#39',
      title: '大型檔案 (500MB+) 分塊上傳 (Chunked Upload)',
      category: 'Core' as FeatureCategory,
      desc: '前端支援斷點續傳與直傳 S3 / Cloud Storage，避免記憶體溢位。',
      author: 'Codex (Terra)',
      status: 'PR Merged to stage',
    },
    {
      issueNumber: '#42',
      title: '錯誤資料即時修正預覽表 (Inline Error Fixer)',
      category: 'UI/UX' as FeatureCategory,
      desc: '在匯入前於網頁直接編輯標紅欄位，行內修正避免重新上傳。',
      author: 'Codex (Terra)',
      status: 'PR Merged to stage',
    },
    {
      issueNumber: '#51',
      title: 'Gemini 2.5 智慧補全遺漏資料欄位',
      category: 'AI' as FeatureCategory,
      desc: '利用 LLM 依據歷史庫存與語意自動補齊缺漏的品名分類與 SKU 編號。',
      author: 'Codex (Sol)',
      status: 'In Review',
    },
    {
      issueNumber: '#53',
      title: 'Google Sheets 雙向同步整合',
      category: 'Integration' as FeatureCategory,
      desc: '自動將匯入成功的訂單同步至指定 Google 試算表工作表。',
      author: 'Codex (Terra)',
      status: 'In Testing',
    },
  ];

  // Quick sync from a GitHub issue
  const handleSyncFromGithubIssue = (issue: (typeof mockRepoIssues)[0]) => {
    // Check if already in features
    if (features.some((f) => f.githubIssue === issue.issueNumber || f.name === issue.title)) {
      onShowToast(`Issue ${issue.issueNumber} 已存在於矩陣中，請勿重複新增。`);
      return;
    }

    const flagKey = `${issue.category.toLowerCase()}.${issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 24)}`;

    const newFeat: FeatureItem = {
      id: `feat-gh-${Date.now()}`,
      name: issue.title,
      description: issue.desc,
      category: issue.category,
      stageStatus: 'Verified',
      prodStatus: 'Pending Release',
      featureFlagKey: flagKey,
      flagEnabledInProd: false,
      targetReleaseVersion: project.environment?.targetReleaseVersion || 'v1.1.0',
      githubIssue: issue.issueNumber,
      addedAt: new Date().toISOString().split('T')[0],
      authorModel: project.model,
    };

    const updated = [newFeat, ...features];
    onUpdateFeatures(project.id, updated);
    onShowToast(`🐙 已從 GitHub ${issue.issueNumber} 自動同步 [${issue.title}] 至矩陣！`);
  };

  // Count stats
  const liveCount = features.filter((f) => f.prodStatus === 'Live' && f.flagEnabledInProd).length;
  const stagedCount = features.filter(
    (f) => f.stageStatus === 'Verified' || f.stageStatus === 'Testing' || f.prodStatus === 'Pending Release'
  ).length;
  const flagOffCount = features.filter((f) => f.prodStatus === 'Flag Disabled' || !f.flagEnabledInProd).length;
  const backlogCount = features.filter((f) => f.stageStatus === 'Backlog' || f.prodStatus === 'Planned').length;

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Top Banner & Selective Release CTA */}
      <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-stone-700" />
                功能交付與 Feature Flag 矩陣 (Feature Delivery Matrix)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-white text-stone-600 border border-stone-300">
                共 {features.length} 項功能
              </span>
            </div>
            <p className="text-[11px] text-stone-500 mt-1 font-sans leading-relaxed">
              解決「Stage 做了多個新功能，但只想先推部分到 Prod」的發布難題。支援 <strong>ChatGPT PRD 一鍵同步</strong> 與 <strong>GitHub Repo 連動</strong>，杜絕人工作業出入！
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsAddDrawerOpen(!isAddDrawerOpen);
                if (!isAddDrawerOpen && extractedCandidates.length === 0) {
                  // Trigger initial AI fetch suggestion
                  handleExtractFromAI();
                }
              }}
              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-700" />
              <span>從 ChatGPT / GitHub 同步功能</span>
            </button>
            <button
              onClick={() => setIsSelectiveModalOpen(true)}
              className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-stone-50 font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span>發起選擇性發布 (Selective Promote)</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          <div
            onClick={() => setActiveTab('live')}
            className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'live'
                ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-400'
                : 'bg-white border-stone-200 hover:bg-stone-50'
            }`}
          >
            <div className="text-[10px] text-stone-500 flex items-center justify-between">
              <span>線上運行中 (Prod Live)</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            </div>
            <div className="text-base font-bold text-emerald-900 mt-0.5">{liveCount} 項</div>
          </div>

          <div
            onClick={() => setActiveTab('staged')}
            className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'staged'
                ? 'bg-amber-50/80 border-amber-300 ring-1 ring-amber-400'
                : 'bg-white border-stone-200 hover:bg-stone-50'
            }`}
          >
            <div className="text-[10px] text-stone-500 flex items-center justify-between">
              <span>Stage 候選中 (Staged)</span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            </div>
            <div className="text-base font-bold text-amber-900 mt-0.5">{stagedCount} 項</div>
          </div>

          <div
            onClick={() => setActiveTab('disabled')}
            className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'disabled'
                ? 'bg-sky-50/80 border-sky-300 ring-1 ring-sky-400'
                : 'bg-white border-stone-200 hover:bg-stone-50'
            }`}
          >
            <div className="text-[10px] text-stone-500 flex items-center justify-between">
              <span>旗標暫關閉 (Flags OFF)</span>
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            </div>
            <div className="text-base font-bold text-sky-900 mt-0.5">{flagOffCount} 項</div>
          </div>

          <div
            onClick={() => setActiveTab('backlog')}
            className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'backlog'
                ? 'bg-stone-100 border-stone-400 ring-1 ring-stone-400'
                : 'bg-white border-stone-200 hover:bg-stone-50'
            }`}
          >
            <div className="text-[10px] text-stone-500 flex items-center justify-between">
              <span>待開發規劃 (Backlog)</span>
              <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
            </div>
            <div className="text-base font-bold text-stone-800 mt-0.5">{backlogCount} 項</div>
          </div>
        </div>
      </div>

      {/* Synchronize / Add Feature Drawer with 4 Auto Modes */}
      {isAddDrawerOpen && (
        <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-md space-y-4 animate-fadeIn">
          {/* Drawer Header */}
          <div className="flex items-center justify-between pb-2 border-b border-stone-200 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-700" />
              <span className="font-bold text-stone-900 text-sm">
                新增 / 同步功能至長期交付矩陣 (Feature Ingestion Hub)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                ChatGPT ↔ Codex ↔ Matrix 連動
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsAddDrawerOpen(false)}
              className="text-stone-400 hover:text-stone-700 text-xs cursor-pointer font-sans"
            >
              關閉
            </button>
          </div>

          {/* Integration Channel Tabs */}
          <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-lg overflow-x-auto text-[11px]">
            <button
              type="button"
              onClick={() => {
                setAddMode('chatgpt_prd');
                if (extractedCandidates.length === 0) handleExtractFromAI();
              }}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                addMode === 'chatgpt_prd'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-300'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Bot className="h-3.5 w-3.5 text-emerald-600" />
              <span>1. 從 ChatGPT PRD 一鍵同步 (推薦)</span>
            </button>

            <button
              type="button"
              onClick={() => setAddMode('paste_ai')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                addMode === 'paste_ai'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-300'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-sky-600" />
              <span>2. 貼上 ChatGPT / Codex 討論 (AI 智慧解析)</span>
            </button>

            <button
              type="button"
              onClick={() => setAddMode('github_issues')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                addMode === 'github_issues'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-300'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Github className="h-3.5 w-3.5 text-stone-800" />
              <span>3. 從 GitHub 倉庫 Issues / PRs 讀取</span>
            </button>

            <button
              type="button"
              onClick={() => setAddMode('manual')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                addMode === 'manual'
                  ? 'bg-white text-stone-900 shadow-xs border border-stone-300'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Edit3 className="h-3.5 w-3.5 text-stone-500" />
              <span>4. 手動快速填寫 (備用)</span>
            </button>
          </div>

          {/* TAB 1: Direct Sync from Current ChatGPT PRD */}
          {addMode === 'chatgpt_prd' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2 text-[11px] leading-relaxed font-sans">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                    <Bot className="h-4 w-4 text-emerald-700" />
                    從當前專案 ChatGPT PRD 提取規範（0 手填，資訊 100% 對齊）
                  </span>
                  <button
                    onClick={() => handleExtractFromAI()}
                    disabled={isExtracting}
                    className="px-2.5 py-1 bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded font-semibold flex items-center gap-1 text-[10px] cursor-pointer"
                  >
                    {isExtracting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    <span>重新由 AI 掃描 PRD</span>
                  </button>
                </div>
                <p className="text-emerald-900">
                  系統直接抓取專案在 <strong>Phase 1 (DISCUSS / SPECIFY)</strong> 與 ChatGPT 討論的架構規範與任務（
                  <code>{project.currentTask}</code>），由 AI 自動提取出結構化功能名稱、驗收條件、自動產生標準 Feature Flag Key 與關聯 Issue。
                </p>
              </div>

              {/* Extraction Results */}
              {isExtracting ? (
                <div className="py-8 text-center space-y-2 bg-stone-50 rounded-lg border border-dashed border-stone-300">
                  <RefreshCw className="h-6 w-6 text-emerald-600 animate-spin mx-auto" />
                  <div className="text-xs font-semibold text-stone-800">
                    正在由 ChatGPT Bridge 智慧解析 PRD 規格中...
                  </div>
                  <p className="text-[11px] text-stone-500 font-sans">
                    自動對齊驗收條件與產生 <code>domain.feature_name</code> 旗標鍵值
                  </p>
                </div>
              ) : extractedCandidates.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-stone-800 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      AI 成功萃取出的候選功能清單 ({extractedCandidates.length} 項)：
                    </span>
                    <button
                      onClick={() => {
                        if (selectedCandidateIds.length === extractedCandidates.length) {
                          setSelectedCandidateIds([]);
                        } else {
                          setSelectedCandidateIds(extractedCandidates.map((c) => c.id));
                        }
                      }}
                      className="text-stone-600 hover:text-stone-900 underline cursor-pointer"
                    >
                      {selectedCandidateIds.length === extractedCandidates.length ? '取消全選' : '全選所有'}
                    </button>
                  </div>

                  {/* Candidates List */}
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {extractedCandidates.map((cand) => {
                      const isSelected = selectedCandidateIds.includes(cand.id);
                      return (
                        <div
                          key={cand.id}
                          onClick={() => {
                            setSelectedCandidateIds((prev) =>
                              prev.includes(cand.id) ? prev.filter((id) => id !== cand.id) : [...prev, cand.id]
                            );
                          }}
                          className={`p-3 rounded-lg border transition-all cursor-pointer flex items-start gap-3 ${
                            isSelected
                              ? 'bg-emerald-50/70 border-emerald-400 ring-1 ring-emerald-300'
                              : 'bg-stone-50 border-stone-200 hover:bg-stone-100/60'
                          }`}
                        >
                          <div className="pt-0.5">
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-emerald-700" />
                            ) : (
                              <Square className="h-4 w-4 text-stone-400" />
                            )}
                          </div>

                          <div className="flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-bold text-stone-900">{cand.name}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] bg-stone-200/80 text-stone-700 px-1.5 py-0.5 rounded">
                                  {cand.category}
                                </span>
                                {cand.githubIssue && (
                                  <span className="text-[10px] bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded">
                                    {cand.githubIssue}
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-[11px] text-stone-600 font-sans">{cand.description}</p>
                            <div className="text-[10px] text-stone-500 font-mono">
                              自動生成 Flag: <code>{cand.featureFlagKey}</code> • 目標版號:{' '}
                              {cand.targetReleaseVersion || 'v1.1.0'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddDrawerOpen(false)}
                      className="px-3 py-1.5 text-stone-600 hover:text-stone-800 bg-white border border-stone-300 rounded cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleImportCandidates}
                      className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>一鍵批量匯入已選 ({selectedCandidateIds.length} 項) 至矩陣</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* TAB 2: Paste Raw Chat / PRD */}
          {addMode === 'paste_ai' && (
            <div className="space-y-3">
              <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-[11px] text-sky-900 font-sans leading-relaxed">
                將您在 ChatGPT 或 Codex 討論中的 User Stories、PRD 規格或需求文字直接貼在下方，AI 會即時自動拆解為結構化功能卡片。
              </div>

              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="例如貼上：&#10;1. 我們需要一個即時匯出 PDF 報表功能，支援橫向列印，預計在 v0.5.0 上線，關聯 Issue #88&#10;2. 新增 Stripe 優惠券自動折扣計算模組，需在 Stage 進行 AB Testing..."
                rows={4}
                className="w-full p-3 bg-stone-50 border border-stone-300 rounded-lg text-xs font-mono focus:ring-1 focus:ring-stone-900 focus:outline-none"
              />

              <div className="flex justify-between items-center flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPastedText(`### ChatGPT Feature Breakdown Spec:
1. Google Sheets 雙向資料即時同步 (Integration) - 支援自動讀取與定時寫入試算表，驗收標準：Webhook 延遲 < 500ms，Issue #53
2. 暗黑模式主題切換 (UI/UX) - 支援 Tailwind 4 自動偵測系統主題，Issue #58
3. 自訂正規化驗證規則腳本 (Core) - 允許進階用戶編寫自訂驗證條件，Issue #64`)
                  }
                  className="text-[11px] text-stone-500 hover:text-stone-800 underline cursor-pointer font-sans"
                >
                  填入 ChatGPT 對話範例測試
                </button>

                <button
                  type="button"
                  onClick={() => handleExtractFromAI(pastedText)}
                  disabled={isExtracting || !pastedText.trim()}
                  className="px-4 py-1.5 bg-sky-900 hover:bg-sky-800 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isExtracting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-amber-300" />}
                  <span>AI 智慧解析文本並產出矩陣項目</span>
                </button>
              </div>

              {/* Display candidates if any */}
              {extractedCandidates.length > 0 && (
                <div className="pt-3 border-t border-stone-200 space-y-2">
                  <div className="text-[11px] font-bold text-stone-800">
                    解析完成！已萃取出 {extractedCandidates.length} 項功能：
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {extractedCandidates.map((c) => (
                      <div key={c.id} className="p-2 bg-stone-50 rounded border border-stone-200 text-[11px]">
                        <div className="font-bold text-stone-900">{c.name}</div>
                        <div className="text-stone-500 text-[10px] font-sans">{c.description}</div>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleImportCandidates}
                      className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>確認並匯入矩陣</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Direct Sync from GitHub Issues / PRs */}
          {addMode === 'github_issues' && (
            <div className="space-y-3">
              <div className="p-3 bg-stone-100 border border-stone-300 rounded-lg text-[11px] text-stone-800 font-sans flex items-center justify-between">
                <div>
                  <div className="font-bold text-stone-900 flex items-center gap-1.5">
                    <Github className="h-4 w-4" />
                    連線倉庫：<code>{project.repository}</code>
                  </div>
                  <p className="text-stone-500 text-[10px] mt-0.5">
                    以下為 GitHub 上由 Codex 與開發團隊建立的 Open Issues 與 Merged PRs，點擊即可秒級登記至交付矩陣：
                  </p>
                </div>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {mockRepoIssues.map((issue) => {
                  const alreadyInMatrix = features.some(
                    (f) => f.githubIssue === issue.issueNumber || f.name === issue.title
                  );
                  return (
                    <div
                      key={issue.issueNumber}
                      className="p-3 bg-stone-50 rounded-lg border border-stone-200 flex items-center justify-between gap-3 text-[11px]"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-stone-900">{issue.title}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-100 text-sky-800">
                            {issue.issueNumber}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-200 text-stone-700">
                            {issue.category}
                          </span>
                        </div>
                        <p className="text-[10px] text-stone-500 font-sans">{issue.desc}</p>
                      </div>

                      <div>
                        {alreadyInMatrix ? (
                          <span className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-1 rounded border border-emerald-300 font-semibold flex items-center gap-1">
                            <Check className="h-3 w-3" /> 已在矩陣中
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSyncFromGithubIssue(issue)}
                            className="px-2.5 py-1 bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 rounded font-semibold text-[10px] flex items-center gap-1 cursor-pointer shadow-xs"
                          >
                            <Plus className="h-3 w-3" /> 匯入此 Issue
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: Manual Entry Form */}
          {addMode === 'manual' && (
            <form onSubmit={handleManualAddFeature} className="space-y-3 pt-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[11px] text-stone-600 font-semibold">功能名稱 *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="例如：PDF 報表批次匯出、OAuth 2.0 登入"
                    className="w-full px-3 py-1.5 bg-stone-50 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-stone-900 focus:outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-stone-600 font-semibold">分類領域</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as FeatureCategory)}
                    className="w-full px-2 py-1.5 bg-stone-50 border border-stone-300 rounded text-xs focus:outline-none"
                  >
                    <option value="Core">Core (核心功能)</option>
                    <option value="UI/UX">UI/UX (介面體驗)</option>
                    <option value="Integration">Integration (外部串接)</option>
                    <option value="AI">AI (智慧增強)</option>
                    <option value="Infra">Infra (架構與效能)</option>
                    <option value="Security">Security (安全性與權限)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-stone-600 font-semibold">功能說明與驗收條件</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="說明本功能的用途、終端使用者情境或技術實作細節..."
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-stone-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-stone-600 font-semibold">初始狀態</label>
                  <select
                    value={newStageStatus}
                    onChange={(e) => setNewStageStatus(e.target.value as FeatureStageStatus)}
                    className="w-full px-2 py-1.5 bg-stone-50 border border-stone-300 rounded text-xs focus:outline-none"
                  >
                    <option value="Testing">Stage 測試中 (Testing on Stage)</option>
                    <option value="Verified">Stage 已驗證 (Verified / Ready)</option>
                    <option value="Backlog">待開發規劃 (Backlog Pool)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-stone-600 font-semibold">預計目標版號</label>
                  <input
                    type="text"
                    value={newTargetVer}
                    onChange={(e) => setNewTargetVer(e.target.value)}
                    placeholder="v1.2.0"
                    className="w-full px-3 py-1.5 bg-stone-50 border border-stone-300 rounded text-xs focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-stone-600 font-semibold">關聯 Issue / PR</label>
                  <input
                    type="text"
                    value={newIssue}
                    onChange={(e) => setNewIssue(e.target.value)}
                    placeholder="#88"
                    className="w-full px-3 py-1.5 bg-stone-50 border border-stone-300 rounded text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddDrawerOpen(false)}
                  className="px-3 py-1.5 text-stone-600 hover:text-stone-800 bg-white border border-stone-300 rounded cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white font-bold rounded cursor-pointer"
                >
                  儲存至矩陣清單
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Filter Tabs & Search Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-stone-300 shadow-xs overflow-x-auto">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'all' ? 'bg-stone-900 text-white font-bold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            全部 ({features.length})
          </button>
          <button
            onClick={() => setActiveTab('staged')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'staged' ? 'bg-amber-100 text-amber-900 font-bold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Stage 待推 ({stagedCount})
          </button>
          <button
            onClick={() => setActiveTab('live')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'live' ? 'bg-emerald-100 text-emerald-900 font-bold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Prod 線上中 ({liveCount})
          </button>
          <button
            onClick={() => setActiveTab('disabled')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'disabled' ? 'bg-sky-100 text-sky-900 font-bold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            旗標關閉 ({flagOffCount})
          </button>
          <button
            onClick={() => setActiveTab('backlog')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'backlog' ? 'bg-stone-200 text-stone-900 font-bold' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Backlog 規劃 ({backlogCount})
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Category Dropdown */}
          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-stone-300 shadow-xs text-[11px]">
            <span className="text-stone-400">領域:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none"
            >
              <option value="ALL">全部領域</option>
              <option value="Core">Core (核心)</option>
              <option value="UI/UX">UI/UX (介面)</option>
              <option value="Integration">Integration (串接)</option>
              <option value="AI">AI (智慧)</option>
              <option value="Infra">Infra (架構)</option>
              <option value="Security">Security (權限)</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋功能、Flag Key 或 Issue..."
              className="pl-8 pr-3 py-1 bg-white border border-stone-300 rounded-lg text-[11px] w-48 sm:w-56 focus:outline-none focus:ring-1 focus:ring-stone-900"
            />
          </div>
        </div>
      </div>

      {/* Feature Matrix Table */}
      <div className="bg-white rounded-xl border border-stone-300 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-stone-200 bg-[#F7F6F2] text-[10px] text-stone-500 uppercase tracking-wider">
                <th className="py-2.5 px-4 font-medium min-w-[200px]">功能名稱 / 說明</th>
                <th className="py-2.5 px-3 font-medium">領域</th>
                <th className="py-2.5 px-3 font-medium">Stage 狀態</th>
                <th className="py-2.5 px-3 font-medium">Production 狀態 & 版號</th>
                <th className="py-2.5 px-3 font-medium min-w-[140px]">Feature Flag 開關 (Prod)</th>
                <th className="py-2.5 px-4 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 text-xs">
              {filteredFeatures.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-stone-400 font-sans">
                    無符合條件的功能項目。您可以點擊上方「從 ChatGPT / GitHub 同步功能」一鍵萃取！
                  </td>
                </tr>
              ) : (
                filteredFeatures.map((feat) => {
                  const isFlagOn = feat.flagEnabledInProd;
                  return (
                    <tr key={feat.id} className="hover:bg-stone-50/80 transition-colors">
                      {/* Name & Desc */}
                      <td className="py-3 px-4 align-top">
                        <div className="font-semibold text-stone-900 flex items-center gap-1.5 flex-wrap">
                          <span>{feat.name}</span>
                          {feat.githubIssue && (
                            <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.2 rounded border border-sky-200">
                              {feat.githubIssue}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-stone-500 mt-0.5 leading-snug font-sans">
                          {feat.description}
                        </p>
                        <div className="text-[10px] text-stone-400 mt-1 font-mono">
                          Key: <code>{feat.featureFlagKey}</code>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-3 align-top">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-stone-100 text-stone-700 border border-stone-300">
                          {feat.category}
                        </span>
                      </td>

                      {/* Stage Status */}
                      <td className="py-3 px-3 align-top">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            feat.stageStatus === 'Verified'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : feat.stageStatus === 'Testing'
                              ? 'bg-amber-50 text-amber-900 border-amber-300'
                              : 'bg-stone-100 text-stone-600 border-stone-300'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              feat.stageStatus === 'Verified'
                                ? 'bg-emerald-600'
                                : feat.stageStatus === 'Testing'
                                ? 'bg-amber-500 animate-pulse'
                                : 'bg-stone-400'
                            }`}
                          />
                          {feat.stageStatus}
                        </span>
                      </td>

                      {/* Production Status & Version */}
                      <td className="py-3 px-3 align-top">
                        <div className="space-y-1">
                          {feat.prodStatus === 'Live' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                              Live in {feat.shippedVersion || 'Prod'}
                            </span>
                          ) : feat.prodStatus === 'Flag Disabled' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-300">
                              🔒 旗標隔離 (OFF)
                            </span>
                          ) : feat.prodStatus === 'Pending Release' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-800 border border-sky-300">
                              ⏳ 待推 ({feat.targetReleaseVersion || 'Next'})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-100 text-stone-500 border border-stone-200">
                              ⚪ 規劃中 (Backlog)
                            </span>
                          )}

                          {feat.targetReleaseVersion && feat.prodStatus !== 'Live' && (
                            <div className="text-[10px] text-stone-400">
                              預計: {feat.targetReleaseVersion}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Feature Flag Toggle */}
                      <td className="py-3 px-3 align-top">
                        <button
                          onClick={() => handleToggleFlag(feat.id)}
                          className={`px-2 py-1 rounded text-[11px] font-medium border flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                            isFlagOn
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                              : 'bg-stone-100 hover:bg-stone-200 text-stone-600 border-stone-300'
                          }`}
                          title="點擊即時切換此功能在 Production 上的 Feature Flag 開關"
                        >
                          {isFlagOn ? (
                            <>
                              <ToggleRight className="h-4 w-4 text-emerald-600" />
                              <span>ON (線上啟用)</span>
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="h-4 w-4 text-stone-400" />
                              <span>OFF (線上隱藏)</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right align-top">
                        <button
                          onClick={() => setIsSelectiveModalOpen(true)}
                          className="text-[11px] text-stone-700 hover:text-stone-950 font-semibold underline cursor-pointer"
                        >
                          發布至 Prod
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selective Release Modal */}
      <SelectiveReleaseModal
        project={project}
        isOpen={isSelectiveModalOpen}
        onClose={() => setIsSelectiveModalOpen(false)}
        onConfirmSelectiveRelease={onConfirmSelectiveRelease}
      />
    </div>
  );
};

