# V1.2C GitHub connection (candidate)

Status: local candidate on `claude/v1.2c-github-connection`, built on V1.2B `eb7d62e`. It is not the daily-use V1.1 runtime and
has not been run against real saved state or real GitHub. Before merge, the full V1.2 (A+B+C) candidate needs the mandatory
independent review (#88).

## Source of truth

There is one file: the existing versioned `data/app-state.json` behind the V1.2A atomic store. A project's connection intent is
stored at `project.management.githubConnection`:

```json
{ "status": "connected" | "disconnected", "repository": "owner/repo", "generation": 1,
  "source": "user-verified" | "legacy-pm-dashboard-compat", "connectedAt": "ISO" | null,
  "verifiedRepositoryId": 123 | null, "revokedAt": "ISO" | null,
  "revokedReason": null | "disconnected" | "archived" | "removed" }
```

- The record is validated strictly (`connectionOf`). A malformed record makes the whole state invalid, which fails closed.
- `generation` increases on every connection write.
- The record says what the owner approved. It is **never** evidence that a GitHub read succeeded.

## Who may read GitHub history (`server/githubConnectionRegistry.mjs`)

The registry is a pure, read-only projection. On **every** `GET /api/github/development-history` and `.../pull` request, the
server re-reads and validates saved state. It grants a repository only to a project that meets all of these:

1. It is in `projects` (not removed), its lifecycle is active, and it has **no `dataMode`**.
2. Its id is non-blank and unique across current **and** removed projects.
3. It has a `connected` record for exactly its saved `repository`, **or** it is the unique legacy PM Dashboard record (Decision B,
   below).
4. **No other saved record names the same repository (remediation F2).** Claims are counted over **every** current and removed
   record before any authority is issued: any lifecycle, connected or not, demo or not, via `repository` or a connection
   record.
   - Spellings are normalized for this check (case, whitespace, `https://`/`www.`/`github.com/` prefix, `git@github.com:`,
     trailing slash, `.git`).
   - A repository claimed by more than one record gives **no** authority to anyone, including the legacy PM rule.
5. **A `user-verified` connection must carry `verifiedRepositoryId` (remediation F3),** the GitHub id recorded at connect time;
   without it, there is no authority.

### Verified identity on every GitHub answer (remediation F3)

The history service checks GitHub's answers against the authorization before anything derived from them is used:
- the repository metadata;
- every PR's `base.repo` in the list;
- the PR-detail `base.repo`, checked before check runs or reviews are requested.

What must match:
- **Pinned (`user-verified`):** GitHub's numeric `id` must equal `verifiedRepositoryId` **and** `full_name` must equal the
  stored repository exactly. A transfer, re-creation, rename or missing identity is refused with 403 `forbidden`; the result is
  never cached, and no further `gh` call is made for that read.
- **Unpinned legacy PM exception:** matched by name only, case-insensitively, from `full_name` (or GitHub's canonical
  `https://github.com/...` `html_url` when `full_name` is absent). If neither is present, the read is refused.
- **Forks:** a fork's **head** repository is a different repository and is kept separate (`headRepo`); only the **base** must
  be this repository.

The requested `repo` must match the stored spelling exactly. When `projectId` is sent (the UI always sends it), it must be that
project's id.

Without a saved state, with an unreadable or invalid one, or with any doubt, nothing is authorized: 403, and no `gh` call.

The history service itself (`fetchDevelopmentHistory` / `fetchPullDetail`) requires a registry-issued authorization object for
exactly that repository. Plain or forged objects are refused before any `gh` call, so a direct caller cannot bypass the route.

### Cache and in-flight reads

- Authority is checked **before** the cache.
- Cache keys are the authority's `scopeKey` (repository, project id, source, generation, connectedAt). A reconnect therefore never
  reuses an older snapshot.
- After every fetch, authority is checked **again**. If it changed meanwhile (disconnect, change, archive), the result is
  discarded with `409 authorization_changed` and is not cached.

### Decision B: PM Dashboard legacy rule

`augusliang23-web/pm-dashboard` stays readable without any saved-state rewrite only when there is exactly one record with all of:
- no `dataMode`;
- no `management`;
- a non-blank id that is unique across current and removed projects;
- the exact repository string;
- not removed.

There is no fuzzy match, no name lookup, and no fallback when state is missing.

- The first **Edit** of that record persists the same authority as an auditable record (`source: legacy-pm-dashboard-compat`), so
  a metadata change never silently ends access.
- **Archive**, **Remove** and **Disconnect** revoke it. **Restore** and **Recover** do not restore it.

## Commands (`POST /api/projects/commands`, version-checked, same request policy as V1.2B)

| type | fields | effect |
|---|---|---|
| `connect` | `id`, `repository` | Not connected → connected to the server-verified repository. Refused if the project already names a different repository (use `change`). |
| `disconnect` | `id` | Connected (saved or legacy) → disconnected (`revokedReason: disconnected`). |
| `change` | `id`, `repository`, `confirmPreviousRepository` | Switches to a server-verified repository. The old authority ends in the same atomic write; the project id never changes. |

How connect and change are processed:
1. Same domain checks as the command (trusted identity, active lifecycle, canonical `owner/repo`, no duplicate across current
   **and removed** projects, the change confirmation) **before** GitHub is contacted. A stale `expectedVersion` is 409 first.
2. Then **one** read-only `gh api --method GET -i repos/{owner}/{repo}` with a 10-second timeout, using the existing gh login.
   Tokens are never read or returned.
3. On 401/403/404/rate-limit/timeout/failure: 502 `GITHUB_VERIFICATION_FAILED` with its `kind`, and nothing is saved. A 404 can
   mean "no access"; it is not proof that the repository does not exist.
4. If GitHub reports a different `full_name` (renamed or redirected): 409 `REPOSITORY_MISMATCH`.
5. Only then does the server add the `verified` identity (GitHub's exact `full_name` and numeric id) and run the versioned write.
   A client cannot send `verified`: the route allowlist refuses it.

Other effects of lifecycle commands:
- **Archive / Remove:** an effective connection becomes `disconnected` with reason `archived` / `removed`.
- **Restore / Recover:** never reconnect. The owner must connect explicitly.
- **Edit:** `repository`, `management` and `dataMode` remain non-editable.

## UI

- **Overview cards** say `Connected（已核准連線）` or `Connected（V1.1 相容：PM Dashboard）` · `Not checked`. A history read
  happens only when the Development Map opens, which then shows source, Last checked and partial/UNKNOWN as before.
  - Revoked connections say why (已中斷 / 封存時已撤銷 / 移除時已撤銷) and that a reconnect is needed.
  - No deployment, CI, agent or "working" status is inferred.
- **Development Map** requests always carry `projectId`. `identityKey` includes the authorization, so a reconnect remounts the
  viewer and drops client caches. A new `authorization_changed` message explains discarded reads.
- **管理專案** shows the server's own `githubAuthorizations` projection from `GET /api/projects`.
  - Connect and Change explain the single read-only verification. Change requires typing the current repository. Disconnect needs
    a confirmation dialog.
  - Demo records and archived projects get no connection controls.
- **Frontend mirror (`githubAuthorizationsFor`)** only decides what the UI offers and requests. The shell always passes an explicit
  projection (`authorization` object or `null`). Only a caller that passes **no** projection (direct component tests) falls back to
  the strict legacy repository. The server remains authoritative either way.

## Limits and notes for the final review

- **Single-user, loopback.** Host/Origin/Referer checks are CSRF protection, not local-process authentication.
- **Advisory lock.** Only this store's writers use the lock; legacy `state-write` still refuses to start.
- **Store race: resolved by remediation F4.** Root cause measured on synthetic files: a reader can observe the replaced inode
  (`nlink 0`) of another process's atomic rename. Reads are now descriptor-bound with a bounded re-open for `nlink 0` only; see
  `docs/v1-2-project-management-foundation.md`. Real hard links are still refused immediately.
- **Client projection (remediation F6).** `githubAuthorizationsFor` applies the same global conflict gate and requires a complete
  connected record (pinned id for `user-verified`, valid `connectedAt`, `generation >= 1`, no revocation fields). Otherwise the
  overview shows Not connected.
- **Static asset exposure (F7, unchanged, out of remediation scope).** Built production mode still serves `dist/server.cjs(.map)`
  (P3). This is acceptable only under the single-user, loopback-only limitation; it needs a separate decision before any wider
  exposure.
- **No real GitHub during development.** All C tests use a fake `gh`. Connecting real repositories, and the first write to the
  owner's real state, need separate release authorization.

## Rollback

C changes no running daily-use behaviour; rollback means not merging the branch. A store-written state can be rolled back with
`restoreBackup` (three generations). Disconnect is the per-project kill switch for GitHub reads.
