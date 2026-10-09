# Phase 3B6B.5 — managed-policy admission qualification

Decision: **MANAGED_POLICY_ADMISSION_BLOCKED**.
Observed 2026-10-07 (Asia/Singapore). Endpoint decision:
**MANAGED_POLICY_ENDPOINT_BLOCKED**. Actual provider calls/inference: **0 / 0**.

The endpoint check could not establish authoritative system-wide MDM absence.
The required stop before candidate `doctor` was honored. Remote/cache state
remains UNKNOWN, and no managed-policy admission was enabled in the harness.

## Baseline and integrity

| Check | Result |
| --- | --- |
| PR #24 starting HEAD | `d67b0234972c6f46bdd44dee9f55912d8264122e` |
| PR state at admission | OPEN / Draft / unmerged; exact HEAD matched |
| Candidate version | `2.1.292`, established in Phase 3B6B.3C; metadata probe not repeated |
| Approved and observed candidate SHA | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate identity recheck | PASS: canonical regular file, nonsymlink, nlink 1, mode 0500, private directory |
| Candidate placement | Side-by-side, off PATH; default executable unchanged |
| Legacy version after | `2.1.260 (Claude Code)`, exit 0, updater disabled |
| Approved and observed legacy SHA | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Both binaries unchanged | YES: observed hashes equal their approved baselines |

Only filesystem identity/hash inspection was performed on the candidate; no
candidate command was executed. No executable bytes, permissions, PATH,
quarantine, signing, or installation were modified.

## Endpoint-managed sources

| Source | Normalized observation |
| --- | --- |
| Effective macOS `com.anthropic.claudecode` managed domain | UNKNOWN |
| `/Library/Application Support/ClaudeCode/managed-settings.json` | ABSENT |
| `/Library/Application Support/ClaudeCode/managed-settings.d/` | ABSENT |
| `/Library/Application Support/ClaudeCode/managed-mcp.json` | ABSENT |
| System managed-preference plist for the Claude domain | ABSENT |
| Current-user system managed-preference plist for the Claude domain | ABSENT |
| HOME managed-preference plist for the Claude domain | ABSENT |
| Endpoint `policyHelper` possibility | UNKNOWN because effective MDM absence is unproven |
| Endpoint admission | MANAGED_POLICY_ENDPOINT_BLOCKED |

Source paths were checked using metadata only. Missing paths were distinguished
from unreadable/error states; symlink ancestors and inaccessible ancestors would
produce UNKNOWN or UNREADABLE rather than ABSENT. No managed policy contents,
credential contents, arbitrary executables, or managed MCP configuration were
read. The plist observations are supporting metadata, not proof of effective
managed-preference absence.

The trusted `/usr/bin/profiles` local help/manual was consulted. Its manual
states that device profile listing and all-system configuration-profile coverage
require root. This process was not root. The read-only command
`profiles list -all -type configuration -output stdout-xml` returned exit **0**,
but that exit alone does not establish root-wide coverage. No profile payload
was inspected to reinterpret a present policy as safe.

A single non-interactive system-wide query using
`/usr/bin/sudo -n /usr/bin/profiles list -all -type configuration -output stdout-xml`
returned exit **1** and did not establish system-wide coverage. No password was
requested, no credentials were inspected, and no permission/profile changes or
interactive elevation were attempted. Raw command output was captured in memory
and was not printed or persisted. Only normalized source states, exit codes,
and the coverage limitation were retained.

The missing authoritative device-wide readback is the blocker. Current-user
profile observations and absent plist files must not be promoted to effective
MDM absence. No inference was made from the user's subscription type.

## Doctor and remote policy

| Check | Result |
| --- | --- |
| Candidate `doctor` executed | NO: endpoint admission did not PASS |
| Doctor exit code | NOT APPLICABLE |
| Normalized remote outcome | REMOTE_UNKNOWN (unobserved; not a parsed doctor result) |
| Any active remote policy | UNKNOWN |
| Active cached remote policy | UNKNOWN |
| Raw doctor output persisted | NO; no doctor output was produced |
| Doctor parser qualified | NO |

Official [server-managed settings documentation](https://code.claude.com/docs/en/server-managed-settings)
describes the remote diagnostic outcomes and cache behavior, and limits
`policyHelper` to endpoint policy sources. It does not make absent filesystem
metadata a substitute for authoritative effective MDM readback. The required
endpoint stop prevents qualification of the remote/cache diagnostic in this
attempt.

## Side effects and safety

No doctor/config/auth snapshots were taken: the candidate diagnostic never
became authorized by endpoint admission. Policy-cache mutation and global
configuration/session/process state were **not assessed**. They must not be
reported as observed unchanged or absent. No diagnostic policy-cache side
effect was observed because no candidate diagnostic ran.

For actions performed by this task: candidate executions **0**, provider calls
**0**, inference **0**, auth commands/mutation **0**, sessions created **0**,
hooks **0**, MCP **0**, agents/background execution **0**, unexpected candidate
executables **0**, SSH **0**, Orchestrator **0**, current Claude installation
changes **0**, merge/deploy **no**. These action counts are not a host-wide
absence claim about unrelated existing processes or concurrent activity.

## Harness, validation, and next gate

Harness and tests are unchanged. Its managed-policy admission stays fail-closed,
and its default lifecycle admission remains BLOCKED with
`LIFECYCLE_NOT_QUALIFIED`. Production adapter and Orchestrator code are unchanged.
No tests were run because this gate changes documentation only.
`git diff --check` passed; this is local documentation validation, not CI.
Historical evidence was preserved. Continue existing Draft PR #24 only.

First resolve authoritative endpoint-managed MDM absence through a trusted
system-wide readback. Only after endpoint PASS may the exact candidate doctor
diagnostic and its metadata side effects be qualified. TCB lifecycle work and
fresh live provider qualification remain blocked and were not started.
