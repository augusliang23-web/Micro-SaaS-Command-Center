import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ExecutionIdentityJournal } from '../../server/execution/identity/identityJournal.mjs';

// Offline fixtures for the Phase 3B7B2B-A0 identity journal. Nothing here contacts Docker.

export const DIGEST = `sha256:${'a'.repeat(64)}`;
export const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`;
export const cid = (ch) => ch.repeat(64);
export const taskId = (n = 1) => `CC-20260101-${n.toString(16).padStart(8, '0')}`;
export const runId = (n = 1) => `RUN-20260101-${n.toString(16).padStart(8, '0')}`;
export const planned = (n = 1, role = 'agent') => ({ taskId: taskId(n), runId: runId(n), sandboxId: runId(n), role, imageDigest: DIGEST });

export function tempRoot() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-identity-')));
  return { base, root: path.join(base, 'journal'), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

export function clock() {
  let n = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, n++ * 10)).toISOString();
}

export function openJournal(root, overrides = {}) {
  return new ExecutionIdentityJournal({ root, now: clock(), ...overrides });
}

/** Returns a journal in a fresh temp root plus a cleanup that closes it. */
export function freshJournal(overrides = {}) {
  const dir = tempRoot();
  const journal = openJournal(dir.root, overrides);
  return { ...dir, journal, cleanup: () => { try { journal.close(); } catch { /* already closed */ } dir.cleanup(); } };
}

export const recordPath = (root, id) => path.join(root, 'records', `${id}.json`);
export const readRecordFile = (root, id) => JSON.parse(fs.readFileSync(recordPath(root, id), 'utf8'));

/** A fake Docker listing entry. Plain data. */
export function container(record, overrides = {}) {
  return { id: record.containerId, name: record.containerName, labels: { ...record.labels }, imageDigest: record.imageDigest, ...overrides };
}
