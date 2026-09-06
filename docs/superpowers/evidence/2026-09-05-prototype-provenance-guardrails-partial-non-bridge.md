# Prototype Provenance & Safety Guardrails: Partial Implementation — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-05
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout, including explicit approval to run `npm install` for new devDependencies. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow described in the committed `CLAUDE.md`. No GitHub Issue, allowlisted file set independently verified by a human workflow, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to the approved plan

This targets the goals of [`docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md`](../issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md) and its linked [implementation plan](../plans/2026-09-02-prototype-safety-guardrails.md), which were written for a fully autonomous, Bridge-dispatched Codex worker (exact `apply_patch` steps, per-task TDD checkboxes, mktemp npm config isolation for unattended installs). Executing directly in an interactive chat session with the owner present, this session implemented the **substance** of the plan pragmatically rather than transcribing every literal ceremony written for unattended dispatch. **This is a deliberately partial implementation** — see "Explicitly deferred" below.

## What shipped

- `src/statusProvenance.mjs` + `test/status-provenance.test.mjs` (12 Node built-in tests) — the fail-closed promotion policy from the plan (`canAuthorizePromotion`, `normalizeGeneratedFeature`, `provenanceLabel`, `isCompleteProvenance`), implemented as specified.
- `src/types.ts` — added `ProvenanceAuthority`, `StatusProvenance`, `ProjectProvenanceField`, `ProjectProvenance`, and a **required** `provenance: ProjectProvenance` field on `MicroSaaSProject`. Scoped to **project-level** provenance (one record per project covering gate/github/test/review/environment/featureFlag/release/activity), not the plan's literal per-gate-step/per-feature-item/per-activity-item provenance — a deliberate scope reduction to keep the diff maintainable.
- `src/mockData.ts` — added `projectProvenance(id)` fixture-provenance helper; every one of the 6 fixture projects now carries `authority: 'fixture'` provenance with stable `fixture:<id>:<field>` evidence references (no `Date.now()`, random IDs, or fake URLs used as evidence, per the plan's rule).
- `src/App.tsx` — persistent `role="status"` "Simulated / Prototype" banner at the top of the app (matches the plan's Task 4 requirement); rewrote toast copy that previously claimed real infrastructure changed (`🎉 已完成 1-Click Promote！正式生產環境已更新` → an explicit `[模擬]`-prefixed message; same for the selective-release and Bridge-telemetry-refresh toasts); backfills `provenance` on state persisted before this field existed so old saved projects don't crash the drawer (see "Bug found during verification" below).
- `src/components/ConnectRepoModal.tsx` — removed fabricated fields from the project shell created on connect: no more invented `contextTokens: '1,240 tokens'`, no more literal fake `githubIssue: '#1 Initial Onboarding'`, no more fake `staging.url` pointing at a domain that doesn't exist; `bridgeRunId` now prefixed `local-sim-` instead of `run-init-`; the misleading "GitHub App Live" badge (which read as if the *whole* 8-Gate workflow were live, when only the repo picker is) replaced with honest copy; new projects get real `provenance`.
- `src/components/ProjectDetailDrawer.tsx` — fixed a **Hook-order bug**: `if (!project) return null` was before four `useState` calls, meaning Hooks were conditionally skipped whenever the drawer closed. This is the same defect class the plan called out for `SelectiveReleaseModal`. Added visible `Simulated / Prototype` provenance badges next to the Bridge Gate pipeline header, Execution Context header, and Environments header — the exact sections in the owner's original screenshot.
- `src/components/SelectiveReleaseModal.tsx` — fixed the plan's two named confirmed defects: the Hook-order bug (`if (!isOpen) return null` moved below all `useState` calls) and the checkbox double-toggle bug (row `onClick` and checkbox `onChange` both firing; added `onClick={(e) => e.stopPropagation()}` on the checkbox).
- `src/components/ErrorBoundary.tsx` — replaced the false "工作流狀態已安全保存" (workflow state was safely saved) claim with honest copy stating browser-memory state was not persisted and reset returns to the fixture baseline.
- Test harness: `vitest@3.2.4`, `jsdom@26.1.0`, `@testing-library/react@16.3.0`, `@testing-library/jest-dom@6.6.3`, `@testing-library/user-event@14.6.1` added as devDependencies via `npm install --ignore-scripts` (no lifecycle scripts ran; `.npmrc` absent; no leaked npm auth env vars per preflight check). New `vitest.config.ts` and `src/test/setup.ts` (zero-network test guard — `fetch` throws in tests, proven by `src/App.test.tsx` passing while `/api/state` calls are rejected and caught). New `npm run test:ui` script added; the existing `npm test` (Node built-in runner over `test/`) was left untouched.
- New focused Vitest coverage: `src/App.test.tsx` (persistent banner renders; no more "GitHub App Live" claim) and `src/components/SelectiveReleaseModal.test.tsx` (opens without crashing with Hooks in the right order; returns null cleanly when closed; checkbox toggles exactly once per click).

## Bug found and fixed during verification

Manual browser verification caught a real regression: state persisted via `/api/state` **before** this session's changes (the `pm-dashboard-uat` project connected earlier this session) had no `provenance` field, and `ProjectDetailDrawer` crashed with `Cannot read properties of undefined (reading 'gate')` when opened — correctly caught by the just-fixed `ErrorBoundary`, which is how the honest copy fix was visually confirmed. Fixed by backfilling `provenance` in `App.tsx`'s load-state handler for any project missing it, plus optional-chaining the three `project.provenance?.field` badge call sites as defense in depth. Re-verified in the browser: the same project now opens cleanly with visible `Simulated / Prototype` badges next to all three affected sections.

## Explicitly deferred (not done in this session)

To keep this a bounded, reviewable change rather than a full transcription of the mega-plan, the following from the original plan were **not** implemented and remain open:

- Per-gate-step, per-feature-item, and per-activity-item provenance (plan wanted it on every array entry; this session scoped it to one provenance record per project).
- Full ARIA dialog semantics + focus trap + Escape-to-close + focus restoration on every modal/drawer (`ChatGPTBridgeModal`, `CiCdWorkflowModal`, `ConnectRepoModal`, `ProjectDetailDrawer`) — only the two named Hook-order defects were fixed; accessibility (focus trapping, `role="dialog"`, keyboard handling) was not added.
- `VITE_PROTOTYPE_SAFE_MODE` env flag and disabling `ChatGPTBridgeModal`'s calls to `/api/bridge/chatgpt-advice` / `/api/bridge/extract-features` in that mode.
- `role="tablist"` / `aria-selected` / arrow-key navigation on the three top-level tabs in `App.tsx`.
- The full per-component Vitest test files the plan specified (`PortfolioOverview.test.tsx`, `ProjectDetailDrawer.test.tsx`, `FeatureDeliveryMatrix.test.tsx`, `ErrorBoundary.test.tsx`, `mockData.test.ts`, `statusProvenance.test.ts`) — only `App.test.tsx` and `SelectiveReleaseModal.test.tsx` were added, covering the concrete fixes made.
- `npm run verify:ui` loopback-only Vite harness for the plan's frontend-only verification mode.
- 4 `npm audit` findings (3 moderate, 1 critical) surfaced by the new devDependencies were not investigated — devDependencies only, not shipped in the production bundle, but worth a follow-up look.

These are candidates for a future, separately scoped follow-up task.

## Commands run and results

- `npm install --save-dev --ignore-scripts --registry=https://registry.npmjs.org/ --always-auth=false vitest@3.2.4 jsdom@26.1.0 @testing-library/react@16.3.0 @testing-library/jest-dom@6.6.3 @testing-library/user-event@14.6.1` — succeeded, no lifecycle scripts ran.
- `npm run lint` (`tsc --noEmit`) — exit 0.
- `npm test` (`node --test test/`) — 54/54 passing (42 pre-existing + 12 new provenance-policy tests).
- `npm run test:ui` (`vitest run`) — 5/5 passing.
- `npm run build` — succeeded (pre-existing, unrelated `import.meta`/cjs warning from `server.ts`, not introduced by this change).

## Manual browser verification

Reloaded the running dev server, confirmed the persistent amber "Simulated / Prototype" banner renders at the top of the app, opened the previously-crashing `pm-dashboard-uat` project (persisted from before this session's schema change) and confirmed it now opens without error with visible `Simulated / Prototype` badges next to the Bridge Gate pipeline, Execution Context, and Environments sections. Dev server left running for the owner; no external network calls were made beyond the npm registry install.

## Boundaries respected

Did not touch `/api/bridge/chatgpt-advice`, `/api/bridge/extract-features`, `server.ts`, `.env*`, GitHub integration, authentication, billing, deployment, or secrets. Did not add `bridge:ready`/`bridge:approved`, open/close/comment on any Issue, or merge/deploy/release anything. Changes remain uncommitted in the working tree pending the owner's review.
