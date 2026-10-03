# Agent Console Phase 3A — Claude CLI Adapter Foundation

**Status:** adapter built and tested, deliberately **unwired**. Real Claude execution is **disabled** until Phase 3B.
**Baseline:** `main` @ `7406542`.

## 1. What exists

```text
AgentAdapter contract         server/execution/agentAdapter.mjs
ClaudeCliAdapter              server/execution/claudeCliAdapter.mjs   (id: claude-code)
Stream parser (Claude-only)   server/execution/claudeStreamParser.mjs
Bounded child-process runner  server/execution/streamingProcess.mjs
Symlink escape helper         server/execution/symlinkGuard.mjs       (unwired; Phase 3B gate)
```

Nothing imports the adapter except tests. The Orchestrator still contains its fake-only gate (`adapter.id !== 'fake'` → BLOCKED) and is not changed. No route, UI or task endpoint can start Claude.

## 2. Installed CLI (verified read-only; no inference)

| Item | Result |
|---|---|
| Binary | `/opt/homebrew/bin/claude` → `@anthropic-ai/claude-code/bin/claude.exe` (native Mach-O) |
| Version | `2.1.260` (the desktop app also bundles `2.1.284`, which is not used) |
| Auth | `claude auth status` → `loggedIn: true`, `authMethod: claude.ai`, `apiProvider: firstParty`, subscription |
| Verified in `--help` | `-p/--print`, `--output-format stream-json`, `--verbose`, `--session-id <uuid>`, `--model`, `--effort`, `--tools`, `--disallowedTools`, `--permission-mode acceptEdits`, `--permission-prompts none`, `--restricted`, `--safe-mode`, `--strict-mcp-config`, `--disable-slash-commands` |
| Prompt via stdin | `-p` is documented as pipe-friendly; the adapter sends text on stdin and closes it. `--input-format stream-json` exists but its message schema is unverified, so it is **not** used |
| Not used | `--dangerously-skip-permissions`, `--allowedTools`, `--add-dir`, `--mcp-config`, `--settings`, `--fallback-model`, `--max-budget-usd` (API-key only), `--bare` (requires an API key) |
| UNKNOWN | the per-event JSON schema of stream-json (see §6), the exact semantics of `--safe-mode` combined with `--restricted`, and graceful cancellation (none verified, so none is used) |

### Environment finding (important)
Subscription auth needs `USER` and `LOGNAME` as well as `HOME`: with only `HOME`+`PATH` the CLI reported `loggedIn: false`; adding `USER`+`LOGNAME` restored it. The adapter therefore builds an **allowlist** environment (`HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, fixed `PATH=/usr/bin:/bin`, `DISABLE_AUTOUPDATER=1`). Everything else is dropped by omission, including `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_*` host/messaging tokens, Bedrock/Vertex routing, `GIT_*`, npm/GitHub/OpenAI tokens and `SSH_AUTH_SOCK`. (The development session that built this had `ANTHROPIC_BASE_URL` and a messaging token in its own environment; a blocklist would have missed such names.)

## 3. Invocation

```text
spawn(<registry binary>, [argv], { cwd: <orchestrator worktree>, env: <allowlist>, shell: false, detached })
stdin  = prompt (never argv)
argv   = -p --output-format=stream-json --verbose --session-id=<server UUID> --model=<config> --effort=<config>
         --tools=Read,Edit,Write,Glob,Grep --disallowedTools=Bash,PowerShell,REPL,WebFetch,WebSearch
         --restricted --safe-mode --strict-mcp-config --disable-slash-commands
         --permission-mode=acceptEdits --permission-prompts=none
```

- **Binary:** from `ProjectRegistry.agentBinaries.claude` only; must be a clean absolute path; probe fails closed if missing, not executable, wrong version output, a required flag is missing from `--help`, auth is absent, or auth is not a first-party subscription.
- **cwd:** absolute, canonical, existing directory, never the Command Center checkout (or an ancestor), home or `/`.
- **Tools:** edit-only. No Bash/git/gh/curl/WebFetch/WebSearch. *Provider transport to Anthropic is the CLI's own and is separate from giving the agent a network tool.*
- **Permissions:** `--permission-prompts none` is documented to deny anything that would prompt, so a run cannot hang on a terminal prompt. The adapter also checks the runtime's own `init` event: if it reports a tool outside the allowlist, a permission mode other than `acceptEdits`, or a different cwd, the process is terminated and the run fails (`TOOL_POLICY_VIOLATION`, `PERMISSION_MODE_VIOLATION`, `CWD_MISMATCH`). If the runtime does not report tools, the result says `toolPolicyObserved: false`.
- **Models:** `FAST/STANDARD/DEEP/CRITICAL` map to model+effort in `DEFAULT_CLAUDE_PROFILES`, which is configuration injected into the adapter. Persisted tasks only hold the profile name. Requested and actual model are separate facts; actual is `UNKNOWN` unless the runtime reports it.
- **Session:** server-generated UUID passed as `--session-id`; never the task id.

## 4. Trust

Adapter events are graded by **event type chosen in adapter code**, never from anything the agent wrote: agent prose is `AGENT_CLAIM`; every other adapter event is `RUNTIME_OBSERVED`. That is the ceiling. Claims such as "tests passed", "commit abc", "PR #42", "deployed" stay prose. The adapter emits no `files_changed`, `command_result`, `commit`, `push` or `pr` events and a forged event or grade field inside the stream is ignored. Higher grades (`LOCALLY_VERIFIED` and above) belong to the Orchestrator.

Usage: tokens are `OBSERVED` only when the runtime reports whole `input`/`output` counts; otherwise `UNAVAILABLE`. `costUsd` is always `null` (a reported `total_cost_usd` is ignored: subscription cost is not trustworthy per run).

## 5. Cancellation and limits

`cancel()`: SIGTERM to the process group → bounded wait → SIGKILL → bounded wait. `CANCELLED` is reported only after the exit is observed; a process that never exits yields `unknown` (`EXIT_NOT_OBSERVED`). No graceful channel is verified for this CLI, so none is used (capability: `cancellation: 'signal'`). Limits: line 1 MiB, stdout 32 MiB, stderr 256 KiB; exceeding any terminates the child and fails with `OUTPUT_LIMIT`.

## 6. Live smoke is pending — `CLAUDE_ADAPTER_LIVE_SMOKE_PENDING`

No Claude prompt was run (none is allowed in this task). The stream-json event shapes are implemented from the published Claude Code SDK format and local session logs, and the parser reads every field defensively, but they are **not** live-verified, nor is the `--restricted` + `--safe-mode` + `--tools` + `acceptEdits` + `--permission-prompts none` combination. One bounded smoke, scheduled by the Control Plane, must confirm: the `init` event fields (`tools`, `permissionMode`, `cwd`, `model`), the `result` event and usage fields, that Edit works inside the cwd while Bash and WebFetch are unavailable, and that an off-policy action is denied without waiting.

## 7. Hard gates before real execution (Phase 3B)

1. **Agent-generated code runs with local permissions.** An agent can edit tests, `package.json` scripts or build config; the Orchestrator then runs the project's verification commands, executing that code with the Command Center process's permissions. Prompts cannot fix this. Phase 3B needs an enforceable verification sandbox (and real-agent execution isolation) before the adapter may be connected to verification, commit, push or PR.
2. **Symlink escape.** A correct `cwd` does not confine the agent: a committed symlink can point outside the worktree. `symlinkGuard.findEscapingSymlinks` reports escaping, dangling and chained links, but it is a detector, not a sandbox (hard links and mounts are not detectable by it). It must be part of the activation gate, together with filesystem-level confinement.
3. **Worktree guard generalization.** `WorktreeManager.guard` currently allows only the Fake Adapter's `fixturePath` to change. That is intentionally untouched. The future split: *generic* integrity guards (protected paths, HEAD/refs/remotes unchanged, no unexpected untracked escapes, symlink scan) stay always-on; the *allowed-path* restriction becomes adapter-specific (fake: one fixture path; real: any non-protected path under the worktree). Both must be proven before the Orchestrator accepts a non-fake adapter.
4. **Governance migration.** `CLAUDE.md` / `AGENTS.md` / `.bridge/` still require the manual Issue + `bridge:ready` process. The dual-authority migration happens only when real execution is enabled.
5. **Orchestrator enablement** (`adapter.id` gate), a Run endpoint and UI are separate, later changes.
