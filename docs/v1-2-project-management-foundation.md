# V1.2A Project Management Data Foundation

Status: foundation only (GitHub Issue #87). Nothing here is mounted by `server.ts`, exposed as an API, used by the UI, or run
against the owner's real `data/app-state.json`. V1.1 daily use is unchanged. Phase B (UI/API) and Phase C (GitHub connection)
need separate authorization.

## Modules

| File | Role |
|---|---|
| `server/projectManagementSchema.mjs` | Input validation, audited defaults for new projects, lifecycle metadata, whole-state invariant, strict parse/serialize. Pure. |
| `server/projectManagementCommands.mjs` | Add / Edit / Archive / Restore / Remove / Recover as pure transforms `(state, payload, { now, newId }) -> { state, result }`. |
| `server/projectManagementStore.mjs` | Opt-in persistence for one explicit directory: version check, lock, atomic replace, bounded backups, restore. |
| `test/v1-2-project-management-foundation.test.mjs` | Synthetic-only tests (temp directories, no network, no server). |

## Data contract

The saved file keeps its existing envelope: `projects`, `attentionItems`, `nba`, `snapshot`, plus any unknown top-level
fields, which are carried over unchanged. Every command checks its input AND its result with both existing readers
(`server/localStateStore.mjs#isValidState` and `src/savedState.mjs#isUsableSavedState`). Anything that fails either reader is
refused. It is never repaired, migrated or replaced with demo data.

### New project (Add)

- `id`: opaque `proj-<uuid>`. A collision with any current or removed id is refused.
- `name` is required. `tagline`, `stage` (`Prototype|Alpha|Beta|Production`), `tags` and `repository` are optional.
- `repository` accepts exactly `owner/repo`. URLs, `.git` suffixes and paths are refused, never parsed. Without a repository,
  the project is saved with `repository: ""` and V1.1 shows it as NOT CONNECTED.
- A repository already used by a current project is refused (case-insensitive).
- `dataMode` is never written. It records provenance, so a command can never promote a demo or unverified record.
- Every field V1.1 requires is filled with a "nothing recorded" value. None of these values is evidence:
  - no gates and no activity history;
  - `testOutcome`/`reviewOutcome` `N/A`, `model` `Not Assigned`, `reasoningEffort` `None`, `waitingState` `AUTOMATION_IDLE`;
  - `blocker: null`, `currentGateLabel` `Not started`, environment `Not Deployed` / `Not recorded`.
  - `health` is the enum placeholder `Attention`. V1.1 labels it "saved, not independently verified".
  - These placeholders stay inside the existing TypeScript enums so typed consumers do not break.
- Only `augusliang23-web/pm-dashboard` is allowlisted for GitHub history, so any new project stays NOT CONNECTED in V1.1.
  This foundation does not change either allowlist.

### Edit

- Only `name`, `tagline`, `stage` and `tags` can be edited. Naming any other field is refused (`FIELD_NOT_EDITABLE`), not
  ignored. That covers `id`, `repository`, `dataMode`, `management`, status fields, gates and history.
- A patch that changes nothing returns the same state object, so nothing is written.

### Lifecycle

- Lifecycle is stored in a new per-project object:
  `management: { schemaVersion: 1, lifecycle: 'active'|'archived', createdAt?, updatedAt, archivedAt?, events: [{type, at}] }`.
  `events` is bounded to 50.
- A project without `management` is active; this covers every legacy record. An unknown lifecycle value makes the state
  invalid (fail closed).
- **Archive** (active to archived) and **Restore** (archived to active) only change `management`. The record stays in
  `projects` with its id and history. V1.1 does not read `management`, so it still shows archived projects. Phase B filters them.
- **Remove** is local-only and reversible:
  - The complete record moves from `projects` to the top-level list
    `projectManagement.removed[] = { project, removedAt, previousIndex, previousLifecycle }`.
  - Nothing else is touched: no GitHub repository, clone, local path, PR, credential or other external resource.
  - The id stays reserved. V1.1 ignores `projectManagement`, so a removed project disappears from V1.1.
- **Recover** puts a removed project back at its previous position (clamped) with its previous lifecycle. It is refused if a
  current project now uses the same id or repository.
- There is no hard delete in V1.2A. Permanently purging a removed record needs a separate decision and an explicit owner
  confirmation flow.
- Illegal transitions are refused (`ILLEGAL_TRANSITION`): archiving an archived project, or restoring an active one.
- An id that is duplicated in legacy data is never guessed (`AMBIGUOUS_ID`).

### Limits and text rules

- At most 5 MiB per file and 500 projects (current + removed).
- name: 120 code points; tagline: 500; tags: at most 20, each up to 40 characters, no case-insensitive repeats.
- Text is NFC-normalised and trimmed. Malformed Unicode (lone surrogates), C0/C1 controls, bidi overrides/isolates and line
  or paragraph separators are refused.
- Stored bytes must be strict UTF-8 without a BOM and valid JSON; anything else is `CORRUPT_STATE`.

## Persistence protocol (`createProjectStore({ dataDir })`)

1. **Directory check.** `dataDir` must be an absolute, existing, non-symlink directory owned by the user and not
   group/other-writable. File names are fixed constants, so no input reaches a path.
2. **Lock.** `app-state.json.lock` is created with `O_EXCL` and mode 0600. If someone else holds it, the result is `LOCKED`.
   A lock is never broken automatically. After a crash, the owner removes it once no writer is running.
3. **Version check.** The file's SHA-256 (or `absent`) must equal the caller's `expectedVersion`; otherwise `CONFLICT`. There
   is no unconditional write, so a stale tab or caller cannot overwrite newer changes.
4. **Target check.** The target and every backup must be a regular file: not a symlink, one hard link, owned by the user, not
   group/other-writable, and within the size limit. Otherwise `UNSAFE_TARGET`.
5. **Backup.** Before the target is touched, `.bak.1`–`.bak.3` are rotated and the current bytes are written atomically to
   `.bak.1` and verified. If the backup fails, the result is `BACKUP_FAILED` and the target is unchanged.
6. **Atomic write.**
   - Write a unique `.app-state.json.tmp-<pid>-<random>` in the same directory (`O_EXCL`, 0600), then fsync and close it.
   - Re-read it and verify its hash.
   - Rename it over the target, then fsync the directory where supported.
   - Re-read the target and verify its hash.
   - On any failure, the previous file is unchanged and our temp file is removed. If the rename succeeded but the directory
     sync failed, the result is `DURABILITY_UNCONFIRMED`.
7. **Stale temp files** from a crashed writer are never read and never deleted automatically.

**Restore:** `restoreBackup({ generation, expectedCurrentVersion })`.
- It works even when the current file is corrupt (pass its raw hash from `rawVersion()`).
- The bytes being replaced are first kept as `app-state.json.pre-restore-<hash16>`.
- The backup must pass both readers before it is used.

**Initial state:** `createInitialState()` writes `{projects:[], attentionItems:[], nba:{}, snapshot:{}}` only when no file
exists. It is never called implicitly, and it never creates demo projects.

## Known limits (accepted for the single-user local MVP)

- Re-serialisation uses the legacy writer's format (2-space JSON). Values keep their meaning but byte formatting can change.
  Duplicate JSON keys collapse to the last one, and integers beyond 2^53 lose precision. Any such value would already have
  been altered by the V1.1 reader.
- Checks and rename are not one atomic step against a hostile process running as the same user (TOCTOU). This is out of
  scope for a single-user Mac.
- The lock is advisory. It only coordinates writers that use this store; the legacy `state-write` route
  (`server/localStateStore.mjs#writeState`) does not use it. That route stays disabled by default and must not be enabled
  alongside V1.2.

## Integration gates (not done in V1.2A)

- **Phase B (separate authorization):**
  - API routes, request size limits, Origin/CSRF policy for writes, and a UI that filters archived and removed projects.
  - A decision on how the read-only V1 boundary changes; today it has four GET routes only.
  - A first-write plan for the owner's real file (inspect, back up and run `rawVersion()` before any command).
- **Phase C (separate authorization):** connecting a repository to GitHub, and any change to the history allowlists.

## Rollback

V1.2A changes no running behaviour, so rollback means not merging the branch. A store-written file can be rolled back with
`restoreBackup` (three generations), or by copying a `.bak.N` file back while no writer runs.
