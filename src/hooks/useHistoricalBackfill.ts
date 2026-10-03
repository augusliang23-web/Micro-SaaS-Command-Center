import { useCallback, useRef, useState } from 'react';
import { ChangeSummaryRecord, MicroSaaSProject, RecentCommit } from '../types';

export type BackfillRunState = 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'QUOTA_EXHAUSTED';

export interface BackfillRun {
  runId: number;
  projectId: string;
  repository: string;
  done: number;
  total: number;
  state: BackfillRunState;
}

export interface HistoricalBackfill {
  /** The current run, or the last finished one until its result is dismissed. */
  run: BackfillRun | null;
  isRunning: boolean;
  /** Returns false (and does nothing) while another run is still active. */
  start: (project: MicroSaaSProject, commits: RecentCommit[]) => boolean;
  /** Forgets a finished run's result; never touches a running one. */
  clearResult: () => void;
}

// Historical backfill is single-flight across the whole app: each run spends one
// AI call per commit, so only one may exist at a time. It lives above the drawer
// so switching projects hides its progress without forgetting it is running.
export function useHistoricalBackfill(
  onSaveChangeSummary: (projectId: string, record: ChangeSummaryRecord) => void,
): HistoricalBackfill {
  const [run, setRun] = useState<BackfillRun | null>(null);
  // Synchronous execution truth: React state alone would let a double click
  // start two runs before the first re-render.
  const activeRunId = useRef<number | null>(null);
  const nextRunId = useRef(0);
  const onSaveRef = useRef(onSaveChangeSummary);
  onSaveRef.current = onSaveChangeSummary;

  const start = useCallback((project: MicroSaaSProject, commits: RecentCommit[]) => {
    if (activeRunId.current !== null || commits.length === 0) return false;
    const runId = ++nextRunId.current;
    activeRunId.current = runId;
    const total = commits.length;
    const update = (patch: Partial<BackfillRun>) =>
      setRun((prev) => (prev && prev.runId === runId ? { ...prev, ...patch } : prev));
    setRun({ runId, projectId: project.id, repository: project.repository, done: 0, total, state: 'RUNNING' });

    void (async () => {
      let done = 0;
      let quotaExhausted = false;
      try {
        for (const commit of commits) {
          try {
            const res = await fetch('/api/bridge/summarize-changes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repo: project.repository, sha: commit.sha }),
            });
            const data = await res.json();
            if (!res.ok) {
              // The route always answers errors with HTTP 500 and puts Gemini's
              // real status in the message text — see server.ts's friendlyError.
              if (typeof data?.error === 'string' && (data.error.includes('429') || data.error.includes('額度已經用完'))) {
                quotaExhausted = true;
                break;
              }
              continue;
            }
            onSaveRef.current(project.id, {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              refKey: `sha:${commit.sha}`,
              summary: data.summary,
              provider: data.provider,
              fileCount: data.fileCount ?? 0,
              includedLocalDiff: false,
              generatedAt: new Date().toISOString(),
              commitDate: commit.date,
            });
            done += 1;
            update({ done });
          } catch {
            // network error on this one commit — skip it, keep going
          }
        }
      } finally {
        activeRunId.current = null;
        update({ done, state: quotaExhausted ? 'QUOTA_EXHAUSTED' : done < total ? 'PARTIAL' : 'COMPLETED' });
      }
    })();
    return true;
  }, []);

  const clearResult = useCallback(() => {
    setRun((prev) => (prev && prev.state !== 'RUNNING' ? null : prev));
  }, []);

  return { run, isRunning: run?.state === 'RUNNING', start, clearResult };
}
