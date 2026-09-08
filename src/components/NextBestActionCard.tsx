import React, { useEffect, useState } from 'react';
import { MicroSaaSProject, GithubPullStatus } from '../types';
import { isRealGithubRepo } from '../utils';
import { getVerdict, pickMostUrgent } from '../verdict.mjs';
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
  const [githubStates, setGithubStates] = useState<Record<string, GithubPullStatus | null>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const realProjects = projects.filter((p) => isRealGithubRepo(p.repository));
    Promise.all(
      realProjects.map((p) =>
        fetch(`/api/github/pull-status?repo=${encodeURIComponent(p.repository)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => [p.id, data] as const)
          .catch(() => [p.id, null] as const)
      )
    ).then((entries) => {
      if (cancelled) return;
      setGithubStates(Object.fromEntries(entries));
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  if (projects.length === 0) return null;
  if (isLoading) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-5 h-[110px] animate-pulse" />
    );
  }

  const verdicts = projects.map((p) => getVerdict(p, githubStates[p.id] ?? undefined));
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
