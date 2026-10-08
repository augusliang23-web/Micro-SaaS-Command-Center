# Phase 3B6B.9B — pre-live evidence integrity and single-use admission (offline)

Decision: **PRELIVE_EVIDENCE_HARDENING_PASS** — the offline evidence and admission hardening is ready for Control Plane review.
It does **not** authorize real Claude execution. Current runtime admission stays `MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED`; live execution stays NOT AUTHORIZED.
Real provider calls **0**; qualification-candidate executions **0**; real `claude -p` **0**. No MDM inventory, `profiles`, `sudo`, `doctor` or `auth status` was run.

Observed 2026-10-08 (Asia/Singapore). Authorization: `AGENT_CONSOLE_PHASE3B6B9A_OFFLINE_PASS_PRELIVE_EVIDENCE_HARDENING_REQUIRED`
(Control Plane review [5453670745](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5453670745), pinned to the starting HEAD).

## Baseline

- Starting HEAD (PR #24, OPEN / Draft / unmerged): `69916199b75a92d8faf8842100c40647d88e50e8`; worktree clean; the review above is on exactly that commit.
- Ending HEAD: the commit containing this document (parent = the starting HEAD; the hash is reported on the PR).
- Changed: `scripts/phase3b6bOneCallSmoke.mjs` (wiring only), new `scripts/phase3b6bOneCallControls.mjs` (qualification-only helpers), the focused one-call test file, this document.
- Unchanged: the three-call harness, the Host-TCB lifecycle observer, the production adapter/Orchestrator/Run API/UI, and all historical evidence (including the 9A document).

## 1. Evidence integrity

**Before:** `persistOneCallEvidence` opened the destination with `O_CREAT` and truncated it in place — a crash could expose a partial record, and an existing record (including a stale PASS) could be silently replaced.

**Now (`writeEvidenceAtomically`):**

1. Destination directory must be absolute, canonical (`realpath` equal), a real directory (not a symlink), owned by the current user, and not group/world-writable.
2. Private temp file in the *same directory* (`O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`, 0600), identity checked (`fstat`: regular, `nlink === 1`).
3. Complete serialized record written, then `fsync`; the directory is `fsync`ed.
4. **Publication by hard link** to `<runId>.json`: atomic, and it fails if *any* entry already has that name (including a symlink or a dangling symlink, which is never followed). There is no truncation and no overwrite of a tracked or earlier record.
5. Temp unlinked, directory `fsync`ed, the published bytes read back and compared.
6. Any failure: the published name is removed (if that also fails the result carries `residualRecord`), the temp file is removed, and the run is **not** PASS. A known FAIL/BLOCKED stays FAIL/BLOCKED in memory (the sticky verdict only raises).

**Run identity and binding.** Each run generates `OCS-<uuid v4>` (validated; an invalid or throwing factory → BLOCKED `INVALID_RUN_IDENTITY` before any gate). The record carries a sanitized `runIdentity`:
`runId`, `scopeId = phase3b6b.one-call-smoke.v1`, `candidate {version, sha256}`, `attemptBudget = 1`, `attestationIdSha256`, `permitIdSha256` (hashes only — no raw attestation/permit/host/issuer identifiers, credentials or account identity).
`bindingSha256` is a SHA-256 over the canonical (sorted-key) sanitized record, so the identity, scope, candidate, budget, attestation, permit **and the observed result** are bound together.

**Stale replay prevention.** `verifyOneCallEvidenceRecord(text, expected)` accepts a record only if it is this run (`STALE_OR_FOREIGN_RECORD` otherwise), in scope with budget 1, for the exact candidate, with an intact binding (any edit, e.g. FAIL→PASS or a nested call state, → `BINDING_MISMATCH`), and — when supplied — the expected attestation identity. A second run that reuses a run identity cannot overwrite the first record and is itself not PASS.

## 2. Managed-policy attestation contract (consumer only)

A `MANAGED_POLICY_RUNTIME_ADMISSION_PASS` state is no longer admission by itself. It must carry an attestation that `validateAttestation` accepts against the run's context; otherwise admission is `MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED` with a specific code. Required, exactly bound fields:

| Field | Rule |
| --- | --- |
| `schema` | `cc.managed-policy-runtime-attestation/1` |
| `attestationId` | non-empty string — **null, empty or non-string never admits** (9A compared `null === null`) |
| `host.id` | equals the trust policy's `hostId` (which must itself be non-empty) |
| `candidate` | exactly `2.1.292` and the approved SHA-256 |
| `scope.id` | exactly `phase3b6b.one-call-smoke.v1` |
| `effectivePolicy.result` | exactly `EFFECTIVE_POLICY_ABSENT` |
| `issuer.id` | in the trust policy's `trustedIssuers` |
| `issuedAt`, `validity.notBefore/notAfter` | ISO-8601 UTC, ordered, current at **each** checkpoint (no lifetime is defined by the module; the window comes from the document) |
| `invalidation.conditions` | includes `HOST_CHANGE`, `CANDIDATE_CHANGE`, `POLICY_CHANGE`, `REVOCATION` |
| authenticity | `verifyAuthenticity(att) === true` |
| revocation | `checkRevocation(id) === 'NOT_REVOKED'` (UNKNOWN/REVOKED/anything else blocks) |

It is checked at `PRE_PREFLIGHT`, `PRE_LAUNCH` and `POST_RUN`, and the attestation identity must be identical across all three. A change before launch blocks; a change, revocation or expiry after the run makes the result UNKNOWN (`ADMISSION_DRIFT`).
**The default trust policy trusts nothing** (`hostId: null`, no issuers, authenticity `false`, revocation `UNKNOWN`), so a real runtime cannot be admitted. No attestation was generated, no historical MDM PASS is treated as current, and no MDM inventory was run.

## 3. Single-use launch permit

The live authorization must take the form of a permit that allows exactly **one invocation**, not one provider call per process:

- **Document (`cc.one-call-launch-permit/1`):** `permitId`, `maxProviderCalls === 1`, host, exact candidate, scope, trusted issuer, `issuedAt`/`validity`, and verified authenticity. It is validated before any candidate access; missing, malformed, mis-bound, expired, not-yet-valid or unverifiable → BLOCKED `LAUNCH_PERMIT_NOT_VALID`, and nothing is consumed.
- **Ledger:** a private directory (absolute, canonical, not a symlink, owned, mode `0700` exactly). Missing or unsafe → `PERMIT_LEDGER_UNSAFE`.
- **Atomic consumption immediately before the guarded launch:** `<sha256(permitId)>.consumed` is created with `O_CREAT|O_EXCL|O_NOFOLLOW`, written, `fsync`ed, and the directory is `fsync`ed. Exactly one caller can create it across threads, processes and restarts. The marker holds only the permit hash and run id.
- **Fail-safe:** if the marker exists, the permit is spent even when a later step fails (a partial or empty marker after a crash counts as consumed). If creation itself fails, nothing launches.
- **Results:** a failed spawn consumes the permit and cannot be retried. A reused permit → `PERMIT_ALREADY_CONSUMED`, zero spawns. No automatic retry or second call. The one-call provider budget (1) still applies on top.
- **Defaults:** no permit, no ledger, live gate `false`. No permit was issued in this phase.

## 4. Tests (local offline; not CI)

| Suite | Passed | Failed |
| --- | ---: | ---: |
| One-call (9A, adapted to the new contract, + 24 new 9B tests) | 57 | 0 |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification (three-call) | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| **Total** | **234** | **0** |

New 9B coverage includes:
- **Evidence publication:** a crash injected at each of 40 I/O steps never exposes a partial record; a partial write (half the bytes, then ENOSPC); a failure after the temp write (link, read-back).
- **No overwrite:** an existing record, a destination symlink and a dangling symlink are refused and left untouched; a symlinked, group-writable, non-owned, relative or missing directory is refused.
- **Identity and replay:** invalid run identities (7 forms); binding contents with no raw identifiers; stale or foreign replay, tampering, and wrong candidate/budget/attestation; run-identity reuse; serialization and persistence failure; known FAIL stays FAIL.
- **Attestation:** null or missing ids (10 forms); 22 field and binding violations; unverifiable, revoked, unknown-revocation and default policy; a changed identity before launch and after the run; late revocation; expiry mid-run; current MDM UNKNOWN stays BLOCKED.
- **Permit:** 13 permit violations; 8 unsafe ledgers; consumption before spawn (the marker exists at spawn time); reuse; failed spawn burns the permit; a crash marker; a read-only ledger; a partial consume burns the permit.
- **Concurrency and restart:** 12 concurrent processes yield exactly one winner; restart replay in a fresh process, the parent, and the full harness.
- **Unchanged contracts:** budgets 1 and 3, the default live gate, no environment-driven gate, no invented lifetime, and the controls module cannot launch processes.

Mutation check (each reintroduced and restored; all 18 caught):
- **Permit:** marker without `O_EXCL` (6 failing tests); consumption skipped (6); permit validation skipped (2); ledger safety skipped (1); multi-call permit (1); partial consume un-burned (1).
- **Attestation:** admission without attestation validation (4); null id accepted (1); host binding removed (3); revocation ignored (2); expiry ignored (3); identity change tolerated (2).
- **Evidence:** direct truncating write (3); no unpublish on late failure (2); binding not verified (1); stale run accepted (1); invalid run id not blocked (1); directory safety skipped (1).

## 5. Findings

- **Fixed (this phase):**
  - Non-atomic, overwriting evidence write.
  - `attestationId: null` satisfied the 9A equality check (`null === null`).
  - The budget was per process only.
  - Each is now covered by negative tests.
- **Separate, not fixed (out of scope):** in the three-call harness, an evidence-serialization failure assigns the fallback `UNKNOWN` decision over an earlier `FAIL`. It hides a known violation; it does not create a PASS. Its default evidence path is a tracked historical file.
- **Residual and design limits:**
  - **Durability:** it depends on the filesystem honouring `fsync`/`link`, and on APFS on the host.
  - **Ledger scope:** single-use holds only for one ledger directory. Two ledgers mean two independent uses, so the future issuer must fix the ledger location and the permit must be bound to it, or be issued once.
  - **Clock trust:** validity windows rely on the host clock; clock rollback is not defended against.
  - **Residual records:** if a late publication failure cannot remove the published name, `residualRecord` is reported, and consumers must still verify it with `verifyOneCallEvidenceRecord` against the expected run.

## 6. Remaining before any real one-call run

1. A real, reviewed attestation source and its authenticity/revocation verifier: the current effective-MDM requirement is still open.
2. A real permit issuer, a fixed ledger location, and a reviewed authenticity check. No permit exists.
3. A qualified (non-sampling) lifecycle collector.
4. Real candidate qualification. Nothing here was observed against Claude Code 2.1.292.
