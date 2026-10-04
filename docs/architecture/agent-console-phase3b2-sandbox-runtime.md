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
| `readbackVerifier.mjs` | strict `docker inspect` verification (explicit-presence rule) |

## 2. Contract

**Identity rule.** Once `docker create` returns a container ID, that immutable ID is the container's identity. Names are used only for the pre-create collision check. Every state-changing operation (`start`, `stop`, `kill`, `rm`) targets the exact tracked ID, preceded by one ownership check that requires **all** of: `Id` equals the tracked ID, `cc.sandbox=1`, `cc.sandbox.id=<sandboxId>`, `cc.sandbox.role=<role>`. If any fact disagrees the operation fails closed and the container is left untouched. A container that appears under our name after a failed `create` is never removed (ownership is unprovable); it is reported `CREATE_AMBIGUOUS`.

**Tracking rule.** The record is created the moment Docker returns an ID (`CREATED_UNVERIFIED`) and is never dropped because a later readback fails: the result is `UNKNOWN / READBACK_UNCONFIRMED` and `inspect/stop/destroy` keep working on that exact ID. `DESTROYED` is reported only after Docker confirms the exact ID is absent; otherwise `UNKNOWN` and the record (and mask state) are kept.

- **`probe()`** — engine reachable and linux, and each allowlisted image present with the pinned digest and platform. Never throws; unavailable ⇒ BLOCKED upstream, no host fallback.
- **`prepare({sandboxId, role, worktreePath, policy, command})`** — validates everything, refuses unknown fields, checks the name is free, runs `docker create` (never `run`), then reads the container back **by ID** and verifies it (strict rule below). A verified-identity container that fails the policy is removed by ID and confirmed absent; anything unprovable is left in place.
- **`start(id)`** — re-scans the workspace (symlinks, hard links, nested `.git`), re-verifies identity and policy, `docker start -a <id>` with timeout and output cap, then reports from inspect readback. Ambiguity ⇒ UNKNOWN.
- **`inspect(id)`** — authoritative state of the tracked ID (`UNKNOWN` when ambiguous or not provably ours).
- **`stop(id)`** — ownership check → `docker stop <id>` → bounded wait → `docker kill <id>`; `STOPPED` (with evidence) only when readback of that ID confirms.
- **`destroy(id)`** — idempotent; ownership check → `docker rm --force <id>` → readback must show the ID absent.

**Strict readback rule.** A property supports `LOCALLY_VERIFIED` only if Docker *explicitly* reports the expected safe value. A missing field is never equivalent to `false`/`[]`/`{}`/`""`: it yields `POLICY_READBACK_INCOMPLETE`; a present-but-unsafe value yields `POLICY_READBACK_MISMATCH`; unparseable output is `UNKNOWN`. Verified fields include `Privileged===false`, `CapDrop==['ALL']` and an explicitly empty `CapAdd`, `SecurityOpt` exactly `no-new-privileges` (so `=false`, extra options or prefixes fail), explicit `PidMode/UsernsMode/UTSMode===''`, `IpcMode==='private'`, explicitly empty `Devices/DeviceCgroupRules/DeviceRequests/PortBindings/Links/Binds/VolumesFrom`, `ReadonlyRootfs===true`, exact network mode, limits, user, mounts (each with a boolean `RW`) and the **complete tmpfs options** (`/tmp`: `rw,noexec,nosuid,nodev,size=64m`; `.git`: `ro,noexec,nosuid,nodev,size=1k`; order and equivalent size spellings normalized, anything weaker fails). When no tmpfs is intended, `HostConfig.Tmpfs` must still be explicitly present and `{}`; a missing field is INCOMPLETE. Real Docker 29.x omits the field when no tmpfs exists, so such a configuration (no `/tmp` and no `.git` directory mask) cannot currently reach PREPARED — it fails closed rather than being assumed safe.

Evidence (`sandbox_policy / created / started / stopped / destroyed`) is `LOCALLY_VERIFIED` only from authoritative readback of the exact tracked ID. Container stdout is output, not evidence.

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

Symlink gate: the Phase 3A detector runs first; escaping, dangling or chained symlinks, a symlinked `.git`, any nested `.git`, or a tree too large to scan **block** activation.

Hard-link gate (closed in this phase): a bind-mounted workspace can contain a regular file whose inode is also referenced outside it (`workspace/leak` ↔ `outside/secret`), which would expose or let the container modify the outside file. We cannot robustly tell which other path owns an inode, so V1 **fails closed**: any regular file with link count > 1 → `HARDLINK_UNSAFE` → BLOCKED, before Docker is contacted, and again immediately before `start`. This is conservative (it also blocks workspaces that hard-link files among themselves, e.g. pnpm stores); a staged-copy design can replace it later. A container cannot create a link to a path outside its mount, so links added during a run cannot reach host files. This is still a preflight gate, not a sandbox: host-side integrity checks after a run remain required.

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
