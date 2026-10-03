import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SandboxBlockedError } from './pathSafety.mjs';
import { TEST_IMAGES, validateImageAllowlist } from './sandboxImages.mjs';
import { NETWORK_PROFILES, assertDockerArgs, buildCreateArgs, parseSandboxPolicy, sandboxName, validateCommand } from './sandboxPolicy.mjs';
import { inspectWorkspace } from './workspaceView.mjs';

/**
 * Provider-neutral Docker sandbox runtime (Phase 3B2).
 *
 *   probe() → prepare(spec) → start(id) → [observe] → stop(id) → destroy(id)
 *
 * The HOST keeps TaskStore, PolicyGate, worktree creation, Git, commit, push, PR, review decisions and
 * evidence grades. The container only ever sees one task worktree (plus a masked `.git`), no credentials,
 * no Docker socket, and only server-resolved environment values.
 *
 * Evidence: a sandbox_* record is LOCALLY_VERIFIED only when confirmed by `docker inspect` readback;
 * if only the Docker CLI said so, it is RUNTIME_OBSERVED. Container stdout is output, never evidence.
 */

export const SANDBOX_EVIDENCE_KINDS = Object.freeze(['sandbox_created', 'sandbox_started', 'sandbox_stopped', 'sandbox_destroyed', 'sandbox_policy']);
const SPEC_KEYS = ['sandboxId', 'role', 'worktreePath', 'policy', 'command'];

const evidence = (kind, grade, data) => ({ kind, grade, data, observedAt: new Date().toISOString() });

function parseJson(text) { try { return JSON.parse(text); } catch { return undefined; } }

export class DockerSandboxRuntime {
  #docker; #images; #stateRoot; #commandCenterRoot; #homeDir; #user; #stopGraceSec; #records = new Map();

  constructor({ docker, images = TEST_IMAGES, stateRoot, commandCenterRoot = process.cwd(), homeDir = os.homedir(), user, stopGraceSec = 2 }) {
    if (!docker || typeof docker.run !== 'function' || typeof docker.stream !== 'function') throw new Error('A docker client is required');
    this.#docker = docker;
    this.#images = validateImageAllowlist(images);
    this.#stateRoot = stateRoot ? fs.realpathSync(stateRoot) : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sandbox-state-')));
    fs.chmodSync(this.#stateRoot, 0o700);
    this.#commandCenterRoot = commandCenterRoot;
    this.#homeDir = homeDir;
    const uid = user?.uid ?? process.getuid?.(); const gid = user?.gid ?? process.getgid?.();
    if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid <= 0 || gid < 0) throw new Error('Sandbox user must be a non-root numeric uid:gid');
    this.#user = `${uid}:${gid}`;
    this.#stopGraceSec = stopGraceSec;
  }

  // ---- Docker readback helpers -------------------------------------------------------------------

  /** Returns { state: 'PRESENT'|'ABSENT'|'UNKNOWN', info?, detail? }. Ambiguity is never treated as absence. */
  async #readContainer(name) {
    const r = await this.#docker.run(['inspect', '--type=container', '--format={{json .}}', name]);
    if (r.spawnError || r.timedOut) return { state: 'UNKNOWN', detail: 'docker did not answer' };
    if (r.exitCode === 0) {
      const info = parseJson(r.stdout);
      return info && typeof info === 'object' ? { state: 'PRESENT', info } : { state: 'UNKNOWN', detail: 'unparseable inspect output' };
    }
    return /no such (object|container)/i.test(r.stderr) ? { state: 'ABSENT' } : { state: 'UNKNOWN', detail: r.stderr.trim().slice(0, 200) };
  }

  async #readImage(alias) {
    const entry = this.#images[alias];
    const r = await this.#docker.run(['image', 'inspect', '--format={{json .}}', entry.reference]);
    if (r.exitCode !== 0) return { present: false, reason: /no such image/i.test(r.stderr) ? 'IMAGE_UNAVAILABLE' : 'IMAGE_UNKNOWN' };
    const info = parseJson(r.stdout);
    if (!info) return { present: false, reason: 'IMAGE_UNKNOWN' };
    if (info.Os !== entry.os || info.Architecture !== entry.arch) return { present: false, reason: 'IMAGE_PLATFORM_MISMATCH', detail: `${info.Os}/${info.Architecture}` };
    if (!(Array.isArray(info.RepoDigests) && info.RepoDigests.includes(entry.reference)) && info.Id !== entry.digest) return { present: false, reason: 'IMAGE_DIGEST_MISMATCH' };
    const envKeys = (info.Config?.Env ?? []).map((e) => e.split('=')[0]);
    return { present: true, imageId: info.Id, digest: entry.digest, arch: info.Architecture, os: info.Os, variant: info.Variant ?? null, envKeys };
  }

  /** Compare what Docker actually created against what the policy intended. */
  #verify(info, plan, image) {
    const hc = info.HostConfig ?? {}; const cfg = info.Config ?? {};
    const failures = [];
    const check = (name, ok) => { if (!ok) failures.push(name); return ok; };
    const none = (v) => v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && Object.keys(v).length === 0) || v === '';
    const expectedNet = plan.policy.network === 'NO_NETWORK' ? ['none'] : ['bridge', 'default'];
    const checks = {
      networkMode: check('networkMode', expectedNet.includes(hc.NetworkMode)),
      notPrivileged: check('privileged', hc.Privileged === false),
      capDropAll: check('capDrop', Array.isArray(hc.CapDrop) && hc.CapDrop.includes('ALL')),
      noCapAdd: check('capAdd', none(hc.CapAdd)),
      noNewPrivileges: check('securityOpt', Array.isArray(hc.SecurityOpt) && hc.SecurityOpt.length === 1 && hc.SecurityOpt[0].startsWith('no-new-privileges')),
      readOnlyRoot: check('readonlyRootfs', hc.ReadonlyRootfs === true),
      noHostPid: check('pidMode', none(hc.PidMode)),
      privateIpc: check('ipcMode', hc.IpcMode === 'private'),
      noHostUserns: check('usernsMode', none(hc.UsernsMode)),
      noDevices: check('devices', none(hc.Devices) && none(hc.DeviceCgroupRules) && none(hc.DeviceRequests)),
      noPortsOrLinks: check('ports', none(hc.PortBindings) && none(hc.Links) && !hc.PublishAllPorts),
      noBindsViaLegacyVolumes: check('binds', none(hc.Binds) && none(hc.VolumesFrom)),
      memory: check('memory', hc.Memory === plan.policy.memoryMb * 1024 * 1024 && hc.MemorySwap === hc.Memory),
      cpus: check('nanoCpus', hc.NanoCpus === Math.round(plan.policy.cpus * 1e9)),
      pids: check('pidsLimit', hc.PidsLimit === plan.policy.pids),
      user: check('user', cfg.User === this.#user),
      workdir: check('workingDir', cfg.WorkingDir === '/workspace'),
      logDriver: check('logDriver', hc.LogConfig?.Type === 'none'),
      image: check('image', cfg.Image === plan.image.reference && info.Image === image.imageId),
      labels: check('labels', cfg.Labels?.['cc.sandbox'] === '1' && cfg.Labels?.['cc.sandbox.id'] === plan.sandboxId),
    };
    const mounts = [...(info.Mounts ?? [])].map((m) => ({ type: m.Type, source: m.Source, destination: m.Destination, rw: m.RW })).sort((a, b) => a.destination.localeCompare(b.destination));
    const expectedMounts = plan.mounts.map((m) => ({ type: 'bind', source: m.source, destination: m.destination, rw: m.rw })).sort((a, b) => a.destination.localeCompare(b.destination));
    checks.mounts = check('mounts', JSON.stringify(mounts) === JSON.stringify(expectedMounts));
    checks.noDockerSocket = check('dockerSocket', !/docker\.sock/.test(JSON.stringify({ mounts: info.Mounts, hc })));
    const tmpfs = Object.keys(hc.Tmpfs ?? {}).sort();
    checks.tmpfs = check('tmpfs', JSON.stringify(tmpfs) === JSON.stringify(plan.tmpfsPaths));
    const env = Object.fromEntries((cfg.Env ?? []).map((e) => { const i = e.indexOf('='); return [e.slice(0, i), e.slice(i + 1)]; }));
    const expectedEnv = plan.env;
    const extra = Object.keys(env).filter((k) => !(k in expectedEnv) && !image.envKeys.includes(k));
    checks.env = check('env', Object.entries(expectedEnv).every(([k, v]) => env[k] === v) && extra.length === 0);
    return { ok: failures.length === 0, failures, checks };
  }

  // ---- Public API -------------------------------------------------------------------------------

  /** Docker engine + allowlisted image availability. Never throws; unavailable means BLOCKED upstream. */
  async probe() {
    const base = { id: 'docker-sandbox', observedAt: new Date().toISOString() };
    const v = await this.#docker.run(['version', '--format={{json .Server}}']);
    if (v.spawnError || v.exitCode !== 0) return { ...base, available: false, reason: 'DOCKER_UNAVAILABLE' };
    const server = parseJson(v.stdout);
    if (!server?.Version) return { ...base, available: false, reason: 'DOCKER_UNAVAILABLE' };
    if (server.Os !== 'linux') return { ...base, available: false, reason: 'UNSUPPORTED_ENGINE', detail: `${server.Os}/${server.Arch}` };
    const images = {};
    for (const alias of Object.keys(this.#images)) images[alias] = await this.#readImage(alias);
    return {
      ...base,
      available: true,
      engine: { version: server.Version, os: server.Os, arch: server.Arch },
      images,
      capabilities: {
        networkProfiles: Object.keys(NETWORK_PROFILES),
        noNetworkEnforcedByDocker: true,
        providerNetworkRestrictsToProvider: false, // bridge network only; see sandboxPolicy.mjs
        readOnlyRoot: true, capDropAll: true, noNewPrivileges: true, dockerSocket: 'never mounted',
        resourceLimits: ['cpus', 'memory', 'pids', 'timeout', 'output'],
      },
    };
  }

  /** Validate everything, create (not start) the container, and verify it by inspect readback. */
  async prepare(spec) {
    let maskDir = null;
    const fail = async (error) => {
      if (maskDir) fs.rmSync(maskDir, { recursive: true, force: true });
      if (error instanceof SandboxBlockedError) return { state: 'BLOCKED', code: error.code, reason: error.message, evidence: [] };
      throw error;
    };
    try {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new SandboxBlockedError('INVALID_SPEC', 'Spec must be an object');
      const unknown = Object.keys(spec).filter((k) => !SPEC_KEYS.includes(k));
      if (unknown.length > 0) throw new SandboxBlockedError('INVALID_SPEC', `Unknown spec field(s): ${unknown.join(', ')}`);
      const policy = parseSandboxPolicy(spec.policy, { images: this.#images });
      const name = sandboxName(spec.role, spec.sandboxId);
      const command = validateCommand(spec.command);
      if (this.#records.has(spec.sandboxId) && this.#records.get(spec.sandboxId).state !== 'DESTROYED') throw new SandboxBlockedError('DUPLICATE_SANDBOX', 'A sandbox with this id already exists');
      const workspace = inspectWorkspace(spec.worktreePath, { commandCenterRoot: this.#commandCenterRoot, homeDir: this.#homeDir, stateRoot: this.#stateRoot });

      const image = await this.#readImage(policy.image);
      if (!image.present) throw new SandboxBlockedError(image.reason, `Image ${policy.image} is not usable (${image.reason}); images are never pulled automatically`);

      const existing = await this.#readContainer(name);
      if (existing.state === 'PRESENT') throw new SandboxBlockedError('CONTAINER_EXISTS', 'A container with this identity already exists; it is not deleted');
      if (existing.state === 'UNKNOWN') throw new SandboxBlockedError('AMBIGUOUS_DOCKER_STATE', `Cannot determine whether the container exists: ${existing.detail}`);

      const gitMask = workspace.gitKind === 'file' ? { kind: 'file', emptyFile: null } : workspace.gitKind === 'dir' ? { kind: 'dir' } : null;
      if (gitMask?.kind === 'file') {
        maskDir = path.join(this.#stateRoot, name);
        fs.mkdirSync(maskDir, { mode: 0o700 });
        gitMask.emptyFile = path.join(maskDir, 'empty');
        fs.writeFileSync(gitMask.emptyFile, '', { mode: 0o444 });
      }
      const imageEntry = this.#images[policy.image];
      const args = buildCreateArgs({ name, sandboxId: spec.sandboxId, role: spec.role, policy, image: imageEntry, workspacePath: workspace.root, gitMask, user: this.#user, command });
      const allowedBindSources = [workspace.root, ...(gitMask?.kind === 'file' ? [gitMask.emptyFile] : [])];
      assertDockerArgs(args, { image: imageEntry, allowedBindSources });

      const created = await this.#docker.run(args);
      if (created.spawnError || created.exitCode !== 0) {
        const again = await this.#readContainer(name); // a failed create must not leave something behind unnoticed
        if (again.state === 'PRESENT') await this.#docker.run(['rm', '-f', name]);
        throw new SandboxBlockedError('CREATE_FAILED', `docker create failed: ${created.stderr.trim().slice(0, 200)}`);
      }
      const plan = {
        sandboxId: spec.sandboxId, policy, image: imageEntry, maskDir,
        mounts: [{ source: workspace.root, destination: '/workspace', rw: policy.writablePaths.includes('/workspace') }, ...(gitMask?.kind === 'file' ? [{ source: gitMask.emptyFile, destination: '/workspace/.git', rw: false }] : [])],
        tmpfsPaths: [...(policy.writablePaths.includes('/tmp') ? ['/tmp'] : []), ...(gitMask?.kind === 'dir' ? ['/workspace/.git'] : [])].sort(),
        env: { ...{ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' }, ...policy.env },
      };
      const readback = await this.#readContainer(name);
      if (readback.state !== 'PRESENT') {
        throw new SandboxBlockedError('AMBIGUOUS_DOCKER_STATE', 'Created container could not be read back');
      }
      const verdict = this.#verify(readback.info, plan, image);
      if (!verdict.ok) {
        await this.#destroyOwned(name, spec.sandboxId); // our own just-created container
        throw new SandboxBlockedError('POLICY_READBACK_MISMATCH', `Docker did not create the intended configuration: ${verdict.failures.join(', ')}`);
      }
      const record = { sandboxId: spec.sandboxId, role: spec.role, name, containerId: readback.info.Id, plan, image, maskDir, state: 'PREPARED' };
      this.#records.set(spec.sandboxId, record);
      return {
        state: 'PREPARED', sandboxId: spec.sandboxId, name, containerId: record.containerId, network: policy.network, imageId: image.imageId,
        evidence: [
          evidence('sandbox_policy', 'LOCALLY_VERIFIED', { checks: verdict.checks, network: policy.network, mounts: plan.mounts, gitMask: gitMask?.kind ?? 'none', limits: { cpus: policy.cpus, memoryMb: policy.memoryMb, pids: policy.pids } }),
          evidence('sandbox_created', 'LOCALLY_VERIFIED', { name, containerId: record.containerId, imageId: image.imageId, imageDigest: image.digest, arch: image.arch }),
        ],
      };
    } catch (error) {
      return fail(error);
    }
  }

  /** Run the prepared container to completion (bounded). Never reports success on ambiguity. */
  async start(sandboxId, { onLine } = {}) {
    const record = this.#records.get(sandboxId);
    if (!record || record.state !== 'PREPARED') return { state: 'BLOCKED', code: 'INVALID_STATE', reason: 'Sandbox is not in PREPARED state', evidence: [] };
    const { name, plan, image } = record;
    // Re-verify immediately before starting: the container must still be exactly what we created.
    const before = await this.#readContainer(name);
    if (before.state !== 'PRESENT' || before.info.Id !== record.containerId || !this.#verify(before.info, plan, image).ok) {
      return { state: before.state === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED', code: 'CONTAINER_CHANGED', reason: 'Container no longer matches the verified configuration', evidence: [] };
    }
    record.state = 'STARTED';
    const lines = [];
    const handle = this.#docker.stream(['start', '-a', name], {
      timeoutMs: plan.policy.timeoutMs,
      limits: { maxStdoutBytes: plan.policy.outputBytes },
      onLine: (line) => { lines.push(line); onLine?.(line); },
    });
    const done = await handle.done;
    let outcome = null;
    let after = await this.#readContainer(name);
    if (done.terminateReason === 'timeout') outcome = 'TIMED_OUT';
    else if (done.limit) outcome = 'OUTPUT_LIMIT';
    if (after.state === 'PRESENT' && after.info.State?.Running) {
      const stopped = await this.stop(sandboxId);
      after = await this.#readContainer(name);
      if (stopped.state !== 'STOPPED') return { state: 'UNKNOWN', outcome: 'UNKNOWN', code: 'STOP_NOT_CONFIRMED', lines, evidence: [] };
    }
    if (after.state !== 'PRESENT' || !['exited', 'dead'].includes(after.info.State?.Status)) {
      record.state = 'UNKNOWN';
      return { state: 'UNKNOWN', outcome: 'UNKNOWN', code: 'AMBIGUOUS_DOCKER_STATE', lines, evidence: [] };
    }
    const st = after.info.State;
    record.state = 'EXITED';
    return {
      state: 'EXITED', outcome: outcome ?? 'FINISHED', exitCode: st.ExitCode, oomKilled: st.OOMKilled === true, lines,
      evidence: [evidence('sandbox_started', 'LOCALLY_VERIFIED', { containerId: record.containerId, startedAt: st.StartedAt, finishedAt: st.FinishedAt, exitCode: st.ExitCode, oomKilled: st.OOMKilled === true })],
    };
  }

  /** Normalized, authoritative view from `docker inspect`; UNKNOWN when Docker's answer is ambiguous. */
  async inspect(sandboxId) {
    const record = this.#records.get(sandboxId);
    if (!record) return { state: 'ABSENT', reason: 'NOT_TRACKED' };
    const r = await this.#readContainer(record.name);
    if (r.state === 'ABSENT') return { state: 'ABSENT' };
    if (r.state === 'UNKNOWN') return { state: 'UNKNOWN', reason: r.detail };
    const st = r.info.State ?? {};
    return { state: st.Running ? 'RUNNING' : (st.Status ?? 'UNKNOWN').toUpperCase(), exitCode: st.ExitCode, oomKilled: st.OOMKilled === true, networkMode: r.info.HostConfig?.NetworkMode, containerId: r.info.Id };
  }

  /** `docker stop` → bounded wait → `docker kill`. STOPPED only when readback confirms; otherwise UNKNOWN. */
  async stop(sandboxId) {
    const record = this.#records.get(sandboxId);
    if (!record) return { state: 'STOPPED', already: true, evidence: [] };
    const read = async () => this.#readContainer(record.name);
    let r = await read();
    if (r.state === 'ABSENT') return { state: 'STOPPED', already: true, evidence: [] };
    if (r.state === 'UNKNOWN') return { state: 'UNKNOWN', code: 'AMBIGUOUS_DOCKER_STATE', evidence: [] };
    if (r.info.State?.Running) {
      await this.#docker.run(['stop', `--time=${this.#stopGraceSec}`, record.name], { timeoutMs: (this.#stopGraceSec + 10) * 1000 });
      r = await read();
      if (r.state === 'PRESENT' && r.info.State?.Running) {
        await this.#docker.run(['kill', record.name], { timeoutMs: 10_000 });
        r = await read();
      }
    }
    if (r.state === 'PRESENT' && !r.info.State?.Running) {
      record.state = 'STOPPED';
      return { state: 'STOPPED', exitCode: r.info.State.ExitCode, evidence: [evidence('sandbox_stopped', 'LOCALLY_VERIFIED', { containerId: record.containerId, status: r.info.State.Status, exitCode: r.info.State.ExitCode })] };
    }
    record.state = 'UNKNOWN';
    return { state: 'UNKNOWN', code: 'STOP_NOT_CONFIRMED', evidence: [] };
  }

  async #destroyOwned(name, sandboxId) {
    await this.#docker.run(['rm', '--force', name], { timeoutMs: 20_000 });
    return this.#readContainer(name);
  }

  /** Idempotent. Only removes a container that carries OUR labels; anything else is BLOCKED and left alone. */
  async destroy(sandboxId) {
    const record = this.#records.get(sandboxId);
    if (!record) return { state: 'DESTROYED', already: true, evidence: [] };
    const r = await this.#readContainer(record.name);
    if (r.state === 'UNKNOWN') return { state: 'UNKNOWN', code: 'AMBIGUOUS_DOCKER_STATE', evidence: [] };
    if (r.state === 'PRESENT') {
      const labels = r.info.Config?.Labels ?? {};
      if (labels['cc.sandbox'] !== '1' || labels['cc.sandbox.id'] !== sandboxId || r.info.Id !== record.containerId) {
        return { state: 'BLOCKED', code: 'NOT_OWNED', reason: 'Container identity does not match; it is left untouched', evidence: [] };
      }
      const after = await this.#destroyOwned(record.name, sandboxId);
      if (after.state !== 'ABSENT') return { state: 'UNKNOWN', code: 'DESTROY_NOT_CONFIRMED', evidence: [] };
    }
    if (record.maskDir) fs.rmSync(record.maskDir, { recursive: true, force: true });
    record.state = 'DESTROYED';
    return { state: 'DESTROYED', already: r.state === 'ABSENT', evidence: [evidence('sandbox_destroyed', 'LOCALLY_VERIFIED', { name: record.name, containerId: record.containerId })] };
  }

  /** Remove the runtime's own state directory (after all sandboxes are destroyed). */
  dispose() { fs.rmSync(this.#stateRoot, { recursive: true, force: true }); }
}
