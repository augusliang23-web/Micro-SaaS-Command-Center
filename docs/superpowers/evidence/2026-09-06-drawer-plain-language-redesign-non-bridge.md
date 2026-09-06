# Project Detail Drawer: Plain-Language Redesign — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-06
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout, after a mockup-first design review (see the "Command Center Drawer Mockup" Artifact) and an approved plan (`/Users/augusliang/.claude/plans/atomic-meandering-dragonfly.md`). This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

This is the second screen of the plain-language UI/UX revamp (Portfolio Overview was the first — see `2026-09-06-plain-language-verdict-ui-non-bridge.md` and `2026-09-06-real-github-signal-verdicts-non-bridge.md`). Clicking a Portfolio verdict card previously opened `ProjectDetailDrawer`, which still showed the full original engineering-jargon UI (8-Gate Bridge rail, Execution Context, "1-Click Promote," manual "Approve/Advance Gate" buttons) — the entry point was honest, but drilling in reverted to the old system.

## What shipped

- `src/utils.ts` / `src/types.ts` — extracted `isRealGithubRepo`, `outcomeBadgeStyle`, and the `GithubPullStatus` interface out of `PortfolioOverview.tsx` into shared locations, since `ProjectDetailDrawer.tsx` now needs the same logic. `PortfolioOverview.tsx` updated to import from there instead of its own local copies (no behavior change).
- `src/components/ProjectDetailDrawer.tsx`:
  - Added a `githubState` fetch (`GET /api/github/pull-status`) mirroring the Portfolio card's pattern, refetched whenever the open project changes (`useEffect` keyed on `project?.id`, resetting stale state from the previously-viewed project first).
  - New primary verdict block at the top of the drawer, using the same `getVerdict()`/`getVerdictStyle()` engine and icon set as the Portfolio card, plus two things new to this screen (validated in the mockup review): a "在 GitHub 上查看" link whenever real `prUrl`/`lastCommitUrl` is available, and a small trust badge — green "已通過標準檢查" when the verdict is GitHub-driven and came from a real merge or a clean passing-PR state, amber "直接更新，未經審查" when it came from a direct push that bypassed the PR/review process entirely. This badge question came directly from the owner during mockup review ("那之後我要怎麼區分我是在哪裡主線 or 分支") — the resolution was to not teach branch/main terminology at all, just surface the one plain-language fact that actually matters: was this checked or not.
  - The old Option A/B decision UI is kept verbatim but now only renders when `verdict.source === 'manual' && verdict.level === 'decision'` — it has no equivalent shape for a real GitHub `danger` verdict (failing CI or changes-requested review isn't a "pick one of two options" decision).
  - Everything else (Bridge Gate rail + Gate Inspector incl. the Approve/Advance buttons, Execution Context incl. `CodexHandoffPanel`, Environment & Versioning incl. "1-Click Promote," Feature Delivery Matrix, Activity Timeline) is unchanged internally, just moved behind one new "顯示技術細節" toggle, collapsed by default. Nothing was deleted.
  - Removed the redundant "CI/CD 映射圖" header button (pure jargon); the same modal is still reachable via the existing in-section link once technical detail is expanded.

## Verification

- `npm run lint` (`tsc --noEmit`) — exit 0.
- `npm test` (`node --test test/`) — 81/81 passing, unaffected by this change (no server-side changes this step).
- `npm run test:ui` (`vitest run`) — 5/5 passing.
- `npm run build` — succeeded.
- Manual browser verification: opened `pm-dashboard-uat`'s drawer (real GitHub-linked, merged PR) — verdict block matched its Portfolio card exactly, showed the green trust badge and a working GitHub link, and the collapsed technical detail correctly revealed the unchanged Gate Inspector/Approve/Advance UI underneath. Opened `ProSync`'s drawer (manual/fixture path, decision verdict) — confirmed no trust badge or GitHub link render (correctly, no real repo), the Option A/B decision UI renders under the verdict block, and no duplicate primary action button appears alongside it. No console errors.

## Known gap surfaced during this work (documented, not fixed here)

While designing this screen the owner asked to "walk through the interaction logic between the AI model tools and Command Center again." Investigation of `CodexHandoffPanel.tsx`, `ChatGPTBridgeModal.tsx`, and their server routes found three disconnected mechanisms:
1. `CodexHandoffPanel` — the only *real* automation (dispatches to and polls a local Codex App Server process), but hardcoded to a fixed read-only demo task, not the user's actual problem.
2. `ChatGPTBridgeModal` — makes a real AI-advice call, but its "Sync Decision to Project & Unblock" button only edits local state; nothing reaches a real coding agent.
3. "Copy Context" — fully manual copy-paste.

None of the three lets a user's decision (or a failing-CI verdict) actually reach the AI agent working on the real branch — reads are real (today's GitHub signal work), writes/dispatch are not. The owner explicitly deferred wiring this into a real closed loop to a separate, later phase; it is not addressed in this commit. See `[[project-command-center-plain-language-redesign]]` memory for the follow-up note.

## Boundaries respected

Read-only against GitHub (reuses the existing `/api/github/pull-status` route, no new server endpoints this step). Did not touch `/api/bridge/chatgpt-advice`, `/api/bridge/extract-features`, `/api/bridge/codex-handoffs`, `.env*`, billing, deployment, or secrets. Did not add `bridge:ready` or open/modify any GitHub Issue.
