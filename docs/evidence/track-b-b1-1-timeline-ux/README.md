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
- **C. Floating detail.** The persistent grid column is removed. Selecting a PR or commit (timeline, topology or list) opens a `role="dialog"` over the graph: desktop = non-modal 420 px panel, outside click closes unless the click is on another node (which switches the content); mobile (≤ 760 px) = modal bottom sheet with backdrop and focus trap. Close button, Escape and outside/backdrop click close it; focus moves into the dialog and returns to the selected node, or to the scrollable timeline if that node no longer exists. Scroll, scale, range, filters, search and the history snapshot are untouched, and no GitHub request is made by opening, closing or collapsing.

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

- `npm run test:ui` — 7 files, 138 tests passed (31 new).
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
