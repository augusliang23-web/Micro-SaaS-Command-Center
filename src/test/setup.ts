import '@testing-library/jest-dom/vitest';
import { afterAll, beforeAll, vi } from 'vitest';

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    throw new Error(`Network forbidden in tests: ${String(input)}`);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
