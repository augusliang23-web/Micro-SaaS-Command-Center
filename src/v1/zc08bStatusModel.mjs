// ZC-08B1: pure synthetic evidence normalizer. No fetch, provider or heartbeat.
// DO NOT treat the output as real GitHub evidence until a separate trusted
// allowlisted reader and exact-head provenance layer have been approved.
const LAB='augusliang23-web/cc-h15a-claude-dispatch-lab';
const CONSOLE='augusliang23-web/Micro-SaaS-Command-Center';
export const FIXED_TARGETS=Object.freeze([
 Object.freeze({id:'ZC06C',workstream:'ZC-06C',repo:LAB,pr:36,workflow:'AG2B offline safety CI'}),
 Object.freeze({id:'ZC07',workstream:'ZC-07',repo:LAB,pr:37,workflow:'ZC07 synthetic Zero-Copy E2E (no provider)'}),
 Object.freeze({id:'ZC09A',workstream:'ZC-09',repo:LAB,pr:39,workflow:'ZC09A offline Auto-Continue policy CI'}),
 Object.freeze({id:'ZC09B1',workstream:'ZC-09',repo:LAB,pr:42,workflow:'ZC09B1 synthetic claim ledger CI'}),
 Object.freeze({id:'ZC09B2',workstream:'ZC-09',repo:LAB,pr:44,workflow:'ZC09B2 isolated fixture CAS CI'}),
 Object.freeze({id:'ZC08A',workstream:'ZC-08',repo:CONSOLE,pr:97,workflow:'ZC08A isolated Live Monitor QA'}),
]);
const shape=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const iso=x=>{
 if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x))return NaN;
 const t=Date.parse(x);
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===x.slice(0,19)?t:NaN;
};
const WORKFLOW_STATUS=['queued','in_progress','completed'];
const CONCLUSIONS=['success','failure','skipped','cancelled','timed_out','action_required'];
const ciValid=x=>shape(x,['name','headSha','status','conclusion'])&&
 typeof x.name==='string'&&x.name.length>0&&x.name.length<=128&&sha(x.headSha)&&
 WORKFLOW_STATUS.includes(x.status)&&
 (x.status==='completed'?CONCLUSIONS.includes(x.conclusion):x.conclusion===null);
const reviewValid=x=>x===null||(shape(x,['headSha','status','hasAnyFindings','hasUnresolvedFindings'])&&
 sha(x.headSha)&&['running','completed','failed'].includes(x.status)&&
 (x.status==='completed'?(typeof x.hasAnyFindings==='boolean'&&
 typeof x.hasUnresolvedFindings==='boolean'):
 x.hasAnyFindings===null&&x.hasUnresolvedFindings===null));
const prValid=(x,t)=>shape(x,['number','headSha','draft','merged'])&&
 x.number===t.pr&&sha(x.headSha)&&
 typeof x.draft==='boolean'&&typeof x.merged==='boolean'&&
 !(x.draft&&x.merged);
const reviewOf=(review,head)=>{
 if(review===null)return 'UNKNOWN';
 if(review.headSha!==head)return 'STALE';
 if(review.status==='running')return 'RUNNING';
 if(review.status==='failed')return 'FAILED';
 if(review.hasAnyFindings||review.hasUnresolvedFindings)return 'FINDINGS';
 return 'NO_NEW_MAJOR_FINDINGS'; // NEVER use "APPROVED".
};
const ciOf=(runs,target,head)=>{
 const relevant=runs.filter(r=>r.name===target.workflow);
 if(relevant.length===0)return 'UNKNOWN';
 const exact=relevant.filter(r=>r.headSha===head);
 if(exact.length===0)return 'STALE';
 if(exact.length!==1)return 'UNKNOWN'; // no reliable timestamps to rank runs
 const r=exact[0];
 if(r.status==='queued')return 'QUEUED';
 if(r.status==='in_progress')return 'RUNNING';
 return ({success:'PASS',failure:'FAIL',skipped:'SKIPPED',
  cancelled:'CANCELLED',timed_out:'FAILED',action_required:'BLOCKED'})[r.conclusion];
};
const safe=(t,head=null,reason='UNVERIFIED')=>({
 provenance:'SYNTHETIC_FIXTURE_ONLY',
 id:t.id,workstream:t.workstream,repo:t.repo,pr:t.pr,
 url:'https://github.com/'+t.repo+'/pull/'+t.pr,
 head,ci:'UNKNOWN',review:'UNKNOWN',status:'UNKNOWN',
 agent:'NOT_CONNECTED',reason,
});
export function normalizeMockStatus({targetId,pr,workflows,review,sourceState,observedAt,now}={}){
 const t=FIXED_TARGETS.find(x=>x.id===targetId);
 if(!t)return {provenance:'SYNTHETIC_FIXTURE_ONLY',status:'REJECTED_TARGET',
  agent:'NOT_CONNECTED',reason:'NOT_ALLOWLISTED'};
 if(!['OK','FAILED'].includes(sourceState))return safe(t,null,'SOURCE_NOT_VERIFIED');
 if(sourceState==='FAILED')return {...safe(t,null,'SOURCE_UNAVAILABLE'),status:'STALE'};
 if(!Number.isFinite(iso(observedAt))||!Number.isFinite(iso(now))||
    iso(observedAt)>iso(now)||iso(now)-iso(observedAt)>300000)
  return {...safe(t,null,'TIMESTAMP_STALE_OR_INVALID'),status:'STALE'};
 if(!prValid(pr,t)||!Array.isArray(workflows)||workflows.length>8||
    !workflows.every(ciValid)||!reviewValid(review))
  return safe(t,null,'INVALID_OR_INCOMPLETE_SNAPSHOT');
 const ci=ciOf(workflows,t,pr.headSha),qa=reviewOf(review,pr.headSha);
 return {provenance:'SYNTHETIC_FIXTURE_ONLY',id:t.id,workstream:t.workstream,
  repo:t.repo,pr:t.pr,url:'https://github.com/'+t.repo+'/pull/'+t.pr,
  head:pr.headSha,ci,review:qa,
  status:pr.merged?'MERGED':
   (['FAIL','FAILED','BLOCKED'].includes(ci)||qa==='FINDINGS'||qa==='FAILED'?'HOLD':
    (ci==='PASS'&&qa==='NO_NEW_MAJOR_FINDINGS'?'READY_FOR_REVIEW':'PARTIAL')),
  agent:'NOT_CONNECTED',
  reason:ci==='PASS'&&qa==='NO_NEW_MAJOR_FINDINGS'?'MOCK_EVIDENCE_COMPLETE':
   'DO_NOT_INFER_AGENT_ACTIVITY'};
}
export const MOCK_INPUT=Object.freeze({
 targetId:'ZC09B1',
 pr:{number:42,headSha:'a'.repeat(40),draft:true,merged:false},
 workflows:[{name:'ZC09B1 synthetic claim ledger CI',headSha:'a'.repeat(40),
  status:'completed',conclusion:'success'}],
 review:{headSha:'a'.repeat(40),status:'completed',
  hasAnyFindings:false,hasUnresolvedFindings:false},
 sourceState:'OK',observedAt:'2026-11-01T01:00:00Z',
 now:'2026-11-01T01:00:03Z'
});
