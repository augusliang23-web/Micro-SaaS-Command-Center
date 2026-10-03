import { AGENTS, EXECUTION_PROFILES, DEFAULT_EXECUTION_PROFILE, RISK_LEVELS } from './types.mjs';
import { ACTION_POLICY, classifyAction } from './actionPolicy.mjs';

// Fields a browser may send. Anything else is rejected (fail closed), which
// covers every path/command/binary/branch spelling, not just a deny-list.
const ALLOWED_INPUT_KEYS = Object.freeze([
  'projectId',
  'workstream',
  'title',
  'goal',
  'agent',
  'executionProfile',
  'risk',
  'requestedActions',
]);

// Named only so the error message can say *why*; rejection does not depend on this list.
const PATH_LIKE_KEY = /(cwd|dir|path|root|worktree|binar|exec|command|cmd|shell|script|branch|sha|taskid|status|review|runids|^pr$)/i;

const WORKSTREAM = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;
const TITLE_MAX = 200;
const GOAL_MAX = 20_000;
const DEFAULT_WORKSTREAM = 'general';

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

const reject = (status, code, error) => ({ ok: false, status, code, error });

export class PolicyGate {
  #policy;

  constructor({ policy = ACTION_POLICY } = {}) {
    this.#policy = policy;
  }

  /**
   * Validate a browser-submitted task request against the server-side registry.
   * Returns { ok: true, input, project, approvalRequired } or { ok: false, status, code, error }.
   * Pure: no I/O, no process, no git.
   */
  evaluateCreate({ body, registry }) {
    if (!isRecord(body)) return reject(400, 'MALFORMED_TASK', 'Request body must be a JSON object.');

    const unexpected = Object.keys(body).filter((key) => !ALLOWED_INPUT_KEYS.includes(key));
    if (unexpected.length > 0) {
      const pathLike = unexpected.filter((key) => PATH_LIKE_KEY.test(key));
      return reject(
        400,
        pathLike.length > 0 ? 'SERVER_OWNED_FIELD' : 'UNKNOWN_FIELD',
        pathLike.length > 0
          ? `These fields are chosen by the server, not the browser: ${pathLike.join(', ')}.`
          : `Unknown field(s): ${unexpected.join(', ')}.`,
      );
    }

    for (const field of ['projectId', 'title', 'goal', 'agent']) {
      if (typeof body[field] !== 'string' || body[field].trim() === '') {
        return reject(400, 'MALFORMED_TASK', `${field} is required and must be a non-empty string.`);
      }
    }
    if (body.title.length > TITLE_MAX) return reject(400, 'MALFORMED_TASK', `title must be at most ${TITLE_MAX} characters.`);
    if (body.goal.length > GOAL_MAX) return reject(400, 'MALFORMED_TASK', `goal must be at most ${GOAL_MAX} characters.`);

    const workstream = body.workstream === undefined ? DEFAULT_WORKSTREAM : body.workstream;
    if (typeof workstream !== 'string' || !WORKSTREAM.test(workstream)) {
      return reject(400, 'MALFORMED_TASK', 'workstream must be a short plain label.');
    }
    const executionProfile = body.executionProfile === undefined ? DEFAULT_EXECUTION_PROFILE : body.executionProfile;
    if (!EXECUTION_PROFILES.includes(executionProfile)) {
      return reject(400, 'INVALID_PROFILE', `executionProfile must be one of: ${EXECUTION_PROFILES.join(', ')}.`);
    }
    if (!RISK_LEVELS.includes(body.risk)) {
      return reject(400, 'MALFORMED_TASK', `risk must be one of: ${RISK_LEVELS.join(', ')}.`);
    }
    if (!AGENTS.includes(body.agent)) {
      return reject(400, 'UNKNOWN_AGENT', `agent must be one of: ${AGENTS.join(', ')}.`);
    }

    const project = registry.get(body.projectId);
    if (!project) return reject(404, 'UNKNOWN_PROJECT', 'Project is not in the server-side registry.');
    if (!project.allowedAgents.includes(body.agent)) {
      return reject(403, 'AGENT_NOT_ALLOWED', `Agent ${body.agent} is not allowed for this project.`);
    }

    // Default: the project's AUTO_ALLOWED actions. Approval-category actions are never implied.
    let requested = body.requestedActions;
    if (requested === undefined) {
      requested = project.allowedActions.filter((a) => classifyAction(a, this.#policy) === 'AUTO_ALLOWED');
    }
    if (!Array.isArray(requested) || !requested.every((a) => typeof a === 'string')) {
      return reject(400, 'MALFORMED_TASK', 'requestedActions must be an array of action names.');
    }
    const requestedActions = [...new Set(requested)];

    const approvalRequired = [];
    for (const action of requestedActions) {
      const category = classifyAction(action, this.#policy);
      if (category === null) return reject(400, 'UNKNOWN_ACTION', `Unknown action: ${String(action).slice(0, 60)}.`);
      if (category === 'FORBIDDEN_IN_V1') return reject(403, 'ACTION_FORBIDDEN', `Action ${action} is forbidden in V1.`);
      if (!project.allowedActions.includes(action)) {
        return reject(403, 'ACTION_NOT_ALLOWED', `Action ${action} is not allowed for this project.`);
      }
      if (category !== 'AUTO_ALLOWED') approvalRequired.push({ action, category });
    }

    return {
      ok: true,
      project,
      approvalRequired,
      input: {
        workstream,
        title: body.title.trim(),
        goal: body.goal,
        agent: body.agent,
        executionProfile,
        risk: body.risk,
        requestedActions,
      },
    };
  }
}
