# Bridge V0.4 Zero-Copy Codex Handoff MVP Design

**Date:** 2026-09-02

**Status:** Approved for implementation

**Scope:** Local-development Command Center to Codex handoff only

## Objective

Let a user start one real Codex task from the existing Command Center project drawer with one explicit **Run with Codex** action. The handoff must use the installed Codex App Server and native ChatGPT authentication, execute inside a server-allowlisted repository, and stream truthful task status back to the Command Center without manual prompt copying.

## Architecture

The browser sends a structured project/task request to a local Express endpoint. The endpoint is available only when `NODE_ENV=development`, accepts JSON from the expected local Command Center origin, and never accepts a client-supplied repository path. A small in-process service resolves the project through a server-side allowlist, applies governance gates, constructs the complete V0.4 handoff payload, and starts a short-lived `codex app-server` child process with `shell: false`.

The App Server client performs the official sequence:

1. `initialize`
2. `initialized` notification
3. `account/read`
4. `thread/start`
5. `turn/start`

It requires `account.type === "chatgpt"`. It neither receives nor persists tokens and has no API-key fallback. The thread is created with read-only sandboxing and approvals preserved; any approval or user-input request becomes `AWAITING_INPUT` and is never approved automatically.

## Local boundary

- Bind the development server to `127.0.0.1`.
- Enable handoff routes only in local development.
- Require the configured local Command Center origin.
- Require `application/json` for dispatch POSTs.
- Fail closed in production or deployed mode.
- Resolve repositories only through a server-side JSON allowlist.
- Keep the allowlist's real local paths untracked; commit only an example.
- Do not add authentication services, background processes, watchers, heartbeats, locks, PID recovery, polling daemons, or persistence.

## Handoff and status

The service emits every required field from the merged Bridge V0.4 Handoff Contract. An in-memory idempotency map returns the existing active handoff for duplicate clicks. This intentionally does not survive a server restart.

Provider events normalize to:

- `NOT_STARTED`
- `QUEUED`
- `WORKING`
- `AWAITING_INPUT`
- `COMPLETED`
- `FAILED`
- `BLOCKED_PROVIDER`
- `BLOCKED_ENVIRONMENT`

The UI displays the handoff ID, Codex thread/task ID, provider, handoff strategy, actual model when reported, state, last activity, blockers or approvals, and terminal result/error.

## First smoke

The first real dispatch is a fixed, read-only repository inspection. It must prove that one browser action starts a native App Server task in the allowlisted checkout, returns live status/result, makes no repository changes, uses ChatGPT authentication, and leaves no daemon or watcher behind.

## Explicit exclusions

This MVP does not implement ChatGPT-to-Command-Center handoff, provider adapters, API-key auth, persistent idempotency, runtime migration, deployment, Command Center production integration, V0.3.x changes, LaunchAgent changes, watcher changes, PR #14 changes, consumer-repository changes, auto-approval, merge, deploy, or release.
