import { CLAUDE_CODE, isCanonicalProviderKey } from './contract.mjs';

export class AdapterRegistry {
  #adapters;

  constructor({ adapters = new Map() } = {}) {
    this.#adapters = adapters;
  }

  resolve({ providerKey, project }) {
    if (!isCanonicalProviderKey(providerKey)) {
      throw new Error(`Unknown provider: ${providerKey}`);
    }
    if (!project?.enabled_providers?.includes(providerKey)) {
      throw new Error(`Provider not enabled for project: ${providerKey}`);
    }
    if (providerKey === CLAUDE_CODE && project?.claude_capability_gate_open !== true) {
      throw new Error('BLOCKED_DECISION: Claude Code capability gate is closed');
    }

    const adapter = this.#adapters.get(providerKey);
    if (!adapter) {
      throw new Error(`Provider unavailable: ${providerKey}`);
    }
    return adapter;
  }
}
