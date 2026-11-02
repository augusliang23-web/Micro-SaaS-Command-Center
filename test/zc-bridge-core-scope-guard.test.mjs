// ZC-MVP-B1 (Issue #119): scope guard. Offline only; fixtures live in mkdtemp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  validateScopePaths, isProtectedPath, takeSnapshot, compareSnapshots, fileDigest, SCOPE_LIMITS,
} from '../tools/zc-bridge-core/scope-guard.mjs';
import {BridgeError} from '../tools/zc-bridge-core/state-machine.mjs';

const code = c => e => e instanceof BridgeError && e.code === c;
const ALLOWED = ['docs/fixture-note.md', 'tools/fixture-tool.mjs'];

function ws() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zc-bridge-core-')));
  const w = path.join(root, 'ws');
  fs.mkdirSync(path.join(w, 'docs'), {recursive: true});
  fs.mkdirSync(path.join(w, 'tools'), {recursive: true});
  fs.writeFileSync(path.join(w, 'docs/fixture-note.md'), 'one\n', {mode: 0o644});
  fs.writeFileSync(path.join(w, 'tools/fixture-tool.mjs'), 'export {};\n', {mode: 0o644});
  fs.writeFileSync(path.join(w, 'keep.txt'), 'keep\n', {mode: 0o644});
  return {root, w, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}
const verdict = (x, mutate, allowed = ALLOWED, limits) => {
  const before = takeSnapshot(x.w);
  mutate();
  return compareSnapshots(before, takeSnapshot(x.w), {allowed, ...(limits ? {limits} : {})});
};
const codes = v => v.violations.map(i => `${i.code}:${i.path}`);

test('validateScopePaths returns a sorted copy of valid paths', () => {
  assert.deepEqual(validateScopePaths(['tools/b.mjs', 'docs/a.md', 'test/c.test.mjs']),
    ['docs/a.md', 'test/c.test.mjs', 'tools/b.mjs']);
});

test('validateScopePaths rejects malformed path lists', () => {
  const bad = [
    undefined, null, 'docs/a.md', [], Array.from({length: 9}, (_, i) => `docs/f${i}.md`),
    [5], [null], [{}], [''], ['docs'], ['docs/'], ['docs/a/'], ['/docs/a.md'], ['docs/../a.md'],
    ['docs/./a.md'], ['docs//a.md'], ['docs\\a.md'], ['docs/.hidden.md'], ['docs/.a/b.md'],
    ['../docs/a.md'], ['src/a.ts'], ['Docs/a.md'], ['docs/a b.md'], ['docs/é.md'], ['docs/a\n.md'],
    ['docs/' + 'x'.repeat(200)], ['docs/a.md', 'docs/a.md'], ['docs/a.md', 'docs/A.md'],
    ['docs/a\0.md'], ['docs/%2e%2e/a.md'.replace('%2e', '.')],
  ];
  for (const b of bad) assert.throws(() => validateScopePaths(b), code('INVALID_SCOPE_PATHS'), JSON.stringify(b));
});

test('validateScopePaths rejects protected files, case-insensitively', () => {
  for (const p of [
    'tools/package.json', 'docs/package-lock.json', 'tools/Package.JSON', 'tools/server.ts',
    'tools/SERVER.TS', 'docs/CLAUDE.md', 'docs/claude.md', 'docs/AGENTS.md', 'tools/yarn.lock',
    'tools/pnpm-lock.yaml', 'tools/bun.lockb', 'tools/npm-shrinkwrap.json',
    'docs/node_modules/x.md', 'tools/node_modules/a.mjs',
  ]) assert.throws(() => validateScopePaths([p]), code('PROTECTED_SCOPE_PATH'), p);
});

test('hidden env, git and workflow paths can never be scoped', () => {
  for (const p of ['.github/workflows/x.yml', '.env', 'tools/.env', 'tools/.env.local', 'docs/.git/config', '.git/config']) {
    assert.throws(() => validateScopePaths([p]), e => e instanceof BridgeError, p);
  }
  for (const p of ['.github/x', '.env', 'tools/.env.local', 'docs/.git', 'tools/server.ts', 'docs/Claude.MD', 'tools/NODE_MODULES/x']) {
    assert.equal(isProtectedPath(p), true, p);
  }
  assert.equal(isProtectedPath('docs/fixture-note.md'), false);
  assert.equal(isProtectedPath(5), true);
});

test('an unchanged workspace passes', () => {
  const x = ws();
  try {
    const v = verdict(x, () => {});
    assert.deepEqual([v.ok, v.violations, v.changed], [true, [], []]);
  } finally { x.cleanup(); }
});

test('an in-scope modification and a new in-scope file pass', () => {
  const x = ws();
  try {
    fs.rmSync(path.join(x.w, 'tools/fixture-tool.mjs'));
    const v = verdict(x, () => {
      fs.writeFileSync(path.join(x.w, 'docs/fixture-note.md'), 'two\n');
      fs.writeFileSync(path.join(x.w, 'tools/fixture-tool.mjs'), 'export const a = 1;\n', {mode: 0o644});
    });
    assert.equal(v.ok, true);
    assert.deepEqual(v.changed, ['docs/fixture-note.md', 'tools/fixture-tool.mjs']);
  } finally { x.cleanup(); }
});

test('an out-of-scope new file or edit is a violation (M10 core)', () => {
  const x = ws();
  try {
    let v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'tools/other.mjs'), 'x\n'));
    assert.deepEqual(codes(v), ['OUT_OF_SCOPE:tools/other.mjs']);
    v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'keep.txt'), 'changed\n'));
    assert.deepEqual(codes(v), ['OUT_OF_SCOPE:keep.txt']);
  } finally { x.cleanup(); }
});

test('protected paths are reported as PROTECTED_PATH', () => {
  const x = ws();
  try {
    const v = verdict(x, () => {
      fs.writeFileSync(path.join(x.w, 'package.json'), '{}\n');
      fs.mkdirSync(path.join(x.w, '.github/workflows'), {recursive: true});
      fs.writeFileSync(path.join(x.w, '.github/workflows/x.yml'), 'x\n');
      fs.writeFileSync(path.join(x.w, '.env'), 'SECRET=1\n');
    });
    assert.equal(v.ok, false);
    const set = new Set(codes(v));
    for (const c of ['PROTECTED_PATH:package.json', 'PROTECTED_PATH:.github', 'PROTECTED_PATH:.github/workflows',
      'PROTECTED_PATH:.github/workflows/x.yml', 'PROTECTED_PATH:.env']) assert.ok(set.has(c), c);
  } finally { x.cleanup(); }
});

test('a case variant of an allowed path is out of scope', () => {
  const x = ws();
  try {
    fs.rmSync(path.join(x.w, 'docs/fixture-note.md'));
    const v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'docs/Fixture-Note.md'), 'x\n'));
    assert.ok(codes(v).includes('OUT_OF_SCOPE:docs/Fixture-Note.md'));
  } finally { x.cleanup(); }
});

test('symlinks are never accepted, even in scope, and never followed', () => {
  const x = ws();
  try {
    fs.rmSync(path.join(x.w, 'docs/fixture-note.md'));
    const v = verdict(x, () => fs.symlinkSync('/nonexistent-synthetic-target', path.join(x.w, 'docs/fixture-note.md')), ALLOWED);
    assert.ok(codes(v).includes('SYMLINK:docs/fixture-note.md'));
    const outside = path.join(x.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret\n');
    fs.symlinkSync(outside, path.join(x.w, 'docs/dirlink'));
    const snap = takeSnapshot(x.w);
    assert.equal(snap.entries['docs/dirlink'].type, 'symlink');
    assert.equal(Object.keys(snap.entries).some(k => k.startsWith('docs/dirlink/')), false);
  } finally { x.cleanup(); }
});

test('a replaced regular file becomes a TYPE_CHANGE and symlink violation', () => {
  const x = ws();
  try {
    const v = verdict(x, () => {
      fs.rmSync(path.join(x.w, 'docs/fixture-note.md'));
      fs.symlinkSync('keep.txt', path.join(x.w, 'docs/fixture-note.md'));
    });
    const c = codes(v);
    assert.ok(c.includes('SYMLINK:docs/fixture-note.md'));
    assert.ok(c.includes('TYPE_CHANGE:docs/fixture-note.md'));
  } finally { x.cleanup(); }
});

test('special files (fifo) are violations', () => {
  const x = ws();
  try {
    const v = verdict(x, () => execFileSync('mkfifo', [path.join(x.w, 'docs/pipe')]));
    assert.ok(codes(v).includes('SPECIAL_FILE:docs/pipe'));
  } finally { x.cleanup(); }
});

test('mode drift on an existing file is a violation', () => {
  const x = ws();
  try {
    const v = verdict(x, () => fs.chmodSync(path.join(x.w, 'docs/fixture-note.md'), 0o755));
    assert.deepEqual(codes(v), ['MODE_CHANGE:docs/fixture-note.md']);
  } finally { x.cleanup(); }
});

test('new executable or setuid files are violations', () => {
  const x = ws();
  try {
    fs.rmSync(path.join(x.w, 'tools/fixture-tool.mjs'));
    let v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'tools/fixture-tool.mjs'), 'x\n', {mode: 0o755}));
    assert.deepEqual(codes(v), ['MODE_CHANGE:tools/fixture-tool.mjs']);
    fs.rmSync(path.join(x.w, 'tools/fixture-tool.mjs'));
    v = verdict(x, () => { const p = path.join(x.w, 'tools/fixture-tool.mjs'); fs.writeFileSync(p, 'x\n'); fs.chmodSync(p, 0o4644); });
    assert.deepEqual(codes(v), ['MODE_CHANGE:tools/fixture-tool.mjs']);
  } finally { x.cleanup(); }
});

test('binary content is a violation (NUL byte or invalid UTF-8)', () => {
  const x = ws();
  try {
    let v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'docs/fixture-note.md'), Buffer.from([1, 0, 2])));
    assert.deepEqual(codes(v), ['BINARY:docs/fixture-note.md']);
    v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'docs/fixture-note.md'), Buffer.from([0xff, 0xfe, 0x41])));
    assert.deepEqual(codes(v), ['BINARY:docs/fixture-note.md']);
  } finally { x.cleanup(); }
});

test('oversize files are violations and are not read into memory', () => {
  const x = ws();
  try {
    const v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'docs/fixture-note.md'), 'x'.repeat(SCOPE_LIMITS.maxFileBytes + 1)));
    assert.deepEqual(codes(v), ['TOO_LARGE:docs/fixture-note.md']);
    assert.equal(takeSnapshot(x.w).entries['docs/fixture-note.md'].sha256, null);
  } finally { x.cleanup(); }
});

test('more changed files than the cap is a violation', () => {
  const x = ws();
  try {
    const allowed = Array.from({length: 8}, (_, i) => `docs/f${i}.md`);
    const limits = {...SCOPE_LIMITS, maxChangedFiles: 3};
    const v = verdict(x, () => { for (const p of allowed.slice(0, 4)) fs.writeFileSync(path.join(x.w, p), 'x\n'); }, allowed, limits);
    assert.deepEqual(codes(v), ['TOO_MANY_CHANGES:']);
  } finally { x.cleanup(); }
});

test('deleting an out-of-scope file is a violation; deleting in scope is not', () => {
  const x = ws();
  try {
    let v = verdict(x, () => fs.rmSync(path.join(x.w, 'keep.txt')));
    assert.deepEqual(codes(v), ['OUT_OF_SCOPE:keep.txt']);
    v = verdict(x, () => fs.rmSync(path.join(x.w, 'docs/fixture-note.md')));
    assert.equal(v.ok, true);
  } finally { x.cleanup(); }
});

test('new directories outside the allowed tree are violations', () => {
  const x = ws();
  try {
    let v = verdict(x, () => fs.mkdirSync(path.join(x.w, 'extra')));
    assert.deepEqual(codes(v), ['OUT_OF_SCOPE:extra']);
    v = verdict(x, () => { fs.mkdirSync(path.join(x.w, 'docs/sub')); }, ['docs/sub/new.md']);
    assert.equal(v.ok, true);
    v = verdict(x, () => fs.mkdirSync(path.join(x.w, 'docs/other')), ['docs/sub/new.md']);
    assert.deepEqual(codes(v), ['OUT_OF_SCOPE:docs/other']);
  } finally { x.cleanup(); }
});

test('directory permission drift is a violation', () => {
  const x = ws();
  try {
    const v = verdict(x, () => fs.chmodSync(path.join(x.w, 'docs'), 0o777));
    assert.deepEqual(codes(v), ['MODE_CHANGE:docs']);
  } finally { x.cleanup(); }
});

test('unsafe file names are violations', () => {
  const x = ws();
  try {
    const v = verdict(x, () => fs.writeFileSync(path.join(x.w, 'docs/odd name;rm.md'), 'x\n'));
    const c = codes(v);
    assert.ok(c.includes('UNSAFE_NAME:docs/odd name;rm.md'));
    assert.ok(c.includes('OUT_OF_SCOPE:docs/odd name;rm.md'));
  } finally { x.cleanup(); }
});

test('violations are bounded and sorted', () => {
  const x = ws();
  try {
    const v = verdict(x, () => { for (let i = 0; i < 80; i++) fs.writeFileSync(path.join(x.w, `f${String(i).padStart(2, '0')}.txt`), 'x\n'); });
    assert.equal(v.violations.length, SCOPE_LIMITS.maxViolations);
    const keys = v.violations.map(i => i.path + i.code);
    assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
  } finally { x.cleanup(); }
});

test('snapshot is bounded and fails closed on limits', () => {
  const x = ws();
  try {
    assert.throws(() => takeSnapshot(x.w, {limits: {...SCOPE_LIMITS, maxEntries: 2}}), code('SNAPSHOT_LIMIT'));
    assert.throws(() => takeSnapshot(x.w, {limits: {...SCOPE_LIMITS, maxDepth: 0}}), code('SNAPSHOT_LIMIT'));
    assert.throws(() => takeSnapshot(x.w, {limits: {...SCOPE_LIMITS, maxTotalBytes: 3}}), code('SNAPSHOT_LIMIT'));
  } finally { x.cleanup(); }
});

test('snapshot refuses relative, missing-type and symlinked roots', () => {
  const x = ws();
  try {
    assert.throws(() => takeSnapshot('relative'), code('SNAPSHOT_ROOT_INVALID'));
    assert.throws(() => takeSnapshot(path.join(x.w, 'keep.txt')), code('SNAPSHOT_ROOT_INVALID'));
    fs.symlinkSync(x.w, path.join(x.root, 'wslink'));
    assert.throws(() => takeSnapshot(path.join(x.root, 'wslink')), code('SNAPSHOT_ROOT_INVALID'));
  } finally { x.cleanup(); }
});

test('compareSnapshots refuses an invalid allowlist', () => {
  const x = ws();
  try {
    const s = takeSnapshot(x.w);
    assert.throws(() => compareSnapshots(s, s, {allowed: ['package.json']}), e => e instanceof BridgeError);
    assert.throws(() => compareSnapshots(s, s, {allowed: []}), code('INVALID_SCOPE_PATHS'));
    assert.throws(() => compareSnapshots(s, s, {}), code('INVALID_SCOPE_PATHS'));
  } finally { x.cleanup(); }
});

test('fileDigest: stable for regular files, MISSING and UNSAFE otherwise', () => {
  const x = ws();
  try {
    const f = path.join(x.w, 'keep.txt');
    const d1 = fileDigest(f);
    assert.match(d1, /^[a-f0-9]{64}$/);
    assert.equal(fileDigest(f), d1);
    fs.writeFileSync(f, 'changed\n');
    assert.notEqual(fileDigest(f), d1);
    assert.equal(fileDigest(path.join(x.w, 'nope')), 'MISSING');
    assert.equal(fileDigest(x.w), 'UNSAFE');
    const link = path.join(x.root, 'l');
    fs.symlinkSync(f, link);
    assert.equal(fileDigest(link), 'UNSAFE');
  } finally { x.cleanup(); }
});
