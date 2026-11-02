# ZC G1 — Owner Mac Antigravity Sandbox validation gate (HOLD)

Updated 2026-11-02 SGT. Parent: [Issue #114](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/114), bridge Draft [PR #115](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/115).

## Why manual authorization is required

Verified from the owner's local Terminal: `agy 1.4.12`, `--print`, `--output-format`, `--sandbox` are advertised, and the read-only CLI diagnostic returns `CLI_INTERFACE_DETECTED`. This **does not prove** macOS sandbox isolation. Verifying actual deny behavior needs a real CLI model turn that might execute model-chosen terminal or file operations. Neither this repository nor ChatGPT is authorized to run an unexpected model turn or alter Mac global safety settings.

**Do not run a model, daemon, Login Item, launchctl, self-hosted GitHub runner or set `--dangerously-skip-permissions` under this document.** The current safe work is only an authorization/preparation runbook, not a command sequence to execute automatically.

## Owner approval choices, before any sandbox negative probe

- Approve **one** finite subscription-model invocation in a newly created isolated disposable working directory (not PM Dashboard, Inventory Tool or Command Center primary worktree).
- Keep Mac shell/file permission prompts visible; never use Turbo or blanket auto-approve. First check documented non-interactive permission behavior and whether a denial is observable in `stream-json`. Avoid any CLI flag that grants unrestricted shell write permissions.
- Use a short explicit prompt whose only requested operations are within disposable fixtures. Require a *denial* on a deliberately out-of-scope synthetic sentinel. No reading home/Documents/SSH/credentials, no network, no GitHub writes, no paid Gemini API.
- Before and after the run, compare the sentinel and disposable fixture contents using an independent shell hash. If the forbidden write is possible, event logs are ambiguous, permissions auto-granted or the model cannot demonstrate denial → **HOLD** and disable bridge execution.
- Time budget, rate limits and local OAuth login must be checked; no credential display or sharing. The owner must consent to potential subscription quota consumption, and a separate trusted container/OS isolation plan may still be needed even if one negative test passes.
- Record sanitized test evidence in Issue #114: CLI version, exact model invocation flags (not credentials/prompt secrets), redacted terminal result, whether forbidden access was actually denied, before/after hash status, GitHub repo/branch SHA, and explicit Gate. Never post local paths revealing private data.

## What G1 PASS does and does not mean

A bounded test can demonstrate a **specific** denial under the tested host/configuration, not prove general escape-resistance or fix ZC-06C's known same-UID settings race. Before real Coding dispatch, require a separately reviewed secure host boundary, trusted identity, owner public-key enrollment, durable single-claim nonce, permission allowlist, quota guard and independent PR QA.

### G1 states

- `ANTI_CLI_INTERFACE_PASS`: verified already on owner Mac.
- `ANTI_SANDBOX_EFFECTIVE_DENY_PASS`: **UNVERIFIED**, owner-supervised negative test required.
- `ANTI_OAUTH_AND_USAGE_BUDGET_PASS`: **UNVERIFIED**.
- `LOCAL_BRIDGE_RELAY_PASS`: **NOT_CONNECTED**.
- `GROK_CALLBACK_ROUTINE_PASS`: **NOT_TESTED**.

Until those are proven: `EXECUTION_HOLD / MERGE_DEPLOY_HOLD`.
