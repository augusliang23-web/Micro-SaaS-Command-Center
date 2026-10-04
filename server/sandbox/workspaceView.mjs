import fs from 'node:fs';
import path from 'node:path';

import { findEscapingSymlinks } from '../execution/symlinkGuard.mjs';
import { SandboxBlockedError, assertSafeWorkspacePath } from './pathSafety.mjs';

const MAX_ENTRIES = 500_000;

/**
 * Classify one lstat result. Only directories and ordinary regular files are acceptable workspace content;
 * symlinks are governed by the separate symlink gate. Anything else — Unix socket, FIFO, block/character device,
 * or a node type we do not recognise — is reported as `special` and blocks activation (never silently skipped).
 */
export function classifyNode(stat) {
  if (stat.isSymbolicLink()) return { kind: 'symlink' };
  if (stat.isDirectory()) return { kind: 'dir' };
  if (stat.isFile()) return { kind: 'file' };
  if (stat.isSocket()) return { kind: 'special', what: 'socket' };
  if (stat.isFIFO()) return { kind: 'special', what: 'fifo' };
  if (stat.isBlockDevice()) return { kind: 'special', what: 'block-device' };
  if (stat.isCharacterDevice()) return { kind: 'special', what: 'character-device' };
  return { kind: 'special', what: 'unknown' };
}

/**
 * One pass over the workspace that finds (a) any `.git` entry below the root (submodules, nested repos —
 * cannot be masked reliably), (b) regular files with more than one hard link, (c) special filesystem nodes
 * (socket, FIFO, device, unknown) and (d) filesystem boundaries.
 *
 * Hard links: a bind-mounted workspace can contain a regular file whose inode is ALSO referenced outside
 * the workspace (e.g. `workspace/leak` and `outside/secret`). We cannot robustly tell which other
 * path owns an inode, so V1 fails closed: any regular file with link count > 1 blocks activation.
 *
 * Special nodes: a socket or device inside the mount can reach a host service or device; a FIFO can block a
 * reader. Allowed content is only directories and regular files.
 *
 * Filesystem boundary: an entry whose `st_dev` differs from the workspace root's lies on another filesystem,
 * i.e. a host mount point sits below the workspace. Detection limits: this sees mounts of a DIFFERENT device only;
 * a bind mount of the same filesystem keeps the same `st_dev` and is invisible to it, and a mount can still appear
 * after the scan (hence the re-scan before start). The primary containment is Docker's non-recursive bind
 * (`bind-recursive=disabled`), which keeps submounts out of the container regardless of what this scan sees.
 * Verified on macOS: APFS firmlinked volumes share one `st_dev`, ordinary worktrees and a 14k-entry node_modules
 * produce no boundary; `/dev` (devfs) differs from `/`.
 *
 * The root `.git` entry is masked, so it is not scanned. `lstat` is injectable for tests.
 */
export function scanWorkspace(root, { lstat = fs.lstatSync } = {}) {
  const rootDev = lstat(root).dev;
  const stack = [root];
  let scanned = 0;
  const found = { nestedGit: [], hardLinks: [], special: [], boundaries: [] };
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++scanned > MAX_ENTRIES) return { ok: false, reason: 'TOO_MANY_ENTRIES', ...found };
      const full = path.join(dir, entry.name);
      if (dir === root && entry.name === '.git') continue;
      if (entry.name === '.git') { found.nestedGit.push(path.relative(root, full)); continue; } // not descended into
      const stat = lstat(full);
      const node = classifyNode(stat);
      if (node.kind === 'symlink') continue;
      const rel = path.relative(root, full);
      if (stat.dev !== rootDev) { found.boundaries.push(rel); continue; } // never descended into
      if (node.kind === 'special') found.special.push(`${rel} (${node.what})`);
      else if (node.kind === 'dir') stack.push(full);
      else if (stat.nlink > 1) found.hardLinks.push(rel);
    }
  }
  return { ok: Object.values(found).every((l) => l.length === 0), ...found };
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
 * `.git`, any regular file with more than one hard link, any special node (socket/FIFO/device/unknown) or any
 * entry on another filesystem. Links the agent creates later cannot reach outside
 * the mount, and the scan is repeated immediately before start.
 */
export function inspectWorkspace(worktreePath, { commandCenterRoot, homeDir, stateRoot, lstat } = {}) {
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

  const scan = scanWorkspace(root, lstat ? { lstat } : undefined);
  if (scan.reason === 'TOO_MANY_ENTRIES') throw new SandboxBlockedError('WORKSPACE_TOO_LARGE', 'Workspace is too large to scan for nested git metadata and hard links');
  if (scan.hardLinks.length > 0) throw new SandboxBlockedError('HARDLINK_UNSAFE', `Workspace contains ${scan.hardLinks.length} regular file(s) with more than one hard link (the inode may be shared with a path outside the workspace): ${scan.hardLinks.slice(0, 3).join(', ')}`);
  if (scan.special.length > 0) throw new SandboxBlockedError('SPECIAL_FILE_UNSAFE', `Workspace contains ${scan.special.length} special filesystem node(s) (only directories and regular files are allowed): ${scan.special.slice(0, 3).join(', ')}`);
  if (scan.boundaries.length > 0) throw new SandboxBlockedError('MOUNT_BOUNDARY_UNSAFE', `Workspace contains ${scan.boundaries.length} entr(ies) on a different filesystem than the workspace root (a host mount below the workspace): ${scan.boundaries.slice(0, 3).join(', ')}`);
  if (scan.nestedGit.length > 0) throw new SandboxBlockedError('GIT_METADATA_UNSAFE', `Nested git metadata cannot be masked: ${scan.nestedGit.slice(0, 3).join(', ')}`);

  return { root, gitKind, symlinksScanned: symlinks.scanned };
}
