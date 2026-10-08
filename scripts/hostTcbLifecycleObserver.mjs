import path from 'node:path';
import { createHash } from 'node:crypto';

// Server-owned proposal for future diagnostic observation, not a production
// timeout or live approval. Collectors must report missed intervals/visibility.
export const LIFECYCLE_OBSERVATION_POLICY = Object.freeze({ sampleIntervalMs: 250, maxSampleGapMs: 500, quiescenceMs: 2000, cleanupWindowMs: 5000 });
export const APPROVED_HELPERS = Object.freeze([]);
export const IPC_SIGNAL_CLASSES = Object.freeze(['UNIX_SOCKET', 'CROSS_SESSION_ENDPOINT', 'LOCAL_LISTENER']);
export const PROCESS_CLASSES = Object.freeze(['APPROVED_PARENT', 'APPROVED_VENDOR_HELPER', 'APPROVED_OS_HELPER',
  'FORBIDDEN_SHELL', 'FORBIDDEN_PROJECT_EXECUTABLE', 'FORBIDDEN_AUTHORITY_PROCESS', 'UNKNOWN_DESCENDANT',
  'UNRELATED_HOST_PROCESS', 'SURVIVOR', 'REUSED_PID']);
const sha = value => createHash('sha256').update(value).digest('hex');
const keyOf = p => `${p.pid}:${p.generation}`;
const validPid = pid => Number.isSafeInteger(pid) && pid > 0;
const validGeneration = p => validPid(p?.pid) && typeof p.generation === 'string' && p.generation.length > 0 && p.generation.length <= 256;
const validProcess = p => validGeneration(p) && Number.isSafeInteger(p.ppid) && p.ppid >= 0 &&
  validPid(p.pgid) && (p.sid === null || validPid(p.sid)) && (p.startTime === null || Number.isFinite(p.startTime) && p.startTime >= 0);
const exactExecutable = (p, a) => p.executablePath === a.executablePath && p.sha256 === a.sha256;
const within = (file, root) => file === root || file.startsWith(`${root}${path.sep}`);

export function lifecycleProofComplete(p) {
  return p?.state === 'LIFECYCLE_PASS' && p.processVisibility === 'COMPLETE' &&
    p.ipcState === 'NO_OBSERVED_UNAPPROVED_IPC' && p.parentSeen === true && p.parentExitObserved === true &&
    p.quiescent === true && p.survivors === 0 && p.unknownDescendants === 0 && p.forbiddenProcesses === 0 &&
    p.unresolvedIdentities === 0 && p.observationGaps === 0;
}

// A pure evidence state machine. It neither launches nor kills any process and
// does not turn sampling into a complete collector. COMPLETE is an explicit
// collector contract requiring independently qualified visibility/attribution.
export function createHostTcbLifecycleObserver({ approvedParent, baseline, approvedHelpers = APPROVED_HELPERS,
  taskRoots = [], policy = LIFECYCLE_OBSERVATION_POLICY }) {
  if (!approvedParent || !path.isAbsolute(approvedParent.executablePath ?? '') || !/^[0-9a-f]{64}$/.test(approvedParent.sha256 ?? '')) throw new TypeError('Exact approved parent identity required');
  if (!['sampleIntervalMs', 'maxSampleGapMs', 'quiescenceMs', 'cleanupWindowMs'].every(k => Number.isSafeInteger(policy[k]) && policy[k] > 0) ||
      policy.maxSampleGapMs < policy.sampleIntervalMs || policy.cleanupWindowMs < policy.quiescenceMs) throw new TypeError('Invalid bounded lifecycle policy');
  if (!Array.isArray(approvedHelpers) || approvedHelpers.some(a => a.approved !== true || a.taskAuthority !== false ||
      !path.isAbsolute(a.executablePath ?? '') || !/^[0-9a-f]{64}$/.test(a.sha256 ?? '') || !a.signingIdentity ||
      !['APPROVED_VENDOR_HELPER', 'APPROVED_OS_HELPER'].includes(a.classification))) throw new TypeError('Explicit helper approval required');
  if (!Array.isArray(taskRoots) || taskRoots.some(root => !path.isAbsolute(root) || path.normalize(root) !== root || root === '/')) throw new TypeError('Canonical task roots required');
  // Copy approvals so later caller mutations cannot grant executable authority.
  approvedParent = { ...approvedParent }; approvedHelpers = approvedHelpers.map(a => ({ ...a })); policy = { ...policy }; taskRoots = [...taskRoots];
  const records = new Map(); const generations = new Map(); const reused = new Set(); const unknown = new Set();
  const ipcSignals = new Set();
  let rootKey = null; let rootPid = null; let rootGeneration = null; let parentSeen = false; let parentExitAt = null;
  let latest = Number.isFinite(baseline?.at) ? baseline.at : null; let stableSince = null; let ipcIncomplete = false; let ipcViolation = false; let failed = false; let gaps = 0;
  const baselineKeys = new Set();
  if (!baseline || baseline.visibility !== 'COMPLETE' || !Array.isArray(baseline.processes) || !Number.isFinite(baseline.at)) unknown.add('BASELINE_INCOMPLETE');
  for (const p of baseline?.processes ?? []) {
    if (!validProcess(p)) { unknown.add('PROCESS_IDENTITY_INCOMPLETE'); continue; }
    baselineKeys.add(keyOf(p)); generations.set(p.pid, p.generation);
  }

  function classify(p, isParent) {
    if (isParent) {
      if (p.taskControlled === true || p.executionAuthority === 'TASK_CONTROLLED' || ['background', 'subagent', 'cross-session', 'session-worker'].includes(p.role)) { failed = true; return 'FORBIDDEN_AUTHORITY_PROCESS'; }
      if (!p.executablePath || !p.sha256) { unknown.add('PARENT_IDENTITY_INCOMPLETE'); return 'UNKNOWN_DESCENDANT'; }
      if (!exactExecutable(p, approvedParent)) { failed = true; return 'FORBIDDEN_AUTHORITY_PROCESS'; }
      return 'APPROVED_PARENT';
    }
    const executable = p.executablePath ?? ''; const name = path.basename(executable).toLowerCase();
    if (/^(?:bash|zsh|sh|dash|ksh|fish|csh|tcsh|pwsh|powershell(?:\.exe)?|cmd\.exe)$/.test(name)) return 'FORBIDDEN_SHELL';
    if (p.taskControlled === true || p.executionAuthority === 'TASK_CONTROLLED' || taskRoots.some(root => within(executable, root))) return 'FORBIDDEN_PROJECT_EXECUTABLE';
    if (['background', 'subagent', 'cross-session', 'session-worker'].includes(p.role) ||
        /^(?:git|gh|ssh|scp|sftp|npm|npx|pnpm|yarn|bun|pip\d*|cargo|brew|curl|wget|repl)$/.test(name) ||
        /mcp|chrome|chromium|firefox|safari|browser|msedge/i.test(name)) return 'FORBIDDEN_AUTHORITY_PROCESS';
    const approval = approvedHelpers.find(a => exactExecutable(p, a) && p.signingIdentity === a.signingIdentity);
    // Exact approved bytes do not approve an independent task launch. A
    // qualified collector must attest the invocation's internal-only role.
    return approval && p.executionAuthority === 'TCB_INTERNAL' ? approval.classification : 'UNKNOWN_DESCENDANT';
  }

  function observe(frame) {
    if (!rootKey || !frame || !Number.isFinite(frame.at) || !Array.isArray(frame.processes) ||
        latest !== null && frame.at <= latest) { unknown.add('OBSERVATION_ORDER_INVALID'); return; }
    if (latest !== null && frame.at - latest > policy.maxSampleGapMs) { unknown.add('OBSERVATION_GAP'); gaps += 1; }
    latest = frame.at;
    if (frame.visibility !== 'COMPLETE') unknown.add('PROCESS_VISIBILITY_INCOMPLETE');
    if (frame.ipc?.signalClasses !== undefined && !Array.isArray(frame.ipc.signalClasses) ||
        frame.ipc?.state === 'NO_OBSERVED_UNAPPROVED_IPC' && frame.ipc.signalClasses?.length) {
      ipcIncomplete = true; unknown.add('IPC_EVIDENCE_CONFLICT');
    }
    if (frame.ipc?.state === 'UNAPPROVED_IPC') {
      ipcViolation = true;
      for (const kind of Array.isArray(frame.ipc.signalClasses) ? frame.ipc.signalClasses : []) if (IPC_SIGNAL_CLASSES.includes(kind)) ipcSignals.add(kind);
    }
    else if (frame.ipc?.state !== 'NO_OBSERVED_UNAPPROVED_IPC') { ipcIncomplete = true; unknown.add('IPC_VISIBILITY_INCOMPLETE'); }
    const current = new Map(); const byPid = new Map();
    for (const p of frame.processes) {
      if (!validProcess(p) || current.has(keyOf(p)) || byPid.has(p.pid)) { unknown.add('PROCESS_IDENTITY_INCOMPLETE'); continue; }
      const key = keyOf(p); current.set(key, p); byPid.set(p.pid, p);
      if (generations.has(p.pid) && generations.get(p.pid) !== p.generation) reused.add(p.pid);
      generations.set(p.pid, p.generation);
      if (p.attributionAmbiguous === true) unknown.add('ATTRIBUTION_INCOMPLETE');
    }
    // Retain an invocation's generation across PPID/PGID/SID changes. The
    // ancestry closure uses parent generation, never a reusable PID alone.
    const attributable = new Set([...current.keys()].filter(key => records.get(key)?.attributable));
    if (current.has(rootKey)) attributable.add(rootKey);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const [key, p] of current) {
        if (attributable.has(key)) continue;
        const parent = byPid.get(p.ppid);
        const parentKey = p.parentGeneration ? `${p.ppid}:${p.parentGeneration}` : null;
        const knownParent = parentKey === rootKey || parentKey && (attributable.has(parentKey) || records.get(parentKey)?.attributable);
        const birthKeys = Array.isArray(p.birthAncestry) && p.birthAncestry.every(validGeneration) ? p.birthAncestry.map(keyOf) : [];
        const birthConnected = birthKeys.some(k => k === rootKey || attributable.has(k) || records.get(k)?.attributable);
        const pidConnection = p.ppid === rootPid || parent && attributable.has(keyOf(parent));
        const groupConnection = p.pgid === rootPid || p.sid !== null && parentSeen && p.sid === records.get(rootKey)?.sid;
        if (knownParent || birthConnected || pidConnection || groupConnection && !baselineKeys.has(key)) {
          attributable.add(key); expanded = true;
          if (!(knownParent || birthConnected && p.birthAncestryComplete === true) || parent && parent.generation !== p.parentGeneration || baselineKeys.has(key)) unknown.add('ATTRIBUTION_INCOMPLETE');
        }
      }
    }
    for (const [key, p] of current) {
      const prior = records.get(key); const owned = attributable.has(key);
      if (!owned && !baselineKeys.has(key)) {
        const ancestors = p.birthAncestry;
        const birthProof = p.birthAncestryComplete === true && Array.isArray(ancestors) && ancestors.length > 0 &&
          ancestors.every(validGeneration) && new Set(ancestors.map(keyOf)).size === ancestors.length &&
          (ancestors.at(-1).pid === 1 || baselineKeys.has(keyOf(ancestors.at(-1))));
        if (!birthProof) unknown.add('UNRELATED_ORIGIN_NOT_PROVEN');
      }
      if (prior && (prior.startTime !== p.startTime || prior.executablePath !== p.executablePath || prior.sha256 !== p.sha256)) unknown.add('GENERATION_IDENTITY_DRIFT');
      if (prior?.exitObserved && owned) unknown.add('EXITED_GENERATION_REAPPEARED');
      const classification = owned ? classify(p, key === rootKey) : 'UNRELATED_HOST_PROCESS';
      if (owned && classification.startsWith('FORBIDDEN_')) failed = true;
      if (owned && classification === 'UNKNOWN_DESCENDANT') unknown.add('HELPER_NOT_APPROVED');
      const record = { ...p, classification, attributable: owned || prior?.attributable === true,
        firstSeen: prior?.firstSeen ?? frame.at, lastSeen: frame.at, exitObserved: false,
        reparented: prior?.reparented === true || !!prior && owned && (prior.ppid !== p.ppid || prior.parentGeneration !== p.parentGeneration),
        everUnknown: prior?.everUnknown === true || classification === 'UNKNOWN_DESCENDANT',
        everForbidden: prior?.everForbidden === true || classification.startsWith('FORBIDDEN_') };
      records.set(key, record);
      if (key === rootKey) {
        parentSeen = true;
        if (baselineKeys.has(key)) unknown.add('PARENT_PREEXISTING');
        if (parentExitAt !== null) unknown.add('PARENT_EXIT_CONFLICT');
      }
    }
    for (const [key, record] of records) {
      record.present = current.has(key);
      if (!record.present && frame.visibility === 'COMPLETE') record.exitObserved = true;
    }
    const aliveOwned = [...records.values()].some(p => p.attributable && !p.exitObserved);
    if (parentExitAt !== null && frame.at >= parentExitAt && !aliveOwned) stableSince ??= frame.at;
    else stableSince = null;
  }

  return {
    start({ pid, generation } = {}) {
      if (rootKey || !validGeneration({ pid, generation })) { unknown.add('PARENT_START_INVALID'); return; }
      rootPid = pid; rootGeneration = generation; rootKey = `${pid}:${generation}`;
    },
    observe,
    loseVisibility() { unknown.add('PROCESS_VISIBILITY_INCOMPLETE'); },
    parentExit({ pid, generation, at } = {}) {
      if (pid !== rootPid || generation !== rootGeneration || !Number.isFinite(at) || latest !== null && at < latest || parentExitAt !== null) { unknown.add('PARENT_EXIT_INVALID'); return; }
      parentExitAt = at;
    },
    finish() {
      const owned = [...records.values()].filter(p => p.attributable);
      const descendants = owned.filter(p => keyOf(p) !== rootKey);
      const survivors = parentExitAt === null ? [] : owned.filter(p => p.present && !p.exitObserved);
      const quiescent = stableSince !== null && latest - stableSince >= policy.quiescenceMs &&
        latest - parentExitAt <= policy.cleanupWindowMs;
      const classCounts = Object.fromEntries(PROCESS_CLASSES.map(k => [k, 0]));
      for (const record of records.values()) classCounts[record.classification] += 1;
      classCounts.SURVIVOR = survivors.length; classCounts.REUSED_PID = reused.size;
      const complete = parentSeen && parentExitAt !== null && quiescent && unknown.size === 0 && !ipcIncomplete;
      const state = failed ? 'LIFECYCLE_FAIL' : ipcViolation || survivors.length ? 'LIFECYCLE_BLOCKED' : complete ? 'LIFECYCLE_PASS' : 'LIFECYCLE_UNKNOWN';
      return { state, code: failed ? 'PROHIBITED_EXECUTION' : ipcViolation ? 'UNAPPROVED_IPC' : survivors.length ? 'SURVIVOR' : complete ? null : 'LIFECYCLE_EVIDENCE_INCOMPLETE',
        parentSeen, parentExitObserved: parentExitAt !== null, quiescent, ipcSignals: [...ipcSignals],
        processVisibility: unknown.size ? 'INCOMPLETE' : 'COMPLETE', ipcState: ipcViolation ? 'UNAPPROVED_IPC' : ipcIncomplete ? 'IPC_OBSERVATION_INCOMPLETE' : latest === null ? 'IPC_OBSERVATION_INCOMPLETE' : 'NO_OBSERVED_UNAPPROVED_IPC',
        attributableDescendants: descendants.length, unknownDescendants: owned.filter(p => p.everUnknown).length,
        forbiddenProcesses: owned.filter(p => p.everForbidden).length, survivors: survivors.length,
        reusedPids: reused.size, reparented: descendants.filter(p => p.reparented).length,
        unresolvedIdentities: unknown.size, observationGaps: gaps, classCounts,
        quiescenceMs: policy.quiescenceMs, cleanupWindowMs: policy.cleanupWindowMs,
        processes: owned.map(p => ({ identityHash: sha(keyOf(p)), classification: p.classification,
          firstSeen: p.firstSeen, lastSeen: p.lastSeen, exitObserved: p.exitObserved, reparented: p.reparented })) };
    },
  };
}
