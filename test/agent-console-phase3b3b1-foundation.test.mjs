import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const mod = await import('../server/verifier/foundation.mjs').catch(() => null);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const scratch = fn => { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-vf-'))); try {
    return fn(root);
}
finally {
    fs.rmSync(root, { recursive: true, force: true });
} };
test('foundation exists so a changed manifest cannot select a dependency profile', () => assert.ok(mod, 'verifier foundation is missing'));
const check = (name, fn) => test(name, { skip: !mod }, fn);
check('both manifest hashes must match; mismatch returns no install authority', () => scratch(root => {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    const approved = { packageJsonHash: hash('{}'), packageLockHash: hash('{}') };
    assert.equal(mod.checkDependencyIdentity(root, approved).state, 'MATCH');
    for (const file of ['package.json', 'package-lock.json']) {
        fs.writeFileSync(path.join(root, file), 'changed');
        assert.equal(mod.checkDependencyIdentity(root, approved).code, 'DEPENDENCY_PROFILE_MISMATCH');
        fs.writeFileSync(path.join(root, file), '{}');
    }
}));
check('snapshot excludes secrets/generated trees, preserves executable source and hashes copied bytes', () => scratch(root => {
    const src = path.join(root, 'source'), dest = path.join(root, 'snapshot');
    fs.mkdirSync(src);
    for (const d of ['node_modules', 'dist', 'coverage', '.cache', '.docker', '.claude', 'data', '.git']) {
        fs.mkdirSync(path.join(src, d));
        fs.writeFileSync(path.join(src, d, 'private'), 'secret');
    }
    for (const f of ['.env', '.env.example', '.env.local', '.npmrc', 'registered.private'])
        fs.writeFileSync(path.join(src, f), 'secret');
    fs.writeFileSync(path.join(src, 'run.sh'), 'echo safe\n', { mode: 0o755 });
    const s = mod.createSnapshot({ sourcePath: src, checkpoint: { sourcePath: src, agentStopped: true, integrity: "VERIFIED" }, destinationPath: dest, privatePaths: ['registered.private'] });
    assert.deepEqual(fs.readdirSync(dest), ['run.sh']);
    assert.equal(s.entries[0].digest, hash('echo safe\n'));
    assert.equal(s.entries[0].mode, 0o555);
    assert.equal(s.fingerprint, mod.fingerprintSnapshot(dest).fingerprint);
    assert.equal(s.entries[0].size, 10);
    assert.equal(s.entries[0].type, 'file');
    assert.equal(fs.statSync(path.join(dest, 'run.sh')).mode & 0o222, 0);
    fs.chmodSync(path.join(dest, 'run.sh'), 0o755);
    fs.writeFileSync(path.join(dest, 'run.sh'), 'changed');
    assert.notEqual(mod.fingerprintSnapshot(dest).fingerprint, s.fingerprint);
}));
check('unsafe symlinks, hard links, nested git and special files block before copying', () => scratch(root => {
    for (const kind of ['symlink', 'hardlink', 'nestedGit']) {
        const src = path.join(root, kind), dest = path.join(root, kind + '-copy');
        fs.mkdirSync(src);
        fs.writeFileSync(path.join(root, 'outside'), 'secret');
        if (kind === 'symlink')
            fs.symlinkSync(path.join(root, 'outside'), path.join(src, 'escape'));
        if (kind === 'hardlink')
            fs.linkSync(path.join(root, 'outside'), path.join(src, 'escape'));
        if (kind === 'nestedGit') {
            fs.mkdirSync(path.join(src, 'nested'));
            fs.writeFileSync(path.join(src, 'nested', '.git'), 'bad');
        }
        assert.throws(() => mod.createSnapshot({ sourcePath: src, checkpoint: { sourcePath: src, agentStopped: true, integrity: "VERIFIED" }, destinationPath: dest }));
        assert.ok(!fs.existsSync(dest));
    }
}));
check('task input cannot override fixed executable, arguments, image or environment', () => {
    const identity = { digest: 'sha256:' + 'a'.repeat(64) };
    const c = mod.resolveCommand({ profileId: 'command-center-v1', commandId: 'ui' }, identity);
    assert.equal(c.executable, '/usr/local/bin/node');
    assert.deepEqual(c.args, ['/verify/workspace/node_modules/vitest/vitest.mjs', 'run']);
    assert.equal(c.cwd, '/verify/workspace');
    assert.equal(c.env.NODE_ENV, 'test');
    assert.equal(c.imageDigest, identity.digest);
    for (const field of ['args', 'executable', 'cwd', 'env', 'image', 'mounts', 'shell'])
        assert.throws(() => mod.resolveCommand({ profileId: 'command-center-v1', commandId: 'ui', [field]: field === 'args' ? ['--version'] : 'evil' }, identity));
    assert.throws(() => mod.resolveCommand({ profileId: 'unknown', commandId: 'ui' }, identity));
    assert.deepEqual(mod.resolveCommand({ profileId: 'command-center-v1', commandId: 'typecheck' }, identity).args, ['/verify/workspace/node_modules/typescript/bin/tsc', '--noEmit']);
    assert.deepEqual(mod.resolveCommand({ profileId: 'command-center-v1', commandId: 'vite-build' }, identity).args, ['/verify/workspace/node_modules/vite/bin/vite.js', 'build']);
    const build = mod.resolveCommand({ profileId: 'command-center-v1', commandId: 'server-build' }, identity);
    assert.equal(build.env.NODE_ENV, 'production');
    assert.ok(build.args.includes('--outfile=dist/server.cjs'));
});
check('command environment is exact and ignores host secrets', () => {
    process.env.CC_TEST_SECRET = 'do-not-inherit';
    try {
        const c = mod.resolveCommand({ profileId: 'command-center-v1', commandId: 'ui' }, { digest: 'sha256:' + 'a'.repeat(64) });
        assert.deepEqual(Object.keys(c.env).sort(), ['CI', 'HOME', 'NODE_ENV', 'PATH', 'TMPDIR']);
        assert.equal(c.env.TMPDIR, '/verify/tmp');
    }
    finally {
        delete process.env.CC_TEST_SECRET;
    }
});
check('verifier image allowlist requires approved toolchain and both dependency hashes', () => {
    const identity = { ...mod.APPROVED_IDENTITY, digest: 'sha256:' + 'a'.repeat(64), reference: 'cc-verifier@sha256:' + 'a'.repeat(64), expectedEnv: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_VERSION: '22.23.3', YARN_VERSION: '1.22.22' }, expectedEntrypoint: ['/usr/bin/env', '--'] };
    assert.equal(mod.verifierImageAllowlist(identity)['command-center-verifier'].reference, identity.reference);
    for (const key of ['packageJsonHash', 'packageLockHash', 'npm', 'node', 'platform', 'baseReference', 'provisioningPolicy'])
        assert.throws(() => mod.verifierImageAllowlist({ ...identity, [key]: 'changed' }), key);
    assert.throws(() => mod.verifierImageAllowlist({ ...identity, expectedEnv: { ...identity.expectedEnv, GH_TOKEN: 'synthetic' } }));
});
check('derived verification runner image requires the exact local B1 parent identity', () => {
    const b1 = JSON.parse(fs.readFileSync(new URL('../server/verifier/verifierImageIdentity.json', import.meta.url), 'utf8'));
    const identity = { ...b1, digest: 'sha256:' + 'b'.repeat(64), reference: `cc-verification-runner@sha256:${'b'.repeat(64)}`, parentB1Digest: b1.digest, parentB1ImageId: b1.imageId, parentB1Tag: 'cc-verifier:phase3b3b1', runnerHash: 'a'.repeat(64), profileHash: 'a'.repeat(64), bootstrapHash: 'a'.repeat(64), snapshotInventoryHash: 'a'.repeat(64), approvedIdentityHash: 'a'.repeat(64), dockerfileHash: 'a'.repeat(64), expectedEnv: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_VERSION: '22.23.3', YARN_VERSION: '1.22.22' }, expectedEntrypoint: ['/usr/bin/env', '--'] };
    assert.throws(() => mod.verifierImageAllowlist(identity), /identity/i);
    assert.ok(mod.verifierImageAllowlist(identity, { allowDerivedRunner: true })['command-center-verifier']);
    assert.throws(() => mod.verifierImageAllowlist({ ...identity, parentB1Digest: 'sha256:' + 'c'.repeat(64) }, { allowDerivedRunner: true }), /identity/i);
});
check('snapshot requires a host checkpoint for the exact stopped source', () => scratch(root => {
    const src = path.join(root, 'source');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'ordinary'), 'safe');
    for (const checkpoint of [undefined, { sourcePath: src, agentStopped: false, integrity: 'VERIFIED' }, { sourcePath: src, agentStopped: true, integrity: 'UNKNOWN' }, { sourcePath: '/wrong', agentStopped: true, integrity: 'VERIFIED' }])
        assert.throws(() => mod.createSnapshot({ sourcePath: src, destinationPath: path.join(root, 'copy'), checkpoint }));
}));
