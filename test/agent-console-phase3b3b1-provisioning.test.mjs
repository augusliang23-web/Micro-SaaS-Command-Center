import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const mod = await import('../server/verifier/provisionImage.mjs').catch(() => null);
test('provisioning context must exist independently of runtime execution', () => assert.ok(mod, 'provisioning guard missing'));
test('context includes only approved manifests and trusted image files, changed manifests refuse context', { skip: !mod }, () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-context-')));
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    try {
        const src = path.join(root, 'source');
        fs.mkdirSync(src);
        for (const f of ['package.json', 'package-lock.json'])
            fs.copyFileSync(path.join(repo, f), path.join(src, f));
        fs.writeFileSync(path.join(src, 'secret'), 'never copied');
        const context = path.join(root, 'context');
        mod.createProvisioningContext(src, context);
        assert.deepEqual(fs.readdirSync(context).sort(), ['Dockerfile', 'approvedIdentity.mjs', 'bootstrap.mjs', 'capabilities.mjs', 'empty-global.npmrc', 'empty-user.npmrc', 'package-lock.json', 'package.json', 'snapshotInventory.mjs'].sort());
        for (const f of ['package.json', 'package-lock.json']) {
            const original = fs.readFileSync(path.join(src, f));
            fs.writeFileSync(path.join(src, f), 'changed');
            assert.throws(() => mod.createProvisioningContext(src, path.join(root, 'bad-' + f)));
            assert.ok(!fs.existsSync(path.join(root, 'bad-' + f)));
            fs.writeFileSync(path.join(src, f), original);
        }
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
