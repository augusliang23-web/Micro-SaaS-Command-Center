import { isDeepStrictEqual } from 'node:util';

export const EVIDENCE_REPO = 'augusliang23-web/Micro-SaaS-Command-Center';
export const EVIDENCE_REPO_ID = 1352468489;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const TASK = freeze({
  schema: 'zc.task/v1',
  taskId: 'zc-pilot-01-pm-reduced-motion',
  idempotencyKey: 'zc-pilot-01-pm-reduced-motion-v1',
  title: '[ZC Task] PM Dashboard loading spinner reduced-motion pilot',
  target: { repository: 'augusliang23-web/pm-dashboard', repositoryId: 1221937556, baseRef: 'main', baseSha: '8e1a0e611bb4a509b0c0ce0a2432778c5f8367ef' },
  scope: { risk: 'LOW', allowedFiles: ['index.html', 'tests/zc-pilot-reduced-motion.test.mjs'], goal: 'Respect prefers-reduced-motion for existing global and async loading spinners; preserve normal-motion rendering, loading text and all business behavior.' },
  acceptance: ['Reduced motion disables .spinner and .async-action-spinner animations.', 'Normal motion and existing busy labels remain unchanged.', 'No authentication, data, cloud, merge or deployment changes.'],
  capabilities: ['github:task-intake'],
  workerRequirements: ['isolated-checkout', 'source-edit:allowlisted', 'offline-test', 'draft-pr', 'independent-review'],
  maxFixAttempts: 2,
  executionAuthorization: 'NOT_GRANTED',
});
export const validateTask = value => isDeepStrictEqual(value, TASK);
export function issueBody() {
  return `<!-- zc-task:${TASK.idempotencyKey} -->\n\n# Zero-Copy task record\n\nIntake only. NOT execution authorization. Agent NOT_CONNECTED; dispatch HOLD.\n\n\`\`\`json\n${JSON.stringify(TASK, null, 2)}\n\`\`\`\n`;
}
export function validateRecord(issue) {
  const n=issue?.number;
  return Number.isSafeInteger(n) && n>0 && n<10_000_000 &&
    issue.html_url===`https://github.com/${EVIDENCE_REPO}/issues/${n}` &&
    !issue.pull_request && issue.title===TASK.title && issue.body===issueBody() &&
    issue.user?.login==='augusliang23-web' && ['open','closed'].includes(issue.state) &&
    ['created_at','updated_at'].every(k=>typeof issue[k]==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(issue[k]) && Number.isFinite(Date.parse(issue[k])));
}
