# ZC Pilot 02 — GitHub-first, headless admission (Issue #109)

## Goal and scope
Zero-Copy must not require the Safari `127.0.0.1:3134` page or any ChatGPT conversation. Grok Bot, ChatGPT or another control plane can eventually create a **versioned GitHub task**; GitHub becomes the task/event/evidence source of truth; an independently authorized, isolated worker may act only when a trusted capability grant exists.

This **first slice** implements a real GitHub `issues` event admission path and a bounded read-only validator. It **does not** execute coding, call a provider, create a PR, send GitHub comments, change task labels, run a daemon, or authorize any worker. A successful GitHub Actions check means the validator ran, **not** that the task was approved or completed.

## Proven parent baseline
- Stacked on Command Center Draft PR [#106](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/106) at `49d87f1d72040a2e914ab9235a9aa1b8a7f7efac`; source contract imported from `tools/zc-pilot/contract.mjs`, not copied into a second incompatible source.
- Actual fixed native subscription pilot: task [Issue #107](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107), execution evidence [comment 6567935283](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107#issuecomment-6567935283), PM Draft PR [#96](https://github.com/augusliang23-web/pm-dashboard/pull/96).
- Pilot01 `zc.task/v1`, `zc.authorization/v1`, `zc.job/v1`, `zc.event/v1` stay unchanged. No new task, duplicate provider call, PM code change or PR.
- ZC-06C Mac same-UID settings-race security gate stays HOLD.

## Trigger / evidence semantics
`.github/workflows/zc-headless-admission.yml` defines `issues` events for `opened`, `edited` and `labeled`; narrowly filters titles beginning `[ZC Task]` and for labeled events only `zc:headless-review`. The action uses a GitHub-hosted runner, `contents:read` and `issues:read` only. It checks out trusted default-branch code with credentials persistence off and runs Node22 without installing packages or calling a provider. The task/issue body is **parsed as untrusted data**, never a shell argument or executable command.

GitHub does **not** trigger this workflow for issue events until the workflow is present on the default branch. This is a **Draft PR** and the earlier Pilot01 PR #106 is also unmerged. Therefore the issue-triggered workflow is **not yet live**. No Merge/Deploy permission has been granted; no real background job is claimed. The separate `zc-headless-admission-qa.yml` tests the candidate on a pull request.

`admission.mjs` validates the signed-by-GitHub event's repository context against the immutable repository ID and canonical full name; verifies canonical Issue URL, Issue-vs-PR, action, body length, single task marker, exact JSON fence and the existing fixed `zc.task/v1` contract. It rejects changed files, added model/shell capabilities, altered authorization and lookalikes. It emits only safe `zc.admission/v1` metadata:
- `IGNORED`: unrelated issue, action or label.
- `HOLD_INVALID_SOURCE`: spoofed/missing repository, event, issue identity.
- `HOLD_UNSUPPORTED_TASK`: task not the specifically approved Pilot01 contract.
- `HOLD_NOT_AUTHORIZED`: recognized fixed task, but **no trusted execution grant**, therefore `agent:NOT_CONNECTED`, `dispatch:HOLD`, `readyForWorker:false`.

An Issue label, comment, JSON body field, Grok instruction, workflow SUCCESS or `executionAuthorization:GRANTED` text cannot grant worker permissions. Do not create a duplicate of Task #107 to test this. The validation is stateless/read-only; do not mistake deterministic evaluation for durable cross-run worker reservation.

## How Grok Bot can fit, without a custom web page
Official Grok Bot supports GitHub connections and event-triggered Routines. After separately connecting authorized GitHub access, create a **narrow Routine** whose source is the designated GitHub task queue, not any GitHub issue/comment. It must first read and verify a versioned contract, verify repository/PR provenance, and report `HOLD` whenever grant, quota or source is missing. **Do not** use Grok text, issue labels or its conversation identity as execution authorization. Disable automatic Merge, Deploy, provider overage and unbounded retries. The Bot's cloud computer could potentially be the worker, but its real coding ability, permissions, cost and callback must be tested independently. No Grok integration or Routine is installed by this PR.

### Suggested Grok Bot Routine specification (NOT enabled)
- Trigger: a new GitHub issue with an explicit `[ZC Task]` task header in the configured Command Center repository; ignore other repositories and existing Issue #107.
- Action: read authoritative issue, evaluate `zc.task/v1` and `zc.authorization/v1` from trusted sources, avoid duplicate claims, and post a bounded status/evidence update only after separately authorized GitHub write permissions.
- If no authenticated grant or worker capability: report `HOLD_NOT_AUTHORIZED` with Issue link; do not run a model or modify source.
- Only after a separately approved worker rollout: process a bounded single eligible task in isolated checkout with target allowlist, quota limits, source-hash pinning, fixed tests, independent QA and Draft PR; stop for any source/identity drift.
- Notify Owner only on terminal progress or required decision, not empty polling. Require Owner approval for Merge/Deploy.

## Future real execution gate (not yet met)
1. **Default-branch activation:** Owner review and separately authorizes merge of parent and this stacked Draft. No automatic merge.
2. **Trusted job authorization:** a server-side/canonical grant bound to immutable Issue ID, exact target commit, repo/file list, limits, authorized worker identity and expiry. Never accept authorization from task body.
3. **Runner choice:** either explicitly approved Grok Bot cloud computer (native GitHub Routine) **or** isolated GitHub-hosted worker with independently verified model authentication and cost limits. Do not migrate a local ChatGPT subscription session or credentials into an untrusted hosted runner.
4. **Durable claim and lifecycle:** atomic cross-run claim, idempotent event ledger, unknown/timeout HOLD, fixed allowed tools, exact-head PR/CI/Codex provenance, bounded independent repair. The previous one-shot local journal is not distributed exactly-once.
5. **UAT:** one *new* authorized task proves unattended event → execution → Draft PR → independent QA → GitHub status and Grok notification, with Safari closed. No arbitrary task claim until this works.

## Developer checks
`node --test test/zc-headless-admission.test.mjs` and `node --check tools/zc-headless/admission.mjs` are deterministic and need no network/npm install/provider. GitHub Action QA runs the same checks at exact PR HEAD. They validate admission semantics only, not a live Grok or Codex worker.

## Safety constraints
Strict read-only; no secrets/tokens in output; no paid API, provider calls, Mac global settings/IAM/Firebase, PM/Inventory edits, merge or deployment. Trigger/role authorization must be reassessed before any live write/execution. This is a conditional foundation, not a completed autonomous ZC product.
