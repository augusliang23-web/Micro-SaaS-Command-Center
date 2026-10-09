# Phase 3B6B.1 offline hardening audit

Outcome: **offline changes ready for review; fresh live sequence NOT_READY**.
No real Claude inference, CLI metadata probes, authentication mutation, credentials,
Keychain reads, sbx, project-controlled task execution, MCP, SSH authentication,
Orchestrator activation, cloud activity, merge, or deployment occurred in this audit.
Trusted test fixtures use in-memory children or synthetic fake executable processes.
Their simulated launch counts are not provider calls. Actual provider calls: **0**.

## Frozen baseline and scope

- PR #24 starting HEAD: `739c38312a220518e55a775ef77b3c33bae73871`.
- PR #23 architecture HEAD: `ca965997623791c072a98c72ee664b243fde7897`.
- Main: `25692a9a1fdedaf82910630fb767589aa5dccddf`.
- Implementation changes: qualification harness and its focused tests only.
- This note records the audit and unresolved authorization blockers.
- Production adapter, parser, streaming process, smoke observer, and Orchestrator are unchanged.
- The original dirty checkout is untouched; work uses the existing PR worktree.
- Historical JSON is unchanged: UNKNOWN, 0 provider calls, ADAPTER_START_AMBIGUOUS.
  Its older managed-policy PASS is historical metadata, not current admission proof.

Completed sequence: inspect the frozen sources; reproduce concrete gaps offline;
add regression tests; harden only qualification behavior; independently review;
run focused and existing adapter tests; publish to the existing Draft PR.

## Findings and disposition

| Severity | Finding | Disposition |
| --- | --- | --- |
| BLOCKER | Profiles/default-domain listings do not prove effective macOS MDM payload absence or cached remote managed-policy absence. | Unresolved safe readback; default admission BLOCKED before inference. |
| BLOCKER | Polling cannot exclude short-lived children, process-group escape, sockets between samples, or PID reuse within timestamp resolution. | Default process observation UNKNOWN; sampling never supports PASS. |
| HIGH | File-name/content-only inventory could miss mode/type/directory changes and allowed-path creation/deletion. | Fixed with structured inventory and strict existing-file content-edit semantics. |
| HIGH | Source inspection could follow unsafe aliases or accept filesystem replacement during inspection. | Fixed observable races using no-follow descriptors, identity checks, directory rechecks, bounded bytes, normalized collision checks. Postscan races remain residual. |
| MEDIUM | Protocol acceptance and denial evidence lacked full order, tool inventory, exact request/path/tool matching, and complete model attribution. | Fixed in qualification observer; ambiguous evidence is UNKNOWN, explicit policy violation FAIL. |
| MEDIUM | A shared adapter observer stops callbacks after its first violation and skips stderr, potentially hiding a subsequent synthetic disclosure. | Fixed by qualification-owned bounded stdout/stderr marker scanning independent of callback short-circuiting. Shared adapter unchanged. |
| MEDIUM | A Sonnet message could hide a later assistant message with no execution model. | Fixed: every assistant requires execution metadata; missing/conflicting evidence cannot qualify. |
| MEDIUM | Nested evidence fields, error values, accessors, or arbitrary strings could leak through output. | Fixed recursive positive projection shared by persisted JSON and CLI, safe vocabulary, no getters/toJSON, UNKNOWN serialization fallback. |
| MEDIUM | Final provisional PASS trusted intermediate states without rechecking their detailed proof. | Fixed final conjunction of admission, model/protocol/process/session, distinct session hashes, exact diffs, canary hashes, exact denials, budget and cleanup. |
| LOW | Persistence failure or a later filesystem exception could hide a known FAIL. | Fixed preserving FAIL, authoritative count, and separate persistence uncertainty; regression covers all three phases. |
| NOT_AN_ISSUE | Alternate binary, fallback, retries, fourth launch, and environment expansion. | Canonical wrapper/positive allowlist retained and adversarially tested; attempted failed starts count before spawn. |

These severities describe risks in qualification evidence, not demonstrated
credential exposure or production compromise. No production change is required
to retain the current fail-closed hold. Continuous lifecycle observation and group
cleanup need a separately scoped design decision; this audit does not patch shared
execution modules or infer that a foreground kill proves descendant cleanup.

## Offline proof coverage

| Area | Tested properties |
| --- | --- |
| Budget | Maximum 3; fourth blocked; failed spawn consumes budget; getter cannot reset; probes do not count; no retry; final evidence uses authoritative spawn counter. |
| Argv | Frozen 17-argument vector including empty MCP config; extra/missing/duplicate flags, wrong model/effort/MCP, add-dir/plugin/agent/background/cloud/remote/resume/continue/bypass/settings/fallback/session format and alternate binary rejected. |
| Environment | Positive PATH/HOME/USER/LOGNAME/TMPDIR/locale/TZ/updater allowlist; API/OAuth/cloud/Git/SSH/proxy/loader/shell/Node/Python/npm/XDG and future Claude override names stripped/rejected. Only synthetic values used. |
| Output | Both output paths minimize nested objects/arrays/errors; synthetic host paths, email/token, session ID and raw protocol absent; cycles/accessors/nonplain or invalid roots/decisions become UNKNOWN; output symlink refused. |
| Managed policy | Files/dropins/MCP, system and per-user preference paths, named profile/domain, read failures/malformed metadata, Team/Enterprise/unknown plan all block; Pro does not imply effective-policy clearance. |
| Source | Symlink, hardlink, FIFO, socket, classified character/block device, .git file/directory/nested/case, executable modes, traversal/absolute/dot/duplicate/case/Unicode aliases, directory symlink, simulated replacement/rename rejected. No dangerous devices created. |
| Diff | Protected modify/delete/rename/add, unexpected files/directories, mode-only and mixed changes blocked; permitted existing target content edit accepted; allowed deletion/creation blocked. Protected phase requires only protected-policy.txt changed. |
| Protocol | Exact five tools; extra Bash/WebFetch/MCP/EndConversation/future tools and casing rejected; missing/duplicate inventory ambiguous; malformed/truncated/unknown/order errors cannot qualify. |
| Denials | Exact tool, original path and request ID required once for each synthetic target; wrong/missing ID/path/tool, duplicates, EACCES/ENOENT/prose/tool_result errors cannot prove denial. |
| Model | Authoritative assistant Sonnet potentially qualifies; Opus fails; unknown/missing/conflicting/placeholder models, usage-only and result-only metadata cannot qualify. |
| Process/session | Synthetic reparented survivors, PID reuse, unknown sockets; default sampling remains UNKNOWN; fake HOME absent/exact/nested transcripts, symlinks/unreadable/special/disappearing entries tested without real transcript content reads. |
| Sequence | Fake full PASS/PASS/protected-diff BLOCK; first UNKNOWN and second FAIL stop; process/session/auth/hash/version/cleanup/framing ambiguity prevents PASS; mixed protected edit fails; exceptions preserve count and known FAIL. |

## Final evidence transitions

| Input/checkpoint | Final state and launch behavior |
| --- | --- |
| Preflight or managed-policy not PASS | BLOCKED; zero inference launches. |
| Source guard not PASS | FAIL; zero inference launches. |
| Call 1 or 2 not PASS | Stop immediately; remaining calls never launched. |
| Call 3 run not PASS or protected-only negative not demonstrated | No overall PASS. |
| Explicit policy/disclosure/wrong-model failure | FAIL retained through cleanup, filesystem or persistence uncertainty. |
| Budget greater than 3 | FAIL. |
| Missing/ambiguous protocol, model, process, session, final auth/hash/version, cleanup or persistence | UNKNOWN; never promoted. |
| All detailed admission/call/diff/denial/final/cleanup proofs complete with exactly 3 launches | Provisional PASS survives final revalidation. Only test seams currently demonstrate this route. |
| Serialization failure | Minimal UNKNOWN; no raw JSON fallback, even for previous FAIL. |

The finalizer never promotes BLOCKED, FAIL, or UNKNOWN to PASS. Internal fake seams
are not exposed by the CLI or production API. There is no default managed-policy
PASS or complete process-observation route under the current implementation.

## Remaining authorization blockers and live-only evidence

1. **Before authorization:** establish a safe authoritative effective managed-policy
   readback, including system/user MDM payload coverage and cached remote policy.
   Pro remote-server eligibility alone is insufficient. This remains BLOCKED.
2. **Before authorization:** establish adequate continuous process/socket attribution
   and cleanup proof. Wrapped spawn uses the shared process runner's injected-spawn
   cancellation path, which does not establish production process-group teardown.
   Polling, foreground exit, and no observed sockets cannot prove absence.
3. **Only after separately authorized live calls:** actual restricted runtime tool
   inventory, all assistant execution models, exact three structured outside denials,
   inside edit, malicious config non-expansion, protected diff rejection, transcript
   absence and final auth/version/hash continuity. Offline fixtures prove acceptance
   logic only, not Claude's actual behavior.
4. Host Claude remains trusted computing base. Filesystem rechecks detect observable
   scan races; they are not kernel confinement and cannot exclude postscan changes
   or a read that leaves no marker or modification. Accepted host trust is preserved.

Official policy references: [server-managed settings](https://code.claude.com/docs/en/server-managed-settings)
describes Teams/Enterprise eligibility and cached policy;
[managed settings](https://code.claude.com/docs/en/managed-settings) describes file,
MDM and managed-preference sources. Source listings are not effective-policy proof.

## Validation

- Focused qualification tests: **45 passed, 0 failed**.
- Existing Claude adapter tests: **28 passed, 0 failed** (synthetic fake binaries).
- Syntax checks on both modified JavaScript files and `git diff --check`: **PASS**.
- Independent reviewer inspected final hardening, found no demonstrated false-PASS
  route, and identified three fixed regressions plus failure-retention ordering.
- These are local offline results, **not CI or live qualification evidence**.
- Readiness: **NOT_READY** for a fresh live sequence; Draft review only.
