import React from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { MicroSaaSProject } from '../types';
import { ProjectVerdictCard } from './ProjectVerdictCard';

interface NeedsAttentionQueueProps {
  projects: MicroSaaSProject[];
  onSelectProject: (project: MicroSaaSProject) => void;
}

export const NeedsAttentionQueue: React.FC<NeedsAttentionQueueProps> = ({ projects, onSelectProject }) => {
  return (
    <section className="bg-white border border-stone-300/90 rounded-xl p-4 sm:p-5 shadow-xs">
      <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-stone-200">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <h2 className="text-sm font-semibold text-stone-900">需要你決定或處理的專案</h2>
        </div>
        <span className="text-xs text-stone-500">
          {projects.length} 個專案在等你
        </span>
      </div>

      {projects.length === 0 ? (
        <div className="py-8 text-center bg-stone-50 rounded-lg border border-dashed border-stone-300">
          <CheckCircle2 className="h-8 w-8 text-emerald-700 mx-auto mb-2 opacity-80" />
          <p className="text-sm font-medium text-stone-800">太好了，目前沒有需要你處理的事</p>
          <p className="text-xs text-stone-500 mt-0.5">所有專案的 AI 都在正常運作，沒有卡住或等你決定的地方。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {projects.map((project) => (
            <ProjectVerdictCard
              key={project.id}
              project={project}
              isSelected={false}
              onSelect={() => onSelectProject(project)}
            />
          ))}
        </div>
      )}
    </section>
  );
};
