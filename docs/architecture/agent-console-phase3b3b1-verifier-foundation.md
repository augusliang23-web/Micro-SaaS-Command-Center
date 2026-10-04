# Phase 3B3B1 — Verifier image and snapshot foundation

Status: READY_FOR_REVIEW foundation; real project verification and real agents remain BLOCKED. This module is internal, provider-neutral and unwired. No Run endpoint, provider auth, governance migration, merge or deployment.

## Baseline and preserved authority

- Remote main: `19c23961af9b0f24b22d23a883def6c060db09e9` (checked before work).
- Branch: `codex/agent-console-phase3b3b1-verifier-foundation` in an isolated worktree.
- Original local main and its eight dirty files remain untouched. Preservation branch remains `8c4812490e69048d25c9e8ca3f30806fd325a66f`.
- Existing Orchestrator still rejects every adapter except fake, and every PR provider except fake-github.

## Base and verifier image

Only `node:22.23.3-bookworm-slim`, `linux/arm64`, was pulled with user authorization. Observed Node `v22.23.3`, npm `10.9.9`, variant `v8`. Bundled npm is retained; no npm upgrade/downgrade.

- Base RepoDigest/image ID: `sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c`.
- Final local verifier reference: `cc-verifier@sha256:619d2835a4ae8c361b7a64a17c3cd528b0d8b22d756545db288ece1f1e9374c8`.
- Final observed size: 638194199 bytes. This is a locally built image; it is not published to a registry or portable to another developer until explicitly provisioned there.
- Complete administrative provenance, including all context hashes and observed native capability results: `server/verifier/verifierImageIdentity.json`.
- Approved package.json SHA-256: `3acbf96890701808944b0cc5a3688eab3b2611ccfa029b756c7e05280fdd5414`.
- Approved package-lock.json SHA-256: `59a0736ce3f1b4f5690a074ec7c6a9b1719db1560c75ce882fdee24bbd0cce6c`.
- Provisioning policy: `npm-ci-ignore-scripts-v1`; bootstrap: `snapshot-copy-v1`, additionally identified by exact input hashes.

`node server/verifier/provisionImage.mjs --provision-approved` is an explicit administrative operation, not a runtime setup command. It rejects nonmatching manifests before building; it never pulls a base or substitutes npm. Context contains exactly package.json, package-lock.json, Dockerfile, approvedIdentity.mjs, bootstrap.mjs, snapshotInventory.mjs, capabilities.mjs and two empty npm configs. Additional files are trusted bootstrap/config, not repository source.

Network is used only for the approved base pull and administrative npm dependency download from the approved lock. Provisioning uses `npm ci --ignore-scripts --include=dev --include=optional --no-audit --no-fund`; no dependency lifecycle preparation was needed. The native checks run with build network disabled and were repeated in a read-only, non-root, NO_NETWORK administrative container. esbuild transform, Rollup native load, Tailwind Oxide scanner and Lightning CSS transform succeeded. Vitest, TypeScript, Vite and esbuild entrypoints exist. No project tests, typecheck or production build were run inside this image.

There is no signature, vulnerability-scan or complete supply-chain attestation claim. Lock integrity and a pinned digest provide identity, not a guarantee that dependency code is trustworthy.

## Fixed server-owned command profile

`resolveCommand` is a host-only helper accepting exactly `{profileId, commandId}` and server-owned image identity. The server selects command IDs; a future browser/task boundary may reference only the profile ID and must not call this helper directly. Unknown fields and IDs are rejected. Executable is always `/usr/local/bin/node`; cwd `/verify/workspace`. Commands are derived from baseline scripts:

| ID / kind | Fixed tool argv after Node |
|---|---|
| ui / test | `/opt/cc-verifier/deps/node_modules/vitest/vitest.mjs run` |
| typecheck / typecheck | `/opt/cc-verifier/deps/node_modules/typescript/bin/tsc --noEmit` |
| vite-build / build | `/opt/cc-verifier/deps/node_modules/vite/bin/vite.js build` |
| server-build / build | `/opt/cc-verifier/deps/node_modules/esbuild/bin/esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs` |

The two build commands preserve the baseline Vite-then-esbuild ordering and required success of both. No npm-run remains in the verifier command identity; host regression commands still use npm-run as explicitly requested. Repository configs/tests remain untrusted code even with fixed entrypoints. Exit 0 is not proof that tests were not weakened; changed tests/configs still need review.

Each immutable command records both approved manifest hashes, image digest, environment, 180 s timeout, stdout 1 MiB / stderr 256 KiB limits, 2 CPU / 2048 MiB RAM / 256 PID limits and 1 GiB working tmpfs. B2 will execute these sequentially in fresh containers and stop on the first non-PASS. This phase defines the contract only.

`verifierImageAllowlist` requires approved baseline/toolchain/provisioning fields, exact manifests, pinned reference, environment and entrypoint; the resulting alias is verifier-role-only. No browser/task supplies executable, args, cwd, env, image, mounts or shell.

## Sanitized snapshot and identity

`createSnapshot` requires a host checkpoint for the exact canonical source: agentStopped true and integrity VERIFIED. Those fields are host assertions, not proof by themselves. B2 must obtain them from its trusted stop/integrity controller, never browser/task input. No actual agent-stop controller or whole-host guard is implemented here.

Existing workspace gates run first: escaping/dangling symlinks, hard links, special nodes, filesystem boundaries and nested .git reject activation. The first snapshot profile is stricter: included source must contain ordinary directories/files only, so even internal source symlinks are rejected.

Excluded trees/files include `.git`, node_modules, dist/build/coverage, known caches/stores, .env and .env.*, .npmrc, provider/Docker/SSH/cloud credential directories, runtime data, local project config, .bridge, .superpowers, private key/certificate files and server-registered privatePaths. Excluded source is not read into the snapshot. Source limits are 50,000 entries, 8 MiB per file and 64 MiB total.

The destination is new, canonical, host-owned, mode 0700 and outside the source. File writes are stripped; executable source stays executable (0555 vs 0444). Hashing happens after the completed copy. Inventory includes sorted relative path, entry type, mode, size and SHA-256; its canonical serialization has its own SHA-256 fingerprint. B2 must mount this exact path read-only and recheck its fingerprint before execution.

Open-file no-follow/inode/device checks and detectable in-copy changes fail closed. This is not an atomic filesystem snapshot and does not defeat concurrent hostile host writers. Agent quiescence and the B2 integrity controller are prerequisites. The host owner can still modify its staging directory; no immutable-host-filesystem claim is made.

## Filesystem and trusted preparation

| Path | Policy |
|---|---|
| /workspace | sanitized host snapshot, read-only non-recursive bind |
| /opt/cc-verifier | immutable image bootstrap/config/dependencies |
| /verify | verifier-only private container tmpfs, `rw,exec,nosuid,nodev,size=1g` |
| /tmp | unchanged `rw,noexec,nosuid,nodev,size=64m` |

Agent/scratch cannot request /verify; verifier cannot request writable source, another mount, or a network other than NO_NETWORK. No writable host bind or persistent Docker volume is added. 1 GiB is an initial limit; larger projects must explicitly revise the profile.

Bootstrap has only `prepare <snapshot-fingerprint>` mode. It checks snapshot and manifest identity, copies source into /verify/workspace, verifies the copied source, grants owner write on that private copy, copies image dependencies into node_modules and creates /verify/tmp. Image dependency symlinks must remain inside the immutable dependency tree. Dependencies are copied instead of linking the entire tree because Vite/build tools may need writable caches. Source and host node_modules are never linked into the writable copy. No project command runner exists in this bootstrap.

## Environment and entrypoint

Command environment is exactly PATH `/usr/local/bin:/usr/bin:/bin`, HOME `/tmp`, TMPDIR `/verify/tmp`, CI `1`, NODE_ENV `test` for UI/typecheck or `production` for builds. Host process.env is not inherited. Credential/provider/cloud/npm/proxy overrides are not passed.

Final baked image environment is explicitly allowlisted: PATH above, NODE_VERSION `22.23.3`, YARN_VERSION `1.22.22`. These metadata values are checked rather than automatically trusted; the B2 child-command contract contains only the five command variables. Unexpected baked env or changed values reject the image before create.

Docker omits an empty image entrypoint from inspect, so the image uses explicit `[/usr/bin/env, --]`: it directly executes the server argv without a shell. Both image and container readback verify this exact entrypoint; missing is not accepted as empty.

## Strict readback for B2

Existing ID/labels, image, NO_NETWORK, non-root, privileges, limits and mount checks remain. Verifier readback additionally checks exact Cmd/Entrypoint, environment and complete /verify tmpfs options. Missing evidence -> POLICY_READBACK_INCOMPLETE; unsafe/different values -> POLICY_READBACK_MISMATCH.

Raw exit state requires explicit State.ExitCode, Running, Status, OOMKilled, StartedAt and FinishedAt plus the immutable ID. Missing OOMKilled cannot be converted to false for verifier execution. Final verifier state rechecks the entire policy; missing execution facts return UNKNOWN with no verified execution evidence. This phase does not produce command_result PASS; stdout never creates verification evidence.

## Validation and scope

- Local validation: focused **22/22**, full server **384/384** (including real synthetic Docker checks), UI **25/25**, lint PASS and build PASS. Independent read-only review: PASS, no actionable B1 findings.
- Focused behavioral tests cover dependency authority, context restriction, snapshot exclusions/identity/checkpoint, safe links, fixed commands/env, image env, verifier-only tmpfs and raw exit readback.
- Synthetic Docker proof copies only approved manifests plus a synthetic text file; it executes trusted preparation, never real Command Center tests/build/typecheck.
- Nine negative mutations were separately caught: changed lock, changed package.json, host node_modules mount, writable source, task argv, process.env inheritance, removed NO_NETWORK, weakened tmpfs, missing OOMKilled. Each safe source was restored.
- Requested host developer checks: lint, server tests, UI tests and build. These are local regression checks, not CI and not the B2 first real verifier run.
- Existing CJS import.meta build warning remains; server.ts was not changed, and starting the bundled server is outside scope.
- B2 still needs the execution runner, authoritative command-result semantics, whole workflow integrity checkpoints and bounded real-profile proof.
- No real Claude/Codex adapter invocation, provider inference, Run endpoint/button, governance changes, merge or deployment.
