// Phase 3B6B.9B: qualification-only controls for the one-call smoke harness (offline; nothing here authorizes a launch).
//   * validateAttestation: fail-closed CONSUMER contract for a future managed-policy runtime attestation.
//   * validateLaunchPermit / consumeLaunchPermit: durable, single-use, atomically consumed launch permit.
//   * writeEvidenceAtomically / verifyOneCallEvidenceRecord: atomic, no-overwrite, run-bound evidence persistence.
// No attestation or permit is generated here, no lifetime is defined here (validity windows come from the document itself),
// and every default policy trusts nothing, so the real runtime can never be admitted through this module.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const ONE_CALL_SCOPE_ID = 'phase3b6b.one-call-smoke.v1';
export const ATTESTATION_SCHEMA = 'cc.managed-policy-runtime-attestation/1';
export const PERMIT_SCHEMA = 'cc.one-call-launch-permit/1';
export const EFFECTIVE_POLICY_ABSENT = 'EFFECTIVE_POLICY_ABSENT';
export const REQUIRED_INVALIDATION = Object.freeze(['HOST_CHANGE', 'CANDIDATE_CHANGE', 'POLICY_CHANGE', 'REVOCATION']);
const RUN_ID = /^OCS-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256 = /^[0-9a-f]{64}$/;
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha = value => createHash('sha256').update(value).digest('hex');
const nonEmpty = x => typeof x === 'string' && x.length > 0 && x.length <= 256 && !x.includes('\0');
const fail = code => ({ ok: false, code });

export const defaultRunId = () => `OCS-${randomUUID()}`;
export const isValidRunId = value => typeof value === 'string' && RUN_ID.test(value);
export const hashIdentity = value => (nonEmpty(value) ? sha(value) : null);

/** The default policy trusts no host, no issuer and no signature, and treats revocation as unknown: nothing can validate. */
export const DEFAULT_TRUST_POLICY = Object.freeze({
  hostId: null, trustedIssuers: Object.freeze([]), verifyAuthenticity: () => false, checkRevocation: () => 'UNKNOWN', now: () => Date.now(),
});

function window(doc, now) {
  const validity = doc.validity;
  if (!isRecord(validity) || !ISO.test(validity.notBefore ?? '') || !ISO.test(validity.notAfter ?? '') || !ISO.test(doc.issuedAt ?? '')) return fail('VALIDITY_MISSING');
  const [nb, na, ia] = [validity.notBefore, validity.notAfter, doc.issuedAt].map(Date.parse);
  if (![nb, na, ia, now].every(Number.isFinite) || na <= nb) return fail('VALIDITY_INVALID');
  if (ia > now || now < nb) return fail('NOT_YET_VALID');
  if (now >= na) return fail('EXPIRED');
  return { ok: true };
}

function bound(doc, ctx) {
  if (!isRecord(doc.host) || !nonEmpty(doc.host.id) || doc.host.id !== ctx.hostId || !nonEmpty(ctx.hostId)) return fail('HOST_MISMATCH');
  if (!isRecord(doc.candidate) || doc.candidate.version !== ctx.candidate.version || doc.candidate.sha256 !== ctx.candidate.sha256 || !SHA256.test(doc.candidate.sha256 ?? '')) return fail('CANDIDATE_MISMATCH');
  if (!isRecord(doc.scope) || doc.scope.id !== ONE_CALL_SCOPE_ID) return fail('SCOPE_MISMATCH');
  if (!isRecord(doc.issuer) || !nonEmpty(doc.issuer.id) || !ctx.trustedIssuers.includes(doc.issuer.id)) return fail('ISSUER_NOT_TRUSTED');
  return { ok: true };
}

/**
 * Consumer contract for a future managed-policy runtime attestation. Every field is required and exactly bound; a missing,
 * null, malformed, expired, unverifiable or revoked attestation is not admission. Offline fixtures use fake identities.
 */
export function validateAttestation(att, ctx) {
  try {
    if (!isRecord(att) || att.schema !== ATTESTATION_SCHEMA) return fail('ATTESTATION_MISSING');
    if (!nonEmpty(att.attestationId)) return fail('ATTESTATION_ID_MISSING');
    const b = bound(att, ctx); if (!b.ok) return b;
    if (!isRecord(att.effectivePolicy) || att.effectivePolicy.result !== EFFECTIVE_POLICY_ABSENT) return fail('EFFECTIVE_POLICY_NOT_ABSENT');
    const inv = att.invalidation?.conditions;
    if (!Array.isArray(inv) || !REQUIRED_INVALIDATION.every(c => inv.includes(c))) return fail('INVALIDATION_CONDITIONS_MISSING');
    const w = window(att, ctx.now()); if (!w.ok) return w;
    if (ctx.verifyAuthenticity(att) !== true) return fail('ATTESTATION_UNVERIFIABLE');
    if (ctx.checkRevocation(att.attestationId) !== 'NOT_REVOKED') return fail('ATTESTATION_REVOKED_OR_UNKNOWN');
    return { ok: true, attestationId: att.attestationId };
  } catch { return fail('ATTESTATION_UNVERIFIABLE'); }
}

/** Shape / binding / validity of a launch permit. Pure: it does not consume anything. */
export function validateLaunchPermit(permit, ctx) {
  try {
    if (!isRecord(permit) || permit.schema !== PERMIT_SCHEMA) return fail('PERMIT_MISSING');
    if (!nonEmpty(permit.permitId) || permit.maxProviderCalls !== 1) return fail('PERMIT_MALFORMED');
    const b = bound(permit, ctx); if (!b.ok) return b;
    const w = window(permit, ctx.now()); if (!w.ok) return w;
    if (ctx.verifyAuthenticity(permit) !== true) return fail('PERMIT_UNVERIFIABLE');
    return { ok: true, permitId: permit.permitId };
  } catch { return fail('PERMIT_UNVERIFIABLE'); }
}

// ---- durable single-use ledger ------------------------------------------------------------------------------------
export function inspectPrivateDirectory(dir, io = fs) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || path.normalize(dir) !== dir) return false;
  try {
    const stat = io.lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink() && io.realpathSync(dir) === dir && stat.uid === process.getuid() && (stat.mode & 0o077) === 0;
  } catch { return false; }
}
function fsyncDirectory(dir, io) {
  const fd = io.openSync(dir, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
}

/**
 * Atomically consume a permit BEFORE the guarded provider launch. The marker is created with O_EXCL, so exactly one
 * caller wins across threads, processes and restarts; once the marker exists the permit is spent even if later steps fail
 * (a failed or crashed launch never makes it reusable).
 */
export function consumeLaunchPermit(permitId, ledgerDir, { runId, io = fs, now = () => Date.now() } = {}) {
  if (!nonEmpty(permitId) || !isValidRunId(runId)) return { ok: false, code: 'PERMIT_MALFORMED', burned: false };
  if (!inspectPrivateDirectory(ledgerDir, io)) return { ok: false, code: 'PERMIT_LEDGER_UNSAFE', burned: false };
  const marker = path.join(ledgerDir, `${sha(permitId)}.consumed`);
  let fd;
  try {
    fd = io.openSync(marker, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    return { ok: false, code: error?.code === 'EEXIST' ? 'PERMIT_ALREADY_CONSUMED' : 'PERMIT_CONSUMPTION_FAILED', burned: false };
  }
  try {
    io.writeFileSync(fd, JSON.stringify({ permitIdSha256: sha(permitId), runId, consumedAt: new Date(now()).toISOString() }));
    io.fsyncSync(fd);
  } catch { try { io.closeSync(fd); } catch { /* the marker already exists: the permit stays spent */ } return { ok: false, code: 'PERMIT_CONSUMPTION_FAILED', burned: true }; }
  try { io.closeSync(fd); fsyncDirectory(ledgerDir, io); } catch { return { ok: false, code: 'PERMIT_CONSUMPTION_FAILED', burned: true }; }
  return { ok: true, permitIdSha256: sha(permitId) };
}

// ---- evidence ---------------------------------------------------------------------------------------------------
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const bindingDigest = record => { const { bindingSha256: _omit, ...rest } = record; return sha(canonicalJson(rest)); };

/**
 * Publish a complete record atomically and never over an existing file: private temp file in the destination directory
 * (O_EXCL|O_NOFOLLOW), complete write, fsync, hard-link publication (fails if the name exists, even as a symlink), directory
 * fsync, read-back verification. A reader sees either no file or the complete record; no step ever truncates a destination.
 */
export function writeEvidenceAtomically(text, directory, runId, { io = fs } = {}) {
  if (!isValidRunId(runId) || typeof text !== 'string' || text.length === 0) return fail('EVIDENCE_PERSISTENCE_FAILED');
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory) return fail('EVIDENCE_PERSISTENCE_FAILED');
  let tmp = null; let published = null;
  try {
    const dir = io.lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || io.realpathSync(directory) !== directory || dir.uid !== process.getuid() || (dir.mode & 0o022) !== 0) return fail('EVIDENCE_DIRECTORY_UNSAFE');
    const final = path.join(directory, `${runId}.json`);
    tmp = path.join(directory, `.${runId}.${randomUUID().slice(0, 8)}.tmp`);
    const fd = io.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const stat = io.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('temp identity');
      io.writeFileSync(fd, `${text}\n`); io.fsyncSync(fd);
    } finally { io.closeSync(fd); }
    fsyncDirectory(directory, io);
    io.linkSync(tmp, final); published = final;
    io.unlinkSync(tmp); tmp = null;
    fsyncDirectory(directory, io);
    const back = io.readFileSync(final, 'utf8');
    if (back !== `${text}\n`) throw new Error('readback');
    return { ok: true, file: final };
  } catch (error) {
    // Never leave a newly authoritative record behind a failed publication, and never leave a temp file.
    let clean = true;
    if (published) { try { io.unlinkSync(published); } catch { clean = false; } }
    if (tmp) { try { io.unlinkSync(tmp); } catch { /* best effort: temp names are never trusted */ } }
    return { ok: false, code: error?.code === 'EEXIST' ? 'EVIDENCE_ALREADY_EXISTS' : 'EVIDENCE_PERSISTENCE_FAILED', residualRecord: !clean };
  }
}

/** Consumer-side check that a persisted record is the complete, untampered record of THIS run and scope. */
export function verifyOneCallEvidenceRecord(text, expected) {
  try {
    const record = JSON.parse(text);
    const id = record?.runIdentity;
    if (!isRecord(id) || !isValidRunId(id.runId)) return fail('INVALID_RUN_IDENTITY');
    if (id.runId !== expected.runId) return fail('STALE_OR_FOREIGN_RECORD');
    if (id.scopeId !== ONE_CALL_SCOPE_ID || id.attemptBudget !== 1) return fail('SCOPE_OR_BUDGET_MISMATCH');
    if (id.candidate?.version !== expected.candidate.version || id.candidate?.sha256 !== expected.candidate.sha256) return fail('CANDIDATE_MISMATCH');
    if (!SHA256.test(record.bindingSha256 ?? '') || record.bindingSha256 !== bindingDigest(record)) return fail('BINDING_MISMATCH');
    if (expected.attestationIdSha256 !== undefined && id.attestationIdSha256 !== expected.attestationIdSha256) return fail('ATTESTATION_IDENTITY_MISMATCH');
    return { ok: true, decision: record.decision };
  } catch { return fail('RECORD_UNREADABLE'); }
}
