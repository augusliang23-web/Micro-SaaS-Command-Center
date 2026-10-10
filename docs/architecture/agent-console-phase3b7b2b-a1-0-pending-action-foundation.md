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
paths, no commands, no prompts, no agent output, no credentials, no approver. Unknown or missing keys are refused.

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
or `ApprovalGate`. Server-side paths must be re-derived from the project registry by a later phase; none is stored.

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
  tasks/<taskId>.open                   exclusive marker: this task holds a pending action
```

* **Compare-and-set without a lock.** A revision is written to a temp file (exclusive, fsync) and *published* with `link(2)`, which
  fails with `EEXIST` if the revision already exists. Racing writers (threads or processes) resolve atomically: exactly one wins, the other
  gets `STALE_REVISION`. A replayed revision is the same `EEXIST`. History is never overwritten, so a crash can only leave a temp file.
* **Write outcomes are explicit.** `WRITE_FAILED` = definitely not applied (nothing published). `WRITE_AMBIGUOUS` = the revision may be on
  disk (failure after publication: temp-name removal, directory fsync or read-back). An ambiguous outcome is never reported as success and
  must be treated as UNKNOWN; a blind retry with the old revision is refused as stale.
* **Reads are strict.** `O_NOFOLLOW | O_NONBLOCK`, regular file, one link, current owner, no group/world bits, at most 128 KiB, contiguous
  revisions from 1, matching `pendingId`, and the **whole history** must validate: immutable facts unchanged, each revision exactly one legal
  step or one legal status change, time never backwards. Anything else is `RECORD_CORRUPT`; nothing is repaired or deleted.
* **Interrupted writes.** Leftover temp files are reported by `list()` and never read as revisions or deleted.
* **Root safety.** Normalized absolute path with no trailing slash, nearest existing ancestor canonical *before* any `mkdir` (nothing is
  created through a symlinked parent), directories 0700 and owned by the current user, never silently `chmod`-ed.

### Invariants

Enforced (also across processes, because they rest on exclusive creation):

* a `pendingId` is unique (`DUPLICATE_PENDING`);
* **at most one pending action per task** (`TASK_ALREADY_PENDING`). The marker is released only when the pending action ended `REVOKED` or
  `SUPERSEDED`; `OPEN`, `COMPLETED`, `INTERRUPTED`, a missing record or a corrupt marker keep the task held (fail closed);
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
| Crash before the temp file is published | Previous revision intact; leftover temp reported; next revision still possible |
| Crash after publication, before the caller learns | The revision exists; a retry of the old revision is `STALE_REVISION`; no double application |
| Directory fsync / temp removal / read-back failure | `WRITE_AMBIGUOUS` (never success); extra hard link detected as corruption |
| Link or write fails | `WRITE_FAILED`; a failed *create* removes the directory it made and its own marker |
| Crash between marker and record on create | The marker names a missing record; the task is held and fails closed until an operator removes it |
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
