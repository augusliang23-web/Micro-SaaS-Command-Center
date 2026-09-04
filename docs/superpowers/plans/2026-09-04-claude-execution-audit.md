# Claude Execution Audit — Option A Preparation Plan

## Goal

Prepare the repository-local Claude execution-audit contract without executing
Claude or changing product, runtime, Bridge, Issue, or operational surfaces.

## Scope

The GitHub Issue #5 allowlist for this preparation is:

- `package.json`
- `package-lock.json`
- `bun.lock` (removal only after the npm lockfile is reviewed)
- `.gitignore` (only to protect `.bridge` environment files and `.npmrc` if needed)
- `docs/claude-audit/**`

All other paths are excluded. In particular, do not change feature source or
runtime behavior, `CLAUDE.md`, `docs/superpowers/**`, `.bridge/` mappings,
Issues, LaunchAgents, environment files other than the narrowly allowed
`.gitignore` protections, server routes, provider behavior, or deployment
settings.

## Completed preparation steps

- [x] Read `AGENTS.md`, all repository `.bridge/` contracts, `package.json`,
  and the available existing documentation. No repository `README.md` exists.
- [x] Record the static local condition: `claude` is unavailable on `PATH`.
  No global installation or alternative CLI invocation was attempted.
- [x] Create a repository-local `CLAUDE.md` that retains the existing
  fail-closed governance, protected surfaces, evidence requirements, and
  `READY_FOR_REVIEW` stop.
- [x] Create the Option A design and audit guide, including explicit
  non-goals and verdict vocabulary.
- [x] Validate only the allowlisted Markdown paths and diff whitespace.

## Future task gate — not authorized by this plan

A future Claude execution audit must stop before any action unless an exact
GitHub Issue, `bridge:ready`, allowed file list, model label, reasoning effort,
and risk label are all recorded. It must then recheck the local CLI without
installing it. If unavailable, report `BLOCKED_ENVIRONMENT`; if governance
metadata is absent, report `BLOCKED_DECISION`.

If a future task is authorized and the CLI is available, it must still avoid
secrets, external network/provider calls, protected API routes, application
startup, production actions, Bridge mapping changes, and any unallowlisted
file. It must capture evidence and stop at `READY_FOR_REVIEW`.

## Verification commands for this preparation

```bash
test -f package.json
test -f package-lock.json
test ! -e bun.lock
test -f .gitignore
test -d docs/claude-audit
rg -n 'BLOCKED_ENVIRONMENT|BLOCKED_DECISION|READY_FOR_REVIEW|not install|no.*network' \
  docs/claude-audit
git diff --check -- package.json package-lock.json bun.lock .gitignore docs/claude-audit
```

Expected result: files and markers exist, and whitespace validation passes.
This does not imply that the Claude CLI exists or that any product behavior was
executed.
