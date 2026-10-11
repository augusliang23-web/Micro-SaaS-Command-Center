# Phase 3B7B2B-A1-0 — Pending Action Foundation

Status: OFFLINE data foundation only. `REAL_AGENT_EXECUTION = NOT_AUTHORIZED`.

This phase adds the durable data the later "Continue After Approval" work needs. It does **not** resume anything: no approval is
consumed, no Git command runs, no branch is pushed, no Docker call is made, and there is no route, no Resume API and no Cancel API.
A1-1 (the resume protocol) and A1-2 are not started.

| Area | Files |
| --- | --- |
| New | `server/execution/continuation/pendingActionTypes.mjs`, `pendingActionStore.mjs` |
| Edited | `server/tasks/types.mjs`, `server/tasks/stateTransitions.mjs`, `server/tasks/taskStore.mjs` |
| Not touched | `server.ts`, routes, UI, Orchestrator, ApprovalGate, WorktreeManager, DockerSandboxRuntime, ContainerFakeAgentAdapter |

## 1. Task states

| State | Active? | Meaning |
| --- | --- | --- |
| `AWAITING_APPROVAL` | no | The task is paused for a human decision. No execution is live. It survives restart unchanged (the file is not even rewritten) and never moves, never executes and never becomes "approved" by itself. There is no `APPROVED` status. |
| `PUBLISHING` | **yes** | A Git publication step is in flight. After a restart it is rewritten as `UNKNOWN` (the existing recovery for active states). It is never retried and never inferred complete. |

Transitions added (everything else, including every terminal state and `VERIFYING -> COMPLETED`, is unchanged):

* `VERIFYING -> AWAITING_APPROVAL`
* `AWAITING_APPROVAL -> PUBLISHING | BLOCKED | CANCELLED | UNKNOWN`
* `PUBLISHING -> AWAITING_APPROVAL | COMPLETED | BLOCKED | FAILED | UNKNOWN` (no `CANCELLED`: Git steps are not interruptible)

`TaskStore.update` additionally refuses `PUBLISHING -> COMPLETED` unless the resulting task carries a `commitSha` and a `pr` record with
`verifiedAt`. That is a data-level refusal of a bare status change; the authoritative evidence check belongs to A1-1. The existing
evidence kind list (17 kinds) is unchanged.

## 2. The pending action record

One strict JSON record per revision. It holds only bounded metadata computed by the server: no source contents (only SHA-256 hashes), no
absolute execution paths, no commands, no prompts, no agent output, no credentials, no approver. Unknown or missing keys are refused.

| Field | Rule |
| --- | --- |
| `schemaVersion` | `1` |
| `pendingId` | `PND-` + 32 hex, chosen by the store |
| `revision` | 1..32, +1 per change |
| `taskId`, `projectId`, `runId` | existing id patterns |
| `executionIdentity` | `NOT_JOURNALED` (all references `null`) or `JOURNALED` (`stateRootId`, `executionGeneration`, and a `runId` that must equal this record's run) |
| `action` | the first step that is not `DONE`; `null` when all are |
| `branch` | the generated `agent/<taskId>-<slug>` branch of this task |
| `baseSha`, `expectedHead`, `treeSha` | 40-hex object ids. `expectedHead` equals `baseSha` until `COMMIT` is `DONE`, a different commit afterwards |
| `diffDigest`, `manifest` | manifest of 1..200 safe relative paths (sha256, size, exec flag, or `deleted`); the digest must equal the digest of the manifest |
| `verification` | reference to passing `command_result` evidence (`EV-` + 32 hex) graded `LOCALLY_VERIFIED` or higher |
| `guardSnapshot` | the source HEAD and five SHA-256 digests (status, fingerprint, remote, remote-before, branches-before) |
| `steps` | `COMMIT`, `PUSH_BRANCH`, `CREATE_PR`, each `PENDING -> CLAIMED -> CONSUMED -> DONE` |
| `status` | `OPEN`, `REVOKED`, `COMPLETED`, `INTERRUPTED`, `SUPERSEDED` |
| `authenticity` | `UNAUTHENTICATED_LOCAL_APPROVAL` (same classification as the approval records; never raised) |
| `createdAt`, `updatedAt`, `expiresAt` | UTC ISO-8601 ms; lifetime 1 s .. 24 h (default 1 h) |

**It is not an authorization token.** It has no approver, no approval id and no capability, and the modules never touch `ApprovalStore`
or `ApprovalGate`. Server-side paths must be re-derived from the project registry by a later phase; only relative manifest paths are stored.

**Steps.** Only the current action may move, one state at a time; a step can only be non-`PENDING` if every earlier step is `DONE`, so at
most one is ever in flight. The last `DONE` completes the record in the same revision. `REVOKED` and `SUPERSEDED` are refused while a
step is `CLAIMED` or `CONSUMED` (too late); `INTERRUPTED` is always possible. Claiming an expired record is refused. These are
records of state only: advancing a step executes nothing and consumes nothing.

**NOT_JOURNALED** means "the container identity was not proven through the A0 durable startup protocol". It does not mean no container
existed and does not mean cleanup was verified. `assessExecutionIdentity()` never returns `proven: true` for it, even next to a perfectly
matching journal record. A `JOURNALED` reference is proven only when the A0 journal has the same task, run, state root and generation and
**every** execution of the task is `DESTROYED`. Even then it is not cleanup evidence and not an authorization: A1-1 must still require
independent authoritative completion and cleanup evidence.

## 3. Durable storage

```
<root>/                         0700, server-chosen, normalized, canonical, owned by the current user
  records/<pendingId>/0000000001.json   one IMMUTABLE file per revision, 0600, single link
  tasks/<taskId>.<10-digit-generation>.open   immutable exclusive generation claim
```

* **Compare-and-set without a lock.** A revision is written to a temp file (exclusive, fsync) and *published* with `link(2)`, which
  fails with `EEXIST` if the revision already exists. Racing writers (threads or processes) resolve atomically: exactly one wins, the other
  gets `STALE_REVISION`. A replayed revision is the same `EEXIST`. History is never overwritten. A crash can leave a temp file or a published claim whose record is missing.
* **Write outcomes are explicit.** `WRITE_FAILED` = the attempted revision was not published. On create a previously published marker is retained, so this does not mean no persistent side effects. `WRITE_AMBIGUOUS` = the revision may be on
  disk (failure after publication: temp-name removal, directory fsync or read-back). An ambiguous outcome is never reported as success and
  must be treated as UNKNOWN; a blind retry with the old revision is refused as stale.
* **Reads are strict.** `O_NOFOLLOW | O_NONBLOCK`, regular file, one link, current owner, no group/world bits, at most 256 KiB, contiguous
  revisions from 1, matching `pendingId`, and the **whole history** must validate: immutable facts unchanged, each revision exactly one legal
  step or one legal status change, time never backwards. Anything else is `RECORD_CORRUPT`; nothing is repaired or deleted.
* **Interrupted writes.** Leftover temp files are reported by `list()` and never read as revisions or deleted.
* **Root safety.** Normalized absolute path with no trailing slash, nearest existing ancestor canonical *before* any `mkdir` (a symlinked ancestor present at preflight is refused), directories 0700 and owned by the current user, never silently `chmod`-ed.

### Invariants

Enforced (also across processes, because they rest on exclusive creation):

* a `pendingId` is unique (`DUPLICATE_PENDING`);
* **at most one pending action per task** (`TASK_ALREADY_PENDING`). A later generation is permitted only when the latest action ended `REVOKED` or
  `SUPERSEDED`; published markers are never removed. `OPEN`, `COMPLETED`, `INTERRUPTED`, unknown status, a missing record or corrupt history block claims (fail closed);
* **several pending actions in one project are allowed** (parallel development branches are not blocked) and are independent;
* revision continuity, immutability of facts and single-move steps on every read.

NOT enforced here (dependencies of A1-1, deliberately not claimed):

* **any project-level exclusion** (e.g. one publisher per repository): the in-memory project lock is per process, so a project-level lock or
  transaction coordinator is required;
* the coupling between a pending action and the task's status (a task in `AWAITING_APPROVAL` having a valid pending action, or the reverse);
* **rollback detection**: deleting the newest revision file makes the previous revision current again. Records are unsigned; A1-1 must pair
  this store with separate exclusive decision markers. (A test documents this as a known limit.)

## 4. Crash consistency

| Situation | Result |
| --- | --- |
| Crash before a revision temp file is published | Previous revision intact; leftover temp reported; next revision still possible |
| Crash after publication, before the caller learns | The revision exists; a retry of the old revision is `STALE_REVISION`; no double application |
| Directory fsync / temp removal / read-back failure | `WRITE_AMBIGUOUS` (never success); extra hard link detected as corruption |
| Link or write fails | `WRITE_FAILED`; a failed *create* removes only its own record directory and retains any published marker |
| Crash before marker publication | A staged marker temp blocks this task; no automatic repair |
| Crash between marker and record on create | The marker names a missing record; the task is held and fails closed pending a separately reviewed operator decision |
| Torn / hand-edited / replayed / rolled-forward revision | `RECORD_CORRUPT`; other pending actions stay readable; no repair |
| Restart with `AWAITING_APPROVAL` | Unchanged |
| Restart with `PUBLISHING` | `UNKNOWN`, no retry, no inferred completion |

There is no automatic retry and no automatic repair anywhere.

## 5. Security limitations

* Records, markers and approvals are unsigned local files. A same-user process can forge or delete them. This is protection against crashes,
  races and mistakes, not a trust anchor; the trust label stays `UNAUTHENTICATED_LOCAL_APPROVAL`.
* A reader that runs while a writer is between `link` and removal of its temp name sees two links and fails closed (`RECORD_CORRUPT`); the
  read is safe to repeat. Losers of a real race can therefore see either `STALE_REVISION` or a transient `RECORD_CORRUPT`; neither is success.
* Pending lifetime (up to 24 h) is independent of the 15-minute approval lifetime.
* **Finding about A0 (not changed here, outside this phase's allowlist):** `ExecutionIdentityJournal` creates its root with a recursive `mkdir`
  *before* checking that the path is canonical, so a root below a symlinked parent creates directories through the link before refusing.
  The new store checks the nearest existing ancestor before creating anything.

## 6. Dependencies for A1-1

1. A project-level lock / transaction coordinator (cross-process) around publishing.
2. Linking `AWAITING_APPROVAL` / `PUBLISHING` task states to the pending record, with startup reconciliation of orphaned pending records
   and markers.
3. Exclusive decision markers (resume vs revoke) and approval consumption bound to `pendingId` / `revision` (approval record v2).
4. `WorktreeManager.reopen()`: re-deriving the worktree from the registry and re-validating Git objects.
5. Independent authoritative completion and cleanup evidence for the agent execution (A2 will journal container identity before start).
6. Rollback detection (see above) and a producer for the guard-snapshot digests and the verification evidence reference.


## 7. Issue #29 security remediation (2026-10-11)

### R1: generation protocol and concurrency argument

Each marker has exactly `schemaVersion`, `taskId`, `pendingId`, `generation`; its generation must equal the 10-digit filename and
its position in contiguous history beginning at 1. Every named record must exist, validate through its entire revision history and
name the same task. Pending identities may not repeat. Every predecessor of the latest generation must be REVOKED or SUPERSEDED.
Legacy `<taskId>.open`, malformed names, generation gaps and staged marker leftovers are refused; no migration occurs.

A create reads validated history and selects exactly N+1. It stages an owner-only, exclusively created file, fsyncs it and publishes
with `link(2)` to the immutable N+1 filename. That exclusive link is the claim's linearization point (the instant one contender wins).
Two contenders using the same history target the same filename; only one link can succeed. The loser never retries for N+2 and never
unlinks a published marker. A contender seeing the winner's marker cannot proceed until that generation's record exists and is terminal.
A terminal status is monotonic under the validated legal transition protocol, so an older terminal snapshot remains safe. Revoke
publishes an immutable record revision and never deletes task markers; a stale reader may conservatively refuse but cannot double claim.
A read during the temporary hard-link window refuses the extra link. Directory fsync/readback failure yields WRITE_AMBIGUOUS, never
success. A crash after the claim but before record publication leaves a blocking marker. No task-wide in-memory lock or project-wide
lock participates in the safety argument. Different tasks target distinct filenames.

This argument covers cooperating processes using this store on a filesystem with atomic exclusive hard-link creation. It does not
establish integrity against same-user filesystem deletion/forgery or filesystem durability beyond successful fsync. Deleting a suffix
or all generations cannot be distinguished from an older history without an independent durable trust anchor. Visible interior gaps
are detected. Records and markers remain unsigned. There is no automatic repair or migration.

Independent OS-process tests use two pipe barriers: both processes first capture the same directory snapshot, then both pause immediately
before marker publication. They cover first claim, REVOKED reclaim, SUPERSEDED reclaim, revoke-versus-create, distinct-task concurrency,
and process exit before/after marker publication. Invalid-history tests cover legacy names, gaps, duplicate identities, generation mismatch,
nonterminal predecessors, unknown status, missing/corrupt records and malformed marker shapes.

### R2: temp ownership and harness integrity

`#stage` sets ownership only after successful `openSync(..., 'wx', 0600)`. Cleanup is conditional on that ownership. A deterministic
`randomHex` collision proves that failed exclusive creation preserves the existing file and bytes, publishes no revision and fails closed.
The former equivalence claim for replacing `wx` with `w` is withdrawn: rare collisions are still behavior differences.

The mutation test helper wraps unexpected domain errors as assertions, while OS errors, module-load errors, syntax errors and timeouts
retain their infrastructure classification. The runner self-tests six cases: green baseline, genuine assertion, syntax error, missing
module, OS EIO through the actual guarded helper, and timeout. Infrastructure failures cannot produce CAUGHT.

### R3: independent whole-record bound

`MAX_RECORD_BYTES = 256 * 1024`. The bound applies to UTF-8 bytes of the complete readable JSON serialization (two-space indentation
plus trailing newline), independently of the unchanged 200-entry manifest and 512-character relative-path limits. The maximal ASCII
fixture is 138,114 bytes. Multibyte paths can exceed 256 KiB while remaining individually valid.

Create serializes and checks size before any task marker or pending-record directory is created. Every subsequent revision checks size
before staging a temp file or publication. Reads remain bounded to the same limit and retain all strict schema/history validation.
Boundary tests accept 138,114, 262,143 and 262,144 bytes; reject 262,145 bytes with no create side effects; and reject a valid next revision
that grows beyond the limit, preserving the previous revision. The prior ineffective-size-guard equivalence claim is withdrawn.

### Equivalence reaudit

All 13 historical classifications were reassessed. Three claims were withdrawn: temp exclusivity, write-size guard, and directory
canonical-path check. The last is observably different under deterministic ancestor replacement between constructor preflight and
subsequent directory checks; initial canonicality is not a temporal guarantee. No unrelated root-safety redesign is included.
The other ten proofs describe redundant acceptance/refusal checks under fixed dependencies, not identical diagnostic messages or
probability assumptions. The final evidence records which mutations are actually caught and which survive with these proofs.

The separate `A0_ANCESTOR_SYMLINK_PREFLIGHT_REMEDIATION_REQUIRED` remains out of scope. A1-1, runtime agent execution, provider calls,
Docker, cloud, merge and deployment remain unauthorized. Final delivery stops at READY_FOR_REVIEW for independent Control Plane review.

### Validation and delivery gates

Final executable source commit: `e557c6f884f885e1f52abe0225873235013073cf` (implementation plus test/harness inputs).
The remediation adds 21 A1-0 tests: the complete A1-0 set is 117 tests. The targeted A1-0/A0/task-persistence/approval/fake-sandbox set
is 274 tests. Syntax checks and `git diff --check` are required separately; no npm command or registry request is used.

The first complete mutation run at `13cf2de472a6bc81beebda4197cd4096239b5107` completed all 148 entries with 133 CAUGHT, 10
EQUIVALENT_WITH_PROOF, 0 unexplained survivors and 5 HARNESS_ERROR, so it was HOLD, not PASS. One mutant replaced link publication
with rename and bypassed the child-process barrier; the barrier now intercepts both operations while calling the actual corresponding
filesystem operation. Four state mutants caused explicit task-domain refusals during otherwise valid operations. The states test now
asserts success only for those known domain refusal messages; OS errors retain their original classification. No production TaskStore
or state-transition code was changed. The entire catalog is rerun against the final committed executable inputs; the final JSON evidence
must bind that exact source and contain zero harness errors as well as zero unexplained survivors.

Full offline regression excludes the three `*.integration.test.mjs` files that would open real Docker boundaries, and includes all 39
remaining top-level test files. The inherited missing-express failures are `agent-console-phase1.test.mjs`, `github-repos.test.mjs`,
`local-state.test.mjs`, and `zero-copy-handoff.test.mjs`. Those failures are never reported as PASS. Dependency installation/registry
access is separately authorized and is not opened by Issue #29. If they remain, the full-regression gate remains FAIL and delivery
remains HOLD: retain local implementation and evidence, do not push PR #28 under the all-gates-pass delivery condition.

Final local validation at the source commit above:

| Check | Actual result |
| --- | --- |
| Complete A1-0 suite | 117/117 PASS (also included in targeted suite and mutation baseline) |
| Targeted A1-0 + A0 + task persistence + approval + fake sandbox | 274/274 PASS |
| Final mutation baseline | 177/177 PASS |
| Harness self-tests | 6/6 PASS |
| Full 148-entry mutation catalog | 138 CAUGHT; 10 EQUIVALENT_WITH_PROOF; 0 SURVIVED_UNEXPLAINED; 0 harness/pattern/invalid-mutant/worker errors |
| Exact source provenance | PASS; source unchanged during full catalog run; report sourceHead matches `e557c6f884f885e1f52abe0225873235013073cf` |
| Full offline regression | 717 total; 713 PASS; 4 FAIL (the four inherited missing-express module-load failures listed above); 0 cancelled/skipped |
| Syntax checks / diff whitespace | PASS |
| Delivery | HOLD; no push; remote PR #28 remains at `cf7fc7db9ebdef236a0d2f72a2399fca644ad755`, Draft / OPEN / unmerged |

R1–R3 targeted security gates and mutation gate passed. Full offline regression did not pass. The Control Plane must resolve or explicitly
accept the four inherited dependency failures before the conditional push proceeds. This is not independent-review approval or production
readiness. Original main was not written to (HEAD `a4a49e72c53f75d85e95e51326715654135225a3`, same eight pre-existing dirty paths);
Track B was not accessed or modified by this remediation. All local deliverable changes stay in Issue #29's allowlist.
