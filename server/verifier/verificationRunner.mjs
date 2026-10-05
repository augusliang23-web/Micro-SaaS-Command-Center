import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DockerClient } from '../sandbox/dockerClient.mjs';
import { DockerSandboxRuntime } from '../sandbox/dockerSandboxRuntime.mjs';
import { TEST_IMAGES } from '../sandbox/sandboxImages.mjs';
import { createSnapshot, checkDependencyIdentity, fingerprintSnapshot, verifierImageAllowlist } from './foundation.mjs';
import { APPROVED } from './image/approvedIdentity.mjs';
import { COMMAND_CENTER_V1_PROFILE, RUNNER_INTERNAL_ERROR_EXIT, resolveProfileCommand } from './verificationProfile.mjs';
import { HostIntegrityGuard, gitMetadataPaths } from './hostIntegrity.mjs';

export { COMMAND_CENTER_V1_PROFILE };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const here = path.dirname(fileURLToPath(import.meta.url));
const runnerIdentity = JSON.parse(fs.readFileSync(path.join(here, 'verificationRunnerImageIdentity.json'), 'utf8'));
const evidence = (kind, data) => ({ kind, grade: data.grade ?? null, data, observedAt: new Date().toISOString() });
const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => expected.includes(k));
export function verifyRunnerSourceIdentity(identity = runnerIdentity) {
  const files = {
    runnerHash: path.join(here, 'image/runner.mjs'),
    profileHash: path.join(here, 'verificationProfile.mjs'),
    bootstrapHash: path.join(here, 'image/bootstrap.mjs'),
    snapshotInventoryHash: path.join(here, 'image/snapshotInventory.mjs'),
    approvedIdentityHash: path.join(here, 'image/approvedIdentity.mjs'),
    dockerfileHash: path.join(here, 'image/runner.Dockerfile'),
  };
  return Object.entries(files).every(([key, file]) => /^[0-9a-f]{64}$/.test(identity?.[key] ?? '') && sha(fs.readFileSync(file)) === identity[key]);
}
/** Process-local authority for Command Center managed source writers; no whole-host claim is made. */
export class ManagedWriterRegistry {
  #active = new Map();
  #leases = new Map();
  register(sourcePath, actorId) {
    if (typeof actorId !== 'string' || !actorId || actorId.includes('\0')) throw new Error('INVALID_WRITER_ID');
    const source = fs.realpathSync(sourcePath), key = `${source}\0${actorId}`;
    if (this.#leases.has(source)) throw new Error('SOURCE_QUIESCENCE_LEASED');
    if (this.#active.has(key)) throw new Error('WRITER_ALREADY_REGISTERED');
    this.#active.set(key, { sourcePath: source, actorId, startedAt: new Date().toISOString() });
    return () => this.#active.delete(key);
  }
  checkpoint(sourcePath) {
    const source = fs.realpathSync(sourcePath);
    return { authority: 'process-local-command-center-managed-writer-registry', sourcePath: source, activeManagedWriters: [...this.#active.values()].filter(writer => writer.sourcePath === source).map(({ actorId, startedAt }) => ({ actorId, startedAt })) };
  }
  acquireQuiescence(sourcePath) {
    const checkpoint = this.checkpoint(sourcePath), source = checkpoint.sourcePath;
    if (checkpoint.activeManagedWriters.length || this.#leases.has(source)) throw new Error('SOURCE_WRITER_ACTIVE');
    const token = crypto.randomUUID();
    this.#leases.set(source, token);
    let released = false;
    return { ...checkpoint, release: () => { if (!released && this.#leases.get(source) === token) this.#leases.delete(source); released = true; } };
  }
}
export const managedWriterRegistry = new ManagedWriterRegistry();

export function evaluateCommandEvidence(value) {
  const unknown = code => ({ state: 'UNKNOWN', grade: null, code });
  if (!value || !value.policyBefore?.ok || !value.policyAfter?.ok || !value.execution?.ok) return unknown('AUTHORITATIVE_READBACK_INCOMPLETE');
  if (value.hostIntegrity?.state !== 'UNCHANGED') return unknown('HOST_INTEGRITY_MISMATCH');
  if (value.timeout === 'UNKNOWN') return unknown('TIMEOUT_UNVERIFIED');
  if (value.timeout === true) return value.execution?.stopped === true && value.cleanup?.state === 'DESTROYED' && value.hostIntegrity?.state === 'UNCHANGED'
    ? { state: 'FAIL', grade: 'LOCALLY_VERIFIED', code: 'VERIFIED_TIMEOUT' } : unknown('TIMEOUT_UNVERIFIED');
  if (value.outputLimited !== false) return unknown('OUTPUT_LIMIT_OR_AMBIGUITY');
  if (value.execution.exitCode === RUNNER_INTERNAL_ERROR_EXIT) return unknown('TRUSTED_RUNNER_PREPARATION_FAILED');
  if (value.execution.oomKilled === true) return value.cleanup?.state === 'DESTROYED' ? { state: 'FAIL', grade: 'LOCALLY_VERIFIED', code: 'OOM_KILLED' } : unknown('CLEANUP_UNCONFIRMED');
  if (value.execution.oomKilled !== false || !Number.isInteger(value.execution.exitCode)) return unknown('EXECUTION_READBACK_INCOMPLETE');
  if (value.cleanup?.state !== 'DESTROYED') return unknown('CLEANUP_UNCONFIRMED');
  if (value.execution.exitCode !== 0) return { state: 'FAIL', grade: 'LOCALLY_VERIFIED', code: 'COMMAND_EXIT_NONZERO' };
  return { state: 'PASS', grade: 'LOCALLY_VERIFIED', code: null };
}

async function dockerInventory(docker) {
  const [containers, networks, volumes] = await Promise.all([
    docker.run(['ps', '-a', '--no-trunc', '--format={{.ID}}']),
    docker.run(['network', 'ls', '--no-trunc', '--format={{.ID}}']),
    docker.run(['volume', 'ls', '--format={{.Name}}']),
  ]);
  if ([containers, networks, volumes].some(result => result.exitCode !== 0 || result.spawnError || result.timedOut)) return null;
  return { containers: containers.stdout.trim().split('\n').filter(Boolean).sort(), networks: networks.stdout.trim().split('\n').filter(Boolean).sort(), volumes: volumes.stdout.trim().split('\n').filter(Boolean).sort() };
}

export class VerificationRunner {
  #sourcePath; #imageIdentity; #docker; #commandCenterRoot; #homeDir; #stateRoot; #privatePaths; #integrity; #recorder; #testExecute; #writers;
  constructor({ sourcePath = null, imageIdentity = null, docker = null, dockerPath = '/Applications/Docker.app/Contents/Resources/bin/docker', commandCenterRoot = process.cwd(), homeDir = os.homedir(), stateRoot = null, privatePaths = [], integrityGuard = null, recordEvidence = () => {}, execute = null, writerRegistry = managedWriterRegistry } = {}) {
    this.#sourcePath = sourcePath;
    this.#imageIdentity = imageIdentity;
    this.#commandCenterRoot = commandCenterRoot;
    this.#homeDir = homeDir;
    this.#privatePaths = privatePaths;
    this.#integrity = integrityGuard;
    this.#recorder = recordEvidence;
    this.#testExecute = execute;
    this.#writers = writerRegistry;
    this.#docker = docker ?? new DockerClient({ dockerPath, env: { HOME: homeDir } });
  }

  async run(options = {}) {
    if (!exactKeys(options, [])) throw new Error('Verification profile and command overrides are prohibited');
    if (this.#testExecute) {
      const commands = [];
      for (const commandId of COMMAND_CENTER_V1_PROFILE.commands.map(x => x.id)) {
        const result = await this.#testExecute(commandId);
        commands.push({ commandId, ...result });
        if (result?.state !== 'PASS') {
          for (const later of COMMAND_CENTER_V1_PROFILE.commands.slice(commands.length)) commands.push({ commandId: later.id, state: 'NOT_RUN', grade: null });
          return { profileId: COMMAND_CENTER_V1_PROFILE.id, version: COMMAND_CENTER_V1_PROFILE.version, state: result?.state === 'FAIL' ? 'FAIL' : 'UNKNOWN', commands };
        }
      }
      return { profileId: COMMAND_CENTER_V1_PROFILE.id, version: COMMAND_CENTER_V1_PROFILE.version, state: 'PASS', commands };
    }
    if (!this.#sourcePath || !this.#imageIdentity) throw new Error('Trusted source and pinned verifier identity are required');
    if (runnerIdentity.parentB1Digest !== this.#imageIdentity.digest || !/^sha256:[0-9a-f]{64}$/.test(runnerIdentity.digest ?? '') || runnerIdentity.reference !== `cc-verification-runner@${runnerIdentity.digest}` || !runnerIdentity.runnerHash || !runnerIdentity.profileHash || !runnerIdentity.bootstrapHash) throw new Error('RUNNER_IMAGE_IDENTITY_NOT_PROVISIONED');
    if (!verifyRunnerSourceIdentity()) return this.#blockedProfile('RUNNER_SOURCE_IDENTITY_MISMATCH');
    const canonicalSource = fs.realpathSync(this.#sourcePath);
    const manifest = checkDependencyIdentity(canonicalSource);
    if (manifest.state !== 'MATCH') return this.#blockedProfile('DEPENDENCY_PROFILE_MISMATCH', manifest);
    if (runnerIdentity.parentB1ImageId !== this.#imageIdentity.imageId || runnerIdentity.platform !== this.#imageIdentity.platform) throw new Error('RUNNER_PARENT_IMAGE_IDENTITY_MISMATCH');
    const identity = { ...this.#imageIdentity, ...runnerIdentity, baseline: this.#imageIdentity.baseline, baseReference: this.#imageIdentity.baseReference, platform: this.#imageIdentity.platform, node: this.#imageIdentity.node, npm: this.#imageIdentity.npm, packageJsonHash: this.#imageIdentity.packageJsonHash, packageLockHash: this.#imageIdentity.packageLockHash, provisioningPolicy: this.#imageIdentity.provisioningPolicy, bootstrapVersion: this.#imageIdentity.bootstrapVersion };
    const images = { ...TEST_IMAGES, ...verifierImageAllowlist(identity, { allowDerivedRunner: true }) };
    const stateRoot = this.#stateRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cc-verifier-state-'));
    fs.chmodSync(stateRoot, 0o700);
    let gitPaths;
    try { gitPaths = gitMetadataPaths(canonicalSource); }
    catch (error) { if (!this.#stateRoot) fs.rmSync(stateRoot, { recursive: true, force: true }); return this.#blockedProfile('GIT_METADATA_CHECKPOINT_UNKNOWN', { reason: error.code ?? error.message }); }
    const stagingRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-verifier-snapshot-')));
    fs.chmodSync(stagingRoot, 0o700);
    const snapshotPath = path.join(stagingRoot, 'snapshot');
    const canaryPath = path.join(stagingRoot, 'synthetic-canary.txt');
    fs.writeFileSync(canaryPath, `synthetic-host-canary:${crypto.randomUUID()}`, { mode: 0o600 });
    const controlPlaneRoot = fs.realpathSync(this.#commandCenterRoot);
    const protectedControlPlanePaths = controlPlaneRoot === canonicalSource ? [] : [controlPlaneRoot];
    const integrity = this.#integrity ?? new HostIntegrityGuard({ sourceRoot: canonicalSource, protectedPaths: [...gitPaths, canaryPath, ...protectedControlPlanePaths, ...this.#privatePaths.map(p => path.isAbsolute(p) ? p : path.join(controlPlaneRoot, p))] });
    const dockerBefore = await dockerInventory(this.#docker);
    if (!dockerBefore) { fs.rmSync(stagingRoot, { recursive: true, force: true }); if (!this.#stateRoot) fs.rmSync(stateRoot, { recursive: true, force: true }); return this.#blockedProfile('DOCKER_INVENTORY_UNKNOWN'); }
    let lease;
    try { lease = this.#writers.acquireQuiescence(canonicalSource); }
    catch { fs.rmSync(stagingRoot, { recursive: true, force: true }); if (!this.#stateRoot) fs.rmSync(stateRoot, { recursive: true, force: true }); return this.#blockedProfile('SOURCE_QUIESCENCE_UNKNOWN'); }
    const managedWriters = lease;
    let checkpoint;
    try { checkpoint = integrity.capture(); }
    catch (error) { lease.release(); fs.rmSync(stagingRoot, { recursive: true, force: true }); if (!this.#stateRoot) fs.rmSync(stateRoot, { recursive: true, force: true }); return this.#blockedProfile('HOST_CHECKPOINT_UNKNOWN', { reason: error.code ?? error.message }); }
    const sourceFingerprint = checkpoint.paths.find(p => p.path === canonicalSource)?.fingerprint;
    const hostCheckpoint = { sourcePath: canonicalSource, sourceFingerprint, agentStopped: true, integrity: 'VERIFIED', controllerVersion: checkpoint.controllerVersion, timestamp: checkpoint.capturedAt, registeredWritableActors: managedWriters.activeManagedWriters };
    let snapshot;
    try { snapshot = createSnapshot({ sourcePath: canonicalSource, destinationPath: snapshotPath, privatePaths: this.#privatePaths, commandCenterRoot: this.#commandCenterRoot, homeDir: this.#homeDir, stateRoot, checkpoint: hostCheckpoint }); }
    catch (error) { lease.release(); fs.rmSync(stagingRoot, { recursive: true, force: true }); if (!this.#stateRoot) fs.rmSync(stateRoot, { recursive: true, force: true }); return this.#blockedProfile(error.code ?? 'SNAPSHOT_BLOCKED'); }
    const runtime = new DockerSandboxRuntime({ docker: this.#docker, images, stateRoot, commandCenterRoot: this.#commandCenterRoot, homeDir: this.#homeDir });
    const verifierImage = images['command-center-verifier'];
    const results = [];
    let unknownContainer = false;
    try {
      for (const profileCommand of COMMAND_CENTER_V1_PROFILE.commands) {
        const hostBefore = integrity.compare(checkpoint);
        const currentSnapshot = fingerprintSnapshot(snapshot.path);
        if (hostBefore.state !== 'UNCHANGED' || currentSnapshot.fingerprint !== snapshot.fingerprint) {
          results.push({ commandId: profileCommand.id, state: 'UNKNOWN', code: hostBefore.state !== 'UNCHANGED' ? 'HOST_INTEGRITY_MISMATCH' : 'SNAPSHOT_MISMATCH' });
          this.#notRun(results, profileCommand.id);
          break;
        }
        const command = resolveProfileCommand(COMMAND_CENTER_V1_PROFILE.id, profileCommand.id);
        const argv = ['/usr/local/bin/node', '/opt/cc-verifier/runner.mjs', 'run', snapshot.fingerprint, COMMAND_CENTER_V1_PROFILE.id, profileCommand.id];
        const sandboxId = `VERIFY-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const prepared = await runtime.prepare({ sandboxId, role: 'verifier', worktreePath: snapshot.path, policy: { network: 'NO_NETWORK', image: 'command-center-verifier', env: { CI: '1', TMPDIR: '/verify/tmp', NODE_ENV: profileCommand.nodeEnv }, cpus: command.resourceLimits.cpus, memoryMb: command.resourceLimits.memoryMb, pids: command.resourceLimits.pids, timeoutMs: command.timeoutMs, outputBytes: command.outputLimits.stdoutBytes }, command: argv });
        if (prepared.state !== 'PREPARED') {
          results.push({ commandId: profileCommand.id, state: prepared.state === 'BLOCKED' ? 'UNKNOWN' : 'UNKNOWN', code: prepared.code ?? 'CONTAINER_PREPARATION_UNKNOWN' });
          unknownContainer ||= Boolean(prepared.containerId);
          this.#notRun(results, profileCommand.id);
          break;
        }
        unknownContainer = true;
        const policyBefore = prepared.evidence.find(item => item.kind === 'sandbox_policy')?.grade === 'LOCALLY_VERIFIED';
        const startedAt = new Date().toISOString();
        const execution = await runtime.start(sandboxId);
        const policyAfter = execution.policyReadback?.ok === true;
        const raw = execution.executionReadback;
        const cleanup = await runtime.destroy(sandboxId);
        unknownContainer = cleanup.state !== 'DESTROYED';
        const hostAfter = integrity.compare(checkpoint);
        const snapshotAfter = fingerprintSnapshot(snapshot.path);
        const integrityResult = hostAfter.state === 'UNCHANGED' && snapshotAfter.fingerprint === snapshot.fingerprint ? { state: 'UNCHANGED', before: hostBefore, after: hostAfter } : { state: 'MISMATCH' };
        const assessed = evaluateCommandEvidence({ policyBefore: { ok: policyBefore }, policyAfter: { ok: policyAfter }, execution: raw ? { ok: execution.executionReadbackCheck?.ok === true, exitCode: raw.ExitCode, oomKilled: raw.OOMKilled, stopped: raw.Running === false } : { ok: false }, timeout: execution.outcome === 'TIMED_OUT' ? true : execution.outcome === 'UNKNOWN' ? 'UNKNOWN' : false, outputLimited: execution.outcome === 'OUTPUT_LIMIT' ? true : execution.outcome === 'UNKNOWN' ? null : false, cleanup, hostIntegrity: integrityResult });
        const commandEvidence = { profileId: COMMAND_CENTER_V1_PROFILE.id, profileVersion: COMMAND_CENTER_V1_PROFILE.version, commandId: profileCommand.id, kind: profileCommand.kind, snapshotFingerprint: snapshot.fingerprint, manifestHashes: manifest, imageDigest: verifierImage.digest, containerId: prepared.containerId, requestedArgvIdentity: sha(JSON.stringify(argv)), requestedArgv: argv, requestStartedAt: startedAt, startedAt: raw?.StartedAt ?? null, endedAt: raw?.FinishedAt ?? new Date().toISOString(), execution: raw ?? null, rawDockerReadback: execution.containerReadback ?? null, timeout: execution.outcome, outputLimit: execution.outcome === 'OUTPUT_LIMIT', outputLimitKind: execution.outputLimitKind ?? null, networkMode: execution.containerReadback?.HostConfig?.NetworkMode ?? null, policyBefore: prepared.evidence, policyAfter: execution.policyReadback ?? null, hostIntegrity: integrityResult, cleanup, state: assessed.state, grade: assessed.grade ?? null, failureReason: assessed.code, diagnosticLines: execution.lines ?? [], diagnosticStderr: execution.stderr ?? '' };
        results.push({ commandId: profileCommand.id, state: assessed.state, grade: assessed.grade, evidence: commandEvidence });
        try { this.#recorder(evidence('verification_command', commandEvidence)); }
        catch (error) { commandEvidence.state = 'UNKNOWN'; commandEvidence.grade = null; commandEvidence.failureReason = 'EVIDENCE_PERSISTENCE_FAILED'; commandEvidence.persistenceError = error.code ?? error.message; results[results.length - 1] = { ...results[results.length - 1], state: 'UNKNOWN', grade: null, code: 'EVIDENCE_PERSISTENCE_FAILED' }; }
        const effectiveResult = results[results.length - 1];
        if (effectiveResult.state !== 'PASS') { this.#notRun(results, profileCommand.id); break; }
      }
      const dockerAfter = await dockerInventory(this.#docker);
      const finalIntegrity = integrity.compare(checkpoint);
      const finalCheck = { dockerInventoryAvailable: dockerAfter !== null, dockerInventoryUnchanged: Boolean(dockerAfter && JSON.stringify(dockerAfter) === JSON.stringify(dockerBefore)), hostIntegrity: finalIntegrity.state };
      const commandsPass = results.length === COMMAND_CENTER_V1_PROFILE.commands.length && results.every(item => item.state === 'PASS');
      // A command failure is authoritative only while final infrastructure trust is intact.
      let state = 'UNKNOWN';
      if (finalCheck.dockerInventoryAvailable && finalCheck.dockerInventoryUnchanged && finalIntegrity.state === 'UNCHANGED') {
        if (results.some(item => item.state === 'UNKNOWN')) state = 'UNKNOWN';
        else if (results.some(item => item.state === 'FAIL')) state = 'FAIL';
        else if (commandsPass) state = 'PASS';
      }
      const profileEvidence = evidence('verification_profile', { profileId: COMMAND_CENTER_V1_PROFILE.id, profileVersion: COMMAND_CENTER_V1_PROFILE.version, state, grade: state === 'PASS' ? 'LOCALLY_VERIFIED' : null, finalCheck, snapshotFingerprint: snapshot.fingerprint, manifestHashes: manifest, imageDigest: verifierImage.digest, commandIds: results.map(item => ({ commandId: item.commandId, state: item.state })) });
      try { this.#recorder(profileEvidence); }
      catch (error) { return { profileId: COMMAND_CENTER_V1_PROFILE.id, version: COMMAND_CENTER_V1_PROFILE.version, state: 'UNKNOWN', code: 'EVIDENCE_PERSISTENCE_FAILED', persistenceError: error.code ?? error.message, commands: results, snapshotFingerprint: snapshot.fingerprint, manifestIdentity: manifest, imageDigest: verifierImage.digest, profileEvidence: { ...profileEvidence, grade: null } }; }
      return { profileId: COMMAND_CENTER_V1_PROFILE.id, version: COMMAND_CENTER_V1_PROFILE.version, state, commands: results, snapshotFingerprint: snapshot.fingerprint, manifestIdentity: manifest, imageDigest: verifierImage.digest, profileEvidence, hostCheckpoint: { authority: managedWriters.authority ?? 'internal-controller', controllerVersion: checkpoint.controllerVersion, paths: checkpoint.paths.map(({ path: p, fingerprint }) => ({ path: p, fingerprint })) } };
    } finally {
      lease.release();
      if (!unknownContainer) {
        runtime.dispose();
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        if (!this.#stateRoot) fs.rmSync(stateRoot, { recursive: true, force: true });
      }
    }
  }

  #notRun(results, failedId) {
    const index = COMMAND_CENTER_V1_PROFILE.commands.findIndex(item => item.id === failedId);
    for (const item of COMMAND_CENTER_V1_PROFILE.commands.slice(index + 1)) results.push({ commandId: item.id, state: 'NOT_RUN', grade: null });
  }
  #blockedProfile(code, details = undefined) { return { profileId: COMMAND_CENTER_V1_PROFILE.id, version: COMMAND_CENTER_V1_PROFILE.version, state: 'UNKNOWN', code, details, commands: COMMAND_CENTER_V1_PROFILE.commands.map(({ id }) => ({ commandId: id, state: 'NOT_RUN', grade: null })) }; }
}
