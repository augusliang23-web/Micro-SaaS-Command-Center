# Remove the Assisted-Execution UI (Keep Server Infrastructure) — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-10
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Direct reversal of the "assisted execution" (real AI write-dispatch) UI built earlier the same day (`c3bc290`, `e3087d4`). After walking through what the feature actually lets the owner do today — single-shot, no commit/push, only two whitelisted projects, no back-and-forth — the owner concluded it doesn't add real value over just working directly in Claude Code/Codex CLI, and asked to remove it.

Asked via `AskUserQuestion` how much to remove: only the UI, everything including server infrastructure, or only the newer write-execution half while keeping the older read-only propose demo. The owner chose **UI only** — hide/remove everything the user can see or click, but leave the server-side Bridge V0.4 pipeline (`server/codexHandoffService.mjs`, `server/codexAppServerClient.mjs`, `server/codexHandoffRoutes.mjs`, `src/bridge/codexHandoff.mjs`, their 25+ tests in `test/zero-copy-handoff.test.mjs`) untouched, so it's cheap to resume later if there's ever a concrete use case worth building for.

## What shipped

- **Deleted** `src/components/CodexHandoffPanel.tsx`, `src/components/CodexDispatchStatus.tsx`, `src/hooks/useCodexHandoff.ts` — the frontend components/hook built earlier today specifically for this UI. Judged safe to delete outright (rather than just unlinking them) since they'd be genuinely dead code with zero remaining call sites, and they're small enough to reconstruct from git history if ever needed.
- **`src/components/ProjectDetailDrawer.tsx`** — removed the `<CodexHandoffPanel project={project} />` render call and its import. Nothing else in the drawer changed.
- **`src/components/ChatGPTBridgeModal.tsx`** — removed the "把這個決定變成可執行的計畫" card, its two handler functions (`handleTurnDecisionIntoPlan`, `handleExecuteDecision`), and the now-unused `decisionString` state (it existed only to feed those handlers' objective text; nothing else read it). The modal now ends where it did conceptually before real dispatch existed: get AI advice, read it, close — no action button claiming to do anything further, since there's nothing honest left to offer once the real-dispatch option is gone (bringing back the *old* fake "Sync Decision to Project & Unblock" local-state trick was explicitly not an option — that's the same "looks handled, isn't" pattern this whole redesign has been removing elsewhere).

## What was deliberately NOT touched

- `server/codexHandoffService.mjs`, `server/codexAppServerClient.mjs`, `server/codexHandoffRoutes.mjs`, `src/bridge/codexHandoff.mjs` — the full Bridge V0.4 Zero-Copy Codex Handoff pipeline, including the `WORKSPACE_WRITE_EXECUTION` classification and `write_enabled` allowlist gate added earlier today. Still real, still tested, just currently unreachable from the UI.
- `test/zero-copy-handoff.test.mjs` — all 93 tests (25+ for this pipeline specifically) still pass; none referenced the deleted frontend files.
- `.bridge/codex-projects.local.json` (gitignored) — left as-is with both pilot projects still `write_enabled: true`. Harmless with no UI path to reach it, and cheap to reuse if this is picked back up.
- `server.ts`'s route registration (`app.use('/api/bridge/codex-handoffs', ...)`) — still registered in development mode. The endpoint itself is unreachable in practice now (nothing in the UI calls it), but leaving the registration alone avoids touching `server.ts` for a change that has zero user-visible effect either way.

## Verification

- `npm run lint`, `npm test` (93/93 — unchanged, confirming server-side infrastructure and its tests are untouched), `npm run test:ui` (5/5), `npm run build` all green.
- `grep -rln "CodexHandoffPanel|CodexDispatchStatus|useCodexHandoff"` across `src/` and `test/` — zero remaining references anywhere.
- Manual browser check: opened the Command Center project's drawer with 技術細節 expanded — confirmed no "Native AI Agent handoff" panel renders at all. Opened `ChatGPTBridgeModal`, got real AI advice (unchanged, still works) — confirmed the advice text still displays but no dispatch card or button appears below it.

## Boundaries respected

No changes to `server.ts`, `.env*`, secrets, or the two protected AI-provider routes. `.bridge/codex-projects.local.json` stays gitignored and untouched. Did not add `bridge:ready` or open/modify any GitHub Issue.
