import fs from 'node:fs';
import path from 'node:path';

/**
 * Reusable, UNWIRED helper for the Phase 3B activation gate.
 *
 * A correct `cwd` does not confine an agent: a symlink committed inside a
 * repository can point outside the worktree, and file tools or later git/build
 * steps would follow it. This scans a canonical worktree for symlinks whose
 * target (lexically or after resolving the chain) leaves the root. It reports;
 * it does not repair, and it is not a sandbox. Hard links and mount points are
 * not detectable here and remain a Phase 3B concern.
 */
export function findEscapingSymlinks(root, { maxEntries = 200_000 } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('root must be an absolute path');
  const realRoot = fs.realpathSync(root);
  if (realRoot !== root) throw new Error('root must be canonical');
  const inside = (candidate) => { const r = path.relative(realRoot, candidate); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

  const escapes = [];
  const stack = [realRoot];
  let scanned = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue; // repository metadata is guarded by the git integrity checks
      if (++scanned > maxEntries) return { ok: false, reason: 'TOO_MANY_ENTRIES', escapes, scanned };
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        const lexical = path.resolve(dir, target);
        let resolved = null;
        try { resolved = fs.realpathSync(full); } catch { /* dangling */ }
        if (path.isAbsolute(target) && !inside(lexical)) escapes.push({ path: path.relative(realRoot, full), reason: 'ABSOLUTE_TARGET_OUTSIDE' });
        else if (!inside(lexical)) escapes.push({ path: path.relative(realRoot, full), reason: 'TARGET_OUTSIDE' });
        else if (resolved !== null && !inside(resolved)) escapes.push({ path: path.relative(realRoot, full), reason: 'CHAIN_ESCAPES' });
        else if (resolved === null) escapes.push({ path: path.relative(realRoot, full), reason: 'DANGLING' });
      } else if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
  return { ok: escapes.length === 0, escapes: escapes.sort((a, b) => a.path.localeCompare(b.path)), scanned };
}
