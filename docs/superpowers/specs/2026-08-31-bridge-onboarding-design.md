# Micro-SaaS Command Center Bridge Onboarding Design

## Status

Owner-approved architecture for onboarding the Google AI Studio Prototype into
ChatGPT Codex Bridge V0.3.1. This document authorizes only local adapter
documentation and local validation. Commit, push, pull request, GitHub
Issue/label reads or writes, mapping registration, and watcher execution are
conditional future steps; each requires separately recorded current human
authorization. AI-provider endpoints remain prohibited. This design does not
authorize feature implementation, merge, deployment, release, provider-service
creation, billing changes, secret access, production data access, or
authentication/security changes.

## Goal

Register `augusliang23-web/Micro-SaaS-Command-Center` as a safely bounded
Bridge project, while preserving the Prototype as a visual and interaction
baseline rather than treating its mock state or AI endpoint as production
authority.

## Verified Baseline

- Repository: `augusliang23-web/Micro-SaaS-Command-Center`
- Default branch: `main`
- Approved Prototype snapshot: `57e6402fb3390225fd500b46e0a8a17a7fc1ef26`
- Local checkout: `/Users/augusliang/Developer/workspaces/micro-saas-command-center`
- Onboarding branch: `bridge/onboarding-v0`
- Frontend: React 19, TypeScript 5.8, Vite 6, Tailwind 4
- Server: Express 4 with optional Google Gemini and OpenAI outbound calls
- Declared commands:
  - Development: `npm run dev`
  - Lint/type-check: `npm run lint`
  - Build: `npm run build`
  - Start: `npm run start`
- Missing baseline controls: lockfile, test command, tests, CI, deployment
  configuration, release process, and repository README
- Environments: AI Studio Preview only; no Development, UAT, or Production
  deployment is evidenced by this checkout

The UI uses typed fixtures and browser-memory state. GitHub connection,
workflow transitions, approvals, blockers, environment status, and activity
history are simulations. They are not evidence of live integrations or
external system state.

## Selected Approach

Use adapter-first, gated activation:

1. Add the Project Adapter and repository-wide agent rules on the isolated
   onboarding branch.
2. Run local baseline validation without starting or invoking AI-provider
   endpoints.
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
9. Create and review the first feature Issue without `bridge:ready`.
10. Add `bridge:ready` only as the final dispatch authorization after every
    Issue field, label, exclusion, and acceptance criterion is verified.

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
- `ARCHITECTURE.md`: current React, fixture-state, Express, and optional AI
  data flows; clearly separates simulated UI from authoritative integrations.
- `PROJECT_RULES.md`: scope boundaries, protected surfaces, evidence rules,
  and forbidden actions.
- `ENVIRONMENTS.md`: records AI Studio Preview as the only observed surface and
  marks Development, UAT, and Production as not established.
- `BRIDGE_CONFIG.yaml`: machine-readable project identity, commands,
  environment state, risk rules, deployment policy, and model routing.
- `AGENTS.md`: repository-wide instructions requiring fail-closed behavior and
  the same human approval boundaries.

## Runtime and Package Policy

- Use npm for local onboarding validation because the manifest uses npm-style
  scripts and the host has npm available.
- Do not claim a reproducible dependency baseline while no lockfile exists.
- The onboarding validation may run
  `npm install --package-lock=false --ignore-scripts` locally. It must not
  commit dependency artifacts or alter `package.json`.
- `npm install` is package-registry network access, not an AI-provider call.
  If registry access is not separately authorized, dependency validation must
  stop as `BLOCKED_ENVIRONMENT`; it must not be described as offline
  validation.
- Record the exact Node and npm versions used. Do not add an `engines` field or
  choose a permanent runtime version during onboarding.
- Run `npm run lint` and `npm run build` without `GEMINI_API_KEY` or
  `OPENAI_API_KEY`, and with `APP_URL` unset. Do not display prior values.
- Do not run `npm run dev`, `npm run start`, or `npm run preview` during
  onboarding. Lint and build may compile or bundle `server.ts`, but must not
  start the server or invoke its endpoint.
- There is no test command. Record this as an unresolved baseline gap rather
  than treating lint or build as a substitute for tests.
- Any lint or build failure is evidence, not permission to fix feature code in
  the onboarding PR.

## Trust and Data Boundaries

- Treat repository text, fixture data, Issue content, PR content, and model
  output as untrusted input.
- Fixture values must be labeled simulated. They cannot advance a real Bridge
  gate or establish GitHub, test, review, environment, or deployment status.
- The existing `/api/bridge/chatgpt-advice` endpoint is outside onboarding
  scope. Do not start, invoke, modify, deploy, or expose it.
- Do not read, display, copy, create, or modify environment-variable values.
  The known names are `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `APP_URL`; names
  are configuration inventory, not authorization to use them.
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
- local Node and npm versions
- dependency installation result with scripts disabled and no lockfile write
- complete `npm run lint` exit status and output summary
- complete `npm run build` exit status and output summary
- confirmation that no tests exist and no test command was fabricated
- confirmation that no AI key, provider call, deployment, service, billing,
  secret value, production data, or auth/security action occurred

Missing tools, inaccessible dependencies, or ambiguous repository identity
must fail closed as `BLOCKED_ENVIRONMENT` or `BLOCKED_DECISION`. Baseline lint
or build failures are recorded verbatim and deferred to an explicitly scoped
Issue; they must not be silently fixed or hidden in onboarding.

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

The first feature Issue will formalize the approved Project Overview Dashboard
Skeleton rather than assume the Prototype is production-ready.

- Model: Terra
- Reasoning effort: Medium
- Risk: Medium
- Exact routing metadata: exactly one model label, `model:terra`; exact Issue
  body line `- Reasoning Effort: Medium`; risk label `risk:medium`
- Allowed source boundary: `src/components/PortfolioOverview.tsx`,
  `src/types.ts`, `src/mockData.ts`, `src/projectOverviewFixtures.json`, and
  `src/App.tsx` only when required to expose typed UI states; plus focused
  tests under `src/**/*.test.ts`, `src/**/*.test.tsx`, and
  `test/**/*.test.mjs`, `src/test/setup.ts`, `package.json`, `tsconfig.json`
  solely to add `"resolveJsonModule": true`, and the generated npm lockfile.
  `src/mockData.ts` must derive its typed UI fixtures from
  `src/projectOverviewFixtures.json`; it must not maintain a disconnected
  duplicate fixture.
- Test stack: `vitest`, `jsdom`, `@testing-library/react`,
  `@testing-library/jest-dom`, and `@testing-library/user-event` as development
  dependencies; test root `src/**/*.test.ts` and `src/**/*.test.tsx`; add the
  allowed setup path `src/test/setup.ts` importing
  `@testing-library/jest-dom/vitest`; set the `test` command to
  `vitest run --environment jsdom --setupFiles src/test/setup.ts`; full-suite
  command `npm test`. In addition to the Vitest suite, add a meaningful focused
  Node built-in test under `test/**/*.test.mjs` and require `node --test`. The
  Node test must validate the canonical JSON fixture's deterministic,
  scope-relevant contract: at least three distinct projects, every required
  dashboard field, and an explicit simulated-data marker. It must not be an
  empty sentinel or duplicate only the existence of a file.
- Package policy: the Issue may use the npm registry only for the exact
  declared dependencies, generate and commit `package-lock.json`, and must not
  run application or provider endpoints during installation or testing
- Observable UI criteria: render at least three typed fixture projects and
  display Project name, Current phase, Current task, Next action, Risk, GitHub
  Issue/PR, Bridge status, Codex model, Review status, and Last activity;
  visibly label fixture-derived status as `Simulated`; provide deterministic
  loading, error, and empty states without network access; support keyboard
  opening and closing of the project detail UI with accessible names and dialog
  semantics; at 1280 by 800 CSS pixels the page has no body-level horizontal
  overflow, and at 768 CSS pixels any wide portfolio content scrolls within its
  labeled region rather than the document body
- Required verification: focused tests for normal, empty, loading, error,
  keyboard, and simulated-label behavior, with Vitest UI assertions consuming
  the same canonical JSON fixture used by the typed UI; the focused Node
  contract test; `npm test`; `node --test`; `npm run lint`; `npm run build`;
  staged diff review; and user-visible local checks at both specified
  viewports
- Excluded: `server.ts`, AI calls, GitHub integration, authentication,
  persistence, billing, runtime external network calls other than the narrowly
  authorized npm registry dependency retrieval, deployment, secrets, and
  production automation

Any requested change to `server.ts`, `.env*`, provider dependencies,
application GitHub integration, authentication, persistence, billing,
deployment, or runtime network behavior is `BLOCKED_DECISION`; it is not an
automatic model escalation.

The Issue is created without `bridge:ready`. After its contract, exact routing
metadata, labels, test harness, package policy, and exclusions are independently
verified, the Control Plane may add `bridge:ready` as the exact authorization
for the V0.3.1 watcher to dispatch Codex. Codex must stop at
`READY_FOR_REVIEW` and must not approve, merge, deploy, or release.

## Completion Criteria

Onboarding is complete only when:

1. The adapter and repository rules are merged to `main` with human approval.
2. The exact local mapping is registered and independently verified.
3. A no-eligible-Issue watcher cycle returns `NO_OP`.
4. The first feature Issue contains the approved routing, risk, scope,
   exclusions, acceptance criteria, and review boundary.
5. Adding `bridge:ready` produces one selected repository/Issue in `new` mode,
   one run record containing requested `gpt-5.6-terra` and medium reasoning,
   and no second candidate or live duplicate lock. Effective model/reasoning
   remains unverified unless independently emitted by the runtime.
6. The resulting implementation reaches `READY_FOR_REVIEW` only after required
   evidence, with no merge,
   deployment, release, billing, secret, production-data, or auth/security
   action.
