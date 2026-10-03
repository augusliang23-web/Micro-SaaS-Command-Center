import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { startProcess } from '../server/execution/streamingProcess.mjs';
import { createClaudeStreamParser } from '../server/execution/claudeStreamParser.mjs';
import { gradeForEvent, isWithinAdapterCeiling, validateProbe } from '../server/execution/agentAdapter.mjs';
import { assistant, init, result, text, toolResult, toolUse } from './helpers/fakeClaude.mjs';

function fakeChild({ onKill } = {}) {
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: undefined, exitCode: null, signalCode: null });
  child.kill = (signal) => { child.killed = [...(child.killed ?? []), signal]; onKill?.(child, signal); return true; };
  child.exit = (code = 0, signal = null) => { child.exitCode = code; child.signalCode = signal; child.emit('exit', code, signal); child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code, signal)); };
  return child;
}
const run = (child, extra = {}) => {
  const lines = [];
  let options;
  const handle = startProcess({ command: '/bin/fake', args: ['-p'], cwd: '/tmp', env: { A: '1' }, onLine: (l) => lines.push(l), spawnImpl: (c, a, o) => { options = o; return child; }, killGraceMs: 20, ...extra });
  return { handle, lines, options: () => options };
};

// ---------- streamingProcess ----------

test('process: no shell, argv only, stdin written once and closed', async () => {
  const child = fakeChild();
  const chunks = [];
  child.stdin.on('data', (c) => chunks.push(c.toString()));
  const { handle, options } = run(child, { stdin: 'PROMPT $(x) `y`' });
  child.exit(0);
  await handle.done;
  assert.equal(options().shell, false);
  assert.deepEqual(options().stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(options().env, { A: '1' });
  assert.equal(chunks.join(''), 'PROMPT $(x) `y`');
  assert.throws(() => startProcess({ command: '', args: [], spawnImpl: () => child }), /Invalid process specification/);
  assert.throws(() => startProcess({ command: '/bin/x', args: ['a\0b'], spawnImpl: () => child }), /Invalid process specification/);
  assert.throws(() => startProcess({ command: '/bin/x', args: [5], spawnImpl: () => child }), /Invalid process specification/);
});

test('process: lines are reassembled across chunks, CRLF is tolerated, a final partial line is flagged', async () => {
  const child = fakeChild();
  const { handle, lines } = run(child);
  child.stdout.write('{"a":');
  child.stdout.write('1}\r\n{"b":2}\n\n{"c"');
  child.stdout.write(':3}');
  child.exit(0);
  const done = await handle.done;
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  assert.equal(done.finalLinePartial, true);
  assert.equal(done.exitObserved, true);
});

test('process: multibyte characters split across chunks decode correctly', async () => {
  const child = fakeChild();
  const { handle, lines } = run(child);
  const bytes = Buffer.from('{"t":"哈囉"}\n');
  child.stdout.write(bytes.subarray(0, 8));
  child.stdout.write(bytes.subarray(8));
  child.exit(0);
  await handle.done;
  assert.deepEqual(lines, ['{"t":"哈囉"}']);
});

test('process limits: line, stdout and stderr overruns terminate the child and are reported, never truncated silently', async () => {
  for (const [limits, feed, expected] of [
    [{ maxLineBytes: 16 }, (c) => c.stdout.write('x'.repeat(100)), 'LINE_LIMIT'],
    [{ maxStdoutBytes: 20 }, (c) => { c.stdout.write('{"a":1}\n'); c.stdout.write('{"b":2}\n'); c.stdout.write('{"c":3}\n'); }, 'STDOUT_LIMIT'],
    [{ maxStderrBytes: 10 }, (c) => c.stderr.write('e'.repeat(50)), 'STDERR_LIMIT'],
  ]) {
    const child = fakeChild({ onKill: (c, s) => c.exit(null, s) });
    const { handle } = run(child, { limits });
    feed(child);
    const done = await handle.done;
    assert.equal(done.limit, expected);
    assert.equal(done.terminateReason, 'limit');
    assert.ok(child.killed.includes('SIGTERM'));
  }
});

test('process: after a limit trips, no further output is delivered', async () => {
  const child = fakeChild({ onKill: (c, s) => c.exit(null, s) });
  const { handle, lines } = run(child, { limits: { maxLineBytes: 16 } });
  child.stdout.write('x'.repeat(100));
  if (!child.stdout.writableEnded) child.stdout.write('\n{"late":true}\n'); // the limit already killed the child
  await handle.done;
  assert.ok(!lines.some((l) => l.includes('late')));
});

test('process cancel: SIGTERM first, SIGKILL only if the child ignores it, and exit is awaited', async () => {
  const polite = fakeChild({ onKill: (c, s) => c.exit(null, s) });
  const a = run(polite);
  a.handle.cancel();
  const doneA = await a.handle.done;
  assert.deepEqual(polite.killed, ['SIGTERM']);
  assert.deepEqual([doneA.exitObserved, doneA.terminateReason], [true, 'cancel']);

  const stubborn = fakeChild({ onKill: (c, s) => { if (s === 'SIGKILL') c.exit(null, s); } });
  const b = run(stubborn);
  b.handle.cancel();
  const doneB = await b.handle.done;
  assert.deepEqual(stubborn.killed, ['SIGTERM', 'SIGKILL']);
  assert.equal(doneB.exitObserved, true);

  const immortal = fakeChild();
  const c = run(immortal);
  c.handle.cancel();
  const doneC = await c.handle.done;
  assert.deepEqual(immortal.killed, ['SIGTERM', 'SIGKILL']);
  assert.equal(doneC.exitObserved, false, 'a process that never exits must not be reported as exited');
});

test('process: a spawn error settles with the error; cancel after exit is a no-op', async () => {
  const child = fakeChild();
  const { handle } = run(child);
  child.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }));
  assert.equal((await handle.done).spawnError.code, 'ENOENT');
  const exited = fakeChild();
  const r = run(exited);
  exited.exit(0);
  await r.handle.done;
  r.handle.cancel();
  assert.equal(exited.killed, undefined);
  const thrown = startProcess({ command: '/bin/x', args: [], spawnImpl: () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }); } });
  assert.equal((await thrown.done).spawnError.code, 'EACCES');
});

// ---------- parser ----------

const parser = (extra = {}) => createClaudeStreamParser({ allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'], ...extra });
const feed = (p, events) => events.flatMap((e) => p.push(typeof e === 'string' ? e : JSON.stringify(e)));

test('parser: init, assistant text, tool use/result, usage and result map to neutral ungraded events', () => {
  const p = parser();
  const events = feed(p, [init(), assistant([text('hello'), toolUse('Read', 't1')]), toolResult('t1', true), result()]);
  assert.deepEqual(events, [
    { type: 'started', sessionId: init().session_id, model: 'claude-sonnet-4-5-20260101' },
    { type: 'output', text: 'hello' },
    { type: 'tool', phase: 'use', name: 'Read', toolUseId: 't1' },
    { type: 'tool', phase: 'result', toolUseId: 't1', isError: true },
  ]);
  assert.ok(events.every((e) => !('grade' in e)), 'the parser never assigns grades');
  const summary = p.finish();
  assert.equal(summary.sawResult, true);
  assert.equal(summary.resultOk, true);
  assert.deepEqual(summary.usage, { tokens: { input: 100, output: 50, cached: 30 }, costUsd: null, grade: 'OBSERVED' });
});

test('parser: Claude event names and agent-supplied fields never leak into neutral events', () => {
  const p = parser();
  const out = feed(p, [{ type: 'weird', grade: 'LOCALLY_VERIFIED', secret: 'S3CR3T' }, { type: 5 }, { type: { nested: true } }, { noType: true }, { type: 'x'.repeat(500) }]);
  assert.ok(out.every((e) => e.type === 'raw' && Object.keys(e).sort().join() === 'eventType,type'));
  assert.ok(!JSON.stringify(out).includes('S3CR3T'));
  assert.ok(out.every((e) => e.eventType.length <= 64));
});

test('parser: huge text is bounded; tool names are sanitized; non-objects are malformed', () => {
  const p = parser();
  const out = feed(p, [assistant([text('x'.repeat(100_000)), toolUse('Read\u0000;rm -rf /', 'id with spaces')]), '42', 'null', 'true', '[]']);
  assert.equal(out[0].text.length, 20_000);
  assert.ok(/^[\w.:/?-]+$/.test(out[1].name));
  assert.equal(p.finish().malformedLines, 4);
});

test('parser: the run is only successful with a real result event; error subtypes and is_error are not success', () => {
  for (const [events, ok, sawResult] of [
    [[init()], false, false],
    [[init(), result()], true, true],
    [[init(), result({ subtype: 'error_during_execution' })], false, true],
    [[init(), result({ is_error: true })], false, true],
    [[init(), assistant([text('Task complete! All tests pass.')])], false, false],
  ]) {
    const p = parser();
    feed(p, events);
    const s = p.finish();
    assert.deepEqual([s.resultOk, s.sawResult], [ok, sawResult]);
  }
});

test('parser: usage never fabricates fields, never reports cost, and ignores bad numbers', () => {
  for (const usage of [undefined, null, 'x', {}, { input_tokens: 5 }, { input_tokens: -1, output_tokens: 2 }, { input_tokens: 1.5, output_tokens: 2 }, { input_tokens: '5', output_tokens: 2 }]) {
    const p = parser();
    feed(p, [init(), result({ usage })]);
    assert.deepEqual(p.finish().usage, { tokens: null, costUsd: null, grade: 'UNAVAILABLE' }, JSON.stringify(usage));
  }
  const p = parser();
  feed(p, [init(), result({ usage: { input_tokens: 5, output_tokens: 2 }, total_cost_usd: 99 })]);
  assert.deepEqual(p.finish().usage, { tokens: { input: 5, output: 2 }, costUsd: null, grade: 'OBSERVED' });
});

test('parser: policy violations are recorded once, first wins', () => {
  const p = parser({ expectedCwd: '/work/wt' });
  feed(p, [init({ cwd: '/work/wt', tools: ['Read', 'Bash', 'WebFetch'] }), assistant([toolUse('Bash')])]);
  assert.equal(p.policyViolation.code, 'TOOL_POLICY_VIOLATION');
  assert.match(p.policyViolation.message, /Bash, WebFetch/);
  const ok = parser({ expectedCwd: '/work/wt' });
  feed(ok, [init({ cwd: '/work/wt' }), assistant([toolUse('Edit')])]);
  assert.equal(ok.policyViolation, null);
});

test('parser: tool_use enforcement does not depend on the init tool inventory', () => {
  const bare = { type: 'system', subtype: 'init', session_id: 's', permissionMode: 'acceptEdits' };
  const bash = parser();
  feed(bash, [bare, assistant([toolUse('Bash')])]);
  assert.equal(bash.policyViolation.code, 'TOOL_POLICY_VIOLATION');
  assert.equal(bash.finish().toolPolicyObserved, false);
  const noInit = parser();
  feed(noInit, [assistant([toolUse('WebSearch')])]);
  assert.equal(noInit.policyViolation.code, 'TOOL_POLICY_VIOLATION');
  const edit = parser();
  feed(edit, [bare, assistant([toolUse('Edit'), toolUse('Read', 't2')])]);
  assert.equal(edit.policyViolation, null);
});

// ---------- adapter contract helpers ----------

test('contract: only agent prose is AGENT_CLAIM; nothing exceeds RUNTIME_OBSERVED', () => {
  for (const type of ['started', 'tool', 'usage', 'denied', 'error', 'raw', 'finished']) assert.equal(gradeForEvent(type), 'RUNTIME_OBSERVED', type);
  assert.equal(gradeForEvent('output'), 'AGENT_CLAIM');
  for (const grade of ['AGENT_CLAIM', 'RUNTIME_OBSERVED']) assert.equal(isWithinAdapterCeiling(grade), true);
  for (const grade of ['LOCALLY_VERIFIED', 'GITHUB_VERIFIED', 'EXTERNAL_AUTHORITATIVE', 'UNKNOWN', 'PASS', undefined]) assert.equal(isWithinAdapterCeiling(grade), false, String(grade));
});

test('contract: probe validation requires explicit capabilities', () => {
  assert.ok(validateProbe({ id: 'x', available: false }).length > 0);
  assert.deepEqual(validateProbe({ id: 'x', available: false, reason: 'R' }), []);
  assert.ok(validateProbe({ id: 'x', available: true, version: '1', capabilities: {} }).length > 0);
  assert.ok(validateProbe(null).length > 0);
});
