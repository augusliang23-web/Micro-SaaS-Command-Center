# Phase 3B6B.3C — Claude 2.1.292 candidate interface qualification

Decision: **CLAUDE_2_1_292_CANDIDATE_INTERFACE_PASS**. Observed 2026-10-07
(Asia/Singapore). This qualifies only the candidate's version/help interface and
does not approve a version migration, runtime behavior, or a live provider call.

## Baseline and candidate identity

| Check | Result |
| --- | --- |
| PR #24 starting HEAD | `905d43c045ba43b1a4de8c79ae9dca15f11851fd` |
| PR #24 initial state | OPEN / Draft / unmerged |
| Candidate path class | `$HOME/.local/share/cc-qualification/claude/2.1.292/claude` |
| Candidate filesystem identity before/after | Regular file; not symlink; nlink 1; mode 0500 |
| Candidate SHA-256 before | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate SHA-256 after | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate unchanged | YES |
| Candidate sibling contents | Only `claude`; unchanged |

The candidate is the previously provenance-verified and notarization-checked
2.1.292 darwin-arm64 artifact. The earlier evidence records are
[`agent-console-phase3b6b3-claude-2.1.292-candidate-provenance-resume.md`](agent-console-phase3b6b3-claude-2.1.292-candidate-provenance-resume.md)
and [`agent-console-phase3b6b3b-notarization-check.md`](agent-console-phase3b6b3b-notarization-check.md).

## Permitted metadata interface checks

The candidate was invoked by its exact absolute path, with a fresh temporary
HOME, a minimal fixed PATH that excluded its directory, and updater disabled.
The working directory was `/private/tmp`. No shell wrapper was used.

| Command | Exit | Sanitized result |
| --- | ---: | --- |
| `<candidate> --version` | 0 | `2.1.292 (Claude Code)` |
| `<candidate> --help` | 0 | Complete requested interface flag set present |

All required flags were found: `-p`, `--print`, `--output-format`, `--verbose`,
`--session-id`, `--model`, `--effort`, `--restricted`, `--safe-mode`, `--tools`,
`--disallowedTools`, `--strict-mcp-config`, `--mcp-config`,
`--disable-slash-commands`, `--no-session-persistence`, `--no-chrome`,
`--permission-mode`, and `--permission-prompts`. Missing flags: **none**.

The temporary HOME was empty after the checks and removed. Candidate SHA-256,
file identity, mode, and sibling contents were unchanged. The candidate was not
added to PATH. The only candidate executions were these two metadata commands;
there was no `-p`, `doctor`, auth, interactive, install, or update command.

## Legacy binary and safety boundary

| Check | Result |
| --- | --- |
| Legacy path | `/opt/homebrew/bin/claude` |
| Legacy version after | `2.1.260 (Claude Code)` |
| Legacy SHA-256 after | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Legacy unchanged | YES |
| Provider calls / inference | 0 / 0 |
| Auth mutation | 0 observed; no auth command or existing auth HOME was used |
| Session created | NO |
| MCP / SSH / Orchestrator | 0 / 0 / 0 |
| Merge/deploy | NO |

This pass establishes that the exact candidate reports version 2.1.292 and
advertises the CLI flags required by the planned adapter. It does not qualify
flag semantics, session/process lifecycle, policy admission, provider routing,
or any inference behavior. The existing frozen harness target and technical
security contract are unchanged; any migration requires its own approval and
subsequent requalification gates.
