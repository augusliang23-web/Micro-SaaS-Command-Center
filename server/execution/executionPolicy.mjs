import { classifyAction } from '../tasks/actionPolicy.mjs';
import { validateDevelopmentTask } from '../tasks/types.mjs';

export class BoundaryError extends Error { constructor(message) { super(message); this.name = 'BoundaryError'; this.code = 'EXECUTION_BLOCKED'; } }
export function requireAction(task, project, action) {
  const category = classifyAction(action);
  if (category === null || category === 'FORBIDDEN_IN_V1') throw new BoundaryError(`Forbidden or unknown action: ${action}`);
  if (category !== 'AUTO_ALLOWED') throw new BoundaryError(`Action ${action} requires an approval record; unavailable in Phase 2`);
  if (!task.allowedActions.includes(action) || !project.allowedActions.includes(action)) throw new BoundaryError(`Action ${action} is not allowed`);
}
const taskKeys = ['taskId','projectId','workstream','title','goal','agent','executionProfile','risk','allowedActions','baseBranch','baseSha','status','createdAt','updatedAt','startedAt','completedAt','runIds','commitSha','pr','review'];
export function validateExecutionTask(task, project) {
  if (!task || validateDevelopmentTask(task).length) throw new BoundaryError('Invalid task contract');
  if (Object.keys(task).some(k => !taskKeys.includes(k))) throw new BoundaryError('Task has server-owned path or unexpected field');
  if (!project) throw new BoundaryError('Unknown registered project');
  if (task.projectId !== project.projectId || task.baseBranch !== project.defaultBranch || !project.allowedAgents.includes(task.agent)) throw new BoundaryError('Task no longer matches registered project');
  if (task.allowedActions.some(a => !project.allowedActions.includes(a))) throw new BoundaryError('Stored task permissions exceed current project allowlist');
  if (task.status !== 'DRAFT') throw new BoundaryError('Only DRAFT tasks can start; retry is not implemented');
  for (const action of ['READ_REPO','CREATE_WORKTREE','EDIT_WORKTREE']) requireAction(task, project, action);
}
export function assertPushBranch(branch, taskId) {
  if (typeof branch !== 'string' || !branch.startsWith(`agent/${taskId}-`) || !/^agent\/CC-\d{8}-[0-9a-f]{8}-[a-z0-9-]+$/.test(branch)) throw new BoundaryError('Push target must be the generated agent task branch');
}
