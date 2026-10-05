import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { COMMAND_CENTER_V1_PROFILE, evaluateCommandEvidence, ManagedWriterRegistry, VerificationRunner, verifyRunnerSourceIdentity } from '../server/verifier/verificationRunner.mjs';
import { FakeDocker } from './helpers/fakeDocker.mjs';
import { makeScratch } from './helpers/dockerScratch.mjs';

// Exercise the real controller and sandbox readback path; only Docker and the final
// host observation are simulated. No test-only execution shortcut is used here.
function controllerFixture(t, { exitCode = 1, finalHost = 'UNCHANGED', finalInventory = 'unchanged', recordEvidence } = {}) {
  const scratch = makeScratch();
  t.after(scratch.cleanup);
  for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.resolve(file), path.join(scratch.wt, file));
  const b1 = JSON.parse(fs.readFileSync(path.resolve('server/verifier/verifierImageIdentity.json'), 'utf8'));
  const image = JSON.parse(fs.readFileSync(path.resolve('server/verifier/verificationRunnerImageIdentity.json'), 'utf8'));
  const ok = stdout => ({ exitCode: 0, stdout, stderr: '', spawnError: null, timedOut: false });
  class VerifierDocker extends FakeDocker {
    inventoryReads = 0;
    async run(args) {
      if (args[0] === 'image') {
        this.calls.push([...args]);
        return ok(JSON.stringify({ Id: image.imageId, Os: 'linux', Architecture: 'arm64', RepoDigests: [image.reference], Config: { Env: Object.entries(image.expectedEnv).map(([k, v]) => `${k}=${v}`), Entrypoint: image.expectedEntrypoint } }));
      }
      if (args[0] === 'ps' || ['network', 'volume'].includes(args[0])) {
        this.calls.push([...args]);
        if (args[0] === 'ps' && ++this.inventoryReads === 2) {
          if (finalInventory === 'unavailable') return { ...ok(''), exitCode: 1 };
          if (finalInventory === 'changed') return ok('unexpected-container\n');
        }
        return ok('');
      }
      return super.run(args);
    }
  }
  const docker = new VerifierDocker();
  docker.scenario.exitCode = exitCode;
  docker.mutateInspect = info => {
    info.Image = image.imageId;
    info.Config.Entrypoint = image.expectedEntrypoint;
    const env = Object.fromEntries(info.Config.Env.map(entry => { const index = entry.indexOf('='); return [entry.slice(0, index), entry.slice(index + 1)]; }));
    info.Config.Env = Object.entries({ ...image.expectedEnv, ...env }).map(([k, v]) => `${k}=${v}`);
  };
  let hostReads = 0;
  const integrityGuard = {
    capture: () => ({ controllerVersion: 'synthetic-test-controller', capturedAt: new Date().toISOString(), paths: [{ path: scratch.wt, fingerprint: 'synthetic-source-identity' }] }),
    compare: () => ({ state: ++hostReads === 3 ? finalHost : 'UNCHANGED' }),
  };
  const runner = new VerificationRunner({ sourcePath: scratch.wt, imageIdentity: b1, docker, commandCenterRoot: scratch.src, integrityGuard, recordEvidence });
  return { runner, docker };
}

for (const scenario of [
  { name: 'host integrity MISMATCH', finalHost: 'MISMATCH', expected: 'UNKNOWN' },
  { name: 'host integrity UNKNOWN', finalHost: 'UNKNOWN', expected: 'UNKNOWN' },
  { name: 'Docker inventory changed', finalInventory: 'changed', expected: 'UNKNOWN' },
  { name: 'Docker inventory unavailable', finalInventory: 'unavailable', expected: 'UNKNOWN' },
  { name: 'trusted final infrastructure', expected: 'FAIL' },
]) {
  test(`command FAIL plus ${scenario.name} gives profile ${scenario.expected}`, async t => {
    const { runner, docker } = controllerFixture(t, scenario);
    const result = await runner.run();
    assert.equal(result.commands[0].state, 'FAIL', 'the command failure itself was authoritative');
    assert.equal(result.state, scenario.expected);
    assert.equal(result.profileEvidence.data.state, scenario.expected);
    assert.equal(docker.callsOf('start').length, 1);
    assert.equal(docker.containers.size, 0);
  });
}

test('first command evidence persistence failure stops before any later container is created or started', async t => {
  let commandRecords = 0;
  const { runner, docker } = controllerFixture(t, {
    exitCode: 0,
    recordEvidence: record => {
      if (record.kind === 'verification_command' && ++commandRecords === 1) throw new Error('synthetic persistence failure');
    },
  });
  const result = await runner.run();
  assert.equal(result.commands[0].evidence.execution.ExitCode, 0, 'UI executed successfully before persistence failed');
  assert.equal(docker.callsOf('start').length, 1, 'no later command/container may execute after persistence fails');
  assert.equal(docker.callsOf('create').length, 1, 'no later verifier container may be created');
  assert.deepEqual(result.commands.map(command => command.state), ['UNKNOWN', 'NOT_RUN', 'NOT_RUN', 'NOT_RUN']);
  assert.equal(result.commands[0].code, 'EVIDENCE_PERSISTENCE_FAILED');
  assert.equal(result.commands[0].grade, null);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(commandRecords, 1);
  assert.equal(docker.containers.size, 0);
});

test('profile is immutable, ordered, and shares exact command identities', () => {
  assert.deepEqual(COMMAND_CENTER_V1_PROFILE.commands.map(command => command.id), ['ui', 'typecheck', 'vite-build', 'server-build']);
  assert.equal(Object.isFrozen(COMMAND_CENTER_V1_PROFILE), true);
  assert.equal(COMMAND_CENTER_V1_PROFILE.commands.every(Object.isFrozen), true);
});

test('each command receives a fresh container identity after a fresh snapshot revalidation', () => {
  const source = fs.readFileSync(path.resolve('server/verifier/verificationRunner.mjs'), 'utf8');
  const loopStart = source.indexOf('for (const profileCommand of COMMAND_CENTER_V1_PROFILE.commands)');
  const loopEnd = source.indexOf('const dockerAfter = await dockerInventory', loopStart);
  assert.ok(loopStart >= 0 && loopEnd > loopStart);
  const loop = source.slice(loopStart, loopEnd);
  assert.match(loop, /const currentSnapshot = fingerprintSnapshot\(snapshot\.path\)/);
  assert.match(loop, /currentSnapshot\.fingerprint !== snapshot\.fingerprint/);
  assert.match(loop, /const sandboxId = `VERIFY-\$\{Date\.now\(\)\}-\$\{crypto\.randomBytes\(6\)\.toString\('hex'\)\}`/);
});

test('pinned runner identity binds the parent digest and current runner/profile/bootstrap bytes', () => {
  const root = path.resolve('server/verifier');
  const identity = JSON.parse(fs.readFileSync(path.join(root, 'verificationRunnerImageIdentity.json'), 'utf8'));
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(identity.parentB1Digest, 'sha256:619d2835a4ae8c361b7a64a17c3cd528b0d8b22d756545db288ece1f1e9374c8');
  assert.equal(identity.runnerHash, sha(path.join(root, 'image/runner.mjs')));
  assert.equal(identity.profileHash, sha(path.join(root, 'verificationProfile.mjs')));
  assert.equal(identity.bootstrapHash, sha(path.join(root, 'image/bootstrap.mjs')));
  assert.equal(identity.reference, `cc-verification-runner@${identity.digest}`);
  assert.equal(identity.platform, 'linux/arm64');
  assert.equal(verifyRunnerSourceIdentity(identity), true);
  assert.equal(verifyRunnerSourceIdentity({ ...identity, profileHash: '0'.repeat(64) }), false);
});

test('only complete raw readback plus trusted cleanup and intact host state can PASS', () => {
  const result = evaluateCommandEvidence({
    policyBefore: { ok: true }, policyAfter: { ok: true }, execution: { ok: true, exitCode: 0, oomKilled: false },
    hostIntegrity: { state: 'UNCHANGED' }, cleanup: { state: 'DESTROYED' }, timeout: false, outputLimited: false,
  });
  const trustedReadback = { policyBefore: { ok: true }, policyAfter: { ok: true }, execution: { ok: true, exitCode: 0, oomKilled: false }, hostIntegrity: { state: 'UNCHANGED' }, cleanup: { state: 'DESTROYED' }, timeout: false, outputLimited: false };
  assert.equal(result.state, 'PASS');
  assert.equal(result.grade, 'LOCALLY_VERIFIED');
  assert.equal(evaluateCommandEvidence({ ...result, execution: { ok: false, missing: ['State.OOMKilled'] } }).state, 'UNKNOWN');
  assert.equal(evaluateCommandEvidence({ ...trustedReadback, diagnosticLines: ['PASS'], execution: { ok: true, exitCode: 1, oomKilled: false } }).state, 'FAIL');
  assert.equal(evaluateCommandEvidence({ ...trustedReadback, diagnosticLines: ['PASS all tests passed'] }).state, 'PASS', 'diagnostic output does not affect the authoritative exit/readback');
  assert.equal(evaluateCommandEvidence({ ...trustedReadback, policyAfter: { ok: false } }).state, 'UNKNOWN');
  assert.equal(evaluateCommandEvidence({ ...trustedReadback, execution: { ok: true, exitCode: 0 } }).state, 'UNKNOWN', 'missing OOMKilled must remain unknown');
  assert.equal(evaluateCommandEvidence({ ...trustedReadback, timeout: true, execution: { ok: true, stopped: true, exitCode: 137, oomKilled: false } }).state, 'FAIL');
  assert.equal(evaluateCommandEvidence({ ...trustedReadback, timeout: true, execution: { ok: true, stopped: false, exitCode: 137, oomKilled: false } }).state, 'UNKNOWN');
  assert.equal(evaluateCommandEvidence({ policyBefore: { ok: true }, policyAfter: { ok: true }, execution: { ok: true, exitCode: 1, oomKilled: false }, hostIntegrity: { state: 'UNCHANGED' }, cleanup: { state: 'DESTROYED' }, timeout: false, outputLimited: false }).state, 'FAIL');
  assert.equal(evaluateCommandEvidence({ policyBefore: { ok: true }, policyAfter: { ok: false }, execution: { ok: true, exitCode: 1, oomKilled: false }, hostIntegrity: { state: 'UNCHANGED' }, cleanup: { state: 'DESTROYED' }, timeout: false, outputLimited: false }).state, 'UNKNOWN');
  assert.equal(evaluateCommandEvidence({ policyBefore: { ok: true }, policyAfter: { ok: true }, execution: { ok: true, exitCode: 0, oomKilled: false }, hostIntegrity: { state: 'MISMATCH' }, cleanup: { state: 'DESTROYED' }, timeout: false, outputLimited: false }).state, 'UNKNOWN');
  assert.equal(evaluateCommandEvidence({ policyBefore: { ok: true }, policyAfter: { ok: true }, execution: { ok: true, exitCode: 0, oomKilled: false }, hostIntegrity: { state: 'UNCHANGED' }, cleanup: { state: 'UNKNOWN' }, timeout: false, outputLimited: false }).state, 'UNKNOWN');
  assert.equal(evaluateCommandEvidence({ policyBefore: { ok: true }, policyAfter: { ok: true }, execution: { ok: true, exitCode: 0, oomKilled: false }, hostIntegrity: { state: 'UNCHANGED' }, cleanup: { state: 'DESTROYED' }, timeout: false, outputLimited: true }).state, 'UNKNOWN');
});

test('host integrity fingerprint reports bounded protected-path changes without reading secrets into evidence', async t => {
  const { HostIntegrityGuard } = await import('../server/verifier/hostIntegrity.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-host-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), canary = path.join(root, 'synthetic-canary');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'AGENTS.md'), 'synthetic-governance'); fs.writeFileSync(canary, 'synthetic-secret-canary');
  const guard = new HostIntegrityGuard({ sourceRoot: source, protectedPaths: [canary] });
  const before = guard.capture();
  assert.equal(guard.compare(before).state, 'UNCHANGED');
  fs.writeFileSync(canary, 'changed');
  const after = guard.compare(before);
  assert.equal(after.state, 'MISMATCH');
  assert.ok(after.before.every(item => !JSON.stringify(item).includes('synthetic-secret-canary')));
});

test('host integrity records absent registered paths and detects their later appearance', async t => {
  const { HostIntegrityGuard } = await import('../server/verifier/hostIntegrity.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-host-absence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  const guard = new HostIntegrityGuard({ sourceRoot: source, protectedPaths: ['projects.local.json'] });
  const before = guard.capture();
  assert.equal(before.paths.find(item => item.path.endsWith('projects.local.json')).state, 'ABSENT');
  fs.writeFileSync(path.join(source, 'projects.local.json'), '{}');
  assert.equal(guard.compare(before).state, 'MISMATCH');
});

test('profile stops at the first non-PASS and marks later commands NOT_RUN', async () => {
  const executed = [];
  const runner = new VerificationRunner({
    execute: async commandId => { executed.push(commandId); return { state: commandId === 'typecheck' ? 'FAIL' : 'PASS' }; },
  });
  const result = await runner.run();
  assert.deepEqual(executed, ['ui', 'typecheck']);
  assert.deepEqual(result.commands.map(x => x.state), ['PASS', 'FAIL', 'NOT_RUN', 'NOT_RUN']);
  assert.equal(result.state, 'FAIL');
});

test('verification runner rejects caller-supplied argv and source overrides', async () => {
  const runner = new VerificationRunner({ execute: async () => ({ state: 'PASS' }) });
  await assert.rejects(() => runner.run({ argv: ['sh', '-c', 'true'] }), /unknown|override|options/i);
});

test('writer checkpoint is scoped to registered managed writers for one canonical source', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-writer-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = new ManagedWriterRegistry();
  assert.deepEqual(registry.checkpoint(root).activeManagedWriters, []);
  const release = registry.register(root, 'synthetic-adapter-1');
  assert.equal(registry.checkpoint(root).activeManagedWriters.length, 1);
  release();
  assert.deepEqual(registry.checkpoint(root).activeManagedWriters, []);
  const lease = registry.acquireQuiescence(root);
  assert.throws(() => registry.register(root, 'racing-writer'), /leased/i);
  lease.release();
  assert.doesNotThrow(() => registry.register(root, 'after-checkpoint'));
});
