// V1.2C GitHub connection: end-to-end and security tests against the REAL server.ts bundle. Every server runs in a throw-away
// cwd with SYNTHETIC saved state, on a free loopback port. A preload replaces the GitHub CLI with a FAKE that answers only the
// synthetic repositories below and records every call; any other child process or outbound socket is refused and recorded.
// No real GitHub, no real saved state, no provider or agent. The two protected provider routes are never requested.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PM = 'augusliang23-web/pm-dashboard';
const PROTECTED = /\/api\/bridge\/(chatgpt-advice|extract-features)/i;
let work;
let bundle;
let preload;
const children = new Set();

// Fake gh: metadata for known repos, a minimal valid history for any known repo, scripted failures by repository name.
const PRELOAD = `
const fs=require('fs'),cp=require('child_process'),net=require('net');
const LOG=process.env.SPY_LOG; const rec=(e)=>{try{fs.appendFileSync(LOG,JSON.stringify(e)+'\\n');}catch{}};
const KNOWN=JSON.parse(process.env.FAKE_GH_REPOS||'{}');
const metaCalls={};
const out=(body,status=200)=>'HTTP/2.0 '+status+' OK\\r\\n\\r\\n'+JSON.stringify(body);
const day='2026-10-01T00:00:00Z';
function answer(p){
  const m=/^repos\\/([^/]+\\/[^/?]+)(.*)$/.exec(p); if(!m) return null;
  const known=Object.keys(KNOWN).find((k)=>k.toLowerCase()===m[1].toLowerCase()); if(!known) return null;
  const meta=KNOWN[known]; if(meta.fail) return {fail:meta.fail};
  const rest=m[2];
  const n=rest===''?(metaCalls[known]=(metaCalls[known]||0)+1):(metaCalls[known]||0);
  const after=n>1; // the 1st metadata call is the connect-time verification; later ones are history reads
  const repo=(after&&meta.renamedTo)||meta.full_name||known;
  const id=(after&&meta.idAfterConnect)||meta.id;
  const baseRepo=meta.baseRepo||{full_name:repo,id};
  const headRepo=meta.forkHead?{full_name:'someone-else/fork',id:999}:{full_name:repo,id};
  const commit=(sha,parents)=>({sha,parents:parents.map((s)=>({sha:s})),html_url:'https://github.com/'+repo+'/commit/'+sha,commit:{message:'SYNTHETIC '+sha,author:{date:day,name:'a'},committer:{date:day}}});
  const pull={number:7,title:'SYNTHETIC PR',state:'open',draft:false,created_at:day,updated_at:day,closed_at:null,merged_at:null,html_url:'https://github.com/'+repo+'/pull/7',user:{login:'s'},base:{ref:'main',sha:'m1',repo:baseRepo},head:{ref:'feat/x',sha:'h7',repo:headRepo},merge_commit_sha:null};
  if(rest==='') return out(after&&meta.noIdentity?{default_branch:'main'}:{id,full_name:repo,default_branch:'main',html_url:'https://github.com/'+repo});
  if(/^\\/branches\\?/.test(rest)) return out([{name:'main',commit:{sha:'m1'},protected:true},{name:'feat/x',commit:{sha:'h7'},protected:false}]);
  if(/^\\/pulls\\?state=all/.test(rest)) return out([pull]);
  if(/^\\/commits\\?sha=/.test(rest)) return out([commit('m1',[])]);
  if(/^\\/compare\\//.test(rest)) return out({status:'ahead',ahead_by:1,behind_by:0,total_commits:1,merge_base_commit:{sha:'m1'},commits:[commit('h7',['m1'])]});
  if(/^\\/pulls\\/7\\/reviews/.test(rest)) return out([]);
  if(/^\\/pulls\\/7$/.test(rest)) return out(Object.assign({},pull,{changed_files:1,additions:1,deletions:0,commits:1}));
  if(/^\\/commits\\/h7\\/check-runs/.test(rest)) return out({total_count:0,check_runs:[]});
  return null;
}
cp.execFile=function(cmd,args,opts,cb){
  if(typeof opts==='function'){cb=opts;opts={};}
  if(cmd==='gh'&&Array.isArray(args)&&args[0]==='api'){
    rec({kind:'gh',args:args.slice(0,5)});
    const a=answer(args[args.length-1]);
    setImmediate(()=>{
      if(a&&a.fail==='rate') return cb(Object.assign(new Error('x'),{code:1}),out({message:'API rate limit exceeded'},403),'gh: API rate limit exceeded (HTTP 403)');
      if(a&&a.fail==='timeout') return cb(Object.assign(new Error('timed out'),{killed:true,signal:'SIGTERM'}),'','');
      if(a&&a.fail==='auth') return cb(Object.assign(new Error('x'),{code:1}),out({message:'Bad credentials'},401),'gh: Bad credentials (HTTP 401)');
      if(!a) return cb(Object.assign(new Error('x'),{code:1}),out({message:'Not Found'},404),'gh: Not Found (HTTP 404)');
      cb(null,a,'');
    });
    return {kill(){},on(){}};
  }
  rec({kind:'child',cmd:String(cmd)}); const e=new Error('SPY: child refused'); if(cb) setImmediate(()=>cb(e,'','')); return {kill(){},on(){}};
};
for(const n of ['spawn','exec','fork','spawnSync','execSync','execFileSync']) cp[n]=function(c){rec({kind:'child',cmd:String(c)});throw new Error('SPY: child refused');};
const oc=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){const o=a[0];if(o&&typeof o==='object'&&(o.host||o.port)){rec({kind:'connect',host:o.host,port:o.port});throw new Error('SPY: socket refused');}return oc.apply(this,a);};
`;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v12c-'));
  bundle = path.join(work, 'server.cjs');
  preload = path.join(work, 'preload.cjs');
  fs.writeFileSync(preload, PRELOAD);
  execFileSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'esbuild'), ['server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${bundle}`, '--log-level=error'], { cwd: REPO_ROOT, stdio: 'pipe' });
});
after(() => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(work, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------------ synthetic fixtures
function project(id, over = {}) {
  return {
    id, name: `SYN ${id}`, tagline: 's', repository: '', stage: 'Beta', health: 'Healthy', workflowType: 'standard', currentTask: 't',
    currentGate: 'IMPLEMENT', currentGateLabel: 'I', testOutcome: 'PASS', reviewOutcome: 'PENDING', nextAction: 'n', blocker: null,
    waitingState: 'WAITING_FOR_HUMAN', model: 'Terra', reasoningEffort: 'Medium', routingReason: 'r', lastActivity: 'x', tags: ['t'], gates: [], activityHistory: [],
    executionContext: { branch: 'main', model: 'Terra', reasoningEffort: 'Medium', risk: 'Low', routingReason: 'r', bridgeRunId: 'b' },
    environment: { production: { status: 'Live', lastDeployed: 'x' }, staging: { status: 'Healthy', lastRefreshed: 'x' } }, ...over,
  };
}
const state = (projects, extra = {}) => ({ projects, attentionItems: [], nba: {}, snapshot: {}, ...extra });
const legacyPm = (over = {}) => project('reg-pm', { name: 'PM Dashboard', repository: PM, ...over });
const FAKE_REPOS = {
  'synthetic-owner/swiperight': { id: 101 }, 'synthetic-owner/swiperight-v2': { id: 102 }, 'synthetic-owner/other': { id: 103 },
  'synthetic-owner/renamed': { id: 104, full_name: 'synthetic-owner/new-name' }, 'Synthetic-Owner/CaseRepo': { id: 105 },
  'synthetic-owner/limited': { id: 106, fail: 'rate' }, 'synthetic-owner/slow': { id: 107, fail: 'timeout' }, 'synthetic-owner/noauth': { id: 108, fail: 'auth' },
  [PM]: { id: 1 },
  // F3 scripted identity changes AFTER the connect-time verification
  'synthetic-owner/transferred': { id: 301, idAfterConnect: 999 },
  'synthetic-owner/renamed-later': { id: 302, renamedTo: 'synthetic-owner/renamed-elsewhere' },
  'synthetic-owner/foreign-base': { id: 303, baseRepo: { full_name: 'synthetic-owner/other', id: 103 } },
  'synthetic-owner/no-identity': { id: 304, noIdentity: true },
  'synthetic-owner/fork-pr': { id: 305, forkHead: true },
};

function makeCwd(saved, { raw } = {}) {
  const cwd = fs.mkdtempSync(path.join(work, 'cwd-'));
  fs.mkdirSync(path.join(cwd, 'dist'));
  fs.writeFileSync(path.join(cwd, 'dist', 'index.html'), '<!doctype html><title>SYNTHETIC SPA</title>');
  fs.mkdirSync(path.join(cwd, 'data'), { mode: 0o700 });
  if (raw !== undefined) fs.writeFileSync(path.join(cwd, 'data', 'app-state.json'), raw, { mode: 0o600 });
  else if (saved) fs.writeFileSync(path.join(cwd, 'data', 'app-state.json'), JSON.stringify(saved, null, 2), { mode: 0o600 });
  return cwd;
}
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function withServer(cwd, fn) {
  const port = await freePort();
  const log = path.join(work, `spy-${path.basename(cwd)}.log`);
  const child = spawn(process.execPath, ['--require', preload, bundle], {
    cwd, env: { PATH: process.env.PATH, NODE_PATH: path.join(REPO_ROOT, 'node_modules'), NODE_ENV: 'production', PORT: String(port), SPY_LOG: log, FAKE_GH_REPOS: JSON.stringify(FAKE_REPOS), TMPDIR: work },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let outText = '';
  let errText = '';
  child.stdout.on('data', (c) => { outText += c; });
  child.stderr.on('data', (c) => { errText += c; });
  for (let i = 0; i < 200 && !/running at/.test(outText) && child.exitCode === null; i += 1) await new Promise((r) => setTimeout(r, 25));
  assert.match(outText, /running at/, errText);
  const origin = `http://127.0.0.1:${port}`;
  const spy = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const request = (method, pathname, { body, headers = {} } = {}) => {
    if (PROTECTED.test(pathname)) throw new Error('protected route requests are not allowed in this file');
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: pathname, agent: false, headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, text, json }); });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
  const s = {
    origin, spy, request,
    gh: () => spy().filter((e) => e.kind === 'gh').map((e) => e.args[4]),
    projects: async () => (await request('GET', '/api/projects')).json,
    command: async (command, { origin: o = origin, expectedVersion } = {}) => {
      const v = expectedVersion ?? (await request('GET', '/api/projects')).json.version;
      return request('POST', '/api/projects/commands', { body: { expectedVersion: v, command }, headers: o ? { origin: o } : {} });
    },
    history: (repo, projectId) => request('GET', `/api/github/development-history?repo=${encodeURIComponent(repo)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`),
    pull: (repo, projectId) => request('GET', `/api/github/development-history/pull?repo=${encodeURIComponent(repo)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}&number=7`),
  };
  try {
    return await fn(s);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); }
  }
}
const sideEffectsOk = (s) => assert.deepEqual(s.spy().filter((e) => e.kind !== 'gh'), [], 'no other child process and no outbound socket');
const allGhAreGet = (s) => { for (const e of s.spy().filter((x) => x.kind === 'gh')) assert.deepEqual(e.args.slice(0, 4), ['api', '--method', 'GET', '-i']); };

// ------------------------------------------------------------------------------------------------ 1. full E2E scenario
describe('1. synthetic end-to-end scenario (Manage Projects + Connect GitHub + lifecycle)', () => {
  test('add, edit, archive, restore, connect, read, disconnect, change, remove, recover, with PM Dashboard unaffected', async () => {
    const cwd = makeCwd(state([legacyPm()]));
    await withServer(cwd, async (s) => {
      assert.equal((await s.history(PM, 'reg-pm')).status, 200, '18 (before): legacy PM Dashboard reads as in V1.1');
      // 1-3 add and see it Active, NOT connected, no GitHub call for it
      const added = await s.command({ type: 'add', input: { name: 'SwipeRight', tags: ['mobile'] } });
      assert.equal(added.status, 200, added.text);
      const id = added.json.result.projectId;
      let model = await s.projects();
      assert.equal(model.projects.find((p) => p.id === id).management.lifecycle, 'active');
      assert.ok(!model.githubAuthorizations.some((a) => a.projectId === id));
      const ghBefore = s.gh().length;
      // 4 edit; 5-6 archive (leaves Active); 7-8 restore with the same id and history
      assert.equal((await s.command({ type: 'edit', id, patch: { name: 'SwipeRight App' } })).status, 200);
      assert.equal((await s.command({ type: 'archive', id })).status, 200);
      model = await s.projects();
      assert.equal(model.projects.find((p) => p.id === id).management.lifecycle, 'archived');
      assert.equal((await s.command({ type: 'connect', id, repository: 'synthetic-owner/swiperight' })).json.code, 'ILLEGAL_TRANSITION', 'archived cannot connect');
      assert.equal((await s.command({ type: 'restore', id })).status, 200);
      assert.equal(s.gh().length, ghBefore, 'no GitHub request for an unconnected project');
      // 9 connect: exactly one metadata GET, then saved; 10 read its own history and PR detail
      const connected = await s.command({ type: 'connect', id, repository: 'synthetic-owner/swiperight' });
      assert.equal(connected.status, 200, connected.text);
      assert.deepEqual(s.gh().slice(ghBefore), ['repos/synthetic-owner/swiperight']);
      model = await s.projects();
      assert.ok(model.githubAuthorizations.some((a) => a.projectId === id && a.repository === 'synthetic-owner/swiperight' && a.source === 'user-verified'));
      const hist = await s.history('synthetic-owner/swiperight', id);
      assert.equal(hist.status, 200, hist.text);
      assert.equal(hist.json.repository, 'synthetic-owner/swiperight');
      assert.equal(hist.json.source, 'GitHub');
      assert.ok(hist.json.fetchedAt);
      assert.equal((await s.pull('synthetic-owner/swiperight', id)).status, 200);
      assert.equal((await s.history('synthetic-owner/swiperight', 'reg-pm')).status, 403, 'bound to its own project id');
      // 11-12 disconnect: no further reads, cached or not
      assert.equal((await s.command({ type: 'disconnect', id })).status, 200);
      const ghAfterDisconnect = s.gh().length;
      assert.equal((await s.history('synthetic-owner/swiperight', id)).status, 403);
      assert.equal((await s.history('synthetic-owner/swiperight')).status, 403);
      assert.equal((await s.pull('synthetic-owner/swiperight', id)).status, 403);
      assert.equal(s.gh().length, ghAfterDisconnect, 'a disconnected repository is never read, not even from cache');
      // 13 reconnect to an explicitly approved repository through "change" (confirmed), old authority revoked
      assert.equal((await s.command({ type: 'change', id, repository: 'synthetic-owner/swiperight-v2', confirmPreviousRepository: 'wrong' })).status, 400);
      const changed = await s.command({ type: 'change', id, repository: 'synthetic-owner/swiperight-v2', confirmPreviousRepository: 'synthetic-owner/swiperight' });
      assert.equal(changed.status, 200, changed.text);
      assert.equal((await s.history('synthetic-owner/swiperight', id)).status, 403, 'old repository no longer readable');
      assert.equal((await s.history('synthetic-owner/swiperight-v2', id)).status, 200, 'new repository readable');
      // 14-15 remove: gone from Active and from GitHub authority
      assert.equal((await s.command({ type: 'remove', id, confirmProjectId: id })).status, 200);
      model = await s.projects();
      assert.ok(!model.projects.some((p) => p.id === id));
      assert.equal((await s.history('synthetic-owner/swiperight-v2', id)).status, 403);
      // 16-17 recover: data intact, but GitHub authority is NOT resurrected
      assert.equal((await s.command({ type: 'recover', id })).status, 200);
      model = await s.projects();
      const back = model.projects.find((p) => p.id === id);
      assert.deepEqual([back.id, back.name, back.tags, back.repository], [id, 'SwipeRight App', ['mobile'], 'synthetic-owner/swiperight-v2']);
      assert.deepEqual([back.management.githubConnection.status, back.management.githubConnection.revokedReason], ['disconnected', 'removed']);
      assert.deepEqual(back.management.events.map((e) => e.type), ['added', 'edited', 'archived', 'restored', 'github-connected', 'github-disconnected', 'github-repository-changed', 'removed', 'recovered']);
      assert.equal((await s.history('synthetic-owner/swiperight-v2', id)).status, 403, 'recover requires an explicit reconnect');
      // 18 PM Dashboard unaffected throughout
      assert.equal((await s.history(PM, 'reg-pm')).status, 200);
      allGhAreGet(s);
      sideEffectsOk(s);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 2. connect verification
describe('2. Connect / Change verify on GitHub first and fail closed', () => {
  test('verification failures (missing, renamed, rate limit, timeout, auth) save nothing and grant nothing', async () => {
    const cwd = makeCwd(state([project('p1')]));
    await withServer(cwd, async (s) => {
      const before = fs.readFileSync(path.join(cwd, 'data', 'app-state.json'));
      for (const [repo, code, kind] of [
        ['synthetic-owner/missing', 'GITHUB_VERIFICATION_FAILED', 'missing'], ['synthetic-owner/limited', 'GITHUB_VERIFICATION_FAILED', 'rate_limited'],
        ['synthetic-owner/slow', 'GITHUB_VERIFICATION_FAILED', 'timeout'], ['synthetic-owner/noauth', 'GITHUB_VERIFICATION_FAILED', 'not_authenticated'],
        ['synthetic-owner/renamed', 'REPOSITORY_MISMATCH', undefined],
      ]) {
        const res = await s.command({ type: 'connect', id: 'p1', repository: repo });
        assert.equal(res.json.code, code, `${repo}: ${res.text}`);
        if (kind) assert.deepEqual([res.status, res.json.kind], [502, kind]);
        assert.doesNotMatch(res.text, /\/(tmp|private|Users|var)\/|token|Bearer/i);
        assert.equal((await s.history(repo, 'p1')).status, 403);
      }
      assert.deepEqual(fs.readFileSync(path.join(cwd, 'data', 'app-state.json')), before, 'no failed verification wrote anything');
      sideEffectsOk(s);
    });
  });

  test('requests that would be refused never contact GitHub (invalid repo, demo, unverified, stale, duplicate, no Origin, forged verified)', async () => {
    const cwd = makeCwd(state([project('p1'), project('p2', { repository: 'synthetic-owner/other' }), project('demo', { dataMode: 'demo' }), project('odd', { dataMode: 'sample' })]));
    await withServer(cwd, async (s) => {
      const cases = [
        [{ type: 'connect', id: 'p1', repository: 'https://github.com/synthetic-owner/swiperight' }, 400],
        [{ type: 'connect', id: 'p1', repository: 'synthetic-owner/swiperight.git' }, 400],
        [{ type: 'connect', id: 'p1', repository: '../etc' }, 400],
        [{ type: 'connect', id: 'demo', repository: 'synthetic-owner/swiperight' }, 409],
        [{ type: 'connect', id: 'odd', repository: 'synthetic-owner/swiperight' }, 409],
        [{ type: 'connect', id: 'p1', repository: 'SYNTHETIC-OWNER/OTHER' }, 409],
        [{ type: 'connect', id: 'nope', repository: 'synthetic-owner/swiperight' }, 404],
        [{ type: 'connect', id: 'p1', repository: 'synthetic-owner/swiperight', verified: { fullName: 'synthetic-owner/swiperight', id: 1 } }, 400],
        [{ type: 'disconnect', id: 'p1' }, 409],
        [{ type: 'change', id: 'p1', repository: 'synthetic-owner/swiperight', confirmPreviousRepository: '' }, 409],
      ];
      for (const [command, status] of cases) assert.equal((await s.command(command)).status, status, JSON.stringify(command));
      assert.equal((await s.command({ type: 'connect', id: 'p1', repository: 'synthetic-owner/swiperight' }, { expectedVersion: 'f'.repeat(64) })).status, 409, 'stale');
      assert.equal((await s.command({ type: 'connect', id: 'p1', repository: 'synthetic-owner/swiperight' }, { origin: null })).status, 403, 'no Origin');
      assert.equal((await s.command({ type: 'connect', id: 'p1', repository: 'synthetic-owner/swiperight' }, { origin: 'http://evil.example' })).status, 403, 'foreign Origin');
      assert.deepEqual(s.gh(), [], 'not one GitHub request');
    });
  });

  test('GitHub full_name becomes the stored spelling; a different-case duplicate is refused across current and removed projects', async () => {
    const cwd = makeCwd(state([project('p1'), project('p2')]));
    await withServer(cwd, async (s) => {
      const res = await s.command({ type: 'connect', id: 'p1', repository: 'synthetic-owner/caserepo' });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.result.repository, 'Synthetic-Owner/CaseRepo');
      assert.equal((await s.history('Synthetic-Owner/CaseRepo', 'p1')).status, 200);
      assert.equal((await s.history('synthetic-owner/caserepo', 'p1')).status, 403, 'only the exact stored spelling');
      assert.equal((await s.command({ type: 'remove', id: 'p1', confirmProjectId: 'p1' })).status, 200);
      assert.equal((await s.command({ type: 'connect', id: 'p2', repository: 'SYNTHETIC-OWNER/caserepo' })).json.code, 'DUPLICATE_REPOSITORY', 'removed records still reserve their repository');
    });
  });
});

// ------------------------------------------------------------------------------------------------ 3. PM Dashboard legacy rule
describe('3. PM Dashboard strict legacy compatibility (Decision B)', () => {
  test('only the unique legacy record qualifies; lookalikes, duplicates, demo, wrong case and managed records do not', async () => {
    const variants = [
      ['unique legacy', [legacyPm()], 200],
      ['duplicate legacy records', [legacyPm(), legacyPm({ id: 'reg-pm-2' })], 403],
      ['duplicate id', [legacyPm(), project('reg-pm', { repository: 'synthetic-owner/other' })], 403],
      ['demo record', [legacyPm({ dataMode: 'demo' })], 403],
      ['malformed dataMode', [legacyPm({ dataMode: null })], 403],
      ['wrong case slug', [legacyPm({ repository: 'Augusliang23-web/PM-Dashboard' })], 403],
      ['URL spelling', [legacyPm({ repository: `https://github.com/${PM}` })], 403],
      ['managed record without connection', [legacyPm({ management: { lifecycle: 'active' } })], 403],
      ['archived', [legacyPm({ management: { lifecycle: 'archived' } })], 403],
    ];
    for (const [label, projects, status] of variants) {
      const cwd = makeCwd(state(projects));
      await withServer(cwd, async (s) => {
        assert.equal((await s.history(projects[0].repository, projects[0].id)).status, status, label);
        if (status === 403) assert.deepEqual(s.gh(), [], `${label}: no GitHub request`);
      });
    }
    const removed = makeCwd(state([project('x')], { projectManagement: { removed: [{ project: legacyPm(), removedAt: '2026-10-19T00:00:00.000Z', previousIndex: 0, previousLifecycle: 'active' }] } }));
    await withServer(removed, async (s) => assert.equal((await s.history(PM, 'reg-pm')).status, 403, 'a removed legacy record never qualifies'));
    await withServer(makeCwd(null), async (s) => assert.equal((await s.history(PM, 'reg-pm')).status, 403, 'no saved state: no fallback'));
  });

  test('an Edit persists the legacy authority as an auditable record; Archive revokes it; Restore does not bring it back', async () => {
    const cwd = makeCwd(state([legacyPm()]));
    await withServer(cwd, async (s) => {
      assert.equal((await s.command({ type: 'edit', id: 'reg-pm', patch: { tagline: 'renamed tagline' } })).status, 200);
      const c = (await s.projects()).projects[0].management.githubConnection;
      assert.deepEqual([c.status, c.source, c.repository], ['connected', 'legacy-pm-dashboard-compat', PM]);
      assert.equal((await s.history(PM, 'reg-pm')).status, 200, 'still readable after a metadata edit');
      assert.equal((await s.command({ type: 'archive', id: 'reg-pm' })).status, 200);
      assert.equal((await s.history(PM, 'reg-pm')).status, 403);
      assert.equal((await s.command({ type: 'restore', id: 'reg-pm' })).status, 200);
      assert.equal((await s.history(PM, 'reg-pm')).status, 403, 'restore requires an explicit reconnect');
      assert.equal((await s.command({ type: 'connect', id: 'reg-pm', repository: PM })).status, 200, 'explicit reconnect verifies and restores access');
      assert.equal((await s.history(PM, 'reg-pm')).status, 200);
    });
  });

  test('disconnecting the legacy PM record ends its access', async () => {
    const cwd = makeCwd(state([legacyPm()]));
    await withServer(cwd, async (s) => {
      assert.equal((await s.command({ type: 'disconnect', id: 'reg-pm' })).status, 200);
      assert.equal((await s.history(PM, 'reg-pm')).status, 403);
      assert.deepEqual(s.gh(), []);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 4. state integrity
describe('4. state integrity and fail-closed reads', () => {
  test('corrupt or invalid saved state authorizes nothing and is never rewritten', async () => {
    for (const raw of ['{"projects": [ truncated', JSON.stringify(state([legacyPm({ management: { githubConnection: { status: 'connected' } } })]))]) {
      const cwd = makeCwd(null, { raw });
      await withServer(cwd, async (s) => {
        assert.equal((await s.history(PM, 'reg-pm')).status, 403);
        assert.equal((await s.request('GET', '/api/projects')).status, 500);
        assert.deepEqual(s.gh(), []);
      });
      assert.equal(fs.readFileSync(path.join(cwd, 'data', 'app-state.json'), 'utf8'), raw);
    }
  });

  test('a hand-edited "connected" record for a different repository than the project grants nothing', async () => {
    const forged = legacyPm({ repository: 'synthetic-owner/other', management: { lifecycle: 'active', githubConnection: {
      status: 'connected', repository: PM, generation: 1, source: 'user-verified', connectedAt: '2026-10-19T00:00:00.000Z', verifiedRepositoryId: 1, revokedAt: null, revokedReason: null } } });
    await withServer(makeCwd(state([forged])), async (s) => {
      assert.equal((await s.history(PM, 'reg-pm')).status, 403);
      assert.equal((await s.history('synthetic-owner/other', 'reg-pm')).status, 403);
      assert.deepEqual(s.gh(), []);
    });
  });

  test('two projects claiming the same connected repository are both denied', async () => {
    const conn = (repo) => ({ lifecycle: 'active', githubConnection: { status: 'connected', repository: repo, generation: 1, source: 'user-verified', connectedAt: '2026-10-19T00:00:00.000Z', verifiedRepositoryId: 1, revokedAt: null, revokedReason: null } });
    const cwd = makeCwd(state([project('a', { repository: 'synthetic-owner/other', management: conn('synthetic-owner/other') }), project('b', { repository: 'synthetic-owner/other', management: conn('synthetic-owner/other') })]));
    await withServer(cwd, async (s) => {
      assert.equal((await s.history('synthetic-owner/other', 'a')).status, 403);
      assert.equal((await s.history('synthetic-owner/other')).status, 403);
    });
  });

  test('concurrent connect attempts from one version: at most one succeeds, no lost or double authority', async () => {
    const cwd = makeCwd(state([project('p1'), project('p2')]));
    await withServer(cwd, async (s) => {
      const v = (await s.projects()).version;
      const results = await Promise.all([
        s.command({ type: 'connect', id: 'p1', repository: 'synthetic-owner/swiperight' }, { expectedVersion: v }),
        s.command({ type: 'connect', id: 'p2', repository: 'synthetic-owner/swiperight' }, { expectedVersion: v }),
        s.command({ type: 'connect', id: 'p2', repository: 'synthetic-owner/other' }, { expectedVersion: v }),
      ]);
      assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join(','));
      assert.ok(results.every((r) => [200, 409, 423].includes(r.status)), results.map((r) => r.text).join('\n'));
      assert.equal((await s.projects()).githubAuthorizations.length, 1);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 5. F3 verified identity binding
describe('5. (F3) every GitHub answer must match the verified repository identity', () => {
  test('id change (transfer), rename, foreign PR base or missing identity after connect: 403, nothing used, nothing cached', async () => {
    const repos = ['synthetic-owner/transferred', 'synthetic-owner/renamed-later', 'synthetic-owner/foreign-base', 'synthetic-owner/no-identity'];
    const cwd = makeCwd(state(repos.map((r, i) => project(`p${i}`))));
    await withServer(cwd, async (s) => {
      for (const [i, repo] of repos.entries()) {
        assert.equal((await s.command({ type: 'connect', id: `p${i}`, repository: repo })).status, 200, repo);
        for (let attempt = 0; attempt < 2; attempt += 1) { // a second read proves nothing was cached from the refused read
          const res = await s.history(repo, `p${i}`);
          assert.deepEqual([res.status, res.json.kind], [403, 'forbidden'], `${repo}: ${res.text}`);
          assert.match(res.json.error, /does not match the authorized repository/);
        }
        // PR detail verifies its OWN base repository identity: refused when that identity is wrong; for no-identity only the
        // repository metadata lacked identity while the PR base is correct, so history is refused but the PR detail is not.
        assert.equal((await s.pull(repo, `p${i}`)).status, repo === 'synthetic-owner/no-identity' ? 200 : 403, `${repo} PR detail`);
      }
    });
  });

  test('a fork PR (head in another repository, base in this one) is accepted and the head repository stays separate', async () => {
    const cwd = makeCwd(state([project('p1')]));
    await withServer(cwd, async (s) => {
      assert.equal((await s.command({ type: 'connect', id: 'p1', repository: 'synthetic-owner/fork-pr' })).status, 200);
      const res = await s.history('synthetic-owner/fork-pr', 'p1');
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.repository, 'synthetic-owner/fork-pr');
      assert.equal(res.json.pulls[0].headRepo, 'someone-else/fork', 'the fork head keeps its own repository');
      assert.ok(!res.json.branches.some((b) => b.name === 'someone-else/fork'));
      assert.equal((await s.pull('synthetic-owner/fork-pr', 'p1')).status, 200);
    });
  });

  test('a user-verified record without a verified repository id grants nothing (hand-edited state)', async () => {
    const unpinned = project('p1', { repository: 'synthetic-owner/other', management: { lifecycle: 'active', githubConnection: {
      status: 'connected', repository: 'synthetic-owner/other', generation: 1, source: 'user-verified', connectedAt: '2026-10-19T00:00:00.000Z', verifiedRepositoryId: null, revokedAt: null, revokedReason: null } } });
    await withServer(makeCwd(state([unpinned])), async (s) => {
      assert.equal((await s.history('synthetic-owner/other', 'p1')).status, 403);
      assert.deepEqual((await s.projects()).githubAuthorizations, []);
      assert.deepEqual(s.gh(), []);
    });
  });
});

// ------------------------------------------------------------------------------------------------ 6. F2 global repository conflicts
describe('6. (F2) a repository named by ANY other saved record grants no authority to anyone', () => {
  const conn = (repo) => ({ lifecycle: 'active', githubConnection: { status: 'connected', repository: repo, generation: 1, source: 'user-verified', connectedAt: '2026-10-19T00:00:00.000Z', verifiedRepositoryId: 103, revokedAt: null, revokedReason: null } });
  const connected = () => project('live', { repository: 'synthetic-owner/other', management: conn('synthetic-owner/other') });
  const variants = [
    ['unconnected current record', project('x', { repository: 'synthetic-owner/other' })],
    ['archived record', project('x', { repository: 'synthetic-owner/other', management: { lifecycle: 'archived' } })],
    ['disconnected record', project('x', { repository: 'synthetic-owner/other', management: { lifecycle: 'active', githubConnection: { status: 'disconnected', repository: 'synthetic-owner/other', generation: 2, source: 'user-verified', connectedAt: '2026-10-19T00:00:00.000Z', verifiedRepositoryId: 103, revokedAt: '2026-10-19T01:00:00.000Z', revokedReason: 'disconnected' } } })],
    ['demo record', project('x', { repository: 'synthetic-owner/other', dataMode: 'demo' })],
    ['different case', project('x', { repository: 'Synthetic-Owner/OTHER' })],
    ['URL spelling', project('x', { repository: 'https://github.com/synthetic-owner/other.git' })],
  ];
  for (const [label, other] of variants) {
    test(`${label}`, async () => {
      await withServer(makeCwd(state([connected(), other])), async (s) => {
        assert.equal((await s.history('synthetic-owner/other', 'live')).status, 403, label);
        assert.deepEqual(s.gh(), [], `${label}: no GitHub request`);
      });
    });
  }
  test('removed record', async () => {
    const removed = { projectManagement: { removed: [{ project: project('x', { repository: 'synthetic-owner/other' }), removedAt: '2026-10-19T00:00:00.000Z', previousIndex: 1, previousLifecycle: 'active' }] } };
    await withServer(makeCwd(state([connected()], removed)), async (s) => {
      assert.equal((await s.history('synthetic-owner/other', 'live')).status, 403);
      assert.deepEqual(s.gh(), []);
    });
  });
  test('the legacy PM rule obeys the same gate (a demo or removed record naming pm-dashboard ends it)', async () => {
    for (const extra of [{ projects: [legacyPm(), project('d', { repository: PM, dataMode: 'demo' })] }, { projects: [legacyPm()], removed: [project('r', { repository: `https://github.com/${PM}` })] }]) {
      const pm = extra.removed ? { projectManagement: { removed: extra.removed.map((p) => ({ project: p, removedAt: '2026-10-19T00:00:00.000Z', previousIndex: 1, previousLifecycle: 'active' })) } } : {};
      await withServer(makeCwd(state(extra.projects, pm)), async (s) => {
        assert.equal((await s.history(PM, 'reg-pm')).status, 403);
        assert.deepEqual(s.gh(), []);
      });
    }
  });
});
