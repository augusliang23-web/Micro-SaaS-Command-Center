# ZC Pilot 01 — Issue #105

Run `node tools/zc-pilot/server.mjs` for read-only mode. Within the owner's explicitly authorized fixed issue-intake scope, run `node tools/zc-pilot/server.mjs --allow-github-intake`. Open http://127.0.0.1:3134/ in Safari. No npm install, environment file, token copy, daemon or provider call is needed. Existing authenticated gh supplies GitHub access; the app never reads or prints token values. Do not grant new scopes if access fails.

This is an independent local Command Center entry on main's codebase, not a deployment or integration of Draft #104. Port 3133 remains separate. Stop the foreground process to stop serving. Default V1 and server.ts are unchanged.

## What is real
The fixed create button calls the local policy endpoint, reconciles prior records, checks exact PM base, creates a real issue in Micro-SaaS-Command-Center and reads it back from GitHub. Subsequent clicks return the same record. Complete bounded issue scans include closed issues and PR entries. A title/key collision or altered body holds. No arbitrary user payload becomes a command or prompt.

`GET /api/session`: zc.session/v1, fixed task and session CSRF token. `GET /api/tasks`: zc.status/v1 plus zc.event/v1 intake observations. `POST /api/tasks`: only `{ "schema": "zc.intake/v1", "taskId": "zc-pilot-01-pm-reduced-motion" }`, exact Origin/Host, JSON and X-ZC-CSRF required. POST is disabled unless --allow-github-intake is supplied. Static assets are fixed and use restrictive CSP/no-store.

## What is blocked
Worker NOT_CONNECTED, dispatch HOLD, PM implementation NOT_STARTED, tests NOT_RUN and owner UAT PENDING are independent from intake RECORDED. CI here tests the intake implementation using controlled GitHub responses; it does not validate PM code or a real worker. Source failures clear the UI to UNKNOWN.

Mac ZC-06C same-UID staging substitution P2 remains HOLD (PR #36). Do not execute it, alter settings or infer safety from Linux tests. Native task/session tools in this chat can do authorized work but are not a connected unattended Command Center worker. No approved cloud runner, provider authorization, billing mode or credentials have been established. A secure next gate is a separately scoped isolated runner with repository/file-limited access, provider access/spend authorization, authenticated capability grants, exact base/branch and bounded test/review/Draft PR outputs. This document does not create that access.

## Idempotency limits
The fixed key is in the exact GitHub task body; creation is serialized locally. Zero automatic POST retries. A timeout or failed read-back latches WRITE_UNCERTAIN; GET may recover an existing valid record. Do not restart to bypass uncertainty. GitHub issue POST is not atomic compare-and-swap: multiple machines or simultaneous external writers may create duplicates. Duplicates hold, never dispatch. Durable distributed worker claims are a future boundary, not claimed here.

## Grok migration
Task data is zc.task/v1; taskId/idempotencyKey, source identity, base SHA, scope, acceptance and required capabilities do not reference chat state or prompts. Status/events carry version, stable identity/revision and GitHub evidence URLs. Replace only the control-plane adapter when moving to Grok; task records stay unchanged. The GitHub adapter owns transport; no HTTP route or task envelope authorizes an agent. Unknown future versions must fail closed.

## Validation and Safari checklist
`node --test test/zc-pilot.test.mjs test/status-provenance.test.mjs`; `node --check` all pilot modules; `git diff --check`. New CI runs these without npm, secrets, live GitHub calls, deployments or writes. Independent reviewer checks actual base..head, boundary failures, uncertainty, truthful status and CI permissions.

Safari: initial GitHub source query; create fixed task; real issue link opens matching target/body; refresh preserves record; browser reload recovers from GitHub; repeated POST does not create duplicate; read-only launch denies POST. User acceptance requires the owner; agent-driven browser evidence is reported separately. Do not count the pending PM scenarios as verified.
