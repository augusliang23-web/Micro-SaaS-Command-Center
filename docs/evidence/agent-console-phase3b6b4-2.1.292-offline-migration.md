# Phase 3B6B.4 — exact 2.1.292 offline harness migration

Decision: **CLAUDE_2_1_292_OFFLINE_HARNESS_MIGRATION_PASS**.
Observed 2026-10-07 (Asia/Singapore). Actual provider calls: **0**.
This migrates the qualification-only baseline. Managed-policy admission,
lifecycle admission, and fresh live provider qualification remain blocked.

## Baseline

| Check | Observed result |
| --- | --- |
| PR #24 starting HEAD | `4ceaf876b457c750fdacd1b881b11f9931e12051` |
| PR state at admission | OPEN / Draft / unmerged; exact HEAD matched |
| Legacy executable | `/opt/homebrew/bin/claude` |
| Legacy version after | `2.1.260 (Claude Code)`, exit 0 |
| Legacy SHA before/after | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Approved candidate version | Exact `2.1.292`, established by Phase 3B6B.3C |
| Candidate SHA before/after | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Candidate identity | Canonical regular file; no symlink; nlink 1; mode 0500 |
| Candidate path class | `$HOME/.local/share/cc-qualification/claude/2.1.292/claude` |
| Candidate placement | Private, side-by-side, off PATH; default CLI unchanged |

No candidate metadata probes were repeated. Its previously established version
is tied to unchanged bytes. The real candidate was inspected by the new
filesystem/hash verifier without execution. Legacy `--version` was checked with
updating disabled; no auth command was used.

## Qualification-only migration

The frozen expected version changes from `2.1.260` to exactly `2.1.292`.
Preflight rejects old, newer, floating, and suffixed versions; only the exact
qualified version output is accepted. The signed candidate SHA is fixed in the
harness and cannot be supplied or overridden through CLI arguments.

The CLI receives an explicit absolute binary path. It must equal the fixed
versioned candidate path beneath the trusted OS home directory, independently
of the child environment's HOME. There is no PATH lookup, legacy fallback,
caller-selected candidate root, floating version directory, or alternate binary.
No username-specific path is embedded in repository code.

Identity inspection requires the canonical path, current-user ownership, private
0700 candidate directory, regular nonsymlink executable, nlink 1, mode 0500, and
the exact signed SHA. The file is opened read-only with no-follow protection;
descriptor, pathname, and directory metadata are compared around hashing.
Replacement or permission drift during inspection blocks admission. The guard
rechecks identity before each probe and guarded provider launch, and preflight
checks again afterward. A mismatch before any provider launch returns BLOCKED.
These checks do not claim atomic pathname execution against arbitrary concurrent
host mutation; the private candidate remains part of the trusted host boundary.

Offline dependency seams supply synthetic metadata, hashing, and process events
only in tests. The CLI exposes no such override. A synthetic signed-hash match
tests admission branches; it is not provenance evidence. The separate actual-file
inspection returned PASS with the exact approved digest.

## Preserved security contract and remaining admission blocks

| Contract | Result |
| --- | --- |
| Canonical argv | Unchanged exact vector; no new flags or features |
| Tools | Exactly Read, Edit, Write, Glob, Grep |
| Denied/unavailable authority | Existing shell, REPL, web, MCP, browser/Chrome, agent/background, Git/SSH and remote-control restrictions preserved |
| CLI protections | restricted, safe-mode, strict/empty MCP, disabled slash commands, no persistence/Chrome, acceptEdits, permission prompts none preserved |
| Provider budget | Maximum 3 guarded attempts; fourth rejected |
| Accounting | 0 → 1 → 2 → 3; failed spawn counts; immutable count; exception paths preserve count |
| Retries | 0 |
| Output minimization | Recursive positive projection preserved; candidate path recorded as generic path class |
| Source and protected-diff guards | Unchanged and covered by existing regressions |
| Managed policy | Existing fail-closed implementation unchanged; no doctor or new admission mechanism |
| Lifecycle | Explicit default BLOCKED before inference; no approved live lifecycle implementation |
| Production adapter / Orchestrator | Unchanged; no product-flow activation |

The new lifecycle admission hold prevents the baseline migration from opening
live execution even if policy admission is addressed later. Only the synthetic
offline sequence supplies a simulated PASS. Existing process observations and
final checks remain unchanged; this gate neither implements TCB lifecycle proof
nor introduces a new zero-internal-process criterion. A separately approved
TCB lifecycle proof remains required.

## Model semantics

The requested model remains `sonnet`, with effort `medium`. Official
[model configuration](https://code.claude.com/docs/en/model-config) describes
Sonnet as a moving alias and identifies v2.1.284 as the Sonnet 5.5 version
boundary; the [2.1.284 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.284)
documents that model introduction. Alias continuity therefore does not establish
the same concrete model as the old qualification target.

No concrete model was observed in this offline gate. Request/init labels and
aggregate result usage remain insufficient to establish execution. Existing
closed model normalization was not broadened: an unqualified Sonnet 5.5
execution label remains UNKNOWN. Synthetic model events exercise evidence
handling only. Authoritative runtime metadata and any required reviewed label
mapping remain part of future live qualification; no concrete model ID is
asserted here.

## Offline validation

| Validation command | Passed | Failed |
| --- | ---: | ---: |
| `node --test test/agent-console-phase3b6b-negative-qualification.test.mjs` | 57 | 0 |
| `node --test test/agent-console-phase3a-claude-adapter.test.mjs` | 28 | 0 |
| `node --test test/agent-console-phase3b4-live-smoke.test.mjs` | 49 | 0 |
| Total focused offline regressions | 134 | 0 |

`node --check` passed for both modified JavaScript files. `git diff --check`
passed. These are local offline validations, not CI. Adapter and smoke tests
execute disposable fake executables; simulated guarded attempts are not
provider calls. No real candidate launch was performed by these tests.

New migration tests were observed failing before implementation. Coverage
includes exact/wrong versions, signed/wrong SHA, no legacy fallback, canonical
path constraints, symlink/ancestor alias/hardlink/special-file rejection,
replacement/permission drift, mismatch between metadata probes, unchanged argv
and tool inventory, budget/no-retry/error accounting, minimization, managed
admission and default lifecycle holds, and unknown concrete model evidence.

## Scope, safety, and next gates

Only the qualification harness, its focused tests, and this evidence note changed.
Historical UNKNOWN, GPG-blocker, provenance, notarization and interface records
were preserved. The normal Claude installation and candidate bytes were not
modified. PR #24 remains Draft; no merge or deploy is authorized.

Provider calls **0**; inference **0**; candidate executions **0**; doctor **0**;
auth commands/mutation **0**; credentials inspected **no**; current Claude
installation changes **0**; MCP **0**; SSH **0**; Orchestrator **0**;
merge/deploy **no**.

Next blockers are authoritative managed-policy admission, separately approved
TCB lifecycle proof, and separately authorized fresh bounded live negatives,
including concrete model and runtime protocol evidence. Offline migration PASS
does not clear any of those gates.
