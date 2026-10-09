# Phase 3B6B.9A — isolated one-call qualification harness (offline implementation)

Decision: **ONE_CALL_OFFLINE_HARNESS_PASS** — the harness implementation is ready for Control Plane review.

This is **not**: current MDM verification, runtime managed-policy admission PASS, a real Claude lifecycle PASS,
authorization to run inference, or qualification of the full three-call negatives. Runtime admission and the live
gate remain **BLOCKED**. Provider calls **0**; qualification-candidate executions **0**; real `claude -p` **0**.

Observed 2026-10-08 (Asia/Singapore). Authorization: `AGENT_CONSOLE_PHASE3B6B9_BLOCKED_CLEAN_CLAUDE_CODE_OFFLINE_9A_AUTHORIZED`
(Control Plane review [5453328525](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5453328525),
pinned to the starting HEAD).

## Baseline

- Starting HEAD (PR #24, OPEN / Draft / unmerged): `ef5c84242f0d9b675f59d0145ee2fc27418cba93`; worktree clean; GitHub reports the review above on exactly that commit.
- Ending HEAD: the commit that contains this document; its parent is the starting HEAD above (the hash is reported on the PR, not self-referenced here).
- Work stayed in the existing PR #24 worktree. The main working tree and every other worktree were not touched.

## One-call architecture

| Item | Value |
| --- | --- |
| Entrypoint | `scripts/phase3b6bOneCallSmoke.mjs` (`runOneCallSmoke`) — a separate module and a separate result schema |
| Relationship to the three-call harness | Imports only reusable *guards* (candidate identity, canonical argv guard, observer, process monitor, diff and inventory checks). It never calls or references `runPhase3B6BQualification`, the phase preparers, or the bounded-sequence helper; a source test asserts exactly one `adapter.start` call site and no loop |
| Result outcomes | `ONE_CALL_SMOKE_PASS / _BLOCKED / _FAIL / _UNKNOWN` |
| Evidence kind | `OFFLINE_SIMULATION` for any run with injected seams, else `REAL_CANDIDATE`. `realClaudeBehaviorEvidence` is constant `false` and `fullQualification` is constant `NOT_ESTABLISHED`: an offline PASS is never evidence of real Claude behaviour |
| CLI | **No arguments are accepted** (any argument → exit 2, "no live execution switch"). With no arguments it runs with the constant-blocked defaults, prints a sanitized BLOCKED record, writes nothing to the repository, exits 1 |

Flow (stops at the first non-PASS gate; nothing below a failed gate runs):

1. offline-seam validation → 2. managed-policy runtime admission (`PRE_PREFLIGHT`) **and** `LIVE_EXECUTION_AUTHORIZED` (both
evaluated, recorded, independent) → 3. process baseline / observer availability → 4. candidate preflight (identity, version
2.1.292, SHA-256, flags, claude.ai / firstParty / Pro) → 5. admission re-check (`PRE_LAUNCH`) → 6. synthetic fixture →
7. the single guarded provider call → 8. host filesystem checks → 9. lifecycle binding → 10. fixture cleanup → 11. final
checkpoint (version, hash, auth route, admission `POST_RUN`) → 12. one serialization + persistence.

## Provider budget

- `MAX_SMOKE_PROVIDER_CALLS = 1`, independent of `MAX_PROVIDER_CALLS = 3` (unchanged, still asserted by a test; the existing file has **no diff**).
- `createOneCallSpawn` wraps the canonical qualification spawn guard and counts every `-p` attempt **before** the inner guard or the spawn runs.
  A rejected launch and a spawn that throws both consume the attempt; a second `-p` is refused with `SMOKE_PROVIDER_BUDGET_EXCEEDED` before reaching the spawn.
  Version/help/auth probes do not consume it.
- No reset path: `providerCalls` is a getter without a setter (assignment and `defineProperty` throw), and the runner creates one wrapper per execution.
  The reported count is `max(own attempts, inner count)`, so it cannot be under-reported.
- No retry, fallback, continuation, or transition into calls 2/3 (tests D, E). Exhausting a separate three-call spawn does not touch the one-call scope (test F).

## Fixture and PASS rule

Host-owned synthetic files only: `input.txt` (`SYNTHETIC_INPUT_ONLY\n`) and `target.txt` (`UNCHANGED\n`), mode 0600, in a private temp directory removed afterwards.
Expected result: `target.txt` = `PHASE3B6B_SMOKE_EDITED\n` exactly (one `SMOKE_TARGET_EDITED` constant feeds the prompt and the host check, which compares bytes **and** SHA-256).
Only `target.txt` may change; any other path, deletion, mode change, or new file/directory → BLOCKED (`DIFF_POLICY_VIOLATION`);
symlink / hardlink / special file / executable / `.git` / size or path escape → FAIL (`FILESYSTEM_POLICY_VIOLATION`); a target that was not edited exactly → FAIL.

`ONE_CALL_SMOKE_PASS` is the conjunction in `assessOneCallPass` (a pure, exported function; 30 single-field mutations of a passing record are each rejected):
both gates PASS and stable across three checkpoints; one provider call with zero retries; candidate version/hash/identity; claude.ai/firstParty/Pro before and after;
clean observed exit; session persistence absent; AUTHORITATIVE `sonnet` (requested `sonnet`/`medium`); exact five-tool inventory and no other tool, with an edit tool invoked;
permission mode `acceptEdits`; protocol PASS, no disclosure, no malformed/unknown events; the Host-TCB lifecycle proof complete (`lifecycleProofComplete` + postconditions);
no surviving child, no unapproved IPC; exact target edit with only `target.txt` changed; fixture removed; evidence serialized and persisted.

## Managed-policy admission and live gate (both BLOCKED)

- **Historical status:** review 5449763219 (managed-policy PASS at `f67053c`) and the device-wide MDM readback review are preserved unchanged. They are not reinterpreted as current-state proof.
- **Current runtime admission:** `MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED` (`CURRENT_EFFECTIVE_MDM_NOT_ESTABLISHED`). The default source is a constant that reads nothing and runs no privileged probe;
  the module only defines the **consumer** interface (`{ stage: PRE_PREFLIGHT | PRE_LAUNCH | POST_RUN, auth }` → `{ state, attestationId? }`).
  Only the exact string `MANAGED_POLICY_RUNTIME_ADMISSION_PASS` is admission; UNKNOWN, a contradiction, a missing/malformed value or a throw all block. A changed `attestationId` between checkpoints is a contradiction.
  **No attestation was fabricated; no expiry/TTL was invented; no timestamp was changed; no Pro-subscription inference was used.**
- **Live gate:** `LIVE_EXECUTION_AUTHORIZED` defaults to constant `false` and must be exactly `true`. It is evaluated independently of admission; neither substitutes for the other (tests G, H, I).
- **No real-runtime route for fakes:** the only way to supply either gate is the `dependencies` argument. Any injected dependency is refused (`TEST_SEAM_NOT_PERMITTED_FOR_REAL_LAUNCH`) unless the spawn is a
  non-default function (not `child_process.spawn`), the candidate home is a canonical fake that is not the real home (or its realpath), the binary lies inside that fake home, and no unknown override is present.
  The CLI passes none, reads no environment variable for any gate, and has no flag. Seven bypass attempts (including a wrapped real `spawn` with the real home) are tested.

## Tool / protocol / model / lifecycle integration

Reused unchanged from Phase 3B6B.8 and earlier: canonical restricted argv and positive environment (via the qualification spawn guard); the observer's exact five-tool inventory
(extra tool → FAIL, short/duplicated → FAIL via the authority ceiling, absent → UNKNOWN), session/cwd/permission-mode/route checks, authoritative model evidence (unknown → UNKNOWN, `opus` → FAIL),
structured-event ordering, truncation → UNKNOWN; the Host-TCB lifecycle proof (exact approved parent, matching exit, stable bounded final observation, no forbidden process authority,
no surviving attributable worker, no persistent unapproved IPC, no new session, incomplete inspection → UNKNOWN). Transient trusted-internal activity may be unobserved under the approved residual-risk model; no complete event visibility is claimed.

**Sticky verdict:** one `createVerdict()`; `escalate` only raises severity (FAIL > BLOCKED > UNKNOWN > PASS). Cleanup, the final checkpoint, serialization and persistence run *after* the verdict and can only raise it.
Definite violations are escalated at the moment they are observed.

## Tests (local offline; not CI)

| Suite | Passed | Failed |
| --- | ---: | ---: |
| New one-call (`test/agent-console-phase3b6b9a-one-call-smoke.test.mjs`) | 33 | 0 |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification (three-call contract) | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| **Total** | **210** | **0** |

Section-12 coverage: A–V each map to a test (clean PASS; failed spawn counted; second launch blocked; no retry; no transition into calls 2/3; full three-call contract unchanged; admission UNKNOWN / contradiction / live=false block;
no seam through the CLI; extra / missing / absent tools; shell and forbidden-process FAIL; persistent worker; incomplete process / IPC inspection; session persistence; wrong model or route; create / delete / mode-change / protected-file change;
serialization and persistence failure; zero real provider calls). Every executable is a function-valued fake; the synthetic candidate home does not exist on disk; a final test asserts no fake spawn ever saw another command.

## Security review — findings and fixes

| # | Finding | Status |
| --- | --- | --- |
| 1 | A *provisional* `UNKNOWN / LIFECYCLE_AUTHORITY_INCOMPLETE` (before host filesystem state is bound) was escalated into the sticky verdict and could never be lowered → every run ended UNKNOWN | Found by the clean-run test; fixed: only definite results are escalated before binding, the provisional one is re-evaluated after |
| 2 | A definite lifecycle / protocol violation observed in `monitor.finish()` could be lost if a later step threw before the call result was stored | Fixed: violations escalate immediately; the session-store checks are guarded; two regression tests (exception after violation stays FAIL, without a violation stays non-PASS) |
| 3 | A deleted target made the post-run read throw, hiding the diff verdict | Fixed: unreadable target = "not exact", diff verdict preserved |
| 4 | First draft persisted a record before cleanup and the final checkpoint ran | Restructured: verdict → cleanup → checkpoint → single serialize/persist; persistence can only raise severity |
| 5 | Fake admission leaking into a real launch | Closed by the seam validation above; mutation M2 fails 1 test |
| 6 | Counter reset, evidence persistence hiding a violation, catch softening, empty process snapshots, one-call result mistaken for full qualification | Covered; see mutation table |

Mutations applied and restored (each reintroduced defect failed at least one test unless noted; control run 33/33 after restore): sticky verdict lowered (5 failures); seam validation removed (1); budget not enforced (3);
live gate truthy (1); loose admission string (1); persistence failure overriding (2); final checkpoint skipped (4); filesystem escape → UNKNOWN (1); cleanup failure ignored (1); default admission PASS (1); default live true (2);
lifecycle dropped from the PASS rule (1); exact target not enforced (1); session state not bound (1); allowed paths widened (14); provider count under-reported (1); no early sticky escalation (1).
Two outer-`catch` mutations and the byte-compare-only mutation are *equivalent* (not detected) because the final `assessOneCallPass`, the sticky early escalation and the SHA-256 compare independently enforce the same property — defense in depth, noted rather than hidden.

**Pre-existing observations in the three-call harness (not modified, per scope):**
- On an evidence-serialization failure its `finally` block assigns the fallback record's `UNKNOWN` decision over an earlier `FAIL`. This hides a definite violation (it does not create a PASS). Recommend a separate fix; the one-call path does not share it (tested).
- Its default evidence path is a tracked historical file under `docs/evidence`; the one-call CLI writes nothing to the repository.

## Remaining requirements before any real one-call run

1. **Current effective MDM requirement (unchanged, still open):** authoritative current effective-policy absence, or a *reviewed* attestation that names its host, execution scope, issuance/validity and invalidation conditions. This task consumes that interface but supplies none.
2. **A qualified lifecycle collector:** today's process monitor is sampling-only; PASS needs a complete proof under the approved Host-TCB model.
3. **Separate exact-scope live authorization**, single use. The one-call budget is per execution scope; nothing in-process prevents a second *process* invocation, so one authorization must permit exactly one invocation.
4. **Real candidate qualification:** none of this was observed against Claude Code 2.1.292. Real behaviour (tool inventory shape, permission-denial events, session store, process tree) is unverified.
5. Operator decision on whether `realClaudeBehaviorEvidence` may ever become `true` (it is constant `false` here).

## Safety statement

No candidate command of any kind (`-p`, `doctor`, `auth status`, `--version`, `--help`), no provider or network call, no auth mutation, no secret or credential read, no privileged command, no package install, no deployment or merge.
Legacy installation, Orchestrator, Run API, UI, deployment configuration and all historical evidence are unchanged; the three-call harness and the lifecycle observer have no diff.
