import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_CODE,
  CODEX_BRIDGE,
  normalizeProviderEvent,
} from '../server/executionAdapters/contract.mjs';
import { AdapterRegistry } from '../server/executionAdapters/adapterRegistry.mjs';
import { ExecutionPolicyGate } from '../server/executionAdapters/executionPolicyGate.mjs';
import { ProjectRegistry } from '../server/executionAdapters/projectRegistry.mjs';

const project = {
  project_id: 'project-a',
  cwd: '/server/resolved/project-a',
  eligible: true,
  allowed_risk_levels: ['LOW'],
  enabled_providers: [CODEX_BRIDGE],
  execution_authority: {
    explicit_user_action: true,
    authorized_actions: ['repository_read'],
  },
  prohibited_actions: [
    'auto_merge',
    'production_deploy',
    'billing_changes',
    'secrets_changes',
    'destructive_actions',
    'self_approval',
  ],
  provider_capability_evidence: {
    [CODEX_BRIDGE]: {
      server_resolved: true,
      provider_key: CODEX_BRIDGE,
      capability_gate: 'OPEN',
      evidence_ref: 'server://evidence/codex-read-only-smoke',
      observed_at: '2026-09-04T00:00:00.000Z',
      forge: false,
    },
  },
};

const request = {
  project_id: project.project_id,
  task_id: 'read-only-task',
  canonical_task_ref: 'local://read-only-task',
  risk_level: 'LOW',
  execution_authority: {
    explicit_user_action: true,
    authorized_actions: ['repository_read'],
  },
  prohibited_actions: [
    'auto_merge',
    'production_deploy',
    'billing_changes',
    'secrets_changes',
    'destructive_actions',
    'self_approval',
  ],
};

test('ProjectRegistry resolves only the server-owned project record', () => {
  const registry = new ProjectRegistry([project]);

  const resolved = registry.resolve(project.project_id);

  assert.equal(resolved.cwd, '/server/resolved/project-a');
  assert.throws(() => registry.resolve('/browser/supplied/path'), /Unknown project/i);
});

test('ExecutionPolicyGate blocks dispatch without explicit user authorization', () => {
  const result = new ExecutionPolicyGate().evaluate({
    request: {
      ...request,
      execution_authority: { authorized_actions: ['repository_read'] },
    },
    project,
  });

  assert.deepEqual(result, {
    allowed: false,
    execution_state: 'BLOCKED_DECISION',
    governance_state: 'BLOCKED',
    reason: 'EXPLICIT_USER_ACTION_REQUIRED',
  });
});

test('ExecutionPolicyGate rejects client-asserted authority without a matching server-owned grant', () => {
  const result = new ExecutionPolicyGate().evaluate({
    request,
    project: {
      ...project,
      execution_authority: {
        explicit_user_action: false,
        authorized_actions: ['repository_read'],
      },
    },
  });

  assert.deepEqual(result, {
    allowed: false,
    execution_state: 'BLOCKED_DECISION',
    governance_state: 'BLOCKED',
    reason: 'EXPLICIT_USER_ACTION_REQUIRED',
  });
});

test('ExecutionPolicyGate blocks a client request when the server-owned prohibited-action allowlist is incomplete', () => {
  const result = new ExecutionPolicyGate().evaluate({
    request,
    project: {
      ...project,
      prohibited_actions: project.prohibited_actions.filter((action) => action !== 'self_approval'),
    },
  });

  assert.deepEqual(result, {
    allowed: false,
    execution_state: 'BLOCKED_DECISION',
    governance_state: 'BLOCKED',
    reason: 'CANONICAL_PROHIBITED_ACTIONS_REQUIRED',
  });
});

test('ExecutionPolicyGate permits the authorized server-resolved read-only request', () => {
  assert.deepEqual(new ExecutionPolicyGate().evaluate({ request, project }), { allowed: true });
});

test('AdapterRegistry resolves only the explicitly selected enabled canonical provider', () => {
  const codexAdapter = { name: 'codex-boundary' };
  const registry = new AdapterRegistry({
    adapters: new Map([[CODEX_BRIDGE, codexAdapter]]),
  });

  assert.equal(registry.resolve({ providerKey: CODEX_BRIDGE, project, request }), codexAdapter);
  assert.throws(
    () => registry.resolve({ providerKey: CLAUDE_CODE, project, request }),
    /not enabled/i,
  );
  assert.throws(() => registry.resolve({ providerKey: 'codex', project, request }), /Unknown provider/i);
});

test('AdapterRegistry refuses forged Claude Code capability evidence even when its gate is open', () => {
  const claudeAdapter = { name: 'claude-boundary' };
  const registry = new AdapterRegistry({
    adapters: new Map([[CLAUDE_CODE, claudeAdapter]]),
  });
  const claudeEnabledProject = {
    ...project,
    enabled_providers: [CODEX_BRIDGE, CLAUDE_CODE],
    provider_capability_evidence: {
      ...project.provider_capability_evidence,
      [CLAUDE_CODE]: {
        server_resolved: true,
        provider_key: CLAUDE_CODE,
        capability_gate: 'OPEN',
        evidence_ref: 'server://evidence/claude-read-only-smoke',
        observed_at: '2026-09-04T00:00:00.000Z',
        forge: true,
      },
    },
  };

  assert.throws(
    () => registry.resolve({ providerKey: CLAUDE_CODE, project: claudeEnabledProject, request }),
    /BLOCKED_DECISION: Claude Code capability evidence is not server-resolved/,
  );
});

test('AdapterRegistry rejects the legacy bare Claude capability-gate boolean', () => {
  const registry = new AdapterRegistry({
    adapters: new Map([[CLAUDE_CODE, { name: 'claude-boundary' }]]),
  });
  const claudeEnabledProject = {
    ...project,
    enabled_providers: [CODEX_BRIDGE, CLAUDE_CODE],
    claude_capability_gate_open: true,
  };

  assert.throws(
    () => registry.resolve({ providerKey: CLAUDE_CODE, project: claudeEnabledProject, request }),
    /BLOCKED_DECISION: Claude Code capability evidence is not server-resolved/,
  );
});

test('AdapterRegistry cannot resolve the existing Codex path without a passing policy evaluation', () => {
  const codexAdapter = { name: 'codex-boundary' };
  const registry = new AdapterRegistry({
    adapters: new Map([[CODEX_BRIDGE, codexAdapter]]),
  });

  assert.throws(
    () => registry.resolve({
      providerKey: CODEX_BRIDGE,
      project,
      request: { ...request, execution_authority: { authorized_actions: ['repository_read'] } },
    }),
    /BLOCKED_DECISION: EXPLICIT_USER_ACTION_REQUIRED/,
  );
});

test('provider lifecycle preserves paused input and permits only explicit completion to succeed', () => {
  assert.deepEqual(normalizeProviderEvent({ type: 'awaiting_input' }), {
    execution_state: 'AWAITING_INPUT',
    governance_state: 'BLOCKED',
    terminal: false,
  });
  assert.deepEqual(
    normalizeProviderEvent({ type: 'provider_completed', terminal_status: 'completed' }),
    {
      execution_state: 'COMPLETED',
      governance_state: 'READY_FOR_REVIEW',
      terminal: true,
    },
  );
  assert.deepEqual(
    normalizeProviderEvent({ type: 'provider_completed', terminal_status: 'interrupted' }),
    {
      execution_state: 'FAILED',
      governance_state: 'BLOCKED',
      terminal: true,
    },
  );
});
