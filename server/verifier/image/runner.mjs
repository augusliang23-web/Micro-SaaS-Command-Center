import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareWorkspace } from './bootstrap.mjs';
import { fingerprintSnapshot } from './snapshotInventory.mjs';
import { APPROVED } from './approvedIdentity.mjs';
import { COMMAND_CENTER_V1_PROFILE, RUNNER_INTERNAL_ERROR_EXIT, resolveProfileCommand } from './verificationProfile.mjs';

const sha = value => /^[0-9a-f]{64}$/.test(value ?? '');
export async function runTrustedCommand({ argv = process.argv.slice(2), root = '/workspace', verifyPath = '/verify/workspace' } = {}) {
  if (argv.length !== 4 || argv[0] !== 'run' || !sha(argv[1]) || argv[2] !== COMMAND_CENTER_V1_PROFILE.id) throw new Error('INVALID_RUNNER_REQUEST');
  const expectedFingerprint = argv[1];
  const before = fingerprintSnapshot(root).fingerprint;
  if (before !== expectedFingerprint) throw new Error(`SNAPSHOT_IDENTITY_MISMATCH:${expectedFingerprint}:${before}`);
  let prepared;
  try { prepared = prepareWorkspace({ sourcePath: root, targetPath: verifyPath, expectedFingerprint }); }
  catch (error) {
    if (/SNAPSHOT_IDENTITY_MISMATCH/.test(error.message)) {
      const after = fingerprintSnapshot(root).fingerprint;
      throw new Error(`SNAPSHOT_IDENTITY_MISMATCH:prepare:${expectedFingerprint}:${after}:${error.message}`);
    }
    throw error;
  }
  const after = fingerprintSnapshot(root).fingerprint;
  if (after !== expectedFingerprint || prepared.sourceFingerprint !== expectedFingerprint) throw new Error(`SNAPSHOT_IDENTITY_MISMATCH:${expectedFingerprint}:${after}`);
  const command = resolveProfileCommand(argv[2], argv[3]);
  await new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { cwd: verifyPath, env: command.env, shell: false, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  }).then(code => { process.exitCode = code; });
  return { snapshotFingerprint: expectedFingerprint, profileId: argv[2], commandId: argv[3], exitCode: process.exitCode ?? 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTrustedCommand().catch(error => { process.stderr.write(`${error.code ?? 'RUNNER_ERROR'}:${error.message}\n`); process.exitCode = RUNNER_INTERNAL_ERROR_EXIT; });
}
