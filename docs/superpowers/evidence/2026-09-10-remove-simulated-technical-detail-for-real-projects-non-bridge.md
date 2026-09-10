# Remove All Simulated "技術細節" Sections for Real, GitHub-Connected Projects — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-10
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Direct follow-up to the same-day 8-Gate hiding
(`docs/superpowers/evidence/2026-09-10-hide-legacy-8gate-for-real-projects-non-bridge.md`),
which produced an inventory of the drawer's other technical-detail
sections showing the same "frozen fixture, not real" problem. After that
inventory, the owner said plainly: "我感覺現在command center很多都不是真實狀態跟資料，我不知道從何判斷" (a lot of what's in Command Center doesn't feel real, and I don't know how to tell). Offered a choice between (a) adding consistent "Simulated" labels to the sections missing them, or (b) removing all the fake sections outright for real projects, matching the 8-Gate precedent. The owner chose **(b) — remove them, not just label them**.

## What shipped

`src/components/ProjectDetailDrawer.tsx` — the "顯示技術細節" toggle button and everything behind it (sections 1 through 6) are now wrapped in a single `{!isRealGithubRepo(project.repository) && (...)}` block. For a real, GitHub-connected project, none of it renders at all — not the toggle, not any of the six sections. For a fixture/demo project, everything renders exactly as before.

This removes, for real projects specifically:
- **Section 1 (Current Focus & Attention Gates)** — Current Task/Next Action/Assigned Model/Current Blocker, all frozen at connection time; plus a "發起改版" banner gated on the frozen `currentGate === 'DONE'` check that could never honestly fire for a real project anyway.
- **Section 2 (8-Gate pipeline)** — already hidden in the prior commit; the redundant inner `!isRealGithubRepo` check on this section was removed since it's now covered by the outer one.
- **Section 3 (Execution Context)** — GitHub Issue/PR/Branch/Model/Risk/Routing Reason, frozen fixture. This was the section with a live, visible contradiction: its own frozen "Pull Request" field could disagree with the real PR the verdict card above it links to.
- **Section 4 (Environments & Versioning)** — Prod/Stage version numbers and deploy status, frozen fixture, plus a "1-Click Promote" / "推進關卡" button that silently called the same fake gate-advancing handler as the old 8-Gate section.
- **Section 5 (Feature Delivery Matrix)** — its "從 GitHub 倉庫 Issues / PRs 讀取" tab turned out to read from a literal hardcoded array named `mockRepoIssues` in `FeatureDeliveryMatrix.tsx`, not a real API call, confirmed by reading the source before deciding to remove this section too.
- **Section 6 (Context Memory Timeline)** — `project.activityHistory`; only the single "Repository Connected" entry set at connection time is genuinely tied to a real event, everything else in a project's history is fixture.

## Verification

- `npm run lint`, `npm test` (93/93), `npm run test:ui` (5/5), `npm run build` all green.
- Manual browser check: pm-dashboard-uat's drawer (real repo) — confirmed the 技術細節 toggle button itself no longer renders, and none of sections 1/3/4/5/6 (nor 2, already hidden) appear. ProSync's drawer (fixture project) — confirmed the toggle and all six sections still render exactly as before, unaffected.

## Known gaps / deliberately out of scope

- Real projects now get a *shorter* drawer than fixture projects (verdict card + manual decision UI when applicable, nothing else) — this is an intentional asymmetry, not a bug: real projects only get to show what's actually real, and today that's just the verdict.
- Section 5's `mockRepoIssues` array and the underlying fixture-only Feature Delivery Matrix concept are unchanged in `FeatureDeliveryMatrix.tsx` itself — only its *reachability from a real project's drawer* was removed. Fixture projects can still use it exactly as before.
- No attempt was made to build a *real* replacement for any of these six sections (e.g. an actually-GitHub-Issues-backed feature tracker, or a real deployment-status source) — that would be new feature work, not a "stop showing fake things" cleanup.

## Boundaries respected

Pure UI-visibility change (one added conditional wrapping existing JSX), no data or dispatch logic touched. No changes to `server.ts`, `.env*`, or protected routes. Did not add `bridge:ready` or open/modify any GitHub Issue.
