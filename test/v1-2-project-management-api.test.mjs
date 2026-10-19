// V1.2B project management API and request-policy tests. Every server here is a DISPOSABLE child process of the real server.ts
// bundle, started on a free loopback port in a throw-away cwd that holds only SYNTHETIC saved state. A preload recorder logs
// (and refuses) child processes and outbound sockets, so tests can state that the API ran no git, gh, agent or network call.
// The two protected provider routes are never requested. No real data/app-state.json is read or written.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isUsableSavedState } from '../src/savedState.mjs';
import { parseCommandRequest } from '../server/v1ProjectManagementRoutes.mjs';
import { assertCapabilitiesCompatibleWithProjectWriter, isProjectCommandPath } from '../server/v1RequestPolicy.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTECTED = /\/api\/bridge\/(chatgpt-advice|extract-features)/i;
let work;
let bundle;
let spyFile;
const children = new Set();

const SPY = `
const fs=require('fs'),cp=require('child_process'),net=require('net');
const rec=(e)=>{try{fs.appendFileSync(process.env.SPY_LOG,JSON.stringify(e)+'\\n');}catch{}};
for(const n of ['spawn','execFile','exec','fork','spawnSync','execFileSync','execSync'])cp[n]=function(c){rec({kind:'child',cmd:String(c)});throw new Error('SPY: child process refused');};
const oc=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){const o=a[0];if(o&&typeof o==='object'&&(o.host||o.port)){rec({kind:'connect',host:o.host,port:o.port});throw new Error('SPY: outbound socket refused');}return oc.apply(this,a);};
`;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v12b-api-'));
  bundle = path.join(work, 'server.cjs');
  spyFile = path.join(work, 'spy.cjs');
  fs.writeFileSync(spyFile, SPY);
  execFileSync(path.join(REPO, 'node_modules', '.bin', 'esbuild'), ['server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${bundle}`, '--log-level=error'], { cwd: REPO, stdio: 'pipe' });
});
after(() => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(work, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------------ synthetic fixtures
function syntheticProject(id, over = {}) {
  return {
    id, name: `SYN ${id}`, tagline: 'synthetic', repository: `synthetic-owner/${id}`, stage: 'Beta', health: 'Healthy', workflowType: 'standard',
    currentTask: 't', currentGate: 'IMPLEMENT', currentGateLabel: 'Implementation', testOutcome: 'PASS', reviewOutcome: 'PENDING', nextAction: 'n',
    blocker: null, waitingState: 'WAITING_FOR_HUMAN', model: 'Terra', reasoningEffort: 'Medium', routingReason: 'r', lastActivity: 'Just now', tags: ['t'],
    gates: [], activityHistory: [], executionContext: { branch: 'main', model: 'Terra', reasoningEffort: 'Medium', risk: 'Low', routingReason: 'r', bridgeRunId: 'b' },
    environment: { production: { status: 'Live', lastDeployed: 'x' }, staging: { status: 'Healthy', lastRefreshed: 'x' } }, ...over,
  };
}
const syntheticState = () => ({ projects: [syntheticProject('a'), syntheticProject('b')], attentionItems: [], nba: {}, snapshot: {}, futureField: { keep: true } });
function makeCwd({ state = syntheticState(), raw, dataDir = true } = {}) {
  const cwd = fs.mkdtempSync(path.join(work, 'cwd-'));
  fs.mkdirSync(path.join(cwd, 'dist'));
  fs.writeFileSync(path.join(cwd, 'dist', 'index.html'), '<!doctype html><title>SYNTHETIC SPA</title>');
  if (dataDir) {
    fs.mkdirSync(path.join(cwd, 'data'), { mode: 0o700 });
    if (raw !== undefined) fs.writeFileSync(path.join(cwd, 'data', 'app-state.json'), raw, { mode: 0o600 });
    else if (state) fs.writeFileSync(path.join(cwd, 'data', 'app-state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  return cwd;
}
const stateFile = (cwd) => path.join(cwd, 'data', 'app-state.json');
const fileHash = (cwd) => (fs.existsSync(stateFile(cwd)) ? createHash('sha256').update(fs.readFileSync(stateFile(cwd))).digest('hex') : 'absent');
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function startServer(cwd, env = {}) {
  const port = await freePort();
  const log = path.join(work, `spy-${path.basename(cwd)}.log`);
  const child = spawn(process.execPath, ['--require', spyFile, bundle], {
    cwd, env: { PATH: process.env.PATH, NODE_PATH: path.join(REPO, 'node_modules'), NODE_ENV: 'production', PORT: String(port), SPY_LOG: log, TMPDIR: work, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  for (let i = 0; i < 200 && !/running at/.test(out) && child.exitCode === null; i += 1) await new Promise((r) => setTimeout(r, 25));
  const origin = `http://127.0.0.1:${port}`;
  return {
    port, origin, child, exited, stderr: () => err, started: /running at/.test(out),
    spy: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); }),
    request(method, pathname, { headers = {}, body, raw } = {}) {
      if (PROTECTED.test(pathname)) throw new Error('protected route requests are not allowed in this file');
      const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
      return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path: pathname, agent: false, headers: { ...(payload !== undefined ? { 'content-length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
        });
        req.on('error', reject);
        if (payload !== undefined) req.write(payload);
        req.end();
      });
    },
  };
}
async function withServer(cwd, fn, env) {
  const server = await startServer(cwd, env);
  assert.ok(server.started, server.stderr());
  try { return await fn(server); } finally { await server.stop(); }
}
const write = (s, body, headers = {}) => s.request('POST', '/api/projects/commands', { body, headers: { origin: s.origin, 'content-type': 'application/json', ...headers } });
const versionOf = async (s) => (await s.request('GET', '/api/projects')).json.version;
const noSideEffects = (s) => assert.deepEqual(s.spy(), [], 'no child process and no outbound socket');

// ------------------------------------------------------------------------------------------------ 1. read model
describe('1. GET /api/projects: versioned, validated, no fallback', () => {
  test('returns version, all projects (legacy ones without management included) and the removed list', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const res = await s.request('GET', '/api/projects');
      assert.equal(res.status, 200);
      assert.equal(res.json.version, fileHash(cwd));
      assert.deepEqual(res.json.projects.map((p) => p.id), ['a', 'b']);
      assert.deepEqual(res.json.removed, []);
      noSideEffects(s);
    });
  });

  test('absent data directory or file is an exact 404 NO_STATE, and nothing is created', async () => {
    for (const cwd of [makeCwd({ dataDir: false }), makeCwd({ state: null })]) {
      await withServer(cwd, async (s) => {
        const res = await s.request('GET', '/api/projects');
        assert.deepEqual([res.status, res.json], [404, { error: 'No saved state yet.', code: 'NO_STATE' }]);
        const post = await write(s, { expectedVersion: 'absent', command: { type: 'add', input: { name: 'x' } } });
        assert.equal(post.status, 404);
        assert.equal(fileHash(cwd), 'absent', 'no state file was created');
      });
    }
  });

  test('corrupt or invalid state is a 500 with a fixed message: no path, no stack, no file content, file untouched', async () => {
    for (const raw of ['{"projects": [ truncated', JSON.stringify({ projects: [{ id: 'x' }], attentionItems: [], nba: {}, snapshot: {} })]) {
      const cwd = makeCwd({ raw });
      const before = fileHash(cwd);
      await withServer(cwd, async (s) => {
        for (const res of [await s.request('GET', '/api/projects'), await write(s, { expectedVersion: before, command: { type: 'archive', id: 'x' } })]) {
          assert.equal(res.status, 500);
          assert.ok(['CORRUPT_STATE', 'INVALID_STATE'].includes(res.json.code), res.text);
          assert.doesNotMatch(res.text, /\/(tmp|private|Users|var)\/|at .*\.(c|m)?js|truncated/);
        }
      });
      assert.equal(fileHash(cwd), before);
    }
  });
});

// ------------------------------------------------------------------------------------------------ 2. lifecycle end-to-end
describe('2. POST /api/projects/commands: Add / Edit / Archive / Restore / Remove / Recover end-to-end', () => {
  test('a full lifecycle through the real server keeps the file valid, versioned, owner-only and backed up', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      let v = await versionOf(s);
      const step = async (command, expectStatus = 200) => {
        const res = await write(s, { expectedVersion: v, command });
        assert.equal(res.status, expectStatus, `${command.type}: ${res.text}`);
        if (res.status === 200) { assert.equal(res.json.version, fileHash(cwd)); v = res.json.version; }
        return res;
      };
      const added = await step({ type: 'add', input: { name: 'New One', tags: ['x'], repository: 'synthetic-owner/new' } });
      const id = added.json.result.projectId;
      assert.match(id, /^proj-[0-9a-f-]{36}$/, 'server-generated UUID id');
      await step({ type: 'edit', id, patch: { name: 'Renamed', stage: 'Alpha' } });
      await step({ type: 'archive', id });
      await step({ type: 'restore', id });
      await step({ type: 'remove', id, confirmProjectId: id });
      let model = (await s.request('GET', '/api/projects')).json;
      assert.deepEqual(model.projects.map((p) => p.id), ['a', 'b']);
      assert.equal(model.removed[0].project.name, 'Renamed');
      await step({ type: 'recover', id });
      model = (await s.request('GET', '/api/projects')).json;
      assert.deepEqual(model.projects.map((p) => p.id), ['a', 'b', id]);
      assert.deepEqual(model.projects[2].management.events.map((e) => e.type), ['added', 'edited', 'archived', 'restored', 'removed', 'recovered']);
      // V1 reader still accepts the result, unknown top-level fields survive, file is 0600 and backups exist
      const saved = JSON.parse(fs.readFileSync(stateFile(cwd), 'utf8'));
      assert.ok(isUsableSavedState(saved));
      assert.deepEqual(saved.futureField, { keep: true });
      assert.equal((await s.request('GET', '/api/state')).status, 200);
      assert.equal(fs.statSync(stateFile(cwd)).mode & 0o777, 0o600);
      assert.ok(fs.existsSync(path.join(cwd, 'data', 'app-state.json.bak.1')));
      noSideEffects(s);
    });
  });

  test('remove requires confirmProjectId equal to the id; refused requests do not write', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      for (const command of [{ type: 'remove', id: 'a' }, { type: 'remove', id: 'a', confirmProjectId: 'b' }]) {
        assert.equal((await write(s, { expectedVersion: v, command })).status, 400);
      }
      assert.equal(fileHash(cwd), v);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 3. request policy
describe('3. the single write route: Origin, Referer, Host, media type, size and method policy', () => {
  test('missing, foreign, cross-port, null or malformed Origin; foreign Referer; foreign Host: refused before any write', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const body = { expectedVersion: v, command: { type: 'archive', id: 'a' } };
      const crossPort = `http://127.0.0.1:${s.port === 65535 ? 1 : s.port + 1}`;
      const cases = [
        [{ origin: undefined }, 403], [{ origin: 'http://evil.example' }, 403], [{ origin: crossPort }, 403], [{ origin: 'null' }, 403],
        [{ origin: `http://localhost:${s.port}` }, 403], [{ origin: `${s.origin}/` }, 403], [{ origin: s.origin.toUpperCase() }, 403],
        [{ referer: 'http://evil.example/x' }, 403], [{ referer: `${crossPort}/` }, 403], [{ host: 'evil.example' }, 403], [{ host: `localhost:${s.port}` }, 403],
      ];
      for (const [headers, status] of cases) {
        const h = { origin: s.origin, 'content-type': 'application/json', ...headers };
        if (headers.origin === undefined && 'origin' in headers) delete h.origin;
        const res = await s.request('POST', '/api/projects/commands', { body, headers: h });
        assert.equal(res.status, status, JSON.stringify(headers));
      }
      assert.equal(fileHash(cwd), v, 'no refused request wrote anything');
      const ok = await write(s, body, { referer: `${s.origin}/manage` });
      assert.equal(ok.status, 200, 'same-origin Origin with same-origin Referer is accepted');
    });
  });

  test('media type, body size, JSON and envelope shape are enforced before the store is touched', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const valid = JSON.stringify({ expectedVersion: v, command: { type: 'archive', id: 'a' } });
      const post = (raw, headers = {}) => s.request('POST', '/api/projects/commands', { raw, headers: { origin: s.origin, 'content-type': 'application/json', ...headers } });
      assert.equal((await post(valid, { 'content-type': 'text/plain' })).status, 415);
      assert.equal((await post(valid, { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
      assert.equal((await post(valid, { 'content-type': '' })).status, 415);
      assert.equal((await post('x'.repeat(16 * 1024 + 1))).status, 413);
      assert.equal((await post(valid, { 'content-length': '999999' })).status, 413);
      // chunked body without Content-Length: the router's own byte cap applies
      const chunked = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/projects/commands', agent: false, headers: { origin: s.origin, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject);
        for (let i = 0; i < 20; i += 1) req.write('x'.repeat(1024));
        req.end();
      });
      assert.equal(chunked, 413);
      for (const raw of ['{bad json', '[]', '"string"', 'null', JSON.stringify({ expectedVersion: v }), JSON.stringify({ command: { type: 'archive', id: 'a' } }),
        JSON.stringify({ expectedVersion: 'not-a-hash', command: { type: 'archive', id: 'a' } }), Buffer.from([0x7b, 0xff, 0x7d]).toString('latin1')]) {
        assert.equal((await post(raw)).status, 400, raw);
      }
      assert.equal(fileHash(cwd), v);
    });
  });

  test('only POST on the exact path is accepted; every other method/path keeps the V1 405/404 behaviour', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const body = { expectedVersion: v, command: { type: 'edit', id: 'a', patch: { name: 'x' } } };
      for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
        const res = await s.request(method, '/api/projects/commands', { headers: { origin: s.origin } });
        assert.equal(res.status, 405, method);
        assert.equal(res.headers.allow, 'POST');
      }
      assert.equal((await s.request('GET', '/api/projects/commands')).status, 405, 'GET on the command path is not a read route');
      for (const p of ['/api/projects/commands/', '/api/projects/commands/x', '/api/projects', '/api/projects/command', '/api/state', '/api/projects%2Fcommands', '/api//projects/commands']) {
        assert.equal((await s.request('POST', p, { body, headers: { origin: s.origin, 'content-type': 'application/json' } })).status, 405, p);
      }
      assert.equal((await s.request('PUT', '/api/state', { body: syntheticState(), headers: { origin: s.origin, 'content-type': 'application/json' } })).status, 405, 'no bulk state write');
      // Express routes case-insensitively, so the gate does too: the case variant is the same single route and same rules
      const v2 = await versionOf(s);
      assert.equal((await s.request('POST', '/API/Projects/Commands', { body: { ...body, expectedVersion: v2 }, headers: { 'content-type': 'application/json' } })).status, 403, 'case variant still needs Origin');
      assert.equal((await s.request('POST', '/API/Projects/Commands', { body: { expectedVersion: v2, command: { type: 'edit', id: 'a', patch: { name: 'case ok' } } }, headers: { origin: s.origin, 'content-type': 'application/json' } })).status, 200);
      assert.equal((await s.request('GET', '/api/unknown')).status, 404);
      noSideEffects(s);
    });
  });

  test('the existing V1 GET routes still answer; non-allowlisted history is refused without running gh', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      assert.equal((await s.request('GET', '/api/health')).status, 200);
      assert.equal((await s.request('GET', '/api/state')).json.projects.length, 2);
      assert.equal((await s.request('GET', '/api/github/development-history?repo=synthetic-owner/a')).status, 403);
      assert.equal((await s.request('GET', '/api/github/development-history/pull?repo=synthetic-owner/a&number=1')).status, 403);
      assert.match((await s.request('GET', '/some/page')).text, /SYNTHETIC SPA/);
      noSideEffects(s);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 4. allowlisted command shape
describe('4. command allowlist: caller cannot choose ids, clocks, paths, storage or whole state', () => {
  test('unknown commands, extra or missing fields and forbidden keys are 400 and never reach the store', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const bad = [
        { type: 'purge', id: 'a' }, { type: '__proto__' }, { type: 'add', input: { name: 'x' }, newId: 'p' }, { type: 'add', input: { name: 'x', id: 'mine' } },
        { type: 'add', input: { name: 'x', dataMode: 'registered' } }, { type: 'add', input: { name: 'x', dataDir: '/tmp' } }, { type: 'add', input: { name: 'x' }, now: '2000-01-01' },
        { type: 'edit', id: 'a', patch: { repository: 'x/y' } }, { type: 'edit', id: 'a', patch: { management: {} } }, { type: 'edit', id: 'a' }, { type: 'archive' },
        { type: 'archive', id: 1 }, { type: 'restore', id: 'a', path: '/etc' },
      ];
      for (const command of bad) assert.equal((await write(s, { expectedVersion: v, command })).status, 400, JSON.stringify(command));
      for (const extra of [{ state: syntheticState() }, { dataDir: '/tmp' }, { token: 'x' }]) {
        assert.equal((await write(s, { expectedVersion: v, command: { type: 'archive', id: 'a' }, ...extra })).status, 400, JSON.stringify(Object.keys(extra)));
      }
      assert.equal(fileHash(cwd), v);
    });
  });

  test('parseCommandRequest is the same allowlist in isolation', () => {
    assert.deepEqual(parseCommandRequest({ expectedVersion: 'absent', command: { type: 'remove', id: 'x', confirmProjectId: 'x' } }), { expectedVersion: 'absent', command: { type: 'remove', id: 'x' } });
    assert.throws(() => parseCommandRequest({ expectedVersion: 'absent', command: { type: 'add', input: { name: 'x' }, extra: 1 } }), /unsupported/);
  });

  test('domain refusals map to status codes without leaking paths', async () => {
    const cwd = makeCwd({ state: { ...syntheticState(), projects: [syntheticProject('a'), syntheticProject('dup'), syntheticProject('dup', { repository: 'synthetic-owner/dup2' })] } });
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const cases = [
        [{ type: 'archive', id: 'nope' }, 404, 'NOT_FOUND'], [{ type: 'restore', id: 'a' }, 409, 'ILLEGAL_TRANSITION'], [{ type: 'archive', id: 'dup' }, 409, 'AMBIGUOUS_ID'],
        [{ type: 'add', input: { name: 'x', repository: 'SYNTHETIC-OWNER/A' } }, 409, 'DUPLICATE_REPOSITORY'], [{ type: 'add', input: { name: '' } }, 400, 'INVALID_INPUT'],
        [{ type: 'add', input: { name: 'x', repository: 'https://github.com/a/b' } }, 400, 'INVALID_INPUT'], [{ type: 'edit', id: 'a', patch: { health: 'Healthy' } }, 400, 'FIELD_NOT_EDITABLE'],
      ];
      for (const [command, status, code] of cases) {
        const res = await write(s, { expectedVersion: v, command });
        assert.deepEqual([res.status, res.json.code], [status, code], JSON.stringify(command));
        assert.doesNotMatch(res.text, /\/(tmp|private|Users|var)\//);
      }
      assert.equal(fileHash(cwd), v);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 5. concurrency
describe('5. stale clients and racing requests', () => {
  test('a stale version is 409 CONFLICT with the current version, and the file is unchanged', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const stale = await versionOf(s);
      assert.equal((await write(s, { expectedVersion: stale, command: { type: 'archive', id: 'a' } })).status, 200);
      const now = fileHash(cwd);
      const res = await write(s, { expectedVersion: stale, command: { type: 'archive', id: 'b' } });
      assert.deepEqual([res.status, res.json.code, res.json.currentVersion], [409, 'CONFLICT', now]);
      assert.equal(fileHash(cwd), now);
    });
  });

  test('10 concurrent writes from one version: exactly one succeeds, the rest are 409/423, nothing is lost or merged silently', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => write(s, { expectedVersion: v, command: { type: 'add', input: { name: `race-${i}` } } })));
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((x) => x === 200).length, 1, statuses.join(','));
      assert.ok(statuses.every((x) => [200, 409, 423].includes(x)), statuses.join(','));
      const names = (await s.request('GET', '/api/projects')).json.projects.map((p) => p.name).filter((n) => n.startsWith('race-'));
      assert.equal(names.length, 1);
      assert.deepEqual(fs.readdirSync(path.join(cwd, 'data')).filter((f) => f.endsWith('.lock') || f.includes('.tmp-')), []);
    });
  });

  test('a held lock is 423 LOCKED and the file is unchanged', async () => {
    const cwd = makeCwd();
    fs.writeFileSync(path.join(cwd, 'data', 'app-state.json.lock'), JSON.stringify({ token: 'other' }), { mode: 0o600 });
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const res = await write(s, { expectedVersion: v, command: { type: 'archive', id: 'a' } });
      assert.deepEqual([res.status, res.json.code], [423, 'LOCKED']);
      assert.equal(fileHash(cwd), v);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 6. capability conflict & composition
describe('6. legacy state-write is refused; composition is as documented', () => {
  test('the server refuses to start with the legacy state-write capability (it bypasses the store lock)', async () => {
    for (const value of ['state-write', 'tasks,state-write']) {
      const server = await startServer(makeCwd(), { COMMAND_CENTER_LEGACY_CAPABILITIES: value });
      const code = await server.exited;
      assert.notEqual(code, 0, value);
      assert.match(server.stderr(), /state-write.*cannot be enabled together with the V1\.2 project writer/);
    }
    assert.throws(() => assertCapabilitiesCompatibleWithProjectWriter(new Set(['state-write'])));
    assert.doesNotThrow(() => assertCapabilitiesCompatibleWithProjectWriter(new Set(['tasks'])));
  });

  test('with another legacy capability enabled, the legacy JSON parser does not consume the project command body', async () => {
    const cwd = makeCwd();
    await withServer(cwd, async (s) => {
      const v = await versionOf(s);
      const res = await write(s, { expectedVersion: v, command: { type: 'archive', id: 'a' } });
      assert.equal(res.status, 200, res.text);
    }, { COMMAND_CENTER_LEGACY_CAPABILITIES: 'github-legacy' });
  });

  test('isProjectCommandPath is exact and case-insensitive', () => {
    for (const p of ['/api/projects/commands', '/API/PROJECTS/COMMANDS']) assert.equal(isProjectCommandPath(p), true, p);
    for (const p of ['/api/projects/commands/', '/api/projects', '/api/projects/commands/x', '/x/api/projects/commands', '/api/projects%2Fcommands', '']) assert.equal(isProjectCommandPath(p), false, p);
  });

  test('static: server.ts mounts the project router after the method gate and write gate, and no global JSON parser in V1', () => {
    const src = fs.readFileSync(path.join(REPO, 'server.ts'), 'utf8');
    const order = ['app.use(createRequestPolicy(', 'app.use(methodGate)', 'app.use(createProjectWriteGate(', 'createV1ProjectManagementRouter()', "app.use('/api', apiNotFound)"].map((m) => src.indexOf(m));
    assert.ok(order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), order.join(','));
    const startServer = src.slice(src.indexOf('async function startServer'));
    assert.doesNotMatch(startServer, /express\.json\(/);
    const router = fs.readFileSync(path.join(REPO, 'server/v1ProjectManagementRoutes.mjs'), 'utf8');
    assert.doesNotMatch(router, /node:(child_process|net|https?)|\bfetch\(|execFile|spawn\(|GoogleGenAI|openai/i);
  });
});
