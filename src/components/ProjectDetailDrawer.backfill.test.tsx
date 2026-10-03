import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { initialProjects } from '../mockData';
import { MicroSaaSProject, RecentCommit } from '../types';
import { useHistoricalBackfill } from '../hooks/useHistoricalBackfill';
import { ProjectDetailDrawer } from './ProjectDetailDrawer';

const real = (id: string): MicroSaaSProject => ({ ...initialProjects[0], id, name: id, repository: `owner/${id}`, changeSummaries: [] });
const commit = (sha: string): RecentCommit => ({ sha, message: `${sha} commit`, date: '2026-09-01T00:00:00Z', url: `https://github.com/owner/x/commit/${sha}` });
const ok = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
const failed = { ok: false, json: async () => ({ error: 'boom' }) } as Response;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// Fake server: candidate lookups answer immediately; each summarize call stays
// pending until the test releases it, so a run can be caught mid-flight.
let commitsByRepo: Record<string, RecentCommit[]>;
let lookups: string[];
let summarizeCalls: string[];
let pending: { sha: string; resolve: (r: Response) => void }[];
beforeEach(() => {
  commitsByRepo = { alpha: [commit('a1'), commit('a2')], beta: [commit('b1')] };
  lookups = [];
  summarizeCalls = [];
  pending = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (url.startsWith('/api/github/recent-commits')) {
      const repo = new URL(url, 'http://test').searchParams.get('repo')!.split('/')[1];
      lookups.push(repo);
      return Promise.resolve(ok({ commits: commitsByRepo[repo] }));
    }
    if (url === '/api/bridge/summarize-changes') {
      const { sha } = JSON.parse(String(init?.body));
      summarizeCalls.push(sha);
      return new Promise<Response>((resolve) => pending.push({ sha, resolve }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const release = async (result: (sha: string) => Response = () => ok({ summary: 's', provider: 'test', fileCount: 1 })) => {
  const next = pending.shift()!;
  next.resolve(result(next.sha));
  await flush();
};

// Mirrors App: the backfill hook sits above the drawer and saves into projects.
function Harness({ projectId, saves }: { projectId: string; saves: string[] }) {
  const [projects, setProjects] = useState([real('alpha'), real('beta')]);
  const backfill = useHistoricalBackfill((id, record) => {
    saves.push(record.refKey);
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, changeSummaries: [...(p.changeSummaries || []), record] } : p)));
  });
  return (
    <ProjectDetailDrawer
      project={projects.find((p) => p.id === projectId)!}
      onClose={vi.fn()}
      onResolveBlocker={vi.fn()}
      onApproveCurrentGate={vi.fn()}
      onAdvanceToNextGate={vi.fn()}
      backfill={backfill}
    />
  );
}

const findButton = () => screen.queryByRole('button', { name: '回溯摘要更早的紀錄' });
const startRun = async () => {
  fireEvent.click(findButton()!);
  fireEvent.click(await screen.findByRole('button', { name: '開始摘要' }));
  await flush();
};

test('A: switching away and back keeps the original run visible and blocks a second run', async () => {
  const saves: string[] = [];
  const { rerender } = render(<Harness projectId="alpha" saves={saves} />);
  await startRun();
  expect(screen.getByText(/回溯摘要中… 0 \/ 2/)).toBeInTheDocument();

  rerender(<Harness projectId="beta" saves={saves} />);
  expect(screen.getByText('另一個專案正在回溯摘要，完成後才能開始新的回溯。')).toBeInTheDocument();
  expect(findButton()).toBeDisabled();
  fireEvent.click(findButton()!);

  await release();
  rerender(<Harness projectId="alpha" saves={saves} />);
  expect(screen.getByText(/回溯摘要中… 1 \/ 2/)).toBeInTheDocument();
  expect(findButton()).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '開始摘要' })).not.toBeInTheDocument();
  expect(lookups).toEqual(['alpha']);
  expect(summarizeCalls).toEqual(['a1', 'a2']);
  await release();
});

test('B: an unfinished run plus repeated UI attempts never summarizes the same SHA twice', async () => {
  const saves: string[] = [];
  const { rerender } = render(<Harness projectId="alpha" saves={saves} />);
  await startRun();
  for (const id of ['beta', 'alpha', 'beta', 'alpha']) {
    rerender(<Harness projectId={id} saves={saves} />);
    const button = findButton();
    if (button) fireEvent.click(button);
    await flush();
  }
  while (pending.length) await release();

  expect(summarizeCalls).toEqual(['a1', 'a2']);
  expect(saves).toEqual(['sha:a1', 'sha:a2']);
  expect(lookups).toEqual(['alpha']);
});

test('B: start() is single-flight even when called twice before React re-renders', () => {
  const { result } = renderHook(() => useHistoricalBackfill(vi.fn()));
  let first = false;
  let second = true;
  act(() => {
    first = result.current.start(real('alpha'), [commit('a1')]);
    second = result.current.start(real('alpha'), [commit('a1')]);
  });
  expect([first, second]).toEqual([true, false]);
  expect(summarizeCalls).toEqual(['a1']);
});

test('C: backfill candidates are cleared when the drawer switches project', async () => {
  const saves: string[] = [];
  const { rerender } = render(<Harness projectId="alpha" saves={saves} />);
  fireEvent.click(findButton()!);
  expect(await screen.findByText(/a1 commit/)).toBeInTheDocument();

  rerender(<Harness projectId="beta" saves={saves} />);
  expect(screen.queryByText(/a1 commit/)).not.toBeInTheDocument();
  expect(findButton()).toBeEnabled();
});

test("C: a candidate lookup that finishes after a project switch never shows in the new project's drawer", async () => {
  let finish!: (r: Response) => void;
  vi.mocked(globalThis.fetch).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const saves: string[] = [];
  const { rerender } = render(<Harness projectId="alpha" saves={saves} />);
  fireEvent.click(findButton()!);
  expect(screen.getByRole('button', { name: '尋找中…' })).toBeDisabled();

  rerender(<Harness projectId="beta" saves={saves} />);
  finish(ok({ commits: [commit('a1')] }));
  await flush();

  expect(screen.queryByText(/a1 commit/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '開始摘要' })).not.toBeInTheDocument();
  expect(findButton()).toBeEnabled();
});

test('D: after a partial run ends, a retry offers only the failed SHA and may run', async () => {
  commitsByRepo.alpha = [commit('a1'), commit('a2'), commit('a3')];
  const saves: string[] = [];
  render(<Harness projectId="alpha" saves={saves} />);
  await startRun();
  await release();
  await release(() => failed);
  await release();
  expect(screen.getByText(/已經補了 2／3 筆/)).toBeInTheDocument();

  await startRun();
  expect(summarizeCalls).toEqual(['a1', 'a2', 'a3', 'a2']);
  expect(screen.getByText(/回溯摘要中… 0 \/ 1/)).toBeInTheDocument();
  await release();

  expect(saves).toEqual(['sha:a1', 'sha:a3', 'sha:a2']);
  fireEvent.click(findButton()!);
  expect(await screen.findByText('目前沒有遺漏的舊紀錄了，每一筆都已經摘要過。')).toBeInTheDocument();
});
