import React, { useState } from 'react';
import { Terminal, ShieldAlert, Cpu, Search, Sparkles, RefreshCw, Github, Workflow, ChevronDown } from 'lucide-react';
import { AIExecutionSnapshotData } from '../types';

interface CockpitHeaderProps {
  snapshot: AIExecutionSnapshotData;
  activeFilter: 'all' | 'attention' | 'running' | 'production';
  onSelectFilter: (filter: 'all' | 'attention' | 'running' | 'production') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  totalProjects: number;
  attentionCount: number;
  onOpenModelGuide: () => void;
  onOpenConnectRepo: () => void;
  onOpenCiCdMap?: () => void;
  onRefreshSim: () => void;
}

export const CockpitHeader: React.FC<CockpitHeaderProps> = ({
  snapshot,
  activeFilter,
  onSelectFilter,
  searchQuery,
  onSearchChange,
  totalProjects,
  attentionCount,
  onOpenModelGuide,
  onOpenConnectRepo,
  onOpenCiCdMap,
  onRefreshSim,
}) => {
  const [showMore, setShowMore] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-[#FAF9F6]/90 backdrop-blur-md border-b border-stone-200/90 px-4 lg:px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Brand & Context */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-stone-100 border border-stone-300 flex items-center justify-center text-stone-700 shadow-xs">
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-stone-900 font-mono">
                Micro-SaaS Command Center
              </h1>
            </div>
            <p className="text-xs text-stone-500 flex items-center gap-2">
              <span>AI 協作作業中</span>
              <span className="inline-block h-1 w-1 rounded-full bg-stone-400" />
              <span className="text-emerald-700 font-mono flex items-center gap-1 font-medium">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                Live Sync
              </span>
            </p>
          </div>
        </div>

        {/* Global Search & Quick Filters */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Search */}
          <div className="relative min-w-[180px] sm:min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜尋專案、任務…"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-stone-300 rounded-md text-stone-800 placeholder-stone-400 focus:outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-400/30 transition-all font-mono shadow-xs"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 text-xs px-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Filter Pill Group */}
          <div className="inline-flex rounded-md p-0.5 bg-stone-200/70 border border-stone-300 text-xs font-medium">
            <button
              onClick={() => onSelectFilter('all')}
              className={`px-2.5 py-1 rounded transition-colors ${
                activeFilter === 'all'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              全部 ({totalProjects})
            </button>
            <button
              onClick={() => onSelectFilter('attention')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeFilter === 'attention'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-xs'
                  : 'text-amber-800 hover:text-amber-950'
              }`}
            >
              <ShieldAlert className="h-3 w-3 text-amber-700" />
              <span>待你關注 ({attentionCount})</span>
            </button>
            <button
              onClick={() => onSelectFilter('running')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeFilter === 'running'
                  ? 'bg-sky-100 text-sky-900 border border-sky-300 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Cpu className="h-3 w-3 text-sky-700" />
              <span>AI 進行中 ({snapshot.aiRunning})</span>
            </button>
            <button
              onClick={() => onSelectFilter('production')}
              className={`px-2.5 py-1 rounded transition-colors ${
                activeFilter === 'production'
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              已上線
            </button>
          </div>

          {/* Connect GitHub Repo Button */}
          <button
            onClick={onOpenConnectRepo}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-stone-900 text-stone-50 hover:bg-stone-800 flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            title="從 GitHub 接入既有 Micro-SaaS 倉庫"
          >
            <Github className="h-3.5 w-3.5" />
            <span>+ 接入新專案</span>
          </button>

          {/* Quick Refresh Sim */}
          <button
            onClick={onRefreshSim}
            className="p-1.5 text-xs rounded-md bg-white border border-stone-300 text-stone-600 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-400 transition-colors shadow-xs cursor-pointer"
            title="重新整理本地快照"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          {/* Technical detail toggle — model routing / pipeline diagram are engineering tools, hidden by default */}
          <button
            onClick={() => setShowMore((v) => !v)}
            className="p-1.5 text-xs rounded-md bg-white border border-stone-300 text-stone-400 hover:bg-stone-50 hover:text-stone-700 hover:border-stone-400 transition-colors shadow-xs cursor-pointer"
            title="技術細節"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMore ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {showMore && (
        <div className="max-w-7xl mx-auto flex items-center justify-end gap-2 pt-2 mt-2 border-t border-stone-200/80">
          <span className="text-[10px] text-stone-400 mr-auto">技術細節 — 一般不用看</span>
          {onOpenCiCdMap && (
            <button
              onClick={onOpenCiCdMap}
              className="px-2.5 py-1.5 text-xs rounded-md bg-white border border-stone-300 text-stone-700 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-400 flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              title="查看 AI 協作流程圖"
            >
              <Workflow className="h-3.5 w-3.5 text-sky-700" />
              <span className="font-mono text-[11px]">CI/CD 流程圖</span>
            </button>
          )}
          <button
            onClick={onOpenModelGuide}
            className="px-2.5 py-1.5 text-xs rounded-md bg-white border border-stone-300 text-stone-700 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-400 flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            title="AI 模型路由參考"
          >
            <Sparkles className="h-3 w-3 text-amber-700" />
            <span className="font-mono text-[11px]">Luna / Terra / Sol</span>
          </button>
        </div>
      )}
    </header>
  );
};
