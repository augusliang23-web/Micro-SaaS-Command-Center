import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  APPROVAL_AUTHENTICITY, ApprovalError, ApprovalGate, ApprovalStore, DOCKER_PATH_ACTION_POLICY, GATED_ACTIONS, MAX_APPROVAL_TTL_MS,
  computeDiffManifest, diffDigestOf, validateApprovalRecord,
} from '../server/execution/approvalGate.mjs';
import { ACTION_POLICY, classifyAction } from '../server/tasks/actionPolicy.mjs';
import { EVIDENCE_KINDS } from '../server/tasks/types.mjs';
import { approvalSetup, branchOf, makeClock, sha256, TASK } from './helpers/dockerPathFixture.mjs';
import { realTmp } from './helpers/dockerScratch.mjs';

const BASE = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const BRANCH = branchOf(TASK);
const approver = { source: 'CONTROL_PLANE', id: 'control-plane-reviewer' };
const grantArgs = (extra = {}) => ({ taskId: TASK, action: 'COMMIT', diffDigest: DIGEST, baseSha: BASE, branch: BRANCH, approvedBy: approver, ...extra });
const expectArgs = (extra = {}) => ({ diffDigest: DIGEST, baseSha: BASE, branch: BRANCH, ...extra });
const task = (extra = {}) => ({ taskId: TASK, allowedActions: ['READ_REPO', 'CREATE_WORKTREE', 'EDIT_WORKTREE', 'COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], ...extra });
const project = (extra = {}) => ({ allowedActions: ['READ_REPO', 'CREATE_WORKTREE', 'EDIT_WORKTREE', 'COMMIT', 'PUSH_BRANCH', 'CREATE_PR'], ...extra });
async function withApprovals(fn, options) { const s = approvalSetup(options); try { return await fn(s); } finally { s.done(); } }

// ---------- Action policy ----------

test('policy: the Docker path requires approval for COMMIT, PUSH_BRANCH and CREATE_PR; the Phase 2 policy is untouched', () => {
  for (const a of GATED_ACTIONS) {
    assert.equal(classifyAction(a, DOCKER_PATH_ACTION_POLICY), 'CONTROL_PLANE_APPROVAL', a);
    assert.equal(classifyAction(a, ACTION_POLICY), 'AUTO_ALLOWED', `${a} keeps its Phase 2 classification`);
  }
  for (const [k, v] of Object.entries(ACTION_POLICY)) if (!GATED_ACTIONS.includes(k)) assert.equal(DOCKER_PATH_ACTION_POLICY[k], v, k);
  assert.ok(Object.isFrozen(DOCKER_PATH_ACTION_POLICY));
  assert.deepEqual([...GATED_ACTIONS], ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR']);
  assert.equal(DOCKER_PATH_ACTION_POLICY.MERGE, 'FORBIDDEN_IN_V1');
  assert.equal(DOCKER_PATH_ACTION_POLICY.DEPLOY, 'FORBIDDEN_IN_V1');
});

test('evidence kinds: the existing kinds are preserved and only sandbox/approval kinds were added', () => {
  for (const k of ['worktree_created', 'branch_created', 'files_changed', 'command_result', 'commit', 'push', 'pr', 'guard_violation', 'agent_report', 'error']) assert.ok(EVIDENCE_KINDS.includes(k), k);
  for (const k of ['sandbox_policy', 'sandbox_created', 'sandbox_started', 'sandbox_stopped', 'sandbox_destroyed', 'approval_required', 'approval_consumed']) assert.ok(EVIDENCE_KINDS.includes(k), k);
  assert.equal(EVIDENCE_KINDS.length, 17);
});

// ---------- Exact diff digest ----------

const entry = (p, content, extra = {}) => ({ path: p, sha256: sha256(content), size: Buffer.byteLength(content), exec: false, ...extra });

test('diff digest: deterministic, order independent and sensitive to path, content, size, mode and deletion', () => {
  const a = entry('a.txt', 'one'); const b = entry('b/c.txt', 'two');
  const d = diffDigestOf([a, b]);
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(diffDigestOf([b, a]), d);
  assert.notEqual(diffDigestOf([a, entry('b/c.txt', 'two!')]), d);
  assert.notEqual(diffDigestOf([a, { ...b, path: 'b/d.txt' }]), d);
  assert.notEqual(diffDigestOf([a, { ...b, exec: true }]), d);
  assert.notEqual(diffDigestOf([a, { path: 'b/c.txt', deleted: true }]), d);
  assert.notEqual(diffDigestOf([a]), d);
  for (const bad of [[], null, undefined, 'x', [a, a], [{ path: '' }], [{ path: 'x' }], [{ ...a, sha256: 'zz' }], [{ ...a, size: -1 }], [{ ...a, exec: 'no' }], [5],
    Array.from({ length: 201 }, (_, i) => entry(`f${i}`, 'x'))]) assert.throws(() => diffDigestOf(bad), /manifest/i, JSON.stringify(bad)?.slice(0, 40));
});

function workspace() {
  const root = realTmp('cc-p3b7b1-ws-');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('manifest: regular files are hashed; the digest equals the pure digest of the same entries', () => {
  const w = workspace();
  try {
    fs.mkdirSync(path.join(w.root, 'sub'));
    fs.writeFileSync(path.join(w.root, 'sub', 'x.txt'), 'hello');
    fs.writeFileSync(path.join(w.root, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
    const m = computeDiffManifest({ worktreePath: w.root, paths: ['sub/x.txt', 'run.sh'], baseSha: BASE });
    assert.equal(m.fileCount, 2);
    assert.equal(m.diffDigest, diffDigestOf([entry('sub/x.txt', 'hello'), entry('run.sh', '#!/bin/sh\n', { exec: true })]));
    assert.equal(m.files.find((f) => f.path === 'run.sh').exec, true);
    const gone = computeDiffManifest({ worktreePath: w.root, paths: ['sub/x.txt', 'missing/old.txt'], baseSha: BASE });
    assert.deepEqual(gone.files.find((f) => f.path === 'missing/old.txt'), { path: 'missing/old.txt', deleted: true });
  } finally { w.cleanup(); }
});

test('manifest: symlinks, hard links, directories, symlinked parents, .git, traversal and oversized files are rejected', () => {
  const w = workspace();
  try {
    fs.writeFileSync(path.join(w.root, 'real.txt'), 'x');
    fs.symlinkSync('real.txt', path.join(w.root, 'link.txt'));
    fs.linkSync(path.join(w.root, 'real.txt'), path.join(w.root, 'hard.txt'));
    fs.mkdirSync(path.join(w.root, 'dir'));
    fs.mkdirSync(path.join(w.root, 'outside-target'));
    fs.symlinkSync('outside-target', path.join(w.root, 'viaLink'));
    fs.writeFileSync(path.join(w.root, 'big.bin'), Buffer.alloc(1024 * 1024 + 1));
    const bad = ['link.txt', 'hard.txt', 'real.txt', 'dir', 'viaLink/x', '.git/config', '.GIT/config', 'a/.git/x', '../escape', '/etc/passwd', 'a\\b', 'a/../b', './x', 'x\0y', '', 'big.bin', '.'];
    for (const p of bad) {
      assert.throws(() => computeDiffManifest({ worktreePath: w.root, paths: [p], baseSha: BASE }), (e) => e.name === 'BoundaryError' || e.code === 'EXECUTION_BLOCKED', JSON.stringify(p));
    }
    assert.throws(() => computeDiffManifest({ worktreePath: w.root, paths: [], baseSha: BASE }), /No changes/);
    assert.throws(() => computeDiffManifest({ worktreePath: w.root, paths: ['real.txt'], baseSha: 'short' }), /base commit/);
    assert.throws(() => computeDiffManifest({ worktreePath: w.root, paths: Array.from({ length: 201 }, (_, i) => `f${i}`), baseSha: BASE }), /Too many/);
  } finally { w.cleanup(); }
});

// ---------- Approval records ----------

test('grant: the store chooses the id, labels the record unauthenticated and validates every field', async () => withApprovals(({ store, dir }) => {
  const a = store.grant({ ...grantArgs(), approvalId: 'APR-0000000000000000' });
  assert.notEqual(a.approvalId, 'APR-0000000000000000');
  assert.match(a.approvalId, /^APR-[0-9a-f]{16}$/);
  assert.equal(a.authenticity, APPROVAL_AUTHENTICITY);
  assert.equal(APPROVAL_AUTHENTICITY, 'UNAUTHENTICATED_LOCAL_APPROVAL');
  assert.deepEqual(validateApprovalRecord(a), []);
  assert.ok(Date.parse(a.expiresAt) - Date.parse(a.issuedAt) <= MAX_APPROVAL_TTL_MS);
  assert.equal(fs.statSync(path.join(dir, `${a.approvalId}.json`)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  const badInputs = [
    { action: 'MERGE' }, { action: 'DEPLOY' }, { action: 'READ_REPO' }, { action: 'EDIT_WORKTREE' }, { action: 'commit' }, { action: undefined },
    { diffDigest: 'xyz' }, { diffDigest: undefined }, { baseSha: 'abc' }, { taskId: 'CC-1' }, { branch: 'main' }, { branch: 'agent/CC-20261003-87654321-other' },
    { approvedBy: undefined }, { approvedBy: { source: 'AGENT', id: 'human' } }, { approvedBy: { source: 'HUMAN_OPERATOR', id: 'claude-code' } }, { approvedBy: { source: 'CONTROL_PLANE', id: 'fake-agent' } },
    { approvedBy: { source: 'HUMAN_OPERATOR', id: 'codex' } }, { approvedBy: { source: 'HUMAN_OPERATOR', id: '../x' } }, { approvedBy: { source: 'HUMAN_OPERATOR', id: 'ok', extra: 1 } },
    { ttlMs: 0 }, { ttlMs: MAX_APPROVAL_TTL_MS + 1 }, { ttlMs: -5 }, { ttlMs: 1.5 }, { ttlMs: '600000' }, { ttlMs: Infinity },
  ];
  for (const extra of badInputs) assert.throws(() => store.grant(grantArgs(extra)), (e) => e instanceof ApprovalError, JSON.stringify(extra));
}));

test('grant: store requires an absolute directory and a valid clock', async () => withApprovals(() => {
  assert.throws(() => new ApprovalStore({ dir: 'relative/dir' }), /absolute/);
  const base = realTmp('cc-p3b7b1-clock-');
  try {
    const store = new ApprovalStore({ dir: path.join(base, 'a'), now: () => 'not a date' });
    assert.throws(() => store.grant(grantArgs()), (e) => e.approvalCode === 'CLOCK_INVALID');
    assert.deepEqual({ ok: false, code: store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code }, { ok: false, code: 'CLOCK_INVALID' });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}));

test('authorize: exactly one valid approval is found and burned; replay is refused', async () => withApprovals(({ store, dir }) => {
  const a = store.grant(grantArgs());
  const first = store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() });
  assert.equal(first.ok, true);
  assert.equal(first.approval.approvalId, a.approvalId);
  assert.ok(fs.existsSync(path.join(dir, `${a.approvalId}.consumed`)));
  for (let i = 0; i < 3; i += 1) {
    const replay = store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() });
    assert.equal(replay.ok, false); assert.equal(replay.code, 'APPROVAL_CONSUMED');
  }
  // A second store instance on the same directory (another process) also sees it consumed.
  const other = new ApprovalStore({ dir, now: () => '2026-10-10T00:00:30.000Z' });
  assert.equal(other.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code, 'APPROVAL_CONSUMED');
}));

test('authorize: missing approval, wrong action and a different task are refused', async () => withApprovals(({ store }) => {
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code, 'APPROVAL_MISSING');
  store.grant(grantArgs({ action: 'PUSH_BRANCH' }));
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code, 'APPROVAL_MISSING', 'a push approval cannot authorize a commit');
  assert.equal(store.authorize({ taskId: 'CC-20261003-87654321', action: 'PUSH_BRANCH', expect: expectArgs() }).code, 'APPROVAL_MISSING', 'approval is bound to the task');
  for (const bad of [{ taskId: 'x' }, { action: 'MERGE' }, { action: 'READ_REPO' }, { expect: null }, { expect: {} }, { expect: expectArgs({ diffDigest: 'x' }) }, { expect: expectArgs({ baseSha: 'x' }) }, { expect: expectArgs({ branch: 5 }) }]) {
    const r = store.authorize({ taskId: TASK, action: 'PUSH_BRANCH', expect: expectArgs(), ...bad });
    assert.equal(r.ok, false); assert.equal(r.code, 'REQUEST_INVALID', JSON.stringify(bad));
  }
}));

test('authorize: a mismatched diff, base commit or branch is refused and the approval stays unconsumed', async () => withApprovals(({ store, dir }) => {
  const a = store.grant(grantArgs());
  for (const wrong of [{ diffDigest: 'c'.repeat(64) }, { baseSha: 'd'.repeat(40) }, { branch: branchOf(TASK, 'other-slug') }]) {
    const r = store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs(wrong) });
    assert.equal(r.ok, false); assert.equal(r.code, 'APPROVAL_MISMATCH', JSON.stringify(wrong));
  }
  assert.ok(!fs.existsSync(path.join(dir, `${a.approvalId}.consumed`)));
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).ok, true, 'the matching request still works');
}));

test('authorize: expired and not-yet-valid approvals are refused (boundary included)', async () => withApprovals(({ store, clock }) => {
  store.grant(grantArgs({ ttlMs: 60_000 }));
  clock.advance(59_999);
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs({ diffDigest: 'e'.repeat(64) }) }).code, 'APPROVAL_MISMATCH');
  clock.advance(1); // exactly the expiry instant
  const expired = store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() });
  assert.equal(expired.ok, false); assert.equal(expired.code, 'APPROVAL_EXPIRED');
  clock.advance(3_600_000);
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code, 'APPROVAL_EXPIRED');
  // Not yet valid: the clock moves backwards beyond the skew allowance.
  clock.set('2026-10-09T00:00:00.000Z');
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code, 'APPROVAL_NOT_YET_VALID');
}));

test('authorize: two valid candidates are ambiguous and neither is consumed', async () => withApprovals(({ store, dir }) => {
  const a = store.grant(grantArgs()); const b = store.grant(grantArgs());
  const r = store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() });
  assert.equal(r.ok, false); assert.equal(r.code, 'APPROVAL_AMBIGUOUS');
  assert.ok(!fs.existsSync(path.join(dir, `${a.approvalId}.consumed`)) && !fs.existsSync(path.join(dir, `${b.approvalId}.consumed`)));
}));

test('authorize: tampered, malformed or mislabeled records are ignored, never trusted', async () => withApprovals(({ store, dir }) => {
  const good = store.grant(grantArgs());
  const file = path.join(dir, `${good.approvalId}.json`);
  const original = fs.readFileSync(file, 'utf8');
  const variants = [
    { ...good, authenticity: 'SIGNED_BY_CONTROL_PLANE' }, { ...good, extra: true }, { ...good, expiresAt: '2099-01-01T00:00:00.000Z' }, { ...good, action: 'MERGE' },
    { ...good, approvedBy: { source: 'HUMAN_OPERATOR', id: 'claude' } }, { ...good, approvalId: 'APR-ffffffffffffffff' }, { ...good, diffDigest: 5 }, null, [],
  ];
  for (const v of variants) {
    fs.writeFileSync(file, JSON.stringify(v));
    const r = store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() });
    assert.equal(r.ok, false, JSON.stringify(v)?.slice(0, 60)); assert.equal(r.code, 'APPROVAL_MISSING');
  }
  fs.writeFileSync(file, '{not json');
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code, 'APPROVAL_MISSING');
  fs.writeFileSync(file, original);
  assert.equal(store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).ok, true);
  fs.writeFileSync(path.join(dir, 'APR-0123456789abcdef.json'), JSON.stringify({ ...good, approvalId: 'APR-aaaaaaaaaaaaaaaa' })); // file name does not match the id
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(good));
}));

test('authorize: an approval is not consumed when the burn cannot be recorded (fail closed)', async () => {
  const base = realTmp('cc-p3b7b1-burn-');
  try {
    const dir = path.join(base, 'a');
    const clock = makeClock();
    const failing = { ...fs, openSync: (file, flags, ...rest) => { if (String(file).endsWith('.consumed')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return fs.openSync(file, flags, ...rest); } };
    const store = new ApprovalStore({ dir, now: clock, fsImpl: failing });
    store.grant(grantArgs());
    const r = store.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() });
    assert.equal(r.ok, false); assert.equal(r.code, 'CONSUME_FAILED');
    const brokenDir = new ApprovalStore({ dir, now: clock, fsImpl: { ...fs, readdirSync: () => { throw new Error('EIO'); } } });
    assert.equal(brokenDir.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }).code, 'STORE_UNREADABLE');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('authorize: two racing consumers cannot both win (exclusive-create marker)', async () => withApprovals(({ store, dir, clock }) => {
  store.grant(grantArgs());
  const other = new ApprovalStore({ dir, now: clock });
  const results = [store, other, store, other].map((s) => s.authorize({ taskId: TASK, action: 'COMMIT', expect: expectArgs() }));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'APPROVAL_CONSUMED'));
}));

// ---------- Gate ----------

test('gate: only approvable actions that the task and project allow can be required; the gate cannot grant', async () => withApprovals(({ store, gate }) => {
  store.grant(grantArgs());
  assert.equal('grant' in gate, false);
  assert.equal(typeof gate.grant, 'undefined');
  for (const action of ['READ_REPO', 'EDIT_WORKTREE', 'MERGE', 'DEPLOY', 'SECRETS', 'AGENT_NETWORK', 'RUN_TESTS', 'UNKNOWN_ACTION', undefined, '__proto__']) {
    assert.throws(() => gate.require({ task: task(), project: project(), action, expect: expectArgs() }), (e) => e.approvalCode === 'ACTION_NOT_GATED', String(action));
  }
  assert.throws(() => gate.require({ task: task({ allowedActions: ['READ_REPO'] }), project: project(), action: 'COMMIT', expect: expectArgs() }), (e) => e.approvalCode === 'ACTION_NOT_ALLOWED');
  assert.throws(() => gate.require({ task: task(), project: project({ allowedActions: ['READ_REPO'] }), action: 'COMMIT', expect: expectArgs() }), (e) => e.approvalCode === 'ACTION_NOT_ALLOWED');
  assert.throws(() => gate.require({ task: undefined, project: project(), action: 'COMMIT', expect: expectArgs() }), (e) => e instanceof ApprovalError);
  const ok = gate.require({ task: task(), project: project(), action: 'COMMIT', expect: expectArgs() });
  assert.equal(ok.action, 'COMMIT');
  assert.throws(() => gate.require({ task: task(), project: project(), action: 'COMMIT', expect: expectArgs() }), (e) => e.approvalCode === 'APPROVAL_CONSUMED');
  assert.throws(() => new ApprovalGate({ store: { authorize: () => ({ ok: true }) } }), /ApprovalStore/);
  assert.throws(() => new ApprovalGate({}), /ApprovalStore/);
}));

test('approval errors are boundary errors (they BLOCK, they do not FAIL) and every refusal names a closed code', async () => withApprovals(({ gate }) => {
  try { gate.require({ task: task(), project: project(), action: 'PUSH_BRANCH', expect: expectArgs() }); assert.fail('should throw'); }
  catch (e) { assert.equal(e.name, 'ApprovalError'); assert.equal(e.code, 'EXECUTION_BLOCKED'); assert.equal(e.approvalCode, 'APPROVAL_MISSING'); assert.match(e.message, /PUSH_BRANCH blocked/); }
  assert.ok(os.tmpdir());
}));
