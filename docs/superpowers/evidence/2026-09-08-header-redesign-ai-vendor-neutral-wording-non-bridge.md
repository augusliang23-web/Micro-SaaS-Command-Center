# Header Redesign + App-Wide AI-Vendor-Neutral Wording — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-08
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Fourth screen of the plain-language UI/UX revamp (after Portfolio Overview, Project Detail Drawer, and Next Best Action, all completed 2026-09-06/08). The owner asked to continue with the header (`CockpitHeader.tsx` — still showed a "ChatGPT ↔ Codex Bridge Operations" tagline and always-visible "Luna / Terra / Sol" / "CI/CD 流程圖" jargon buttons) and, in the same request, to remove the app's dependence on naming specific AI vendors ("ChatGPT," "Codex") throughout, since the owner may use different AI models going forward. A repo-wide search found this touched far more than the header — 110 mentions across 13 files, including two large explanatory surfaces (`CiCdWorkflowModal.tsx`, `FeatureDeliveryMatrix.tsx`'s AI-advisor-sync tab). The owner explicitly chose, via `AskUserQuestion`, to do everything in one pass rather than scoping to user-facing surfaces only.

## What shipped

**Header (`src/components/CockpitHeader.tsx`)** — rewritten to match the same "zero jargon by default, technical detail behind an explicit toggle" pattern used on every prior screen. Dropped the "v1.0 Cockpit" badge and vendor tagline in favor of a plain "AI 協作作業中 · Live Sync" status line. Moved the "Luna / Terra / Sol" and "CI/CD 流程圖" buttons out of the always-visible row into a new collapsible "技術細節" panel (chevron toggle, same visual language as every other technical-detail affordance in the app).

**App-wide AI-vendor-neutral wording sweep** — applied one consistent vocabulary substitution across 13 files:

| Original | Replacement |
|---|---|
| "ChatGPT" (advisory/PRD role) | AI 顧問 (AI Advisor) |
| "Codex" (coding/execution role) | AI 代理 (AI Agent) |
| "ChatGPT ↔ Codex Bridge" / "ChatGPT Bridge" | AI 協作流程 |
| "Discuss in ChatGPT" | 請 AI 顧問討論 |
| "Google AI Studio" | AI 原型工具 |
| `'Codex (Terra/Sol/Luna)'` (activity author) | `'AI (Terra/Sol/Luna)'` |
| "Google AI Studio" mock flavor text | AI Prototyping Tool |

Left unchanged, deliberately: "GitHub"/"GitHub Actions" (a real third-party tool, not an AI model); the product's own branding — "Bridge," "Command Center," "Luna/Terra/Sol" tier names; and every internal code identifier (`ChatGPTBridgeModal.tsx`/`ChatGPTBridgeModalProps`, `CodexHandoffPanel.tsx`/`CodexHandoffStatus`/`runWithCodex`, the `CodexModelName` type, `/api/bridge/chatgpt-advice` and `/api/bridge/codex-handoffs` route paths) — none of these are visible during actual use, and renaming them would be pure churn with real risk and no user-visible benefit. Only displayed text, plus `ActivityItem.author`'s string-literal union (its values are directly rendered), changed.

Files touched: `src/components/CockpitHeader.tsx`, `ChatGPTBridgeModal.tsx`, `CodexHandoffPanel.tsx`, `ProjectDetailDrawer.tsx`, `BridgeWorkflowRail.tsx`, `ModelRoutingGuide.tsx`, `ConnectRepoModal.tsx`, `SelectiveReleaseModal.tsx`, `CiCdWorkflowModal.tsx` (~790 lines of pipeline-stage cards, comparison table, and 4 iteration-scenario narratives), `FeatureDeliveryMatrix.tsx`, `src/App.tsx`, `src/types.ts`, `src/mockData.ts`.

## Verification

- `npm run lint` (`tsc --noEmit`) — exit 0.
- `npm test` (`node --test test/`) — 85/85 passing.
- `npm run test:ui` (`vitest run`) — 5/5 passing.
- `npm run build` — succeeded.
- `grep -rln "ChatGPT\|Codex" src/` — only the deliberately-out-of-scope internal identifiers listed above remain; zero user-facing copy left.
- Manual browser verification (dev server, real project data):
  - Header renders with the plain tagline and no vendor naming by default; the new "技術細節" toggle correctly reveals "CI/CD 流程圖" and "Luna / Terra / Sol" buttons.
  - Opened FormFlow Engine's Project Detail Drawer — "請 AI 顧問討論" button present and correctly labeled; drawer's "技術細節" section shows "Native AI Agent handoff" / "Run with AI Agent" (from `CodexHandoffPanel`) rendering correctly.
  - Opened the AI-advisor modal (`ChatGPTBridgeModal`) — title reads "AI 顧問即時協作," button reads "Ask AI Advisor for Advice," and the inline instruction text matches, with no leftover "ChatGPT" wording.
  - Opened `CiCdWorkflowModal` and read through the 3-phase pipeline cards, the Bridge-vs-legacy-CI/CD comparison table, and Scenario A ("重大改版") and Scenario C ("線上 Hotfix") of the 4 iteration narratives — all read as natural Chinese prose using "AI 顧問"/"AI 代理" consistently, not a mechanical find-and-replace.
  - `read_console_messages` — no errors beyond the pre-existing, unrelated Vite HMR WebSocket noise.

## Known gaps / deliberately out of scope

- Locally-persisted `data/app-state.json` (gitignored runtime state from an earlier session, predating this change) still contains a few stale strings written before this sweep — e.g. FormFlow Engine's blocker text ("...Codex paused before execution") and its gate label ("Codex Implementation"), and one activity-timeline entry's author ("Codex (Sol)"). This is expected: persisted data doesn't retroactively pick up new `mockData.ts` fallback defaults, and it is not a source-code bug. It self-heals whenever that project's real data is next written, or clears if the local state file is deleted.
- The *structure and jargon density* of `CiCdWorkflowModal.tsx` and `FeatureDeliveryMatrix.tsx` beyond vendor-naming was not redesigned this phase — only the vendor-specific wording within their existing (still fairly technical) content was genericized. A plain-language redesign of these two surfaces' content, if wanted, remains a separate future step.
- `NeedsAttentionQueue` and `AIExecutionSnapshot` — the two remaining screens with Gate-era jargon — have not been touched; not started without the owner asking, per this session's established one-screen-at-a-time cadence.

## Boundaries respected

No changes to `server/`, `.env*`, `/api/bridge/*` routes, billing, deployment, or secrets. Did not add `bridge:ready` or open/modify any GitHub Issue. All changes are display-text and one component's layout only — no logic, data-fetching, or persistence changes.
