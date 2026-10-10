import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';

import { DOCKER_BIN } from './helpers/dockerScratch.mjs';
import { DockerClient } from '../server/sandbox/dockerClient.mjs';
import { OwnedDocker } from './helpers/ownedDocker.mjs';
import {
  PINNED_REF, createHarness, adapterRealRun, endToEnd, fenceBeforeLaunch, issuedLaunchStop, unconfirmedStop, unconfirmedDestroy, rawReadbackReal, rawReadbackFaults,
} from './helpers/realDockerScenarios.mjs';
import { TEST_IMAGES } from '../server/sandbox/sandboxImages.mjs';

// Phase 3B7B2A — REAL local Docker, FAKE agent only. Closes three gaps left by the Phase 3B2 integration suite:
//   1. ContainerFakeAgentAdapter (role=agent, alias fake-agent-busybox) against the real daemon,
//   2. the cancellation launch fence against the real daemon,
//   3. raw agent-role execution readback from the real daemon (plus FAULT-INJECTED responses, clearly labelled).
//
// REVIEW GATE: this file must be reviewed by the Control Plane BEFORE it is executed against a daemon.
// Safety: every Docker call goes through OwnedDocker, an allow-list wrapper. Only the pinned local BusyBox digest is ever
// referenced; `create` is accepted only with --network=none, --pull=never and the cc.sandbox label; inspect/stop/kill/rm/start
// are limited to container ids THIS process created (or task-owned container names for the pre-create collision check).
// No `ps`, `images`, `pull`, `build`, `run`, `prune`, no PROVIDER_NETWORK, no credentials, no provider, no real agent.
// If Docker or the pinned image is absent, every test is reported SKIPPED (a skip is never a pass).

const mkInner = () => new DockerClient({ dockerPath: DOCKER_BIN });
let probe = { ok: false, reason: 'DOCKER_BINARY_MISSING' };
if (fs.existsSync(DOCKER_BIN)) {
  try {
    const owned = new OwnedDocker({ inner: mkInner(), imageRef: PINNED_REF });
    const v = await owned.run(['version', '--format={{json .Server}}']);
    const server = v.exitCode === 0 ? JSON.parse(v.stdout) : null;
    const img = server ? await owned.run(['image', 'inspect', '--format={{json .}}', PINNED_REF]) : null;
    const info = img?.exitCode === 0 ? JSON.parse(img.stdout) : null;
    const entry = TEST_IMAGES['busybox-test'];
    probe = server?.Os === 'linux' && info && info.Os === entry.os && info.Architecture === entry.arch && (info.RepoDigests ?? []).includes(entry.reference)
      ? { ok: true } : { ok: false, reason: server ? 'PINNED_IMAGE_MISSING_OR_MISMATCHED' : 'DOCKER_DAEMON_UNAVAILABLE' };
  } catch { probe = { ok: false, reason: 'DOCKER_PROBE_FAILED' }; }
}
const skip = probe.ok ? false : `real Docker not usable (${probe.reason}); NOT RUN`;

const harnesses = [];
const newHarness = () => { const h = createHarness({ inner: mkInner(), mode: 'real' }); harnesses.push(h); return h; };

/** Runs one scenario with its own harness; always attempts exact-id cleanup and requires every owned container confirmed absent. */
function scenario(name, fn, { timeout = 90_000 } = {}) {
  test(name, { skip, timeout }, async () => {
    const h = newHarness();
    let failure = null;
    try { await fn(h); } catch (error) { failure = error; }
    const leftovers = await h.dispose();
    if (failure) throw failure;
    assert.deepEqual(leftovers, [], `owned containers that could not be confirmed absent: ${leftovers}`);
  });
}

// ---- Gap 1: ContainerFakeAgentAdapter against the real daemon ---------------------------------------------------------------
scenario('[REAL] fake-agent adapter: identity, isolation, synthetic edit, complete evidence, confirmed cleanup', adapterRealRun);
scenario('[REAL] fake-agent end to end: container edit → host tree check → three approvals → local commit/push → fake PR', (h) => endToEnd(h), { timeout: 150_000 });

// ---- Gap 2: cancellation launch fence ---------------------------------------------------------------------------------------
scenario('[REAL] launch fence: stop confirmed while start() is paused before its launch → no docker start ever', (h) => fenceBeforeLaunch(h, 'stop'));
scenario('[REAL] launch fence: destroy confirmed while start() is paused before its launch → no docker start ever', (h) => fenceBeforeLaunch(h, 'destroy'));
scenario('[REAL] already-issued launch: bounded wait, stop confirmed by readback, nothing late-starts', issuedLaunchStop);
scenario('[FAULT-INJECTED stop/kill swallowed] a container that really keeps running is UNKNOWN, never stopped', unconfirmedStop);
scenario('[FAULT-INJECTED rm swallowed] a container that is really still present is UNKNOWN, never destroyed', unconfirmedDestroy);

// ---- Gap 3: raw execution readback --------------------------------------------------------------------------------------------
scenario('[REAL] agent-role raw execution readback: every field present, typed and mutually consistent', rawReadbackReal);
scenario('[REAL run + FAULT-INJECTED readback] each missing/mistyped/conflicting field → UNKNOWN, no success evidence', rawReadbackFaults, { timeout: 240_000 });
scenario('[REAL run + FAULT-INJECTED readback] end to end: UNKNOWN task, no commit, no Git approval consumed', (h) => endToEnd(h, { fault: true }), { timeout: 150_000 });

// ---- Final safety net: exact-id cleanup of anything this file created -------------------------------------------------------------
test('every container this file created is confirmed absent', { skip }, async () => {
  const leftovers = [];
  for (const h of harnesses) leftovers.push(...(await h.owned.cleanupAll()));
  assert.deepEqual(leftovers, []);
});
after(async () => { for (const h of harnesses) { try { await h.owned.cleanupAll(); } catch { /* reported by the test above */ } } });
