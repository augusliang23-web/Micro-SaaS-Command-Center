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
