# Phase 3B6B.5C — final managed-policy diagnostic evidence capture

Decision: **MANAGED_POLICY_ADMISSION_UNKNOWN**.
Observed 2026-10-08 (Asia/Singapore). The authorized sequence ran exactly once
per command: candidate `auth status` → `doctor` → `auth status`. All exited 0.
Semantic auth, settings content, cache absence, session entry sets, and binary
integrity checks passed. The sanitized remote diagnostic line was withheld by
the capture guard, so the required policy proof remains UNKNOWN.

## Baseline and endpoint authority

Starting local and remote PR #24 HEAD:
`8b9d969e6f0b64c23d2edf2938aa72704a54b4d8`.
PR OPEN / Draft / unmerged; worktree initially clean.

Endpoint admission remains PASS under the
[superseding human readback evidence](agent-console-phase3b6b5a-device-wide-mdm-readback-pass.md):
device-wide coverage COMPLETE, Claude managed domain ABSENT, and previously
verified managed settings file/drop-in directory/managed MCP file/supporting
preference plists ABSENT. Historical evidence is preserved. No sudo, profiles,
or MDM inventory was rerun.

The revised contract evaluates semantic auth stability and settings hashes.
Earlier Keychain timestamp changes are not reused as evidence of credential
mutation or as a blocker. No Keychain content or database metadata was inspected
or snapshotted in this task. No token value was inspected or compared.

## Execution context and auth semantics

Each command used the exact canonical private 2.1.292 candidate, cwd
`/private/tmp`, real user HOME, DISABLE_AUTOUPDATER=1, and a positive environment
limited to HOME/USER/LOGNAME/system-only PATH/TERM/LANG/TMPDIR plus that updater
flag. Candidate remained off PATH. No configuration-directory override or
provider/proxy/credential override was inherited. No config/cache copy, reset,
login/logout, credential-source switch, installation or update was requested.

Auth JSON stdout/stderr stayed in memory. Only normalized allowlisted fields
were retained; account/email/token/path/raw JSON were discarded.

| Auth field | BEFORE | AFTER |
| --- | --- | --- |
| Exit | 0 | 0 |
| Logged in | true | true |
| authMethod | claude.ai | claude.ai |
| Provider class | firstParty | firstParty |
| Subscription class | pro | pro |
| Config directory class | DEFAULT_USER_CONFIG | DEFAULT_USER_CONFIG |

Semantic equivalence: **YES**, including subscription class. Config-directory
class derives from the controlled default HOME context with no directory
override; it is not claimed as a field emitted by auth status. This establishes
the approved route's semantic stability, not identity of opaque OAuth tokens.

## Security-relevant content and cache

Hashes were computed without printing or persisting file contents, using
O_NOFOLLOW and file identity checks around hashing. Settings/session snapshots
covered the full sequence; settings were also rechecked after the first auth
status and before doctor. No settings change occurred at that checkpoint.

| Generic file class | BEFORE | AFTER |
| --- | --- | --- |
| User settings | PRESENT; SHA256 `c36532b8c7e489940a211b9dd187d22ff4fac923171b6aee8be478d5763b4349` | Same |
| User local settings | ABSENT | ABSENT |
| Remote policy cache | ABSENT | ABSENT |

User settings corresponds to the known user settings.json class; user local
settings.json was checked complementarily. The documented remote-settings.json
cache was absent before and after: **CACHE_ABSENT**. Settings content changed:
**NO**. Cache changed: **NO**. No cache content was inspected or persisted.
Timestamp-only churn was not treated as a security mutation. Top-level opaque
account/config storage and Keychain files were not hashed.

## Doctor remote diagnostic capture

Doctor ran once with output captured in memory through an ephemeral PTY.
Exit **0**, no timeout, no output-limit truncation, no input sent. Exactly one
raw line matched the label `Managed settings (remote)` after terminal-format
normalization.

The sanitizer normalized whitespace and applied redaction rules for email,
user/home paths, UUID identifiers, long token-like strings, URL/query material
and credential-looking assignments. It then required a strict vocabulary and
character allowlist. That safety guard did not admit the matching line.

| Required capture | Result |
| --- | --- |
| Matching diagnostic count | 1 |
| Sanitized Managed settings (remote) line | WITHHELD; sanitizer safety check did not pass |
| Original raw matching-line SHA256 | NOT RETAINED; capture implementation gated both line and hash on sanitizer success |
| Normalized remote outcome | REMOTE_UNKNOWN |
| Active remote policy | UNKNOWN |
| Active cached policy | UNKNOWN; file cache absence corroborated separately |
| Full raw doctor output printed/persisted | NO |

This is an evidence-capture limitation, not proof that the vendor output was
intrinsically ambiguous or contained a secret. The raw bytes were discarded at
normalizer exit. They cannot be reprocessed, and no second doctor command was
run. The requested exact sanitized line/raw-line hash evidence is therefore
incomplete. No policy inactivity meaning is invented from subscription class,
exit 0, or cache absence alone.

Official [server-managed settings documentation](https://code.claude.com/docs/en/server-managed-settings)
defines doctor remote outcomes and documents the remote-settings.json cache.
Without a retained safely sanitized field, this attempt cannot establish the
specific documented outcome required for policy admission.

## Sessions, processes, inference and integrity

Session/transcript entry sets were compared recursively without reading
contents. Checked classes: projects, sessions, transcripts, session-env, tasks,
agents. New entries **0**; baseline/after traversal errors **0**.

Process snapshots sampled PID, parent/group and executable names, without
command-line arguments. After the sequence, no sampled attributable candidate/
Claude process, MCP/agent/background process, or other child remained. This is
bounded diagnostic observation, not a full lifecycle proof or proof of absence
of every short-lived trusted helper.

No assistant/model result stream was detected. Only the three authorized
non-inference argv sequences launched; provider inference calls **0**.
No interactive Claude, -p, auth login/logout, MCP/plugin/agent/session command,
remote control, SSH, lifecycle work or Orchestrator activation was requested.

| Integrity check | BEFORE and AFTER |
| --- | --- |
| Candidate SHA256 | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate identity | PASS: canonical nonsymlink regular file, nlink 1, current-user owner, mode 0500, private parent mode 0700 |
| Candidate off PATH | YES |
| Legacy SHA256 | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Binaries unchanged | YES |

Prior qualified versions remain 2.1.292 and legacy 2.1.260 respectively;
version commands were not repeated.

## Repository scope, validation and remaining gate

Only this documentation/evidence file changed. Harness/parser/tests,
production adapter, Run API and Orchestrator are unchanged. Managed-policy
harness admission remains BLOCKED; lifecycle remains BLOCKED with
LIFECYCLE_NOT_QUALIFIED. No inference admission was enabled.

Local staged and committed documentation diff checks passed. No tests were
run because executable code did not change; this is not CI. PR #24 remains
Draft and unmerged. No merge/deploy or further diagnostic launch occurred.

The revised semantic side-effect checks resolve this attempt's auth/settings/
session uncertainty. Policy evidence remains incomplete because the safe line
capture failed. Control Plane review must determine the next scope; no further
command is authorized by this single-attempt gate.
