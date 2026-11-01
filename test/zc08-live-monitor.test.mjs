import test from 'node:test';
import assert from 'node:assert/strict';
import { beginMonitorRefresh, historyFreshness, monitorSummary, validateMonitorHistory, MONITOR_POLL_MS } from '../src/v1/liveMonitorModel.mjs';

const REPO='augusliang23-web/pm-dashboard';
const NOW=Date.parse('2026-11-01T02:00:00.000Z');
const SHA='0123456789abcdef0123456789abcdef01234567';
const pr=(number, updatedAt, status='draft')=>({
  number,title:'synthetic pull ' + number, url:'https://github.com/' + REPO + '/pull/' + number,
  status,headSha:SHA,updatedAt,
});
const history=(extras={})=>({
  source:'GitHub',repository:REPO,fetchedAt:'2026-11-01T01:59:00.000Z',
  status:'complete', pulls:[pr(37,'2026-11-01T01:53:00.000Z'),pr(36,'2026-11-01T01:58:00.000Z','open')],
  ...extras,
});
test('ZC08-01 only exact repository/source and full PR URL are accepted',()=>{
  assert.equal(validateMonitorHistory(history(),REPO),true);
  assert.equal(validateMonitorHistory(history(), 'augusliang23-web/other-repo'),false);
  assert.equal(validateMonitorHistory(history({source:'Fixture'}),REPO),false);
  assert.equal(validateMonitorHistory(history({pulls:[{...pr(36,'2026-11-01T01:58:00Z'),url:'https://evil.example/'}]}),REPO),false);
});
test('ZC08-02 malformed data and unknown head cannot masquerade as verified source',()=>{
  assert.equal(validateMonitorHistory(null,REPO),false);
  assert.equal(validateMonitorHistory(history({fetchedAt:'not-time'}),REPO),false);
  assert.equal(validateMonitorHistory(history({pulls:[{...pr(36,'2026-11-01T01:58:00Z'),headSha:'abcd'}]}),REPO),false);
});
test('ZC08-03 cached snapshot truthfully uses source fetchedAt not browser poll time',()=>{
  assert.deepEqual(historyFreshness(history(),NOW),{state:'AVAILABLE',ageSeconds:60});
  assert.equal(MONITOR_POLL_MS,30_000);
});
test('ZC08-04 old and suspicious future source clocks fail closed as STALE',()=>{
  assert.equal(historyFreshness(history({fetchedAt:'2026-11-01T01:50:00Z'}),NOW).state,'STALE');
  assert.equal(historyFreshness(history({fetchedAt:'2026-11-01T02:03:00Z'}),NOW).state,'STALE');
  assert.equal(historyFreshness({},NOW).state,'UNKNOWN');
});
test('ZC08-05 partial provenance remains PARTIAL and not AVAILABLE',()=>{
  assert.equal(historyFreshness(history({status:'partial'}),NOW).state,'PARTIAL');
});
test('ZC08-06 PR event ordering uses observed update timestamps',()=>{
  const result=monitorSummary(history(),NOW);
  assert.deepEqual(result.events.map(e=>e.number),[36,37]);
  assert.equal(result.prCount,2);assert.equal(result.open,2);assert.equal(result.draft,1);
});
test('ZC08-07 GitHub PR activity never implies model execution, CI or Codex PASS',()=>{
  const result=monitorSummary(history(),NOW);
  assert.equal(result.agent,'UNKNOWN');
  assert.equal(result.ci,'NOT_CHECKED');
  assert.equal(result.codex,'NOT_CHECKED');
});
test('ZC08-08 missing data shows unknown counts rather than zero',()=>{
  const result=monitorSummary(null,NOW);
  assert.equal(result.prCount,null);
  assert.equal(result.open,null);
  assert.equal(result.state,'UNKNOWN');
  assert.deepEqual(result.events,[]);
});
test('ZC08-09 event view caps history to 12 entries',()=>{
  const pulls=Array.from({length:30},(_,i)=>pr(i+1,'2026-11-01T01:59:00Z'));
  const result=monitorSummary(history({pulls}),NOW);
  assert.equal(result.events.length,12);
  assert.equal(result.prCount,30);
});

test('ZC08-10 retry must retain last UNAVAILABLE error until verified success',()=>{
  const original={repo:REPO,history:history(),checkedAt:'2026-11-01T01:59:00Z',
    error:'HTTP 429',busy:false,lastRequest:'2026-11-01T01:59:00Z'};
  const retried=beginMonitorRefresh(original,REPO,'2026-11-01T02:00:00Z');
  assert.equal(retried.busy,true);
  assert.equal(retried.error,'HTTP 429');
  assert.equal(retried.history,original.history);
  assert.equal(retried.lastRequest,'2026-11-01T02:00:00Z');
});
