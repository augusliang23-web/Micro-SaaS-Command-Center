import assert from 'node:assert/strict';
import test from 'node:test';
import { getVerdict, pickMostUrgent } from '../src/verdict.mjs';
import { githubSnapshot } from '../src/test/githubSnapshots.mjs';
const now = Date.parse('2026-10-03T02:00:00Z');
const fresh = { checkedAt: '2026-10-03T01:59:00Z', availability: 'AVAILABLE', now };
const project = { repository: 'owner/repo', waitingState: 'AI_RUNNING', health: 'Healthy' };
const derive = (data, options = fresh) => getVerdict(project, githubSnapshot(data), options);

test('observed idle never implies AI execution despite saved AI_RUNNING', () => {
 const v = derive({ state:'none' });
 assert.equal(v.status,'IDLE'); assert.equal(v.isWaiting,false); assert.doesNotMatch(v.headline,/AI/);
});
test('no checks cannot be presented as passing or merge-ready', () => {
 const v = derive({state:'open',ciStatus:'none',reviewDecision:'review_required'});
 assert.equal(v.status,'NEEDS_CONFIRMATION'); assert.equal(v.checksPassed,false);
 assert.match(v.explanation,/尚未取得自動檢查結果/); assert.doesNotMatch(v.headline,/通過|可以繼續/);
});
test('open PR still needs review when checks pass', () => {
 const v = derive({state:'open',ciStatus:'passing',reviewDecision:'review_required'});
 assert.equal(v.status,'NEEDS_CONFIRMATION'); assert.match(v.explanation,/等待審查/);
});
test('explicit CI execution is in progress without claiming an AI agent is running', () => {
 const v = derive({state:'open',ciStatus:'running'});
 assert.equal(v.status,'IN_PROGRESS'); assert.match(v.headline,/自動檢查/); assert.doesNotMatch(v.headline,/AI/);
});
test('failing checks and requested changes block even draft work', () => {
 for (const data of [{state:'open',isDraft:true,ciStatus:'failing'},{state:'open',reviewDecision:'changes_requested'}])
 assert.equal(derive(data).status,'BLOCKED');
});
test('missing, stale, failed and invalid evidence are UNKNOWN without manual fallback', () => {
 for (const options of [{now},{...fresh,checkedAt:'2026-10-02T01:00:00Z'},{...fresh,availability:'UNAVAILABLE'},{...fresh,checkedAt:'bad'},{...fresh,checkedAt:'2026-10-04T01:00:00Z'}]) {
 const v=derive({state:'none'},options); assert.equal(v.status,'UNKNOWN'); assert.equal(v.checksPassed,false);
 }
 assert.equal(derive(null).status,'UNKNOWN'); assert.equal(derive({state:'nonsense'}).status,'UNKNOWN');
});
test('merged PR is idle and proves neither checks nor deployment', () => {
 const v=derive({state:'merged',prNumber:9,mergedAt:'2026-10-02T00:00:00Z'});
 assert.equal(v.status,'IDLE'); assert.equal(v.checksPassed,false); assert.equal(v.deployed,false);
 assert.match(v.explanation,/部署狀態尚未確認/);
});
test('draft and direct commits do not imply ongoing AI execution', () => {
 assert.equal(derive({state:'open',isDraft:true,ciStatus:'none'}).status,'NEEDS_CONFIRMATION');
 assert.equal(derive({state:'active',ciStatus:'passing'}).status,'IDLE');
 assert.equal(derive({state:'active',ciStatus:'none'}).status,'NEEDS_CONFIRMATION');
});
test('raw idle or running without observed provenance is unknown', () => {
 for(const waitingState of ['AI_RUNNING','AUTOMATION_IDLE'])
 assert.equal(getVerdict({waitingState}).status,'UNKNOWN');
});
test('recommendations ignore idle/in-progress and rank blocked before confirmation/unknown', () => {
 assert.equal(pickMostUrgent([{status:'IDLE'},{status:'IN_PROGRESS'}]),-1);
 assert.equal(pickMostUrgent([{status:'UNKNOWN'},{status:'NEEDS_CONFIRMATION'},{status:'BLOCKED'}]),2);
});

test('all demo and explicit demo-marked repositories are excluded from real selection', async () => {
 const {isRealProject} = await import('../src/verdict.mjs');
 const projects=[{repository:'owner/real'},{repository:'github.com/my-org/demo'},{repository:'owner/example',dataMode:'demo'},{repository:''}];
 assert.deepEqual(projects.filter(isRealProject),[{repository:'owner/real'}]);
});
test('unknown is attention and every canonical filter uses the same status', async () => {
 const {needsAttention,matchesStatusFilter}=await import('../src/verdict.mjs');
 for(const [status,attention,running] of [['IDLE',false,false],['IN_PROGRESS',false,true],['NEEDS_CONFIRMATION',true,false],['BLOCKED',true,false],['UNKNOWN',true,false]]) {
  const v={status}; assert.equal(needsAttention(v),attention); assert.equal(matchesStatusFilter(v,'attention'),attention);
  assert.equal(matchesStatusFilter(v,'running'),running); assert.equal(matchesStatusFilter(v,status),true);
 }
});
test('checked-time ordering puts newest verified observation first and unknown times last', async () => {
 const {compareCheckedAt}=await import('../src/verdict.mjs');
 const values=[{id:'missing'}, {id:'older',checkedAt:'2026-10-03T01:00:00Z',sourceState:'AVAILABLE'}, {id:'failed',checkedAt:'2026-10-03T03:00:00Z',sourceState:'UNAVAILABLE'}, {id:'newer',checkedAt:'2026-10-03T02:00:00Z',sourceState:'AVAILABLE'}];
 assert.deepEqual(values.sort(compareCheckedAt).map(v=>v.id),['newer','older','missing','failed']);
});

test('homepage unknown filter includes UNKNOWN and excludes observed idle', async () => {
 const {matchesStatusFilter}=await import('../src/verdict.mjs');
 assert.equal(matchesStatusFilter({status:'UNKNOWN'},'unknown'),true);
 assert.equal(matchesStatusFilter({status:'IDLE'},'unknown'),false);
});

test('malformed fields and inconsistent states never fabricate checks, idle or execution', () => {
 for(const data of [{state:'merged'}, {state:'merged',prNumber:9,mergedAt:'bad'}, {state:'merged',ciStatus:'running'}, {state:'none',ciStatus:'running'}, {state:'none',reviewDecision:'changes_requested'}, {state:'open',isDraft:'false',ciStatus:'passing'}, {state:'active',lastCommitSha:null,ciStatus:'passing'}]) {
  const v=getVerdict(project,data,fresh);assert.equal(v.status,'UNKNOWN');assert.equal(v.checksPassed,false);assert.equal(v.sourceState,'UNAVAILABLE');
 }
});

test('queued CI is confirmation work rather than execution evidence', () => {
 const v=derive({state:'open',ciStatus:'pending'});
 assert.equal(v.status,'NEEDS_CONFIRMATION');assert.equal(v.isWaiting,false);assert.match(v.explanation,/等待執行/);
});
