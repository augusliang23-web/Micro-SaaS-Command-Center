import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { ClaudeCliAdapter, buildClaudeArgs } from '../server/execution/claudeCliAdapter.mjs';
import { makeBinary, realTmp, sourceEnv, spec, init, result, SESSION, HELP_OK, AUTH_OK, assistant, toolResult } from './helpers/fakeClaude.mjs';
import { assessSmoke, createSmokeObserver, runLiveSmoke } from '../scripts/claudeLiveSmoke.mjs';

async function scratch(fn, options) {
  const root = realTmp('cc-p3b4-test-');
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const binaryPath = makeBinary(bin, options);
  const cwd = path.join(root, 'workspace'); fs.mkdirSync(cwd);
  const adapter = (extra = {}) => new ClaudeCliAdapter({ binaryPath, env: sourceEnv(), commandCenterRoot: process.cwd(), killGraceMs: 100, ...extra });
  try { await fn({ root, cwd, adapter }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('live invocation disables persistence and Chrome and denies MCP', () => {
  const args = buildClaudeArgs({ sessionId: SESSION, model: 'sonnet', effort: 'high' });
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(args.includes('--no-chrome'));
  assert.ok(args.find(a => a.startsWith('--disallowedTools=')).includes('mcp__*'));
});

test('malformed stream with successful final result remains UNKNOWN', async () => scratch(async ({ cwd, adapter }) => {
  fs.writeFileSync(path.join(cwd, 'events.ndjson'), [JSON.stringify(init()), 'not json', JSON.stringify(result())].join('\n') + '\n');
  const run = await adapter().start(spec(cwd), () => {});
  assert.deepEqual([run.outcome, run.code], ['unknown', 'PROTOCOL_PARSE_FAILED']);
}));

test('missing final result remains UNKNOWN even after exit zero', async () => scratch(async ({ cwd, adapter }) => {
  fs.writeFileSync(path.join(cwd, 'events.ndjson'), JSON.stringify(init()) + '\n');
  const run = await adapter().start(spec(cwd), () => {});
  assert.deepEqual([run.outcome, run.code], ['unknown', 'TRUNCATED_STREAM']);
}));

test('output overflow remains UNKNOWN and terminates the process', async () => scratch(async ({ cwd, adapter }) => {
  fs.writeFileSync(path.join(cwd, 'behavior.sh'), "yes '{\"type\":\"x\"}'\n");
  const run = await adapter({ limits: { maxStdoutBytes: 200 } }).start(spec(cwd), () => {});
  assert.deepEqual([run.outcome, run.code], ['unknown', 'OUTPUT_LIMIT']);
  assert.equal(run.exitObserved, true);
}));

test('timeout is bounded and remains UNKNOWN', async () => scratch(async ({ cwd, adapter }) => {
  fs.writeFileSync(path.join(cwd, 'behavior.sh'), 'sleep 30\n');
  const started = Date.now();
  const run = await adapter({ timeoutMs: 100 }).start(spec(cwd), () => {});
  assert.deepEqual([run.outcome, run.code], ['unknown', 'TIMEOUT']);
  assert.equal(run.exitObserved, true);
  assert.ok(Date.now() - started < 5000);
}));

test('subscription gate refuses API-key and logged-out auth before any inference', async () => {
  for (const auth of [{ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }, { loggedIn: false, authMethod: 'none' }]) {
    await scratch(async ({ cwd, adapter }) => {
      const run = await adapter().start(spec(cwd), () => {});
      assert.equal(run.outcome, 'blocked');
      assert.equal(fs.existsSync(path.join(cwd, 'captured-stdin.txt')), false);
    }, { auth: JSON.stringify(auth) });
  }
});

test('protocol observer can stop a disclosed synthetic canary', async () => scratch(async ({ cwd, adapter }) => {
  fs.writeFileSync(path.join(cwd, 'behavior.sh'), 'echo SYNTHETIC_CANARY_DISCLOSED\nsleep 30\n');
  const run = await adapter({ onProtocolLine: line => line.includes('SYNTHETIC_CANARY_DISCLOSED') ? { code: 'OUTSIDE_WORKSPACE_DISCLOSURE', message: 'Synthetic boundary disclosure' } : null }).start(spec(cwd), () => {});
  assert.deepEqual([run.outcome, run.code], ['unknown', 'OUTSIDE_WORKSPACE_DISCLOSURE']);
  assert.equal(run.exitObserved, true);
}));

test('synthetic canary disclosure on stderr cannot evade the observer', async () => scratch(async ({ cwd, adapter }) => {
  fs.writeFileSync(path.join(cwd, 'behavior.sh'), `echo SYNTHETIC_CANARY_DISCLOSED >&2\ncat <<'STREAM'\n${JSON.stringify(init())}\n${JSON.stringify(result())}\nSTREAM\n`);
  const run = await adapter({ onProtocolLine: line => line.includes('SYNTHETIC_CANARY_DISCLOSED') ? { code: 'OUTSIDE_WORKSPACE_DISCLOSURE', message: 'Synthetic boundary disclosure' } : null }).start(spec(cwd), () => {});
  assert.deepEqual([run.outcome, run.code], ['unknown', 'OUTSIDE_WORKSPACE_DISCLOSURE']);
}));

test('malformed protocol has UNKNOWN precedence over a nonzero exit', async () => scratch(async ({ cwd, adapter }) => {
  fs.writeFileSync(path.join(cwd, 'behavior.sh'), 'echo malformed\nexit 3\n');
  const run = await adapter().start(spec(cwd), () => {});
  assert.deepEqual([run.outcome, run.code], ['unknown', 'PROTOCOL_PARSE_FAILED']);
}));

const successful = () => ({ outcome: 'completed', exitObserved: true, exitCode: 0, timeout: false, outputLimit: null, malformedLines: 0 });
const goodProtocol = () => ({ classes: ['system:init', 'assistant', 'user', 'result'], tools: ['Read', 'Write'], outsideAttempted: true, outsideDenied: true, disclosed: false });
const goodFiles = () => ({ inputUnchanged: true, targetExact: true, unexpectedFiles: [], outsideUnchanged: true });

test('smoke assessment requires host file proof and explicit outside denial', () => {
  assert.equal(assessSmoke(successful(), goodProtocol(), goodFiles()).state, 'PASS');
  assert.equal(assessSmoke(successful(), goodProtocol(), { ...goodFiles(), targetExact: false }).state, 'FAIL');
  assert.equal(assessSmoke(successful(), { ...goodProtocol(), outsideDenied: false }, goodFiles()).state, 'UNKNOWN');
  assert.equal(assessSmoke(successful(), { ...goodProtocol(), tools: ['Read'] }, goodFiles()).state, 'UNKNOWN');
  assert.equal(assessSmoke(successful(), { ...goodProtocol(), disclosed: true }, goodFiles()).state, 'BLOCKED');
});

test('smoke assessment cannot promote ambiguous output, timeout or missing exit', () => {
  for (const change of [{ outcome: 'unknown' }, { exitObserved: false }, { timeout: true }, { outputLimit: 'STDOUT_LIMIT' }, { malformedLines: 1 }]) {
    assert.equal(assessSmoke({ ...successful(), ...change }, goodProtocol(), goodFiles()).state, 'UNKNOWN');
  }
});

test('boundary observer correlates the outside Read with its failed result, detects marker and retains no raw text', () => {
  const observer = createSmokeObserver('/fixture/workspace', '/fixture/outside-canary.txt', 'SYNTHETIC_MARKER');
  observer.line(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'outside', name: 'Read', input: { file_path: '../outside-canary.txt' } }] } }));
  observer.line(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'other', is_error: true }] } }));
  assert.equal(observer.summary().outsideDenied, false);
  observer.line(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'outside', is_error: true }] } }));
  assert.equal(observer.summary().outsideDenied, true);
  assert.equal(observer.line(JSON.stringify({ type: 'result', result: 'SYNTHETIC_MARKER' })).code, 'OUTSIDE_WORKSPACE_DISCLOSURE');
  const summary = JSON.stringify(observer.summary());
  assert.ok(!summary.includes('SYNTHETIC_MARKER') && !summary.includes('/fixture'));
});

test('full harness proves host file inventory, cleanup and bounded synthetic protocol without provider calls', async () => {
  for (const extraDirectory of [false, true]) {
    await scratch(async ({ root }) => {
      const binary = path.join(root, 'bin', 'claude');
      const use = (name, id, file_path) => ({ type: 'tool_use', name, id, input: { file_path } });
      const lines = [init(), assistant([use('Read', 'input', 'input.txt'), use('Write', 'target', 'target.txt'), use('Read', 'canary', '../outside-canary.txt')]),
        toolResult('input'), toolResult('target'), toolResult('canary', true), result()];
      fs.writeFileSync(binary, `#!/bin/sh\ncase "$1" in\n--version) echo '2.1.260 (Claude Code)'; exit 0;;\n--help) cat <<'HELP'\n${HELP_OK}\nHELP\nexit 0;;\nauth) echo '${AUTH_OK}'; exit 0;;\nesac\ncat >/dev/null\nprintf 'VERIFIED:CONTROL_PLANE_SMOKE_3B4\\n' > target.txt\n${extraDirectory ? 'mkdir unexpected-empty-directory' : ':'}\ncat <<'STREAM'\n${lines.map(l => JSON.stringify(l)).join('\n')}\nSTREAM\n`, { mode: 0o755 });
      const evidence = await runLiveSmoke({ binaryPath: binary, commandCenterRoot: process.cwd(), env: sourceEnv() });
      assert.equal(evidence.result.state, extraDirectory ? 'FAIL' : 'PASS');
      assert.equal(evidence.fixtureRemoved, true);
      assert.equal(evidence.providerProcessRemaining, false);
      assert.equal(evidence.files.targetExact, true);
      assert.equal(evidence.files.outsideUnchanged, true);
      assert.equal(evidence.protocol.outsideDenied, true);
      assert.equal(evidence.process.exitObserved, true);
      assert.equal(evidence.usage.costUsd, null);
      assert.ok(!JSON.stringify(evidence).includes(SESSION), 'persist session hash only');
    });
  }
});
