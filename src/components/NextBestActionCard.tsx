import React from 'react';
import { MicroSaaSProject } from '../types';
import { pickMostUrgent } from '../verdict.mjs';
import { useProjectVerdicts } from '../hooks/useProjectVerdicts';
import { ProjectVerdictCard } from './ProjectVerdictCard';

interface NextBestActionCardProps {
  projects: MicroSaaSProject[];
  onSelectProject: (project: MicroSaaSProject) => void;
}

/**
 * Scans every project's real (or manual-fallback) verdict and surfaces the
 * single most urgent one — replaces the old standalone, hand-authored
 * NextBestAction fixture that never changed no matter what was actually
 * happening in any project.
 */
export const NextBestActionCard: React.FC<NextBestActionCardProps> = ({ projects, onSelectProject }) => {
  const { verdicts, isLoading } = useProjectVerdicts(projects);

  if (projects.length === 0) return null;
  if (isLoading) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-5 h-[110px] animate-pulse" />
    );
  }

  const topIndex = pickMostUrgent(verdicts);
  if (topIndex === -1) return null;
  const topProject = projects[topIndex];

  return (
    <ProjectVerdictCard
      project={topProject}
      isSelected={false}
      onSelect={() => onSelectProject(topProject)}
      eyebrow={
        projects.length > 1
          ? `🎯 在 ${projects.length} 個專案中，這個最需要你注意`
          : '🎯 最需要你注意的專案'
      }
    />
  );
};
