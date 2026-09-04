# Dual-Platform Execution Adapter Design

**Date:** 2026-09-04

**Status:** Architecture proposal; no adapter or feature implementation is authorized by this document

**Baseline:** `origin/main` and this design checkout both point to `c1340f22d7f861b9e72920ef8443b9ef20008718`

## 1. Purpose

Define a provider-neutral execution boundary in which the existing native Codex
Bridge handoff and a future Claude Code path can coexist without duplicating
governance, overstating provider capability, or allowing provider selection to
broaden task authority.

The design preserves the current product boundary:

- local development only;
- explicit user dispatch only;
- server-allowlisted repositories only;
- read-only repository inspection only until a separately reviewed task authorizes more;
- native account authentication, with no API-key fallback;
- no automatic approval, merge, deployment, release, billing, secrets, destructive action, or production expansion; and
- successful execution stops at `READY_FOR_REVIEW`, never approval.

This is an architecture document. It does not authorize changes to `server.ts`, provider behavior, routes, UI, `.bridge/` mappings, authentication, persistence, networking, deployment, or either provider installation.

The canonical provider keys in this design are `CODEX_BRIDGE` and
`CLAUDE_CODE`. They identify execution boundaries, not brands, models, desktop
applications, or permission tiers. Claude Desktop is not a third provider and
is never an implicit substitute for the Claude Code CLI.

## 2. Observed baseline

### 2.1 Codex

The current implementation is a provider-specific vertical slice:

```text
CodexHandoffPanel
  -> /api/bridge/codex-handoffs
  -> CodexHandoffService
  -> fresh CodexAppServerClient per execution
  -> codex app-server over stdio
```

It has evidence for the following behavior:

- native protocol sequence `initialize -> initialized -> account/read -> thread/start -> turn/start`;
- mandatory `account.type === "chatgpt"`;
- API-key-related environment names removed from the child process;
- `shell: false`, read-only sandboxing, and native approval preservation;
- server-side project allowlisting and loopback-only development routes;
- streamed lifecycle/output events;
- a fresh provider client per non-idempotent execution;
- explicit provider status `completed` as the only success condition; and
- bounded cleanup through stdin close, `SIGTERM`, then `SIGKILL` if needed.

The current service stores status and idempotency only in process memory. The observed smoke did not report an actual model. Native approval requests are surfaced as `AWAITING_INPUT`, but the Command Center cannot resolve them.

### 2.2 Claude

The repository currently contains a documentation-only, fail-closed Claude audit boundary in `CLAUDE.md` and `docs/claude-audit/`. It records that the Claude CLI was unavailable on `PATH` when prepared on 2026-09-04. This design did not recheck or install it.

There is no current evidence in this repository for a Claude execution transport, native authentication mode, event protocol, read-only sandbox, approval pause, status query, session identity, model reporting, or process cleanup contract. Repository instructions are policy evidence, not runtime capability evidence.

### 2.3 Shared governance

`AGENTS.md`, `CLAUDE.md`, and `.bridge/` establish shared constraints:

- an exact GitHub Issue, allowed file list, model label, `- Reasoning Effort:` line, risk label, and human-applied `bridge:ready` are mandatory before future feature execution;
- fixtures, browser-memory values, user-entered values, and AI-generated values are non-authoritative;
- provider execution cannot add `bridge:ready` or `bridge:approved`;
- `server.ts`, provider behavior, auth, persistence, GitHub integration, billing, deployment, and runtime networking remain `BLOCKED_DECISION` unless an exact approved task opens them; and
- `/api/bridge/chatgpt-advice` and `/api/bridge/extract-features` remain protected and outside this design.

## 3. Options considered

### Option A — Shared execution core with provider adapters (recommended)

Move task validation, idempotency, normalized state, evidence, and review/approval boundaries into one provider-neutral coordinator. Codex and future Claude integrations implement a narrow `ExecutionAdapter` contract and emit facts into that coordinator.

Advantages:

- one governance and state-transition implementation;
- capability differences remain explicit;
- provider-specific protocol code stays isolated;
- the existing Codex behavior can migrate incrementally; and
- Claude remains unavailable until separately proven, without blocking Codex.

Cost: requires careful compatibility work so the current Codex route, UI, and status fields do not change semantics during extraction.

### Option B — Duplicate the Codex service for Claude

Create a `ClaudeHandoffService` beside `CodexHandoffService` and keep provider-specific routes and UI.

This is initially quick but rejected because validation, lifecycle semantics, evidence requirements, and approval rules would diverge. Fixes such as fresh-client isolation and strict terminal-status handling would need to be rediscovered and maintained twice.

### Option C — Introduce a general workflow engine

Represent execution, review, approval, retries, and release as a durable workflow graph.

This may be appropriate after persistent multi-provider orchestration is justified, but it is rejected for the current local read-only scope. It would add storage, recovery, scheduling, and operational concerns that the MVP explicitly excludes.

## 4. Architecture

```text
Browser or trusted local caller
  -> provider-neutral execution API
  -> ExecutionPolicyGate
  -> ProjectRegistry (server-side cwd and policy)
  -> ExecutionCoordinator (idempotency and canonical state)
  -> AdapterRegistry (explicit provider selection; no silent fallback)
  -> fresh ExecutionAdapter instance
       -> Codex App Server adapter
       -> Claude adapter only after a separate capability gate passes
  -> normalized events and evidence
  -> ExecutionRecordStore (process memory in the first migration)
  -> read-only status projection

Execution completion
  -> READY_FOR_REVIEW
  -> independent human/reviewer workflow
  -> approval remains outside ExecutionAdapter
```

### 4.1 ExecutionPolicyGate

The policy gate runs before provider selection or process creation. It validates the canonical task, explicit user action, requested authority, risk, prohibited actions, required evidence, project eligibility, and provider-independent Bridge prerequisites.

For feature-capable work, it must additionally validate the exact Issue, declared file allowlist, model label, reasoning effort, risk label, and `bridge:ready`. Missing authorization produces `BLOCKED_DECISION`; it is not a provider failure.

Provider choice never changes these inputs. A provider with more capability cannot receive more authority than the task grants.

### 4.2 ProjectRegistry

The registry is the sole source of local filesystem paths, allowed risk, enabled providers, and capability-evidence references. The browser supplies `project_id`, never `cwd`.

The existing `.bridge/codex-projects.local.json` shape may be migrated into a provider-neutral local registry, but the real file remains untracked. Each provider entry records an evidence grade and observation date rather than a permanent boolean claim.

### 4.3 ExecutionCoordinator

The coordinator owns:

- request validation after server-side project resolution;
- logical-task idempotency;
- creation of a coordinator-generated, immutable `attempt_id` before adapter dispatch;
- creation of one fresh adapter instance per new execution attempt;
- normalized state transitions;
- attempt-scoped event and evidence correlation even when the provider reports no
  run identifier;
- immutable provider/run reference after it is first reported;
- evidence and sanitized output accumulation;
- terminal-state immutability;
- cleanup reporting; and
- the status view returned to the Command Center.

The coordinator does not know Codex JSON-RPC methods or a future Claude CLI format. It also cannot approve, merge, deploy, release, or modify provider credentials.

### 4.4 AdapterRegistry

The registry resolves only an explicitly selected, project-enabled provider. It must not automatically fail over from Codex to Claude or from Claude to Codex. Silent failover would change authentication, sandbox enforcement, model/cost behavior, session provenance, and possibly side effects.

If the selected provider is not enabled or lacks verified capability for the authorized task, dispatch stops with `BLOCKED_PROVIDER` or `BLOCKED_ENVIRONMENT`. Selecting a different provider is a new explicit execution attempt.

The initial registry mapping is exact and closed:

| Provider key | Adapter boundary | Eligibility |
|---|---|---|
| `CODEX_BRIDGE` | Existing Bridge service using one fresh Codex App Server client | Eligible only for the already evidenced and authorized local read-only task tier |
| `CLAUDE_CODE` | Future adapter around the Claude Code CLI contract proven by the Claude gates in section 8 | Disabled; documentation or Claude Desktop availability cannot enable it |

Unknown provider keys fail closed. Provider aliases, model names, UI product
names, and transport names must not be accepted as provider keys. The registry
must not translate `CLAUDE_CODE` into `CODEX_BRIDGE`, or vice versa, when a
capability check fails.

### 4.5 ExecutionRecordStore

The first migration retains process-memory storage to avoid expanding scope. Each
record stores the coordinator-generated immutable `attempt_id`, canonical request
snapshot, resolved policy/capability snapshot, selected provider key, nullable
`provider_run_ref`, normalized status, evidence references, output summary, and
cleanup result. `attempt_id` is the canonical correlation key;
`provider_run_ref` is supplemental provider evidence and cannot replace it.

Persistence, recovery, daemons, watchers, locks, and background resume remain separate architectural decisions. The UI must continue to disclose `PROCESS_MEMORY_ONLY` while that limitation exists.

## 5. Provider-neutral `ExecutionAdapter` contract

The contract below is descriptive, not executable code.

### 5.1 Required operations

| Operation | Responsibility |
|---|---|
| `describeCapabilities(context)` | Return capability claims with evidence grade and provenance. Must not probe a provider, network, credentials, or filesystem outside an already authorized preflight. |
| `preflight(resolvedRequest)` | Verify local executable/transport availability, authentication class, sandbox mode, requested capability compatibility, and provider-specific constraints without starting task work. |
| `start(resolvedRequest, emit)` | Start exactly one provider run and return a stable provider run reference when the provider reports one; otherwise return `null`. Emits normalized facts asynchronously. |
| `dispose(reason)` | End provider resources using a bounded cleanup policy and return observable cleanup evidence. Must be idempotent. |

`approve`, `merge`, `deploy`, `release`, and generic arbitrary-command methods are intentionally absent.

### 5.2 Adapter inputs

The adapter receives a server-resolved request containing:

- canonical task and attempt identifiers;
- selected provider and requested model/reasoning metadata;
- allowlisted repository identity and server-resolved `cwd`;
- exact execution authority and allowed actions;
- objective, scope, acceptance criteria, constraints, and canonical prohibited actions;
- context and architecture references;
- required completion evidence;
- risk and governance classifications; and
- immutable policy and capability-evidence snapshots.

It does not receive browser-supplied filesystem paths, secret values, approval authority, release authority, or permission to reinterpret scope.

`attempt_id` is generated by the coordinator before `preflight`/`start`, is
immutable for the lifetime of the attempt, and is never derived from a provider
session, task, thread, turn, or process ID. A retry, reroute, or newly dispatched
attempt receives a new `attempt_id` even when it concerns the same canonical task.
The adapter may return `provider_run_ref` only after receiving its component IDs
from the provider. It is a structured, provider-namespaced reference:

| Field | Rule |
|---|---|
| `provider` | Must equal the attempt's immutable `CODEX_BRIDGE` or `CLAUDE_CODE` selection |
| `run_id` | Opaque provider-issued primary run/session/thread ID; never a process ID or coordinator-generated substitute |

The entire value is optional/nullable and, once recorded for an attempt, is
immutable. Its absence is a reported limitation, not a reason to synthesize an
ID. A provider reference is unique only in its provider namespace: consumers
must never assume `run_id` is globally unique or use it without the provider
key. A provider-issued subordinate turn/task/message ID is carried separately
as nullable `provider_operation_ref` on the event/evidence that reported it; it
does not redefine the attempt or primary run. If a provider reports the primary
ID only after start, earlier events keep `provider_run_ref: null`; they are
correlated through `attempt_id` and are not rewritten. Later discovery adds the
reference to the attempt record and future events, but never changes the
identity of earlier event evidence.

### 5.3 Adapter outputs

Adapters emit a small provider-neutral event vocabulary. The coordinator wraps every
event in an immutable correlation envelope containing `attempt_id`, selected
provider key, and a coordinator-generated `event_id`; `provider_run_ref` is
nullable and follows the structured contract above, while
`provider_operation_ref` is nullable and event-scoped.
Thus events, outputs, cleanup results, and evidence remain correlated when a
provider has not exposed a session/task/thread/turn ID. No consumer may join records
by timestamp, output text, process ID, or a guessed provider identifier.

| Event | Required information |
|---|---|
| `provider_queued` | Provider run reference when known; otherwise the correlation envelope only |
| `provider_started` | Provider session/task/turn identifiers when reported; absence remains explicit |
| `model_reported` | Actual model only when the provider reports it |
| `output_delta` | Sanitized user-facing text; never secret/environment dumps |
| `awaiting_input` | Native request type and safe blocker summary; no automatic answer |
| `provider_completed` | Explicit successful terminal status and completion evidence |
| `provider_failed` | Provider terminal status, normalized error class, and safe detail |
| `cleanup_progress` | Cleanup action without falsely updating task activity |
| `cleanup_completed` | Final cleanup outcome |

Raw provider events may be retained only if separately authorized, sanitized,
size-bounded, and linked as non-authoritative diagnostic evidence. Each retained
event/evidence reference must carry the coordinator `attempt_id` and its immutable
`event_id` or evidence ID; `provider_run_ref` remains nullable. They must not
determine review or approval state directly.

### 5.4 Capability evidence grades

Each capability uses one of these grades:

| Grade | Meaning |
|---|---|
| `NATIVE_VERIFIED` | Observed through a provider-native interface with dated evidence |
| `CONTROL_PLANE_ENFORCED` | Enforced by the Command Center/Bridge rather than the provider |
| `DOCUMENTED_ONLY` | Stated in local instructions or provider documentation but not runtime-verified here |
| `UNVERIFIED` | No sufficient evidence |
| `UNAVAILABLE` | Checked and absent in the stated environment |

Capability and authorization are separate. `NATIVE_VERIFIED` code execution does not authorize file writes, and a task authorization cannot turn `UNVERIFIED` sandboxing into an available capability.

## 6. Canonical execution state

The initial provider-neutral state vocabulary extends the current Codex contract by adding `BLOCKED_DECISION`:

| State | Category | Meaning |
|---|---|---|
| `NOT_STARTED` | Pre-start | No provider run exists |
| `QUEUED` | Active | Accepted and initializing or queued |
| `WORKING` | Active | Provider reports active execution |
| `AWAITING_INPUT` | Paused, non-terminal | Provider requires native human input or approval |
| `COMPLETED` | Terminal success | Provider explicitly reports successful completion |
| `FAILED` | Terminal failure | Execution ended unsuccessfully, was interrupted, exited early, or returned an unknown terminal condition |
| `BLOCKED_DECISION` | Terminal blocked | Required task authority or governance decision is absent |
| `BLOCKED_PROVIDER` | Terminal blocked | Selected provider/auth/capability cannot satisfy the authorized request |
| `BLOCKED_ENVIRONMENT` | Terminal blocked | Required local executable, transport, configuration, or runtime is unavailable |

Rules:

1. Only an explicit provider success terminal maps to `COMPLETED`.
2. Provider `interrupted`, cancelled, denied, unknown terminal values, and early process exit map to `FAILED` with a specific blocker/error code.
3. `AWAITING_INPUT` is non-terminal even if the first UI pauses polling and directs the user to the native provider. Resumption requires provider-native, user-authorized evidence; the Command Center does not synthesize approval.
4. Terminal states are immutable. A retry or provider change creates a new attempt linked to the same canonical task.
5. `COMPLETED` maps governance to `READY_FOR_REVIEW`, not `APPROVED` or `DONE`.
6. Execution, governance, review, approval, release, UAT, and production state remain separate fields. They must never be inferred from one another.

Recommended normalized blocker/error codes include `AUTHORIZATION_MISSING`, `PROJECT_NOT_ALLOWLISTED`, `CAPABILITY_UNVERIFIED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_AUTH_UNVERIFIED`, `PROVIDER_INTERRUPTED`, `PROVIDER_PROTOCOL_ERROR`, and `PROCESS_CLEANUP_INCOMPLETE`.

## 7. Idempotency and attempts

Idempotency is defined at the logical task boundary, not by provider. The key should be derived from project, task/canonical reference, and authorization revision; it should not include the provider. This prevents a repeated click or apparent provider switch from launching the same logical work twice.

While an attempt is active or paused, the coordinator returns the existing record. After a terminal state, rerouting to another provider requires an explicit user action and creates a new `attempt_id` linked to the prior attempt. There is no automatic cross-provider retry or dual execution.

The process-memory limitation must remain visible until a separately designed persistent store exists. Restarting the server can lose deduplication and status history; therefore write-capable execution must not be enabled on this storage model merely by adding an adapter.

## 8. Provider mapping and Claude capability gates

This table records the repository evidence at this baseline. It is not a general claim about either product.

| Capability | `CODEX_BRIDGE` | `CLAUDE_CODE` | Design consequence |
|---|---|---|---|
| Local execution transport | `NATIVE_VERIFIED`: App Server over stdio | `UNAVAILABLE` at the recorded 2026-09-04 audit; not rechecked here | Claude adapter must remain disabled |
| Native account authentication | `NATIVE_VERIFIED`: `account/read` requires ChatGPT | `UNVERIFIED` | No credential or API-key substitution |
| Server-resolved repository | `CONTROL_PLANE_ENFORCED` | `CONTROL_PLANE_ENFORCED` when implemented | Shared ProjectRegistry owns `cwd` |
| Repository read | `NATIVE_VERIFIED` in the MVP smoke | `UNVERIFIED` | Claude cannot be selected for the current task tier |
| Command/code execution | `NATIVE_VERIFIED` transport capability, but only repository read is authorized | `UNVERIFIED` | Capability never implies write authority |
| Read-only sandbox | `NATIVE_VERIFIED`: `thread/start` uses `sandbox: read-only` | `UNVERIFIED` | Written instructions alone are insufficient |
| Structured lifecycle events | `NATIVE_VERIFIED` | `UNVERIFIED` | Claude adapter needs an evidenced parser/protocol before enablement |
| Status projection/query | App Server events plus process-memory Command Center status | `UNVERIFIED` | Canonical status stays in the coordinator |
| Native approval pause | `NATIVE_VERIFIED`; surfaced as `AWAITING_INPUT` | `DOCUMENTED_ONLY` fail-closed instructions | Neither adapter may auto-resolve approval |
| Approval resolution in Command Center | Not implemented | Not implemented | Remains outside the adapter contract |
| Stable session identity | Thread and turn IDs are reported | `UNVERIFIED` | Provider run references are nullable until reported |
| Actual model reporting | Supported conditionally; observed smoke returned none | `UNVERIFIED` | Display `Not reported`, never infer a model |
| Bounded process cleanup | Implemented and tested | `UNVERIFIED` | Claude integration needs its own evidenced cleanup policy |
| Persistent idempotency/recovery | Not implemented | Not implemented | Shared limitation; no write-capable promotion |
| File-write execution | Not authorized | Not authorized | Separate high-risk design and approval required |

### Provider-specific correlation mapping

| Provider key | Runtime mapping | `provider_run_ref` mapping | Success mapping |
|---|---|---|---|
| `CODEX_BRIDGE` | Native Bridge handoff to a fresh Codex App Server client using `initialize -> initialized -> account/read -> thread/start -> turn/start` | `run_id = thread_id`; an event may carry `provider_operation_ref = turn_id` when each is actually reported | Only an explicit App Server turn status of `completed` |
| `CLAUDE_CODE` | Future Claude Code CLI adapter; never Claude Desktop UI automation, copied prompts, or a generic shell runner | Provider-issued Claude Code session/run ID; an event may carry a subordinate task/message reference only if the audited CLI interface reports it | Disabled until the CLI audit proves one explicit successful terminal signal and fail-closed mappings for all other exits |

The coordinator always generates `attempt_id` before either mapping starts. A
provider reroute, manual retry after a terminal state, or second run against the
same task receives a new `attempt_id`; it does not reuse the prior attempt merely
because `provider_run_ref` is absent or repeated. Conversely, a provider may
report several subordinate operation IDs during one attempt without creating a
new attempt. The execution record owns the one-to-zero-or-one mapping from
`attempt_id` to the immutable primary `provider_run_ref`.

### Claude Desktop gate

Claude Desktop and Claude Code CLI capabilities are evaluated independently.
The presence of the Desktop application, an authenticated Desktop window, MCP
configuration, or a successful interactive chat does not prove CLI availability,
CLI authentication, repository scope, read-only enforcement, structured events,
run identity, or cleanup behavior.

Claude Desktop may be used as a native user-facing approval/input surface only
after a separate approved audit proves all of the following for the exact local
environment:

1. the Desktop application and its authentication/session state can be checked
   without reading secrets or automating/scraping chat content;
2. the audited Claude Code mode explicitly documents that Desktop is required,
   optional, or not involved;
3. a native approval/input request can be matched to the coordinator
   `attempt_id` and namespaced `provider_run_ref` without guessed timestamps or
   copied prompt text;
4. the human action resumes only the same paused provider run and grants no new
   repository, review, merge, deploy, release, or billing authority; and
5. absence, logout, ambiguity, or version drift blocks the Desktop-dependent
   path without silently switching provider or authentication mode.

Until that evidence exists, Desktop-mediated execution or approval resolution is
`UNVERIFIED` and outside the adapter. If the audited CLI mode does not require
Desktop, record the Desktop gate as `NOT_REQUIRED` for that mode rather than
using Desktop presence as positive CLI evidence.

### Claude Code CLI gate

`CLAUDE_CODE` cannot be enabled until a separately authorized, local-only audit
proves all of the following for an exact CLI version and environment:

1. an allowlisted executable/transport is available without unapproved
   installation or dependency retrieval;
2. the CLI uses an acceptable native account-authentication mode, with no API-key
   fallback, environment secret exposure, credential substitution, or inherited
   provider keys;
3. the coordinator supplies only the server-resolved repository and the CLI
   cannot escape the authorized working directory or file/action scope;
4. repository-read-only operation is enforceable outside prompt text and a
   no-mutation smoke verifies the pre/post Git state;
5. start, sanitized output, approval/input request, explicit success,
   interruption, cancellation, denial, protocol error, and early exit each have
   deterministic normalized mappings;
6. the CLI's native session/run ID is captured as namespaced
   `provider_run_ref`, or its absence is explicitly recorded while
   `attempt_id` remains the sole correlation key;
7. every provider-native approval pauses at `AWAITING_INPUT` and cannot be
   answered by the adapter or Command Center;
8. cancellation and normal/error cleanup have bounded, observable behavior and
   leave no child process, daemon, watcher, or resumable task accidentally alive;
9. logs and evidence are sanitized and size-bounded, with no raw environment,
   token, conversation, or secret capture; and
10. version, capability evidence date, environment identity, and recheck/expiry
    policy are recorded in the ProjectRegistry.

### Claude enablement gate

A Claude adapter cannot be registered as eligible until both the Claude Code CLI
gate and every Desktop gate declared required by that audited CLI mode pass. At
minimum, the combined evidence must prove:

1. executable/transport availability without unapproved installation;
2. acceptable native authentication with no API-key fallback or secret exposure;
3. server-resolved `cwd` behavior;
4. enforceable read-only sandboxing, not prompt-only compliance;
5. deterministic mapping for start, output, input request, explicit completion, interruption, and failure;
6. stable, provider-namespaced run identity or a documented limitation with
   `attempt_id` retained as the canonical correlation key;
7. bounded cancellation/cleanup behavior;
8. sanitized evidence capture; and
9. no writes to the repository during the read-only smoke.

If any required capability is absent or ambiguous, the registry keeps Claude disabled and reports `BLOCKED_ENVIRONMENT` or `BLOCKED_PROVIDER`; it must not weaken the task or silently use Codex.

## 9. Review and approval boundaries

### 9.1 Before execution

- The human workflow owns Issue creation, file allowlisting, labels, `bridge:ready`, and the exact authority grant.
- The Command Center validates and records those facts but cannot create missing approval metadata during dispatch.
- Provider adapters may reject an unsafe request but cannot expand or repair its authority.
- Model routing is subordinate to the task's explicit model/risk policy and the lowest-cost-capable rule. A fallback model must be reported, not hidden.

### 9.2 During execution

- A native provider approval or input request pauses at `AWAITING_INPUT`.
- The adapter emits the safe request type plus the coordinator `attempt_id` and
  nullable `provider_run_ref`; it does not answer the request.
- The Command Center does not translate a UI click into provider approval until a separate authenticated approval design is reviewed and authorized.
- Output and tests are execution evidence only. They do not create approval or release authority.

### 9.3 After execution

- `COMPLETED` means only that the selected provider explicitly finished the authorized attempt.
- The coordinator sets governance to `READY_FOR_REVIEW` and preserves evidence references, actual provider/model when known, exact changed paths, and skipped/blocked checks.
- Review must be an independent workflow with identifiable provenance. A Codex or Claude findings reviewer cannot add `bridge:approved` or self-approve its own execution.
- Human approval, merge, UAT, deploy, release, and production verification remain separate gates and separate state transitions.

### 9.4 Protected surfaces

This design does not route execution through `/api/bridge/chatgpt-advice` or `/api/bridge/extract-features`. Those routes have provider/fallback behavior that is neither an execution adapter nor authoritative task evidence.

## 10. Migration plan

Each phase requires its own exact approved implementation task. No phase is authorized by this document.

### Phase 0 — Contract tests and terminology

- Define provider-neutral request, event, capability, status, and attempt contracts.
- Lock existing Codex state semantics with characterization tests.
- Explicitly test that `AWAITING_INPUT` is paused/non-terminal and that only provider `completed` succeeds.

Exit condition: no production/runtime behavior change and no Codex regression.

### Phase 1 — Extract the shared core behind the existing Codex route

- Introduce the policy gate, coordinator, registry, and adapter factory internally.
- Wrap the existing Codex client as the first adapter without changing protocol or authority.
- Retain process-memory storage and current route/status compatibility.

Exit condition: existing focused/full tests and the local read-only Codex smoke produce equivalent user-visible evidence.

### Phase 2 — Provider-neutral API and UI projection

- Add a neutral execution endpoint and provider-neutral panel vocabulary.
- Keep the Codex endpoint as a temporary compatibility wrapper, not a second state machine.
- Display selected provider, actual provider/model, capability evidence age, attempt linkage, and truthful blockers.

Exit condition: both routes address the same execution record, and duplicate dispatch cannot create duplicate provider runs.

### Phase 3 — Claude capability audit

- Run only after an exact task authorizes the audit boundary.
- Prove or reject every item in the Claude enablement gate.
- Record `UNAVAILABLE`/`UNVERIFIED` results without installing, substituting credentials, or weakening sandbox requirements unless separately authorized.

Exit condition: a human-reviewed capability evidence record exists. Documentation-only claims do not pass.

### Phase 4 — Optional Claude read-only adapter

- Implement only capabilities proven in Phase 3.
- Register Claude only for the allowlisted local read-only task tier.
- Run contract tests and an isolated no-mutation smoke.

Exit condition: Claude can be explicitly selected, emits the same canonical lifecycle/evidence contract, and does not change review/approval semantics.

Write-capable tasks, persistent orchestration, cross-provider retries, approval resolution, deployment, and production integration remain future designs.

## 11. Migration risks and controls

| Risk | Failure mode | Required control |
|---|---|---|
| False provider parity | Claude is shown as available because `CLAUDE.md` exists | Capability evidence grades; provider disabled until runtime proof |
| Governance duplication | Codex and Claude services validate different rules | One ExecutionPolicyGate before adapter resolution |
| Sandbox mismatch | Prompt-only “read only” is treated as enforcement | Require evidenced native or control-plane enforcement; otherwise block |
| Silent provider fallback | A failed Codex run launches Claude with different auth/cost/side effects | Explicit provider selection; no automatic fallback |
| Duplicate execution | Retry or provider switch launches concurrent work | Provider-independent logical idempotency plus explicit attempt creation |
| Approval deadlock or bypass | `AWAITING_INPUT` is treated as success, failure, or auto-approved | Non-terminal paused state; provider-native user action only |
| Terminal-status ambiguity | Interrupted or unknown completion becomes success | Exact success allowlist; all other terminal conditions fail closed |
| Cross-run state contamination | Concurrent callbacks update another task | Fresh adapter instance and event sink per attempt |
| Process leakage | Child survives completion/failure | Provider-specific bounded, idempotent cleanup with evidence |
| Secret leakage | Environment or raw provider output exposes credentials | Environment-name denylist, no value logging, sanitization and output bounds |
| Status conflation | Completed execution appears approved/deployed | Separate execution, governance, review, approval, UAT, release, and production fields |
| Compatibility drift | Neutral API changes existing Codex behavior | Characterization tests and temporary wrapper over one coordinator |
| Stale capability claims | Old smoke evidence is treated as permanent | Record evidence reference, observed date, environment, and expiry/recheck policy |
| Cost/routing opacity | Selected or rerouted model is inferred or hidden | Record requested and actual provider/model; display `Not reported` when absent |
| In-memory recovery gap | Server restart loses status/deduplication | Disclose limitation; do not enable write-capable tasks on this basis |
| Dual-write expansion | “Compare providers” runs the same mutation twice | No dual execution; any future comparison must be read-only and separately designed |

## 12. Acceptance criteria

A future implementation of this architecture is acceptable only when all applicable criteria pass with evidence:

### Contract and isolation

- One provider-neutral coordinator owns validation, idempotency, canonical state, and status projection.
- Codex and Claude protocol details exist only behind `ExecutionAdapter` implementations.
- The registry accepts only the canonical `CODEX_BRIDGE` and `CLAUDE_CODE`
  provider keys; unknown names and aliases fail closed.
- Every new attempt creates a fresh adapter instance; concurrent event streams cannot cross-update.
- Provider selection is explicit and cannot silently fall back or expand authority.
- Every attempt, event, output, cleanup result, and evidence reference correlates
  through the coordinator-generated immutable `attempt_id` even when
  `provider_run_ref` is absent.
- A reported `provider_run_ref` is provider-namespaced, immutable, and
  supplemental; consumers never treat it as a globally unique or canonical
  attempt identifier.

### Governance

- Missing Issue/file allowlist/model/reasoning/risk/`bridge:ready` produces `BLOCKED_DECISION` before a provider starts for any task that requires those gates.
- Browser-supplied `cwd` is rejected or ignored; only the server registry resolves repositories.
- Canonical prohibited actions are preserved for every provider.
- No adapter can approve, merge, deploy, release, change billing/secrets, or change review state.

### Lifecycle truthfulness

- Only explicit provider success maps to `COMPLETED`.
- Interrupted, cancelled, unknown, and early-exit conditions never map to success.
- `AWAITING_INPUT` remains paused/non-terminal and is never auto-resolved.
- `COMPLETED` transitions governance only to `READY_FOR_REVIEW`.
- Requested and actual provider/model are distinct; absent actual values display `Not reported`.
- Cleanup events do not advance `last_meaningful_activity` and cleanup failure remains visible.

### Capability truthfulness

- Every enabled provider capability has a dated evidence grade and reference.
- `CLAUDE_CODE` remains disabled until the CLI gate and every Desktop gate
  declared required by that exact mode are independently verified.
- Claude Desktop presence, login, chat success, or configuration never counts as
  evidence for CLI availability, CLI auth, read-only enforcement, lifecycle,
  correlation, or cleanup.
- Written instructions or a successful static check are never presented as execution, sandbox, auth, deployment, or provider evidence.

### Security and scope

- Local execution remains loopback-only and development-only.
- Native auth is verified; API-key fallback and secret-value logging remain absent.
- The first provider-neutral and first Claude smokes, if authorized, are repository-read-only and prove no repository mutation.
- Protected AI routes, GitHub integration, persistence, networking expansion, deployment, billing, and production remain untouched.

### Compatibility and evidence

- Existing Codex contract tests, focused tests, full tests, lint, and build pass in the authorized environment.
- The migrated Codex browser smoke preserves the current user-visible lifecycle and evidence.
- Duplicate clicks and explicit reroute attempts are tested for provider-independent idempotency.
- Evidence records state repository path, branch, exact HEAD, dirty state,
  immutable `attempt_id`, selected provider key, nullable namespaced
  `provider_run_ref`, requested/actual model, commands/checks performed, changed
  paths, blockers, skipped checks, and cleanup outcome. Event/evidence
  correlation remains by `attempt_id` when the provider never reports an ID.
- Independent review confirms the implementation stops at `READY_FOR_REVIEW`.

## 13. Non-goals

- Installing, invoking, or configuring Claude.
- Modifying the current Codex adapter, routes, service, UI, or provider behavior.
- Enabling write-capable feature implementation.
- Creating a generic arbitrary-command runner.
- Persistent workflow storage, background workers, watchers, daemons, locks, or crash recovery.
- Command Center approval resolution.
- Automatic retries, automatic provider failover, multi-provider voting, or dual execution.
- GitHub Issue/label/PR mutation, merge, UAT, deployment, release, billing, service creation, secrets, or production access.
- Treating Prototype fixtures or AI-generated output as operational authority.

## 14. Decision summary

Adopt a shared provider-neutral execution core and a fresh `ExecutionAdapter` instance per attempt. Migrate the verified Codex path first behind compatibility boundaries. Keep Claude disabled until a separately authorized capability audit proves its local transport, authentication, read-only enforcement, lifecycle, and cleanup. Preserve execution completion, review, approval, and release as independent states, with every successful provider run stopping at `READY_FOR_REVIEW`.
