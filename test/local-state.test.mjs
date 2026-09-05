import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isValidState, readState, writeState } from '../server/localStateStore.mjs';
import { evaluateStateRequest } from '../server/stateRoutes.mjs';

const validState = {
  projects: [],
  attentionItems: [],
  nba: { id: 'nba-1' },
  snapshot: { aiRunning: 0 },
};

test('isValidState accepts a well-shaped state object', () => {
  assert.equal(isValidState(validState), true);
});

test('isValidState rejects malformed payloads', () => {
  assert.equal(isValidState(null), false);
  assert.equal(isValidState([]), false);
  assert.equal(isValidState({ projects: 'not-an-array', attentionItems: [], nba: {}, snapshot: {} }), false);
  assert.equal(isValidState({ projects: [], attentionItems: [] }), false);
});

test('readState returns null when the file does not exist', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'local-state-test-'));
  const filePath = path.join(dir, 'missing.json');
  try {
    assert.equal(readState(filePath), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeState persists a valid state and readState reads it back', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'local-state-test-'));
  const filePath = path.join(dir, 'nested', 'app-state.json');
  try {
    writeState(validState, filePath);
    assert.deepEqual(readState(filePath), validState);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeState throws instead of writing an invalid state', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'local-state-test-'));
  const filePath = path.join(dir, 'app-state.json');
  try {
    assert.throws(() => writeState({ garbage: true }, filePath));
    assert.equal(readState(filePath), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateStateRequest allows originless and any loopback-hostname requests', () => {
  assert.equal(evaluateStateRequest({ origin: null }).ok, true);
  assert.equal(evaluateStateRequest({ origin: 'http://127.0.0.1:3000' }).ok, true);
  assert.equal(evaluateStateRequest({ origin: 'http://localhost:3000' }).ok, true);
});

test('evaluateStateRequest rejects a non-loopback browser origin', () => {
  const decision = evaluateStateRequest({ origin: 'https://evil.example' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});
