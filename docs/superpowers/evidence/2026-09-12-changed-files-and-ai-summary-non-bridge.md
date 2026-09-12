# Add Changed-Files List + Optional AI Diff Summary — Non-Bridge Direct Chat Execution Record

**Date:** 2026-09-12
**Authorization:** Direct, explicit chat instruction from the repository owner (augusliang23@gmail.com), given in an interactive Claude Code session with the owner present throughout. This work did **not** go through the `.bridge/` Issue / `bridge:ready` governance flow. No GitHub Issue, allowlisted file set, model/reasoning-effort label, risk label, or `bridge:ready` label preceded this task. The owner separately, explicitly authorized touching `server.ts` for this task (a protected file per `CLAUDE.md`) and confirmed the UI placement ("放在專案卡片本來就有的「技術細節」裡").
**Do not attribute this record to any existing Issue.**

## Relationship to prior work

Direct follow-up to the real-vs-fake trust audit and plain-language verdict redesign from 2026-09-10/11. The owner asked to see actual change content, not just a PR number ("如果我不想只看到ＰＲ號碼，也想看到修改內容。有機會嗎？"), and confirmed wanting both a file list and an optional AI summary ("好，那就兩個都要 "先列檔案，再選擇性地讓 AI 摘要"").

## What shipped

- **`server/githubPullStatus.mjs`** — new `fetchChangedFiles(repo, { prNumber, sha }, { execFileFn })`, reusing the existing `ghApiJson()` proxy; hits `pulls/{n}/files` for PR-based changes or `commits/{sha}` for direct pushes, normalizing both shapes to `{ filename, status, additions, deletions, patch }[]`. The `active` state returned by `fetchPullRequestStatus()` now also carries `lastCommitSha` (previously only message/date/URL), needed so the client can request the file list for direct-push projects.
- **`server/githubRoutes.mjs`** — new `GET /api/github/changed-files?repo=...&pr=...|&sha=...`, same origin-guard and `GithubCliError` → HTTP status mapping as the existing `/pull-status` route. Strips the `patch` field from the response — the browser only ever receives filenames and add/delete counts, never diff content.
- **`server.ts`** — new `POST /api/bridge/summarize-changes`. Re-fetches changed files server-side (this time including patches), concatenates them up to a ~12,000-character cap, and asks `getGeminiClient()` for a ≤300-character plain-language Traditional Chinese summary aimed at a non-technical founder. If no `GEMINI_API_KEY` is configured, returns the real file list as plain text with an explicit "尚未設定 AI 金鑰" note — never a fabricated-looking summary.
- **`src/types.ts`** — `GithubPullStatus.lastCommitSha?: string`; new `GithubChangedFile` type.
- **`src/components/ProjectVerdictCard.tsx`** — lazily fetches the changed-file list the first time a real-GitHub card's technical detail is expanded; renders it with per-file +/- counts; adds a "請 AI 摘要這次修改" button (explicit click only, since it's the one real external-AI-cost action in this flow) that calls the new summarize route and displays the result or a clear error.
- **`test/github-pull-status.test.mjs`** — new tests for `fetchChangedFiles()`: PR-files-array shape, commit-object-with-files shape, and rejection when neither `prNumber` nor `sha` is given or when `repo` isn't a real slug.

## Verification

- `npm run lint` (tsc --noEmit), `npm test` (96/96, up from 93 — 3 new `fetchChangedFiles` tests), `npm run test:ui` (5/5), `npm run build` all green.
- Manual, in-browser, against real GitHub state (dev server restarted to pick up `server.ts` changes, since `tsx server.ts` has no file-watch):
  - **PR-based case**: expanded "Pm Dashboard" (`augusliang23-web/pm-dashboard`, PR #4, merged). File list rendered 5 files with add/delete counts; cross-checked directly against `gh api repos/augusliang23-web/pm-dashboard/pulls/4/files` — exact match.
  - **Direct-push case**: expanded "Micro SaaS Command Center" (this repo, direct push, no open PR). File list rendered 3 files; cross-checked directly against `gh api repos/augusliang23-web/Micro-SaaS-Command-Center/commits/HEAD` — exact match.
  - **AI summary, no key configured**: clicking "請 AI 摘要這次修改" correctly returned the honest local fallback (real file list + explicit "no AI key" note), since this environment has no `GEMINI_API_KEY` set. No fabricated-looking summary was shown.
  - `read_console_messages` — no errors in either case.
- Side finding from the direct-push cross-check: `gh api .../commits/HEAD` resolved to a different commit than local `git log -1` — confirmed via `git status -sb` (`ahead 1`) that local commit `496bdbc` had never been pushed. This is the real-vs-fake distinction the feature is designed to surface, working as intended; it also resolves the open question left at the end of entry 19 in `PROJECT_CONTEXT.md`.

## Follow-up (2026-09-12, same day): retry logic + real root cause found

After the owner set a real `GEMINI_API_KEY` and clicked "請 AI 摘要這次修改" in
his own browser, it failed intermittently. Fixed the missing piece first —
`server.ts` never actually loaded `.env` (no `dotenv` import despite it
being a listed dependency; `.env.example`'s "AI Studio automatically
injects this" comment only applies to the hosted AI Studio runtime, not a
local `npm run dev`). Added `import 'dotenv/config'` (owner re-confirmed
this specific `server.ts` touch).

After that fix, the summarize call still failed intermittently. Direct
`curl` probing against the running server (bypassing the browser entirely)
reproduced it: repeated calls to the same PR alternated between success and
a Gemini 503 "This model is currently experiencing high demand" error —
confirmed genuinely intermittent, not a config problem. Added
`generateContentWithRetry()` (retries up to twice on 503 with backoff) and
replaced the raw English "Failed to summarize changes." message with
Traditional Chinese, distinguishing transient-overload wording from other
failures.

Further probing (6 rapid calls in a row) surfaced the **real, underlying
constraint**: `gemini-3.7-flash`'s free tier caps at **20 requests/day**
(`RESOURCE_EXHAUSTED`, `generate_content_free_tier_requests`, `limit: 20`).
The troubleshooting probes themselves likely consumed a meaningful chunk of
that day's quota. Retrying cannot fix a 429 quota-exhaustion error (only
503 overload) — the error message now says so. Presented the owner three
options (wait for reset / find a higher-quota model / turn on paid
billing); he chose to leave the feature as-is and treat it as
occasional-use, waiting for the quota to reset when it's hit.

**Lesson:** a working API key does not mean unlimited testing is free —
this session's own verification loop (repeated curl calls to confirm a fix)
measurably ate into the account's real daily quota for this feature. When
diagnosing a live external-API failure, prefer one or two targeted probes
over a loop, and stop probing as soon as the failure mode is identified
rather than continuing to "confirm" it.

## Correction (2026-09-12, same day): removed the retry-on-503 logic

The owner asked directly whether a failed API call (not just a successful
one) still counts against the daily quota — a fair worry given how quickly
the account had been rate-limited. Google's own docs
([rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting))
and developer-forum threads do **not** explicitly state this either way.
But tallying every real call made during this session's troubleshooting
(~20 total attempts, only ~4-5 ever succeeded) against the free tier's
20-requests/day cap makes it very unlikely that only successes count —
the account was rate-limited long before 20 successes were ever reached.

Given that, the `generateContentWithRetry()` helper added a few commits
earlier (retry up to twice on 503, with backoff) was actively
counterproductive: a single user click hitting a 503 could silently fire
up to 3 real API calls, tripling quota consumption on the exact failure
mode being retried, for a request that likely wasn't going to succeed
anyway during a real capacity outage. Removed it entirely — one attempt
per click is the safer default until Google explicitly documents that
failed requests don't count. Also updated the 503 error message to no
longer claim "retried a few times" since that's no longer what happens.

**Lesson:** a retry-on-error pattern that seems like an obvious reliability
improvement can be actively harmful under a scarce, per-request quota —
before adding retries to any metered external API call, check what
actually gets billed/counted (successes only, or every attempt) rather
than assuming retries are free insurance.

## Follow-up (2026-09-12, same day): switched to a cheaper/higher-quota model

The owner asked why the free tier is so small, how paid billing works, and
about cheaper models. Explained the tradeoffs and offered to switch; he
asked to. Tried `gemini-2.5-flash-lite` first (third-party reports suggest
a more generous free tier) — Google's API returned a 404 saying that model
is no longer available to new users and pointed to `gemini-3.5-flash-lite`
as the replacement. Switched to that instead; verified end-to-end (direct
API call, then a real browser click) that it returns a correctly-formatted
plain-language summary. Only `/api/bridge/summarize-changes` was changed —
the two protected routes (`chatgpt-advice`, `extract-features`) still use
`gemini-3.7-flash`, untouched, since the request was scoped to this one
feature.

## Known gaps

- No dedicated HTTP-level route test for `/api/github/changed-files` or `/api/bridge/summarize-changes` (no precedent for HTTP-level route tests exists elsewhere in this codebase either — logic-level tests cover `fetchChangedFiles()` directly).
- The AI-summary path itself (an actual Gemini call, not the fallback) was not exercised in this session since no `GEMINI_API_KEY` is configured in this environment — only the honest-fallback path was verified end-to-end.

## Boundaries respected

Touched `server.ts` only for the specific new route the owner authorized; did not touch either protected route (`/api/bridge/chatgpt-advice`, `/api/bridge/extract-features`). No changes to `.env*`, secrets, or deployment config. Did not add `bridge:ready` or open/modify any GitHub Issue.
