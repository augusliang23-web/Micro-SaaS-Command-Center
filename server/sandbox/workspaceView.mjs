import fs from 'node:fs';
import path from 'node:path';

import { findEscapingSymlinks } from '../execution/symlinkGuard.mjs';
import { SandboxBlockedError, assertSafeWorkspacePath } from './pathSafety.mjs';

const MAX_ENTRIES = 500_000;

/** Any `.git` entry below the workspace root (submodules, nested repos) cannot be masked reliably. */
function findNestedGit(root) {
  const stack = [root];
  let scanned = 0;
  const found = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++scanned > MAX_ENTRIES) return { ok: false, reason: 'TOO_MANY_ENTRIES', found };
      const full = path.join(dir, entry.name);
      if (entry.name === '.git' && dir !== root) found.push(path.relative(root, full));
      else if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(full);
    }
  }
  return { ok: found.length === 0, found };
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
 * Blocks (does not mask) a workspace containing: escaping/dangling symlinks, a symlinked `.git`, or any
 * nested `.git`. This is a preflight signal, not full filesystem confinement (hard links and later-created
 * links are not covered) — see docs.
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

  const nested = findNestedGit(root);
  if (!nested.ok) throw new SandboxBlockedError('GIT_METADATA_UNSAFE', nested.reason === 'TOO_MANY_ENTRIES' ? 'Workspace is too large to scan for nested git metadata' : `Nested git metadata cannot be masked: ${nested.found.slice(0, 3).join(', ')}`);

  return { root, gitKind, symlinksScanned: symlinks.scanned };
}
