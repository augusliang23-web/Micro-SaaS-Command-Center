import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VerificationRunner } from '../server/verifier/verificationRunner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runGit = args => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', shell: false });
const controlPlaneRoot = path.dirname(fs.realpathSync(runGit(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()));
if (process.argv.length !== 3 || process.argv[2] !== '--run-clean-candidate') throw new Error('Controlled verifier harness requires --run-clean-candidate');
if (runGit(['branch', '--show-current']).trim() !== 'codex/agent-console-phase3b3b2-verification-runner') throw new Error('UNEXPECTED_CANDIDATE_BRANCH');
if (runGit(['status', '--porcelain']).trim()) throw new Error('CANDIDATE_WORKTREE_NOT_CLEAN');
const head = runGit(['rev-parse', 'HEAD']).trim();
const baseline = runGit(['rev-parse', 'origin/main']).trim();
try { execFileSync('/usr/bin/git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], { cwd: root, stdio: 'ignore', shell: false }); }
catch { throw new Error('CANDIDATE_BASELINE_MISMATCH'); }
if (baseline !== 'b4197d846b1e2a38eb1b6d4bb079c62052be176c') throw new Error('CANDIDATE_BASELINE_MISMATCH');
const b1 = JSON.parse(fs.readFileSync(path.join(root, 'server/verifier/verifierImageIdentity.json'), 'utf8'));
const runner = new VerificationRunner({ sourcePath: root, imageIdentity: b1, commandCenterRoot: controlPlaneRoot, privatePaths: ['.bridge', '.superpowers', 'data', 'projects.local.json'] });
const result = await runner.run();
process.stdout.write(`${JSON.stringify({ candidateHead: head, baseline, result }, null, 2)}\n`);
if (result.state !== 'PASS') process.exitCode = 1;
