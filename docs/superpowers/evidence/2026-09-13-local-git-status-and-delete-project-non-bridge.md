# Local Git Status Comparison + Delete Project — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-13
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded either task. Both went through `EnterPlanMode`/`ExitPlanMode` given their scope (new feature, multiple files, an architectural decision for the second one). The owner separately, explicitly authorized touching `server.ts` for the local-git feature (a protected file per `CLAUDE.md`; a one-line router mount).
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Two separate features shipped back-to-back the same day:

1. **Delete project**: the owner asked for "一個專案退場的機制" (a way to retire a project from the list). No delete/remove/archive functionality existed anywhere in the codebase.
2. **Local git status comparison**: mid-way through reviewing the delete feature, the owner said "我感覺只看github狀態好像有點太慢，應該也要同時比對本機狀態" (only looking at GitHub state feels incomplete — should also compare local machine state). Confirmed via follow-up question that he specifically meant detecting unpushed/uncommitted local state, not query speed — directly echoing the 2026-09-11 incident where 18 unpushed local commits made GitHub-derived "staleness" look like a possible bug.

## What shipped

### Delete project
- **`src/components/DeleteProjectModal.tsx`** (new) — confirmation modal, same prop convention as `SelectiveReleaseModal.tsx` (`project`, `isOpen`, `onClose`, plus `onConfirmDelete`).
- **`src/components/ProjectVerdictCard.tsx`** — new `Trash2` icon button (only rendered when an `onDelete` prop is supplied) opening the modal; confirming calls `onDelete(project.id)`.
- **`src/components/PortfolioOverview.tsx` / `NextBestActionCard.tsx` / `NeedsAttentionQueue.tsx`** — thread a new optional `onDeleteProject` prop through to the shared `ProjectVerdictCard`.
- **`src/App.tsx`** — new `handleDeleteProject(projectId)`: filters the project out of `projects` state, closes the drawer if that project was open, shows a toast. No server changes — `PUT /api/state` already replaces the whole `projects` array on every debounced save, and `isValidState()` only checks shape, not content.

### Local git status
- **`server/localGitStatus.mjs`** (new) — `fetchLocalGitStatus(localPath, { execFileFn })` runs `git -C <path> status --porcelain=v2 --branch`, parses the `# branch.ab +N -M` line for ahead/behind counts and counts remaining porcelain lines for `uncommittedCount`. Throws a typed `LocalGitError` (`kind: 'not_found' | 'no_upstream' | 'failed'`) for a bad path, a repo with no upstream configured, or any other git failure — deliberately does **not** silently report "clean" when the comparison can't actually be made.
- **`server/localGitRoutes.mjs`** (new) — `GET /api/local-git/status?path=...`, same `isLoopbackOrigin` origin guard (reused via `evaluateGithubRequest` from `githubRoutes.mjs`) and error-to-HTTP-status mapping pattern as the GitHub routes.
- **`server.ts`** — one-line mount: `app.use('/api/local-git', createLocalGitRouter())`.
- **`src/types.ts`** — `MicroSaaSProject.localPath?: string` (the owner-entered clone path, persisted the same way as every other project field); new `LocalGitStatus` response type.
- **`src/components/ProjectVerdictCard.tsx`** — new "本機狀態" sub-section inside the real-GitHub technical-detail block: an inline path-entry form when `localPath` isn't set yet (or being edited), and once set, a lazily-fetched (on expand) plain-language badge — amber "領先遠端 N 個 commit，還沒 push", sky "遠端有新更新，本機還沒拉取", stone "有 N 個檔案還沒 commit", or emerald "本機與遠端一致" — plus an honest error message with a re-edit link if the path is invalid.
- New `onUpdateLocalPath` prop threaded the same way as `onDeleteProject`, down to `App.tsx`'s `handleUpdateLocalPath` (a `setProjects` map-by-id update).

## Verification

- `npm run lint` (tsc --noEmit), `npm test` (104/104, up from 96 — 8 new `fetchLocalGitStatus` tests), `npm run test:ui` (9/9, up from 5 — 4 new `DeleteProjectModal` tests), `npm run build` all green throughout.
- **Delete project**: browser-verified opening the modal on a real project (correct name shown), cancel leaves the project untouched, confirmed via the automated test suite for the actual delete path (not repeated live against real persisted data, to avoid altering the owner's real project list mid-verification).
- **Local git status**: verified `fetchLocalGitStatus`'s real-world parsing against this repo's own actual `git status --porcelain=v2 --branch` output directly (exact field-for-field match). Set this repo's own local path via the live UI, confirmed the "N 個檔案還沒 commit" badge matched the real uncommitted-file count. Created a throwaway empty commit (`git commit --allow-empty`), confirmed the badge correctly flipped to "領先遠端 1 個 commit，還沒 push", then removed it with `git reset --soft HEAD~1` (safe — empty commit, no working-tree changes, and there were real uncommitted feature files in the tree at the time that a `--hard` reset would have destroyed). Verified the invalid-path case (honest `"<path>" is not a git repository.` error with a working re-edit link) and restored the correct path afterward. Confirmed `localPath` persists across a full page reload via `data/app-state.json`.

## Known gaps

- No automated Express-route-level test for `/api/local-git/status` (no precedent for HTTP-level route tests exists elsewhere in this codebase either — logic-level tests cover `fetchLocalGitStatus()` directly, matching the pattern already used for `fetchChangedFiles`/`fetchPullRequestStatus`).
- Local path is entered manually per project; the two other real projects already connected (`pm-dashboard`, `pm-dashboard-uat`) don't have their `localPath` pre-filled — the owner would need to enter those himself (or ask for it to be done as a follow-up).
- `DeleteProjectModal`'s actual-delete path (clicking confirm against a real, persisted project) wasn't re-verified live in the browser this session — the automated component test covers the same code path deterministically, and a live re-test was skipped specifically to avoid mutating the owner's real project list as a side effect of verification.

## Boundaries respected

`server.ts` touched only for the one-line router mount, pre-authorized as part of this feature's plan approval. No changes to `.env*`, secrets, or either of the two named-protected routes (`/api/bridge/chatgpt-advice`, `/api/bridge/extract-features`). Did not add `bridge:ready` or open/modify any GitHub Issue.
