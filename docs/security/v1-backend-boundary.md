# Command Center V1 — backend capability boundary

Status: implemented on the V1 integration branch. Source: `server.ts`, `server/v1RequestPolicy.mjs`, `server/v1ReadOnlyRoutes.mjs`.
Tests: `test/v1-backend-boundary.test.mjs` (runtime, disposable servers) and `test/server-runtime-bootstrap.test.mjs`.

## What V1 serves

The default server (no configuration) serves **exactly four GET routes** and the static app:

| Route | Behaviour |
|---|---|
| `GET /api/health` | `{status, timestamp}` only. It does not reveal whether provider keys exist. |
| `GET /api/state` | Reads `data/app-state.json` under the process cwd. Absent → `404 {"error":"No saved state yet."}`; unreadable or wrong shape → `500`. The file is never created, repaired, migrated or overwritten. |
| `GET /api/github/development-history` | Existing handler, existing repository allowlist (`augusliang23-web/pm-dashboard`), cancellation and rate-limit handling. |
| `GET /api/github/development-history/pull` | Same. |

Everything else under `/api` answers a JSON API error: unknown paths `404`, any method other than `GET` `405` with `Allow: GET`
(this includes `HEAD` and `OPTIONS`; HEAD is refused explicitly instead of relying on Express' implicit HEAD-for-GET).
Outside `/api` only `GET` and `HEAD` are accepted, with the SPA fallback. Refused requests never reach a handler and their bodies are discarded unparsed.

A V1 process does **not**: construct a `TaskStore` (so it neither creates `data/tasks` nor rewrites persisted active tasks), load the project
registry or the Codex allowlist, read `.env` (neither our code nor Vite in development), construct a provider client, mount the AI bridge,
Codex handoff, task, state-write or local-Git routes, or run `git`/agent processes.

## Capability selection

`COMMAND_CENTER_LEGACY_CAPABILITIES` (process environment only) is a comma separated list of exact lower-case names. Unset or blank means none.
`NODE_ENV` never enables anything, and a missing or mistyped `NODE_ENV` does not either.

| Name | Mounts |
|---|---|
| `state-write` | legacy `/api/state` router (GET **and PUT**) |
| `tasks` | `/api/tasks` and the `TaskStore` (its start-up recovery rewrites active tasks to `UNKNOWN`) |
| `providers` | the three `/api/bridge/*` AI POST handlers, the legacy health payload and the Gemini/OpenAI use; loads `.env` |
| `github-legacy` | every legacy `/api/github/*` route (broad account scope) |
| `local-git` | `/api/local-git/*` (runs `git fetch`) |
| `codex-handoff` | `/api/bridge/codex-handoffs`; additionally requires `NODE_ENV=development` |

An unknown name, an empty entry or a wrong-case name makes the server refuse to start, before any service exists. So does a
`COMMAND_CENTER_ORIGIN` that is not an `http` loopback origin. `.env` is loaded only when at least one legacy capability is enabled,
so `PORT` and the capability list themselves come from the real process environment, never from `.env`.

### Migration

The legacy UI (`src/App.tsx`) is not mounted by V1. Anyone still using a legacy feature must opt in explicitly, for example
`COMMAND_CENTER_LEGACY_CAPABILITIES=state-write,tasks npm run dev`. Nothing is silently re-enabled for compatibility.

## Host / Origin / Referer policy and what it does not protect

* `Host` must equal the trusted origin's host (default `127.0.0.1:<PORT>`) on every request: this blocks DNS-rebinding hostnames. A request with no Host header is refused.
* On `/api`, a present `Origin` must equal the trusted origin exactly (`null`, other loopback ports, `localhost`, malformed values and empty values are refused).
  A present `Referer` must parse and have the trusted origin. Refusals are `403` JSON.
* A request with **no** `Origin` and **no** `Referer` is accepted by design: browsers omit them for same-origin GETs and local tools never send them.

These checks protect against other web pages using the user's browser. **They are not authentication.** Any local process can send any
headers (or none) and read `/api/state` and the GitHub history. If that matters, add caller authentication or rely on OS-level isolation as
a separate, explicitly accepted decision. The server binds `127.0.0.1` only.

## Known limitations

* Legacy writers (`state-write`, `tasks`, …) are unchanged when opted in; their own shallow validation and non-atomic state write remain.
* The Vite development server keeps its own pre-bundling cache under `node_modules/.vite` (development only, not business data).
* `GET /api/github/development-history*` still talks to the user's `gh` session; the repository allowlist is the only account-scope limit.
* `npm start` (`node dist/server.cjs` without `NODE_ENV=production`) takes the Vite development path; the API boundary is identical.
