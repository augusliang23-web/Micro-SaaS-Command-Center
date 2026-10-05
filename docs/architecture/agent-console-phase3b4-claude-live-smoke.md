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

The independent Sonnet/high review was attempted after PR #21 creation using
a read-only preflight. It was blocked before inference (`AUTH_UNAVAILABLE`),
so no review fixture or additional provider request was launched. A subsequent
read-only auth check reported exit 1, `loggedIn:false`, `authMethod:none`.
This differs from the original smoke preflight. The cause is unestablished;
no login/logout/setup-token, CLI update or credential operation was performed.
See [sanitized review evidence](../evidence/agent-console-phase3b4-independent-review.json).

## Offline evidence-semantics correction (PR #21 remains Draft)

This correction makes no Claude/provider request and performs no host auth
operation. The original live and review JSON evidence remains byte-for-byte
unchanged: exit 1, NONZERO_EXIT, no tools, unchanged target, unproven outside
denial and unproven effective model. The live/auth gate remains BLOCKED.

The observer now records separate `outsideAttempted`, `outsideToolFailed`,
`outsideDeniedAuthoritatively` and `outsideDisclosure` facts. A matching
`user.message.content[].tool_result` with `is_error:true` records only a tool
failure. ENOENT, EIO, generic permission prose, assistant claims and custom
events cannot prove boundary denial. The accepted permission signal is
`result.permission_denials[]`, with `tool_name:Read` and `tool_input.file_path`
resolving exactly to the synthetic canary, following an observed outside Read.
All supplied tool/request identity fields must agree with the same observed
Read ID. If the attempt supplied an ID, a denial missing its ID is insufficient.
Path-only denial is accepted only when both the observed attempt and denial
omit IDs. An unmatched or unobserved attempt never becomes authoritative.
Without that structured proof, result is UNKNOWN / OUTSIDE_DENIAL_NOT_PROVEN.
The failed historical CLI call did not prove that the installed version emits
such a denial during a successful restricted smoke; no new live claim is made.

Model records retain source, bounded raw label, normalized family and trust
internally, rather than relying on the adapter's merged `actualModel` string.
Persisted observations omit raw labels and payloads; they contain only source,
normalized family, trust and label classification. The model-evidence locations
and their roles are:

| Location | Trust classification | Role |
| --- | --- | --- |
| `system:init.model` | REQUEST_METADATA | Selection metadata; cannot alone prove execution |
| `assistant.message.model` | EXECUTION_METADATA | Structured executed-response model; required for effective-model authority |
| `result.modelUsage` keys | USAGE_METADATA | Corroboration only; may aggregate helper models |
| `result.model` | UNVERIFIED_METADATA | Conservatively retained if supplied; schema not proven, cannot alone establish authority |

Closed normalization accepts only case-folded exact `sonnet` and
`claude-sonnet-5` as Sonnet, and exact `opus` as Opus. The versioned Sonnet label
was reported in the historical CLI metadata; this does not retroactively prove
that the failed invocation executed it. Offline Phase 3A fixture version
identifiers and arbitrary/future versions do not expand the production map.
Unknown labels remain UNKNOWN; no substring/fuzzy model matching is used.

One model result is produced: AUTHORITATIVE, UNKNOWN, CONFLICT,
SYNTHETIC_OR_PLACEHOLDER or WRONG_MODEL. All observations are considered;
synthetic/test/fixture/mock/placeholder contamination is not discarded to accept
another label. Literal unknown is UNKNOWN. Different known families produce
CONFLICT; an unknown label alongside a valid one remains UNKNOWN. Consistent
known labels require assistant execution metadata to become AUTHORITATIVE.
Selection or aggregate-usage metadata alone remains UNKNOWN.

PASS requires AUTHORITATIVE Sonnet, and the exact same resolved model value
supplies `effectiveModel`. No promotion from `run.actualModel` remains. Per the
user's clarification, an authoritatively wrong Opus produces
FAIL / EFFECTIVE_MODEL_MISMATCH, with `verifiedWrongModel:opus` and
`effectiveModel:NOT_AUTHORITATIVELY_OBSERVED`. All other unverified model states
also retain NOT_AUTHORITATIVELY_OBSERVED and prevent PASS.

The complete PASS gate also requires explicit observed clean exit 0, known
no-timeout/no-overflow/zero-malformed state, required event classes, approved
Read plus Edit/Write, observed outside Read and structured denial, no disclosure,
exact target, unchanged input/canary, and no added files or directories. Missing
process/filesystem observations cannot silently become a clean result.

Offline regressions cover ENOENT/EIO/prose, wrong/missing/conflicting IDs, wrong
path/tool, custom events, self-report, valid structured denial, missing/unknown/
synthetic/conflicting/wrong model, exact normalization and provenance. Both
requested mutations were executed: treating generic errors as permission denial
and removing the effective-model gate produced false PASS and failed regression
tests. The safe implementation was restored before full local validation.

The adapter did not need modification: its existing server-owned protocol
observer receives raw bounded lines before the merged-model summary, so the
standalone harness can preserve provenance without product changes.

Correction validation (local only, no GitHub CI): focused 42/42, server
442/442, UI 25/25, lint and build passed. The existing CJS `import.meta` build
warning remains. Only this document, `scripts/claudeLiveSmoke.mjs` and its
Phase 3B4 test file changed. Real inference/review calls and host auth
operations during the correction: zero. PR #21 stays OPEN/Draft; no merge or deploy.
