import { useEffect, useState } from 'react';
import { MicroSaaSProject, GithubPullStatus } from '../types';
import { isRealGithubRepo } from '../utils';
import { getVerdict } from '../verdict.mjs';

export interface Verdict {
  level: 'danger' | 'decision' | 'ready' | 'waiting';
  headline: string;
  explanation: string;
  actionLabel: string;
  hasAction: boolean;
  isWaiting: boolean;
  source: 'manual' | 'github';
}

/**
 * Scans every project's real (or manual-fallback) verdict in parallel —
 * shared by any screen that needs to reason about verdicts across the whole
 * portfolio at once (Next Best Action, Needs Attention, the execution
 * snapshot counts), not just one project at a time like `ProjectVerdictCard`
 * does internally.
 */
export function useProjectVerdicts(projects: MicroSaaSProject[]): { verdicts: Verdict[]; isLoading: boolean } {
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

  const verdicts = projects.map((p) => getVerdict(p, githubStates[p.id] ?? undefined) as Verdict);
  return { verdicts, isLoading };
}
