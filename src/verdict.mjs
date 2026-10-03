// One evidence-based status for every homepage consumer. Saved fixture fields
// remain available for inspection, but never attest to execution or health.
export const STATUS_MAX_AGE_MS = 5 * 60 * 1000;
export const STATUS_LABELS = {
  IDLE: '目前沒有進行中的工作',
  IN_PROGRESS: '自動檢查正在執行',
  NEEDS_CONFIRMATION: '修改正在等待確認',
  BLOCKED: '有已知問題需要處理',
  UNKNOWN: '目前無法確認最新狀態',
};
const LEVEL = { IDLE: 'idle', IN_PROGRESS: 'waiting', NEEDS_CONFIRMATION: 'decision', BLOCKED: 'danger', UNKNOWN: 'unknown' };
const STYLES = {
 danger: { headlineColor:'#e11d48',borderColor:'#fda4af',iconBg:'#fff1f2',iconColor:'#e11d48' },
 decision: { headlineColor:'#b45309',borderColor:'#fcd34d',iconBg:'#fffbeb',iconColor:'#b45309' },
 waiting: { headlineColor:'#0369a1',borderColor:'#bae6fd',iconBg:'#f0f9ff',iconColor:'#0369a1' },
 idle: { headlineColor:'#57534e',borderColor:'#d6d3d1',iconBg:'#fafaf9',iconColor:'#57534e' },
 unknown: { headlineColor:'#57534e',borderColor:'#d6d3d1',iconBg:'#fafaf9',iconColor:'#78716c' },
};
export function formatRelativeTime(input, now = new Date()) {
 const timestamp = typeof input === 'string' ? Date.parse(input) : input?.getTime();
 if (!Number.isFinite(timestamp) || timestamp > now.getTime()) return '時間未知';
 const sec=Math.floor((now.getTime()-timestamp)/1000);
 if(sec<60) return '剛剛'; if(sec<3600) return `${Math.floor(sec/60)} 分鐘前`;
 if(sec<86400) return `${Math.floor(sec/3600)} 小時前`;
 return Math.floor(sec/86400)===1 ? '昨天' : `${Math.floor(sec/86400)} 天前`;
}
export function isRealProject(project) {
 return project?.dataMode !== 'demo' && /^[\w.-]+\/[\w.-]+$/.test(project?.repository || '');
}
// Check the per-state contract before interpreting evidence. A recognized
// state alone cannot prove that the returned PR/commit/check data is coherent.
export function isValidGithubState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const ci = ['passing', 'failing', 'running', 'none', 'unknown', 'pending'];
  const review = ['approved', 'changes_requested', 'review_required'];
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const url = value => {
    try { return typeof value === 'string' && new URL(value).protocol === 'https:'; }
    catch { return false; }
  };
  const pr = Number.isInteger(data.prNumber) && data.prNumber > 0 && url(data.prUrl);
  if (data.state === 'open') return pr && typeof data.isDraft === 'boolean' && ci.includes(data.ciStatus) && review.includes(data.reviewDecision);
  if (data.state === 'merged') return pr && date(data.mergedAt) && data.ciStatus === undefined && data.reviewDecision === undefined;
  if (data.state === 'active') return typeof data.lastCommitSha === 'string' && /^[a-f0-9]{40}$/i.test(data.lastCommitSha) && date(data.lastCommitAt) && typeof data.lastCommitMessage === 'string' && url(data.lastCommitUrl) && ci.includes(data.ciStatus) && data.prNumber === undefined && data.reviewDecision === undefined;
  if (data.state === 'none') return ['ciStatus','reviewDecision','prNumber','prUrl','mergedAt','lastCommitSha','isDraft'].every(key => data[key] === undefined);
  return false;
}
export function getVerdict(project, githubState, { checkedAt, availability = 'UNAVAILABLE', now = Date.now() } = {}) {
 const checked = Date.parse(checkedAt);
 const fresh = Number.isFinite(checked) && checked <= now && now-checked <= STATUS_MAX_AGE_MS;
 const validState = isValidGithubState(githubState);
 const source = isRealProject(project) ? 'github' : 'manual';
 let status='UNKNOWN', explanation='尚未取得可驗證的資料。', checksPassed=false;
 let sourceState = availability;
 if(availability==='AVAILABLE' && !fresh) sourceState='STALE';
 if(availability==='AVAILABLE' && !validState) sourceState='UNAVAILABLE';
 if (isRealProject(project) && availability==='AVAILABLE' && fresh && validState) {
  checksPassed = ['open','active'].includes(githubState.state) && githubState.ciStatus==='passing';
  if(githubState.ciStatus==='failing' || githubState.reviewDecision==='changes_requested') {
   status='BLOCKED'; explanation=githubState.ciStatus==='failing' ? '最新修改沒有通過自動檢查。' : '審查提出了需要修正的意見。';
  } else if(githubState.ciStatus==='running') {
   status='IN_PROGRESS'; explanation='GitHub 回報自動檢查正在執行；尚未取得最終結果。';
  } else if(githubState.state==='open') {
   status='NEEDS_CONFIRMATION';
   explanation = githubState.isDraft ? '修改仍是草稿，需要確認下一步；沒有 AI 正在執行的證據。' : githubState.reviewDecision==='approved' ? '修改已有審查紀錄，仍需要人工確認下一步。' : '修改正在等待審查。';
   explanation += checksPassed ? ' 已取得自動檢查通過的結果。' : githubState.ciStatus === 'pending' ? ' 自動檢查正在等待執行。' : ' 尚未取得自動檢查結果。';
  } else if(githubState.state==='active' && !checksPassed) {
   status='NEEDS_CONFIRMATION'; explanation='主分支有直接提交的修改，尚未取得自動檢查結果。';
  } else {
   status='IDLE'; explanation=githubState.state==='merged' ? `PR #${githubState.prNumber ?? '?'} 已合併；部署狀態尚未確認。` : githubState.state==='active' ? '主分支有已保存的修改；沒有目前正在執行工作的證據。' : '本次查詢沒有找到進行中的修改。';
  }
 } else if(sourceState==='STALE') explanation='上次查詢已過期，請重新查詢。';
 else if(sourceState==='CHECKING') explanation='正在查詢 GitHub，完成前無法確認狀態。';
 else if(source==='manual') explanation='示範或手動資料，不能用來確認真實專案狀態。';
 else explanation='資料來源無法使用（UNAVAILABLE），請重試；保存的狀態不能代表現在。';
 return {status, level:LEVEL[status], headline:STATUS_LABELS[status], explanation,
  actionLabel:status==='UNKNOWN'?'查看資料來源':status==='BLOCKED'?'查看問題':status==='NEEDS_CONFIRMATION'?'查看並確認':status==='IN_PROGRESS'?'自動檢查執行中':'查看專案',
  hasAction:status!=='IN_PROGRESS', isWaiting:status==='IN_PROGRESS', source, sourceState,
  checkedAt: Number.isFinite(checked) ? checkedAt : null, checksPassed, deployed:false,
  activityAt: validState ? githubState.updatedAt || githubState.lastCommitAt || githubState.mergedAt || null : null,
 };
}
export function getVerdictStyle(level) { return STYLES[level] || STYLES.unknown; }
export function needsAttention(verdict) { return ['BLOCKED','NEEDS_CONFIRMATION','UNKNOWN'].includes(verdict?.status); }
export function matchesStatusFilter(verdict, filter) {
 if(filter==='all'||filter==='ALL') return true;
 if(filter==='attention') return needsAttention(verdict);
 if(filter==='running') return verdict?.status==='IN_PROGRESS';
 if(filter==='unknown') return verdict?.status==='UNKNOWN';
 return verdict?.status===filter;
}
export function statusRank(verdict) { return ({BLOCKED:0,NEEDS_CONFIRMATION:1,UNKNOWN:2,IN_PROGRESS:3,IDLE:4})[verdict?.status] ?? 2; }
export function pickMostUrgent(verdicts) {
 let best=-1;
 verdicts.forEach((v,i)=>{if(needsAttention(v) && (best<0 || statusRank(v)<statusRank(verdicts[best]))) best=i;});
 return best;
}
export function compareCheckedAt(a,b) {
 const time=v=>v?.sourceState==='AVAILABLE' && Number.isFinite(Date.parse(v?.checkedAt)) ? Date.parse(v.checkedAt) : -Infinity;
 const at=time(a), bt=time(b); return at===bt ? 0 : at>bt ? -1 : 1;
}
