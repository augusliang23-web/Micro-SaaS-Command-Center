import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { DockerClient } from '../../server/sandbox/dockerClient.mjs';
import { DockerSandboxRuntime } from '../../server/sandbox/dockerSandboxRuntime.mjs';

export const DOCKER_BIN = process.env.CC_DOCKER_BIN || '/Applications/Docker.app/Contents/Resources/bin/docker';

export const realTmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
export const git = (cwd, ...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Scratch tree: <root>/outside/secret.txt (synthetic), <root>/src (git repo), <root>/wt (git worktree). */
export function makeScratch() {
  const root = realTmp('cc-p3b2-');
  fs.mkdirSync(path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, 'outside', 'secret.txt'), 'SYNTHETIC-HOST-SECRET-DO-NOT-LEAK\n');
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  git(src, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello from the worktree\n');
  git(src, 'add', '--all');
  git(src, 'commit', '-q', '-m', 'init');
  const wt = path.join(root, 'wt');
  git(src, 'worktree', 'add', '-q', wt, '-b', 'agent/scratch');
  return { root, src, wt, secret: path.join(root, 'outside', 'secret.txt'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function realRuntime(extra = {}) {
  const docker = new DockerClient({ dockerPath: DOCKER_BIN });
  return { docker, runtime: new DockerSandboxRuntime({ docker, commandCenterRoot: process.cwd(), ...extra }) };
}

export const POLICY = (extra = {}) => ({ network: 'NO_NETWORK', image: 'busybox-test', ...extra });
let counter = 0;
export const nextId = (prefix = 'itest') => `${prefix}-${process.pid}-${Date.now().toString(36)}-${counter++}`;
