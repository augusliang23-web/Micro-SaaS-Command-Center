import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class SandboxBlockedError extends Error {
  constructor(code, message) { super(message); this.name = 'SandboxBlockedError'; this.code = code; }
}

// Directories that must never be mounted, be inside a mount, or be an ancestor of one that holds them.
const SYSTEM_DIRS = ['/', '/Users', '/private', '/private/var', '/private/tmp', '/private/etc', '/tmp', '/var', '/etc', '/usr', '/bin', '/sbin', '/opt', '/System', '/Library', '/Volumes', '/dev', '/proc'];
const HOME_SENSITIVE = ['.docker', '.ssh', '.gnupg', '.aws', '.config', '.claude', '.codex', '.npmrc', '.kube', '.gcloud', '.azure', '.netrc', '.gitconfig', 'Library'];
const DOCKER_SOCKETS = ['/var/run/docker.sock', '/run/docker.sock', '/private/var/run/docker.sock'];

const within = (parent, child) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/**
 * One shared, strict check for any host path that may become a sandbox workspace.
 * It is a policy gate for the mount SOURCE: absolute, canonical, existing directory,
 * outside the Command Center checkout, not home / filesystem root / system dirs, not
 * holding credentials or a Docker socket, and free of characters that could alter
 * Docker's `--mount` option syntax (commas, quotes, newlines).
 */
export function assertSafeWorkspacePath(workspacePath, { commandCenterRoot = process.cwd(), homeDir = os.homedir(), stateRoot } = {}) {
  const blocked = (code, message) => new SandboxBlockedError(code, message);
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || /[\0\n\r,"']/.test(workspacePath)) {
    throw blocked('INVALID_WORKSPACE', 'Workspace must be an absolute path without commas, quotes or control characters');
  }
  let real;
  try { real = fs.realpathSync(workspacePath); } catch { throw blocked('INVALID_WORKSPACE', 'Workspace does not exist'); }
  if (real !== workspacePath) throw blocked('INVALID_WORKSPACE', 'Workspace must be canonical (no symlinks or trailing segments)');
  if (!fs.statSync(real).isDirectory()) throw blocked('INVALID_WORKSPACE', 'Workspace must be a directory');

  const realHome = fs.realpathSync(homeDir);
  const realRoot = fs.realpathSync(commandCenterRoot);
  if (SYSTEM_DIRS.includes(real)) throw blocked('FORBIDDEN_WORKSPACE', 'Workspace may not be a system directory or the filesystem root');
  if (real === realHome) throw blocked('FORBIDDEN_WORKSPACE', 'Workspace may not be the home directory');
  if (within(real, realHome)) throw blocked('FORBIDDEN_WORKSPACE', 'Workspace may not contain the home directory'); // ancestors of home
  if (within(real, realRoot)) throw blocked('FORBIDDEN_WORKSPACE', 'Workspace may not be the Command Center checkout, an ancestor or a path inside it');
  if (within(realRoot, real)) throw blocked('FORBIDDEN_WORKSPACE', 'Workspace may not be inside the Command Center checkout');
  for (const name of HOME_SENSITIVE) {
    const sensitive = path.join(realHome, name);
    if (within(sensitive, real) || within(real, sensitive)) throw blocked('FORBIDDEN_WORKSPACE', `Workspace may not overlap ${name}`);
  }
  for (const socket of [...DOCKER_SOCKETS, path.join(realHome, '.docker', 'run', 'docker.sock')]) {
    if (within(real, socket)) throw blocked('FORBIDDEN_WORKSPACE', 'Workspace may not contain a Docker socket');
  }
  if (stateRoot && (within(real, stateRoot) || within(stateRoot, real))) throw blocked('FORBIDDEN_WORKSPACE', 'Workspace may not overlap the sandbox state directory');
  return real;
}
