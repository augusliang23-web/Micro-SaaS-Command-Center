# Phase 3B6B.9B-R1 — evidence consumer security corrections (offline)

Decision: **PRELIVE_EVIDENCE_CONSUMER_PASS** — the offline evidence-consumer contract is ready for Control Plane review.
It does **not** authorize real inference. Runtime MDM admission: **BLOCKED**. Live execution: **NOT AUTHORIZED**.
Provider calls **0**; qualification-candidate executions **0**. No candidate command, `doctor`, `auth status`, `profiles`, `sudo`, MDM inventory, key generation or package install was performed.

Authorization: `AGENT_CONSOLE_PHASE3B6B9B_EVIDENCE_CONSUMER_HOLD_OFFLINE_R1_AUTHORIZED`; Control Plane review
[5464220534](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5464220534), pinned to the starting HEAD.

- Starting HEAD (PR #24, OPEN / Draft / unmerged, worktree clean): `421f0bc5f329e2bfa132ba298704416968a8a780`.
- Ending HEAD: the commit containing this document (parent = the starting HEAD; the hash is reported on the PR).
- Changed: `scripts/phase3b6bOneCallControls.mjs`, `scripts/phase3b6bOneCallSmoke.mjs` (record classification and bundle publication only), the focused one-call test file, this document.
  Not changed: the three-call harness, lifecycle observer, production code, and all earlier evidence documents (the 9B document is historical; this one supersedes its wording on "binding").

## Trusted vs untrusted evidence

| Class | What it is | May be used for |
| --- | --- | --- |
| `UNAUTHENTICATED_LOCAL_EVIDENCE` | Every record this harness writes (`evidenceClass`, `authorizationGrade: false`). It carries an **unkeyed** SHA-256 over itself and a commit marker, both of which anyone able to edit the files can regenerate. | Diagnostics and accidental-corruption detection (`verifyOneCallEvidenceRecord`, which now always answers `authorizationGrade: false`). **Never** promoted to real-run evidence. |
| Authorization-grade evidence | A record + commit that an **independent trust anchor** authenticates *and* that matches expectations supplied by a trusted caller. | The only thing a future real-run decision may rely on (`verifyAuthorizationGradeEvidence`). |

Self-consistency never implies authenticity. No trust anchor exists in this phase, no key was created, and the default anchor (`DEFAULT_EVIDENCE_TRUST_ANCHOR`) authenticates nothing, so every authorization-grade read is **BLOCKED** today.

## H1 — authenticity

- **Fix:** the digest is documented and labelled as an unkeyed self-check; records are classified `UNAUTHENTICATED_LOCAL_EVIDENCE`; a future authenticated-evidence interface `verifyAuthentication({ recordText, commitText }) === true` is defined and defaults to BLOCKED. Anything but a function returning exactly `true` (missing, throwing, truthy string) blocks.
- **Negative proof:** a record edited with its digest left unchanged fails locally (`BINDING_MISMATCH`). A record edited with its digest **and** commit recomputed verifies *locally* — demonstrating why the digest proves nothing — and is rejected for authorization by an anchor that knows only the genuine bytes, and by the default anchor.
- **Trust boundary:** the anchor must be independent of whoever can write the evidence directory. The offline test anchor is an in-test lookup of genuine bytes; it is not a key, signature or trust root.

## H2 — provenance

`verifyAuthorizationGradeEvidence` trusts nothing the record says about itself. The caller must supply, and each must match exactly: run identity, candidate (version + SHA-256), scope, one-call budget, attestation identity hash, **permit identity hash**, and execution mode `REAL_CANDIDATE`; plus the anchor. A missing, malformed or non-hash expectation → `EXPECTATION_MISSING`.

- `OFFLINE_SIMULATION` records → `OFFLINE_SIMULATION_NOT_REAL` (even with a trusting anchor and perfect expectations); an unknown provenance label → `PROVENANCE_MISMATCH`; asking the reader for any mode but `REAL_CANDIDATE` → `EXECUTION_MODE_NOT_REAL`.
- Permit: missing expectation → `EXPECTATION_MISSING`; a different hash, or a record without the permit hash → `PERMIT_IDENTITY_MISMATCH`. The same holds for attestation identity.
- An `ok` answer means "authentic, committed, bound to the expected run"; it is not a PASS verdict — callers must still read the returned `decision`.

## H3 — residual PASS record

**Before:** a record could be published and then fail a later fsync/read-back step; if its removal also failed, a complete PASS file remained and looked authoritative.

**Now:** authority comes from a **commit marker**, not file existence. `publishEvidenceBundle`: atomic record publication → directory fsync → independent read-back of the exact bytes → atomic publication of `<runId>.commit.json` (run, scope, SHA-256 and byte length of the record) → that marker's own read-back. On any failure after the record is visible: the record is unlinked; if unlinking fails a `<runId>.revoked` marker is attempted; either way there is no commit, so the record is non-authoritative.
The reader requires: record present (read with `O_NOFOLLOW`, symlinks ignored), commit present, well-formed and bound to the exact record bytes, **no revocation marker** (an unreadable revocation state counts as revoked), then the anchor. A missing, malformed, mismatched, foreign or stale confirmation → blocked. In-memory, a persistence failure still only raises severity (a known FAIL stays FAIL) and surfaces `residualRecord`.

## Negative-test results (local offline; not CI)

Required cases A–S are covered. Highlights: modified record with unchanged / recomputed digest; OFFLINE_SIMULATION vs real; missing / wrong permit and attestation identity; wrong run / candidate / scope / budget; unconfirmed, malformed, mismatched and foreign commits; late fsync failure at three points, read-back failure and tampered confirmation read-back, commit-link failure, **failed unlink leaving a real residual PASS record** (revocation marker recorded, reader blocks); **crash injection at every one of 120 I/O steps** with a trusting anchor — authoritative only when publication reported success; symlinked record never read; known FAIL stays FAIL; budgets 1 and 3; default admission BLOCKED; default live gate false; no key or signature primitives in the code; no stray command reached any fake spawn.

| Suite | Passed | Failed |
| --- | ---: | ---: |
| One-call (57 prior + 12 new) | 69 | 0 |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| **Total** | **246** | **0** |

`node --check` passes on both scripts and the test file; `git diff --check` is clean.

Mutation check (each reintroduced and restored): anchor ignored (2 failing tests), commit not required (2), offline records accepted (1), provenance / permit / attestation comparisons removed (1 each), expectations made optional (1 each), revocation ignored (2), commit hash not compared (1), execution mode check removed (2), bundle reporting success when the commit fails (2), local digest not checked (2), loader following symlinks (1), record mislabelled authorization-grade (1), confirmation read-back skipped (1), revocation marker never created (1). One mutant survived and is equivalent: removing the explicit anchor-presence check still blocks because the later anchor call throws and is caught — two independent guards.

## Independent read-only review (findings)

- No path was found by which a local record, an OFFLINE_SIMULATION record, a residual file or a forged-and-rehashed record satisfies the authorization-grade reader without an anchor.
- Residual limits (documented, not fixed): (1) if, after a late failure, removing the commit, removing the record **and** creating the revocation marker all fail, a bundle that looks complete can remain; the authenticating anchor must therefore sign only after final confirmation, and a future signer should refuse to sign when publication reported failure. (2) Everything depends on the future anchor's key custody and on the host clock for validity windows. (3) The pre-existing three-call serialization-fallback issue is unchanged and out of scope.

## Remaining before any real execution

1. A real, reviewed trust anchor (key custody, who may sign, verification) and its independence from the evidence directory.
2. A real attestation source / verifier (current effective-MDM proof) and a real permit issuer with a fixed ledger location — none exist.
3. A qualified (non-sampling) lifecycle collector, and real candidate qualification — nothing here was observed against Claude Code 2.1.292.
