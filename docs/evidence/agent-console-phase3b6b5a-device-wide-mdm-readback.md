# Phase 3B6B.5A — device-wide MDM profile readback

Decision: **MDM_ENDPOINT_READBACK_BLOCKED**.
Observed 2026-10-07 (Asia/Singapore). The authorized privileged inventory did
not run because interactive sudo authentication was not safely completed. Device
coverage and Claude Code policy presence remain UNKNOWN.

## Baseline and integrity

| Check | Result |
| --- | --- |
| PR #24 starting HEAD | `75fd29f12da4ff5e6108a6e5d49fd79d7da83687` |
| PR at start | OPEN / Draft / unmerged; exact HEAD matched |
| Candidate version | 2.1.292; prior qualification remains the version authority |
| Candidate SHA after | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate filesystem identity | Canonical regular file, nonsymlink, nlink 1, mode 0500 |
| Candidate remains off PATH | YES |
| Legacy version after | `2.1.260 (Claude Code)`, exit 0 with updater disabled |
| Legacy SHA | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Candidate and legacy unchanged | YES |

No Claude candidate command was run. Candidate integrity was checked by the
qualification harness's read-only filesystem/hash verifier. Legacy Claude was
used only for the required `--version` recheck.

## Privileged inventory attempt

The local trusted `profiles(1)` man page was read first. It documents `show`
as the expanded configuration-profile inventory command and states that
`-all`, when run as root, displays all installed configuration profiles. The
documented command form selected was:

`/usr/bin/profiles show -type configuration -all -output stdout-xml`

Only that read-only profiles inventory was authorized for elevation. It was
invoked through `/usr/bin/sudo` with stdout piped directly to an in-memory
normalizer. The raw profile payload was not printed or persisted. Sudo reported
that a password was required; authentication was not completed in the command
session. The profiles executable did not run, so its exit code is **NOT RUN**.
No root shell or other elevated command was used.

| Field | Normalized result |
| --- | --- |
| Sudo invoked | YES |
| Root shell | NO |
| Profiles command class | `show -type configuration -all -output stdout-xml` |
| Profiles exit code | NOT RUN; sudo did not launch it |
| Coverage | UNKNOWN / INCOMPLETE |
| Claude Code managed-domain state | UNKNOWN |
| Applicable Claude Code payload | UNKNOWN |
| Raw payload persisted | NO |
| Endpoint decision | `MDM_ENDPOINT_READBACK_BLOCKED` |

The earlier non-root profile inventory did not prove device-wide coverage and
is not reused as absence evidence. The previously observed absence of the
managed settings file, drop-in directory, managed MCP file, and checked
managed-preference plist paths does not resolve system-wide MDM state.

## Safety and next step

Doctor **0**; `-p` **0**; auth commands **0**; provider calls **0**; inference
**0**. No profile payload, device identifier, or raw profile output was persisted in
repository evidence. The misrouted terminal input may be sensitive; local shell
history was not inspected or changed. No credentials were sent to sudo or
profiles. No profiles, preferences,
files, permissions, caches, or Claude installation were changed. PR #24 remains
Draft and unmerged.

The endpoint policy gate remains blocked. A later attempt requires the human to
enter any administrator password directly into the actual sudo prompt for this
read-only command. That credential must not be sent in chat or typed into a
normal shell prompt. If the misrouted input was the administrator password,
treat it as exposed and change it through macOS settings. After a complete profile inventory, only normalized
Claude Code domain/payload presence may be retained. Doctor remains unauthorized
until that result is PASS. The harness is unchanged; its lifecycle admission
default remains BLOCKED.

This is documentation-only evidence. `git diff --check` passed; no tests were
run and this is not CI.
