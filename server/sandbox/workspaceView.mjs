import fs from 'node:fs';
import path from 'node:path';

import { findEscapingSymlinks } from '../execution/symlinkGuard.mjs';
import { SandboxBlockedError, assertSafeWorkspacePath } from './pathSafety.mjs';

const MAX_ENTRIES = 500_000;

/**
 * One pass over the workspace that finds (a) any `.git` entry below the root (submodules, nested repos —
 * cannot be masked reliably) and (b) regular files with more than one hard link.
 *
 * Hard links: a bind-mounted workspace can contain a regular file whose inode is ALSO referenced outside
 * the workspace (e.g. `workspace/leak` and `outside/secret`). Reading it would expose the outside content and,
 * if the workspace is writable, writing would modify the outside file. We cannot robustly tell which other
 * path owns an inode, so V1 fails closed: any regular file with link count > 1 blocks activation
 * (conservative: it also blocks workspaces that hard-link files among themselves, e.g. pnpm stores).
 * The root `.git` entry is masked, so it is not scanned.
 */
function scanWorkspace(root) {
  const stack = [root];
  let scanned = 0;
  const nestedGit = [];
  const hardLinks = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++scanned > MAX_ENTRIES) return { ok: false, reason: 'TOO_MANY_ENTRIES', nestedGit, hardLinks };
      const full = path.join(dir, entry.name);
      if (dir === root && entry.name === '.git') continue;
      if (entry.name === '.git') { nestedGit.push(path.relative(root, full)); continue; } // not descended into
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) stack.push(full);
      else if (stat.isFile() && stat.nlink > 1) hardLinks.push(path.relative(root, full));
    }
  }
  return { ok: nestedGit.length === 0 && hardLinks.length === 0, nestedGit, hardLinks };
}

/**
 * Decide what a container may see of one task worktree.
 *
 * Git metadata boundary: a `git worktree` keeps a `.git` FILE that points (by absolute path) into the
 * shared `<source>/.git/worktrees/<name>` directory. That shared metadata is never mounted, so the pointer
 * dangles inside the container; additionally the `.git` entry itself is MASKED so the container sees an
 * empty read-only file (or an empty read-only tmpfs for a `.git` directory) and cannot read the host path
 * it names, modify it, or replace it. The container therefore has no Git authority, and the host (which owns
 * all git operations) is unaffected by anything the container does to the visible files.
 *
 * Blocks (does not mask) a workspace containing: escaping/dangling symlinks, a symlinked `.git`, any nested
 * `.git`, or any regular file with more than one hard link. Links the agent creates later cannot reach outside
 * the mount, and the scan is repeated immediately before start.
 */
export function inspectWorkspace(worktreePath, { commandCenterRoot, homeDir, stateRoot } = {}) {
  const root = assertSafeWorkspacePath(worktreePath, { commandCenterRoot, homeDir, stateRoot });

  const symlinks = findEscapingSymlinks(root);
  if (!symlinks.ok) {
    throw new SandboxBlockedError('SYMLINK_ESCAPE', symlinks.reason === 'TOO_MANY_ENTRIES'
      ? 'Workspace is too large to scan for symlink escapes'
      : `Workspace contains ${symlinks.escapes.length} escaping/dangling symlink(s): ${symlinks.escapes.slice(0, 3).map((e) => e.path).join(', ')}`);
  }

  let gitKind = null;
  try {
    const stat = fs.lstatSync(path.join(root, '.git'));
    if (stat.isSymbolicLink()) throw new SandboxBlockedError('GIT_METADATA_UNSAFE', 'A symlinked .git cannot be masked');
    gitKind = stat.isDirectory() ? 'dir' : 'file';
  } catch (error) {
    if (error instanceof SandboxBlockedError) throw error;
    if (error.code !== 'ENOENT') throw error;
  }

  const scan = scanWorkspace(root);
  if (scan.reason === 'TOO_MANY_ENTRIES') throw new SandboxBlockedError('WORKSPACE_TOO_LARGE', 'Workspace is too large to scan for nested git metadata and hard links');
  if (scan.hardLinks.length > 0) throw new SandboxBlockedError('HARDLINK_UNSAFE', `Workspace contains ${scan.hardLinks.length} regular file(s) with more than one hard link (the inode may be shared with a path outside the workspace): ${scan.hardLinks.slice(0, 3).join(', ')}`);
  if (scan.nestedGit.length > 0) throw new SandboxBlockedError('GIT_METADATA_UNSAFE', `Nested git metadata cannot be masked: ${scan.nestedGit.slice(0, 3).join(', ')}`);

  return { root, gitKind, symlinksScanned: symlinks.scanned };
}
