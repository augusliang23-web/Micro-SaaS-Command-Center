import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Layers,
  Sparkles,
  CheckCircle2,
  Clock,
  Radio,
  ArrowUpDown,
  Filter,
  Plus,
  Github,
} from 'lucide-react';
import { MicroSaaSProject, ProjectHealth, ProjectStage, CodexModelName } from '../types';
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
    <section className="bg-white border border-stone-300/90 rounded-xl overflow-hidden shadow-xs">
      {/* Header & Controls */}
      <div className="p-4 sm:p-5 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF9F6]">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-stone-700" />
            <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider font-mono">
              Portfolio Overview
            </h2>
            <span className="text-xs font-mono text-stone-600 bg-stone-100 px-2 py-0.5 rounded border border-stone-300">
              {filteredProjects.length} Micro-SaaS Projects
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Situational awareness across active micro-SaaS repositories and bridge gates.
          </p>
        </div>

        {/* Filter / Sort pills */}
        <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <Filter className="h-3 w-3 text-stone-400" />
            <span className="text-stone-500">Stage:</span>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Stages</option>
              <option value="Prototype">Prototype</option>
              <option value="Alpha">Alpha</option>
              <option value="Beta">Beta</option>
              <option value="Production">Production</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <span className="text-stone-500">Health:</span>
            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Health</option>
              <option value="Attention">Attention</option>
              <option value="Blocked">Blocked</option>
              <option value="At Risk">At Risk</option>
              <option value="Healthy">Healthy</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-stone-300 shadow-xs">
            <ArrowUpDown className="h-3 w-3 text-stone-400" />
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="bg-transparent text-stone-800 focus:outline-none cursor-pointer"
            >
              <option value="activity">Sort: Activity</option>
              <option value="health">Sort: Risk / Attention</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>

          {onOpenConnectRepo && (
            <button
              onClick={onOpenConnectRepo}
              className="px-2.5 py-1 text-xs font-mono font-medium rounded bg-stone-900 text-stone-50 hover:bg-stone-800 flex items-center gap-1 transition-colors shadow-xs cursor-pointer ml-1"
            >
              <Plus className="h-3 w-3" />
              <span>接入 GitHub 倉庫</span>
            </button>
          )}
        </div>
      </div>

      {/* Structured Table Rows */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-stone-200 bg-[#F7F6F2] text-[11px] font-mono text-stone-500 uppercase tracking-wider">
              <th className="py-2.5 px-4 font-medium">Project & Health</th>
              <th className="py-2.5 px-3 font-medium min-w-[200px]">Current Task & Ref</th>
              <th className="py-2.5 px-3 font-medium min-w-[170px]">Bridge Gate Status</th>
              <th className="py-2.5 px-3 font-medium">Model Routing</th>
              <th className="py-2.5 px-3 font-medium min-w-[150px]">Environments</th>
              <th className="py-2.5 px-3 font-medium">Blocker / Action</th>
              <th className="py-2.5 px-4 text-right font-medium">Last Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 text-xs">
            {filteredProjects.map((project) => {
              const healthStyle = getHealthBadgeStyle(project.health);
              const stageStyle = getStageBadgeStyle(project.stage);
              const modelStyle = getModelBadgeStyle(project.model);
              const isSelected = selectedProjectId === project.id;

              return (
                <tr
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className={`group cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-stone-100 hover:bg-stone-150'
                      : 'hover:bg-stone-50/80'
                  }`}
                >
                  {/* Column 1: Project Name, Health & Stage */}
                  <td className="py-3 px-4 align-top">
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${healthStyle.dot}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-stone-900 group-hover:text-stone-700 transition-colors font-mono">
                            {project.name}
                          </span>
                          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${stageStyle.bg} ${stageStyle.text} ${stageStyle.border}`}>
                            {project.stage}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-500 line-clamp-1 mt-0.5 max-w-[180px]">
                          {project.tagline}
                        </p>
                        <div className="mt-1">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded border ${healthStyle.bg} ${healthStyle.text} ${healthStyle.border}`}>
                            {project.health}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Column 2: Current Task & Branch */}
                  <td className="py-3 px-3 align-top">
                    <div className="space-y-1">
                      <div className="font-medium text-stone-800 group-hover:text-stone-950 text-xs line-clamp-2">
                        {project.currentTask}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-stone-500 font-mono">
                        {project.executionContext.branch && (
                          <span className="flex items-center gap-1 text-stone-500 hover:text-stone-800">
                            <GitBranch className="h-3 w-3 text-stone-400" />
                            <span className="truncate max-w-[110px]">{project.executionContext.branch}</span>
                          </span>
                        )}
                        {project.executionContext.githubPR && (
                          <span className="flex items-center gap-1 text-sky-700 font-medium">
                            <GitPullRequest className="h-3 w-3" />
                            <span>{project.executionContext.githubPR}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Column 3: Current Bridge Gate */}
                  <td className="py-3 px-3 align-top">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-stone-100 border border-stone-300 text-[11px] font-mono">
                        <span className="text-stone-700 font-bold">GATE:</span>
                        <span className="text-stone-900 font-semibold">{project.currentGate}</span>
                        {project.currentGate === 'REVIEW' && project.reviewOutcome === 'CHANGES_REQUIRED' && (
                          <span className="text-amber-800 text-[10px] font-bold">⚠️ CHANGES</span>
                        )}
                        {project.currentGate === 'TEST' && project.testOutcome === 'RUNNING' && (
                          <span className="text-sky-700 text-[10px] animate-pulse">● RUNNING</span>
                        )}
                      </div>

                      {/* Sub-state Nuances (Crucial: Tests PASS != Review PASS) */}
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-500">
                        <span className="text-stone-400">Sub-checks:</span>
                        {project.testOutcome !== 'N/A' && (
                          <span
                            className={
                              project.testOutcome === 'PASS'
                                ? 'text-emerald-700 font-medium'
                                : project.testOutcome === 'FAIL'
                                ? 'text-rose-700 font-bold'
                                : 'text-sky-700'
                            }
                          >
                            Tests:{project.testOutcome}
                          </span>
                        )}
                        {project.reviewOutcome !== 'N/A' && (
                          <span
                            className={
                              project.reviewOutcome === 'APPROVED'
                                ? 'text-emerald-700 font-medium'
                                : project.reviewOutcome === 'CHANGES_REQUIRED'
                                ? 'text-amber-800 font-bold'
                                : 'text-stone-500'
                            }
                          >
                            Review:{project.reviewOutcome === 'CHANGES_REQUIRED' ? 'CHANGES' : project.reviewOutcome}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Column 4: Model Routing */}
                  <td className="py-3 px-3 align-top">
                    <div className="space-y-1">
                      <span
                        className="inline-block text-[11px] font-mono px-2 py-0.5 rounded border"
                        style={{
                          backgroundColor: modelStyle.bg,
                          color: modelStyle.accent,
                          borderColor: modelStyle.border,
                        }}
                      >
                        {project.model}
                      </span>
                      {project.reasoningEffort !== 'None' && (
                        <div className="text-[10px] font-mono text-stone-500">
                          Reasoning: <span className="text-stone-700">{project.reasoningEffort}</span>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Column 5: Environments (Prod & UAT) */}
                  <td className="py-3 px-3 align-top">
                    <div className="space-y-1 text-[11px] font-mono">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-stone-400">Prod:</span>
                        <span
                          className={
                            project.environment.production.status === 'Healthy' || project.environment.production.status === 'Live'
                              ? 'text-emerald-700 font-medium'
                              : project.environment.production.status === 'Not Deployed'
                              ? 'text-stone-400'
                              : 'text-amber-800'
                          }
                        >
                          {project.environment.production.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-stone-400">UAT:</span>
                        <span
                          className={
                            project.environment.uat.status === 'Ready' || project.environment.uat.status === 'Active'
                              ? 'text-emerald-700 font-medium'
                              : project.environment.uat.status === 'Not Deployed'
                              ? 'text-stone-400'
                              : 'text-amber-800'
                          }
                        >
                          {project.environment.uat.status}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Column 6: Blocker / Next Action */}
                  <td className="py-3 px-3 align-top">
                    <div className="max-w-[220px]">
                      {project.blocker ? (
                        <div className="text-[11px] text-amber-900 bg-amber-50/90 p-1.5 rounded border border-amber-200 font-mono leading-tight">
                          <span className="font-bold text-amber-900">Blocker: </span>
                          <span className="line-clamp-2">{project.blocker}</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-stone-600 line-clamp-2 leading-tight">
                          <span className="text-stone-400 font-mono">Next: </span>
                          {project.nextAction}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Column 7: Last Activity & Row Action */}
                  <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="text-right">
                        <span className="text-[11px] font-mono text-stone-500 flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3 text-stone-400" />
                          {project.lastActivity}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-stone-400 group-hover:text-stone-800 transition-colors" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
