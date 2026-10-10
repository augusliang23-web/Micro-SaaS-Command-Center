# Phase 3B7B2B-A0 — Durable Execution Identity Foundation

Status: OFFLINE foundation only. `REAL_AGENT_EXECUTION = NOT_AUTHORIZED`.

This phase adds the data layer that later phases need for safe task cancellation and crash recovery. It does **not** start, stop,
cancel, resume, adopt or remove anything, calls no Docker daemon, mounts no route and does not touch `server.ts`.

Files (all new, under `server/execution/identity/`):

| File | Purpose |
| --- | --- |
| `executionIdentity.mjs` | The record schema, strict validation, stage table, planned-record builder. Data and validation only. |
| `identityJournal.mjs` | `ExecutionIdentityJournal`: single-writer, atomic, owner-only, fail-closed durable storage. |
| `recoveryClassifier.mjs` | A pure function that classifies journal records against a container listing (fake data in this phase). |

## 1. The identity record

One JSON file per execution, `records/<runId>.json`, never deleted or re-created.

| Field | Source | Rule |
| --- | --- | --- |
| `schemaVersion` | constant | exactly `1` |
| `taskId`, `runId` | server | existing `CC-…` / `RUN-…` patterns |
| `sandboxId` | server | sandbox policy pattern; unique in the journal |
| `role` | server | `agent` or `verifier` |
| `containerId` | recorded after `docker create` | `null` while `PLANNED`; exactly 64 lowercase hex afterwards; written once, unique in the journal |
| `containerName` | derived | must equal `cc-sandbox-<role>-<sandboxId>`; never supplied |
| `imageDigest` | server image registry | `sha256:` + 64 hex |
| `labels` | derived | exactly `cc.sandbox=1`, `cc.sandbox.id`, `cc.sandbox.role`, matching the record; never supplied |
| `executionGeneration` | journal | per task: 1, then 2, … |
| `revision` | journal | +1 on every write (compare-and-set) |
| `writerEpoch` | journal | the process generation that wrote it |
| `stage` | journal | `PLANNED → CREATED → START_AUTHORIZED → RUNNING → STOPPING → STOPPED → DESTROYED`, or `UNKNOWN` |
| `createdAt`, `updatedAt` | journal | UTC ISO-8601 with milliseconds |
| `stateRootId` | journal | identity of this journal; a record copied from another journal is rejected |

Unknown keys are refused. There is no free-text field, so there is nowhere to put a credential. A caller cannot supply a container
id, name, label, image path or host path: `createPlanned()` accepts exactly `taskId, runId, sandboxId, role, imageDigest` and
refuses anything extra. Nothing in this phase takes input from a browser.

The `SANDBOX_ID` pattern, the naming rule and the three labels are **mirrored**, not imported, from the sandbox policy (the
repository's scope test allows only the verifier to import the sandbox modules). A drift-guard test compares them.

## 2. The journal

```
<root>/                 mode 0700, owned by the current user, canonical path, not a symlink
  meta.json             { schemaVersion, stateRootId, epoch }; epoch +1 on every open
  writer.lock           single-writer lock (exclusive create); removed by close()
  records/<runId>.json  mode 0600
```

* **Atomic writes**: exclusive-create temp file (0600) → write loop with progress checks → `fsync` → `rename` → directory `fsync`
  (a failed directory flush is an error, not ignored) → read back and compare.
* **Reads**: `O_NOFOLLOW | O_NONBLOCK`, then `fstat`: regular file, one link, current owner, no group/world bits, ≤ 16 KiB. Anything
  else is `JOURNAL_CORRUPT`. Records are validated against the strict schema and against `stateRootId` and their own file name.
* **Corruption fails closed.** `scan()` reports corrupt or unexpected entries and never skips them silently; the journal never
  repairs or deletes them. A scan also validates the complete identity set. While anything is corrupt, planning, transitions, new start authorization and validation of an existing start ticket refuse. Single-record reads remain diagnostic and do not establish whole-journal trust.
* **Single writer.** Opening takes `writer.lock`. A second instance or process gets `JOURNAL_LOCKED`. Every operation re-reads the
  lock and refuses (`JOURNAL_NOT_OWNER`) if its token, PID or hostname differs, so a fenced or zombie writer cannot write. A lock is taken over only
  if it names **this host** and a **provably dead pid**, serialised by an exclusive `takeover.lock`. An interrupted takeover, a
  malformed lock or a lock from another host stays locked until an operator acts. Lock creation and every ownership read require exactly schemaVersion=1, a 32-character lowercase hex token, a positive safe-integer PID, a valid nonempty ASCII hostname and a canonical millisecond UTC timestamp; extra/missing fields are refused before a liveness probe. Only an explicit false liveness result permits takeover. The complete lock is compared again during takeover; close releases only a matching token/PID/hostname.
* **Generations**: `revision` is a compare-and-set counter (`STALE_REVISION`). `executionGeneration` counts executions per task. A
  task may start a new execution only when every earlier one is `DESTROYED`; an `UNKNOWN` one blocks it until an operator
  resolves it (a later phase defines that action). Run ids and sandbox ids are never reused.

### Start authorization (the double-execution contract)

`transition()` can never write `START_AUTHORIZED`. Only `authorizeStart(runId, revision)` can, and only from `CREATED`, so the exact
container id is already durable. It writes the record, then returns a frozen authorization naming that exact revision and the
process epoch. `assertStartAuthorized()` re-reads the disk and denies the launch if the record moved on, the epoch differs
(any restart), the journal differs, or the identity differs. A second `authorizeStart` for the same run is impossible. If the
write or its directory flush fails, **no authorization is returned**, and the run can never launch (recovery later sees an
interrupted start and classifies it UNKNOWN).

## 3. Crash-consistency contracts

| Crash point | What is on disk | Contract |
| --- | --- | --- |
| Before `docker create` | `PLANNED`, no container id | No container exists. Classified `MISSING`; execution outcome `UNKNOWN`. |
| After create, before the journal write of `CREATED` | `PLANNED`; a container with the planned name/labels exists | The container's id is not recorded, so it is **not** proven ours: `UNKNOWN` (`CREATED_BEFORE_JOURNALED`), never adopted, never removed. |
| After `CREATED` is durable, before start | `CREATED` + exact container id | Safe by construction: nothing launches without a later `authorizeStart`. After restart: `KNOWN`, outcome `UNKNOWN`. |
| After `START_AUTHORIZED`, before/while running | `START_AUTHORIZED` or `RUNNING` | The authorization dies with the process epoch. Recovery: `KNOWN`, outcome `UNKNOWN`. Never re-launched. |
| During stop | `STOPPING` | Same: `KNOWN` if the exact container is present, outcome `UNKNOWN`. |
| Interrupted write (temp file left) | previous record intact | Temp files are reported (`leftoverTemp`), never read as records, never silently deleted. |
| Torn/hand-edited/corrupt record | corrupt file | `JOURNAL_CORRUPT`; every classification becomes `UNKNOWN`; no planning or authorization. |
| Two Command Center processes | one `writer.lock` | The second gets `JOURNAL_LOCKED`; a zombie holder is fenced. |
| Missing or mismatched container | record vs. listing | `MISSING`, or `UNKNOWN` on any id/name/label/image mismatch. |
| Docker listing incomplete or Docker down | — | Nothing can be claimed: every entry is `UNKNOWN`. |

An interrupted or ambiguous execution is always `UNKNOWN`. The only `SETTLED` outcome is a `DESTROYED` record whose container is
verifiably absent from a complete listing.

## 4. Offline recovery classification

`classifyExecutions({ records, corrupt, containers, listingComplete })` is pure. It returns frozen entries:

| Class | Meaning | Recommended action |
| --- | --- | --- |
| `KNOWN` | globally valid input; a nonterminal record **and** a container agree on exact id, name, all three labels and image digest | `REPORT_TO_OPERATOR`; `eligibleForVerifiedAdoption: true` (a later phase must still re-inspect) |
| `ORPHAN` | ownership labels but no journal record, and no lookalike record | `REPORT_TO_OPERATOR` — **never deleted** |
| `MISSING` | a record whose container is absent from a complete listing | none if `DESTROYED`, else report |
| `OTHER` | no exact recorded ID match and no ownership labels or name-prefix claim | none; never treated as owned |
| `UNKNOWN` | anything ambiguous: lookalike with a different id, any field mismatch, duplicates, partial ownership claims, malformed data, corrupt journal, incomplete listing | `OPERATOR_REVIEW` |

A label match alone never proves ownership; only the container id recorded before the container could start does. The result has
no "remove" action and `autoCleanup` is always `false`.

## 5. Not done in this phase (deliberately)

No real Docker adoption, stop or removal; no Start/Cancel/Resume; no routes; no `server.ts` change; no verifier wiring; no
operator "resolve UNKNOWN" action; no fixed sandbox state root; no real agent, provider or credential.

## 6. Remaining risks

* **Records are unsigned.** A process running as the same user can forge them. This protects against crashes, races and mistakes,
  not against a hostile same-user process (the same model as the unsigned local approvals). Real agents need a trust anchor.
* **The lock check and the write are not one atomic step.** A holder that loses its lock between the check and the rename can
  still complete that one write. The compare-and-set revision and the epoch fence limit the damage; a kernel-level lock would
  close it and is not used here.
* **Pid-based staleness** can be fooled by pid reuse on the same host; the failure mode is a refused open (fail closed) except when a
  different live process reuses the dead holder's pid, which also refuses.
* **Docker's own state** (a container created but never journaled) can only be detected, not prevented, offline; the journal
  records intent first so that case is always `UNKNOWN`, never silently owned.
* **Journal growth**: records are never deleted; pruning is a later, operator-controlled decision.


## 7. A0 security remediation and exact offline evidence

Starting PR #27 HEAD: `049c3908f63d5999c26bacce2f2dd29c6876a72b`.
Final executable source/test/catalog/runner commit: `059b178b70534308dd383646f8da5d293fc1ff02`.
The subsequent evidence commit changes documentation/evidence only. This is an offline foundation gate; it does not authorize A1 or real agent execution.

### Implemented recovery and journal corrections

* **R1 — present ID wins over OTHER.** Exact recorded container IDs are checked before ownership claims. A present ID with a foreign name, absent/wrong labels, role or digest remains `UNKNOWN`, requires operator intervention and is never adoption eligible. Tests include simultaneous foreign name and absent ownership labels. Only genuine absence in a complete, globally valid listing permits `DESTROYED_AND_ABSENT / SETTLED`.
* **R2 — records must be coherent together.** `validateIdentityRecords()` independently checks duplicate run IDs, sandbox IDs, non-null container IDs and derived names; mixed state roots; duplicate/non-contiguous generations; an earlier generation that is not DESTROYED; backwards creation history or writer epoch. A task history starts at generation 1 and is contiguous. Each next generation requires the preceding record to be DESTROYED, its creation time to be no earlier than the prior update, and its writer epoch not to move backwards. Scans report these as corruption, preserve files and block planning/start. The pure classifier runs the same validation independently. Prospective writes are validated as a set before persistence. Lawful sequential generations remain supported.
* **R3 — UNKNOWN is terminal.** Even an exact container match stays classification/outcome UNKNOWN, operator intervention true and adoption false. Identity remains diagnostic; no resume, retry or start authorization is restored.
* **R4 — every lock field is validated.** Malformed locks cannot justify takeover and are not used for process-liveness probes. Existing and generated writer identities use the same strict validation. Same-host, provably dead-PID takeover and writer fencing remain supported; uncertain liveness is insufficient. Closing a fenced writer cannot remove a replacement lock, including a replacement that retains its token but changes PID/hostname.
* **Global fail closed.** Any corrupt entry, invalid/coherently conflicting record set, malformed arrays, incomplete listing, malformed container or duplicate normalized container ID/name blocks the entire result. No KNOWN or SETTLED result is emitted. Sparse array holes are explicitly validated as malformed evidence. Diagnostics may include both record and listing rows; these are all UNKNOWN, not trusted partial success.
* **Crash consistency.** Exclusive temp creation refuses deterministic collisions without overwriting or deleting the planted file; cleanup removes only a temp file this write actually created. Structurally valid but different read-back revisions raise JOURNAL_IO. Clock rollback is rejected before writing, including a rollback that remains after createdAt but precedes the previous revision. Direct reads also bind a record's runId to its filename. A record disappearing during enumeration is reported as corruption, not a healthy empty journal.

### Verification at the final source commit

Local offline validation, not CI:

| Check | Result |
| --- | --- |
| A0 journal + crash + classification | 97/97 PASS |
| Sandbox policy/scope tests with fake executables | 34/34 PASS |
| Combined focused/mutation baseline | 131/131 PASS |
| Full offline regression, 36 test files, excluding every `*.integration.*` | 596/600 PASS; four existing environmental failures |
| Modified JavaScript syntax checks | PASS |
| Diff whitespace check | PASS |
| Source SHA/tree and per-file mutation snapshot consistency | PASS |
| Runner fault checks: stale PASS, invalid workers, skipped baseline, empty selection, cleanup failure | Correctly HOLD / exit 1 |
| Runner input-overwrite attempt | Refused; source bytes unchanged |

The four regression failures are `agent-console-phase1`, `github-repos`, `local-state`, and `zero-copy-handoff`, all `ERR_MODULE_NOT_FOUND` for `express`. They remain failures, not PASS. No dependencies were installed. No new unexplained regression was observed. Docker integration files were excluded; the sandbox tests use fake executables and contact no daemon.

### Honest mutation classifications

Final evidence: [agent-console-phase3b7b2b-a0-mutation-results.json](../evidence/agent-console-phase3b7b2b-a0-mutation-results.json).

The catalog preserves all 115 original IDs and adds 21 focused guard mutations: **136 total, 125 CAUGHT, 11 EQUIVALENT_WITH_PROOF, 0 SURVIVED_UNEXPLAINED**. There are zero pattern errors, invalid mutants, harness errors or worker errors. The three challenged mutations (exclusive temp creation, read-back equality, pre-commit validation) are all CAUGHT by deterministic assertions. An initial run at `9bb5274aa87cbe73e475227260eac5f92925ac6f` was correctly HOLD (119 caught, 9 proof equivalents, 4 unexplained survivors, 4 harness errors); it was not accepted as final evidence. The follow-up commit repaired missing assertions and documented two redundant regex guards, then reran the complete catalog against the final commit.

The old informal equivalence strings were removed. The 11 current proofs have explicit rationale, assumptions and source evidence:

| Proof group | Count | Scope |
| --- | ---: | --- |
| Filesystem root and directory-symlink disjunct | 2 | POSIX path semantics and coherent Node lstat type predicates |
| Atomic-write payload bound and revision-step assertion | 2 | Current closed schema/private callers: maximal identity JSON is 862 bytes (meta 107), below 16 KiB; private advance constructs previous revision +1 and validation rejects overflow |
| Redundant local duplicate/malformed classifier branches | 5 | Stable ordinary input data; unchanged global validators return before these local branches; separate mutations exercise the global guards |
| Explicit token-length / whole-hostname character exclusions | 2 | Unchanged full-string ASCII regexes already imply these checks; no multiline flag |

These proofs are scoped to the exact current source and stated assumptions. Low probability, difficult injection, or failure later is not an equivalence argument. The proofs do not cover mutating accessors/proxies or contradictory filesystem test doubles.

The mutation runner binds a private immutable snapshot to the committed source SHA/tree and per-file SHA256/Git blob identities, checks its green baseline, syntax-checks mutants, requires explicit assertion failures for CAUGHT, and checks source/snapshot stability. Syntax/load/spawn/timeout/signal/unknown failures cause HOLD rather than increasing caught counts. Unexplained survivors also cause HOLD. Report output is invalidated to HOLD before preflight and PASS is published only after successful private-copy cleanup. Acceptance requires CLI exit 0, a fresh full-catalog report and matching source provenance; selected-only runs are not the full gate.

### Preserved scope and remaining risks

No Docker daemon, real Claude/Codex, provider call, credentials, new route, operational recovery/adoption/cleanup, Orchestrator activation, merge or deployment. `REAL_AGENT_EXECUTION = NOT_AUTHORIZED`. PR #27 remains Draft and stacked on unchanged PR #26 / #25; the original main checkout and its eight pre-existing dirty files remain intact.

Records and locks remain unsigned local state, not a trust anchor against a hostile same-user process. Set validation and pathname/existence checks are not a transaction with all concurrent host filesystem changes; a lock check and later rename are still separate steps. These fixes strengthen offline corruption, recovery and evidence handling without claiming kernel isolation, cryptographic authenticity, real Docker proof or agent execution readiness.
