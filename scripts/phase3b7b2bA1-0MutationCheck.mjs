#!/usr/bin/env node
// OFFLINE ONLY: no Docker, network, provider or agent. Mutants live only in private temporary copies.
// node scripts/phase3b7b2bA1-0MutationCheck.mjs [--workers N] [--out report.json] [--only text] [--check-patterns]
// Final evidence requires committed executable inputs, a green baseline and unchanged source provenance.
// --check-patterns remains usable during editing; --no-baseline is deliberately not a verification gate.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const requestedWorkers = Number(opt('--workers', '4'));
const WORKERS = Number.isInteger(requestedWorkers) && requestedWorkers >= 1 && requestedWorkers <= 8 ? requestedWorkers : null;
const OUT = opt('--out', null);
const ONLY = opt('--only', null);
const CHECK_ONLY = args.includes('--check-patterns');
const CATALOG = 'scripts/phase3b7b2bA1-0-mutations.json';
const RUNNER = 'scripts/phase3b7b2bA1-0MutationCheck.mjs';
const INPUTS = ['server', 'test', 'server.ts', 'package.json', CATALOG, RUNNER];
const TESTS = ['test/agent-console-phase3b7b2b-a1-0-contract.test.mjs', 'test/agent-console-phase3b7b2b-a1-0-states.test.mjs', 'test/agent-console-phase3b7b2b-a1-0-store.test.mjs', 'test/agent-console-phase2-store.test.mjs', 'test/agent-console-phase3b7b1-approval.test.mjs', 'test/agent-console-phase3b2-sandbox.test.mjs'];
const tiersFor = () => TESTS.map((file) => [file]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...argv) => execFileSync('/usr/bin/git', argv, { cwd: ROOT, encoding: 'utf8' }).trim();

function fingerprint(root) {
  const files = {}; const gitBlobs = {};
  const objectFormat = git('rev-parse', '--show-object-format');
  const visit = (relative) => {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
    else if (stat.isFile()) {
      const bytes = fs.readFileSync(absolute);
      files[relative] = hash(bytes);
      gitBlobs[relative] = createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    }
    else throw new Error(`Unsupported nonregular verification input: ${relative}`);
  };
  INPUTS.forEach(visit);
  return { sha256: hash(JSON.stringify(files)), files, gitBlobs };
}
function matchesCommit(source) {
  const blobs = {};
  for (const entry of git('ls-tree', '-rz', source.sourceHead, '--', ...INPUTS).split('\0').filter(Boolean)) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (!match) return false;
    blobs[match[2]] = match[1];
  }
  const paths = Object.keys(source.fingerprint.gitBlobs).sort();
  return JSON.stringify(paths) === JSON.stringify(Object.keys(blobs).sort())
    && paths.every((file) => source.fingerprint.gitBlobs[file] === blobs[file]);
}
function provenance() {
  return {
    worktree: fs.realpathSync(ROOT), gitTopLevel: fs.realpathSync(git('rev-parse', '--show-toplevel')),
    sourceHead: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    worktreeStatus: git('status', '--porcelain=v1', '--untracked-files=all'),
    participatingStatus: git('status', '--porcelain=v1', '--untracked-files=all', '--', ...INPUTS),
    fingerprint: fingerprint(ROOT),
  };
}
const editsOf = (m) => [...(m.also ?? []), { find: m.find, replace: m.replace }];
const count = (text, needle) => typeof needle === 'string' && needle.length ? text.split(needle).length - 1 : 0;
const validProof = (proof) => proof !== null && typeof proof === 'object' && !Array.isArray(proof)
  && typeof proof.rationale === 'string' && proof.rationale.trim().length > 0
  && ['assumptions', 'evidence'].every((key) => Array.isArray(proof[key]) && proof[key].length > 0 && proof[key].every((value) => typeof value === 'string' && value.trim().length > 0));
function catalogAt(root) {
  const all = JSON.parse(fs.readFileSync(path.join(root, CATALOG), 'utf8'));
  if (!Array.isArray(all) || !all.length) throw new Error('The mutation catalog must be a nonempty array');
  const ids = new Set();
  for (const m of all) {
    if (typeof m.id !== 'string' || !m.id || ids.has(m.id)) throw new Error('Mutation IDs must be nonempty and unique');
    ids.add(m.id);
    if (typeof m.file !== 'string' || !/^server\/(execution\/continuation|tasks)\/[A-Za-z0-9_-]+\.mjs$/.test(m.file)) throw new Error(`Invalid mutation target: ${m.id}`);
    if (editsOf(m).some((e) => typeof e.find !== 'string' || !e.find || typeof e.replace !== 'string' || e.find === e.replace)) throw new Error(`Invalid or ineffective mutation edits: ${m.id}`);
    if (m.tiers !== undefined && JSON.stringify(m.tiers) !== JSON.stringify(tiersFor())) throw new Error(`Custom tiers may not omit or reorder the required test suite: ${m.id}`);
    if (m.equivalentWithProof !== undefined && !validProof(m.equivalentWithProof)) throw new Error(`Invalid equivalence proof metadata: ${m.id}`);
  }
  const selected = all.filter((m) => !ONLY || m.id.includes(ONLY));
  if (!selected.length) throw new Error('No mutations selected; an empty run is not verification');
  return { all, selected };
}
function checkPatterns(root, selected) {
  return selected.filter((m) => {
    let text = fs.readFileSync(path.join(root, m.file), 'utf8');
    for (const e of editsOf(m)) {
      if (count(text, e.find) !== 1) return true;
      text = text.replace(e.find, () => e.replace);
    }
    return false;
  }).map((m) => m.id);
}

// Node's native structured test events preserve the error cause chain. TAP exit codes alone cannot distinguish assertions from load errors.
const REPORTER = `
const describe = (error, depth = 0) => !error ? null : ({ name: error.name, code: error.code, message: error.message, failureType: error.failureType, stack: error.stack, cause: depth < 6 ? describe(error.cause, depth + 1) : null });
export default async function* (source) {
  for await (const event of source) {
    const d = event.data ?? {};
    if (['test:fail', 'test:diagnostic', 'test:summary'].includes(event.type)) {
      yield JSON.stringify({ type: event.type, name: d.name, file: d.file, nesting: d.nesting, message: d.message, counts: d.counts, error: describe(d.details?.error) }) + '\\n';
    }
  }
}
`;
function runProcess(dir, argv, timeout = 120000) {
  return new Promise((resolve) => {
    let stdout = ''; let stderr = ''; let spawnError = null; let timedOut = false; let oversizedOutput = false;
    const child = spawn(process.execPath, argv, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    const append = (stream, chunk) => {
      if (stdout.length + stderr.length + chunk.length > 4 * 1024 * 1024) { oversizedOutput = true; child.kill('SIGKILL'); return; }
      if (stream === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk.toString()));
    child.stderr.on('data', (chunk) => append('stderr', chunk.toString()));
    child.on('error', (error) => { spawnError = error.message; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, spawnError, timedOut, oversizedOutput, stdout, stderr }); });
  });
}
function errorChain(error) { return error ? [error, ...errorChain(error.cause)] : []; }
async function runTests(dir, files) {
  const processResult = await runProcess(dir, ['--test', '--test-timeout=90000', '--test-reporter=./mutation-reporter.mjs', ...files], Math.max(120000, files.length * 120000));
  const events = []; let parseError = null;
  for (const line of processResult.stdout.split('\n').filter(Boolean)) {
    try { events.push(JSON.parse(line)); } catch { parseError = 'The structured test reporter emitted invalid JSON'; }
  }
  const diagnostic = (key) => {
    const messages = events.filter((e) => e.type === 'test:diagnostic' && e.nesting === 0).map((e) => e.message);
    const found = messages.map((message) => new RegExp(`^${key} (\\d+)$`).exec(message)).filter(Boolean).at(-1);
    return found ? Number(found[1]) : null;
  };
  const finalCounts = events.filter((e) => e.type === 'test:summary' && e.counts).at(-1)?.counts;
  const tests = finalCounts?.tests ?? diagnostic('tests');
  const pass = finalCounts?.passed ?? diagnostic('pass');
  const fail = finalCounts?.failed ?? diagnostic('fail');
  const cancelled = finalCounts?.cancelled ?? diagnostic('cancelled');
  const failures = events.filter((e) => e.type === 'test:fail');
  const wrappers = failures.filter((e) => e.error?.failureType === 'subtestsFailed');
  const leaves = failures.filter((e) => !wrappers.includes(e));
  const assertions = leaves.filter((e) => {
    const chain = errorChain(e.error);
    const loadOrInfrastructure = chain.some((error) => error.name === 'SyntaxError' || error.failureType === 'testTimeoutFailure'
      || ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_DIR_IMPORT', 'ENOENT'].includes(error.code));
    const fileWrapper = e.file && (e.name === e.file || e.name === path.relative(dir, e.file));
    return !loadOrInfrastructure && !fileWrapper && chain.some((error) => error.code === 'ERR_ASSERTION' || error.name === 'AssertionError');
  });
  const infrastructureFailures = leaves.filter((e) => !assertions.includes(e));
  const problems = [];
  if (processResult.spawnError) problems.push(`spawn: ${processResult.spawnError}`);
  if (processResult.signal || processResult.timedOut || processResult.oversizedOutput) problems.push('Test process was interrupted, timed out or exceeded output bounds');
  if (parseError) problems.push(parseError);
  if (!Number.isInteger(tests) || tests <= 0 || !Number.isInteger(pass) || !Number.isInteger(fail) || !Number.isInteger(cancelled)) problems.push('Missing or empty test summary');
  if (cancelled > 0) problems.push('Tests were cancelled');
  if (infrastructureFailures.length) problems.push('A test failed without a verified assertion failure');
  if (processResult.code !== 0 && !assertions.length) problems.push('Nonzero test exit without a verified assertion failure');
  if (fail > 0 && !assertions.length) problems.push('Failed summary without a verified assertion failure');
  if (processResult.code === 0 && (fail > 0 || failures.length)) problems.push('Inconsistent exit status and test events');
  return {
    code: processResult.code, signal: processResult.signal, tests, pass, fail, cancelled,
    assertionFailures: assertions, infrastructureFailures, problems,
    ...(problems.length ? { diagnostics: { stderr: processResult.stderr.slice(0, 16000), reporterOutput: processResult.stdout.slice(-16000) } } : {}),
  };
}

async function main() {
  if (CHECK_ONLY) {
    const { selected } = catalogAt(ROOT);
    const errors = checkPatterns(ROOT, selected);
    console.log(JSON.stringify({ mode: 'PATTERN_CHECK_ONLY', mutations: selected.length, patternErrors: errors, verificationPerformed: false }));
    return errors.length ? 1 : 0;
  }
  if (OUT) {
    const relative = path.relative(ROOT, path.resolve(OUT));
    if (INPUTS.some((item) => relative === item || relative.startsWith(`${item}/`))) throw new Error('The report output may not overwrite participating verification inputs');
    // Invalidate any older output before preflight. PASS is published only after successful temporary-copy cleanup.
    fs.writeFileSync(path.resolve(OUT), `${JSON.stringify({ status: 'HOLD', reason: 'VERIFICATION_NOT_COMPLETED', sourceHead: git('rev-parse', 'HEAD') }, null, 2)}\n`);
  }
  if (WORKERS === null) throw new Error('--workers must be an integer between 1 and 8');
  if (args.includes('--no-baseline')) throw new Error('--no-baseline cannot produce valid mutation evidence; an unmutated green baseline is mandatory');
  const start = provenance();
  if (start.worktree !== start.gitTopLevel || start.participatingStatus || !matchesCommit(start)) throw new Error('Executable verification inputs must match a committed code HEAD; commit them before collecting evidence');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-identity-mutations-'));
  let report; let exitCode = 1;
  try {
    const snapshot = path.join(temporaryRoot, 'snapshot');
    fs.mkdirSync(snapshot);
    for (const item of INPUTS) fs.cpSync(path.join(ROOT, item), path.join(snapshot, item), { recursive: true });
    const snapshotFingerprint = fingerprint(snapshot);
    const afterCopy = provenance();
    if (snapshotFingerprint.sha256 !== start.fingerprint.sha256 || afterCopy.sourceHead !== start.sourceHead || afterCopy.fingerprint.sha256 !== start.fingerprint.sha256 || afterCopy.participatingStatus) throw new Error('Verification inputs changed while capturing the source snapshot');
    const { all, selected } = catalogAt(snapshot);
    const patternErrors = checkPatterns(snapshot, selected);
    const dirs = Array.from({ length: Math.min(WORKERS, selected.length) }, (_, i) => {
      const dir = path.join(temporaryRoot, `worker-${i}`);
      fs.cpSync(snapshot, dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'mutation-reporter.mjs'), REPORTER);
      return dir;
    });
    const baseline = await runTests(dirs[0], TESTS);
    if (fingerprint(dirs[0]).sha256 !== snapshotFingerprint.sha256) baseline.problems.push('The baseline changed participating source or test inputs');
    const baselineGreen = baseline.problems.length === 0 && baseline.code === 0 && baseline.fail === 0 && baseline.pass === baseline.tests;
    console.log(`baseline: tests=${baseline.tests} pass=${baseline.pass} fail=${baseline.fail} valid=${baselineGreen}`);
    const results = []; const workerErrors = [];
    if (baselineGreen) {
      let cursor = 0;
      const workers = await Promise.allSettled(dirs.map(async (dir) => {
        while (cursor < selected.length) {
          const m = selected[cursor++];
          let result = { id: m.id, file: m.file, status: 'HARNESS_ERROR' };
          if (patternErrors.includes(m.id)) result.status = 'PATTERN_ERROR';
          else {
            const original = fs.readFileSync(path.join(snapshot, m.file), 'utf8');
            const target = path.join(dir, m.file);
            try {
              if (fingerprint(dir).sha256 !== snapshotFingerprint.sha256) throw new Error('A worker no longer matches the unmutated snapshot');
              const mutated = editsOf(m).reduce((text, e) => text.replace(e.find, () => e.replace), original);
              fs.writeFileSync(target, mutated);
              result.mutatedSourceSha256 = hash(mutated);
              const syntax = await runProcess(dir, ['--check', m.file], 30000);
              if (syntax.code !== 0 || syntax.signal || syntax.spawnError || syntax.timedOut || syntax.oversizedOutput) {
                result.status = syntax.signal || syntax.spawnError || syntax.timedOut || syntax.oversizedOutput ? 'HARNESS_ERROR' : 'INVALID_MUTANT';
                result.syntax = { ...syntax, stdout: syntax.stdout.slice(0, 16000), stderr: syntax.stderr.slice(0, 16000) };
              } else {
                result.status = 'SURVIVED_UNEXPLAINED';
                result.tiers = [];
                for (const tier of tiersFor()) {
                  const outcome = await runTests(dir, tier);
                  result.tiers.push({ files: tier, ...outcome });
                  if (outcome.problems.length) { result.status = 'HARNESS_ERROR'; break; }
                  if (outcome.assertionFailures.length) { result.status = 'CAUGHT'; result.caughtBy = tier; break; }
                }
                if (result.status === 'SURVIVED_UNEXPLAINED' && validProof(m.equivalentWithProof)) {
                  result.status = 'EQUIVALENT_WITH_PROOF'; result.equivalentWithProof = m.equivalentWithProof;
                }
              }
            } catch (error) { result.status = 'HARNESS_ERROR'; result.error = error.message; }
            finally {
              fs.writeFileSync(target, original);
              if (fingerprint(dir).sha256 !== snapshotFingerprint.sha256) {
                result.status = 'HARNESS_ERROR'; result.error = 'Tests changed participating source or test inputs';
              }
            }
          }
          results.push(result);
          console.log(`${result.status} ${result.id}`);
        }
      }));
      for (const worker of workers) if (worker.status === 'rejected') workerErrors.push(worker.reason?.message ?? String(worker.reason));
    }
    results.sort((a, b) => selected.findIndex((m) => m.id === a.id) - selected.findIndex((m) => m.id === b.id));
    const end = provenance();
    const sourceUnchanged = end.sourceHead === start.sourceHead && end.sourceTree === start.sourceTree && end.worktree === start.worktree && !end.participatingStatus && end.fingerprint.sha256 === snapshotFingerprint.sha256;
    const summary = {
      selected: selected.length, catalogTotal: all.length, completed: results.length,
      caught: results.filter((r) => r.status === 'CAUGHT').length,
      equivalentWithProof: results.filter((r) => r.status === 'EQUIVALENT_WITH_PROOF').length,
      survivedUnexplained: results.filter((r) => r.status === 'SURVIVED_UNEXPLAINED').map((r) => r.id),
      patternErrors: results.filter((r) => r.status === 'PATTERN_ERROR').map((r) => r.id),
      invalidMutants: results.filter((r) => r.status === 'INVALID_MUTANT').map((r) => r.id),
      harnessErrors: results.filter((r) => r.status === 'HARNESS_ERROR').map((r) => r.id),
      workerErrors,
    };
    const valid = baselineGreen && sourceUnchanged && !workerErrors.length && results.length === selected.length && results.every((r) => ['CAUGHT', 'EQUIVALENT_WITH_PROOF'].includes(r.status));
    report = {
      phase: '3B7B2B-A1-0-pending-action-foundation', status: valid ? 'PASS' : 'HOLD', sourceHead: start.sourceHead,
      evidenceScope: ONLY ? 'SELECTED_MUTATIONS_ONLY' : 'FULL_CATALOG', node: process.version,
      provenance: { start, end, snapshotFingerprint, sourceUnchanged }, baseline, summary, results,
    };
    exitCode = valid ? 0 : 1;
  } finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
  if (OUT) fs.writeFileSync(path.resolve(OUT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, sourceUnchanged: report.provenance.sourceUnchanged, ...report.summary }));
  return exitCode;
}

try { process.exitCode = await main(); }
catch (error) { console.error(`HOLD: ${error.message}`); process.exitCode = 1; }
