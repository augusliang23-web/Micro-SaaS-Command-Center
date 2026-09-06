import assert from 'node:assert/strict';
import test from 'node:test';

import { getVerdict, getVerdictStyle } from '../src/verdict.mjs';

test('BLOCKED projects get the danger verdict using the blocker text', () => {
  const verdict = getVerdict({ waitingState: 'BLOCKED', blocker: 'Missing STRIPE_WEBHOOK_SECRET' });
  assert.equal(verdict.level, 'danger');
  assert.equal(verdict.explanation, 'Missing STRIPE_WEBHOOK_SECRET');
  assert.equal(verdict.hasAction, true);
  assert.equal(verdict.isWaiting, false);
});

test('BLOCKED without blocker text falls back to a generic explanation', () => {
  const verdict = getVerdict({ waitingState: 'BLOCKED', blocker: null });
  assert.equal(verdict.level, 'danger');
  assert.match(verdict.explanation, /卡住/);
});

test('WAITING_FOR_HUMAN with a blocker is a decision verdict', () => {
  const verdict = getVerdict({ waitingState: 'WAITING_FOR_HUMAN', blocker: 'Pick a policy' });
  assert.equal(verdict.level, 'decision');
  assert.equal(verdict.explanation, 'Pick a policy');
  assert.equal(verdict.hasAction, true);
});

test('WAITING_FOR_HUMAN with no blocker is a ready verdict using nextAction', () => {
  const verdict = getVerdict({ waitingState: 'WAITING_FOR_HUMAN', blocker: null, nextAction: 'Ready to merge PR #89' });
  assert.equal(verdict.level, 'ready');
  assert.equal(verdict.explanation, 'Ready to merge PR #89');
});

test('AI_RUNNING and AUTOMATION_IDLE both get the waiting verdict with no action', () => {
  const running = getVerdict({ waitingState: 'AI_RUNNING', blocker: null, nextAction: 'Running tests' });
  const idle = getVerdict({ waitingState: 'AUTOMATION_IDLE', blocker: null });
  assert.equal(running.level, 'waiting');
  assert.equal(running.explanation, 'Running tests');
  assert.equal(running.hasAction, false);
  assert.equal(running.isWaiting, true);
  assert.equal(idle.level, 'waiting');
});

test('getVerdictStyle returns a color set per level and falls back for unknown levels', () => {
  assert.equal(getVerdictStyle('danger').headlineColor, '#e11d48');
  assert.equal(getVerdictStyle('ready').headlineColor, '#059669');
  assert.deepEqual(getVerdictStyle('nonsense'), getVerdictStyle('waiting'));
});
