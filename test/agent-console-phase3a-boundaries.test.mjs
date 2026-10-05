import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { withFixture } from './helpers/phase2Fixture.mjs';
import { Orchestrator } from '../server/execution/orchestrator.mjs';
import { WorktreeManager } from '../server/execution/worktreeManager.mjs';
import { FakeAdapter } from '../server/execution/fakeAdapter.mjs';
import { FakePrProvider } from '../server/execution/fakePrProvider.mjs';
import { findEscapingSymlinks } from '../server/execution/symlinkGuard.mjs';
import { AGENTS } from '../server/tasks/types.mjs';
import { realTmp } from './helpers/fakeClaude.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'data'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

// ---------- Phase 3A stays unwired ----------

test('unwired: the Orchestrator still fails closed on a claude-code adapter and never touches it', async () => withFixture(async (f) => {
  let probes = 0; let starts = 0;
  const claudeLike = { id: 'claude-code', probe: async () => { probes += 1; return { id: 'claude-code', available: true, version: '1', capabilities: { editOnly: true, shell: false, git: false, network: false } }; }, start: async () => { starts += 1; return { exitCode: 0 }; } };
  const engine = new Orchestrator({ registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: new WorktreeManager({ allowLocalRemotes: true }), adapter: claudeLike, prProvider: new FakePrProvider() });
  const t = f.task();
  const res = await engine.execute(t.taskId);
  assert.equal(res.task.status, 'BLOCKED');
  assert.equal(probes, 0, 'the adapter must not even be probed');
  assert.equal(starts, 0);
  assert.ok(!fs.existsSync(f.worktreeRoot), 'no worktree may be created for a real adapter');
  assert.ok(f.records.listEvidence(t.taskId).some((e) => e.kind === 'guard_violation' && /Phase 2 only permits internal fake/.test(e.data.reason)));
}));

test('unwired: only the adapter and explicit offline CLI harness reference Claude; no run route or UI exists', () => {
  const nonTestFilesMatching = (pattern) => walk(REPO)
    .filter((f) => /\.(mjs|ts|tsx|js|jsx|cjs)$/.test(f))
    .filter((f) => pattern.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(REPO, f))
    .filter((f) => !f.startsWith('test/'))
    .sort();
  // Phase 3B4 adds an operator-invoked diagnostic, never a product import.
  assert.deepEqual(nonTestFilesMatching(/claudeCliAdapter|claudeStreamParser/), ['scripts/claudeLiveSmoke.mjs', 'server/execution/claudeCliAdapter.mjs']);
  assert.deepEqual(nonTestFilesMatching(/claudeLiveSmoke/), [], 'no product module imports the diagnostic');
  // streamingProcess is a generic, provider-neutral, shell-free process runner. Phase 3B2's Docker client reuses it;
  // nothing else may (in particular no route, task or orchestrator code).
  assert.deepEqual(nonTestFilesMatching(/streamingProcess/), ['server/execution/claudeCliAdapter.mjs', 'server/sandbox/dockerClient.mjs']);
  assert.ok(!/execution\//.test(read('server.ts')), 'server.ts must not import the execution layer');
  const routes = read('server/tasks/taskRoutes.mjs');
  assert.deepEqual([...routes.matchAll(/router\.(get|post|put|patch|delete)\('([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`), ['post /', 'get /', 'get /:taskId']);
  assert.ok(!/\/run|execute|spawn/.test(routes.replace(/never spawns/g, '')), 'no run endpoint');
  const ui = walk(path.join(REPO, 'src')).filter((f) => /\.(tsx?|mjs)$/.test(f) && !/\.test\./.test(f));
  assert.ok(!ui.some((f) => /\/api\/tasks|claude-code adapter|Run Task/.test(fs.readFileSync(f, 'utf8'))), 'no UI starts an agent');
});

test('unwired: the browser-selectable agent list is unchanged and never offers the fake adapter', () => {
  assert.deepEqual([...AGENTS], ['claude-code', 'codex']);
  assert.ok(!AGENTS.includes('fake'));
  assert.equal(new FakeAdapter().id, 'fake');
});

test('the Orchestrator source still contains the fake-only gate and no Claude reference', () => {
  const source = read('server/execution/orchestrator.mjs');
  assert.match(source, /this\.#adapter\.id !== 'fake'/);
  assert.ok(!/claude/i.test(source));
});

// ---------- Phase 2 regression (the full Phase 2 suites also run in `npm test`) ----------

test('phase 2 regression: the Fake Adapter pipeline still completes unchanged', async () => withFixture(async (f) => {
  const engine = new Orchestrator({ registry: f.registry, taskStore: f.store, executionStore: f.records, worktreeManager: new WorktreeManager({ allowLocalRemotes: true }), adapter: new FakeAdapter(), prProvider: new FakePrProvider() });
  const t = f.task();
  const res = await engine.execute(t.taskId);
  assert.equal(f.store.get(t.taskId).status, 'COMPLETED');
  assert.equal(res.verificationPassed, true);
  const run = f.records.getRun(f.store.get(t.taskId).runIds[0]);
  assert.equal(run.agent, 'fake');
  assert.equal(run.usage.costUsd, null);
}));

test('phase 2 regression: the Fake-only path guard is still in the worktree manager', () => {
  assert.match(read('server/execution/worktreeManager.mjs'), /file !== context\.fixturePath/);
});

// ---------- Symlink escape helper (Phase 3B gate, unwired) ----------

test('symlink guard: finds links that leave the worktree and ignores safe ones and .git', () => {
  const root = realTmp('cc-p3a-sym-');
  const outside = realTmp('cc-p3a-outside-');
  try {
    const wt = path.join(root, 'wt');
    fs.mkdirSync(path.join(wt, 'src/deep'), { recursive: true });
    fs.mkdirSync(path.join(wt, '.git'));
    fs.writeFileSync(path.join(wt, 'src/real.txt'), 'x');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    fs.symlinkSync('real.txt', path.join(wt, 'src/safe-relative'));
    fs.symlinkSync('../real.txt', path.join(wt, 'src/deep/safe-up'));
    fs.symlinkSync(path.join(wt, 'src/real.txt'), path.join(wt, 'safe-absolute-inside'));
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(wt, 'abs-escape'));
    fs.symlinkSync('../../../outside-rel', path.join(wt, 'src/deep/rel-escape'));
    fs.symlinkSync(outside, path.join(wt, 'dir-escape'));
    fs.symlinkSync('missing-target', path.join(wt, 'dangling'));
    fs.symlinkSync(outside, path.join(wt, '.git/ignored-metadata-link'));
    // A chain whose first hop stays inside but whose final target is outside.
    fs.symlinkSync('dir-escape', path.join(wt, 'chain-hop'));
    const res = findEscapingSymlinks(wt);
    assert.equal(res.ok, false);
    assert.deepEqual(res.escapes.map((e) => `${e.path}:${e.reason}`), [
      'abs-escape:ABSOLUTE_TARGET_OUTSIDE',
      'chain-hop:CHAIN_ESCAPES',
      'dangling:DANGLING',
      'dir-escape:ABSOLUTE_TARGET_OUTSIDE',
      'src/deep/rel-escape:TARGET_OUTSIDE',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('symlink guard: a clean tree passes, non-canonical roots are rejected, huge trees fail closed', () => {
  const root = realTmp('cc-p3a-sym2-');
  try {
    fs.mkdirSync(path.join(root, 'a'));
    for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(root, 'a', `f${i}`), 'x');
    assert.deepEqual(findEscapingSymlinks(root), { ok: true, escapes: [], scanned: 6 });
    assert.equal(findEscapingSymlinks(root, { maxEntries: 3 }).reason, 'TOO_MANY_ENTRIES');
    const link = `${root}-link`;
    fs.symlinkSync(root, link);
    try { assert.throws(() => findEscapingSymlinks(link), /canonical/); } finally { fs.rmSync(link); }
    assert.throws(() => findEscapingSymlinks('relative'), /absolute/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
