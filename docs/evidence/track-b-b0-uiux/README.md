# Track B B0 / B0.1 — Interactive Command Center UI

Frontend prototype only. `REAL_AGENT_EXECUTION = NOT_AUTHORIZED`.

**Current evidence: B0.1, authorized by [Issue #31](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/31).** B0 sections below are historical records; the four images are updated B0.1 captures. Issue #31 does not retroactively approve the original B0 process. Human UX acceptance and merge remain pending.

Base: `25692a9a1fdedaf82910630fb767589aa5dccddf`.
Branch: `feat/track-b-uiux-prototype`.

## Experience the prototype locally

From the isolated `command-center-track-b-uiux` worktree:

```sh
npm exec --offline -- vite --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/?mode=demo** for the explicit DEMO workspace. The URL was verified in the Codex in-app browser on macOS. The default URL retains the API-backed registered portfolio; a Vite-only server has no backend routes and missing state remains unavailable, never authoritative fixture data.

## Implemented behavior

- Persistent four-page navigation: 專案總覽, Development Map, AI Command, Cost Guard. Shared project/task context survives page navigation, including a selected registered project's name/repository handed into explicitly labeled demo pages.
- Five local project samples. Statuses, milestones, blockers, task counts, timestamps and costs are labeled DEMO. Existing CockpitHeader, portfolio/cards, detail drawer, Needs Attention and AI status functions remain in the registered view; no existing component was rewritten.
- Native SVG development map with distinct curved branches, horizontal scrolling, visible titles/references/statuses and task details. PR #25 → #26 → #27 is a historical dependency reference, not current GitHub status. Independent UI/UX and Cost Guard nodes are DEMO-ONLY, not real PRs. Dashed merge curves are explicitly hypothetical, not completed merges.
- AI Command accepts Traditional Chinese, transfers the chosen task, preserves only in-memory drafts and produces a deterministic **DEMO PLANNING PREVIEW**. Project/task/prompt changes invalidate old plans. Agent/model suggestions are demo suggestions, not actual execution or approval. Execute with Agent is disabled. Demo code makes no API requests and writes no prompt storage.
- Cost Guard uses one monthly USD sample distribution (4 of 5 samples available). Reads/time remain separate per-limit indicators. Missing amounts/accounts/limits display unavailable or insufficient data, not zero. Budget alerts are distinguished from unconfigured hard caps; no cloud enforcement exists.

## Local validation — not CI

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run test:ui` | 7 files / 44 tests PASS, 0 failed; original 25 retained plus 19 prototype tests |
| `npm run build` | PASS, with the existing backend CJS/import.meta warning |
| `git diff --check` | PASS |
| Independent read-only frontend review | No blockers found; separate from test/browser verification |
| Original main preservation | HEAD/status and all eight dirty-file hashes unchanged |
| Track A branch preservation | Existing Track A branch refs match the implementation preflight snapshot; no Track A writes |
| Dependency manifests | package.json/package-lock.json unchanged; no added dependency |

Build warning: esbuild's existing CommonJS backend bundle cannot preserve `import.meta` at server.ts:24. The backend entrypoint was not executed or changed. UI tests also retain the expected network-forbidden diagnostic for legacy tests that deliberately simulate an unavailable /api/state; those tests pass.

## Actual browser verification

Used the local Vite-only frontend, including a 1366 × 768 viewport to check the initial MacBook Air layout; the temporary viewport override was reset afterwards. These are actual browser screenshots, not generated mockups. The map and planner screenshots intentionally show a scrolled viewport so branch/task and preview/disabled-execution details are visible.

- A: Overview → Micro-SaaS Command Center → PR #27 details → AI Command → Chinese prompt → local planning preview; context observed and execution disabled.
- B: Overview → PM Dashboard cost sample → matching detail → return to Overview with the project preserved.
- C: Parallel UI/UX demo task → details → AI Command; task selection preserved.
- Additional check: SwipeRight's missing cost/account/limits display Not available / Not enough data, with no invented zero or progress value.

| Overview | Development Map |
| --- | --- |
| ![Overview](overview.jpg) | ![Development Map](development-map.jpg) |

| AI Command | Cost Guard |
| --- | --- |
| ![AI Command](ai-command.jpg) | ![Cost Guard](cost-guard.jpg) |

## Boundaries and remaining limitations

No backend/Orchestrator/ApprovalGate/store/Docker/identity-journal changes, provider call, agent execution, GCP/Firebase action, billing credential access, SaaS Cost Guard repository edit, merge or deployment. Only the feature branch is published as a Draft PR against main.

Demo plans are fixed-rule previews, historical PR status is unqueried, demo costs are fictional and not billing advice, and the standalone Vite preview cannot provide real backend state. UI drafts/selection intentionally reset on full reload; no backend integration begins in this phase.


## B0.1 — UX refinement under Issue #31 (2026-10-11)

Starting HEAD: `6690c220aeacd86d0529bd30bed8c7de4fe9bd50`. Exact issue is OPEN with `model:sol`, `risk:medium`, `bridge:ready` and Medium effort, and the explicit file allowlist. No `bridge:approved` was added. Existing PR #30 remains the delivery destination against main; no new PR or backend integration.

### Verified, bounded topology snapshot

GitHub PR reads establish main → #25 → #26 → #27 → #28, independently main → #30. Snapshot observation is `2026-10-10T23:43:21Z` / `2026-10-11 07:43 +08:00`. Node titles match the actual PR titles. Every known node stores its source URL, observed timestamp, head SHA, base SHA/ref and observed OPEN / Draft state. UI status says **未即時查詢**; those fields are a dated snapshot, never live telemetry. PR #30's recorded head is the starting B0 commit; this delivery advances PR #30, intentionally without pretending the historical snapshot was refreshed.

| PR | Observed base | Observed head |
| --- | --- | --- |
| [PR #25](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/25) | `25692a9a1fdedaf82910630fb767589aa5dccddf` | `f5addc4a9cbab419b43ebb38159b07f51daa60ea` |
| [PR #26](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/26) | `f5addc4a9cbab419b43ebb38159b07f51daa60ea` | `ae3f1e5ae518aa0ed234d96c66934372b8ba213c` |
| [PR #27](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/27) | `ae3f1e5ae518aa0ed234d96c66934372b8ba213c` | `c7c751df3acd5e3be22cc5c2ac7d3001278ab453` |
| [PR #28](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/28) | `c7c751df3acd5e3be22cc5c2ac7d3001278ab453` | `cf7fc7db9ebdef236a0d2f72a2399fca644ad755` |
| [PR #30](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/30) | `25692a9a1fdedaf82910630fb767589aa5dccddf` | `6690c220aeacd86d0529bd30bed8c7de4fe9bd50` |

Connections are rendered from dependency data. Selecting a task highlights its upstream path only: #28 highlights Track A; #30 highlights main → #30 and does not imply a #28 → #30 edge. The separate UI/UX and Cost Guard samples remain DEMO-ONLY. Hypothetical merge curves were removed; no merge completion is fabricated. Other projects still have only their own demo/unknown topology, not the Command Center's PR chain.

### AI discovery and navigation

An obvious **向 AI 提需求** action is available from every page, reusing the sole AI Command editor and preserving selected project/task. The editor shows adjacent project/task context; absent branch/task is explained and does not prevent a general Chinese request. Prompt/project/task changes invalidate unrelated previews. Planning remains local deterministic DEMO output; execution stays disabled and prompts are not written to backend or browser storage.

Registered portfolio source/UNKNOWN behavior is unchanged. Cost Guard retains USD-only sample distribution, per-unit usage indicators, dated DEMO provenance, missing != zero, and explicit budget-alert versus unconfigured hard-cap wording. No billing or provider integration was added.

### Newly executed verification

| Gate | B0.1 result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run test:ui` | 7 files, **52/52 PASS**, 0 failures; all previous 44 rerun plus 8 focused regressions |
| `npm run build` | PASS; existing CJS/import.meta warning in server.ts:24 remains |
| `git diff --check` | PASS |
| Independent read-only frontend review | No blocker found; separate from actual browser checks |
| Browser workflows A / B / C / D / E | Observed PASS, not human acceptance |
| 1366×768 desktop, 768×1024 tablet, 390×844 mobile | All four pages checked at each size: 12/12 body/document widths matched viewport, no page-wide horizontal overflow |
| Actual keyboard | Enter opens PR30 details; Tab enters PR nodes; visible solid focus outline; graph ArrowRight changed internal scrollLeft from 199 to 223.5 |

No overflow was masked using a page-wide clipping rule. The graph canvas scrolls inside a keyboard-focusable panel. Long exact titles wrap without ellipsis; smaller screens stack task details below the graph. Viewport overrides were reset after testing.

The tested preview was `http://127.0.0.1:5173/?mode=demo`; the Vite listener's cwd was independently verified as the Track B worktree. No unrelated process was stopped. Updated screenshots show Overview, selected independent PR30 details, local planning and Cost Guard; some frames are scrolled to expose the relevant controls.

A: Overview → Command Center → PR28 details (depends on PR27) → AI entry → Chinese prompt → DEMO preview, execution disabled.

B: PR30 details show main dependency, main edge highlighted and Track A edge not highlighted → AI entry preserves PR30.

C: PM Dashboard overview → matching Cost Guard detail → overview retains PM Dashboard.

D: Direct AI navigation without a task explains missing context; Chinese prompt produces only unapproved DEMO planning.

E: Changing project after a plan removes the old preview; editing the prompt also removes the preview.

### Human UX acceptance checklist — pending

- [ ] On your Mac, find **向 AI 提需求** without guidance from every page.
- [ ] Distinguish Track A's stack, independent Track B, and DEMO-ONLY examples.
- [ ] Read each complete task title and verify which upstream edges highlight.
- [ ] Transfer PR28 and PR30 to the editor and confirm the desired project/task.
- [ ] Use the map's internal horizontal/vertical scroll on tablet/mobile; confirm inline details below the graph are comfortable.
- [ ] Understand unavailable cost values and why a budget alert is not a spending stop.
- [ ] Confirm the layout, typography and keyboard focus feel appropriate before accepting B0.1.

Remaining limitations: exact long PR titles may require graph panning; mobile details are inline below the graph. No formal assistive-technology/WCAG audit or human UX acceptance is claimed. Source/status snapshots and costs are not live; local plans are not AI inference; backend/agent/billing integration remains unauthorized. This refinement does not resolve or retroactively validate the original B0 governance gap.
