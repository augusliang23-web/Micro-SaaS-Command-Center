// V1 backend capability boundary tests. Every server here is a DISPOSABLE child process of the built bundle, started in a
// throw-away cwd with SYNTHETIC fixtures (state, active task, registry, Codex allowlist, fake provider keys in env and .env).
// A preload spy (spyMain, below) answers `gh` with a FAKE GitHub CLI and records-and-refuses every other child process,
// every outbound network call and every filesystem read/write under the cwd, so each test can state what a server did NOT do.
// Nothing here touches real data, real credentials, real providers or real agents, and only processes started here are stopped.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDraftTask, validateDevelopmentTask } from '../server/tasks/types.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PM = 'augusliang23-web/pm-dashboard';
const TASK_ID = 'CC-20260101-aaaaaaaa';
const FAKE_KEYS = { OPENAI_API_KEY: 'sk-FAKE-not-a-real-key', GEMINI_API_KEY: 'FAKE-gemini-key' };

// Runs inside the child (CommonJS, via --require). Serialised with Function#toString: nothing in it runs in the test process.
function spyMain() {
  'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const http = require('node:http');
const https = require('node:https');

const LOG = process.env.SPY_LOG;
const realAppend = fs.appendFileSync.bind(fs);
const record = (entry) => { if (LOG) realAppend(LOG, JSON.stringify(entry) + '\n'); };

// ---- fake GitHub CLI (synthetic) ----
const REPO = 'augusliang23-web/pm-dashboard';
const out = (body, status = 200) => `HTTP/2.0 ${status} OK\r\n\r\n${JSON.stringify(body)}`;
const day = '2026-10-01T00:00:00Z';
const commit = (sha, parents) => ({ sha, parents: parents.map((p) => ({ sha: p })), html_url: `https://github.com/${REPO}/commit/${sha}`, commit: { message: `SYNTHETIC ${sha}`, author: { date: day, name: 'a' }, committer: { date: day } } });
const pull7 = { number: 7, title: 'SYNTHETIC PR', state: 'open', draft: false, created_at: day, updated_at: day, closed_at: null, merged_at: null, html_url: `https://github.com/${REPO}/pull/7`, user: { login: 'synthetic' }, base: { ref: 'main', sha: 'm1', repo: { full_name: REPO } }, head: { ref: 'feat/x', sha: 'h7', repo: { full_name: REPO } }, merge_commit_sha: null };
const routes = [
  [/^repos\/[^/]+\/[^/?]+$/, () => out({ default_branch: 'main', html_url: `https://github.com/${REPO}` })],
  [/\/branches\?/, () => out([{ name: 'main', commit: { sha: 'm1' }, protected: true }, { name: 'feat/x', commit: { sha: 'h7' }, protected: false }])],
  [/\/pulls\?state=all/, () => out([pull7])],
  [/\/commits\?sha=/, () => out([commit('m1', [])])],
  [/\/compare\//, () => out({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, merge_base_commit: { sha: 'm1' }, commits: [commit('h7', ['m1'])] })],
  [/\/pulls\/7\/reviews/, () => out([])],
  [/\/pulls\/7$/, () => out({ ...pull7, changed_files: 1, additions: 1, deletions: 0, commits: 1 })],
  [/\/commits\/h7\/check-runs/, () => out({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] })],
];
function fakeGh(args, cb) {
  const apiPath = args[args.length - 1];
  for (const [pattern, handler] of routes) if (pattern.test(apiPath)) { setImmediate(() => cb(null, handler(), '')); return; }
  setImmediate(() => cb(Object.assign(new Error('unrouted'), { code: 1 }), out({ message: 'Not Found' }, 404), 'gh: Not Found (HTTP 404)'));
}

// ---- child processes ----
const refuse = (kind, cmd, args) => { record({ kind: 'spawn', via: kind, cmd, args: Array.isArray(args) ? args.slice(0, 8) : [] }); const e = new Error(`SPY: ${kind} ${cmd} refused`); e.code = 'SPY_REFUSED'; return e; };
const origExecFile = cp.execFile;
cp.execFile = function (cmd, args, opts, cb) {
  if (typeof args === 'function') { cb = args; args = []; opts = {}; } else if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (cmd === 'gh' && process.env.SPY_FAKE_GH === '1' && Array.isArray(args) && args[0] === 'api' && args.includes('GET')) {
    record({ kind: 'gh', method: 'GET', path: args[args.length - 1] });
    fakeGh(args, cb);
    return { kill() {}, on() {} };
  }
  const err = refuse('execFile', cmd, args);
  if (cb) setImmediate(() => cb(err, '', String(err.message)));
  return { kill() {}, on() {} };
};
for (const name of ['exec', 'fork']) cp[name] = function (cmd, args) { throw refuse(name, cmd, args); };
// The ONLY process allowed through: Vite's own esbuild service (it transforms TypeScript in development). Matched by the exact
// installed-binary path shape AND the service argument, and recorded as a separate `tool` event, never as a refused `spawn`.
const realSpawn = cp.spawn;
const ESBUILD_BINARY = /[\\/]node_modules[\\/]@esbuild[\\/][a-z0-9-]+[\\/]bin[\\/]esbuild$/;
cp.spawn = function (cmd, args, ...rest) {
  if (typeof cmd === 'string' && ESBUILD_BINARY.test(cmd) && Array.isArray(args) && typeof args[0] === 'string' && /^--service=/.test(args[0])) {
    record({ kind: 'tool', tool: 'esbuild-service' });
    return realSpawn.call(this, cmd, args, ...rest);
  }
  throw refuse('spawn', cmd, args);
};
for (const name of ['execFileSync', 'execSync', 'spawnSync']) cp[name] = function (cmd, args) { throw refuse(name, cmd, args); };
void origExecFile;

// ---- outbound network ----
globalThis.fetch = async function (input) { record({ kind: 'network', via: 'fetch', url: String(input && input.url ? input.url : input).slice(0, 120) }); throw new Error('SPY: outbound fetch refused'); };
for (const [label, mod] of [['http', http], ['https', https]]) {
  const real = mod.request;
  mod.request = function (...a) {
    const target = typeof a[0] === 'string' ? a[0] : (a[0] && (a[0].hostname || a[0].host)) || '';
    if (/^(127\.0\.0\.1|localhost|::1)(:|$)/.test(String(target).replace(/^https?:\/\//, ''))) return real.apply(this, a);
    record({ kind: 'network', via: `${label}.request`, target: String(target).slice(0, 120) });
    throw new Error('SPY: outbound request refused');
  };
}

// ---- filesystem under cwd ----
const CWD = process.cwd();
const rel = (p) => { try { const abs = path.resolve(String(p)); return abs.startsWith(CWD + path.sep) || abs === CWD ? path.relative(CWD, abs) || '.' : null; } catch { return null; } };
const wrap = (name, kind) => {
  const real = fs[name];
  fs[name] = function (...a) { const r = typeof a[0] === 'string' || Buffer.isBuffer(a[0]) ? rel(a[0]) : null; if (r !== null && !(name === 'appendFileSync' && path.resolve(String(a[0])) === path.resolve(LOG || ''))) record({ kind: 'fs', op: name, access: kind, path: r }); return real.apply(this, a); };
};
for (const n of ['readFileSync', 'readdirSync', 'existsSync', 'statSync', 'lstatSync', 'accessSync']) wrap(n, 'read');
for (const n of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'rmSync', 'unlinkSync', 'copyFileSync', 'rmdirSync']) wrap(n, 'write');
const realOpen = fs.openSync;
fs.openSync = function (p, flags, ...rest) { const r = typeof p === 'string' ? rel(p) : null; if (r !== null) record({ kind: 'fs', op: 'openSync', access: /[wa+]/.test(String(flags ?? 'r')) ? 'write' : 'read', path: r }); return realOpen.call(this, p, flags, ...rest); };

// ---- what the child actually received, and every socket it tries to bind ----
// `hasNodeEnv:false` is the genuine "NODE_ENV absent" evidence (the key is not in the child's process.env at all).
record({ kind: 'env', hasNodeEnv: Object.prototype.hasOwnProperty.call(process.env, 'NODE_ENV'), nodeEnv: Object.prototype.hasOwnProperty.call(process.env, 'NODE_ENV') ? process.env.NODE_ENV : null });
const net = require('node:net');
const realListen = net.Server.prototype.listen;
// Every bind attempt is recorded. A bind that does not name an explicit loopback host (no host = all interfaces, 0.0.0.0, ::) is
// REFUSED here (never performed), so no test can ever open an exposed listener on the machine running the suite.
net.Server.prototype.listen = function (...a) {
  const args = a.filter((x) => typeof x !== 'function');
  const first = args[0];
  const host = first !== null && typeof first === 'object' ? first.host : args.find((x, i) => i > 0 && typeof x === 'string');
  const isPath = typeof first === 'string' && /^[^\d]/.test(first) && args.length === 1;
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  record({ kind: 'listen', args, refused: !loopback && !isPath });
  if (!loopback && !isPath) return this;
  return realListen.apply(this, a);
};
}
const SPY_SOURCE = `(${spyMain.toString()})();`;

// ---------------------------------------------------------------- harness
let work;
let bundle;
let spyFile;
const children = new Set();

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v1-boundary-'));
  bundle = path.join(work, 'server.cjs');
  spyFile = path.join(work, 'spy.cjs');
  fs.writeFileSync(spyFile, SPY_SOURCE);
  execFileSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'esbuild'), ['server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${bundle}`, '--log-level=error'], { cwd: REPO_ROOT, stdio: 'pipe' });
});
after(() => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(work, { recursive: true, force: true });
});

// V1.2C (Issue #91): GitHub history authority is derived from VALIDATED saved state, so the synthetic PM record is a complete
// saved project (still the unique legacy PM Dashboard record: no dataMode, no management). Everything else is unchanged.
const syntheticState = () => ({
  projects: [{
    id: 'reg-pm', name: 'SYNTHETIC PM', repository: PM, tagline: 's', stage: 'Beta', health: 'Healthy', workflowType: 'standard', currentTask: 't',
    currentGate: 'IMPLEMENT', currentGateLabel: 'I', testOutcome: 'PASS', reviewOutcome: 'PENDING', nextAction: 'n', blocker: null, waitingState: 'WAITING_FOR_HUMAN',
    model: 'Terra', reasoningEffort: 'Medium', routingReason: 'r', lastActivity: 'x', tags: [], gates: [], activityHistory: [],
    executionContext: { branch: 'main', model: 'Terra', reasoningEffort: 'Medium', risk: 'Low', routingReason: 'r', bridgeRunId: 'b' },
    environment: { production: { status: 'Live', lastDeployed: 'x' }, staging: { status: 'Healthy', lastRefreshed: 'x' } },
  }],
  attentionItems: [], nba: {}, snapshot: {},
});
const registryJson = () => ({ projects: [{ projectId: 'demo', repository: 'me/demo', localPath: '/srv/repos/demo', defaultBranch: 'main', worktreeRoot: '/srv/worktrees/demo', allowedAgents: ['codex'], allowedActions: ['READ_REPO'], verifyCommands: { test: { command: 'npm', args: ['test'] } }, protectedPaths: [], agentBinaries: {} }] });
function activeTaskJson() {
  const task = createDraftTask({
    taskId: TASK_ID, now: '2026-01-01T00:00:00.000Z',
    input: { workstream: 'x', title: 'SYNTHETIC active task', goal: 'g', agent: 'codex', executionProfile: 'STANDARD', risk: 'LOW', requestedActions: ['READ_REPO'] },
    project: { projectId: 'demo', defaultBranch: 'main' },
  });
  const active = { ...task, status: 'RUNNING', startedAt: '2026-01-01T00:01:00.000Z', baseSha: 'a'.repeat(40) };
  assert.deepEqual(validateDevelopmentTask(active), [], 'the fixture task must be a valid active task');
  return JSON.stringify(active, null, 2);
}

/** Builds a disposable cwd. `fixtures` selects which synthetic files exist. */
function makeCwd({ state = false, malformedState = false, activeTask = false, registry = true, allowlist = true, dotenv = true, dist = true } = {}) {
  const cwd = fs.mkdtempSync(path.join(work, 'cwd-'));
  if (dist) { fs.mkdirSync(path.join(cwd, 'dist')); fs.writeFileSync(path.join(cwd, 'dist', 'index.html'), '<!doctype html><title>SYNTHETIC V1 SPA</title><div id="root"></div>'); }
  if (state || malformedState) { fs.mkdirSync(path.join(cwd, 'data')); fs.writeFileSync(path.join(cwd, 'data', 'app-state.json'), malformedState ? '{ not json' : JSON.stringify(syntheticState())); }
  if (activeTask) { fs.mkdirSync(path.join(cwd, 'data', 'tasks'), { recursive: true }); fs.writeFileSync(path.join(cwd, 'data', 'tasks', `${TASK_ID}.json`), activeTaskJson()); }
  if (registry) fs.writeFileSync(path.join(cwd, 'projects.local.json'), JSON.stringify(registryJson()));
  if (allowlist) { fs.mkdirSync(path.join(cwd, '.bridge')); fs.writeFileSync(path.join(cwd, '.bridge', 'codex-projects.local.json'), JSON.stringify({ projects: [{ projectId: 'demo', cwd: '/srv/repos/demo' }] })); }
  if (dotenv) fs.writeFileSync(path.join(cwd, '.env'), Object.entries(FAKE_KEYS).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  return cwd;
}
const snapshotTree = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.vite') continue; /* development tool cache, not data */
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) out[path.relative(dir, p)] = `link:${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p).toString('hex');
    }
  };
  walk(dir);
  return out;
};
function freePort() {
  return new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}

// The two protected provider routes (AGENTS.md / CLAUDE.md) must never receive a request from any test, not even a refused one.
// This tripwire is a pure predicate used by the harness: a request whose path (decoded, any case) names them is rejected BEFORE a
// socket is opened. Tests verify these routes statically (section J) and never name them as a request target.
const PROTECTED_ROUTE = /\/api\/bridge\/(chatgpt-advice|extract-features)/i;
function isProtectedRoutePath(target) {
  let decoded = String(target);
  for (let i = 0; i < 3; i += 1) { try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; } }
  return PROTECTED_ROUTE.test(String(target)) || PROTECTED_ROUTE.test(decoded);
}
function refuseProtectedRoute(target) {
  if (isProtectedRoutePath(target)) throw new Error('PROTECTED_ROUTE_REQUEST_REFUSED: tests must not send requests to the protected provider routes');
}

// R4: `nodeEnv` is decided by KEY PRESENCE. `startServer({ nodeEnv: undefined })` means NODE_ENV is genuinely absent from the child's
// environment (a default parameter would silently turn `undefined` into 'production'); omitting the key means 'production'.
/** Starts the bundle in `cwd`; resolves once it reports readiness, or reports an early exit. */
async function startServer(options = {}) {
  const { cwd, env = {}, port } = options;
  const nodeEnv = 'nodeEnv' in options ? options.nodeEnv : 'production';
  const p = port ?? await freePort();
  const logFile = path.join(cwd, '..', `spy-${path.basename(cwd)}.log`);
  fs.writeFileSync(logFile, '');
  const child = spawn(process.execPath, ['--require', spyFile, bundle], {
    cwd,
    env: { PATH: process.env.PATH, NODE_PATH: path.join(REPO_ROOT, 'node_modules'), PORT: String(p), SPY_LOG: logFile, SPY_FAKE_GH: '1', ...FAKE_KEYS, ...(nodeEnv !== undefined ? { NODE_ENV: nodeEnv } : {}), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => { children.delete(child); resolve(code); }));
  const server = {
    cwd, port: p, child, exited, stdout: () => stdout, stderr: () => stderr,
    spy: () => fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); }),
    request: (method, pathname, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
      refuseProtectedRoute(pathname);
      const req = http.request({ host: '127.0.0.1', port: p, method, path: pathname, agent: false, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    }),
    /** Sends exactly `text` on a raw loopback socket (WebSocket upgrade probes, absolute-form targets) and resolves with the bytes received. */
    raw: (text) => new Promise((resolve) => {
      refuseProtectedRoute(text);
      const s = net.connect(p, '127.0.0.1', () => s.write(text));
      let d = '';
      const done = () => resolve(d);
      s.setTimeout(3000, () => s.destroy());
      s.on('data', (c) => { d += c; });
      s.on('close', done);
      s.on('error', done);
    }),
  };

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) { server.earlyExit = child.exitCode; return server; }
    if (/running at/.test(stdout)) return server;
    if (Date.now() > deadline) { await server.stop(); throw new Error(`server not ready: ${stderr.slice(0, 300)}`); }
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function withServer(options, fn) {
  const server = await startServer(options);
  try { return await fn(server); } finally { await server.stop(); }
}
const writesIn = (spy) => spy.filter((e) => e.kind === 'fs' && e.access === 'write');
// The Vite dev server keeps its own pre-bundling cache (never business data) under .vite or node_modules/.vite; it is the only write allowed in development.
const DEV_TOOL_CACHE = /^(node_modules\/)?\.vite(\/|$)/;
const businessWritesIn = (spy) => writesIn(spy).filter((e) => !DEV_TOOL_CACHE.test(e.path));
const readsOf = (spy, re) => spy.filter((e) => e.kind === 'fs' && e.access === 'read' && re.test(e.path));
const processesIn = (spy) => spy.filter((e) => e.kind === 'spawn');
const networkIn = (spy) => spy.filter((e) => e.kind === 'network');
const ghIn = (spy) => spy.filter((e) => e.kind === 'gh');
const SENSITIVE_READ = /(^|\/)(\.env|projects\.local\.json|codex-projects\.local\.json)$|data\/tasks/;

// ---------------------------------------------------------------- A. startup isolation
describe('A. V1 startup does not touch business data or secrets', () => {
  test('an active persisted task stays byte-for-byte identical and nothing is written, even with a valid registry, allowlist and fake keys', async () => {
    const cwd = makeCwd({ state: true, activeTask: true });
    const before = snapshotTree(cwd);
    await withServer({ cwd }, async (server) => {
      assert.equal(server.earlyExit, undefined, server.stderr());
      assert.equal((await server.request('GET', '/api/health')).status, 200);
      assert.deepEqual(writesIn(server.spy()), [], 'a V1 start performs no filesystem write under its cwd');
      assert.deepEqual(readsOf(server.spy(), SENSITIVE_READ), [], 'V1 does not read .env, the project registry, the Codex allowlist or the task directory');
    });
    assert.deepEqual(snapshotTree(cwd), before, 'every file under cwd is byte-for-byte identical after start and stop');
  });

  test('a missing task directory (and a missing data directory) stays absent', async () => {
    const cwd = makeCwd({});
    await withServer({ cwd }, async (server) => { assert.equal(server.earlyExit, undefined, server.stderr()); assert.equal((await server.request('GET', '/api/health')).status, 200); });
    assert.equal(fs.existsSync(path.join(cwd, 'data')), false);
  });

  test('a failed startup (invalid PORT, unknown capability configuration) mutates nothing and never listens', async () => {
    for (const env of [{ PORT: 'abc' }, { COMMAND_CENTER_LEGACY_CAPABILITIES: 'definitely-not-a-capability' }, { COMMAND_CENTER_LEGACY_CAPABILITIES: 'tasks,Tasks' }, { COMMAND_CENTER_LEGACY_CAPABILITIES: 'state-write,,tasks' }]) {
      const cwd = makeCwd({ activeTask: true });
      const before = snapshotTree(cwd);
      const server = await startServer({ cwd, env });
      assert.notEqual(server.earlyExit, undefined, `${JSON.stringify(env)} must refuse to start`);
      assert.notEqual(server.earlyExit, 0);
      assert.match(server.stderr(), /PORT|CAPABILIT/i);
      assert.deepEqual(writesIn(server.spy()), []);
      assert.deepEqual(snapshotTree(cwd), before);
    }
  });
});

// ---------------------------------------------------------------- B. API boundary
const ALL_WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
describe('B. the V1 API surface is exactly four GET routes', () => {
  test('route x method matrix; forbidden handlers never run (no process, no network, no write, no task file, state untouched)', async () => {
    const cwd = makeCwd({ state: true, activeTask: true });
    const before = snapshotTree(cwd);
    await withServer({ cwd }, async (server) => {
      const hist = `/api/github/development-history?repo=${encodeURIComponent(PM)}`;
      const pull = `/api/github/development-history/pull?repo=${encodeURIComponent(PM)}&number=7`;
      // V1 routes: GET works, every other method is refused with 405 + Allow: GET
      for (const route of ['/api/health', '/api/state', hist, pull]) {
        assert.equal((await server.request('GET', route)).status, 200, `GET ${route}`);
        for (const method of ['HEAD', 'OPTIONS', ...ALL_WRITE_METHODS]) {
          const res = await server.request(method, route, { body: ALL_WRITE_METHODS.includes(method) ? { x: 1 } : undefined });
          assert.equal(res.status, 405, `${method} ${route}`);
          assert.equal(res.headers.allow, 'GET', `${method} ${route} advertises only GET`);
        }
      }
      // legacy routes: not mounted. Reads are 404 (API JSON), everything else is refused by the method policy.
      // The two protected provider routes are deliberately absent from this list: they are verified STATICALLY (see section J)
      // and the harness refuses to send any request to them. Unrelated synthetic paths below exercise the generic method policy.
      const legacy = ['/api/tasks', `/api/tasks/${TASK_ID}`, '/api/bridge/codex-handoffs', '/api/bridge/summarize-changes', '/api/bridge/synthetic-unmounted-post-route',
        '/api/local-git/status?path=/tmp', '/api/local-git/find?repo=me/demo', '/api/github/repos', '/api/github/pull-status?repo=me/demo&number=1', '/api/github/changed-files?repo=me/demo&number=1', '/api/github/recent-commits?repo=me/demo', '/api/unknown', '/api/', '/api'];
      for (const route of legacy) {
        const get = await server.request('GET', route);
        assert.equal(get.status, 404, `GET ${route}`);
        assert.ok(get.json && typeof get.json.error === 'string', `GET ${route} answers API JSON, not SPA HTML`);
        assert.match(String(get.headers['content-type']), /application\/json/);
        for (const method of ['HEAD', 'OPTIONS', ...ALL_WRITE_METHODS]) assert.equal((await server.request(method, route, { body: ALL_WRITE_METHODS.includes(method) ? { x: 1 } : undefined })).status, 405, `${method} ${route}`);
      }
      // static: GET and HEAD only, with SPA fallback outside /api
      assert.match((await server.request('GET', '/')).text, /SYNTHETIC V1 SPA/);
      assert.match((await server.request('GET', '/some/client/route')).text, /SYNTHETIC V1 SPA/);
      assert.equal((await server.request('HEAD', '/')).status, 200);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal((await server.request(method, '/', { body: method === 'OPTIONS' ? undefined : { x: 1 } })).status, 405, `${method} /`);
      // nothing forbidden ran
      const spy = server.spy();
      assert.deepEqual(processesIn(spy), [], 'no git, no agent, no other child process');
      assert.deepEqual(networkIn(spy), [], 'no provider or other outbound network call');
      assert.deepEqual(writesIn(spy), [], 'no filesystem write');
      assert.deepEqual(ghIn(spy).filter((g) => !g.path.startsWith(`repos/${PM}`)), [], 'the fake GitHub CLI was only asked about the allowlisted repository');
    });
    assert.deepEqual(snapshotTree(cwd), before, 'saved state and the active task are untouched after the whole matrix');
  });

  test('the allowlist still applies to the history routes (GET only)', async () => {
    // V1.2C: with NO saved state nothing is authorized, not even the legacy PM Dashboard (no fallback), and no gh call is made.
    await withServer({ cwd: makeCwd({}) }, async (server) => {
      assert.equal((await server.request('GET', `/api/github/development-history?repo=${encodeURIComponent(PM)}`)).status, 403);
      assert.equal((await server.request('GET', `/api/github/development-history/pull?repo=${encodeURIComponent(PM)}&number=7`)).status, 403);
      assert.deepEqual(ghIn(server.spy()), [], 'no saved state: no GitHub read');
    });
    await withServer({ cwd: makeCwd({ state: true }) }, async (server) => {
      assert.equal((await server.request('GET', '/api/github/development-history?repo=someone%2Felse')).status, 403);
      assert.equal((await server.request('GET', '/api/github/development-history')).status, 403);
      assert.equal((await server.request('GET', `/api/github/development-history/pull?repo=${encodeURIComponent(PM)}&number=abc`)).status, 400);
      assert.equal((await server.request('GET', '/api/github/development-history/pull?repo=someone%2Felse&number=7')).status, 403);
      assert.deepEqual(ghIn(server.spy()), [], 'refused requests never reach GitHub');
    });
  });
});

// ---------------------------------------------------------------- C/D/E. provider, agent, local git
describe('C/D/E. provider, agent and local Git capabilities are unreachable in V1', () => {
  for (const nodeEnv of ['production', 'development', undefined]) {
    test(`NODE_ENV=${nodeEnv ?? '(unset)'}: fake keys, a valid registry and a valid Codex allowlist still yield zero provider calls, zero agent dispatch and zero Git`, async () => {
      const cwd = makeCwd({ state: true, activeTask: true });
      const before = snapshotTree(cwd);
      await withServer({ cwd, nodeEnv }, async (server) => {
        assert.equal(server.earlyExit, undefined, server.stderr());
        for (const route of ['/api/bridge/summarize-changes', '/api/bridge/codex-handoffs', '/api/tasks']) {
          assert.equal((await server.request('POST', route, { body: { repo: 'me/demo', project: { name: 'x' }, userQuery: 'q' } })).status, 405, route);
        }
        assert.equal((await server.request('GET', '/api/local-git/status?path=%2Ftmp')).status, 404);
        assert.equal((await server.request('GET', '/api/health')).status, 200);
        const spy = server.spy();
        assert.deepEqual(networkIn(spy), [], 'provider invocation count is zero');
        assert.deepEqual(processesIn(spy), [], 'agent dispatch and git execution counts are zero');
        assert.deepEqual(readsOf(spy, SENSITIVE_READ), [], 'neither .env, the registry nor the allowlist is read');
        assert.deepEqual(businessWritesIn(spy), [], 'only the development tool cache may be written, and only in development');
        if (nodeEnv === 'production') assert.deepEqual(writesIn(spy), []);
        const health = (await server.request('GET', '/api/health')).json;
        assert.equal(health.status, 'ok');
        assert.equal('hasGeminiKey' in health || 'hasOpenAIKey' in health, false, 'V1 health does not even reveal whether provider keys exist');
      });
      assert.deepEqual(snapshotTree(cwd), before);
    });
  }
});

// ---------------------------------------------------------------- F. Origin / Host policy
describe('F. Host / Origin / Referer policy on the V1 API', () => {
  test('exact expected origin passes; foreign host, wrong origin, other loopback port, null and malformed values are refused', async () => {
    await withServer({ cwd: makeCwd({ state: true }) }, async (server) => {
      const own = `http://127.0.0.1:${server.port}`;
      const get = (headers) => server.request('GET', '/api/state', { headers });
      assert.equal((await get({})).status, 200, 'no Origin and no Referer: a local non-browser caller (documented, NOT authentication)');
      assert.equal((await get({ Origin: own })).status, 200);
      assert.equal((await get({ Referer: `${own}/map?x=1` })).status, 200);
      for (const bad of [{ Origin: 'http://evil.example' }, { Origin: `http://127.0.0.1:${server.port === 3999 ? 3998 : 3999}` }, { Origin: `http://localhost:${server.port}` }, { Origin: 'null' }, { Origin: 'not a url' }, { Origin: '' },
        { Referer: 'http://evil.example/page' }, { Referer: 'http://127.0.0.1:1/x' }, { Referer: '::::' }, { Referer: 'javascript:alert(1)' }, { Referer: 'null' }, { Origin: own, Referer: 'http://evil.example/' }]) {
        const res = await get(bad);
        assert.equal(res.status, 403, JSON.stringify(bad));
        assert.deepEqual(Object.keys(res.json ?? {}), ['error']);
      }
      for (const host of ['evil.example', `evil.example:${server.port}`, `localhost:${server.port}`, '127.0.0.1', `127.0.0.1:${server.port + 1}`, `127.0.0.1.evil.example:${server.port}`]) {
        const res = await get({ Host: host });
        assert.equal(res.status, 403, `Host: ${JSON.stringify(host)}`);
      }
      assert.equal((await get({ Host: `127.0.0.1:${server.port}` })).status, 200);
      // HTTP/1.0 without any Host header (the HTTP client cannot send this): refused by the policy, not served
      const raw = await new Promise((resolve) => { const s = net.connect(server.port, '127.0.0.1', () => s.write('GET /api/health HTTP/1.0\r\n\r\n')); let d = ''; s.on('data', (c) => { d += c; }); s.on('close', () => resolve(d)); s.on('error', () => resolve(d)); });
      assert.match(raw, /^HTTP\/1\.1 403/, 'a request without a Host header is refused');
    });
  });

  test('the same policy guards the history routes and the static app host check; policy refusals never reach GitHub', async () => {
    await withServer({ cwd: makeCwd({}) }, async (server) => {
      const hist = `/api/github/development-history?repo=${encodeURIComponent(PM)}`;
      assert.equal((await server.request('GET', hist, { headers: { Origin: 'http://evil.example' } })).status, 403);
      assert.equal((await server.request('GET', hist, { headers: { Host: 'evil.example' } })).status, 403);
      assert.equal((await server.request('GET', '/', { headers: { Host: 'evil.example' } })).status, 403, 'DNS-rebinding style Host is refused for the app too');
      assert.deepEqual(ghIn(server.spy()), []);
    });
  });

  test('an explicit COMMAND_CENTER_ORIGIN moves the trusted origin and host together; a non-loopback value fails closed', async () => {
    const port = await freePort();
    await withServer({ cwd: makeCwd({ state: true }), port, env: { COMMAND_CENTER_ORIGIN: `http://127.0.0.1:${port}` } }, async (server) => {
      assert.equal((await server.request('GET', '/api/state', { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200);
      assert.equal((await server.request('GET', '/api/state', { headers: { Origin: 'http://127.0.0.1:4555' } })).status, 403);
    });
    const remote = await startServer({ cwd: makeCwd({}), env: { COMMAND_CENTER_ORIGIN: 'http://example.com:3000' } });
    try {
      if (remote.earlyExit === undefined) assert.equal((await remote.request('GET', '/api/health')).status, 403, 'a non-loopback expected origin serves nothing');
      else assert.notEqual(remote.earlyExit, 0);
    } finally { await remote.stop(); }
  });
});

// ---------------------------------------------------------------- G. positive controls
describe('G. positive controls: V1 still works', () => {
  test('saved state: valid -> 200 exact content; missing -> 404 "No saved state yet."; malformed -> 500 JSON, file never repaired', async () => {
    const good = makeCwd({ state: true });
    await withServer({ cwd: good }, async (server) => {
      const res = await server.request('GET', '/api/state');
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, syntheticState());
    });
    await withServer({ cwd: makeCwd({}) }, async (server) => {
      const res = await server.request('GET', '/api/state');
      assert.equal(res.status, 404);
      assert.equal(res.json.error, 'No saved state yet.');
    });
    const bad = makeCwd({ malformedState: true });
    const before = snapshotTree(bad);
    await withServer({ cwd: bad }, async (server) => {
      const res = await server.request('GET', '/api/state');
      assert.equal(res.status, 500);
      assert.equal(typeof res.json.error, 'string');
      assert.deepEqual(writesIn(server.spy()), []);
    });
    assert.deepEqual(snapshotTree(bad), before, 'a malformed saved state is reported, never repaired or overwritten');
  });

  test('allowlisted history and PR detail GET return real response shapes (from the FAKE GitHub CLI)', async () => {
    // V1.2C: authority comes from the validated saved state (the unique legacy PM record), so this positive control has state.
    await withServer({ cwd: makeCwd({ state: true }) }, async (server) => {
      const hist = await server.request('GET', `/api/github/development-history?repo=${encodeURIComponent(PM)}`);
      assert.equal(hist.status, 200);
      assert.equal(hist.json.repository, PM);
      assert.ok(Array.isArray(hist.json.pulls) && hist.json.pulls.length === 1 && hist.json.pulls[0].number === 7);
      assert.ok(hist.json.coverage && hist.json.fetchedAt);
      const pull = await server.request('GET', `/api/github/development-history/pull?repo=${encodeURIComponent(PM)}&number=7`);
      assert.equal(pull.status, 200);
      assert.equal(pull.json.number, 7);
      assert.equal(pull.json.ci.status, 'passing');
      assert.ok(ghIn(server.spy()).length >= 2 && ghIn(server.spy()).every((g) => g.method === 'GET'));
    });
  });

  test('the V1 frontend (static app) loads with SPA fallback; health is minimal', async () => {
    await withServer({ cwd: makeCwd({}) }, async (server) => {
      const root = await server.request('GET', '/');
      assert.equal(root.status, 200);
      assert.match(root.text, /SYNTHETIC V1 SPA/);
      assert.deepEqual(Object.keys((await server.request('GET', '/api/health')).json).sort(), ['status', 'timestamp']);
    });
  });
});

// ---------------------------------------------------------------- H. capability mode contract
describe('H. capability selection fails closed and legacy capabilities need explicit server-side opt-in', () => {
  test('NODE_ENV=development, NODE_ENV unset and a mistyped mode never enable legacy capabilities', async () => {
    for (const [nodeEnv, env] of [['development', {}], [undefined, {}], ['production', { COMMAND_CENTER_LEGACY: 'true' }], ['production', { COMMAND_CENTER_CAPABILITY_MODE: 'legacy' }]]) {
      await withServer({ cwd: makeCwd({ state: true }), nodeEnv, env }, async (server) => {
        assert.equal(server.earlyExit, undefined, server.stderr());
        assert.equal((await server.request('PUT', '/api/state', { body: syntheticState() })).status, 405);
        assert.equal((await server.request('GET', '/api/tasks')).status, 404);
      });
    }
  });

  test('each legacy capability is its own opt-in and only enables its own routes; state-write fails closed (V1.2)', async () => {
    // V1.2B (Issue #90 V1_2B_TEST_CONTRACT_AMENDMENT): the legacy whole-state writer bypasses the V1.2 project store's lock and
    // version check, so opting into it is a refusal to start. The refusal must be that specific conflict, not a generic crash,
    // and no writer may ever become reachable.
    for (const value of ['state-write', 'tasks,state-write']) {
      const cwd = makeCwd({ state: true, activeTask: true });
      const before = snapshotTree(cwd);
      const stateBefore = fs.readFileSync(path.join(cwd, 'data', 'app-state.json'));
      const server = await startServer({ cwd, env: { COMMAND_CENTER_LEGACY_CAPABILITIES: value } });
      assert.notEqual(server.earlyExit, undefined, `${value} must refuse to start`);
      assert.notEqual(server.earlyExit, 0);
      assert.match(server.stderr(), /Refusing to start \(capability configuration\): The legacy "state-write" capability cannot be enabled together with the V1\.2 project writer/, server.stderr());
      assert.doesNotMatch(server.stdout(), /running at/);
      assert.deepEqual(writesIn(server.spy()), []);
      assert.deepEqual(snapshotTree(cwd), before);
      assert.deepEqual(fs.readFileSync(path.join(cwd, 'data', 'app-state.json')), stateBefore);
    }
    const cases = [
      ['tasks', async (s) => { assert.equal((await s.request('GET', '/api/tasks')).status, 200); assert.equal((await s.request('PUT', '/api/state', { body: syntheticState() })).status, 405); }],
      ['local-git', async (s) => { assert.notEqual((await s.request('GET', '/api/local-git/status?path=%2Ftmp')).status, 404); assert.ok(processesIn(s.spy()).length > 0, 'git execution is attempted only when this capability is enabled'); assert.equal((await s.request('GET', '/api/tasks')).status, 404); }],
      ['github-legacy', async (s) => { assert.notEqual((await s.request('GET', '/api/github/repos')).status, 404); assert.equal((await s.request('PUT', '/api/state', { body: syntheticState() })).status, 405); }],
      ['providers', async (s) => { const res = await s.request('POST', '/api/bridge/summarize-changes', { body: { repo: 'me/demo', prNumber: 1 } }); assert.notEqual(res.status, 405); assert.notEqual(res.status, 404); assert.equal((await s.request('GET', '/api/tasks')).status, 404); }],
    ];
    for (const [capability, check] of cases) {
      await withServer({ cwd: makeCwd({ state: true, activeTask: true }), env: { COMMAND_CENTER_LEGACY_CAPABILITIES: capability } }, async (server) => {
        assert.equal(server.earlyExit, undefined, `${capability}: ${server.stderr()}`);
        assert.equal((await server.request('GET', '/api/health')).status, 200);
        await check(server);
      });
    }
  });

  test('the tasks capability is the only thing that constructs the TaskStore (active task recovery happens only on explicit opt-in)', async () => {
    const cwd = makeCwd({ activeTask: true });
    const file = path.join(cwd, 'data', 'tasks', `${TASK_ID}.json`);
    const before = fs.readFileSync(file, 'utf8');
    await withServer({ cwd }, async () => {});
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    await withServer({ cwd, env: { COMMAND_CENTER_LEGACY_CAPABILITIES: 'tasks' } }, async () => {});
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).status, 'UNKNOWN', 'explicit legacy opt-in keeps the legacy recovery behaviour');
  });

  test('the Codex handoff capability needs both its opt-in and NODE_ENV=development', async () => {
    await withServer({ cwd: makeCwd({}), nodeEnv: 'production', env: { COMMAND_CENTER_LEGACY_CAPABILITIES: 'codex-handoff' } }, async (server) => {
      assert.equal((await server.request('POST', '/api/bridge/codex-handoffs', { body: {} })).status, 405);
    });
  });
});

// ---------------------------------------------------------------- development / production equivalence
describe('production and development have the same V1 capability boundary', () => {
  test('source contract: one capability decision, made before any side-effecting service is constructed', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf8');
    const decision = src.indexOf('resolveCapabilities(');
    assert.ok(decision > 0, 'server.ts resolves capabilities through the policy module');
    for (const sideEffect of ['new TaskStore(', 'new CodexHandoffService(', 'loadProjectRegistry(', 'new GoogleGenAI(', "import 'dotenv/config'", 'createLocalGitRouter(']) {
      const at = src.indexOf(sideEffect);
      assert.ok(at === -1 || at > decision, `${sideEffect} must not run before the capability decision`);
    }
    assert.doesNotMatch(src, /^import 'dotenv\/config';/m, 'secrets are not loaded at module import');
  });
});

// =====================================================================================================================
// Issue #49 (R1-R4). Same rules as above: disposable child processes, synthetic fixtures, no provider, no agent, no real data,
// and NO request is ever sent to the two protected provider routes (the harness refuses them; section J checks them statically).
// =====================================================================================================================

// A synthetic frontend: a real Vite dev server needs an index.html and a module. Everything here is invented for the test.
const MARK = { registry: 'SYNTH-MARK-REGISTRY-7c1', task: 'SYNTH-MARK-TASK-7c1', state: 'SYNTH-MARK-STATE-7c1', business: 'SYNTH-MARK-BUSINESS-7c1', bridge: 'SYNTH-MARK-BRIDGE-7c1', env: 'SYNTH-MARK-ENV-7c1', noext: 'SYNTH-MARK-NOEXT-7c1', config: 'SYNTH-MARK-CONFIG-7c1', outside: 'SYNTH-MARK-OUTSIDE-7c1' };
const DEV_HTML_MARK = 'SYNTHETIC DEV FRONTEND';
const DEV_JS_MARK = 'SYNTHETIC-FRONTEND-MODULE';
const SECRET_FILES = [
  ['projects.local.json', MARK.registry], [`data/tasks/${TASK_ID}.json`, MARK.task], ['data/app-state.json', MARK.state],
  ['business/fixture-business.txt', MARK.business], ['business/fixture-business.json', MARK.business],
  ['.bridge/codex-projects.local.json', MARK.bridge], ['.env', MARK.env], ['NOTES', MARK.noext], ['server-config.ts', MARK.config],
];
function makeDevCwd() {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(work, 'devcwd-')));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
  put('index.html', `<!doctype html><title>${DEV_HTML_MARK}</title><div id="root"></div><script type="module" src="/src/main.js"></script>`);
  put('src/main.js', `console.log('${DEV_JS_MARK}');\nexport {};\n`);
  put('dist/index.html', '<!doctype html><title>SYNTHETIC V1 SPA</title><div id="root"></div>');
  put('projects.local.json', JSON.stringify({ marker: MARK.registry }));
  put(`data/tasks/${TASK_ID}.json`, JSON.stringify({ marker: MARK.task }));
  put('data/app-state.json', JSON.stringify({ projects: [{ id: 'reg-pm', name: MARK.state, repository: PM }], attentionItems: [], nba: {}, snapshot: {} }));
  put('business/fixture-business.txt', MARK.business);
  put('business/fixture-business.json', JSON.stringify({ marker: MARK.business }));
  put('.bridge/codex-projects.local.json', JSON.stringify({ marker: MARK.bridge }));
  put('.env', `GEMINI_API_KEY=${MARK.env}\n`);
  put('NOTES', MARK.noext);
  put('server-config.ts', `export const x = '${MARK.config}';`);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(work, 'outside-')));
  fs.writeFileSync(path.join(outside, 'secret.txt'), MARK.outside);
  return { cwd, outside };
}
const ALL_MARKERS = Object.values(MARK);
const ABSENT = undefined; // readability only: `nodeEnv: ABSENT` means the key is genuinely missing (see startServer)

// ---------------------------------------------------------------- I. R1 API path classification
describe('I. (R1) /api is classified exactly the way Express routes it: case-insensitively', () => {
  test('isApiPath accepts every spelling Express mounts under /api and nothing else', async () => {
    const { isApiPath } = await import('../server/v1RequestPolicy.mjs');
    assert.equal(typeof isApiPath, 'function', 'the policy exports the single API classifier');
    for (const p of ['/api', '/api/', '/api/state', '/API', '/API/', '/API/state', '/Api/State', '/aPi/github/Development-History', '/API/unknown']) assert.equal(isApiPath(p), true, p);
    for (const p of ['/', '', '/apix', '/api.json', '/apis/state', '/ap', '//api/state', '/%61pi/state', '/api%2Fstate', '/x/api/state', '/assets/api']) assert.equal(isApiPath(p), false, p);
  });

  test('differential: isApiPath agrees with real Express mount matching for every probe path', async () => {
    const { isApiPath } = await import('../server/v1RequestPolicy.mjs');
    const { default: express } = await import('express');
    const app = express();
    app.use('/api', (req, res) => { res.end('api'); });
    app.use((req, res) => { res.end('other'); });
    const srv = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const port = srv.address().port;
      const probes = ['/api', '/api/', '/api/state', '/API', '/API/', '/API/state', '/Api/State?x=1', '/aPi/github/x', '/apix', '/api.json', '/apis/state', '/ap', '//api/state', '/%61pi/state', '/api%2Fstate', '/x/api/state', '/', '/assets/api', '/API//state', '/api?q=1'];
      for (const probe of probes) {
        const body = await new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: probe, agent: false }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d)); }).on('error', reject); });
        assert.equal(isApiPath(probe.split('?')[0]), body === 'api', `${probe}: Express answered ${JSON.stringify(body)}`);
      }
    } finally { await new Promise((resolve) => srv.close(resolve)); }
  });

  for (const nodeEnv of ['production', 'development']) {
    test(`NODE_ENV=${nodeEnv}: every spelling gets the same Host/Origin/Referer and method policy (no HEAD/OPTIONS bypass)`, async () => {
      const cwd = makeCwd({ state: true, activeTask: true });
      const before = snapshotTree(cwd);
      await withServer({ cwd, nodeEnv }, async (server) => {
        assert.equal(server.earlyExit, undefined, server.stderr());
        const hist = `repo=${encodeURIComponent(PM)}`;
        // [path, status of an ordinary GET]. Unknown spellings of the history paths fall through to the JSON API 404, never to the SPA.
        const table = [
          ['/api/health', 200], ['/API/health', 200], ['/Api/Health', 200], ['/aPI/state', 200], ['/API/STATE', 200], ['/API/unknown', 404], ['/Api', 404], ['/API/', 404], ['/api', 404],
          [`/api/github/development-history?${hist}`, 200], [`/api/GITHUB/development-history?${hist}`, 200], [`/API/Github/development-history?${hist}`, 200],
          [`/api/github/Development-History?${hist}`, 404], [`/API/github/development-history/PULL?${hist}&number=7`, 404], [`/API/github/development-history/pull?${hist}&number=7`, 200],
        ];
        const own = `http://127.0.0.1:${server.port}`;
        for (const [route, expected] of table) {
          const get = await server.request('GET', route);
          assert.equal(get.status, expected, `GET ${route}`);
          assert.ok(get.json && typeof (get.json.error ?? get.json.status ?? get.json.repository ?? get.json.number ?? get.json.projects) !== 'undefined', `GET ${route} answers API JSON, never the SPA`);
          assert.equal((await server.request('GET', route, { headers: { Origin: own } })).status, expected, `GET ${route} with the trusted Origin`);
          for (const bad of [{ Origin: 'http://evil.example' }, { Referer: 'http://evil.example/x' }, { Origin: 'null' }, { Host: 'evil.example' }]) {
            const res = await server.request('GET', route, { headers: bad });
            assert.equal(res.status, 403, `GET ${route} ${JSON.stringify(bad)} must be refused before any handler`);
            assert.deepEqual(Object.keys(res.json ?? {}), ['error']);
          }
          for (const method of ['HEAD', 'OPTIONS', ...ALL_WRITE_METHODS]) {
            const res = await server.request(method, route, { body: ALL_WRITE_METHODS.includes(method) ? { x: 1 } : undefined });
            assert.equal(res.status, 405, `${method} ${route}`);
            assert.equal(res.headers.allow, 'GET', `${method} ${route}`);
          }
        }
        // Not API-shaped for Express either: these must never return API data.
        for (const route of ['//api/state', '/%61pi/state', '/apix', '/api.json']) {
          const res = await server.request('GET', route);
          assert.equal(res.json?.status === 'ok' || Array.isArray(res.json?.projects), false, `${route} is not an API route`);
        }
        const spy = server.spy();
        assert.deepEqual(processesIn(spy), []);
        assert.deepEqual(networkIn(spy), []);
        assert.deepEqual(businessWritesIn(spy), []);
        assert.deepEqual(ghIn(spy).filter((g) => !g.path.startsWith(`repos/${PM}`)), []);
      });
      assert.deepEqual(snapshotTree(cwd), before);
    });
  }
});

// ---------------------------------------------------------------- J. protected provider routes: STATIC verification only
describe('J. the two protected provider routes are verified statically; no request to them exists in this file', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf8');
  const PROTECTED = ['/api/bridge/chatgpt-advice', '/api/bridge/extract-features'];

  test('they are registered only inside mountProviderBridge, which only runs behind the "providers" opt-in, which only runs behind mountLegacy', () => {
    const start = src.indexOf('async function mountProviderBridge');
    const end = src.indexOf('async function mountLegacy');
    assert.ok(start > 0 && end > start, 'mount functions found');
    const inside = src.slice(start, end);
    for (const route of PROTECTED) {
      assert.equal(src.split(`'${route}'`).length - 1, 1, `${route} is registered exactly once`);
      assert.ok(inside.includes(`app.post('${route}'`), `${route} is a POST registered inside mountProviderBridge`);
    }
    assert.equal([...src.matchAll(/mountProviderBridge\(app\)/g)].length, 1, 'mountProviderBridge is invoked from exactly one place');
    assert.match(src, /if \(capabilities\.has\('providers'\)\) await mountProviderBridge\(app\);/);
    assert.equal([...src.matchAll(/mountLegacy\(app, CAPABILITIES\)/g)].length, 1);
    assert.match(src, /if \(CAPABILITIES\.size > 0\) await mountLegacy\(app, CAPABILITIES\);/);
    const legacyCall = src.indexOf('mountLegacy(app, CAPABILITIES)');
    assert.ok(legacyCall > src.indexOf('createRequestPolicy('), 'the request policy is installed before any legacy mount');
  });

  test('neither the V1 router nor the request policy mentions them, and the V1 router registers only its own read routes', () => {
    const v1 = fs.readFileSync(path.join(REPO_ROOT, 'server/v1ReadOnlyRoutes.mjs'), 'utf8');
    const policy = fs.readFileSync(path.join(REPO_ROOT, 'server/v1RequestPolicy.mjs'), 'utf8');
    for (const text of [v1, policy]) { for (const route of PROTECTED) assert.equal(text.includes(route), false, route); assert.equal(text.includes('/bridge'), false); }
    assert.deepEqual([...v1.matchAll(/router\.(get|post|put|patch|delete|all|use)\(\s*'([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`), ['get /health', 'get /state', 'use /github']);
  });

  test('the harness tripwire refuses these paths in any spelling (pure predicate, no socket involved)', () => {
    for (const spelling of ['/api/bridge/chatgpt-advice', '/API/BRIDGE/Extract-Features?x=1', '/api/bridge/%63hatgpt-advice', '/api%2Fbridge%2Fextract-features']) assert.equal(isProtectedRoutePath(spelling), true, spelling);
    for (const fine of ['/api/bridge/summarize-changes', '/api/bridge/synthetic-unmounted-post-route', '/api/health']) assert.equal(isProtectedRoutePath(fine), false, fine);
    assert.throws(() => refuseProtectedRoute('/Api/Bridge/ChatGPT-Advice'), /PROTECTED_ROUTE_REQUEST_REFUSED/);
  });
});

// ---------------------------------------------------------------- K. R2 Vite development file boundary
const DOT_MARK = 'SYNTH-MARK-DOTFILE-7c1';
const SHADOW_PUBLIC_MARK = 'SYNTH-MARK-SHADOW-PUBLIC-7c1';
const HELPER_JS_MARK = 'SYNTHETIC-HELPER-MODULE';
const PKG_JS_MARK = 'SYNTHETIC-NODE-MODULE';
const DEP_JS_MARK = 'SYNTHETIC-OPTIMIZED-DEP';
const VITE_ENV_MARK = 'SYNTHETIC-VITE-ENV-MJS';

function makeSymlinkDevCwd() {
  const { cwd, outside } = makeDevCwd();
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
  const link = (rel, target) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.symlinkSync(target, path.join(cwd, rel)); };

  // Legitimate frontend modules, dependency packages, and pre-bundled dep cache
  put('src/sub/helper.js', `export const helper = '${HELPER_JS_MARK}';\n`);
  put('node_modules/synth-pkg/index.js', `export const pkg = '${PKG_JS_MARK}';\n`);
  put('node_modules/.vite/deps/synth-dep.js', `export const dep = '${DEP_JS_MARK}';\n`);

  // Legitimate Vite client env.mjs (exact file allowed for Vite dev client)
  put('node_modules/vite/dist/client/env.mjs', `export const env = '${VITE_ENV_MARK}';\n`);
  // Neighboring unapproved files in the same directory (must remain blocked)
  put('node_modules/vite/dist/client/client.mjs', `export const client = 'UNAPPROVED-CLIENT-MJS';\n`);
  put('node_modules/vite/dist/client/other.js', `export const other = 'UNAPPROVED-OTHER-JS';\n`);
  link('node_modules/vite/dist/client/evil-escape.mjs', '../../../../projects.local.json');
  put('node_modules/vite/dist/client/.env', `SECRET=${DOT_MARK}\n`);

  // A. Allowed /src symlinks resolving inside /src
  link('src/alias-main.js', './main.js');
  link('src/linked-sub', './sub');

  // B. Allowed /src symlinks resolving to private / business / out-of-root files
  link('src/leak-registry.json', '../projects.local.json');
  link('src/leak-state.json', '../data/app-state.json');
  link('src/leak-task.json', `../data/tasks/${TASK_ID}.json`);
  link('src/leak-business.json', '../business/fixture-business.json');
  link('src/leak-business.txt', '../business/fixture-business.txt');
  link('src/leak-outside.txt', path.join(outside, 'secret.txt'));

  // C. Symlinked ancestor directories resolving outside trusted /src root (including hop-out-and-back-in)
  link('src/dir-business', '../business');
  link('src/dir-outside', outside);
  fs.symlinkSync(path.join(cwd, 'src', 'main.js'), path.join(outside, 'hop-back.js'));

  // D. Nested symlinks (in-boundary vs escaping vs dangling)
  link('src/sub/hop2-ok.js', '../main.js');
  link('src/hop1-ok.js', './sub/hop2-ok.js');
  link('src/sub/hop2-bad.json', '../../projects.local.json');
  link('src/hop1-bad.json', './sub/hop2-bad.json');
  link('src/dangling.js', './does-not-exist.js');

  // F & G. /@fs and node_modules / .vite/deps symlinks (legitimate in-root vs escaping)
  link('node_modules/synth-alias', './synth-pkg');
  link('node_modules/evil-pkg/index.js', '../../projects.local.json');
  link('node_modules/evil-dir', outside);
  link('node_modules/.vite/deps/synth-dep-link.js', './synth-dep.js');
  link('node_modules/.vite/deps/evil-dep.js', '../../../projects.local.json');

  // H. Nested dotfiles and symlinks to dotfiles across /src, node_modules, and .vite/deps
  put('src/sub/.dotfile.js', `export const d = '${DOT_MARK}';\n`);
  put('src/sub/.dotdir/secret.js', `export const d = '${DOT_MARK}';\n`);
  link('src/dot-link.js', './sub/.dotfile.js');
  link('src/dotdir-link', './sub/.dotdir');
  put('node_modules/.env', `SECRET=${DOT_MARK}\n`);
  put('node_modules/synth-pkg/.env', `SECRET=${DOT_MARK}\n`);
  put('node_modules/synth-pkg/.dotdir/secret.js', `export const d = '${DOT_MARK}';\n`);
  link('node_modules/synth-pkg/dot-link.js', './.env');
  put('node_modules/.vite/deps/.env', `SECRET=${DOT_MARK}\n`);
  put('node_modules/.vite/deps/.dotdir/secret.js', `export const d = '${DOT_MARK}';\n`);
  link('node_modules/.vite/deps/dot-link.js', './.env');

  // I. Public-shadowing prevention: synthetic files under public/ attempting to shadow /src modules or serve static assets
  put('public/src/main.js', `export const shadow = '${SHADOW_PUBLIC_MARK}';\n`);
  put('public/src/sub/helper.js', `export const shadow = '${SHADOW_PUBLIC_MARK}';\n`);
  put('public/robots.txt', `User-agent: *\nDisallow: /secret\n`);
  put('public/secret.txt', `SYNTHETIC-PUBLIC-ROOT-SECRET\n`);

  return { cwd, outside };
}

describe('K. (R2) the Vite development server serves only the V1 frontend, never business files or editor tools', () => {
  test('pure classifier: frontend paths are allowed, everything addressable outside the frontend surface is denied', async () => {
    const { classifyDevAssetRequest } = await import('../server/v1RequestPolicy.mjs');
    assert.equal(typeof classifyDevAssetRequest, 'function');
    const root = '/srv/synthetic root/project';
    const c = (url) => classifyDevAssetRequest(url, { root }).action;
    for (const url of ['/src/main.tsx', '/src/main.tsx?t=1700000000', '/src/v1/ReadOnlyCommandCenter.tsx', '/src/index.css', '/@vite/client', '/@vite/env', '/@react-refresh', '/node_modules/.vite/deps/react.js?v=abc123', '/node_modules/.vite/deps/_metadata.json',
      `/@fs/${root}/node_modules/tailwindcss/index.css`, '/@id/__x00__virtual:synthetic', '/@id/virtual:synthetic-module',
      '/node_modules/vite/dist/client/env.mjs', '/node_modules/vite/dist/client/env.mjs?t=1700000000']) assert.equal(c(url), 'allow', url);
    for (const url of ['/', '/index.html', '/some/client/route', '/some/client/route?x=1', '/projects', '/NOTES', '/data/tasks']) assert.equal(c(url), 'spa', url);
    for (const url of [
      '/projects.local.json', '/projects.local.json?raw', '/data/tasks/CC-1.json', '/data/app-state.json', '/business/x.txt', '/.env', '/.env.local', '/.bridge/codex-projects.local.json', '/vite.config.ts', '/package.json', '/server.ts', '/server/v1RequestPolicy.mjs', '/test/x.mjs',
      '/src/../projects.local.json', '/src/%2e%2e/projects.local.json', '/src/%2E%2E/projects.local.json', '/src/..%2fprojects.local.json', '/src/..%5cprojects.local.json', '/src\\..\\projects.local.json', '/src//..//projects.local.json', '/./projects.local.json', '/%2e/projects.local.json', '//projects.local.json',
      '/src/%252e%252e/projects.local.json', '/src/main.js%00.json', '/src/main.js\0', '/src/.env', '/src/.hidden/x.js', '/src/nested/.env', '/src/a/b/.hidden/x.js', '/SRC/main.js', '/Src/main.js', '/@FS/x', '/@VITE/client', '/@vite/other',
      `/@fs/${root}/projects.local.json`, `/@fs/${root}/data/tasks/CC-1.json`, `/@fs/${root}/.env`, `/@fs/${root}/node_modules/../projects.local.json`, `/@fs/${root}/node_modules/%2e%2e/projects.local.json`, '/@fs/etc/synthetic', '/@fs//synthetic/secret.txt',
      `/@fs/${root}/node_modules/.env`, `/@fs/${root}/node_modules/tailwindcss/.env`, `/@fs/${root}/node_modules/tailwindcss/.hidden/x.js`, `/@fs/${root}/node_modules/.bin/vite`, `/@fs/${root}/node_modules/.cache/secret.json`, `/@fs/${root}/node_modules/.vite/metadata.json`, `/@fs/${root}/node_modules/.vite/deps/.env`,
      '/node_modules/.vite/deps/.env', '/node_modules/.vite/deps/.hidden/x.js', '/node_modules/.vite/deps/sub/.env',
      '/node_modules/vite/dist/client/client.mjs', '/node_modules/vite/dist/client/other.js', '/node_modules/vite/dist/client/env.mjs/evil.js', '/node_modules/vite/dist/client/env.mjs.map', '/node_modules/vite/dist/client/.env',
      '/@id/@/projects.local.json', '/@id/%40/projects.local.json', '/@id/projects.local.json', '/@id/', '/@vite/../projects.local.json', '/node_modules/other/package.json', '/node_modules/../projects.local.json',
      '/__open-in-editor?file=x', '/__open-stack-frame-in-editor?file=x', '/__vite_ping', '/@vite-plugin-synthetic', 'http://evil.example/src/main.js', '*', '',
    ]) assert.equal(c(url), 'deny', JSON.stringify(url));
  });

  test('canonical realpath classifier (R2 P2 closure): symlinks escaping approved roots or targeting dotfiles are denied while in-boundary symlinks and modules are allowed', async () => {
    const { classifyDevAssetRequest } = await import('../server/v1RequestPolicy.mjs');
    const { cwd } = makeSymlinkDevCwd();
    const c = (url) => classifyDevAssetRequest(url, { root: cwd }).action;

    // A, D, F, G, J (positive): legitimate files and in-boundary symlinks inside /src, node_modules, and .vite/deps
    for (const allowed of [
      '/src/main.js', '/src/sub/helper.js', '/src/alias-main.js', '/src/linked-sub/helper.js', '/src/hop1-ok.js',
      '/%73rc/main.js', '/src/main.js?import', '/src/main.js?raw',
      `/@fs/${cwd}/node_modules/synth-pkg/index.js`, `/@fs/${cwd}/node_modules/synth-alias/index.js`,
      '/node_modules/.vite/deps/synth-dep.js', '/node_modules/.vite/deps/synth-dep.js?v=123', '/node_modules/.vite/deps/synth-dep-link.js',
      '/@vite/client', '/@vite/env', '/@react-refresh',
      '/node_modules/vite/dist/client/env.mjs', '/node_modules/vite/dist/client/env.mjs?v=123', '/node_modules/vite/dist/client/env.mjs?import',
    ]) assert.equal(c(allowed), 'allow', allowed);

    // B, C, D, E, F, G, H, I (negative): escaping symlinks, ancestor symlinks, hop-out-and-back, nested symlinks, dangling symlinks, encoded variants, /@fs, .vite/deps, and dotfiles
    for (const denied of [
      '/src/leak-registry.json', '/src/leak-registry.json?raw', '/src/leak-registry.json?import', '/src/leak-registry.json?url', '/src/leak-registry.json?inline',
      '/src/leak-state.json', '/src/leak-task.json', '/src/leak-business.json', '/src/leak-business.txt', '/src/leak-outside.txt',
      '/src/dir-business/fixture-business.json', '/src/dir-business/fixture-business.txt', '/src/dir-outside/secret.txt', '/src/dir-outside/hop-back.js',
      '/src/hop1-bad.json', '/src/sub/hop2-bad.json', '/src/dangling.js', '/src/does-not-exist.js',
      '/%73rc/leak-registry.json', '/src/%6ceak-registry.json', '/src/dir-business/%66ixture-business.json',
      `/@fs/${cwd}/node_modules/evil-pkg/index.js`, `/@fs/${cwd}/node_modules/evil-pkg/index.js?raw`, `/@fs/${cwd}/node_modules/evil-dir/secret.txt`,
      '/node_modules/.vite/deps/evil-dep.js', '/node_modules/.vite/deps/evil-dep.js?v=123',
      '/src/sub/.dotfile.js', '/src/sub/.dotdir/secret.js', '/src/dot-link.js', '/src/dotdir-link/secret.js',
      `/@fs/${cwd}/node_modules/.env`, `/@fs/${cwd}/node_modules/synth-pkg/.env`, `/@fs/${cwd}/node_modules/synth-pkg/.dotdir/secret.js`, `/@fs/${cwd}/node_modules/synth-pkg/dot-link.js`,
      '/node_modules/.vite/deps/.env', '/node_modules/.vite/deps/.dotdir/secret.js', '/node_modules/.vite/deps/dot-link.js',
      '/node_modules/vite/dist/client/client.mjs', '/node_modules/vite/dist/client/other.js',
      '/node_modules/vite/dist/client/evil-escape.mjs', '/node_modules/vite/dist/client/.env',
      '/node_modules/vite/dist/client/env.mjs/evil.js',
    ]) assert.equal(c(denied), 'deny', denied);

    // SPA entry check: normal index.html is 'spa', but a symlinked index.html fails closed as 'deny'
    assert.equal(c('/'), 'spa');
    assert.equal(c('/index.html'), 'spa');
    fs.unlinkSync(path.join(cwd, 'index.html'));
    fs.symlinkSync(path.join(cwd, 'projects.local.json'), path.join(cwd, 'index.html'));
    assert.equal(c('/'), 'deny', 'symlinked index.html must be denied');
    assert.equal(c('/index.html'), 'deny', 'symlinked index.html must be denied');
    assert.equal(c('/projects'), 'deny', 'SPA fallback with symlinked index.html must be denied');

    // Escaping symlink replacement check: if env.mjs is replaced with a symlink targeting private files, it must be denied
    fs.unlinkSync(path.join(cwd, 'node_modules/vite/dist/client/env.mjs'));
    fs.symlinkSync(path.join(cwd, 'projects.local.json'), path.join(cwd, 'node_modules/vite/dist/client/env.mjs'));
    assert.equal(c('/node_modules/vite/dist/client/env.mjs'), 'deny', 'symlinked env.mjs escaping to private file must be denied');
  });

  test('runtime dev server blocks symlink, ancestor-symlink, nested-symlink, encoded, /@fs, dependency-cache, dotfile, and public-shadow escapes before Vite, while serving legitimate frontend modules', async () => {
    const { cwd } = makeSymlinkDevCwd();
    const before = snapshotTree(cwd);
    const forbiddenMarkers = [...ALL_MARKERS, DOT_MARK, SHADOW_PUBLIC_MARK];
    await withServer({ cwd, nodeEnv: 'development' }, async (server) => {
      assert.equal(server.earlyExit, undefined, server.stderr());
      const baseBlocked = [
        '/src/leak-registry.json', '/src/leak-state.json', '/src/leak-task.json', '/src/leak-business.json', '/src/leak-business.txt', '/src/leak-outside.txt',
        '/src/dir-business/fixture-business.json', '/src/dir-business/fixture-business.txt', '/src/dir-outside/secret.txt', '/src/dir-outside/hop-back.js',
        '/src/hop1-bad.json', '/src/sub/hop2-bad.json', '/src/dangling.js',
        '/%73rc/leak-registry.json', '/src/%6ceak-registry.json', '/src/dir-business/%66ixture-business.json',
        `/@fs/${cwd}/node_modules/evil-pkg/index.js`, `/@fs/${cwd}/node_modules/evil-dir/secret.txt`,
        '/node_modules/.vite/deps/evil-dep.js',
        '/src/sub/.dotfile.js', '/src/sub/.dotdir/secret.js', '/src/dot-link.js', '/src/dotdir-link/secret.js',
        `/@fs/${cwd}/node_modules/.env`, `/@fs/${cwd}/node_modules/synth-pkg/.env`, `/@fs/${cwd}/node_modules/synth-pkg/.dotdir/secret.js`, `/@fs/${cwd}/node_modules/synth-pkg/dot-link.js`,
        '/node_modules/.vite/deps/.env', '/node_modules/.vite/deps/.dotdir/secret.js', '/node_modules/.vite/deps/dot-link.js',
        '/node_modules/vite/dist/client/client.mjs', '/node_modules/vite/dist/client/other.js',
        '/node_modules/vite/dist/client/evil-escape.mjs', '/node_modules/vite/dist/client/.env',
        '/robots.txt', '/secret.txt',
      ];
      const blockedUrls = [];
      for (const u of baseBlocked) {
        blockedUrls.push(u, `${u}?raw`, `${u}?import`, `${u}?url`, `${u}?inline`, `${u}?t=1700000000`);
      }
      for (const url of blockedUrls) {
        const res = await server.request('GET', url);
        assert.equal(res.status, 404, `GET ${url} must be refused with 404 JSON before reaching Vite (got ${res.status})`);
        assert.deepEqual(res.json, { error: 'Not found.' }, `GET ${url} must return the guard's JSON 404`);
        for (const marker of forbiddenMarkers) assert.equal(res.text.includes(marker), false, `GET ${url} leaked ${marker}`);
      }

      // J. Positive controls: legitimate frontend modules, in-boundary symlinks, dependency packages, and SPA routes still load
      const own = `http://127.0.0.1:${server.port}`;
      for (const [url, expectedMark] of [
        ['/', DEV_HTML_MARK],
        ['/index.html', DEV_HTML_MARK],
        ['/projects', DEV_HTML_MARK],
        ['/src/main.js', DEV_JS_MARK],
        ['/src/main.js?import', DEV_JS_MARK],
        ['/src/main.js?raw', DEV_JS_MARK],
        ['/src/alias-main.js', DEV_JS_MARK],
        ['/src/hop1-ok.js', DEV_JS_MARK],
        ['/src/sub/helper.js', HELPER_JS_MARK],
        ['/src/linked-sub/helper.js', HELPER_JS_MARK],
        [`/@fs/${cwd}/node_modules/synth-pkg/index.js`, PKG_JS_MARK],
        [`/@fs/${cwd}/node_modules/synth-alias/index.js`, PKG_JS_MARK],
        ['/node_modules/.vite/deps/synth-dep.js?v=123', DEP_JS_MARK],
        ['/node_modules/.vite/deps/synth-dep-link.js?v=123', DEP_JS_MARK],
        ['/node_modules/vite/dist/client/env.mjs', VITE_ENV_MARK],
        ['/node_modules/vite/dist/client/env.mjs?import', VITE_ENV_MARK],
      ]) {
        const res = await server.request('GET', url, { headers: { Origin: own, Referer: `${own}/` } });
        assert.equal(res.status, 200, `positive control GET ${url} (${res.text.slice(0, 120)})`);
        assert.match(res.text, new RegExp(expectedMark), `positive control GET ${url}`);
        assert.equal(res.text.includes(SHADOW_PUBLIC_MARK), false, `GET ${url} must not serve shadowed file from public/`);
      }
      assert.equal((await server.request('GET', '/@vite/client')).status, 200);
      assert.equal((await server.request('GET', '/api/health')).status, 200);

      const spy = server.spy();
      assert.deepEqual(readsOf(spy, SENSITIVE_READ), [], 'no sensitive business/config/secret file was read or stat-probed');
      assert.deepEqual(processesIn(spy), []);
      assert.deepEqual(networkIn(spy), []);
      assert.deepEqual(businessWritesIn(spy), []);
    });
    assert.deepEqual(snapshotTree(cwd), before, 'fixture tree is byte-for-byte identical after symlink probing');
  });

  test('a disposable dev server never returns a synthetic business, config, secret or out-of-root file, in any URL form', async () => {
    const { cwd, outside } = makeDevCwd();
    const before = snapshotTree(cwd);
    await withServer({ cwd, nodeEnv: 'development' }, async (server) => {
      assert.equal(server.earlyExit, undefined, server.stderr());
      const urls = [];
      for (const [rel] of SECRET_FILES) {
        urls.push(`/${rel}`, `/${rel}?raw`, `/${rel}?import`, `/${rel}?url`, `/${rel}?inline`, `/${rel}?import&raw`, `/${rel}?t=1&import`, `/${rel.toUpperCase()}`,
          `/@fs/${cwd}/${rel}`, `/@fs/${cwd}/${rel}?raw`, `/@fs/${cwd}/${rel}?import`, `/@fs/${cwd}/src/../${rel}`, `/@id/@/${rel}`, `/src/../${rel}`, `/src/%2e%2e/${rel}`, `/src/..%2f${rel}`, `/./${rel}`, `/%2e/${rel}`, `//${rel}`, `/${rel}/`);
      }
      urls.push(`/@fs/${outside}/secret.txt`, `/@fs/${outside}/secret.txt?raw`, `/@fs/${cwd}/../${path.basename(outside)}/secret.txt`, `/__open-in-editor?file=${encodeURIComponent(path.join(cwd, 'projects.local.json'))}`, '/__open-stack-frame-in-editor?file=x');
      for (const url of urls) {
        const res = await server.request('GET', url);
        for (const marker of ALL_MARKERS) assert.equal(res.text.includes(marker), false, `GET ${url} (HTTP ${res.status}) leaked ${marker}`);
        // never the file: either refused/not found, or the ordinary SPA page (only possible for a path that names no file)
        const spaPage = res.status === 200 && /text\/html/.test(String(res.headers['content-type'])) && res.text.includes(DEV_HTML_MARK);
        assert.ok([403, 404].includes(res.status) || spaPage, `GET ${url} -> ${res.status}`);
        if (/__open|@fs/.test(url)) assert.ok([403, 404].includes(res.status), `GET ${url} must be refused outright`);
      }
      const spy = server.spy();
      assert.deepEqual(processesIn(spy), [], 'the editor-launch endpoints started no process');
      assert.deepEqual(networkIn(spy), []);
      assert.deepEqual(businessWritesIn(spy), []);
    });
    assert.deepEqual(snapshotTree(cwd), before, 'probing did not alter a single synthetic file');
  });

  test('positive controls: the V1 frontend (entry page, SPA routes, source modules, Vite client) is still delivered, and the API still works', async () => {
    const { cwd } = makeDevCwd();
    await withServer({ cwd, nodeEnv: 'development' }, async (server) => {
      assert.equal(server.earlyExit, undefined, server.stderr());
      const own = `http://127.0.0.1:${server.port}`;
      for (const route of ['/', '/index.html', '/some/client/route', '/projects']) {
        const res = await server.request('GET', route);
        assert.equal(res.status, 200, route);
        assert.match(res.text, new RegExp(DEV_HTML_MARK), route);
        assert.match(res.text, /src="\/src\/main\.js"/, route);
      }
      assert.equal((await server.request('HEAD', '/')).status, 200);
      const mod = await server.request('GET', '/src/main.js', { headers: { Origin: own, Referer: `${own}/` } });
      assert.equal(mod.status, 200);
      assert.match(mod.text, new RegExp(DEV_JS_MARK));
      assert.equal((await server.request('GET', '/@vite/client')).status, 200);
      assert.equal((await server.request('GET', '/api/health')).status, 200);
      assert.equal((await server.request('GET', '/api/state')).json.projects[0].name, MARK.state, 'the V1 state API (not a static route) still serves saved state');
    });
  });

  test('asset requests get the same Host/Origin/Referer checks as the API', async () => {
    const { cwd } = makeDevCwd();
    await withServer({ cwd, nodeEnv: 'development' }, async (server) => {
      for (const route of ['/src/main.js', '/@vite/client']) {
        for (const bad of [{ Origin: 'http://evil.example' }, { Origin: 'null' }, { Referer: 'http://evil.example/page' }, { Host: 'evil.example' }, { Host: `localhost:${server.port}` }]) {
          assert.equal((await server.request('GET', route, { headers: bad })).status, 403, `${route} ${JSON.stringify(bad)}`);
        }
      }
      assert.equal((await server.request('GET', '/', { headers: { Host: 'evil.example' } })).status, 403);
    });
  });
});

// ---------------------------------------------------------------- L. R3 listener boundary
function listeningSocketsOf(pid) {
  try {
    const out = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1));
  } catch (error) {
    if (error.code === 'ENOENT') return null; // passive inspection unavailable on this machine
    if (error.status === 1) return []; // lsof: nothing matched
    throw error;
  }
}
describe('L. (R3) exactly one listener, on loopback, with no HMR / WebSocket endpoint', () => {
  const MODES = [['development', 'development'], ['production', 'production'], ['NODE_ENV absent', ABSENT], ['NODE_ENV invalid', 'staging']];
  for (const [label, nodeEnv] of MODES) {
    test(`${label}: one recorded bind (127.0.0.1:<PORT>), none refused, no upgrade accepted, passive socket listing agrees`, async (t) => {
      const { cwd } = makeDevCwd();
      await withServer({ cwd, nodeEnv }, async (server) => {
        assert.equal(server.earlyExit, undefined, server.stderr());
        const listens = server.spy().filter((e) => e.kind === 'listen');
        assert.deepEqual(listens.map((l) => l.args), [[server.port, '127.0.0.1']], 'every bind attempt of the whole process');
        assert.deepEqual(listens.filter((l) => l.refused), [], 'no attempt to bind all interfaces / 0.0.0.0 / [::]');
        for (const protocol of ['vite-hmr', 'vite-ping']) {
          const reply = await server.raw(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: ${protocol}\r\n\r\n`);
          assert.doesNotMatch(reply, /^HTTP\/1\.1 101/, `a ${protocol} WebSocket upgrade must not be accepted`);
        }
        const sockets = listeningSocketsOf(server.child.pid);
        if (sockets === null) t.diagnostic('lsof unavailable: passive socket listing NOT_VERIFIED on this machine');
        else assert.deepEqual(sockets, [`127.0.0.1:${server.port}`], 'the only listening TCP socket of this process');
      });
    });
  }

  test('source contract: HMR and the Vite WebSocket server are disabled, and no second listener or upgrade handler exists in server.ts', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf8');
    assert.match(src, /hmr:\s*false/);
    assert.match(src, /ws:\s*false/);
    assert.equal([...src.matchAll(/\.listen\(/g)].length, 1);
    assert.doesNotMatch(src, /on\(\s*['"]upgrade['"]/);
    assert.doesNotMatch(src, /hmr:\s*\{/, 'no HMR server/port option that could open a listener');
  });
});

// ---------------------------------------------------------------- M. R4 genuine NODE_ENV modes
describe('M. (R4) every NODE_ENV mode, including genuinely absent and invalid, keeps the V1 boundary', () => {
  test('the harness really removes NODE_ENV: the child reports the key as absent, as production, as development, and as an invalid value', async () => {
    const seen = {};
    for (const [label, nodeEnv] of [['absent', ABSENT], ['production', 'production'], ['development', 'development'], ['typo', 'prodution'], ['empty', '']]) {
      await withServer({ cwd: makeCwd({}), nodeEnv }, async (server) => {
        seen[label] = server.spy().find((e) => e.kind === 'env');
      });
    }
    assert.deepEqual(seen.absent, { kind: 'env', hasNodeEnv: false, nodeEnv: null }, 'NODE_ENV is genuinely absent, not defaulted to production');
    assert.deepEqual(seen.production, { kind: 'env', hasNodeEnv: true, nodeEnv: 'production' });
    assert.deepEqual(seen.development, { kind: 'env', hasNodeEnv: true, nodeEnv: 'development' });
    assert.deepEqual(seen.typo, { kind: 'env', hasNodeEnv: true, nodeEnv: 'prodution' });
    assert.deepEqual(seen.empty, { kind: 'env', hasNodeEnv: true, nodeEnv: '' });
  });

  const MODES = [['production', 'production', 'prod'], ['development', 'development', 'dev'], ['absent', ABSENT, 'dev'], ['typo "prodution"', 'prodution', 'dev'], ['capitalised "Production"', 'Production', 'dev'], ['unknown "staging"', 'staging', 'dev'], ['empty', '', 'dev']];
  for (const [label, nodeEnv, path_] of MODES) {
    test(`NODE_ENV ${label}: takes the ${path_ === 'prod' ? 'compiled dist' : 'Vite development'} path and exposes exactly the V1 API, with no startup writes, process, network or sensitive reads`, async () => {
      const { cwd } = makeDevCwd();
      fs.mkdirSync(path.join(cwd, 'data', 'tasks'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'data', 'tasks', `${TASK_ID}.json`), activeTaskJson());
      const before = snapshotTree(cwd);
      await withServer({ cwd, nodeEnv }, async (server) => {
        assert.equal(server.earlyExit, undefined, server.stderr());
        const root = await server.request('GET', '/');
        assert.equal(root.status, 200);
        if (path_ === 'prod') assert.match(root.text, /SYNTHETIC V1 SPA/);
        else { assert.match(root.text, new RegExp(DEV_HTML_MARK)); assert.match(root.text, /\/@vite\/client/); }
        // the same API boundary in every mode
        assert.equal((await server.request('GET', '/api/health')).status, 200);
        assert.deepEqual(Object.keys((await server.request('GET', '/api/health')).json).sort(), ['status', 'timestamp']);
        assert.equal((await server.request('PUT', '/api/state', { body: syntheticState() })).status, 405);
        assert.equal((await server.request('GET', '/api/tasks')).status, 404);
        assert.equal((await server.request('GET', '/API/Tasks')).status, 404);
        assert.equal((await server.request('POST', '/api/bridge/summarize-changes', { body: { repo: 'me/demo' } })).status, 405);
        assert.equal((await server.request('GET', '/api/local-git/status?path=%2Ftmp')).status, 404);
        // and the same file boundary: a business file is never served in any mode
        for (const rel of ['projects.local.json', `data/tasks/${TASK_ID}.json`, '.env', '.bridge/codex-projects.local.json']) {
          const res = await server.request('GET', `/${rel}`);
          for (const marker of ALL_MARKERS) assert.equal(res.text.includes(marker), false, `${rel} leaked in NODE_ENV ${label}`);
        }
        const spy = server.spy();
        assert.deepEqual(processesIn(spy), [], 'no agent, no git, no other child process');
        assert.deepEqual(networkIn(spy), [], 'no provider call');
        assert.deepEqual(ghIn(spy), [], 'no GitHub request was made');
        assert.deepEqual(businessWritesIn(spy), [], 'no saved-state or task write');
        assert.deepEqual(readsOf(spy, /(^|\/)(projects\.local\.json|codex-projects\.local\.json)$/), [], 'no registry or Codex allowlist read');
        assert.deepEqual(spy.filter((e) => e.kind === 'listen').map((l) => l.args), [[server.port, '127.0.0.1']]);
      });
      assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'data', 'tasks', `${TASK_ID}.json`), 'utf8')).status, 'RUNNING', 'no TaskStore startup recovery rewrote the active task');
      assert.deepEqual(snapshotTree(cwd), before, 'every synthetic file is byte-for-byte identical after start and stop');
    });
  }
});
