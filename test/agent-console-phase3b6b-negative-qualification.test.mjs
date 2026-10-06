import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
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
