import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fingerprintSnapshot } from '../server/verifier/foundation.mjs';
const bootstrap = await import('../server/verifier/image/bootstrap.mjs').catch(() => null);
test('trusted bootstrap exists to prepare a private copy without executing project scripts', () => assert.ok(bootstrap, 'bootstrap missing'));
test('bootstrap copies image dependencies and source; refuses source identity mismatch', { skip: !bootstrap }, () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bootstrap-')));
    const src = path.join(root, 'source'), deps = path.join(root, 'deps'), target = path.join(root, 'verify/workspace');
    try {
        fs.mkdirSync(src);
        fs.mkdirSync(deps);
        fs.writeFileSync(path.join(src, 'package.json'), '{}');
        fs.writeFileSync(path.join(src, 'package-lock.json'), '{}');
        fs.writeFileSync(path.join(src, 'ordinary.txt'), 'synthetic');
        fs.writeFileSync(path.join(deps, 'native-fixture'), 'image');
        const approved = { packageJsonHash: crypto.createHash('sha256').update('{}').digest('hex'), packageLockHash: crypto.createHash('sha256').update('{}').digest('hex') };
        const before = fingerprintSnapshot(src).fingerprint;
        assert.throws(() => bootstrap.prepareWorkspace({ sourcePath: src, targetPath: target, depsPath: deps, temporaryPath: path.join(root, 'verify/tmp'), approved, expectedFingerprint: '0'.repeat(64) }));
        assert.ok(!fs.existsSync(target));
        bootstrap.prepareWorkspace({ sourcePath: src, targetPath: target, depsPath: deps, temporaryPath: path.join(root, 'verify/tmp'), approved, expectedFingerprint: before });
        assert.equal(fs.readFileSync(path.join(target, 'node_modules/native-fixture'), 'utf8'), 'image');
        assert.ok(!fs.lstatSync(path.join(target, 'node_modules')).isSymbolicLink());
        fs.writeFileSync(path.join(target, 'ordinary.txt'), 'changed');
        assert.equal(fingerprintSnapshot(src).fingerprint, before);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
