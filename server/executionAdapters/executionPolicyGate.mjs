import { CANONICAL_PROHIBITED_ACTIONS } from './contract.mjs';

const blocked = (reason) => ({
  allowed: false,
  execution_state: 'BLOCKED_DECISION',
  governance_state: 'BLOCKED',
  reason,
});

export class ExecutionPolicyGate {
  evaluate({ request, project }) {
    if (!project?.eligible) {
      return blocked('PROJECT_NOT_ELIGIBLE');
    }
    if (!project.allowed_risk_levels?.includes(request?.risk_level)) {
      return blocked('RISK_LEVEL_NOT_ALLOWED');
    }
    if (!request?.execution_authority?.explicit_user_action) {
      return blocked('EXPLICIT_USER_ACTION_REQUIRED');
    }
    if (!CANONICAL_PROHIBITED_ACTIONS.every((action) => request.prohibited_actions?.includes(action))) {
      return blocked('CANONICAL_PROHIBITED_ACTIONS_REQUIRED');
    }
    return { allowed: true };
  }
}
