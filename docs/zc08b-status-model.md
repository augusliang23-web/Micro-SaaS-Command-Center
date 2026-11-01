# ZC-08B1 — Synthetic Zero-Copy status normalization (offline only)

Linked to Issue #101 and design Issue #100. This candidate is deliberately *not* wired into the running Command Center. It is a pure data-contract experiment preparing ZC-08B without widening any GitHub integration or source allowlist.

## Static target identities

- ZC-06C: lab Draft PR #36
- ZC-07: lab Draft PR #37
- ZC-09: lab Draft PR #39 (offline policy), #42 (claim proposal), #44 (fixture CAS)
- ZC-08: Command Center Draft PR #97

Only these six literal pairs are accepted. Inputs do not get to choose arbitrary repos, PRs, links or workflow names. Returned URLs are created from the static allowlist, not caller fields.

## Required future trusted inputs

A separately authorized, minimal read-only GitHub evidence collector would obtain exact current PR HEAD, draft/merged state, matching workflow run status/conclusion, matching Codex review receipt with exact reviewed SHA and findings, as-of timestamp, independently attested source availability and freshness. This experiment takes all of those as **synthetic input**. It does **not** verify authenticity, query GitHub, contact Codex or cache private comments.

## Strict status rules

- CI: `PASS`, `FAIL`, `QUEUED`, `RUNNING`, `SKIPPED`, `CANCELLED`, `FAILED`, `BLOCKED`, `UNKNOWN`, `STALE`; only exact-HEAD matching workflow evidence may be PASS.
- Codex: `NO_NEW_MAJOR_FINDINGS`, `FINDINGS`, `RUNNING`, `FAILED`, `UNKNOWN`, `STALE`. **No** automatic `OWNER_APPROVED` or `SECURITY_CERTIFIED` state.
- Summary: `READY_FOR_REVIEW` requires exact-head CI PASS plus completed no-new-major-findings review; a CI failure or review findings/failed review produces HOLD; incomplete evidence yields PARTIAL; source error yields STALE. Merged state is represented only when source snapshot itself attests it.
- The Agent status is **always `NOT_CONNECTED`**. CI executing, code review running or a PR with new commits does not prove an actual coding Agent is alive.
- Invalid shapes, old/mismatched SHA, duplicate runs without a reliable sequence, arbitrary extra properties, future/stale timestamps, or unknown identities fail closed.
- The output contains no raw PR title, comment text, email, token, path, stdout, stderr or user-provided link.

## Explicit limitations

This is **fixture-only normalization**, not a new GitHub entitlement or endpoint. The current ZC-08A client reads only an existing PM Dashboard allowlist; PR #97 remains Draft and is unchanged here. No server change, expanded private-repo read access, browser application, user Mac launcher, worker heartbeat, provider call, Merge or Deploy is authorized by this phase.

A future separate review must secure the backend GitHub reader with fixed targets, bounded concurrency/rate, TTL and read credentials before connecting these fields to the UI. PR #44 is a fixture CAS candidate, not a real running worker. Native macOS and same-UID risks on ZC-06C stay HOLD.

## QA

`node --check src/v1/zc08bStatusModel.mjs`
`node --test test/zc08b-status-model.test.mjs`

Exact Draft-PR GitHub Actions verification must use read-only permissions, Node 22, no npm install, credentials or network calls from test code.

Gate: `ZC08B1_OFFLINE_MOCK_ONLY / LIVE_GITHUB_FEED_NOT_CONNECTED / AGENT_HEARTBEAT_NOT_CONNECTED`.
