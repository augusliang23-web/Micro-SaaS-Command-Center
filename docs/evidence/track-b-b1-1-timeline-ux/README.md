# Track B B1.1 · timeline focus UX — evidence

- Issue: augusliang23-web/Micro-SaaS-Command-Center#36 (labels: `model:sonnet`, `risk:medium`, `bridge:ready`)
- Agent / model: Claude Code · Claude Sonnet 5.5 (`claude-sonnet-5-5`), matching the Issue's `model:sonnet`. The prompt asked for Reasoning Effort: Medium; the session's effort setting could not be verified from inside the session.
- Parent: PR #35 `claude/track-b-b1-pm-real-history` @ `2a533a785ffee6cde7d66be3717e37c683e3009a` (verified Draft before branching)
- Branch: `claude/track-b-b1-1-timeline-focus-ux` (new isolated worktree, stacked Draft PR targeting the parent branch)
- Presentation only. GitHub acquisition, pagination, commit parents, merge verification, PR base/head, SHA/CI/review validation, partial/UNKNOWN classification, snapshot consistency, REGISTERED/DEMO isolation and Last checked are unchanged (`server/*`, `gitHistoryTypes.ts` untouched; the `gitHistoryModel.ts` diff is limited to the timeline geometry helpers).
- `REAL_AGENT_EXECUTION = NOT_AUTHORIZED`

## Changes

- **A. Auto Fit (default).** The container is measured with `ResizeObserver` (window `resize` fallback): frame width minus the sticky branch-label column. px/day = (plot width − gutters) ÷ real span `[rangeStart, Last checked]`, floored at 4 px/day (narrow screens then scroll inside the graph) and capped at 60. The axis ends exactly at Last checked; the old `CARD_MIN_WIDTH` tail is gone, and a card near the right edge slides left (its duration bar keeps the true date position). Ticks adapt (1/2/7/14 days, then SGT calendar months). Zoom +/- switch to Manual (starting from the nearest step); an `Auto Fit` button restores the fit; choosing a range always returns to Auto Fit. Zoom/resize keep the same moment centred.
- **B. Collapsible navigation.** The project rail collapses to a 64 px icon rail through `--g-rail-w` (grid column actually narrows), with `aria-expanded`, a stable accessible name per project and the selected project still marked. The state lives above the history component, so collapsing neither remounts it nor refetches GitHub. The inner branch-label column has its own compact toggle (168 → 76 px) with `main` / `prod` (title `production-pages`) still identifiable and coloured.
- **C. Floating detail.** The persistent grid column is removed. Selecting a PR or commit (timeline, topology or list) opens a `role="dialog"` over the graph: desktop = non-modal 420 px panel, outside click closes unless the click is on another node (which switches the content); mobile (≤ 760 px) = modal bottom sheet with backdrop and focus trap. Close button, Escape and outside/backdrop click close it; focus moves into the dialog and returns to the selected node, or to the scrollable timeline if that node no longer exists. Scroll, scale, range, filters, search and the history snapshot are untouched, and collapsing the rail never touches GitHub. Opening a PR reads its detail (CI, reviews) once; reopening the same PR on the same snapshot reuses that detail (see the six-P2 section).

## Negative controls (run against the unmodified parent `2a533a7`; all three failed, all pass now)

| Control | Parent result | Now |
|---|---|---|
| A: 1 month fills the plot | axis fill 34.7% (jsdom geometry); live 34.9% | ≥ 90% (live 97.8%) |
| B: rail collapse releases width | no collapse control exists | rail 220 → 64 px, graph +156 px |
| C: selecting PR #55 keeps graph width | graph 1088 → 734 px (−354 px, `has-detail` column) | 1088 → 1088 px |

The tests use deterministic geometry mocks (a `ResizeObserver` stub and a `clientWidth` that emulates the CSS), not screenshots. Mutation checks (range no longer resets to Auto Fit, focus not restored, outside click disabled, card tail restored) each made at least one of the new tests fail.

## Measured on live PM Dashboard data (read-only, GitHub, 2026-10-16 ≈ 11:35–11:41 SGT; 68 branches / 58 PRs / 13 OPEN, status Complete)

Actual measured viewport widths (not requested ones): **1366** and **390**.

| 1366 × 768 | Old B1 (port 3100) | B1.1 |
|---|---|---|
| 1 month: plot width / Last checked at / fill / blank gap | 920 / 321 / **34.9%** / 599 px | 920 / 900 / **97.8%** / 20 px |
| 3 months, 6 months, all history: fill | — | 97.8% each (9.6, 4.8, 5.3 px/day) |
| 1 month px/day | 10 (fixed) | 29.1 |
| Rail expanded → collapsed | 220 → 220 | 220 → 64 px, graph 1088 → 1244 px |
| Branch labels expanded → compact | 168 | 168 → 76 px |
| Both collapsed, 1 month | — | plot 1168 px, 37.3 px/day, fill 98.3% |
| Select PR #55: graph width | shrinks by 354 px | 1088 → 1088 px; panel 420 px, `position: fixed` |
| Page `scrollWidth` | 1366 | 1366 |

Desktop interactions confirmed live: open by PR and by commit, focus enters the dialog, Escape / outside click / Close button each close it, focus returns to the PR card, vertical scroll (180 px) preserved across open and close.

| 390 × 844 | B1.1 |
|---|---|
| Page `scrollWidth` | 390 (no overflow) |
| Rail | collapsed by default as an icon strip; all 6 projects reachable |
| Default 6 months | plot 252 px, floor 4 px/day, canvas 766 px, scrolls inside the graph |
| PR #55 | modal bottom sheet, full width, 692 px tall, backdrop, Close button, focus inside; graph stays 356 px |
| Close | backdrop and Close button both work; focus returns to the card; timeline still scrolls |

Not tested: tablet 768 × 1024 (optional). A hidden preview pane delays `ResizeObserver` callbacks until the next paint (measured once: refit completed after a paint); this is a measurement artifact of the pane, and the refit is covered deterministically in the unit tests.

Screenshots (live data, same preview): `auto-fit-desktop.png` (1 month, Auto Fit active), `detail-overlay-desktop.png` (PR #55 floating over an unchanged-width graph, CI shown with its matching head), `mobile-bottom-sheet.png`. Unit tests use versioned fixtures and are labelled as such; nothing there is claimed as live.

## Validation

- `npm run test:ui` — 7 files, 177 tests passed (31 new in B1.1, 39 more in the six-P2 remediation).
- `node --test` focused (`github-development-history`, `github-pull-status`, `github-repos`, `local-git-status`, `status-provenance`, `verdict`, `local-state`) — 116 passed.
- `npm run lint` (tsc) pass · `npm run build` exit 0 (pre-existing `import.meta` / chunk-size warnings only) · `git diff --check` clean.
- npm safety: no `.npmrc`; no `npm_config_*`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `NPM_AUTH_TOKEN` names; no install, no registry access.
- Live data regression (2026-10-16 03:40Z): 68 branches / 58 PRs / 13 OPEN match `gh api`; 20/20 spot-check PRs match; status Complete, consistency `consistent`, `atomic: false`.

## Existing tests changed

Only a mechanical role rename: 25 queries `getByRole('complementary', …)` for `PR 詳細資訊` / `Commit 詳細資訊` became `getByRole('dialog', …)`, because the detail is now a dialog instead of an `<aside>`. No assertion about data, SHA/CI/review provenance or relationships was changed, and all of those tests pass through the dialog.

## Limitations

- The 420 px panel docks on the right as specified, so a selected card on the far right (the latest PRs) can sit behind it; the card keeps its selected style and the panel names it. A follow-up could dock left when the node would be covered.
- Rail collapse state is not persisted across reloads.
- Auto Fit stops at 4 px/day; very long ranges on narrow screens scroll inside the graph by design.

## Six-P2 remediation (independent review of PR #37 @ `4e36fff`)

Starting HEAD `4e36fff35d76fa0dfd8c89290f5ab38ebd5555d1`, same branch and PR. Deterministic negative controls were written first and run against that commit in a throwaway worktree: **19 tests failed there across all six findings; all pass now** (177 UI tests in total). Mutation checks (cache never hits, opener not remembered, modal focus guard removed, zoom-in capped at the old 40, one-day minimum span restored) each failed at least one new test. Model: Claude Sonnet 5.5, matching the Issue's `model:sonnet`.

| # | Finding | Correction |
|---|---|---|
| P2-1 | Short history left ~3.5% fill (1-day span minimum, 60 px/day cap) | `fitPxPerDay` fits the real positive span; zero, inverted or invalid spans use one nominal day; cap removed (numeric safety only). Sub-day spans get SGT time-of-day ticks (1 min … 12 h), then day and month ticks. |
| P2-2 | Zoom In from Auto Fit could shrink (60 → 40 px/day) | Zoom In/Out multiply/divide the current effective scale by 1.5 whatever its source; at a numeric boundary (canvas > 120,000 px, axis < 120 px or < 1 px/day) the button is disabled instead of reversing. |
| P2-3 | Closing the dialog dropped the PR detail; reopening re-requested it | Detail cache owned by the project session, keyed by identity + repository + snapshot version; same PR + same snapshot reuses it, a new snapshot, repository or project starts empty. Errors are not cached; the SHA/CI/review fail-closed guard still runs on cached detail. |
| P2-4 | Focus returned to the selected node, not to the element that opened the panel | The clicked element is captured at open (links inside the dialog keep the original opener). Close restores it if still connected and enabled, else the selected node, else the visible scrollable region (timeline, list or topology). |
| P2-5 | A desktop panel turning into the mobile modal left focus in the background | On entering modal mode focus moves into the dialog and a `focusin` guard keeps it from landing behind the backdrop; leaving modal mode removes the guard and the panel is non-modal again. |
| P2-6 | Mobile rail CSS was overridden by later global rules | The mobile rail block now follows the shared rules, and the rail list no longer shrinks, so the strip scrolls inside itself. A test computes the real cascade from the stylesheet text (dialog/CSS parser, not class names). |

### Real browser (read-only live PM Dashboard data unless stated), measured widths 1366 and 390

- 1366 × 768, 1 month: Zoom In 29.0 → 43.6 → 65.3 px/day, Zoom Out back to 43.6, Auto Fit restores 29.0; all history 5.3 → 7.9 → 5.3.
- PR #55 detail: 0 requests before, 2 on first open (React StrictMode runs the dev effect twice and aborts the first), still 2 after close and reopen, CI shown immediately on reopen.
- Opening from the bottom OPEN PR card and closing with Escape returns focus to that card button (not the timeline card); the graph's vertical scroll (60 px) is unchanged.
- Computed rail CSS: 1366 px = column / overflow hidden; 390 px = row / overflow-x auto, six projects on one row, rail content 1012 px inside a 390 px box (scrolls), first and last project reachable, page `scrollWidth` 390.
- Desktop panel left open with focus on a background control, then viewport shrunk to 390: `aria-modal="true"`, backdrop present, focus inside the dialog. Real Tab ×16 and Shift+Tab ×16 key presses stayed inside the dialog every time. Growing back to 1366: `aria-modal="false"`, no backdrop, 420 px panel, background control usable again.
- Short-history Auto Fit was checked with a **fixture** (live data rewritten to a 30-minute span, not live): fill 97.8% (old code ≈ 1.4–3.5%), ticks every 5 minutes in SGT, cards inside the plot, Zoom In grows the canvas.
- A programmatic `.focus()` probe is not conclusive in an unfocused preview document (no `focusin` is dispatched), so the focus-trap claim rests on the real key presses above and the jsdom tests.

### Commit history is not PR history

The timeline's PR cards are GitHub pull requests (created → merged/closed). The dots on the `main` and `production-pages` lines are commits; only merge commits and branch heads are clickable, and a commit is tied to a PR only where its SHA is that PR's verified merge commit or head (shown in the commit detail as "Associated PR"). Nothing links other commits to PRs, and no PRs or relationships are invented. The legend now says so and lists the months in range with no PR created. Live check (2026-10-16 05:53 UTC; counts by Singapore month of `created_at`; `main` commits by committer date):

| Month (SGT) | PRs created | `main` commits |
|---|---|---|
| 2026-04 | 0 | 12 |
| 2026-05 | 1 (PR #1, created 2026-04-30 21:15 UTC = **2026-05-01 05:15 SGT**) | 2 |
| 2026-06 | 0 | 111 |
| 2026-07 | 0 | 183 |
| 2026-08 | 0 | 131 |
| 2026-09 | 24 | 137 |
| 2026-10 | 33 | 45 |

So there are 58 PRs, and June–August have none, while those months hold 425 direct `main` commits. The "April: 1 PR" in the review is the same PR counted in UTC; the app always uses Singapore time. A per-commit detail view or a compressed no-PR period would be a separate scoped design; nothing like it is implemented here.

### Environment

The earlier `node_modules` symlink into another worktree was replaced with a local copy-on-write clone (no install, no network), so Vite/Vitest cache writes stay inside this worktree; the other worktree's `node_modules` is unchanged.
