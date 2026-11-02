# Owner Verification Gate — Grok Bot → GitHub → Antigravity

Date: 2026-11-02 SGT. Scope: **environment-capability verification only**, not coding execution or installation.

## What engineering already completed
1. Pilot01: [Draft #106](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/106), real native one-shot [Issue #107 evidence](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/107#issuecomment-6567935283). No repeat.
2. Pilot02A: GitHub read-only Issue admission [Draft #110](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/110); not on main, GitHub issue event trigger **not active**.
3. Pilot02C: Anti CLI preflight [Draft #113](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/113); only tests the CLI interface; no model, settings, GitHub, worker or Mac service changes.
4. Grok × Anti routing authority [Issue #111](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/111); focused safe verification [Issue #112](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/112).

No merge or deploy is permitted. ZC-06C Mac native settings race remains HOLD. Both Grok connection and Mac CLI availability are **UNKNOWN** until real owner evidence.

## Verification A — Anti on owner Mac (no model request from diagnostic)
Run from the **existing Command Center worktree** after explicitly checking out candidate `zc/zc-pilot02c-anti-cli-preflight` in a separate isolated checkout, with a clean tracked tree. Do not overwrite another running checkout or fetch secrets. Verify actual checkout HEAD matches GitHub Draft #113 HEAD before executing:

```sh
git rev-parse HEAD
node tools/zc-anti/cli-preflight.mjs
```

The second command uses exactly `agy --version` and `agy --help` and emits one JSON line. **It does not run a model**, start a worker, or verify CLI login. The CLI itself may initialize normal state; only run this if you accept the documented `--version`/`--help` diagnostic.

If `gate=CLI_INTERFACE_DETECTED` and the flags are true, record only the output JSON and exact repository SHA in Issue #112. Keep `isolation=UNVERIFIED`, `authentication=UNVERIFIED`, `subscriptionQuota=UNVERIFIED`, `worker=NOT_CONNECTED`, `dispatch=HOLD`, `readyToCode=false`. Do **not** paste CLI credential/session data or raw logs. If `UNSAFE_PATH`, `CLI_MISSING_OR_FAILED`, `CLI_FLAGS_MISSING` or anything else, record HOLD without changing global settings or installing software.

This is **not** a sandbox penetration test. Effective terminal isolation and same-UID safety require a separately authorized, disposable-directory test before model execution. The current Anti preflight output cannot lift ZC-06C HOLD.

## Verification B — Grok Bot GitHub connection (read-only)
Within the user's Grok Bot app, authorize only the chosen GitHub repo with least permission available. If the provider requests broader repository/organization access, extra purchases or unknown write scopes, stop and report the exact permission dialog **without approval**.

Ask Grok to confirm the canonical repository `augusliang23-web/Micro-SaaS-Command-Center` numeric ID `1352468489`, read current main SHA, PR #106/#110/#113 and Issue #111/#112, then report whether GitHub event-triggered Routines and repository-scoped Issue write **are actually available** on this account. No new issues, workflows, routine, Cloud Agent, code, model quota spend, or API/hosting changes in this test. Distinguish supported product feature from account-verified entitlement.

Return a short verdict:
- `GROK_GITHUB_READ_PASS`: real read with matching repo identity and links;
- `GROK_GITHUB_HOLD`: missing access, unexpected scope, stale source, unsupported trigger, permission, or spend.

Documentation: https://docs.x.ai/grok-bot/skills-routines-and-automations

## Owner handoff packet
Only these items are needed to resume ZC integration:
- The Anti `zc.anti.preflight/v1` JSON line with no secrets;
- Grok `PASS/HOLD` and GitHub evidence links, plus whether a GitHub-event Routine can be configured without broad access.

## Remaining work AFTER those verification results
**Not approved by these diagnostics:** real sandbox negative test, worker identity and trusted non-issue authorization, one-time durable claim, safe GitHub-to-local trigger, live native Anti call, bounded file writes, draft PR, independent QA, owner UAT. Local Mac must be awake for local Anti; cloud Grok does not automatically invoke local processes. A cloud Anti runner is a separate authentication/security/usage decision.

Control Plane gate until then:
`GROK_CONTROL_PLANE_SELECTED / ANTI_PRIMARY_SELECTED / CLI_CODE_QA_PASS / GROK_READ_UNKNOWN / ANTI_HOST_UNKNOWN / LIVE_DISPATCH_HOLD`.
