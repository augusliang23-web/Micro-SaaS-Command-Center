# Track B B1 · PM Dashboard verified development map — evidence

- Issue: augusliang23-web/Micro-SaaS-Command-Center#34 (labels at start: `bridge:ready`, `risk:high`, `model:opus`)
- Agent / model: Claude Code · Claude Opus 5.5 (`claude-opus-5-5`) · Reasoning Effort: High
- Base: PR #30 `feat/track-b-uiux-prototype` @ `1737a76a2d5071249aa1f56f8a4eca2ae6f188df` (verified before branching)
- Branch: `claude/track-b-b1-pm-real-history` (stacked Draft PR targeting `feat/track-b-uiux-prototype`)
- `REAL_AGENT_EXECUTION = NOT_AUTHORIZED` — no AI chat, prompt, agent dispatch, provider call, merge or deploy.

## Source and freshness

| Read | Time (UTC) | Time (SGT) | Result |
|---|---|---|---|
| Control Plane preflight (given) | 2026-10-16 (prompt) | — | 67 branches · 57 PRs · 12 OPEN · main `4a8e7ee` · production-pages `9c42541` |
| Discovery (`gh api`, this session) | 2026-10-15T23:53:08Z | 2026-10-16 07:53 | 67 branches · 57 PRs · 12 OPEN (matched preflight) |
| Adapter first live run | 2026-10-15T23:57:20Z | 2026-10-16 07:57 | `complete` · 679 commits in graph · 14 refs compared · 0 warnings |
| Final verification (`refresh=1` + independent `gh api`) | 2026-10-16T00:14:31Z | 2026-10-16 08:14 | 68 branches · 58 PRs · 13 OPEN (11 Draft) · 44 merged · 1 closed-unmerged · `complete` |

GitHub changed during the session: PR **#60** (`codex/pdf-attention-consistency-hotfix` → `main`, Draft, created 2026-10-16 07:59 SGT) and its branch appeared. Nothing in code hardcodes counts; every number above was read from GitHub at the stated time.

Data source: `augusliang23-web/pm-dashboard` only (exact allowlist), via the user's existing authenticated `gh` CLI, `gh api --method GET -i` only. Endpoints: `repos/{repo}`, `branches` (paginated), `pulls?state=all` (paginated), `commits?sha=main` (paginated, ≤10 pages), `compare/main...{ref}` for production-pages and every OPEN PR head/base branch, and on demand `pulls/{n}`, `commits/{sha}/check-runs`, `pulls/{n}/reviews`. `main` history was read to the root commit (621 commits, back to 2026-04-27 05:42 SGT).

## Spot checks (final read, 2026-10-16 08:14 SGT) — app API vs independent `gh api`: 20/20 MATCH

| PR | State | Created (SGT) | Merged (SGT) | head → base | Merge edge |
|---|---|---|---|---|---|
| #13 | MERGED | 2026-09-24 09:26 | 2026-09-24 09:43 | migration/consolidated-source-ci → main | verified merge commit |
| #23 | MERGED | 2026-09-27 08:23 | 2026-09-27 08:56 | claude/b8-uat-pdf-url-integration → main | verified |
| #33 | MERGED | 2026-10-03 08:38 | 2026-10-03 12:08 | claude/week-manage-permission-foundation → main | verified |
| #34 | MERGED | 2026-10-03 12:27 | 2026-10-03 12:48 | claude/user-permissions-ui → main | verified |
| #35 | MERGED | 2026-10-03 16:54 | 2026-10-03 17:45 | codex/functions-node22-candidate → main | verified |
| #36 | OPEN | 2026-10-03 22:21 | — | claude/production-user-permissions-promotion → main | — |
| #37 | OPEN | 2026-10-03 22:21 | — | claude/production-pages-user-permissions → production-pages | — |
| #40 | MERGED | 2026-10-04 12:17 | 2026-10-06 16:46 | claude/production-pages-user-permissions-v2 → production-pages | verified |
| #47 | MERGED | 2026-10-10 07:00 | 2026-10-10 08:37 | claude/weekly-update-one-paste-uat → main | verified |
| #48 | MERGED | 2026-10-10 08:14 | 2026-10-10 08:53 | claude/weekly-one-paste-production-pages → production-pages | verified |
| #50 | DRAFT | 2026-10-14 11:09 | — | claude/v23-delivery-presentation → main | — |
| #51 | DRAFT | 2026-10-14 13:19 | — | codex/v23-shared-metrics-engine → main | — |
| #52 | DRAFT | 2026-10-14 13:57 | — | codex/v23-history-pipeline → integration/v23-foundation | — |
| #53 | DRAFT | 2026-10-14 15:22 | — | claude/v23-product-integration → integration/v23-foundation | — |
| #54 | DRAFT | 2026-10-14 21:52 | — | codex/new-project-draft-publish → main | — |
| #55 | DRAFT | 2026-10-14 22:39 | — | claude/v23-browser-e2e-hardening → claude/v23-product-integration | — |
| #56 | DRAFT | 2026-10-15 07:57 | — | integration/v23-e2e-candidate → integration/v23-foundation | — |
| #57 | DRAFT | 2026-10-15 08:33 | — | claude/v23-gate2-closeout → integration/v23-e2e-candidate | — |
| #58 | DRAFT | 2026-10-15 13:42 | — | claude/v23-uat-backend-activation → claude/v23-gate2-closeout | — |
| #59 | DRAFT | 2026-10-15 13:42 | — | claude/v23-uat-frontend-activation → claude/v23-gate2-closeout | — |

Date comparisons (created vs merged, UTC→SGT, year shown): #13, #23, #33, #34, #35, #40, #47, #48 — 8 comparisons. Note #40 `merged_at` 08:46:12Z ≠ `closed_at` 08:46:13Z; both are shown as separate source fields.

## V2.3 stacked relationships (PR metadata) and verified Git ancestry

Stacking is shown only where an OPEN PR's base ref equals another OPEN PR's head ref; it is labelled "reported PR base", never a fork point.

| PR | Reported base | Stacked on | Base branch head is ancestor of PR head (commit parents) |
|---|---|---|---|
| #52 | integration/v23-foundation | — (branch, no open PR head) | YES |
| #53 | integration/v23-foundation | — | YES |
| #55 | claude/v23-product-integration | #53 | YES |
| #56 | integration/v23-foundation | — | YES |
| #57 | integration/v23-e2e-candidate | #56 | YES |
| #58 | claude/v23-gate2-closeout | #57 | YES |
| #59 | claude/v23-gate2-closeout | #57 | YES |
| #54, #60 | main | — | YES |
| #36, #50, #51 | main | — | NO (main moved / diverged since the branch point) |
| #37 | production-pages | — | NO |

## Graph edges

- Solid (verified): commit → parent from GitHub commit objects; 43 of 44 merged PRs have a merge commit whose parents include the PR head SHA.
- Dotted (PR record only): #49 merged as a single-parent commit (squash/rebase) — no Git edge drawn to its branch.
- Dashed (reported PR base): every OPEN PR → its base branch / parent PR.
- UNKNOWN: 11 branch heads are not inside the fetched commit graph (`claude/gifted-bardeen-1m9ugt`, `codex/v2.1-release`, `codex/v3.0t-vercel-preview`, `feat/ucg-v2-uat-integration`, `fix/owner-to-project-manager-labels-20261014`, `fix/risk-mitigation-actions-label`, `integrate/risk-mitigation-actions-current-main`, `release/pdf-risk-mitigation-terminology-prod`, `test-push-1`, `v2.2T`, `v3.0T`); their ancestry is shown as UNKNOWN, not guessed.
- Closed without merge: #14 (shown as CLOSED · 未合併).

## Not checked (by design in this phase)

Local worktrees, deployment state, project health (UNKNOWN), and CI/review for a PR until that PR is opened in the detail panel (then fetched and labelled: Not checked / No CI checks / CI passed / CI failed / running / unknown).

## Screenshots (real data, 1366×768, preview harness)

- `pm-development-map.png` — timeline, 6 months, main / production-pages lanes, V2.3 lanes (read 2026-10-16 08:13 SGT).
- `pm-history-detail.png` — PR #55 selected: stacked on #53 highlighted, on-demand detail "CI passed (5 check runs)", verified ancestry.
- `pm-open-prs.png` — List view filtered to OPEN: 13 / 58 PRs including the new #60.

Mobile 390×844: page `scrollWidth` 390 (no page-wide overflow); graph frame 356 px wide scrolls internally (2,166 px) with sticky lane labels. Tablet 768×1024: `scrollWidth` 768. Desktop 1366×768: `scrollWidth` 1366.

Browser note: port 3000 was occupied by the user's long-running `command-center-v1-trust` server, and `server.ts` (hardcoded port) is outside this task's allowlist, so the UI was served by a scratch harness (not committed) that mounted only Vite plus the read-only `/api/github` router on `127.0.0.1:3100`. `/api/state` was intentionally not mounted (404 in console), and Vite HMR could not bind its websocket port (also held by the other server).

## Validation

- `npm run test:ui` — 7 files, 78 tests passed (16 new B1 tests).
- `node --test` focused: `github-development-history` (18 new), `github-pull-status`, `github-repos`, `local-git-status`, `status-provenance`, `verdict`, `local-state` — 101 passed.
- `npm run lint` (tsc) — pass. `npm run build` — exit 0 (pre-existing `import.meta`/chunk-size warnings only).
- `git diff --check` — clean.
- npm safety: no repo `.npmrc`; no `npm_config_*`/`NPM_TOKEN`/`NODE_AUTH_TOKEN` env names; no install, no registry access.
- Not run: agent-console / Docker suites (Track A, unrelated to this change; avoids any sandbox/agent runtime).
