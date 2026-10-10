import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { FakeDocker } from './fakeDocker.mjs';
import { makeScratch, realTmp } from './dockerScratch.mjs';
import { DockerSandboxRuntime } from '../../server/sandbox/dockerSandboxRuntime.mjs';
import { FAKE_AGENT_IMAGES } from '../../server/sandbox/fakeAgentImages.mjs';
import { ContainerFakeAgentAdapter } from '../../server/execution/containerAgentAdapter.mjs';
import { ApprovalGate, ApprovalStore, diffDigestOf } from '../../server/execution/approvalGate.mjs';

/**
 * Fake Docker whose "container" can have an effect on the host workspace (what a real container's bind-mounted writes would be),
 * and whose start can be held open so cancellation can be exercised. No Docker daemon is contacted; this is an in-memory fake.
 */
export class EffectDocker extends FakeDocker {
  effect = null; // (workspaceSourcePath, container) => void, runs when the container "starts"
  hold = null; // Promise gating the container run (for cancellation tests)
  holdCreate = null; // Promise gating `docker create`
  ignoreRm = false; // rm silently does nothing (destroy cannot be confirmed)
  onStop = null;
  inspectGate = null; // { nth, promise, onReached }: pause the nth inspect-by-container-id AFTER its answer was computed
  lateStart = null; // Promise: `docker start` was issued but the container only becomes Running once this resolves
  idInspects = 0;

  async run(args, ...rest) {
    if (args[0] === 'create' && this.holdCreate) await this.holdCreate;
    if (args[0] === 'rm' && this.ignoreRm) { this.calls.push([...args]); return { exitCode: 0, stdout: '', stderr: '', spawnError: null, timedOut: false }; }
    const result = await super.run(args, ...rest);
    if (args[0] === 'stop' || args[0] === 'kill') this.onStop?.();
    if (args[0] === 'inspect' && this.inspectGate && /^[0-9a-f]{64}$/.test(args.at(-1))) {
      this.idInspects += 1;
      if (this.idInspects === this.inspectGate.nth) { this.inspectGate.onReached?.(); await this.inspectGate.promise; }
    }
    return result;
  }

  stream(args, opts = {}) {
    const container = this.find(args.at(-1));
    if (container && this.effect) {
      const ws = container.mounts.find((m) => m.destination === '/workspace');
      this.effect(ws?.source, container);
    }
    if (!this.hold) return super.stream(args, opts);
    this.calls.push([...args]);
    this.streams.push({ args: [...args], timeoutMs: opts.timeoutMs, limits: opts.limits });
    if (container) container.running = !this.lateStart;
    if (container && this.lateStart) this.lateStart.then(() => { container.running = true; });
    const done = this.hold.then(() => {
      if (container) { container.running = false; container.exitCode = 137; }
      return { spawnError: null, exitCode: 137, signal: null, exitObserved: true, stderr: '', limit: null, terminateReason: null };
    });
    return { pid: undefined, cancel: () => {}, done };
  }
}

export function makeRuntime({ fake = new EffectDocker(), images = FAKE_AGENT_IMAGES, homeDir, commandCenterRoot = process.cwd(), launchSettleMs } = {}) {
  const stateRoot = realTmp('cc-p3b7b1-state-');
  const runtime = new DockerSandboxRuntime({ docker: fake, images, stateRoot, commandCenterRoot, ...(homeDir ? { homeDir } : {}), ...(launchSettleMs ? { launchSettleMs } : {}), user: { uid: 501, gid: 20 } });
  return { fake, runtime, stateRoot, dispose: () => { runtime.dispose(); } };
}

export const TASK = 'CC-20261003-12345678';
export const RUN = 'RUN-20261003-abcdef01';
export const spec = (worktreePath, extra = {}) => ({ taskId: TASK, runId: RUN, worktreePath, fixturePath: `agent-console-fixture/${TASK}.txt`, ...extra });

let counter = 0;
export const nextRun = () => `RUN-20261003-${(0xabc000 + counter++).toString(16).padStart(8, '0')}`;

/** Adapter + runtime + a real scratch git worktree (the existing makeScratch helper). */
export function adapterSetup({ scenario = 'edit-fixture', fake = new EffectDocker(), limits, images, launchSettleMs } = {}) {
  const scratch = makeScratch();
  const rt = makeRuntime({ fake, ...(images ? { images } : {}), ...(launchSettleMs ? { launchSettleMs } : {}) });
  const adapter = new ContainerFakeAgentAdapter({ runtime: rt.runtime, scenario, ...(limits ? { limits } : {}) });
  return { fake, scratch, rt, adapter, done: () => { rt.dispose(); scratch.cleanup(); } };
}

export async function withAdapter(fn, options) {
  const s = adapterSetup(options);
  try { return await fn(s); } finally { s.done(); }
}

// ---- Approval helpers --------------------------------------------------------------------------------------------

export const FIXTURE_CONTENT = (taskId) => `Task ${taskId}\nDeterministic Fake Adapter fixture\n`;
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const expectedFixtureDigest = (taskId, content = FIXTURE_CONTENT(taskId)) => diffDigestOf([
  { path: `agent-console-fixture/${taskId}.txt`, sha256: sha256(content), size: Buffer.byteLength(content), exec: false },
]);
export const branchOf = (taskId, slug = 'fixture-edit') => `agent/${taskId}-${slug}`;

export function makeClock(startIso = '2026-10-10T00:00:00.000Z') {
  let t = Date.parse(startIso);
  const clock = () => new Date(t).toISOString();
  clock.advance = (ms) => { t += ms; };
  clock.set = (iso) => { t = Date.parse(iso); };
  return clock;
}

export function approvalSetup({ clock = makeClock() } = {}) {
  const dir = path.join(realTmp('cc-p3b7b1-approvals-'), 'approvals');
  const store = new ApprovalStore({ dir, now: clock });
  const gate = new ApprovalGate({ store });
  return { dir, store, gate, clock, done: () => fs.rmSync(path.dirname(dir), { recursive: true, force: true }) };
}

export const tmpHome = () => { const home = realTmp('cc-p3b7b1-home-'); return { home, done: () => fs.rmSync(home, { recursive: true, force: true }) }; };
export { os, path, fs };

/**
 * Independent oracle for the Git tree an approved change must produce: real `git` in a scratch index (GIT_INDEX_FILE), the blob id
 * from `git hash-object` (not the production code's own SHA-1). Used to pre-grant approvals the way a reviewer would.
 */
export function expectedTreeFor({ repo, baseSha, entries }) {
  const indexFile = path.join(realTmp('cc-p3b7b1-oracle-'), 'index');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_INDEX_FILE: indexFile };
  const git = (args, input) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  try {
    git(['read-tree', baseSha]);
    for (const e of entries) {
      if (e.deleted) { git(['update-index', '--force-remove', '--', e.path]); continue; }
      const blob = git(['hash-object', '--stdin'], e.content);
      git(['update-index', '--add', '--cacheinfo', `${e.mode ?? '100644'},${blob},${e.path}`]);
    }
    return git(['write-tree', '--missing-ok']);
  } finally { fs.rmSync(path.dirname(indexFile), { recursive: true, force: true }); }
}
