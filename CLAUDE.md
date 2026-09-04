# Claude Execution Boundary

## Current mode: documentation-only audit preparation

This checkout is a Prototype. Its fixtures, browser-memory values,
user-entered values, and AI-generated output are not authoritative evidence.
This file prepares a future, explicitly authorized Claude execution audit; it
does not authorize Claude to execute a feature task, interact with a provider,
or change project configuration.

## Mandatory preflight for every future Claude task

Before any execution, the task owner must provide all of the following:

- an exact GitHub Issue;
- a declared, allowlisted file set;
- an explicit model label and `- Reasoning Effort:` line;
- a risk label; and
- `bridge:ready` recorded by the authorized human workflow.

If any prerequisite is absent, stop and report `BLOCKED_DECISION`. Do not add
`bridge:ready` or `bridge:approved`, auto-approve, merge, deploy, release, or
perform any write outside the approved file list. Stop at `READY_FOR_REVIEW`.

## Protected boundaries

Do not call, start, modify, expose, or test either protected route:

- `/api/bridge/chatgpt-advice`
- `/api/bridge/extract-features`

The following remain blocked unless a separately reviewed, exact task opens
them: `server.ts`, `.env*`, provider behavior, GitHub integration,
authentication, authorization, persistence, billing, deployment, runtime
networking, secrets, production data, and Bridge mappings.

Do not install Claude globally or retrieve dependencies as part of this audit.
Do not read or print secret values. Do not run network, provider, production,
deployment, billing, or service-creation actions.

## Claude CLI availability

At preparation time (2026-09-04), `claude` was not present on `PATH` in this
checkout environment. Record this as `BLOCKED_ENVIRONMENT`; do not attempt an
installation or substitute a network-enabled command. A future task may only
recheck availability after it has separately authorized the check and its
execution boundary.

## Evidence and routing

Record the repository path, branch, HEAD, status, exact allowed files, command
outputs, and every skipped or blocked check. Passing a static documentation
check is not feature approval, provider evidence, deployment evidence, or
permission to expand scope.

Use the lowest-cost capable model: Luna for mechanical inspection, Terra for
normal implementation and review, and Sol only for architecture, ambiguity,
high-risk integration, or critical final review.
