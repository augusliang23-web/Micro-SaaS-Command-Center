# Real GitHub PR/CI Signals Drive Verdicts — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-06
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow described in the committed `CLAUDE.md`. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

This closes the architecture question left open in [`docs/superpowers/issue-drafts/2026-09-05-bridge-gate-live-github-state.md`](../issue-drafts/2026-09-05-bridge-gate-live-github-state.md) — option (b) there ("infer gate state from GitHub signals") was chosen by the owner, who explicitly rejected manual clicking as the source of truth once a project is really connected to GitHub. It also extends [`src/verdict.mjs`](../../../src/verdict.mjs) from the same-day plain-language redesign (see `2026-09-06-plain-language-verdict-ui-non-bridge.md`), which previously only translated manually-set `waitingState`/`blocker` fields.

## What shipped

- `server/githubRepos.mjs` — extracted a reusable `ghApiJson(path, { execFileFn })` low-level `gh api` caller out of `fetchGithubRepos` (no behavior change; existing tests still pass unmodified).
- `server/githubPullStatus.mjs` (new) — `fetchPullRequestStatus(repo)`: finds the repo's newest open PR (if any), and its check-runs + review aggregate; falls back to the newest merged PR when nothing is open; returns `{ state: 'none' }` when there's no PR history at all. Pure aggregation helpers `aggregateCiStatus` and `aggregateReviewDecision` are exported and unit-tested independently. `isRealGithubRepo(repo)` guards against the six built-in fixture projects, whose `repository` field (`github.com/my-org/...`) isn't a real `owner/repo` slug and has no repo behind it to query.
- `server/githubRoutes.mjs` — new `GET /api/github/pull-status?repo=owner/name` route, same loopback-origin guard as `/repos`, same `GithubCliError` → HTTP status mapping (401 not authenticated, 503 gh missing, 502 other failure), 400 for a malformed `repo` param.
- `src/verdict.mjs` — `getVerdict(project, githubState?)` now takes an optional second argument. When provided, `getVerdictFromGithub()` drives the verdict purely from real signals (no manual field is consulted): draft PR → waiting; failing CI or changes-requested review → danger; running CI → waiting; passing CI with no blocking review → ready; merged → ready (with an explicit "merged into main, not necessarily deployed" caveat baked into the copy); no PR history → waiting. Every verdict now carries a `source: 'github' | 'manual'` field. The `decision` level is deliberately never produced by this path — GitHub has no signal for "needs a product decision," and forcing one would mean inventing it, which was ruled out.
- `src/components/PortfolioOverview.tsx` — `ProjectVerdictCard` now fetches `/api/github/pull-status` on mount for any project whose `repository` looks like a real `owner/repo` slug, feeds the result into `getVerdict()`, and adds a small manual refresh icon. The "技術細節" (technical detail) expand section branches: real GitHub-linked cards show the actual PR link/CI/review facts (labeled "即時查詢 GitHub 得到的真實狀態"); everything else still shows the previous manually-set Gate/Test/Review badges — the two are never mixed on one card, to avoid recreating the "one real field among fabricated ones" problem this whole day's work has been about removing.

## Verification

- `npm run lint` (`tsc --noEmit`) — exit 0.
- `npm test` (`node --test test/`) — 77/77 passing (60 pre-existing + 7 new `github-pull-status.test.mjs` + 9 new/changed `verdict.test.mjs` covering the GitHub-driven path, including an explicit assertion that the `decision` level is never produced from GitHub state, and one more router-construction test for the injected `fetchPullStatus`).
- `npm run test:ui` (`vitest run`) — 5/5 passing, unaffected.
- `npm run build` — succeeded.
- Manual browser verification against the owner's **real, currently-connected repos** (not synthetic fixtures): `augusliang23-web/pm-dashboard-uat` and `augusliang23-web/Micro-SaaS-Command-Center` both have no open PRs but do have real merged history (confirmed independently via `gh pr list --repo ... --state all`: PR #1 merged for pm-dashboard-uat, PR #11 most recently merged for Micro-SaaS-Command-Center). The app correctly showed both as "都檢查過了，可以繼續了" with the real PR number and a working link to the real merged PR in the expanded technical detail — matching `gh pr list` exactly, not template text. The fixture `ProSync` project (fake `github.com/my-org/...` repository) correctly fell back to the manual `decision`-level verdict path unaffected by this change. Confirmed via `read_network_requests` that all `/api/github/pull-status` calls returned `200 OK`; no other console errors besides the sandboxed preview's own unrelated Vite HMR WebSocket noise.

## Known gaps / deliberately out of scope

- **"Merged" is not "deployed."** No deployment signal source exists yet (Vercel/Railway/etc. aren't wired up); the copy is explicit about this rather than implying production changed.
- **No product-decision detection.** The `decision` verdict level only appears for projects still on the manual path (no real repo link). A GitHub-linked project with, say, an ambiguous product question buried in a PR description will not surface as `decision` — there's no generic signal to detect that.
- **Fetch timing**: on-demand (mount + manual refresh button) per the earlier design discussion, not polling or webhooks — matches a personal, loopback-only tool; means the card can go briefly stale between refreshes.
- **One PR assumed per repo.** `fetchPullRequestStatus` only looks at the single most-recently-updated open (or merged) PR. A repo with multiple concurrent open PRs only surfaces one of them.

## Boundaries respected

Read-only against GitHub throughout (no comments, merges, approvals, or label writes). Did not touch `/api/bridge/chatgpt-advice`, `/api/bridge/extract-features`, `server.ts`'s existing routes beyond mounting the one new endpoint, `.env*`, billing, deployment, or secrets. Did not add `bridge:ready` or open/modify any GitHub Issue. Changes remain uncommitted in the working tree at write time; see the accompanying commit for exactly what landed.
