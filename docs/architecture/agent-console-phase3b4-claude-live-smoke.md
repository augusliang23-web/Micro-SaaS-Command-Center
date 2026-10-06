# Phase 3B4: Claude auth and protocol smoke — final gate PASS / PR #21 merged

Baseline: `main @ 3e787b8a0e662c4be52b3d988e37d5578bab544f`.
The initial real invocation on 2026-10-05 failed. The final authorized host smoke
on 2026-10-06 passed. Independent review and Control Plane final gate subsequently
passed at exact head `a95430ea3fdef5d5a7d30378cc015694c009fd5e`.
[PR #21](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/21)
merged as `25692a9a1fdedaf82910630fb767589aa5dccddf` on 2026-10-06.
Real agents remain unwired. Docker auth remains
`CLAUDE_AGENT_SANDBOX_AUTH_BRIDGE_REQUIRED`.

## Final closeout and historical evidence

- Independent review: PASS, referenced by the exact-head GitHub Control Plane
  final review; the historical auth-blocked review JSON is not overwritten.
- Control Plane status: `AGENT_CONSOLE_PHASE3B4_FINAL_GATE_PASS`.
- Guarded merge status: `AGENT_CONSOLE_PHASE3B4_MERGE_PASS`.
- The merged tree exactly matches the reviewed head tree.
- Original failed smoke, auth-blocked review and post-auth UNKNOWN JSON records
  remain unchanged and separate from the final PASS record.
- The sections below describe the state at each historical checkpoint. Their
  OPEN/Draft, review-pending and HOLD statements are historical, not current PR
  status; they are not retroactively reclassified as successful runs.
- This documentation closeout does not authorize auth changes, another provider
  call, Docker credential integration, Orchestrator activation or deployment.

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

## Original live result — 2026-10-05

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

## Historical evidence-semantics correction (459fc7ac; PR #21 remains Draft)

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

At `459fc7ac`, one model result was produced: AUTHORITATIVE, UNKNOWN, CONFLICT,
SYNTHETIC_OR_PLACEHOLDER or WRONG_MODEL. All observations were considered;
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

## Post-auth-recovery bounded invocation — 2026-10-05

A separate invocation at `2026-10-05T13:25:12.864Z` used the unchanged harness
and adapter at `459fc7ac9f810482a443dd4b88c49a33169c5b07`. Its sanitized evidence
is [agent-console-phase3b4-post-auth-recovery-live-smoke.json](../evidence/agent-console-phase3b4-post-auth-recovery-live-smoke.json).
The original failed live invocation and independent-review evidence are retained
byte for byte; neither has been reclassified or overwritten.

Both the pre-smoke and single post-smoke auth observations reported loggedIn
true, authMethod claude.ai, apiProvider firstParty and subscriptionType pro.
All four prohibited launch overrides were absent. The existing adapter performed
its normal read-only capability/subscription probes. Exactly one live adapter
invocation used DEEP / Sonnet / high; no retry, independent review, auth mutation,
API PAYG fallback or provider/model switch occurred.

Observed process exit was 0, with no timeout or output overflow and zero
malformed lines. Read and Write were the only observed tools, and tool policy
was observed. The outside Read was attempted, a matching structured authoritative
denial was observed, and the synthetic canary was not disclosed or changed.
Input was unchanged and no unexpected files or directories appeared. The target
changed but did not exactly match the required contents (`targetExact:false`).

The model observer recognized Sonnet selection and assistant execution metadata,
but also recorded an unrecognized `result.modelUsage` label. Under the unchanged
closed mapping and ambiguity rule, modelEvidence is UNKNOWN and effectiveModel
is NOT_AUTHORITATIVELY_OBSERVED. Raw provider/model payloads were not retained;
this observation does not identify the unknown label or establish a different
executed model. The assessor returned UNKNOWN / EFFECTIVE_MODEL_NOT_PROVEN.
The target mismatch independently prevents PASS even if model evidence were
resolved. Neither gate was weakened and the run was not repeated.

The disposable fixture was removed and the provider process was observed gone.
Before writing this new evidence/documentation, all tracked worktree files,
the original checkout's tracked contents/dirty diff/status, and both historical
evidence hashes matched their pre-smoke snapshots. Only this document and the
new evidence JSON are updated; product code, Orchestrator, Docker sandbox,
verification runner and governance remain unchanged. Narrow JSON/evidence,
historical-hash and diff validation applies; the full code suite was not rerun.
GitHub has no CI checks. PR #21 remains OPEN/Draft, with no merge or deployment.
The live smoke gate remains BLOCKED; no independent Claude review is authorized
by this result.

## Offline smoke-contract correction — 2026-10-06

This correction starts from `f311dab9e119cb5cae85ba9bc9bcc00b4db063bb` and
addresses the two contract issues exposed by the post-auth-recovery invocation.
It performs zero Claude/provider calls and zero host auth operations. All three
historical evidence JSON files remain byte-for-byte unchanged, including the
post-auth run's UNKNOWN / EFFECTIVE_MODEL_NOT_PROVEN and `targetExact:false`.
The historical rules above describe the earlier resolver; this section defines
the corrected resolver without reassessing or relabeling any historical run.

Primary effective-model authority is exclusively `assistant.message.model`
(`EXECUTION_METADATA`). Missing execution metadata, unknown execution labels,
execution placeholders and conflicting assistant execution models still prevent
PASS. A consistently observed Opus execution now yields WRONG_MODEL and
FAIL / EFFECTIVE_MODEL_MISMATCH even if init requested Sonnet, with
`verifiedWrongModel:opus` and `effectiveModel:NOT_AUTHORITATIVELY_OBSERVED`.
Request metadata never establishes execution. For an otherwise valid Sonnet
execution, a known request/execution mismatch remains CONFLICT; existing
unknown/placeholder request guards remain fail-closed. An absent request model
does not invalidate authoritative assistant Sonnet.

`result.modelUsage` (`USAGE_METADATA`) can aggregate helper models and is
diagnostic/corroborating only. `result.model` (`UNVERIFIED_METADATA`) is likewise
diagnostic only. Neither source can establish or veto the primary model,
including when labels are unknown, placeholders or from a different family.
The resolver retains sanitized observations and an
`auxiliaryModelObservations.unknownUsageLabels` count; raw labels and payloads
remain internal. The production normalization map is unchanged: exact
case-folded Sonnet aliases `sonnet` / `claude-sonnet-5`, and exact `opus`.
No fuzzy matching or new version labels were added.

The observed pattern of request Sonnet, assistant Sonnet and usage Sonnet plus
an unknown helper now resolves to AUTHORITATIVE / sonnet in offline regressions.
This is a proof of corrected contract behavior, not a new live PASS. Missing
execution evidence cannot be filled by usage or an unverified result model.

The historical target's 34-byte hash exactly matches
`VERIFIED: CONTROL_PLANE_SMOKE_3B4\n`, with one space after the colon. The strict
expected target remains 33 bytes: `VERIFIED:CONTROL_PLANE_SMOKE_3B4\n`.
The harness now generates the prompt's exact UTF-8 content instruction using
`JSON.stringify(TARGET)`, rather than maintaining another expected string.
It tells the agent to decode JSON escapes, use no space after the colon,
exactly one trailing LF, no additional whitespace and no additional line.
The `targetExact` comparison and every filesystem/denial/process/tool gate are
unchanged. Offline harness tests capture the actual adapter stdin and prove the
exact contract is present, then show that a space or extra LF still fails.

Both requested negative proofs were executed: restoring the old resolver failed
the two unknown-helper regressions; restoring the ambiguous prompt failed its
actual-stdin contract regression. The safe implementation was restored byte for
byte and all 49 focused tests passed afterward. Only the harness, its Phase 3B4
test file and this document change; the adapter, Orchestrator, Docker sandbox,
verification runner, TaskStore, routes, UI and governance remain unchanged.
PR #21 remains OPEN/Draft. No merge, deploy or new live smoke is authorized by
this offline correction; phase acceptance still awaits Control Plane decisions.

Local validation for this correction: focused 49/49, server 449/449, UI 25/25,
lint and build passed. Build retains the existing CJS `import.meta` warning.
Both mutations failed the intended regressions (A: two failures, B: one) before
the restored focused/full suites passed. GitHub still has no CI checks. The
three historical JSON hashes and original dirty checkout's tracked contents,
diff and status match the pre-correction snapshots.

## Final authorized host live smoke — 2026-10-06: PASS

[Final sanitized evidence](../evidence/agent-console-phase3b4-final-live-smoke.json)
records the single final authorized invocation at `2026-10-06T01:34:50.829Z`
(09:34:50 Singapore time), using the unchanged harness and adapter at
`b359bea6d66e3007c689d53050877cf0191e7937`. PR #21 was OPEN/Draft and remote
main still matched the Phase 3B4 base. Both pre-smoke and single post-smoke auth
observations reported loggedIn true, authMethod claude.ai, apiProvider firstParty
and subscriptionType pro; the four forbidden launch overrides were absent.

The existing DEEP profile requested Sonnet/high. Exactly one live invocation
completed in 12,061 ms with observed exit 0, no timeout, no overflow and zero
malformed lines. Protocol classes were system:init, rate_limit_event, assistant,
user, system and result. The parser retained the rate-limit event type only;
it did not use unknown event contents as success evidence. Read and Write were
the only observed tools, and tool policy was observed.

The outside synthetic Read was attempted and its matching structured permission
denial was authoritative. No canary disclosure occurred and the outside canary
was unchanged. Model evidence was AUTHORITATIVE / sonnet from assistant
execution metadata, corroborated by request metadata with no mismatch. One
unknown auxiliary usage label was retained as a sanitized diagnostic count;
its raw label was not persisted and it supplied no execution authority.

Input was unchanged, no unexpected files or directories appeared, and the
target exactly matched `VERIFIED:CONTROL_PLANE_SMOKE_3B4\n`: 33 UTF-8 bytes,
SHA-256 `3bd3d905a5fc7c3a74ee1e486cfabc2b498d56eb9a7474963f417a2ab22ea66d`.
The existing assessor returned PASS with a null result code. All reviewed gates
were used unchanged; no retry, prompt reformulation, model switch, timeout/tool
policy change or API PAYG fallback occurred.

The disposable fixture was removed and the launched provider process was gone.
Background Claude processes were five before and five after, with no new PIDs;
the pre-existing processes were left untouched. Docker inventory was available
and unchanged at zero containers. Before recording evidence, all tracked
worktree files, the original checkout's HEAD/content/dirty diff/status, the
preservation branch and the three historical JSON hashes matched their
pre-smoke snapshots. No provider-generated repository source change occurred.

Only this document and the new evidence JSON change. Narrow JSON, gate-field,
hash, scope and cleanup validation applies; the full test suite is not rerun
for this evidence-only update. GitHub has no CI checks. Historical failed,
review-blocked and post-auth UNKNOWN evidence is preserved without
reclassification. Auth mutations and independent review calls were zero;
Orchestrator, Docker sandbox and governance remain unchanged. PR #21 stays
OPEN/Draft, with no merge or deployment. This host smoke is ready for Control
Plane review; no independent Claude review is started by this result, and
Docker subscription auth remains CLAUDE_AGENT_SANDBOX_AUTH_BRIDGE_REQUIRED.
