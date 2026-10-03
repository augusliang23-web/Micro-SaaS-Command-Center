# Agent Console Phase 2

An internal, provider-neutral execution engine exercised with a deterministic Fake Adapter. No server route imports or starts the engine. Task creation remains DRAFT and `POST /api/tasks/:id/run` remains unavailable.

## Ownership

- `server/tasks/projectRegistry.mjs`: immutable server-owned paths, actions, structured verification commands and protected paths. Legacy command strings now fail loading. Copy the updated example configuration when migrating a local registry.
- `stateTransitions.mjs` and `TaskStore.update`: canonical task transitions and validated atomic replacement of execution fields; request identity and review cannot be changed through execution updates.
- `ExecutionStore`: internal fake AgentRun records and logically append-only JSONL evidence, atomically replaced on append. Active task/run records recover to UNKNOWN at restart.
- `server/execution/orchestrator.mjs`: process-wide project single-flight, policy checks, persistence, execution and publication decisions.
- `worktreeManager.mjs`: exact origin/defaultBranch resolution, persistence callback before branch/worktree creation, isolated Git worktrees, source and ref checks, commit and explicit non-force push with SHA readback.
- `fakeAdapter.mjs`: exclusive creation of one server-derived fixture file; no process/Git/network API.
- `verificationRunner.mjs` and `processRunner.mjs`: configured executable plus argv via execFile with shell disabled, bounded time/output, real command results. setupCommand is inert. npm verification refuses injected environment/project configuration and uses empty private user/global configuration files.
- `fakePrProvider.mjs`: injectable create/readback contract; fake:// URLs and FAKE_OPEN state, no real GitHub integration.

## State and evidence

Task flow is DRAFT → QUEUED → STARTING → RUNNING → VERIFYING → COMPLETED. Active stages may become BLOCKED, FAILED, CANCELLED or UNKNOWN; terminal tasks cannot restart. A nonzero verification exit is COMPLETED with failing evidence and PENDING review, before commit/push/PR. No verification commands means an unknown verification result, never PASS. Ambiguous PR creation/readback becomes UNKNOWN without a PR claim. Persistence failure surfaces while preserving the last durable record.

Run identity `fake` is internal; browser-selectable AGENTS still contains only claude-code/codex. Fake usage is UNAVAILABLE, with null cost/tokens.

Worktree/branch creation, actual verification commands, commit and remote push readback are LOCALLY_VERIFIED. Adapter output and fake PR readback are RUNTIME_OBSERVED. Adapter-supplied grades/PASS text have no authority. Phase 2 produces no GITHUB_VERIFIED evidence.

## Security scope

The adapter receives only a server-derived task ID, worktree path and exact fixture path. The registry owns filesystem roots, default branch, verification commands and protected paths. Orchestrator owns Git operations, publication target, commit message and PR base. Push accepts only the generated agent/<taskId>-<slug> branch, never force. Protected edits remain blocked even if EDIT_PROTECTED_PATHS is listed; approval continuation and setup/install are outside this phase.

Guards check physical worktree/repository identity, task HEAD/branch, local heads/tags, all remote refs/URLs and source HEAD/status/content. Source content checks cover tracked changes, nonignored untracked files and ignored protected paths (including .env); ignored dependency/build caches are outside this check. This is a Fake Adapter boundary with checks for later review, not an OS sandbox for real providers. Test-only dependency injection and allowLocalRemotes are trusted internal harness controls.

Task worktrees/branches are retained for inspection on failure; no automatic clean/reset/removal. Single-flight is process-local, not a distributed lock. Existing browser-path debt remains: local-git/status?path and bridge/summarize-changes localPath. Governance files remain unchanged.

## Validation

Local: lint PASS; server tests 214/214 (baseline 159); UI tests 25/25; build PASS. Existing server.ts CJS/import.meta warning is unchanged; build success does not establish packaged server startup. GitHub has no CI validation for this change.

Scratch integration uses temporary repositories, a local bare remote and fake PR readback. It proves remote base selection despite an ahead/dirty source, fixture edit, three real verification commands, commit, local push and COMPLETED state while preserving source contents. Failure cases cover policy/registry, path/branch collisions, HEAD/ref/remote changes, protected edits/renames, command failure, push failure, ambiguous PR/readback, persistence failure, missing source, busy execution and retry rejection.

Five focused mutations each failed their intended test, then source bytes were restored: task path selection, protected guard removal, HEAD guard removal, unverified PASS trust and push-prefix removal. Independent Sol High read-only review: PASS, no remaining blocking findings. No tests create a real GitHub PR or invoke a real agent/provider.
