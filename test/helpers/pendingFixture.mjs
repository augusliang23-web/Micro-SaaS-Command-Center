import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { PendingActionStore } from '../../server/execution/continuation/pendingActionStore.mjs';
import { diffDigestOf } from '../../server/execution/approvalGate.mjs';

// Offline fixtures for the Phase 3B7B2B-A1-0 pending-action foundation. Nothing here touches Docker, Git remotes or an approval.

export const h = (ch, n = 40) => ch.repeat(n);
export const taskId = (n = 1) => `CC-20260101-${n.toString(16).padStart(8, '0')}`;
export const runId = (n = 1) => `RUN-20260101-${n.toString(16).padStart(8, '0')}`;
export const branchOf = (n = 1, slug = 'fix') => `agent/${taskId(n)}-${slug}`;
export const digest = (s) => createHash('sha256').update(s).digest('hex');
export const evidenceId = (ch = 'e') => `EV-${ch.repeat(32)}`;

export function manifestOf(n = 1) {
  const files = [{ path: `agent-console-fixture/${taskId(n)}.txt`, sha256: digest(`content-${n}`), size: 12, exec: false }];
  return { manifest: { files }, diffDigest: diffDigestOf(files) };
}

export const NOT_JOURNALED = Object.freeze({ state: 'NOT_JOURNALED', stateRootId: null, executionGeneration: null, runId: null });

/** A valid server-computed create input. `over` replaces whole fields. */
export function pendingInput(n = 1, over = {}) {
  const { manifest, diffDigest } = manifestOf(n);
  return {
    taskId: taskId(n), projectId: 'demo', runId: runId(n), executionIdentity: { ...NOT_JOURNALED }, branch: branchOf(n),
    baseSha: h('a'), treeSha: h('b'), diffDigest, manifest,
    verification: { evidenceId: evidenceId(), kind: 'command_result', grade: 'LOCALLY_VERIFIED', passed: true },
    guardSnapshot: { sourceHead: h('c'), sourceStatusDigest: digest('s'), sourceFingerprint: digest('f'), remoteDigest: digest('r'), remoteBeforeDigest: digest('rb'), branchesBeforeDigest: digest('b') },
    ...over,
  };
}

export function clock(start = Date.UTC(2026, 0, 1, 0, 0, 0, 0)) {
  let n = 0;
  return () => new Date(start + n++ * 10).toISOString();
}

export function tempRoot() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pending-')));
  return { base, root: path.join(base, 'pending'), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

/** Deterministic ids: PND-<counter hex padded>; still validated by the store. */
export function counterHex() {
  let n = 0;
  return (bytes) => { n += 1; return n.toString(16).padStart(bytes * 2, '0'); };
}

export function freshStore(overrides = {}) {
  const dir = tempRoot();
  const store = new PendingActionStore({ root: dir.root, now: clock(), ...overrides });
  return { ...dir, store };
}

export const revisionFile = (root, id, rev) => path.join(root, 'records', id, `${String(rev).padStart(10, '0')}.json`);
export const readRev = (root, id, rev) => JSON.parse(fs.readFileSync(revisionFile(root, id, rev), 'utf8'));

/** Walk COMMIT -> PUSH_BRANCH -> CREATE_PR step by step. Returns the final record. */
export function finishAll(store, record) {
  let r = record;
  for (const action of ['COMMIT', 'PUSH_BRANCH', 'CREATE_PR']) {
    for (const to of ['CLAIMED', 'CONSUMED', 'DONE']) r = store.advanceStep(r.pendingId, r.revision, { action, to, ...(action === 'COMMIT' && to === 'DONE' ? { commitSha: h('d') } : {}) });
  }
  return r;
}
