# Micro-SaaS Command Center Bridge Onboarding Design

## Status

Owner-approved safety-first direction for onboarding the Google AI Studio
Prototype into ChatGPT Codex Bridge V0.3.1. The revised written design remains
subject to owner review before implementation planning. This document
authorizes only local design and adapter documentation work. Push, pull
request, GitHub Issue/label writes, dependency retrieval, mapping registration,
and watcher execution are conditional future steps; each requires separately
recorded current human authorization. AI-provider endpoints remain prohibited.
This design does not authorize feature implementation, merge, deployment,
release, provider-service creation, billing changes, secret access, production
data access, or authentication/security changes.

## Goal

Register `augusliang23-web/Micro-SaaS-Command-Center` as a safely bounded
Bridge project, while preserving the Prototype as a visual and interaction
baseline rather than treating its mock state or AI endpoint as production
authority.

## Verified Baseline

- Repository: `augusliang23-web/Micro-SaaS-Command-Center`
- Default branch: `main`
- Current Prototype snapshot: `6fcd2395c3d5028c14aced1e278b49d29f36f2af`
- Previous Prototype snapshot: `57e6402fb3390225fd500b46e0a8a17a7fc1ef26`
- Latest expansion: 18 files changed, 4,719 insertions, and 493 deletions
- Local checkout: `/Users/augusliang/Developer/workspaces/micro-saas-command-center`
- Onboarding branch: `bridge/onboarding-v0`
- Frontend: React 19, TypeScript 5.8, Vite 6, Tailwind 4
- Server: Express 4 with optional Google Gemini and OpenAI outbound calls
- Added Prototype surfaces: Feature Delivery Matrix, CI/CD workflow map,
  Selective Release modal, staging/production views, and Error Boundary
- Declared commands:
  - Development: `npm run dev`
  - Lint/type-check: `npm run lint`
  - Build: `npm run build`
  - Start: `npm run start`
- Package state: `bun.lock` exists, npm-style scripts remain, no
  `packageManager` is declared, and Bun was not installed on the audited Bridge
  host
- Missing baseline controls: test command, tests, CI, deployment
  configuration, authoritative release process, and repository README
- Environments: AI Studio Preview only; no Development, UAT, or Production
  deployment is evidenced by this checkout

The UI uses typed fixtures and browser-memory state. GitHub connection,
workflow transitions, approvals, blockers, environment status, feature flags,
releases, and activity history are simulations. They are not evidence of live
integrations or external system state. The source currently allows local clicks
to display `APPROVED`, `Live`, `DONE`, deployed, GitHub-synced, and production
flag states without authoritative evidence. These are known Prototype safety
gaps, not implemented capabilities.

The audit also confirmed two source-level interaction defects: opening
`SelectiveReleaseModal` changes the component's Hook count and triggers a React
runtime failure, while clicking its nested checkbox toggles selection twice
because the event also reaches the row handler. The current diff additionally
fails `git diff --check` for blank lines at end-of-file in
`src/components/FeatureDeliveryMatrix.tsx` and `src/main.tsx`. No lint, build,
runtime, test, accessibility, or viewport pass is claimed for this snapshot.

## Selected Approach

Use adapter-first, gated activation:

1. Add the Project Adapter and repository-wide agent rules on the isolated
   onboarding branch.
2. Record static baseline evidence without starting the application, invoking
   AI-provider endpoints, or treating the unresolved Bun/npm state as a valid
   dependency baseline.
3. After separately recorded human authorization, create an administrative
   onboarding Issue without `bridge:ready`, commit and push only the design,
   onboarding configuration, and evidence, and link the branch and PR to that
   Issue. An explicit owner-approved exception is required if the
   one-branch/one-Issue policy is not used.
4. Open an onboarding PR and stop at `READY_FOR_REVIEW`.
5. Obtain a non-authoritative Terra findings review from a reviewer separate
   from the executor, followed by canonical ChatGPT Control Plane review.
6. Require explicit named-human merge approval. Neither Codex nor the Terra
   findings reviewer may merge the PR.
7. After the adapter is approved and merged to `main`, register the exact
   machine-local
   repository mapping.
8. Verify there is no active repository lock, resumable `CODEX_QUOTA` run,
   eligible open `bridge:changes-required` Issue, or eligible open
   `bridge:ready` Issue. Run one watcher cycle and require its machine-readable
   `NO_OP` result as the mapping recognition check. Discovery failure, a
   blocker, or any other result fails closed.
9. Create and review the first feature Issue, **Prototype State Provenance &
   Safety Guardrails**, without `bridge:ready`.
10. Add `bridge:ready` only as the final dispatch authorization after every
    Issue field, label, package-manager prerequisite, exclusion, and acceptance
    criterion is verified.

Direct writes to `main` and mapping-first activation are rejected because they
remove the independent review gate or expose an unadapted repository to the
watcher.

## Project Adapter Structure

The onboarding change will create:

```text
.bridge/
├── PROJECT_CONTEXT.md
├── ARCHITECTURE.md
├── PROJECT_RULES.md
├── ENVIRONMENTS.md
└── BRIDGE_CONFIG.yaml
AGENTS.md
```

- `PROJECT_CONTEXT.md`: canonical identity, product purpose, Prototype status,
  source roots, and ownership.
- `ARCHITECTURE.md`: current React, fixture-state, release/CI presentation,
  Express, and optional AI data flows; clearly separates simulated UI from
  authoritative integrations.
- `PROJECT_RULES.md`: scope boundaries, protected surfaces, evidence rules,
  and forbidden actions.
- `ENVIRONMENTS.md`: records AI Studio Preview as the only observed surface and
  marks Development, UAT, and Production as not established.
- `BRIDGE_CONFIG.yaml`: machine-readable project identity, commands,
  environment state, risk rules, deployment policy, and model routing.
- `AGENTS.md`: repository-wide instructions requiring fail-closed behavior and
  the same human approval boundaries.

## Runtime and Package Policy

- npm is the selected canonical package manager for Bridge execution because
  the manifest exposes npm-style scripts and the audited host has Node/npm but
  no Bun executable. This selection becomes effective only when the owner
  approves this written design.
- The committed `bun.lock` is not npm authority. The first safety Issue may
  remove `bun.lock` and generate `package-lock.json` as one atomic package
  normalization change, and must set `"packageManager": "npm@10.8.2"` in
  `package.json`. The two lockfiles must never coexist in the resulting branch.
- Until that separately authorized Issue runs, onboarding records dependency,
  lint, and build status as `BLOCKED_DECISION`; it must not install from either
  package manager, invent a pass, or alter package metadata.
- Registry access requires separately recorded execution authorization. After
  removing `bun.lock`, generate the lockfile with
  `npm install --package-lock-only --ignore-scripts`, review its staged diff,
  and install exactly from it with `npm ci --ignore-scripts`. Neither command
  may run lifecycle scripts.
- Run normalization with an explicit approved registry and clean temporary npm
  user/global configuration files. Before running npm, inspect environment
  variable names only; reject `npm_config_*` case-insensitively and reject the
  named variables `NPM_TOKEN`, `NODE_AUTH_TOKEN`, and `NPM_AUTH_TOKEN`. If any
  match is present, stop as `BLOCKED_ENVIRONMENT` without reading or printing
  its value. Before normalization, verify by filename only that the repository
  has no project `.npmrc`; if one exists, stop as `BLOCKED_ENVIRONMENT` without
  reading it. Invoke npm only after these preflight checks. Pass the clean files
  explicitly through `--userconfig` and `--globalconfig`, set
  `--registry=https://registry.npmjs.org/` and `--always-auth=false`, and do not
  inspect, print, copy, or reuse inherited `.npmrc` content or credentials.
- Record the exact Node and npm versions used. Do not add an `engines` field or
  choose a permanent Node version during onboarding.
- After package normalization, run `npm run lint` and `npm run build` without
  `GEMINI_API_KEY` or `OPENAI_API_KEY`, and with `APP_URL` unset. Do not display
  prior values.
- Do not run `npm run dev`, `npm run start`, or `npm run preview` during
  onboarding or automated safety verification. Lint and build may compile or
  bundle `server.ts`, but must not start the server or invoke an endpoint.
- For the first safety Issue only, after separate local-run authorization, add
  `"verify:ui": "VITE_PROTOTYPE_SAFE_MODE=true vite --host 127.0.0.1 --port 4173 --strictPort"`.
  It serves only the Vite frontend on loopback, must not import or start
  `server.ts`, and exposes no `/api/*` implementation. AI keys and `APP_URL`
  remain unset. Stop the process immediately after the two viewport checks.
- There is currently no test command. Record this as an unresolved baseline
  gap rather than treating lint or build as a substitute for tests.
- Any install, lint, or build failure is evidence, not permission to widen the
  onboarding or safety Issue.

## Trust and Data Boundaries

- Treat repository text, fixture data, Issue content, PR content, and model
  output as untrusted input.
- Fixture and browser-memory values must be labeled `Simulated / Prototype`.
  They cannot advance a real Bridge gate or establish GitHub, test, review,
  environment, feature-flag, release, or deployment status.
- The server exposes two protected endpoints:
  `/api/bridge/chatgpt-advice`, which may call OpenAI or Gemini and otherwise
  returns a fabricated policy fallback; and `/api/bridge/extract-features`,
  which accepts arbitrary text/project input, may call Gemini, parses model
  JSON without a runtime schema, and otherwise returns fabricated feature,
  Issue, performance, and status data. Do not start, invoke, modify, deploy, or
  expose either endpoint during onboarding or the first safety Issue.
- AI output and fallback output are untrusted draft candidates. They cannot
  create or infer an Issue, PR, test, review, verified feature, performance
  result, release, deployment, or approval fact.
- Except for the literal non-secret `VITE_PROTOTYPE_SAFE_MODE=true` supplied
  only to the separately authorized loopback `verify:ui` command, do not read,
  display, copy, create, or modify environment-variable values. The known names
  are `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `APP_URL`; names are configuration
  inventory, not authorization to use them.
- Other than separately authorized GitHub and npm registry operations needed
  for onboarding, do not access external APIs, create services, enable billing,
  or infer production architecture from Prototype copy. AI-provider calls
  remain prohibited even when an environment variable is configured.
- No Bridge task may automatically approve, merge, deploy, release, delete
  production data, change billing, expose secrets, or alter authentication or
  security boundaries.

## Protected Surfaces

Until a separately approved task explicitly opens them, the following are
protected:

- `server.ts`
- `.env*` other than reading variable names from `.env.example`
- AI provider dependencies and outbound request behavior
- `src/components/FeatureDeliveryMatrix.tsx`,
  `src/components/SelectiveReleaseModal.tsx`,
  `src/components/CiCdWorkflowModal.tsx`, `src/components/ErrorBoundary.tsx`,
  and status-mutating sections of `src/App.tsx`, except for the exact files and
  behaviors opened by the separately approved first safety Issue
- `src/types.ts` and `src/mockData.ts` outside the exact provenance and
  simulation-label scope opened by that Issue
- application GitHub integration behavior
- authentication, authorization, roles, tenants, and identity
- billing, payments, usage metering, and provider configuration
- databases, persistence, migrations, and production data
- CI/CD, hosting, deployment, release, and environment provisioning
- canonical Bridge approval and merge state

## Model Routing

- Luna, low or medium reasoning: deterministic documentation, formatting,
  label/config maintenance, and focused fixture-only changes.
- Terra, medium reasoning: normal multi-file UI work, typed data models,
  component behavior, tests, and implementation self-review.
- Sol, high reasoning: Bridge orchestration, architecture, AI endpoints,
  GitHub write integrations, authentication, security, schema, billing,
  deployment, destructive work, or ambiguous/high-blast-radius changes.

A Terra or Luna findings review must be performed by a reviewer separate from
the executor, is non-authoritative, and does not replace the independent
ChatGPT Control Plane review. ChatGPT is the sole canonical approval recorder;
the named human is the sole merge authority. Tests passing does not imply
review approval.

## Onboarding Verification and Failure Handling

The onboarding PR must provide fresh evidence for:

- exact repository, branch, HEAD, remote, and clean/dirty state
- diff restricted to the design, adapter, agent rules, and evidence files
- staging only the declared allowlisted files before evidence capture
- exact staged filename set and `git diff --cached --check`
- `git status --short`, including an explicit list of untracked or unrelated
  dirty files; a clean tree is not inferred from `git diff --check`
- local Node and npm versions and evidence that Bun was unavailable during the
  baseline audit
- `bun.lock`, absent `packageManager`, npm-style scripts, and the selected npm
  normalization policy
- dependency installation, lint, and build recorded as `BLOCKED_DECISION`
  until the separately approved first safety Issue normalizes the lockfile
- confirmation that no tests exist and no test command was fabricated
- exact source-observed interaction and status-provenance gaps, including the
  Selective Release Hook crash and checkbox double-toggle
- confirmation that no AI key, provider call, deployment, service, billing,
  secret value, production data, or auth/security action occurred

Missing tools, inaccessible dependencies, ambiguous package authority, or
ambiguous repository identity must fail closed as `BLOCKED_ENVIRONMENT` or
`BLOCKED_DECISION`. Baseline install, lint, or build failures are recorded
verbatim and deferred to the explicitly scoped safety Issue; they must not be
silently fixed or hidden in onboarding.

## Mapping Activation

The machine-local mapping is added only after the onboarding PR is approved and
merged. The following `projects` array is illustrative; it is not a static
replacement file:

```json
{
  "version": 1,
  "projects": [
    {
      "repository": "augusliang23-web/ChatGPT-Codex-Bridge",
      "path": "/Users/augusliang/Developer/ChatGPT-Codex-Bridge"
    },
    {
      "repository": "augusliang23-web/Micro-SaaS-Command-Center",
      "path": "/Users/augusliang/Developer/workspaces/micro-saas-command-center"
    }
  ]
}
```

Under separately authorized local access, read the existing mapping first,
preserve its exact unrelated entries byte-for-byte or semantically, and append
only the new canonical entry. Do not generate a replacement static file from
this document. If this repository already maps to a different path, stop as
`BLOCKED_DECISION`; never overwrite it automatically. Before registration,
independently verify the normalized `origin` repository, the intended absolute
path, and the clean/dirty policy. After separately authorizing a GitHub read,
fetch `origin/main` immediately before verifying that the exact approved and
merged adapter SHA is an ancestor of the freshly fetched `origin/main`. If the
fetch or exact ancestry check cannot be completed, stop as
`BLOCKED_ENVIRONMENT`; do not register the mapping.
Record before/after mapping hashes. After registration, verify there is no
active repository lock, resumable `CODEX_QUOTA` run, eligible open
`bridge:changes-required` Issue, or eligible open `bridge:ready` Issue. Run one
watcher cycle and require its machine-readable `NO_OP` result. Any other result,
including discovery failure or a blocker, fails closed and forbids feature
authorization.

## First Feature Issue Boundary

The first feature Issue is **Prototype State Provenance & Safety Guardrails**.
It makes the expanded interface honest and operable as a Prototype before any
dashboard expansion or live integration work.

- Model: Terra
- Reasoning effort: Medium
- Risk: Medium
- Exact routing metadata: exactly one model label, `model:terra`; exact Issue
  body line `- Reasoning Effort: Medium`; risk label `risk:medium`
- Allowed application boundary: `src/types.ts`, `src/mockData.ts`,
  `src/statusProvenance.mjs`, `src/App.tsx`,
  `src/components/PortfolioOverview.tsx`,
  `src/components/BridgeWorkflowRail.tsx`,
  `src/components/CockpitHeader.tsx`,
  `src/components/ConnectRepoModal.tsx`,
  `src/components/NeedsAttentionQueue.tsx`,
  `src/components/NextBestActionCard.tsx`,
  `src/components/AIExecutionSnapshot.tsx`,
  `src/components/ProjectDetailDrawer.tsx`,
  `src/components/ChatGPTBridgeModal.tsx`,
  `src/components/FeatureDeliveryMatrix.tsx`,
  `src/components/SelectiveReleaseModal.tsx`,
  `src/components/CiCdWorkflowModal.tsx`, and
  `src/components/ErrorBoundary.tsx`; plus focused test and setup files under
  `src/**/*.test.ts`, `src/**/*.test.tsx`, `src/test/setup.ts`, and
  `test/**/*.test.mjs`
- Allowed package boundary: `package.json`, removal of `bun.lock`, and one
  generated `package-lock.json`. No dependency other than the exact test stack
  below may be added. `package.json` must declare
  `"packageManager": "npm@10.8.2"` and the exact loopback-only `verify:ui`
  script defined above. No other configuration file is opened by this Issue.
- Provenance contract: every displayed gate, GitHub reference, test/review
  outcome, environment/version, feature flag, release, and activity event must
  carry a typed provenance value with required `authority`, `observedAt`,
  immutable `evidenceRef`, and `confidence` fields. Allowed authorities are
  `fixture`, `user-entered`, `AI-candidate`, `GitHub-observed`, `CI-observed`,
  and `deployment-observed`. Fixture evidence references use stable fixture
  identifiers; they must not imitate external URLs or run IDs.
- Promotion contract: `fixture`, `user-entered`, and `AI-candidate` values can
  never produce authoritative `APPROVED`, `Verified`, `Live`, `DONE`, deployed,
  GitHub-synced, or production flag-on state. A shared pure
  `src/statusProvenance.mjs` policy must deny these promotions by default.
  Future authoritative promotion requires independently observed evidence,
  independent review where applicable, named-human approval, and a recorded
  deployment result. This Issue remains read-only with respect to every
  external system.
- Presentation contract: render a persistent global `Simulated / Prototype`
  banner and a visible provenance badge beside every affected status. Buttons
  may demonstrate a simulation only when their label and resulting message
  explicitly say simulation; they must not claim that GitHub, Bridge, CI/CD,
  feature flags, staging, UAT, or Production changed.
- Safe-mode contract: when `VITE_PROTOTYPE_SAFE_MODE=true`, disable every
  control that can call `/api/bridge/chatgpt-advice` or
  `/api/bridge/extract-features` and replace its action copy with an explicit
  non-network simulation label. No frontend test or viewport check may issue a
  request to `/api/*` or any external origin. Fixture-derived GitHub,
  staging/UAT, Production, or evidence URLs render as non-navigating simulated
  references.
- Generated-feature contract: AI and fallback results are rendered only as
  untrusted draft candidates. Import requires explicit user confirmation and
  normalizes them to non-authoritative `Backlog` / `Planned` state while
  retaining source provenance. The UI must not infer Issue numbers, PR state,
  verification, performance, deployment, or approval from generated content.
- Defect contract: move every `SelectiveReleaseModal` Hook before conditional
  return, and make a checkbox interaction toggle exactly once for pointer and
  keyboard input. The Error Boundary must not claim browser-memory workflow
  data was persisted or safely saved.
- Accessibility contract: affected modal surfaces require dialog semantics,
  accessible names, initial focus, focus containment, Escape close, focus
  restoration, and labelled close controls. Dashboard tabs require tablist/tab
  semantics, keyboard navigation, and `aria-selected`. At 1280 by 800 CSS
  pixels the document has no body-level horizontal overflow; at 768 CSS pixels
  wide content scrolls only inside a labelled region.
- Test stack: `vitest`, `jsdom`, `@testing-library/react`,
  `@testing-library/jest-dom`, and `@testing-library/user-event` as development
  dependencies; test root `src/**/*.test.ts` and `src/**/*.test.tsx`; add the
  allowed setup path `src/test/setup.ts` importing
  `@testing-library/jest-dom/vitest`; set the `test` command to
  `vitest run --environment jsdom --setupFiles src/test/setup.ts`; full-suite
  command `npm test`. Registry retrieval must use npm with lifecycle scripts
  disabled and requires separately recorded execution authorization.
- V0.3.1 compatibility: add a meaningful focused Node built-in test under
  `test/**/*.test.mjs` and require `node --test`. It must import the same
  `src/statusProvenance.mjs` policy used by the application and prove that
  fixture, user-entered, and AI-candidate data cannot authorize protected
  status promotion. It must not be an empty sentinel or static text search.
- Required verification: focused tests for provenance rendering, denied status
  promotion, generated-candidate normalization, modal open/close, checkbox
  pointer and keyboard behavior, tabs, Error Boundary wording, normal/empty/
  loading/error states, persistent Prototype labels, non-navigating fixture
  references, and zero `/api/*` or external requests in safe mode; `npm test`;
  `node --test`; `npm run lint`; `npm run build`; `git diff --check`; staged
  allowlist review; then a separately authorized `npm run verify:ui` process
  for user-visible local checks at both specified viewports, followed by proof
  that the loopback process stopped
- Excluded: `server.ts`, AI calls, GitHub integration, authentication,
  persistence, feature-flag providers, CI/CD runners, billing, runtime external
  network calls other than the narrowly authorized npm registry dependency
  retrieval, deployment, secrets, and production automation

Any requested change to `server.ts`, `.env*`, provider dependencies,
application GitHub integration, authentication, persistence, billing,
deployment, or runtime network behavior is `BLOCKED_DECISION`; it is not an
automatic model escalation.

The Issue is created without `bridge:ready`. It is not dispatchable until the
owner has approved npm normalization and separately authorized the required npm
registry read. After its contract, exact routing metadata, labels, test harness,
package policy, and exclusions are independently verified, the Control Plane
may add `bridge:ready` as the exact authorization for the V0.3.1 watcher to
dispatch Codex. Codex must stop at `READY_FOR_REVIEW` and must not approve,
merge, deploy, or release.

## Completion Criteria

Onboarding is complete only when:

1. The adapter and repository rules are merged to `main` with human approval.
2. The exact local mapping is registered and independently verified.
3. A no-eligible-Issue watcher cycle returns `NO_OP`.
4. The first safety Issue contains the approved provenance contract, npm
   normalization, routing, risk, scope, exclusions, acceptance criteria, and
   review boundary.
5. Adding `bridge:ready` produces one selected repository/Issue in `new` mode,
   one run record containing requested `gpt-5.6-terra` and medium reasoning,
   and no second candidate or live duplicate lock. Effective model/reasoning
   remains unverified unless independently emitted by the runtime.
6. The resulting implementation reaches `READY_FOR_REVIEW` only after required
   evidence, with no external status mutation, merge, deployment, release,
   billing, secret, production-data, or auth/security action.
7. Project Overview expansion, live GitHub/Bridge reads, AI endpoint hardening,
   and real CI/CD or deployment integration remain separate future Issues and
   receive no implied authorization from onboarding completion.
