import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockerClient } from '../server/sandbox/dockerClient.mjs';
import { DockerSandboxRuntime } from '../server/sandbox/dockerSandboxRuntime.mjs';
import { createSnapshot, verifierImageAllowlist, checkDependencyIdentity } from '../server/verifier/foundation.mjs';
import { realTmp, DOCKER_BIN } from './helpers/dockerScratch.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = JSON.parse(fs.readFileSync(path.join(repo, 'server/verifier/verifierImageIdentity.json'), 'utf8'));
const docker = new DockerClient({ dockerPath: DOCKER_BIN });
const image = await docker.run(['image', 'inspect', '--format={{.Id}}', identity.reference]);
const skip = image.exitCode === 0 ? false : 'Approved verifier image unavailable locally; synthetic Docker proof NOT run';
test('real verifier foundation prepares synthetic source/dependencies inside private tmpfs without source writes or project execution', { skip }, async () => {
    const root = realTmp('cc-vf-real-'), source = path.join(root, 'source'), snapshot = path.join(root, 'snapshot'), state = realTmp('cc-vf-state-');
    fs.mkdirSync(source);
    for (const name of ['package.json', 'package-lock.json'])
        fs.copyFileSync(path.join(repo, name), path.join(source, name));
    fs.writeFileSync(path.join(source, 'synthetic.txt'), 'synthetic only');
    fs.writeFileSync(path.join(source, '.env'), 'synthetic private');
    const snap = createSnapshot({ sourcePath: source, checkpoint: { sourcePath: source, agentStopped: true, integrity: "VERIFIED" }, destinationPath: snapshot });
    assert.equal(checkDependencyIdentity(snapshot).state, 'MATCH');
    const runtime = new DockerSandboxRuntime({ docker, images: verifierImageAllowlist(identity), stateRoot: state, commandCenterRoot: repo });
    const id = `verifier-foundation-${process.pid}`;
    try {
        const prepared = await runtime.prepare({ sandboxId: id, role: 'verifier', worktreePath: snapshot, policy: { network: 'NO_NETWORK', image: 'command-center-verifier', env: { CI: '1', TMPDIR: '/verify/tmp', NODE_ENV: 'test' }, memoryMb: 2048, cpus: 2, pids: 256, timeoutMs: 120000 }, command: ['/usr/local/bin/node', '/opt/cc-verifier/bootstrap.mjs', 'prepare', snap.fingerprint] });
        assert.equal(prepared.state, 'PREPARED', JSON.stringify(prepared));
        const r = await runtime.start(id);
        assert.equal(r.state, 'EXITED', JSON.stringify(r));
        assert.equal(r.exitCode, 0, JSON.stringify(r));
        assert.equal(r.oomKilled, false);
        assert.equal(JSON.parse(r.lines.at(-1)).sourceFingerprint, snap.fingerprint);
        const info = JSON.parse((await docker.run(['inspect', prepared.containerId])).stdout)[0];
        assert.equal(info.HostConfig.NetworkMode, 'none');
        assert.equal(info.Mounts.find(m => m.Destination === '/workspace').RW, false);
        assert.equal(info.HostConfig.Tmpfs['/verify'], 'rw,exec,nosuid,nodev,size=1g');
        assert.deepEqual(fs.readdirSync(snapshot).sort(), ['package-lock.json', 'package.json', 'synthetic.txt']);
        assert.equal(fs.readFileSync(path.join(source, 'synthetic.txt'), 'utf8'), 'synthetic only');
        assert.equal((await runtime.destroy(id)).state, 'DESTROYED');
    }
    finally {
        await runtime.destroy(id);
        runtime.dispose();
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(state, { recursive: true, force: true });
    }
});
