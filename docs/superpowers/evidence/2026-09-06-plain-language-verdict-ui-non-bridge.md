# Plain-Language Verdict UI: Real Implementation — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-06
**Authorization:** Direct chat instruction from the repository owner (augusliang23@gmail.com), reached through an EnterPlanMode → ExitPlanMode cycle in this same interactive session (plan saved at `/Users/augusliang/.claude/plans/curious-cooking-fairy.md`), followed by an explicit "直接開始接進真正的 React 專案" go-ahead once the standalone mockup Artifact was approved. Same non-Bridge/Issue authorization basis as the rest of this session — see `docs/superpowers/evidence/2026-09-05-github-repo-connect-live-data-non-bridge.md` and `2026-09-05-prototype-provenance-guardrails-partial-non-bridge.md` for the established precedent. Not attributed to any GitHub Issue; no `bridge:ready`.

## What this is

Implements the plain-language redesign decided earlier in this session (see memory `project-command-center-plain-language-redesign`): Command Center's Portfolio Overview no longer leads with engineering vocabulary (Gate names, PR/CI/Review references, model-routing labels). Each project now shows one of four deterministic, rule-based verdicts with plain-language copy and one action button; the previous jargon-forward detail is demoted to an expandable "技術細節" section, not removed.

## Files

- `src/verdict.mjs` (new) — pure `getVerdict(project)` / `getVerdictStyle(level)`, same shape as `src/statusProvenance.mjs`. Rule table: `waitingState === 'BLOCKED'` → danger; `WAITING_FOR_HUMAN` + `blocker` → decision; `WAITING_FOR_HUMAN` + no `blocker` → ready; otherwise (`AI_RUNNING`/`AUTOMATION_IDLE`) → waiting.
- `test/verdict.test.mjs` (new) — 6 Node built-in tests covering all four verdict branches and the style fallback.
- `src/components/PortfolioOverview.tsx` — replaced the dual table/card-grid jargon-forward views with a single verdict-card list (`ProjectVerdictCard`); removed the view-mode toggle and the Stage→Prod upgrade-arrow indicator from the default view (moved into the expandable technical-detail section alongside Gate/PR/Test/Review/Model badges).

## Known, deliberate limitation

`getVerdict`'s `explanation` field falls back to the project's existing `blocker` / `nextAction` free text, which was originally authored for an engineering audience and can still read as somewhat technical (e.g. "Missing STRIPE_WEBHOOK_SECRET in staging runtime"). A pure rule table cannot rewrite arbitrary free text into plain language without an AI call, which this phase intentionally avoids per the owner's explicit choice (rule-based, not live-AI, for cost/latency/governance reasons). Fully plain-language explanations for every scenario would require either hand-authoring `blocker`/`nextAction` copy in plain language at the source, or a later AI-assisted phase — both out of scope here.

## Verification

- `npm run lint` (`tsc --noEmit`) — exit 0.
- `npm test` (`node --test test/`) — 60/60 passing (54 pre-existing + 6 new verdict tests).
- `npm run test:ui` (`vitest run`) — 5/5 passing (unchanged; no new component tests added for `PortfolioOverview` in this pass).
- `npm run build` — succeeded.
- Manual browser verification: all 8 projects (6 fixtures + 2 connected via `ConnectRepoModal`) render the correct verdict for their `waitingState`/`blocker` combination; the "技術細節" toggle expands/collapses per card independently and shows the correct Gate/PR/Test/Review/Model values; the card's primary action button and the expanded "開啟完整專案詳情" link both still open `ProjectDetailDrawer` correctly (unchanged `onSelectProject` wiring); no console errors.

## Boundaries respected

No changes to `server.ts`, `.env*`, GitHub integration, authentication, billing, or deployment. No Issue opened, no `bridge:ready` added, nothing merged/deployed. Changes remain uncommitted pending the owner's review.
