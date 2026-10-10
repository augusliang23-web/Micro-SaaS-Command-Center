/**
 * Phase 3B7B2A test-only Docker client wrapper. It sits between DockerSandboxRuntime and a Docker client (the real
 * DockerClient in the integration run, an in-memory fake in the offline dry run) and adds:
 *
 *  - an ALLOW-LIST POLICY that refuses anything a gap test must never do: no `ps`/`images`/`pull`/`build`/`prune`/`run`,
 *    no inspect of anything but the pinned image, containers THIS wrapper created, or task-owned container names, and
 *    no stop/kill/rm/start of anything but container ids THIS wrapper created. `create` is accepted only with
 *    `--network=none`, `--pull=never`, the cc.sandbox label and the pinned image.
 *  - OBSERVATION of the real inspect responses (a small, sanitized subset) so tests can assert on what Docker reported.
 *  - an optional PAUSE of the nth inspect-by-id response (to hold `start()` just before its launch), and
 *  - optional FAULT INJECTION (`faults`, `swallow`) which is clearly separated from observations: every injected change
 *    is counted in `faultsApplied` / `swallowed` so a test can prove its fault actually happened.
 */
const HEX64 = /^[0-9a-f]{64}$/;
const OWNED_NAME = [/^cc-sandbox-agent-run-\d{8}-[0-9a-f]{8}$/, /^cc-sandbox-agent-p3b7b2-[a-z0-9-]+$/];
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', spawnError: null, timedOut: false });

export class PolicyError extends Error { constructor(message) { super(`OwnedDocker policy: ${message}`); this.name = 'PolicyError'; this.code = 'OWNED_DOCKER_POLICY'; } }

export class OwnedDocker {
  inner; imageRef;
  calls = []; // { verb, target, injected } — never full argv, never environment
  owned = new Set(); // container ids created through this wrapper
  ownedNames = new Set();
  observed = []; // real inspect responses (sanitized subset) of owned containers
  faults = null; // (info) => void: applied to the EXITED-state inspect response of an owned container
  faultsApplied = 0;
  swallow = new Set(); // verbs ('stop' | 'kill' | 'rm') acknowledged without reaching Docker (fault injection)
  swallowed = 0;
  #pause = null; #idInspects = 0;

  constructor({ inner, imageRef }) {
    if (!inner || typeof inner.run !== 'function' || typeof inner.stream !== 'function') throw new Error('An inner docker client is required');
    if (!/^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/.test(imageRef ?? '')) throw new Error('The pinned image reference is required');
    this.inner = inner; this.imageRef = imageRef;
  }

  /** Pause the nth inspect-by-id response (counted from now) AFTER Docker answered, until `release()` is called. */
  armPause(nth) {
    let release; const gate = new Promise((r) => { release = r; });
    let reached; const reachedPromise = new Promise((r) => { reached = r; });
    this.#idInspects = 0;
    this.#pause = { nth, gate, reached };
    return { release, reached: reachedPromise };
  }

  #isOwnedRef(ref) { return this.owned.has(ref) || this.ownedNames.has(ref) || OWNED_NAME.some((re) => re.test(ref)); }
  #record(verb, target, injected = false) { this.calls.push({ verb, target: target ? String(target).slice(0, 12) : null, injected }); }
  count(verb, { injected } = {}) { return this.calls.filter((c) => c.verb === verb && (injected === undefined || c.injected === injected)).length; }

  async run(args, opts) {
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw new PolicyError('arguments must be strings');
    const verb = args[0];
    const last = args.at(-1);
    if (verb === 'version') {
      if (args.length !== 2 || !args[1].startsWith('--format=')) throw new PolicyError('version must use --format only');
      this.#record('version'); return this.inner.run(args, opts);
    }
    if (verb === 'image') {
      if (args[1] !== 'inspect' || last !== this.imageRef) throw new PolicyError('only `image inspect` of the pinned image is allowed');
      this.#record('image-inspect'); return this.inner.run(args, opts);
    }
    if (verb === 'inspect') {
      if (!this.#isOwnedRef(last)) throw new PolicyError('inspect is limited to owned containers');
      this.#record('inspect', last);
      return this.#inspect(args, opts, last);
    }
    if (verb === 'create') {
      const need = ['--network=none', '--pull=never', '--label=cc.sandbox=1', this.imageRef];
      if (!need.every((n) => args.includes(n)) || args.some((a) => /privileged|--network=(?!none$)|--cap-add|--device|docker\.sock|--pid=|--ipc=host|--volume|^-v$/.test(a))) throw new PolicyError('create must be NO_NETWORK, no-pull, labelled, pinned and unprivileged');
      const nameArg = args.find((a) => a.startsWith('--name='))?.slice(7);
      if (!nameArg || !OWNED_NAME.some((re) => re.test(nameArg))) throw new PolicyError('create needs a task-owned name');
      const res = await this.inner.run(args, opts);
      this.#record('create', res.stdout);
      if (res.exitCode === 0 && HEX64.test(res.stdout.trim())) { this.owned.add(res.stdout.trim()); this.ownedNames.add(nameArg); }
      return res;
    }
    if (verb === 'stop' || verb === 'kill' || verb === 'rm') {
      if (!this.owned.has(last)) throw new PolicyError(`${verb} is limited to container ids created by this test`);
      if (this.swallow.has(verb)) { this.swallowed += 1; this.#record(verb, last, true); return ok(); }
      this.#record(verb, last); return this.inner.run(args, opts);
    }
    throw new PolicyError(`docker verb not allowed: ${String(verb).slice(0, 20)}`);
  }

  async #inspect(args, opts, ref) {
    const res = await this.inner.run(args, opts);
    const byId = HEX64.test(ref) && this.owned.has(ref);
    if (!byId || res.exitCode !== 0) return res;
    let info;
    try { info = JSON.parse(res.stdout); } catch { return res; }
    this.observed.push(sanitize(info)); // REAL observation, taken before any injected change
    let out = res;
    if (this.faults && info?.State?.Status === 'exited') {
      this.faults(info.State, info); this.faultsApplied += 1; this.#record('inspect-fault', ref, true);
      out = { ...res, stdout: JSON.stringify(info) };
    }
    const pause = this.#pause;
    if (pause) {
      this.#idInspects += 1;
      if (this.#idInspects === pause.nth) { this.#pause = null; pause.reached(); await pause.gate; }
    }
    return out;
  }

  /** Only `docker start -a <owned id>` may be streamed. */
  stream(args, opts) {
    if (args.length !== 3 || args[0] !== 'start' || args[1] !== '-a' || !this.owned.has(args[2])) throw new PolicyError('only `start -a <owned container id>` may be streamed');
    this.#record('start', args[2]);
    return this.inner.stream(args, opts);
  }

  // ---- test-side helpers (always scoped to owned ids; bypass faults and swallowing) ------------------------------------------

  /** 'PRESENT' | 'ABSENT' | 'UNKNOWN' by exact id. Never uses the fault, swallow or pause machinery. */
  async existence(id) {
    if (!this.owned.has(id)) throw new PolicyError('existence checks are limited to owned ids');
    const r = await this.inner.run(['inspect', '--type=container', '--format={{json .}}', id]);
    if (r.exitCode === 0) return 'PRESENT';
    return /no such (object|container)/i.test(r.stderr ?? '') ? 'ABSENT' : 'UNKNOWN';
  }
  /** Real state of an owned container by exact id (sanitized), or null. */
  async realState(id) {
    if (!this.owned.has(id)) throw new PolicyError('state reads are limited to owned ids');
    const r = await this.inner.run(['inspect', '--type=container', '--format={{json .}}', id]);
    if (r.exitCode !== 0) return null;
    try { return sanitize(JSON.parse(r.stdout)); } catch { return null; }
  }
  /** Force-remove exactly one owned container id and report whether it is gone. */
  async forceRemove(id) {
    if (!this.owned.has(id)) throw new PolicyError('cleanup is limited to owned ids');
    await this.inner.run(['rm', '--force', id], { timeoutMs: 20_000 });
    return this.existence(id);
  }
  /** Remove every owned container by exact id; returns the ids that could not be confirmed absent. */
  async cleanupAll() {
    const leftovers = [];
    for (const id of this.owned) { if ((await this.forceRemove(id)) !== 'ABSENT') leftovers.push(id.slice(0, 12)); }
    return leftovers;
  }
}

/** The small subset of an inspect response that tests assert on. No environment, no host paths beyond mount destinations. */
export function sanitize(info) {
  const hc = info?.HostConfig ?? {}; const st = info?.State ?? {}; const cfg = info?.Config ?? {};
  return {
    id: info?.Id,
    labels: { ...(cfg.Labels ?? {}) },
    user: cfg.User,
    image: cfg.Image,
    state: { ...st },
    host: {
      networkMode: hc.NetworkMode, privileged: hc.Privileged, capDrop: hc.CapDrop, capAdd: hc.CapAdd, securityOpt: hc.SecurityOpt, readonlyRootfs: hc.ReadonlyRootfs,
      memory: hc.Memory, pidsLimit: hc.PidsLimit, nanoCpus: hc.NanoCpus, binds: hc.Binds, tmpfs: hc.Tmpfs, logType: hc.LogConfig?.Type,
    },
    mountDestinations: (info?.Mounts ?? []).map((m) => ({ destination: m.Destination, rw: m.RW })).sort((a, b) => (a.destination < b.destination ? -1 : 1)),
    envNames: (cfg.Env ?? []).map((e) => e.split('=')[0]).sort(),
  };
}
