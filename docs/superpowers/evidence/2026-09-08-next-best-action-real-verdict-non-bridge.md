# Next Best Action Card: Real Verdict Scan Replaces Hardcoded Fixture — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-08
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Third screen of the plain-language UI/UX revamp (after Portfolio Overview and Project Detail Drawer, both 2026-09-06). The owner asked to continue; investigation of the two remaining hero-card candidates (`CockpitHeader`, `NextBestActionCard`) found `NextBestActionCard` was still entirely disconnected from the day's real-verdict work — it rendered a single hand-authored `NextBestAction` fixture (`initialNextBestAction` in `src/mockData.ts`) that never changed regardless of what was actually happening in any project, and its "快速放行" (quick approve) button was another instance of a fake, local-state-only action — the same class of problem already fixed in Portfolio and the Drawer.

## What shipped

- `src/verdict.mjs` — new `pickMostUrgent(verdicts)`: given an array of verdicts (one per project), returns the index of the most urgent by a fixed rank (`decision` > `danger` > `ready` > `waiting`; ties keep first occurrence). `decision` ranks highest because it is the one level only a human can resolve; `danger` next because it may still self-resolve on an AI retry.
- `src/components/ProjectVerdictCard.tsx` (new) — extracted verbatim from `PortfolioOverview.tsx` (no behavior change) into its own file so it can be reused by both the Portfolio list and the new Next Best Action card, plus one new optional `eyebrow` prop for a small label above the card (e.g. "🎯 在 8 個專案中，這個最需要你注意").
- `src/components/PortfolioOverview.tsx` — now imports `ProjectVerdictCard` instead of defining it locally; no rendering change.
- `src/components/NextBestActionCard.tsx` — rewritten. Old props (`nba`, `attentionCount`, `onExecute`, `onSimulateApprove`) replaced with `projects` and `onSelectProject`. Fetches real GitHub PR/CI state for every real-repo project in parallel, computes a verdict per project via the existing `getVerdict()`, picks the top one via `pickMostUrgent()`, and renders it with `ProjectVerdictCard` — the exact same component and visual language as a Portfolio card, just with the eyebrow label. Shows a skeleton while the scan is in flight; renders nothing if there are no projects.
- `src/App.tsx` — updated the `<NextBestActionCard>` call site accordingly. Removed `handleSimulateApproveNBA` (the fake-approve handler, now unreachable since its only caller — the removed button — is gone). Left the `nba`/`setNba` state and its `/api/state` load/save round-trip in place, with a comment explaining it's kept only so previously-saved state files keep validating against `isValidState`'s shape — not because anything still renders from it. Deliberately did **not** touch `server/localStateStore.mjs`'s validation contract or `initialNextBestAction`/`NextBestAction` in this pass, to avoid a persistence-schema migration that's a separate concern from this screen's redesign.

## Verification

- `npm run lint` (`tsc --noEmit`) — exit 0.
- `npm test` (`node --test test/`) — 85/85 passing (81 prior + 4 new `pickMostUrgent` tests).
- `npm run test:ui` (`vitest run`) — 5/5 passing.
- `npm run build` — succeeded.
- Manual browser verification: with 8 projects loaded (6 fixtures + 2 real repos), the card correctly surfaced ProSync (a manual-path `decision` verdict) as "🎯 在 8 個專案中，這個最需要你注意", outranking every `ready`/`waiting` real-GitHub-driven project. Clicking its action button opened ProSync's drawer with the same decision UI verified in the prior Drawer step. Confirmed via `read_network_requests` that `/api/github/pull-status` calls stayed bounded (no runaway fetch loop) and all returned `200 OK`; no console errors.

## Known gaps / deliberately out of scope

- `NextBestActionCard` does its own independent GitHub-state scan rather than sharing already-fetched state with the Portfolio cards below it — a minor duplicate-fetch cost accepted to avoid a bigger "lift state to App.tsx" refactor, consistent with the same tradeoff already accepted in the Drawer step.
- The `nba` field in `/api/state`'s persisted JSON and `isValidState`'s shape check are unchanged and now effectively inert (loaded and saved, never rendered) — a full removal would touch `server/localStateStore.mjs` and its tests, deliberately deferred as a separate, lower-priority cleanup.
- `CockpitHeader` (top nav/branding: "ChatGPT ↔ Codex Bridge Operations," "Luna / Terra / Sol" button, "CI/CD 流程圖" button) has not been touched — still the next candidate screen in the one-at-a-time revamp.

## Boundaries respected

Read-only against GitHub (reuses the existing `/api/github/pull-status` route, no new server endpoints this step). Did not touch `/api/bridge/*`, `.env*`, billing, deployment, or secrets. Did not add `bridge:ready` or open/modify any GitHub Issue.
