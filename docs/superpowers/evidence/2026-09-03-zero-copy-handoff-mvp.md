# Bridge V0.4 Zero-Copy Codex Handoff MVP Evidence

**Date:** 2026-09-03

## Integration decision

The MVP uses the installed Codex App Server (`codex app-server`) over stdio. It was selected because it exposes the required native thread lifecycle, streamed events, and native approval behavior without adding a dependency or a separate API-billed path. The installed client reported `codex-cli 0.151.0`, and `codex login status` reported `Logged in using ChatGPT`.

The adapter uses the documented protocol sequence:

1. `initialize`
2. `initialized`
3. `account/read`
4. `thread/start`
5. `turn/start`

It rejects every account type except `chatgpt`, strips API-key environment variables from the child process, and never reads, stores, or sends credential contents to the browser.

## Read-only end-to-end smoke

The smoke was initiated with the existing Command Center project's **Run with Codex** button. The browser sent the structured handoff directly to the local adapter; no task prompt was copied or pasted into Codex.

| Evidence | Observed value |
| --- | --- |
| Handoff ID | `01614fd8-e8b2-4d58-8bbf-691828d47b3e` |
| Codex thread ID | `01a06485-9676-7412-b644-29409ab41cd6` |
| Provider | `CODEX_APP_SERVER` |
| Strategy | `CONTROL_CENTER_ADAPTER` |
| Lifecycle | `WORKING` then `COMPLETED` |
| Auth path | Native ChatGPT login |
| Task | Allowlisted repository inspection only |
| Codex result | Reported branch, exact HEAD, working-tree state, and top-level structure; reported no file modifications, commits, branches, PRs, deployments, or releases |
| Process cleanup | The child App Server exited; the only remaining App Server process was the pre-existing Codex desktop process |

The browser exposed the handoff ID, Codex task ID, provider, strategy, model availability, state, timestamp, blocker/error field, and terminal result. The native App Server did not report a model during this smoke, so the UI truthfully displayed `Not reported`.

## Review fixes

Independent review required two fixes before delivery:

- Each non-idempotent handoff now creates an isolated App Server client, so concurrent callbacks cannot cross-update another handoff.
- Only provider status `completed` maps to `COMPLETED`; `interrupted`, `failed`, and unknown terminal statuses map to `FAILED`.

The adapter also closes stdin after terminal completion, waits one second, then sends `SIGTERM` and finally `SIGKILL` only if the child remains alive. This bounded cleanup is visible as `process_cleanup` in the in-memory status record.

## Status Contract corrections

The latest independent review required three narrow status corrections:

- `BLOCKED_PROVIDER`, `BLOCKED_ENVIRONMENT`, and `FAILED` now normalize to governance state `BLOCKED`; they are not presented as actively executing.
- `AWAITING_INPUT` keeps `approval_state: REQUIRED` without immediately deriving `stalled: true`. This MVP has no SLA/stall evaluator, so it reports `stalled: false` and `stalled_reason: null` until such a mechanism exists.
- A `processCleanup` update records cleanup state but does not advance `last_meaningful_activity`.

Focused regressions cover all three corrections.

## Known limitations and capability gaps

- This is intentionally a local-development, read-only MVP. Normal write-capable engineering handoffs are not enabled.
- Idempotency is process-memory only and is lost when the local server restarts.
- Native approvals correctly become `AWAITING_INPUT`; this MVP does not yet provide a Command Center approval-resolution UI.
- The current UI supports the server-side configured project allowlist only. It never accepts a browser-supplied filesystem path.
- Model display depends on an App Server-reported model; the observed smoke did not report one.
- No persistent event store, watcher, heartbeat, daemon, PID recovery, lock manager, quota timer, or background resume mechanism exists.
