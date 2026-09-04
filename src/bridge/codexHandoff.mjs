export const CANONICAL_PROHIBITED_ACTIONS = Object.freeze([
  'auto_merge',
  'production_deploy',
  'billing_changes',
  'secrets_changes',
  'destructive_actions',
  'self_approval',
]);

export const HANDOFF_REQUIRED_FIELDS = Object.freeze([
  'handoff_id',
  'idempotency_key',
  'task_id',
  'canonical_task_ref',
  'source_surface',
  'source_provider',
  'target_surface',
  'target_provider',
  'task_classification',
  'governance_classification',
  'routing_decision',
  'handoff_strategy',
  'capability_tier',
  'reasoning_level',
  'provider_capability_evidence',
  'risk_level',
  'execution_authority',
  'objective',
  'scope',
  'acceptance_criteria',
  'constraints',
  'prohibited_actions',
  'context_refs',
  'architecture_refs',
  'required_completion_evidence',
  'required_evidence',
  'callback_expectation',
  'canonical_next_state_owner',
]);

export const STATUS_REQUIRED_FIELDS = Object.freeze([
  'project_id',
  'task_id',
  'bridge_core_version',
  'consumer_adoption_version',
  'governance_state',
  'current_surface',
  'provider',
  'capability_tier',
  'automation_level',
  'execution_state',
  'risk_level',
  'pr_number',
  'head_sha',
  'evidence_refs',
  'review_state',
  'review_provenance',
  'approval_state',
  'release_gate',
  'native_enforcement_available',
  'control_plane_fallback',
  'normalized_blocker',
  'last_meaningful_activity',
  'stalled',
  'stalled_reason',
  'next_action',
  'uat_state',
  'production_state',
]);

export const TERMINAL_EXECUTION_STATES = Object.freeze([
  'COMPLETED',
  'FAILED',
  'BLOCKED_PROVIDER',
  'BLOCKED_ENVIRONMENT',
]);

function requireNonEmpty(value, label) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${label} is required`);
  }
}

export function validateDispatch({ dispatch, project }) {
  if (!project) throw new Error('Target project is not in the server-side allowlist');
  if (project.control_mode === 'PAUSED') throw new Error('Project control mode is PAUSED');
  if (project.eligible !== true) throw new Error('Task is not eligible for dispatch');
  if (dispatch.project_id !== project.project_id) throw new Error('Project identity does not match allowlist');
  if (dispatch.target_surface !== 'CODE_EXECUTOR') throw new Error('Target surface must be CODE_EXECUTOR');
  if (dispatch.execution_authority?.explicit_user_action !== true) {
    throw new Error('Dispatch requires an explicit user action');
  }
  if (dispatch.task_classification !== 'READ_ONLY_REPOSITORY_INSPECTION') {
    throw new Error('This MVP accepts only a read-only repository inspection');
  }
  const authorizedActions = dispatch.execution_authority?.authorized_actions;
  if (
    !Array.isArray(authorizedActions) ||
    !authorizedActions.includes('repository_read') ||
    authorizedActions.some((action) => action !== 'repository_read')
  ) {
    throw new Error('This MVP authority must be limited to repository_read');
  }
  if (!project.allowed_risk_levels?.includes(dispatch.risk_level)) {
    throw new Error(`Task risk ${dispatch.risk_level} is outside the allowed risk boundary`);
  }
  if (project.provider_capability_evidence?.code_execution !== 'NATIVE') {
    throw new Error('Provider code_execution capability is not evidenced as NATIVE');
  }
  if (project.provider_capability_evidence?.repository_read !== 'NATIVE') {
    throw new Error('Provider repository_read capability is not evidenced as NATIVE');
  }
  for (const field of [
    'task_id',
    'canonical_task_ref',
    'task_classification',
    'governance_classification',
    'risk_level',
    'objective',
    'callback_expectation',
  ]) {
    requireNonEmpty(dispatch[field], field);
  }
  for (const field of [
    'scope',
    'acceptance_criteria',
    'constraints',
    'prohibited_actions',
    'context_refs',
    'architecture_refs',
    'required_completion_evidence',
  ]) {
    if (!Array.isArray(dispatch[field]) || dispatch[field].length === 0) {
      throw new Error(`${field} must be a non-empty array`);
    }
  }
  for (const action of CANONICAL_PROHIBITED_ACTIONS) {
    if (!dispatch.prohibited_actions.includes(action)) {
      throw new Error(`prohibited_actions must preserve ${action}`);
    }
  }
  if (!dispatch.constraints.includes('read-only')) {
    throw new Error('This MVP must preserve the read-only constraint');
  }
}

export function buildIdempotencyKey(dispatch) {
  return [dispatch.project_id, dispatch.task_id, dispatch.canonical_task_ref].join('::');
}

export function buildHandoff({ dispatch, project, handoffId }) {
  validateDispatch({ dispatch, project });
  const requiredEvidence = [...dispatch.required_completion_evidence];
  return {
    handoff_id: handoffId,
    idempotency_key: buildIdempotencyKey(dispatch),
    task_id: dispatch.task_id,
    canonical_task_ref: dispatch.canonical_task_ref,
    source_surface: 'COMMAND_CENTER',
    source_provider: 'MICRO_SAAS_COMMAND_CENTER',
    target_surface: dispatch.target_surface,
    target_provider: 'CODEX_APP_SERVER',
    task_classification: dispatch.task_classification,
    governance_classification: dispatch.governance_classification,
    routing_decision: 'SERVER_ALLOWLIST_TO_NATIVE_CODE_EXECUTOR',
    handoff_strategy: 'CONTROL_CENTER_ADAPTER',
    capability_tier: project.capability_tier,
    reasoning_level: dispatch.reasoning_level || 'HIGH',
    provider_capability_evidence: { ...project.provider_capability_evidence },
    risk_level: dispatch.risk_level,
    execution_authority: { ...dispatch.execution_authority },
    objective: dispatch.objective,
    scope: [...dispatch.scope],
    acceptance_criteria: [...dispatch.acceptance_criteria],
    constraints: [...dispatch.constraints],
    prohibited_actions: [...dispatch.prohibited_actions],
    context_refs: [...dispatch.context_refs],
    architecture_refs: [...dispatch.architecture_refs],
    required_completion_evidence: requiredEvidence,
    required_evidence: [...requiredEvidence],
    callback_expectation: dispatch.callback_expectation,
    canonical_next_state_owner: 'COMMAND_CENTER',
  };
}

export function formatHandoffPrompt(handoff) {
  return [
    'Execute this Bridge V0.4 handoff exactly within its authority and constraints.',
    'This handoff does not authorize merge, deployment, release, billing, secrets changes, destructive actions, or self-approval.',
    'Return the required completion evidence in your final response.',
    '',
    JSON.stringify(handoff, null, 2),
  ].join('\n');
}
