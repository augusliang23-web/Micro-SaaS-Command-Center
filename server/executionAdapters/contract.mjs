export const CODEX_BRIDGE = 'CODEX_BRIDGE';
export const CLAUDE_CODE = 'CLAUDE_CODE';

export const CANONICAL_PROVIDER_KEYS = Object.freeze([
  CODEX_BRIDGE,
  CLAUDE_CODE,
]);

export const CANONICAL_PROHIBITED_ACTIONS = Object.freeze([
  'auto_merge',
  'production_deploy',
  'billing_changes',
  'secrets_changes',
  'destructive_actions',
  'self_approval',
]);

export function isCanonicalProviderKey(providerKey) {
  return CANONICAL_PROVIDER_KEYS.includes(providerKey);
}

export function normalizeProviderEvent(event) {
  if (event?.type === 'awaiting_input') {
    return {
      execution_state: 'AWAITING_INPUT',
      governance_state: 'BLOCKED',
      terminal: false,
    };
  }

  if (event?.type === 'provider_completed' && event.terminal_status === 'completed') {
    return {
      execution_state: 'COMPLETED',
      governance_state: 'READY_FOR_REVIEW',
      terminal: true,
    };
  }

  return {
    execution_state: 'FAILED',
    governance_state: 'BLOCKED',
    terminal: true,
  };
}
