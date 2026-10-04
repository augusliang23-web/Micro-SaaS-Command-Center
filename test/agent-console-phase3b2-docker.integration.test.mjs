import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

import { DOCKER_BIN, POLICY, git, makeScratch, nextId, realRuntime, realTmp } from './helpers/dockerScratch.mjs';
import { TEST_IMAGES } from '../server/sandbox/sandboxImages.mjs';
import { DockerSandboxRuntime } from '../server/sandbox/dockerSandboxRuntime.mjs';
import { DockerClient } from '../server/sandbox/dockerClient.mjs';

// Bounded REAL Docker scratch tests: temp directories only, the locally pinned busybox image, no provider
// call, no real repository, no network download. If Docker or the pinned image is absent these tests are
// SKIPPED (reported as skipped, never as passed).
const { runtime: probeRuntime } = fs.existsSync(DOCKER_BIN) ? realRuntime() : { runtime: null };
const probe = probeRuntime ? await probeRuntime.probe() : { available: false, reason: 'DOCKER_BINARY_MISSING' };
const imageOk = probe.available && probe.images?.['busybox-test']?.present === true;
const skip = imageOk ? false : `real Docker not usable (${probe.reason ?? 'pinned image missing locally'}); integration NOT run`;
probeRuntime?.dispose();

const run = (cmd) => ['sh', '-c', cmd];
async function withSandbox(fn, { policy = POLICY(), command = run('true'), scratch = makeScratch(), role = 'scratch' } = {}) {
  const { runtime, docker } = realRuntime();
  const sandboxId = nextId();
  try {
    const prepared = await runtime.prepare({ sandboxId, role, worktreePath: scratch.wt, policy, command });
    return await fn({ runtime, docker, sandboxId, prepared, scratch });
  } finally {
    await runtime.destroy(sandboxId);
    runtime.dispose();
    scratch.cleanup();
  }
}
const dockerOut = async (docker, ...args) => (await docker.run(args)).stdout;

test('real docker: probe reports a linux/arm64 engine and the pinned image by digest', { skip }, async () => {
  assert.equal(probe.engine.os, 'linux');
  assert.equal(probe.engine.arch, 'arm64');
  const image = probe.images['busybox-test'];
  assert.equal(image.digest, TEST_IMAGES['busybox-test'].digest);
  assert.deepEqual([image.os, image.arch], ['linux', 'arm64']);
  assert.equal(probe.capabilities.providerNetworkRestrictsToProvider, false, 'no overclaiming of provider-only network isolation');
});

test('real docker: exact workspace mount, masked .git, no host secret / HOME / source / socket visible', { skip }, async () => {
  const scratch = makeScratch();
  const hostGit = fs.readFileSync(path.join(scratch.wt, '.git'), 'utf8');
  assert.match(hostGit, /^gitdir: .*\/src\/\.git\/worktrees\/wt/, 'fixture is a real git worktree');
  const script = [
    'echo "uid=$(id -u)"',
    'echo "gitsize=$(wc -c < /workspace/.git)"',
    'echo "file=$(cat /workspace/a.txt)"',
    'echo from-container > /workspace/out.txt && echo wrote-workspace',
    '(echo x > /workspace/.git) 2>&1 | sed "s/^/gitwrite: /"',
    '(rm -f /workspace/.git) 2>&1 | sed "s/^/gitrm: /"',
    `cat ${scratch.root}/outside/secret.txt 2>&1 | sed "s/^/secret: /"`,
    `ls ${scratch.src} 2>&1 | sed "s/^/source: /"`,
    'ls /Users 2>&1 | sed "s/^/users: /"',
    `ls ${os.homedir()} 2>&1 | sed "s/^/home: /"`,
    'ls /var/run/docker.sock 2>&1 | sed "s/^/sock: /"',
    'ls /var/run 2>&1 | sed "s/^/varrun: /"',
    'echo "rootwrite: $( (echo x > /etc/cc-probe) 2>&1 )"',
    'cut -d" " -f2 /proc/mounts | sed "s/^/mount: /"',
  ].join('\n');
  await withSandbox(async ({ runtime, sandboxId, prepared }) => {
    assert.equal(prepared.state, 'PREPARED', JSON.stringify(prepared));
    const res = await runtime.start(sandboxId);
    assert.equal(res.outcome, 'FINISHED');
    assert.equal(res.exitCode, 0);
    const out = res.lines.join('\n');
    assert.match(out, new RegExp(`uid=${process.getuid()}`));
    assert.match(out, /gitsize=0/, '.git is masked: the container sees an empty file, not the pointer to shared metadata');
    assert.match(out, /file=hello from the worktree/);
    assert.match(out, /wrote-workspace/);
    assert.match(out, /gitwrite: .*(Read-only|Device or resource busy)/i);
    assert.match(out, /gitrm: .*(Read-only|Device or resource busy)/i);
    assert.match(out, /secret: .*No such file/);
    assert.ok(!out.includes('SYNTHETIC-HOST-SECRET'));
    assert.match(out, /source: .*No such file/, 'the shared source repository is not reachable');
    assert.match(out, /users: .*No such file/);
    assert.match(out, /home: .*No such file/);
    assert.match(out, /sock: .*No such file/);
    assert.ok(!/varrun: .*docker/.test(out));
    assert.match(out, /rootwrite: .*(Read-only|Permission denied)/);
    const mounts = out.split('\n').filter((l) => l.startsWith('mount: ')).map((l) => l.slice(7));
    assert.ok(mounts.includes('/workspace') && mounts.includes('/workspace/.git'));
    assert.ok(!mounts.some((m) => /docker|\/Users|host_mnt|mnt\/host/i.test(m)), `unexpected mount: ${mounts.join(' ')}`);
    // Host side: edits landed, .git pointer and shared metadata are untouched, git still works on the host.
    assert.equal(fs.readFileSync(path.join(scratch.wt, 'out.txt'), 'utf8'), 'from-container\n');
    assert.equal(fs.readFileSync(path.join(scratch.wt, '.git'), 'utf8'), hostGit);
    assert.match(git(scratch.wt, 'status', '--porcelain'), /\?\? out\.txt/);
    assert.equal(fs.statSync(path.join(scratch.wt, 'out.txt')).uid, process.getuid(), 'files are owned by the host user, not root');
    assert.ok(prepared.evidence.every((e) => e.grade === 'LOCALLY_VERIFIED'));
  }, { command: run(script), scratch });
});

test('real docker: environment is the allowlist only; host process.env is never inherited', { skip }, async () => {
  const synthetic = { GH_TOKEN: 'synthetic-gh', ANTHROPIC_API_KEY: 'synthetic-anthropic', AWS_SECRET_ACCESS_KEY: 'synthetic-aws', SSH_AUTH_SOCK: '/synthetic/sock', OPENAI_API_KEY: 'synthetic-openai', NPM_TOKEN: 'synthetic-npm', GIT_DIR: '/synthetic' };
  const scratch = makeScratch(); // built before the synthetic variables so host git is unaffected
  const saved = { ...process.env };
  Object.assign(process.env, synthetic);
  try {
    await withSandbox(async ({ runtime, sandboxId }) => {
      const res = await runtime.start(sandboxId);
      const keys = res.lines.filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]).sort();
      assert.deepEqual(keys, ['CI', 'HOME', 'HOSTNAME', 'PATH', 'PWD', 'SHLVL']);
      const text = res.lines.join('\n');
      for (const value of Object.values(synthetic)) assert.ok(!text.includes(value));
    }, { command: run('env'), policy: POLICY({ env: { CI: '1' } }), scratch });
  } finally {
    for (const k of Object.keys(synthetic)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

test('real docker: NO_NETWORK is confirmed by Docker inspect readback, and no usable interface exists', { skip }, async () => {
  await withSandbox(async ({ runtime, docker, sandboxId, prepared }) => {
    assert.equal(prepared.state, 'PREPARED');
    const policy = prepared.evidence.find((e) => e.kind === 'sandbox_policy');
    assert.equal(policy.data.checks.networkMode, true);
    assert.equal(policy.grade, 'LOCALLY_VERIFIED');
    // Independent readback straight from Docker, not from our own argv.
    assert.equal((await dockerOut(docker, 'inspect', '--format={{.HostConfig.NetworkMode}}', prepared.name)).trim(), 'none');
    assert.equal((await dockerOut(docker, 'inspect', '--format={{json .NetworkSettings.Networks}}', prepared.name)).trim().replace(/\s/g, '').startsWith('{"none"'), true);
    assert.equal((await runtime.inspect(sandboxId)).networkMode, 'none');
    const res = await runtime.start(sandboxId);
    const text = res.lines.join('\n');
    assert.match(text, /^\s*lo:/m);
    assert.ok(!/^\s*(eth|en)\d*:/m.test(text), 'no ethernet interface');
    assert.match(text, /routes=0/, 'empty routing table');
  }, { command: run('cat /proc/net/dev; echo "routes=$(tail -n +2 /proc/net/route | wc -l)"') });
});

test('real docker: the PROVIDER_NETWORK profile is a plain bridge and is reported as such (no provider-only claim)', { skip }, async () => {
  await withSandbox(async ({ docker, prepared }) => {
    assert.equal(prepared.state, 'PREPARED');
    assert.equal((await dockerOut(docker, 'inspect', '--format={{.HostConfig.NetworkMode}}', prepared.name)).trim(), 'bridge');
    // Created but never started: no traffic of any kind.
    assert.equal((await dockerOut(docker, 'inspect', '--format={{.State.Status}}', prepared.name)).trim(), 'created');
  }, { policy: POLICY({ network: 'PROVIDER_NETWORK' }) });
});

test('real docker: privileges, capabilities and resource limits are what Docker reports', { skip }, async () => {
  await withSandbox(async ({ docker, prepared }) => {
    const hc = JSON.parse(await dockerOut(docker, 'inspect', '--format={{json .HostConfig}}', prepared.name));
    assert.equal(hc.Privileged, false);
    assert.deepEqual(hc.CapDrop, ['ALL']);
    assert.ok(!hc.CapAdd?.length);
    assert.deepEqual(hc.SecurityOpt, ['no-new-privileges']);
    assert.equal(hc.ReadonlyRootfs, true);
    assert.ok(!hc.PidMode);
    assert.equal(hc.IpcMode, 'private');
    assert.ok(!hc.Devices?.length);
    assert.equal(hc.Memory, 96 * 1024 * 1024);
    assert.equal(hc.MemorySwap, hc.Memory);
    assert.equal(hc.NanoCpus, 500_000_000);
    assert.equal(hc.PidsLimit, 20);
    assert.equal(hc.LogConfig.Type, 'none');
    const mounts = JSON.parse(await dockerOut(docker, 'inspect', '--format={{json .Mounts}}', prepared.name));
    assert.deepEqual(mounts.map((m) => m.Destination).sort(), ['/workspace', '/workspace/.git']);
    assert.ok(!JSON.stringify(mounts).includes('docker.sock'));
  }, { policy: POLICY({ memoryMb: 96, cpus: 0.5, pids: 20 }) });
});

test('real docker: the PID limit is enforced (fork fails once --pids-limit is reached)', { skip }, async () => {
  await withSandbox(async ({ runtime, sandboxId }) => {
    const res = await runtime.start(sandboxId);
    assert.match(res.lines.join('\n'), /can't fork/i, JSON.stringify(res.lines));
  }, { policy: POLICY({ pids: 8 }), command: run('exec 2>&1; i=0; while [ $i -lt 30 ]; do sleep 3 & i=$((i+1)); done; echo done-spawning') });
});

test('real docker: the memory limit is enforced (OOM kill reported by Docker)', { skip }, async () => {
  await withSandbox(async ({ runtime, sandboxId }) => {
    const res = await runtime.start(sandboxId);
    assert.equal(res.oomKilled, true, JSON.stringify({ exit: res.exitCode, lines: res.lines }));
    assert.equal(res.exitCode, 137);
  }, { policy: POLICY({ memoryMb: 16 }), command: ['dd', 'if=/dev/zero', 'of=/dev/null', 'bs=64M', 'count=1'] });
});

test('real docker: /tmp tmpfs is size-bounded and the root filesystem is read-only', { skip }, async () => {
  await withSandbox(async ({ runtime, sandboxId }) => {
    const res = await runtime.start(sandboxId);
    const text = res.lines.join('\n');
    assert.match(text, /tmp-full: .*No space left/);
    assert.match(text, /root: .*(Read-only|Permission denied)/);
  }, { command: run('dd if=/dev/zero of=/tmp/big bs=1M count=200 2>&1 | grep -i "no space" | sed "s/^/tmp-full: /"; echo "root: $( (echo x > /usr/x) 2>&1 )"') });
});

test('real docker: timeout stops the container and reports TIMED_OUT only after Docker confirms it', { skip }, async () => {
  await withSandbox(async ({ runtime, docker, sandboxId, prepared }) => {
    const started = Date.now();
    const res = await runtime.start(sandboxId);
    assert.equal(res.outcome, 'TIMED_OUT');
    assert.equal(res.state, 'EXITED');
    assert.ok(Date.now() - started < 25_000);
    assert.equal((await dockerOut(docker, 'inspect', '--format={{.State.Running}}', prepared.name)).trim(), 'false');
  }, { policy: POLICY({ timeoutMs: 1500 }), command: ['sleep', '60'] });
});

test('real docker: an output flood is capped and the container is stopped', { skip }, async () => {
  await withSandbox(async ({ runtime, docker, sandboxId, prepared }) => {
    const res = await runtime.start(sandboxId);
    assert.equal(res.outcome, 'OUTPUT_LIMIT');
    assert.equal((await dockerOut(docker, 'inspect', '--format={{.State.Running}}', prepared.name)).trim(), 'false');
    assert.ok(res.lines.join('').length < 64 * 1024);
  }, { policy: POLICY({ outputBytes: 4096 }), command: ['yes'] });
});

test('real docker: stop escalates to kill for a PID-1 that ignores SIGTERM; STOPPED needs readback confirmation', { skip }, async () => {
  await withSandbox(async ({ runtime, sandboxId, prepared }) => {
    const running = runtime.start(sandboxId);
    for (let i = 0; i < 100 && (await runtime.inspect(sandboxId)).state !== 'RUNNING'; i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await runtime.inspect(sandboxId)).state, 'RUNNING');
    const stopped = await runtime.stop(sandboxId);
    assert.equal(stopped.state, 'STOPPED');
    assert.equal(stopped.evidence[0].kind, 'sandbox_stopped');
    assert.equal(stopped.evidence[0].grade, 'LOCALLY_VERIFIED');
    assert.equal((await runtime.inspect(sandboxId)).state, 'EXITED');
    await running;
    assert.equal((await runtime.stop(sandboxId)).state, 'STOPPED', 'stop is idempotent');
  }, { command: ['sleep', '120'] });
});

test('real docker: destroy is idempotent, removes the container and its mask state, and leaves no sandbox containers', { skip }, async () => {
  const scratch = makeScratch();
  const { runtime, docker } = realRuntime();
  const sandboxId = nextId();
  try {
    const prepared = await runtime.prepare({ sandboxId, role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('true') });
    assert.equal(prepared.state, 'PREPARED');
    const first = await runtime.destroy(sandboxId);
    assert.equal(first.state, 'DESTROYED');
    assert.equal(first.evidence[0].grade, 'LOCALLY_VERIFIED');
    const second = await runtime.destroy(sandboxId);
    assert.deepEqual([second.state, second.already], ['DESTROYED', true]);
    assert.equal((await docker.run(['ps', '-a', '--filter', `name=${prepared.name}`, '--format={{.Names}}'])).stdout.trim(), '');
    assert.equal((await runtime.destroy('never-prepared-1')).state, 'DESTROYED');
    const left = (await docker.run(['ps', '-a', '--filter', 'label=cc.sandbox=1', '--format={{.Names}}'])).stdout.trim();
    assert.ok(!left.split('\n').some((n) => n.includes(sandboxId.toLowerCase())), `leftover: ${left}`);
  } finally {
    await runtime.destroy(sandboxId);
    runtime.dispose();
    scratch.cleanup();
  }
});

test('real docker: a pre-existing container with the same identity is BLOCKED and never deleted', { skip }, async () => {
  const scratch = makeScratch();
  const { runtime, docker } = realRuntime();
  const sandboxId = nextId('collide');
  const name = `cc-sandbox-scratch-${sandboxId.toLowerCase()}`;
  const ref = TEST_IMAGES['busybox-test'].reference;
  try {
    const made = await docker.run(['create', `--name=${name}`, '--pull=never', ref, 'true']);
    assert.equal(made.exitCode, 0, made.stderr);
    const res = await runtime.prepare({ sandboxId, role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('true') });
    assert.deepEqual([res.state, res.code], ['BLOCKED', 'CONTAINER_EXISTS']);
    assert.equal((await docker.run(['inspect', '--format={{.Name}}', name])).stdout.trim(), `/${name}`, 'the unknown container is untouched');
  } finally {
    await docker.run(['rm', '-f', name]);
    runtime.dispose();
    scratch.cleanup();
  }
});

test('real docker: task-controlled strings stay data and can never become Docker options', { skip }, async () => {
  const hostile = ['--privileged', '--network=host', '-v', '/:/host', '--pid=host', '--cap-add=ALL', '$(touch /workspace/pwned)', '`id`'];
  await withSandbox(async ({ runtime, docker, sandboxId, prepared, scratch }) => {
    const res = await runtime.start(sandboxId);
    assert.equal(res.exitCode, 0);
    assert.deepEqual(res.lines, hostile, 'the strings were passed to the container command verbatim');
    assert.ok(!fs.existsSync(path.join(scratch.wt, 'pwned')));
    const hc = JSON.parse(await dockerOut(docker, 'inspect', '--format={{json .HostConfig}}', prepared.name));
    assert.equal(hc.Privileged, false);
    assert.equal(hc.NetworkMode, 'none');
    assert.ok(!hc.PidMode);
    assert.deepEqual(hc.CapDrop, ['ALL']);
  }, { command: ['printf', '%s\\n', ...hostile] });
});

test('real docker: blocked workspaces never reach Docker (home, ~/.docker, comma path, symlink escape, nested git)', { skip }, async () => {
  const { runtime, docker } = realRuntime();
  const before = (await docker.run(['ps', '-a', '--format={{.Names}}'])).stdout;
  const trial = async (worktreePath) => runtime.prepare({ sandboxId: nextId('blk'), role: 'scratch', worktreePath, policy: POLICY(), command: run('true') });
  try {
    for (const bad of [os.homedir(), path.join(os.homedir(), '.docker'), '/', '/Users', process.cwd()]) {
      const r = await trial(bad);
      assert.equal(r.state, 'BLOCKED', bad);
      assert.equal(r.code, 'FORBIDDEN_WORKSPACE', bad);
    }
    const comma = realTmp('cc-p3b2-a,b-'); // would otherwise alter Docker's --mount syntax
    try { assert.equal((await trial(comma)).code, 'INVALID_WORKSPACE'); } finally { fs.rmSync(comma, { recursive: true }); }

    const scratch = makeScratch();
    try {
      fs.symlinkSync(scratch.secret, path.join(scratch.wt, 'leak'));
      assert.equal((await trial(scratch.wt)).code, 'SYMLINK_ESCAPE');
      fs.rmSync(path.join(scratch.wt, 'leak'));
      fs.mkdirSync(path.join(scratch.wt, 'vendor/sub'), { recursive: true });
      fs.writeFileSync(path.join(scratch.wt, 'vendor/sub/.git'), 'gitdir: /elsewhere\n');
      assert.equal((await trial(scratch.wt)).code, 'GIT_METADATA_UNSAFE');
    } finally { scratch.cleanup(); }
    assert.equal((await docker.run(['ps', '-a', '--format={{.Names}}'])).stdout, before, 'no container was created for any blocked workspace');
  } finally { runtime.dispose(); }
});

test('real docker: a hard link to a file outside the workspace BLOCKS before any container exists', { skip }, async () => {
  const scratch = makeScratch();
  const { runtime, docker } = realRuntime();
  const before = (await docker.run(['ps', '-a', '--format={{.Names}}'])).stdout;
  try {
    fs.linkSync(scratch.secret, path.join(scratch.wt, 'leak')); // synthetic outside/secret.txt and workspace/leak share an inode
    const r = await runtime.prepare({ sandboxId: nextId('hl'), role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('cat /workspace/leak') });
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'HARDLINK_UNSAFE']);
    assert.equal((await docker.run(['ps', '-a', '--format={{.Names}}'])).stdout, before, 'no container was created');
    fs.rmSync(path.join(scratch.wt, 'leak'));
    const ok = await runtime.prepare({ sandboxId: nextId('hl'), role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('true') });
    assert.equal(ok.state, 'PREPARED', 'the same workspace without the link is allowed');
    await runtime.destroy(ok.sandboxId);
  } finally { runtime.dispose(); scratch.cleanup(); }
});

test('real docker: stop and destroy act on the exact container ID even if another container takes the name', { skip }, async () => {
  const scratch = makeScratch();
  const { runtime, docker } = realRuntime();
  const sandboxId = nextId('own');
  const ref = TEST_IMAGES['busybox-test'].reference;
  let foreignName;
  try {
    const prepared = await runtime.prepare({ sandboxId, role: 'scratch', worktreePath: scratch.wt, policy: POLICY({ timeoutMs: 60_000 }), command: ['sleep', '120'] });
    assert.equal(prepared.state, 'PREPARED');
    const running = runtime.start(sandboxId);
    for (let i = 0; i < 100 && (await runtime.inspect(sandboxId)).state !== 'RUNNING'; i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await runtime.inspect(sandboxId)).state, 'RUNNING');

    // Race: our container is renamed away and a FOREIGN running container (no labels) takes the original name.
    foreignName = prepared.name;
    assert.equal((await docker.run(['rename', prepared.containerId, `${prepared.name}-moved`])).exitCode, 0);
    const foreign = await docker.run(['run', '-d', `--name=${foreignName}`, '--pull=never', '--network=none', ref, 'sleep', '120']);
    assert.equal(foreign.exitCode, 0, foreign.stderr);
    const foreignId = foreign.stdout.trim();

    const stopped = await runtime.stop(sandboxId);
    assert.equal(stopped.state, 'STOPPED');
    assert.equal(stopped.evidence[0].data.containerId, prepared.containerId, 'evidence is for OUR id');
    assert.equal((await docker.run(['inspect', '--format={{.State.Running}}', foreignId])).stdout.trim(), 'true', 'the foreign container was NOT stopped');
    assert.equal((await docker.run(['inspect', '--format={{.State.Running}}', prepared.containerId])).stdout.trim(), 'false');
    await running;

    const destroyed = await runtime.destroy(sandboxId);
    assert.equal(destroyed.state, 'DESTROYED');
    assert.equal((await docker.run(['inspect', '--format={{.Id}}', prepared.containerId])).exitCode, 1, 'our container is gone');
    assert.equal((await docker.run(['inspect', '--format={{.State.Running}}', foreignId])).stdout.trim(), 'true', 'the foreign container still runs and still has the name');
    assert.equal((await docker.run(['inspect', '--format={{.Name}}', foreignId])).stdout.trim(), `/${foreignName}`);
  } finally {
    if (foreignName) await docker.run(['rm', '-f', foreignName]);
    await runtime.destroy(sandboxId);
    runtime.dispose();
    scratch.cleanup();
  }
});

test('real docker: an image that is not present locally is BLOCKED and nothing is pulled', { skip }, async () => {
  const scratch = makeScratch();
  const ghost = { 'ghost-test': { reference: `busybox@sha256:${'a'.repeat(64)}`, digest: `sha256:${'a'.repeat(64)}`, os: 'linux', arch: 'arm64' } };
  const { runtime, docker } = realRuntime({ images: ghost });
  const imagesBefore = (await docker.run(['images', '-q'])).stdout;
  try {
    const r = await runtime.prepare({ sandboxId: nextId('img'), role: 'scratch', worktreePath: scratch.wt, policy: POLICY({ image: 'ghost-test' }), command: run('true') });
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'IMAGE_UNAVAILABLE']);
    assert.equal((await docker.run(['images', '-q'])).stdout, imagesBefore);
  } finally { runtime.dispose(); scratch.cleanup(); }
});

test('real docker: an unavailable Docker is reported as unavailable, with no host fallback', { skip }, async () => {
  const dead = new DockerSandboxRuntime({ docker: new DockerClient({ dockerPath: '/nonexistent/path/docker' }), commandCenterRoot: process.cwd() });
  try {
    assert.deepEqual(await dead.probe().then((p) => [p.available, p.reason]), [false, 'DOCKER_UNAVAILABLE']);
    const scratch = makeScratch();
    try {
      const r = await dead.prepare({ sandboxId: nextId('dead'), role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('true') });
      assert.equal(r.state, 'BLOCKED');
    } finally { scratch.cleanup(); }
  } finally { dead.dispose(); }
});

test('real docker: no sandbox containers from this suite remain', { skip }, async () => {
  const { docker, runtime } = realRuntime();
  const left = (await docker.run(['ps', '-a', '--filter', 'label=cc.sandbox=1', '--format={{.Names}}'])).stdout.trim();
  runtime.dispose();
  assert.equal(left, '', `leftover sandbox containers: ${left}`);
});

// ---- Phase 3B2.1: filesystem boundary ---------------------------------------------------------------------------------
// argv verified (unit) / runtime accepted (real create) / behavior observed (the container below). Docker inspect exposes the
// option as HostConfig.Mounts[].BindOptions.NonRecursive, which the strict readback requires. A nested host submount is NOT
// created here (that would need a real host mount); the non-recursive behaviour itself is therefore accepted + inspect-verified,
// not observed.
test('real docker: the non-recursive workspace bind is accepted, reported by inspect, and prepare/start/destroy work', { skip }, async () => {
  const scratch = makeScratch();
  fs.mkdirSync(path.join(scratch.wt, 'sub'));
  fs.writeFileSync(path.join(scratch.wt, 'sub', 'n.txt'), 'nested\n');
  await withSandbox(async ({ runtime, docker, sandboxId, prepared }) => {
    assert.equal(prepared.state, 'PREPARED', JSON.stringify(prepared));
    assert.equal(prepared.evidence.find((e) => e.kind === 'sandbox_policy').data.checks.workspaceNonRecursive, true);
    const info = JSON.parse(await dockerOut(docker, 'inspect', prepared.containerId))[0];
    const ws = info.HostConfig.Mounts.find((m) => m.Target === '/workspace');
    assert.equal(ws.BindOptions.NonRecursive, true, 'Docker reports the bind as non-recursive');
    const started = await runtime.start(sandboxId);
    assert.equal(started.outcome, 'FINISHED', JSON.stringify(started));
    assert.equal(started.exitCode, 0);
    const out = started.lines.join('\n');
    assert.match(out, /hello from the worktree/);
    assert.match(out, /nested/);
  }, { scratch, command: run('cat /workspace/a.txt /workspace/sub/n.txt') });
});

test('real docker: a Unix socket or FIFO in the workspace BLOCKS before any container exists', { skip }, async () => {
  const scratch = makeScratch();
  const { runtime, docker } = realRuntime();
  const before = (await docker.run(['ps', '-a', '--format={{.Names}}'])).stdout;
  const sock = path.join(scratch.wt, 's.sock');
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(sock, resolve); });
    let r = await runtime.prepare({ sandboxId: nextId('sp'), role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('true') });
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'SPECIAL_FILE_UNSAFE']);
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(sock, { force: true });
    execFileSync('/usr/bin/mkfifo', [path.join(scratch.wt, 'pipe')]);
    r = await runtime.prepare({ sandboxId: nextId('sp'), role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('true') });
    assert.deepEqual([r.state, r.code], ['BLOCKED', 'SPECIAL_FILE_UNSAFE']);
    assert.equal((await docker.run(['ps', '-a', '--format={{.Names}}'])).stdout, before, 'no container was created');
    fs.rmSync(path.join(scratch.wt, 'pipe'));
    const ok = await runtime.prepare({ sandboxId: nextId('sp'), role: 'scratch', worktreePath: scratch.wt, policy: POLICY(), command: run('true') });
    assert.equal(ok.state, 'PREPARED', 'the same workspace without special files is allowed');
    await runtime.destroy(ok.sandboxId);
  } finally { server.close(); runtime.dispose(); scratch.cleanup(); }
});
