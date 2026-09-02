# Prototype State Provenance & Safety Guardrails

- Reasoning Effort: Medium
- Risk: Medium
- Required Model Label: `model:terra`
- Required Risk Label: `risk:medium`
- Bridge Authorization: NOT GRANTED; do not add `bridge:ready`

## Scope

Implement the approved [Prototype safety implementation plan](../plans/2026-09-02-prototype-safety-guardrails.md) so the expanded interface is honest and operable as a Prototype before dashboard expansion or live integration work.

Allowed application files are exactly: `src/types.ts`, `src/mockData.ts`, `src/statusProvenance.mjs`, `src/App.tsx`, `src/components/PortfolioOverview.tsx`, `src/components/BridgeWorkflowRail.tsx`, `src/components/CockpitHeader.tsx`, `src/components/ConnectRepoModal.tsx`, `src/components/NeedsAttentionQueue.tsx`, `src/components/NextBestActionCard.tsx`, `src/components/AIExecutionSnapshot.tsx`, `src/components/ProjectDetailDrawer.tsx`, `src/components/ChatGPTBridgeModal.tsx`, `src/components/FeatureDeliveryMatrix.tsx`, `src/components/SelectiveReleaseModal.tsx`, `src/components/CiCdWorkflowModal.tsx`, and `src/components/ErrorBoundary.tsx`; plus focused test and setup files under `src/**/*.test.ts`, `src/**/*.test.tsx`, `src/test/setup.ts`, and `test/**/*.test.mjs`.

Allowed package files are `package.json`, removal of `bun.lock`, and one generated `package-lock.json`. No dependency other than `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event` may be added. `package.json` must declare `"packageManager": "npm@10.8.2"` and the exact loopback-only `verify:ui` script defined in the plan. No other configuration file is opened by this Issue.

## Provenance and promotion contract

Every displayed gate, GitHub reference, test/review outcome, environment/version, feature flag, release, and activity event must carry typed provenance with required `authority`, `observedAt`, immutable `evidenceRef`, and `confidence` fields. Allowed authorities are `fixture`, `user-entered`, `AI-candidate`, `GitHub-observed`, `CI-observed`, and `deployment-observed`. Fixture evidence references use stable fixture identifiers and must not imitate external URLs or run IDs.

Fixture, user-entered, and AI-candidate values can never produce authoritative `APPROVED`, `Verified`, `Live`, `DONE`, deployed, GitHub-synced, or production flag-on state. A shared pure `src/statusProvenance.mjs` policy must deny these promotions by default. Future authoritative promotion requires independently observed evidence, independent review where applicable, named-human approval, and a recorded deployment result. This Issue remains read-only with respect to every external system.

Render a persistent global `Simulated / Prototype` banner and a visible provenance badge beside every affected status. Buttons may demonstrate a simulation only when their label and resulting message explicitly say simulation; they must not claim that GitHub, Bridge, CI/CD, feature flags, staging, UAT, or Production changed.

When `VITE_PROTOTYPE_SAFE_MODE=true`, disable every control that can call `/api/bridge/chatgpt-advice` or `/api/bridge/extract-features` and replace its action copy with an explicit non-network simulation label. No frontend test or viewport check may issue a request to `/api/*` or any external origin. Fixture-derived GitHub, staging/UAT, Production, or evidence URLs render as non-navigating simulated references.

AI and fallback results are rendered only as untrusted draft candidates. Import requires explicit user confirmation and normalizes them to non-authoritative `Backlog` / `Planned` state while retaining source provenance. The UI must not infer Issue numbers, PR state, verification, performance, deployment, or approval from generated content.

## Defects and accessibility

Move every `SelectiveReleaseModal` Hook before conditional return, and make checkbox interaction toggle exactly once for pointer and keyboard input. The Error Boundary must not claim browser-memory workflow data was persisted or safely saved.

Affected modal surfaces require dialog semantics, accessible names, initial focus, focus containment, Escape close, focus restoration, and labelled close controls. Dashboard tabs require tablist/tab semantics, keyboard navigation, and `aria-selected`. At 1280 by 800 CSS pixels the document has no body-level horizontal overflow; at 768 CSS pixels wide content scrolls only inside a labelled region.

## Verification and stop boundary

Use `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event` as development dependencies, with test root `src/**/*.test.ts` and `src/**/*.test.tsx` and allowed setup path `src/test/setup.ts` importing `@testing-library/jest-dom/vitest`. Set the test command to `vitest run --environment jsdom --setupFiles src/test/setup.ts`; full suite is `npm test`. Registry retrieval must use npm with lifecycle scripts disabled and requires separately recorded execution authorization. npm registry access requires a separate current authorization; it is not granted by this local contract.

Add a meaningful focused Node built-in test under `test/**/*.test.mjs`, using `node --test`, importing the same `src/statusProvenance.mjs` policy and proving fixture, user-entered, and AI-candidate data cannot authorize protected status promotion. It must not be an empty sentinel or static text search.

Required verification covers provenance rendering, denied status promotion, generated-candidate normalization, modal open/close, checkbox pointer and keyboard behavior, tabs, Error Boundary wording, normal/empty/loading/error states, persistent Prototype labels, non-navigating fixture references, and zero `/api/*` or external requests in safe mode; then `npm test`, `node --test`, `npm run lint`, `npm run build`, `git diff --check`, staged allowlist review, and—only after separate authorization—`npm run verify:ui` at both specified viewports followed by proof that the loopback process stopped.

Excluded are `server.ts`, AI calls, GitHub integration, authentication, persistence, feature-flag providers, CI/CD runners, billing, runtime external network calls other than the narrowly authorized npm registry dependency retrieval, deployment, secrets, and production automation. `server.ts`, external APIs, provider behavior, authentication, persistence, billing, deployment, secrets, and production automation remain excluded. Any requested change to these surfaces is `BLOCKED_DECISION`, not automatic model escalation.

The Issue is a local contract only. It is not created on GitHub and grants no dispatch authorization. It must remain without `bridge:ready`; it is not dispatchable until the owner approves npm normalization and separately authorizes the required npm registry read. After the contract, exact routing metadata, labels, test harness, package policy, and exclusions are independently verified, the Control Plane may add `bridge:ready` as the exact authorization for the V0.3.1 watcher to dispatch Codex. Codex must stop at `READY_FOR_REVIEW` and must not approve, merge, deploy, or release.
