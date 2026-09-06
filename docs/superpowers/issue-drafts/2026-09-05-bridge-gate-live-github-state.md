# Bridge Gate & Project Card: Replace Fabricated GitHub/CI State with Real, Read-Only Signals

- Reasoning Effort: High
- Risk: Medium
- Required Model Label: `model:sol` (architecture/mapping decision), `model:terra` (implementation once the mapping is approved)
- Required Risk Label: `risk:medium`
- Bridge Authorization: NOT GRANTED; do not add `bridge:ready`

## Observed symptom

After [#391de15](../../../server/githubRoutes.mjs) made the repo picker (step 1 of Connect Repo) show real GitHub repositories, the owner connected the real `augusliang23-web/pm-dashboard-uat` repo and the resulting project card still showed obviously fabricated state: `Run ID: run-init-8340`, `GitHub Issue: #1 Initial Onboarding`, a full 9-step DISCUSS→DONE gate pipeline reset to "just started," `CI: PENDING` / `REV: PENDING`, and a non-existent staging URL. None of this reflects the real repository.

## Root cause

`handleConfirmConnect` in `src/components/ConnectRepoModal.tsx` (roughly lines 156–317) builds a brand-new `MicroSaaSProject` from a single hardcoded template every time *any* repo is connected, regardless of which repo was picked. The fields below are fabricated, not derived from GitHub:

- `executionContext.githubIssue`: literal string `'#1 Initial Onboarding'`
- `executionContext.bridgeRunId`: `` `run-init-${random 4-digit number}` ``
- `executionContext.contextTokens`: literal `'1,240 tokens'`
- `gates`: a fixed 9-step array, always reset to the same labels/detail text with only `status` varying by the manually-picked `initialGate`
- `environment.staging.url`: `` `https://staging-${repoName}.dev` `` — a URL that doesn't exist
- `testOutcome` / `reviewOutcome`: always `'PENDING'`

This is a separate code path from the GitHub-repo-listing work just shipped; that work only made **step 1** (which repos are pickable) real.

## Relationship to the pending provenance plan

[`docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md`](2026-09-02-prototype-state-provenance-safety-guardrails.md) designed a `src/statusProvenance.mjs` authority system (`fixture` / `user-entered` / `AI-candidate` / `GitHub-observed` / `CI-observed` / `deployment-observed`) specifically so fixture/fabricated data can never render as if it were authoritative. **That plan has not been implemented yet** — `src/statusProvenance.mjs` does not exist in this checkout. Recommend landing (or at least concurrently designing) that provenance layer before or alongside this task, so partially-real data introduced here doesn't create a new, subtler version of the same confusion the owner just flagged: a card that mixes one real field with eight fabricated ones, with no visual way to tell which is which.

## Scope (for the architecture decision, before implementation)

Decide, with tradeoffs made explicit, how much of the project card should become GitHub-observed and how:

- **Definitely real, low-ambiguity**: default branch, latest commit SHA/timestamp, open PR count and state, latest GitHub Actions workflow run conclusion (success/failure/running/none) — all directly available from the GitHub REST API via the same `gh api` server-side pattern used in `server/githubRepos.mjs`.
- **Ambiguous, needs a policy decision**: the 8-Gate Bridge pipeline (DISCUSS/SPECIFY/ROUTE/IMPLEMENT/TEST/REVIEW/APPROVE/DONE) is this product's own governance concept — it has no native 1:1 GitHub equivalent. Options to evaluate: (a) leave gate progression as an explicit, honestly-labeled manual/local state (not fabricated boilerplate text) and only surface real GitHub facts alongside it without claiming they drive the gate; or (b) infer gate state from GitHub signals (e.g., open PR → IMPLEMENT, CI running → TEST, review requested → REVIEW, merged → DONE) — higher value but higher risk of a wrong inference being read as authoritative progress.
- **Must not silently happen**: `contextTokens`, `bridgeRunId`, and the literal `'#1 Initial Onboarding'` string must stop being invented; either remove them from the card or replace with real values (real GitHub Issue reference only if the user links one explicitly — do not guess an Issue number).

## Verification (once scope is approved)

- Extend `test/github-repos.test.mjs` or add a sibling test file covering the new read-only GitHub signal fetch(es), including not-found/not-authenticated/rate-limit error paths.
- `npm run lint`, `npm test` must pass.
- Manual browser verification: connect a real repo with a real open PR and a real Actions run, confirm the card shows that repo's actual PR/CI state and not template text; connect a repo with no PRs/no Actions runs and confirm an honest empty state (not a fabricated "PENDING").

## Exclusions

Same boundaries as the rest of this checkout's governance: no writes back to GitHub (issues, PRs, comments, labels, merges), no `.env*` changes, no billing/deployment/production automation, no changes to `/api/bridge/chatgpt-advice` or `/api/bridge/extract-features`. This stays read-only against GitHub, same as `server/githubRoutes.mjs` today.

## Status

**Superseded by implementation (2026-09-06).** The owner chose option (b) from the Scope section above (infer state from GitHub signals, no manual clicking) and had it implemented via direct chat instruction outside the Bridge/Issue flow — see `docs/superpowers/evidence/2026-09-06-real-github-signal-verdicts-non-bridge.md` for what shipped (`server/githubPullStatus.mjs`, `GET /api/github/pull-status`, `src/verdict.mjs`'s GitHub-driven path). This document remains as the historical record of the architecture question and options considered; it never went through the formal Bridge/Issue/`bridge:ready` process described below, and none of that changes retroactively.

This was a local planning document only. It was never posted as a GitHub Issue and carried no dispatch authorization. `bridge:ready` must not be added retroactively; the formal preflight (exact Issue, allowlisted files, model/reasoning/risk labels, `bridge:ready`) per `CLAUDE.md` was never recorded for this work.
