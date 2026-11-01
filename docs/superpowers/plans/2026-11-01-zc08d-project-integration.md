# ZC-08D Project Integration Implementation Plan

> Execute inline with superpowers:executing-plans; one independent bounded review at the end.

**Goal:** Owner-approved Inventory and grouped Zero-Copy monitoring in existing V1.
**Architecture:** Reuse #97's monitor and #102's fixed-target normalizer. An explicit catalog is separate from saved-state registrations. Reuse the two existing history GET routes, with exact repository identity validation and bounded status evidence. One selected repository per river; never combine commit graphs.
**Tech Stack:** Existing React/TypeScript, Express, gh GET, node:test and Vitest. No dependencies.
**Spec:** Issue #103 (Product Contract, exact file allowlist and permission boundary).

## Global constraints
- No credentials, auth, provider, persistence, server.ts or global configuration changes.
- No writes to monitored repositories, UAT/Production, merge/deploy or real-agent execution.
- Catalog is approved configuration, never saved registration or GitHub evidence.
- GitHub failure, identity mismatch, incomplete or old evidence cannot produce current PASS. Agent = NOT_CONNECTED.
- Stop at READY_FOR_REVIEW; actual Safari acceptance and release approval remain separate gates.

## Review focus
- Redirect/rename/transfer and lookalike repository identities must fail before dependent reads.
- PR head movement during CI reads and stale snapshots must not yield current-head success.
- Missing, historical or ambiguous Codex reviews must remain UNKNOWN/STALE, never approval.
- Delayed responses while changing repository must not cross-contaminate UI state or graphs.
- Empty/unavailable saved state and demo entries must not become authoritative registrations.

### Task 1: Identity and bounded evidence
**Files:** catalog, githubDevelopmentHistory, githubRoutes, zc08bStatusModel, projectStatusModel, focused server tests.
- [x] Write and run failing identity, exact allowlist, target, stale and head-drift tests.
- [x] Add approved catalog identities; validate GitHub numeric id/full_name and PR base identity. Reuse existing GETs and bound status reads.
- [x] Preserve #102 synthetic provenance; trusted GitHub adapter reuses its computation only after source validation.
- [x] Run focused tests and commit.

### Task 2: Project journey
**Files:** ReadOnlyCommandCenter, ProjectWorkstreams, ProjectIntegration tests, existing monitor/map and CSS/types.
- [x] Write and run failing project/repository selection tests.
- [x] Add catalog cards, grouped ZC selector and four workstreams; selected repo alone drives map and monitor.
- [x] Verify late responses, UNKNOWN/STALE and GET-only behavior with UI tests; preserve saved-state safety regressions.
- [x] Run relevant regression, typecheck and build; commit.

### Task 3: Delivery and review
**Files:** isolated QA workflow and integration documentation.
- [x] Record dependency/source/permission audit and exact Safari local launch/checklist.
- [x] Run full deterministic UI and scoped Node suites, distinguishing environment/known failures.
- [ ] Independent review of actual diff, allowlist, privacy, freshness and topology; fix material findings once and recheck affected scope.
- [ ] Push scoped branch, create Draft PR, verify exact-head CI and report outstanding UAT/release gates.

## Execution ledger
- Native worktree creation could not use a repository outside this project's attached roots. Ruling: use isolated local clone inside the writable project; preserve the dirty original checkout.
- #97 and #102 files restored from exact audited SHAs; no changes to either existing branch.
- Existing gh credentials already permit metadata reads for all three additions. No new login, permissions or secret access.

- Task 1/2 validation: 204/204 scoped Node tests; 274/274 UI tests; TypeScript and Vite/server bundles PASS. Refresh failure regression observed RED then GREEN. Offline dependency inventory: 313 installed package entries, zero version mismatches against package-lock.
- Ruling: do not execute unrelated real Docker or provider integration suites; risk-based regression covers the changed read-only integration and V1 runtime boundary.
