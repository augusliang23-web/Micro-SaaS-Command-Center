// ZC-MVP-B1 Local Bridge core: Mock Adapter and Mock Reporter.
// Issue #119. MOCK-ONLY, OFFLINE: it never starts a real worker. Its only
// "agent" is a constant fake child script (below) that performs synthetic
// edits inside a mkdtemp fixture and prints synthetic NDJSON.
//
// Nothing here is derived from task text: edits, symlinks, sentinel writes and
// emitted events come from constructor options supplied by the test author.
// The synthetic NDJSON is SHAPED after the Lab G1-R3 local evidence
// (step ERROR "permission check failed", result status SUCCESS with a
// non-empty denied_actions) but contains no real identifiers or paths.
// Provenance: new design for ZC-MVP-B1; no code reused from other repositories.
import {fail} from '../state-machine.mjs';

export const MOCK_FAULTS = Object.freeze([
  'none', 'out-of-scope', 'protected', 'symlink', 'binary', 'oversize',
  'executable', 'denied', 'quota', 'crash', 'hang', 'tamper',
]);

// Constant fake-child program. The plan (a JSON literal built from adapter
// options) is prepended as `const plan = ...;` at start(). Every write must
// stay inside plan.fixtureRoot.
const CHILD_BODY = `import fs from 'node:fs';
import path from 'node:path';
const root = plan.fixtureRoot;
const inside = p => {
  const r = path.resolve(p);
  if (r !== root && !r.startsWith(root + path.sep)) throw new Error('PLAN_OUTSIDE_FIXTURE');
  return r;
};
const emit = o => fs.writeSync(1, JSON.stringify(o) + '\\n');
const ID = '00000000-0000-4000-8000-000000000000';
emit({event: 'init', synthetic: true});
for (const e of plan.edits) {
  const target = inside(path.resolve(process.cwd(), e.path));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, e.repeat ? e.content.repeat(e.repeat) : e.base64 ? Buffer.from(e.content, 'base64') : e.content);
  if (typeof e.mode === 'number') fs.chmodSync(target, e.mode);
}
for (const s of plan.symlinks) {
  const link = inside(path.resolve(process.cwd(), s.path));
  fs.mkdirSync(path.dirname(link), {recursive: true});
  try { fs.unlinkSync(link); } catch {}
  fs.symlinkSync(s.target, link);
}
if (plan.sentinel) fs.writeFileSync(inside(plan.sentinel.path), plan.sentinel.content);
if (plan.behavior === 'hang') {
  emit({event: 'hang', pid: process.pid});
  setInterval(() => {}, 1000);
} else if (plan.behavior === 'crash') {
  process.kill(process.pid, 'SIGKILL');
} else {
  if (plan.emit === 'denied') {
    emit({event: 'step_update', step_update: {conversation_id: ID, step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command'}});
    emit({event: 'step_update', step_update: {conversation_id: ID, step_index: 2, state: 'ERROR', step_type: 'tool', tool_name: 'run_command', tool_info: {name: 'run_command', error: {type: 'TOOL_ERROR', message: 'permission check failed (synthetic)'}}}});
    emit({event: 'result', result: {conversation_id: ID, status: 'SUCCESS', response: '', denied_actions: [{action: 'command', display_name: 'RunCommand'}]}});
  } else if (plan.emit === 'quota') {
    emit({event: 'step_update', step_update: {conversation_id: ID, step_index: 1, state: 'ERROR', step_type: 'model', tool_info: {error: {type: 'QUOTA_EXCEEDED', message: 'synthetic'}}}});
    emit({event: 'result', result: {conversation_id: ID, status: 'ERROR', response: ''}});
  } else {
    emit({event: 'result', result: {conversation_id: ID, status: 'SUCCESS', response: 'synthetic mock result', denied_actions: []}});
  }
  process.exit(plan.exitCode ?? 0);
}
`;

const NOTE = 'synthetic mock output\n';
function presetPlan(fault, opts) {
  const base = {edits: [{path: 'docs/fixture-note.md', content: NOTE}], symlinks: [], sentinel: null, behavior: 'normal', emit: 'ok', exitCode: 0};
  switch (fault) {
    case 'none': return base;
    case 'out-of-scope': return {...base, edits: [...base.edits, {path: 'tools/unrelated.mjs', content: 'export {};\n'}]};
    case 'protected': return {...base, edits: [...base.edits, {path: 'package.json', content: '{}\n'}]};
    case 'symlink': return {...base, symlinks: [{path: 'docs/fixture-link.md', target: '/nonexistent-synthetic-target'}]};
    case 'binary': return {...base, edits: [{path: 'docs/fixture-note.md', content: Buffer.from([0, 1, 2, 255]).toString('base64'), base64: true}]};
    case 'oversize': return {...base, edits: [{path: 'docs/fixture-note.md', content: 'x', repeat: 300000}]};
    case 'executable': return {...base, edits: [{path: 'docs/fixture-note.md', content: NOTE, mode: 0o755}]};
    case 'denied': return {...base, emit: 'denied', exitCode: 0};
    case 'quota': return {...base, emit: 'quota', exitCode: 75};
    case 'crash': return {...base, behavior: 'crash'};
    case 'hang': return {...base, behavior: 'hang'};
    case 'tamper':
      if (!opts.sentinel) fail('MOCK_SENTINEL_REQUIRED');
      return {...base, sentinel: opts.sentinel};
    default: return fail('MOCK_FAULT_UNKNOWN');
  }
}

// Strict NDJSON classification. Anything unparsable is a protocol error.
export function classifyOutput(stdout) {
  const lines = stdout.split('\n').filter(l => l.length > 0);
  let result = null;
  let errorSteps = 0;
  let quota = false;
  let hangPid = null;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { return {protocolError: true}; }
    if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) return {protocolError: true};
    if (ev.event === 'step_update' && ev.step_update?.state === 'ERROR') {
      errorSteps++;
      if (ev.step_update?.tool_info?.error?.type === 'QUOTA_EXCEEDED') quota = true;
    } else if (ev.event === 'result') {
      result = ev.result ?? null;
    } else if (ev.event === 'hang' && Number.isSafeInteger(ev.pid)) {
      hangPid = ev.pid;
    }
  }
  const d = result?.denied_actions;
  if (d !== undefined && !Array.isArray(d)) return {protocolError: true};
  return {protocolError: false, result, errorSteps, quota, hangPid, denied: d?.length ?? 0};
}

export class MockAdapter {
  id = 'mock';
  #plan; #used = false;
  constructor({fault = 'none', edits, symlinks, sentinel, behavior, emit, exitCode} = {}) {
    if (!MOCK_FAULTS.includes(fault)) fail('MOCK_FAULT_UNKNOWN');
    const plan = presetPlan(fault, {sentinel});
    this.#plan = {
      ...plan,
      ...(edits ? {edits} : {}), ...(symlinks ? {symlinks} : {}),
      ...(behavior ? {behavior} : {}), ...(emit ? {emit} : {}),
      ...(exitCode !== undefined ? {exitCode} : {}),
    };
  }
  async probe() {
    return {id: this.id, available: true, simulated: true, provenance: 'MOCK_ADAPTER', real_agent: false};
  }
  // One attempt per adapter instance, mirroring the real adapter contract.
  async start(spec, {supervise}) {
    if (this.#used) fail('ADAPTER_ATTEMPT_ALREADY_USED');
    this.#used = true;
    if (typeof supervise !== 'function') fail('ADAPTER_SUPERVISE_REQUIRED');
    // The plan is data from adapter options; it is embedded as a JSON literal
    // so no value is ever passed as a command-line argument.
    const plan = JSON.stringify({...this.#plan, fixtureRoot: spec.fixtureRoot});
    const run = await supervise({scriptSource: `const plan = ${plan};\n${CHILD_BODY}`, args: []});
    const supervision = {
      error: run.error, status: run.status, signal: run.signal,
      groupExitObserved: run.groupExitObserved, exitObserved: run.exitObserved,
      stderrBytes: run.stderrBytes, durationMs: run.durationMs,
    };
    const base = {
      adapter: this.id, supervision, simulated: true, provenance: 'MOCK_ADAPTER',
      denied_actions_count: 0, error_steps: 0, quota: false, child_pid: null,
    };
    const c = classifyOutput(run.stdout ?? '');
    const withClass = o => ({...base, ...o, child_pid: c.hangPid ?? null});
    if (run.error === 'TIMEOUT') return withClass({outcome: 'timeout'});
    if (run.error === 'ABORTED') return withClass({outcome: 'aborted'});
    if (run.error === 'PROCESS_STILL_ALIVE' || !run.groupExitObserved || !run.exitObserved)
      return withClass({outcome: 'unconfirmed_exit'});
    if (run.error !== null) return withClass({outcome: 'failed'});
    if (c.protocolError) return withClass({outcome: 'protocol_error'});
    const quota = c.quota === true;
    const info = {denied_actions_count: c.denied, error_steps: c.errorSteps, quota};
    if (run.signal !== null || run.status !== 0)
      return withClass({...info, outcome: quota ? 'quota' : 'crashed'});
    if (quota) return withClass({...info, outcome: 'quota'});
    if (c.denied > 0 || c.errorSteps > 0) return withClass({...info, outcome: 'denied'});
    if (c.result === null) return withClass({...info, outcome: 'protocol_error'});
    if (c.result.status !== 'SUCCESS') return withClass({...info, outcome: 'failed'});
    return withClass({...info, outcome: 'completed'});
  }
}

export function createMockReporter({failWith = null} = {}) {
  const calls = [];
  return {
    calls,
    async report(summary) {
      if (failWith !== null) throw new Error(failWith);
      calls.push(structuredClone(summary));
      return {delivered: true, simulated: true};
    },
  };
}
