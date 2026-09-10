# Hide the Legacy 8-Gate Bridge Section for Real, GitHub-Connected Projects — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-10
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

The owner opened pm-dashboard-uat's drawer, expanded "技術細節", and asked why the "Bridge ↔ CI/CD 8-Gate 流水線軌道" section still showed `DISCUSS` / "Just now" despite the project having weeks of real activity. Investigated and explained: this 8-Gate model (DISCUSS/SPECIFY/ROUTE/IMPLEMENT/TEST/REVIEW/APPROVE/DONE) has no real-world counterpart observable from GitHub — there's no API that tells you "is this repo in SPECIFY vs ROUTE." `ConnectRepoModal.tsx` sets `currentGate` to whatever the connecting user picked in a dropdown (defaulting to `DISCUSS`) at connection time, and nothing has ever updated it since — it's frozen fixture state, not a real signal gone stale.

The owner agreed this can't be made real (making it "real" would mean inventing arbitrary guess-rules mapping GitHub facts onto Bridge-specific stages — the same kind of fake-precision this whole redesign has been removing) and asked to remove it, plus requested an inventory of any other similarly-frozen sections for a follow-up review.

## What shipped

`src/components/ProjectDetailDrawer.tsx`, Section 2 ("Bridge Workflow Lifecycle Visualization", the 8-Gate rail + Gate Inspector + Approve/Advance buttons) is now wrapped in `{!isRealGithubRepo(project.repository) && (...)}`. It still renders for fixture/demo projects (where it's an honestly-labeled simulated illustration of the Bridge concept, not a stale claim about anything real) but is hidden entirely for real, GitHub-connected projects.

## Inventory of the drawer's other technical-detail sections (requested by the owner, not yet acted on)

Audited every section inside the drawer's "顯示技術細節" toggle for the same class of problem — frozen fixture data set once at connection and never updated by real signals — for a project like pm-dashboard-uat:

| # | Section | Content | Real or frozen fixture? | Currently labeled "Simulated / Prototype"? |
|---|---|---|---|---|
| 1 | Current Focus & Attention Gates | Current Task, Next Action, Assigned Model, Current Blocker | Frozen fixture (`project.currentTask`/`.nextAction`/`.model`/`.blocker`, never updated after connection) | **No** — no `ProvenanceBadge` on this section |
| 2 | Bridge 8-Gate Pipeline | Gate rail, Gate Inspector | Frozen fixture | Yes — **now hidden for real projects**, this record |
| 3 | Execution Context | GitHub Issue, Pull Request, Branch, Model, Risk, Routing Reason | Frozen fixture — and notably, its "Pull Request" field can show something like "Pending Creation" while the real verdict card at the top of the *same drawer* links to an actual real, open/merged PR — a direct, visible contradiction within one screen | Yes — has `ProvenanceBadge` |
| 4 | Environments & Versioning | Prod/Stage version numbers, deploy status, uptime metrics | Frozen fixture | Yes — has `ProvenanceBadge` |
| 5 | Feature Delivery Matrix | Feature list, flag states | Frozen fixture unless manually extracted via the AI-advisor-sync button | **No** — no `ProvenanceBadge` |
| 6 | Context Memory Timeline | Activity log entries | Frozen fixture (only the "Repository Connected" entry is genuinely tied to a real event; everything else is whatever fixture activity history the project started with) | **No** — no `ProvenanceBadge` |

**Key finding:** sections 3 and 4 already honestly disclose their simulated nature via the existing `ProvenanceBadge` (`src/statusProvenance.mjs`'s fail-closed provenance system, built earlier this project). Sections 1, 5, and 6 show the *same class* of frozen fixture data with **no disclosure at all** — arguably more misleading than the ones already labeled, since a user has no visual cue they're looking at simulated state. Section 3 additionally has a concrete, visible internal contradiction (its own "Pull Request" field vs. the real PR the verdict card above it links to) that's worse than simply being frozen.

This inventory is informational — no further sections were changed this pass. The owner will decide next steps per section (remove for real projects like the 8-Gate rail, add `ProvenanceBadge` disclosure where missing, or something else) in a follow-up.

## Verification

- `npm run lint`, `npm test` (93/93), `npm run test:ui` (5/5), `npm run build` all green.
- Manual browser check: pm-dashboard-uat's drawer (real repo) — confirmed the 8-Gate section no longer renders at all under 技術細節. ProSync's drawer (fixture project) — confirmed the 8-Gate section still renders exactly as before, unaffected.

## Boundaries respected

Pure UI-visibility change (a conditional render), no data or dispatch logic touched. No changes to `server.ts`, `.env*`, or protected routes. Did not add `bridge:ready` or open/modify any GitHub Issue.
