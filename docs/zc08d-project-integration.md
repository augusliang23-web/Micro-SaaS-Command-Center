# ZC-08D — owner-approved project integration (Issue #103)

## Product contract and boundaries
Existing V1 viewer users can select PM Dashboard, Inventory Tool and Zero-Copy Development. Zero-Copy groups Lab and Command Center, with four workstreams and seven fixed PRs. Each river mounts exactly one repository's history; project grouping creates no Git edges. The catalog is approved monitoring configuration, not a fabricated saved registration, health value, or live status. Existing saved projects retain their provenance and fail-closed identity checks.

Read-only GitHub observation only. No provider calls, heartbeat, runner, task execution, auth or persistence changes. Agent = NOT_CONNECTED. No monitored repository modification, cloud, UAT/Production, merge or deployment. Codex COMMENTED/APPROVED observations remain attributable to their exact commit and do not establish clean QA or a Gate approval. Unresolved finding resolution is not read by this bounded adapter; Codex QA remains UNKNOWN.

## Current-source / permission audit (2026-11-01)
- GitHub main: `292e8d24cd856255214403fd38690834386e4b61`.
- Draft #97: `fd607182bba296d368d33df70bd427aa81442762`, unmerged. Reused its V1 monitor, styles, model, regression tests and original isolated workflow.
- Draft #102: `875c49734b6d08592db9988dd6797ba840a5e42c`, unmerged. Reused its fixed-target exact-head normalizer and negative tests; added #102 itself as seventh target. Its synthetic entry point always retains SYNTHETIC_FIXTURE_ONLY provenance. The new validated GitHub adapter reuses its computation, never its fixture.
- Existing server allowlist was PM-only. Issue #103 explicitly opens the existing development-history GET integration for the three approved additions. The V1 HTTP surface remains the same four GET routes; no server.ts change.
- Both connector metadata and existing authenticated `gh api --method GET` confirmed `pull:true` for the three private sources. No login, scope expansion, token access or credential changes.
- Numeric identities verified: PM `1221937556`; Inventory `1344622897`; Lab `1423925660`; Command Center `1352468489`. Exact full_name, id and canonical URL are checked before dependent history reads; PR base identity and number/URL are also checked. Transfers/renames fail closed.
- Original checkout had unrelated dirty changes and was behind main. Native managed worktree creation was unavailable for this project's attached roots, so an isolated clone was created in this project. Original files are untouched; only its Git remote refs were fetched.

## Bounded evidence and freshness
- History reuses existing limits: 500 branches, 500 PRs, 1,000 default-branch commits, up to 30 focused refs and 250 compared commits/ref; explicit partial coverage and consistency checks remain intact.
- Only the seven fixed ZC PR details trigger workflow status reads: Lab #36/#37/#39/#42/#44, Command Center #97/#102.
- Per detail: repository metadata, PR, at most 100 checks, at most three 100-review pages, one 50-workflow-run page, then PR reread. Maximum eight GETs; each has a 20-second timeout and cancellation. Workflow results must match the exact HEAD, fixed workflow name and audited workflow path. Truncated/ambiguous results remain UNKNOWN.
- Workstream requests use two concurrent browser workers. 30-second local checks reuse the existing five-minute memory-cache policy. Manual refresh bypasses and invalidates that key; a failed refresh cannot resurrect an earlier cached PASS.
- Source failure, head drift, invalid/future timestamps and evidence older than five minutes suppress current success. No automatic Gate progression. Historical Codex observations show HISTORICAL; missing/completeness/clean-review evidence stays UNKNOWN.

## Validation and release gates
Local baseline: 109/109 existing history / #97 / #102 tests passed using fake GitHub. Initial loopback permission errors were resolved by running local test servers under the approved execution permission.
Local candidate checks: 206/206 scoped Node tests and 274/274 UI tests PASS; TypeScript and Vite/server bundles PASS. The scoped suite includes source/identity/status/HTTP security regression and all existing UI tests. Copied dependency inventory: 313 installed entries, zero version mismatches against package-lock. Real Docker/provider/agent integration suites are intentionally outside this task and are not executed. No registry download was needed locally: existing same-main dependency installation was copied into the isolated checkout; no global npm configuration was read or changed.

Independent review and exact candidate CI evidence must be evaluated separately from implementation tests. Product acceptance remains HOLD until the actual Safari journey is checked. No merge/deploy authorization is implied.

## Safari local UAT
Use this isolated checkout, not the original dirty checkout:

```sh
cd /Users/augusliang/.codex/.chatgpt-projects/g-p-6a94012dca4c8191ae40c7f5c2959985/command-center-zc08d
NODE_ENV=production PORT=3133 COMMAND_CENTER_ORIGIN=http://127.0.0.1:3133 COMMAND_CENTER_LEGACY_CAPABILITIES= node dist/server.cjs
```

Open Safari at **http://127.0.0.1:3133**. This is a local production-mode bundle, not a production deployment. The server binds loopback only; use the exact origin. The existing gh session supplies only the already authorized reads. If that session lacks access later, leave the affected source UNKNOWN; do not log in or widen permissions as part of UAT.

1. Confirm the three catalog cards and the separate saved-state section; no saved-state file is created when absent.
2. Open PM and Inventory maps; check canonical repository source, Last checked, recent PR links and Git parent topology against each repository.
3. Open Zero-Copy; switch Lab ↔ Command Center in the two-repository selector. Each switch must show only that repo's graph and clear old detail state. Inspect the four workstreams, seven PR links and full exact commit identifiers.
4. Compare CI links with the displayed commit; compare Codex observation commits and HISTORICAL labels. Agent must remain NOT_CONNECTED and Gate unassessed, including after CI PASS.
5. Refresh; then disconnect the browser/network and retry. No former PASS may remain current. After five minutes without validated source recovery, workstream statuses are STALE/UNKNOWN. Reconnect and verify recovery from a new validated read.
6. Check wide and narrow layouts and return through Overview, Map and Live Monitor. Record candidate SHA, Safari version, time, source and acceptance separately. Stop the local server with Ctrl-C when finished.

Automated browser control is unavailable in this session. Deterministic React tests are UI regression evidence, not Safari UAT or live Product Acceptance.

## Live observation and independent review evidence

Local read-only HTTP smoke at candidate `9e62f06408226f40c239788f64ea9af67f7af691`, 2026-11-01 20:01–20:02 SGT:

| Exact repository | Branches | PRs | Commits in bounded history | Result |
|---|---:|---:|---:|---|
| augusliang23-web/pm-dashboard | 103 | 92 | 761 | HTTP 200, complete / consistent |
| alin36242-web/inventory-management-tool | 46 | 41 | 139 | HTTP 200, complete / consistent |
| augusliang23-web/cc-h15a-claude-dispatch-lab | 22 | 21 | 138 | HTTP 200, complete / consistent |
| augusliang23-web/Micro-SaaS-Command-Center | 39 | 39 | 226 | HTTP 200, complete / consistent |

These are bounded snapshots, not total repository statistics or durable current claims. All seven fixed PR reads returned HTTP 200, exact-head CI PASS, Codex QA UNKNOWN and Agent NOT_CONNECTED. Codex observations were separately labelled CURRENT_HEAD or HISTORICAL, never clean QA. Unallowlisted history returned 403; POST returned 405; absent saved state returned 404 and no data directory was created.

Independent reviewer (separate Codex / GPT-6.1 Sol High role) inspected base `292e8d24cd856255214403fd38690834386e4b61` through `9e62f06408226f40c239788f64ea9af67f7af691`. Initial recommendation HOLD: one reproduced P2 concurrency defect allowed an older in-flight read to repopulate cache after a failed forced refresh. No other demonstrated material findings. Reviewer ran 46 pure status/monitor and 29 selected UI tests; its restricted HTTP tests encountered listen EPERM, so author-run approved loopback regression supplies that evidence separately.

Remediation: per-key cache generations reject writes by invalidated reads for both history and fixed-PR detail. Concurrent regressions reproduced two failures before the fix, then 76/76 combined history/integration tests passed. A focused follow-up independent review is required on this delta; its exact final SHA/result and exact-head CI run are recorded in Draft PR #104 rather than implying the initial HOLD was an approval. No production Gate has been granted.
