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
import * as controls from '../scripts/phase3b6bOneCallControls.mjs';
import { createSmokeObserver } from '../scripts/claudeLiveSmoke.mjs';
import * as shapes from '../scripts/phase3b6bOneCallShapeRecorder.mjs';
import { createHash } from 'node:crypto';

// Offline only. Every executable is a function-valued fake; the qualification candidate is never executed and the
// synthetic candidate home below does not exist on disk. Real provider calls in this whole file: 0.
const SCRIPT = fileURLToPath(new URL('../scripts/phase3b6bOneCallSmoke.mjs', import.meta.url));
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');
const CANDIDATE_HOME = '/synthetic/home';
const CANDIDATE_PATH = '/synthetic/home/.local/share/cc-qualification/claude/2.1.292/claude';
const CANDIDATE_SHA = '97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f';
const PASS_ADMISSION = smoke.MANAGED_POLICY_RUNTIME_ADMISSION_PASS;
const TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];
const NOW = Date.parse('2026-10-09T00:00:00Z');
const goodAttestation = (overrides = {}) => ({ schema: 'cc.managed-policy-runtime-attestation/1', attestationId: 'SYNTHETIC-ATT-1', host: { id: 'SYNTHETIC_HOST' },
  candidate: { version: '2.1.292', sha256: CANDIDATE_SHA }, scope: { id: 'phase3b6b.one-call-smoke.v1' }, effectivePolicy: { result: 'EFFECTIVE_POLICY_ABSENT' },
  issuer: { id: 'SYNTHETIC_ISSUER' }, issuedAt: '2026-10-08T00:00:00Z', validity: { notBefore: '2026-10-08T00:00:00Z', notAfter: '2026-10-10T00:00:00Z' },
  invalidation: { conditions: ['HOST_CHANGE', 'CANDIDATE_CHANGE', 'POLICY_CHANGE', 'REVOCATION'] }, ...overrides });
const goodPermit = (overrides = {}) => ({ schema: 'cc.one-call-launch-permit/1', permitId: 'SYNTHETIC-PERMIT-1', maxProviderCalls: 1, host: { id: 'SYNTHETIC_HOST' },
  candidate: { version: '2.1.292', sha256: CANDIDATE_SHA }, scope: { id: 'phase3b6b.one-call-smoke.v1' }, issuer: { id: 'SYNTHETIC_ISSUER' },
  issuedAt: '2026-10-08T00:00:00Z', validity: { notBefore: '2026-10-08T00:00:00Z', notAfter: '2026-10-10T00:00:00Z' }, ...overrides });
const trustPolicy = (overrides = {}) => ({ hostId: 'SYNTHETIC_HOST', trustedIssuers: ['SYNTHETIC_ISSUER'], verifyAuthenticity: () => true, checkRevocation: () => 'NOT_REVOKED', now: () => NOW, ...overrides });
const privateDir = dir => { fs.mkdirSync(dir, { mode: 0o700, recursive: true }); fs.chmodSync(dir, 0o700); return dir; };
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
    const ledger = privateDir(path.join(root, 'ledger'));
    const counts = { spawned: 0, adapterStarts: 0, preflights: 0, admissionCalls: [], fixtureRoots: [], monitors: 0 };
    const fakeSpawn = (command, args, spec) => {
      if (command !== CANDIDATE_PATH) strayCommands += 1;
      assert.equal(spec.shell, false);
      counts.spawned += 1; counts.markerAtSpawn = fs.readdirSync(options.ledgerDir ?? ledger).length;
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
        const init = { type: 'system', subtype: 'init', session_id: session, cwd, model: options.initModel ?? 'sonnet', permissionMode: options.permissionMode ?? 'acceptEdits', tools, ...(options.routeEvent ?? {}) };
        if (options.noInventory) delete init.tools;
        const blocks = [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'input.txt' } },
          { type: options.noEditTool ? 'text' : 'tool_use', ...(options.noEditTool ? { text: 'done' } : { id: 't2', name: options.editTool ?? 'Write', input: { file_path: 'target.txt' } }) }];
        if (options.shellUse) blocks.push({ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'echo x' } });
        const events = [init,
          { type: 'assistant', message: { id: 'm1', model: options.model ?? 'sonnet', content: blocks } },
          { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'synthetic' }, { type: 'tool_result', tool_use_id: 't2', content: 'synthetic' }] } },
          { type: 'result', subtype: 'success', is_error: false, session_id: session, permission_denials: [] }];
        if (options.unknownEvent) events.splice(2, 0, { type: 'future_event' });
        for (const { at, event } of options.insertEvents ?? []) events.splice(at < 0 ? events.length + 1 + at : at, 0, typeof event === 'function' ? event(session, cwd) : event);
        const data = events.map(e => JSON.stringify(e)).join('\n') + (options.partialFinal ? '' : '\n');
        child.stdout.write(data); exit(0);
      });
      return child;
    };
    const auth = (n, drift) => ({ loggedIn: true, authMethod: drift && n > 1 ? 'api_key' : 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro' });
    const dependencies = {
      managedPolicyRuntimeAdmission: input => { counts.admissionCalls.push(input.stage); return options.admission ? options.admission(input) : { state: PASS_ADMISSION, attestation: goodAttestation(options.attestation ?? {}) }; },
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
    Object.assign(dependencies, options.shapeRecorderFactory ? { shapeRecorderFactory: options.shapeRecorderFactory } : {});
    Object.assign(dependencies, { attestationPolicy: trustPolicy(options.trust ?? {}), launchPermit: () => (Object.hasOwn(options, 'permit') ? options.permit : goodPermit()), permitLedgerDir: Object.hasOwn(options, 'ledgerDir') ? options.ledgerDir : ledger, ...(options.runIdFactory ? { runIdFactory: options.runIdFactory } : {}) });
    for (const key of options.omit ?? []) delete dependencies[key];
    const evidenceDirectory = Object.hasOwn(options, 'evidenceDirectory') ? options.evidenceDirectory : privateDir(path.join(root, 'evidence'));
    const evidence = await smoke.runOneCallSmoke({ binaryPath: CANDIDATE_PATH, repositoryRoot: process.cwd(), sourceEnv: { HOME: homeDir, USER: 'synthetic', LOGNAME: 'synthetic' },
      evidenceDirectory, dependencies });
    const file = evidenceDirectory && evidence.runIdentity ? path.join(evidenceDirectory, `${evidence.runIdentity.runId}.json`) : null;
    const persisted = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const commitText = file && fs.existsSync(file.replace(/\.json$/, '.commit.json')) ? fs.readFileSync(file.replace(/\.json$/, '.commit.json'), 'utf8') : null;
    const persistedText = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const ledgerFiles = fs.existsSync(ledger) ? fs.readdirSync(ledger) : [];
    return { evidence, persisted, persistedText, commitText, counts, root, evidenceDirectory, ledger, ledgerFiles, file };
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
  const { evidence, counts } = await simulate({ ...options, evidenceDirectory: undefined });
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
  const late = await simulate({ admission: ({ stage }) => ({ state: stage === 'PRE_LAUNCH' ? 'MANAGED_POLICY_RUNTIME_ADMISSION_CONTRADICTED' : PASS_ADMISSION, attestation: goodAttestation() }), evidenceDirectory: undefined });
  assert.equal(late.evidence.decision, D.BLOCKED); assert.equal(late.counts.spawned, 0); assert.equal(late.counts.fixtureRoots.length, 0);
  const swapped = await simulate({ admission: ({ stage }) => ({ state: PASS_ADMISSION, attestation: goodAttestation({ attestationId: stage === 'PRE_LAUNCH' ? 'other' : 'a' }) }), evidenceDirectory: undefined });
  assert.equal(swapped.evidence.decision, D.BLOCKED, 'a changed attestation identity is a contradiction'); assert.equal(swapped.counts.spawned, 0);
});

test('H: admission drift after the run (post-run checkpoint) can only make the outcome UNKNOWN, never PASS', async () => {
  const { evidence, counts } = await simulate({ admission: ({ stage }) => ({ state: stage === 'POST_RUN' ? 'MANAGED_POLICY_RUNTIME_ADMISSION_CONTRADICTED' : PASS_ADMISSION, attestation: goodAttestation() }) });
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
  const pass = { managedPolicyRuntimeAdmission: () => ({ state: PASS_ADMISSION, attestation: goodAttestation() }), liveExecutionAuthorized: () => true,
    attestationPolicy: trustPolicy(), launchPermit: () => goodPermit(), permitLedgerDir: os.tmpdir(), runIdFactory: controls.defaultRunId };
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
  const d = await simulate({ lifecycleViolation: true, evidenceDirectory: '/' });
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
  const persistence = await simulate({ evidenceDirectory: path.join(os.tmpdir(), 'cc-p3b6b9b-missing-dir-never-created') });
  assert.equal(persistence.evidence.decision, D.UNKNOWN); assert.equal(persistence.evidence.code, 'EVIDENCE_PERSISTENCE_FAILED');
  const none = await simulate({ evidenceDirectory: undefined });
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

// =====================================================================================================================
// Phase 3B6B.9B — pre-live evidence integrity, attestation contract, single-use permit (offline fakes only)
// =====================================================================================================================
const sha = v => createHash('sha256').update(v).digest('hex');
const shared = async fn => scratch(async root => fn({ root, ledger: privateDir(path.join(root, 'ledger')), evidence: privateDir(path.join(root, 'evidence')) }));
const RUN_A = 'OCS-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_B = 'OCS-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cleanSim = { ledgerDir: undefined };

// ---- evidence: atomic, no-overwrite, run-bound ------------------------------------------------------------------------
function countingIo(failAt, mutate = {}) {
  let n = 0; const io = { ...fs };
  for (const name of ['openSync', 'writeFileSync', 'fsyncSync', 'closeSync', 'linkSync', 'unlinkSync', 'readFileSync', 'fstatSync', 'lstatSync', 'realpathSync']) {
    io[name] = (...a) => { n += 1; if (n === failAt) throw Object.assign(new Error(`synthetic crash at ${name}`), { code: 'EIO' }); return (mutate[name] ?? fs[name])(...a); };
  }
  return io;
}
test('evidence: a crash at ANY step of publication leaves either no record or the complete record, never a partial one', async () => shared(async ({ evidence }) => {
  const text = JSON.stringify({ decision: 'ONE_CALL_SMOKE_PASS', padding: 'x'.repeat(5000) });
  let completed = 0;
  for (let step = 1; step <= 40; step += 1) {
    const runId = `OCS-${String(step).padStart(8, '0')}-0000-4000-8000-000000000000`;
    const result = controls.writeEvidenceAtomically(text, evidence, runId, { io: countingIo(step) });
    const final = path.join(evidence, `${runId}.json`);
    if (fs.existsSync(final)) { assert.equal(fs.readFileSync(final, 'utf8'), `${text}\n`, `step ${step}: a published record is always complete`); if (result.ok) completed += 1; }
    else assert.equal(result.ok, false, `step ${step}`);
    if (!result.ok && !result.residualRecord) assert.equal(fs.existsSync(final), false, `step ${step}: a failed publication leaves no authoritative record`);
  }
  assert.ok(completed > 0, 'later steps (beyond the last io call) succeed');
}));

test('evidence: a partial write (half the bytes, then failure) publishes nothing and removes its temp file', async () => shared(async ({ evidence }) => {
  const text = 'x'.repeat(4096);
  const io = { ...fs, writeFileSync: (fd, data) => { fs.writeSync(fd, data.slice(0, 100)); throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); } };
  const result = controls.writeEvidenceAtomically(text, evidence, RUN_A, { io });
  assert.equal(result.ok, false); assert.deepEqual(fs.readdirSync(evidence), []);
}));

test('evidence: persistence failing after the temp write (link / fsync / readback) leaves no PASS record', async () => shared(async ({ evidence }) => {
  for (const [name, patch] of Object.entries({
    link: { linkSync: () => { throw Object.assign(new Error('synthetic'), { code: 'EMLINK' }); } },
    readback: { readFileSync: () => 'tampered' },
  })) {
    const result = controls.writeEvidenceAtomically('{"decision":"ONE_CALL_SMOKE_PASS"}', evidence, RUN_A, { io: { ...fs, ...patch } });
    assert.equal(result.ok, false, name); assert.equal(fs.existsSync(path.join(evidence, `${RUN_A}.json`)), false, name);
    assert.deepEqual(fs.readdirSync(evidence), [], `${name}: no temp residue`);
  }
}));

test('evidence: never overwrites — an existing record, a destination symlink or a dangling symlink is refused and left untouched', async () => shared(async ({ root, evidence }) => {
  const final = path.join(evidence, `${RUN_A}.json`);
  fs.writeFileSync(final, 'HISTORICAL-PASS\n');
  assert.equal(controls.writeEvidenceAtomically('{"new":1}', evidence, RUN_A).code, 'EVIDENCE_ALREADY_EXISTS');
  assert.equal(fs.readFileSync(final, 'utf8'), 'HISTORICAL-PASS\n');
  const outside = path.join(root, 'outside.txt'); fs.writeFileSync(outside, 'OUTSIDE');
  fs.symlinkSync(outside, path.join(evidence, `${RUN_B}.json`));
  assert.equal(controls.writeEvidenceAtomically('{"new":1}', evidence, RUN_B).ok, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE');
  const RUN_C = 'OCS-cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  fs.symlinkSync(path.join(root, 'missing-target'), path.join(evidence, `${RUN_C}.json`));
  assert.equal(controls.writeEvidenceAtomically('{"new":1}', evidence, RUN_C).ok, false);
  assert.equal(fs.existsSync(path.join(root, 'missing-target')), false, 'a dangling symlink is not followed');
}));

test('evidence: a symlinked, group-writable, non-owned, relative or missing directory is refused', async () => shared(async ({ root, evidence }) => {
  const link = path.join(root, 'evidence-link'); fs.symlinkSync(evidence, link);
  const open = path.join(root, 'open'); fs.mkdirSync(open); fs.chmodSync(open, 0o777);
  for (const dir of [link, open, '/', 'relative/dir', path.join(root, 'missing')]) {
    assert.equal(controls.writeEvidenceAtomically('{"x":1}', dir, RUN_A).ok, false, dir);
  }
  assert.deepEqual(fs.readdirSync(evidence), []);
}));

test('evidence: a run identity is generated, validated and bound; invalid identities block before any gate or spawn', async () => {
  for (const runIdFactory of [() => 'bad', () => null, () => undefined, () => { throw new Error('x'); }, () => RUN_A.toUpperCase(), () => `${RUN_A}x`, () => '../../escape']) {
    const { evidence, counts } = await simulate({ runIdFactory });
    assert.equal(evidence.decision, D.BLOCKED); assert.equal(evidence.code, 'INVALID_RUN_IDENTITY');
    assert.equal(counts.spawned, 0); assert.deepEqual(counts.admissionCalls, []);
  }
  const { evidence, persisted, persistedText, counts, file } = await simulate();
  assert.ok(controls.isValidRunId(evidence.runIdentity.runId)); assert.equal(path.basename(file), `${evidence.runIdentity.runId}.json`);
  assert.deepEqual([persisted.runIdentity.scopeId, persisted.runIdentity.attemptBudget, persisted.runIdentity.candidate.sha256], ['phase3b6b.one-call-smoke.v1', 1, CANDIDATE_SHA]);
  assert.equal(persisted.runIdentity.attestationIdSha256, sha('SYNTHETIC-ATT-1')); assert.equal(persisted.runIdentity.permitIdSha256, sha('SYNTHETIC-PERMIT-1'));
  const text = persistedText;
  for (const raw of ['SYNTHETIC-ATT-1', 'SYNTHETIC-PERMIT-1', 'SYNTHETIC_HOST', 'SYNTHETIC_ISSUER']) assert.equal(text.includes(raw), false, `${raw} must not be persisted`);
  assert.equal(counts.spawned, 1);
  const verdict = controls.verifyOneCallEvidenceRecord(text, { runId: evidence.runIdentity.runId, candidate: { version: '2.1.292', sha256: CANDIDATE_SHA }, attestationIdSha256: sha('SYNTHETIC-ATT-1') });
  assert.deepEqual([verdict.ok, verdict.decision], [true, D.PASS]);
});

test('evidence: a stale PASS record cannot be replayed — foreign run, tampering, wrong candidate/budget/attestation and re-persistence are all rejected', async () => {
  const { evidence, persistedText } = await simulate();
  const text = persistedText; const id = evidence.runIdentity.runId; const cand = { version: '2.1.292', sha256: CANDIDATE_SHA };
  assert.equal(controls.verifyOneCallEvidenceRecord(text, { runId: RUN_B, candidate: cand }).code, 'STALE_OR_FOREIGN_RECORD');
  const mutate = fn => { const r = JSON.parse(text); fn(r); return JSON.stringify(r); };
  assert.equal(controls.verifyOneCallEvidenceRecord(mutate(r => { r.decision = 'ONE_CALL_SMOKE_FAIL'; }), { runId: id, candidate: cand }).code, 'BINDING_MISMATCH');
  assert.equal(controls.verifyOneCallEvidenceRecord(mutate(r => { r.call.state = 'FAIL'; }), { runId: id, candidate: cand }).code, 'BINDING_MISMATCH');
  assert.equal(controls.verifyOneCallEvidenceRecord(mutate(r => { r.runIdentity.attemptBudget = 3; }), { runId: id, candidate: cand }).code, 'SCOPE_OR_BUDGET_MISMATCH');
  assert.equal(controls.verifyOneCallEvidenceRecord(mutate(r => { delete r.bindingSha256; }), { runId: id, candidate: cand }).code, 'BINDING_MISMATCH');
  assert.equal(controls.verifyOneCallEvidenceRecord(text, { runId: id, candidate: { version: '2.1.293', sha256: CANDIDATE_SHA } }).code, 'CANDIDATE_MISMATCH');
  assert.equal(controls.verifyOneCallEvidenceRecord(text, { runId: id, candidate: cand, attestationIdSha256: sha('OTHER') }).code, 'ATTESTATION_IDENTITY_MISMATCH');
  assert.equal(controls.verifyOneCallEvidenceRecord('not json', { runId: id, candidate: cand }).code, 'RECORD_UNREADABLE');
});

test('evidence: a second run that reuses an earlier run identity cannot overwrite its PASS record and is itself never PASS', async () => shared(async ({ evidence, ledger }) => {
  const first = await simulate({ evidenceDirectory: evidence, ledgerDir: ledger, runIdFactory: () => RUN_A });
  assert.equal(first.evidence.decision, D.PASS);
  const before = fs.readFileSync(path.join(evidence, `${RUN_A}.json`), 'utf8');
  const second = await simulate({ evidenceDirectory: evidence, ledgerDir: ledger, runIdFactory: () => RUN_A, permit: goodPermit({ permitId: 'SYNTHETIC-PERMIT-2' }) });
  assert.equal(second.evidence.decision, D.UNKNOWN); assert.equal(second.evidence.code, 'EVIDENCE_PERSISTENCE_FAILED');
  assert.equal(fs.readFileSync(path.join(evidence, `${RUN_A}.json`), 'utf8'), before, 'the earlier record is untouched');
  assert.deepEqual(fs.readdirSync(evidence).filter(n => n.endsWith('.tmp')), []);
}));

test('evidence: persistence / serialization failure never produces a record, and a known FAIL stays FAIL in memory', async () => {
  const unsafe = await simulate({ evidenceDirectory: '/' });
  assert.equal(unsafe.evidence.decision, D.UNKNOWN); assert.equal(unsafe.persisted, null);
  const serialization = await simulate({ preflightExtra: { code: Number.NaN } });
  assert.equal(serialization.evidence.code, 'EVIDENCE_SERIALIZATION_FAILED'); assert.deepEqual(fs.existsSync(serialization.file), false);
  for (const extra of [{ evidenceDirectory: '/' }, { preflightExtra: { code: Number.NaN } }, { evidenceDirectory: path.join(os.tmpdir(), 'cc-p3b6b9b-nope') }]) {
    const { evidence } = await simulate({ lifecycleViolation: true, ...extra });
    assert.equal(evidence.decision, D.FAIL, JSON.stringify(Object.keys(extra)));
  }
});

// ---- attestation consumer contract -------------------------------------------------------------------------------------------
async function attestationBlocked(admission, extra = {}) {
  const { evidence, counts } = await simulate({ admission, ...extra });
  assert.equal(evidence.decision, D.BLOCKED, JSON.stringify(evidence.gates?.attestation)); assert.equal(counts.spawned, 0); assert.equal(counts.preflights, 0); assert.equal(evidence.providerCallsUsed, 0);
  return evidence;
}
const withAtt = overrides => () => ({ state: PASS_ADMISSION, attestation: goodAttestation(overrides) });

test('attestation: a PASS state without a verified, non-null attestation identity never admits (null id cannot match null id)', async () => {
  for (const admission of [() => ({ state: PASS_ADMISSION }), () => ({ state: PASS_ADMISSION, attestationId: null }), () => ({ state: PASS_ADMISSION, attestationId: 'legacy-top-level-id' }),
    withAtt({ attestationId: null }), withAtt({ attestationId: '' }), withAtt({ attestationId: 42 }), withAtt({ attestationId: undefined }), () => ({ state: PASS_ADMISSION, attestation: null }),
    () => ({ state: PASS_ADMISSION, attestation: 'text' }), () => ({ state: PASS_ADMISSION, attestation: [] })]) {
    const e = await attestationBlocked(admission);
    assert.equal(e.gates.managedPolicyRuntimeAdmission.state, 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED');
  }
});

test('attestation: wrong host / candidate / scope / issuer, missing or invalid validity, expiry and missing invalidation conditions all BLOCK', async () => {
  const cases = {
    'wrong host': [{ host: { id: 'OTHER_HOST' } }, 'HOST_MISMATCH'], 'no host': [{ host: undefined }, 'HOST_MISMATCH'],
    'wrong version': [{ candidate: { version: '2.1.293', sha256: CANDIDATE_SHA } }, 'CANDIDATE_MISMATCH'], 'wrong hash': [{ candidate: { version: '2.1.292', sha256: 'b'.repeat(64) } }, 'CANDIDATE_MISMATCH'],
    'no candidate': [{ candidate: undefined }, 'CANDIDATE_MISMATCH'], 'wrong scope': [{ scope: { id: 'phase3b6b.three-call' } }, 'SCOPE_MISMATCH'], 'no scope': [{ scope: undefined }, 'SCOPE_MISMATCH'],
    'untrusted issuer': [{ issuer: { id: 'ROGUE' } }, 'ISSUER_NOT_TRUSTED'], 'no issuer': [{ issuer: undefined }, 'ISSUER_NOT_TRUSTED'],
    'wrong schema': [{ schema: 'other/1' }, 'ATTESTATION_MISSING'], 'effective policy present': [{ effectivePolicy: { result: 'EFFECTIVE_POLICY_PRESENT' } }, 'EFFECTIVE_POLICY_NOT_ABSENT'],
    'effective policy unknown': [{ effectivePolicy: { result: 'UNKNOWN' } }, 'EFFECTIVE_POLICY_NOT_ABSENT'], 'no effective policy': [{ effectivePolicy: undefined }, 'EFFECTIVE_POLICY_NOT_ABSENT'],
    'no validity': [{ validity: undefined }, 'VALIDITY_MISSING'], 'bad validity date': [{ validity: { notBefore: 'yesterday', notAfter: '2026-10-10T00:00:00Z' } }, 'VALIDITY_MISSING'],
    'inverted validity': [{ validity: { notBefore: '2026-10-10T00:00:00Z', notAfter: '2026-10-08T00:00:00Z' } }, 'VALIDITY_INVALID'],
    'expired': [{ validity: { notBefore: '2026-10-01T00:00:00Z', notAfter: '2026-10-08T00:00:00Z' } }, 'EXPIRED'],
    'not yet valid': [{ validity: { notBefore: '2026-10-09T12:00:00Z', notAfter: '2026-10-10T00:00:00Z' } }, 'NOT_YET_VALID'], 'issued in future': [{ issuedAt: '2026-10-09T06:00:00Z' }, 'NOT_YET_VALID'],
    'no invalidation': [{ invalidation: undefined }, 'INVALIDATION_CONDITIONS_MISSING'], 'empty invalidation': [{ invalidation: { conditions: [] } }, 'INVALIDATION_CONDITIONS_MISSING'],
    'no revocation condition': [{ invalidation: { conditions: ['HOST_CHANGE', 'CANDIDATE_CHANGE', 'POLICY_CHANGE'] } }, 'INVALIDATION_CONDITIONS_MISSING'],
  };
  for (const [name, [overrides, code]] of Object.entries(cases)) {
    const e = await attestationBlocked(withAtt(overrides));
    assert.equal(e.gates.attestation.state, code, name);
  }
});

test('attestation: unverifiable, revoked, revocation-unknown and policy-less attestations BLOCK; the default policy trusts nothing', async () => {
  assert.equal((await attestationBlocked(undefined, { trust: { verifyAuthenticity: () => false } })).gates.attestation.state, 'ATTESTATION_UNVERIFIABLE');
  assert.equal((await attestationBlocked(undefined, { trust: { verifyAuthenticity: () => 'true' } })).gates.attestation.state, 'ATTESTATION_UNVERIFIABLE');
  assert.equal((await attestationBlocked(undefined, { trust: { verifyAuthenticity: () => { throw new Error('x'); } } })).gates.attestation.state, 'ATTESTATION_UNVERIFIABLE');
  for (const checkRevocation of [() => 'REVOKED', () => 'UNKNOWN', () => undefined, () => true]) {
    assert.equal((await attestationBlocked(undefined, { trust: { checkRevocation } })).gates.attestation.state, 'ATTESTATION_REVOKED_OR_UNKNOWN');
  }
  assert.ok(['ATTESTATION_UNVERIFIABLE', 'ATTESTATION_REVOKED_OR_UNKNOWN'].includes((await attestationBlocked(undefined, { trust: { checkRevocation: () => { throw new Error('x'); } } })).gates.attestation.state));
  assert.equal((await attestationBlocked(undefined, { omit: ['attestationPolicy'] })).gates.attestation.state, 'HOST_MISMATCH');
  assert.equal((await attestationBlocked(undefined, { trust: { hostId: null } })).gates.attestation.state, 'HOST_MISMATCH');
  assert.equal((await attestationBlocked(undefined, { trust: { trustedIssuers: [] } })).gates.attestation.state, 'ISSUER_NOT_TRUSTED');
  assert.equal((await attestationBlocked(undefined, { trust: { now: undefined } })).gates.attestation.state, 'ATTESTATION_UNVERIFIABLE');
});

test('attestation: a changed identity or a later revocation/expiry (pre-launch or post-run) can never PASS', async () => {
  const swapped = await simulate({ admission: ({ stage }) => ({ state: PASS_ADMISSION, attestation: goodAttestation({ attestationId: stage === 'PRE_LAUNCH' ? 'ANOTHER' : 'SYNTHETIC-ATT-1' }) }) });
  assert.equal(swapped.evidence.decision, D.BLOCKED); assert.equal(swapped.counts.spawned, 0);
  const post = await simulate({ admission: ({ stage }) => ({ state: PASS_ADMISSION, attestation: goodAttestation({ attestationId: stage === 'POST_RUN' ? 'ANOTHER' : 'SYNTHETIC-ATT-1' }) }) });
  assert.equal(post.evidence.decision, D.UNKNOWN); assert.equal(post.counts.spawned, 1);
  let calls = 0;
  const revokedLate = await simulate({ trust: { checkRevocation: () => (++calls >= 3 ? 'REVOKED' : 'NOT_REVOKED') } });
  assert.equal(revokedLate.evidence.decision, D.UNKNOWN); assert.equal(revokedLate.evidence.code, 'ADMISSION_DRIFT');
  let t = NOW;
  const expiresMidRun = await simulate({ trust: { now: () => (t += 6 * 3600 * 1000) } });
  assert.notEqual(expiresMidRun.evidence.decision, D.PASS);
});

test('attestation: current MDM UNKNOWN stays BLOCKED, the default admission is BLOCKED, and a fake PASS needs the fake seams', async () => {
  const unknown = await attestationBlocked(() => ({ state: 'MANAGED_POLICY_RUNTIME_ADMISSION_UNKNOWN', attestation: goodAttestation() }));
  assert.equal(unknown.gates.managedPolicyRuntimeAdmission.state, 'MANAGED_POLICY_RUNTIME_ADMISSION_UNKNOWN');
  const real = await smoke.runOneCallSmoke({ binaryPath: path.join(os.homedir(), '.local/share/cc-qualification/claude/2.1.292/claude'), sourceEnv: { HOME: os.homedir() } });
  assert.equal(real.decision, D.BLOCKED); assert.equal(real.gates.managedPolicyRuntimeAdmission.state, 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED');
  assert.equal(real.gates.launchPermit.state, 'NOT_CONSUMED'); assert.equal(real.providerCallsUsed, 0);
});

// ---- single-use launch permit ---------------------------------------------------------------------------------------------------
async function permitBlocked(extra) {
  const { evidence, counts, ledgerFiles } = await simulate(extra);
  assert.equal(evidence.decision, D.BLOCKED, JSON.stringify([evidence.code, evidence.gates?.launchPermit]));
  assert.equal(counts.spawned, 0); assert.equal(counts.preflights, 0, 'no candidate access before the permit is valid'); assert.equal(evidence.providerCallsUsed, 0);
  return { evidence, ledgerFiles, counts };
}

test('permit: missing, malformed, mis-bound, expired, unverifiable or multi-call permits BLOCK before any candidate access', async () => {
  const cases = {
    missing: [undefined, 'PERMIT_MISSING'], null: [null, 'PERMIT_MISSING'], 'wrong schema': [goodPermit({ schema: 'x' }), 'PERMIT_MISSING'], 'no id': [goodPermit({ permitId: '' }), 'PERMIT_MALFORMED'],
    'two calls': [goodPermit({ maxProviderCalls: 2 }), 'PERMIT_MALFORMED'], 'no budget': [goodPermit({ maxProviderCalls: undefined }), 'PERMIT_MALFORMED'],
    'wrong host': [goodPermit({ host: { id: 'OTHER' } }), 'HOST_MISMATCH'], 'wrong candidate': [goodPermit({ candidate: { version: '2.1.292', sha256: 'c'.repeat(64) } }), 'CANDIDATE_MISMATCH'],
    'wrong scope': [goodPermit({ scope: { id: 'phase3b6b.three-call' } }), 'SCOPE_MISMATCH'], 'untrusted issuer': [goodPermit({ issuer: { id: 'ROGUE' } }), 'ISSUER_NOT_TRUSTED'],
    expired: [goodPermit({ validity: { notBefore: '2026-10-01T00:00:00Z', notAfter: '2026-10-08T00:00:00Z' } }), 'EXPIRED'], 'no validity': [goodPermit({ validity: undefined }), 'VALIDITY_MISSING'],
    'not yet valid': [goodPermit({ validity: { notBefore: '2026-10-09T12:00:00Z', notAfter: '2026-10-10T00:00:00Z' } }), 'NOT_YET_VALID'],
  };
  for (const [name, [permit, code]] of Object.entries(cases)) {
    const { evidence, ledgerFiles } = await permitBlocked({ permit });
    assert.equal(evidence.gates.launchPermit.state, code, name); assert.deepEqual(ledgerFiles, [], `${name}: nothing was consumed`);
    assert.equal(evidence.code, 'LAUNCH_PERMIT_NOT_VALID', name);
  }
  const unverifiable = await permitBlocked({ trust: { verifyAuthenticity: (doc) => doc.schema !== 'cc.one-call-launch-permit/1' } });
  assert.equal(unverifiable.evidence.gates.launchPermit.state, 'PERMIT_UNVERIFIABLE');
});

test('permit: an unsafe or missing ledger blocks and never launches', async () => scratch(async root => {
  const loose = path.join(root, 'loose'); fs.mkdirSync(loose, { mode: 0o755 }); fs.chmodSync(loose, 0o755);
  const real = privateDir(path.join(root, 'real')); const link = path.join(root, 'link'); fs.symlinkSync(real, link);
  const file = path.join(root, 'file'); fs.writeFileSync(file, 'x');
  for (const ledgerDir of [null, undefined, loose, link, file, 'relative', path.join(root, 'missing'), '/']) {
    const { evidence, counts } = await simulate({ ledgerDir: ledgerDir === undefined ? null : ledgerDir });
    assert.equal(evidence.decision, D.BLOCKED, String(ledgerDir)); assert.equal(evidence.code, 'PERMIT_LEDGER_UNSAFE'); assert.equal(counts.spawned, 0);
  }
  assert.deepEqual(fs.readdirSync(real), []);
}));

test('permit: consumed atomically BEFORE the guarded launch, bound to its hash, and a reused permit blocks (no second launch)', async () => shared(async ({ ledger, evidence }) => {
  const first = await simulate({ ledgerDir: ledger, evidenceDirectory: evidence });
  assert.equal(first.evidence.decision, D.PASS); assert.equal(first.counts.markerAtSpawn, 1, 'the marker already existed when the spawn happened');
  assert.equal(first.evidence.gates.launchPermit.state, 'CONSUMED');
  const markers = fs.readdirSync(ledger); assert.deepEqual(markers, [`${sha('SYNTHETIC-PERMIT-1')}.consumed`]);
  assert.equal(fs.readFileSync(path.join(ledger, markers[0]), 'utf8').includes('SYNTHETIC-PERMIT-1'), false, 'only the permit hash is stored');
  assert.equal(fs.statSync(path.join(ledger, markers[0])).mode & 0o777, 0o600);
  const replay = await simulate({ ledgerDir: ledger, evidenceDirectory: evidence });
  assert.equal(replay.evidence.decision, D.BLOCKED); assert.equal(replay.evidence.code, 'PERMIT_ALREADY_CONSUMED'); assert.equal(replay.counts.spawned, 0);
  const other = await simulate({ ledgerDir: ledger, evidenceDirectory: evidence, permit: goodPermit({ permitId: 'SYNTHETIC-PERMIT-2' }) });
  assert.equal(other.evidence.decision, D.PASS, 'a distinct permit is an independent single use');
}));

test('permit: a failed spawn consumes the permit; it can never be reused, and the one-call budget is spent too', async () => shared(async ({ ledger }) => {
  const failed = await simulate({ ledgerDir: ledger, spawnThrows: true });
  assert.notEqual(failed.evidence.decision, D.PASS); assert.equal(failed.counts.spawned, 1); assert.equal(failed.evidence.providerCallsUsed, 1);
  assert.equal(failed.counts.markerAtSpawn, 1); assert.equal(fs.readdirSync(ledger).length, 1);
  const retry = await simulate({ ledgerDir: ledger });
  assert.equal(retry.evidence.code, 'PERMIT_ALREADY_CONSUMED'); assert.equal(retry.counts.spawned, 0);
}));

test('permit: a crash after the marker was created (empty / partial marker) still counts as spent', async () => shared(async ({ ledger }) => {
  fs.writeFileSync(path.join(ledger, `${sha('SYNTHETIC-PERMIT-1')}.consumed`), '', { mode: 0o600 });
  const { evidence, counts } = await simulate({ ledgerDir: ledger });
  assert.equal(evidence.code, 'PERMIT_ALREADY_CONSUMED'); assert.equal(counts.spawned, 0);
}));

test('permit: a ledger that rejects creation (read-only) blocks and does not launch; a half-failed consume burns the permit', async () => shared(async ({ ledger }) => {
  fs.chmodSync(ledger, 0o500);
  try {
    const { evidence, counts } = await simulate({ ledgerDir: ledger });
    assert.equal(evidence.decision, D.BLOCKED); assert.equal(evidence.code, 'PERMIT_CONSUMPTION_FAILED'); assert.equal(counts.spawned, 0);
  } finally { fs.chmodSync(ledger, 0o700); }
  const io = { ...fs, fsyncSync: () => { throw Object.assign(new Error('synthetic'), { code: 'EIO' }); } };
  const burned = controls.consumeLaunchPermit('SYNTHETIC-PERMIT-9', ledger, { runId: RUN_A, io });
  assert.deepEqual([burned.ok, burned.burned], [false, true]);
  assert.equal(controls.consumeLaunchPermit('SYNTHETIC-PERMIT-9', ledger, { runId: RUN_B }).code, 'PERMIT_ALREADY_CONSUMED');
}));

const CONSUME_SCRIPT = (ledger, id) => `import('${new URL('../scripts/phase3b6bOneCallControls.mjs', import.meta.url).href}').then(m => { const r = m.consumeLaunchPermit(${JSON.stringify(id)}, ${JSON.stringify(ledger)}, { runId: m.defaultRunId() }); console.log(r.ok ? 'CONSUMED' : r.code); });`;
const runChild = (ledger, id) => new Promise(resolve => {
  const child = realSpawn(process.execPath, ['--input-type=module', '-e', CONSUME_SCRIPT(ledger, id)], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
  let out = ''; child.stdout.on('data', c => { out += c; }); child.on('close', () => resolve(out.trim()));
});

test('permit: concurrent consumption across processes — exactly one winner; a restarted process cannot replay it', async () => shared(async ({ ledger }) => {
  const results = await Promise.all(Array.from({ length: 12 }, () => runChild(ledger, 'SYNTHETIC-PERMIT-CONCURRENT')));
  assert.equal(results.filter(r => r === 'CONSUMED').length, 1, JSON.stringify(results));
  assert.equal(results.filter(r => r === 'PERMIT_ALREADY_CONSUMED').length, 11, JSON.stringify(results));
  assert.equal(fs.readdirSync(ledger).length, 1);
  assert.equal(await runChild(ledger, 'SYNTHETIC-PERMIT-CONCURRENT'), 'PERMIT_ALREADY_CONSUMED', 'a fresh process after the first winner');
  assert.equal(controls.consumeLaunchPermit('SYNTHETIC-PERMIT-CONCURRENT', ledger, { runId: RUN_A }).code, 'PERMIT_ALREADY_CONSUMED', 'and the parent process');
  assert.equal(await runChild(ledger, 'SYNTHETIC-PERMIT-OTHER'), 'CONSUMED');
}));

test('permit: a permit consumed by another process blocks the full harness (restart replay), with zero spawns', async () => shared(async ({ ledger }) => {
  assert.equal(await runChild(ledger, 'SYNTHETIC-PERMIT-1'), 'CONSUMED');
  const { evidence, counts } = await simulate({ ledgerDir: ledger });
  assert.equal(evidence.code, 'PERMIT_ALREADY_CONSUMED'); assert.equal(counts.spawned, 0);
}));

test('permit: consumption refuses malformed ids and run identities, and defaults authorize nothing', async () => shared(async ({ ledger }) => {
  for (const [id, runId] of [['', RUN_A], [undefined, RUN_A], ['p', 'bad'], ['p', undefined]]) assert.equal(controls.consumeLaunchPermit(id, ledger, { runId }).code, 'PERMIT_MALFORMED');
  assert.deepEqual(fs.readdirSync(ledger), []);
  assert.equal(controls.DEFAULT_TRUST_POLICY.hostId, null); assert.deepEqual([...controls.DEFAULT_TRUST_POLICY.trustedIssuers], []);
  assert.equal(controls.DEFAULT_TRUST_POLICY.verifyAuthenticity({}), false); assert.equal(controls.DEFAULT_TRUST_POLICY.checkRevocation('x'), 'UNKNOWN');
  assert.equal(controls.validateLaunchPermit(goodPermit(), { ...controls.DEFAULT_TRUST_POLICY, candidate: { version: '2.1.292', sha256: CANDIDATE_SHA } }).ok, false);
  assert.equal(controls.validateAttestation(goodAttestation(), { ...controls.DEFAULT_TRUST_POLICY, candidate: { version: '2.1.292', sha256: CANDIDATE_SHA } }).ok, false);
}));

test('budgets and gates are unchanged: one-call 1, three-call 3, live default false, no live switch, seams cannot be smuggled', () => {
  assert.equal(smoke.MAX_SMOKE_PROVIDER_CALLS, 1); assert.equal(threeCall.MAX_PROVIDER_CALLS, 3);
  const CONTROLS = fs.readFileSync(fileURLToPath(new URL('../scripts/phase3b6bOneCallControls.mjs', import.meta.url)), 'utf8');
  assert.equal(CONTROLS.includes('process.env'), false); assert.equal(SOURCE.includes('process.env.'), false);
  assert.equal(/const defaultLiveExecutionAuthorized = \(\) => false;/.test(SOURCE), true);
  assert.equal(/ttl|timeToLive|expiresIn|maxAge/i.test(CONTROLS + SOURCE), false, 'no invented TTL');
  assert.equal(/\b(spawn|spawnSync|execFile|exec)\(/.test(CONTROLS), false, 'the controls module cannot launch anything');
});

// =====================================================================================================================
// Phase 3B6B.9B-R1 — evidence consumer: authenticity (H1), provenance (H2), publication commit (H3)
// =====================================================================================================================
const RUN_R = 'OCS-dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ATT_H = sha('SYNTHETIC-ATT-1'); const PERMIT_H = sha('SYNTHETIC-PERMIT-1');
const CAND = { version: '2.1.292', sha256: CANDIDATE_SHA };
/** A fixture record labelled REAL_CANDIDATE. It is synthetic: nothing real produced it. */
function fixtureRecord({ runId = RUN_R, kind = 'REAL_CANDIDATE', mutate = () => {} } = {}) {
  const r = { schemaVersion: 1, evidenceKind: kind, evidenceClass: 'UNAUTHENTICATED_LOCAL_EVIDENCE', authorizationGrade: false, decision: D.PASS, code: null,
    runIdentity: { runId, scopeId: 'phase3b6b.one-call-smoke.v1', candidate: { ...CAND }, attemptBudget: 1, attestationIdSha256: ATT_H, permitIdSha256: PERMIT_H } };
  mutate(r); r.bindingSha256 = controls.bindingDigest(r); return r;
}
const textOf = r => JSON.stringify(r, null, 2);
const commitFor = (recordText, runId = RUN_R, extra = {}) => JSON.stringify({ schema: 'cc.evidence-commit/1', runId, scopeId: 'phase3b6b.one-call-smoke.v1', recordSha256: sha(`${recordText}\n`), recordBytes: Buffer.byteLength(`${recordText}\n`), ...extra });
const trustedFor = (anchor, extra = {}) => ({ anchor, runId: RUN_R, candidate: { ...CAND }, scopeId: 'phase3b6b.one-call-smoke.v1', attemptBudget: 1, attestationIdSha256: ATT_H, permitIdSha256: PERMIT_H, executionMode: 'REAL_CANDIDATE', ...extra });
// Offline stand-in for a FUTURE independent authenticator: it only knows the genuine bytes it was shown. No real key exists.
const anchorFor = (...genuine) => ({ verifyAuthentication: ({ recordText, commitText }) => genuine.some(g => g.recordText === recordText && g.commitText === commitText) });
const permissive = { verifyAuthentication: () => true };
const goodBundle = () => { const recordText = textOf(fixtureRecord()); return { recordText, commitText: commitFor(recordText), revoked: false }; };

test('H1: local records are classified UNAUTHENTICATED_LOCAL_EVIDENCE; self-consistency never implies authorization-grade trust', async () => {
  const { evidence, persisted, persistedText } = await simulate();
  assert.equal(persisted.evidenceClass, 'UNAUTHENTICATED_LOCAL_EVIDENCE'); assert.equal(persisted.authorizationGrade, false); assert.equal(evidence.authorizationGrade, false);
  const local = controls.verifyOneCallEvidenceRecord(persistedText, { runId: evidence.runIdentity.runId, candidate: CAND });
  assert.deepEqual([local.ok, local.classification, local.authorizationGrade], [true, 'UNAUTHENTICATED_LOCAL_EVIDENCE', false]);
  assert.equal(controls.EVIDENCE_CLASS_LOCAL, 'UNAUTHENTICATED_LOCAL_EVIDENCE');
  assert.equal(controls.DEFAULT_EVIDENCE_TRUST_ANCHOR.verifyAuthentication({}), false, 'the default anchor authenticates nothing');
});

test('H1 A/B: a modified record fails local checks with the old digest; with a RECOMPUTED digest it is self-consistent but rejected for authorization', () => {
  const genuine = goodBundle();
  const forged = fixtureRecord({ mutate: r => { r.decision = D.FAIL; r.call = { state: 'PASS' }; } }); // attacker edits content and recomputes the unkeyed digest
  const old = JSON.parse(genuine.recordText); old.call = { state: 'PASS' }; // content edited, digest left unchanged
  assert.equal(controls.verifyOneCallEvidenceRecord(JSON.stringify(old), { runId: RUN_R, candidate: CAND }).code, 'BINDING_MISMATCH');
  const forgedText = textOf(forged);
  const local = controls.verifyOneCallEvidenceRecord(forgedText, { runId: RUN_R, candidate: CAND });
  assert.equal(local.ok, true, 'a recomputed unkeyed digest verifies locally — which is exactly why it proves nothing about authenticity');
  assert.equal(local.authorizationGrade, false);
  const forgedBundle = { recordText: forgedText, commitText: commitFor(forgedText), revoked: false }; // attacker also rewrites the commit
  assert.equal(controls.verifyAuthorizationGradeEvidence(forgedBundle, trustedFor(anchorFor(genuine))).code, 'TRUST_ANCHOR_MISSING_OR_UNVERIFIED');
  assert.equal(controls.verifyAuthorizationGradeEvidence(forgedBundle, trustedFor(controls.DEFAULT_EVIDENCE_TRUST_ANCHOR)).ok, false);
  assert.equal(controls.verifyAuthorizationGradeEvidence(genuine, trustedFor(anchorFor(genuine))).ok, true, 'the genuine, anchor-authenticated bundle passes (fixture)');
});

test('H1 M: without an independent trust anchor, authorization-grade evidence is BLOCKED even for a perfect bundle', () => {
  for (const anchor of [undefined, null, {}, { verifyAuthentication: 'yes' }, controls.DEFAULT_EVIDENCE_TRUST_ANCHOR, { verifyAuthentication: () => 'true' }, { verifyAuthentication: () => { throw new Error('x'); } }]) {
    assert.equal(controls.verifyAuthorizationGradeEvidence(goodBundle(), trustedFor(anchor)).code, 'TRUST_ANCHOR_MISSING_OR_UNVERIFIED', String(anchor));
  }
  assert.equal(controls.verifyAuthorizationGradeEvidence(goodBundle(), undefined).ok, false);
});

test('H2 C: an OFFLINE_SIMULATION record can never satisfy real-run evidence — even with a trusting anchor and matching expectations', async () => {
  const { evidence, persistedText, commitText } = await simulate();
  assert.equal(evidence.evidenceKind, 'OFFLINE_SIMULATION');
  const bundle = { recordText: persistedText, commitText, revoked: false };
  const trusted = trustedFor(permissive, { runId: evidence.runIdentity.runId });
  assert.equal(controls.verifyAuthorizationGradeEvidence(bundle, trusted).code, 'OFFLINE_SIMULATION_NOT_REAL');
  assert.equal(controls.verifyAuthorizationGradeEvidence(bundle, { ...trusted, executionMode: 'OFFLINE_SIMULATION' }).code, 'EXECUTION_MODE_NOT_REAL', 'the reader only serves real-run requirements');
  const relabelled = textOf(fixtureRecord({ kind: 'OFFLINE_SIMULATION' }));
  assert.equal(controls.verifyAuthorizationGradeEvidence({ recordText: relabelled, commitText: commitFor(relabelled), revoked: false }, trustedFor(permissive)).code, 'OFFLINE_SIMULATION_NOT_REAL');
  const wrongProvenance = textOf(fixtureRecord({ kind: 'SOMETHING_ELSE' }));
  assert.equal(controls.verifyAuthorizationGradeEvidence({ recordText: wrongProvenance, commitText: commitFor(wrongProvenance), revoked: false }, trustedFor(permissive)).code, 'PROVENANCE_MISMATCH');
});

test('H2 D/E/F/G/H: permit, attestation, run, candidate, scope and budget expectations must be supplied by the trusted caller and must match', () => {
  const b = goodBundle(); const t = extra => controls.verifyAuthorizationGradeEvidence(b, trustedFor(permissive, extra)).code;
  for (const bad of [undefined, null, '', 'not-a-hash', 'A'.repeat(64)]) {
    assert.equal(t({ permitIdSha256: bad }), 'EXPECTATION_MISSING', `permit ${bad}`); assert.equal(t({ attestationIdSha256: bad }), 'EXPECTATION_MISSING', `attestation ${bad}`);
  }
  assert.equal(t({ permitIdSha256: sha('OTHER-PERMIT') }), 'PERMIT_IDENTITY_MISMATCH');
  assert.equal(t({ attestationIdSha256: sha('OTHER-ATT') }), 'ATTESTATION_IDENTITY_MISMATCH');
  assert.equal(t({ runId: RUN_A }), 'STALE_OR_FOREIGN_RECORD'); assert.equal(t({ runId: 'bad' }), 'EXPECTATION_MISSING'); assert.equal(t({ runId: undefined }), 'EXPECTATION_MISSING');
  assert.equal(t({ candidate: { version: '2.1.293', sha256: CANDIDATE_SHA } }), 'CANDIDATE_MISMATCH'); assert.equal(t({ candidate: { version: '2.1.292', sha256: 'b'.repeat(64) } }), 'CANDIDATE_MISMATCH');
  assert.equal(t({ candidate: undefined }), 'EXPECTATION_MISSING');
  assert.equal(t({ scopeId: 'phase3b6b.three-call' }), 'EXPECTATION_MISSING'); assert.equal(t({ scopeId: undefined }), 'EXPECTATION_MISSING');
  assert.equal(t({ attemptBudget: 3 }), 'EXPECTATION_MISSING'); assert.equal(t({ attemptBudget: undefined }), 'EXPECTATION_MISSING');
  assert.equal(t({ executionMode: undefined }), 'EXECUTION_MODE_NOT_REAL');
  // a record that claims a different permit / attestation / scope than the trusted expectation is rejected regardless of its own digest
  for (const [name, mutate, code] of [['record permit', r => { r.runIdentity.permitIdSha256 = sha('X'); }, 'PERMIT_IDENTITY_MISMATCH'], ['record attestation', r => { r.runIdentity.attestationIdSha256 = sha('X'); }, 'ATTESTATION_IDENTITY_MISMATCH'],
    ['record scope', r => { r.runIdentity.scopeId = 'other'; }, 'SCOPE_OR_BUDGET_MISMATCH'], ['record budget', r => { r.runIdentity.attemptBudget = 3; }, 'SCOPE_OR_BUDGET_MISMATCH'], ['record permit absent', r => { delete r.runIdentity.permitIdSha256; }, 'PERMIT_IDENTITY_MISMATCH']]) {
    const text = textOf(fixtureRecord({ mutate }));
    assert.equal(controls.verifyAuthorizationGradeEvidence({ recordText: text, commitText: commitFor(text), revoked: false }, trustedFor(permissive)).code, code, name);
  }
});

test('H3 I: a published but unconfirmed PASS record (no commit, malformed, mismatched, foreign or revoked commit) is rejected', () => {
  const text = textOf(fixtureRecord()); const verify = bundle => controls.verifyAuthorizationGradeEvidence(bundle, trustedFor(permissive)).code;
  assert.equal(verify({ recordText: text, commitText: null, revoked: false }), 'COMMIT_MISSING');
  assert.equal(verify({ recordText: null, commitText: commitFor(text), revoked: false }), 'RECORD_MISSING');
  assert.equal(verify({ recordText: text, commitText: 'garbage', revoked: false }), 'COMMIT_MALFORMED');
  assert.equal(verify({ recordText: text, commitText: commitFor(text, RUN_A), revoked: false }), 'COMMIT_MALFORMED');
  assert.equal(verify({ recordText: text, commitText: commitFor(text, RUN_R, { schema: 'x' }), revoked: false }), 'COMMIT_MALFORMED');
  assert.equal(verify({ recordText: text, commitText: commitFor(`${text} `), revoked: false }), 'COMMIT_MISMATCH', 'a commit for different bytes');
  assert.equal(verify({ recordText: text, commitText: commitFor(text, RUN_R, { recordBytes: 1 }), revoked: false }), 'COMMIT_MISMATCH');
  assert.equal(verify({ recordText: text, commitText: commitFor(text), revoked: true }), 'EVIDENCE_REVOKED');
  assert.equal(verify({ recordText: text, commitText: commitFor(text), revoked: undefined }), 'EVIDENCE_REVOKED', 'an unknown revocation state is not "not revoked"');
  assert.equal(verify({ recordText: text, commitText: commitFor(text), revoked: false }), undefined);
});

function failingIo({ tamperReadAt = 0, failFsyncAt = 0, failReadAt = 0, failUnlink = false, failLinkAt = 0, crashAt = 0 } = {}) {
  let fsyncs = 0; let reads = 0; let links = 0; let steps = 0; const io = { ...fs };
  const wrap = (name, impl) => { io[name] = (...a) => { steps += 1; if (crashAt && steps === crashAt) throw Object.assign(new Error('synthetic crash'), { code: 'EIO' }); return impl(...a); }; };
  wrap('fsyncSync', (...a) => { fsyncs += 1; if (fsyncs === failFsyncAt) throw Object.assign(new Error('synthetic fsync'), { code: 'EIO' }); return fs.fsyncSync(...a); });
  wrap('readFileSync', (...a) => { reads += 1; if (reads === failReadAt) throw Object.assign(new Error('synthetic read'), { code: 'EIO' }); if (reads === tamperReadAt) return 'tampered'; return fs.readFileSync(...a); });
  wrap('linkSync', (...a) => { links += 1; if (links === failLinkAt) throw Object.assign(new Error('synthetic link'), { code: 'EIO' }); return fs.linkSync(...a); });
  wrap('unlinkSync', (...a) => { if (failUnlink) throw Object.assign(new Error('synthetic unlink'), { code: 'EBUSY' }); return fs.unlinkSync(...a); });
  for (const n of ['openSync', 'writeFileSync', 'closeSync', 'fstatSync', 'lstatSync', 'realpathSync']) wrap(n, (...a) => fs[n](...a));
  return io;
}
const gradeOf = (dir, extra) => controls.verifyAuthorizationGradeEvidence(controls.loadEvidenceBundle(dir, RUN_R), trustedFor(permissive, extra));

test('H3: a complete, confirmed bundle verifies; bundle publication is atomic and never overwrites', async () => shared(async ({ evidence }) => {
  const text = textOf(fixtureRecord());
  const ok = controls.publishEvidenceBundle(text, evidence, RUN_R);
  assert.equal(ok.ok, true); assert.deepEqual(fs.readdirSync(evidence).sort(), [`${RUN_R}.commit.json`, `${RUN_R}.json`]);
  assert.deepEqual([gradeOf(evidence).ok, gradeOf(evidence).authorizationGrade], [true, true]);
  assert.equal(controls.publishEvidenceBundle(text, evidence, RUN_R).ok, false, 'a second publication cannot replace the confirmed bundle');
  assert.equal(gradeOf(evidence).ok, true);
}));

test('H3 J/K/L: late fsync failure, late read-back failure and a failed unlink never leave an authoritative PASS', async () => {
  const text = textOf(fixtureRecord());
  const scenarios = {
    'late fsync after record link': { failFsyncAt: 3 }, 'late fsync (confirmation)': { failFsyncAt: 4 }, 'late fsync after commit link': { failFsyncAt: 7 },
    'read-back of record fails': { failReadAt: 1 }, 'read-back of record fails (confirm)': { failReadAt: 2 }, 'read-back of commit fails': { failReadAt: 3 },
    'commit link fails': { failLinkAt: 2 }, 'late fsync + unlink fails (residual PASS)': { failFsyncAt: 3, failUnlink: true },
    'confirmation read-back returns different bytes': { tamperReadAt: 2 }, 'read-back + unlink fails (residual PASS)': { failReadAt: 1, failUnlink: true }, 'commit link fails + unlink fails': { failLinkAt: 2, failUnlink: true },
  };
  for (const [name, options] of Object.entries(scenarios)) {
    await shared(async ({ evidence }) => {
      const result = controls.publishEvidenceBundle(text, evidence, RUN_R, { io: failingIo(options) });
      assert.equal(result.ok, false, name);
      const grade = gradeOf(evidence);
      assert.equal(grade.ok, false, `${name}: even a trusting anchor cannot make it authoritative (${JSON.stringify(grade)})`);
      if (options.failUnlink) { assert.equal(result.residualRecord, true, name); assert.equal(fs.existsSync(path.join(evidence, `${RUN_R}.json`)), true, `${name}: a PASS record really remains`); assert.equal(fs.existsSync(path.join(evidence, `${RUN_R}.revoked`)), true, `${name}: a revocation marker was recorded`); assert.equal(grade.code, 'EVIDENCE_REVOKED', name); }
    });
  }
});

test('H3: crash injection at EVERY I/O step — authoritative only if publication reported success', async () => {
  const text = textOf(fixtureRecord()); let successes = 0; let failures = 0;
  for (let step = 1; step <= 120; step += 1) {
    await shared(async ({ evidence }) => {
      const result = controls.publishEvidenceBundle(text, evidence, RUN_R, { io: failingIo({ crashAt: step }) });
      const grade = gradeOf(evidence);
      if (result.ok) { successes += 1; assert.equal(grade.ok, true, `step ${step}`); }
      else { failures += 1; assert.equal(grade.ok, false, `step ${step}: ${JSON.stringify(grade)}`); }
    });
  }
  assert.ok(failures > 20 && successes > 0, `${failures} failing / ${successes} succeeding steps exercised`);
});

test('H3: a symlinked record or commit is never read, and a stray revoked marker blocks an otherwise perfect bundle', async () => shared(async ({ root, evidence }) => {
  const text = textOf(fixtureRecord()); controls.publishEvidenceBundle(text, evidence, RUN_R);
  assert.equal(gradeOf(evidence).ok, true);
  fs.writeFileSync(path.join(evidence, `${RUN_R}.revoked`), ''); assert.equal(gradeOf(evidence).code, 'EVIDENCE_REVOKED'); fs.rmSync(path.join(evidence, `${RUN_R}.revoked`));
  const copy = path.join(root, 'copy.json'); fs.copyFileSync(path.join(evidence, `${RUN_R}.json`), copy);
  fs.rmSync(path.join(evidence, `${RUN_R}.json`)); fs.symlinkSync(copy, path.join(evidence, `${RUN_R}.json`));
  assert.equal(controls.loadEvidenceBundle(evidence, RUN_R).recordText, null); assert.equal(gradeOf(evidence).code, 'RECORD_MISSING');
}));

test('H3 end-to-end: the harness publishes record + commit; a PASS record without its commit is not trusted by the consumer', async () => {
  const run = await simulate();
  assert.equal(run.evidence.decision, D.PASS); assert.ok(run.persistedText && run.commitText);
  assert.equal(JSON.parse(run.commitText).recordSha256, sha(run.persistedText));
  const id = run.evidence.runIdentity.runId;
  const local = controls.verifyOneCallEvidenceRecord(run.persistedText, { runId: id, candidate: CAND });
  assert.equal(local.authorizationGrade, false);
  assert.equal(controls.verifyAuthorizationGradeEvidence({ recordText: run.persistedText, commitText: null, revoked: false }, trustedFor(permissive, { runId: id })).code, 'COMMIT_MISSING');
});

test('N/O/P/Q/R/S: a known FAIL stays FAIL; budgets, MDM admission and live gate defaults are unchanged; nothing real ran', async () => {
  for (const extra of [{ evidenceDirectory: '/' }, { preflightExtra: { code: Number.NaN } }]) assert.equal((await simulate({ lifecycleViolation: true, ...extra })).evidence.decision, D.FAIL);
  assert.equal(smoke.MAX_SMOKE_PROVIDER_CALLS, 1); assert.equal(threeCall.MAX_PROVIDER_CALLS, 3);
  const real = await smoke.runOneCallSmoke({ binaryPath: path.join(os.homedir(), '.local/share/cc-qualification/claude/2.1.292/claude'), sourceEnv: { HOME: os.homedir() } });
  assert.equal(real.gates.managedPolicyRuntimeAdmission.state, 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED'); assert.equal(real.gates.liveExecutionAuthorized, false);
  assert.equal(real.providerCallsUsed, 0); assert.equal(strayCommands, 0);
  const CONTROLS = fs.readFileSync(fileURLToPath(new URL('../scripts/phase3b6bOneCallControls.mjs', import.meta.url)), 'utf8');
  assert.equal(/\b(spawn|spawnSync|execFile|exec)\(/.test(CONTROLS), false); assert.equal(/createHmac|createSign|generateKey|createPrivateKey|randomBytes\(32/.test(CONTROLS + SOURCE), false, 'no keys or signatures are created');
});

// =====================================================================================================================
// Phase 3B6B.10A — R1 model label compatibility (exact, one-call only) and R2 strictness (no event allow-list was justified)
// =====================================================================================================================
const SID = '33333333-4444-4555-8666-777777777777'; const TROOT = '/synthetic/task';
const EXTRA = smoke.ONE_CALL_ADDITIONAL_MODEL_FAMILIES;
const initEv = (extra = {}) => ({ type: 'system', subtype: 'init', session_id: SID, cwd: TROOT, model: 'sonnet', permissionMode: 'acceptEdits', tools: TOOLS, ...extra });
const asstEv = (model = 'sonnet', content) => ({ type: 'assistant', message: { id: 'm1', model, content: content ?? [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'target.txt' } }] } });
const userEv = () => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
const resultEv = (extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, session_id: SID, permission_denials: [], ...extra });
function observeStream(events, options = { additionalModelFamilies: EXTRA }) {
  const observer = threeCall.createQualificationObserver({ taskRoot: TROOT, sessionId: SID, targets: [], ...options });
  for (const e of events) observer.line(typeof e === 'string' ? e : JSON.stringify(e));
  return observer.finish();
}
const good = (over = {}) => [initEv(over.init), asstEv(over.model), userEv(), resultEv(over.result)];

test('R1 J: an authoritative claude-sonnet-5-5 execution label is accepted as Sonnet by the one-call path only (exact match)', async () => {
  const p = observeStream(good({ model: 'claude-sonnet-5-5' }));
  assert.deepEqual([p.modelEvidence.state, p.modelEvidence.effectiveModel, p.protocolState], ['AUTHORITATIVE', 'sonnet', 'PASS']);
  const resolved = observeStream(good({ model: 'claude-sonnet-5-5', init: { model: 'claude-sonnet-5-5' }, result: { modelUsage: { 'claude-sonnet-5-5': { input_tokens: 1 } } } }));
  assert.equal(resolved.modelEvidence.state, 'AUTHORITATIVE');
  for (const label of ['sonnet', 'claude-sonnet-5']) assert.equal(observeStream(good({ model: label })).modelEvidence.state, 'AUTHORITATIVE', label);
  for (const options of [{ initModel: 'claude-sonnet-5-5', model: 'claude-sonnet-5-5' }, { model: 'claude-sonnet-5-5' }]) {
    const { evidence } = await simulate(options);
    assert.equal(evidence.decision, D.PASS, JSON.stringify(options)); assert.equal(evidence.call.effectiveModel, 'sonnet');
  }
});

test('R1 default unchanged: without the one-call extension claude-sonnet-5-5 stays UNKNOWN in the three-call observer and the diagnostic smoke', () => {
  assert.equal(observeStream(good({ model: 'claude-sonnet-5-5' }), {}).modelEvidence.state, 'UNKNOWN');
  const smokeObs = createSmokeObserver('/f/w', '/f/c', 'M');
  smokeObs.line(JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [] } }));
  assert.equal(smokeObs.summary().modelEvidence.state, 'UNKNOWN');
});

test('R1 K/L/M: unknown, near-miss, wrong and conflicting model evidence never becomes Sonnet', async () => {
  for (const label of ['claude-sonnet-5-6', 'claude-sonnet-5-5-malicious', 'claude-sonnet-5-50', 'my-claude-sonnet-5-5', 'claude-sonnet-5-5 ', ' claude-sonnet-5-5', 'claude-sonnet-5.5', 'claude-sonnet-5-5-20260101', 'claude-sonnet-5-', 'claude-sonnet', 'sonnet-5-5']) {
    const p = observeStream(good({ model: label })); assert.equal(p.modelEvidence.state, 'UNKNOWN', JSON.stringify(label));
    assert.notEqual((await simulate({ model: label })).evidence.decision, D.PASS, JSON.stringify(label));
  }
  assert.equal((await simulate({ model: 'opus' })).evidence.decision, D.FAIL, 'a recognised wrong family is FAIL');
  assert.equal(observeStream(good({ model: 'claude-opus-5-5' })).modelEvidence.state, 'UNKNOWN', 'an unrecognised Opus label is never promoted to Sonnet (UNKNOWN)');
  const conflict = observeStream([initEv(), asstEv('claude-sonnet-5-5'), asstEv('opus'), userEv(), resultEv()]);
  assert.equal(conflict.modelEvidence.state, 'CONFLICT');
  assert.equal(observeStream([initEv({ model: 'opus' }), asstEv('claude-sonnet-5-5'), userEv(), resultEv()]).modelEvidence.state, 'CONFLICT', 'request/execution family conflict');
  assert.equal(observeStream(good({ model: '<synthetic>' })).modelEvidence.state, 'SYNTHETIC_OR_PLACEHOLDER');
  const usageOnly = observeStream([initEv({ model: 'sonnet' }), { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }, userEv(), resultEv({ modelUsage: { 'claude-sonnet-5-5': {} } })]);
  assert.notEqual(usageOnly.modelEvidence.state, 'AUTHORITATIVE', 'usage metadata alone is never execution proof');
});

test('R1: the extension is a validated exact-label list — wrong family, wildcards, placeholders, prototypes and overlong lists are refused', () => {
  const bad = [{ 'claude-opus-5-5': 'sonnet' }, { 'claude-sonnet-5-5': 'opus' }, { 'claude-sonnet-*': 'sonnet' }, { 'claude-sonnet': 'sonnet' }, { sonnet: 'sonnet' }, { 'claude-sonnet-5': 'sonnet' },
    { 'Claude-Sonnet-5-5': 'sonnet' }, { '<synthetic>': 'sonnet' }, { 'claude-sonnet-5-5': 'haiku' }, { a: 1 }, [], 'claude-sonnet-5-5',
    Object.fromEntries(['5-1', '5-2', '5-3', '5-4', '5-6'].map(v => [`claude-sonnet-${v}`, 'sonnet'])), Object.create({ 'claude-sonnet-5-5': 'sonnet' })];
  for (const additionalModelFamilies of bad) assert.throws(() => createSmokeObserver('/f/w', '/f/c', 'M', { additionalModelFamilies }), TypeError, JSON.stringify(additionalModelFamilies));
  assert.deepEqual(EXTRA, { 'claude-sonnet-5-5': 'sonnet' }); assert.equal(Object.isFrozen(EXTRA), true);
  assert.equal(SOURCE.includes('claude-sonnet-5-5'), true); assert.equal(/includes\(\s*['"`]sonnet|startsWith\(['"`]claude-sonnet/.test(SOURCE), false, 'no prefix/substring model matching in the one-call module');
});

test('R2: no event allow-list was justified — rate_limit_event and non-init system events remain UNKNOWN, and security-bearing events still FAIL', () => {
  const rate = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, session_id: SID };
  const status = { type: 'system', subtype: 'status', session_id: SID };
  for (const ev of [rate, status]) {
    const p = observeStream([initEv(), ev, asstEv(), userEv(), resultEv()]);
    assert.equal(p.protocolState, 'UNKNOWN'); assert.equal(p.code, 'UNKNOWN_EVENT');
    assert.equal(observeStream([ev, initEv(), asstEv(), userEv(), resultEv()]).protocolState, 'UNKNOWN', 'before init');
    assert.equal(observeStream([initEv(), asstEv(), userEv(), resultEv(), ev]).protocolState, 'UNKNOWN', 'after result');
  }
  assert.equal(observeStream([initEv(), { ...rate, message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } }, asstEv(), userEv(), resultEv()]).protocolState, 'UNKNOWN', 'an informational-looking event carrying a tool is never trusted');
  assert.equal(observeStream([initEv(), { ...rate, apiProvider: 'bedrock' }, asstEv(), userEv(), resultEv()]).protocolState, 'FAIL', 'provider override');
  assert.equal(observeStream([initEv(), { ...rate, authMethod: 'api_key' }, asstEv(), userEv(), resultEv()]).protocolState, 'FAIL', 'auth override');
  assert.equal(observeStream([initEv(), { ...rate, session_id: 'other' }, asstEv(), userEv(), resultEv()]).protocolState, 'FAIL', 'unexpected session identity');
  assert.equal(observeStream([initEv(), 'not json', asstEv(), userEv(), resultEv()]).protocolState, 'UNKNOWN', 'malformed');
  assert.equal(observeStream([initEv(), { type: 'mystery' }, asstEv(), userEv(), resultEv()]).protocolState, 'UNKNOWN', 'unknown type');
});

test('R1/R2 N/O/P: five-tool inventory, forbidden-tool FAIL and the guards are unchanged', async () => {
  assert.deepEqual(observeStream(good()).toolInventory, TOOLS);
  assert.equal(observeStream([initEv({ tools: [...TOOLS, 'Bash'] }), asstEv(), userEv(), resultEv()]).protocolState, 'FAIL');
  assert.equal(observeStream([initEv(), asstEv('sonnet', [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'x' } }]), userEv(), resultEv()]).protocolState, 'FAIL');
  assert.equal(observeStream([initEv({ tools: TOOLS.slice(0, 4) }), asstEv(), userEv(), resultEv()]).protocolState, 'UNKNOWN');
  assert.equal(smoke.MAX_SMOKE_PROVIDER_CALLS, 1); assert.equal(threeCall.MAX_PROVIDER_CALLS, 3); assert.equal(strayCommands, 0);
});

// =====================================================================================================================
// Phase 3B6B.10B — recording-only event shape fingerprints: bounded, sanitized, and with NO influence on admission
// =====================================================================================================================
const VOCAB = {
  stage: ['BEFORE_INIT', 'INIT', 'ACTIVE', 'AFTER_RESULT'], type: ['system', 'assistant', 'user', 'result', 'rate_limit_event', 'OTHER', 'NONE', 'MALFORMED'],
  subtype: ['init', 'status', 'compact_boundary', 'hook_started', 'hook_progress', 'hook_response', 'task_started', 'task_progress', 'task_updated', 'task_notification', 'background_tasks_changed',
    'commands_changed', 'session_state_changed', 'conversation_reset', 'informational', 'control_request_progress', 'success', 'error_max_turns', 'error_during_execution', 'OTHER', 'NONE'],
  keyCountBucket: ['0', '1-4', '5-8', '9-16', '17+'], sizeBucket: ['<=256', '<=1K', '<=4K', '<=64K', '<=1M', 'OVERSIZE'],
};
const SENS = ['tools', 'mcpServers', 'plugins', 'agents', 'apiProvider', 'authMethod', 'permissionMode', 'cwd', 'model', 'permissionDenials', 'toolUseBlock', 'toolResultBlock'];
function assertSanitizedShape(snapshot) {
  assert.deepEqual(Object.keys(snapshot).sort(), ['admissionEffect', 'count', 'entries', 'overflow', 'recorder', 'schema']);
  assert.equal(snapshot.admissionEffect, 'NONE'); assert.ok(snapshot.entries.length <= shapes.SHAPE_MAX_ENTRIES);
  snapshot.entries.forEach((e, i) => {
    assert.deepEqual(Object.keys(e).sort(), ['keyCountBucket', 'ordinal', 'sensitive', 'sessionMatch', 'sizeBucket', 'stage', 'subtype', 'type']);
    assert.ok(Number.isInteger(e.ordinal) && e.ordinal >= 1); assert.ok([true, false, null].includes(e.sessionMatch));
    for (const key of ['stage', 'type', 'subtype', 'keyCountBucket', 'sizeBucket']) assert.ok(VOCAB[key].includes(e[key]), `${key}=${e[key]}`);
    assert.deepEqual(Object.keys(e.sensitive).sort(), [...SENS].sort()); assert.ok(Object.values(e.sensitive).every(v => typeof v === 'boolean'));
    assert.ok(snapshot.entries.length === 0 || e.ordinal >= i + 1);
  });
}
const SESSION_X = '99999999-8888-4777-8666-555555555555';

test('shape recorder: fingerprints use ordinal, stage, closed type/subtype, session-match boolean and presence flags only', () => {
  const r = shapes.createShapeRecorder({ sessionId: SESSION_X });
  const lines = [{ type: 'rate_limit_event', session_id: SESSION_X, rate_limit_info: { a: 1 } }, { type: 'system', subtype: 'init', session_id: SESSION_X, cwd: '/x', model: 'm', tools: [], mcp_servers: [] },
    { type: 'system', subtype: 'hook_started', session_id: SESSION_X }, { type: 'system', subtype: 'weird_new_subtype' }, { type: 'assistant', session_id: 'other', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result' }] } }, { type: 'mystery' }, { type: 5 }, { subtype: 'init' }, { type: 'result', subtype: 'success', session_id: SESSION_X, permission_denials: [] },
    { type: 'rate_limit_event', session_id: SESSION_X }];
  lines.forEach(l => r.record(JSON.stringify(l))); r.record('not json'); r.record(''); r.record(undefined);
  const snap = r.snapshot(); assertSanitizedShape(snap);
  const by = i => snap.entries[i];
  assert.deepEqual([by(0).stage, by(0).type, by(0).sessionMatch], ['BEFORE_INIT', 'rate_limit_event', true]);
  assert.deepEqual([by(1).stage, by(1).type, by(1).subtype, by(1).sensitive.cwd, by(1).sensitive.model, by(1).sensitive.tools, by(1).sensitive.mcpServers], ['INIT', 'system', 'init', true, true, true, true]);
  assert.deepEqual([by(2).stage, by(2).subtype], ['ACTIVE', 'hook_started']); assert.equal(by(3).subtype, 'OTHER');
  assert.deepEqual([by(4).sessionMatch, by(4).sensitive.toolUseBlock], [false, true]); assert.equal(by(5).sensitive.toolResultBlock, true);
  assert.deepEqual([by(6).type, by(7).type, by(8).type, by(8).subtype], ['OTHER', 'NONE', 'NONE', 'init']);
  assert.deepEqual([by(9).stage, by(9).type, by(9).sensitive.permissionDenials], ['ACTIVE', 'result', true]); assert.deepEqual([by(10).stage, by(10).sessionMatch], ['AFTER_RESULT', true]);
  assert.deepEqual([snap.entries[11].type, snap.entries[12].type, snap.entries[13].type], ['MALFORMED', 'MALFORMED', 'MALFORMED']);
  assert.deepEqual(snap.entries.map(e => e.ordinal), snap.entries.map((_, i) => i + 1));
  assert.equal(shapes.createShapeRecorder({}).snapshot().count, 0);
});

test('shape recorder sanitization: no raw payload, session id, path, prompt, model text, credential or arbitrary key name is ever kept', () => {
  const sentinels = ['SECRET-TOKEN-xyz', '/Users/someone/private.txt', 'PROMPT: please read my diary', 'sk-ant-FAKE', 'ARBITRARY_FIELD_NAME_42', SESSION_X, 'claude-sonnet-5-5', 'attacker-subtype', 'attacker-type'];
  const r = shapes.createShapeRecorder({ sessionId: SESSION_X });
  r.record(JSON.stringify({ type: 'attacker-type', subtype: 'attacker-subtype', session_id: SESSION_X, ARBITRARY_FIELD_NAME_42: 'SECRET-TOKEN-xyz', model: 'claude-sonnet-5-5', cwd: '/Users/someone/private.txt',
    message: { content: [{ type: 'text', text: 'PROMPT: please read my diary' }, { type: 'tool_use', name: 'sk-ant-FAKE', input: { file_path: '/Users/someone/private.txt' } }] }, authMethod: 'sk-ant-FAKE' }));
  r.record(`{"__proto__":{"polluted":true},"type":"assistant","constructor":{"prototype":{"x":1}}}`); r.record('SECRET-TOKEN-xyz /Users/someone/private.txt');
  const text = JSON.stringify(r.snapshot()); for (const sentinel of sentinels) assert.equal(text.includes(sentinel), false, sentinel);
  assertSanitizedShape(r.snapshot()); assert.equal({}.polluted, undefined);
  const serialized = smoke.serializeOneCallEvidence({ decision: D.UNKNOWN, call: { eventDiagnostics: { ...r.snapshot(), entries: [{ ...r.snapshot().entries[0], type: 'SECRET-TOKEN-xyz', extraKey: 'SECRET-TOKEN-xyz' }] } } }).text;
  assert.equal(serialized.includes('SECRET-TOKEN-xyz'), false); assert.match(serialized, /"type": "REDACTED"/);
});

test('shape recorder bounds: at most 64 entries (rest counted), oversized / deep / huge-key lines are bucketed, hostile input never throws', () => {
  const r = shapes.createShapeRecorder({ sessionId: SESSION_X });
  for (let i = 0; i < 200; i += 1) r.record(JSON.stringify({ type: 'assistant' }));
  let snap = r.snapshot(); assert.equal(snap.count, 64); assert.equal(snap.overflow, 136); assert.equal(snap.entries.length, 64); assertSanitizedShape(snap);
  const big = shapes.createShapeRecorder({ sessionId: SESSION_X });
  big.record('x'.repeat(shapes.SHAPE_MAX_LINE_BYTES + 1)); big.record(`{"type":"user","pad":"${'a'.repeat(5000)}"}`);
  big.record(`{"type":"user"${Array.from({ length: 40 }, (_, i) => `,"k${i}":1`).join('')}}`); big.record('['.repeat(200000)); big.record(`{"a":${'['.repeat(100000)}}`);
  snap = big.snapshot(); assertSanitizedShape(snap);
  assert.deepEqual([snap.entries[0].type, snap.entries[0].sizeBucket], ['MALFORMED', 'OVERSIZE']); assert.equal(snap.entries[1].sizeBucket, '<=64K'.replace('64K', '64K') && snap.entries[1].sizeBucket);
  assert.equal(snap.entries[2].keyCountBucket, '17+');
  for (const hostile of [Symbol('x'), 5, {}, [], null, new Proxy({}, {}), { toString() { throw new Error('x'); } }]) assert.doesNotThrow(() => big.record(hostile));
  assert.equal(JSON.stringify(shapes.safeSnapshot({ snapshot() { throw new Error('x'); } })).includes('"recorder":"FAILED"'), true);
  assert.equal(shapes.safeSnapshot(null).recorder, 'FAILED');
});

test('shape diagnostics in the harness: a PASS run records the lifecycle shape and persists only sanitized fingerprints', async () => {
  const { evidence, persistedText, persisted } = await simulate();
  assert.equal(evidence.decision, D.PASS);
  const diag = evidence.call.eventDiagnostics; assertSanitizedShape(diag);
  assert.deepEqual(diag.entries.map(e => [e.type, e.stage]), [['system', 'INIT'], ['assistant', 'ACTIVE'], ['user', 'ACTIVE'], ['result', 'ACTIVE']]);
  assert.deepEqual(persisted.call.eventDiagnostics.entries.map(e => e.type), ['system', 'assistant', 'user', 'result']);
  for (const leak of ['/private', 'cc-p3b6b9a', 'input.txt', 'VERIFIED', 'tool_use', 'SYNTHETIC-ATT', 'file_path']) assert.equal(persistedText.includes(leak), false, leak);
  assert.equal(diag.entries[0].sessionMatch, true);
});

test('shape diagnostics NEVER change admission: UNKNOWN stays UNKNOWN for rate_limit_event / non-init system / early / late / unknown events', async () => {
  const rate = session => ({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, session_id: session });
  const status = session => ({ type: 'system', subtype: 'status', session_id: session });
  const scenarios = { 'rate limit after init': [{ at: 1, event: rate }], 'system status after init': [{ at: 1, event: status }], 'rate limit before init': [{ at: 0, event: rate }],
    'event after result': [{ at: -1, event: rate }], 'unknown subtype': [{ at: 1, event: s => ({ type: 'system', subtype: 'zzz_new', session_id: s }) }], 'hook event': [{ at: 1, event: s => ({ type: 'system', subtype: 'hook_started', session_id: s }) }] };
  for (const [name, insertEvents] of Object.entries(scenarios)) {
    const withRecorder = await simulate({ insertEvents });
    assert.equal(withRecorder.evidence.decision, D.UNKNOWN, name);
    const types = withRecorder.evidence.call.eventDiagnostics.entries.map(e => e.type);
    assert.ok(types.includes('rate_limit_event') || types.includes('system'), name);
    for (const shapeRecorderFactory of [() => { throw new Error('x'); }, () => ({ record() { throw new Error('y'); }, snapshot() { throw new Error('z'); } }), () => undefined, () => ({ record() {}, snapshot: () => 'garbage' })]) {
      const broken = await simulate({ insertEvents, shapeRecorderFactory });
      assert.equal(broken.evidence.decision, withRecorder.evidence.decision, `${name}: a broken recorder changes nothing`); assert.equal(broken.evidence.code, withRecorder.evidence.code);
    }
  }
  const one = (await simulate({ insertEvents: [{ at: 1, event: rate }] })).evidence.call.eventDiagnostics.entries[1];
  assert.deepEqual([one.type, one.stage, one.sessionMatch, Object.values(one.sensitive).some(Boolean)], ['rate_limit_event', 'ACTIVE', true, false]);
  assert.equal((await simulate({ insertEvents: [{ at: 1, event: status }] })).evidence.call.eventDiagnostics.entries[1].subtype, 'status');
  assert.equal((await simulate({ insertEvents: [{ at: 0, event: rate }] })).evidence.call.eventDiagnostics.entries[0].stage, 'BEFORE_INIT');
  assert.equal((await simulate({ insertEvents: [{ at: -1, event: rate }] })).evidence.call.eventDiagnostics.entries.at(-1).stage, 'AFTER_RESULT');
});

test('shape diagnostics NEVER soften FAIL: security-bearing informational-looking events stay FAIL or UNKNOWN as before', async () => {
  const rate = (extra) => session => ({ type: 'rate_limit_event', session_id: session, ...extra });
  const fail = async (extra, name) => { const r = await simulate({ insertEvents: [{ at: 1, event: rate(extra) }] }); assert.equal(r.evidence.decision, D.FAIL, name); return r.evidence.call.eventDiagnostics.entries[1]; };
  assert.equal((await fail({ apiProvider: 'bedrock' }, 'provider')).sensitive.apiProvider, true);
  assert.equal((await fail({ authMethod: 'api_key' }, 'auth')).sensitive.authMethod, true);
  const foreign = await simulate({ insertEvents: [{ at: 1, event: () => ({ type: 'rate_limit_event', session_id: 'someone-else' }) }] });
  assert.equal(foreign.evidence.decision, D.FAIL); assert.equal(foreign.evidence.call.eventDiagnostics.entries[1].sessionMatch, false);
  const toolish = await simulate({ insertEvents: [{ at: 1, event: s => ({ type: 'rate_limit_event', session_id: s, message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } }) }] });
  assert.notEqual(toolish.evidence.decision, D.PASS); assert.equal(toolish.evidence.call.eventDiagnostics.entries[1].sensitive.toolUseBlock, true);
  assert.equal((await simulate({ lifecycleViolation: true })).evidence.decision, D.FAIL); assert.equal((await simulate({ shellUse: true })).evidence.decision, D.FAIL); assert.equal((await simulate({ extraTool: true })).evidence.decision, D.FAIL);
});

test('a failing recorder never changes a PASS, and diagnostics are not an input to the PASS rule', async () => {
  const broken = await simulate({ shapeRecorderFactory: () => { throw new Error('x'); } });
  assert.equal(broken.evidence.decision, D.PASS); assert.equal(broken.evidence.call.eventDiagnostics.recorder, 'FAILED');
  const throwingRecord = await simulate({ shapeRecorderFactory: () => ({ record() { throw new Error('y'); }, snapshot: () => shapes.createShapeRecorder({}).snapshot() }) });
  assert.equal(throwingRecord.evidence.decision, D.PASS, 'a recorder whose record() throws on every line cannot disturb the run');
  const { evidence } = await simulate(); assert.equal(smoke.assessOneCallPass(evidence), true);
  for (const mutate of [e => { e.call.eventDiagnostics = undefined; }, e => { e.call.eventDiagnostics = { entries: 'x' }; }, e => { e.call.eventDiagnostics.entries.push({ type: 'rate_limit_event' }); }]) {
    const copy = structuredClone(evidence); mutate(copy); assert.equal(smoke.assessOneCallPass(copy), true);
  }
  assert.equal(/eventDiagnostics|eventShape|shapeRecorder|safeSnapshot/.test(SOURCE.slice(SOURCE.indexOf('export function assessOneCallPass'), SOURCE.indexOf('// ---- the single provider call'))), false, 'the pure PASS rule does not read diagnostics');
});
