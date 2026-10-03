import { TEST_IMAGES } from '../../server/sandbox/sandboxImages.mjs';

// Stateful fake Docker driver for unit tests. It parses `docker create` argv into a container record and
// answers `inspect` the way real Docker does, so the runtime's readback verification is exercised without
// a daemon. Knobs simulate failures and ambiguity.
const IMAGE = TEST_IMAGES['busybox-test'];
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', spawnError: null, timedOut: false });
const err = (stderr, exitCode = 1) => ({ exitCode, stdout: '', stderr, spawnError: null, timedOut: false });

export class FakeDocker {
  calls = [];
  containers = new Map();
  streams = [];
  unavailable = false;
  imagePresent = true;
  imagePlatform = { Os: 'linux', Architecture: 'arm64' };
  imageDigestOk = true;
  engine = { Version: '29.8.1', Os: 'linux', Arch: 'arm64' };
  ambiguousInspect = false;
  failCreate = false;
  leaveBehindOnFailedCreate = false;
  mutateInspect = null; // (info) => void
  scenario = { lines: [], exitCode: 0, hang: false, oom: false };
  stopStopsContainer = true;
  killKillsContainer = true;

  get names() { return this.calls.map((c) => c[0] === 'image' ? 'image' : c[0]); }
  callsOf(verb) { return this.calls.filter((c) => c[0] === verb); }

  async run(args) {
    this.calls.push([...args]);
    if (this.unavailable) return { exitCode: null, stdout: '', stderr: '', spawnError: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), timedOut: false };
    const [verb] = args;
    if (verb === 'version') return ok(JSON.stringify(this.engine));
    if (verb === 'image') return this.#imageInspect();
    if (verb === 'inspect') return this.#inspect(args.at(-1));
    if (verb === 'create') return this.#create(args);
    if (verb === 'stop') { const c = this.#find(args.at(-1)); if (c && this.stopStopsContainer) c.running = false; return ok(); }
    if (verb === 'kill') { const c = this.#find(args.at(-1)); if (c && this.killKillsContainer) c.running = false; return ok(); }
    if (verb === 'rm') { this.containers.delete(args.at(-1)); return ok(); }
    return err(`unexpected docker verb in fake: ${verb}`);
  }

  stream(args, { onLine, timeoutMs, limits } = {}) {
    this.calls.push([...args]);
    this.streams.push({ args: [...args], timeoutMs, limits });
    const container = this.#find(args.at(-1));
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const finish = (extra) => resolveDone({ spawnError: null, exitCode: 0, signal: null, exitObserved: true, stderr: '', limit: null, terminateReason: null, ...extra });
    if (container) container.running = true;
    queueMicrotask(() => {
      for (const line of this.scenario.lines ?? []) onLine?.(line);
      if (this.scenario.hang) {
        setTimeout(() => finish({ terminateReason: 'timeout' }), Math.min(timeoutMs || 20, 50)); // container is left running
      } else {
        if (container) { container.running = false; container.exitCode = this.scenario.exitCode; container.oom = this.scenario.oom; }
        finish({ limit: this.scenario.limit ?? null, terminateReason: this.scenario.limit ? 'limit' : null });
      }
    });
    return { pid: undefined, cancel: () => {}, done };
  }

  #find(name) { return this.containers.get(name); }

  #imageInspect() {
    if (!this.imagePresent) return err('Error response from daemon: No such image: x');
    return ok(JSON.stringify({
      Id: this.imageDigestOk ? IMAGE.digest : `sha256:${'0'.repeat(64)}`, ...this.imagePlatform,
      RepoDigests: this.imageDigestOk ? [IMAGE.reference] : [`busybox@sha256:${'0'.repeat(64)}`],
      Config: { Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'] },
    }));
  }

  #create(args) {
    if (this.failCreate) {
      if (this.leaveBehindOnFailedCreate) this.containers.set(this.#flag(args, '--name'), { name: this.#flag(args, '--name'), labels: {}, foreign: false, partial: true, args, mounts: [], env: {}, tmpfs: {} });
      return err('Error response from daemon: simulated create failure');
    }
    const flags = (n) => args.filter((a) => a.startsWith(`${n}=`)).map((a) => a.slice(n.length + 1));
    const imageIndex = args.findIndex((a, i) => i > 0 && !a.startsWith('-'));
    const name = this.#flag(args, '--name');
    const mounts = flags('--mount').map((m) => { const o = Object.fromEntries(m.split(',').map((kv) => kv.split('=', 2))); return { source: o.src, destination: o.dst, rw: !m.includes(',readonly') }; });
    const tmpfs = Object.fromEntries(flags('--tmpfs').map((t) => { const [p, ...o] = t.split(':'); return [p, o.join(':')]; }));
    const mb = (v) => Number(v.replace('m', '')) * 1024 * 1024;
    this.containers.set(name, {
      name, id: `${'c'.repeat(63)}${this.containers.size}`, labels: Object.fromEntries(flags('--label').map((l) => l.split('=', 2))), args, mounts, tmpfs,
      network: this.#flag(args, '--network'), memory: mb(this.#flag(args, '--memory')), memorySwap: mb(this.#flag(args, '--memory-swap')), cpus: Number(this.#flag(args, '--cpus')),
      pids: Number(this.#flag(args, '--pids-limit')), user: this.#flag(args, '--user'), workdir: this.#flag(args, '--workdir'), image: args[imageIndex], command: args.slice(imageIndex + 1),
      env: Object.fromEntries(flags('--env').map((e) => { const i = e.indexOf('='); return [e.slice(0, i), e.slice(i + 1)]; })),
      readOnly: args.includes('--read-only'), capDrop: flags('--cap-drop'), secOpt: flags('--security-opt'), ipc: this.#flag(args, '--ipc'), log: this.#flag(args, '--log-driver'),
      running: false, exitCode: 0, oom: false, foreign: false,
    });
    return ok(this.containers.get(name).id);
  }

  #flag(args, n) { const v = args.find((a) => a.startsWith(`${n}=`)); return v ? v.slice(n.length + 1) : undefined; }

  addForeign(name) { this.containers.set(name, { name, id: 'f'.repeat(64), labels: {}, foreign: true, mounts: [], env: {}, tmpfs: {}, args: [] }); }

  #inspect(name) {
    if (this.ambiguousInspect) return err('permission denied while trying to connect to the Docker daemon socket');
    const c = this.#find(name);
    if (!c) return err(`Error response from daemon: No such object: ${name}`);
    if (c.foreign || c.partial) return ok(JSON.stringify({ Id: c.id ?? 'x', Config: { Labels: {}, Env: [] }, HostConfig: {}, Mounts: [], State: { Status: 'created', Running: false, ExitCode: 0 } }));
    const info = {
      Id: c.id, Image: IMAGE.digest,
      State: { Status: c.running ? 'running' : (c.started ? 'exited' : 'created'), Running: c.running, ExitCode: c.exitCode, OOMKilled: c.oom, StartedAt: '2026-10-04T00:00:00Z', FinishedAt: '2026-10-04T00:00:01Z' },
      Config: { Image: c.image, User: c.user, WorkingDir: c.workdir, Labels: c.labels, Env: [...Object.entries(c.env).map(([k, v]) => `${k}=${v}`)] },
      HostConfig: {
        NetworkMode: c.network, Privileged: false, CapDrop: c.capDrop.length ? c.capDrop : null, CapAdd: null, SecurityOpt: c.secOpt, ReadonlyRootfs: c.readOnly, PidMode: '', IpcMode: c.ipc, UsernsMode: '',
        Devices: [], DeviceCgroupRules: null, DeviceRequests: null, PortBindings: {}, Links: null, PublishAllPorts: false, Binds: null, VolumesFrom: null,
        Memory: c.memory, MemorySwap: c.memorySwap, NanoCpus: Math.round(c.cpus * 1e9), PidsLimit: c.pids, LogConfig: { Type: c.log }, Tmpfs: c.tmpfs,
      },
      Mounts: c.mounts.map((m) => ({ Type: 'bind', Source: m.source, Destination: m.destination, RW: m.rw })),
    };
    if (c.running === false && c.exitCode !== undefined && this.streams.some((s) => s.args.at(-1) === name)) info.State.Status = 'exited';
    this.mutateInspect?.(info, c);
    return ok(JSON.stringify(info));
  }
}
