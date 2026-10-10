import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OwnedDocker } from './ownedDocker.mjs';
import { TEST_IMAGES } from '../../server/sandbox/sandboxImages.mjs';

/**
 * Read-only preflight for the real-Docker integration file. It issues exactly two allow-listed, non-mutating Docker calls
 * (`version` and `image inspect` of the pinned digest) through the SAME OwnedDocker wrapper the tests use, and never creates,
 * starts or removes a container.
 *
 * Classification:
 *   - { ok: true }                         the daemon is a Linux engine and the pinned image matches the allowlist digest and platform;
 *   - { ok: false, reason }                an EXPECTED unavailability (no daemon, no image, mismatched image, unparseable Docker output) -> the suite is SKIPPED;
 *   - throws                               anything else (a programming error such as a bad OwnedDocker construction, a policy violation, a
 *                                          broken client) is NEVER converted into "unavailable": it fails the file loudly.
 */
export async function preflight({ inner, imageRef, stateRoot } = {}) {
  const temp = stateRoot ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p3b7b2-preflight-'));
  try {
    const owned = new OwnedDocker({ inner, imageRef, stateRoot: stateRoot ?? temp }); // constructor/programming errors propagate
    const entry = TEST_IMAGES['busybox-test'];
    const v = await owned.run(['version', '--format={{json .Server}}']);
    if (v.spawnError || v.timedOut || v.exitCode !== 0) return { ok: false, reason: 'DOCKER_DAEMON_UNAVAILABLE', calls: owned.calls };
    let server;
    try { server = JSON.parse(v.stdout); } catch { return { ok: false, reason: 'DOCKER_VERSION_OUTPUT_UNPARSEABLE', calls: owned.calls }; }
    if (server?.Os !== 'linux') return { ok: false, reason: 'DOCKER_ENGINE_NOT_LINUX', calls: owned.calls };
    const img = await owned.run(['image', 'inspect', '--format={{json .}}', imageRef]);
    if (img.spawnError || img.timedOut || img.exitCode !== 0) return { ok: false, reason: 'PINNED_IMAGE_MISSING', calls: owned.calls };
    let info;
    try { info = JSON.parse(img.stdout); } catch { return { ok: false, reason: 'IMAGE_OUTPUT_UNPARSEABLE', calls: owned.calls }; }
    if (info?.Os !== entry.os || info?.Architecture !== entry.arch || !(info?.RepoDigests ?? []).includes(entry.reference)) return { ok: false, reason: 'PINNED_IMAGE_MISMATCHED', calls: owned.calls };
    return { ok: true, calls: owned.calls };
  } finally { if (temp) fs.rmSync(temp, { recursive: true, force: true }); }
}
