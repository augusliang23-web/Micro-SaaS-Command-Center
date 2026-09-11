# Remove the Duplicate-Named Fixture "PM Dashboard" Project — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-11
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Same-day repeat of `2026-09-11-remove-duplicate-name-fixture-project-non-bridge.md`. After pushing pending commits, the owner looked at two project cards — "Pm Dashboard" and "Pm Dashboard Uat" — and asked to confirm whether both really were only at PR #4 (they were; each is an independent GitHub repo with its own independent PR numbering, so both happening to have exactly 4 merged PRs so far is a real coincidence, not a data mix-up — verified by inspecting each repo's actual `origin/main` merge-commit history directly).

While investigating, found the owner had separately connected the real `augusliang23-web/pm-dashboard` (production) repo himself via "+ 接入新專案" at some point (`proj-pm-dashboard-0910` in persisted state) — not something done in this session. This created the exact same collision as the Command Center fixture from the prior record: `mockData.ts` still had an old fixture project also named "PM Dashboard" (`proj-pm-dash`, fake `github.com/my-org/pm-dashboard` repository), sitting alongside the newly-real one. Flagged this proactively and the owner confirmed removing it too.

## What shipped

- **`src/mockData.ts`** — removed the entire `proj-pm-dash` fixture project object (including its `features` array and `projectProvenance('proj-pm-dash')` call) from `initialProjects`.
- **`data/app-state.json`** (gitignored local runtime state, not committed) — removed the matching already-persisted entry. Confirmed no `attentionItems`/`nba` references first.

## Verification

- `npm run lint`, `npm test` (93/93), `npm run test:ui` (5/5), `npm run build` all green.
- `GET /api/state` — confirmed 7 projects, no `id === 'proj-pm-dash'` entry, exactly one "Pm Dashboard" (real, `augusliang23-web/pm-dashboard`) and one "Pm Dashboard Uat" remaining.
- Manual browser check + `read_console_messages` — no errors.

## Boundaries respected

Pure fixture-data removal, same pattern as the immediately-prior record. No changes to `server.ts`, `.env*`, or protected routes. Did not add `bridge:ready` or open/modify any GitHub Issue.
