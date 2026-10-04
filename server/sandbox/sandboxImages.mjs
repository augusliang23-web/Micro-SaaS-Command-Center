// Server-side image allowlist. Tasks, browsers and policies name an ALIAS; they never
// supply an image reference. Each entry is pinned to an immutable digest.
//
// Recorded from `docker pull --platform linux/arm64 busybox:1.37.0` (approved) and
// `docker image inspect` on 2026-10-04: arch arm64/v8, os linux, 6141220 bytes.
// The only verification claimed is that the local image's digest and platform match
// these values at probe time; no signature or provenance check is performed.
export const TEST_IMAGES = Object.freeze({
  'busybox-test': Object.freeze({
    reference: 'busybox@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e',
    digest: 'sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e',
    os: 'linux',
    arch: 'arm64',
    note: 'Phase 3B2 scratch test image (busybox:1.37.0); not for agent or verifier use.',
  }),
});

export function validateImageAllowlist(images) {
  if (!images || typeof images !== 'object') throw new Error('Image allowlist must be an object');
  for (const [alias, entry] of Object.entries(images)) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(alias)) throw new Error(`Invalid image alias: ${alias}`);
    if (!/^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/.test(entry?.reference ?? '')) throw new Error(`Image ${alias} must be pinned by digest (no tags)`);
    if (entry.reference.split('@')[1] !== entry.digest) throw new Error(`Image ${alias} digest does not match its reference`);
    if (entry.os !== 'linux' || !['arm64', 'amd64'].includes(entry.arch)) throw new Error(`Image ${alias} has an unsupported platform`);
  }
  return images;
}
