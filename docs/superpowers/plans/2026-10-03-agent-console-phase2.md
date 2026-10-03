# Agent Console Phase 2 Implementation Plan

**Goal:** Prove a provider-neutral internal execution pipeline with only a deterministic Fake Adapter, isolated worktrees and real local Git evidence.

**Architecture:** The internal Orchestrator revalidates task authority against the current server registry and owns task/run transitions, worktree management, verification, commit/push and PR readback. Fake Adapter has one server-derived fixture path, no process or network interface. Command execution uses executable plus explicit argv, never a shell.

**Tech Stack:** Existing Node ESM, node:test, Node filesystem/child_process built-ins, existing Express foundation. No new dependency.

**Spec:** /Users/augusliang/.codex/attachments/b4efe096-af9f-4160-8612-fc7072b14f1d/貼上的文字.txt

## Global Constraints

- Baseline main @ b1e5a8acf4ab57f8a28b87afea5da795555c4f57; implementation branch codex/agent-console-phase2-orchestrator.
- No real Claude/Codex invocation, AI provider calls, browser execution endpoint, setupCommand/dependency installation, governance migration, merge or deploy.
- Protect original dirty main and preservation branch; CLAUDE.md, AGENTS.md and .bridge/ unchanged.
- Only local temporary repositories/bare remotes and fake PR provider in automated tests.
- Full validation: npm run lint, npm test, npm run test:ui, npm run build. Baseline 159 server and 25 UI tests; results are local, not CI.

## Review Focus

- Symlink or nested worktree roots must never redirect edits into the source checkout.
- Existing staged/untracked/protected files, renames, and adapter-created commits/branches must not bypass diff guards.
- Unexpected remote URLs/refs or task-supplied extra fields must fail before push; push only exact server-generated agent branch.
- Nonzero verification means COMPLETED with failing evidence, no commit/push/PR; adapter claims cannot produce PASS.
- Persistence and PR-readback errors must not fabricate state or PR evidence; single-flight must span Orchestrator instances within the process.

## Task 1: Structured registry commands

Files: server/tasks/projectRegistry.mjs, projects.local.example.json, test/agent-console-phase1.test.mjs, test/agent-console-phase2-registry.test.mjs.

- [x] Add failing tests for string commands, malformed argv and permission/command inconsistency.
- [x] Accept only {command, args} with exact keys, nonempty command string, string argv array, no NUL; reject command strings and shell configuration fields. Setup remains inert.
- [x] Require test/lint/build commands when matching RUN_TESTS/RUN_LINT/RUN_BUILD is allowed. Clone and deep-freeze registry data, preventing mutation of server policy/commands.
- [x] Update example and old fixtures; all registry/Phase 1 tests pass.

## Task 2: Controlled persistence and transitions

Files: server/tasks/stateTransitions.mjs, types.mjs, taskStore.mjs, executionStore.mjs; test/agent-console-phase2-store.test.mjs.

Interfaces: assertTaskTransition(from,to); TaskStore.update(taskId,patch); ExecutionStore({dir,fsImpl?,now?}).saveRun(run), getRun(runId), appendEvidence(evidence), listEvidence(taskId).

- [x] Tests first for illegal transitions, task identity/input immutability, full validation, atomic preservation on write failure, fake run identity and honest evidence persistence.
- [x] Main flow DRAFT→QUEUED→STARTING→RUNNING→VERIFYING→COMPLETED; active states may transition BLOCKED/FAILED/CANCELLED/UNKNOWN; terminal states never resume.
- [x] Update permits only server-owned execution fields, rejects taskId/project/input/review changes; validates whole task before replacement.
- [x] Internal run identity fake is accepted only by AgentRun validation; browser/task AGENTS stays claude-code/codex. Run records recover active states to UNKNOWN.
- [x] Evidence JSONL is logically append-only with atomic replacement to preserve prior records under partial writes; grade/kind and task/run associations validated, duplicate IDs rejected.

## Task 3: Safe commands, worktrees and Git guards

Files: server/execution/processRunner.mjs, worktreeManager.mjs, executionPolicy.mjs; test/agent-console-phase2-worktree.test.mjs.

Interfaces: runProcess({command,args,cwd,timeoutMs?})→{stdout,stderr,exitCode,signal,durationMs}; WorktreeManager.prepare(project,task)→context; guard(context,project); commit(context,task); push(context,task).

- [x] Scratch tests first for origin base resolution despite dirty local HEAD, existing worktree, wrong paths, protected renames/untracked files, moved HEAD, extra branches/remote refs, unsafe push branch and changed remote target.
- [x] Registered localPath must be actual source repository root; task paths ignored/rejected; registered worktreeRoot must be outside source and canonical, no symlink redirection.
- [x] Snapshot original source status/HEAD, local branches and remote refs; fetch origin/defaultBranch; exact base SHA; generated agent/<taskId>-<slug> and worktreeRoot/taskId only. Existing branch/path blocked, never reset or clean.
- [x] Detect HEAD movement, wrong repository/worktree/branch, source checkout mutation, unexpected branch/remote refs and changed remote endpoints before commit/push.
- [x] Protected paths match exact file or directory prefix and rename source/destination. Commit only allowed fixture changes; commit/push require canonical AUTO_ALLOWED permissions.
- [x] Push exact generated agent ref without force, verify remote target before/after and read back exact SHA.

## Task 4: Fake adapter, verifier and fake PR abstraction

Files: server/execution/fakeAdapter.mjs, verificationRunner.mjs, fakePrProvider.mjs; test/agent-console-phase2-adapter.test.mjs.

- [x] Tests first for traversal/symlink escape, unsafe adapter identity, untrusted PASS claims, nonzero/timeout verification, fake PR grade/readback identity.
- [x] FakeAdapter.id=fake, probe() and start(spec,emit); only edit agent-console-fixture/<taskId>.txt inside canonical supplied worktree, emit observations, no shell/Git/network.
- [x] Verifier runs only current registry {command,args} for permitted actions; command_result records real exitCode/duration and LOCALLY_VERIFIED grade. No commands means no PASS.
- [x] FakePrProvider createPr/getPr is in-memory and its readback evidence is RUNTIME_OBSERVED, never GITHUB_VERIFIED.

## Task 5: Internal Orchestrator and scratch integration

Files: server/execution/orchestrator.mjs; test/agent-console-phase2.test.mjs.

- [x] Tests first: full local pipeline, single-flight, unknown project, missing actions, path override, real adapter rejection, HEAD/branch/remote guard violations, protected-path edits, failing verification, push failure, PR create/readback failure and persistence failure.
- [x] Revalidate stored task against current registry; only DRAFT can run; no browser export/mount. Adapter override is internal and only fake is permitted in Phase 2.
- [x] Process-level per-project single-flight held through terminal persistence. Create fake AgentRun with UNAVAILABLE usage. Adapter callbacks never control status or evidence grade.
- [x] Execute full flow; all verification results recorded before deciding success. Nonzero verification is COMPLETED/PENDING with no publication. Guard/policy violations BLOCKED; unexpected execution faults FAILED; ambiguous PR create/readback UNKNOWN, without PR claim.
- [x] Persist actual commits, verified remote push and fake PR readback before adding task commitSha/pr. Preserve evidence on later failure. No cleanup of task worktree/branch automatically.

## Task 6: Validation, negative proof, review and PR

- [x] Five requested mutations (isolation/protected/HEAD/evidence/push) must cause focused test failures; restore source bytes exactly.
- [x] Full lint/server/UI/build; review complete diff independently on requested Sol High route, address blocking findings with regression tests.
- [ ] Commit and push only implementation branch, create PR against main and attach it. Remote baseline and original checkout/preservation hashes have been rechecked.
- [ ] Report baseline, modules, transitions, isolation, adapter, commands, guard/evidence examples, all failure/mutation proofs, validation and PR; no merge/deploy.
