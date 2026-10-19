import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SandboxBlockedError } from './pathSafety.mjs';
import { TEST_IMAGES, validateImageAllowlist } from './sandboxImages.mjs';
import { BASE_ENV, NETWORK_PROFILES, VERIFIER_TMPFS, assertDockerArgs, buildCreateArgs, parseSandboxPolicy, sandboxName, validateCommand } from './sandboxPolicy.mjs';
import { inspectWorkspace } from './workspaceView.mjs';
import { verifyContainerReadback, verifyExecutionReadback } from './readbackVerifier.mjs';

/**
 * Provider-neutral Docker sandbox runtime (Phase 3B2).
 *
 *   probe() → prepare(spec) → start(id) → [observe] → stop(id) → destroy(id)
 *
 * The HOST keeps TaskStore, PolicyGate, worktree creation, Git, commit, push, PR, review decisions and
 * evidence grades. The container only ever sees one task worktree (plus a masked `.git`), no credentials,
 * no Docker socket, and only server-resolved environment values.
 *
 * IDENTITY RULE. Once `docker create` returns a container ID, that immutable ID is the container's identity.
 * Names are used only for the pre-create collision check. Every state-changing operation (start, stop, kill, rm)
 * targets the exact tracked ID, and is preceded by an ownership check that requires ALL of:
 *   Id === tracked ID  +  cc.sandbox=1  +  cc.sandbox.id=<sandboxId>  +  cc.sandbox.role=<role>
 * If any fact disagrees the operation fails closed and the container is left untouched.
 *
 * TRACKING RULE. The record is created the moment Docker returns an ID (state CREATED_UNVERIFIED) and is never
 * dropped because a later readback fails. DESTROYED is reported only after Docker confirms the exact ID is absent.
 *
 * EVIDENCE RULE. A sandbox_* record is LOCALLY_VERIFIED only from authoritative `docker inspect` readback of the
 * exact tracked ID with every security-relevant field explicitly present and safe. Container stdout is output,
 * never evidence.
 */

export const SANDBOX_EVIDENCE_KINDS = Object.freeze(['sandbox_created', 'sandbox_started', 'sandbox_stopped', 'sandbox_destroyed', 'sandbox_policy']);
const SPEC_KEYS = ['sandboxId', 'role', 'worktreePath', 'policy', 'command'];
const CONTAINER_ID = /^[0-9a-f]{64}$/;
// Roles whose run result must be backed by COMPLETE raw execution facts (exit code, OOM flag, timestamps, identity).
// A missing field is never normalized into "false" or "success": it makes the run UNKNOWN.
const STRICT_EXECUTION_ROLES = Object.freeze(['verifier', 'agent']);

const evidence = (kind, grade, data) => ({ kind, grade, data, observedAt: new Date().toISOString() });
function parseJson(text) { try { return JSON.parse(text); } catch { return undefined; } }

export class DockerSandboxRuntime {
  #docker; #images; #stateRoot; #commandCenterRoot; #homeDir; #user; #stopGraceSec; #launchSettleMs; #launchPollMs; #lstat; #records = new Map();

  constructor({ docker, images = TEST_IMAGES, stateRoot, commandCenterRoot = process.cwd(), homeDir = os.homedir(), user, stopGraceSec = 2, launchSettleMs, lstat }) {
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
    this.#launchSettleMs = Number.isInteger(launchSettleMs) && launchSettleMs > 0 ? launchSettleMs : (stopGraceSec + 10) * 1000;
    this.#launchPollMs = Math.min(100, this.#launchSettleMs);
    this.#lstat = lstat; // test seam for the workspace scan only (server-side constructor option, never task input)
  }

  // ---- Docker readback helpers -------------------------------------------------------------------

  /** `ref` is a name (pre-create only) or an immutable container ID. Ambiguity is never treated as absence. */
  async #read(ref) {
    const r = await this.#docker.run(['inspect', '--type=container', '--format={{json .}}', ref]);
    if (r.spawnError || r.timedOut) return { state: 'UNKNOWN', detail: 'docker did not answer' };
    if (r.exitCode === 0) {
      const info = parseJson(r.stdout);
      return info && typeof info === 'object' && !Array.isArray(info) ? { state: 'PRESENT', info } : { state: 'UNKNOWN', detail: 'unparseable inspect output' };
    }
    return /no such (object|container)/i.test(r.stderr) ? { state: 'ABSENT' } : { state: 'UNKNOWN', detail: r.stderr.trim().slice(0, 200) };
  }

  /** Authoritative read of the exact tracked container by immutable ID. */
  #readTracked(record) {
    return record.containerId ? this.#read(record.containerId) : Promise.resolve({ state: 'UNKNOWN', detail: 'no container id is tracked' });
  }

  /** The one ownership check: ID + all three labels. A name never establishes ownership. */
  #owns(info, record) {
    const labels = info?.Config?.Labels;
    return !!record.containerId && info?.Id === record.containerId && !!labels && typeof labels === 'object'
      && labels['cc.sandbox'] === '1' && labels['cc.sandbox.id'] === record.sandboxId && labels['cc.sandbox.role'] === record.role;
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
    if (entry.expectedEnv) {
      const actual=info.Config?.Env;
      const expected=Object.entries(entry.expectedEnv).map(([k,v])=>`${k}=${v}`).sort();
      if(!Array.isArray(actual)||JSON.stringify([...actual].sort())!==JSON.stringify(expected)||!Object.hasOwn(info.Config,'Entrypoint')||JSON.stringify(info.Config.Entrypoint)!==JSON.stringify(entry.expectedEntrypoint)) return {present:false,reason:'IMAGE_ENV_MISMATCH'};
    }
    return { present: true, imageId: info.Id, digest: entry.digest, arch: info.Architecture, os: info.Os, variant: info.Variant ?? null, envKeys };
  }

  /** `rm --force` by exact ID, then authoritative readback by that ID. Returns 'ABSENT' | 'PRESENT' | 'UNKNOWN'. */
  async #removeById(containerId) {
    await this.#docker.run(['rm', '--force', containerId], { timeoutMs: 20_000 });
    return (await this.#read(containerId)).state;
  }

  #dropMask(record) { if (record.maskDir) fs.rmSync(record.maskDir, { recursive: true, force: true }); }

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
        hardLinkedFiles: 'blocked (fail closed)', containerIdentity: 'immutable id + ownership labels',
        resourceLimits: ['cpus', 'memory', 'pids', 'timeout', 'output'],
      },
    };
  }

  /** Validate everything, create (not start) the container, and verify it by strict inspect readback of its ID. */
  async prepare(spec) {
    let maskDir = null;
    let record = null;
    const failBeforeId = (error) => {
      if (maskDir) fs.rmSync(maskDir, { recursive: true, force: true });
      if (error instanceof SandboxBlockedError) return { state: 'BLOCKED', code: error.code, reason: error.message, evidence: [] };
      throw error;
    };
    try {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new SandboxBlockedError('INVALID_SPEC', 'Spec must be an object');
      const unknown = Object.keys(spec).filter((k) => !SPEC_KEYS.includes(k));
      if (unknown.length > 0) throw new SandboxBlockedError('INVALID_SPEC', `Unknown spec field(s): ${unknown.join(', ')}`);
      const policy = parseSandboxPolicy(spec.policy, { images: this.#images, role: spec.role });
      if(this.#images[policy.image].roles && !this.#images[policy.image].roles.includes(spec.role)) throw new SandboxBlockedError('IMAGE_NOT_ALLOWED','Image is not approved for this role');
      if(spec.role==='verifier' && !this.#images[policy.image].expectedEnv) throw new SandboxBlockedError('IMAGE_NOT_ALLOWED','Verifier image requires an explicit baked environment allowlist');
      const name = sandboxName(spec.role, spec.sandboxId);
      const command = validateCommand(spec.command);
      if (this.#records.has(spec.sandboxId) && this.#records.get(spec.sandboxId).state !== 'DESTROYED') throw new SandboxBlockedError('DUPLICATE_SANDBOX', 'A sandbox with this id already exists');
      const workspace = inspectWorkspace(spec.worktreePath, { commandCenterRoot: this.#commandCenterRoot, homeDir: this.#homeDir, stateRoot: this.#stateRoot, lstat: this.#lstat });

      const image = await this.#readImage(policy.image);
      if (!image.present) throw new SandboxBlockedError(image.reason, `Image ${policy.image} is not usable (${image.reason}); images are never pulled automatically`);

      const existing = await this.#read(name); // by NAME, only to detect a collision before create
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
      const containerId = created.stdout.trim();
      if (created.spawnError || created.exitCode !== 0 || !CONTAINER_ID.test(containerId)) {
        // No ID came back. Something may still have appeared under this name, but nothing proves it is ours
        // (names and labels can be set by anyone), so it is NEVER removed: left in place and reported.
        const again = await this.#read(name);
        if (again.state === 'ABSENT') throw new SandboxBlockedError('CREATE_FAILED', `docker create failed: ${created.stderr.trim().slice(0, 200)}`);
        if (maskDir) fs.rmSync(maskDir, { recursive: true, force: true });
        this.#records.set(spec.sandboxId, { sandboxId: spec.sandboxId, role: spec.role, name, containerId: null, state: 'UNKNOWN', note: 'CREATE_AMBIGUOUS' });
        return { state: 'BLOCKED', code: 'CREATE_AMBIGUOUS', reason: 'docker create did not confirm an identity but a container with this name now exists; it was left untouched', evidence: [] };
      }

      // The ID is ours (returned by our own create). Track it immediately, before any further readback can fail.
      const plan = {
        sandboxId: spec.sandboxId, role: spec.role, command, policy, image: imageEntry, maskDir, workspaceRoot: workspace.root, gitKind: workspace.gitKind,
        mounts: [{ source: workspace.root, destination: '/workspace', rw: policy.writablePaths.includes('/workspace') }, ...(gitMask?.kind === 'file' ? [{ source: gitMask.emptyFile, destination: '/workspace/.git', rw: false }] : [])],
        tmpfs: { ...(policy.writablePaths.includes('/tmp') ? { '/tmp': 'rw,noexec,nosuid,nodev,size=64m' } : {}), ...(spec.role==='verifier' ? {'/verify':VERIFIER_TMPFS}:{}), ...(gitMask?.kind === 'dir' ? { '/workspace/.git': 'ro,noexec,nosuid,nodev,size=1k' } : {}) },
        env: { ...BASE_ENV, ...policy.env },
      };
      record = { sandboxId: spec.sandboxId, role: spec.role, name, containerId, plan, image, maskDir, state: 'CREATED_UNVERIFIED' };
      this.#records.set(spec.sandboxId, record);
      maskDir = null; // from here the mask belongs to the record and is removed only by a confirmed destroy

      const readback = await this.#readTracked(record);
      if (readback.state !== 'PRESENT') {
        record.state = 'UNKNOWN';
        return { state: 'UNKNOWN', code: 'READBACK_UNCONFIRMED', reason: `Created container ${containerId.slice(0, 12)} could not be read back; it is tracked and left in place`, sandboxId: spec.sandboxId, containerId, evidence: [] };
      }
      if (!this.#owns(readback.info, record)) {
        record.state = 'UNKNOWN';
        return { state: 'BLOCKED', code: 'NOT_OWNED', reason: 'Created container identity or ownership labels do not match; left untouched', sandboxId: spec.sandboxId, containerId, evidence: [] };
      }
      const verdict = verifyContainerReadback(readback.info, { plan, image, user: this.#user });
      if (!verdict.ok) {
        // Identity is proven (id + labels), so this is our own container: remove it by ID and confirm.
        const gone = await this.#removeById(containerId);
        if (gone === 'ABSENT') { this.#dropMask(record); record.state = 'DESTROYED'; } else record.state = 'UNKNOWN';
        const incomplete = verdict.missing.length > 0;
        return {
          state: gone === 'ABSENT' ? 'BLOCKED' : 'UNKNOWN',
          code: incomplete ? 'POLICY_READBACK_INCOMPLETE' : 'POLICY_READBACK_MISMATCH',
          reason: `${incomplete ? 'Docker did not report' : 'Docker reported an unsafe value for'}: ${[...verdict.missing, ...verdict.failures].join(', ')}${gone === 'ABSENT' ? '' : ' (and removal could not be confirmed)'}`,
          sandboxId: spec.sandboxId, containerId, evidence: [],
        };
      }
      record.state = 'PREPARED';
      return {
        state: 'PREPARED', sandboxId: spec.sandboxId, name, containerId, network: policy.network, imageId: image.imageId,
        evidence: [
          evidence('sandbox_policy', 'LOCALLY_VERIFIED', { containerId, checks: verdict.checks, network: policy.network, mounts: plan.mounts, tmpfs: plan.tmpfs, gitMask: gitMask?.kind ?? 'none', limits: { cpus: policy.cpus, memoryMb: policy.memoryMb, pids: policy.pids } }),
          evidence('sandbox_created', 'LOCALLY_VERIFIED', { name, containerId, imageId: image.imageId, imageDigest: image.digest, arch: image.arch }),
        ],
      };
    } catch (error) {
      if (record) { record.state = 'UNKNOWN'; throw error; } // never lose a created container because of an exception
      return failBeforeId(error);
    }
  }

  /** Run the prepared container to completion (bounded). Never reports success on ambiguity. */
  async start(sandboxId, { onLine } = {}) {
    const record = this.#records.get(sandboxId);
    if (!record || record.state !== 'PREPARED') return { state: 'BLOCKED', code: 'INVALID_STATE', reason: 'Sandbox is not in PREPARED state', evidence: [] };
    const { plan, image } = record;
    // Re-check the host side (a file may have gained a hard link or a symlink since prepare)…
    try {
      inspectWorkspace(plan.workspaceRoot, { commandCenterRoot: this.#commandCenterRoot, homeDir: this.#homeDir, stateRoot: this.#stateRoot, lstat: this.#lstat });
    } catch (error) {
      if (error instanceof SandboxBlockedError) return { state: 'BLOCKED', code: error.code, reason: error.message, evidence: [] };
      throw error;
    }
    // …and re-verify the container: the exact tracked ID must still be ours and still match the policy.
    const before = await this.#readTracked(record);
    // LAUNCH FENCE. stop() and destroy() set `fenced` synchronously when they are called. Everything between the fence check below and the
    // `docker start` call is synchronous, so a stop that returned (or is in progress) before this point always wins and the
    // container is never launched afterwards. A stop that arrives later sees `record.launch` and waits for the launch to settle.
    if (before.state === 'UNKNOWN') return { state: 'UNKNOWN', code: 'AMBIGUOUS_DOCKER_STATE', evidence: [] };
    if (before.state === 'ABSENT' || !this.#owns(before.info, record) || !verifyContainerReadback(before.info, { plan, image, user: this.#user }).ok) {
      return { state: 'BLOCKED', code: 'CONTAINER_CHANGED', reason: 'Container no longer matches the verified identity and configuration', evidence: [] };
    }
    if (record.fenced) return { state: 'BLOCKED', code: 'CANCELLED_BEFORE_LAUNCH', reason: 'The sandbox was stopped before it was launched', evidence: [] };
    record.state = 'STARTED';
    const lines = [];
    const handle = this.#docker.stream(['start', '-a', record.containerId], {
      timeoutMs: plan.policy.timeoutMs,
      limits: { maxStdoutBytes: plan.policy.outputBytes },
      onLine: (line) => { lines.push(line); onLine?.(line); },
    });
    const launch = { settled: false, done: null };
    launch.done = Promise.resolve(handle.done).then(() => { launch.settled = true; }, () => { launch.settled = true; });
    record.launch = launch;
    const done = await handle.done;
    let outcome = null;
    let after = await this.#readTracked(record);
    if (done.terminateReason === 'timeout') outcome = 'TIMED_OUT';
    else if (done.limit) outcome = 'OUTPUT_LIMIT';
    if (after.state === 'PRESENT' && after.info.State?.Running) {
      const stopped = await this.stop(sandboxId);
      after = await this.#readTracked(record);
      if (stopped.state !== 'STOPPED') return { state: 'UNKNOWN', outcome: 'UNKNOWN', code: stopped.code ?? 'STOP_NOT_CONFIRMED', lines, evidence: [] };
    }
    if (after.state !== 'PRESENT' || !this.#owns(after.info, record) || !['exited', 'dead'].includes(after.info.State?.Status)) {
      record.state = 'UNKNOWN';
      return { state: 'UNKNOWN', outcome: 'UNKNOWN', code: 'AMBIGUOUS_DOCKER_STATE', lines, evidence: [] };
    }
    const st = after.info.State;
    const policyReadback = verifyContainerReadback(after.info,{plan,image,user:this.#user});
    const executionReadbackCheck = verifyExecutionReadback(after.info,{containerId:record.containerId});
    if(STRICT_EXECUTION_ROLES.includes(plan.role) && (!policyReadback.ok || !executionReadbackCheck.ok)) {
      record.state='UNKNOWN';return {state:'UNKNOWN',outcome:'UNKNOWN',code:'EXECUTION_READBACK_INCOMPLETE',lines,evidence:[]};
    }
    record.state = 'EXITED';
    return {
      state: 'EXITED', outcome: outcome ?? 'FINISHED', exitCode: st.ExitCode, oomKilled: st.OOMKilled === true, lines, stderr: done.stderr ?? '', outputLimitKind: done.limit ?? null,
      ...(STRICT_EXECUTION_ROLES.includes(plan.role) ? { executionReadback: structuredClone(st), executionReadbackCheck, policyReadback, containerReadback: structuredClone(after.info), containerId: record.containerId } : {}),
      evidence: [evidence('sandbox_started', 'LOCALLY_VERIFIED', { containerId: record.containerId, startedAt: st.StartedAt, finishedAt: st.FinishedAt, exitCode: st.ExitCode, oomKilled: st.OOMKilled === true })],
    };
  }

  async #settleOrWait(launch, ms) {
    let timer;
    try { await Promise.race([launch.done, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]); } finally { clearTimeout(timer); }
  }

  /** Normalized, authoritative view of the exact tracked ID; UNKNOWN when ambiguous or not provably ours. */
  async inspect(sandboxId) {
    const record = this.#records.get(sandboxId);
    if (!record) return { state: 'ABSENT', reason: 'NOT_TRACKED' };
    const r = await this.#readTracked(record);
    if (r.state === 'ABSENT') return { state: 'ABSENT' };
    if (r.state === 'UNKNOWN') return { state: 'UNKNOWN', reason: r.detail };
    if (!this.#owns(r.info, record)) return { state: 'UNKNOWN', reason: 'NOT_OWNED' };
    const st = r.info.State ?? {};
    if(STRICT_EXECUTION_ROLES.includes(record.plan?.role)) {
      const keys=['ExitCode','Running','Status','OOMKilled','StartedAt','FinishedAt'];
      const present=keys.every(k=>Object.hasOwn(st,k));
      const typed=Number.isInteger(st.ExitCode)&&typeof st.Running==='boolean'&&typeof st.OOMKilled==='boolean'&&typeof st.Status==='string'&&typeof st.StartedAt==='string'&&typeof st.FinishedAt==='string';
      if(!present || !typed || !verifyContainerReadback(r.info,{plan:record.plan,image:record.image,user:this.#user}).ok) return {state:'UNKNOWN',reason:'POLICY_OR_STATE_READBACK_INCOMPLETE'};
      if(st.Status==='exited' && !verifyExecutionReadback(r.info,{containerId:record.containerId}).ok) return {state:'UNKNOWN',reason:'EXECUTION_READBACK_INCOMPLETE'};
    }
    return { state: st.Running ? 'RUNNING' : (st.Status ?? 'UNKNOWN').toUpperCase(), exitCode: st.ExitCode, oomKilled: st.OOMKilled === true, networkMode: r.info.HostConfig?.NetworkMode, containerId: r.info.Id };
  }

  /** Verify identity → `docker stop <id>` → bounded wait → `docker kill <id>`. STOPPED only on readback of that ID. */
  async stop(sandboxId) {
    const record = this.#records.get(sandboxId);
    if (!record) return { state: 'STOPPED', already: true, evidence: [] };
    record.fenced = true; // synchronous: from this point this sandbox can never be launched by a start() that is still reading
    if (!record.containerId) return { state: 'UNKNOWN', code: 'NO_TRACKED_CONTAINER_ID', evidence: [] };
    let r = await this.#readTracked(record);
    if (r.state === 'ABSENT') return { state: 'STOPPED', already: true, evidence: [] };
    if (r.state === 'UNKNOWN') return { state: 'UNKNOWN', code: 'AMBIGUOUS_DOCKER_STATE', evidence: [] };
    if (!this.#owns(r.info, record)) return { state: 'BLOCKED', code: 'NOT_OWNED', reason: 'Container identity does not match; it is left untouched', evidence: [] };
    if (r.info.State?.Running) {
      await this.#docker.run(['stop', `--time=${this.#stopGraceSec}`, record.containerId], { timeoutMs: (this.#stopGraceSec + 10) * 1000 });
      r = await this.#readTracked(record);
      if (r.state === 'PRESENT' && this.#owns(r.info, record) && r.info.State?.Running) {
        await this.#docker.run(['kill', record.containerId], { timeoutMs: 10_000 });
        r = await this.#readTracked(record);
      }
    }
    // A `docker start` that was already issued may not have taken effect yet, so "not running" proves nothing until that
    // launch has finished. Poll the exact container (stopping it if a late launch brings it up) until the launch process
    // has exited, bounded; if it never settles the stop is UNKNOWN, not STOPPED.
    if (r.state === 'PRESENT' && this.#owns(r.info, record) && record.launch && !record.launch.settled) {
      const deadline = Date.now() + this.#launchSettleMs;
      while (!record.launch.settled && Date.now() < deadline) {
        await this.#settleOrWait(record.launch, Math.min(this.#launchPollMs, Math.max(1, deadline - Date.now())));
        const cur = await this.#readTracked(record);
        if (cur.state === 'PRESENT' && this.#owns(cur.info, record) && cur.info.State?.Running) {
          await this.#docker.run(['stop', `--time=${this.#stopGraceSec}`, record.containerId], { timeoutMs: (this.#stopGraceSec + 10) * 1000 });
          const after = await this.#readTracked(record);
          if (after.state === 'PRESENT' && this.#owns(after.info, record) && after.info.State?.Running) await this.#docker.run(['kill', record.containerId], { timeoutMs: 10_000 });
        }
      }
      if (!record.launch.settled) { record.state = 'UNKNOWN'; return { state: 'UNKNOWN', code: 'STOP_NOT_CONFIRMED', reason: 'The container launch has not finished; a stop cannot be confirmed', evidence: [] }; }
      r = await this.#readTracked(record);
    }
    if (r.state === 'PRESENT' && this.#owns(r.info, record) && r.info.State?.Running === false) {
      record.state = 'STOPPED';
      return { state: 'STOPPED', exitCode: r.info.State.ExitCode, evidence: [evidence('sandbox_stopped', 'LOCALLY_VERIFIED', { containerId: record.containerId, status: r.info.State.Status, exitCode: r.info.State.ExitCode })] };
    }
    record.state = 'UNKNOWN';
    return { state: 'UNKNOWN', code: 'STOP_NOT_CONFIRMED', evidence: [] };
  }

  /**
   * Idempotent. Removes only the exact tracked ID after the ownership check, and reports DESTROYED only after
   * Docker confirms that ID is absent. Anything unprovable is UNKNOWN/BLOCKED and the tracking record is kept.
   */
  async destroy(sandboxId) {
    const record = this.#records.get(sandboxId);
    if (!record) return { state: 'DESTROYED', already: true, evidence: [] };
    if (record.state === 'DESTROYED') return { state: 'DESTROYED', already: true, evidence: [] };
    record.fenced = true;
    if (!record.containerId) return { state: 'UNKNOWN', code: 'CREATE_AMBIGUOUS', reason: 'A container with this name may exist but its identity was never confirmed; it is left untouched', evidence: [] };
    const r = await this.#readTracked(record);
    if (r.state === 'UNKNOWN') return { state: 'UNKNOWN', code: 'AMBIGUOUS_DOCKER_STATE', evidence: [] };
    if (r.state === 'PRESENT') {
      if (!this.#owns(r.info, record)) return { state: 'BLOCKED', code: 'NOT_OWNED', reason: 'Container identity does not match; it is left untouched', evidence: [] };
      const after = await this.#removeById(record.containerId);
      if (after !== 'ABSENT') { record.state = 'UNKNOWN'; return { state: 'UNKNOWN', code: 'DESTROY_NOT_CONFIRMED', evidence: [] }; }
    }
    this.#dropMask(record);
    record.state = 'DESTROYED';
    return { state: 'DESTROYED', already: r.state === 'ABSENT', evidence: [evidence('sandbox_destroyed', 'LOCALLY_VERIFIED', { name: record.name, containerId: record.containerId })] };
  }

  /** Remove the runtime's own state directory (after all sandboxes are destroyed). */
  dispose() { fs.rmSync(this.#stateRoot, { recursive: true, force: true }); }
}
