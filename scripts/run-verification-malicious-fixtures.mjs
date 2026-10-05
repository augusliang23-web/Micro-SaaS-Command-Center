import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VerificationRunner } from '../server/verifier/verificationRunner.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args, cwd = repo) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', shell: false });
const controlPlaneRoot = path.dirname(fs.realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()));
if (process.argv.length !== 3 || process.argv[2] !== '--run-synthetic-fixtures') throw new Error('Synthetic fixture harness requires --run-synthetic-fixtures');
if (git(['branch', '--show-current']) !== 'codex/agent-console-phase3b3b2-verification-runner\n' || git(['status', '--porcelain']).trim()) throw new Error('CANDIDATE_MUST_BE_CLEAN');
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-verifier-fixtures-')));
const source = path.join(temporaryRoot, 'source');
const secret = path.join(temporaryRoot, 'synthetic-host-secret.txt');
fs.writeFileSync(secret, 'SYNTHETIC_SECRET_MUST_NEVER_BE_VISIBLE', { mode: 0o600 });
const b1 = JSON.parse(fs.readFileSync(path.join(repo, 'server/verifier/verifierImageIdentity.json'), 'utf8'));
const writeTest = sourceText => fs.writeFileSync(path.join(source, 'src/VerificationBoundary.test.tsx'), sourceText);
const containerTest = `// @ts-nocheck
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
describe('synthetic verifier boundaries', () => {
  it('cannot read the synthetic host secret or Docker socket', () => {
    expect(fs.existsSync(${JSON.stringify(secret)})).toBe(false);
    expect(() => fs.readFileSync('/var/run/docker.sock')).toThrow();
    expect(() => fs.readFileSync('/run/docker.sock')).toThrow();
  });
  it('cannot read Git metadata or write to the snapshot mount', () => {
    expect(fs.existsSync('/workspace/.git')).toBe(false);
    expect(() => fs.writeFileSync('/workspace/host-snapshot-tamper', 'changed')).toThrow();
  });
  it('cannot reach an external address with NO_NETWORK', async () => {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '198.51.100.1', port: 9 });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('network attempt did not fail promptly')); }, 1200);
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('external network unexpectedly connected')); });
      socket.once('error', () => { clearTimeout(timer); resolve(); });
    });
  });
  it('observes Docker resource ceilings and cannot exceed the PID limit', async () => {
    const memory = Number(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim());
    const pids = Number(fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim());
    expect(memory).toBe(2147483648); expect(pids).toBe(256);
    const children = []; let refused = false;
    for (let i = 0; i < 300; i++) {
      const child = spawn('/bin/sleep', ['30'], { shell: false, stdio: 'ignore' });
      const outcome = await new Promise(resolve => { child.once('spawn', () => resolve('spawn')); child.once('error', error => resolve(error.code)); });
      if (outcome === 'spawn') children.push(child);
      else { refused = outcome === 'EAGAIN'; break; }
    }
    for (const child of children) child.kill('SIGKILL');
    await Promise.all(children.map(child => new Promise(resolve => child.once('close', resolve))));
    expect(refused).toBe(true);
    expect(children.length).toBeLessThan(pids);
  });
});`;
try {
  git(['worktree', 'add', '--detach', source, 'HEAD']);
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  const run = async mode => {
    const controller = new VerificationRunner({ sourcePath: source, imageIdentity: b1, commandCenterRoot: controlPlaneRoot, privatePaths: ['.bridge', '.superpowers', 'data', 'projects.local.json'] });
    const result = await controller.run();
    const summary = { mode, state: result.state, commands: result.commands.map(item => ({ commandId: item.commandId, state: item.state, code: item.evidence?.failureReason ?? item.code, destroyed: item.evidence?.cleanup?.state ?? null })) };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return result;
  };
  writeTest(containerTest);
  const contained = await run('containment-and-resource-limits');
  if (contained.state !== 'PASS') throw new Error('SYNTHETIC_CONTAINMENT_PROFILE_NOT_PASS');
  writeTest(`${containerTest}\nit('memory over-limit is terminated by the container', async () => { const child = spawn('/usr/local/bin/node', ['-e', \"const a=[]; for(let i=0;i<256;i++){const b=Buffer.alloc(16*1024*1024); b.fill(1); a.push(b)}\"], { shell: false, stdio: 'ignore' }); const outcome = await new Promise(resolve => { const timer=setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 12000); child.once('close', (code, signal) => { clearTimeout(timer); resolve(signal ?? code); }); }); expect(outcome).toBe('SIGKILL'); });`);
  const memoryLimit = await run('memory-limit');
  if (memoryLimit.state !== 'FAIL' || memoryLimit.commands[0]?.evidence?.failureReason !== 'OOM_KILLED' || memoryLimit.commands.slice(1).some(item => item.state !== 'NOT_RUN')) throw new Error('MEMORY_LIMIT_NEGATIVE_PROOF_FAILED');
  writeTest(`${containerTest}\nprocess.stdout.write('PASS all tests passed\\n'); describe('synthetic fake result', () => { it('fails despite PASS output', () => { expect(true).toBe(false); }); });`);
  const fakePass = await run('fake-pass-with-nonzero-exit');
  if (fakePass.state !== 'FAIL' || fakePass.commands[0]?.state !== 'FAIL' || fakePass.commands.slice(1).some(item => item.state !== 'NOT_RUN')) throw new Error('FAKE_PASS_NEGATIVE_PROOF_FAILED');
  writeTest(`${containerTest}\nit('exceeds the output cap', () => { process.stdout.write('x'.repeat(2 * 1024 * 1024)); });`);
  const overflow = await run('output-overflow');
  if (overflow.state !== 'UNKNOWN' || overflow.commands[0]?.state !== 'UNKNOWN' || overflow.commands[0]?.evidence?.cleanup?.state !== 'DESTROYED') throw new Error('OUTPUT_LIMIT_NEGATIVE_PROOF_FAILED');
} finally {
  try { git(['worktree', 'remove', '--force', source]); } catch { /* preserve temp workspace for manual inspection if Git cannot detach it */ }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
