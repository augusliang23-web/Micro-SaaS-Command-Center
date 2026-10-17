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
for (const name of ['spawn', 'exec', 'fork']) cp[name] = function (cmd, args) { throw refuse(name, cmd, args); };
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

const syntheticState = () => ({ projects: [{ id: 'reg-pm', name: 'SYNTHETIC PM', repository: PM }], attentionItems: [], nba: {}, snapshot: {} });
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
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.vite') continue; /* development tool cache, not data */ const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p).toString('hex'); } };
  walk(dir);
  return out;
};
function freePort() {
  return new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}

/** Starts the bundle in `cwd`; resolves once it reports readiness, or reports an early exit. */
async function startServer({ cwd, env = {}, nodeEnv = 'production', port } = {}) {
  const p = port ?? await freePort();
  const logFile = path.join(cwd, '..', `spy-${path.basename(cwd)}.log`);
  fs.writeFileSync(logFile, '');
  const child = spawn(process.execPath, ['--require', spyFile, bundle], {
    cwd,
    env: { PATH: process.env.PATH, NODE_PATH: path.join(REPO_ROOT, 'node_modules'), PORT: String(p), SPY_LOG: logFile, SPY_FAKE_GH: '1', ...FAKE_KEYS, ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}), ...env },
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
      const req = http.request({ host: '127.0.0.1', port: p, method, path: pathname, agent: false, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
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
      const legacy = ['/api/tasks', `/api/tasks/${TASK_ID}`, '/api/bridge/codex-handoffs', '/api/bridge/summarize-changes', '/api/bridge/chatgpt-advice', '/api/bridge/extract-features',
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
    await withServer({ cwd: makeCwd({}) }, async (server) => {
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
        if (nodeEnv !== 'development') assert.deepEqual(writesIn(spy), []);
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
    await withServer({ cwd: makeCwd({}) }, async (server) => {
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

  test('each legacy capability is its own opt-in and only enables its own routes', async () => {
    const cases = [
      ['state-write', async (s) => { assert.equal((await s.request('PUT', '/api/state', { body: syntheticState() })).status, 200); assert.equal((await s.request('GET', '/api/tasks')).status, 404); assert.equal((await s.request('GET', '/api/local-git/status?path=%2Ftmp')).status, 404); }],
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
