# Phase 3B6B.5B — remote/cached managed-policy diagnostic gate

Decision: **MANAGED_POLICY_ADMISSION_BLOCKED**.
Observed 2026-10-07 (Asia/Singapore). Candidate doctor executions **0**;
provider inference calls **0**. Remote and cached policy state remain UNKNOWN.

## Baseline conflict and admission stop

PR #24 starting HEAD was exactly
`e4d47c7b699c1e995d2cee8305b7ed03c4bd6884`; the remote PR matched and was
OPEN / Draft / unmerged. The Phase 3B6B.5B request declares device-wide MDM
coverage COMPLETE and `com.anthropic.claudecode` ABSENT. However, the owning
[5A evidence](agent-console-phase3b6b5a-device-wide-mdm-readback.md) at that
exact HEAD records **MDM_ENDPOINT_READBACK_BLOCKED**: privileged profiles
inventory did not run, coverage UNKNOWN / INCOMPLETE, Claude domain UNKNOWN.

No later successful device-wide readback was supplied during this attempt.
Clarification was requested about a separate completed readback and its
normalized evidence. This does not establish that no later readback exists;
it establishes that the asserted PASS cannot currently be reconciled with the
recorded baseline. Under the applicable instruction to stop affected work when
repository evidence conflicts with the Control Plane assumptions, doctor was
held before launch. No profiles/sudo retry was attempted.

## Read-only filesystem checks

| Check | Current observation |
| --- | --- |
| Device-wide MDM coverage | UNKNOWN / INCOMPLETE in owning 5A evidence; asserted COMPLETE remains unresolved |
| Effective Claude Code MDM domain | UNKNOWN; asserted ABSENT remains unresolved |
| System managed-settings.json | ABSENT |
| System managed-settings.d | ABSENT |
| System managed-mcp.json | ABSENT |
| System managed-preference plist | ABSENT |
| Current-user system managed-preference plist | ABSENT |
| HOME managed-preference plist | ABSENT |
| Candidate identity | PASS: canonical regular file, nonsymlink, nlink 1, owner matches, mode 0500; private parent mode 0700 |
| Candidate SHA | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate off PATH | YES |
| Legacy SHA | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Binary hashes match approved baselines | YES |
| Legacy version | 2.1.260, established by prior 5A version readback; current bytes match that baseline, version command not repeated |

Metadata-only absence checks distinguish missing paths from errors and symlink
ancestors. They do not establish effective device-wide MDM absence. Candidate
identity was checked without importing or running project code, with an
O_NOFOLLOW file descriptor and matching file metadata before/after hashing.
No candidate bytes, permissions, installation, quarantine, or PATH were changed.

## Doctor and side effects

| Field | Normalized result |
| --- | --- |
| Doctor executed | NO: endpoint prerequisite unresolved |
| Exit code | NOT RUN |
| Remote normalized outcome | REMOTE_UNKNOWN; unobserved, not parsed output |
| Remote policy active | UNKNOWN |
| Cached policy active | UNKNOWN |
| Raw output persisted | NO; no doctor output produced |
| Doctor parser qualified | NO |
| Auth mutation by this task | 0; global auth state not inspected |
| Config/policy-cache mutation | Not assessed; no diagnostic ran |
| Session/transcript state | Not assessed; no diagnostic ran |
| Persistent diagnostic-attributable process | Not applicable; doctor never launched |
| MCP/hook executions by this task | 0 / 0 |

No side-effect classification is promoted to NO_UNEXPECTED_MUTATION: the
diagnostic and its metadata snapshots did not occur. No claim is made about
unrelated concurrent host activity. Credentials, keychain values, terminal
contents, shell history, and raw profile payloads were not inspected.

## Harness, validation, and next steps

Harness/tests/production adapter/Orchestrator are unchanged. Managed-policy
admission remains BLOCKED. Lifecycle admission remains BLOCKED with
`LIFECYCLE_NOT_QUALIFIED`. No doctor output parser or admission exception was
added. Only this evidence document changed. Local `git diff --check` passed;
no tests were run because no executable code changed. This is not CI.

Resolve the endpoint baseline with a successful authoritative device-wide
readback and normalized Claude-domain result before the single authorized
candidate doctor diagnostic. Its remote/cache semantics and side effects still
require qualification. TCB lifecycle work and fresh bounded 3-call live
qualification remain blocked and were not started.

For this task: candidate execution **0**, provider inference **0**, auth
mutation **0**, project code execution **0**, MCP execution **0**, hook
execution **0**, SSH **0**, Orchestrator activation **0**, merge/deploy **no**.
PR #24 remains Draft and unmerged.
