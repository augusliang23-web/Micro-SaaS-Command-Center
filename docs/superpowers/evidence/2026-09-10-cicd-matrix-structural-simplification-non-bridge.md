# CiCdWorkflowModal / FeatureDeliveryMatrix: Structural Simplification — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-10
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task.
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Third of three things the owner asked to do in one pass (after wiring `ChatGPTBridgeModal` to real dispatch and adding a second write-execution pilot, both 2026-09-10). The 2026-09-09 pass on these same two files reworded their prose into plain Chinese but deliberately left their *structure* — Gate-ID-numbered sub-lists, raw 8-step pill-chain path diagrams, mixed English/Chinese table headers — still engineering-shaped. This pass addresses that.

## What shipped

- **`src/components/CiCdWorkflowModal.tsx`, pipeline tab** — each of the 3 phase cards (準備/驗證/上線) had a nested list of 2-3 numbered Gate sub-items (e.g. "1. DISCUSS (對齊目標)" / "2. SPECIFY (規格契約)" / "3. ROUTE (模型分流)", each with a jargon-dense subtitle like "技術 PRD、Schema 定義、Safety Checklist"). Removed all 8 of these nested boxes; folded their meaning into the phase's existing plain-language paragraph instead. Each card is now a headline + one paragraph + an "這階段結束時會有" outcome line — no raw Gate IDs visible in the default pipeline view at all.
- **`src/components/CiCdWorkflowModal.tsx`, iteration tab** — the 4 scenario execution-path visualizations were each an 8-node pill chain reciting every Gate ID (`1. DISCUSS → 2. SPECIFY → 3. ROUTE → 4. IMPLEMENT → 5. TEST → 6. REVIEW → 7. APPROVE → 8. DONE`). Replaced each with a 3-4 node path using the *same* plain-language phase names already established in the pipeline tab (準備/驗證/上線), so the iteration scenarios now visually tie back to the one mental model introduced earlier instead of re-exposing all 8 raw Gate IDs a second time. Scenario A (major) shows all three phases; B (minor) shows a shortened "準備"; C (hotfix) and D (maintenance) skip straight to "驗證" — the skip pattern itself is still communicated, just without jargon.
- **`src/components/CiCdWorkflowModal.tsx`, imports** — removed 10 lucide-react icon imports that were already unused before this pass (dead imports left over from earlier edits), while removing this pass.
- **`src/components/FeatureDeliveryMatrix.tsx`** — the quick-stats tiles, filter-tab labels, and table column headers mixed English technical terms into otherwise-Chinese UI ("Stage 候選中 (Staged)", "Prod 線上中", "Feature Flag 開關 (Prod)", "Production 狀態 & 版號"). Rewritten to plain Chinese throughout ("測試中待推送", "已上線", "是否對外開放", "正式環境狀態與版號"). Left the per-row `ON (線上啟用)`/`OFF (線上隱藏)` toggle labels and `Live in vX.X.X` badges as-is — those are already compact and paired with Chinese clarification, consistent with badge conventions used elsewhere in the app (e.g. `ProjectVerdictCard`'s technical-detail badges); rewriting them further had diminishing returns for the risk of touching more lines. Also left the 4-mode "integration channel" tab switcher (AI 顧問 PRD sync / paste text / GitHub Issues / manual entry) and the data table's fundamental column structure unchanged — 4 clearly-differentiated input methods is already a reasonably minimal structure, and the columns are all load-bearing (name, category, two environment statuses, the flag toggle, an action) with no redundant one to cut.

## Verification

- `npm run lint`, `npm test` (93/93), `npm run test:ui` (5/5), `npm run build` all green.
- Manual browser check: opened `CiCdWorkflowModal`'s pipeline tab — confirmed the 3 phase cards render as clean headline+paragraph+outcome, no nested Gate-ID boxes. Switched through all 4 iteration scenarios — confirmed scenario A shows the full 準備→驗證→上線 path, scenario C (hotfix) correctly shows the shortened 2-node path skipping 準備. Opened `FeatureDeliveryMatrix` inside a project drawer — confirmed quick-stats tiles, filter tabs, and table headers all render in plain Chinese with no stray English technical terms.
- `read_console_messages` — no errors attributable to this change (a batch of stale `502`/`400` entries observed are leftovers from this long-lived browser tab surviving many dev-server restarts across the session, unrelated — confirmed via `read_network_requests` showing zero errors in the current request window).

## Known gaps / deliberately out of scope

- `FeatureDeliveryMatrix.tsx`'s per-row `ON`/`OFF`/`Live in vX` badges were deliberately left as compact structural labels, not prose — same line drawn as the previous session's "keep short structural labels, simplify prose" principle.
- The 4-mode integration-channel tab switcher's structure is unchanged — considered simplifying it further but judged the 4 modes already minimal and each individually load-bearing (AI-PRD sync, raw-paste, GitHub Issues, manual fallback each serve a genuinely different situation).
- This completes the owner's requested three items in this round (ChatGPTBridgeModal real dispatch, second write-execution pilot, this structural pass). Remaining, not started without being asked: manual "Copy Context" is still clipboard-only.

## Boundaries respected

Pure UI/presentation changes to two components already gated behind the app's "技術細節" opt-in toggle — no data, dispatch, or persistence logic touched. No changes to `server.ts`, `.env*`, or the protected `/api/bridge/*` routes. Did not add `bridge:ready` or open/modify any GitHub Issue.
