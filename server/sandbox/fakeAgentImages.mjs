import { TEST_IMAGES, validateImageAllowlist } from './sandboxImages.mjs';

// Phase 3B7B1: image allowlist for the FAKE container agent only.
//
// This is the existing digest-pinned busybox test image (same digest and platform as TEST_IMAGES) exposed under a
// separate alias that is approved for the `agent` role and nothing else. No image is pulled, built or downloaded by
// this module; the runtime still verifies the local image digest and platform at probe/prepare time and never
// pulls (`--pull=never`). A real Claude Code or Codex image is NOT allowlisted here (REAL_AGENT_EXECUTION stays
// NOT_AUTHORIZED); adding one needs its own reviewed phase.
const base = TEST_IMAGES['busybox-test'];

export const FAKE_AGENT_IMAGE_ALIAS = 'fake-agent-busybox';

export const FAKE_AGENT_IMAGES = validateImageAllowlist(Object.freeze({
  [FAKE_AGENT_IMAGE_ALIAS]: Object.freeze({
    reference: base.reference,
    digest: base.digest,
    os: base.os,
    arch: base.arch,
    roles: Object.freeze(['agent']),
    note: 'Phase 3B7B1 fake container agent (busybox 1.37.0). Scripted shell only; no AI, no credentials, no network.',
  }),
}));
