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
  repairs or deletes them. While anything is corrupt, `createPlanned()` and `authorizeStart()` refuse.
* **Single writer.** Opening takes `writer.lock`. A second instance or process gets `JOURNAL_LOCKED`. Every operation re-reads the
  lock and refuses (`JOURNAL_NOT_OWNER`) if its token is gone, so a fenced or zombie writer cannot write. A lock is taken over only
  if it names **this host** and a **provably dead pid**, serialised by an exclusive `takeover.lock`. An interrupted takeover, a
  malformed lock or a lock from another host stays locked until an operator acts.
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
| `KNOWN` | a record **and** a container agree on exact id, name, all three labels and image digest | `REPORT_TO_OPERATOR`; `eligibleForVerifiedAdoption: true` (a later phase must still re-inspect) |
| `ORPHAN` | ownership labels but no journal record, and no lookalike record | `REPORT_TO_OPERATOR` — **never deleted** |
| `MISSING` | a record whose container is absent from a complete listing | none if `DESTROYED`, else report |
| `OTHER` | does not claim our ownership labels or name prefix | none; not inspected further |
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
