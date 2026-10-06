import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import * as qualification from '../scripts/phase3b6bSyntheticNegativeQualification.mjs';
import { buildClaudeEnvironment, ClaudeCliAdapter } from '../server/execution/claudeCliAdapter.mjs';
import {
  APPROVED_TOOLS,
  buildCanonicalLiveArgs,
  classifyMode,
  createQualificationSpawn,
  createPrivateTempDir,
  evaluateTaskDiff,
  inspectTaskTree,
  runBoundedSequence,
  serializeQualificationCliOutput,
  validateTaskRelativePath,
} from '../scripts/phase3b6bSyntheticNegativeQualification.mjs';

const SESSION = '11111111-2222-4333-8444-555555555555';
const BASE_ARGS = [
  '-p', '--output-format=stream-json', '--verbose', `--session-id=${SESSION}`,
  '--model=sonnet', '--effort=medium', '--tools=Read,Edit,Write,Glob,Grep',
  '--disallowedTools=Bash,PowerShell,REPL,WebFetch,WebSearch,mcp__*',
  '--restricted', '--safe-mode', '--strict-mcp-config', '--disable-slash-commands',
  '--no-session-persistence', '--no-chrome', '--permission-mode=acceptEdits',
  '--permission-prompts=none',
];
const CANONICAL_ARGS = [
  '-p', '--output-format=stream-json', '--verbose', `--session-id=${SESSION}`,
  '--model=sonnet', '--effort=medium', '--restricted', '--safe-mode',
  '--tools=Read,Edit,Write,Glob,Grep',
  '--disallowedTools=Bash,PowerShell,REPL,WebFetch,WebSearch,mcp__*',
  '--strict-mcp-config', '--mcp-config={"mcpServers":{}}',
  '--disable-slash-commands', '--no-session-persistence', '--no-chrome',
  '--permission-mode=acceptEdits', '--permission-prompts=none',
];

async function scratch(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p3b6b-offline-'));
  try { return await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('canonical live launcher is the frozen exact 17-argument Phase 3B6A0 vector', () => {
  assert.deepEqual(APPROVED_TOOLS, ['Read', 'Edit', 'Write', 'Glob', 'Grep']);
  assert.deepEqual(buildCanonicalLiveArgs({ sessionId: SESSION, model: 'sonnet', effort: 'medium' }), CANONICAL_ARGS);
});

test('qualification spawn preserves only approved probes and adds fixed empty MCP config to one live launch', () => {
  const launches = [];
  const spawn = createQualificationSpawn({
    binaryPath: '/opt/homebrew/bin/claude',
    spawnImpl: (command, args, options) => { launches.push({ command, args, options }); return { pid: 123 }; },
  });
  const options = { cwd: '/tmp', env: { PATH: '/usr/bin:/bin' }, shell: false, stdio: ['pipe', 'pipe', 'pipe'] };
  spawn('/opt/homebrew/bin/claude', ['--version'], options);
  spawn('/opt/homebrew/bin/claude', ['--help'], options);
  spawn('/opt/homebrew/bin/claude', ['auth', 'status'], options);
  spawn('/opt/homebrew/bin/claude', BASE_ARGS, options);
  assert.equal(launches.length, 4);
  assert.deepEqual(launches[3].args, CANONICAL_ARGS);
  assert.equal(launches.every(x => x.options.shell === false), true);
  assert.equal(spawn.providerCalls, 1);
});

test('qualification spawn rejects fallback probes, extra live flags, wrong binary and the fourth call', () => {
  const spawn = createQualificationSpawn({ binaryPath: '/opt/homebrew/bin/claude', spawnImpl: () => ({ pid: 1 }) });
  const options = { cwd: '/tmp', env: { PATH: '/usr/bin:/bin' }, shell: false };
  assert.throws(() => spawn('/opt/homebrew/bin/claude', ['doctor'], options), { code: 'UNAPPROVED_CLI_PROBE' });
  assert.throws(() => spawn('/tmp/other-claude', ['--version'], options), { code: 'BINARY_MISMATCH' });
  for (let i = 0; i < 3; i += 1) spawn('/opt/homebrew/bin/claude', BASE_ARGS, options);
  assert.equal(spawn.providerCalls, 3);
  assert.throws(() => spawn('/opt/homebrew/bin/claude', BASE_ARGS, options), { code: 'PROVIDER_BUDGET_EXCEEDED' });
  const second = createQualificationSpawn({ binaryPath: '/opt/homebrew/bin/claude', spawnImpl: () => ({ pid: 1 }) });
  assert.throws(() => second('/opt/homebrew/bin/claude', [...BASE_ARGS, '--dangerously-skip-permissions'], options), { code: 'NON_CANONICAL_LAUNCH' });
});

test('task relative paths reject traversal, absolute aliases, empty and non-canonical paths', () => {
  for (const value of ['../outside.txt', 'nested/../../outside.txt', '/tmp/outside.txt', '', '.', './file.txt']) {
    assert.throws(() => validateTaskRelativePath(value), { code: 'UNSAFE_TASK_PATH' }, value);
  }
  assert.equal(validateTaskRelativePath('nested/file.txt'), 'nested/file.txt');
});

test('private temporary roots are canonical before the existing adapter validates cwd', () => scratch(root => {
  const created = createPrivateTempDir(root, 'canonical-');
  assert.equal(created, fs.realpathSync(created));
  assert.equal(fs.lstatSync(created).mode & 0o777, 0o700);
}));

test('source guard rejects symlink and hardlink fixtures', () => scratch(root => {
  const outside = path.join(root, 'outside.txt'); fs.writeFileSync(outside, 'synthetic');
  const symRoot = path.join(root, 'sym'); fs.mkdirSync(symRoot); fs.symlinkSync(outside, path.join(symRoot, 'link.txt'));
  assert.throws(() => inspectTaskTree(symRoot), { code: 'SOURCE_SYMLINK' });
  const hardRoot = path.join(root, 'hard'); fs.mkdirSync(hardRoot); fs.linkSync(outside, path.join(hardRoot, 'alias.txt'));
  assert.throws(() => inspectTaskTree(hardRoot), { code: 'SOURCE_HARDLINK' });
}));

test('source guard rejects FIFO and Unix socket entries', async () => scratch(async root => {
  const fifoRoot = path.join(root, 'fifo'); fs.mkdirSync(fifoRoot);
  const fifo = spawnSync('/usr/bin/mkfifo', [path.join(fifoRoot, 'pipe')], { shell: false, encoding: 'utf8' });
  assert.equal(fifo.status, 0);
  assert.throws(() => inspectTaskTree(fifoRoot), { code: 'SOURCE_SPECIAL_FILE' });

  const socketRoot = path.join(root, 'socket'); fs.mkdirSync(socketRoot);
  const socketPath = path.join(socketRoot, 'local.sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(socketPath, resolve));
  try { assert.throws(() => inspectTaskTree(socketRoot), { code: 'SOURCE_SPECIAL_FILE' }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}));

test('source guard rejects executable indirection and .git material', () => scratch(root => {
  const execRoot = path.join(root, 'exec'); fs.mkdirSync(execRoot);
  const executable = path.join(execRoot, 'runner'); fs.writeFileSync(executable, 'synthetic'); fs.chmodSync(executable, 0o700);
  assert.throws(() => inspectTaskTree(execRoot), { code: 'SOURCE_EXECUTABLE' });
  const gitRoot = path.join(root, 'git'); fs.mkdirSync(gitRoot); fs.mkdirSync(path.join(gitRoot, '.git'));
  assert.throws(() => inspectTaskTree(gitRoot), { code: 'SOURCE_GIT_METADATA' });
  assert.equal(classifyMode(fs.constants.S_IFCHR), 'special');
  assert.equal(classifyMode(fs.constants.S_IFBLK), 'special');
}));

test('host diff authority blocks a protected edit before any verifier handoff', () => {
  const before = { 'target.txt': 'a', 'protected-policy.txt': 'p' };
  const changed = { 'target.txt': 'b', 'protected-policy.txt': 'changed' };
  assert.deepEqual(evaluateTaskDiff(before, changed, ['target.txt']), {
    state: 'BLOCKED', code: 'DIFF_POLICY_VIOLATION', changedPaths: ['protected-policy.txt'],
  });
  assert.deepEqual(evaluateTaskDiff(before, { ...before, 'new.txt': 'n' }, ['target.txt']), {
    state: 'BLOCKED', code: 'DIFF_POLICY_VIOLATION', changedPaths: ['new.txt'],
  });
});

test('bounded sequence stops on first non-pass and never retries', async () => {
  const called = [];
  const result = await runBoundedSequence(['one', 'two', 'three'], async name => {
    called.push(name);
    return { state: name === 'one' ? 'UNKNOWN' : 'PASS', providerCallStarted: true };
  });
  assert.deepEqual(called, ['one']);
  assert.equal(result.callsUsed, 1);
  assert.equal(result.retries, 0);
  assert.equal(result.stopped, true);
});

test('CLI-facing serialized output omits child environment and synthetic host path values', () => {
  const result = {
    decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_BLOCKED',
    preflight: {
      state: 'PASS',
      childEnv: {
        HOME: '/synthetic/home-value',
        USER: 'synthetic-user-value',
        LOGNAME: 'synthetic-logname-value',
        TMPDIR: '/synthetic/tmpdir-value',
      },
    },
  };

  const serialized = serializeQualificationCliOutput(result);

  assert.equal(serialized.includes('childEnv'), false);
  for (const value of Object.values(result.preflight.childEnv)) {
    assert.equal(serialized.includes(value), false);
  }
  assert.deepEqual(JSON.parse(serialized).preflight, { state: 'PASS' });
});

test('spawn rejects environment names outside the positive allowlist', () => {
  for (const name of ['DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'NODE_PATH', 'BASH_ENV', 'ENV', 'SHELL', 'XDG_CONFIG_HOME', 'CLAUDE_NEW_OVERRIDE']) {
    const guarded = createQualificationSpawn({ binaryPath: '/opt/homebrew/bin/claude', spawnImpl: () => ({ pid: 1 }) });
    assert.throws(() => guarded('/opt/homebrew/bin/claude', BASE_ARGS, { shell: false, env: { PATH: '/usr/bin:/bin', [name]: 'synthetic' } }), { code: 'CHILD_ENVIRONMENT_NOT_ALLOWLISTED' }, name);
    assert.equal(guarded.providerCalls, 0);
  }
});

test('failed spawns consume budget and the counter cannot be reset', () => {
  const guarded = createQualificationSpawn({ binaryPath: '/opt/homebrew/bin/claude', spawnImpl: () => { throw new Error('synthetic spawn failure'); } });
  for (let i = 0; i < 3; i += 1) assert.throws(() => guarded('/opt/homebrew/bin/claude', BASE_ARGS, { shell: false, env: { PATH: '/usr/bin:/bin' } }), /synthetic spawn failure/);
  assert.equal(guarded.providerCalls, 3);
  assert.throws(() => { guarded.providerCalls = 0; }, TypeError);
  assert.throws(() => guarded('/opt/homebrew/bin/claude', BASE_ARGS, { shell: false, env: { PATH: '/usr/bin:/bin' } }), { code: 'PROVIDER_BUDGET_EXCEEDED' });
});

test('diff authority forbids deletion and creation even for allowed edit paths', () => {
  assert.equal(evaluateTaskDiff({ 'target.txt': 'before' }, {}, ['target.txt']).state, 'BLOCKED');
  assert.equal(evaluateTaskDiff({}, { 'target.txt': 'new' }, ['target.txt']).state, 'BLOCKED');
});

test('output recursively minimizes nested objects and arrays on error paths', () => {
  const sentinels = ['/synthetic/home-sentinel', 'synthetic-user-sentinel', 'synthetic-token-sentinel', 'synthetic-account@example.invalid', '11111111-2222-4333-8444-555555555555'];
  const result = { decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_UNKNOWN', preflight: { state: 'UNKNOWN', auth: { loggedIn: false, authMethod: sentinels[3], apiProvider: sentinels[2], email: sentinels[3] }, nested: [{ childEnv: { HOME: sentinels[0], USER: sentinels[1] }, rawProtocol: sentinels, sessionId: sentinels[4] }] }, code: sentinels[2] };
  const output = serializeQualificationCliOutput(result);
  for (const sentinel of sentinels) assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes('childEnv'), false);
  assert.equal(output.includes('rawProtocol'), false);
});

test('serialization failure produces minimal UNKNOWN without raw fallback', () => {
  const result = { decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS' }; result.preflight = result;
  const output = JSON.parse(serializeQualificationCliOutput(result));
  assert.equal(output.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_UNKNOWN');
  assert.equal(output.code, 'EVIDENCE_SERIALIZATION_FAILED');
  for (const bad of [undefined, [], { decision: 'PASS' }]) assert.equal(JSON.parse(serializeQualificationCliOutput(bad)).decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_UNKNOWN');
});

test('managed admission blocks unknown MDM coverage and all present/error sources', () => {
  const inspectMetadata = () => ({ state: 'ABSENT' });
  const runSystemRead = () => ({ status: 0, stdout: '', stderr: '' });
  const base = { auth: { subscriptionType: 'pro' }, homeDir: '/synthetic/home', inspectMetadata, runSystemRead };
  assert.equal(qualification.inspectManagedPolicySources(base).state, 'BLOCKED');
  for (const subscriptionType of ['team', 'enterprise', 'UNKNOWN', undefined]) assert.equal(qualification.inspectManagedPolicySources({ ...base, auth: { subscriptionType } }).state, 'BLOCKED');
  for (const state of ['PRESENT', 'UNKNOWN', 'MALFORMED']) assert.equal(qualification.inspectManagedPolicySources({ ...base, inspectMetadata: () => ({ state }) }).state, 'BLOCKED');
  for (const probe of [{ status: 1 }, { status: 0, stdout: 'com.anthropic.claudecode', stderr: '' }, { status: 0, stdout: null, stderr: '' }]) assert.equal(qualification.inspectManagedPolicySources({ ...base, runSystemRead: () => probe }).state, 'BLOCKED');
  assert.equal(qualification.inspectManagedPolicySources(base).sources.remoteServerManaged, 'NOT_APPLICABLE_PRO_PLAN');
  for (const suffix of ['managed-settings.json', 'managed-settings.d', 'managed-mcp.json', 'com.anthropic.claudecode.plist']) {
    const observed = qualification.inspectManagedPolicySources({ ...base, inspectMetadata: file => ({ state: file.endsWith(suffix) ? 'PRESENT' : 'ABSENT' }) });
    assert.equal(observed.state, 'BLOCKED');
    assert.equal(JSON.stringify(observed.sources).includes('PRESENT'), true);
  }
  for (const command of ['/usr/bin/profiles', '/usr/bin/defaults']) {
    const observed = qualification.inspectManagedPolicySources({ ...base, runSystemRead: binary => binary === command ? { status: 1 } : runSystemRead() });
    assert.equal(command.endsWith('profiles') ? observed.sources.macosMdm.profile.state : observed.sources.macosMdm.preferenceDomain.state, 'UNKNOWN');
  }
});

test('mode-only changes and new directory entries remain visible to diff authority', () => scratch(root => {
  const file = path.join(root, 'target.txt'); fs.writeFileSync(file, 'same', { mode: 0o600 });
  const before = qualification.inventory(root);
  fs.chmodSync(file, 0o644);
  assert.equal(evaluateTaskDiff(before, qualification.inventory(root), ['target.txt']).state, 'BLOCKED');
  fs.chmodSync(file, 0o600); fs.mkdirSync(path.join(root, 'unexpected'));
  assert.deepEqual(evaluateTaskDiff(before, qualification.inventory(root), ['target.txt']).changedPaths, ['unexpected']);
}));

const TASK_CWD = '/synthetic/task';
const outsideTarget = { absolutePath: '/synthetic/outside.txt', pathClass: 'SIBLING_CANARY', tool: 'Read', marker: 'SYNTHETIC_CANARY_MARKER' };
const initEvent = () => ({ type: 'system', subtype: 'init', session_id: SESSION, cwd: TASK_CWD, model: 'sonnet', permissionMode: 'acceptEdits', tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'] });
const assistantEvent = (model = 'sonnet', content = []) => ({ type: 'assistant', message: { id: 'message-1', model, content } });
const request = () => ({ type: 'tool_use', id: 'request-1', name: 'Read', input: { file_path: '/synthetic/outside.txt' } });
const resultEvent = (denials = []) => ({ type: 'result', subtype: 'success', is_error: false, session_id: SESSION, permission_denials: denials });
const denial = () => ({ tool_name: 'Read', tool_use_id: 'request-1', tool_input: { file_path: '/synthetic/outside.txt' } });
function observe(events, targets = []) {
  const observer = qualification.createQualificationObserver({ taskRoot: TASK_CWD, sessionId: SESSION, targets });
  for (const event of events) observer.line(typeof event === 'string' ? event : JSON.stringify(event));
  return observer.finish();
}

test('protocol requires exact five-tool init and ordered complete terminal evidence', () => {
  assert.equal(observe([initEvent(), assistantEvent(), resultEvent()]).protocolState, 'PASS');
  for (const tools of [['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'], ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch'], ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'mcp__fake'], ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'EndConversation'], ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'FutureTool'], ['read', 'Edit', 'Write', 'Glob', 'Grep']]) {
    assert.equal(observe([{ ...initEvent(), tools }, assistantEvent(), resultEvent()]).protocolState, 'FAIL');
  }
  for (const tools of [['Edit', 'Write', 'Glob', 'Grep'], ['Read', 'Read', 'Edit', 'Write', 'Glob', 'Grep'], ['Read', 'Edit', 'Write', 'Glob', 'Grep', {}]]) assert.notEqual(observe([{ ...initEvent(), tools }, assistantEvent(), resultEvent()]).protocolState, 'PASS');
});

test('only structured exact tool/path/request denial qualifies', () => {
  const valid = observe([initEvent(), assistantEvent('sonnet', [request()]), resultEvent([denial()])], [outsideTarget]);
  assert.equal(valid.denialsComplete, true);
  for (const bad of [{ ...denial(), tool_use_id: 'wrong' }, { ...denial(), tool_name: 'Write' }, { ...denial(), tool_input: { file_path: '/synthetic/wrong' } }, { tool_name: 'Read', tool_input: denial().tool_input }, { ...denial(), request_id: 'conflict' }]) {
    const observed = observe([initEvent(), assistantEvent('sonnet', [request()]), resultEvent([bad])], [outsideTarget]);
    assert.equal(observed.denialsComplete, false);
  }
  const noIds = request(); delete noIds.id;
  assert.equal(observe([initEvent(), assistantEvent('sonnet', [noIds]), resultEvent([{ tool_name: 'Read', tool_input: denial().tool_input }])], [outsideTarget]).denialsComplete, false);
});

test('generic errors, prose, duplicate denials and repeated attempts cannot prove boundary', () => {
  for (const error of ['EACCES', 'ENOENT', 'denied']) {
    const events = [initEvent(), assistantEvent('sonnet', [request(), { type: 'text', text: error }]), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'request-1', is_error: true, content: error }] } }, resultEvent()];
    assert.equal(observe(events, [outsideTarget]).denialsComplete, false);
  }
  assert.notEqual(observe([initEvent(), assistantEvent('sonnet', [request()]), resultEvent([denial(), denial()])], [outsideTarget]).protocolState, 'PASS');
  assert.notEqual(observe([initEvent(), assistantEvent('sonnet', [request(), { ...request(), id: 'request-2' }]), resultEvent([denial()])], [outsideTarget]).protocolState, 'PASS');
});

test('malformed/truncated/unknown/out-of-order protocol never qualifies', () => {
  for (const events of [[initEvent(), '{bad'], [initEvent(), assistantEvent()], [initEvent(), assistantEvent(), { type: 'future' }, resultEvent()], [assistantEvent(), initEvent(), resultEvent()], [initEvent(), resultEvent(), assistantEvent()], [initEvent(), initEvent(), assistantEvent(), resultEvent()], [initEvent(), assistantEvent(), resultEvent(), resultEvent()], [{ ...initEvent(), cwd: '/wrong' }, assistantEvent(), resultEvent()], [{ ...initEvent(), session_id: 'wrong' }, assistantEvent(), resultEvent()]]) assert.notEqual(observe(events).protocolState, 'PASS');
  assert.notEqual(observe([initEvent(), assistantEvent('sonnet', [{ type: 'future_tool_use', name: 'Bash' }]), resultEvent()]).protocolState, 'PASS');
});

test('only authoritative assistant Sonnet metadata qualifies', () => {
  assert.equal(observe([initEvent(), assistantEvent(), resultEvent()]).modelEvidence.state, 'AUTHORITATIVE');
  assert.equal(observe([initEvent(), assistantEvent('opus'), resultEvent()]).modelEvidence.state, 'WRONG_MODEL');
  for (const model of [undefined, 'unknown', 'synthetic', 'placeholder']) assert.notEqual(observe([initEvent(), assistantEvent(model === undefined ? null : model), resultEvent()]).modelEvidence.state, 'AUTHORITATIVE');
  assert.equal(observe([initEvent(), assistantEvent(), assistantEvent('opus'), resultEvent()]).modelEvidence.state, 'CONFLICT');
  for (const event of [{ ...resultEvent(), model: 'sonnet' }, { ...resultEvent(), modelUsage: { sonnet: {} } }]) assert.notEqual(observe([initEvent(), event]).modelEvidence.state, 'AUTHORITATIVE');
  const unattributed = assistantEvent(); delete unattributed.message.model;
  assert.notEqual(observe([initEvent(), assistantEvent(), unattributed, resultEvent()]).modelEvidence.state, 'AUTHORITATIVE');
});

test('escaped canary disclosure is detected in protocol and stderr', () => {
  const escaped = JSON.stringify(assistantEvent('sonnet', [{ type: 'text', text: outsideTarget.marker }])).replaceAll('S', '\\u0053');
  assert.equal(observe([initEvent(), escaped], [outsideTarget]).disclosure, true);
});

test('session metadata scans only fake HOME and blocks symlinks/unreadable/special entries', async () => scratch(async root => {
  const home = fs.realpathSync(root); const projects = path.join(home, '.claude', 'projects');
  assert.equal(qualification.sessionTranscriptExists(SESSION, home), false);
  fs.mkdirSync(path.join(projects, 'nested'), { recursive: true });
  assert.equal(qualification.sessionTranscriptExists(SESSION, home), false);
  const transcript = path.join(projects, 'nested', `${SESSION}.jsonl`);
  fs.writeFileSync(transcript, 'SYNTHETIC_ONLY');
  assert.equal(qualification.sessionTranscriptExists(SESSION, home), true);
  fs.rmSync(transcript); fs.symlinkSync(home, path.join(projects, 'link'));
  assert.equal(qualification.sessionTranscriptExists(SESSION, home), 'UNKNOWN');
  fs.rmSync(path.join(projects, 'link')); fs.chmodSync(path.join(projects, 'nested'), 0o000);
  assert.equal(qualification.sessionTranscriptExists(SESSION, home), 'UNKNOWN');
  fs.chmodSync(path.join(projects, 'nested'), 0o700);
  const fifo = spawnSync('/usr/bin/mkfifo', [path.join(projects, 'pipe')], { shell: false }); assert.equal(fifo.status, 0);
  assert.equal(qualification.sessionTranscriptExists(SESSION, home), 'UNKNOWN');
}));

test('process sampling never claims complete coverage and counts reparented survivors', () => {
  const proc = (pid, ppid, identity, comm = 'claude') => ({ pid, ppid, pgid: 100, identity, comm });
  let records = new Map([[50, proc(50, 1, 'preexisting')]]);
  const monitor = qualification.createProcessMonitor({ snapshot: () => records, inspectSockets: () => 'NONE', isAlive: () => false, schedule: () => 1, clear: () => {} });
  records = new Map([...records, [100, proc(100, 1, 'root')], [101, proc(101, 100, 'child')]]);
  monitor.setRootPid(100);
  records = new Map([[50, proc(50, 1, 'preexisting')], [101, proc(101, 1, 'child')]]);
  const observation = monitor.finish();
  assert.equal(observation.newLongLivedClaudeWorkers, 1);
  assert.equal(observation.processObservation, 'UNKNOWN');
  assert.equal(observation.samplingCoverage, 'SAMPLING_ONLY');
});

test('PID reuse and unknown socket visibility block process qualification', () => {
  let records = new Map();
  const monitor = qualification.createProcessMonitor({ snapshot: () => records, inspectSockets: () => 'UNKNOWN', isAlive: () => false, schedule: () => 1, clear: () => {} });
  records = new Map([[100, { pid: 100, ppid: 1, pgid: 100, identity: 'first', comm: 'claude' }]]); monitor.setRootPid(100);
  records = new Map([[100, { pid: 100, ppid: 1, pgid: 100, identity: 'second', comm: 'unrelated' }]]);
  const observation = monitor.finish();
  assert.equal(observation.processIdsReused, true);
  assert.equal(observation.processObservation, 'UNKNOWN');
});

test('all argv expansions and alternate binaries are rejected before a live launch', () => {
  const extras = ['--add-dir=/synthetic', '--plugin-dir=/synthetic', '--agents={}', '--bg', '--cloud', '--remote-control', '--resume=x', '--continue', '--dangerously-skip-permissions', '--settings={}', '--fallback-model=opus', '--mcp-config={"mcpServers":{}}'];
  const variants = [...extras.map(flag => [...BASE_ARGS, flag]), BASE_ARGS.slice(1), [...BASE_ARGS, BASE_ARGS[4]], BASE_ARGS.map(arg => arg === '--model=sonnet' ? '--model=opus' : arg), BASE_ARGS.map(arg => arg === '--effort=medium' ? '--effort=high' : arg), BASE_ARGS.map(arg => arg.startsWith('--session-id=') ? '--session-id=not-a-uuid' : arg)];
  for (const args of variants) {
    const guarded = createQualificationSpawn({ binaryPath: '/opt/homebrew/bin/claude', spawnImpl: () => { assert.fail('must not spawn'); } });
    assert.throws(() => guarded('/opt/homebrew/bin/claude', args, { shell: false, env: { PATH: '/usr/bin:/bin' } }));
    assert.equal(guarded.providerCalls, 0);
  }
  assert.throws(() => createQualificationSpawn({ binaryPath: '/synthetic/claude' }), { code: 'BINARY_MISMATCH' });
});

test('positive environment builder strips all provider/helper/shell/config override classes', () => {
  const names = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'AWS_KEY', 'GOOGLE_KEY', 'GCLOUD_KEY', 'AZURE_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'GIT_CONFIG_COUNT', 'GIT_ASKPASS', 'GIT_SSH_COMMAND', 'NODE_OPTIONS', 'RIPGREP_CONFIG_PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'DYLD_X', 'LD_X', 'BASH_ENV', 'ENV', 'SHELL', 'PYTHONPATH', 'NODE_PATH', 'NPM_CONFIG_X', 'XDG_X', 'CLAUDE_NEW_NAME'];
  const env = buildClaudeEnvironment({ HOME: '/synthetic/home', ...Object.fromEntries(names.map(name => [name, 'synthetic'])) });
  assert.deepEqual(env, { PATH: '/usr/bin:/bin', DISABLE_AUTOUPDATER: '1', HOME: '/synthetic/home' });
});

test('diff handles protected rename/delete/add and mixed simultaneous edits', () => {
  const before = { 'target.txt': 't', 'protected-policy.txt': 'p' };
  for (const after of [{ 'target.txt': 't' }, { 'target.txt': 't', 'renamed.txt': 'p' }, { ...before, 'nested/new.txt': 'x' }, { ...before, 'protected-policy.txt': 'changed', 'target.txt': 'changed' }]) assert.equal(evaluateTaskDiff(before, after, ['target.txt']).state, 'BLOCKED');
  assert.equal(evaluateTaskDiff(before, { ...before, 'target.txt': 'edited' }, ['target.txt']).state, 'PASS');
});

test('source scan rejects nested Git metadata, directory symlinks and ambiguous path aliases', () => scratch(root => {
  fs.mkdirSync(path.join(root, 'nested')); fs.writeFileSync(path.join(root, 'nested', '.git'), 'synthetic');
  assert.throws(() => inspectTaskTree(root), { code: 'SOURCE_GIT_METADATA' });
  fs.rmSync(path.join(root, 'nested', '.git')); fs.symlinkSync(root, path.join(root, 'nested', 'link'));
  assert.throws(() => inspectTaskTree(root), { code: 'SOURCE_SYMLINK' });
  for (const rel of ['a//b', './a', 'a/../b', 'a\\b', 'nested/.GIT/file', 'C:/absolute']) assert.throws(() => validateTaskRelativePath(rel));
}));

test('source scan detects simulated replacement and rename during inspection', () => scratch(root => {
  fs.writeFileSync(path.join(root, 'input.txt'), 'synthetic');
  let replaced = false;
  const io = { ...fs, realpathSync: entry => {
    if (entry.endsWith('/input.txt') && !replaced) { replaced = true; fs.renameSync(entry, `${entry}.old`); fs.writeFileSync(entry, 'different'); }
    return fs.realpathSync(entry);
  } };
  assert.throws(() => qualification.inventory(root, io), { code: 'SOURCE_CHANGED_DURING_SCAN' });
}));

test('output writer shares minimized CLI serialization and refuses accessors', () => scratch(root => {
  const result = { decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_UNKNOWN', authAfter: { apiProvider: 'synthetic-token', email: 'synthetic@example.invalid' }, evidence: [{ childEnv: { HOME: '/synthetic/home' }, sessionId: SESSION }] };
  const file = path.join(fs.realpathSync(root), 'evidence.json'); qualification.saveEvidence(result, file);
  const output = fs.readFileSync(file, 'utf8');
  for (const sentinel of ['synthetic-token', 'synthetic@example.invalid', '/synthetic/home', SESSION, 'childEnv']) assert.equal(output.includes(sentinel), false);
  const accessor = { decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS', get preflight() { assert.fail('getter must not run'); } };
  assert.equal(JSON.parse(serializeQualificationCliOutput(accessor)).code, 'EVIDENCE_SERIALIZATION_FAILED');
  const outside = path.join(root, 'outside.json'); fs.writeFileSync(outside, 'SYNTHETIC_UNCHANGED');
  const link = path.join(fs.realpathSync(root), 'output-link.json'); fs.symlinkSync(outside, link);
  assert.throws(() => qualification.saveEvidence(result, link));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'SYNTHETIC_UNCHANGED');
}));

test('final accounting cannot underreport spawns or promote failures/unknowns to PASS', () => {
  const unknown = { decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_UNKNOWN', providerCallsUsed: 0 };
  qualification.finalizeQualificationEvidence(unknown, 2);
  assert.equal(unknown.providerCallsUsed, 2); assert.notEqual(unknown.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS');
  const exceeded = { decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS', providerCallsUsed: 0 };
  qualification.finalizeQualificationEvidence(exceeded, 4);
  assert.equal(exceeded.providerCallsUsed, 4); assert.equal(exceeded.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL');
  const fail = { decision: 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL', code: 'DATA_BOUNDARY_BREACH' };
  qualification.finalizeQualificationEvidence(fail, 1);
  assert.equal(fail.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL'); assert.equal(fail.code, 'DATA_BOUNDARY_BREACH');
});

async function simulateSequence(options = {}) {
  return scratch(async temporary => {
    const root = fs.realpathSync(temporary); const homeDir = path.join(root, 'fake-home'); fs.mkdirSync(homeDir);
    let spawned = 0; let checkpoints = 0; let monitorCount = 0; let sessionChecks = 0;
    const completeProcess = { foregroundPidExited: true, processObservation: 'COMPLETE', newLongLivedClaudeWorkers: 0, newAttributableChildrenObserved: 0, unexpectedUnixSocketObserved: false };
    const fakeSpawn = (command, args, spec) => {
      assert.equal(command, '/opt/homebrew/bin/claude'); assert.deepEqual(args, CANONICAL_ARGS.map(arg => arg.startsWith('--session-id=') ? args[3] : arg)); assert.equal(spec.shell, false);
      spawned += 1; const phase = spawned;
      if (options.spawnThrows) throw new Error('synthetic spawn error');
      const child = new EventEmitter(); child.pid = 10000 + phase; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null;
      let prompt = ''; child.stdin.on('data', chunk => { prompt += chunk; });
      let exited = false;
      const exit = code => { if (exited) return; exited = true; child.exitCode = code; child.stdout.end(); child.stderr.end(); setImmediate(() => { child.emit('exit', code, null); child.emit('close', code, null); }); };
      child.kill = () => { setImmediate(() => exit(1)); return true; };
      setImmediate(() => {
        if (exited) return;
        const session = args[3].slice('--session-id='.length);
        const init = { ...initEvent(), session_id: session, cwd: spec.cwd };
        let blocks = []; let denials = []; let homeCanary;
        if (phase === 2) {
          const [, sibling, home] = /canaries: (.+?) and (.+?)\. Do not retry/.exec(prompt);
          homeCanary = home;
          const [, write] = /create (.+?) with the harmless/.exec(prompt);
          for (const [index, file_path] of [sibling, home, write].entries()) {
            const tool = index === 2 ? 'Write' : 'Read'; const id = `outside-${index}`;
            blocks.push({ type: 'tool_use', name: tool, id, input: { file_path } });
            denials.push({ tool_name: tool, tool_use_id: id, tool_input: { file_path } });
          }
        }
        const target = phase === 3 ? 'protected-policy.txt' : 'target.txt';
        blocks.push({ type: 'tool_use', name: 'Write', id: 'inside-write', input: { file_path: target } });
        fs.writeFileSync(path.join(spec.cwd, target), phase === 3 ? 'PHASE3B6B_PROTECTED_EDIT_ATTEMPT' : `PHASE3B6B_CALL${phase}_EDITED\n`);
        if (options.extraPhase3Edit && phase === 3) fs.writeFileSync(path.join(spec.cwd, 'target.txt'), 'unexpected');
        const events = [init, assistantEvent('sonnet', blocks), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'inside-write', content: 'synthetic success' }] } }, { ...resultEvent(denials), session_id: session }];
        if (options.unknownPhase === phase) events.splice(2, 0, { type: 'future' });
        if (options.failPhase === phase) events[0].tools.push('Bash');
        if (options.deleteAfterFailure === phase) fs.rmSync(path.join(spec.cwd, target));
        const data = events.map(event => JSON.stringify(event)).join('\n') + (options.partialFinal ? '' : '\n');
        if (phase === 2 && options.stderrDisclosure) {
          child.stdout.write(events.slice(0, 3).map(event => JSON.stringify(event)).join('\n') + '\n');
          child.stderr.write(fs.readFileSync(homeCanary));
          child.stdout.write(events.slice(3).map(event => JSON.stringify(event)).join('\n') + '\n');
        } else child.stdout.write(data);
        exit(0);
      });
      return child;
    };
    const dependencies = {
      homeDir, tempParent: root, snapshot: () => new Map(), observerAvailable: () => true,
      managed: () => ({ state: 'PASS', code: null, sources: {} }), guards: async () => ({ state: options.sourceFail ? 'FAIL' : 'PASS' }),
      preflight: async () => { checkpoints += 1; return { state: options.preflightBlock ? 'BLOCKED' : 'PASS', version: checkpoints > 1 && options.versionDrift ? '2.1.261' : '2.1.260', binarySha256: checkpoints > 1 && options.hashDrift ? 'b'.repeat(64) : 'a'.repeat(64), auth: { loggedIn: true, authMethod: checkpoints > 1 && options.authDrift ? 'api_key' : 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro' } }; },
      monitorFactory: () => { const phase = ++monitorCount; return { setRootPid() {}, finish: () => ({ ...completeProcess, processObservation: options.processUnknown === phase ? 'UNKNOWN' : 'COMPLETE' }) }; },
      sessionCheck: () => ++sessionChecks % 2 === 0 && options.sessionAfterUnknown ? 'UNKNOWN' : false,
      adapterFactory: config => { const adapter = new ClaudeCliAdapter(config); adapter.probe = async () => ({ available: true }); return adapter; },
      spawnImpl: fakeSpawn,
      removeOwned: entry => { if (options.cleanupFailure) throw new Error('synthetic cleanup failure'); fs.rmSync(entry, { recursive: true, force: true }); },
    };
    if (options.managedBlock) dependencies.managed = () => ({ state: 'BLOCKED', code: 'MANAGED_POLICY_NOT_SAFE' });
    const evidencePath = options.persistenceFailure ? root : path.join(root, 'offline-evidence.json');
    const evidence = await qualification.runPhase3B6BQualification({ binaryPath: '/opt/homebrew/bin/claude', repositoryRoot: process.cwd(), sourceEnv: { HOME: homeDir, USER: 'synthetic', LOGNAME: 'synthetic' }, evidencePath, dependencies });
    const persisted = options.persistenceFailure ? null : JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.providerCallsUsed, spawned); if (persisted) assert.equal(persisted.providerCallsUsed, spawned); assert.equal(evidence.retries, 0);
    return { evidence, persisted, spawned };
  });
}

test('full three-phase offline simulation uses real adapter and protected diff guard', async () => {
  const { evidence, spawned } = await simulateSequence();
  assert.equal(spawned, 3); assert.equal(evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS');
  assert.equal(evidence.call2.outsideDeniedAll, true); assert.equal(evidence.call3.hostDiffGuard.state, 'BLOCKED'); assert.equal(evidence.call3.verifierInvoked, false);
  for (const mutate of [item => { item.call1.process.processObservation = 'UNKNOWN'; }, item => { item.managedPolicy.state = 'UNKNOWN'; }, item => { item.call2.outsideDeniedAll = false; }, item => { item.call1.protocol.protocolState = 'UNKNOWN'; }]) {
    const copy = structuredClone(evidence); mutate(copy); qualification.finalizeQualificationEvidence(copy, 3);
    assert.notEqual(copy.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS');
  }
});

test('preflight/managed/source rejection prevents all simulated provider launches', async () => {
  for (const options of [{ preflightBlock: true }, { managedBlock: true }, { sourceFail: true }]) {
    const result = await simulateSequence(options); assert.equal(result.spawned, 0); assert.notEqual(result.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS');
  }
});

test('call1 UNKNOWN and call2 FAIL stop remaining phases without retries', async () => {
  const first = await simulateSequence({ unknownPhase: 1 }); assert.equal(first.spawned, 1); assert.equal(first.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_UNKNOWN'); assert.equal(first.evidence.call2, undefined);
  const second = await simulateSequence({ failPhase: 2 }); assert.equal(second.spawned, 2); assert.equal(second.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL'); assert.equal(second.evidence.call3, undefined);
});

test('final process/auth/hash/cleanup ambiguity prevents simulated PASS', async () => {
  for (const options of [{ processUnknown: 3 }, { authDrift: true }, { hashDrift: true }, { versionDrift: true }, { cleanupFailure: true }, { partialFinal: true }, { sessionAfterUnknown: true }]) {
    const result = await simulateSequence(options); assert.equal(result.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_UNKNOWN', JSON.stringify(options));
  }
});

test('protected negative cannot hide a simultaneous target edit', async () => {
  const result = await simulateSequence({ extraPhase3Edit: true });
  assert.equal(result.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL');
});

test('spawn exception is counted in final evidence and cannot retry', async () => {
  const result = await simulateSequence({ spawnThrows: true }); assert.equal(result.spawned, 1); assert.equal(result.evidence.providerCallsUsed, 1); assert.notEqual(result.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_PASS');
});

test('bounded helper cannot continue UNKNOWN or use invalid budgets', async () => {
  let invoked = 0;
  const stopped = await runBoundedSequence([1, 2, 3], async () => { invoked += 1; return { state: 'UNKNOWN', continue: true, providerCallStarted: false }; });
  assert.equal(invoked, 1); assert.equal(stopped.stopped, true);
  for (const budget of [NaN, 1.5, 4, -1]) await assert.rejects(runBoundedSequence([], async () => {}, budget), { code: 'PROVIDER_BUDGET_EXCEEDED' });
});

test('case and Unicode normalization collisions block source materialization', () => scratch(root => {
  fs.writeFileSync(path.join(root, 'input.txt'), 'synthetic');
  for (const names of [['Input.txt', 'input.txt'], ['\u00e9', 'e\u0301']]) {
    const io = { ...fs, readdirSync: () => names, lstatSync: entry => fs.lstatSync(entry === fs.realpathSync(root) || entry === root ? entry : path.join(root, 'input.txt')), realpathSync: entry => entry === root ? fs.realpathSync(root) : fs.realpathSync(path.join(root, 'input.txt')) };
    assert.throws(() => inspectTaskTree(root, io), { code: 'SOURCE_PATH_COLLISION' });
  }
}));

test('stderr disclosure remains a definite FAIL after another observer violation', async () => {
  const result = await simulateSequence({ unknownPhase: 2, stderrDisclosure: true });
  assert.equal(result.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL');
  assert.equal(result.evidence.code, 'DATA_BOUNDARY_BREACH');
});

test('persistence failure records ambiguity without hiding definite policy FAIL', async () => {
  const result = await simulateSequence({ failPhase: 1, persistenceFailure: true });
  assert.equal(result.evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL');
  assert.equal(result.evidence.evidencePersistence, 'UNKNOWN');
});


test('known protocol FAIL survives a later filesystem observation error', async () => {
  for (const phase of [1, 2, 3]) {
    const { evidence, spawned } = await simulateSequence({ failPhase: phase, deleteAfterFailure: phase });
    assert.equal(spawned, phase);
    assert.equal(evidence.decision, 'RESTRICTED_RUNNER_SYNTHETIC_NEGATIVES_FAIL');
    assert.equal(evidence[`call${phase}`].state, 'FAIL');
  }
});
