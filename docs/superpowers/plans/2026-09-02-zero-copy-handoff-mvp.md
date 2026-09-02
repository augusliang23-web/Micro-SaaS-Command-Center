# Bridge V0.4 Zero-Copy Codex Handoff MVP Implementation Plan

> **For Codex:** Execute this plan test-first in the isolated worktree. Stop at `READY_FOR_REVIEW`.

**Goal:** Add the smallest local-only path from the Command Center project drawer to a real Codex App Server task.

**Architecture:** A pure contract/gating layer feeds an in-memory handoff service. The service resolves a server-side repository allowlist and delegates to an injected App Server client. Express exposes two protected local-development endpoints, and a small React panel dispatches and polls status.

**Tech Stack:** Node built-ins, existing Express/React/Vite/TypeScript dependencies, Codex App Server over JSONL stdio.

---

### Task 1: Lock the contract and security boundary with failing tests

**Files:**
- Create: `test/zero-copy-handoff.test.mjs`
- Create: `src/bridge/codexHandoff.mjs`
- Create: `server/codexHandoffService.mjs`

1. Test all required handoff fields and prohibited-action preservation.
2. Test PAUSED, missing authority, wrong target, disallowed risk, and non-allowlisted repository failures.
3. Test active duplicate idempotency and documented restart limitation.
4. Test provider event to normalized-state mapping, including approval to `AWAITING_INPUT`.
5. Run the focused test and confirm the new assertions fail before implementation.

### Task 2: Implement the native App Server protocol client

**Files:**
- Create: `server/codexAppServerClient.mjs`
- Test: `test/zero-copy-handoff.test.mjs`

1. Test the exact `initialize → initialized → account/read → thread/start → turn/start` sequence.
2. Test `codex app-server` invocation with an argv vector and `shell: false`.
3. Test ChatGPT-only account enforcement, no credential fields, read-only sandbox, and approval preservation.
4. Test streamed status, agent output, completion, errors, and unresolved approval requests.
5. Implement the smallest JSONL RPC client that satisfies the tests.

### Task 3: Add fail-closed local endpoints

**Files:**
- Create: `server/codexHandoffRoutes.mjs`
- Create: `.bridge/codex-projects.local.json.example`
- Modify: `.gitignore`
- Modify: `server.ts`
- Test: `test/zero-copy-handoff.test.mjs`

1. Test development-only enablement, exact local origin, JSON-only POST, server-side allowlist, and production failure.
2. Mount `POST /api/bridge/codex-handoffs` and `GET /api/bridge/codex-handoffs/:handoffId` only through the protected router.
3. Bind to `127.0.0.1` and preserve unrelated provider endpoints unchanged.
4. Keep real local allowlist paths untracked.

### Task 4: Add the minimum Command Center UI

**Files:**
- Create: `src/components/CodexHandoffPanel.tsx`
- Modify: `src/components/ProjectDetailDrawer.tsx`

1. Add a single explicit `Run with Codex` action in Execution Context.
2. Dispatch a fixed read-only inspection request for the selected allowlisted project.
3. Poll only while active and display all required status fields.
4. Stop polling on terminal or input-required state.
5. Do not redesign unrelated UI or reuse the protected AI endpoints.

### Task 5: Verify and deliver

1. Run focused Node built-in tests.
2. Run full `node --test`, lint, and build.
3. Run a real browser-initiated read-only smoke with ChatGPT login and compare repository state before/after.
4. Run `git diff --check` and inspect the exact diff.
5. Request an independent findings review and apply only in-scope fixes.
6. Commit, push `codex/v0.4-zero-copy-handoff-mvp`, and open a PR targeting `main`.
7. Record validation, limitations, capability gaps, routing audit, and explicit exclusions in the PR.
8. Do not merge, approve, deploy, release, or start follow-on scope. Stop at `READY_FOR_REVIEW`.
