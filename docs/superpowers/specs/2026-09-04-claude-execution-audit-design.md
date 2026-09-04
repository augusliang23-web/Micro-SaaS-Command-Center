# Claude Execution Audit — Option A Design

## Status

Prepared documentation only. This design defines Option A as a repository-local
Claude instruction layer plus a fail-closed execution-audit record. It does
not install or invoke Claude, alter application code, create a Bridge mapping,
open or modify an Issue, access a secret, make a network request, or authorize
any production action.

## Purpose

Option A gives a future authorized Claude task a local, reviewable boundary
before it can inspect or edit the Micro-SaaS Command Center Prototype. The
boundary must preserve the existing Bridge governance rather than create a
parallel authorization path.

## Observed baseline

- Checkout: `/private/tmp/micro-saas-claude-audit`
- Branch: `claude/prep-audit`
- HEAD at preparation: `7de1d64` (`docs: finalize bridge onboarding evidence`)
- Architecture: React fixture state feeds dashboard/modal presentation; the
  protected Express routes can use OpenAI, Gemini, or fabricated fallback.
- Authority: fixtures, browser-memory, user-entered, and AI-generated values
  are non-authoritative.
- Claude CLI: unavailable on `PATH` on 2026-09-04. This is
  `BLOCKED_ENVIRONMENT`, not a request to install a global package.

## Option A contract

1. `CLAUDE.md` is the repository-local instruction source for a future Claude
   audit. It repeats the fail-closed gates in `AGENTS.md` and `.bridge/` rather
   than weakening or replacing them.
2. A future run starts only with an exact Issue, `bridge:ready`, declared
   allowed files, model label, reasoning-effort line, and risk label. Absent
   prerequisites produce `BLOCKED_DECISION`.
3. The run records its static preflight evidence: checkout identity, branch,
   HEAD, dirty state, CLI availability, approved file list, and every command
   actually run. Evidence must clearly separate observed facts, blocked checks,
   and unperformed checks.
4. The run cannot grant approval. It stops at `READY_FOR_REVIEW`; human review
   remains the only canonical approval and merge path.
5. The run cannot broaden to `.bridge/` mappings, `server.ts`, `.env*`,
   provider behavior, GitHub integration, auth, persistence, billing,
   deployment, runtime networking, secrets, or production data unless a new,
   exact approved task opens that boundary.

## Explicit non-goals

- No Claude CLI installation, upgrade, global package change, or dependency
  retrieval.
- No application startup, build, lint, test, preview, browser check, endpoint
  call, API request, provider request, or external network use.
- No GitHub Issue/label/PR mutation, Bridge mapping or watcher execution,
  LaunchAgent action, deployment, release, billing/service action, secret
  access, or production change.
- No claim that this preparation proves a live Claude integration or an
  executable migration.

## Audit verdict vocabulary

| Result | Meaning |
|---|---|
| `PREPARED_DOCUMENTATION_ONLY` | Local instruction and plan files exist; no Claude execution occurred. |
| `BLOCKED_ENVIRONMENT` | A required local capability, including the Claude CLI, is unavailable. |
| `BLOCKED_DECISION` | The exact task authorization, allowed files, or required governance metadata is absent. |
| `READY_FOR_REVIEW` | A separately authorized future task completed its allowlisted work and evidence capture; this is not approval. |

## Verification boundary for this preparation

Only static checks of the newly created Markdown files and Git diff are in
scope. They confirm path allowlisting, required safety markers, and clean
Markdown whitespace. They do not validate Claude execution, dependencies,
application behavior, provider behavior, or deployment.
