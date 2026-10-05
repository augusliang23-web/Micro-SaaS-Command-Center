import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { COMMAND_CENTER_V1_PROFILE, evaluateCommandEvidence, ManagedWriterRegistry, VerificationRunner, verifyRunnerSourceIdentity } from '../server/verifier/verificationRunner.mjs';

test('profile is immutable, ordered, and shares exact command identities', () => {
  assert.deepEqual(COMMAND_CENTER_V1_PROFILE.commands.map(command => command.id), ['ui', 'typecheck', 'vite-build', 'server-build']);
  assert.equal(Object.isFrozen(COMMAND_CENTER_V1_PROFILE), true);
  assert.equal(COMMAND_CENTER_V1_PROFILE.commands.every(Object.isFrozen), true);
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
