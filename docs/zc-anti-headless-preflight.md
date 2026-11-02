# ZC Pilot02C — Antigravity Headless CLI host preflight

Related: [Issue #112](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/112), main routing owner [Issue #111](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/111).

## Target architecture
**Grok Bot = Control Plane**; **GitHub = task queue/provenance/event bridge**; **Antigravity (Anti) = primary Coding Agent**. Command Center Safari UI is optional. Native Codex is fallback only and Pilot01 evidence is not authorization for Anti. Versioned ZC task/grant/job/event contracts remain provider-neutral.

## Proven vs unknown
- **VERIFIED by vendor docs:** `agy` Headless mode accepts `-p`, `--output-format stream-json`, `--sandbox`, and uses cached authentication. See https://antigravity.google/docs/cli/headless/ and https://antigravity.google/docs/cli/reference.
- **UNKNOWN for owner's Mac:** whether `agy` is installed/on PATH, its real version, authentication, quota, effective OS sandbox, write/command permissions and security isolation.
- **UNKNOWN for Grok account:** GitHub connection, scoped Issue write/Routine trigger and any ability to trigger an approved local worker.
- **KNOWN HOLD:** ZC-06C Draft PR #36 same-UID file-race security concerns; do not reuse that executor or install/modify native settings.
- **VERIFIED earlier:** Pilot01 one fixed native Codex task succeeded. Pilot02A Draft PR #110 has an offline admission gate, but no live GitHub background executor.

## Read-only host capability check
One-time operator-approved invocation **only on the Mac that will host Anti**:

```sh
node tools/zc-anti/cli-preflight.mjs
```

The Node tool attempts exactly `agy --version` and `agy --help` using `spawnSync` semantics (no shell). It safely reads **both stdout and stderr** because owner-verified `agy 1.4.12 --help` writes 0 bytes to stdout and 3048 bytes to stderr. It validates exit status, signal and output size, never prints raw CLI streams, and emits one `zc.anti.preflight/v1` JSON line with bounded CLI interface information and fixed `readyToCode:false`. It never asks a model a question, invokes `agy -p`, logs credentials, reads Antigravity settings directly, edits GitHub, modifies Mac global settings, starts a worker, creates background services, or alters an app project. The underlying third-party CLI itself may initialize its usual state; that behavior has **not** been independently verified. The script does not claim it is a strict zero-side-effect program. If the desired host cannot be trusted to run even `--help`, perform host isolation review first.

Pass criteria **for this gate only**: macOS host, CLI exits successfully on both fixed probes, version parseable, and advertised `--print`, `--output-format`, `--sandbox`. Output then reads `CLI_INTERFACE_DETECTED`, while **isolation/auth/quota remain UNVERIFIED, worker NOT_CONNECTED, dispatch HOLD**. Missing CLI or flags returns HOLD and non-zero process exit. Do not treat a detected sandbox *flag* as working sandbox protection: Google documentation warns `--sandbox` can have no effect when OS support is unavailable. Never use `--dangerously-skip-permissions`, Turbo preset, arbitrary Issue text as shell argument, or unverified global permissions.

The CLI's headless success exit code is not sufficient for coding success because permission-denied commands may be soft-denied. Later execution must inspect full NDJSON `init`, tool steps, terminal `result`, filesystem diff and tests; a claimed agent PASS alone is not an authorized PR.

## Read-only test CI
`test/zc-anti-cli-preflight.test.mjs` uses a fake injected process execution boundary, so GitHub Actions on Linux **never calls Anti, a model or an external API**. It proves no modeled prompt flag, secret environment variables, shell launch or GitHub writes are part of the preflight script, plus schema, masking and fail-closed outcomes.

```sh
node --test test/zc-anti-cli-preflight.test.mjs
```

A green CI proves only **preflight code behavior**, not real owner-host readiness. It must remain Draft until review.

## Concrete next validation stages
1. On owner Mac, capture the bounded JSON output without keys/settings contents; check version and CLI features. No credential copy.
2. On a disposable isolated workspace, perform a *separately authorized* sandbox negative probe and record effective deny behavior. Mac ZC-06C same-UID race is NOT solved merely by CLI sandbox default.
3. Configure Grok GitHub integration read-only first, compare exact repository ID/Issue/PR/commit and verify its Routine can react to a new authorized task. Existing Issue #107 won't replay.
4. Design a trusted local Anti worker with bounded identity/grant and durable reservations; local Mac must stay awake or else use a separately verified isolated remote Anti installation. GitHub events alone do not run Mac binaries, and a GitHub self-hosted runner is not authorized on owner's Mac.
5. One new low-risk task after approval → Grok GitHub Issue → verified worker → scoped Anti headless coding → isolated checkout/test → Draft PR → independent QA → evidence link → Grok owner report. Stop for unknown quota, authentication, OS isolation, duplicate claim, file scope drift or CI failure. No Merge/Deploy.

## Security and product gates
`ANTI_CLI_INTERFACE_DETECTED` is **not** `ANTI_WORKER_READY`. Required later: `ANTI_HOST_ISOLATION_PASS`, `GROK_GITHUB_CONNECTED`, `TRUSTED_GRANT_PASS`, `ATOMIC_CLAIM_PASS`, `ANTI_REAL_CODING_CI_QA_PASS`, `OWNER_UAT_PASS`.

No provider billing, credentials, cloud IAM, local global setting changes, auto-merge, deploy or additional background automation are part of this PR.
