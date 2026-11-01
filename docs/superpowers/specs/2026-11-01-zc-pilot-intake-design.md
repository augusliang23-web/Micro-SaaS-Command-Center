# ZC Pilot 01 — GitHub intake (Issue #105)

The owner wants development without copying prompts, eventually driven by any control plane, including Grok. This first independent slice creates a real GitHub task record and reads it back. It deliberately cannot start an agent. It leaves existing V1, unmerged PRs, Mac settings and all product environments untouched.

## Product contract
- Local owner scenario: open the Command Center pilot page, inspect one fixed PM task, create its record, refresh status and follow its GitHub evidence link.
- Existing behavior: monitoring only, no trusted worker. Expected behavior: a real issue is recorded, while agent remains NOT_CONNECTED and dispatch HOLD. No new roles or permission semantics.
- Selected task: disable existing `.spinner` and `.async-action-spinner` CSS animation when `prefers-reduced-motion: reduce`; preserve normal-motion rendering, loading text and all business behavior. PM main `8e1a0e611bb4a509b0c0ce0a2432778c5f8367ef` contains the gap. Open PR metadata #94/#93/#83/#82/#80/#78/#77/#75 and older release drafts was inspected. Shared index.html requires fresh overlap review before any later execution.
- Acceptance: real create/read-back; duplicate clicks reuse one issue; malformed, uncertain, duplicate and unavailable evidence holds; cross-origin/Host/CSRF failures cannot write; exact-head no-install CI and independent review; Safari journey exercised where available. Owner acceptance is distinct.
- Non-goals: source execution, claims/leases, agent heartbeat, arbitrary prompt entry, workers, providers, merge/deploy, UAT/cloud data.

## Approach
Use a standalone Node entry inside this repository, with no dependencies or modification to existing server.ts. A fixed versioned data envelope is stored verbatim in an issue in this repository via the existing authenticated gh session. A native GitHub issue form would avoid local writes but require another manual submit; extending legacy provider/task endpoints would enlarge the permission boundary. The standalone entry is the implementer's choice under the owner's autonomous instruction.

## Boundaries
Read-only by default; --allow-github-intake enables only the fixed issue POST. Exact loopback Host and Origin, random process CSRF token, JSON and size limit. Static asset paths are fixed. No caller-supplied repo, command, model, file list or task body. Identity GET verifies repository numeric id and canonical URL before bounded issue reads/writes. POST additionally checks PM main has not moved. No secret values are read or printed by application code.

One process serializes create requests and reconciles all pages up to a bounded limit before a write. An ambiguous POST latches WRITE_UNCERTAIN for the process; status reads may recover a matching record. No automatic write retries. GitHub issue creation has no atomic idempotency primitive: this is not a cross-machine exactly-once guarantee; duplicate records fail closed and never dispatch. Do not restart to bypass WRITE_UNCERTAIN.

## Neutral protocol and future worker gate
zc.task/v1 carries stable task/idempotency identities, target repo/id/base SHA, scope, acceptance, capabilities and fixed maximum fix attempts. zc.status/v1 and zc.event/v1 expose intake observations with GitHub provenance. No chat id, external prompt or GPT-specific state. Grok changes only its adapter producing/consuming these data contracts. No task body or GitHub label grants execution authority. A future worker requires independently verified capability grants, isolated source checkout, bounded credentials, spend/provider authorization and claim/event authenticity; this slice supplies none of those.
