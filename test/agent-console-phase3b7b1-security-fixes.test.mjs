import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { withFixture, git } from './helpers/phase2Fixture.mjs';
import { WorktreeManager } from '../server/execution/worktreeManager.mjs';
import { computeDiffManifest } from '../server/execution/approvalGate.mjs';
import { ContainerFakeAgentAdapter } from '../server/execution/containerAgentAdapter.mjs';
import { FAKE_AGENT_IMAGE_ALIAS, FAKE_AGENT_IMAGES } from '../server/sandbox/fakeAgentImages.mjs';
import { DockerSandboxRuntime } from '../server/sandbox/dockerSandboxRuntime.mjs';
import { EffectDocker, FIXTURE_CONTENT, expectedTreeFor, makeRuntime, nextRun, spec, withAdapter } from './helpers/dockerPathFixture.mjs';
import { makeScratch } from './helpers/dockerScratch.mjs';
import { TASK_A, fixtureOf, grant, kinds, reasons, remoteBranches, withEngine, worktreeHead, writeFixture } from './helpers/dockerPathEngine.mjs';

const fresh = (s, extra = {}) => spec(s.scratch.wt, { runId: nextRun(), ...extra });
const sh = (cwd, ...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================================================================================================================
// FIX 1 — approvals bind the Git objects that are actually staged, committed and published
// =====================================================================================================================

async function gitSetup(f, taskId = TASK_A, content = FIXTURE_CONTENT(taskId)) {
  const task = f.task(taskId);
  const m = new WorktreeManager({ allowLocalRemotes: true });
  const ctx = await m.prepare(f.project, task);
  const rel = fixtureOf(taskId);
  writeFixture(ctx.worktreePath, taskId, content);
  const manifest = computeDiffManifest({ worktreePath: ctx.worktreePath, paths: await m.changedPaths(ctx), baseSha: ctx.baseSha });
  const treeSha = await m.expectedTree(ctx, manifest);
  return { task, m, ctx, rel, manifest, treeSha, wt: ctx.worktreePath, approved: { manifest, treeSha } };
}
const indexTree = (wt) => sh(wt, 'write-tree');
const baseTreeOf = (g) => sh(g.wt, 'rev-parse', `${g.ctx.baseSha}^{tree}`);
const setFilter = (f) => {
  fs.mkdirSync(path.join(f.source, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(f.source, '.git', 'info', 'attributes'), 'agent-console-fixture/*.txt filter=review-transform\n');
  sh(f.source, 'config', 'filter.review-transform.clean', 'sed s/Deterministic/UNAPPROVED/');
  sh(f.source, 'config', 'filter.review-transform.smudge', 'cat');
};

test('expected tree: computed from the approved bytes and the base tree, equal to real Git for create, modify, delete, nested and mode changes', async () => withFixture(async (f) => {
  const task = f.task(TASK_A);
  const m = new WorktreeManager({ allowLocalRemotes: true });
  const ctx = await m.prepare(f.project, task);
  const wt = ctx.worktreePath;
  const reset = () => { sh(wt, 'checkout', '--', '.'); sh(wt, 'clean', '-fdq'); };
  const oracle = (entries) => expectedTreeFor({ repo: f.source, baseSha: ctx.baseSha, entries });
  const compute = async () => m.expectedTree(ctx, computeDiffManifest({ worktreePath: wt, paths: await m.changedPaths(ctx), baseSha: ctx.baseSha }));

  fs.mkdirSync(path.join(wt, 'a/b'), { recursive: true }); fs.writeFileSync(path.join(wt, 'a/b/new.txt'), 'nested\n');
  assert.equal(await compute(), oracle([{ path: 'a/b/new.txt', content: 'nested\n' }]), 'create nested');
  reset();
  fs.writeFileSync(path.join(wt, 'verify.mjs'), 'changed\n');
  assert.equal(await compute(), oracle([{ path: 'verify.mjs', content: 'changed\n' }]), 'modify');
  reset();
  fs.rmSync(path.join(wt, 'verify.mjs'));
  assert.equal(await compute(), oracle([{ path: 'verify.mjs', deleted: true }]), 'delete');
  reset();
  fs.writeFileSync(path.join(wt, 'tool.sh'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(await compute(), oracle([{ path: 'tool.sh', content: '#!/bin/sh\n', mode: '100755' }]), 'executable');
  reset();
  fs.writeFileSync(path.join(wt, 'x.txt'), 'x'); fs.writeFileSync(path.join(wt, 'y.txt'), 'y'); fs.rmSync(path.join(wt, 'verify.mjs'));
  assert.equal(await compute(), oracle([{ path: 'x.txt', content: 'x' }, { path: 'y.txt', content: 'y' }, { path: 'verify.mjs', deleted: true }]), 'several');
  assert.notEqual(await compute(), ctx.baseSha);
}));

test('expected tree: a different byte, mode or path gives a different tree; the base tree is not the answer', async () => withFixture(async (f) => {
  const g = await gitSetup(f);
  const other = await gitSetup(f, 'CC-20261003-87654321', FIXTURE_CONTENT(TASK_A));
  assert.notEqual(g.treeSha, baseTreeOf(g));
  assert.notEqual(g.treeSha, other.treeSha, 'a different path is a different tree');
  fs.writeFileSync(path.join(g.wt, g.rel), FIXTURE_CONTENT(TASK_A).replace('Deterministic', 'Deterministik'));
  const changed = await g.m.expectedTree(g.ctx, computeDiffManifest({ worktreePath: g.wt, paths: await g.m.changedPaths(g.ctx), baseSha: g.ctx.baseSha }));
  assert.notEqual(changed, g.treeSha);
  await assert.rejects(g.m.expectedTree(g.ctx, { files: [] }), /No approved manifest/);
  await assert.rejects(g.m.expectedTree({}, g.manifest), /Unrecognized/);
  await assert.rejects(g.m.expectedTree(g.ctx, { files: [{ path: 'a.txt', mode: '100644', blob: 'xyz' }] }), /Git mode or blob/);
}));

test('commit: the staged tree and the committed tree are exactly the approved tree, one commit on the base', async () => withFixture(async (f) => {
  const g = await gitSetup(f);
  const sha = await g.m.commitApproved(g.ctx, g.task, f.project, g.approved);
  assert.equal(sh(g.wt, 'rev-parse', 'HEAD'), sha);
  assert.equal(sh(g.wt, 'rev-parse', 'HEAD^{tree}'), g.treeSha);
  assert.equal(g.treeSha, expectedTreeFor({ repo: f.source, baseSha: g.ctx.baseSha, entries: [{ path: g.rel, content: FIXTURE_CONTENT(TASK_A) }] }), 'equal to an independent Git computation');
  assert.equal(sh(g.wt, 'rev-parse', 'HEAD^'), g.ctx.baseSha);
  assert.equal(await g.m.verifyPublished(g.ctx, { treeSha: g.treeSha }), sha);
  assert.equal(sh(g.wt, 'show', `HEAD:${g.rel}`) + '\n', FIXTURE_CONTENT(TASK_A));
}));

test('clean filters, EOL and ident attributes are refused: they could publish bytes nobody approved', async () => {
  for (const [label, attributes, pattern] of [
    ['clean filter', 'agent-console-fixture/*.txt filter=review-transform\n', /Git attribute filter/],
    ['eol conversion', 'agent-console-fixture/*.txt text eol=crlf\n', /Git attribute (text|eol)/],
    ['ident expansion', 'agent-console-fixture/*.txt ident\n', /Git attribute ident/],
    ['working-tree-encoding', 'agent-console-fixture/*.txt working-tree-encoding=UTF-16\n', /Git attribute working-tree-encoding/],
  ]) {
    await withFixture(async (f) => {
      setFilter(f);
      fs.writeFileSync(path.join(f.source, '.git', 'info', 'attributes'), attributes);
      const g = await gitSetup(f);
      await assert.rejects(g.m.commitApproved(g.ctx, g.task, f.project, g.approved), pattern, label);
      assert.equal(worktreeHead(f, TASK_A), g.ctx.baseSha, label);
      assert.equal(indexTree(g.wt), baseTreeOf(g), `${label}: nothing was staged`);
    });
  }
});

test('the reviewed filter attack: a clean filter that rewrites the staged blob never publishes (full Orchestrator run)', async () => withFixture(async (f) => {
  f.task(TASK_A);
  setFilter(f);
  await withEngine(f, {}, async (e) => {
    grant(e, TASK_A, ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], { baseSha: f.baseSha });
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'BLOCKED');
    assert.ok(reasons(f, TASK_A).some((x) => /Git attribute filter/.test(x)), reasons(f, TASK_A).join('|'));
    assert.equal(worktreeHead(f, TASK_A), f.baseSha);
    assert.deepEqual(remoteBranches(f), []);
    assert.ok(!kinds(f, TASK_A).some((k) => ['commit', 'push', 'pr'].includes(k)));
    assert.equal(f.store.get(TASK_A).pr, undefined);
  });
}));

test('index drift: content staged before the approved commit is refused, whether flagged or not, and the index is reset', async () => {
  const cases = [
    ['different blob + assume-unchanged on the approved path', (g) => {
      fs.writeFileSync(path.join(g.wt, g.rel), 'EVIL\n'); sh(g.wt, 'add', '--', g.rel); sh(g.wt, 'update-index', '--assume-unchanged', '--', g.rel);
      fs.writeFileSync(path.join(g.wt, g.rel), FIXTURE_CONTENT(TASK_A));
    }, /Index flag/],
    ['different blob + skip-worktree on the approved path', (g) => {
      fs.writeFileSync(path.join(g.wt, g.rel), 'EVIL\n'); sh(g.wt, 'add', '--', g.rel); sh(g.wt, 'update-index', '--skip-worktree', '--', g.rel);
      fs.writeFileSync(path.join(g.wt, g.rel), FIXTURE_CONTENT(TASK_A));
    }, /Index flag/],
    ['an extra path staged and then removed from the worktree', (g) => {
      fs.writeFileSync(path.join(g.wt, 'evil.txt'), 'EVIL\n'); sh(g.wt, 'add', '--', 'evil.txt'); fs.rmSync(path.join(g.wt, 'evil.txt'));
    }, /Index drift/],
    ['a different blob staged on the approved path (no flag)', (g) => {
      fs.writeFileSync(path.join(g.wt, g.rel), 'EVIL\n'); sh(g.wt, 'add', '--', g.rel);
      fs.writeFileSync(path.join(g.wt, g.rel), FIXTURE_CONTENT(TASK_A));
    }, /Index drift/],
    ['a deletion staged on an unrelated tracked file', (g) => { sh(g.wt, 'rm', '-q', '--cached', '--', 'verify.mjs'); }, /unexpected path/],
  ];
  for (const [label, tamper, pattern] of cases) {
    await withFixture(async (f) => {
      const g = await gitSetup(f);
      tamper(g);
      await assert.rejects(g.m.commitApproved(g.ctx, g.task, f.project, g.approved), pattern, label);
      assert.equal(worktreeHead(f, TASK_A), g.ctx.baseSha, label);
      if (/extra path|no flag/.test(label)) assert.equal(indexTree(g.wt), baseTreeOf(g), `${label}: the index was reset to the base tree`);
    });
  }
});

test('the reviewed index attack: a pre-staged blob with assume-unchanged never publishes (full Orchestrator run)', async () => withFixture(async (f) => {
  f.task(TASK_A);
  const wrap = (base) => ({
    id: base.id, probe: () => base.probe(), cancel: (r) => base.cancel(r),
    start: async (s, emit) => {
      const r = await base.start(s, emit);
      const rel = fixtureOf(TASK_A);
      fs.writeFileSync(path.join(s.worktreePath, rel), 'EVIL\n'); sh(s.worktreePath, 'add', '--', rel); sh(s.worktreePath, 'update-index', '--assume-unchanged', '--', rel);
      fs.writeFileSync(path.join(s.worktreePath, rel), FIXTURE_CONTENT(TASK_A));
      return r;
    },
  });
  await withEngine(f, { wrapAdapter: wrap }, async (e) => {
    grant(e, TASK_A, ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], { baseSha: f.baseSha });
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'BLOCKED');
    assert.equal(worktreeHead(f, TASK_A), f.baseSha);
    assert.deepEqual(remoteBranches(f), []);
    assert.ok(!kinds(f, TASK_A).some((k) => ['commit', 'push', 'pr'].includes(k)));
  });
}));

test('unapproved content: bytes that differ from the approved manifest, or a wrong approved tree, never reach a commit', async () => {
  await withFixture(async (f) => {
    const g = await gitSetup(f);
    fs.writeFileSync(path.join(g.wt, g.rel), FIXTURE_CONTENT(TASK_A).replace('fixture', 'f1xture')); // changed after the tree was computed
    await assert.rejects(g.m.commitApproved(g.ctx, g.task, f.project, g.approved), /Staged tree does not match/);
    assert.equal(worktreeHead(f, TASK_A), g.ctx.baseSha);
    assert.equal(indexTree(g.wt), baseTreeOf(g), 'the index was reset');
  });
  await withFixture(async (f) => {
    const g = await gitSetup(f);
    await assert.rejects(g.m.commitApproved(g.ctx, g.task, f.project, { manifest: g.manifest, treeSha: 'a'.repeat(40) }), /Staged tree does not match/);
    await assert.rejects(g.m.commitApproved(g.ctx, g.task, f.project, { manifest: g.manifest, treeSha: 'nope' }), /approved tree and manifest/);
    await assert.rejects(g.m.commitApproved(g.ctx, g.task, f.project, { manifest: { files: [] }, treeSha: g.treeSha }), /approved tree and manifest/);
    assert.equal(worktreeHead(f, TASK_A), g.ctx.baseSha);
  });
});

test('published commit: anything other than the verified commit on the approved tree is refused', async () => {
  await withFixture(async (f) => {
    const g = await gitSetup(f);
    await g.m.commitApproved(g.ctx, g.task, f.project, g.approved);
    sh(g.wt, 'commit', '--allow-empty', '-m', 'extra commit');
    await assert.rejects(g.m.verifyPublished(g.ctx, { treeSha: g.treeSha }), /HEAD is not the commit that was verified/);
  });
  await withFixture(async (f) => {
    const g = await gitSetup(f);
    await g.m.commitApproved(g.ctx, g.task, f.project, g.approved);
    await assert.rejects(g.m.verifyPublished(g.ctx, { treeSha: 'b'.repeat(40) }), /Committed tree does not match/);
    await assert.rejects(g.m.verifyPublished({}, { treeSha: g.treeSha }), /Unrecognized/);
  });
});

test('published commit: a commit that is not on the base (an orphan with the same tree) is refused', async () => withFixture(async (f) => {
  const g = await gitSetup(f);
  await g.m.commitApproved(g.ctx, g.task, f.project, g.approved);
  const orphan = sh(g.wt, 'commit-tree', g.treeSha, '-m', 'orphan with the approved tree');
  sh(g.wt, 'reset', '--soft', orphan);
  g.ctx.expectedHead = orphan;
  assert.equal(sh(g.wt, 'rev-parse', 'HEAD^{tree}'), g.treeSha);
  await assert.rejects(g.m.verifyPublished(g.ctx, { treeSha: g.treeSha }), /single commit on the base/);
}));

test('a commit that moves HEAD after it was verified is refused before the push approval is spent (full Orchestrator run)', async () => withFixture(async (f) => {
  f.task(TASK_A);
  class Moving extends WorktreeManager {
    async commitApproved(context, task, project, approved) { const sha = await super.commitApproved(context, task, project, approved); sh(context.worktreePath, 'commit', '--allow-empty', '-m', 'late extra commit'); return sha; }
  }
  await withEngine(f, { worktreeManager: new Moving({ allowLocalRemotes: true }) }, async (e) => {
    const made = grant(e, TASK_A, ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], { baseSha: f.baseSha });
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'BLOCKED');
    assert.ok(reasons(f, TASK_A).some((x) => /HEAD is not the commit that was verified/.test(x)), reasons(f, TASK_A).join('|'));
    assert.deepEqual(remoteBranches(f), []);
    assert.ok(!fs.existsSync(path.join(e.approvals.dir, `${made[1].approvalId}.consumed`)), 'the push approval was not spent on an unverified HEAD');
  });
}));

test('approval is bound to the tree: an approval for another tree does not authorize this commit', async () => withFixture(async (f) => {
  f.task(TASK_A);
  await withEngine(f, {}, async (e) => {
    grant(e, TASK_A, ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], { baseSha: f.baseSha, treeSha: 'c'.repeat(40) });
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'BLOCKED');
    assert.equal(f.records.listEvidence(TASK_A).find((x) => x.kind === 'approval_required').data.code, 'APPROVAL_MISMATCH');
    assert.equal(worktreeHead(f, TASK_A), f.baseSha);
  });
}));

// =====================================================================================================================
// FIX 2 — cancellation cannot be overtaken by a container launch
// =====================================================================================================================

function gate() { let release; const promise = new Promise((r) => { release = r; }); let reached; const reachedPromise = new Promise((r) => { reached = r; }); return { promise, release, onReached: reached, reachedPromise }; }
const runtimeSpec = (s, id) => ({ sandboxId: id, role: 'agent', worktreePath: s.scratch.wt, command: ['/bin/true'], policy: { network: 'NO_NETWORK', image: FAKE_AGENT_IMAGE_ALIAS } });

test('the reviewed cancellation race: terminated:true is never followed by a container launch (adapter)', async () => withAdapter(async (s) => {
  const g = gate();
  s.fake.inspectGate = { nth: 2, promise: g.promise, onReached: g.onReached }; // the last inspect before `docker start`
  const sp = fresh(s);
  const running = s.adapter.start(sp, () => {});
  await g.reachedPromise;
  assert.equal(s.fake.callsOf('start').length, 0);
  const c = await s.adapter.cancel(sp.runId);
  assert.equal(c.terminated, true);
  assert.equal(s.fake.callsOf('start').length, 0);
  g.release();
  const r = await running;
  assert.equal(s.fake.callsOf('start').length, 0, 'the container was never launched after the stop was confirmed');
  assert.equal(s.fake.streams.length, 0);
  assert.equal(r.outcome, 'cancelled'); assert.equal(r.reason, 'CANCELLED_BEFORE_LAUNCH'); assert.equal(r.cleanup, 'CONFIRMED'); assert.equal(r.exitCode, null);
  assert.equal(s.fake.containers.size, 0);
  await sleep(20);
  assert.equal(s.fake.callsOf('start').length, 0, 'and never later either');
}));

test('cancellation race at the runtime: stop and destroy fence a pending start', async () => {
  for (const op of ['stop', 'destroy']) {
    const fake = new EffectDocker();
    const rt = makeRuntime({ fake });
    const scratch = makeScratch();
    try {
      const id = nextRun();
      const prepared = await rt.runtime.prepare(runtimeSpec({ scratch }, id));
      assert.equal(prepared.state, 'PREPARED');
      const g = gate();
      fake.inspectGate = { nth: 1, promise: g.promise, onReached: g.onReached }; // armed after prepare: the first inspect-by-id is start()'s pre-launch read
      const starting = rt.runtime.start(id);
      await g.reachedPromise;
      const res = await rt.runtime[op](id);
      assert.equal(res.state, op === 'stop' ? 'STOPPED' : 'DESTROYED');
      g.release();
      const out = await starting;
      assert.equal(out.state, 'BLOCKED', op);
      assert.ok(['CANCELLED_BEFORE_LAUNCH', 'CONTAINER_CHANGED'].includes(out.code), `${op}: ${out.code}`);
      assert.equal(fake.callsOf('start').length, 0, `${op}: no launch`);
      assert.equal(fake.streams.length, 0, `${op}: no stream`);
    } finally { scratch.cleanup(); rt.dispose(); }
  }
});

test('cancellation with a launch already issued: STOPPED only after the launch settles, and a late-starting container is stopped', async () => {
  const fake = new EffectDocker();
  const rt = makeRuntime({ fake, launchSettleMs: 2000 });
  const scratch = makeScratch();
  try {
    const id = nextRun();
    assert.equal((await rt.runtime.prepare(runtimeSpec({ scratch }, id))).state, 'PREPARED');
    let startNow; fake.lateStart = new Promise((r) => { startNow = r; });
    let release; fake.hold = new Promise((r) => { release = r; }); fake.onStop = () => release();
    const starting = rt.runtime.start(id);
    for (let i = 0; i < 200 && fake.callsOf('start').length === 0; i += 1) await sleep(2);
    assert.equal(fake.callsOf('start').length, 1, '`docker start` was issued');
    const container = [...fake.containers.values()][0];
    assert.equal(container.running, false, 'but the container is not running yet, so "not running" proves nothing');
    const stopping = rt.runtime.stop(id);
    await sleep(30);
    startNow(); // the late launch takes effect after the first stop look
    const res = await stopping;
    assert.equal(res.state, 'STOPPED');
    assert.equal(container.running, false, 'the late-started container was stopped');
    assert.ok(fake.callsOf('stop').length >= 1, 'stop had to act on the late launch');
    await starting;
  } finally { scratch.cleanup(); rt.dispose(); }
});

test('cancellation with a launch that never settles is UNKNOWN, not "terminated"', async () => {
  const fake = new EffectDocker();
  const rt = makeRuntime({ fake, launchSettleMs: 120 });
  const adapter = new ContainerFakeAgentAdapter({ runtime: rt.runtime });
  const scratch = makeScratch();
  try {
    let release; fake.hold = new Promise((r) => { release = r; }); fake.lateStart = new Promise(() => {}); // never starts, never ends
    const sp = spec(scratch.wt, { runId: nextRun() });
    const running = adapter.start(sp, () => {});
    for (let i = 0; i < 400 && fake.callsOf('start').length === 0; i += 1) await sleep(2);
    const t0 = Date.now();
    const c = await adapter.cancel(sp.runId);
    assert.equal(c.terminated, false); assert.equal(c.state, 'UNKNOWN');
    assert.ok(Date.now() - t0 >= 100, 'it waited for the bounded settle period');
    release();
    const r = await running;
    assert.notEqual(r.outcome, 'completed', 'the run was never a success');
    assert.equal(c.terminated, false, 'and the caller was told the stop was not confirmed');
  } finally { scratch.cleanup(); rt.dispose(); }
});

// =====================================================================================================================
// FIX 3 — the agent role needs complete, consistent raw execution evidence
// =====================================================================================================================

const afterExit = (damage) => (info) => { if (info.State?.Status === 'exited' && info.Config?.Labels?.['cc.sandbox.role'] === 'agent') damage(info.State, info); };
const DAMAGE = {
  'OOMKilled missing': (st) => { delete st.OOMKilled; },
  'StartedAt missing': (st) => { delete st.StartedAt; },
  'FinishedAt missing': (st) => { delete st.FinishedAt; },
  'ExitCode missing': (st) => { delete st.ExitCode; },
  'Running missing': (st) => { delete st.Running; },
  'Status missing': (st) => { delete st.Status; },
  'OOMKilled wrong type': (st) => { st.OOMKilled = 'false'; },
  'OOMKilled null': (st) => { st.OOMKilled = null; },
  'ExitCode wrong type': (st) => { st.ExitCode = '0'; },
  'ExitCode fractional': (st) => { st.ExitCode = 0.5; },
  'StartedAt garbage': (st) => { st.StartedAt = 'garbage'; },
  'FinishedAt garbage': (st) => { st.FinishedAt = 42; },
  'Docker zero time': (st) => { st.StartedAt = '0001-01-01T00:00:00Z'; },
  'FinishedAt before StartedAt': (st) => { st.FinishedAt = '2020-01-01T00:00:00Z'; },
  'Running true after exit': (st) => { st.Running = true; },
  'Status dead': (st) => { st.Status = 'dead'; },
};

test('the reviewed readback gap: any missing, mistyped or inconsistent raw execution fact is UNKNOWN, with no success evidence', async () => {
  for (const [label, damage] of Object.entries(DAMAGE)) {
    await withAdapter(async (s) => {
      s.fake.mutateInspect = afterExit(damage);
      const r = await s.adapter.start(fresh(s), () => {});
      assert.notEqual(r.outcome, 'completed', label);
      assert.equal(r.outcome, 'unknown', label);
      assert.equal(r.exitCode, null, label);
      assert.ok(!r.container.evidence.some((e) => e.kind === 'sandbox_started'), `${label}: no sandbox_started evidence`);
      assert.ok(!JSON.stringify(r.container.evidence).includes('"oomKilled":false'), `${label}: an unknown OOM flag was never written as false`);
    });
  }
  await withAdapter(async (s) => {
    const r = await s.adapter.start(fresh(s), () => {});
    assert.equal(r.outcome, 'completed');
    const started = r.container.evidence.find((e) => e.kind === 'sandbox_started');
    assert.equal(started.grade, 'LOCALLY_VERIFIED'); assert.equal(started.data.oomKilled, false); assert.equal(started.data.exitCode, 0);
  });
});

test('the runtime itself enforces complete execution readback for the agent role (and inspect reports UNKNOWN)', async () => {
  const fake = new EffectDocker();
  const rt = makeRuntime({ fake });
  const scratch = makeScratch();
  try {
    const id = nextRun();
    assert.equal((await rt.runtime.prepare(runtimeSpec({ scratch }, id))).state, 'PREPARED');
    fake.mutateInspect = afterExit((st) => { delete st.OOMKilled; });
    const out = await rt.runtime.start(id);
    assert.equal(out.state, 'UNKNOWN'); assert.equal(out.code, 'EXECUTION_READBACK_INCOMPLETE'); assert.deepEqual(out.evidence, []);
    assert.equal((await rt.runtime.inspect(id)).state, 'UNKNOWN');
    fake.mutateInspect = null;
  } finally { scratch.cleanup(); rt.dispose(); }
  const fake2 = new EffectDocker();
  const rt2 = makeRuntime({ fake: fake2 });
  const scratch2 = makeScratch();
  try {
    const id = nextRun();
    assert.equal((await rt2.runtime.prepare(runtimeSpec({ scratch: scratch2 }, id))).state, 'PREPARED');
    const ok = await rt2.runtime.start(id);
    assert.equal(ok.state, 'EXITED'); assert.equal(ok.executionReadbackCheck.ok, true); assert.equal(typeof ok.oomKilled, 'boolean');
  } finally { scratch2.cleanup(); rt2.dispose(); }
});

test('the adapter does not trust the runtime blindly: a result without a passing execution check or typed facts is UNKNOWN', async () => {
  const mk = (patch) => async (s) => {
    const inner = s.rt.runtime;
    const runtime = { probe: () => inner.probe(), prepare: (x) => inner.prepare(x), stop: (id) => inner.stop(id), destroy: (id) => inner.destroy(id), start: async (id, o) => ({ ...(await inner.start(id, o)), ...patch }) };
    return new ContainerFakeAgentAdapter({ runtime }).start(fresh(s), () => {});
  };
  for (const [label, patch] of [['no execution check', { executionReadbackCheck: undefined }], ['failed check', { executionReadbackCheck: { ok: false } }], ['oom not boolean', { oomKilled: undefined }], ['oom string', { oomKilled: 'false' }], ['exit code string', { exitCode: '0' }], ['exit code missing', { exitCode: undefined }]]) {
    await withAdapter(async (s) => {
      const r = await mk(patch)(s);
      assert.equal(r.outcome, 'unknown', label); assert.equal(r.reason.includes('EXECUTION_READBACK_INCOMPLETE'), true, label); assert.equal(r.exitCode, null, label);
    });
  }
});

test('a damaged execution readback ends the whole task UNKNOWN: no success evidence, no commit, no approval spent', async () => withFixture(async (f) => {
  f.task(TASK_A);
  const fake = new EffectDocker();
  fake.mutateInspect = afterExit((st) => { delete st.OOMKilled; delete st.StartedAt; delete st.FinishedAt; });
  await withEngine(f, { fake }, async (e) => {
    const made = grant(e, TASK_A, ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], { baseSha: f.baseSha });
    const r = await e.orchestrator.execute(TASK_A);
    assert.equal(r.task.status, 'UNKNOWN');
    assert.equal(f.records.getRun(f.store.get(TASK_A).runIds[0]).status, 'UNKNOWN');
    assert.ok(!kinds(f, TASK_A).includes('sandbox_started'));
    assert.ok(!kinds(f, TASK_A).some((k) => ['commit', 'push', 'pr', 'approval_consumed'].includes(k)));
    assert.equal(worktreeHead(f, TASK_A), f.baseSha);
    assert.deepEqual(remoteBranches(f), []);
    for (const a of made) assert.ok(!fs.existsSync(path.join(e.approvals.dir, `${a.approvalId}.consumed`)));
    assert.ok(!JSON.stringify(f.records.listEvidence(TASK_A)).includes('"oomKilled":false'));
  });
}));

test('scope: the fixes keep the sandbox layer provider-neutral and the Orchestrator free of sandbox, Claude and Codex naming', () => {
  const orch = fs.readFileSync(new URL('../server/execution/orchestrator.mjs', import.meta.url), 'utf8');
  assert.ok(!/sandbox/i.test(orch) && !/claude|codex/i.test(orch));
  assert.ok(DockerSandboxRuntime && FAKE_AGENT_IMAGES);
});
