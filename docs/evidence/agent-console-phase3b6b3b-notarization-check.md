# Phase 3B6B.3B — notarization-specific candidate check

Result: **CLAUDE_2_1_292_NOTARIZATION_PASS**. Observed 2026-10-07
(Asia/Singapore). This resolves the outstanding notarization-specific check only;
it does not execute or fully provenance-qualify the candidate CLI interface.

## Baseline and candidate identity

| Check | Result |
| --- | --- |
| PR #24 starting HEAD | `ef55b380078e21e7595e469a62b290095e05e8d7` |
| PR #24 initial state | OPEN / Draft / unmerged |
| Candidate path class | `$HOME/.local/share/cc-qualification/claude/2.1.292/claude` |
| Canonical regular file | YES |
| Symlink / hard links | NO / nlink 1 |
| Mode | 0500 |
| SHA-256 before | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Signed-manifest SHA match | YES |
| SHA-256 after | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate unchanged | YES |

## Notarization check

Ran exactly the requested native verification with the previously qualified
candidate path:

`codesign -vvvv -R="notarized" --check-notarization <exact-candidate-path>`

- Exit code: **0**.
- Sanitized diagnostic: candidate valid on disk; satisfies its designated
  requirement; explicit requirement satisfied.
- The explicit `notarized` requirement was accepted: **NOTARIZATION_CHECK_PASS**.
- No bypass, quarantine removal, policy alteration, re-signing, or candidate
  execution was used.

## Legacy Claude and safety

| Check | Result |
| --- | --- |
| Legacy path | `/opt/homebrew/bin/claude` |
| Legacy version | `2.1.260 (Claude Code)` |
| Legacy SHA-256 | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Legacy unchanged | YES |
| Candidate `--version`, `--help`, or any execution | 0 |
| Provider calls / inference | 0 / 0 |
| Doctor / auth mutation | 0 / 0 |
| MCP / SSH authentication / Orchestrator | 0 / 0 / 0 |
| Merge/deploy | NO |

Only this evidence document changed. Candidate manifest/signature provenance and
strict macOS code signature were verified in the previous gate; this check verifies
the separate notarized requirement. Candidate `--version` and `--help` remain
unrun, required flag presence remains unchecked, and the harness frozen version
has not changed. This is not full candidate provenance completion or approval to
migrate the Host TCB baseline. Historical BLOCKED and UNKNOWN records remain intact.

`git diff --check` passed. No project code or tests were run; this is documentation
validation, not CI. PR #24 remains Draft.
