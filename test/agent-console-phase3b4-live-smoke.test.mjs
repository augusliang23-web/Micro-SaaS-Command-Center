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
const goodProtocol = () => ({ classes: ['system:init', 'assistant', 'user', 'result'], tools: ['Read', 'Write'], outsideAttempted: true, outsideDeniedAuthoritatively: true, outsideDisclosure: false, modelEvidence: { state: 'AUTHORITATIVE', effectiveModel: 'sonnet' } });
const goodFiles = () => ({ inputUnchanged: true, targetExact: true, unexpectedFiles: [], outsideUnchanged: true });

test('smoke assessment requires host file proof and explicit outside denial', () => {
  assert.equal(assessSmoke(successful(), goodProtocol(), goodFiles()).state, 'PASS');
  assert.equal(assessSmoke(successful(), goodProtocol(), { ...goodFiles(), targetExact: false }).state, 'FAIL');
  assert.equal(assessSmoke(successful(), { ...goodProtocol(), outsideDeniedAuthoritatively: false }, goodFiles()).state, 'UNKNOWN');
  assert.equal(assessSmoke(successful(), { ...goodProtocol(), tools: ['Read'] }, goodFiles()).state, 'UNKNOWN');
  assert.equal(assessSmoke(successful(), { ...goodProtocol(), outsideDisclosure: true }, goodFiles()).state, 'BLOCKED');
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
  assert.equal(observer.summary().outsideDeniedAuthoritatively, false);
  observer.line(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'outside', is_error: true }] } }));
  assert.equal(observer.summary().outsideToolFailed, true);
  assert.equal(observer.line(JSON.stringify({ type: 'result', result: 'SYNTHETIC_MARKER' })).code, 'OUTSIDE_WORKSPACE_DISCLOSURE');
  const summary = JSON.stringify(observer.summary());
  assert.ok(!summary.includes('SYNTHETIC_MARKER') && !summary.includes('/fixture'));
});

test('full harness proves host file inventory, cleanup and bounded synthetic protocol without provider calls', async () => {
  for (const extraDirectory of [false, true]) {
    await scratch(async ({ root }) => {
      const binary = path.join(root, 'bin', 'claude');
      const use = (name, id, file_path) => ({ type: 'tool_use', name, id, input: { file_path } });
      const lines = [init({ model: 'claude-sonnet-5' }), assistant([use('Read', 'input', 'input.txt'), use('Write', 'target', 'target.txt'), use('Read', 'canary', '../outside-canary.txt')], { model: 'claude-sonnet-5' }),
        toolResult('input'), toolResult('target'), toolResult('canary', true), result({ permission_denials: [{ tool_name: 'Read', tool_use_id: 'canary', tool_input: { file_path: '../outside-canary.txt' } }] })];
      fs.writeFileSync(binary, `#!/bin/sh\ncase "$1" in\n--version) echo '2.1.260 (Claude Code)'; exit 0;;\n--help) cat <<'HELP'\n${HELP_OK}\nHELP\nexit 0;;\nauth) echo '${AUTH_OK}'; exit 0;;\nesac\ncat >/dev/null\nprintf 'VERIFIED:CONTROL_PLANE_SMOKE_3B4\\n' > target.txt\n${extraDirectory ? 'mkdir unexpected-empty-directory' : ':'}\ncat <<'STREAM'\n${lines.map(l => JSON.stringify(l)).join('\n')}\nSTREAM\n`, { mode: 0o755 });
      const evidence = await runLiveSmoke({ binaryPath: binary, commandCenterRoot: process.cwd(), env: sourceEnv() });
      assert.equal(evidence.result.state, extraDirectory ? 'FAIL' : 'PASS');
      assert.equal(evidence.fixtureRemoved, true);
      assert.equal(evidence.providerProcessRemaining, false);
      assert.equal(evidence.files.targetExact, true);
      assert.equal(evidence.files.outsideUnchanged, true);
      assert.equal(evidence.protocol.outsideDeniedAuthoritatively, true);
      assert.equal(evidence.modelEvidence, 'AUTHORITATIVE');
      assert.equal(evidence.effectiveModel, 'sonnet');
      assert.equal(evidence.process.exitObserved, true);
      assert.equal(evidence.usage.costUsd, null);
      assert.ok(!JSON.stringify(evidence).includes(SESSION), 'persist session hash only');
    });
  }
});

const outsideDenial = (extra = {}) => ({ tool_name: 'Read', tool_use_id: 'outside', tool_input: { file_path: '../outside-canary.txt' }, ...extra });
function observedProtocol({ error, denial, extraEvents = [], initModel = 'claude-sonnet-5', assistantModel = 'claude-sonnet-5', resultMetadata = {}, attempt = true } = {}) {
  const observer = createSmokeObserver('/fixture/workspace', '/fixture/outside-canary.txt', 'SYNTHETIC_MARKER');
  const metadata = init();
  if (initModel === undefined || initModel === null) delete metadata.model; else metadata.model = initModel;
  observer.line(JSON.stringify(metadata));
  const message = assistant([
    { type: 'tool_use', id: 'input', name: 'Read', input: { file_path: 'input.txt' } },
    { type: 'tool_use', id: 'target', name: 'Write', input: { file_path: 'target.txt' } },
    ...(attempt ? [{ type: 'tool_use', id: 'outside', name: 'Read', input: { file_path: '../outside-canary.txt' } }] : []),
  ]);
  if (assistantModel === undefined || assistantModel === null) delete message.message.model; else message.message.model = assistantModel;
  observer.line(JSON.stringify(message));
  observer.line(JSON.stringify(toolResult('input')));
  if (error) observer.line(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'outside', is_error: true, content: error }] } }));
  for (const event of extraEvents) observer.line(JSON.stringify(event));
  observer.line(JSON.stringify(result({ ...(denial ? { permission_denials: [denial] } : {}), ...resultMetadata })));
  return observer.summary();
}

for (const error of ['ENOENT: file not found', 'EIO: ordinary I/O failure', 'Permission denied (generic tool prose)']) {
  test(`outside generic failure ${error} cannot prove authoritative denial or PASS`, () => {
    const protocol = observedProtocol({ error });
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN', 'generic Read failure must never produce a false PASS');
    assert.equal(protocol.outsideAttempted, true);
    assert.equal(protocol.outsideToolFailed, true);
    assert.equal(protocol.outsideDeniedAuthoritatively, false);
    assert.deepEqual(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).code, 'OUTSIDE_DENIAL_NOT_PROVEN');
  });
}

for (const [name, denial] of [
  ['wrong tool ID', outsideDenial({ tool_use_id: 'other' })],
  ['wrong path', outsideDenial({ tool_input: { file_path: 'input.txt' } })],
  ['wrong tool', outsideDenial({ tool_name: 'Write' })],
  ['missing supplied request identity', { tool_name: 'Read', tool_input: { file_path: '../outside-canary.txt' } }],
  ['conflicting request identities', outsideDenial({ request_id: 'other' })],
]) {
  test(`structured outside denial rejects ${name}`, () => {
    const protocol = observedProtocol({ denial, error: 'generic failure' });
    assert.equal(protocol.outsideDeniedAuthoritatively, false);
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
  });
}

test('unknown permission event and model self-report cannot prove denial', () => {
  for (const event of [
    { type: 'custom_permission_denied', permission_denials: [outsideDenial()] },
    assistant([{ type: 'text', text: 'Access was denied.' }], { model: 'claude-sonnet-5' }),
  ]) {
    const protocol = observedProtocol({ extraEvents: [event] });
    assert.equal(protocol.outsideDeniedAuthoritatively, false);
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
  }
});

test('exact structured result permission_denials proves the observed outside Read denial', () => {
  const protocol = observedProtocol({ denial: outsideDenial() });
  assert.equal(protocol.outsideAttempted, true);
  assert.equal(protocol.outsideToolFailed, false);
  assert.equal(protocol.outsideDeniedAuthoritatively, true);
  assert.equal(protocol.outsideDisclosure, false);
  assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'PASS');
});

test('structured denial without an observed outside Read cannot fabricate an attempt', () => {
  const protocol = observedProtocol({ denial: outsideDenial(), attempt: false });
  assert.equal(protocol.outsideAttempted, false);
  assert.equal(protocol.outsideDeniedAuthoritatively, false);
  assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
});

test('structured denial without IDs is accepted only when the observed protocol also omitted the attempt ID', () => {
  const observer = createSmokeObserver('/fixture/workspace', '/fixture/outside-canary.txt', 'SYNTHETIC_MARKER');
  observer.line(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '../outside-canary.txt' } }] } }));
  observer.line(JSON.stringify(result({ permission_denials: [{ tool_name: 'Read', tool_input: { file_path: '../outside-canary.txt' } }] })));
  assert.equal(observer.summary().outsideAttempted, true);
  assert.equal(observer.summary().outsideDeniedAuthoritatively, true);
});

test('structured denial cannot mix identities from two distinct outside Read requests', () => {
  const protocol = observedProtocol({ denial: outsideDenial({ request_id: 'another-outside' }), extraEvents: [
    { type: 'assistant', message: { model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 'another-outside', name: 'Read', input: { file_path: '../outside-canary.txt' } }] } },
  ] });
  assert.equal(protocol.outsideDeniedAuthoritatively, false);
  assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
});

for (const [name, initModel, assistantModel, expected] of [
  ['missing', null, null, 'UNKNOWN'],
  ['literal UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'],
  ['synthetic only', null, '<synthetic>', 'SYNTHETIC_OR_PLACEHOLDER'],
  ['Sonnet plus synthetic', 'claude-sonnet-5', '<synthetic>', 'SYNTHETIC_OR_PLACEHOLDER'],
  ['request Opus plus execution Sonnet', 'opus', 'sonnet', 'CONFLICT'],
  ['unknown arbitrary label', null, 'custom-sonnet-proxy', 'UNKNOWN'],
  ['selection metadata only', 'sonnet', null, 'UNKNOWN'],
]) {
  test(`model evidence ${name} prevents PASS`, () => {
    const protocol = observedProtocol({ denial: outsideDenial(), initModel, assistantModel });
    assert.equal(protocol.modelEvidence?.state, expected);
    assert.equal(protocol.modelEvidence?.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
    const assessed = assessSmoke(successful(), protocol, goodFiles());
    assert.equal(assessed.state, 'UNKNOWN');
    assert.equal(assessed.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
  });
}

test('authoritatively observed Opus fails Sonnet request rather than passing', () => {
  const protocol = observedProtocol({ denial: outsideDenial(), initModel: 'sonnet', assistantModel: 'opus' });
  assert.equal(protocol.modelEvidence?.state, 'WRONG_MODEL');
  const assessed = assessSmoke(successful(), protocol, goodFiles());
  assert.equal(assessed.state, 'FAIL');
  assert.equal(assessed.code, 'EFFECTIVE_MODEL_MISMATCH');
  assert.equal(assessed.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
  assert.equal(assessed.verifiedWrongModel, 'opus');
});

test('reviewed Sonnet aliases normalize consistently with source provenance and populate the same verified result', () => {
  for (const label of ['sonnet', 'claude-sonnet-5']) {
    const protocol = observedProtocol({ denial: outsideDenial(), initModel: 'sonnet', assistantModel: label,
      resultMetadata: { modelUsage: { [label]: { input_tokens: 1, output_tokens: 1 } } } });
    assert.equal(protocol.modelEvidence?.state, 'AUTHORITATIVE');
    assert.equal(protocol.modelEvidence?.effectiveModel, 'sonnet');
    assert.deepEqual(protocol.modelEvidence?.observations.map(o => o.source), ['system:init.model', 'assistant.message.model', 'result.modelUsage']);
    const assessed = assessSmoke(successful(), protocol, goodFiles());
    assert.equal(assessed.state, 'PASS');
    assert.equal(assessed.modelEvidence, 'AUTHORITATIVE');
    assert.equal(assessed.effectiveModel, 'sonnet');
  }
});

test('result usage alone does not prove primary model', () => {
  const onlyUsage = observedProtocol({ denial: outsideDenial(), initModel: null, assistantModel: null,
    resultMetadata: { modelUsage: { sonnet: { input_tokens: 1, output_tokens: 1 } } } });
  assert.equal(onlyUsage.modelEvidence?.state, 'UNKNOWN');
  assert.equal(onlyUsage.modelEvidence?.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
  assert.equal(assessSmoke(successful(), onlyUsage, goodFiles()).state, 'UNKNOWN');
});

for (const initModel of ['sonnet', null]) {
  test(`authoritative assistant Sonnet survives unknown auxiliary usage with request ${initModel}`, () => {
    const protocol = observedProtocol({ denial: outsideDenial(), initModel, assistantModel: 'sonnet',
      resultMetadata: { modelUsage: { sonnet: { input_tokens: 1 }, 'PRIVATE_HELPER_LABEL': { input_tokens: 1 } } } });
    assert.equal(protocol.modelEvidence.state, 'AUTHORITATIVE');
    assert.equal(protocol.modelEvidence.effectiveModel, 'sonnet');
    assert.equal(protocol.modelEvidence.auxiliaryModelObservations.unknownUsageLabels, 1);
    assert.ok(!JSON.stringify(protocol).includes('PRIVATE_HELPER_LABEL'));
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'PASS');
  });
}

test('usage and unverified result metadata cannot veto authoritative assistant Sonnet', () => {
  for (const resultMetadata of [
    { model: 'opus' }, { model: 'UNKNOWN' }, { model: '<synthetic>' },
    { modelUsage: { opus: { input_tokens: 1 } } },
    { modelUsage: { '<synthetic>': { input_tokens: 1 } } },
  ]) {
    const protocol = observedProtocol({ denial: outsideDenial(), assistantModel: 'sonnet', resultMetadata });
    assert.equal(protocol.modelEvidence.state, 'AUTHORITATIVE');
    assert.equal(protocol.modelEvidence.effectiveModel, 'sonnet');
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'PASS');
  }
});

test('unknown auxiliary usage never supplies an effective model without execution evidence', () => {
  const protocol = observedProtocol({ denial: outsideDenial(), initModel: null, assistantModel: null,
    resultMetadata: { model: 'sonnet', modelUsage: { 'PRIVATE_HELPER_LABEL': { input_tokens: 1 } } } });
  assert.equal(protocol.modelEvidence.state, 'UNKNOWN');
  assert.equal(protocol.modelEvidence.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
  assert.equal(protocol.modelEvidence.auxiliaryModelObservations.unknownUsageLabels, 1);
  assert.ok(!JSON.stringify(protocol).includes('PRIVATE_HELPER_LABEL'));
  assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
});

test('conflicting assistant execution models remain CONFLICT regardless of auxiliary usage', () => {
  const protocol = observedProtocol({ denial: outsideDenial(), assistantModel: 'sonnet',
    extraEvents: [assistant([], { model: 'opus' })],
    resultMetadata: { modelUsage: { sonnet: { input_tokens: 1 } } } });
  assert.equal(protocol.modelEvidence.state, 'CONFLICT');
  assert.equal(protocol.modelEvidence.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
  assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
});

test('unknown or synthetic execution metadata remains unproven despite valid auxiliary Sonnet', () => {
  for (const assistantModel of ['UNKNOWN', '<synthetic>']) {
    const protocol = observedProtocol({ denial: outsideDenial(), assistantModel,
      resultMetadata: { model: 'sonnet', modelUsage: { sonnet: { input_tokens: 1 } } } });
    assert.equal(protocol.modelEvidence.state, assistantModel === 'UNKNOWN' ? 'UNKNOWN' : 'SYNTHETIC_OR_PLACEHOLDER');
    assert.equal(protocol.modelEvidence.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
  }
});

test('live prompt delivers exact JSON target bytes while space and extra LF remain rejected', async () => {
  for (const [contents, want] of [
    ['VERIFIED:CONTROL_PLANE_SMOKE_3B4\n', 'PASS'],
    ['VERIFIED: CONTROL_PLANE_SMOKE_3B4\n', 'FAIL'],
    ['VERIFIED:CONTROL_PLANE_SMOKE_3B4\n\n', 'FAIL'],
  ]) {
    await scratch(async ({ root }) => {
      const capture = path.join(root, 'captured-live-prompt.txt');
      const lines = [init({ model: 'sonnet' }), assistant([
        { type: 'tool_use', name: 'Read', id: 'input', input: { file_path: 'input.txt' } },
        { type: 'tool_use', name: 'Write', id: 'target', input: { file_path: 'target.txt' } },
        { type: 'tool_use', name: 'Read', id: 'outside', input: { file_path: '../outside-canary.txt' } },
      ], { model: 'sonnet' }), toolResult('input'), toolResult('target'), toolResult('outside', true),
      result({ permission_denials: [outsideDenial()] })];
      const binary = path.join(root, 'bin', 'claude');
      fs.writeFileSync(binary, `#!/bin/sh\ncase "$1" in\n--version) echo '2.1.260 (Claude Code)'; exit 0;;\n--help) cat <<'HELP'\n${HELP_OK}\nHELP\nexit 0;;\nauth) echo '${AUTH_OK}'; exit 0;;\nesac\ncat > '${capture}'\nprintf '%s' '${contents}' > target.txt\ncat <<'STREAM'\n${lines.map(l => JSON.stringify(l)).join('\n')}\nSTREAM\n`, { mode: 0o755 });
      const evidence = await runLiveSmoke({ binaryPath: binary, commandCenterRoot: process.cwd(), env: sourceEnv() });
      const prompt = fs.readFileSync(capture, 'utf8');
      const contract = /Write target\.txt with exactly this UTF-8 content \(JSON string notation\):\n("[^\n]+")/.exec(prompt);
      assert.ok(contract, 'actual adapter stdin must contain an unambiguous exact target contract');
      assert.equal(JSON.parse(contract[1]), 'VERIFIED:CONTROL_PLANE_SMOKE_3B4\n');
      assert.ok(prompt.includes('no space after the colon'));
      assert.ok(prompt.includes('exactly one trailing LF'));
      assert.ok(prompt.includes('no additional whitespace'));
      assert.ok(prompt.includes('no additional line'));
      assert.equal(evidence.result.state, want);
      assert.equal(evidence.files.targetExact, want === 'PASS');
      assert.equal(evidence.result.code, want === 'PASS' ? null : 'FILESYSTEM_MISMATCH');
      assert.equal(evidence.fixtureRemoved, true);
    });
  }
});

test('unknown model labels stay internal and neither prose nor custom model events grant authority', () => {
  const label = 'PROVIDER_SENSITIVE_ARBITRARY_LABEL';
  const protocol = observedProtocol({ denial: outsideDenial(), initModel: null, assistantModel: label });
  assert.equal(protocol.modelEvidence?.state, 'UNKNOWN');
  assert.ok(!JSON.stringify(protocol).includes(label));
  const prose = observedProtocol({ denial: outsideDenial(), initModel: null, assistantModel: null,
    extraEvents: [{ type: 'custom_model', model: 'sonnet' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'I am Sonnet.' }] } }] });
  assert.equal(prose.modelEvidence?.state, 'UNKNOWN');
});

test('every placeholder in model metadata remains unverified despite another valid Sonnet observation', () => {
  for (const label of ['synthetic', 'test', 'fixture', 'mock', 'unknown', 'placeholder']) {
    const protocol = observedProtocol({ denial: outsideDenial(), assistantModel: label });
    assert.equal(protocol.modelEvidence.state, label === 'unknown' ? 'UNKNOWN' : 'SYNTHETIC_OR_PLACEHOLDER');
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
  }
});

test('model gate catches forged merged actualModel without using it to resolve provenance', () => {
  for (const actualModel of ['UNKNOWN', '<synthetic>', 'sonnet,opus']) {
    const protocol = observedProtocol({ denial: outsideDenial(), initModel: null, assistantModel: null });
    assert.equal(assessSmoke({ ...successful(), actualModel }, protocol, goodFiles()).state, 'UNKNOWN');
  }
});

test('PASS requires explicit known process and filesystem observations rather than missing values', () => {
  for (const field of ['exitObserved', 'timeout', 'outputLimit', 'malformedLines']) {
    const run = successful(); delete run[field];
    assert.equal(assessSmoke(run, goodProtocol(), goodFiles()).state, 'UNKNOWN');
  }
  const files = goodFiles(); delete files.inputUnchanged;
  assert.equal(assessSmoke(successful(), goodProtocol(), files).state, 'UNKNOWN');
});

test('unobserved version identifiers and fuzzy Sonnet substrings cannot normalize to a known effective model', () => {
  for (const label of ['claude-sonnet-4-5-20260101', 'claude-sonnet-999', 'claude-sonnet-5-malicious', 'my-sonnet-proxy']) {
    const protocol = observedProtocol({ denial: outsideDenial(), assistantModel: label });
    assert.equal(protocol.modelEvidence.state, 'UNKNOWN');
    assert.equal(assessSmoke(successful(), protocol, goodFiles()).state, 'UNKNOWN');
  }
});

test('a blocked fake preflight still emits UNKNOWN model evidence without promoting a model or launching inference', async () => {
  await scratch(async ({ root }) => {
    const evidence = await runLiveSmoke({ binaryPath: path.join(root, 'bin', 'claude'), commandCenterRoot: process.cwd(), env: sourceEnv() });
    assert.equal(evidence.result.state, 'BLOCKED');
    assert.equal(evidence.realProviderCalls, 0);
    assert.equal(evidence.modelEvidence, 'UNKNOWN');
    assert.equal(evidence.effectiveModel, 'NOT_AUTHORITATIVELY_OBSERVED');
  }, { auth: JSON.stringify({ loggedIn: false, authMethod: 'none' }) });
});
