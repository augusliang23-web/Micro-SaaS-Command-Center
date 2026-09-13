import React, { useState } from 'react';
import { Layers, ArrowUpDown, Plus } from 'lucide-react';
import { MicroSaaSProject, ProjectHealth } from '../types';
import { ProjectVerdictCard } from './ProjectVerdictCard';

interface PortfolioOverviewProps {
  projects: MicroSaaSProject[];
  selectedProjectId: string | null;
  onSelectProject: (project: MicroSaaSProject) => void;
  onOpenConnectRepo?: () => void;
  onDeleteProject?: (projectId: string) => void;
}

export const PortfolioOverview: React.FC<PortfolioOverviewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenConnectRepo,
  onDeleteProject,
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
            onDelete={onDeleteProject}
          />
        ))}
      </div>
    </section>
  );
};
