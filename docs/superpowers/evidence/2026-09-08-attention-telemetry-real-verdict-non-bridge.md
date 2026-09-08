# Needs Attention + AI Execution Snapshot: Plain Language + Real Verdict Data — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-08
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Fifth/sixth screens of the plain-language UI/UX revamp (after Portfolio, Drawer, Next Best Action, Header — all 2026-09-06/08). The two remaining tabs — "待人決策" (`NeedsAttentionQueue`) and "AI 執行與模型遙測" (`AIExecutionSnapshot`) — were still pure English Gate-jargon (`HUMAN_DECISION`, `PRODUCTION_BLOCKER`, ALL-CAPS Gate names, "Luna/Terra/Sol Model" tiles) and were both driven by static fixtures (`initialAttentionItems`, `initialExecutionSnapshot` in `src/mockData.ts`) that never reflected what was actually happening in any project — the same "looks live, isn't" gap already fixed for Portfolio and Next Best Action. The old "Resolve" button on an attention item was a fake local-state removal with no real effect, the same class of problem as the "快速放行" button already removed from Next Best Action.

Asked the owner via `AskUserQuestion` whether to do a text-only reskin or also fix the underlying data source; he chose to do both together. Went through `EnterPlanMode`/`ExitPlanMode` given the scope (5 files, a new shared hook, App-level state changes) before implementing.

## What shipped

- **`src/hooks/useProjectVerdicts.ts` (new)** — extracted the parallel-fetch-then-verdict scan that previously lived only inside `NextBestActionCard.tsx` into a reusable hook: given a project list, fetches `/api/github/pull-status` for every real-repo project in parallel and returns one `getVerdict()` result per project, same order. `NextBestActionCard.tsx` now calls this hook instead of carrying its own copy of the same logic — pure refactor, no behavior change there.
- **`src/App.tsx`** — calls `useProjectVerdicts(projects)` once at the top level and derives, live, on every render: `attentionProjects` (projects whose verdict is `decision` or `danger`), `attentionCount`, `aiRunningCount` (verdict `waiting`), and a `liveSnapshot` object matching the existing `AIExecutionSnapshotData` shape (`waitingForHuman`/`blocked`/`waitingForReview`/`aiRunning` from verdict counts, `lunaTasks`/`terraTasks`/`solTasks` from live `projects.filter(p => p.model === X).length`). These feed both Header pill counts ("待你關注"/"AI 進行中") and both tab badges/content, so all four places now share one real source of truth instead of four independently-stale numbers. The old `attentionItems`/`snapshot` `useState` and their `/api/state` load/save wiring are kept (same treatment as the already-inert `nba` field) purely so `isValidState` in `server/localStateStore.mjs` keeps accepting previously-saved state files — nothing reads them for rendering anymore. Removed the now-dead `setAttentionItems`/`setSnapshot` calls that used to scatter fake local mutations through `handleResolveBlocker` and `handleConnectRepo`, deleted `handleResolveAttentionItem` entirely (no more "Resolve" affordance to back), and deleted the now-unused `handleFocusProjectGate` helper.
- **`src/components/NeedsAttentionQueue.tsx`** — rewritten. Props changed from `{ items: AttentionItem[], onSelectItem, onResolveItem }` to `{ projects: MicroSaaSProject[], onSelectProject }`, matching `PortfolioOverview`/`NextBestActionCard`. Renders one `ProjectVerdictCard` per project — full visual reuse, no new card design. Plain-language header ("需要你決定或處理的專案") and empty state ("太好了，目前沒有需要你處理的事"). No "Resolve" button: a `decision`/`danger` verdict now only clears by the user actually acting on it through the card's action button into the drawer, not by a queue-level fake dismiss.
- **`src/components/AIExecutionSnapshot.tsx`** — wording-only pass (no prop/behavior change; still receives an `AIExecutionSnapshotData`-shaped object, now computed live instead of fixture-held). Section title → "AI 目前在忙什麼", "Model Tiers Info" → "AI 模型分級說明", the four workflow-state tiles → "需要你決定" / "可以繼續了" / "AI 卡住了" / "AI 執行中" with plain-language one-liners, and the Luna/Terra/Sol tier tiles' jargon subtitles ("Docs, Lint, Config" etc.) rewritten in Chinese. Tier names themselves (Luna/Terra/Sol) kept — product's own branding, not vendor wording.

## Verification

- `npm run lint` (`tsc --noEmit`) — exit 0.
- `npm test` (`node --test test/`) — 85/85 passing (no test referenced the removed `AttentionItem` rendering path or `handleResolveAttentionItem`).
- `npm run test:ui` (`vitest run`) — 5/5 passing.
- `npm run build` — succeeded.
- Manual browser verification (dev server, real fixture + real-repo project mix):
  - "待人決策" tab correctly showed exactly the 3 projects with `decision`/`danger` verdicts (ProSync, FormFlow Engine, AuthKit Micro) rendered as full `ProjectVerdictCard`s with working action buttons into the drawer, plain-language header, no dead Resolve button.
  - "AI 執行與模型遙測" tab's four state tiles summed to 8 (all projects) and exactly matched the independently-computed tab-badge/header-pill counts: 需要你決定=1, 可以繼續了=3, AI 卡住了=2, AI 執行中=2.
  - Header's "待你關注 (3)" / "AI 進行中 (2)" pills matched the two tabs' own counts exactly — single source of truth confirmed, no more of the previous four-independently-stale-numbers problem.
  - `read_console_messages` — no errors beyond the pre-existing, unrelated Vite HMR WebSocket noise.

## Known gaps / deliberately out of scope

- `AttentionItem`/`AttentionCategory` types (`src/types.ts`) and `initialAttentionItems`/`initialExecutionSnapshot` (`src/mockData.ts`) are left in place, unused by any component now, kept only because `attentionItems`/`snapshot` state still needs a type for the backward-compatible persisted-shape fields. A full removal would touch `server/localStateStore.mjs`'s validation contract and is a separate, lower-priority cleanup — same tradeoff already accepted for `NextBestAction`/`nba`.
- `useProjectVerdicts` at the App level, `NextBestActionCard`, and each `ProjectVerdictCard` on the Portfolio tab still each do their own independent GitHub scan rather than sharing one fetch — a known, previously-accepted duplicate-fetch tradeoff, now with one more caller. No runaway-fetch issue observed in manual testing (`read_network_requests` showed bounded, successful calls).
- `lunaTasks`/`terraTasks`/`solTasks` counts reflect the `model` field already on each project — a manually-set/simulated value (see `[[project-command-center-plain-language-redesign]]`), not something derivable from real GitHub state. Making the counts "live" here means live-relative-to-current-projects-state, not GitHub-verified.

## Boundaries respected

No changes to `server/`, `.env*`, `/api/bridge/*` routes, billing, deployment, or secrets. No change to `server/localStateStore.mjs`'s validation contract. Did not add `bridge:ready` or open/modify any GitHub Issue.
