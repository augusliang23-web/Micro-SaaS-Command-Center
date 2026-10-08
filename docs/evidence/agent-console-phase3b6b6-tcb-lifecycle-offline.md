# Phase 3B6B.6 — Host Claude TCB lifecycle offline qualification

Decision: **TCB_LIFECYCLE_OFFLINE_QUALIFICATION_PASS**.
Observed 2026-10-08 (Asia/Singapore). This qualifies the offline observer/state
machine and harness integration, not real Claude lifecycle behavior. Actual
provider calls **0**, inference **0**, candidate executions **0**.

## Baseline and authority

Starting local and PR #24 HEAD:
`f67053c41b96724157981705d6f4981bf8ed1e8e`; clean worktree, OPEN / Draft /
unmerged. [Owner Control Plane review 5449763219](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5449763219)
was verified directly through GitHub. It establishes managed-policy PASS at
this exact HEAD and authorizes only this offline lifecycle implementation.
The incomplete earlier doctor-line capture is preserved; doctor was not rerun.

`MANAGED_POLICY_APPROVAL` records that historical PASS/review ID in qualification
evidence. It does not bypass fresh runtime policy checks, reopen provider
execution, or substitute for a later exact-scope live authorization.

## Trust model and implementation boundary

Accepted parent: canonical private provenance-qualified Claude Code 2.1.292,
SHA256 `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f`.
The existing launch guard still validates exact path, bytes, metadata, environment,
and canonical argv. Apple platform services needed by the trusted CLI are part
of the accepted host TCB; arbitrary OS-named descendants are not thereby approved.

Initial vendor/OS helper approval inventory: **EMPTY**. No real helper was
observed, named, signed, or approved here. Synthetic tests supply explicit fake
helper identities only. Being descended from Claude or having a familiar name
does not grant trust.

The new qualification-only module is a pure state machine. It consumes process
and IPC evidence, never launches/kills processes, and is not imported by product
Orchestrator, Run API, or UI. The existing native monitor feeds it incomplete
ps/lsof evidence. Offline complete traces exercise the positive contract.

## Process identity and attribution contract

Inputs include PID, PPID, process group, session ID where available, immutable
generation identity, start time where available, exact executable path/hash,
signing identity for helpers, first/last observation, parent generation and
qualified birth ancestry. Missing generation, identity drift, duplicated/reordered
records, missing intervals and uncertain attribution remain sticky UNKNOWN.

Current and historical parent-child closure uses PID **plus generation**.
Previously attributable identities remain owned after PPID/group/session changes.
Complete birth ancestry can attribute a process already detached before its
first sample. Fresh disconnected processes need positive unrelated birth-origin
proof to a trusted host anchor; lack of a connection is not absence evidence.
Unchanged pre-existing identities are unrelated unless later evidence connects
them to the target invocation, in which case ambiguity is retained.

PID reuse creates a separate identity record. An exited helper and a later
unrelated process reusing its PID are not merged into a survivor; PID reuse
cannot supply the target's missing exit evidence. An exited generation that
reappears or changes executable/start identity becomes UNKNOWN. Parent exit
requires an explicit event matching the invocation generation; PID disappearance
or kill(pid, 0) alone cannot establish it.

Normalized classes:

`APPROVED_PARENT`, `APPROVED_VENDOR_HELPER`, `APPROVED_OS_HELPER`,
`FORBIDDEN_SHELL`, `FORBIDDEN_PROJECT_EXECUTABLE`,
`FORBIDDEN_AUTHORITY_PROCESS`, `UNKNOWN_DESCENDANT`,
`UNRELATED_HOST_PROCESS`, `SURVIVOR`, `REUSED_PID`.

Survivor and reused-PID counts supplement the original classification. Persisted
process evidence contains generation identity hashes, normalized classes,
observation times and exit/reparenting flags, not raw paths, signing strings,
process argv, or credentials.

## Helper approval and prohibited authority

A future separately reviewed helper approval requires exact stable executable
path/hash/signing identity, understood CLI-internal purpose, clear invocation
attribution, no independent task authority, and termination within this contract.
The collector must also positively attest each observed launch's
`executionAuthority=TCB_INTERNAL`. Approved executable bytes alone do not prove
that a general interpreter/helper launch is internal. Missing launch-role proof
is UNKNOWN; TASK_CONTROLLED authority is prohibited for parent and descendants.

Known shells, project-root executables/task-controlled interpreters, Git/gh/SSH,
MCP/browser/Chrome, package managers, and background/subagent/cross-session roles
fail classification. Explicit helper approval cannot override those prohibitions.
Unknown binaries/helpers remain UNKNOWN even if they exit. The exact five-tool
Read/Edit/Write/Glob/Grep ceiling remains unchanged.

## State machine, bounded cleanup and IPC

| Result | Contract |
| --- | --- |
| LIFECYCLE_PASS | Exact observed parent, matching explicit exit, complete identity/ancestry/visibility, approved descendants all exited, no unresolved identity/authority/IPC, stable quiescence within bound |
| LIFECYCLE_BLOCKED | Observed attributable survivor or unapproved IPC prevents qualification |
| LIFECYCLE_FAIL | Definite prohibited execution/security violation |
| LIFECYCLE_UNKNOWN | Visibility, attribution, helper classification, parent exit, cleanup or IPC proof incomplete |

Priority is definite FAIL, known BLOCKED, then UNKNOWN; incomplete evidence never
becomes PASS. Adapter exceptions cannot hide a definite process violation.
BLOCKED lifecycle results retain BLOCKED at the overall harness boundary.

Reviewable server-owned default policy constant:

- Sampling interval: **250 ms**.
- Maximum inter-observation gap: **500 ms**, including baseline-to-first-frame.
- Stable quiescence window: **2000 ms** after all attributable processes exit.
- Bounded cleanup observation window: **5000 ms** after matching parent exit.

These are offline implementation defaults for review, not an independently
approved production timeout. Only server-owned configuration can supply a
validated policy; the CLI exposes no timeout override. A new attributable process
resets stability. Exceeded window or lost visibility stays UNKNOWN; it is not
silently cleaned up or promoted. The monitor's async finish is awaited.

IPC states: `NO_OBSERVED_UNAPPROVED_IPC`, `UNAPPROVED_IPC`,
`IPC_OBSERVATION_INCOMPLETE`. Optional normalized signal kinds record
`UNIX_SOCKET`, `CROSS_SESSION_ENDPOINT`, `LOCAL_LISTENER`; no raw endpoints are
persisted. Conflicting/malformed no-IPC evidence cannot qualify. An observed
unapproved invocation-scoped endpoint blocks; unavailable coverage is UNKNOWN.
No kernel network monitor or kernel isolation is claimed.

Native ps has second-resolution creation times and no qualified birth-ancestry
capture; lsof provides sampled Unix-socket observations, not complete IPC
coverage. The native collector explicitly reports INCOMPLETE / SAMPLING_ONLY.
It cannot produce a real lifecycle PASS merely from an empty snapshot. The
positive synthetic COMPLETE contract is not a claim about native coverage.

## Harness integration and live boundary

The per-call and final evidence checks now require complete positive lifecycle
proof instead of zero observed children. Approved synthetic helpers may exit
cleanly and qualify; every unknown descendant or survivor still prevents PASS.
The spawn's matching parent-exit event is connected to the monitor. Recursive
output minimization retains only the new normalized lifecycle evidence.

An independent default `LIVE_EXECUTION_NOT_AUTHORIZED` gate blocks the CLI
**before any preflight probe or provider launch**. Lifecycle admission also
remains BLOCKED / LIFECYCLE_NOT_QUALIFIED by default. Only internal synthetic
test seams open those gates for fake launches. Offline PASS is not live approval.

Preserved: MAX_PROVIDER_CALLS=3, zero retry, pre-spawn provider accounting,
exact 2.1.292/hash/path, canonical argv and positive environment, five tools,
source guards, protected diff guard, session checks, auth/model evidence checks,
output sanitization. Lifecycle PASS cannot authorize a fourth call. Production
Orchestrator, adapter, Run API, UI and deployment configuration are unchanged.

## Validation and review

Local required offline command:

`node --test test/agent-console-phase3b6b-lifecycle.test.mjs test/agent-console-phase3b6b-negative-qualification.test.mjs test/agent-console-phase3a-claude-adapter.test.mjs test/agent-console-phase3b4-live-smoke.test.mjs`

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Focused lifecycle | 29 | 0 |
| Phase 3B6B qualification | 62 | 0 |
| Claude adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| Required total | **168** | **0** |

All four modified JS/test files passed `node --check`; staged and committed
diff checks passed. These are local validations, not CI. Synthetic fixtures
exercise the requested A–O cases plus initial visibility gaps, positive detached
origin proof, launch-role authority, malformed IPC, parent-exit conflicts,
exception precedence, serialized classes and the independent closed live gate.

A separate reviewer found and verified fixes for initial coverage gaps,
unproven disconnected origins, parent authority, and exception/BLOCKED result
propagation. No important findings remained in the reviewed offline scope.

Broader `node --test test/` result: **455 passed / 5 failed** (460 entries).
All five failures also reproduce in a temporary tracked-file export of the
frozen starting HEAD; they are not lifecycle regressions:

- agent-console-phase1.test.mjs: missing express package.
- github-repos.test.mjs: missing express package.
- local-state.test.mjs: missing express package.
- zero-copy-handoff.test.mjs: missing express package.
- agent-console-phase3a-boundaries.test.mjs, “unwired: only the adapter and
  explicit offline CLI harness reference Claude; no run route or UI exists”:
  older expected file list omits the already-existing qualification harness.

No dependencies were installed and unrelated tests were not rewritten. The
temporary baseline export was removed. No whole-suite PASS is claimed.

## Integrity, safety and remaining live evidence

Candidate SHA before/after matches
`97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f`;
canonical regular file, mode 0500, nlink 1. Legacy SHA after matches its frozen
baseline `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c`.
Neither binary was executed, replaced or modified. No doctor/auth/interactive
Claude/-p, auth mutation, secrets inspection, MDM readback, real MCP/SSH/provider
activation, lifecycle activation, merge or deploy occurred. Unit tests use
synthetic process graphs and local fake executables only for Claude behavior.

Still required separately: real exact-parent generation/ancestry/launch-role and
IPC collector qualification, any actual vendor/OS helper approvals, stable real
cleanup evidence, no persistent sessions/backgrounds/cross-session authority,
and fresh bounded live negatives under new Control Plane authorization. The
current native collector remains incomplete. Real Claude lifecycle is unproven;
real -p execution is **NOT AUTHORIZED**. PR #24 remains Draft and unmerged.
