# ChatGPTBridgeModal: Wire "Apply Decision" to Real Dispatch — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-10
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Second of three things the owner asked to do in one pass after the 2026-09-09 write-execution milestone: (1) wire `ChatGPTBridgeModal`'s fake "apply decision" to the same real Propose → human review → Execute pipeline `CodexHandoffPanel` already has, (2) open the real write-execution pilot to a second project, (3) restructure `CiCdWorkflowModal`/`FeatureDeliveryMatrix` beyond wording. This record covers (1) and (2); (3) follows separately.

Went through `EnterPlanMode` given the design decisions involved (does this touch the *other* decision entry point too? does completing an Execute silently advance fake gate state again?).

## Item 2: pm-dashboard-uat added to the write-execution pilot

`.bridge/codex-projects.local.json` (gitignored, not committed) now has a second entry for `proj-pm-dashboard-uat-6841` (`augusliang23-web/pm-dashboard-uat`), `write_enabled: true`. Finding the right `cwd` needed real investigation, not a guess: the machine has multiple local clones of this repo (`~/Developer/augusliang23-web/pm-dashboard-uat`, `~/Developer/workspaces/pm-dashboard-uat`, plus several `-recovery`/`-snapshot` folders from what looks like a past incident). Asked the owner directly rather than picking one — he pointed to a freshly-recreated clean clone, `~/Developer/workspaces/pm-dashboard-uat-main`, confirmed via `git remote -v`/`git log` to be the correct repo with the most recent activity (commit 2026-09-08, clean working tree).

## Item 1: design

`ChatGPTBridgeModal`'s "Sync Decision to Project & Unblock" button previously only called `onApplyResolution` → `App.tsx`'s `handleResolveBlocker`, which edits local state to fake-advance the manual Gate pipeline (sets `currentGate: 'APPROVE'`, claims `nextAction: '1-click Merge PR & release to UAT'`) — exactly the "looks handled, isn't" pattern the rest of this app's redesign has been removing.

**Scope decision, made explicit in the plan:** `ProjectDetailDrawer.tsx` has a *second* decision entry point — the inline "請選一個做法" Option A/B radio UI — that calls the same `onResolveBlocker` handler. Left it and `handleResolveBlocker` completely untouched, because that UI is structurally gated to `verdict.source === 'manual' && verdict.level === 'decision'`, and `verdict.mjs` documents that the `'decision'` level can *only* ever come from the manual/fixture path — GitHub has no equivalent "needs a product decision" signal. So that inline UI can, by construction, never appear for a real write-enabled project; wiring it to real dispatch would always 403 with "not in allowlist" and add no real capability, just churn. `ChatGPTBridgeModal`, by contrast, opens from an unconditional header button available on every project including real, write-enabled ones — that's the integration point that actually matters.

## What shipped

- **`src/hooks/useCodexHandoff.ts`** (new) — extracted the propose/execute/poll mechanics out of `CodexHandoffPanel.tsx` into a reusable hook, generalized so callers supply their own objective/scope/acceptance-criteria/context-refs instead of the hook hardcoding one fixed shape (same "used twice → extract" reasoning as `useProjectVerdicts`). Accepts `MicroSaaSProject | null` since `ChatGPTBridgeModal` can be open with no project selected.
- **`src/components/CodexDispatchStatus.tsx`** (new) — the shared status/plan/execute-button/result presentational block, pulled out of `CodexHandoffPanel.tsx`'s JSX so both call sites render identically instead of duplicating ~60 lines of markup.
- **`src/components/CodexHandoffPanel.tsx`** — refactored to use the new hook + shared component. Pure refactor: same labels, same behavior, verified via a live regression dispatch.
- **`src/components/ChatGPTBridgeModal.tsx`** — the fake "Sync Decision to Project & Unblock" card is replaced with an honest one: "把這個決定變成可執行的計畫" / "請 AI 依照這個決定提出具體的改動計畫（唯讀，不會先動手）；你看過計畫、按下核准後才會真的執行。" Clicking "請 AI 把決定變成計畫" dispatches a real `READ_ONLY_REPOSITORY_INSPECTION` Propose whose objective embeds the actual `decisionString` (the AI advisor's recommendation) plus the project's real `currentTask`/`blocker`. The resulting plan renders via `<CodexDispatchStatus>`; only a human clicking "核准並執行" triggers the real `WORKSPACE_WRITE_EXECUTION` Execute. The `onApplyResolution` prop is removed entirely — the modal now owns its own real dispatch state instead of calling back into `App.tsx`'s fake handler. The old copy claiming an automatic "unblock ... advance gate to APPROVE" outcome is gone, since nothing advances automatically anymore.
- **`src/components/ProjectDetailDrawer.tsx`** — one-line change: drops the now-nonexistent `onApplyResolution={onResolveBlocker}` prop from the `<ChatGPTBridgeModal>` call site. Everything else (the inline Option A/B UI, `onResolveBlocker`, `handleResolveBlocker`) is untouched, per the scope decision above.

## Verification

- `npm run lint`, `npm test` (93/93), `npm run test:ui` (5/5), `npm run build` all green. No existing test referenced either component, so no test updates were needed.
- Manual, live, end-to-end against the real pipeline (not just the refactor compiling):
  - Regression-checked `CodexHandoffPanel` on the Command Center project after the hook/component extraction — Propose still dispatches for real and polls correctly (confirmed via `read_network_requests`, distinct handoff id, 200 OK throughout).
  - Opened `ChatGPTBridgeModal` on the same write-enabled project, got AI advice, clicked the new button — confirmed via network inspection a **second, independent** real dispatch fired concurrently (`task_id` suffix `decision-propose`, distinct `handoff_id`, both running side by side without interfering), reached `COMPLETED` with a real ~2500-character plan, and the "核准並執行" Execute box appeared. Did not click Execute during this verification pass, for the same reason established 2026-09-09 — that decision belongs to a human reviewing the actual plan, not an automated check.
  - Opened the same modal on ProSync (not in the allowlist at all) and confirmed clicking the button surfaces the honest, existing rejection — "Target project is not in the server-side allowlist" — instead of any fake success.
  - Noted a batch of stale `502`/WebSocket-failure console entries during verification; traced them to leftover artifacts from this long-lived browser tab surviving multiple dev-server restarts over the prior ~22 hours, not a live issue — confirmed by `read_network_requests` showing zero errors in the current request window and the feature working correctly end-to-end.

## Known gaps / deliberately out of scope

- The AI-advice fallback content in `server.ts`'s `/api/bridge/chatgpt-advice` local-fallback path is hardcoded to one fictional ProSync CSV-duplicate-email scenario regardless of which project's modal is actually open — a pre-existing rough edge noticed but not fixed this round (touching that fallback text again means touching `server.ts`, which needs its own scoped authorization per project convention, and wasn't what was asked).
- After a real Execute completes, nothing updates the project's `blocker`/`currentGate`/`waitingState` fields — deliberate, not an oversight: auto-advancing that local state again would reintroduce the exact "local state claims more progress than actually happened" problem this change exists to remove. Real progress should surface through the existing real-GitHub-verdict system once a human reviews, commits, and pushes the AI's changes themselves.
- Every project except the two pilots (Command Center, pm-dashboard-uat) still gets an honest "not in allowlist" rejection from this new button, same as `CodexHandoffPanel` already behaves.

## Boundaries respected

No changes to `server.ts`, `/api/bridge/chatgpt-advice`'s actual logic, `.env*`, secrets, or the two protected AI-provider routes' request/response contracts. `.bridge/codex-projects.local.json` stays gitignored, never staged. Did not add `bridge:ready` or open/modify any GitHub Issue.
