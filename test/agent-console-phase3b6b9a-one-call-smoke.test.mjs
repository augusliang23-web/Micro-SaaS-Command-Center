import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn as realSpawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ClaudeCliAdapter } from '../server/execution/claudeCliAdapter.mjs';
import { createHostTcbLifecycleObserver } from '../scripts/hostTcbLifecycleObserver.mjs';
import * as threeCall from '../scripts/phase3b6bSyntheticNegativeQualification.mjs';
import * as smoke from '../scripts/phase3b6bOneCallSmoke.mjs';

// Offline only. Every executable is a function-valued fake; the qualification candidate is never executed and the
// synthetic candidate home below does not exist on disk. Real provider calls in this whole file: 0.
const SCRIPT = fileURLToPath(new URL('../scripts/phase3b6bOneCallSmoke.mjs', import.meta.url));
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');
const CANDIDATE_HOME = '/synthetic/home';
const CANDIDATE_PATH = '/synthetic/home/.local/share/cc-qualification/claude/2.1.292/claude';
const CANDIDATE_SHA = '97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f';
const PASS_ADMISSION = smoke.MANAGED_POLICY_RUNTIME_ADMISSION_PASS;
const TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];
const fakeBinaryInspection = () => ({ state: 'PASS', code: null, binarySha256: CANDIDATE_SHA });
let strayCommands = 0; // any fake spawn handed a command other than the synthetic candidate

async function scratch(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p3b6b9a-')));
  try { return await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

/** One offline one-call run against fakes. Returns the evidence plus observation counters. */
async function simulate(options = {}) {
  return scratch(async root => {
    const homeDir = path.join(root, 'fake-home'); fs.mkdirSync(homeDir);
    const counts = { spawned: 0, adapterStarts: 0, preflights: 0, admissionCalls: [], fixtureRoots: [], monitors: 0 };
    const fakeSpawn = (command, args, spec) => {
      if (command !== CANDIDATE_PATH) strayCommands += 1;
      assert.equal(spec.shell, false);
      counts.spawned += 1;
      if (options.spawnThrows) throw new Error('synthetic spawn failure');
      const child = new EventEmitter(); child.pid = 20000 + counts.spawned;
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null;
      let exited = false;
      const exit = code => { if (exited) return; exited = true; child.exitCode = code; child.stdout.end(); child.stderr.end(); setImmediate(() => { child.emit('exit', code, null); child.emit('close', code, null); }); };
      child.kill = () => { setImmediate(() => exit(1)); return true; };
      setImmediate(() => {
        if (exited) return;
        const session = args.find(a => a.startsWith('--session-id=')).slice('--session-id='.length);
        const cwd = spec.cwd; counts.fixtureRoots.push(cwd);
        const apply = options.mutateFs ?? (dir => { fs.writeFileSync(path.join(dir, 'target.txt'), options.targetContent ?? smoke.SMOKE_TARGET_EDITED); });
        if (!options.noEdit) apply(cwd);
        let tools = [...TOOLS]; if (options.extraTool) tools.push('Bash'); if (options.missingTool) tools = tools.slice(0, 4); if (options.duplicateTool) tools = [...TOOLS.slice(0, 4), 'Read'];
        const init = { type: 'system', subtype: 'init', session_id: session, cwd, model: 'sonnet', permissionMode: options.permissionMode ?? 'acceptEdits', tools, ...(options.routeEvent ?? {}) };
        if (options.noInventory) delete init.tools;
        const blocks = [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'input.txt' } },
          { type: options.noEditTool ? 'text' : 'tool_use', ...(options.noEditTool ? { text: 'done' } : { id: 't2', name: options.editTool ?? 'Write', input: { file_path: 'target.txt' } }) }];
        if (options.shellUse) blocks.push({ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'echo x' } });
        const events = [init,
          { type: 'assistant', message: { id: 'm1', model: options.model ?? 'sonnet', content: blocks } },
          { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'synthetic' }, { type: 'tool_result', tool_use_id: 't2', content: 'synthetic' }] } },
          { type: 'result', subtype: 'success', is_error: false, session_id: session, permission_denials: [] }];
        if (options.unknownEvent) events.splice(2, 0, { type: 'future_event' });
        const data = events.map(e => JSON.stringify(e)).join('\n') + (options.partialFinal ? '' : '\n');
        child.stdout.write(data); exit(0);
      });
      return child;
    };
    const auth = (n, drift) => ({ loggedIn: true, authMethod: drift && n > 1 ? 'api_key' : 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro' });
    const dependencies = {
      managedPolicyRuntimeAdmission: input => { counts.admissionCalls.push(input.stage); return options.admission ? options.admission(input) : { state: PASS_ADMISSION }; },
      liveExecutionAuthorized: () => (Object.hasOwn(options, 'live') ? options.live : true),
      spawnImpl: fakeSpawn, candidateHomeDir: CANDIDATE_HOME, inspectBinary: fakeBinaryInspection, tempParent: root, snapshot: () => new Map(),
      observerAvailable: () => true,
      preflight: async () => {
        counts.preflights += 1; const n = counts.preflights;
        return { state: options.preflightBlock ? 'BLOCKED' : 'PASS', version: n > 1 && options.versionDrift ? '2.1.293' : '2.1.292',
          binarySha256: n > 1 && options.hashDrift ? 'b'.repeat(64) : CANDIDATE_SHA, auth: auth(n, options.authDrift), ...(options.preflightExtra ?? {}) };
      },
      monitorFactory: () => {
        counts.monitors += 1; let rootPid = null; let exited = false;
        return { setRootPid(pid) { rootPid = options.monitorBlind ? null : pid; }, parentExit(pid) { exited = pid === rootPid; }, finish() {
          const parent = { executablePath: CANDIDATE_PATH, sha256: CANDIDATE_SHA };
          const lifecycle = createHostTcbLifecycleObserver({ approvedParent: parent, approvedHelpers: [], baseline: { at: -250, processes: [], inspectionState: 'PASS' } });
          if (rootPid !== null) {
            const row = { ...parent, pid: rootPid, ppid: 1, parentGeneration: 'host', pgid: rootPid, sid: rootPid, startTime: 0, generation: 'parent' };
            lifecycle.start({ pid: rootPid, generation: 'parent' });
            const descendant = { ...row, pid: rootPid + 100, ppid: rootPid, parentGeneration: 'parent', generation: 'helper', executablePath: options.lifecycleViolation ? '/bin/bash' : '/synthetic/helper', sha256: 'c'.repeat(64) };
            lifecycle.observe({ at: 0, processes: [row, ...(options.lifecycleSurvivor || options.lifecycleViolation ? [descendant] : [])], visibility: 'COMPLETE', ipc: { state: 'TRANSIENT_TCB_IPC' } });
            if (exited) lifecycle.parentExit({ pid: rootPid, generation: 'parent', at: 250 });
            for (let at = 250; at <= 2250; at += 250) lifecycle.observe({ at, processes: options.lifecycleSurvivor ? [descendant] : [], visibility: 'SAMPLING_ONLY',
              inspection: { process: options.processInspection ?? 'PASS', ipc: options.ipcInspection ?? 'PASS' }, ipc: { state: options.lifecycleIpc ? 'UNAPPROVED_IPC' : 'NO_PERSISTENT_UNAPPROVED_IPC' } });
          }
          let proof = lifecycle.finish();
          if (options.poisonLifecycle) { proof = { ...proof }; Object.defineProperty(proof, 'ambiguousPersistentProcesses', { enumerable: true, get() { throw new Error('synthetic accessor failure'); } }); }
          return { lifecycle: proof, foregroundPidExited: proof.parentExitObserved, processObservation: 'POSTCONDITIONS_CHECKED', newLongLivedClaudeWorkers: 0,
            newSurvivingChildren: proof.survivors, newAttributableChildrenObserved: proof.attributableDescendants, unexpectedUnixSocketObserved: false };
        } };
      },
      sessionCheck: () => options.sessionCheckThrowsAfter && ++counts.sessionChecks > 1 ? (() => { throw new Error('synthetic'); })() : options.sessionPersisted ? (++counts.sessionChecks % 2 === 0) : false,
      adapterFactory: config => {
        const adapter = new ClaudeCliAdapter(config); adapter.probe = async () => ({ available: true });
        const start = adapter.start.bind(adapter); adapter.start = async (...a) => { counts.adapterStarts += 1; const r = await start(...a); if (options.throwAfterAdapter) throw new Error('synthetic'); return r; };
        return adapter;
      },
      removeOwned: entry => { if (options.cleanupFailure) throw new Error('synthetic cleanup failure'); fs.rmSync(entry, { recursive: true, force: true }); },
    };
    counts.sessionChecks = 0;
    for (const key of options.omit ?? []) delete dependencies[key];
    const evidencePath = options.evidencePath === undefined ? path.join(root, 'evidence.json') : options.evidencePath;
    const evidence = await smoke.runOneCallSmoke({ binaryPath: CANDIDATE_PATH, repositoryRoot: process.cwd(), sourceEnv: { HOME: homeDir, USER: 'synthetic', LOGNAME: 'synthetic' },
      evidencePath: evidencePath === null ? undefined : evidencePath, dependencies });
    const persisted = evidencePath && fs.existsSync(evidencePath) && fs.statSync(evidencePath).isFile() ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;
    return { evidence, persisted, counts, root };
  });
}

const D = smoke.ONE_CALL_DECISIONS;

// ---- A. clean pass --------------------------------------------------------------------------------------------------------
test('A: a clean one-call fake run passes, is labelled OFFLINE_SIMULATION and claims no real Claude behaviour', async () => {
  const { evidence, persisted, counts } = await simulate();
  assert.equal(evidence.decision, D.PASS, JSON.stringify([evidence.code, evidence.call?.state, evidence.call?.code]));
  assert.equal(counts.spawned, 1); assert.equal(evidence.providerCallsUsed, 1); assert.equal(evidence.retries, 0);
  assert.equal(evidence.evidenceKind, 'OFFLINE_SIMULATION'); assert.equal(evidence.realClaudeBehaviorEvidence, false); assert.equal(evidence.fullQualification, 'NOT_ESTABLISHED');
  assert.deepEqual(counts.admissionCalls, ['PRE_PREFLIGHT', 'PRE_LAUNCH', 'POST_RUN']);
  assert.equal(evidence.call.hostDiff.changedPaths.join(','), 'target.txt');
  assert.equal(evidence.cleanup, 'PASS'); assert.equal(evidence.fixtureRemoved, true);
  assert.equal(persisted.decision, D.PASS); assert.equal(persisted.evidenceKind, 'OFFLINE_SIMULATION');
  assert.equal(persisted.call.protocol.toolInventory.length, 5);
  assert.equal(fs.existsSync(evidence.call && counts.fixtureRoots[0]), false, 'fixture removed');
});

test('the smoke prompt and PASS rule share one target constant (33-byte-style exact bytes, one LF)', () => {
  assert.equal(smoke.SMOKE_TARGET_EDITED, 'PHASE3B6B_SMOKE_EDITED\n');
  assert.ok(buildPromptContract().includes(JSON.stringify(smoke.SMOKE_TARGET_EDITED)));
  function buildPromptContract() { return smoke.buildSmokePrompt(); }
  assert.deepEqual(smoke.SMOKE_ALLOWED_CHANGED_PATHS, ['target.txt']);
});

test('exact target bytes are required: missing LF, extra LF, wrong text and no edit never pass', async () => {
  for (const targetContent of ['PHASE3B6B_SMOKE_EDITED', 'PHASE3B6B_SMOKE_EDITED\n\n', 'PHASE3B6B_SMOKE_EDITED \n', 'phase3b6b_smoke_edited\n', 'UNCHANGED\n']) {
    const { evidence } = await simulate({ targetContent });
    assert.notEqual(evidence.decision, D.PASS, JSON.stringify(targetContent));
  }
  const { evidence } = await simulate({ noEdit: true });
  assert.equal(evidence.decision, D.FAIL); assert.equal(evidence.code, 'SMOKE_EXPECTATION_FAILED');
});

// ---- B/C/D/E. budget, no retry, isolation ----------------------------------------------------------------------------------
const OPTIONS = { shell: false, env: { PATH: '/usr/bin:/bin' } };
const ARGS = session => ['-p', '--output-format=stream-json', '--verbose', `--session-id=${session}`, '--model=sonnet', '--effort=medium', '--tools=Read,Edit,Write,Glob,Grep',
  '--disallowedTools=Bash,PowerShell,REPL,WebFetch,WebSearch,mcp__*', '--restricted', '--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
  '--no-chrome', '--permission-mode=acceptEdits', '--permission-prompts=none'];
const SESSION = '11111111-2222-4333-8444-555555555555';
function oneCallSpawn(spawnImpl) { return smoke.createOneCallSpawn({ binaryPath: CANDIDATE_PATH, homeDir: CANDIDATE_HOME, inspectBinary: fakeBinaryInspection, spawnImpl }); }

test('B: a failed spawn consumes the one-call budget; C: a second launch is blocked before reaching the spawn', () => {
  let attempts = 0;
  const guarded = oneCallSpawn(() => { attempts += 1; throw new Error('synthetic spawn failure'); });
  assert.throws(() => guarded(CANDIDATE_PATH, ARGS(SESSION), OPTIONS), /synthetic spawn failure/);
  assert.equal(guarded.providerCalls, 1); assert.equal(attempts, 1);
  assert.throws(() => guarded(CANDIDATE_PATH, ARGS(SESSION), OPTIONS), { code: 'SMOKE_PROVIDER_BUDGET_EXCEEDED' });
  assert.equal(attempts, 1, 'the second launch never reaches the spawn'); assert.equal(guarded.providerCalls, 1);
});

test('B: a launch rejected by the canonical guard (never spawned) still consumes the attempt', () => {
  const guarded = oneCallSpawn(() => { assert.fail('must not spawn'); });
  assert.throws(() => guarded(CANDIDATE_PATH, [...ARGS(SESSION), '--dangerously-skip-permissions'], OPTIONS), { code: 'NON_CANONICAL_LAUNCH' });
  assert.equal(guarded.providerCalls, 1);
  assert.throws(() => guarded(CANDIDATE_PATH, ARGS(SESSION), OPTIONS), { code: 'SMOKE_PROVIDER_BUDGET_EXCEEDED' });
});

test('the counter cannot be reset or overwritten, and read-only probes do not consume the budget', () => {
  const guarded = oneCallSpawn(() => ({ pid: 1 }));
  guarded(CANDIDATE_PATH, ['--version'], OPTIONS); guarded(CANDIDATE_PATH, ['--help'], OPTIONS); guarded(CANDIDATE_PATH, ['auth', 'status'], OPTIONS);
  assert.equal(guarded.providerCalls, 0);
  guarded(CANDIDATE_PATH, ARGS(SESSION), OPTIONS);
  assert.throws(() => { guarded.providerCalls = 0; }, TypeError);
  assert.throws(() => Object.defineProperty(guarded, 'providerCalls', { value: 0 }), TypeError);
  assert.equal(guarded.providerCalls, 1);
  assert.throws(() => guarded(CANDIDATE_PATH, ARGS(SESSION), OPTIONS), { code: 'SMOKE_PROVIDER_BUDGET_EXCEEDED' });
});

test('B (full run): an injected spawn failure counts one provider attempt, never passes, and is not retried', async () => {
  const { evidence, counts } = await simulate({ spawnThrows: true });
  assert.notEqual(evidence.decision, D.PASS);
  assert.equal(evidence.providerCallsUsed, 1); assert.equal(counts.spawned, 1); assert.equal(counts.adapterStarts, 1);
});

test('D: no retry after a FAIL, BLOCKED or UNKNOWN run — exactly one adapter start and one spawn', async () => {
  for (const options of [{ lifecycleViolation: true }, { sessionPersisted: true }, { partialFinal: true }, { noEdit: true }, { throwAfterAdapter: true }]) {
    const { evidence, counts } = await simulate(options);
    assert.notEqual(evidence.decision, D.PASS, JSON.stringify(options));
    assert.equal(counts.spawned, 1, JSON.stringify(options)); assert.equal(counts.adapterStarts, 1, JSON.stringify(options)); assert.equal(evidence.retries, 0);
  }
});

test('E: the one-call path never enters calls 2 or 3 and never references the three-call entrypoint', async () => {
  const { evidence, counts } = await simulate();
  assert.equal(counts.spawned, 1); assert.equal(Object.hasOwn(evidence, 'call2'), false); assert.equal(Object.hasOwn(evidence, 'call3'), false);
  for (const forbidden of ['runPhase3B6BQualification', 'preparePhase', 'runBoundedSequence', 'MAX_PROVIDER_CALLS', 'call2', 'call3']) {
    assert.equal(SOURCE.includes(forbidden), false, forbidden);
  }
  assert.equal((SOURCE.match(/adapter\.start\(/g) ?? []).length, 1, 'exactly one adapter.start call site');
  assert.equal(/\bfor\s*\(.*adapter\.start|while\s*\(.*adapter\.start/.test(SOURCE), false);
  assert.equal(smoke.MAX_SMOKE_PROVIDER_CALLS, 1);
});

test('F: the full three-call budget and contract are unchanged and independent of the one-call scope', () => {
  assert.equal(threeCall.MAX_PROVIDER_CALLS, 3);
  const oneCall = oneCallSpawn(() => ({ pid: 1 })); oneCall(CANDIDATE_PATH, ARGS(SESSION), OPTIONS);
  const full = threeCall.createQualificationSpawn({ binaryPath: CANDIDATE_PATH, homeDir: CANDIDATE_HOME, inspectBinary: fakeBinaryInspection, spawnImpl: () => ({ pid: 2 }) });
  for (let i = 1; i <= 3; i += 1) { full(CANDIDATE_PATH, ARGS(SESSION), OPTIONS); assert.equal(full.providerCalls, i); }
  assert.throws(() => full(CANDIDATE_PATH, ARGS(SESSION), OPTIONS), { code: 'PROVIDER_BUDGET_EXCEEDED' });
  assert.equal(oneCall.providerCalls, 1, 'exhausting the full-suite scope does not touch the one-call scope');
});

// ---- G/H/I/J. gates ------------------------------------------------------------------------------------------------------
async function blockedWithoutCandidateAccess(options) {
  const { evidence, counts } = await simulate({ ...options, evidencePath: null });
  assert.equal(evidence.decision, D.BLOCKED, JSON.stringify([options, evidence.code]));
  assert.equal(counts.spawned, 0); assert.equal(counts.preflights, 0, 'the candidate was not touched'); assert.equal(counts.monitors, 0);
  assert.equal(counts.fixtureRoots.length, 0); assert.equal(evidence.providerCallsUsed, 0);
  return evidence;
}

test('G: runtime managed-policy admission UNKNOWN, missing, throwing or malformed blocks any real launch', async () => {
  for (const admission of [() => ({ state: 'MANAGED_POLICY_RUNTIME_ADMISSION_UNKNOWN' }), () => undefined, () => null, () => { throw new Error('synthetic'); }, () => ({ state: 'PASS' }), () => ({ state: true }), () => 'MANAGED_POLICY_RUNTIME_ADMISSION_PASS']) {
    const evidence = await blockedWithoutCandidateAccess({ admission });
    assert.equal(evidence.code, 'MANAGED_POLICY_RUNTIME_ADMISSION_NOT_PASS');
  }
});

test('H: a managed-policy contradiction (at any checkpoint) blocks; a late contradiction never reaches the spawn', async () => {
  await blockedWithoutCandidateAccess({ admission: () => ({ state: 'MANAGED_POLICY_RUNTIME_ADMISSION_CONTRADICTED' }) });
  const late = await simulate({ admission: ({ stage }) => ({ state: stage === 'PRE_LAUNCH' ? 'MANAGED_POLICY_RUNTIME_ADMISSION_CONTRADICTED' : PASS_ADMISSION }), evidencePath: null });
  assert.equal(late.evidence.decision, D.BLOCKED); assert.equal(late.counts.spawned, 0); assert.equal(late.counts.fixtureRoots.length, 0);
  const swapped = await simulate({ admission: ({ stage }) => ({ state: PASS_ADMISSION, attestationId: stage === 'PRE_LAUNCH' ? 'other' : 'a' }), evidencePath: null });
  assert.equal(swapped.evidence.decision, D.BLOCKED, 'a changed attestation identity is a contradiction'); assert.equal(swapped.counts.spawned, 0);
});

test('H: admission drift after the run (post-run checkpoint) can only make the outcome UNKNOWN, never PASS', async () => {
  const { evidence, counts } = await simulate({ admission: ({ stage }) => ({ state: stage === 'POST_RUN' ? 'MANAGED_POLICY_RUNTIME_ADMISSION_CONTRADICTED' : PASS_ADMISSION }) });
  assert.equal(counts.spawned, 1); assert.equal(evidence.decision, D.UNKNOWN); assert.equal(evidence.code, 'ADMISSION_DRIFT');
});

test('I: LIVE_EXECUTION_AUTHORIZED must be exactly true; admission PASS alone does not substitute (and vice versa)', async () => {
  for (const live of [false, undefined, null, 1, 'true', {}]) {
    const evidence = await blockedWithoutCandidateAccess({ live });
    assert.equal(evidence.code, 'LIVE_EXECUTION_NOT_AUTHORIZED'); assert.equal(evidence.gates.liveExecutionAuthorized, false);
  }
  const both = await blockedWithoutCandidateAccess({ live: true, admission: () => ({ state: 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED' }) });
  assert.equal(both.gates.liveExecutionAuthorized, true, 'live authorization alone does not open the gate');
});

test('J: the production defaults are constant-BLOCKED and never touch the candidate', async () => {
  const evidence = await smoke.runOneCallSmoke({ binaryPath: path.join(os.homedir(), '.local/share/cc-qualification/claude/2.1.292/claude'), sourceEnv: { HOME: os.homedir() } });
  assert.equal(evidence.decision, D.BLOCKED); assert.equal(evidence.code, 'MANAGED_POLICY_RUNTIME_ADMISSION_NOT_PASS');
  assert.equal(evidence.providerCallsUsed, 0); assert.equal(evidence.binaryIdentity, 'NOT_INSPECTED'); assert.equal(evidence.evidenceKind, 'REAL_CANDIDATE');
  assert.equal(evidence.gates.managedPolicyRuntimeAdmission.state, 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED'); assert.equal(evidence.gates.liveExecutionAuthorized, false);
});

test('J: injected seams are refused unless every one points away from the real host (a fake PASS cannot authorize a real launch)', async () => {
  const realCandidate = path.join(os.homedir(), '.local/share/cc-qualification/claude/2.1.292/claude');
  const pass = { managedPolicyRuntimeAdmission: () => ({ state: PASS_ADMISSION }), liveExecutionAuthorized: () => true };
  const attempts = [
    ['no spawn override', realCandidate, { ...pass }],
    ['real child_process.spawn', realCandidate, { ...pass, spawnImpl: realSpawn, candidateHomeDir: CANDIDATE_HOME }],
    ['wrapped real spawn + real home', realCandidate, { ...pass, spawnImpl: (...a) => realSpawn(...a), candidateHomeDir: os.homedir() }],
    ['fake spawn + real home', realCandidate, { ...pass, spawnImpl: () => ({}), candidateHomeDir: os.homedir() }],
    ['fake home but real candidate path', realCandidate, { ...pass, spawnImpl: () => ({}), candidateHomeDir: CANDIDATE_HOME }],
    ['relative/odd home', CANDIDATE_PATH, { ...pass, spawnImpl: () => ({}), candidateHomeDir: '/synthetic/../synthetic/home' }],
    ['unknown override name', CANDIDATE_PATH, { ...pass, spawnImpl: () => ({}), candidateHomeDir: CANDIDATE_HOME, bypassAdmission: true }],
  ];
  for (const [name, binaryPath, dependencies] of attempts) {
    const evidence = await smoke.runOneCallSmoke({ binaryPath, sourceEnv: { HOME: os.homedir() }, dependencies });
    assert.equal(evidence.decision, D.BLOCKED, name); assert.equal(evidence.code, 'TEST_SEAM_NOT_PERMITTED_FOR_REAL_LAUNCH', name);
    assert.equal(evidence.providerCallsUsed, 0, name);
  }
});

test('J: the real CLI has no live switch, ignores environment attempts, and cannot execute a fake binary', () => {
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p3b6b9a-cli-'));
  try {
    const sentinel = path.join(sentinelDir, 'executed'); const fake = path.join(sentinelDir, 'claude');
    fs.writeFileSync(fake, `#!/bin/sh\ntouch '${sentinel}'\n`, { mode: 0o755 });
    for (const args of [['--live'], ['--live', '--binary', fake], ['--authorize'], ['--dependencies', '{}'], ['--help']]) {
      const run = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', shell: false, env: { PATH: '/usr/bin:/bin' } });
      assert.equal(run.status, 2, args.join(' ')); assert.match(run.stderr, /no live execution switch/i); assert.equal(run.stdout, '');
    }
    const noArgs = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', shell: false,
      env: { PATH: '/usr/bin:/bin', HOME: sentinelDir, LIVE_EXECUTION_AUTHORIZED: 'true', MANAGED_POLICY_RUNTIME_ADMISSION: PASS_ADMISSION, CC_ONE_CALL_LIVE: '1', NODE_OPTIONS: '' } });
    assert.equal(noArgs.status, 1); const out = JSON.parse(noArgs.stdout);
    assert.equal(out.decision, D.BLOCKED); assert.equal(out.providerCallsUsed, 0); assert.equal(out.gates.liveExecutionAuthorized, false);
    assert.equal(fs.existsSync(sentinel), false, 'no fake or real binary was executed');
    assert.equal(SOURCE.includes('process.env.'), false, 'no environment-driven gate or seam');
    assert.equal(/--live/.test(SOURCE.replace(/'[^']*--live[^']*'|`[^`]*--live[^`]*`/g, '')), false);
  } finally { fs.rmSync(sentinelDir, { recursive: true, force: true }); }
});

// ---- K-R. protocol / tools / lifecycle -------------------------------------------------------------------------------------
test('K: an extra effective tool FAILs; M: a shell tool use FAILs', async () => {
  const extra = await simulate({ extraTool: true });
  assert.equal(extra.evidence.decision, D.FAIL); assert.equal(extra.counts.spawned, 1);
  const shell = await simulate({ shellUse: true });
  assert.equal(shell.evidence.decision, D.FAIL);
});

test('L: an absent tool inventory is UNKNOWN; a short, duplicated or oversized inventory violates the exact five-tool ceiling and FAILs', async () => {
  assert.equal((await simulate({ noInventory: true })).evidence.decision, D.UNKNOWN);
  for (const options of [{ missingTool: true }, { duplicateTool: true }, { extraTool: true }]) {
    const { evidence } = await simulate(options);
    assert.equal(evidence.decision, D.FAIL, JSON.stringify(options));
  }
});

test('M: a forbidden process observed by the lifecycle observer FAILs and stays FAIL through cleanup and a later exception', async () => {
  const a = await simulate({ lifecycleViolation: true });
  assert.equal(a.evidence.decision, D.FAIL);
  const b = await simulate({ lifecycleViolation: true, throwAfterAdapter: true });
  assert.equal(b.evidence.decision, D.FAIL, 'a later adapter exception cannot soften it');
  const c = await simulate({ lifecycleViolation: true, cleanupFailure: true, preflightExtra: { code: Number.NaN } });
  assert.equal(c.evidence.decision, D.FAIL, 'cleanup failure and a serialization failure cannot soften it');
  const e = await simulate({ lifecycleViolation: true, sessionCheckThrowsAfter: true });
  assert.equal(e.evidence.decision, D.FAIL, 'an exception after the violation was observed cannot lose it');
  assert.equal((await simulate({ sessionCheckThrowsAfter: true })).evidence.decision, D.UNKNOWN, 'the same exception without a violation is UNKNOWN');
  const f = await simulate({ lifecycleViolation: true, poisonLifecycle: true });
  assert.equal(f.evidence.decision, D.FAIL, 'an exception while binding the lifecycle cannot soften an observed violation');
  const g = await simulate({ poisonLifecycle: true });
  assert.equal(g.evidence.decision, D.UNKNOWN, 'the same exception without a violation never PASSes');
  const d = await simulate({ lifecycleViolation: true, evidencePath: '/' });
  assert.equal(d.evidence.decision, D.FAIL, 'persistence failure cannot hide it'); assert.equal(d.evidence.evidencePersistence, 'UNKNOWN');
});

test('N: a persistent worker/descendant after the parent exit does not PASS (BLOCKED or worse)', async () => {
  const { evidence } = await simulate({ lifecycleSurvivor: true });
  assert.notEqual(evidence.decision, D.PASS); assert.notEqual(evidence.decision, D.UNKNOWN, JSON.stringify([evidence.call?.state, evidence.call?.code]));
});

test('O/P: incomplete final process or IPC inspection is UNKNOWN; persistent unapproved IPC does not PASS', async () => {
  assert.equal((await simulate({ processInspection: 'UNKNOWN' })).evidence.decision, D.UNKNOWN);
  assert.equal((await simulate({ ipcInspection: 'UNKNOWN' })).evidence.decision, D.UNKNOWN);
  assert.notEqual((await simulate({ lifecycleIpc: true })).evidence.decision, D.PASS);
});

test('empty process snapshots are not proof: a monitor that never saw the parent cannot PASS (UNKNOWN)', async () => {
  const { evidence } = await simulate({ monitorBlind: true });
  assert.equal(evidence.decision, D.UNKNOWN);
  const proof = threeCall.createProcessMonitor({ binaryPath: CANDIDATE_PATH, taskRoot: '/synthetic/task', repositoryRoot: '/synthetic/repo', snapshot: () => new Map(), inspectSockets: () => 'NONE', schedule: () => 1, clear: () => {}, ipcInspectorAvailable: () => true });
  const observation = await proof.finish();
  assert.notEqual(observation.processObservation, 'POSTCONDITIONS_CHECKED');
});

test('Q: session persistence BLOCKs', async () => {
  const { evidence } = await simulate({ sessionPersisted: true });
  assert.equal(evidence.decision, D.BLOCKED); assert.equal(evidence.code, 'SESSION_PERSISTENCE_OBSERVED');
});

test('R: a wrong effective model or a wrong provider/auth route cannot PASS', async () => {
  assert.equal((await simulate({ model: 'opus' })).evidence.decision, D.FAIL);
  assert.equal((await simulate({ model: 'unrecognised-model' })).evidence.decision, D.UNKNOWN);
  assert.equal((await simulate({ routeEvent: { apiProvider: 'bedrock' } })).evidence.decision, D.FAIL);
  assert.equal((await simulate({ routeEvent: { authMethod: 'api_key' } })).evidence.decision, D.FAIL);
  assert.equal((await simulate({ permissionMode: 'bypassPermissions' })).evidence.decision, D.FAIL);
  const authDrift = await simulate({ authDrift: true });
  assert.notEqual(authDrift.evidence.decision, D.PASS);
  assert.equal((await simulate({ preflightBlock: true })).counts.spawned, 0);
});

test('unknown protocol events and a truncated final line stay UNKNOWN', async () => {
  assert.equal((await simulate({ unknownEvent: true })).evidence.decision, D.UNKNOWN);
  assert.equal((await simulate({ partialFinal: true })).evidence.decision, D.UNKNOWN);
});

// ---- S/T. filesystem ----------------------------------------------------------------------------------------------------
const edit = extra => dir => { fs.writeFileSync(path.join(dir, 'target.txt'), smoke.SMOKE_TARGET_EDITED); extra(dir); };
test('S/T: file creation, deletion, mode change and a protected (input.txt) change cannot PASS', async () => {
  const cases = {
    'new file': edit(dir => fs.writeFileSync(path.join(dir, 'extra.txt'), 'x')),
    'new directory': edit(dir => fs.mkdirSync(path.join(dir, 'sub'))),
    'target deleted': dir => fs.rmSync(path.join(dir, 'target.txt')),
    'input deleted': edit(dir => fs.rmSync(path.join(dir, 'input.txt'))),
    'input changed (protected)': edit(dir => fs.writeFileSync(path.join(dir, 'input.txt'), 'CHANGED\n')),
    'mode change': edit(dir => fs.chmodSync(path.join(dir, 'target.txt'), 0o644)),
  };
  for (const [name, mutateFs] of Object.entries(cases)) {
    const { evidence } = await simulate({ mutateFs });
    assert.equal(evidence.decision, D.BLOCKED, name); assert.equal(evidence.code, 'DIFF_POLICY_VIOLATION', name);
  }
});

test('S: symlinks, hardlinks, special files and executables created by the agent FAIL', async () => {
  const cases = {
    symlink: edit(dir => fs.symlinkSync('/etc/hosts', path.join(dir, 'link'))),
    hardlink: edit(dir => fs.linkSync(path.join(dir, 'input.txt'), path.join(dir, 'alias'))),
    fifo: edit(dir => spawnSync('/usr/bin/mkfifo', [path.join(dir, 'pipe')], { shell: false })),
    executable: edit(dir => { fs.writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\n'); fs.chmodSync(path.join(dir, 'run.sh'), 0o755); }),
    gitMetadata: edit(dir => fs.mkdirSync(path.join(dir, '.git'))),
  };
  for (const [name, mutateFs] of Object.entries(cases)) {
    const { evidence } = await simulate({ mutateFs });
    assert.equal(evidence.decision, D.FAIL, name); assert.equal(evidence.code, 'FILESYSTEM_POLICY_VIOLATION', name);
  }
});

// ---- U. evidence ----------------------------------------------------------------------------------------------------------
test('U: an evidence serialization or persistence failure cannot PASS (and cannot hide a violation)', async () => {
  const serialization = await simulate({ preflightExtra: { code: Number.NaN } });
  assert.equal(serialization.evidence.decision, D.UNKNOWN); assert.equal(serialization.evidence.code, 'EVIDENCE_SERIALIZATION_FAILED');
  const persistence = await simulate({ evidencePath: os.tmpdir() });
  assert.equal(persistence.evidence.decision, D.UNKNOWN); assert.equal(persistence.evidence.code, 'EVIDENCE_PERSISTENCE_FAILED');
  const none = await simulate({ evidencePath: null });
  assert.equal(none.evidence.decision, D.UNKNOWN, 'a PASS needs a persisted record');
  const cleanup = await simulate({ cleanupFailure: true });
  assert.equal(cleanup.evidence.decision, D.UNKNOWN); assert.equal(cleanup.evidence.code, 'FIXTURE_CLEANUP_UNKNOWN');
});

test('U: persisted evidence is closed-vocabulary and contains no raw protocol, paths, session ids or credentials', async () => {
  const { persisted, counts } = await simulate({ preflightExtra: { environment: { HOME: '/synthetic/home' }, auth: { email: 'synthetic@example.invalid' }, childEnv: { SECRET: 'synthetic-token' } } });
  const text = JSON.stringify(persisted);
  for (const sentinel of ['synthetic-token', 'synthetic@example.invalid', '/synthetic', counts.fixtureRoots[0], 'SMOKE_TASK_ROOT', 'childEnv']) assert.equal(text.includes(sentinel), false, sentinel);
  assert.equal(persisted.safety.authMutation, false);
  const out = smoke.serializeOneCallEvidence({ decision: D.PASS, get preflight() { assert.fail('getter must not run'); } });
  assert.equal(out.ok, false);
  assert.equal(smoke.serializeOneCallEvidence({ decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS' }).ok, false);
});

test('the pure PASS rule rejects every partially complete record', async () => {
  const { evidence } = await simulate();
  assert.equal(smoke.assessOneCallPass(evidence), true);
  const mutations = {
    gateLive: e => { e.gates.liveExecutionAuthorized = false; }, gateAdmission: e => { e.gates.managedPolicyRuntimeAdmission.state = 'MANAGED_POLICY_RUNTIME_ADMISSION_UNKNOWN'; },
    admissionStable: e => { e.gates.admissionStable = false; }, calls: e => { e.providerCallsUsed = 2; }, noCalls: e => { e.providerCallsUsed = 0; }, retries: e => { e.retries = 1; },
    version: e => { e.preflight.version = '2.1.293'; }, sha: e => { e.preflight.binarySha256 = 'b'.repeat(64); }, authPre: e => { e.authBefore.subscriptionType = 'team'; }, authPost: e => { e.authAfter = undefined; },
    checkpoint: e => { e.checkpoint = undefined; }, callState: e => { e.call.state = 'UNKNOWN'; }, model: e => { e.call.effectiveModel = 'opus'; }, modelState: e => { e.call.modelEvidence = 'UNKNOWN'; },
    protocol: e => { e.call.protocol.protocolState = 'UNKNOWN'; }, inventory: e => { e.call.protocol.toolInventory.pop(); }, invoked: e => { e.call.protocol.invokedTools.push('Bash'); },
    noEditTool: e => { e.call.protocol.invokedTools = ['Read']; }, perm: e => { e.call.protocol.permissionMode = 'default'; }, lifecycle: e => { e.call.process.lifecycle.state = 'LIFECYCLE_UNKNOWN'; },
    survivors: e => { e.call.process.newSurvivingChildren = 1; }, session: e => { e.call.sessionTranscriptObserved = true; }, target: e => { e.call.targetEditExact = false; },
    input: e => { e.call.inputUnchanged = false; }, diff: e => { e.call.hostDiff.changedPaths = ['target.txt', 'x.txt']; }, noDiff: e => { e.call.hostDiff = undefined; },
    cleanup: e => { e.cleanup = 'UNKNOWN'; }, fixture: e => { e.fixtureRemoved = false; }, sessionHash: e => { e.call.sessionIdHash = 'x'; }, disclosure: e => { e.call.protocol.disclosure = true; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const copy = structuredClone(evidence); mutate(copy);
    assert.equal(smoke.assessOneCallPass(copy), false, name);
  }
});

// ---- checkpoint -----------------------------------------------------------------------------------------------------------
test('final checkpoint drift (version, binary hash, auth route) can only raise severity', async () => {
  for (const options of [{ versionDrift: true }, { hashDrift: true }, { authDrift: true }]) {
    const { evidence } = await simulate(options);
    assert.equal(evidence.decision, D.UNKNOWN, JSON.stringify(options));
  }
  const fail = await simulate({ lifecycleViolation: true, hashDrift: true });
  assert.equal(fail.evidence.decision, D.FAIL);
});

// ---- V. provider calls ----------------------------------------------------------------------------------------------------
test('V: no real provider call or candidate execution happened anywhere in this suite', () => {
  assert.equal(strayCommands, 0, 'every fake spawn only ever saw the synthetic candidate path');
  assert.equal(fs.existsSync(CANDIDATE_HOME), false, 'the synthetic candidate home is not a real directory');
  assert.equal(SOURCE.includes("'-p'") && /spawnSync|execFile|exec\(/.test(SOURCE), false, 'the module has no direct process launcher of its own');
});
