import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { PolicyError } from './helpers/ownedDocker.mjs';
import { createFixture } from './helpers/createArgsFixture.mjs';
import {
  DAMAGE, PINNED_REF, adapterRealRun, createHarness, endToEnd, fenceBeforeLaunch, issuedLaunchStop, rawReadbackFaults, rawReadbackReal, unconfirmedDestroy, unconfirmedStop,
} from './helpers/realDockerScenarios.mjs';
import { EffectDocker } from './helpers/dockerPathFixture.mjs';

// OFFLINE ONLY. This file never imports the real-Docker integration file and never contacts a daemon: it (1) unit-tests the
// OwnedDocker allow-list/fault wrapper, (2) dry-runs every real-Docker scenario against an in-memory fake Docker so the scenario
// code, the policy and the runtime/adapter call shapes are proven coherent BEFORE a daemon is involved, and (3) statically
// inspects the integration file for forbidden operations. Passing here is NOT evidence about a real daemon.

// Create-shape, ownership and cleanup contracts are covered exhaustively in agent-console-phase3b7b2-safety.test.mjs.

test('policy: every verb outside the allow-list is refused, including ps, images, pull, build, run, system and network', async () => {
  const { owned: d } = createFixture();
  for (const args of [['ps', '-a'], ['ps'], ['images'], ['images', '-q'], ['pull', PINNED_REF], ['build', '.'], ['run', '-d', PINNED_REF], ['system', 'prune', '-f'], ['network', 'ls'], ['volume', 'ls'],
    ['container', 'prune'], ['rename', 'a', 'b'], ['exec', 'x', 'sh'], ['cp', 'a', 'b'], ['logs', 'x'], ['info'], ['version'], ['version', '--format=a', 'b'], [], ['']]) {
    await assert.rejects(d.run(args), (e) => e instanceof PolicyError, JSON.stringify(args));
  }
  assert.throws(() => d.stream(['start', '-a', 'x']), PolicyError);
  assert.throws(() => d.stream(['run', 'x']), PolicyError);
  await assert.rejects(d.run([5]), PolicyError);
});

test('policy: image inspect is limited to the pinned digest', async () => {
  const { owned: d } = createFixture();
  await assert.rejects(d.run(['image', 'inspect', '--format={{json .}}', 'busybox:latest']), PolicyError);
  await assert.rejects(d.run(['image', 'inspect', '--format={{json .}}', `busybox@sha256:${'a'.repeat(64)}`]), PolicyError);
  await assert.rejects(d.run(['image', 'ls']), PolicyError);
  await d.run(['image', 'inspect', '--format={{json .}}', PINNED_REF]);
});

test('policy: stop, kill, rm and start act only on container ids this wrapper created', async () => {
  const fx = createFixture(); const d = fx.owned;
  const id = (await d.run(fx.args)).stdout.trim();
  const other = 'f'.repeat(64);
  for (const args of [['stop', '--time=2', other], ['kill', other], ['rm', '--force', other], ['rm', '--force', fx.name], ['stop', 'name']]) await assert.rejects(d.run(args), PolicyError, JSON.stringify(args));
  assert.throws(() => d.stream(['start', '-a', other]), PolicyError);
  assert.throws(() => d.stream(['start', id]), PolicyError);
  assert.throws(() => d.stream(['start', '-a', id, 'extra']), PolicyError);
  await d.run(['stop', '--time=2', id]);
  d.stream(['start', '-a', id], {});
  await assert.rejects(d.existence(other), PolicyError);
  await assert.rejects(d.forceRemove(other), PolicyError);
  assert.equal(await d.forceRemove(id), 'ABSENT');
  assert.deepEqual(await d.cleanupAll(), []);
});

test('observation, pause, fault injection and swallowing are separated and counted', async () => {
  const fx = createFixture(); const d = fx.owned;
  const id = (await d.run(fx.args)).stdout.trim();
  d.inner.containers.get(fx.name).started = true;
  const real = await d.run(['inspect', '--type=container', '--format={{json .}}', id]);
  assert.equal(d.observed.length, 1); assert.equal(d.faultsApplied, 0);
  assert.equal(JSON.parse(real.stdout).State.ExitCode, 0);
  // faults apply only to EXITED-state responses of owned containers, and are counted
  d.inner.containers.get(fx.name).running = false;
  d.inner.streams.push({ args: ['start', '-a', id] });
  d.faults = (st) => { delete st.OOMKilled; };
  const hurt = JSON.parse((await d.run(['inspect', '--type=container', '--format={{json .}}', id])).stdout);
  assert.equal(d.faultsApplied, 1); assert.equal('OOMKilled' in hurt.State, false);
  assert.equal(d.observed.at(-1).state.OOMKilled, false, 'the REAL observation was recorded before the injected change');
  assert.equal((await d.realState(id)).state.OOMKilled, false, 'test-side reads bypass faults');
  d.faults = null;
  // swallowing
  d.swallow = new Set(['rm']);
  await d.run(['rm', '--force', id]);
  assert.equal(d.swallowed, 1); assert.equal(await d.existence(id), 'PRESENT');
  d.swallow = new Set();
  assert.equal(await d.forceRemove(id), 'ABSENT');
  // pause: held after Docker answered, and release() is idempotent
  const id2 = (await d.run(fx.args.map((a) => a.split(fx.name).join(fx.name) ))).stdout.trim();
  const pause = d.armPause(2);
  let done = 0;
  const p = (async () => { await d.run(['inspect', '--type=container', '--format={{json .}}', id2]); done = 1; await d.run(['inspect', '--type=container', '--format={{json .}}', id2]); done = 2; })();
  await pause.reached;
  assert.equal(done, 1, 'the second inspect is held after Docker answered');
  pause.release(); pause.release(); await p;
  assert.equal(done, 2);
  assert.equal(pause.released, true);
  await d.cleanupAll();
});

// ---------- 2. dry runs of every scenario against the in-memory fake ----------

const dry = (name, fn) => test(`dry run (fake Docker, not a daemon): ${name}`, { timeout: 120_000 }, async () => {
  const h = createHarness({ inner: new EffectDocker(), mode: 'dry' });
  let failure = null;
  try { await fn(h); } catch (error) { failure = error; }
  const left = await h.dispose();
  if (failure) throw failure;
  assert.deepEqual(left, []);
  assert.equal(h.owned.calls.some((c) => ['ps', 'images', 'pull', 'build', 'run'].includes(c.verb)), false);
});

dry('adapter run: identity, isolation observations, synthetic edit, evidence, cleanup', adapterRealRun);
dry('end to end approved path', (h) => endToEnd(h));
dry('end to end with a corrupted readback: UNKNOWN, no approval consumed', (h) => endToEnd(h, { fault: true }));
dry('launch fence via stop', (h) => fenceBeforeLaunch(h, 'stop'));
dry('launch fence via destroy', (h) => fenceBeforeLaunch(h, 'destroy'));
dry('already-issued launch is stopped and confirmed', issuedLaunchStop);
dry('unconfirmed stop is UNKNOWN', unconfirmedStop);
dry('unconfirmed destroy is UNKNOWN', unconfirmedDestroy);
dry('raw readback fields', rawReadbackReal);
dry('raw readback fault matrix', rawReadbackFaults);

test('the fault matrix covers the corruptions the review named', () => {
  for (const k of ['OOMKilled missing', 'StartedAt missing', 'FinishedAt missing', 'ExitCode missing', 'OOMKilled wrong type', 'ExitCode wrong type', 'FinishedAt before StartedAt', 'Docker zero time', 'Running true after exit']) assert.ok(k in DAMAGE, k);
  assert.ok(Object.keys(DAMAGE).length >= 16);
});

// ---------- 3. static inspection of the real-Docker file and its helpers ----------

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const integration = read('./agent-console-phase3b7b2-docker.integration.test.mjs');
const scenarios = read('./helpers/realDockerScenarios.mjs');
const wrapper = read('./helpers/ownedDocker.mjs');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('inspection: the integration file and scenarios contain no forbidden Docker operation, network profile, credential or real agent', () => {
  const code = strip(integration) + strip(scenarios);
  for (const [re, what] of [
    [/PROVIDER_NETWORK/, 'provider network'], [/network:\s*'bridge'|--network=(?!none)/, 'non-none network'], [/'ps'|"ps"|\bdocker ps\b/, 'docker ps'], [/'images'|docker images/, 'docker images'],
    [/'pull'|docker pull/, 'pull'], [/'build'|docker build/, 'build'], [/prune/, 'prune'], [/'run'/, 'docker run'], [/system/i, 'docker system'],
    [/ANTHROPIC|OPENAI|OAUTH|API_KEY|_TOKEN|Keychain|keychain|credentials/i, 'credentials'], [/claude-code|codex|\bclaude\b/i, 'real agent'], [/fetch\(|https?:\/\/|net\.connect|dns\./, 'network access'],
    [/docker rm|docker stop|docker kill/, 'raw docker CLI strings'], [/child_process/, 'child_process'],
  ]) assert.ok(!re.test(code), `forbidden: ${what}`);
  assert.match(strip(scenarios), /network: 'NO_NETWORK'/);
  assert.ok([...code.matchAll(/docker\.sock/g)].every((m) => /includes\('docker\.sock'\)/.test(code.slice(Math.max(0, m.index - 30), m.index + 20))), 'docker.sock appears only inside an absence assertion');
  assert.ok(!/PROVIDER_NETWORK|bridge/.test(strip(wrapper)));
});

test('inspection: every test in the integration file is skipped when Docker or the pinned image is absent, and cleanup is guaranteed', () => {
  const tests = [...integration.matchAll(/^\s*(?:scenario|test)\(/gm)];
  assert.ok(tests.length >= 11);
  assert.match(integration, /const skip = probe\.ok \? false :/);
  assert.match(integration, /test\(name, \{ skip, timeout \}, async \(t\) => \{ await guard\.run\(newHarness\(\), fn, t\); \}\)/);
  assert.match(integration, /test\('every container this file created is confirmed absent', \{ skip \}/);
  assert.match(integration, /createSuiteGuard\(\)/);
  assert.match(integration, /mode: 'real'/);
  assert.match(integration, /after\(async/);
  assert.ok(!/mode: 'dry'/.test(integration));
  // every real container the scenarios create is also removed by exact id in a finally block
  assert.ok((scenarios.match(/closeOut\(h/g) ?? []).length >= 8, 'every scenario closes out through the exact-id sweep');
  assert.match(scenarios, /cleanupAll\(\)/);
  assert.match(scenarios, /pause\?\.release\(\);/, 'the paused inspect is released unconditionally');
  assert.ok((scenarios.match(/bounded\(/g) ?? []).length >= 12, 'asynchronous waits are bounded');
});

test('inspection: the wrapper restricts the daemon surface to a small verb allow-list', () => {
  const verbs = [...wrapper.matchAll(/verb === '([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(verbs)].sort(), ['create', 'image', 'inspect', 'kill', 'rm', 'stop', 'version']);
  assert.match(wrapper, /throw new PolicyError\(`docker verb not allowed/);
});
