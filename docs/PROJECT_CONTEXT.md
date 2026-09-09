# Project Context

Personal tool: a status/progress dashboard for tracking Augus's own fleet of
vibe-coding side projects (ProSync, pm-dashboard, ToP, TeraHive tools, this
project itself, etc.), with an AI-agent orchestration layer modeled on his
day-job PM instincts (gates, milestones, blockers, next-best-action).

This file is product/architecture context — tech stack, data model, and
roadmap. Governance (what an AI agent may execute, and under what
authorization) lives in `CLAUDE.md` at the repo root and is intentionally
kept separate from this file.

## Tech stack

- Frontend: React 19 + Vite 6 + Tailwind v4 + Framer Motion, TypeScript
- Backend: Express (`server.ts`), TypeScript
- AI: `@google/genai` (Gemini), originally scaffolded via Google AI Studio
- Package manager: **npm** (`package-lock.json`, `packageManager: npm@10.8.2`
  in `package.json`). Migrated off Bun; `bun.lock` has been removed.
- Testing: `node --test test/` (`npm test`) for server/logic-level tests;
  `vitest` + `jsdom` + `@testing-library/react` (`npm run test:ui`,
  configured in `vitest.config.ts`) for React component tests — added
  2026-09-05 alongside `src/statusProvenance.mjs`.
- Originally developed via Codex (ChatGPT Codex Bridge); Claude Code now also
  executes tasks directly in this repo, under the boundaries in `CLAUDE.md`.

## Data model (`src/types.ts`)

Core entity is `MicroSaaSProject` — one nested object per tracked project:
- `gates: GateStepInfo[]` — a 13-step Bridge Gate pipeline: DISCUSS →
  SPECIFY → SPECIFY_UX → PROTOTYPE → PROTOTYPE_REVIEW → APPROVE_UI →
  SPECIFY_TASK → ROUTE → IMPLEMENT → TEST → REVIEW → APPROVE → DONE
- `environment` — production / staging / uat status, each with its own
  deploy state
- `executionContext` — which AI agent model handled the work
  (`CodexModelName`: Luna / Terra / Sol — this product's own three-tier
  model-routing labels, conceptually analogous to Haiku/Sonnet/Opus, but
  this is a product design question, not yet decided whether to rename in
  the UI)
- `features?: FeatureItem[]` — feature delivery matrix with flags
- `activityHistory: ActivityItem[]` — audit log
- Separate top-level lists: `AttentionItem[]` (needs-human-decision queue),
  `NextBestAction[]` (recommended next step per project)

This is a deeply nested, document-shaped model by design — it maps directly
onto both a single JSON file (Phase 1, current) and Firestore (Phase 2
target) without normalization. Don't normalize this into relational tables.

## Persistence

**Phase 1 (current, done):** a single local JSON file
(`data/app-state.json`, gitignored), written by the Express server:
- `server/localStateStore.mjs` — `readState()` / `writeState()`, with
  `isValidState()` shape-checking every write before it touches disk.
- `server/stateRoutes.mjs` — `GET /api/state`, `PUT /api/state`, guarded by
  a loopback-origin check (same pattern as `codexHandoffRoutes.mjs`); a
  non-loopback browser `Origin` gets `403`.
- `src/App.tsx` loads from `/api/state` on mount (falls back to
  `mockData.ts` if no saved state exists yet) and debounce-saves on change.
- Test coverage: `test/local-state.test.mjs` (`npm test`).

**Explicit security limits of this design** — it is single-machine,
single-user, loopback-only:
- No authentication — anything that can reach `127.0.0.1`/`localhost` on the
  server's port can read or overwrite the entire dashboard state.
- No multi-user isolation, no audit trail of who changed what, no schema
  versioning/migration path beyond `isValidState`'s basic shape check.
- Not suitable to expose beyond loopback, and not intended to be — this is a
  personal-use stopgap, not a production data store.

**Phase 2 (deferred, not yet started):** migrate to **Firestore** — decided
2026-09-05 that Firestore is unnecessary complexity for Phase 1 (personal,
single-machine use: cloud account, network dependency, auth surface, none of
which Phase 1 needs). Firestore stays the Phase 2 target once real
multi-session/multi-device usage is needed — the document-shaped data model
above was chosen so this migration doesn't require reshaping data, only
swapping the storage layer behind the same `MicroSaaSProject[]` shape.

## Current known gaps (as of 2026-09-05)

1. ~~`ConnectRepoModal.tsx` is fully mocked~~ **done (2026-09-05)** —
   `GET /api/github/repos` (`server/githubRoutes.mjs`) now shells out to the
   machine's already-authenticated `gh` CLI and returns real repositories;
   the token never reaches the browser. See
   `docs/superpowers/evidence/2026-09-05-github-repo-connect-live-data-non-bridge.md`.
2. Only two endpoints actually call an AI model:
   `/api/bridge/chatgpt-advice` and `/api/bridge/extract-features`.
   Everything else is static UI (`/api/state` persists UI state, it does not
   call a model).
3. `.env*` is correctly gitignored (only `.env.example` committed) — no
   leaked secrets as of last check. Keep it that way.
4. `mockData.ts` currently contains Augus's real project names/status
   (ProSync, pm-dashboard, etc.) — must be genericized before this repo is
   shared publicly as a template (see Phase 1).
5. **Partially done (2026-09-05):** every project now carries project-level
   `provenance` (`src/statusProvenance.mjs`, `src/types.ts`) and a persistent
   "Simulated / Prototype" banner + badges make clear that gate/environment/
   execution-context state is local Prototype simulation, not a real GitHub/
   CI/deployment sync. Still open: per-gate-step/per-feature-item provenance,
   full modal accessibility (focus trap, Escape, ARIA dialog roles), and a
   `VITE_PROTOTYPE_SAFE_MODE` flag to disable the two AI-calling endpoints
   during frontend-only verification. See
   `docs/superpowers/evidence/2026-09-05-prototype-provenance-guardrails-partial-non-bridge.md`
   and `docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md`.
6. **Done (2026-09-06):** Portfolio Overview's default view is now a
   plain-language "verdict" card per project (`src/verdict.mjs`,
   `src/components/PortfolioOverview.tsx`) instead of the 8-Gate
   Bridge/PR/CI jargon table — driven by the owner (who has no software
   engineering background himself) not being able to reliably judge
   engineering states either. For projects connected to a real GitHub repo,
   the verdict is now driven by real, live-queried PR/CI/review signals
   (`server/githubPullStatus.mjs`, `GET /api/github/pull-status`), not
   manual clicking; fixture/demo projects fall back to the old manually-set
   `waitingState`/`blocker` fields. See
   `docs/superpowers/evidence/2026-09-06-plain-language-verdict-ui-non-bridge.md`
   and `docs/superpowers/evidence/2026-09-06-real-github-signal-verdicts-non-bridge.md`.
   Known gaps: "merged" doesn't mean "deployed" (no deployment signal source
   yet), no way to detect a needed product decision from GitHub alone, and
   only the single most-recently-updated PR per repo is considered.
7. **Done (2026-09-06):** `ProjectDetailDrawer.tsx` got the same plain-language
   treatment as Portfolio — a verdict block (with a real-GitHub-vs-direct-push
   trust badge) now leads the drawer, the old Option A/B decision UI only
   shows for the manual/fixture path, and the entire original Gate/Execution
   Context/Environment/Feature Matrix/Activity Timeline UI is preserved but
   collapsed behind a "顯示技術細節" toggle. See
   `docs/superpowers/evidence/2026-09-06-drawer-plain-language-redesign-non-bridge.md`.
   **Known gap surfaced, not yet fixed**: the app's three AI-tool interaction
   mechanisms are disconnected — `CodexHandoffPanel` (real Codex dispatch,
   but hardcoded to a demo read-only task), `ChatGPTBridgeModal` (real AI
   advice call, but "apply decision" only edits local state), and "Copy
   Context" (fully manual). None of them lets a user's real decision reach
   the actual coding agent working on the branch — reads are real, writes
   aren't. Deferred to a separate future phase.
8. **Done (2026-09-08):** the home-page "Next Best Action" hero card
   (`src/components/NextBestActionCard.tsx`) no longer renders a hand-authored
   fixture that never changed — it now scans every project's real verdict
   (`getVerdict()` + new `pickMostUrgent()` in `src/verdict.mjs`) and surfaces
   the single most urgent one, reusing the same `ProjectVerdictCard` component
   (extracted to its own file, `src/components/ProjectVerdictCard.tsx`) as
   Portfolio. The old fake "快速放行" (quick-approve) button, which only
   edited local state, was removed. See
   `docs/superpowers/evidence/2026-09-08-next-best-action-real-verdict-non-bridge.md`.
9. **Done (2026-09-08):** `CockpitHeader.tsx` redesigned to the same
   zero-jargon-by-default pattern as every prior screen — the vendor tagline
   is gone (replaced with a plain "AI 協作作業中 · Live Sync" status line),
   and the "Luna / Terra / Sol" / "CI/CD 流程圖" buttons moved behind a new
   collapsible "技術細節" toggle instead of always showing. In the same pass,
   every user-facing mention of "ChatGPT" or "Codex" was replaced app-wide
   (110 mentions, 13 files) with vendor-neutral role language — "AI 顧問"
   (AI Advisor) for the advisory/PRD role, "AI 代理" (AI Agent) for the
   coding/execution role — so the app doesn't read as permanently tied to
   OpenAI's specific products; the owner may use different AI models going
   forward. "GitHub"/"GitHub Actions" (a real third-party tool) and the
   product's own branding ("Bridge," "Command Center," "Luna/Terra/Sol")
   were left unchanged, as were internal code identifiers
   (`ChatGPTBridgeModal`, `CodexHandoffPanel`, `CodexModelName`, the
   `/api/bridge/chatgpt-advice` route) — invisible during use, so renaming
   them was out of scope. See
   `docs/superpowers/evidence/2026-09-08-header-redesign-ai-vendor-neutral-wording-non-bridge.md`.
   Known cosmetic gap: locally-persisted `data/app-state.json` (gitignored,
   predates this change) still has a few stale "Codex"-named strings for one
   fixture project until that project's state is next rewritten — not a
   source-code issue.
10. **Done (2026-09-08):** the "待人決策" (`NeedsAttentionQueue`) and "AI 執行與
    模型遙測" (`AIExecutionSnapshot`) tabs got the plain-language pass AND had
    their underlying data source fixed — both used to be driven by static
    fixtures (`initialAttentionItems`/`initialExecutionSnapshot`) that never
    reflected real project state, the same "looks live, isn't" gap already
    fixed for Portfolio/Next Best Action. New shared hook
    `src/hooks/useProjectVerdicts.ts` scans every project's real verdict
    once in `App.tsx`; `attentionCount`/`aiRunningCount`/the execution
    snapshot's four state tiles are all now derived from that single scan,
    so the Header's pill counts and both tabs' badges/content stay in sync
    instead of being four independently-stale numbers. `NeedsAttentionQueue`
    now renders real `decision`/`danger`-verdict projects as full
    `ProjectVerdictCard`s (same visual language as Portfolio) with no more
    fake "Resolve" button. See
    `docs/superpowers/evidence/2026-09-08-attention-telemetry-real-verdict-non-bridge.md`.
    This closes out the one-at-a-time plain-language revamp for all primary
    screens.
11. **Done (2026-09-09):** `CiCdWorkflowModal.tsx` (all 4 tabs) and the
    highest jargon-density prose in `FeatureDeliveryMatrix.tsx` (top banner,
    AI-sync drawer intro/loading text) rewritten from engineering-jargon
    prose into plain Chinese explanation — structure unchanged, Gate IDs
    and Luna/Terra/Sol tier names kept (core app vocabulary, not disposable
    jargon). While verifying, found and fixed a leftover "ChatGPT" mention
    the 2026-09-08 sweep couldn't reach because it deliberately skipped
    `server.ts` (a boundary `CLAUDE.md` keeps separately protected). Got
    explicit owner re-authorization via `AskUserQuestion` before touching
    it; fixed the `/api/bridge/chatgpt-advice` and `/api/bridge/extract-
    features` routes' **display/fallback strings only** (provider labels,
    fallback markdown, two comments) — deliberately left the real system
    prompts sent to OpenAI/Gemini untouched (still say "ChatGPT" internally;
    that's live provider behavior, a different category from display text,
    and the owner explicitly chose not to touch it this round). See
    `docs/superpowers/evidence/2026-09-09-cicd-modal-plain-language-content-non-bridge.md`.
    Remaining, lower-priority: `FeatureDeliveryMatrix.tsx`'s data-table
    structure itself was not redesigned (only its surrounding prose).
12. **Done for the pilot project (2026-09-09):** closed the AI-tool interaction
    gap (entry 7) — `CodexHandoffPanel` can now genuinely propose *and*,
    once a human approves the specific plan, actually execute file changes
    for one pilot project (this repo itself), instead of only ever running
    a hardcoded read-only demo. New `WORKSPACE_WRITE_EXECUTION` task
    classification in `src/bridge/codexHandoff.mjs`, gated by a new
    per-project `write_enabled` allowlist flag; `sandbox` now threads from
    classification through `server/codexAppServerClient.mjs` into the real
    Codex CLI's own sandbox (`read-only` vs `workspace-write`); commit/push
    are blocked at three layers (server-side validation, an explicit prompt
    instruction, and a real post-hoc `git rev-parse HEAD` verification, not
    just trust). Verified live end-to-end against the real `codex app-server`
    process — see
    `docs/superpowers/evidence/2026-09-09-codex-write-execution-propose-approve-execute-non-bridge.md`
    for the full record, including a real pre-existing gap found and fixed
    (`npm run dev` never set `NODE_ENV=development`, so this route was
    unreachable through the normal dev workflow even before this change).
    Owner exercised the full flow live the same day — Propose → reviewed
    the plan → Execute — and it produced real, accurate output: Codex
    rewrote 4 `.bridge/` docs plus one new spec, correctly replacing stale
    `BLOCKED_DECISION` placeholders with the real V0.4 architecture, and
    `git log` confirmed no commit was made during its own turn. Reviewed
    and committed (`cbba415`) after catching one thing worth checking first
    — the diff silently repointed `.bridge/PROJECT_CONTEXT.md`'s "Local
    workspace" path away from a second, separate clone of this repo at
    `/Users/augusliang/Developer/workspaces/micro-saas-command-center`;
    confirmed that clone is stale (5 days untouched, 16 commits behind
    `origin/main`) and no longer in use, so the change was accurate, not
    destructive. Still open: `ChatGPTBridgeModal`'s "apply decision" is not
    wired to any real dispatch; every project except the one pilot stays
    read-only.

## Roadmap

- **Phase 1 (current)** — Personal use + shareable offline/local version for
  friends. Priority order: (1) ~~real persistence~~ **done** — local JSON
  file, see above; (2) ~~real GitHub API in `ConnectRepoModal`~~ **done**, see above;
  (3) package for
  easy local deploy — Dockerfile + docker-compose.yml + README quickstart,
  ideally a GitHub template repo; (4) genericize `mockData.ts` before making
  the repo public/template.
- **Phase 2 (~1-3 months after Phase 1)** — Personal daily-use validation
  period. Persistence: **Firestore** (not SQL — data model is already
  document-shaped, and Augus already knows Firestore from `pm-dashboard`).
  Goal is to collect real usage signals and decide Go/No-Go on
  productization, not to add features for their own sake.
- **Phase 3** — Productization MVP, 3-5 invited users. Firebase Auth +
  Firestore + Cloud Run (reusing the `Prosync`/`pm-dashboard` deployment
  pattern). BYO Gemini API key per user by default. Design Firestore
  security rules carefully — `pm-dashboard` previously had a field-level
  access control flaw at the DB layer; don't repeat that.
- **Phase 4** — Second-stage productization (billing, public onboarding).
  Only if Phase 3 shows real demand. This competes directly for the same
  limited hours as Augus's higher-conviction EMS/microgrid vertical SaaS
  idea — treat entering Phase 4 as a deliberate tradeoff decision, not a
  default next step.
