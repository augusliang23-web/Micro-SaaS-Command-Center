# Agent Console Phase 3B2 — Docker Sandbox Runtime Foundation

**Status:** runtime built and tested; **unwired**. Real agent execution stays BLOCKED (Orchestrator still fake-only).
**Baseline:** `main` @ `62c0f2e`.

```text
Host Command Center → Task / PolicyGate → Orchestrator → [Agent Sandbox | Verification Sandbox] → Host integrity guard → commit / push / PR
                                                         ^ this phase: the provider-neutral runtime both sandboxes will use
```

## 1. Modules (`server/sandbox/`)

| File | Role |
|---|---|
| `sandboxPolicy.mjs` | strict policy parser, `docker create` argv builder, final argv guard |
| `sandboxImages.mjs` | server-side image allowlist (digest-pinned) |
| `pathSafety.mjs` | one shared workspace-path gate |
| `workspaceView.mjs` | symlink gate + `.git` metadata handling |
| `dockerClient.mjs` | absolute-binary, `shell:false` Docker CLI wrapper (injectable) |
| `dockerSandboxRuntime.mjs` | `probe / prepare / start / inspect / stop / destroy` |

## 2. Contract

- **`probe()`** — engine reachable, linux engine, and each allowlisted image present with the pinned digest and platform. Never throws; unavailable ⇒ BLOCKED upstream, no host fallback.
- **`prepare({sandboxId, role, worktreePath, policy, command})`** — validates everything, refuses unknown fields, checks the name is free, runs `docker create` (never `run`), then **reads the container back with `docker inspect` and verifies 24 properties** (network mode, privileged, caps, security opt, read-only root, pid/ipc/userns, devices, ports, memory/swap, CPUs, PIDs, user, workdir, log driver, image id, labels, exact mounts, tmpfs, exact environment, no Docker socket). Any mismatch removes *our own* container and returns BLOCKED.
- **`start(id)`** — re-verifies the container is unchanged, `docker start -a` with timeout and output cap, then reports from inspect readback (exit code, OOM). Ambiguity ⇒ UNKNOWN.
- **`inspect(id)`** — normalized authoritative state (`UNKNOWN` when Docker's answer is ambiguous).
- **`stop(id)`** — `docker stop` → bounded wait → `docker kill`; `STOPPED` only when readback confirms; otherwise `UNKNOWN`.
- **`destroy(id)`** — idempotent; removes only a container carrying our labels and matching container id; anything else is BLOCKED and left alone.

Evidence (`sandbox_policy / created / started / stopped / destroyed`) is `LOCALLY_VERIFIED` only from inspect readback. Container stdout is output, not evidence.

## 3. Exact Docker configuration

```text
docker create --name=cc-sandbox-<role>-<id> --label=cc.sandbox=1 --label=cc.sandbox.id=<id> --label=cc.sandbox.role=<role>
  --pull=never  --network=none|bridge  --ipc=private  --cap-drop=ALL  --security-opt=no-new-privileges  --read-only
  --memory=<n>m --memory-swap=<n>m --cpus=<n> --pids-limit=<n>  --user=<host uid>:<host gid> (non-root)  --workdir=/workspace  --log-driver=none
  --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m
  --mount=type=bind,src=<canonical worktree>,dst=/workspace[,readonly]
  --mount=type=bind,src=<empty 0444 file>,dst=/workspace/.git,readonly      (worktree .git FILE)   |   --tmpfs=/workspace/.git:ro,…,size=1k (.git DIR)
  --env=PATH=… --env=HOME=/tmp --env=<policy env…>
  <image@sha256:digest> <command…>
```
- Every option is `--flag=value`; the image is the allowlisted digest reference; the command follows the image and is plain data (verified in real Docker: `--privileged`, `--network=host`, `-v /:/host` passed as command arguments are just echoed).
- Never present: `--privileged`, `--network=host`, host PID/IPC/UTS/userns, `--cap-add`, `--device`, `--volume`/`-v`, extra mounts, Docker socket, `--env-file`, `--entrypoint`, root user. `assertDockerArgs` rejects any such option on the final argv, and the readback verifies Docker actually honoured the configuration.
- Defaults: 1 CPU, 512 MB (swap = memory), 128 PIDs, 120 s timeout, 1 MiB output.
- Environment: fixed `PATH`/`HOME` plus explicit `policy.env`. Host `process.env` is never read. Secret-like and routing names (`*TOKEN*`, `*KEY*`, `GH_*`, `SSH_*`, `AWS_*`, `ANTHROPIC_*`, `OPENAI_*`, `GIT_*`, `DOCKER_*`, `NODE_OPTIONS`, proxies…) are refused.

## 4. Workspace and Git metadata boundary

A `git worktree` contains a `.git` **file** pointing by absolute path to the shared `<source>/.git/worktrees/<name>`. Only the worktree is mounted, so that pointer dangles in the container, **and** the `.git` entry is masked: the container sees an empty, read-only, non-removable file (or an empty read-only tmpfs if `.git` is a directory). The container has no Git authority, cannot read the host path the pointer names, and cannot alter it. The host owns all git operations. Verified in real Docker: `.git` size 0, writes and `rm` fail, the shared source path does not exist in the container, host `.git` is byte-identical afterward, and host `git status` still works.

Workspace gate (shared helper): absolute, canonical, existing directory; not `/`, system dirs, home, an ancestor of home, the Command Center checkout (or inside/ancestor of it), `~/.docker`, `~/.ssh`, `~/.aws`, `~/.config`, `~/.claude`, `~/.codex`, …; no commas, quotes or control characters (they could alter Docker's `--mount` syntax); no overlap with the runtime's state directory.

Symlink gate: the Phase 3A detector runs first; escaping, dangling or chained symlinks, a symlinked `.git`, any nested `.git`, or a tree too large to scan **block** activation. This is a preflight signal, not full confinement: hard links and links created later by the agent are not covered (host-side checks after the run remain required).

## 5. Networks

- `NO_NETWORK` → `--network=none`, confirmed by `docker inspect` (`NetworkMode=none`, `Networks={none}`) and inside the container (only `lo`, empty routing table).
- `PROVIDER_NETWORK` → default `bridge`. **Docker cannot restrict this to the provider's endpoints without extra infrastructure**, so this is *provider transport available*; agent tool network access stays disabled at the adapter level (Phase 3A tool policy). The runtime reports `providerNetworkRestrictsToProvider: false` and claims nothing more.

## 6. Image

`busybox@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e` (`busybox:1.37.0`, linux/arm64 v8, 6.1 MB), pulled once with explicit approval. Only the digest and platform match at probe time are checked; there is no signature or provenance verification. Images are never pulled by the runtime (`--pull=never`; a missing image is BLOCKED). This scratch image is for tests only.

## 7. Future auth interface (not implemented)

Provider credentials must not travel through `policy.env`. A later phase adds a separate, server-owned `ProviderAuthMount { provider, hostSource (server-resolved), containerPath, readOnly }` accepted only for the `agent` role, validated like a mount, and never for the `verifier` role. No Claude subscription credential is copied in Phase 3B2 and there is no API-key fallback.

## 8. Remaining gates

- **3B3 Verification Sandbox:** NO_NETWORK verifier on a real project (dependency strategy, clean env, host integrity guard between agent and verifier).
- **3B4 Claude live smoke:** adapter inside the agent sandbox, auth injection, provider connectivity, confirming stream-json shapes.
- **3B5 Orchestrator activation:** generalized worktree guards, real-adapter gate, evidence wiring.
- **3B6 Governance migration.**
