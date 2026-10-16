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

## Validation (updated after P2 remediation)

- `npm run test:ui` — 7 files, 107 tests passed.
- `node --test` focused: `github-development-history` (33), `github-pull-status`, `github-repos`, `local-git-status`, `status-provenance`, `verdict`, `local-state` — 116 passed.
- `npm run lint` (tsc) — pass. `npm run build` — exit 0 (pre-existing `import.meta`/chunk-size warnings only).
- `git diff --check` — clean.
- npm safety: no repo `.npmrc`; no `npm_config_*`/`NPM_TOKEN`/`NODE_AUTH_TOKEN` env names; no install, no registry access.
- Not run: agent-console / Docker suites (Track A, unrelated to this change; avoids any sandbox/agent runtime).

## P2 provenance remediation (Issue #34 independent-review addendum)

Starting HEAD `17a56232f114cf3d222cf99566ccedf76000ad48`. Negative controls were written first and run against that commit in a throwaway worktree: 8 backend and 16 UI tests failed there, and all pass after the fix.

**P2-1 PR/CI version consistency.** Reproduced on the original: snapshot head `e1`, fresh detail head `e2` with CI PASS on `e2` rendered "CI passed (5 check runs)" next to `e1` with no warning. Now the panel compares the snapshot head, the detail head and the head the CI was read for. A mismatch shows "Needs refresh · Stale data", labels the CI "針對 <B> 的 CI … 不適用於快照 head <A>", and marks review and changed files "Not verified". CI whose head differs from the detail's own head is "Not verified". State changes (DRAFT→OPEN, →MERGED, →CLOSED) are shown as "狀態已變更" with both states. The detail request is keyed by the snapshot version, so a refreshed snapshot discards and re-reads the detail while the selection is kept; a PR missing from the new snapshot is reported, not cleared.

**P2-2 incomplete review history.** Reproduced on the original: a truncated list of 300 reviews rendered "Approved (300)". The backend now returns `status: partial` with `observed` (what the read pages showed, so a visible CHANGES_REQUESTED is not hidden) whenever pagination is incomplete, and the UI renders "Partial / UNKNOWN" even if a legacy response claims approved with `complete=false`. No reviews, Not checked, Partial, Approved and Changes requested stay distinct.

**Snapshot consistency.** The reads are separate GETs and are not atomic; the UI says so ("非原子快照") and the API reports `consistency.atomic: false` on every response. Reads are now pinned to observed SHAs: `main` history uses `commits?sha=<main head>` and each focus ref is compared as `compare/<main head>...<ref head>`. After the dependent reads the branch list is read again; any ref that moved, appeared or vanished is listed (`relevant` marks refs that edges depend on). Open PRs whose list head differs from their branch head are listed too. Any relevant drift or mismatch makes the snapshot `partial / inconsistent`, and ancestry claims touching a moved base or a mismatched PR become UNKNOWN instead of verified. A failed re-read is `unverified`, never consistent.

Residual: the PR detail's CI and review reads are two requests after the PR record, so a push in that window is not detectable by the server; the displayed SHA for CI is always the SHA it was read for.

Existing B1 tests changed for the new behavior: backend fixtures now give branches heads equal to their open PR heads, read main history by SHA and assert SHA-based compares; the UI `detailFor` fixture now uses each PR's own head SHA instead of a hard-coded `e1` (the old fixture served CI for the wrong SHA, which the new gate correctly rejects).

Final live revalidation (2026-10-16 08:32 SGT): 68 branches, 58 PRs, 13 OPEN, status `complete`, consistency `consistent` (re-read found no drift), 15 compares all pinned, 20/20 spot-check PRs match `gh api`. Real PR detail for #55, #57, #36: CI head equals PR head, reviews `no_reviews` complete. Browser 1366×768 and 390×844: page `scrollWidth` equals viewport, graph frame scrolls internally. The stale banner was also viewed in the real UI with an injected (simulated, not live) detail response for PR #57 (head changed); that screenshot is not committed because the Issue allowlist names only three PNGs.

## Final provenance hardening (second independent review: P2-3, P2-4)

Starting HEAD `f69031f88612205cfa611af4ec69a5ce7444cce1`. Negative controls were written first and run against that commit in a throwaway worktree: 3 backend and 10 UI tests failed there; all pass after the fix.

**P2-3 CI SHA fail-closed.** The earlier code computed `ciApplies` but did not use it as the final condition: with a missing snapshot head, current head B and CI PASS on B, the panel rendered an unqualified "CI passed". Now an unqualified CI result is rendered only when snapshot head = current PR head = CI check-run head, all present. A missing snapshot, current or CI SHA, or any mismatch, shows "Not verified" (or "Stale data" when the heads differ) and "Needs refresh"; review and changed-files data are also "Not verified" when the snapshot or current head is unknown. Covered by a six-row `reconcilePullDetail` truth table and rendered-panel tests for each missing SHA, all-missing, mismatched and matching cases.

**P2-4 completeness vs edge proof.** Previously a non-focus branch that moved or appeared during the read was listed in `driftedRefs` while `consistency.status` stayed `consistent` and the top-level status stayed `complete`. Now any drift (moved, new or removed branch) makes the repository snapshot `inconsistent` and `partial`. Per-edge proof stays separate: a comparison is still pinned to its observed SHAs and complete, and an ancestry claim is downgraded to UNKNOWN only when a ref it uses moved (its base, or the head branch of an open PR) or when the PR list head disagrees with its branch; unrelated drift leaves it verified. `relevant` on each drifted ref tells the UI which claims are affected. Tests: unrelated branch moves, new branch, removed branch, main moves, stacked PR base moves, combined drift, stable snapshot; plus the per-edge cases in the model.

**Model disclosure.** The Issue requires Opus. The P2 remediation commit `f69031f` and this follow-up were produced in a session running Sonnet 5.5. This was disclosed in the earlier report and is not rewritten here; the earlier commit trailer says Sonnet 5.5.

Validation: 107 UI and 116 Node tests, lint, build and `git diff --check` pass. Live check (2026-10-16 10:55 SGT): 68 branches, 58 PRs, 13 OPEN, status `complete`, consistency `consistent`, 20/20 spot-check PRs match `gh api`. Browser smoke at 1366×768 and 390×844 (actual widths measured): no page-wide overflow, CI shown only with its matching head SHA.
