# Phase 3B4: Claude auth and protocol smoke — BLOCKED

Baseline: `main @ 3e787b8a0e662c4be52b3d988e37d5578bab544f`.
The real invocation on 2026-10-05 failed. This phase is **not accepted** and real agents remain unwired.

## Existing integration reused

`server/execution/claudeCliAdapter.mjs` launches the registry's absolute binary
with `shell:false`, a canonical cwd, stdin prompt, and an environment allowlist.
Historical documented binary `/opt/homebrew/bin/claude` was independently resolved
on this host and verified executable; no registry or authentication was changed.
The four profiles remain FAST=Haiku/low, STANDARD=Sonnet/medium,
DEEP=Sonnet/high, CRITICAL=Opus/high.

File tools remain Read/Edit/Write/Glob/Grep. Restricted/safe mode, strict MCP,
disabled skills and denied permission prompts remain enforced. This change adds
explicit no-session-persistence, no-Chrome and an MCP deny pattern. Unsupported
required flags block execution. `buildClaudeEnvironment` retains HOME,
USER/LOGNAME, optional locale/timezone/temp location, fixed PATH and disabled
auto-updater; provider/API override variables are dropped.

The existing `claudeStreamParser.mjs` still handles init, assistant/tool-use,
user/tool-result and result events. Unknown event contents are dropped, not
interpreted as success. Malformed JSON, missing terminal result, timeout,
output overflow and tool-policy violations now produce UNKNOWN. A clean
nonzero exit remains FAILED. Each run has a default 120-second timeout;
server configuration may select 1–300000 ms. Cancellation still requires
observed exit, using SIGTERM then SIGKILL for the child process group.

An internal optional protocol observer can tighten policy on bounded stdout
lines and bounded final stderr. It cannot waive the parser's tool checks.
The smoke uses it to detect a synthetic outside-canary disclosure and correlate
an outside Read with its explicit error/permission denial. Raw stream, tool
arguments, credential data and provider prose are not persisted as smoke evidence.

## Actual live result

[Sanitized evidence](../evidence/agent-console-phase3b4-live-smoke.json) records
one real CLI inference attempt through the existing adapter, using DEEP.

- CLI 2.1.260; auth status exit 0, `loggedIn:true`, `claude.ai`, firstParty.
- All required flags supported; all four API/OAuth override variables absent.
- Sonnet/high requested. Init/assistant model labels were observed, including a
  synthetic label; an effective executing model was **not proven**.
- Process definitely exited with code 1; no timeout or output overflow.
- 3027 stdout bytes, zero stderr bytes; stream parsed, init/assistant/result seen.
- No tool calls or tool results; target remained UNCHANGED. No successful edit
  or outside-workspace denial was proven. No canary contents were observed.
- Input and outside-canary hashes unchanged, no extra files observed. The
  original real invocation's inventory covered files; subsequent harness code
  also inventories directories, verified offline without another live call.
- Fixture removed; launched process gone; both Command Center directories'
  source/status fingerprints unchanged by the provider.

The specific upstream failure text was not retained. **NONZERO_EXIT is the
observed blocker**; this evidence does not diagnose quota, revoked auth or an
unavailable model. No retry, API fallback, login modification or CLI upgrade
was attempted. Auth status proves configured subscription login, not a
successful authenticated development operation.

## Diagnostic and offline checks

`scripts/claudeLiveSmoke.mjs` is import-safe and requires an explicit operator
invocation `--live --binary <server-owned absolute path>`. Do not automatically
rerun it: each invocation can consume subscription usage. It creates only a
disposable synthetic fixture outside the repository and always deletes it.
Positive edit and single negative Read probe share one invocation. PASS requires
observed clean exit, parseable final result, approved Read plus Edit/Write,
explicit outside denial, host-verified file contents and unchanged inventory.

`test/agent-console-phase3b4-live-smoke.test.mjs` uses fake executables and
synthetic streams. It covers API/none auth rejection before inference,
malformed/missing result, nonzero exit, timeout, overflow, stdout/stderr canary
disclosure, missing tool/denial evidence, file mismatch and extra empty directory.
Phase 3A tests retain per-call Bash rejection even without init tool inventory.
Boundary checks admit only the standalone diagnostic and reject its import
from product modules; Orchestrator still blocks real adapters before probe/start.

## Auth and product boundary

`CLAUDE_AGENT_SANDBOX_AUTH_BRIDGE_REQUIRED`: no Docker subscription launch was
attempted or proven. No Claude credential files, tokens or Keychain data were
copied, exported, mounted or injected. Host restricted mode is not Docker proof.
Session identifiers are persisted only as SHA-256 hashes. Reported token counts
are runtime observations; subscription dollar cost remains unavailable/null.

Original dirty main, preservation branch, CLAUDE.md, AGENTS.md and .bridge are
preserved. No product Run endpoint, UI, TaskStore state, provider dispatch,
verification command/image, merge or deployment was changed.

PR delivery makes the narrow diagnostic and safety fixes reviewable; it does
not turn the failed real smoke into READY_FOR_REVIEW. A successful bounded
live invocation and the independent Claude review remain required for phase
acceptance.
