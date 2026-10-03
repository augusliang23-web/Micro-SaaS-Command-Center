// The V1 action policy, as data. Enforcement lives in PolicyGate and (later)
// the orchestrator; prompts are never the control. Phase 1 executes none of
// these actions — AUTO_ALLOWED describes future permission only.

export const POLICY_CATEGORIES = Object.freeze([
  'AUTO_ALLOWED',
  'CONTROL_PLANE_APPROVAL',
  'EXPLICIT_HUMAN_APPROVAL',
  'FORBIDDEN_IN_V1',
]);

export const ACTION_POLICY = Object.freeze({
  READ_REPO: 'AUTO_ALLOWED',
  CREATE_WORKTREE: 'AUTO_ALLOWED',
  EDIT_WORKTREE: 'AUTO_ALLOWED',
  RUN_TESTS: 'AUTO_ALLOWED',
  RUN_LINT: 'AUTO_ALLOWED',
  RUN_BUILD: 'AUTO_ALLOWED',
  COMMIT: 'AUTO_ALLOWED',
  PUSH_BRANCH: 'AUTO_ALLOWED',
  CREATE_PR: 'AUTO_ALLOWED',

  EDIT_PROTECTED_PATHS: 'CONTROL_PLANE_APPROVAL',
  REVIEW_DECISION: 'CONTROL_PLANE_APPROVAL',

  INSTALL_DEPENDENCIES: 'EXPLICIT_HUMAN_APPROVAL',
  CHANGE_ALLOWLIST: 'EXPLICIT_HUMAN_APPROVAL',
  CHANGE_POLICY: 'EXPLICIT_HUMAN_APPROVAL',

  AGENT_NETWORK: 'FORBIDDEN_IN_V1',
  MERGE: 'FORBIDDEN_IN_V1',
  DEPLOY: 'FORBIDDEN_IN_V1',
  PRODUCTION_CONFIG: 'FORBIDDEN_IN_V1',
  IAM: 'FORBIDDEN_IN_V1',
  SECRETS: 'FORBIDDEN_IN_V1',
  DELETE_RESOURCE: 'FORBIDDEN_IN_V1',
  BILLING_CHANGE: 'FORBIDDEN_IN_V1',
});

/** Category of an action, or null for an unknown action (callers must fail closed). */
export function classifyAction(action, policy = ACTION_POLICY) {
  return typeof action === 'string' && Object.hasOwn(policy, action) ? policy[action] : null;
}
