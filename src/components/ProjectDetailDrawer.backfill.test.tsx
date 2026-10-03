import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { initialProjects } from '../mockData';
import { MicroSaaSProject } from '../types';
import { ProjectDetailDrawer } from './ProjectDetailDrawer';

const real = (id: string): MicroSaaSProject => ({ ...initialProjects[0], id, name: id, repository: `owner/${id}`, changeSummaries: [] });
const commits = (repo: string) => ({
  commits: [{ sha: `${repo}-sha`, message: `${repo} commit`, date: '2026-09-01T00:00:00Z', url: `https://github.com/owner/${repo}/commit/1` }],
});
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
const drawer = (project: MicroSaaSProject) => (
  <ProjectDetailDrawer
    project={project}
    onClose={vi.fn()}
    onResolveBlocker={vi.fn()}
    onApproveCurrentGate={vi.fn()}
    onAdvanceToNextGate={vi.fn()}
  />
);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('backfill candidates are cleared when the drawer switches project', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(commits('alpha')));
  const { rerender } = render(drawer(real('alpha')));
  fireEvent.click(screen.getByRole('button', { name: '回溯摘要更早的紀錄' }));
  expect(await screen.findByText(/alpha commit/)).toBeInTheDocument();

  rerender(drawer(real('beta')));
  expect(screen.queryByText(/alpha commit/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '回溯摘要更早的紀錄' })).toBeEnabled();
});

test("a candidate lookup that finishes after a project switch never shows in the new project's drawer", async () => {
  let finish!: (r: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const { rerender } = render(drawer(real('alpha')));
  fireEvent.click(screen.getByRole('button', { name: '回溯摘要更早的紀錄' }));
  expect(screen.getByRole('button', { name: '尋找中…' })).toBeDisabled();

  rerender(drawer(real('beta')));
  finish(response(commits('alpha')));
  await new Promise((r) => setTimeout(r, 0));

  expect(screen.queryByText(/alpha commit/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '開始摘要' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '回溯摘要更早的紀錄' })).toBeEnabled();
});
