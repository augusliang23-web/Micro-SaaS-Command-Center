// Explicit administrative command, never imported by the application or Orchestrator.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDependencyIdentity } from './foundation.mjs';
import { APPROVED } from './image/approvedIdentity.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const imageFiles = ['Dockerfile', 'approvedIdentity.mjs', 'bootstrap.mjs', 'capabilities.mjs', 'empty-user.npmrc', 'empty-global.npmrc', 'snapshotInventory.mjs'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function createProvisioningContext(manifestRoot, destination) {
    if (checkDependencyIdentity(manifestRoot).state !== 'MATCH')
        throw new Error('DEPENDENCY_PROFILE_MISMATCH');
    fs.mkdirSync(destination, { mode: 0o700 });
    try {
        for (const name of ['package.json', 'package-lock.json'])
            fs.copyFileSync(path.join(manifestRoot, name), path.join(destination, name), fs.constants.COPYFILE_EXCL);
        if (checkDependencyIdentity(destination).state !== 'MATCH')
            throw new Error('DEPENDENCY_PROFILE_MISMATCH');
        for (const name of imageFiles)
            fs.copyFileSync(path.join(here, 'image', name), path.join(destination, name), fs.constants.COPYFILE_EXCL);
        return Object.fromEntries(fs.readdirSync(destination).sort().map(name => [name, sha(fs.readFileSync(path.join(destination, name)))]));
    }
    catch (error) {
        fs.rmSync(destination, { recursive: true, force: true });
        throw error;
    }
}
export function provisionApprovedImage({ manifestRoot, dockerPath = '/Applications/Docker.app/Contents/Resources/bin/docker' }) {
    if (!path.isAbsolute(dockerPath) || path.normalize(dockerPath) !== dockerPath)
        throw new Error('Absolute Docker binary required');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-verifier-provision-')));
    const context = path.join(root, 'context'), metadata = path.join(root, 'metadata.json');
    const env = { HOME: os.homedir(), PATH: `${path.dirname(dockerPath)}:/usr/bin:/bin` };
    const run = args => execFileSync(dockerPath, args, { env, shell: false, encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
    try {
        const inputHashes = createProvisioningContext(manifestRoot, context);
        const base = JSON.parse(run(['image', 'inspect', APPROVED.baseReference]))[0];
        if (base.Os !== 'linux' || base.Architecture !== 'arm64' || !base.RepoDigests?.includes(APPROVED.baseReference))
            throw new Error('IMAGE_RESOLUTION_BLOCKED');
        run(['buildx', 'build', '--platform=linux/arm64', '--pull=false', '--provenance=false', '--load', `--metadata-file=${metadata}`, '--tag=cc-verifier:phase3b3b1', context]);
        const info = JSON.parse(run(['image', 'inspect', 'cc-verifier:phase3b3b1']))[0];
        const built = JSON.parse(fs.readFileSync(metadata, 'utf8'));
        const digest = built['containerimage.digest'];
        if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? ''))
            throw new Error('FINAL_IMAGE_DIGEST_UNKNOWN');
        const reference = `cc-verifier@${digest}`;
        const pinned = JSON.parse(run(['image', 'inspect', reference]))[0];
        if (pinned.Id !== info.Id || pinned.Os !== 'linux' || pinned.Architecture !== 'arm64')
            throw new Error('FINAL_IMAGE_IDENTITY_MISMATCH');
        const expectedEntrypoint = ['/usr/bin/env', '--'];
        const expectedEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_VERSION: '22.23.3', YARN_VERSION: '1.22.22' };
        if (JSON.stringify([...info.Config.Env].sort()) !== JSON.stringify(Object.entries(expectedEnv).map(([k, v]) => `${k}=${v}`).sort()) || JSON.stringify(info.Config.Entrypoint) !== JSON.stringify(expectedEntrypoint))
            throw new Error('FINAL_IMAGE_ENV_MISMATCH');
        const capabilities = JSON.parse(run(['run', '--rm', '--pull=never', '--network=none', '--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=64', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m', reference, '/usr/local/bin/node', '/opt/cc-verifier/capabilities.mjs']));
        if (capabilities.node !== APPROVED.node || capabilities.npm !== APPROVED.npm || capabilities.arch !== 'arm64')
            throw new Error('IMAGE_TOOLCHAIN_MISMATCH');
        return { ...APPROVED, baseImageId: base.Id, baseVariant: base.Variant ?? null, digest, reference, imageId: info.Id, sizeBytes: info.Size, expectedEnv, expectedEntrypoint, inputHashes, capabilities, observedAt: new Date().toISOString() };
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 3 || process.argv[2] !== '--provision-approved')
        throw new Error('Administrative provisioning requires --provision-approved; no automatic runtime provisioning');
    const identity = provisionApprovedImage({ manifestRoot: path.resolve(here, '../..') });
    fs.writeFileSync(path.join(here, 'verifierImageIdentity.json'), JSON.stringify(identity, null, 2) + '\n', { flag: 'w' });
    console.log(JSON.stringify(identity, null, 2));
}
