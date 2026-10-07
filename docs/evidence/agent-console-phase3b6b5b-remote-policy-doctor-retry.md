# Phase 3B6B.5B-Retry — evidence reconciliation and one doctor diagnostic

Decision: **MANAGED_POLICY_ADMISSION_UNKNOWN**.
Observed 2026-10-07 (Asia/Singapore). Exactly one candidate `doctor` command
ran; exit **0**. Provider inference calls **0**. The diagnostic did not
establish the required remote/cache inactivity proof, and metadata changes
leave auth/config side effects unresolved. Harness admission remains BLOCKED.

## Verified evidence precedence

Starting local and PR #24 HEAD:
`7127be355d0d16fee2eb206983be3942e3037887`; PR OPEN / Draft / unmerged;
worktree initially clean.

Both owner-authored Control Plane reviews were fetched directly through the
GitHub PR reviews API before any candidate command:

- [5439750877](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5439750877)
  accepts the later human-operated result: `PROFILES_EXIT=0`,
  `COVERAGE=COMPLETE`, `CLAUDE_DOMAIN=ABSENT`.
- [5439851201](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5439851201)
  confirms that the later readback supersedes the historical blocked attempt.

The [superseding endpoint record](agent-console-phase3b6b5a-device-wide-mdm-readback-pass.md)
was added before doctor. Historical 5A and first 5B evidence remain preserved.
No sudo/profiles command was rerun; no profile payload or password was read or
recorded. Effective endpoint prerequisite: **PASS**, using approved human
device-wide coverage/domain evidence and previously verified absent managed
settings, drop-in directory, managed MCP file and supporting plist paths.

## Exact execution boundary

Executed once: the canonical private side-by-side 2.1.292 candidate with sole
argument `doctor`. Working directory `/private/tmp`. Candidate stayed off PATH.
Before launch, filesystem/hash checks required canonical regular file,
nonsymlink, nlink 1, current-user ownership, mode 0500 and private parent 0700.
The descriptor was opened O_NOFOLLOW and file/directory identity checked again
after hashing. Candidate and legacy approved hashes matched before launch.

The positive environment contained only HOME, USER, LOGNAME, a system-only PATH,
DISABLE_AUTOUPDATER=1, TERM, LANG and TMPDIR. Real user HOME/config context was
preserved; no config/cache copy, reset, or fake HOME was used. Secret/provider/
proxy overrides were not inherited or inspected. No other Claude command was
executed, including legacy version, auth, inference, install or update commands.

An ephemeral PTY supported terminal diagnostics while all stdout/stderr stayed
in the parent process's memory. No interactive Claude session was requested.
No diagnostic exit prompt required acknowledgement. The diagnostic completed
without timeout or output-limit truncation. Full raw output was never printed
or persisted and was discarded when the normalizer exited.

## Remote/cache result

| Field | Normalized observation |
| --- | --- |
| Doctor executed / exit | YES / 0 |
| Managed settings (remote) field detected | YES; one distinct matching line |
| Normalized outcome | REMOTE_UNKNOWN |
| Active remote policy | UNKNOWN |
| Active cached remote policy | UNKNOWN |
| Explicit remote/cache inactivity established | NO |
| Documented remote-settings.json cache metadata | ABSENT before and after |
| Raw output persisted | NO |

The conservative in-memory normalizer did not recognize an explicit none,
loaded, skipped, failed-fetch, in-progress, or active/inactive-cache contract
from the matching line. This is a qualification/parser limitation: it does not
prove that the vendor's full output is intrinsically ambiguous or that policy
is present. Raw output was discarded and cannot be reinterpreted. No second
doctor command was run. Exit 0 and absent cache metadata are not promoted to
proof of policy inactivity.

Official [server-managed settings documentation](https://code.claude.com/docs/en/server-managed-settings)
describes the remote doctor field, cache applicability on failures, and the
remote-settings.json cache. It does not qualify this attempt's unrecognized
field as an inactivity proof. No inference was made from subscription type.

## Metadata side effects and process observation

Before/after snapshots used metadata only: file identity, type/mode/ownership,
size and modification/change times. Covered the Claude configuration tree,
top-level configuration/backup files, diagnostic cache tree, Keychain tree,
and candidate directory. Symlink roots, unreadable metadata and traversal
limits would block launch; none were encountered. No credential, settings,
cache, session or Keychain contents were read. Snapshot paths, usernames and
identifiers were retained only in memory; evidence records categories/counts.

| Category | Observed result |
| --- | --- |
| Config metadata | 1 changed entry |
| Keychain metadata | 2 changed entries |
| Other Claude metadata | 1 changed entry; purpose not established |
| Credential-file metadata | No change detected in checked credential file |
| Remote policy-cache metadata | No change; documented cache absent before/after |
| Session/agent/transcript metadata | No change detected in checked categories |
| Candidate directory metadata | No change detected |
| Metadata read errors after | None |
| Auth/account mutation | UNKNOWN; Keychain metadata changes do not identify account or credential changes |
| Side-effect classification | UNKNOWN; unexplained config/Keychain/other metadata changes prevent PASS |

Metadata changes were observed over the diagnostic interval, but attribution
to doctor versus concurrent host activity is not established. Unchanged
credential-file metadata does not establish unchanged Keychain-backed auth.
No documented policy-cache refresh was observed. No rollback, auth mutation,
or cache/config cleanup was attempted by the operator/normalizer.

Process snapshots sampled PID, parent/group and executable names without
command-line arguments. No sampled doctor-attributable Claude, MCP, or other
child survived the diagnostic's exit and follow-up snapshot. No assistant/model
result stream was detected. Only the authorized doctor argv was launched;
provider inference calls remain **0**. No MCP/hook/agent command was requested.
Sampling does not prove absence of every short-lived helper/hook, and no global
host-process or full TCB lifecycle PASS is claimed.

## Integrity after and unchanged admission

| Check | Result |
| --- | --- |
| Candidate SHA before/after | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate identity after | PASS; private canonical regular file, nlink 1, mode 0500 |
| Candidate off PATH | YES |
| Legacy SHA before/after | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Legacy version authority | Prior qualified 2.1.260 readback; matching binary bytes, version command not repeated |
| Binaries unchanged | YES |
| Harness/tests changed | NO |
| Managed-policy harness admission | BLOCKED |
| Lifecycle admission | BLOCKED / LIFECYCLE_NOT_QUALIFIED |

No stable doctor parsing/admission contract was established, so no harness
logic or synthetic tests were added. Production adapter, Run API and
Orchestrator are unchanged. Local documentation diff checks passed; no tests
were run and this is not CI. PR #24 remains Draft and unmerged.

Endpoint evidence reconciliation is complete. Remote/cache admission and
diagnostic side-effect qualification remain unresolved. Any further diagnostic
execution requires a new explicit scope; this task used its single authorized
doctor launch. TCB lifecycle and fresh bounded live inference were not started.
No SSH, merge or deployment occurred; credentials were not inspected. Auth
unchanged is not claimed.
