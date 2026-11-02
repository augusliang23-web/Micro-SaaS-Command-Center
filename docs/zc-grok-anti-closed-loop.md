# Pilot 02D — Grok ⇄ Antigravity closed loop, offline bridge building blocks

Owner P0: [Issue #114](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/114).
This is a **stacked Draft PR** on Pilot02C [#113](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/113), Pilot02A [#110](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/110), and Pilot01 [#106](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/106). Never merge out of sequence; no authorizations or deployments implicit.

## Goal and boundaries

Required eventual UX: owner discusses one task in **Grok Bot**, says "開始開發", Grok creates a **versioned GitHub Issue**; approved Mac **Anti** Worker automatically obtains it and runs an authorized, sandboxed `agy` job, produces a **Draft PR + CI/QA**, then Grok reads the PR/CI evidence on supported `pr-opened` or `ci-passed/ci-failed` Routine and tells owner next steps.

Current artifacts are **OFFLINE PURE PARSERS ONLY**, with **zero** GitHub API requests, model/provider calls, local launch agent, polling, credential inspection, authorization grants or writable actions. Do **not** interpret this PR as a functioning auto-worker or bot Routine.

## A. Task queue admission (`tools/zc-bridge/task-queue.mjs`)
- Source is a future trusted GitHub API Issue snapshot; caller must authenticate & verify upstream transport (this code cannot). Expected fixed repo identity: numeric `1352468489`, `augusliang23-web/Micro-SaaS-Command-Center`.
- An Issue body is untrusted and has exactly one `<!-- zc.bridge-task/v1 -->` marker and one JSON code fence. No extra prose. Maximum 16 KiB.
- Only `zc.task/v1` with strict keys. Required fields: `schema,taskId,repositoryId,repository,baseSha,goal,paths,verificationSuite,limits`. Example:

```markdown
<!-- zc.bridge-task/v1 -->
```json
{"schema":"zc.task/v1","taskId":"zc-safe-pilot-02","repositoryId":1352468489,"repository":"augusliang23-web/Micro-SaaS-Command-Center","baseSha":"<verified full lowercase 40-hex commit SHA>","goal":"Update one bounded sample source file without infrastructure changes","paths":["tools/zc-pilot/server.mjs"],"verificationSuite":"node22-offline-tests","limits":{"maxMinutes":10,"maxTurns":2,"maxRetries":0}}
```
```

- `paths` currently require unique sorted relative `tools/`, `test/`, `docs/` entries; absolute, traversal, dot-hidden and `.github` paths rejected. Test suite is a symbolic preset, **never shell commands from Issue**. Limits are parsed as bounds for later trusted policy; this code does not enforce runtime limits because it never runs jobs.
- A valid Issue results in `PENDING_TRUSTED_GRANT`; it is **not** an execution permit. It returns only task digest (idempotency hint, **not a signature**), no task prompt or secrets. Queue duplicates and malformed input are rejected. `dispatch=HOLD`, `worker=NOT_CONNECTED`, `readyToCode=false`.

## B. Grok callback normalization (`tools/zc-bridge/grok-callback.mjs`)
- Offline accepts a future normalized GitHub snapshot for `pr-opened`, `pr-pushed`, `ci-passed`, or `ci-failed`. This is not the Grok Routine payload contract; an authenticated event/CI adapter is not connected.
- Requires exact repository ID, canonical PR URL, open Draft PR, same-repo base/head and exact 40-char SHA.
- Requires exactly one `<!-- zc.bridge-result/v1 task=zc-... issue=N -->` task marker and a canonical GitHub Issue link in PR body. A marker is **never proof of Agent identity or approval**.
- CI terminal snapshots must agree on exact PR number, HEAD SHA and completion conclusion. This is still merely **unverified event data**; Grok must freshly read source, checks, review, changed files, grant and tests itself.
- Produces a deterministic `wakeKey` for duplicate suppression per PR/HEAD/event stage. Actual dedupe requires durable receiver storage and remains unimplemented. `grokRoutine=NOT_CONNECTED`, `gitHubReFetch=REQUIRED`, `independentQA=NOT_VERIFIED`, `userNotified=false`.

## C. Detached signed execution-grant scope primitive (`tools/zc-bridge/grant-verifier.mjs`)

- A `zc.authorization/v1` object is **separate from the Issue body**. It binds the Issue number, `taskId`, canonical SHA-256 task digest, exact repo identity, HEAD/base SHA, sorted file paths, worker ID, max runtime, expiry and nonce.
- `verifyDetachedGrant` checks a detached Ed25519 signature using a **caller-supplied public KeyObject** and verifies all bounds. It does **not** generate production private keys or commit secrets. Unit tests generate ephemeral key pairs in memory, only inside GitHub CI.
- A cryptographically correct signature yields `CRYPTO_SIGNATURE_SCOPE_MATCH` but **still `dispatch:HOLD`, `ownerApproval:NOT_VERIFIED`, `nonceReservation:NOT_RESERVED`, `worker:NOT_CONNECTED`**. This is intentional: the public key has not been pinned out of band, no live owner authorization exists and the signed nonce has not been durably consumed.
- A future runner must have a distinct trusted policy service, secure public-key enrollment, atomic one-time claim, host identity, effective sandbox and quota gates before interpreting any signature as actual permission. The GitHub Issue, PR marker or Grok Bot message must never supply its own trusted public key.

Task JSON currently must match exact `JSON.stringify(task)` canonical minified serialization to prevent duplicate-key ambiguity. Two tasks with the same `taskId`, even if goal/digest differs, cannot share a dry-run queue without a HOLD.

## D. Bounded offline queue poll planning (`tools/zc-bridge/poll-plan.mjs`)

After the actual Grok/Cursor G0 write-readback Issue #116 (2026-11-02), the next safe engineering slice is a pure read-only poll planner. This module **does not access GitHub** and cannot run `agy`. A later authenticated transport must supply a validated Repository identity and a complete, bounded series of Issue pages; the current code cannot attest that transport.

- Reject wrong repository ID/name/URL, malformed or overlapping pages, incomplete pagination (up to 3 pages of max 20 Issues each), spoofed Issue URLs and repeated Issue numbers.
- Filter normal non-task Issues before schema admission, including the exact `<!-- zc.connection-probe/v1 -->` marker of [G0 Issue #116](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/116).
- If an Issue begins with the actual `<!-- zc.bridge-task/v1 -->` marker, *always* pass it to the strict validator, even if malformed, producing HOLD rather than silently dropping it.
- The resulting `zc.bridge.poll-plan/v1` intentionally retains `source:UNVERIFIED_API_SNAPSHOT`, `dispatch:HOLD`, `worker:NOT_CONNECTED`, `readyToCode:false`. No credential, Issue body, GitHub write, model prompt or API request is emitted.

**Callback dedupe correction:** A failed CI run followed by a successful CI run for the same exact SHA must produce **distinct** wake keys (`CI_FAILURE` and `CI_SUCCESS`), otherwise the success can be swallowed. Repeated identical stage/HEAD remains idempotent. This still does not establish a real Grok Routine or durable delivery log.

## E. Security / negative QA

`node --test test/zc-bridge-task-queue.test.mjs test/zc-bridge-grok-callback.test.mjs test/zc-bridge-grant-verifier.test.mjs test/zc-bridge-poll-plan.test.mjs`

- Wrong repository/ID/URL, forged or duplicate task IDs, duplicated/noncanonical JSON keys, task-envelope extra text, invalid schema/paths/limits, spoofed Issue URL suffixes, PR/source drift, invalid marker, forged CI SHA/conclusion, changed/expired Ed25519 grants, untrusted signers and untrusted secret echo all fail closed.
- GitHub exact-head CI uses only no-install Node22 + mocked payloads on GitHub-hosted runner with read-only `contents`; **no real Anti, Grok, network provider, authentication, model or new GitHub writes**. The Grok G0 Issue #116 is already a separate successful live write/read-back test; its creation is not repeated by CI.

## Next gated development

1. Owner restricts Cursor/Grok GitHub installation to only this repo, and proves Grok Issue-write / Routine ability. Existing admin-wide access to at least 16 repos remains **HOLD**.
2. Owner approves disposable Mac sandbox negative tests. `agy 1.4.12` flags pass the real host CLI interface test, **not** effective filesystem/process isolation or CLI auth/quota.
3. Add an independently reviewed trusted grant (out of Issue body), signed immutable repo/task/base SHA/file scope, durable atomic claim/reservations and authentication-bound local transport. No run from Issue label, assignee or body alone.
4. Build no-model Mac dry run (after separate authorization), then one tightly scoped real Anti `agy -p` session with isolated files, budget, verified tool-stream outcome, Draft PR and independent QA.
5. Configure and test one Grok `pr-opened` / `ci-passed` Routine with exact callback filtering, durable dedupe and owner-facing report.

## Current gate
`OFFLINE_QUEUE_AND_CALLBACK_QA_CANDIDATE / GROK_READ_PASS / GROK_WRITE_UNKNOWN / ANTI_CLI_PASS / ANTI_SANDBOX_UNVERIFIED / WORKER_NOT_CONNECTED / ROUTINE_UNTESTED / MERGE_DEPLOY_HOLD`.

**Important:** Command Center main still does not have this workflow; creating a Draft PR and offline tests is not activation. A Mac awake state is required for a future local worker, and no background process is installed by this PR.
