#!/usr/bin/env node
// Phase 3B7B2B-A0 durable execution identity reproducible mutation check (OFFLINE; no Docker, no network, no provider, no agent).
// It mutates the PRODUCTION identity layer (server/execution/identity/*) and requires the offline tests to catch each mutation.
//
//   node scripts/phase3b7b2bA0MutationCheck.mjs [--workers N] [--out file.json] [--only text] [--check-patterns] [--no-baseline]
//
// For every entry of scripts/phase3b7b2bA0-mutations.json it copies server/, test/, server.ts (read by the scope test) and package.json into a private temp directory,
// applies ONE exact-text mutation to ONE source file, runs the Phase 3B7B2B-A0 test files plus the sandbox scope test (in tiers: cheapest first) and records whether
// at least one test failed (CAUGHT). A surviving mutation is acceptable only when the list marks it `equivalent` with a reason.
// The repository working tree is never modified. Exit status 1 on an unexplained survivor, a pattern that does not match exactly
// once, or a failing unmutated baseline.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const WORKERS = Math.max(1, Number.parseInt(opt('--workers', '4'), 10) || 4);
const OUT = opt('--out', null);
const ONLY = opt('--only', null);
const CHECK_ONLY = args.includes('--check-patterns');
const BASELINE = !args.includes('--no-baseline');

const T = {
  classification: 'test/agent-console-phase3b7b2b-a0-classification.test.mjs',
  journal: 'test/agent-console-phase3b7b2b-a0-journal.test.mjs',
  crash: 'test/agent-console-phase3b7b2b-a0-crash.test.mjs',
  scope: 'test/agent-console-phase3b2-sandbox.test.mjs',
};
const ALL = Object.values(T);
const tiersFor = () => [[T.journal], [T.classification], [T.crash], [T.scope]];

const mutations = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/phase3b7b2bA0-mutations.json'), 'utf8')).filter((m) => !ONLY || m.id.includes(ONLY));
const count = (text, needle) => (needle === '' ? 0 : text.split(needle).length - 1);

const editsOf = (m) => [...(m.also ?? []), { find: m.find, replace: m.replace }];
const applyEdits = (text, m) => editsOf(m).reduce((t, e) => t.replace(e.find, () => e.replace), text);
const patternErrors = mutations.filter((m) => editsOf(m).some((e) => count(fs.readFileSync(path.join(ROOT, m.file), 'utf8'), e.find) !== 1)).map((m) => m.id);
if (patternErrors.length) console.log('PATTERN ERRORS (must match exactly once):', patternErrors);
if (CHECK_ONLY) { console.log(`${mutations.length} mutations, ${patternErrors.length} pattern errors`); process.exit(patternErrors.length ? 1 : 0); }

function prepare(index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cc-mutation-${index}-`));
  for (const item of ['server', 'test', 'package.json', 'server.ts']) fs.cpSync(path.join(ROOT, item), path.join(dir, item), { recursive: true });
  return dir;
}
function runTests(dir, files) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-timeout=90000', ...files], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      const num = (k) => { const m = new RegExp(`^# ${k} (\\d+)`, 'm').exec(out); return m ? Number(m[1]) : null; };
      resolve({ code, tests: num('tests'), pass: num('pass'), fail: num('fail') });
    });
  });
}

const dirs = Array.from({ length: WORKERS }, (_, i) => prepare(i));
let baseline = null;
if (BASELINE) {
  baseline = await runTests(dirs[0], ALL);
  console.log(`baseline: tests=${baseline.tests} pass=${baseline.pass} fail=${baseline.fail}`);
  if (baseline.fail !== 0 || baseline.code !== 0) { console.error('unmutated baseline is not green; aborting'); process.exit(1); }
}

const queue = [...dirs];
const waiters = [];
const acquire = () => (queue.length ? Promise.resolve(queue.pop()) : new Promise((r) => waiters.push(r)));
const release = (d) => { const w = waiters.shift(); if (w) w(d); else queue.push(d); };

async function one(m) {
  if (patternErrors.includes(m.id)) return { id: m.id, file: m.file, status: 'PATTERN_ERROR' };
  const dir = await acquire();
  const target = path.join(dir, m.file);
  const original = fs.readFileSync(path.join(ROOT, m.file), 'utf8');
  try {
    fs.writeFileSync(target, applyEdits(original, m));
    let caughtBy = null; let failures = 0;
    for (const tier of m.tiers ?? tiersFor(m.file)) {
      const r = await runTests(dir, tier);
      if (r.fail > 0 || r.code !== 0) { caughtBy = tier; failures = r.fail ?? -1; break; }
    }
    return { id: m.id, file: m.file, status: caughtBy ? 'CAUGHT' : 'SURVIVED', failures, caughtBy, ...(m.equivalent ? { equivalent: m.equivalent } : {}) };
  } finally { fs.writeFileSync(target, original); release(dir); }
}

const results = [];
await Promise.all(mutations.map(async (m) => { const r = await one(m); results.push(r); console.log(`${r.status.padEnd(9)} ${r.failures ?? ''} ${r.id}${r.status === 'SURVIVED' && r.equivalent ? '  [equivalent: ' + r.equivalent + ']' : ''}`); }));
for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });

results.sort((a, b) => mutations.findIndex((m) => m.id === a.id) - mutations.findIndex((m) => m.id === b.id));
const summary = {
  total: results.length,
  caught: results.filter((r) => r.status === 'CAUGHT').length,
  survivedEquivalent: results.filter((r) => r.status === 'SURVIVED' && r.equivalent).length,
  survivedUnexplained: results.filter((r) => r.status === 'SURVIVED' && !r.equivalent).map((r) => r.id),
  patternErrors: results.filter((r) => r.status === 'PATTERN_ERROR').map((r) => r.id),
};
let head = null;
try { head = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
const report = { phase: '3B7B2B-A0-execution-identity', sourceHead: head, node: process.version, baseline, summary, results };
if (OUT) fs.writeFileSync(path.resolve(OUT), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summary));
process.exit(summary.survivedUnexplained.length || summary.patternErrors.length ? 1 : 0);
