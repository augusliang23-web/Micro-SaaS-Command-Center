// Runtime bootstrap regression tests for server.ts (configurable PORT, loopback-only bind, coherent default origin,
// CJS-build startup). Every child process is started by this file, runs in a throw-away temp directory (so cwd-anchored
// data, tasks and .env lookups never touch real project data), receives a minimal environment (no inherited secrets),
// and is the only process this file ever signals. Ports are never taken from the fixed 3000/3100/3200 set: either a
// bind guard intercepts listen() (nothing is bound) or a free ephemeral port is chosen at run time.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_SRC = fs.readFileSync(path.join(REPO, 'server.ts'), 'utf8');
let work;
let bundle;
let guard;
const children = new Set();

// The guard replaces net.Server#listen: it reports the exact arguments and exits, so nothing is ever bound.
const GUARD = `const net=require('net');net.Server.prototype.listen=function(){const a=[].slice.call(arguments).filter(x=>typeof x!=='function');process.stdout.write('LISTEN:'+JSON.stringify(a)+'\\n');process.exit(0);};`;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bootstrap-'));
  bundle = path.join(work, 'server.cjs');
  guard = path.join(work, 'guard.cjs');
  fs.writeFileSync(guard, GUARD);
  execFileSync(
    path.join(REPO, 'node_modules', '.bin', 'esbuild'),
    ['server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${bundle}`, '--log-level=error'],
    { cwd: REPO, stdio: 'pipe' },
  );
});
after(() => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(work, { recursive: true, force: true });
});

function baseEnv(extra = {}) {
  // Minimal, explicit environment: NODE_PATH lets the bundle find the repo's installed packages.
  return { PATH: process.env.PATH, NODE_PATH: path.join(REPO, 'node_modules'), NODE_ENV: 'production', TMPDIR: work, ...extra };
}
function run(extraEnv, { useGuard }) {
  return new Promise((resolve) => {
    const args = [...(useGuard ? ['--require', guard] : []), bundle];
    const child = spawn(process.execPath, args, { cwd: work, env: baseEnv(extraEnv), stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => { children.delete(child); resolve({ code, stdout, stderr }); });
  });
}
const listenArgs = (result) => {
  const line = result.stdout.split('\n').find((l) => l.startsWith('LISTEN:'));
  return line ? JSON.parse(line.slice('LISTEN:'.length)) : null;
};
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
async function startReal(extraEnv) {
  const port = await freePort();
  const child = spawn(process.execPath, [bundle], { cwd: work, env: baseEnv({ PORT: String(port), ...extraEnv }), stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', () => { children.delete(child); resolve(); }); child.kill('SIGTERM'); });
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}): ${err.slice(0, 400)}`);
    if (/running at/.test(out)) break; // the server's own readiness line, not a sleep
    if (Date.now() > deadline) { await stop(); throw new Error('server did not report readiness'); }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { port, stop, out: () => out };
}
const get = (port, pathname, headers = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, { headers });

test('1. the default port stays 3000 on 127.0.0.1 when PORT is not provided (listen intercepted, nothing bound)', async () => {
  const result = await run({}, { useGuard: true });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(listenArgs(result), [3000, '127.0.0.1']);
});

test('2. a valid PORT override is honoured and the host stays 127.0.0.1', async () => {
  for (const value of ['3901', '1', '65535']) {
    const result = await run({ PORT: value }, { useGuard: true });
    assert.equal(result.code, 0, `${value}: ${result.stderr}`);
    assert.deepEqual(listenArgs(result), [Number(value), '127.0.0.1'], value);
  }
});

test('3-6. invalid explicit PORT values fail closed: non-zero exit, no listen, never a silent 3000', async () => {
  for (const value of ['0', '-1', '65536', '99999', 'abc', '3901.5', '', ' 3901', '3901 ', '0x10', '1e3', '+3901', '03901', '3901abc', '١٢٣']) {
    const result = await run({ PORT: value }, { useGuard: true });
    assert.notEqual(result.code, 0, `PORT=${JSON.stringify(value)} must be rejected`);
    assert.equal(listenArgs(result), null, `PORT=${JSON.stringify(value)} must not reach listen()`);
    assert.match(result.stderr, /PORT/, `PORT=${JSON.stringify(value)} should say why`);
  }
});

test('7. a real start binds loopback only: reachable on 127.0.0.1, refused on every non-loopback IPv4 address', async () => {
  const server = await startReal({});
  try {
    assert.equal((await get(server.port, '/api/health')).status, 200);
    const external = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const address of external) {
      const refused = await new Promise((resolve) => {
        const socket = net.connect({ host: address, port: server.port, timeout: 1500 });
        socket.once('connect', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => resolve(true));
        socket.once('timeout', () => { socket.destroy(); resolve(true); });
      });
      assert.ok(refused, `${address}:${server.port} must not accept connections`);
    }
  } finally {
    await server.stop();
  }
});

test('8/10. the CJS bundle starts (no import.meta.url failure) and answers GET /api/health on the selected loopback port', async () => {
  const server = await startReal({});
  try {
    const res = await get(server.port, '/api/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  } finally {
    await server.stop();
  }
});

// Origin behaviour is tested without any protected route: the exact default-origin expression is taken from server.ts
// and evaluated with different HOST/PORT/env values, then fed to the pure origin decision functions the routers use.
function defaultOrigin(env, port) {
  const match = SERVER_SRC.match(/const EXPECTED_COMMAND_CENTER_ORIGIN = ([^;]+);/);
  assert.ok(match, 'EXPECTED_COMMAND_CENTER_ORIGIN declaration not found');
  return new Function('process', 'HOST', 'PORT', `return ${match[1]};`)({ env }, '127.0.0.1', port);
}

test('8. the default expected origin follows the selected PORT and never widens', async () => {
  const { evaluateTaskRequest } = await import('../server/tasks/taskRoutes.mjs');
  const { isLoopbackOrigin } = await import('../server/codexHandoffRoutes.mjs');
  for (const port of [3000, 3901, 65535]) {
    const expected = defaultOrigin({}, port);
    assert.equal(expected, `http://127.0.0.1:${port}`);
    assert.ok(isLoopbackOrigin(expected));
    const decide = (origin) => evaluateTaskRequest({ origin, expectedOrigin: expected, method: 'GET', contentType: '' });
    assert.equal(decide(expected).ok, true);
    assert.equal(decide(null).ok, true); // headerless local callers remain supported
    for (const other of [`http://127.0.0.1:${port === 3000 ? 3001 : 3000}`, `http://localhost:${port}`, 'http://evil.example', 'null']) {
      assert.equal(decide(other).ok, false, `${other} must be refused for ${expected}`);
    }
  }
});

test('9. an explicit COMMAND_CENTER_ORIGIN keeps its contract: PORT does not add a trusted origin, non-loopback stays refused', async () => {
  const { evaluateTaskRequest } = await import('../server/tasks/taskRoutes.mjs');
  const explicit = defaultOrigin({ COMMAND_CENTER_ORIGIN: 'http://127.0.0.1:4555' }, 3901);
  assert.equal(explicit, 'http://127.0.0.1:4555');
  const decide = (origin, expectedOrigin) => evaluateTaskRequest({ origin, expectedOrigin, method: 'GET', contentType: '' });
  assert.equal(decide('http://127.0.0.1:4555', explicit).ok, true);
  assert.equal(decide('http://127.0.0.1:3901', explicit).ok, false);
  const remote = defaultOrigin({ COMMAND_CENTER_ORIGIN: 'http://example.com:3000' }, 3901);
  assert.equal(decide(null, remote).ok, false); // a non-loopback expected origin fails closed
  assert.equal(decide('http://example.com:3000', remote).ok, false);
});

test('11. startup changes did not alter the registered API route definitions', () => {
  const routes = [...SERVER_SRC.matchAll(/^\s*app\.(get|post|put|patch|delete|use)\(\s*('[^']*')/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(routes, [
    "use '/api/bridge/codex-handoffs'", "use '/api/state'", "use '/api/tasks'", "use '/api/github'", "use '/api/local-git'",
    "get '/api/health'", "post '/api/bridge/chatgpt-advice'", "post '/api/bridge/extract-features'", "post '/api/bridge/summarize-changes'", "get '*'",
  ]);
});

test('source contract: HOST is the literal loopback address, no import.meta, no second port setting', () => {
  assert.match(SERVER_SRC, /const HOST = '127\.0\.0\.1';/);
  assert.doesNotMatch(SERVER_SRC, /import\.meta/);
  assert.doesNotMatch(SERVER_SRC, /0\.0\.0\.0/);
  assert.equal([...SERVER_SRC.matchAll(/process\.env\.PORT/g)].length, 1);
  assert.equal([...SERVER_SRC.matchAll(/\.listen\(/g)].length, 1);
});
