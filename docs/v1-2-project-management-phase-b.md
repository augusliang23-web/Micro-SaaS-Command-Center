# V1.2B Manage Projects: UI and narrow local API (candidate)

Status: local candidate on `claude/v1.2b-project-management-ui-api`, built on V1.2A (#89, read-only here). It is **not** the daily-use
V1.1 runtime and has **not** been run against real saved state. Phase C (GitHub connection) and the final independent review are
separate.

## Intentional change to the V1 boundary

V1.1 exposed four GET routes only. This candidate adds exactly two routes. Every other `/api` path keeps the V1 behaviour: GET
only, unknown paths are a JSON 404, other methods are 405.

| Route | Purpose |
|---|---|
| `GET /api/projects` | `{ version, projects, removed }`, strictly validated with both V1 readers. `version` is the SHA-256 of the file. 404 `{ code: 'NO_STATE' }` when there is no data directory or file; nothing is created. |
| `POST /api/projects/commands` | `{ expectedVersion, command }`. The only mutating route. |

## Request policy (in order, before any body is read)

1. **Host / Origin / Referer policy (unchanged).** Host must be the loopback origin's host. A present Origin or Referer must
   match the trusted origin.
2. **Method gate.** `/api` is GET-only, except **POST on the exact path** `/api/projects/commands`.
   - Matching is case-insensitive like Express, with no trailing slash, extra segment or encoded variant.
   - Any other method on that path is 405 `Allow: POST`.
3. **Project write gate.** For the command path:
   - The Origin header must be **present** and equal the trusted origin (403 `ORIGIN_REQUIRED`).
   - `Content-Type` must be `application/json` (415), so HTML forms cannot post.
   - A declared `Content-Length` above 16 KiB is 413.
4. **Router.**
   - Reads at most 16 KiB (also for chunked bodies) as strict UTF-8 JSON.
   - Accepts only the allowlisted command shapes below. Unknown fields anywhere are 400.
   - The store, its directory, the clock and the UUID generator are server-side. The caller cannot pass a path, `dataDir`,
     `newId`, `now`, a token or a whole state.

Host/Origin/Referer are browser CSRF protections for a loopback single-user app, **not caller authentication**. Any local process
can send the same headers. A separate local-process authentication decision remains out of MVP scope.

### Command shapes

| type | fields |
|---|---|
| `add` | `input: { name, tagline?, stage?, tags?, repository? }` |
| `edit` | `id`, `patch: { name?, tagline?, stage?, tags? }`; repository and identity are not editable (Phase C) |
| `archive`, `restore`, `recover` | `id` |
| `remove` | `id`, `confirmProjectId` (must equal `id`) |

Semantics are the V1.2A ones (`docs/v1-2-project-management-foundation.md`). Remove is a local soft remove; nothing outside saved
state is touched, and there is no hard delete.

### Status codes

| Status | Codes |
|---|---|
| 400 | `INVALID_REQUEST`, `INVALID_COMMAND`, `INVALID_INPUT`, `INVALID_ID`, `FIELD_NOT_EDITABLE` |
| 403 | Host/Origin/Referer refusals, `ORIGIN_REQUIRED` |
| 404 | `NOT_FOUND`, `NO_STATE`; unknown API paths |
| 405 | wrong method or path variant |
| 409 | `CONFLICT` (with `currentVersion`), `DUPLICATE_REPOSITORY`, `ILLEGAL_TRANSITION`, `AMBIGUOUS_ID`, `ID_COLLISION`, `LIMIT_EXCEEDED` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 423 | `LOCKED` |
| 500 | `CORRUPT_STATE`, `INVALID_STATE`, `UNSAFE_TARGET`, `WRITE_FAILED`, `BACKUP_FAILED` (all: refused before the file was replaced, nothing changed); `COMMIT_OUTCOME_UNKNOWN` (remediation F1: the file was replaced but the result could not be confirmed) |

**Remediation F1: uncertain outcomes.**
- `COMMIT_OUTCOME_UNKNOWN` responses carry `outcome: "unknown"`, `stateReadable` and `currentVersion` (or `null`). The server
  gets these from a fresh validated read after the failure.
- The UI treats `COMMIT_OUTCOME_UNKNOWN`, any other 5xx without a "nothing changed" code, and a lost connection the same way:
  it re-reads `GET /api/projects` and refreshes the overview.
- It then says "結果未知" (outcome unknown), adding "無法讀取資料" (state unreadable) when the read fails too. It never retries
  the command and never claims the data is unchanged.

Every 500 uses a fixed message. No response contains a file path, stack trace or anything from the store's internal text.

## Capability rule

The project writer replaces the legacy whole-state writer.
- `COMMAND_CENTER_LEGACY_CAPABILITIES` containing `state-write` makes the server **refuse to start**, because that writer
  bypasses the store's lock and version check.
- Other legacy capabilities keep their behaviour. Their global JSON parser skips the project command path, so it cannot consume
  the capped body.

## UI

- Navigation is 專案總覽 / **管理專案** / 開發地圖. The overview and the Development Map stay read-only (GET only).
- **管理專案** lists 使用中 / 已封存 / 已移除 with counts, plus forms for add and edit.
  - Edit sends only the changed presentation fields. The repository is shown read-only.
  - Remove opens a dialog that explains nothing external is deleted and requires typing the exact project name.
  - Every command carries the last-read version. Buttons are disabled while one is in flight, so there are no duplicate
    submissions.
- **Refusals.**
  - 409/404/illegal transition: the page reloads the latest data and explains why. **Nothing is retried automatically.**
  - Lock, backup, write, corrupt-state and network failures are reported as failures, never as optimistic success.
- **Overview.**
  - Archived projects are hidden from the overview and the Development Map rail, with a count pointing to 管理專案.
  - Removed projects are not in `projects` at all.
  - A project added by 管理專案 shows **健康狀態 UNKNOWN · Not checked**, with its creation time, instead of the V1.2A legacy
    placeholder `health: Attention`.
- **Identity labels.**
  - Without a repository, an owner-added project is labelled **LOCAL · Not connected**. Its identity source stays
    non-REGISTERED, so it can never reach the live viewer.
  - DEMO and unverifiable records are labelled as such in 管理專案, and actions never change `dataMode`.
- **GitHub.** No new GitHub request exists. The Development Map is unchanged: only `augusliang23-web/pm-dashboard` is live, and
  new projects stay Not connected until Phase C.
- **No data.** If there is no saved state, 管理專案 shows an explicit absence message. It never creates a file or demo data.

## Safe first write against real data (NOT done; requires separate authorization)

1. Stop the daily-use server; no other writer may run.
2. Copy `data/app-state.json` aside, outside the app, and record its SHA-256.
3. Start the candidate in the real checkout without `state-write`, open 管理專案, and confirm the list matches V1.1.
4. Perform one reversible action (for example archive then restore a test-safe project). Confirm that `.bak.1` equals the
   recorded hash and that V1.1's `GET /api/state` still loads.
5. Rollback: restore the copy, or use `restoreBackup` with three generations available.

## Known limits

- **Changed V1 invariant tests.** Two existing tests encode the V1.1/V1.2A invariants this phase intentionally changes, and both
  are outside the Phase B write allowlist. They need an explicit amendment:
  - `test/v1-backend-boundary.test.mjs`, the `state-write` case of "each legacy capability is its own opt-in": the server now
    refuses to start with `state-write`.
  - `test/v1-2-project-management-foundation.test.mjs` E ("no existing server or src file imports the project management
    modules"): `server/v1ProjectManagementRoutes.mjs` (and its UI test) now import them by design.
- **Static asset exposure (unchanged).** Built production mode still serves `dist/server.cjs(.map)` (P3, reported in the
  V1.1 activation).
- **Evidence scope.** All evidence is synthetic: JSDOM tests, a real-bundle API harness and a task-owned browser check. There is
  no CI, and nothing has been accepted in real Safari.
