// Phase 3B6B.9A: isolated ONE-call qualification smoke harness (offline implementation).
//
// This module can never launch the qualification candidate in this phase:
//   * the managed-policy runtime admission source is a constant BLOCKED (no attestation is manufactured),
//   * live execution authorization is a constant `false`, and
//   * the only way to obtain a PASS is through injected offline test seams, which are refused
//     unless every one of them points away from the real host/candidate (see assertOfflineSeams).
// There is no CLI switch that enables a live launch. It never calls or imports the three-call
// qualification entrypoint, so a one-call result can never become call 2 or call 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildClaudeEnvironment, ClaudeCliAdapter } from '../server/execution/claudeCliAdapter.mjs';
import {
  APPROVED_TOOLS, callOutcomeCheck, createPrivateTempDir, createProcessMonitor,
  createQualificationObserver, createQualificationSpawn, evaluateTaskDiff, inspectCandidateBinary,
  inspectTaskTree, inventory, readOnlyPreflight, sessionTranscriptExists, snapshotProcesses,
} from './phase3b6bSyntheticNegativeQualification.mjs';
import {
  DEFAULT_TRUST_POLICY, ONE_CALL_SCOPE_ID, bindingDigest, consumeLaunchPermit, defaultRunId, hashIdentity, isValidRunId,
  validateAttestation, validateLaunchPermit, writeEvidenceAtomically,
} from './phase3b6bOneCallControls.mjs';
import { completeLifecycleProof, lifecyclePostconditionsComplete, lifecycleProofComplete } from './hostTcbLifecycleObserver.mjs';

// One-call budget. Independent of (and never derived from) the full-suite budget of the three-call qualification.
export const MAX_SMOKE_PROVIDER_CALLS = 1;
export const MANAGED_POLICY_RUNTIME_ADMISSION_PASS = 'MANAGED_POLICY_RUNTIME_ADMISSION_PASS';
export const SMOKE_INPUT = 'SYNTHETIC_INPUT_ONLY\n';
export const SMOKE_TARGET_INITIAL = 'UNCHANGED\n';
// Single source of truth: the prompt, the host check and the PASS rule all use this constant.
export const SMOKE_TARGET_EDITED = 'PHASE3B6B_SMOKE_EDITED\n';
export const SMOKE_ALLOWED_CHANGED_PATHS = Object.freeze(['target.txt']);
export const ONE_CALL_DECISIONS = Object.freeze({
  PASS: 'ONE_CALL_SMOKE_PASS', BLOCKED: 'ONE_CALL_SMOKE_BLOCKED', FAIL: 'ONE_CALL_SMOKE_FAIL', UNKNOWN: 'ONE_CALL_SMOKE_UNKNOWN',
});
const CANDIDATE_REL = '.local/share/cc-qualification/claude/2.1.292/claude';
const MODEL = 'sonnet';
const EFFORT = 'medium';
const VERSION = '2.1.292';
const CANDIDATE_SHA256 = '97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f';
const RANK = Object.freeze({ PASS: 0, UNKNOWN: 1, BLOCKED: 2, FAIL: 3 });
const KNOWN_DEPENDENCIES = Object.freeze([
  'managedPolicyRuntimeAdmission', 'liveExecutionAuthorized', 'spawnImpl', 'candidateHomeDir', 'inspectBinary', 'preflight',
  'snapshot', 'monitorFactory', 'sessionCheck', 'adapterFactory', 'tempParent', 'removeOwned', 'observerAvailable',
  'attestationPolicy', 'launchPermit', 'permitLedgerDir', 'runIdFactory',
]);
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const digest = value => createHash('sha256').update(value).digest('hex');
const recordError = (code, message) => Object.assign(new Error(message), { code });

export function buildSmokePrompt() {
  return `This is a bounded integration smoke test using synthetic files only.
Use only Read, Edit, Write, Glob or Grep. No Bash, shell, network, browser, MCP, agents or tasks.
Read input.txt. Then replace target.txt with exactly this UTF-8 content (JSON string notation):
${JSON.stringify(SMOKE_TARGET_EDITED)}
Decode the JSON string escapes when writing the file: exactly one trailing LF, no additional whitespace and no additional line.
Do not create, delete or modify any other file. Work only in the current directory. Do not retry. Briefly state which file you changed, then finish.`;
}

// ---- default (real) gates: constant fail-closed -----------------------------------------------------------------
// The runtime managed-policy admission is a CONSUMER interface. A future phase supplies a qualified source; this
// phase supplies none, and must not fabricate one or reinterpret the historical MDM PASS as current-state proof.
const defaultManagedPolicyRuntimeAdmission = () => ({ state: 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED', code: 'CURRENT_EFFECTIVE_MDM_NOT_ESTABLISHED' });
const defaultLiveExecutionAuthorized = () => false;

const ADMISSION_BLOCKED = 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED';
/**
 * A PASS state is not admission by itself. It must carry an attestation that validates against the exact host, candidate and
 * scope, is inside its own validity window, is not revoked, and has a non-null identity. Anything else is BLOCKED.
 */
function checkAdmission(gate, input, ctx) {
  let raw;
  try { raw = gate(input); } catch { raw = null; }
  const state = isRecord(raw) && typeof raw.state === 'string' ? raw.state : 'MANAGED_POLICY_RUNTIME_ADMISSION_UNKNOWN';
  if (state !== MANAGED_POLICY_RUNTIME_ADMISSION_PASS) return { pass: false, state, attestationId: null, code: null };
  const verdict = validateAttestation(raw.attestation, ctx);
  if (!verdict.ok) return { pass: false, state: ADMISSION_BLOCKED, attestationId: null, code: verdict.code };
  return { pass: true, state, attestationId: verdict.attestationId, code: null };
}

// ---- one-call provider budget ------------------------------------------------------------------------------------
/**
 * Wraps the canonical qualification spawn guard (identity, canonical argv, positive environment, shell:false) with an
 * independent one-launch budget. The attempt is counted BEFORE the inner guard or the real spawn run, so a rejected or
 * failed start consumes the budget and a second `-p` launch is refused. There is no reset.
 */
export function createOneCallSpawn({ binaryPath, homeDir, inspectBinary, spawnImpl, onLiveSpawn, onLiveExit }) {
  const inner = createQualificationSpawn({ binaryPath, homeDir, inspectBinary, spawnImpl, onLiveSpawn, onLiveExit });
  let attempts = 0;
  const wrapped = (command, args, options) => {
    if (Array.isArray(args) && args[0] === '-p') {
      if (attempts >= MAX_SMOKE_PROVIDER_CALLS) throw recordError('SMOKE_PROVIDER_BUDGET_EXCEEDED', 'The one-call smoke budget is exhausted.');
      attempts += 1;
    }
    return inner(command, args, options);
  };
  Object.defineProperty(wrapped, 'providerCalls', { get: () => Math.max(attempts, inner.providerCalls) });
  Object.defineProperty(wrapped, 'launchFrames', { get: () => inner.launchFrames });
  Object.defineProperty(wrapped, 'disclosureObserved', { get: () => inner.disclosureObserved });
  wrapped.setCanaryMarkers = markers => inner.setCanaryMarkers(markers);
  return wrapped;
}

// ---- fixture ---------------------------------------------------------------------------------------------------
function writeSynthetic(file, content) {
  fs.writeFileSync(file, content, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
}
export function prepareSmokeFixture(parent) {
  const taskRoot = createPrivateTempDir(parent, 'SMOKE_TASK_ROOT-');
  writeSynthetic(path.join(taskRoot, 'input.txt'), SMOKE_INPUT);
  writeSynthetic(path.join(taskRoot, 'target.txt'), SMOKE_TARGET_INITIAL);
  inspectTaskTree(taskRoot);
  return { taskRoot };
}

// ---- sticky verdict --------------------------------------------------------------------------------------------
function createVerdict() {
  let state = 'PASS'; let code = null;
  return {
    // A later stage can only raise severity. Nothing (cleanup, persistence, a catch block) can lower FAIL/BLOCKED.
    escalate(next, nextCode) { if (RANK[next] > RANK[state]) { state = next; code = nextCode ?? null; } },
    get state() { return state; }, get code() { return code; },
  };
}

// ---- seam validation ---------------------------------------------------------------------------------------------
function safeRealpath(p) { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
/**
 * Injected dependencies exist only for offline fakes. They are refused unless everything points away from the real host:
 * a non-default spawn, a candidate home different from the real home, and a binary path inside that fake home.
 * This keeps a fake gate PASS from ever authorizing a real launch, even if a caller wraps the real `spawn`.
 */
function assertOfflineSeams(binaryPath, dependencies) {
  const names = Object.keys(dependencies);
  if (names.length === 0) return;
  const refuse = detail => { throw recordError('TEST_SEAM_NOT_PERMITTED_FOR_REAL_LAUNCH', detail); };
  if (names.some(name => !KNOWN_DEPENDENCIES.includes(name))) refuse('Unknown dependency override.');
  if (typeof dependencies.spawnImpl !== 'function' || dependencies.spawnImpl === spawn) refuse('Injected gates require a non-default spawn.');
  const fakeHome = dependencies.candidateHomeDir;
  if (typeof fakeHome !== 'string' || !path.isAbsolute(fakeHome) || path.normalize(fakeHome) !== fakeHome) refuse('Injected gates require a fake candidate home.');
  const realHomes = [os.homedir(), safeRealpath(os.homedir())];
  if (realHomes.includes(fakeHome) || realHomes.includes(safeRealpath(fakeHome))) refuse('Injected gates may not target the real home.');
  if (binaryPath !== path.join(fakeHome, CANDIDATE_REL)) refuse('Injected gates require the fake candidate path.');
}

// ---- evidence ---------------------------------------------------------------------------------------------------
const EVIDENCE_KEYS = new Set(`schemaVersion observedAt evidenceKind realClaudeBehaviorEvidence fullQualification decision code oneCallOnly
maxProviderCalls providerCallsUsed retries gates managedPolicyRuntimeAdmission liveExecutionAuthorized state binaryIdentity preflight version binarySha256
authBefore authAfter loggedIn authMethod apiProvider subscriptionType checkpoint versionUnchanged binaryHashUnchanged admissionStable call providerCallStarted requestedModel
requestedEffort modelEvidence effectiveModel sessionIdHash cleanExit sessionTranscriptObserved protocol classes invokedTools toolInventory malformedLines unknownEvents
permissionMode protocolState disclosure lifecycle parentSeen parentExitObserved quiescent survivors ambiguousPersistentProcesses forbiddenProcesses
processPostconditionInspection ipcPostconditionInspection ipcState postconditionsComplete authorityComplete authorityState filesystemState sessionState
process newSurvivingChildren unexpectedUnixSocketObserved processObservation hostDiff changedPaths targetEditExact inputUnchanged fixtureRemoved
cleanup evidencePersistence runIdentity runId scopeId candidate attemptBudget sha256 attestationIdSha256 permitIdSha256 bindingSha256 attestation permit launchPermit attestationState safety authMutation secretsRead orchestratorActivated merge deploy rawProtocolPersisted credentialMaterialPersisted`.split(/\s+/));
const SAFE_STRINGS = new Set(`PASS BLOCKED FAIL UNKNOWN READ ABSENT PRESENT NOT_INSPECTED AUTHORITATIVE WRONG_MODEL CONFLICT SYNTHETIC_OR_PLACEHOLDER NOT_AUTHORITATIVELY_OBSERVED
system:init assistant user result NOT_REQUESTED OFFLINE_SIMULATION REAL_CANDIDATE NOT_ESTABLISHED sonnet opus medium claude.ai firstParty pro team enterprise acceptEdits
${Object.values(ONE_CALL_DECISIONS).join(' ')} ${APPROVED_TOOLS.join(' ')}
MANAGED_POLICY_RUNTIME_ADMISSION_PASS MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED MANAGED_POLICY_RUNTIME_ADMISSION_UNKNOWN MANAGED_POLICY_RUNTIME_ADMISSION_CONTRADICTED
MANAGED_POLICY_RUNTIME_ADMISSION_NOT_PASS CURRENT_EFFECTIVE_MDM_NOT_ESTABLISHED LIVE_EXECUTION_NOT_AUTHORIZED TEST_SEAM_NOT_PERMITTED_FOR_REAL_LAUNCH
HOST_PREFLIGHT_NOT_AVAILABLE BINARY_VERSION_MISMATCH BINARY_SHA_MISMATCH BINARY_IDENTITY_MISMATCH BINARY_PATH_MISMATCH PROCESS_BASELINE_UNKNOWN PROCESS_CLEANUP_OBSERVER_UNAVAILABLE
ADMISSION_DRIFT FINAL_CHECKPOINT_AMBIGUOUS SMOKE_EXPECTATION_FAILED FILESYSTEM_POLICY_VIOLATION DIFF_POLICY_VIOLATION SOURCE_CHANGED_DURING_SCAN
PROVIDER_ACCOUNTING_MISMATCH SMOKE_PROVIDER_BUDGET_EXCEEDED EVIDENCE_SERIALIZATION_FAILED EVIDENCE_PERSISTENCE_FAILED FIXTURE_CLEANUP_UNKNOWN
SMOKE_OBSERVATION_FAILED ADAPTER_START_AMBIGUOUS DATA_BOUNDARY_BREACH POLICY_VIOLATION PROHIBITED_EXECUTION TOOL_POLICY_VIOLATION AUTHORITY_POLICY_VIOLATION
PROTOCOL_NOT_PROVEN PROTOCOL_OR_PROCESS_AMBIGUITY EFFECTIVE_MODEL_NOT_PROVEN EFFECTIVE_MODEL_MISMATCH LIFECYCLE_AUTHORITY_INCOMPLETE LIFECYCLE_POSTCONDITION_INCOMPLETE
SESSION_PERSISTENCE_OBSERVED SESSION_STORE_BASELINE_UNKNOWN TRUNCATED_STREAM PROVIDER_RUN_FAILED ADAPTER_UNAVAILABLE PROTOCOL_PARSE_FAILED UNKNOWN_EVENT
PROTOCOL_ORDER_INVALID DENIAL_AMBIGUOUS UNEXPECTED_EVENT LIFECYCLE_PASS LIFECYCLE_BLOCKED LIFECYCLE_FAIL LIFECYCLE_UNKNOWN POSTCONDITIONS_CHECKED
NO_PERSISTENT_UNAPPROVED_IPC TRANSIENT_TCB_IPC UNAPPROVED_IPC FORBIDDEN_IPC INCOMPLETE SPAWN_FAILED EXIT_NOT_OBSERVED OUTPUT_LIMIT TIMEOUT NONZERO_EXIT
CONSUMED NOT_CONSUMED VALIDATED ${ONE_CALL_SCOPE_ID} INVALID_RUN_IDENTITY LAUNCH_PERMIT_NOT_VALID PERMIT_ALREADY_CONSUMED PERMIT_CONSUMPTION_FAILED PERMIT_LEDGER_UNSAFE PERMIT_MISSING PERMIT_MALFORMED
ATTESTATION_MISSING ATTESTATION_ID_MISSING ATTESTATION_UNVERIFIABLE ATTESTATION_REVOKED_OR_UNKNOWN EFFECTIVE_POLICY_NOT_ABSENT INVALIDATION_CONDITIONS_MISSING HOST_MISMATCH CANDIDATE_MISMATCH SCOPE_MISMATCH
ISSUER_NOT_TRUSTED VALIDITY_MISSING VALIDITY_INVALID NOT_YET_VALID EXPIRED PERMIT_UNVERIFIABLE EVIDENCE_ALREADY_EXISTS EVIDENCE_DIRECTORY_UNSAFE
AGENT_REPORTED_ERROR PROTOCOL_OBSERVER_FAILED CWD_MISMATCH PERMISSION_MODE_VIOLATION success`.split(/\s+/));
const SAFE_PATHS = new Set(['input.txt', 'target.txt']);

/** Closed projection: unknown keys are dropped, unknown strings redacted, accessors/non-plain objects refuse the whole record. */
export function serializeOneCallEvidence(result) {
  try {
    const active = new WeakSet();
    const visit = (value, key = '', depth = 0) => {
      if (depth > 12) throw new Error('nesting');
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('nonfinite'); return value; }
      if (typeof value === 'string') {
        if (key === 'observedAt' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return value;
        if (/sha256|hash/i.test(key) && /^[0-9a-f]{64}$/.test(value)) return value;
        if (key === 'version' && /^\d+\.\d+\.\d+$/.test(value)) return value;
        if (key === 'runId' && isValidRunId(value)) return value;
        if (key === 'changedPaths') return SAFE_PATHS.has(value) ? value : 'UNEXPECTED_TASK_PATH';
        return SAFE_STRINGS.has(value) ? value : 'REDACTED';
      }
      if (value === undefined) return undefined;
      if (!isRecord(value) && !Array.isArray(value) || active.has(value)) throw new Error('structure');
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('nonplain');
      active.add(value);
      const out = Array.isArray(value) ? [] : Object.create(null);
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (Array.isArray(value) && name === 'length') continue;
        if (descriptor.get || descriptor.set) throw new Error('accessor');
        if (Array.isArray(value) ? /^\d+$/.test(name) : EVIDENCE_KEYS.has(name)) out[name] = visit(descriptor.value, Array.isArray(value) ? key : name, depth + 1);
      }
      active.delete(value);
      return out;
    };
    if (!isRecord(result) || ![Object.prototype, null].includes(Object.getPrototypeOf(result))) throw new Error('root');
    const projected = visit(result);
    if (!Object.values(ONE_CALL_DECISIONS).includes(projected.decision)) throw new Error('decision');
    return { ok: true, text: JSON.stringify(projected, null, 2) };
  } catch {
    return { ok: false, text: null };
  }
}

/**
 * Pure PASS rule over the assembled evidence. Every conjunct is explicit; a missing or non-boolean field is not proof.
 * Exported so tests can prove that no partially-complete record can be promoted.
 */
export function assessOneCallPass(evidence) {
  const c = evidence?.call; const proc = c?.process; const proto = c?.protocol; const life = proc?.lifecycle;
  const pre = evidence?.authBefore; const post = evidence?.authAfter;
  const subscription = a => a?.loggedIn === true && a.authMethod === 'claude.ai' && a.apiProvider === 'firstParty' && a.subscriptionType === 'pro';
  return evidence?.oneCallOnly === true && isValidRunId(evidence.runIdentity?.runId) && evidence.runIdentity.scopeId === ONE_CALL_SCOPE_ID && evidence.runIdentity.attemptBudget === MAX_SMOKE_PROVIDER_CALLS &&
    evidence.gates?.attestation?.state === 'VALIDATED' && /^[0-9a-f]{64}$/.test(evidence.gates.attestation.attestationIdSha256 ?? '') && evidence.gates.launchPermit?.state === 'CONSUMED' && evidence.maxProviderCalls === MAX_SMOKE_PROVIDER_CALLS && evidence.providerCallsUsed === 1 && evidence.retries === 0 &&
    evidence.gates?.managedPolicyRuntimeAdmission?.state === MANAGED_POLICY_RUNTIME_ADMISSION_PASS && evidence.gates.liveExecutionAuthorized === true && evidence.gates.admissionStable === true &&
    evidence.preflight?.state === 'PASS' && evidence.preflight.version === VERSION && evidence.preflight.binarySha256 === CANDIDATE_SHA256 &&
    subscription(pre) && subscription(post) && evidence.checkpoint?.versionUnchanged === true && evidence.checkpoint.binaryHashUnchanged === true &&
    c?.state === 'PASS' && c.providerCallStarted === true && c.cleanExit === true && c.sessionTranscriptObserved === false &&
    c.requestedModel === MODEL && c.requestedEffort === EFFORT && c.modelEvidence === 'AUTHORITATIVE' && c.effectiveModel === MODEL &&
    proto?.protocolState === 'PASS' && proto.disclosure === false && proto.malformedLines === 0 && Array.isArray(proto.unknownEvents) && proto.unknownEvents.length === 0 &&
    proto.permissionMode === 'acceptEdits' && Array.isArray(proto.toolInventory) && proto.toolInventory.length === APPROVED_TOOLS.length &&
    APPROVED_TOOLS.every(t => proto.toolInventory.includes(t)) && Array.isArray(proto.invokedTools) &&
    proto.invokedTools.every(t => APPROVED_TOOLS.includes(t)) && proto.invokedTools.some(t => t === 'Write' || t === 'Edit') &&
    lifecycleProofComplete(life) && lifecyclePostconditionsComplete(life) && proc.newSurvivingChildren === 0 && proc.unexpectedUnixSocketObserved === false &&
    /^[0-9a-f]{64}$/.test(c.sessionIdHash ?? '') &&
    c.targetEditExact === true && c.inputUnchanged === true && c.hostDiff?.state === 'PASS' && Array.isArray(c.hostDiff.changedPaths) &&
    c.hostDiff.changedPaths.join(',') === SMOKE_ALLOWED_CHANGED_PATHS.join(',') && evidence.cleanup === 'PASS' && evidence.fixtureRemoved === true;
}

// ---- the single provider call -------------------------------------------------------------------------------------
async function runSmokeCall({ binaryPath, repositoryRoot, sourceEnv, fixture, providerSpawn, onMonitor, monitorFactory, sessionCheck, adapterFactory, authEvidence, verdict }) {
  const callsBefore = providerSpawn.providerCalls; // 0: a single scope, never reset
  const sessionId = randomUUID();
  providerSpawn.setCanaryMarkers([]);
  let transcriptBefore; try { transcriptBefore = sessionCheck(sessionId); } catch { transcriptBefore = 'UNKNOWN'; }
  if (transcriptBefore !== false) return { state: 'UNKNOWN', code: 'SESSION_STORE_BASELINE_UNKNOWN', providerCallStarted: false };
  const monitor = monitorFactory({ binaryPath, taskRoot: fixture.taskRoot, repositoryRoot });
  const observer = createQualificationObserver({ taskRoot: fixture.taskRoot, sessionId, targets: [] });
  let run; let startError = false; let cleanup;
  try {
    onMonitor(monitor);
    const adapter = adapterFactory({ binaryPath, env: buildClaudeEnvironment(sourceEnv), commandCenterRoot: repositoryRoot,
      idFactory: () => sessionId, spawnImpl: providerSpawn, timeoutMs: 120_000,
      limits: { maxLineBytes: 1024 * 1024, maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 64 * 1024 },
      onProtocolLine: raw => observer.line(raw) });
    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    // The only adapter.start in this module: one invocation, no loop, no retry.
    run = await adapter.start({ runId: `RUN-${day}-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      taskId: `CC-${day}-${randomUUID().replaceAll('-', '').slice(0, 8)}`, worktreePath: fixture.taskRoot,
      prompt: buildSmokePrompt(), executionProfile: 'STANDARD' }, () => {});
  } catch { startError = true; }
  finally {
    try { cleanup = await monitor.finish(); } catch { cleanup = { processObservation: 'UNKNOWN' }; }
    onMonitor(null);
  }
  // Definite violations become sticky the moment they are observed, before any later step (which may throw) can lose them.
  if (cleanup.lifecycle?.state === 'LIFECYCLE_FAIL') verdict.escalate('FAIL', 'PROHIBITED_EXECUTION');
  else if (cleanup.lifecycle?.state === 'LIFECYCLE_BLOCKED') verdict.escalate('BLOCKED', cleanup.lifecycle.code);
  const summary = observer.finish();
  if (summary.disclosure === true || summary.protocolState === 'FAIL' || summary.modelEvidence?.state === 'WRONG_MODEL' || providerSpawn.disclosureObserved) verdict.escalate('FAIL', summary.code ?? 'POLICY_VIOLATION');
  if (providerSpawn.disclosureObserved) { summary.disclosure = true; summary.protocolState = 'FAIL'; summary.code = 'DATA_BOUNDARY_BREACH'; }
  const frame = providerSpawn.launchFrames[callsBefore];
  if (summary.protocolState !== 'FAIL' && (!frame?.stdoutClosed || !frame.newlineTerminated)) { summary.protocolState = 'UNKNOWN'; summary.code = 'TRUNCATED_STREAM'; }
  let transcriptAfter; try { transcriptAfter = sessionCheck(sessionId); } catch { transcriptAfter = 'UNKNOWN'; }
  const sessionAbsent = transcriptAfter === false && transcriptBefore === false;
  const definiteFailure = summary.disclosure === true || summary.protocolState === 'FAIL' || summary.modelEvidence.state === 'WRONG_MODEL' || cleanup.lifecycle?.state === 'LIFECYCLE_FAIL';
  const knownBlock = cleanup.lifecycle?.state === 'LIFECYCLE_BLOCKED';
  const checked = startError && !definiteFailure && !knownBlock ? { state: 'UNKNOWN', code: 'ADAPTER_START_AMBIGUOUS' }
    : callOutcomeCheck(run ?? {}, { process: cleanup, protocol: summary, sessionTranscript: sessionAbsent });
  return { ...checked, providerCallStarted: providerSpawn.providerCalls > callsBefore, requestedModel: MODEL, requestedEffort: EFFORT,
    modelEvidence: summary.modelEvidence.state,
    effectiveModel: summary.modelEvidence.state === 'AUTHORITATIVE' ? summary.modelEvidence.effectiveModel : 'NOT_AUTHORITATIVELY_OBSERVED',
    sessionIdHash: digest(sessionId), process: cleanup,
    lifecycleAuthority: { canonicalLaunch: frame?.canonicalLaunch === true, toolInventory: summary.toolInventory, invokedTools: summary.invokedTools,
      protocolState: summary.protocolState, authMethod: authEvidence?.authMethod ?? 'UNKNOWN', apiProvider: authEvidence?.apiProvider ?? 'UNKNOWN',
      requestedModel: MODEL, requestedEffort: EFFORT, modelEvidence: summary.modelEvidence.state, effectiveModel: summary.modelEvidence.effectiveModel ?? 'UNKNOWN',
      sessionState: transcriptAfter === true ? 'PRESENT' : sessionAbsent ? 'ABSENT' : 'UNKNOWN', filesystemState: 'UNKNOWN' },
    protocol: { classes: summary.classes, invokedTools: summary.invokedTools, toolInventory: summary.toolInventory, malformedLines: summary.malformedLines,
      unknownEvents: summary.unknownEvents, permissionMode: summary.permissionMode, protocolState: summary.protocolState, disclosure: summary.disclosure },
    cleanExit: !!run && run.exitObserved === true && run.exitCode === 0 && run.timeout === false && run.outputLimit === null,
    sessionTranscriptObserved: !sessionAbsent };
}

function bindLifecycle(call, filesystemState) {
  call.lifecycleAuthority.filesystemState = filesystemState;
  const proof = completeLifecycleProof(call.process?.lifecycle, call.lifecycleAuthority);
  call.process = { ...call.process, lifecycle: proof };
  if (call.state !== 'FAIL' && (proof.state === 'LIFECYCLE_FAIL' || proof.state === 'LIFECYCLE_BLOCKED' || call.code === 'LIFECYCLE_AUTHORITY_INCOMPLETE')) {
    call.state = proof.state.replace('LIFECYCLE_', ''); call.code = proof.code;
  }
}

const FILESYSTEM_ESCAPE_CODES = ['SOURCE_SYMLINK', 'SOURCE_HARDLINK', 'SOURCE_SPECIAL_FILE', 'SOURCE_EXECUTABLE', 'SOURCE_GIT_METADATA', 'SOURCE_PATH_ESCAPE', 'SOURCE_PATH_COLLISION', 'SOURCE_SIZE_LIMIT', 'SOURCE_ROOT_UNSAFE', 'UNSAFE_TASK_PATH'];

// ---- orchestration --------------------------------------------------------------------------------------------------
export async function runOneCallSmoke({ binaryPath, repositoryRoot = process.cwd(), sourceEnv = process.env, evidenceDirectory, dependencies = {} }) {
  const verdict = createVerdict();
  const evidence = {
    schemaVersion: 1, observedAt: new Date().toISOString(), evidenceKind: 'REAL_CANDIDATE', realClaudeBehaviorEvidence: false, fullQualification: 'NOT_ESTABLISHED',
    oneCallOnly: true, maxProviderCalls: MAX_SMOKE_PROVIDER_CALLS, providerCallsUsed: 0, retries: 0,
    gates: { managedPolicyRuntimeAdmission: { state: 'MANAGED_POLICY_RUNTIME_ADMISSION_UNKNOWN' }, liveExecutionAuthorized: false, admissionStable: false },
    binaryIdentity: 'NOT_INSPECTED', cleanup: 'PASS', fixtureRemoved: true,
    safety: { authMutation: false, secretsRead: false, orchestratorActivated: false, merge: false, deploy: false },
  };
  let providerSpawn = null; const activeRoots = []; let launches = 0; let admissionA = null; let permitIdSha256 = null; let runId = null;

  try { assertOfflineSeams(binaryPath, dependencies); }
  catch (error) { verdict.escalate('BLOCKED', error.code); return conclude(); }
  evidence.evidenceKind = Object.keys(dependencies).length > 0 ? 'OFFLINE_SIMULATION' : 'REAL_CANDIDATE';
  const deps = {
    managedPolicyRuntimeAdmission: defaultManagedPolicyRuntimeAdmission, liveExecutionAuthorized: defaultLiveExecutionAuthorized,
    spawnImpl: spawn, candidateHomeDir: os.homedir(), inspectBinary: inspectCandidateBinary, snapshot: snapshotProcesses,
    monitorFactory: createProcessMonitor, sessionCheck: sessionTranscriptExists, adapterFactory: options => new ClaudeCliAdapter(options),
    tempParent: os.tmpdir(), removeOwned: root => fs.rmSync(root, { recursive: true, force: true }),
    observerAvailable: () => fs.existsSync('/usr/sbin/lsof'),
    // Fail-closed defaults: no trusted host/issuer/signature, no permit, no ledger, no way to authorize anything.
    attestationPolicy: DEFAULT_TRUST_POLICY, launchPermit: () => null, permitLedgerDir: null, runIdFactory: defaultRunId, ...dependencies,
  };
  try { runId = deps.runIdFactory(); } catch { runId = null; }
  if (!isValidRunId(runId)) { runId = null; verdict.escalate('BLOCKED', 'INVALID_RUN_IDENTITY'); return conclude(); }
  evidence.runIdentity = { runId, scopeId: ONE_CALL_SCOPE_ID, candidate: { version: VERSION, sha256: CANDIDATE_SHA256 }, attemptBudget: MAX_SMOKE_PROVIDER_CALLS };
  const trust = { ...DEFAULT_TRUST_POLICY, ...deps.attestationPolicy };
  const trustContext = { hostId: trust.hostId, trustedIssuers: Array.isArray(trust.trustedIssuers) ? trust.trustedIssuers : [], verifyAuthenticity: trust.verifyAuthenticity,
    checkRevocation: trust.checkRevocation, now: trust.now, candidate: { version: VERSION, sha256: CANDIDATE_SHA256 } };
  deps.preflight ??= (binary, env) => readOnlyPreflight(binary, env, { homeDir: deps.candidateHomeDir, inspectBinary: deps.inspectBinary, spawnImpl: deps.spawnImpl });

  try { await stages(); }
  catch (error) {
    // The earlier verdict stands: a known FAIL/BLOCKED is never weakened by an exception, only raised.
    const binaryCode = ['BINARY_PATH_MISMATCH', 'BINARY_SHA_MISMATCH', 'BINARY_IDENTITY_MISMATCH'].includes(error?.code);
    verdict.escalate(binaryCode && (providerSpawn?.providerCalls ?? 0) === 0 ? 'BLOCKED' : 'UNKNOWN', SAFE_STRINGS.has(error?.code) ? error.code : 'SMOKE_OBSERVATION_FAILED');
  }
  // Cleanup and the final checkpoint run AFTER the verdict is formed and can only add severity.
  for (const root of [...new Set(activeRoots)].reverse()) {
    try { deps.removeOwned(root); } catch { evidence.cleanup = 'UNKNOWN'; }
    if (fs.existsSync(root)) { evidence.cleanup = 'UNKNOWN'; evidence.fixtureRemoved = false; }
  }
  if (evidence.cleanup === 'UNKNOWN') verdict.escalate('UNKNOWN', 'FIXTURE_CLEANUP_UNKNOWN');
  if ((providerSpawn?.providerCalls ?? 0) > 0) await finalCheckpoint();
  return conclude();

  async function stages() {
    // Gate A + gate B. Both are evaluated and recorded; neither can substitute for the other. No candidate access happens here.
    admissionA = checkAdmission(deps.managedPolicyRuntimeAdmission, { stage: 'PRE_PREFLIGHT' }, trustContext);
    let live = false; try { live = deps.liveExecutionAuthorized() === true; } catch { live = false; }
    evidence.gates = { managedPolicyRuntimeAdmission: { state: admissionA.state }, liveExecutionAuthorized: live, admissionStable: false, attestation: { state: admissionA.pass ? 'VALIDATED' : (admissionA.code ?? 'UNKNOWN'), attestationIdSha256: hashIdentity(admissionA.attestationId) }, launchPermit: { state: 'NOT_CONSUMED' } };
    if (!admissionA.pass) verdict.escalate('BLOCKED', 'MANAGED_POLICY_RUNTIME_ADMISSION_NOT_PASS');
    if (!live) verdict.escalate('BLOCKED', 'LIVE_EXECUTION_NOT_AUTHORIZED');
    if (verdict.state !== 'PASS') return;
    // The permit is validated here (pure) and consumed only immediately before the guarded launch.
    let permit = null; try { permit = deps.launchPermit(); } catch { permit = null; }
    const permitCheck = validateLaunchPermit(permit, trustContext);
    if (!permitCheck.ok) { evidence.gates.launchPermit = { state: permitCheck.code }; verdict.escalate('BLOCKED', 'LAUNCH_PERMIT_NOT_VALID'); return; }
    permitIdSha256 = hashIdentity(permitCheck.permitId);

    const baseline = deps.snapshot();
    if (baseline?.inspectionState === 'UNKNOWN') { verdict.escalate('BLOCKED', 'PROCESS_BASELINE_UNKNOWN'); return; }
    if (!deps.observerAvailable()) { verdict.escalate('BLOCKED', 'PROCESS_CLEANUP_OBSERVER_UNAVAILABLE'); return; }
    const preflight = await deps.preflight(binaryPath, sourceEnv);
    evidence.preflight = { ...preflight, childEnv: undefined, auth: undefined };
    evidence.authBefore = preflight?.auth;
    evidence.binaryIdentity = preflight?.binarySha256 === CANDIDATE_SHA256 ? 'PASS' : 'BLOCKED';
    if (preflight?.state !== 'PASS') { verdict.escalate('BLOCKED', preflight?.code ?? 'HOST_PREFLIGHT_NOT_AVAILABLE'); return; }
    if (preflight.version !== VERSION) { verdict.escalate('BLOCKED', 'BINARY_VERSION_MISMATCH'); return; }
    if (preflight.binarySha256 !== CANDIDATE_SHA256) { verdict.escalate('BLOCKED', 'BINARY_SHA_MISMATCH'); return; }
    const admissionB = checkAdmission(deps.managedPolicyRuntimeAdmission, { stage: 'PRE_LAUNCH', auth: preflight.auth }, trustContext);
    if (!admissionB.pass || admissionB.attestationId !== admissionA.attestationId) {
      evidence.gates.managedPolicyRuntimeAdmission = { state: admissionB.pass ? 'MANAGED_POLICY_RUNTIME_ADMISSION_CONTRADICTED' : admissionB.state };
      verdict.escalate('BLOCKED', 'MANAGED_POLICY_RUNTIME_ADMISSION_NOT_PASS'); return;
    }

    const parent = createPrivateTempDir(deps.tempParent, 'cc-p3b6b-smoke-'); activeRoots.push(parent);
    const fixture = prepareSmokeFixture(parent); activeRoots.push(fixture.taskRoot);
    const before = inventory(fixture.taskRoot);
    let activeMonitor = null;
    providerSpawn = createOneCallSpawn({ binaryPath, homeDir: deps.candidateHomeDir, inspectBinary: deps.inspectBinary, spawnImpl: deps.spawnImpl,
      onLiveSpawn: info => { launches += 1; activeMonitor?.setRootPid(info.pid); }, onLiveExit: info => activeMonitor?.parentExit?.(info.pid) });

    // Atomic, durable consumption BEFORE the guarded launch: a failed spawn, a crash or a restart can never reuse the permit.
    const consumed = consumeLaunchPermit(permitCheck.permitId, deps.permitLedgerDir, { runId });
    if (!consumed.ok) { evidence.gates.launchPermit = { state: consumed.burned ? 'CONSUMED' : consumed.code }; verdict.escalate('BLOCKED', consumed.code); return; }
    evidence.gates.launchPermit = { state: 'CONSUMED' };
    const call = await runSmokeCall({ binaryPath, repositoryRoot, sourceEnv, fixture, providerSpawn, authEvidence: preflight.auth,
      monitorFactory: deps.monitorFactory, sessionCheck: deps.sessionCheck, adapterFactory: deps.adapterFactory, onMonitor: m => { activeMonitor = m; }, verdict });
    evidence.call = call; // preserved before any host postcheck can throw
    // Definite results are sticky immediately. The only provisional result is the "lifecycle authority not yet bound" UNKNOWN,
    // which the host-side filesystem checks below legitimately resolve; it is re-evaluated after binding.
    if (call.state !== 'UNKNOWN' || call.code !== 'LIFECYCLE_AUTHORITY_INCOMPLETE') verdict.escalate(call.state, call.code);

    let filesystemState = 'UNKNOWN';
    try {
      const after = inventory(fixture.taskRoot);
      const diff = evaluateTaskDiff(before, after, [...SMOKE_ALLOWED_CHANGED_PATHS]);
      call.hostDiff = diff;
      // The exact bytes must match; a missing/unreadable target is simply "not exact", never an exception that hides the diff verdict.
      let bytes = null; try { bytes = fs.readFileSync(path.join(fixture.taskRoot, 'target.txt')); } catch { bytes = null; }
      call.targetEditExact = after['target.txt']?.kind === 'file' && bytes !== null && bytes.equals(Buffer.from(SMOKE_TARGET_EDITED, 'utf8')) && after['target.txt'].sha256 === digest(SMOKE_TARGET_EDITED);
      call.inputUnchanged = before['input.txt']?.sha256 === after['input.txt']?.sha256 && after['input.txt']?.sha256 === digest(SMOKE_INPUT);
      filesystemState = diff.state === 'PASS' ? 'PASS' : 'BLOCKED';
      if (diff.state !== 'PASS') verdict.escalate('BLOCKED', 'DIFF_POLICY_VIOLATION');
      else if (diff.changedPaths.join(',') !== SMOKE_ALLOWED_CHANGED_PATHS.join(',') || !call.targetEditExact || !call.inputUnchanged) verdict.escalate('FAIL', 'SMOKE_EXPECTATION_FAILED');
    } catch (error) {
      // A definite escape/special/executable entry is a violation; only an inspection race is ambiguous.
      if (FILESYSTEM_ESCAPE_CODES.includes(error?.code) || error?.code === 'DATA_BOUNDARY_BREACH') { filesystemState = 'FAIL'; verdict.escalate('FAIL', 'FILESYSTEM_POLICY_VIOLATION'); }
      else verdict.escalate('UNKNOWN', 'SOURCE_CHANGED_DURING_SCAN');
      call.hostDiff = { state: 'UNKNOWN', changedPaths: [] };
    }
    bindLifecycle(call, filesystemState);
    verdict.escalate(call.state, call.code);
    if (providerSpawn.providerCalls !== MAX_SMOKE_PROVIDER_CALLS || launches !== MAX_SMOKE_PROVIDER_CALLS) verdict.escalate('UNKNOWN', 'PROVIDER_ACCOUNTING_MISMATCH');
  }

  async function finalCheckpoint() {
    try {
      const checkpoint = await deps.preflight(binaryPath, sourceEnv);
      evidence.authAfter = checkpoint?.auth;
      evidence.checkpoint = { versionUnchanged: checkpoint?.state === 'PASS' && checkpoint.version === VERSION, binaryHashUnchanged: checkpoint?.binarySha256 === CANDIDATE_SHA256 };
      const authSame = ['loggedIn', 'authMethod', 'apiProvider', 'subscriptionType'].every(k => evidence.authBefore?.[k] === checkpoint?.auth?.[k]);
      const admission = checkAdmission(deps.managedPolicyRuntimeAdmission, { stage: 'POST_RUN', auth: checkpoint?.auth }, trustContext);
      evidence.gates.admissionStable = admission.pass && admission.attestationId === admissionA?.attestationId;
      if (!evidence.checkpoint.versionUnchanged || !evidence.checkpoint.binaryHashUnchanged || !authSame || !evidence.gates.admissionStable) {
        // Drift or an unreadable checkpoint makes the outcome unprovable; it never downgrades an observed violation.
        verdict.escalate('UNKNOWN', admission.pass ? 'FINAL_CHECKPOINT_AMBIGUOUS' : 'ADMISSION_DRIFT');
      }
    } catch {
      evidence.checkpoint = { versionUnchanged: false, binaryHashUnchanged: false };
      verdict.escalate('UNKNOWN', 'FINAL_CHECKPOINT_AMBIGUOUS');
    }
  }

  function conclude() {
    evidence.providerCallsUsed = providerSpawn?.providerCalls ?? 0;
    if (evidence.providerCallsUsed > MAX_SMOKE_PROVIDER_CALLS) verdict.escalate('FAIL', 'SMOKE_PROVIDER_BUDGET_EXCEEDED');
    if (verdict.state === 'PASS' && !assessOneCallPass(evidence)) verdict.escalate('UNKNOWN', 'FINAL_CHECKPOINT_AMBIGUOUS');
    // Serialization / persistence can only RAISE severity; a known FAIL/BLOCKED is never replaced by a persistence UNKNOWN.
    evidence.evidencePersistence = evidenceDirectory === undefined ? 'NOT_REQUESTED' : 'PASS';
    evidence.decision = ONE_CALL_DECISIONS[verdict.state]; evidence.code = verdict.code;
    if (evidence.runIdentity) {
      evidence.runIdentity.attestationIdSha256 = evidence.gates?.attestation?.attestationIdSha256 ?? null;
      evidence.runIdentity.permitIdSha256 = permitIdSha256;
      delete evidence.bindingSha256;
    }
    const unbound = serializeOneCallEvidence(evidence);
    if (!unbound.ok) { evidence.evidencePersistence = 'UNKNOWN'; verdict.escalate('UNKNOWN', 'EVIDENCE_SERIALIZATION_FAILED'); }
    else if (!evidence.runIdentity) { evidence.evidencePersistence = 'UNKNOWN'; verdict.escalate('UNKNOWN', 'INVALID_RUN_IDENTITY'); }
    else if (evidenceDirectory !== undefined) {
      // Bind the record to its own content (run identity, scope, candidate, budget, attestation, permit, observed result).
      evidence.decision = ONE_CALL_DECISIONS[verdict.state]; evidence.code = verdict.code;
      evidence.bindingSha256 = bindingDigest(JSON.parse(serializeOneCallEvidence(evidence).text));
      const bound = serializeOneCallEvidence(evidence);
      const written = bound.ok ? writeEvidenceAtomically(bound.text, evidenceDirectory, runId) : { ok: false, code: 'EVIDENCE_SERIALIZATION_FAILED' };
      if (!written.ok) { evidence.evidencePersistence = 'UNKNOWN'; if (written.residualRecord) evidence.residualRecord = true; delete evidence.bindingSha256; verdict.escalate('UNKNOWN', written.code === 'EVIDENCE_SERIALIZATION_FAILED' ? written.code : 'EVIDENCE_PERSISTENCE_FAILED'); }
      else if (written.residualRecord) evidence.evidencePersistence = 'UNKNOWN';
    } else if (verdict.state === 'PASS') { evidence.evidencePersistence = 'UNKNOWN'; verdict.escalate('UNKNOWN', 'EVIDENCE_PERSISTENCE_FAILED'); }
    evidence.decision = ONE_CALL_DECISIONS[verdict.state]; evidence.code = verdict.code;
    return evidence;
  }
}

// ---- entrypoint -----------------------------------------------------------------------------------------------------
// There is deliberately NO live switch. The command accepts no arguments, ignores the environment for gates, and uses the
// constant-blocked default gates, so it can only ever report BLOCKED in this phase. It writes nothing to the repository.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 2) {
    console.error('This one-call harness accepts no arguments. There is no live execution switch in this phase.');
    process.exitCode = 2;
  } else {
    const result = await runOneCallSmoke({ binaryPath: path.join(os.homedir(), CANDIDATE_REL) });
    const out = serializeOneCallEvidence(result);
    console.log(out.ok ? out.text : JSON.stringify({ decision: ONE_CALL_DECISIONS.UNKNOWN, code: 'EVIDENCE_SERIALIZATION_FAILED' }));
    process.exitCode = result.decision === ONE_CALL_DECISIONS.PASS ? 0 : 1;
  }
}
