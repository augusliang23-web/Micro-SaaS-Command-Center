import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMockStatus,FIXED_TARGETS,MOCK_INPUT}
 from '../src/v1/zc08bStatusModel.mjs';
const trial=edit=>{const x=structuredClone(MOCK_INPUT);edit?.(x);return normalizeMockStatus(x);};
const basic=r=>{
 assert.equal(r.provenance,'SYNTHETIC_FIXTURE_ONLY');
 assert.equal(r.agent,'NOT_CONNECTED');
 assert.equal(JSON.stringify(r).includes('RUNNING_AGENT'),false);
 return r;
};
test('SM01 fixed six PR targets cover four workstreams',()=>{
 assert.equal(FIXED_TARGETS.length,6);
 assert.equal(new Set(FIXED_TARGETS.map(x=>x.workstream)).size,4);
 assert.equal(new Set(FIXED_TARGETS.map(x=>x.id)).size,6);
});
test('SM02 synthetic exact-head CI and Code Review are READY_FOR_REVIEW, not deployed',()=>{
 const r=basic(trial());
 assert.equal(r.ci,'PASS');assert.equal(r.review,'NO_NEW_MAJOR_FINDINGS');
 assert.equal(r.status,'READY_FOR_REVIEW');
 assert.equal(r.agent,'NOT_CONNECTED');
});
test('SM03 unknown target is always rejected',()=>{
 const r=basic(trial(x=>{x.targetId='OTHER_REPOSITORY';}));
 assert.equal(r.status,'REJECTED_TARGET');
 assert.equal(r.reason,'NOT_ALLOWLISTED');
});
test('SM04 forged target id using object fails closed',()=>{
 assert.equal(trial(x=>{x.targetId={id:'ZC09B1'};}).status,'REJECTED_TARGET');
});
test('SM05 missing PR data is not verified',()=>{
 const r=basic(trial(x=>{x.pr=null;}));
 assert.equal(r.status,'UNKNOWN');
});
test('SM06 different PR number cannot impersonate allowlisted identity',()=>{
 const r=basic(trial(x=>{x.pr.number=36;}));
 assert.equal(r.status,'UNKNOWN');
});
test('SM07 forged short SHA cannot match',()=>{
 const r=basic(trial(x=>{x.pr.headSha='HEAD';}));
 assert.equal(r.status,'UNKNOWN');
});
test('SM08 CI on old SHA is STALE and never READY_FOR_REVIEW',()=>{
 const r=basic(trial(x=>{x.workflows[0].headSha='b'.repeat(40);}));
 assert.equal(r.ci,'STALE');assert.equal(r.status,'PARTIAL');
});
test('SM09 Codex review on older SHA cannot approve new head',()=>{
 const r=basic(trial(x=>{x.review.headSha='b'.repeat(40);}));
 assert.equal(r.review,'STALE');assert.equal(r.status,'PARTIAL');
});
test('SM10 no workflow run means UNKNOWN, never PASS',()=>{
 const r=basic(trial(x=>{x.workflows=[];}));
 assert.equal(r.ci,'UNKNOWN');assert.equal(r.status,'PARTIAL');
});
test('SM11 skipped workflow is not PASS',()=>{
 const r=basic(trial(x=>{x.workflows[0].conclusion='skipped';}));
 assert.equal(r.ci,'SKIPPED');assert.equal(r.status,'PARTIAL');
});
test('SM12 queued workflow never claims verified state',()=>{
 const r=basic(trial(x=>{x.workflows[0].status='queued';x.workflows[0].conclusion=null;}));
 assert.equal(r.ci,'QUEUED');assert.equal(r.agent,'NOT_CONNECTED');
});
test('SM13 running CI is not a running agent',()=>{
 const r=basic(trial(x=>{x.workflows[0].status='in_progress';x.workflows[0].conclusion=null;}));
 assert.equal(r.ci,'RUNNING');assert.equal(r.agent,'NOT_CONNECTED');
});
test('SM14 CI failure is HOLD',()=>{
 const r=basic(trial(x=>{x.workflows[0].conclusion='failure';}));
 assert.equal(r.ci,'FAIL');assert.equal(r.status,'HOLD');
});
test('SM15 Code Review findings are HOLD even if CI green',()=>{
 const r=basic(trial(x=>{x.review.hasAnyFindings=true;x.review.hasUnresolvedFindings=true;}));
 assert.equal(r.review,'FINDINGS');assert.equal(r.status,'HOLD');
});
test('SM16 completed Review has no findings but is not OWNER APPROVED',()=>{
 const r=basic(trial());
 assert.ok(!JSON.stringify(r).includes('OWNER_APPROVED'));
 assert.ok(!JSON.stringify(r).includes('APPROVED'));
});
test('SM17 Code Review running cannot be treated as finished',()=>{
 const r=basic(trial(x=>{x.review.status='running';x.review.hasAnyFindings=null;x.review.hasUnresolvedFindings=null;}));
 assert.equal(r.review,'RUNNING');assert.equal(r.status,'PARTIAL');
});
test('SM18 Code Review failed or quota failed is not approval',()=>{
 const r=basic(trial(x=>{x.review.status='failed';x.review.hasAnyFindings=null;x.review.hasUnresolvedFindings=null;}));
 assert.equal(r.review,'FAILED');assert.equal(r.status,'HOLD');
});
test('SM19 failed data source degrades to STALE even if cached fixture looks green',()=>{
 const r=basic(trial(x=>{x.sourceState='FAILED';}));
 assert.equal(r.status,'STALE');assert.equal(r.ci,'UNKNOWN');
});
test('SM20 missing or stale source timestamp cannot support verified status',()=>{
 const r=basic(trial(x=>{x.now='2026-11-01T01:06:00Z';}));
 assert.equal(r.status,'STALE');
});
test('SM21 source observation from future cannot verify snapshot',()=>{
 const r=basic(trial(x=>{x.now='2026-11-01T00:59:59Z';}));
 assert.equal(r.status,'STALE');
});
test('SM22 malformed ISO timestamp fails closed',()=>{
 const r=basic(trial(x=>{x.observedAt='2026-11-31T01:00:00Z';}));
 assert.equal(r.status,'STALE');
});
test('SM23 unknown extra PR property cannot contaminate safe output',()=>{
 const r=basic(trial(x=>{x.pr.privateToken='SYNTHETIC_SECRET';}));
 assert.equal(r.status,'UNKNOWN');
 assert.ok(!JSON.stringify(r).includes('SYNTHETIC_SECRET'));
});
test('SM24 unexpected workflow fields fail closed',()=>{
 const r=basic(trial(x=>{x.workflows[0].secrets='SYNTHETIC_SECRET';}));
 assert.equal(r.status,'UNKNOWN');
 assert.ok(!JSON.stringify(r).includes('SYNTHETIC_SECRET'));
});
test('SM25 unsupported running completion combination fails closed',()=>{
 const r=basic(trial(x=>{x.workflows[0].status='in_progress';}));
 assert.equal(r.status,'UNKNOWN');
});
test('SM26 duplicate exact-head CI runs without ordering metadata are UNKNOWN',()=>{
 const r=basic(trial(x=>{x.workflows.push(structuredClone(x.workflows[0]));}));
 assert.equal(r.ci,'UNKNOWN');assert.equal(r.status,'PARTIAL');
});
test('SM27 wrong workflow name cannot verify this target',()=>{
 const r=basic(trial(x=>{x.workflows[0].name='Another workflow';}));
 assert.equal(r.ci,'UNKNOWN');
});
test('SM28 raw comments and secret fields never pass through returned payload',()=>{
 const r=basic(trial(x=>{x.review.rawComment='SHOULD_NOT_APPEAR';}));
 assert.equal(r.status,'UNKNOWN');
 assert.ok(!JSON.stringify(r).includes('SHOULD_NOT_APPEAR'));
});
test('SM29 malformed review boolean types rejected',()=>{
 const r=basic(trial(x=>{x.review.hasUnresolvedFindings='false';}));
 assert.equal(r.review,'UNKNOWN');
});
test('SM30 workflow list is capped and unsupported input fails closed',()=>{
 const r=basic(trial(x=>{x.workflows=Array(9).fill(null).map(()=>structuredClone(x.workflows[0]));}));
 assert.equal(r.status,'UNKNOWN');
});
test('SM31 static URL derives only from allowlisted identities',()=>{
 const r=basic(trial());
 assert.equal(r.url,'https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/pull/42');
});
test('SM32 non-draft merged PR is not treated as running',()=>{
 const r=basic(trial(x=>{x.pr.draft=false;x.pr.merged=true;}));
 assert.equal(r.status,'MERGED');assert.equal(r.agent,'NOT_CONNECTED');
});
test('SM33 inconsistent merged+draft PR fails closed',()=>{
 const r=basic(trial(x=>{x.pr.merged=true;}));
 assert.equal(r.status,'UNKNOWN');
});
test('SM34 fixtures across each target produce its own static PR identity',()=>{
 for(const t of FIXED_TARGETS){
  const r=basic(trial(x=>{
   x.targetId=t.id;x.pr.number=t.pr;x.workflows[0].name=t.workflow;
  }));
  assert.equal(r.id,t.id);assert.equal(r.pr,t.pr);
  assert.equal(r.status,'READY_FOR_REVIEW');
 }
});
