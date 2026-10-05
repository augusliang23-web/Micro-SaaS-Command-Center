import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const B1 = JSON.parse(fs.readFileSync(new URL('./verifierImageIdentity.json', import.meta.url), 'utf8'));

const here = path.dirname(fileURLToPath(import.meta.url));
const approvedFiles = {
  'bootstrap.mjs': path.join(here, 'image/bootstrap.mjs'),
  'snapshotInventory.mjs': path.join(here, 'image/snapshotInventory.mjs'),
  'approvedIdentity.mjs': path.join(here, 'image/approvedIdentity.mjs'),
  'runner.mjs': path.join(here, 'image/runner.mjs'),
  'verificationProfile.mjs': path.join(here, 'verificationProfile.mjs'),
};
const digestFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function buildRunnerImage({ dockerPath = '/Applications/Docker.app/Contents/Resources/bin/docker', identityPath = path.join(here, 'verificationRunnerImageIdentity.json') } = {}) {
  if (!path.isAbsolute(dockerPath) || path.normalize(dockerPath) !== dockerPath) throw new Error('ABSOLUTE_DOCKER_BINARY_REQUIRED');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-verification-runner-build-')));
  const context = path.join(root, 'context'); const metadataPath = path.join(root, 'metadata.json');
  fs.mkdirSync(context, { mode: 0o700 });
  const env = { HOME: os.homedir(), PATH: `${path.dirname(dockerPath)}:/usr/bin:/bin` };
  const run = args => execFileSync(dockerPath, args, { cwd: '/', env, shell: false, encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
  try {
    const parent = JSON.parse(run(['image', 'inspect', B1.reference]))[0];
    if (parent.Id !== B1.imageId || parent.Os !== 'linux' || parent.Architecture !== 'arm64' || !parent.RepoDigests?.includes(B1.reference)) throw new Error('B1_IMAGE_IDENTITY_MISMATCH');
    const localParent = JSON.parse(run(['image', 'inspect', 'cc-verifier:phase3b3b1']))[0];
    if (localParent.Id !== parent.Id) throw new Error('B1_LOCAL_TAG_IDENTITY_MISMATCH');
    const hashes = {};
    for (const [name, source] of Object.entries(approvedFiles)) { fs.copyFileSync(source, path.join(context, name), fs.constants.COPYFILE_EXCL); hashes[name] = digestFile(path.join(context, name)); }
    fs.copyFileSync(path.join(here, 'image/runner.Dockerfile'), path.join(context, 'Dockerfile'), fs.constants.COPYFILE_EXCL);
    hashes['Dockerfile'] = digestFile(path.join(context, 'Dockerfile'));
    const dockerfile = fs.readFileSync(path.join(context, 'Dockerfile'), 'utf8');
    if (!dockerfile.startsWith('FROM cc-verifier:phase3b3b1\n') || /npm\s+(ci|install)|registry\.|https?:\/\//i.test(dockerfile.replace(/^FROM .*$/m, ''))) throw new Error('RUNNER_LAYER_DEPENDENCY_POLICY_REJECTED');
    run(['buildx', 'build', '--platform=linux/arm64', '--pull=false', '--network=none', '--provenance=false', '--load', '--metadata-file', metadataPath, '--tag=cc-verification-runner:phase3b3b2', context]);
    const build = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const digest = build['containerimage.digest'];
    if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) throw new Error('RUNNER_IMAGE_DIGEST_UNKNOWN');
    const reference = `cc-verification-runner@${digest}`;
    const image = JSON.parse(run(['image', 'inspect', 'cc-verification-runner:phase3b3b2']))[0];
    const pinned = JSON.parse(run(['image', 'inspect', reference]))[0];
    if (image.Id !== pinned.Id || image.Os !== 'linux' || image.Architecture !== 'arm64' || !pinned.RepoDigests?.includes(reference)) throw new Error('RUNNER_IMAGE_PIN_READBACK_FAILED');
    const parentEnv = B1.expectedEnv;
    if (JSON.stringify([...image.Config.Env].sort()) !== JSON.stringify(Object.entries(parentEnv).map(([key, value]) => `${key}=${value}`).sort()) || JSON.stringify(image.Config.Entrypoint) !== JSON.stringify(B1.expectedEntrypoint)) throw new Error('RUNNER_IMAGE_CONFIG_CHANGED');
    const identity = { parentB1Digest: B1.digest, parentB1Tag: 'cc-verifier:phase3b3b1', parentB1ImageId: parent.Id, runnerHash: hashes['runner.mjs'], profileHash: hashes['verificationProfile.mjs'], bootstrapHash: hashes['bootstrap.mjs'], snapshotInventoryHash: hashes['snapshotInventory.mjs'], approvedIdentityHash: hashes['approvedIdentity.mjs'], dockerfileHash: hashes.Dockerfile, platform: 'linux/arm64', digest, reference, imageId: image.Id, expectedEnv: B1.expectedEnv, expectedEntrypoint: B1.expectedEntrypoint, builtWithNetwork: 'none', externalPulls: false, observedAt: new Date().toISOString() };
    fs.writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    return identity;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--build-offline') throw new Error('Explicit offline runner image build required');
  process.stdout.write(`${JSON.stringify(buildRunnerImage(), null, 2)}\n`);
}
