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
* In development mode, `createDevAssetGuard` enforces synchronous userspace `fs.lstatSync` / `fs.realpathSync` pre-validation before passing requests to Vite middleware; it does not claim kernel-level (`openat` / `O_NOFOLLOW`) immunity against local filesystem TOCTOU races if a local process swaps paths mid-request.
* `GET /api/github/development-history*` still talks to the user's `gh` session; the repository allowlist is the only account-scope limit.
* `npm start` (`node dist/server.cjs` without `NODE_ENV=production`) takes the Vite development path; the API boundary is identical.

## Issue #49 & Issue #51 Remediations (R1–R4)

Following independent security review (Codex Issue #50), the V1 boundary was hardened against four bypass / exposure vectors:

* **R1 — API Path Case-Insensitive Matching**: Express router mounts are case-insensitive by default. The path policy classifier `isApiPath` matches `/^\/api(?:\/|$)/i`, guaranteeing that case-variant paths (e.g. `/API/state`, `/Api/health`) receive identical Host, Origin, Referer, and HTTP 405 Method Gate enforcement as standard `/api/*` paths.
* **R2 — Vite Development File Guard & Canonical Realpath Containment (Issue #51)**:
  * **Approved Asset Roots**: In development mode, `createDevAssetGuard` in `server/v1RequestPolicy.mjs` precedes Vite middleware and resolves the project root via `fs.realpathSync(root)`. Only four filesystem categories are approved:
    1. `<realpath(root)>/index.html` (for `/` and `/index.html`; `index.html` itself must be a regular file and not a symlink).
    2. `<realpath(root)>/src/**` (for `/src/*` module requests).
    3. `<realpath(root)>/node_modules/**` (for Vite `/@fs/<root>/node_modules/*` requests).
    4. `<realpath(root)>/node_modules/.vite/deps/**` (for pre-bundled dependency requests `/node_modules/.vite/deps/*`).
  * **Virtual Runtime Endpoints**: Only exact virtual client endpoints `/@vite/client` and `/@vite/env` (plus non-traversal `/@id/*` virtual module specifiers that do not reference `/@fs/` or `__x00__`) are permitted without a filesystem target. Arbitrary `/@vite/*` subpaths are rejected.
  * **Symlink & Ancestor-Directory Realpath Verification**: For every filesystem-backed request (`checkFs: true` in `createDevAssetGuard`), `verifyCanonicalTarget` walks each path segment from the approved canonical base root to the target file using `fs.lstatSync` and `fs.realpathSync`. Every intermediate ancestor directory and the final resolved file must remain strictly inside the category's canonical base root (`<realpath(root)>/src`, `<realpath(root)>/node_modules`, or `<realpath(root)>/node_modules/.vite/deps`) and resolve to a regular file (`stat.isFile()`). Direct symlinks escaping the boundary, symlinked ancestor directories (including multi-hop chains that step outside the boundary and back in), nested symlinks pointing outside the boundary, and broken/dangling symlinks all fail closed with a `404` JSON response (`{"error":"Not found."}`) before Vite middleware or target file reads can occur.
  * **Uniform Dotfile & Nested Dotfile Rejection**: Dotfile and dot-directory segments (any segment starting with `.` other than the explicit `.vite` cache directory segment) are rejected both lexically and on the canonical resolved path across `/src/*`, `/@fs/<root>/node_modules/*`, and `/node_modules/.vite/deps/*`. A symlink inside an approved directory pointing to a dotfile (e.g. `.env` or `.secret`) is likewise rejected.
  * **Public-Shadow Prevention (`publicDir: false`)**: Command Center V1 requires no assets from `public/` (no `public/` folder exists in the repository, `index.html` and `src/` contain zero references to static public assets, and all icons are inline Lucide React components). Vite dev server configuration sets top-level `publicDir: false` in `server.ts`. This disables Vite's internal `servePublicMiddleware`, preventing public-shadow attacks where synthetic or uninspected files in `public/` could substitute legitimate `/src/*` modules or bypass dev asset guard checks.
  * **Verification**: Proven by 45 runtime tests in `test/v1-backend-boundary.test.mjs` (including Section K synthetic symlink, symlinked-ancestor, nested-symlink, URL-encoded traversal, `/@fs`, `node_modules`, `.vite/deps`, dotfile, and public-shadow substitution tests with filesystem read spies confirming zero reads of sensitive files).
* **R3 — Vite HMR and WebSocket Listener Lockdown**: Vite dev server options explicitly set `server.hmr = false` and `server.ws = false`. This eliminates secondary unauthenticated WebSocket listener endpoints (such as port 24678), ensuring the server binds exactly one loopback listener on `127.0.0.1:<PORT>` across all environments.
* **R4 — Robust NODE_ENV Boundary Coverage**: The boundary guarantees fail-closed behavior across all `NODE_ENV` states: `production`, `development`, absent (unset), empty, or arbitrary strings/typos. Non-production or unset `NODE_ENV` routes to the safe Vite dev pipeline, while legacy capabilities strictly require explicit `COMMAND_CENTER_LEGACY_CAPABILITIES` opt-ins. Test harnesses were corrected to ensure genuine environment variable removal when asserting absent `NODE_ENV`.
* **Protected AI Provider Routes**: `/api/bridge/chatgpt-advice` and `/api/bridge/extract-features` remain strictly gated behind legacy provider capabilities. Automated test suites enforce a pure-predicate tripwire that rejects any HTTP requests to these endpoints, verifying their boundaries via static code assertions only.

