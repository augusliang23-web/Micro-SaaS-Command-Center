// ZC-MVP-B1 Local Bridge core: scope guard.
// Issue #119. MOCK-ONLY, OFFLINE: reads only inside a caller-supplied fixture
// directory; never follows symlinks; never touches a real product repository.
//
// Two jobs:
//   1. validateScopePaths(): exact, normalised allowlist of repo-relative paths.
//   2. takeSnapshot()/compareSnapshots(): post-run "diff" check of a workspace
//      against its baseline (out-of-scope paths, symlinks, mode drift, binary
//      content, oversize files, special files).
// Provenance: new design for ZC-MVP-B1 (Issue #118 sections 5.2/6.5); no code
// reused from other repositories.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BridgeError, fail} from './state-machine.mjs';

export const SCOPE_LIMITS = Object.freeze({
  maxPaths: 8,
  maxPathLength: 180,
  maxEntries: 2000,
  maxDepth: 12,
  maxFileBytes: 262144,
  maxTotalBytes: 8388608,
  maxChangedFiles: 8,
  maxViolations: 50,
});

const SAFE_PATH = /^(tools|test|docs)\/[A-Za-z0-9._/-]+$/;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
// Compared case-insensitively: macOS volumes are case-insensitive by default.
const PROTECTED_NAMES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock',
  'pnpm-lock.yaml', 'bun.lockb', 'server.ts', 'claude.md', 'agents.md',
  'node_modules', '.git', '.github', '.gitignore', '.gitattributes',
  '.npmrc', '.nvmrc',
]);

export function isProtectedPath(p) {
  if (typeof p !== 'string') return true;
  return p.split('/').some(seg => {
    const s = seg.toLowerCase();
    return PROTECTED_NAMES.has(s) || s.startsWith('.env');
  });
}

// Returns a sorted copy, or throws BridgeError with INVALID_SCOPE_PATHS /
// PROTECTED_SCOPE_PATH (one stable code per class keeps callers simple).
export function validateScopePaths(paths, limits = SCOPE_LIMITS) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > limits.maxPaths)
    fail('INVALID_SCOPE_PATHS');
  const seen = new Set();
  for (const p of paths) {
    if (typeof p !== 'string' || p.length > limits.maxPathLength ||
        !SAFE_PATH.test(p) || p.includes('//') || p.endsWith('/'))
      fail('INVALID_SCOPE_PATHS');
    const segs = p.split('/');
    if (segs.some(s => s === '' || s === '.' || s === '..' || s.startsWith('.')))
      fail('INVALID_SCOPE_PATHS');
    if (isProtectedPath(p)) fail('PROTECTED_SCOPE_PATH');
    const folded = p.toLowerCase();
    if (seen.has(folded)) fail('INVALID_SCOPE_PATHS');
    seen.add(folded);
  }
  return [...paths].sort();
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function readNoFollow(io, file, size) {
  const c = io.constants ?? fs.constants;
  if (typeof c.O_NOFOLLOW !== 'number') fail('NOFOLLOW_UNSUPPORTED');
  const fd = io.openSync(file, c.O_RDONLY | c.O_NOFOLLOW);
  try {
    const st = io.fstatSync(fd);
    if (!st.isFile()) fail('SNAPSHOT_RACE');
    const buf = Buffer.alloc(Math.min(size, st.size));
    let off = 0;
    while (off < buf.length) {
      const n = io.readSync(fd, buf, off, buf.length - off, off);
      if (n <= 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    io.closeSync(fd);
  }
}

// Digest of a single file for tripwire checks. Missing/unsafe -> stable marker,
// so a deleted or replaced sentinel also counts as "changed".
export function fileDigest(file, io = fs) {
  try {
    const st = io.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > SCOPE_LIMITS.maxFileBytes)
      return 'UNSAFE';
    return sha256(readNoFollow(io, file, SCOPE_LIMITS.maxFileBytes));
  } catch (e) {
    return e?.code === 'ENOENT' ? 'MISSING' : 'UNSAFE';
  }
}

function isBinary(buf) {
  if (buf.includes(0)) return true;
  try { new TextDecoder('utf-8', {fatal: true}).decode(buf); return false; }
  catch { return true; }
}

// Walk `root` without following symlinks. Bounded; exceeding a bound throws so
// callers fail closed instead of silently skipping part of the tree.
export function takeSnapshot(root, {io = fs, limits = SCOPE_LIMITS} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('SNAPSHOT_ROOT_INVALID');
  const rootStat = io.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('SNAPSHOT_ROOT_INVALID');
  const entries = Object.create(null);
  let count = 0;
  let total = 0;
  const walk = (dirAbs, rel, depth) => {
    if (depth > limits.maxDepth) fail('SNAPSHOT_LIMIT');
    for (const name of io.readdirSync(dirAbs).sort()) {
      if (++count > limits.maxEntries) fail('SNAPSHOT_LIMIT');
      const abs = path.join(dirAbs, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      const st = io.lstatSync(abs);
      if (st.isSymbolicLink()) {
        entries[relPath] = {type: 'symlink', mode: st.mode & 0o7777, size: 0, sha256: null, binary: false, oversize: false};
      } else if (st.isDirectory()) {
        entries[relPath] = {type: 'dir', mode: st.mode & 0o7777, size: 0, sha256: null, binary: false, oversize: false};
        walk(abs, relPath, depth + 1);
      } else if (st.isFile()) {
        total += st.size;
        if (total > limits.maxTotalBytes) fail('SNAPSHOT_LIMIT');
        const oversize = st.size > limits.maxFileBytes;
        let hash = null;
        let binary = false;
        if (!oversize) {
          const buf = readNoFollow(io, abs, limits.maxFileBytes);
          hash = sha256(buf);
          binary = isBinary(buf);
        }
        entries[relPath] = {type: 'file', mode: st.mode & 0o7777, size: st.size, sha256: hash, binary, oversize};
      } else {
        entries[relPath] = {type: 'special', mode: st.mode & 0o7777, size: 0, sha256: null, binary: false, oversize: false};
      }
    }
  };
  try {
    walk(root, '', 0);
  } catch (e) {
    if (e instanceof BridgeError) throw e;
    return fail('SNAPSHOT_FAILED');
  }
  return Object.freeze({entries: Object.freeze(entries), count});
}

const same = (a, b) => a.type === b.type && a.mode === b.mode &&
  a.size === b.size && a.sha256 === b.sha256;

function ancestors(p) {
  const out = [];
  const segs = p.split('/');
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'));
  return out;
}

// Compare two snapshots against the allowed file list. Returns a sorted,
// bounded list of violations; ok only when the list is empty.
export function compareSnapshots(before, after, {allowed, limits = SCOPE_LIMITS} = {}) {
  const allowedFiles = new Set(validateScopePaths(allowed, limits));
  const allowedDirs = new Set([...allowedFiles].flatMap(ancestors));
  const violations = [];
  const add = (code, p) => {
    if (violations.length < limits.maxViolations) violations.push({code, path: p});
  };
  const keys = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)]);
  let changedFiles = 0;
  for (const p of [...keys].sort()) {
    const b = before.entries[p];
    const a = after.entries[p];
    if (b && a && same(a, b)) continue;
    if (b?.type === 'dir' && a?.type === 'dir') continue; // mode-only dir drift handled below
    const kind = a?.type ?? b.type;
    if (!p.split('/').every(s => SAFE_NAME.test(s))) add('UNSAFE_NAME', p);
    if (kind === 'file') changedFiles++;
    if (a?.type === 'symlink' || (b?.type === 'symlink' && a?.type !== undefined)) add('SYMLINK', p);
    if (a?.type === 'special') add('SPECIAL_FILE', p);
    const inScope = kind === 'dir' ? allowedDirs.has(p) || allowedFiles.has(p)
      : allowedFiles.has(p);
    if (isProtectedPath(p)) add('PROTECTED_PATH', p);
    else if (!inScope) add('OUT_OF_SCOPE', p);
    if (a?.type === 'file') {
      if (a.oversize || a.size > limits.maxFileBytes) add('TOO_LARGE', p);
      if (a.binary) add('BINARY', p);
      if (b?.type === 'file') {
        if (a.mode !== b.mode) add('MODE_CHANGE', p);
      } else if ((a.mode & 0o7111) !== 0) {
        add('MODE_CHANGE', p); // new files must not be executable/setuid/sticky
      }
    }
    if (b && a && b.type !== a.type) add('TYPE_CHANGE', p);
  }
  // Directory permission drift on pre-existing directories.
  for (const [p, b] of Object.entries(before.entries)) {
    const a = after.entries[p];
    if (b.type === 'dir' && a?.type === 'dir' && a.mode !== b.mode) add('MODE_CHANGE', p);
  }
  if (changedFiles > limits.maxChangedFiles) add('TOO_MANY_CHANGES', '');
  violations.sort((x, y) => (x.path + x.code).localeCompare(y.path + y.code));
  const changed = [...keys].filter(p => {
    const b = before.entries[p];
    const a = after.entries[p];
    return !(b && a && same(a, b)) && (a?.type ?? b.type) === 'file';
  }).sort();
  return Object.freeze({ok: violations.length === 0, violations, changed, changedFiles});
}
