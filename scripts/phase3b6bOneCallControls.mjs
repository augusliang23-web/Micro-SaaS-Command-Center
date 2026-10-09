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
export function writeEvidenceAtomically(text, directory, runId, { io = fs, suffix = '.json' } = {}) {
  if (!isValidRunId(runId) || typeof text !== 'string' || text.length === 0) return fail('EVIDENCE_PERSISTENCE_FAILED');
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory) return fail('EVIDENCE_PERSISTENCE_FAILED');
  let tmp = null; let published = null;
  try {
    const dir = io.lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || io.realpathSync(directory) !== directory || dir.uid !== process.getuid() || (dir.mode & 0o022) !== 0) return fail('EVIDENCE_DIRECTORY_UNSAFE');
    const final = path.join(directory, `${runId}${suffix}`);
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

// ---- evidence classes, publication commit, authorization-grade reader -----------------------------------------------------
// A record written by this module is self-consistent LOCAL evidence only. Its digest is unkeyed, so anyone who can edit the file
// can recompute it: self-consistency never implies authenticity. Authorization-grade trust needs (a) an independent trust anchor
// supplied by the reader, (b) externally trusted expectations, and (c) a publication commit. No anchor exists in this phase.
export const EVIDENCE_CLASS_LOCAL = 'UNAUTHENTICATED_LOCAL_EVIDENCE';
export const COMMIT_SCHEMA = 'cc.evidence-commit/1';
/** Future authenticated-evidence interface: `verifyAuthentication({ recordText, commitText }) === true`. Default: nothing verifies. */
export const DEFAULT_EVIDENCE_TRUST_ANCHOR = Object.freeze({ verifyAuthentication: () => false });

function createRevocation(directory, runId, io) {
  try { const fd = io.openSync(path.join(directory, `${runId}.revoked`), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); io.closeSync(fd); return true; } catch { return false; }
}

/**
 * Publish record + commit marker. A record is authoritative ONLY once `<runId>.commit.json` exists, binds the record's exact bytes
 * and is itself atomically published after the record was durably confirmed. Existence of `<runId>.json` alone proves nothing.
 * Any failure after the record became visible removes it; if removal fails a revocation marker is attempted, and in every case the
 * missing commit keeps the record non-authoritative.
 */
export function publishEvidenceBundle(text, directory, runId, { io = fs } = {}) {
  const record = writeEvidenceAtomically(text, directory, runId, { io });
  if (!record.ok) { if (record.residualRecord) createRevocation(directory, runId, io); return record; }
  const failAfterPublish = code => {
    let residual = false;
    try { io.unlinkSync(record.file); } catch { residual = true; }
    if (residual) createRevocation(directory, runId, io);
    return { ok: false, code, residualRecord: residual };
  };
  let back;
  try { fsyncDirectory(directory, io); back = io.readFileSync(record.file, 'utf8'); } catch { return failAfterPublish('EVIDENCE_PERSISTENCE_FAILED'); }
  if (back !== `${text}\n`) return failAfterPublish('EVIDENCE_PERSISTENCE_FAILED');
  const commit = writeEvidenceAtomically(JSON.stringify({ schema: COMMIT_SCHEMA, runId, scopeId: ONE_CALL_SCOPE_ID, recordSha256: sha(back), recordBytes: Buffer.byteLength(back) }), directory, runId, { io, suffix: '.commit.json' });
  if (!commit.ok) { const r = failAfterPublish(commit.code); if (commit.residualRecord) { r.residualRecord = true; createRevocation(directory, runId, io); } return r; }
  return { ok: true, file: record.file, commitFile: commit.file };
}

/** Read the three artifacts of a run without following symlinks. Absence is reported as null, never as success. */
export function loadEvidenceBundle(directory, runId, { io = fs } = {}) {
  const read = name => {
    try {
      const fd = io.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { const st = io.fstatSync(fd); return st.isFile() && st.nlink === 1 ? io.readFileSync(fd, 'utf8') : null; } finally { io.closeSync(fd); }
    } catch { return null; }
  };
  let revoked = false; try { io.lstatSync(path.join(directory, `${runId}.revoked`)); revoked = true; } catch (error) { revoked = error?.code !== 'ENOENT'; }
  return { recordText: read(`${runId}.json`), commitText: read(`${runId}.commit.json`), revoked };
}

/**
 * The only reader that may support a real-run decision. Nothing the record says about itself is trusted: the caller supplies the
 * expected run, candidate, scope, budget, attestation identity, permit identity and execution mode, and an independent trust anchor
 * that authenticates the record and its commit. Without every one of those the answer is BLOCKED. Self-hash + commit alone never pass.
 */
export function verifyAuthorizationGradeEvidence(bundle, trusted) {
  try {
    const anchor = trusted?.anchor;
    if (typeof anchor?.verifyAuthentication !== 'function') return fail('TRUST_ANCHOR_MISSING_OR_UNVERIFIED');
    if (!isValidRunId(trusted.runId) || !nonEmpty(trusted.candidate?.version) || !SHA256.test(trusted.candidate?.sha256 ?? '') || trusted.scopeId !== ONE_CALL_SCOPE_ID ||
        trusted.attemptBudget !== 1 || !SHA256.test(trusted.attestationIdSha256 ?? '') || !SHA256.test(trusted.permitIdSha256 ?? '')) return fail('EXPECTATION_MISSING');
    if (trusted.executionMode !== 'REAL_CANDIDATE') return fail('EXECUTION_MODE_NOT_REAL');
    if (!isRecord(bundle)) return fail('RECORD_MISSING');
    if (bundle.revoked !== false) return fail('EVIDENCE_REVOKED');
    if (typeof bundle.recordText !== 'string') return fail('RECORD_MISSING');
    if (typeof bundle.commitText !== 'string') return fail('COMMIT_MISSING');
    const local = verifyOneCallEvidenceRecord(bundle.recordText, { runId: trusted.runId, candidate: trusted.candidate, attestationIdSha256: trusted.attestationIdSha256 });
    if (!local.ok) return local;
    const record = JSON.parse(bundle.recordText);
    if (record.evidenceKind === 'OFFLINE_SIMULATION') return fail('OFFLINE_SIMULATION_NOT_REAL');
    if (record.evidenceKind !== trusted.executionMode) return fail('PROVENANCE_MISMATCH');
    if (record.runIdentity.permitIdSha256 !== trusted.permitIdSha256) return fail('PERMIT_IDENTITY_MISMATCH');
    let commit; try { commit = JSON.parse(bundle.commitText); } catch { return fail('COMMIT_MALFORMED'); }
    if (!isRecord(commit) || commit.schema !== COMMIT_SCHEMA || commit.runId !== trusted.runId || commit.scopeId !== ONE_CALL_SCOPE_ID) return fail('COMMIT_MALFORMED');
    const bytes = `${bundle.recordText.replace(/\n$/, '')}\n`;
    if (commit.recordSha256 !== sha(bytes) || commit.recordBytes !== Buffer.byteLength(bytes)) return fail('COMMIT_MISMATCH');
    if (anchor.verifyAuthentication({ recordText: bundle.recordText, commitText: bundle.commitText }) !== true) return fail('TRUST_ANCHOR_MISSING_OR_UNVERIFIED');
    return { ok: true, authorizationGrade: true, decision: local.decision };
  } catch { return fail('TRUST_ANCHOR_MISSING_OR_UNVERIFIED'); }
}

/** LOCAL diagnostic only: complete, untampered-by-accident record of THIS run and scope. Never authorization-grade. */
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
    return { ok: true, decision: record.decision, classification: EVIDENCE_CLASS_LOCAL, authorizationGrade: false };
  } catch { return fail('RECORD_UNREADABLE'); }
}
