# Agent Console Phase 3B7B1 — Docker offline execution foundation (fake agent only)

**Status:** built and tested offline; security review fixes applied (see below). **No real Docker, no Claude Code or Codex, no provider call, no credential.**
`REAL_AGENT_EXECUTION = NOT_AUTHORIZED`. Nothing is wired to a route, the UI, `server.ts` or any deployment.
**Baseline:** `origin/main` = `25692a9a1fdedaf82910630fb767589aa5dccddf`. Direction: Control Plane's Phase 3B7A architecture (Docker execution; the macOS track in PR #24 is suspended and untouched).

```text
Task (DRAFT) → Orchestrator[publishGate] → worktree → ContainerFakeAgentAdapter → DockerSandboxRuntime (existing)
             → host guards (paths, protected files) → verification (fake path commands, host)
             → ApprovalGate: COMMIT → PUSH_BRANCH → CREATE_PR   (one single-use approval each, bound to the exact diff)
```

## What was added (and what was reused)

| Piece | File | Notes |
| --- | --- | --- |
| Approval gate, diff binding, approval store | `server/execution/approvalGate.mjs` (new) | `COMMIT`, `PUSH_BRANCH`, `CREATE_PR` need approval on the Docker path only. |
| Container adapter (start, state, timeout, cancel, cleanup, sanitized output) | `server/execution/containerAgentAdapter.mjs` (new) | Fake scripted agent only; closed constructor and spec. |
| Fake-agent image alias | `server/sandbox/fakeAgentImages.mjs` (new) | Same digest-pinned busybox image as `TEST_IMAGES`, role `agent` only. No pull, build or download. |
| Opt-in Docker path | `server/execution/orchestrator.mjs` (edited) | `publishGate` constructor option. Without it the Phase 2 fake path is byte-for-byte the same behavior. |
| Evidence kinds | `server/tasks/types.mjs` (edited) | Added `sandbox_*` (five) and `approval_required` / `approval_consumed`. Existing kinds untouched. |
| **Reused unchanged** | `DockerSandboxRuntime`, `sandboxPolicy` + `assertDockerArgs`, `readbackVerifier`, `pathSafety`, `workspaceView`, `DockerClient`, `TaskStore`, `ExecutionStore`, `WorktreeManager`, `FakePrProvider`, `FakeAdapter`, `PolicyGate`, `ACTION_POLICY` | The existing scope guard "the Orchestrator never names sandboxes, Claude or Codex and stays fake-only" still passes, so the Orchestrator talks to the adapter only through a neutral result shape. |

## Approval model

- On the Docker path `COMMIT`, `PUSH_BRANCH` and `CREATE_PR` are `CONTROL_PLANE_APPROVAL` (`DOCKER_PATH_ACTION_POLICY`). The global `ACTION_POLICY` is unchanged, so the Phase 2 fake path still treats them as automatic.
- One approval record per action, bound to: task id, action, **exact diff digest** (SHA-256 over every changed path, content hash, size and exec bit, or "deleted"), base commit, and the generated task branch.
- Refused (BLOCKED, never FAILED): missing, expired, not yet valid, mismatched diff/base/branch/task/action, malformed or tampered record, an approver that looks like an agent, and ambiguity (two valid candidates). Lifetime is capped at 15 minutes.
- **Replay:** consuming creates an exclusive-create marker **before** the Git action, so an approval is spent even if the action then fails, and two racing consumers cannot both win.
- The diff is **re-computed before every gated action**; bytes that changed after review are refused (`Diff changed after it was reviewed`).
- An unapproved run stops with an `approval_required` evidence record carrying the exact digest and file list, so a person knows precisely what to approve. (A resume/continue step is 3B7B2 scope.)
- The Orchestrator receives an `ApprovalGate` that can only `require`; only the `ApprovalStore` can `grant`, and it is never reachable from adapter specs, agent output or events.

**Honest limit — approvals are `UNAUTHENTICATED_LOCAL_APPROVAL`.** They are local files owned by the same user, not signed, and not a trust anchor. They stop the execution agent and mistakes; they do not stop a process that can write that directory. No signing key, permit or attestation exists in this phase, and approval evidence is capped at `RUNTIME_OBSERVED`.

## Container adapter

- Spec is exactly `{ taskId, runId, worktreePath, fixturePath }`; policy, environment, image, command, mounts, network, user and agent name cannot be supplied. The constructor accepts only `{ runtime, scenario, image, limits }`.
- Always `NO_NETWORK`, role `agent`, no environment beyond the fixed `PATH`/`HOME`, the digest-pinned allowlisted image, the existing non-root / read-only-root / `--cap-drop=ALL` / non-recursive-bind configuration, verified by the runtime's strict `docker inspect` readback.
- Outcome mapping: only `completed` + exit 0 + **confirmed cleanup** is success. Timeout, output limit, OOM and non-zero exit are `failed`. An unconfirmed stop, unreadable Docker state or unconfirmed destroy is `unknown`. `cancelled` requires a confirmed stop of the exact container.
- Cleanup runs after every outcome (`finally`) and always targets the exact container id.
- Container output is data: control characters, secret-like text (tokens, keys, bearer headers, private-key markers) and host paths are redacted, line length and event count are bounded, and no agent line can set a grade, kind, approval or file list.
- The Orchestrator admits only the five sandbox evidence kinds at grade `LOCALLY_VERIFIED` (what the runtime's own readback produces); anything else is an unearned claim and BLOCKS the run.

## Security review fixes (Control Plane review 5476501744)

**1. Approvals bind the Git objects that are published (P1).** A worktree-bytes digest was not enough: `git add` can apply clean filters or EOL conversion, and the index can hold other blobs than the worktree. The Docker path now binds every approval to a **Git tree id** (`treeSha`) as well as the diff digest. The reviewer-visible `approval_required` evidence states that tree. The tree is computed independently of the real index, from the approved bytes (Git blob ids, no filters) applied to the base tree in a scratch index (`GIT_INDEX_FILE`, `write-tree --missing-ok`). `WorktreeManager.commitApproved` then: (a) refuses any `filter`, `text`, `eol`, `ident` or `working-tree-encoding` attribute on the approved paths; (b) refuses assume-unchanged, skip-worktree or unmerged index flags on them; (c) requires the index to equal the base tree before staging (no pre-staged content, flagged or not; the index is reset on refusal); (d) stages only the approved paths and requires the **staged tree** to equal the approved tree; (e) commits and requires the **committed tree** to equal it with exactly one commit whose only parent is the base. Before the push and the PR approvals `verifyPublished` re-proves that `HEAD` is that verified commit. The Phase 2 fake path keeps `commit()` unchanged.

**2. Cancellation cannot be overtaken by a launch (P1).** `DockerSandboxRuntime.stop()` and `destroy()` now set a *launch fence* synchronously; `start()` re-checks the fence after its last asynchronous read and before the `docker start` call with nothing asynchronous in between, so a confirmed stop can never be followed by a launch (`CANCELLED_BEFORE_LAUNCH`). If a `docker start` was already issued, `stop()` does not accept "not running" as proof: it polls the exact container (stopping a late-started one) until the launch process has finished, bounded; if it never settles the stop is `UNKNOWN`, not `STOPPED`.

**3. Complete raw execution evidence for the agent role (P2).** The runtime's strict execution readback (identity, integer `ExitCode`, boolean `OOMKilled`, `Running:false`, `Status:exited`, valid ordered `StartedAt`/`FinishedAt`) now applies to the `agent` role as well as `verifier`, in `start()` and `inspect()`. A missing, mistyped or inconsistent fact is `UNKNOWN` (`EXECUTION_READBACK_INCOMPLETE`): no `sandbox_started` evidence is produced, an unknown OOM flag is never written as `false`, and no approval is spent. The adapter also refuses a runtime result that lacks a passing execution check or typed facts.

**Reproducible mutation check.** `node scripts/phase3b7b1MutationCheck.mjs --workers 5 --out docs/evidence/agent-console-phase3b7b1-mutation-results.json` (list: `scripts/phase3b7b1-mutations.json`) applies each exact-text mutation to a private copy, runs the new test files in tiers, and writes the per-mutation raw results (`docs/evidence/agent-console-phase3b7b1-mutation-results.json`). It never touches the working tree, uses only the fake Docker, and exits non-zero on an unexplained survivor. Mutations that survive are listed with the reason they are equivalent.

## Validation (local offline; not CI — this repository has no GitHub CI)

| Suite | Tests | Passed | Failed |
| --- | ---: | ---: | ---: |
| `…3b7b1-approval` (policy, digest, manifest, store, gate) | 19 | 19 | 0 |
| `…3b7b1-container-adapter` (negative security, limits, cancel, cleanup) | 30 | 30 | 0 |
| `…3b7b1-docker-path` (Orchestrator integration, local git, in-memory fake Docker) | 23 | 23 | 0 |
| `…3b7b1-security-fixes` (Git-object binding, cancellation race, raw execution readback) | 21 | 21 | 0 |
| Existing Agent Console suites re-run (phase 2, 3A, 3B2, 3B2.1, 3B3, 3B4; 17 files) | 261 | 261 | 0 |
| `agent-console-phase1.test.mjs` | 1 | 0 | 1 (see below) |

`agent-console-phase1.test.mjs` fails to import `express` because this fresh worktree has no `node_modules` (dependencies were not installed, by instruction). It does not touch any file changed here. The two real-Docker `*.docker.integration.test.mjs` files were **not run**.

**Mutation checks (reproducible):** `scripts/phase3b7b1MutationCheck.mjs` with `scripts/phase3b7b1-mutations.json` (78 exact-text mutations of the approval gate, manifest, container adapter, worktree manager, Orchestrator and sandbox runtime, including counterexamples for the three review findings). Raw per-mutation results from the final run on the committed sources: `docs/evidence/agent-console-phase3b7b1-mutation-results.json`. Result: **74 caught, 4 equivalent, 0 unexplained** (baseline 93/93 green). The four equivalent survivors are redundant layers, each with its reason recorded in the results file: the action-category check beside `GATED_ACTIONS`, the first manifest hard-link check beside the post-open `fstat` check, the one-commit count beside the parents check, and the tree re-check beside the digest re-check (the tree is a pure function of the manifest and base). Earlier runs also exposed real gaps that now have tests (consumed-approval pre-filter, same-size content change, outcome/exit-code inconsistency, missing policy evidence, assume-unchanged versus drift messages).

## Remaining blockers and limits

- **No real Docker was exercised.** The in-memory fake mirrors `docker create` / `inspect` closely, but real daemon behavior (and the Docker Desktop VM) is unverified in this phase.
- **Verification still runs on the host** against the worktree (the Phase 2 runner). That is acceptable only because the guard allows nothing but the fixture file to change; a real agent needs the existing verifier sandbox path.
- **No resume step:** an approval-blocked task stays `BLOCKED` and needs a new "continue after approval" operation.
- **Approvals are unauthenticated local records** (see above); no trust anchor, permit, attestation or signing key.
- **Credentials** for any real agent in a container remain unsolved (PR #22, `NO_SAFE_SUPPORTED_PATH_FOUND`); no real agent image, egress broker or provider network profile exists.
- No route, UI start/stop/approve controls, persistence of approvals beyond the local directory, or cross-process cancel API.

## Suggested 3B7B2 scope

1. Continue-after-approval operation (new state/transition) with persisted pending-approval context.
2. Route the Docker-path verification into the existing verifier sandbox instead of the host runner.
3. Orphan-container reconciliation (label sweep) after a crash, and a cancel API on the Orchestrator.
4. Decide the approval trust model (what, if anything, replaces `UNAUTHENTICATED_LOCAL_APPROVAL`) before any real agent.
5. Only after a Control Plane credential decision: Linux agent qualification (3B7D) — not part of 3B7B2.
