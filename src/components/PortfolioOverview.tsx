import React, { useState } from 'react';
import {
  Layers,
  Sparkles,
  ArrowUpDown,
  Filter,
  Plus,
  LayoutGrid,
  List,
  ChevronRight,
  ExternalLink,
  GitBranch,
  ShieldCheck,
  Zap,
  ShieldAlert,
  PlayCircle,
  Clock,
  Server,
  ArrowRight,
  Radio,
} from 'lucide-react';
import { MicroSaaSProject, ProjectHealth, ProjectStage } from '../types';
import {
  getHealthBadgeStyle,
  getStageBadgeStyle,
  getModelBadgeStyle,
  getGateStatusBadgeStyle,
} from '../utils';

interface PortfolioOverviewProps {
  projects: MicroSaaSProject[];
  selectedProjectId: string | null;
  onSelectProject: (project: MicroSaaSProject) => void;
  onOpenConnectRepo?: () => void;
}

export const PortfolioOverview: React.FC<PortfolioOverviewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenConnectRepo,
}) => {
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [healthFilter, setHealthFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'activity' | 'health' | 'name' | 'version'>('activity');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

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
      if (sortBy === 'version') {
        const vA = a.environment.production.version || 'v0.0.0';
        const vB = b.environment.production.version || 'v0.0.0';
        return vB.localeCompare(vA);
      }
      return 0; // default order
    });

  // Calculate staging vs prod active versions
  const activeInStagingCount = projects.filter(
    (p) => p.environment.staging?.version && p.currentGate !== 'DONE'
  ).length;
  const liveInProdCount = projects.filter(
    (p) => p.environment.production.status === 'Live' || p.environment.production.status === 'Healthy'
  ).length;

  return (
    <section className="bg-white border border-stone-300 rounded-xl overflow-hidden shadow-xs">
      {/* Header & Controls */}
      <div className="p-4 sm:p-5 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF9F6]">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-stone-700" />
            <h2 className="text-sm font-semibold text-stone-900 font-mono uppercase tracking-wider">
              專案與環境監控看板（Portfolio Overview）
            </h2>
            <span className="text-xs font-mono text-stone-600 bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
              {filteredProjects.length} 個專案
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            支援 <strong>Stage (測試/預發)</strong> ➔ <strong>Production (正式線上)</strong> 雙軌環境監控與版本改版差異追蹤。
          </p>
        </div>

        {/* Filter & View Mode Controls */}
        <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
          {/* Stage Filter */}
          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <span className="text-stone-500">專案階段:</span>
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

          {/* Health Filter */}
          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <span className="text-stone-500">健康狀態:</span>
            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">全部狀態</option>
              <option value="Attention">需關注 (Attention)</option>
              <option value="Blocked">已阻礙 (Blocked)</option>
              <option value="At Risk">有風險 (At Risk)</option>
              <option value="Healthy">正常 (Healthy)</option>
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <ArrowUpDown className="h-3 w-3 text-stone-400" />
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="activity">依活動排序</option>
              <option value="health">依風險排序</option>
              <option value="version">依正式版號排序</option>
              <option value="name">依名稱排序</option>
            </select>
          </div>

          {/* Layout Toggle */}
          <div className="flex items-center bg-stone-200/70 p-0.5 rounded border border-stone-300">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1 rounded transition-colors cursor-pointer ${
                viewMode === 'table' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600 hover:text-stone-900'
              }`}
              title="表格清單模式"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`p-1 rounded transition-colors cursor-pointer ${
                viewMode === 'cards' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600 hover:text-stone-900'
              }`}
              title="卡片網格模式"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
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

      {/* Dual Environment Quick Status Bar */}
      <div className="px-4 py-2 bg-stone-100/60 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2 text-[11px] font-mono text-stone-600">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span>
              <strong>Production 正式線上:</strong> {liveInProdCount} 個服務 Live 運作中
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <span>
              <strong>Stage 預發/測試:</strong> {activeInStagingCount} 個新版本候選驗證中 (RC In-Flight)
            </span>
          </div>
        </div>
        <div className="text-stone-500 text-[10px]">
          CI/CD 規則：所有改版必須先在 Stage 驗證通過（Tests & Review PASS）後，方可 1-Click Promote 至 Production。
        </div>
      </div>

      {/* VIEW 1: Clean Table View */}
      {viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-stone-200 bg-[#F7F6F2] text-[11px] font-mono text-stone-500 uppercase tracking-wider">
                <th className="py-2.5 px-4 font-medium">專案 / 階段</th>
                <th className="py-2.5 px-3 font-medium min-w-[190px]">環境與版本 (Stage ➔ Prod)</th>
                <th className="py-2.5 px-3 font-medium min-w-[200px]">當前任務與進度</th>
                <th className="py-2.5 px-3 font-medium">Bridge 關卡</th>
                <th className="py-2.5 px-3 font-medium">指派模型</th>
                <th className="py-2.5 px-3 font-medium">健康 / 阻塞</th>
                <th className="py-2.5 px-4 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 text-xs font-mono">
              {filteredProjects.map((project) => {
                const healthStyle = getHealthBadgeStyle(project.health);
                const stageStyle = getStageBadgeStyle(project.stage);
                const modelStyle = getModelBadgeStyle(project.model);
                const isSelected = selectedProjectId === project.id;
                const isRunning = project.waitingState === 'AI_RUNNING';

                const prodVer = project.environment.production.version;
                const stageVer = project.environment.staging?.version || project.environment.uat?.version;
                const isUpgradeInFlight =
                  prodVer &&
                  stageVer &&
                  prodVer !== stageVer &&
                  project.currentGate !== 'DONE';

                return (
                  <tr
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className={`group cursor-pointer transition-colors ${
                      isSelected ? 'bg-stone-100' : 'hover:bg-stone-50'
                    }`}
                  >
                    {/* Column 1: Project Name & Stage */}
                    <td className="py-3 px-4 align-middle">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${healthStyle.dot}`} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-stone-900 text-xs">
                              {project.name}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded border ${stageStyle.bg} ${stageStyle.text} ${stageStyle.border}`}
                            >
                              {project.stage}
                            </span>
                          </div>
                          <div className="text-[10px] text-stone-400 font-mono mt-0.5">
                            {project.repository}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Environments & Versions (Stage ➔ Prod) */}
                    <td className="py-3 px-3 align-middle">
                      <div className="space-y-1">
                        {/* Prod version */}
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-[10px] text-stone-500 font-mono w-11 shrink-0">Prod:</span>
                          {prodVer ? (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 font-semibold font-mono flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 shrink-0" />
                              {prodVer}
                            </span>
                          ) : (
                            <span className="text-stone-400 text-[10px]">未部署 (None)</span>
                          )}
                        </div>

                        {/* Stage version */}
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-[10px] text-stone-500 font-mono w-11 shrink-0">Stage:</span>
                          {stageVer ? (
                            <span className="px-1.5 py-0.2 rounded bg-amber-50 text-amber-900 border border-amber-300 font-mono flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                              {stageVer}
                            </span>
                          ) : (
                            <span className="text-stone-400 text-[10px]">未啟用</span>
                          )}
                        </div>

                        {/* Release Upgrade Delta Indicator */}
                        {isUpgradeInFlight && (
                          <div className="text-[10px] text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 flex items-center gap-1 mt-0.5 font-medium">
                            <span>改版中:</span>
                            <span className="font-mono">{prodVer}</span>
                            <ArrowRight className="h-2.5 w-2.5 text-sky-600" />
                            <span className="font-mono font-bold">{project.environment.targetReleaseVersion || stageVer}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Column 3: Current Task */}
                    <td className="py-3 px-3 align-middle">
                      <div className="text-stone-800 text-xs font-medium line-clamp-1">
                        {project.currentTask}
                      </div>
                      <div className="text-[10px] text-stone-500 mt-0.5 flex items-center gap-1.5">
                        <span>Ref: {project.executionContext.githubIssue}</span>
                        {isRunning && (
                          <span className="text-sky-700 flex items-center gap-0.5">
                            <PlayCircle className="h-2.5 w-2.5 animate-spin" /> AI 執行中
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Column 4: Bridge Gate */}
                    <td className="py-3 px-3 align-middle">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-800 border border-stone-300">
                        {project.currentGate}
                      </span>
                    </td>

                    {/* Column 5: Model Tier */}
                    <td className="py-3 px-3 align-middle">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border"
                        style={{
                          backgroundColor: modelStyle.bg,
                          color: modelStyle.accent,
                          borderColor: modelStyle.border,
                        }}
                      >
                        {project.model}
                      </span>
                    </td>

                    {/* Column 6: Health / Blocker */}
                    <td className="py-3 px-3 align-middle">
                      {project.blocker ? (
                        <span className="text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-medium line-clamp-1 max-w-[180px]" title={project.blocker}>
                          ⚠️ {project.blocker}
                        </span>
                      ) : (
                        <span className={`text-[11px] px-2 py-0.5 rounded border ${healthStyle.bg} ${healthStyle.text} ${healthStyle.border}`}>
                          {project.health}
                        </span>
                      )}
                    </td>

                    {/* Column 7: Action */}
                    <td className="py-3 px-4 text-right align-middle">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(project);
                        }}
                        className="px-2.5 py-1 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded transition-colors inline-flex items-center gap-1 cursor-pointer"
                      >
                        <span>詳情</span>
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* VIEW 2: Clean Card Grid View */
        <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 font-mono">
          {filteredProjects.map((project) => {
            const healthStyle = getHealthBadgeStyle(project.health);
            const stageStyle = getStageBadgeStyle(project.stage);
            const modelStyle = getModelBadgeStyle(project.model);
            const isSelected = selectedProjectId === project.id;
            const isRunning = project.waitingState === 'AI_RUNNING';

            const prodVer = project.environment.production.version;
            const stageVer = project.environment.staging?.version || project.environment.uat?.version;
            const isUpgradeInFlight =
              prodVer &&
              stageVer &&
              prodVer !== stageVer &&
              project.currentGate !== 'DONE';

            return (
              <div
                key={project.id}
                onClick={() => onSelectProject(project)}
                className={`p-4 rounded-lg border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  isSelected
                    ? 'bg-stone-50 border-stone-800 shadow-xs'
                    : 'bg-white border-stone-200 hover:border-stone-400 hover:shadow-xs'
                }`}
              >
                {/* Card Top */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${healthStyle.dot}`} />
                      <h3 className="font-bold text-stone-900 text-xs">{project.name}</h3>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded border ${stageStyle.bg} ${stageStyle.text} ${stageStyle.border}`}
                    >
                      {project.stage}
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-500 line-clamp-1">{project.tagline}</p>

                  {/* Dual Environment & Version Strip */}
                  <div className="bg-stone-100/70 p-2 rounded border border-stone-200 text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-stone-500">正式 Production:</span>
                      {prodVer ? (
                        <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-300">
                          {prodVer}
                        </span>
                      ) : (
                        <span className="text-stone-400 text-[10px]">未部署</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-stone-500">測試 Stage:</span>
                      {stageVer ? (
                        <span className="font-mono text-amber-900 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-300">
                          {stageVer}
                        </span>
                      ) : (
                        <span className="text-stone-400 text-[10px]">未啟用</span>
                      )}
                    </div>

                    {isUpgradeInFlight && (
                      <div className="pt-1 mt-1 border-t border-stone-200/80 flex items-center justify-between text-[10px] text-sky-800">
                        <span>🚀 改版流向:</span>
                        <div className="flex items-center gap-1 font-mono font-medium">
                          <span>{prodVer}</span>
                          <ArrowRight className="h-2.5 w-2.5 text-sky-600" />
                          <span className="font-bold text-sky-950">
                            {project.environment.targetReleaseVersion || stageVer}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-stone-50 p-2 rounded border border-stone-200 text-xs">
                    <div className="text-[10px] text-stone-400">當前任務:</div>
                    <div className="text-stone-800 font-medium text-[11px] line-clamp-1 mt-0.5">
                      {project.currentTask}
                    </div>
                  </div>
                </div>

                {/* Card Footer */}
                <div className="pt-2 border-t border-stone-200 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-800 border border-stone-300 font-semibold">
                      {project.currentGate}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded border"
                      style={{
                        backgroundColor: modelStyle.bg,
                        color: modelStyle.accent,
                        borderColor: modelStyle.border,
                      }}
                    >
                      {project.model}
                    </span>
                  </div>

                  <span className="text-stone-500 hover:text-stone-900 flex items-center gap-0.5">
                    展開抽屜 <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
