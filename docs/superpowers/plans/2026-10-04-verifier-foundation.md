# Verifier Foundation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; one independent whole-branch review at the end.

**Goal:** Provide a pinned Linux ARM64 verifier image, immutable command profiles, sanitized snapshot, and verifier-only filesystem/readback foundation. No verification runner or activation.
**Architecture:** Read-only sanitized source bind; image-owned dependencies copied into private executable /verify tmpfs; explicit environment and raw execution readback.
**Tech Stack:** Node ESM, Node test runner, Docker Desktop/BuildKit.
**Spec:** User-approved Phase 3B3B1 prompt; frozen copy in current task attachment.

## Global Constraints
- Baseline 19c23961af9b0f24b22d23a883def6c060db09e9. Preserve dirty checkout and governance.
- Pull only node:22.23.3-bookworm-slim linux/arm64; bundled npm 10.9.9, no npm replacement.
- Provision only approved manifests with ignore-scripts; capability checks are administrative, not project validation.
- Verifier NO_NETWORK, read-only /workspace, /verify rw,exec,nosuid,nodev,size=1g; /tmp unchanged.
- Host regression checks permitted; real verifier project checks deferred to B2.

## Review Focus
- Snapshot races, hostile names, symlink/hardlink/special-file boundaries, excluded private trees.
- Mutable package manifests or task argv cannot select dependencies/commands.
- Image/environment/entrypoint identity and incomplete Docker state must fail closed.
- Executable tmpfs must be verifier-only and source mount must remain read-only.
- No extra build context, automatic image pull/install, provider activity, or orchestration wiring.

## Task 1: Snapshot and profile contracts
- [x] Write failing behavioral tests for manifest authority, source exclusions/gates, completed-copy hash, fixed commands and environment.
- [x] Implement snapshot/identity/profile modules and run focused tests.

## Task 2: Runtime extension
- [x] Write failing verifier-role policy/readback tests.
- [x] Extend exact argv, image env checks and raw exit-state verification; preserve existing roles.

## Task 3: Image/bootstrap
- [x] Test bootstrap on synthetic fixtures before implementation.
- [x] Restrict provisioning context; build from observed base digest; run offline native capability checks.
- [x] Record observed final identity; synthetic Docker filesystem proof only.

## Task 4: Completion
- [x] Run nine temporary negative mutations; restore safe files after each.
- [x] Run host lint/server/UI/build; inspect image/container inventory.
- [x] Independent whole-branch review; fix blocking issues, recheck; commit/push/open unmerged PR is the final integration step.

Pre-flight: Task 1 hashes/profile identity feed Task 3 image provenance; Task 2 image env contract is consumed by Task 3. Final identity is administrative recorded output, not agent input. No shared-interface contradictions.
