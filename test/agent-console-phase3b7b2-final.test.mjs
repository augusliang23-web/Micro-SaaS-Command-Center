import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { preflight } from './helpers/dockerPreflight.mjs';
import { PINNED_REF, UnknownOutcomeError, createHarness, createSuiteGuard, endToEnd, rawReadbackReal } from './helpers/realDockerScenarios.mjs';
import { EffectDocker } from './helpers/dockerPathFixture.mjs';
import { withFixture } from './helpers/phase2Fixture.mjs';
import { TEST_IMAGES } from '../server/sandbox/sandboxImages.mjs';

// OFFLINE ONLY. Final PR #26 harness fixes: (A) the read-only Docker preflight must make a valid daemon + pinned image RUNNABLE,
// skip on expected unavailability and never swallow a programming error; (B) the end-to-end fixture must outlive an UNKNOWN cleanup
// and be removed only after exact owned-container absence is proven.

// =====================================================================================================================
// A. preflight
// =====================================================================================================================

const entry = TEST_IMAGES['busybox-test'];
const okVersion = { exitCode: 0, stdout: JSON.stringify({ Version: '29.8.2', Os: 'linux', Arch: 'arm64' }), stderr: '', spawnError: null, timedOut: false };
const okImage = { exitCode: 0, stdout: JSON.stringify({ Id: entry.digest, Os: entry.os, Architecture: entry.arch, RepoDigests: [entry.reference] }), stderr: '', spawnError: null, timedOut: false };
const noImage = { exitCode: 1, stdout: '', stderr: 'Error response from daemon: No such image', spawnError: null, timedOut: false };
const mock = ({ version = okVersion, image = okImage } = {}) => ({
  calls: [],
  async run(args) { this.calls.push(args[0]); return args[0] === 'version' ? version : image; },
  stream() { throw new Error('preflight must never stream'); },
});
const tmpPreflightDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('cc-p3b7b2-preflight-')).length;

test('preflight: a valid daemon and the pinned image make the suite RUNNABLE (this is the exact regression: the constructor must not throw)', async () => {
  const inner = mock();
  const r = await preflight({ inner, imageRef: PINNED_REF });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(inner.calls, ['version', 'image'], 'exactly two read-only calls');
  assert.deepEqual(r.calls.map((c) => c.verb), ['version', 'image-inspect']);
});

test('preflight: the same result through the in-memory fake Docker client used by the dry runs', async () => {
  const r = await preflight({ inner: new EffectDocker(), imageRef: PINNED_REF });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('preflight is read-only: no create, start, stop, kill or rm is ever issued, and its temporary directory is removed', async () => {
  const before = tmpPreflightDirs();
  for (const inner of [mock(), mock({ version: { ...okVersion, exitCode: 1 } }), mock({ image: noImage })]) {
    await preflight({ inner, imageRef: PINNED_REF });
    assert.ok(inner.calls.every((c) => ['version', 'image'].includes(c)), inner.calls.join());
  }
  const fake = new EffectDocker();
  await preflight({ inner: fake, imageRef: PINNED_REF });
  assert.deepEqual(fake.names.filter((n) => !['version', 'image'].includes(n)), [], 'only version and image inspect reached the client');
  assert.equal(fake.containers.size, 0);
  assert.equal(tmpPreflightDirs(), before, 'no preflight directory is left behind');
});

test('preflight: a missing daemon or image is a SKIP with a visible reason — not a failure and not a throw', async () => {
  const cases = [
    ['daemon spawn error', mock({ version: { exitCode: null, stdout: '', stderr: '', spawnError: new Error('ENOENT'), timedOut: false } }), 'DOCKER_DAEMON_UNAVAILABLE'],
    ['daemon exits non-zero', mock({ version: { ...okVersion, exitCode: 1, stdout: '' } }), 'DOCKER_DAEMON_UNAVAILABLE'],
    ['daemon times out', mock({ version: { ...okVersion, timedOut: true } }), 'DOCKER_DAEMON_UNAVAILABLE'],
    ['not a Linux engine', mock({ version: { ...okVersion, stdout: JSON.stringify({ Os: 'windows' }) } }), 'DOCKER_ENGINE_NOT_LINUX'],
    ['unparseable version output', mock({ version: { ...okVersion, stdout: 'not json' } }), 'DOCKER_VERSION_OUTPUT_UNPARSEABLE'],
    ['pinned image missing', mock({ image: noImage }), 'PINNED_IMAGE_MISSING'],
    ['image inspect spawn error', mock({ image: { ...noImage, spawnError: new Error('x') } }), 'PINNED_IMAGE_MISSING'],
    ['image output unparseable', mock({ image: { ...okImage, stdout: '<html>' } }), 'IMAGE_OUTPUT_UNPARSEABLE'],
    ['wrong digest', mock({ image: { ...okImage, stdout: JSON.stringify({ Os: 'linux', Architecture: entry.arch, RepoDigests: [`busybox@sha256:${'0'.repeat(64)}`] }) } }), 'PINNED_IMAGE_MISMATCHED'],
    ['wrong platform', mock({ image: { ...okImage, stdout: JSON.stringify({ Os: 'linux', Architecture: 'amd64', RepoDigests: [entry.reference] }) } }), 'PINNED_IMAGE_MISMATCHED'],
    ['wrong os', mock({ image: { ...okImage, stdout: JSON.stringify({ Os: 'windows', Architecture: entry.arch, RepoDigests: [entry.reference] }) } }), 'PINNED_IMAGE_MISMATCHED'],
    ['no repo digests', mock({ image: { ...okImage, stdout: JSON.stringify({ Os: 'linux', Architecture: entry.arch }) } }), 'PINNED_IMAGE_MISMATCHED'],
  ];
  for (const [label, inner, reason] of cases) {
    const r = await preflight({ inner, imageRef: PINNED_REF });
    assert.equal(r.ok, false, label); assert.equal(r.reason, reason, label);
  }
});

test('preflight: programming errors are NEVER reported as "unavailable" — they fail loudly', async () => {
  await assert.rejects(preflight({ inner: { run: async () => { throw new TypeError('inner exploded'); }, stream() {} }, imageRef: PINNED_REF }), TypeError);
  await assert.rejects(preflight({ inner: {}, imageRef: PINNED_REF }), /inner docker client is required/);
  await assert.rejects(preflight({ inner: mock(), imageRef: 'busybox:latest' }), /pinned image reference is required/);
  await assert.rejects(preflight({ inner: mock(), imageRef: PINNED_REF, stateRoot: 'relative/path' }), /state root is required/);
  await assert.rejects(preflight({ inner: undefined, imageRef: PINNED_REF }), /inner docker client is required/);
});

test('inspection: the integration file uses preflight() and has no blanket catch that could hide a programming error', () => {
  const src = fs.readFileSync(new URL('./agent-console-phase3b7b2-docker.integration.test.mjs', import.meta.url), 'utf8');
  assert.match(src, /await preflight\(\{ inner: mkInner\(\), imageRef: PINNED_REF \}\)/);
  assert.ok(!/new OwnedDocker\(/.test(src), 'the file does not construct OwnedDocker itself');
  assert.ok(!/DOCKER_PROBE_FAILED/.test(src), 'no catch-all "probe failed" classification remains');
  assert.ok(!/try \{[^}]*preflight|catch \{ probe/.test(src));
  assert.match(src, /const skip = probe\.ok \? false :/);
});

// =====================================================================================================================
// B. fixture lifetime
// =====================================================================================================================

const decoyRoot = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p2-integration-decoy-')); fs.writeFileSync(path.join(d, 'keep.txt'), 'unrelated'); return d; };
const sentinel = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p3b7b2-sentinel-')); fs.writeFileSync(path.join(d, 'keep.txt'), 'unrelated'); return d; };

test('shared Phase 2 fixture: default behaviour is unchanged (always removed, even when the body throws); preservation is opt-in', async () => {
  let root;
  await withFixture(async (f) => { root = f.root; assert.ok(fs.existsSync(f.source)); });
  assert.equal(fs.existsSync(root), false, 'default: removed after success');
  await assert.rejects(withFixture(async (f) => { root = f.root; throw new Error('body failed'); }), /body failed/);
  assert.equal(fs.existsSync(root), false, 'default: removed after a throw');
  await withFixture(async (f) => { root = f.root; }, {}, {});
  assert.equal(fs.existsSync(root), false, 'empty options: removed');
  await withFixture(async (f) => { root = f.root; }, {}, { keepRoot: () => false });
  assert.equal(fs.existsSync(root), false, 'keepRoot false: removed');
  await withFixture(async (f) => { root = f.root; }, {}, { keepRoot: 'yes' });
  assert.equal(fs.existsSync(root), false, 'a non-function is ignored: removed');
  await withFixture(async (f) => { root = f.root; }, {}, { keepRoot: () => 'true' });
  assert.equal(fs.existsSync(root), false, 'only a strict true preserves');
  await withFixture(async (f) => { root = f.root; }, {}, { keepRoot: () => true });
  assert.equal(fs.existsSync(root), true, 'keepRoot true: preserved');
  fs.rmSync(root, { recursive: true, force: true });
});

test('end to end, cleanup CONFIRMED: the synthetic fixture and approvals are removed — and nothing unrelated is touched', async () => {
  const keep = [sentinel(), decoyRoot()];
  const h = createHarness({ inner: new EffectDocker(), mode: 'dry' });
  const scratch = h.newScratch();
  try {
    await endToEnd(h);
    assert.equal(h.fixtureRoots.length, 1);
    assert.equal(fs.existsSync(h.fixtureRoots[0]), false, 'the fixture root was removed after absence was proven');
    assert.deepEqual(h.preserved, []);
    for (const k of keep) assert.ok(fs.existsSync(path.join(k, 'keep.txt')), `unrelated resource kept: ${k}`);
    assert.ok(fs.existsSync(scratch.wt), 'another scratch workspace of the same harness is untouched');
    assert.deepEqual(await h.dispose(), []);
  } finally { for (const k of keep) fs.rmSync(k, { recursive: true, force: true }); scratch.cleanup(); }
});

test('end to end, cleanup UNCONFIRMED: the fixture (worktree, git repositories, evidence) and approvals are PRESERVED, and the outcome is UNKNOWN', async () => {
  const keep = [sentinel(), decoyRoot()];
  const inner = new EffectDocker();
  inner.ignoreRm = true; // Docker never confirms the container is gone
  const h = createHarness({ inner, mode: 'dry' });
  let error = null;
  try { await endToEnd(h); } catch (e) { error = e; }
  try {
    assert.ok(error instanceof UnknownOutcomeError, `${error?.name}: ${String(error?.message).slice(0, 160)}`);
    assert.match(error.message, /preserved at/);
    const root = h.fixtureRoots[0];
    assert.ok(h.preserved.includes(root));
    assert.ok(fs.existsSync(path.join(root, 'worktrees')) && fs.existsSync(path.join(root, 'remote.git')) && fs.existsSync(path.join(root, 'source')), 'worktree and both git repositories are preserved');
    assert.ok(fs.readdirSync(path.join(root, 'data')).some((n) => n.endsWith('.events.jsonl')), 'the execution evidence is preserved');
    const approvalsDir = h.preserved.find((p) => p !== root);
    assert.ok(approvalsDir && fs.existsSync(approvalsDir), 'the approval records are preserved');
    for (const k of keep) assert.ok(fs.existsSync(path.join(k, 'keep.txt')), `unrelated resource kept: ${k}`);
    // The container really is still there; only once absence is proven may the state be removed (by the operator/next run).
    assert.equal(h.owned.owned.size >= 1, true);
    inner.ignoreRm = false;
    assert.deepEqual(await h.dispose(), []);
  } finally {
    for (const p of h.preserved) fs.rmSync(p, { recursive: true, force: true });
    for (const k of keep) fs.rmSync(k, { recursive: true, force: true });
  }
});

test('end to end with an injected readback fault AND an unconfirmed cleanup also preserves the fixture', async () => {
  const inner = new EffectDocker(); inner.ignoreRm = true;
  const h = createHarness({ inner, mode: 'dry' });
  let error = null;
  try { await endToEnd(h, { fault: true }); } catch (e) { error = e; }
  try {
    assert.ok(error instanceof UnknownOutcomeError, String(error));
    assert.ok(fs.existsSync(h.fixtureRoots[0]));
  } finally { inner.ignoreRm = false; await h.dispose(); for (const p of h.preserved) fs.rmSync(p, { recursive: true, force: true }); }
});

test('end to end: a failure BEFORE any container exists still cleans up the fixture (nothing to prove absent)', async () => {
  const h = createHarness({ inner: new EffectDocker(), mode: 'dry' });
  h.newAdapter = () => { throw new Error('adapter construction failed'); };
  await assert.rejects(endToEnd(h), /adapter construction failed/);
  assert.equal(h.owned.owned.size, 0);
  assert.equal(fs.existsSync(h.fixtureRoots[0]), false, 'no container was ever created, so the fixture is removed');
  assert.deepEqual(h.preserved, []);
  assert.deepEqual(await h.dispose(), []);
});

test('suite guard: an unconfirmed end-to-end cleanup stops every later live scenario, which is reported skipped and never run', async () => {
  const guard = createSuiteGuard();
  const skipped = [];
  const t = { skip: (why) => skipped.push(why) };
  const inner = new EffectDocker(); inner.ignoreRm = true;
  const first = createHarness({ inner, mode: 'dry' });
  await assert.rejects(guard.run(first, (h) => endToEnd(h), t), UnknownOutcomeError);
  assert.ok(guard.halted);
  const second = createHarness({ inner: new EffectDocker(), mode: 'dry' });
  let ran = false;
  assert.equal(await guard.run(second, async () => { ran = true; await rawReadbackReal(second); }, t), 'skipped');
  assert.equal(ran, false, 'the later scenario never ran');
  assert.equal(second.owned.owned.size, 0, 'and created nothing');
  assert.equal(skipped.length, 1);
  assert.ok(fs.existsSync(first.fixtureRoots[0]), 'the first scenario\'s evidence is still there');
  inner.ignoreRm = false; await first.dispose(); await second.dispose();
  for (const p of first.preserved) fs.rmSync(p, { recursive: true, force: true });
});
