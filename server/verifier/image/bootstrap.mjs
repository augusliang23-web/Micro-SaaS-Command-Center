import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fingerprintSnapshot } from './snapshotInventory.mjs';
import { APPROVED } from './approvedIdentity.mjs';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// Preparation only: this phase has no project-command executor. All arguments here are host/image-owned.
export function prepareWorkspace({ sourcePath = '/workspace', targetPath = '/verify/workspace', depsPath = '/opt/cc-verifier/deps/node_modules', temporaryPath = '/verify/tmp', approved = APPROVED, expectedFingerprint }) {
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint ?? '') || fingerprintSnapshot(sourcePath).fingerprint !== expectedFingerprint)
        throw new Error('SNAPSHOT_IDENTITY_MISMATCH');
    for (const [name, key] of [['package.json', 'packageJsonHash'], ['package-lock.json', 'packageLockHash']]) {
        const fd = fs.openSync(path.join(sourcePath, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
            if (!fs.fstatSync(fd).isFile() || digest(fs.readFileSync(fd)) !== approved[key])
                throw new Error('DEPENDENCY_PROFILE_MISMATCH');
        }
        finally {
            fs.closeSync(fd);
        }
    }
    if (fs.existsSync(path.join(sourcePath, 'node_modules')) || fs.existsSync(path.join(sourcePath, '.git')) || fs.existsSync(targetPath) || !fs.lstatSync(depsPath).isDirectory())
        throw new Error('UNSAFE_WORKSPACE');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(targetPath, { mode: 0o700 });
    try {
        fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: false, errorOnExist: true, force: false });
        // The source copy has no links. Grant owner write only to its private copy.
        const writable = dir => { fs.chmodSync(dir, 0o700); for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory())
                writable(p);
            else
                fs.chmodSync(p, (fs.statSync(p).mode & 0o111) ? 0o700 : 0o600);
        } };
        if (fingerprintSnapshot(sourcePath).fingerprint !== expectedFingerprint || fingerprintSnapshot(targetPath).fingerprint !== expectedFingerprint)
            throw new Error('SNAPSHOT_IDENTITY_MISMATCH');
        writable(targetPath);
        const deps = fs.realpathSync(depsPath);
        // Trusted image packages may use .bin relative symlinks; none may escape the immutable dependency tree.
        const inspect = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name), s = fs.lstatSync(p);
            if (s.isSymbolicLink()) {
                const real = fs.realpathSync(p);
                if (!real.startsWith(deps + path.sep))
                    throw new Error('UNSAFE_DEPENDENCY_LINK');
            }
            else if (s.isDirectory())
                inspect(p);
            else if (!s.isFile())
                throw new Error('UNSAFE_DEPENDENCY_NODE');
        } };
        inspect(deps);
        fs.cpSync(deps, path.join(targetPath, 'node_modules'), { recursive: true, dereference: false, errorOnExist: true, force: false });
        fs.mkdirSync(temporaryPath, { recursive: true, mode: 0o700 });
        return { sourceFingerprint: expectedFingerprint, workspace: targetPath, dependencyModel: 'image-copy', prepared: true };
    }
    catch (error) {
        fs.rmSync(targetPath, { recursive: true, force: true });
        throw error;
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 4 || process.argv[2] !== 'prepare')
        throw new Error('Only trusted preparation is available; project execution is deferred');
    console.log(JSON.stringify(prepareWorkspace({ expectedFingerprint: process.argv[3] })));
}
