import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

import {
  STATUS_REQUIRED_FIELDS,
  TERMINAL_EXECUTION_STATES,
  buildHandoff,
  formatHandoffPrompt,
} from '../src/bridge/codexHandoff.mjs';

function initialStatus(handoff, project, now) {
  return {
    project_id: project.project_id,
    task_id: handoff.task_id,
    bridge_core_version: '0.4',
    consumer_adoption_version: '0.4-zero-copy-mvp',
    governance_state: 'EXECUTING',
    current_surface: 'CODE_EXECUTOR',
    provider: 'CODEX_APP_SERVER',
    capability_tier: handoff.capability_tier,
    automation_level: project.automation_level || 'DISPATCHED',
    execution_state: 'QUEUED',
    risk_level: handoff.risk_level,
    pr_number: 'UNKNOWN',
    head_sha: 'UNKNOWN',
    evidence_refs: [],
    review_state: 'NOT_STARTED',
    review_provenance: 'UNKNOWN',
    approval_state: 'NOT_REQUIRED',
    release_gate: 'NOT_AUTHORIZED',
    native_enforcement_available: true,
    control_plane_fallback: true,
    normalized_blocker: null,
    last_meaningful_activity: now(),
    stalled: false,
    stalled_reason: null,
    next_action: 'Wait for Codex App Server events.',
    uat_state: 'NOT_REQUESTED',
    production_state: 'NOT_REQUESTED',
    handoff_id: handoff.handoff_id,
    idempotency_key: handoff.idempotency_key,
    handoff_strategy: handoff.handoff_strategy,
    thread_id: null,
    turn_id: null,
    actual_model: null,
    terminal_result: null,
    error: null,
    idempotency_persistence: 'PROCESS_MEMORY_ONLY',
  };
}

function clone(value) {
  return structuredClone(value);
}

function classifyProviderFailure(error) {
  if (error?.code === 'ENOENT') return 'BLOCKED_ENVIRONMENT';
  if (/ChatGPT account/i.test(error?.message || '')) return 'BLOCKED_PROVIDER';
  return 'FAILED';
}

export class CodexHandoffService {
  /**
   * @param {{
   *   projects: any[],
   *   provider?: { start(input: any): Promise<any> },
   *   providerFactory?: () => { start(input: any): Promise<any> },
   *   idFactory?: () => string,
   *   now?: () => string,
   * }} options
   */
  constructor({ projects, provider, providerFactory, idFactory = randomUUID, now = () => new Date().toISOString() }) {
    this.projects = new Map(projects.map((project) => [project.project_id, clone(project)]));
    if (!providerFactory && !provider) throw new Error('A Codex provider or providerFactory is required');
    this.providerFactory = providerFactory || (() => provider);
    this.idFactory = idFactory;
    this.now = now;
    this.handoffs = new Map();
    this.byIdempotencyKey = new Map();
  }

  async dispatch(dispatch) {
    const project = this.projects.get(dispatch.project_id);
    const handoff = buildHandoff({ dispatch, project, handoffId: this.idFactory() });
    const existingId = this.byIdempotencyKey.get(handoff.idempotency_key);
    if (existingId) {
      const existing = this.handoffs.get(existingId);
      if (existing && !TERMINAL_EXECUTION_STATES.includes(existing.status.execution_state)) {
        return this.#response(existing);
      }
    }

    const record = {
      handoff,
      status: initialStatus(handoff, project, this.now),
    };
    this.handoffs.set(handoff.handoff_id, record);
    this.byIdempotencyKey.set(handoff.idempotency_key, handoff.handoff_id);

    const isWriteExecution = handoff.task_classification === 'WORKSPACE_WRITE_EXECUTION';
    const headBeforeSha = isWriteExecution ? await this.#readHeadSha(project.cwd) : null;

    const onUpdate = (update) => {
      this.#applyUpdate(handoff.handoff_id, update);
      if (isWriteExecution && update.state && TERMINAL_EXECUTION_STATES.includes(update.state)) {
        void this.#verifyNoUnauthorizedGitActivity(handoff.handoff_id, project.cwd, headBeforeSha);
      }
    };
    try {
      const started = await this.providerFactory().start({
        cwd: project.cwd,
        prompt: formatHandoffPrompt(handoff),
        handoff: clone(handoff),
        sandbox: isWriteExecution ? 'workspace-write' : 'read-only',
        onUpdate,
      });
      this.#applyUpdate(handoff.handoff_id, {
        threadId: started?.threadId,
        turnId: started?.turnId,
        model: started?.model,
      });
    } catch (error) {
      this.#applyUpdate(handoff.handoff_id, {
        state: classifyProviderFailure(error),
        error: error instanceof Error ? error.message : String(error),
        blocker: 'Codex App Server dispatch did not start.',
      });
    }

    return this.#response(record);
  }

  getStatus(handoffId) {
    const record = this.handoffs.get(handoffId);
    return record ? clone(record.status) : null;
  }

  #applyUpdate(handoffId, update = {}) {
    const record = this.handoffs.get(handoffId);
    if (!record) return;
    const status = record.status;
    if (update.state) status.execution_state = update.state;
    if (update.threadId) status.thread_id = update.threadId;
    if (update.turnId) status.turn_id = update.turnId;
    if (update.model) status.actual_model = update.model;
    if (update.output) status.terminal_result = `${status.terminal_result || ''}${update.output}`;
    if (update.result) status.terminal_result = update.result;
    if (update.error) status.error = update.error;
    if (update.blocker) status.normalized_blocker = update.blocker;
    if (update.processCleanup) status.process_cleanup = update.processCleanup;
    if (status.execution_state === 'AWAITING_INPUT') {
      status.approval_state = 'REQUIRED';
      status.stalled = false;
      status.stalled_reason = null;
      status.next_action = 'Open Codex and review the native approval or input request.';
    } else if (TERMINAL_EXECUTION_STATES.includes(status.execution_state)) {
      status.governance_state = status.execution_state === 'COMPLETED' ? 'READY_FOR_REVIEW' : 'BLOCKED';
      status.next_action = status.execution_state === 'COMPLETED' ? 'Review the returned evidence.' : 'Review the blocker or error.';
    } else if (status.execution_state === 'WORKING') {
      status.next_action = 'Wait for Codex to complete the task.';
    }
    if (
      update.state ||
      update.threadId ||
      update.turnId ||
      update.model ||
      update.output ||
      update.result ||
      update.error ||
      update.blocker
    ) {
      status.last_meaningful_activity = this.now();
    }
  }

  // Best-effort real verification (not just trust in the prompt) that a
  // WORKSPACE_WRITE_EXECUTION handoff did not commit or push despite being
  // instructed not to. Never throws — a git failure here must not mask the
  // handoff's own real outcome.
  #readHeadSha(cwd) {
    return new Promise((resolve) => {
      execFile('git', ['rev-parse', 'HEAD'], { cwd }, (error, stdout) => {
        resolve(error ? null : stdout.trim());
      });
    });
  }

  async #verifyNoUnauthorizedGitActivity(handoffId, cwd, headBeforeSha) {
    if (!headBeforeSha) return;
    const headAfterSha = await this.#readHeadSha(cwd);
    if (headAfterSha && headAfterSha !== headBeforeSha) {
      this.#applyUpdate(handoffId, {
        blocker: `⚠️ Verification: HEAD moved from ${headBeforeSha} to ${headAfterSha} despite the no-commit instruction — a commit may have been made. Review before trusting this result.`,
      });
    }
  }

  #response(record) {
    for (const field of STATUS_REQUIRED_FIELDS) {
      if (!Object.hasOwn(record.status, field)) throw new Error(`Internal status is missing ${field}`);
    }
    return { ...clone(record.status), handoff: clone(record.handoff) };
  }
}
