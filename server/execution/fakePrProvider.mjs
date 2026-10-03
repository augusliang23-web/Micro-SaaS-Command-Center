// Narrow PR interface: createPr(spec) → {number}; getPr({repository,number})
// → readback identity. Phase 2 includes no real GitHub provider implementation.
export class FakePrProvider {
  id = 'fake-github';
  #records = new Map();
  async createPr(spec) {
    const number = this.#records.size + 1;
    this.#records.set(`${spec.repository}/${number}`, { ...spec, number, url: `fake://github/${spec.repository}/pull/${number}`, state: 'FAKE_OPEN' });
    return { number };
  }
  async getPr({ repository, number }) {
    const record = this.#records.get(`${repository}/${number}`);
    if (!record) throw new Error('Fake PR readback unavailable');
    return { ...record };
  }
}
