import React from 'react';
import { Terminal, ShieldAlert, Cpu, Search, Sparkles, SlidersHorizontal, RefreshCw, Plus, Github } from 'lucide-react';
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
  onRefreshSim,
}) => {
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
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-stone-200/80 text-stone-700 border border-stone-300">
                v1.0 Cockpit
              </span>
            </div>
            <p className="text-xs text-stone-500 flex items-center gap-2">
              <span>ChatGPT ↔ Codex Bridge Operations</span>
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
          <div className="relative min-w-[200px] sm:min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search projects, tasks, models..."
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
              All ({totalProjects})
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
              <span>Attention ({attentionCount})</span>
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
              <span>AI Running ({snapshot.aiRunning})</span>
            </button>
            <button
              onClick={() => onSelectFilter('production')}
              className={`px-2.5 py-1 rounded transition-colors ${
                activeFilter === 'production'
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Production
            </button>
          </div>

          {/* Model Routing Guide Trigger */}
          <button
            onClick={onOpenModelGuide}
            className="px-2.5 py-1.5 text-xs rounded-md bg-white border border-stone-300 text-stone-700 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-400 flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            title="Codex Model Routing Reference"
          >
            <Sparkles className="h-3 w-3 text-amber-700" />
            <span className="font-mono text-[11px]">Luna / Terra / Sol</span>
          </button>

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
            title="Refresh Bridge Telemetry"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
