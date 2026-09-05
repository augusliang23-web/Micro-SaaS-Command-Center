# GitHub Repo Connect: Live Data — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-05
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow described in the committed `CLAUDE.md` ("Claude Execution Boundary"). No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label was recorded by the authorized human workflow before this task started.
**Do not attribute this record to any existing Issue** (e.g. #7 or #3) — neither authorized this feature work.

The owner was asked in-session whether to (a) follow the formal Bridge/Issue flow, (b) explicitly authorize direct execution outside that flow for this personal-project task, or (c) block. The owner chose (b).

## Checkout identity

- Repository path: `/Users/augusliang/Developer/Micro-SaaS-Command-Center`
- Branch: `main`
- HEAD before this task: `ebcf6cfc63c3e7123802f782ec6de9fec4dd7b4e`
- Working tree before this task: clean

## Scope

Replace the hardcoded `mockAvailableRepos` array in `src/components/ConnectRepoModal.tsx` with real GitHub repository data, without changing the `UnconnectedGitHubRepo` interface shape.

## Files touched

- `server/githubRepos.mjs` (new) — pure mapping/formatting helpers plus `fetchGithubRepos`, which shells out to the already-authenticated `gh` CLI (`gh api /user/repos?...`) via `child_process.execFile`.
- `server/githubRoutes.mjs` (new) — Express router at `/api/github/repos`, gated by the same loopback-origin check used by `/api/state` (`server/stateRoutes.mjs`) and `/api/bridge/codex-handoffs` (`server/codexHandoffRoutes.mjs`).
- `server.ts` — registers `app.use('/api/github', createGithubRouter())`.
- `src/components/ConnectRepoModal.tsx` — removed `mockAvailableRepos`; added a `fetch('/api/github/repos')` call (loading/error/retry states) that populates the same `UnconnectedGitHubRepo[]` shape.
- `test/github-repos.test.mjs` (new) — unit tests for the new pure functions and route guard.

## Design decisions

- **Auth reuse over new PAT**: reused the machine's existing `gh auth login` session (scopes: `repo`, `read:org`, `gist`, `workflow`) rather than issuing a separate Personal Access Token into `.env`. Rationale given to the owner: fewer secrets to manage for a single-user local tool; the token lives entirely inside `gh`'s own credential store and is never read into this app's process memory, `.env`, or logs.
- **Token stays server-side**: the browser only ever calls `GET /api/github/repos` on the same-origin Express server; the route shells out to `gh api` server-side and returns already-mapped JSON. No GitHub token or header reaches client code.

## Commands run and results

- `npm run lint` (`tsc --noEmit`) — exit 0, no errors.
- `npm test` (`node --test test/`) — 42/42 tests passing, 0 failures.
- `gh auth status` (read-only check, no writes) — confirmed already logged in as `augusliang23-web` with required scopes.

## Manual browser verification

Started the dev server (`npm run dev` equivalent via the project's preview tooling), opened the "接入 GitHub 倉庫" modal, and confirmed:
- `GET /api/github/repos` returned `200 OK` with real repositories from the authenticated GitHub account (e.g. `augusliang23-web/Micro-SaaS-Command-Center`, `augusliang23-web/pm-dashboard-uat`, `augusliang23-web/ChatGPT-Codex-Bridge`), not the old mock fixtures (`invoice-radar`, `slack-standup-bot`, etc.).
- Response shape matched `UnconnectedGitHubRepo` exactly (`id`, `name`, `fullName`, `description`, `isPrivate`, `language`, `defaultBranch`, `stars`, `lastPushed`).
- No console errors related to the new endpoint; the only 404s observed were the pre-existing, expected `/api/state` "no saved state yet" calls on first load.
- Dev server stopped after verification.

## Boundaries respected

- Did not touch `/api/bridge/chatgpt-advice` or `/api/bridge/extract-features` (the two explicitly protected routes).
- Did not touch `.env*`, billing, deployment, production data, or Bridge mapping files.
- Did not add `bridge:ready`/`bridge:approved`, did not open, close, or comment on any GitHub Issue, and did not merge/deploy/release anything — changes remain uncommitted in the local working tree pending the owner's own review and commit.
- Did not install anything globally or globally modify the `gh` CLI's own auth state (read-only `gh auth status` check only; the new runtime route calls `gh api`, a read-only GitHub API call).
