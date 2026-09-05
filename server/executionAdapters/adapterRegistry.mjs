import { CLAUDE_CODE, isCanonicalProviderKey } from './contract.mjs';
import { ExecutionPolicyGate } from './executionPolicyGate.mjs';

function hasServerResolvedCapabilityEvidence({ providerKey, evidence }) {
  return (
    evidence?.server_resolved === true &&
    evidence.provider_key === providerKey &&
    evidence.capability_gate === 'OPEN' &&
    typeof evidence.evidence_ref === 'string' &&
    evidence.evidence_ref.length > 0 &&
    typeof evidence.observed_at === 'string' &&
    evidence.observed_at.length > 0 &&
    evidence.forge !== true
  );
}

export class AdapterRegistry {
  #adapters;

  constructor({ adapters = new Map(), policyGate = new ExecutionPolicyGate() } = {}) {
    this.#adapters = adapters;
    this.policyGate = policyGate;
  }

  resolve({ providerKey, project, request }) {
    const policy = this.policyGate.evaluate({ request, project });
    if (!policy.allowed) {
      throw new Error(`BLOCKED_DECISION: ${policy.reason}`);
    }
    if (!isCanonicalProviderKey(providerKey)) {
      throw new Error(`Unknown provider: ${providerKey}`);
    }
    if (!project?.enabled_providers?.includes(providerKey)) {
      throw new Error(`Provider not enabled for project: ${providerKey}`);
    }
    if (
      providerKey === CLAUDE_CODE &&
      !hasServerResolvedCapabilityEvidence({
        providerKey,
        evidence: project.provider_capability_evidence?.[providerKey],
      })
    ) {
      throw new Error('BLOCKED_DECISION: Claude Code capability evidence is not server-resolved');
    }

    const adapter = this.#adapters.get(providerKey);
    if (!adapter) {
      throw new Error(`Provider unavailable: ${providerKey}`);
    }
    return adapter;
  }
}
