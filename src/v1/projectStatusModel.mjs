import { FIXED_TARGETS, normalizeMockStatus } from './zc08bStatusModel.mjs';
import { catalogEntry } from './projectCatalog.mjs';

const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const instant=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
export const unknownStatus=(target,reason='NOT_CHECKED')=>({id:target.id,repo:target.repo,pr:target.pr,
 workstream:target.workstream,url:`https://github.com/${target.repo}/pull/${target.pr}`,
 head:null,ci:'UNKNOWN',review:'UNKNOWN',status:'UNKNOWN',agent:'NOT_CONNECTED',reason});

/** A trusted server GET envelope is required before reusing B1's pure exact-head computation.
 * Never relabel its fixtures as live. Raw reviews are observations, not Gate approval or a clean QA result.
 */
export function statusFromGitHub(target, evidence, nowMs=Date.now()) {
 const safe=unknownStatus(target,'INVALID_SOURCE');
 if(!FIXED_TARGETS.some(t=>t.id===target.id&&t.repo===target.repo&&t.pr===target.pr))return safe;
 const entry=catalogEntry(target.repo);
 if(!evidence||evidence.source!=='GitHub'||evidence.repository!==target.repo||evidence.repositoryId!==entry?.id||
  evidence.number!==target.pr||!sha(evidence.head)||!instant(evidence.observedAt)||!Number.isFinite(nowMs))return safe;
 const age=nowMs-Date.parse(evidence.observedAt);
 if(age<0||age>300000||evidence.consistent!==true)return {...safe,status:'STALE',reason:'STALE_OR_HEAD_CHANGED'};
 const normalized=normalizeMockStatus({targetId:target.id,pr:evidence.pull,
  workflows:evidence.workflows,review:null,sourceState:'OK',
  observedAt:new Date(evidence.observedAt).toISOString().replace(/\.\d{3}Z$/,'Z'),
  now:new Date(nowMs).toISOString().replace(/\.\d{3}Z$/,'Z')});
 if(evidence.pull?.headSha!==evidence.head)return safe;
 return {...normalized,provenance:'GITHUB_READ_ONLY',source:'GitHub',repositoryId:entry.id,
  observedAt:evidence.observedAt,review:'UNKNOWN',agent:'NOT_CONNECTED',
  status:normalized.ci==='FAIL'||normalized.ci==='BLOCKED'||normalized.ci==='FAILED'?'HOLD':
   normalized.status==='UNKNOWN'||normalized.status==='STALE'?normalized.status:'PARTIAL',
  // Safe URLs are constructed from the trusted target, never a supplied external URL.
  ciUrl:`https://github.com/${target.repo}/actions${Number.isSafeInteger(evidence.ciRunId)&&evidence.ciRunId>0?'/runs/'+evidence.ciRunId:''}`,
  codex:Array.isArray(evidence.codex)?evidence.codex.filter(r=>r&&sha(r.headSha)&&
   ['COMMENTED','APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state)&&Number.isSafeInteger(r.id)&&
   r.author==='chatgpt-codex-connector[bot]').slice(0,20).map(r=>({state:r.state,headSha:r.headSha,
    relation:r.headSha===evidence.head?'CURRENT_HEAD':'HISTORICAL',
    url:`https://github.com/${target.repo}/pull/${target.pr}#pullrequestreview-${r.id}`})):[],
  reason:'CI_IS_NOT_GATE_APPROVAL; CODEX_OBSERVATIONS_ARE_NOT_CLEAN_QA'};
}
