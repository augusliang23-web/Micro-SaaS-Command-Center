# V1 Phase 1 — Trust Foundation + UI Baseline Validation

## Baseline / Safety
- Date: 2026-10-03, Asia/Singapore.
- Original checkout: /Users/augusliang/Developer/Micro-SaaS-Command-Center, main.
- Audited HEAD and remote main verified identical: a4a49e72c53f75d85e95e51326715654135225a3.
- Eight existing dirty files were preserved; initial and final path lists and SHA-256 contents matched. No reset/stash/overwrite/commit in the original checkout.
- Isolated worktree: /Users/augusliang/Developer/worktrees/command-center-v1-trust, branch codex/v1-trust-foundation, exact audited base.
- The native worktree tool targets the calling chat's checkout, which is a non-Git project mirror and cannot select the target repository. Used Git's worktree capability in an external directory; no original working-tree files changed.
- Copied installed dependencies as independent files into this worktree; no shared dependency symlink, registry access, .env/secrets copy or original environment settings change.
- Runtime state copied read-only from original data/app-state.json into ignored worktree data/. Removed localPath only from this disposable copy to prevent automatic git fetch against the dirty original clone. Stored six-project dataset otherwise retained.
- Service ran only on loopback http://127.0.0.1:3000. No provider, bridge execution, cloud/settings change, merge or deploy.

## Root Cause Fixes
- Replaced loose verdict fallbacks with one canonical IDLE / IN_PROGRESS / NEEDS_CONFIRMATION / BLOCKED / UNKNOWN derivation.
- One shared GitHub observation context for card, drawer, filters, attention, recommendation and counters. No independent card/drawer/hero status requests.
- Successful observations expire after five minutes. Refresh clears optimistic evidence immediately, validates per-state payloads, rejects obsolete responses and times out requests. Missing/stale/failed evidence is UNKNOWN; source availability is visible.
- Only in-progress CI is execution evidence. Queued checks wait for confirmation; saved AI_RUNNING/idle fields cannot attest agent activity.
- No CI, unknown/skipped/neutral conclusions or incomplete check-runs responses cannot attest passing. A known failure remains blocked even alongside running checks.
- Merged code does not attest checks or deployment. Removed raw Healthy/waiting badges from real drawer heading. Retained saved raw fields/provenance in labeled detail. AI summaries are labeled as historical generated content rather than check/deployment evidence.
- Three example repositories are excluded from default real project counts, priority and recommendations. Fixture provenance is not used to identify demos because connected real projects also have legacy fixture fields.
- Removed fixed Live Sync and fake refresh success. Last checked records actual browser-side query attempts; failures show UNAVAILABLE. Changed nonfunctional activity sort to actual verified query-time sorting, unknown/missing timestamps last.
- Failed/malformed saved-state loads disable autosave and display UNAVAILABLE rather than writing fixtures over stored data. Recognized fresh-install 404 remains supported.

## Files Changed
- Canonical status: src/verdict.mjs; shared observation lifecycle: src/hooks/useProjectVerdicts.ts; read validation: src/savedState.mjs; CI completeness/aggregation: server/githubPullStatus.mjs; CI enum: src/types.ts.
- Consumers: App, CockpitHeader, PortfolioOverview, ProjectVerdictCard, ProjectDetailDrawer, NextBestActionCard, NeedsAttentionQueue, AIExecutionSnapshot.
- Tests: test/verdict.test.mjs, test/github-pull-status.test.mjs, src/TrustFoundation.test.tsx, src/hooks/useProjectVerdicts.test.tsx; complete API fixtures: src/test/githubSnapshots.mjs.
- Plan and this evidence directory (screenshots included). No dependency, provider, persistence-write/server routing or deployment changes.

## Tests / Build
- Baseline: Node 117/117. Replaced tests asserting unsafe old verdict behavior; final suite total therefore differs.
- Focused canonical/CI: 31/31.
- Full Node suite (`node --test test/`, same as npm test): 115/115.
- Full UI suite (`vitest run`, same as npm run test:ui): 19/19 across five files.
- Lint/type check (`tsc --noEmit`, repository lint script): PASS.
- Build (`vite build` + repository esbuild server command): PASS exit 0.
- Existing warning: server.ts uses import.meta in CommonJS output. server.ts/package.json are unchanged from baseline. This is not production runtime validation; the existing production start artifact remains a separate follow-up.
- Tests include all eight requested cases, neutral/skipped/incomplete CI, queued vs running, late response, repository replacement, five-minute expiry, malformed source data, failed refresh invalidation, no autosave on failed/malformed state reads, and fresh empty portfolio.

## UI Smoke Evidence
Actual Codex in-app browser, baseline and final app, not synthetic screenshots:
- baseline-home.jpg: six projects including demo; ProSync demo recommended; direct commit reported as AI running; fixed Live Sync.
- baseline-drawer.jpg: stored Healthy badge and unsupported checks-ready headline.
- after-home.jpg: only three real projects; observed review/idle/missing-CI meanings, Last checked and source state.
- after-drawer.jpg: merged PR idle, deployment unconfirmed, no checks-passed badge; retained raw evidence.
- after-refresh-unavailable.jpg and after-drawer-unavailable.jpg: actual local server launched with an empty GH_CONFIG_DIR under worktree data/ (no original CLI config changed), producing failed GitHub access. All views became UNKNOWN/UNAVAILABLE; unknown filter retained all three projects; no false success toast.
- Actual filter smoke: attention=2 returned two matching real projects; CI-running=0 returned zero; IDLE selected only UAT; UNKNOWN selected all three during source failure.
- Restored ordinary local service environment after error smoke. The test-only empty GitHub configuration was process-local.

## Before vs After
| Before | After |
| --- | --- |
| Saved idle / historical direct commit → AI running | Only explicit CI execution → IN_PROGRESS; idle/history not AI evidence |
| No CI/review evidence → checks passed / continue | NEEDS_CONFIRMATION or UNKNOWN; no passing claim |
| Merge → passed-standard-check badge | IDLE, deployment unconfirmed; no inferred check result |
| Demo drives next action / totals | Default real projects only |
| Fixed Live Sync / simulated refresh | Actual query attempts, checked time, source availability and shared invalidation |

## Independent Review
Read-only reviewer requested GPT-5.6 Sol High. Three Important findings were reproduced with failing tests then fixed: malformed valid-state payloads; partial CI page; malformed saved-state autosave. Empty-portfolio positive sync wording also corrected. Fresh-context review otherwise confirmed shared status, demo exclusion, stale responses and labeled raw boundaries. No second implementation agent, no Astra escalation. Primary execution model/reasoning and credit/token telemetry are not exposed; no usage or cost figures asserted.

## Known Limitations
- Still observes only the newest open PR (or relevant merged/direct commit); no Development Map or complete workstream representation.
- Check-runs incomplete pages deliberately produce unknown rather than fetching further pages. Only GitHub check-runs are observed; other check/status systems and required branch-protection completeness are not attested.
- No agent execution or deployment source is connected. Model numbers are saved assignments, explicitly not runtime model telemetry.
- Read-only query snapshot, five-minute freshness threshold; refresh is manual, no automatic agent polling.
- Demos retained in saved data but excluded from default UI; no new Demo-mode editor in this phase.
- Existing production server bundle warning and production-start behavior are outside scope; no production readiness or deployment claim.
- Original dirty changes were not incorporated; future integration must review their overlap separately.

Result: READY_FOR_REVIEW. Commit and PR are the delivery boundary; no merge or deploy authorization.
