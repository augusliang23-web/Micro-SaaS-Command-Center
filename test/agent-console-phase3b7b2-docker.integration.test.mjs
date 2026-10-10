import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';

import { DOCKER_BIN } from './helpers/dockerScratch.mjs';
import { DockerClient } from '../server/sandbox/dockerClient.mjs';
import { preflight } from './helpers/dockerPreflight.mjs';
import {
  PINNED_REF, createHarness, createSuiteGuard, adapterRealRun, endToEnd, fenceBeforeLaunch, issuedLaunchStop, unconfirmedStop, unconfirmedDestroy, rawReadbackReal, rawReadbackFaults,
} from './helpers/realDockerScenarios.mjs';

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
// Read-only preflight (version + image inspect only). Expected unavailability => skip with a visible reason; a programming error is NOT swallowed.
const probe = fs.existsSync(DOCKER_BIN) ? await preflight({ inner: mkInner(), imageRef: PINNED_REF }) : { ok: false, reason: 'DOCKER_BINARY_MISSING' };
const skip = probe.ok ? false : `real Docker not usable (${probe.reason}); NOT RUN`;

const harnesses = [];
const guard = createSuiteGuard();
const newHarness = () => { const h = createHarness({ inner: mkInner(), mode: 'real' }); harnesses.push(h); return h; };

/**
 * Runs one scenario with its own harness. Exact-id cleanup of every owned container is always attempted; local state is deleted only
 * when absence is proven. After an UNKNOWN outcome, a timeout or an unconfirmed cleanup the suite HALTS: later scenarios are reported
 * skipped and are never run against a daemon that may still hold an owned container.
 */
function scenario(name, fn, { timeout = 90_000 } = {}) {
  test(name, { skip, timeout }, async (t) => { await guard.run(newHarness(), fn, t); });
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
