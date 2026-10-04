import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSandboxPolicy, buildCreateArgs, assertDockerArgs } from '../server/sandbox/sandboxPolicy.mjs';
import { TEST_IMAGES } from '../server/sandbox/sandboxImages.mjs';
import * as readback from '../server/sandbox/readbackVerifier.mjs';
import { FakeDocker } from './helpers/fakeDocker.mjs';
const image = TEST_IMAGES['busybox-test'];
const parse = (extra = {}, role = 'verifier') => parseSandboxPolicy({ network: 'NO_NETWORK', image: 'busybox-test', ...extra }, { images: TEST_IMAGES, role });
test('verifier gets private executable tmpfs and read-only source; other roles do not', () => {
    const p = parse();
    const args = buildCreateArgs({ name: 'cc-sandbox-verifier-abcdef', sandboxId: 'abcdef', role: 'verifier', policy: p, image, workspacePath: '/safe/source', gitMask: null, user: '1000:1000', command: ['true'] });
    assert.ok(args.includes('--tmpfs=/verify:rw,exec,nosuid,nodev,size=1g'));
    assert.ok(args.includes('--mount=type=bind,src=/safe/source,dst=/workspace,readonly,bind-recursive=disabled'));
    for (const role of ['agent', 'scratch']) {
        const a = buildCreateArgs({ name: `cc-sandbox-${role}-abcdef`, sandboxId: 'abcdef', role, policy: parse({}, role), image, workspacePath: '/safe/source', user: '1000:1000', command: ['true'] });
        assert.ok(!a.some(x => x.startsWith('--tmpfs=/verify')));
    }
});
test('verifier rejects network, writable source, mounts and non-allowlisted environment', () => {
    for (const extra of [{ network: 'PROVIDER_NETWORK' }, { writablePaths: ['/workspace', '/tmp'] }, { mounts: [{ src: '/host/node_modules', dst: '/workspace/node_modules' }] }, { env: { LANG: 'C' } }, { env: { NODE_ENV: 'bad' } }, { env: { TMPDIR: '/host' } }, { env: { CI: '0' } }])
        assert.throws(() => parse(extra));
    assert.doesNotThrow(() => parse({ env: { CI: '1', TMPDIR: '/verify/tmp', NODE_ENV: 'test' } }));
});
test('final argv guard rejects weakening source or adding executable tmpfs to scratch', () => {
    const p = parse();
    const args = buildCreateArgs({ name: 'cc-sandbox-verifier-abcdef', sandboxId: 'abcdef', role: 'verifier', policy: p, image, workspacePath: '/safe/source', user: '1000:1000', command: ['true'] });
    const opts = { image, allowedBindSources: ['/safe/source'] };
    assert.doesNotThrow(() => assertDockerArgs(args, opts));
    assert.throws(() => assertDockerArgs(args.map(x => x.includes('dst=/workspace,readonly') ? x.replace(',readonly', '') : x), opts));
    assert.throws(() => assertDockerArgs(args.map(x => x === '--network=none' ? '--network=bridge' : x), opts));
    assert.throws(() => assertDockerArgs(args.map(x => x.includes('cc.sandbox.role=verifier') ? x.replace('verifier', 'scratch') : x), opts));
});
test('raw execution readback never verifies missing OOMKilled or missing exit facts', () => {
    assert.equal(typeof readback.verifyExecutionReadback, 'function');
    const good = { Id: 'a'.repeat(64), State: { Running: false, Status: 'exited', ExitCode: 0, OOMKilled: false, StartedAt: '2026-10-04T00:00:00Z', FinishedAt: '2026-10-04T00:00:01Z' } };
    assert.equal(readback.verifyExecutionReadback(good, { containerId: good.Id }).ok, true);
    for (const key of ['Running', 'Status', 'ExitCode', 'OOMKilled', 'StartedAt', 'FinishedAt']) {
        const i = structuredClone(good);
        delete i.State[key];
        assert.equal(readback.verifyExecutionReadback(i, { containerId: good.Id }).ok, false, key);
    }
    assert.equal(readback.verifyExecutionReadback({ ...good, Id: 'b'.repeat(64) }, { containerId: good.Id }).ok, false);
});
import fs from 'node:fs';
import { DockerSandboxRuntime } from '../server/sandbox/dockerSandboxRuntime.mjs';
import { makeScratch, realTmp } from './helpers/dockerScratch.mjs';
const withRuntime = async (fn) => {
    const scratch = makeScratch(), fake = new FakeDocker(), stateRoot = realTmp('cc-vfi-state-');
    const images = { 'verifier-test': { ...image, expectedEntrypoint: null, expectedEnv: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' } } };
    const runtime = new DockerSandboxRuntime({ docker: fake, images, stateRoot, commandCenterRoot: process.cwd(), user: { uid: 501, gid: 20 } });
    try {
        await fn({ fake, runtime, scratch, prepare: () => runtime.prepare({ sandboxId: 'verifier-abcdef', role: 'verifier', worktreePath: scratch.wt, policy: { network: 'NO_NETWORK', image: 'verifier-test', env: { CI: '1', TMPDIR: '/verify/tmp', NODE_ENV: 'test' } }, command: ['true'] }) });
    }
    finally {
        runtime.dispose();
        scratch.cleanup();
        fs.rmSync(stateRoot, { recursive: true, force: true });
    }
};
test('strict /verify readback: missing is INCOMPLETE; unsafe options or source RW is MISMATCH', async () => {
    for (const [mode, code] of [['missing', 'POLICY_READBACK_INCOMPLETE'], ['noexec', 'POLICY_READBACK_MISMATCH'], ['size', 'POLICY_READBACK_MISMATCH'], ['source-rw', 'POLICY_READBACK_MISMATCH']])
        await withRuntime(async ({ fake, prepare }) => {
            fake.mutateInspect = i => { if (mode === 'missing')
                delete i.HostConfig.Tmpfs;
            else if (mode === 'source-rw')
                i.Mounts.find(m => m.Destination === '/workspace').RW = true;
            else
                i.HostConfig.Tmpfs['/verify'] = mode === 'noexec' ? 'rw,noexec,nosuid,nodev,size=1g' : 'rw,exec,nosuid,nodev,size=2g'; };
            assert.equal((await prepare()).code, code, mode);
        });
});
test('verifier runtime refuses unexpected image-baked environment before create', async () => withRuntime(async ({ fake, prepare }) => {
    const run = fake.run.bind(fake);
    fake.run = async (args) => { const r = await run(args); if (args[0] === 'image') {
        const info = JSON.parse(r.stdout);
        info.Config.Env.push('OPENAI_API_KEY=synthetic');
        return { ...r, stdout: JSON.stringify(info) };
    } return r; };
    assert.equal((await prepare()).code, 'IMAGE_ENV_MISMATCH');
    assert.equal(fake.callsOf('create').length, 0);
}));
test('verifier cannot verify missing OOMKilled after otherwise successful execution', async () => withRuntime(async ({ fake, runtime, prepare }) => {
    assert.equal((await prepare()).state, 'PREPARED');
    fake.mutateInspect = i => { if (i.State.Status === 'exited')
        delete i.State.OOMKilled; };
    const r = await runtime.start('verifier-abcdef');
    assert.equal(r.state, 'UNKNOWN');
    assert.deepEqual(r.evidence, []);
}));
test('verifier command/environment readback rejects replaced argv or injected env', async () => {
    for (const field of ['Cmd', 'Env'])
        await withRuntime(async ({ fake, prepare }) => { fake.mutateInspect = i => { if (field === 'Cmd')
            i.Config.Cmd = ['echo', 'forged'];
        else
            i.Config.Env.push('SECRET=synthetic'); }; assert.equal((await prepare()).code, 'POLICY_READBACK_MISMATCH'); });
});
test('verifier inspect does not turn missing raw OOMKilled into false', async () => withRuntime(async ({ fake, runtime, prepare }) => {
    assert.equal((await prepare()).state, 'PREPARED');
    fake.mutateInspect = info => { delete info.State.OOMKilled; };
    assert.equal((await runtime.inspect('verifier-abcdef')).state, 'UNKNOWN');
}));
