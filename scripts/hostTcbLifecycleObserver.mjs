import {createHash} from 'node:crypto';
import path from 'node:path';

export const LIFECYCLE_OBSERVATION_POLICY = Object.freeze(
    {sampleIntervalMs: 250, maxSampleGapMs: 500, quiescenceMs: 2000, cleanupWindowMs: 5000});
// No permanent helper approvals are granted. Eligible exited descendants are
// trusted only inside the exact parent Host TCB for this invocation.
export const APPROVED_HELPERS = Object.freeze([]);
export const IPC_SIGNAL_CLASSES =
    Object.freeze(['UNIX_SOCKET', 'CROSS_SESSION_ENDPOINT', 'LOCAL_LISTENER']);
export const PROCESS_CLASSES = Object.freeze([
  'APPROVED_PARENT', 'TCB_INTERNAL_TRANSIENT', 'FORBIDDEN_SHELL', 'FORBIDDEN_PROJECT_EXECUTABLE',
  'FORBIDDEN_AUTHORITY_PROCESS', 'UNRELATED_HOST_PROCESS', 'PERSISTENT_SURVIVOR',
  'UNKNOWN_PERSISTENT_PROCESS', 'REUSED_PID'
]);
const tools = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];
const pidOK = pid => Number.isSafeInteger(pid) && pid > 0;
const generationOK = p => pidOK(p?.pid) && typeof p.generation === 'string' &&
    p.generation.length > 0 && p.generation.length <= 256;
const keyOf = p => `${p.pid}:${p.generation}`;
const nativeUnique = generation =>
    typeof generation === 'string' && /^\d+:-?\d+$/.test(generation) ? generation.split(':')[0] :
                                                                       null;
const sameNativeProcess = (a, b) => nativeUnique(a) !== null && nativeUnique(a) === nativeUnique(b);
const hash = s => createHash('sha256').update(s).digest('hex');
const exact = (p, a) => p.executablePath === a.executablePath && p.sha256 === a.sha256;
const within = (p, r) => p === r || p.startsWith(`${r}${path.sep}`);
const forbiddenRole = p =>
    p.taskControlled === true || p.executionAuthority === 'TASK_CONTROLLED' || [
      'background', 'subagent', 'team', 'resume', 'fork', 'cross-session', 'session-worker'
    ].includes(p.role);
function authorityResult(a) {
  if (!a) return {state: 'UNKNOWN', complete: false, code: 'LIFECYCLE_AUTHORITY_INCOMPLETE'};
  if (a.canonicalLaunch === false || a.protocolState === 'FAIL' ||
      a.modelEvidence === 'WRONG_MODEL' ||
      a.authMethod && !['claude.ai', 'UNKNOWN'].includes(a.authMethod) ||
      a.apiProvider && !['firstParty', 'UNKNOWN'].includes(a.apiProvider))
    return {state: 'FAIL', complete: false, code: 'AUTHORITY_POLICY_VIOLATION'};
  if (Array.isArray(a.toolInventory) &&
          (a.toolInventory.length !== 5 || new Set(a.toolInventory).size !== 5 ||
           !tools.every(t => a.toolInventory.includes(t))) ||
      Array.isArray(a.invokedTools) && a.invokedTools.some(t => !tools.includes(t)))
    return {state: 'FAIL', complete: false, code: 'TOOL_POLICY_VIOLATION'};
  if (a.filesystemState === 'FAIL')
    return {state: 'FAIL', complete: false, code: 'DATA_BOUNDARY_BREACH'};
  if (a.sessionState === 'PRESENT')
    return {state: 'BLOCKED', complete: false, code: 'SESSION_PERSISTENCE_OBSERVED'};
  const known = a.canonicalLaunch === true && Array.isArray(a.toolInventory) &&
      Array.isArray(a.invokedTools) && a.protocolState === 'PASS' && a.authMethod === 'claude.ai' &&
      a.apiProvider === 'firstParty' && a.requestedModel === 'sonnet' &&
      a.requestedEffort === 'medium' && a.modelEvidence === 'AUTHORITATIVE' &&
      a.effectiveModel === 'sonnet';
  if (!known || !['ABSENT', 'PRESENT'].includes(a.sessionState) ||
      !['PASS', 'BLOCKED', 'FAIL'].includes(a.filesystemState))
    return {state: 'UNKNOWN', complete: false, code: 'LIFECYCLE_AUTHORITY_INCOMPLETE'};
  if (a.filesystemState === 'FAIL')
    return {state: 'FAIL', complete: true, code: 'DATA_BOUNDARY_BREACH'};
  if (a.sessionState === 'PRESENT')
    return {state: 'BLOCKED', complete: true, code: 'SESSION_PERSISTENCE_OBSERVED'};
  if (a.filesystemState === 'BLOCKED')
    return {state: 'BLOCKED', complete: true, code: 'DIFF_POLICY_VIOLATION'};
  return {state: 'PASS', complete: true, code: null};
}
export function completeLifecycleProof(p, a) {
  p ??= {
    state: 'LIFECYCLE_UNKNOWN',
    code: 'LIFECYCLE_POSTCONDITION_INCOMPLETE',
    postconditionsComplete: false
  };
  const authority = authorityResult(a);
  let state = p.state;
  let code = p.code;
  if (p.state === 'LIFECYCLE_FAIL' || authority.state === 'FAIL') {
    state = 'LIFECYCLE_FAIL';
    code = p.state === 'LIFECYCLE_FAIL' ? p.code : authority.code;
  } else if (p.state === 'LIFECYCLE_BLOCKED' || authority.state === 'BLOCKED') {
    state = 'LIFECYCLE_BLOCKED';
    code = p.state === 'LIFECYCLE_BLOCKED' ? p.code : authority.code;
  } else if (p.postconditionsComplete === true && authority.state === 'PASS') {
    state = 'LIFECYCLE_PASS';
    code = null;
  } else {
    state = 'LIFECYCLE_UNKNOWN';
    code = p.postconditionsComplete ? authority.code : p.code;
  }
  return {
    ...p,
    state,
    code,
    authorityComplete: authority.complete,
    authorityState: authority.state,
    filesystemState: a?.filesystemState ?? 'UNKNOWN',
    sessionState: a?.sessionState ?? 'UNKNOWN'
  };
}
export function lifecyclePostconditionsComplete(p) {
  return p?.postconditionsComplete === true && p.parentSeen === true &&
      p.parentExitObserved === true && p.quiescent === true && p.survivors === 0 &&
      p.ambiguousPersistentProcesses === 0 && p.forbiddenProcesses === 0 &&
      p.processPostconditionInspection === 'PASS' && p.ipcPostconditionInspection === 'PASS' &&
      p.ipcState === 'NO_PERSISTENT_UNAPPROVED_IPC';
}
export function lifecycleProofComplete(p) {
  return p?.state === 'LIFECYCLE_PASS' && lifecyclePostconditionsComplete(p) &&
      p.authorityComplete === true && p.authorityState === 'PASS' && p.filesystemState === 'PASS' &&
      p.sessionState === 'ABSENT';
}
export function createHostTcbLifecycleObserver(
    {approvedParent, baseline, taskRoots = [], policy = LIFECYCLE_OBSERVATION_POLICY}) {
  if (!approvedParent || !path.isAbsolute(approvedParent.executablePath ?? '') ||
      !/^[0-9a-f]{64}$/.test(approvedParent.sha256 ?? ''))
    throw new TypeError('Exact approved parent identity required');
  if (!['sampleIntervalMs', 'maxSampleGapMs', 'quiescenceMs', 'cleanupWindowMs'].every(
          k => Number.isSafeInteger(policy[k]) && policy[k] > 0) ||
      policy.maxSampleGapMs < policy.sampleIntervalMs ||
      policy.cleanupWindowMs < policy.quiescenceMs)
    throw new TypeError('Invalid bounded policy');
  if (!Array.isArray(taskRoots) ||
      taskRoots.some(r => !path.isAbsolute(r) || path.normalize(r) !== r || r === '/'))
    throw new TypeError('Canonical task roots required');
  approvedParent = {...approvedParent};
  policy = {...policy};
  taskRoots = [...taskRoots];
  const records = new Map(), baselineKeys = new Set(), baselineGenerations = new Set(),
        generations = new Map(), reused = new Set(), execTransitions = new Set(),
        ipcSignals = new Set(), fatal = new Set();
  let rootKey = null, rootPid = null, rootGeneration = null, parentSeen = false, exitAt = null,
      latest = baseline?.at ?? null, stableSince = null, failed = false, gaps = 0;
  let processInspection = 'UNKNOWN', ipcInspection = 'UNKNOWN',
      ipcState = 'IPC_OBSERVATION_INCOMPLETE', persistentIpc = false;
  if (!baseline || !Array.isArray(baseline.processes) || !Number.isFinite(baseline.at) ||
      !(baseline.inspectionState === 'PASS' || baseline.visibility === 'COMPLETE'))
    fatal.add('BASELINE_UNAVAILABLE');
  for (const p of baseline?.processes ?? []) {
    if (!generationOK(p)) {
      fatal.add('BASELINE_IDENTITY_UNKNOWN');
      continue;
    }
    baselineKeys.add(keyOf(p));
    baselineGenerations.add(p.generation);
    generations.set(p.pid, p.generation);
  }
  function classify(p, parent) {
    if (forbiddenRole(p)) return 'FORBIDDEN_AUTHORITY_PROCESS';
    if (parent) {
      if (p.executablePath && p.executablePath !== approvedParent.executablePath)
        return 'FORBIDDEN_AUTHORITY_PROCESS';
      if (!p.executablePath || !p.sha256) {
        fatal.add('PARENT_IDENTITY_UNKNOWN');
        return 'UNKNOWN_PERSISTENT_PROCESS';
      }
      return exact(p, approvedParent) ? 'APPROVED_PARENT' : 'FORBIDDEN_AUTHORITY_PROCESS';
    }
    const executable = p.executablePath ?? '', name = path.basename(executable).toLowerCase();
    if (/^(?:sh|bash|zsh|fish|dash|ksh|csh|tcsh|pwsh|powershell(?:\.exe)?|cmd(?:\.exe)?)$/.test(
            name))
      return 'FORBIDDEN_SHELL';
    if (taskRoots.some(r => within(path.normalize(executable), r)))
      return 'FORBIDDEN_PROJECT_EXECUTABLE';
    if (/^(?:git|gh|ssh|scp|sftp|npm|npx|pnpm|yarn|bun|pip\d*|cargo|brew|curl|wget|repl)$/.test(
            name) ||
        /mcp|chrome|chromium|firefox|browser|safari|msedge/i.test(name))
      return 'FORBIDDEN_AUTHORITY_PROCESS';
    return path.isAbsolute(executable) ? 'TCB_INTERNAL_TRANSIENT' : 'UNKNOWN_PERSISTENT_PROCESS';
  }
  function relationships(current) {
    const byPid = new Map([...current.values()].map(p => [p.pid, p]));
    const owned = new Set([...current.keys()].filter(k => records.get(k)?.owned));
    if (current.has(rootKey)) owned.add(rootKey);
    for (const [key, p] of current)
      if ([...records.values()].some(
              r => r.owned && r.pid === p.pid && sameNativeProcess(r.generation, p.generation)))
        owned.add(key);
    const unrelated =
        new Set([...current.keys()].filter(k => baselineKeys.has(k) || records.get(k)?.unrelated));
    let changed = true;
    while (changed) {
      changed = false;
      for (const [key, p] of current) {
        if (owned.has(key)) continue;
        const pk = p.parentGeneration ? `${p.ppid}:${p.parentGeneration}` : null;
        const birth =
            Array.isArray(p.birthAncestry) ? p.birthAncestry.filter(generationOK).map(keyOf) : [];
        const origOwned = p.originalParentGeneration === rootGeneration ||
            sameNativeProcess(p.originalParentGeneration, rootGeneration) ||
            [...records.values()].some(
                r => r.owned &&
                    (r.generation === p.originalParentGeneration ||
                     sameNativeProcess(r.generation, p.originalParentGeneration)));
        if (pk === rootKey || pk && (owned.has(pk) || records.get(pk)?.owned) ||
            birth.some(k => k === rootKey || owned.has(k) || records.get(k)?.owned) || origOwned) {
          owned.add(key);
          unrelated.delete(key);
          changed = true;
          continue;
        }
        const originKnown = baselineGenerations.has(p.originalParentGeneration) ||
            [...current.entries()].some(
                ([k, r]) => unrelated.has(k) && r.generation === p.originalParentGeneration);
        const birthUnrelated = p.birthAncestryComplete === true && Array.isArray(p.birthAncestry) &&
            p.birthAncestry.length > 0 && p.birthAncestry.every(generationOK) &&
            p.birthAncestry.at(-1).pid === 1;
        const q = byPid.get(p.ppid);
        const direct = p.ppid === rootPid && current.has(rootKey) || q && owned.has(keyOf(q));
        const group = (p.pgid === rootPid ||
                       p.sid != null && parentSeen && p.sid === records.get(rootKey)?.sid) &&
            !baselineKeys.has(key) && !originKnown && !birthUnrelated;
        if (direct || group) {
          owned.add(key);
          unrelated.delete(key);
          current.set(key, {...p, attributionAmbiguous: true});
          changed = true;
          continue;
        }
        if (!unrelated.has(key) && (originKnown || pk && unrelated.has(pk) || birthUnrelated)) {
          unrelated.add(key);
          changed = true;
        }
      }
    }
    return {owned, unrelated};
  }
  function observe(f) {
    if (!rootKey || !f || !Number.isFinite(f.at) || !Array.isArray(f.processes) ||
        latest !== null && f.at <= latest) {
      processInspection = 'UNKNOWN';
      ipcInspection = 'UNKNOWN';
      stableSince = null;
      return;
    }
    const gap = latest !== null && f.at - latest > policy.maxSampleGapMs;
    if (gap) {
      gaps++;
      if (exitAt !== null) stableSince = null;
    }
    latest = f.at;
    const current = new Map(), byPid = new Map();
    let malformed = false;
    for (const p of f.processes) {
      if (!generationOK(p) || current.has(keyOf(p)) || byPid.has(p.pid)) {
        malformed = true;
        continue;
      }
      current.set(keyOf(p), p);
      byPid.set(p.pid, p);
      if (generations.has(p.pid) && generations.get(p.pid) !== p.generation) {
        if (sameNativeProcess(generations.get(p.pid), p.generation))
          execTransitions.add(`${p.pid}:${p.generation}`);
        else
          reused.add(p.pid);
      }
      generations.set(p.pid, p.generation);
    }
    const {owned, unrelated} = relationships(current);
    if (exitAt === null && byPid.has(rootPid) && keyOf(byPid.get(rootPid)) !== rootKey &&
        !sameNativeProcess(byPid.get(rootPid).generation, rootGeneration))
      fatal.add('PARENT_GENERATION_CHANGED');
    for (const [key, p] of current) {
      const prior = records.get(key);
      const isOwned = owned.has(key);
      const ambiguous = p.attributionAmbiguous === true || !isOwned && !unrelated.has(key);
      const logicalParent =
          key === rootKey || p.pid === rootPid && sameNativeProcess(p.generation, rootGeneration);
      const cls = isOwned    ? classify(p, logicalParent) :
          unrelated.has(key) ? 'UNRELATED_HOST_PROCESS' :
                               'UNKNOWN_PERSISTENT_PROCESS';
      if (isOwned && cls.startsWith('FORBIDDEN_')) failed = true;
      if (logicalParent) {
        parentSeen = true;
        if (baselineKeys.has(key) || exitAt !== null) fatal.add('PARENT_IDENTITY_CONFLICT');
      }
      records.set(key, {
        ...p,
        classification: cls,
        owned: isOwned || prior?.owned === true,
        unrelated: unrelated.has(key),
        ambiguous,
        firstSeen: prior?.firstSeen ?? f.at,
        lastSeen: f.at,
        present: true,
        reparented: prior?.reparented === true ||
            !!prior && isOwned &&
                (prior.ppid !== p.ppid || prior.parentGeneration !== p.parentGeneration),
        everForbidden: prior?.everForbidden === true || cls.startsWith('FORBIDDEN_')
      });
    }
    for (const [key, p] of records) p.present = current.has(key);
    if (f.ipc?.state === 'FORBIDDEN_IPC' || f.ipc?.taskControlled === true) failed = true;
    if (exitAt === null) return;  // Execution sampling is a detector, not absence proof.
    processInspection = f.inspection?.process === 'PASS' && !malformed ? 'PASS' : 'UNKNOWN';
    const badSignals = f.ipc?.signalClasses !== undefined && !Array.isArray(f.ipc.signalClasses) ||
        f.ipc?.state === 'NO_PERSISTENT_UNAPPROVED_IPC' && f.ipc.signalClasses?.length;
    ipcInspection = f.inspection?.ipc === 'PASS' && !badSignals ? 'PASS' : 'UNKNOWN';
    ipcState = f.ipc?.state === 'UNAPPROVED_IPC'        ? 'UNAPPROVED_IPC' :
        f.ipc?.state === 'NO_PERSISTENT_UNAPPROVED_IPC' ? 'NO_PERSISTENT_UNAPPROVED_IPC' :
                                                          'IPC_OBSERVATION_INCOMPLETE';
    persistentIpc = ipcState === 'UNAPPROVED_IPC';
    if (persistentIpc)
      for (const s of Array.isArray(f.ipc.signalClasses) ? f.ipc.signalClasses : [])
        if (IPC_SIGNAL_CLASSES.includes(s)) ipcSignals.add(s);
    const remaining = [...records.values()].some(p => p.present && (p.owned || p.ambiguous));
    if (processInspection === 'PASS' && ipcInspection === 'PASS' &&
        ipcState === 'NO_PERSISTENT_UNAPPROVED_IPC' && !remaining && fatal.size === 0)
      stableSince ??= f.at;
    else
      stableSince = null;
  }
  return {
    start({pid, generation} = {}) {
      if (rootKey || !generationOK({pid, generation})) {
        fatal.add('PARENT_START_INVALID');
        return;
      }
      rootPid = pid;
      rootGeneration = generation;
      rootKey = `${pid}:${generation}`;
    },
    observe,
    observedGenerations() {
      return [...records.values()].filter(p => p.owned).map(p => p.generation);
    },
    targets(processes) {
      const current = new Map(processes.filter(generationOK).map(p => [keyOf(p), p]));
      const {owned, unrelated} = relationships(current);
      return [...current]
          .filter(([k]) => owned.has(k) || !unrelated.has(k))
          .map(([k, p]) => ({
                 pid: p.pid,
                 generation: p.generation,
                 owned: owned.has(k) && p.attributionAmbiguous !== true
               }));
    },
    loseVisibility() {
      processInspection = 'UNKNOWN';
      ipcInspection = 'UNKNOWN';
      stableSince = null;
    },
    parentExit({pid, generation, at} = {}) {
      if (pid !== rootPid || generation !== rootGeneration || !Number.isFinite(at) ||
          latest !== null && at < latest || exitAt !== null) {
        fatal.add('PARENT_EXIT_UNKNOWN');
        return;
      }
      exitAt = at;
    },
    finish(authority) {
      const owned = [...records.values()].filter(p => p.owned),
            survivors = exitAt === null ? [] : owned.filter(p => p.present);
      const ambiguous = exitAt === null ?
          [] :
          [...records.values()].filter(
              p => p.present &&
                  (p.ambiguous || p.owned && p.classification === 'UNKNOWN_PERSISTENT_PROCESS'));
      const quiescent = stableSince !== null && latest - stableSince >= policy.quiescenceMs &&
          latest - exitAt <= policy.cleanupWindowMs;
      const complete = parentSeen && exitAt !== null && quiescent && fatal.size === 0 &&
          processInspection === 'PASS' && ipcInspection === 'PASS' &&
          ipcState === 'NO_PERSISTENT_UNAPPROVED_IPC' && survivors.length === 0 &&
          ambiguous.length === 0;
      const classCounts = Object.fromEntries(PROCESS_CLASSES.map(k => [k, 0]));
      for (const p of records.values()) classCounts[p.classification]++;
      classCounts.PERSISTENT_SURVIVOR = survivors.length;
      classCounts.REUSED_PID = reused.size;
      const p = {
        state: failed                         ? 'LIFECYCLE_FAIL' :
            survivors.length || persistentIpc ? 'LIFECYCLE_BLOCKED' :
                                                'LIFECYCLE_UNKNOWN',
        code: failed         ? 'PROHIBITED_EXECUTION' :
            survivors.length ? 'PERSISTENT_SURVIVOR' :
            persistentIpc    ? 'UNAPPROVED_IPC' :
            complete         ? 'LIFECYCLE_AUTHORITY_INCOMPLETE' :
                               'LIFECYCLE_POSTCONDITION_INCOMPLETE',
        postconditionsComplete: complete,
        parentSeen,
        parentExitObserved: exitAt !== null,
        quiescent,
        historyCoverage: 'SAMPLING_ONLY',
        processPostconditionInspection: processInspection,
        ipcPostconditionInspection: ipcInspection,
        ipcState,
        ipcSignals: [...ipcSignals],
        attributableDescendants:
            owned
                .filter(
                    p => keyOf(p) !== rootKey &&
                        !(p.pid === rootPid && sameNativeProcess(p.generation, rootGeneration)))
                .length,
        forbiddenProcesses: owned.filter(p => p.everForbidden).length,
        survivors: survivors.length,
        ambiguousPersistentProcesses: ambiguous.length,
        reusedPids: reused.size,
        execTransitions: execTransitions.size,
        reparented: owned.filter(p => p.reparented).length,
        unresolvedIdentities: fatal.size,
        observationGaps: gaps,
        classCounts,
        quiescenceMs: policy.quiescenceMs,
        cleanupWindowMs: policy.cleanupWindowMs,
        processes: owned.map(p => ({
                               identityHash: hash(keyOf(p)),
                               classification: p.classification,
                               firstSeen: p.firstSeen,
                               lastSeen: p.lastSeen,
                               reparented: p.reparented,
                               absentAtPostcondition: exitAt !== null && !p.present
                             }))
      };
      return completeLifecycleProof(p, authority);
    }
  };
}
