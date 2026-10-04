import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectWorkspace } from '../sandbox/workspaceView.mjs';
import { APPROVED } from './image/approvedIdentity.mjs';
import { fingerprintSnapshot } from './image/snapshotInventory.mjs';
export { fingerprintSnapshot };
export const APPROVED_IDENTITY = APPROVED;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blocked = (code, message) => Object.assign(new Error(message), { code });
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const EXCLUDED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.vite', '.vite-temp', '.vitest', '.next', '.turbo', '.npm', '.yarn', '.pnpm-store', '.docker', '.ssh', '.aws', '.config', '.claude', '.codex', '.anthropic', '.gcloud', '.kube', '.bridge', '.superpowers', 'data', 'projects.local.json', '.npmrc', '.netrc', '.gitconfig', '.DS_Store']);
const safeRelative = value => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split('/').some(p => !p || p === '.' || p === '..') && !/[\0\r\n\\]/.test(value);
export function checkDependencyIdentity(root, approved = APPROVED) {
    try {
        const actual = {};
        for (const [file, key] of [['package.json', 'packageJsonHash'], ['package-lock.json', 'packageLockHash']]) {
            const fd = fs.openSync(path.join(root, file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try {
                const s = fs.fstatSync(fd);
                if (!s.isFile() || s.nlink !== 1 || s.size > 8 * 1024 * 1024)
                    throw new Error('Unsafe manifest');
                actual[key] = digest(fs.readFileSync(fd));
            }
            finally {
                fs.closeSync(fd);
            }
        }
        return Object.keys(actual).every(k => actual[k] === approved[k]) ? { state: 'MATCH', ...actual } : { state: 'BLOCKED', code: 'DEPENDENCY_PROFILE_MISMATCH', ...actual };
    }
    catch {
        return { state: 'BLOCKED', code: 'DEPENDENCY_PROFILE_MISMATCH' };
    }
}
// Checkpoints are host assertions, not authentication. B2 must obtain them from its stopped-agent /
// integrity controller, never task/browser input. Concurrent hostile host writers are outside this guarantee.
export function createSnapshot({ sourcePath, destinationPath, privatePaths = [], commandCenterRoot = process.cwd(), homeDir, stateRoot, checkpoint }) {
    const source = inspectWorkspace(sourcePath, { commandCenterRoot, homeDir, stateRoot }).root;
    if (checkpoint?.sourcePath !== source || checkpoint.agentStopped !== true || checkpoint.integrity !== 'VERIFIED')
        throw blocked('SNAPSHOT_CHECKPOINT_REQUIRED', 'Stopped-agent and host integrity checkpoint required for this exact source');
    if (!Array.isArray(privatePaths) || !privatePaths.every(safeRelative))
        throw blocked('SNAPSHOT_UNSAFE', 'Private paths must be server-owned relative paths');
    if (typeof destinationPath !== 'string' || !path.isAbsolute(destinationPath) || path.normalize(destinationPath) !== destinationPath || fs.realpathSync(path.dirname(destinationPath)) !== path.dirname(destinationPath) || inside(source, destinationPath) || inside(destinationPath, source) || fs.existsSync(destinationPath))
        throw blocked('SNAPSHOT_UNSAFE', 'Snapshot destination must be a new independent canonical path');
    const exclude = rel => rel.split('/').some(n => EXCLUDED.has(n) || n === '.env' || n.startsWith('.env.') || /\.(pem|key|p12|pfx)$/.test(n)) || privatePaths.some(p => rel === p || rel.startsWith(p + '/'));
    // Reject even internal links in the first profile: source copies are ordinary files only.
    let bytes = 0, count = 0;
    const copy = (dir, target, rel = '') => {
        for (const name of fs.readdirSync(dir).sort()) {
            const relative = rel ? `${rel}/${name}` : name;
            if (!safeRelative(relative))
                throw blocked('SNAPSHOT_UNSAFE', 'Unsafe source name');
            if (exclude(relative))
                continue;
            if (++count > 50000)
                throw blocked('SNAPSHOT_LIMIT', 'Too many source entries');
            const from = path.join(dir, name), to = path.join(target, name), s = fs.lstatSync(from);
            if (s.dev !== fs.lstatSync(source).dev)
                throw blocked('MOUNT_BOUNDARY_UNSAFE', 'Source filesystem boundary');
            if (s.isDirectory()) {
                fs.mkdirSync(to, { mode: 0o700 });
                copy(from, to, relative);
            }
            else {
                if (!s.isFile() || s.nlink !== 1)
                    throw blocked('SNAPSHOT_UNSAFE', 'Only independent ordinary source files may be copied');
                const fd = fs.openSync(from, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                try {
                    const before = fs.fstatSync(fd);
                    if (!before.isFile() || before.nlink !== 1 || before.ino !== s.ino || before.dev !== s.dev || before.size > 8 * 1024 * 1024 || bytes + before.size > 64 * 1024 * 1024)
                        throw blocked('SNAPSHOT_UNSAFE', 'Unsafe or oversized source');
                    const content = fs.readFileSync(fd);
                    const after = fs.fstatSync(fd);
                    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
                        throw blocked('SNAPSHOT_CHANGED', 'Source changed during copying');
                    bytes += content.length;
                    fs.writeFileSync(to, content, { flag: 'wx', mode: (s.mode & 0o111) ? 0o555 : 0o444 });
                }
                finally {
                    fs.closeSync(fd);
                }
            }
        }
    };
    fs.mkdirSync(destinationPath, { mode: 0o700 });
    try {
        copy(source, destinationPath);
        const identity = fingerprintSnapshot(destinationPath);
        return Object.freeze({ path: destinationPath, ...identity });
    }
    catch (error) {
        fs.rmSync(destinationPath, { recursive: true, force: true });
        throw error;
    }
}
const commands = Object.freeze({
    ui: Object.freeze({ kind: 'test', tool: 'vitest/vitest.mjs', args: Object.freeze(['run']), nodeEnv: 'test' }),
    typecheck: Object.freeze({ kind: 'typecheck', tool: 'typescript/bin/tsc', args: Object.freeze(['--noEmit']), nodeEnv: 'test' }),
    'vite-build': Object.freeze({ kind: 'build', tool: 'vite/bin/vite.js', args: Object.freeze(['build']), nodeEnv: 'production' }),
    'server-build': Object.freeze({ kind: 'build', tool: 'esbuild/bin/esbuild', args: Object.freeze(['server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', '--sourcemap', '--outfile=dist/server.cjs']), nodeEnv: 'production' }),
});
export function resolveCommand(request, imageIdentity) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 2 || !Object.keys(request).every(k => ['profileId', 'commandId'].includes(k)) || request.profileId !== 'command-center-v1' || !Object.hasOwn(commands, request.commandId ?? ''))
        throw blocked('INVALID_VERIFICATION_PROFILE', 'Only a fixed profile and command ID may be requested');
    if (!/^sha256:[0-9a-f]{64}$/.test(imageIdentity?.digest ?? ''))
        throw blocked('INVALID_IMAGE_IDENTITY', 'Server-owned immutable image digest is required');
    const c = commands[request.commandId];
    return Object.freeze({ profileId: request.profileId, commandId: request.commandId, kind: c.kind, executable: '/usr/local/bin/node', args: Object.freeze([`/opt/cc-verifier/deps/node_modules/${c.tool}`, ...c.args]), cwd: '/verify/workspace', env: Object.freeze({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/verify/tmp', CI: '1', NODE_ENV: c.nodeEnv }), network: 'NO_NETWORK', timeoutMs: 180000, outputLimits: Object.freeze({ stdoutBytes: 1048576, stderrBytes: 262144 }), resourceLimits: Object.freeze({ cpus: 2, memoryMb: 2048, pids: 256, tmpfsBytes: 1073741824 }), requiredManifestHashes: Object.freeze({ packageJsonHash: APPROVED.packageJsonHash, packageLockHash: APPROVED.packageLockHash }), imageDigest: imageIdentity.digest });
}
/** Only server-owned, approved administrative image metadata may construct this alias. */
export function verifierImageAllowlist(identity) {
    if (!identity || !Object.keys(APPROVED).every(k => identity[k] === APPROVED[k]) || !/^sha256:[0-9a-f]{64}$/.test(identity.digest ?? '') || identity.reference !== `cc-verifier@${identity.digest}`)
        throw blocked('DEPENDENCY_PROFILE_MISMATCH', 'Verifier image identity does not match the approved baseline');
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_VERSION: '22.23.3', YARN_VERSION: '1.22.22' };
    if (!identity.expectedEnv || Object.keys(identity.expectedEnv).length !== 3 || !Object.entries(env).every(([k, v]) => identity.expectedEnv[k] === v) || JSON.stringify(identity.expectedEntrypoint) !== JSON.stringify(['/usr/bin/env', '--']))
        throw blocked('IMAGE_ENV_MISMATCH', 'Unexpected baked image environment or entrypoint');
    return Object.freeze({ 'command-center-verifier': Object.freeze({ reference: identity.reference, digest: identity.digest, os: 'linux', arch: 'arm64', roles: Object.freeze(['verifier']), expectedEnv: Object.freeze(env), expectedEntrypoint: Object.freeze(['/usr/bin/env', '--']) }) });
}
