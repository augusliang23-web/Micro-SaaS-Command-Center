// Read validation only: never migrate or replace malformed saved data with demos.
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value, keys) => record(value) && keys.every(key => typeof value[key] === 'string');
export function isUsableSavedState(state) {
 if (!record(state) || !Array.isArray(state.projects) || !Array.isArray(state.attentionItems) || !record(state.nba) || !record(state.snapshot)) return false;
 return state.projects.every(project =>
  strings(project, ['id','name','tagline','repository','stage','health','workflowType','currentTask','currentGate','currentGateLabel','testOutcome','reviewOutcome','nextAction','waitingState','model','reasoningEffort','routingReason','lastActivity']) &&
  (project.blocker === null || typeof project.blocker === 'string') &&
  Array.isArray(project.tags) && project.tags.every(tag => typeof tag === 'string') &&
  Array.isArray(project.gates) && project.gates.every(gate => strings(gate,['id','label','shortLabel','status'])) &&
  Array.isArray(project.activityHistory) && project.activityHistory.every(item => strings(item,['id','timestamp','author','action','detail'])) &&
  strings(project.executionContext,['branch','model','reasoningEffort','risk','routingReason','bridgeRunId']) &&
  record(project.environment) && strings(project.environment.production,['status','lastDeployed']) && strings(project.environment.staging,['status','lastRefreshed']) &&
  (project.changeSummaries === undefined || (Array.isArray(project.changeSummaries) && project.changeSummaries.every(item => strings(item,['id','refKey','summary','provider','generatedAt'])))) &&
  (project.features === undefined || Array.isArray(project.features))
 );
}
