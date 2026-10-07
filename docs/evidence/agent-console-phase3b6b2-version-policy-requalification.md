# Phase 3B6B.2 — static version and policy admission review

Observed 2026-10-07 (Asia/Singapore). This is a proposal, not migration approval.

| Required decision | Result |
| --- | --- |
| VERSION | VERSION_DECISION_BLOCKED |
| PROCESS CONTRACT | REPLACE_WITH_TCB_LIFECYCLE_PROOF |
| MANAGED POLICY | DOCTOR_PREFLIGHT_UNKNOWN |
| OVERALL | NOT_READY |

## Baseline and release identity

PR #24 began at `54694d92b7fb896a0420f1fb7d5bbfd6acd1e200`, OPEN/Draft.
Architecture PR #23 was verified at `ca965997623791c072a98c72ee664b243fde7897`.
The harness still freezes 2.1.260; this task changes documentation only.

| Release | Tag commit | Published UTC / Singapore | Status |
| --- | --- | --- | --- |
| Candidate v2.1.291 | `8e60c4cac989c0e0cc6d2c49407a5c67f5a4a8e6` | 2026-10-06 03:55:19 / 11:55:19 | Immutable; not draft or prerelease |
| GitHub latest v2.1.292 | `fbe20e00e2851fc01506f54f98a8f0b875af3847` | 2026-10-06 18:59:30 / 2026-10-07 02:59:30 | Immutable; not draft or prerelease |

Immutable release protection covers the published tag/assets; title and notes may
still be edited. The direct official release API superseded a stale search result listing 2.1.291
as latest. Separately, the official installer channel metadata returned **stable
2.1.285** and **latest 2.1.292**. A non-prerelease GitHub release is not the delayed
stable updater channel. Therefore the prompt's “current stable 2.1.291” premise
is not verified. Control Plane must choose an exact version and channel; this
review does not substitute 2.1.292, recommend installing 2.1.285, or expand its
security delta review beyond 2.1.291.

Sources: [candidate release](https://github.com/anthropics/claude-code/releases/tag/v2.1.291),
[candidate tag API](https://api.github.com/repos/anthropics/claude-code/git/refs/tags/v2.1.291),
[latest release API](https://api.github.com/repos/anthropics/claude-code/releases/latest),
[stable metadata](https://downloads.claude.ai/claude-code-releases/stable),
[latest metadata](https://downloads.claude.ai/claude-code-releases/latest),
[official installer source](https://claude.ai/install.sh), and
[channel documentation](https://code.claude.com/docs/en/setup#configure-release-channel).
These mutable pointers are dated observations, not permanent pins.

Supported candidate asset: [claude-darwin-arm64.tar.gz](https://github.com/anthropics/claude-code/releases/download/v2.1.291/claude-darwin-arm64.tar.gz),
with official SHASUMS256.txt and signature assets. The official native manifest
[2.1.291 manifest](https://downloads.claude.ai/claude-code-releases/2.1.291/manifest.json)
lists `darwin-arm64`, binary `claude`, size 233211568, checksum
`9a1d2ed6bb4421e8fc80c892c0413f293be3ee50ae3d7dda1a7622197a056690`.
That checksum describes the manifest's native binary, not the GitHub tarball or
an installed Homebrew launcher. No binary/package was downloaded or installed;
release tag commit is not a binary SHA or public source-code audit.

## Security delta: 2.1.261 through 2.1.291

Classifications below concern this contract; “new risk” means new/revised surface
or a qualification concern, not a demonstrated exploit. All published releases
in the range were inspected from official release bodies and the tagged
[changelog](https://github.com/anthropics/claude-code/blob/v2.1.291/CHANGELOG.md).
The API and tagged changelog have no entries for 262, 264, or 279; do not invent
notes for these gaps. Generic reliability notes offer no specific security proof.
Each row links its own official release; unrelated UI, Slack, cloud UX and billing
entries are IRRELEVANT to the frozen direct host path.

| Version | Relevant delta and classification |
| --- | --- |
| [261](https://github.com/anthropics/claude-code/releases/tag/v2.1.261) | Policy load diagnostics: BEHAVIOR_CHANGE. New subagent prompt flag and gateway credential pinning: REQUALIFICATION_REQUIRED; remain outside approved argv/route. |
| [263](https://github.com/anthropics/claude-code/releases/tag/v2.1.263) | Unspecified reliability fixes: IRRELEVANT as security evidence. |
| [265](https://github.com/anthropics/claude-code/releases/tag/v2.1.265) | Plugin path containment fix: SECURITY_IMPROVEMENT. Plugin directories and gateway/auth behavior: BEHAVIOR_CHANGE, REQUALIFICATION_REQUIRED. |
| [266](https://github.com/anthropics/claude-code/releases/tag/v2.1.266) | Repairs gateway-env regression: SECURITY_IMPROVEMENT/BEHAVIOR_CHANGE; positive env stripping stays required. |
| [267](https://github.com/anthropics/claude-code/releases/tag/v2.1.267) | Unreadable managed hook/channel allowlists deny rather than admit: SECURITY_IMPROVEMENT. Effort cap and auth retry changes: REQUALIFICATION_REQUIRED. |
| [268](https://github.com/anthropics/claude-code/releases/tag/v2.1.268) | Canonical symlink deny/ask rules and Read/Edit checks repaired; MCP secret masking repaired: SECURITY_IMPROVEMENT. Auth configDirectory field and print-mode permission hooks: BEHAVIOR_CHANGE/REQUALIFICATION_REQUIRED. |
| [269](https://github.com/anthropics/claude-code/releases/tag/v2.1.269) | Permission negation scope fix: SECURITY_IMPROVEMENT. Managed plugins load in headless sessions; background reporting/resume changes: REQUALIFICATION_REQUIRED. |
| [270](https://github.com/anthropics/claude-code/releases/tag/v2.1.270) | Bash read-only Git prompt regression repaired: IRRELEVANT while Bash remains prohibited. |
| [271](https://github.com/anthropics/claude-code/releases/tag/v2.1.271) | Cached policy account-switch reuse, late tool-list refresh, unreadable managed MCP repaired: SECURITY_IMPROVEMENT. Cross-session delivery/result semantics: REQUALIFICATION_REQUIRED. |
| [272](https://github.com/anthropics/claude-code/releases/tag/v2.1.272) | Unspecified reliability fixes: IRRELEVANT as security evidence. |
| [273](https://github.com/anthropics/claude-code/releases/tag/v2.1.273) | Endpoint MCP/connector locks survive remote policy; opaque shell read checks tightened: SECURITY_IMPROVEMENT. Remote background forks: NEW_RISK outside approved launch. |
| [274](https://github.com/anthropics/claude-code/releases/tag/v2.1.274) | Managed resolution telemetry and MCP startup bounds: BEHAVIOR_CHANGE. Background completion inference batching/resume: REQUALIFICATION_REQUIRED; no background authority permitted. |
| [275](https://github.com/anthropics/claude-code/releases/tag/v2.1.275) | Read error handling and malformed attachment/resume fixes: BEHAVIOR_CHANGE; stream/result/session REQUALIFICATION_REQUIRED. Gateway feature changes are IRRELEVANT to first-party route. |
| [276](https://github.com/anthropics/claude-code/releases/tag/v2.1.276) | Proxy beta-header regression repair: IRRELEVANT to no-custom-gateway route. |
| [277](https://github.com/anthropics/claude-code/releases/tag/v2.1.277) | AGENTS.md fallback loading: NEW_RISK/BEHAVIOR_CHANGE. Headless error exit fixed and non-SDK background title inference removed: SECURITY_IMPROVEMENT; REQUALIFICATION_REQUIRED. |
| [278](https://github.com/anthropics/claude-code/releases/tag/v2.1.278) | Auto-mode classifier/provider default change: BEHAVIOR_CHANGE; IRRELEVANT if acceptEdits and first-party route are proven. |
| [280](https://github.com/anthropics/claude-code/releases/tag/v2.1.280) | Outside symlink write is no longer approved via in-tree spelling: SECURITY_IMPROVEMENT. Write argument normalization/hook/session handling: REQUALIFICATION_REQUIRED. |
| [281](https://github.com/anthropics/claude-code/releases/tag/v2.1.281) | MCP browser elicitation: NEW_RISK outside empty MCP/no-browser contract. Retry-loop/startup changes: REQUALIFICATION_REQUIRED. |
| [282](https://github.com/anthropics/claude-code/releases/tag/v2.1.282) | macOS special-path instruction reads and malformed managed locks repaired: SECURITY_IMPROVEMENT. Chrome/MCP override and compaction fallback: NEW_RISK/REQUALIFICATION_REQUIRED. |
| [283](https://github.com/anthropics/claude-code/releases/tag/v2.1.283) | Exact model restrictions and deniedModels: SECURITY_IMPROVEMENT. Deferred results/usage and lazy headless startup: REQUALIFICATION_REQUIRED. Slash doctor prompt-audit is distinct from CLI doctor. |
| [284](https://github.com/anthropics/claude-code/releases/tag/v2.1.284) | Sonnet alias/default advances to Sonnet 5.5: BEHAVIOR_CHANGE/REQUALIFICATION_REQUIRED. Instruction-link approval and managed plugin preapproval restrictions: SECURITY_IMPROVEMENT. |
| [285](https://github.com/anthropics/claude-code/releases/tag/v2.1.285) | Access-denied managed-file reads now warn and continue: NEW_RISK for admission. Provider allowlists: SECURITY_IMPROVEMENT. Headless default mode/subagent behavior: REQUALIFICATION_REQUIRED; explicit mode required. |
| [286](https://github.com/anthropics/claude-code/releases/tag/v2.1.286) | Console key no longer misreported as claude.ai: SECURITY_IMPROVEMENT. Previous-tier model retry and hook value handling: REQUALIFICATION_REQUIRED; count process starts separately from internal requests. |
| [287](https://github.com/anthropics/claude-code/releases/tag/v2.1.287) | Mods and built-in side agent introduce NEW_RISK. Model fallback repetition fix and shell symlink writes: SECURITY_IMPROVEMENT; disabled customization/inventory REQUALIFICATION_REQUIRED. |
| [288](https://github.com/anthropics/claude-code/releases/tag/v2.1.288) | Headless SIGTERM/SIGCONT handling and unmatchable permission hooks fail closed: SECURITY_IMPROVEMENT. MCP OAuth scope and instruction-loading changes: REQUALIFICATION_REQUIRED. |
| [289](https://github.com/anthropics/claude-code/releases/tag/v2.1.289) | IDE symlink Read-deny and managed mod/MCP protection fixes: SECURITY_IMPROVEMENT. Auth-status sign-out regression reverted: REQUALIFICATION_REQUIRED for metadata probe. |
| [290](https://github.com/anthropics/claude-code/releases/tag/v2.1.290) | Restricted messaging socket, instruction symlink, restricted @-mention swap, and image link-swap fixes: SECURITY_IMPROVEMENT. Post-hook input checks, guard bypass, permission relay duplicate IDs, background respawn bypass disclaimer repaired: SECURITY_IMPROVEMENT. Headless result/error, fallback effort, managed-file link warning and mod hook/result fields: BEHAVIOR_CHANGE/REQUALIFICATION_REQUIRED. Added retry after content-filter interruption: NEW_RISK to any claim of three HTTP requests. |
| [291](https://github.com/anthropics/claude-code/releases/tag/v2.1.291) | Cloud permission-answer and quitting-message-loss regressions repaired: SECURITY_IMPROVEMENT/BEHAVIOR_CHANGE; session/result REQUALIFICATION_REQUIRED. Cloud path itself remains disabled. |

### Version decision and blocker disposition

Do not continue to treat 2.1.260 as the preferred fresh qualification candidate.
The 290 fixes directly address the architecture's known version-risk concerns.
However, release notes do not identify every bug's introduced version and are
not proof that 260 was exploited or that 291 satisfies the contract.

If 291 is explicitly chosen despite channel/latest drift, its published fixes
remove the *known vendor defect described in those notes* from the proposed
baseline. They do not remove the need to test socket non-creation, instruction
and image race safety, complete tool/model evidence or denied outside reads.
Managed-policy admission, descendant cleanup, protocol compatibility, alias model
identity, auth stability, session persistence and accepted host-TCB residual risk
remain. Vendor internal retries mean the existing maximum-three-launch counter
cannot claim maximum-three network requests. Control Plane must preserve that
distinction or require a separate supported internal-request limit.

## Process contract proposal

**REPLACE_WITH_TCB_LIFECYCLE_PROOF**, requiring explicit architecture approval.
The approved vendor binary is trusted host TCB. Counting every internal helper as
unauthorized conflates vendor implementation with model-granted authority.
The change is not “polling saw nothing, therefore safe.” Future proof must:

1. Freeze executable identity, version, installed hash and vendor provenance;
   approve any vendor helper identities/roles specifically. No general process or
   path wildcard. Unknown executables/roles remain UNKNOWN/BLOCKED.
2. Prove the launch exposes exactly Read/Edit/Write/Glob/Grep, no process tools,
   agents/teams/workflows/background/Monitor/SendMessage, MCP, browser, Git/SSH,
   remote control or cloud authority. Retain canonical args/env, safe mode,
   restricted mode and no-session-persistence. Reject unexpected runtime tools.
3. Bound permitted vendor helpers to this launch's lifecycle using reliable root
   and descendant identity/attribution and termination ownership. Track PID reuse,
   reparenting and group escape. A process merely named Claude is not approved.
   Show cancel/timeout/normal exit teardown; survivors or missing attribution block.
4. Verify restricted-session cross-session messaging endpoints do not open and
   that no detached session/background daemon/subagent is created. An approved
   internal IPC endpoint requires explicit role/provenance approval; cross-session
   communication is forbidden. Sampling absence alone is insufficient evidence.
5. Prove no model-controlled shell/process execution despite malicious config and
   prompts; retain outside read/write negatives, exact denials and protected diff.
   Approved subscription HTTPS transport is not model-controlled network authority.
6. Recheck binary/auth/policy identity, session-store absence and owned fixture
   cleanup. Keep unrelated preexisting processes untouched. Missing proof is UNKNOWN.

This is a design requirement, not an implemented observer or claim that 291 solves
cleanup. Current injected-spawn cancellation does not establish group teardown.
A future lifecycle design must resolve that limitation without broadly killing
unrelated Claude processes. The blanket “zero attributable internal children”
criterion becomes obsolete only after approval and adequate replacement proof.

## Managed-policy sources and precedence

Official sources: [managed settings](https://code.claude.com/docs/en/managed-settings),
[server delivery/cache](https://code.claude.com/docs/en/server-managed-settings),
[settings precedence](https://code.claude.com/docs/en/settings#settings-precedence),
[policyHelper](https://code.claude.com/docs/en/settings-reference#policyhelper),
[managed MCP](https://code.claude.com/docs/en/mcp#managed-mcp-configuration).

Remote policy ranks above macOS `com.anthropic.claudecode` managed preferences,
then system files/drop-ins. Default selection is first policy-bearing source;
merge mode and cross-source locks/env are exceptions. Managed tier outranks CLI,
local, project and user settings. File policy merges base then alphabetical JSON
drop-ins. `managed-mcp.json` applies separately, even with remote policy. Remote
eligibility is Teams/Enterprise; Pro is not independent cache-absence evidence.
Cached policy can survive failed fetches. Hooks and env can carry authority; safe
mode does not remove managed hooks/settings. An endpoint policyHelper executes
from its selected source and may replace policy; it is not honored from remote.
All present or unknown managed sources block this initial unmanaged qualification.

## Doctor static assessment

**DOCTOR_PREFLIGHT_UNKNOWN** under this task's full safety contract.

| Question | Official evidence / finding |
| --- | --- |
| Non-inference, diagnostic, normal session? | Setup and debug-config docs expressly describe CLI `claude doctor` as read-only diagnostics without starting a session. This supports non-inference classification; it is not `/doctor`, `/doctor prompt-audit`, or `/debug`. |
| Remote and cache reporting? | Remote documentation says the Managed settings (remote) line reports loaded, no organization policy, failed fetch with cached applicability, or skipped with reason; in-progress is possible. Capability documented since 2.1.248. |
| Safe before -p? | Appropriate diagnostic candidate, but no unconditional admission proof: cache absence and side-effect coverage still require exact-version evidence. |
| Hooks / policyHelper? | General helper startup execution is documented; an explicit CLI-doctor exemption covering initialization, hooks, all helper types and remote-policy loading was not established. No session implies no normal session lifecycle, not proven no initialization helper execution. |
| Auth mutation? | Read-only diagnostic wording supports intent. Exact token-refresh, Keychain/config/cache-write behavior is not enumerated; no unconditional zero-auth-write proof. |
| Anthropic contact? | A remote fetch outcome is reported and normal policy fetches use Anthropic. Doctor-specific fresh-vs-existing fetch/network sequence is not fully documented. Do not call it offline or guaranteed no-network. |
| Machine-readable exact state? | Documentation gives semantic outcomes, not a stable version-pinned JSON schema or complete literal strings. Do not invent a parser accepting substrings. |

References: [setup diagnostics](https://code.claude.com/docs/en/setup#verify-your-installation),
[CLI versus slash doctor](https://code.claude.com/docs/en/debug-your-config#check-resolved-settings),
[remote outcomes](https://code.claude.com/docs/en/server-managed-settings#verify-settings-delivery).
No doctor command was executed. Evidence does not justify UNSAFE as a proven
behavior, nor QUALIFIABLE as an already satisfied side-effect/cache contract.

### Proposed remote-state admission after doctor qualification

There are **no accepted doctor states now**. Future normalized states must be
backed by exact-version fixtures and documented semantics, not these invented
labels as CLI output:

- FRESH_NONE_AND_CACHE_INACTIVE: fresh successful no-policy outcome **and** explicit
  inactive/absent cache proof, expected first-party route/config; potentially PASS.
- SKIPPED_INELIGIBLE_PRO_AND_CACHE_INACTIVE: explicit Pro-ineligible reason **and**
  independent cache-inactive proof; potentially PASS. Pro alone or bare skipped
  is BLOCKED; third-party/custom endpoint/gateway skip is BLOCKED.
- LOADED, cached applies, unexpected remote source: BLOCKED.
- Fetch failure (even no cache), in-progress, timeout, missing/duplicate/conflicting
  fields, malformed output, stale/cross-account result: BLOCKED.

A snapshot from a separate doctor process must not be treated as atomic proof for
the following -p launch. Bind policy/config/auth identity and freshness, recheck
before launch, and block if policy can change unobserved. No cache deletion,
credential isolation trick, logout, or policy execution is authorized here.

## Endpoint-managed checks proposed for a future gate

Use trusted read-only OS policy APIs for effective machine and current-user forced
preferences in `com.anthropic.claudecode`, with complete scope/readability results.
Neither `defaults domains`, a profile-name grep, nor absence of guessed plist
paths proves domain absence. Supporting metadata may cover system/current-user
Managed Preferences plists, but is not the authoritative effective-domain check.
No actual host policy or secret inspection occurred in this static task.

Use no-follow metadata with canonical parent checks for
`/Library/Application Support/ClaudeCode/managed-settings.json`,
`managed-settings.d/`, and `managed-mcp.json`. Any present file/directory/link,
malformed type, unreadable ancestor, permission denial or uncertain scope blocks.
Even an empty managed directory is conservatively PRESENT here. Missing metadata
is sufficient only for that exact file source when trusted parent/path coverage
and race handling are established; it does not clear MDM or remote cache.

Do not inspect helper executables or run policyHelper. Blocking all endpoint source
presence prevents needing to interpret its hooks/env/helper content. Any remote
cache presence likewise blocks unless authoritative inactive-cache proof exists.
No standalone helper path scan can prove absence of a helper configured in policy.

## Proposed prestart admission

Approved target/version/channel → trusted endpoint metadata/effective MDM check
→ exact binary identity/hash → guarded version and auth metadata
→ qualified remote/cache diagnostic → endpoint/auth/hash/config recheck
→ canonical env/argv and source guards → lifecycle observer ready
→ separately authorized bounded live launch.

Endpoint checks precede even CLI probes where possible to prevent startup helpers;
version/auth probes themselves need exact-version non-inference qualification.
Every BLOCKED/UNKNOWN step stops; no fallback launcher, relaxed flags, policy
execution or provider inference follows. Poststart protocol is necessary but too
late to authorize prestart managed hooks.

## Existing test impact

Categories overlap: UNCHANGED means requirement retained, not waived rerun.

| Category | PR #24 coverage / future action |
| --- | --- |
| UNCHANGED | Path/collision/source guards; protected modify/delete/rename/add/mode/mixed diffs; budget/getter/failed spawn/no retry; positive env; recursive output; exact request/path/tool denials; UNKNOWN/FAIL retention. |
| RERUN_REQUIRED | All 45 focused tests and 28 existing adapter tests after approved migration; stream/model/inventory/canonical argv and full fake sequence, cleanup/session/source guards. Offline results still do not prove vendor runtime. |
| UPDATE_REQUIRED | Frozen version/help/hash fixtures; alias execution model expectation; managed diagnostic vocabulary/parser; final proof conjunction; fake monitor lifecycle evidence. Preserve exact five-tool ceiling and three-launch ceiling. |
| OBSOLETE_AFTER_2_1_291 | No test is automatically obsolete on installation. After approved lifecycle replacement only, retire “every attributable internal helper forbidden” as the final PASS criterion; retain PID/socket/reparenting ambiguity tests with revised unauthorized-role semantics. |
| NEW_TEST_REQUIRED | Doctor loaded/none/skipped/cache/fetch/error/in-progress combinations and side-effect boundaries; effective MDM coverage and unreadable policy; vendor helper provenance/teardown; restricted messaging socket; CLAUDE.md/rules/AGENTS.md and image/@-mention link-swap negatives; model alias/fallback/internal-request distinction; exact version/hash drift and SIGTERM/SIGCONT. |

No code/tests or historical live JSON changed or executed in this documentation gate.

## Architecture delta and next decision

PR #23 freezes 2.1.260 and explicitly requires requalification on any version
change. Proposed migration changes executable/version/hash and vendor semantics;
proposed lifecycle proof changes evidence admission. Neither is already approved.
The model remains a requested alias until authoritative executed-model metadata
proves it; Control Plane must decide whether the model family or exact model is
frozen. Managed admission remains closed until doctor and endpoint proof qualify.

Required order remains:
**version migration approval → install/update → exact binary/hash freeze → offline
adapter/harness requalification → policy admission → fresh bounded live negatives**.
Before approval, resolve candidate/channel drift and doctor safety evidence gaps.
No merge, install, migration implementation or inference is authorized by this note.

## Validation and safety

Documentation-only diff reviewed; `git diff --check` passed before commit.
No test runner or project code execution in this gate. All release API, installer
text, manifest and documentation reads were static; installer text was never run.
Claude commands (including doctor/version/help/auth/-p): 0. Provider calls: 0.
Auth mutation: 0; credentials/Keychain secrets inspected: no; MCP/SSH authentication,
sbx, Orchestrator, Production/UAT/cloud execution, merge/deploy: 0/no.
Original dirty checkout untouched. Existing PR #24 remains Draft.
