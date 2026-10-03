# V1 Trust Foundation Implementation Plan

Agent: Codex
Model: session model (requested GPT-5.6 Sol if selectable)
Reasoning: High requested; telemetry unavailable

**Goal:** Make homepage and drawer status evidence-based and consistent.
**Architecture:** One canonical derivation in verdict.mjs and one shared observation store in useProjectVerdicts.ts. Cards, drawer, filters, attention and recommendation consume the same result. Fresh GitHub observations override saved fixture fields; unavailable/stale data never falls back to them.
**Spec:** User-authorized V1 Phase 1 A–F and eight acceptance cases in this chat.

## Constraints
- Base a4a49e72c53f75d85e95e51326715654135225a3; preserve eight dirty main files byte-for-byte.
- Worktree only. No merge, deployment, provider calls, cloud/settings changes, Development Map or Cost Guard.
- Default real projects only; demos remain stored but excluded from all homepage consumers.
- No dependency or persistence schema migration required. Unknown is actionable for checking evidence, never safe/healthy.

## Tasks
- [x] Verify main/remote, isolate branch, copy dependencies independently, run baseline Node tests, launch baseline browser and save screenshots. Runtime dataset copy excludes localPath to avoid any fetch against the original main clone.
- [x] Write failing canonical status tests covering idle, missing CI, waiting review, explicit execution, blocked, stale/missing/malformed data, merge vs deploy, demo exclusion and sorting.
- [x] Implement canonical getVerdict(project, githubState, observationOptions), attention/ranking/filter helpers and observation validation. Keep raw fields stored and detail-accessible.
- [x] Share one project observation context; fail closed during initial load/refresh/error; handle expiry and stale request races.
- [x] Connect App, card, drawer, overview, recommendation, attention, header and counters to the shared results. Replace fixed Live Sync; use actual checked timestamps and honest sorting.
- [x] Add rendered UI tests for consistency, exclusion and refresh error invalidation; verify focused/full Node + UI tests, lint/build and actual browser smoke.
- [x] Review diff and evidence, verify original main hashes, commit, push and create/attach PR. Stop READY_FOR_REVIEW.

## Review focus
- In-flight refreshes and project/repository replacement cannot restore obsolete successful evidence.
- CI neutral/unknown outcomes must not be called passing.
- Missing timestamps and offline initial state cannot fall back to Healthy/AI_RUNNING.
- Draft/review-required and merged PRs must not imply agent execution, approval or deployment.
- No auto-persistence of failed initial load over stored projects; preserve raw details with provenance labels.

## Final validation and decisions
- Focused canonical/CI 31/31; full Node 115/115; UI 19/19; tsc and build exit 0. Existing unchanged server import.meta/CJS warning remains.
- Three independent Important findings reproduced RED and fixed GREEN: malformed snapshots, incomplete check-runs page, malformed saved-state autosave. Empty portfolio wording corrected.
- Source failure browser smoke and original main path/hash checks passed. Actual snapshots included in evidence/v1-trust/.
- Sorting renamed to verified query time because complete activity timestamps are unavailable for open PRs. Incomplete check pages fail closed rather than adding pagination in this phase.
- Exact user execution request authorizes this UI/status task and PR; repository Bridge issue/label workflow does not require an additional approval for this explicitly scoped non-Bridge task. No provider boundary or server networking/persistence-write changes.
- User already selected commit + PR with no merge/deploy; no integration-choice prompt needed. Worktree retained for review.
