import { CONTAINER_ID_PATTERN, IMAGE_DIGEST_PATTERN, LABEL_KEYS, validateIdentityRecord, validateIdentityRecords } from './executionIdentity.mjs';

// Phase 3B7B2B-A0: OFFLINE recovery classification. A PURE function over data the caller already holds: journal records and a
// container listing. It performs no Docker call, adopts nothing and removes nothing; its output contains no "remove" action.
//
//   KNOWN    a journal record AND a container agree on the exact container id, name, ownership labels and image digest.
//   ORPHAN   a container that claims our ownership labels and has NO journal record at all. Reported, never deleted.
//   MISSING  a journal record whose container is not in a COMPLETE listing.
//   OTHER    a container that does not claim our ownership labels (never inspected further, never reported as ours).
//   UNKNOWN  anything ambiguous: a label/name match without the exact id, mismatched fields, duplicates, malformed data,
//            a corrupt journal or an incomplete listing.
//
// A label match alone never proves ownership. Only the immutable container id recorded BEFORE the container could start does.
// Interrupted or ambiguous executions always resolve to executionOutcome UNKNOWN; the only SETTLED case is a DESTROYED record
// whose container is verifiably gone.

export const CLASSIFICATIONS = Object.freeze(['KNOWN', 'ORPHAN', 'MISSING', 'OTHER', 'UNKNOWN']);
const SANDBOX_NAME_PREFIX = 'cc-sandbox-';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function normalizeContainer(raw) {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !CONTAINER_ID_PATTERN.test(raw.id)) return null;
  if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > 200) return null;
  if (!isObject(raw.labels) || Object.keys(raw.labels).length > 64 || !Object.values(raw.labels).every((v) => typeof v === 'string')) return null;
  if (raw.imageDigest !== null && raw.imageDigest !== undefined && !(typeof raw.imageDigest === 'string' && IMAGE_DIGEST_PATTERN.test(raw.imageDigest))) return null;
  return { id: raw.id, name: raw.name.replace(/^\//, ''), labels: raw.labels, imageDigest: raw.imageDigest ?? null };
}

const claimsOwnership = (c) => Object.hasOwn(c.labels, 'cc.sandbox') || c.name.startsWith(SANDBOX_NAME_PREFIX) || LABEL_KEYS.some((k) => Object.hasOwn(c.labels, k));

function mismatches(record, c) {
  const wrong = [];
  if (c.name !== record.containerName) wrong.push('name');
  if (c.imageDigest !== record.imageDigest) wrong.push('imageDigest');
  for (const key of LABEL_KEYS) if (c.labels[key] !== record.labels[key]) wrong.push(`label:${key}`);
  return wrong;
}

/**
 * @param {object} input
 * @param {Array}  input.records          records from ExecutionIdentityJournal.scan().records
 * @param {Array}  input.corrupt          scan().corrupt: any entry makes every outcome UNKNOWN
 * @param {Array}  input.containers       container listing (id, name, labels, imageDigest); fake data in this phase
 * @param {boolean} input.listingComplete must be exactly true for MISSING/ORPHAN/OTHER to be asserted
 */
export function classifyExecutions({ records, corrupt = [], containers, listingComplete }) {
  const entries = [];
  const corruptInput = !Array.isArray(corrupt) || corrupt.length > 0;
  const setProblems = validateIdentityRecords(records);
  // Array.from materializes sparse holes: a missing listing entry is malformed evidence, never absence.
  const containerProblems = Array.isArray(containers) && (Array.from(containers).some(c => !normalizeContainer(c)) ||
    new Set(containers.map(c => normalizeContainer(c)?.id)).size !== containers.length ||
    new Set(containers.map(c => normalizeContainer(c)?.name)).size !== containers.length);
  const blocked = corruptInput || listingComplete !== true || !Array.isArray(records) || !Array.isArray(containers) || setProblems.length > 0 || containerProblems;
  const blockReason = corruptInput ? 'JOURNAL_CORRUPT' : listingComplete !== true ? 'DOCKER_LISTING_INCOMPLETE' :
    setProblems.length ? 'INVALID_JOURNAL_SET' : containerProblems ? 'INVALID_CONTAINER_LISTING' : 'INVALID_INPUT';
  const unknown = (extra) => ({ classification: 'UNKNOWN', executionOutcome: 'UNKNOWN', operatorIntervention: true, recommendedAction: 'OPERATOR_REVIEW', eligibleForVerifiedAdoption: false, ...extra });

  const validRecords = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (validateIdentityRecord(record).length > 0) entries.push(unknown({ runId: isObject(record) ? String(record.runId ?? '') : '', containerId: null, reason: 'INVALID_RECORD' }));
    else validRecords.push(record);
  }
  if (blocked) {
    for (const record of validRecords) entries.push(unknown({ runId: record.runId, containerId: record.containerId, reason: blockReason }));
    for (const raw of Array.isArray(containers) ? containers : []) entries.push(unknown({ runId: null, containerId: normalizeContainer(raw)?.id ?? null, reason: normalizeContainer(raw) ? blockReason : 'MALFORMED_CONTAINER' }));
    return finish(entries, true);
  }

  // Duplicate journal identities or duplicate listed ids make the match ambiguous: never pick one.
  const recordsByContainer = new Map(); const recordsBySandbox = new Map(); const recordsByName = new Map();
  for (const r of validRecords) {
    if (r.containerId) recordsByContainer.set(r.containerId, [...(recordsByContainer.get(r.containerId) ?? []), r]);
    recordsBySandbox.set(r.sandboxId, [...(recordsBySandbox.get(r.sandboxId) ?? []), r]);
    recordsByName.set(r.containerName, [...(recordsByName.get(r.containerName) ?? []), r]);
  }
  const matchedRecords = new Set();
  const normalized = [];
  const idCount = new Map(); const nameCount = new Map();
  for (const raw of containers) {
    const c = normalizeContainer(raw);
    if (!c) {
      const id = isObject(raw) && typeof raw.id === 'string' && CONTAINER_ID_PATTERN.test(raw.id) ? raw.id : null;
      // A present-but-unreadable container is not an absent one: its record must not be reported MISSING.
      for (const r of recordsByContainer.get(id) ?? []) matchedRecords.add(r.runId);
      entries.push(unknown({ runId: null, containerId: id, reason: 'MALFORMED_CONTAINER' }));
      continue;
    }
    normalized.push(c);
    idCount.set(c.id, (idCount.get(c.id) ?? 0) + 1);
    nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  }

  for (const c of normalized) {
    if (idCount.get(c.id) > 1 || nameCount.get(c.name) > 1) {
      for (const r of [...(recordsByContainer.get(c.id) ?? []), ...(recordsByName.get(c.name) ?? [])]) matchedRecords.add(r.runId);
      entries.push(unknown({ runId: null, containerId: c.id, reason: 'DUPLICATE_CONTAINER_IDENTITY' }));
      continue;
    }
    const byId = recordsByContainer.get(c.id) ?? [];
    if (byId.length > 1) { for (const r of byId) matchedRecords.add(r.runId); entries.push(unknown({ runId: null, containerId: c.id, reason: 'DUPLICATE_JOURNAL_IDENTITY' })); continue; }
    if (byId.length === 1) {
      const [record] = byId; matchedRecords.add(record.runId);
      const wrong = mismatches(record, c);
      if (wrong.length > 0) { entries.push(unknown({ runId: record.runId, containerId: c.id, reason: `IDENTITY_MISMATCH:${wrong.join(',')}` })); continue; }
      if (record.stage === 'UNKNOWN') { entries.push(unknown({ runId: record.runId, containerId: c.id, reason: 'TERMINAL_UNKNOWN' })); continue; }
      // Present and exact. A DESTROYED record with a live container is inconsistent; every other stage was interrupted by the restart.
      const reason = record.stage === 'DESTROYED' ? 'DESTROYED_RECORD_BUT_CONTAINER_PRESENT' : 'EXECUTION_INTERRUPTED';
      entries.push({ classification: record.stage === 'DESTROYED' ? 'UNKNOWN' : 'KNOWN', executionOutcome: 'UNKNOWN', operatorIntervention: record.stage === 'DESTROYED', recommendedAction: record.stage === 'DESTROYED' ? 'OPERATOR_REVIEW' : 'REPORT_TO_OPERATOR', eligibleForVerifiedAdoption: record.stage !== 'DESTROYED', runId: record.runId, containerId: c.id, reason });
      continue;
    }
    if (!claimsOwnership(c)) { entries.push({ classification: 'OTHER', executionOutcome: null, operatorIntervention: false, recommendedAction: 'NONE', eligibleForVerifiedAdoption: false, runId: null, containerId: c.id, reason: 'NOT_CLAIMING_OWNERSHIP' }); continue; }
    // No record holds this container id. If a record claims the same sandbox/name, a lookalike (or a crash between create and journal
    // write) is possible: ambiguous, never an orphan and never adoptable.
    const sandboxId = c.labels['cc.sandbox.id'];
    const lookalikes = [...(recordsBySandbox.get(sandboxId) ?? []), ...(recordsByName.get(c.name) ?? [])];
    if (lookalikes.length > 0) { for (const r of lookalikes) matchedRecords.add(r.runId); entries.push(unknown({ runId: lookalikes[0].runId, containerId: c.id, reason: lookalikes.some((r) => r.containerId) ? 'CONTAINER_ID_MISMATCH_FOR_RECORD' : 'CREATED_BEFORE_JOURNALED' })); continue; }
    if (c.labels['cc.sandbox'] !== '1' || LABEL_KEYS.some((k) => typeof c.labels[k] !== 'string')) { entries.push(unknown({ runId: null, containerId: c.id, reason: 'PARTIAL_OWNERSHIP_CLAIM' })); continue; }
    entries.push({ classification: 'ORPHAN', executionOutcome: null, operatorIntervention: true, recommendedAction: 'REPORT_TO_OPERATOR', eligibleForVerifiedAdoption: false, runId: null, containerId: c.id, reason: 'OWNERSHIP_LABELS_WITHOUT_JOURNAL_RECORD' });
  }

  for (const record of validRecords) {
    if (matchedRecords.has(record.runId)) continue;
    const settled = record.stage === 'DESTROYED';
    entries.push({ classification: 'MISSING', executionOutcome: settled ? 'SETTLED' : 'UNKNOWN', operatorIntervention: !settled, recommendedAction: settled ? 'NONE' : 'REPORT_TO_OPERATOR', eligibleForVerifiedAdoption: false, runId: record.runId, containerId: record.containerId, reason: settled ? 'DESTROYED_AND_ABSENT' : 'RECORDED_CONTAINER_ABSENT' });
  }
  return finish(entries, false);
}

function finish(entries, blocked) {
  const summary = Object.fromEntries(CLASSIFICATIONS.map((k) => [k, entries.filter((e) => e.classification === k).length]));
  return Object.freeze({ blocked, autoCleanup: false, entries: Object.freeze(entries.map((e) => Object.freeze(e))), summary: Object.freeze(summary) });
}
