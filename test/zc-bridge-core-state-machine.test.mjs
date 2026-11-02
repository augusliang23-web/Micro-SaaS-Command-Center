// ZC-MVP-B1 (Issue #119): state machine and shared pure helpers. Offline only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES, TERMINAL_STATES, EVENTS, applyEvent, canTransition, transition,
  isTerminal, isState, holdTarget, canonical, digest, exact, isTimestamp,
  BridgeError, fail,
} from '../tools/zc-bridge-core/state-machine.mjs';

const PRE_CLAIM = ['PROPOSED', 'PENDING_GRANT', 'AUTHORIZED'];
const POST_CLAIM_ACTIVE = ['CLAIMED', 'PREPARING', 'RUNNING', 'VERIFYING', 'REPORTING', 'REPORT_PENDING', 'INTERRUPTED'];

test('every state is either terminal or has outgoing events', () => {
  for (const s of STATES) {
    if (isTerminal(s)) {
      for (const e of EVENTS) assert.equal(applyEvent(s, e).ok, false);
    } else {
      assert.ok(EVENTS.some(e => applyEvent(s, e).ok), `${s} has an accepted event`);
    }
  }
  assert.deepEqual([...STATES].sort(), [...new Set(STATES)].sort());
  assert.ok(TERMINAL_STATES.includes('READY_FOR_REVIEW'));
  assert.ok(TERMINAL_STATES.includes('RECONCILE_REQUIRED'));
});

test('terminal states are immutable for every event (no overwrite)', () => {
  for (const s of TERMINAL_STATES) {
    for (const e of [...EVENTS, 'HOLD', 'RECONCILE', 'CLAIM', 'x', null, undefined, 42, {}]) {
      const r = applyEvent(s, e);
      assert.equal(r.ok, false);
      assert.equal(r.state, s);
      assert.equal(r.reason, 'TERMINAL_STATE_IMMUTABLE');
    }
  }
});

test('unknown events fail closed to the hold target', () => {
  for (const s of PRE_CLAIM) {
    const r = applyEvent(s, 'NOT_AN_EVENT');
    assert.deepEqual([r.ok, r.state, r.reason], [false, 'HELD', 'UNKNOWN_EVENT']);
  }
  for (const s of POST_CLAIM_ACTIVE) {
    const r = applyEvent(s, 'NOT_AN_EVENT');
    assert.deepEqual([r.ok, r.state, r.reason], [false, 'RECONCILE_REQUIRED', 'UNKNOWN_EVENT']);
  }
});

test('non-string and prototype-ish events are unknown, never accepted', () => {
  for (const e of [null, undefined, 0, 1, {}, [], '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
    const r = applyEvent('RUNNING', e);
    assert.equal(r.ok, false);
    assert.equal(r.state, 'RECONCILE_REQUIRED');
    assert.equal(r.reason, 'UNKNOWN_EVENT');
  }
});

test('a known event in the wrong state is held, not applied', () => {
  const r = applyEvent('CLAIMED', 'EXIT_CLEAN');
  assert.deepEqual([r.ok, r.state, r.reason], [false, 'RECONCILE_REQUIRED', 'EVENT_NOT_ALLOWED_IN_STATE']);
  const h = applyEvent('AUTHORIZED', 'VERIFIED');
  assert.deepEqual([h.ok, h.state], [false, 'HELD']);
});

test('unknown or non-string state fails closed to HELD', () => {
  for (const s of ['NOPE', null, undefined, 3, {}, '']) {
    const r = applyEvent(s, 'CLAIM');
    assert.deepEqual([r.ok, r.state, r.reason], [false, 'HELD', 'UNKNOWN_STATE']);
  }
});

test('happy path reaches READY_FOR_REVIEW only through REPORTING', () => {
  const events = ['ADMIT', 'GRANT_OK', 'CLAIM', 'PREPARE', 'PREPARED', 'EXIT_CLEAN', 'VERIFIED', 'REPORT_OK'];
  let s = 'PROPOSED';
  const seen = [s];
  for (const e of events) {
    const r = applyEvent(s, e);
    assert.equal(r.ok, true, `${s} --${e}-->`);
    s = r.state;
    seen.push(s);
  }
  assert.equal(s, 'READY_FOR_REVIEW');
  assert.ok(seen.indexOf('REPORTING') < seen.indexOf('READY_FOR_REVIEW'));
});

test('READY_FOR_REVIEW is unreachable except from REPORTING or REPORT_PENDING', () => {
  const into = STATES.filter(s => canTransition(s, 'READY_FOR_REVIEW')).sort();
  assert.deepEqual(into, ['REPORTING', 'REPORT_PENDING']);
});

test('RUNNING cannot skip verification or reporting', () => {
  assert.equal(canTransition('RUNNING', 'READY_FOR_REVIEW'), false);
  assert.equal(canTransition('RUNNING', 'REPORTING'), false);
  assert.equal(canTransition('VERIFYING', 'READY_FOR_REVIEW'), false);
  assert.equal(canTransition('CLAIMED', 'RUNNING'), false);
});

test('there is no backward or terminal-leaving transition', () => {
  assert.equal(canTransition('RUNNING', 'CLAIMED'), false);
  assert.equal(canTransition('STOPPED', 'RUNNING'), false);
  assert.equal(canTransition('RECONCILE_REQUIRED', 'CLAIMED'), false);
  assert.equal(canTransition('FAILED_SCOPE', 'VERIFYING'), false);
  for (const t of TERMINAL_STATES) for (const s of STATES) assert.equal(canTransition(t, s), false);
});

test('transition() throws a stable code for illegal moves', () => {
  assert.equal(transition('CLAIMED', 'PREPARING'), 'PREPARING');
  assert.throws(() => transition('CLAIMED', 'RUNNING'), e => e instanceof BridgeError && e.code === 'INVALID_STATE_TRANSITION');
  assert.throws(() => transition('NOPE', 'HELD'), e => e.code === 'INVALID_STATE_TRANSITION');
});

test('holdTarget distinguishes pre-claim HOLD from post-claim reconciliation', () => {
  for (const s of PRE_CLAIM) assert.equal(holdTarget(s), 'HELD');
  for (const s of POST_CLAIM_ACTIVE) assert.equal(holdTarget(s), 'RECONCILE_REQUIRED');
  for (const s of TERMINAL_STATES) assert.equal(holdTarget(s), null);
  assert.equal(holdTarget('NOPE'), null);
});

test('every failure path from RUNNING is a distinct terminal state', () => {
  const map = {TIMEOUT: 'TIMED_OUT', STOP: 'STOPPED', QUOTA: 'FAILED_QUOTA', ADAPTER_FAILURE: 'FAILED_ADAPTER', RECONCILE: 'RECONCILE_REQUIRED'};
  for (const [e, to] of Object.entries(map)) {
    const r = applyEvent('RUNNING', e);
    assert.equal(r.state, to);
    assert.equal(isTerminal(to), true);
  }
  assert.equal(applyEvent('RUNNING', 'INTERRUPT').state, 'INTERRUPTED');
  assert.equal(applyEvent('INTERRUPTED', 'RECONCILE').state, 'RECONCILE_REQUIRED');
});

test('applyEvent results are frozen and the function is pure', () => {
  const r = applyEvent('CLAIMED', 'PREPARE');
  assert.equal(Object.isFrozen(r), true);
  assert.equal(applyEvent('CLAIMED', 'PREPARE').state, r.state);
});

test('isState and isTerminal reject non-states', () => {
  for (const x of ['', 'nope', null, 1, {}, 'running']) {
    assert.equal(isState(x), false);
    assert.equal(isTerminal(x), false);
  }
});

test('canonical() sorts keys and is stable', () => {
  assert.equal(canonical({b: 1, a: [2, {d: 'x', c: null}]}), '{"a":[2,{"c":null,"d":"x"}],"b":1}');
  assert.equal(digest({a: 1, b: 2}), digest({b: 2, a: 1}));
  assert.notEqual(digest({a: 1}), digest({a: 2}));
});

test('canonical() fails closed on unsupported values', () => {
  for (const v of [1.5, NaN, Infinity, -0, undefined, () => 1, Symbol('x'), 10n, new Date(), new Map(), {a: undefined}]) {
    assert.throws(() => canonical(v), e => e instanceof BridgeError && e.code === 'INVALID_CANONICAL_INPUT');
  }
});

test('exact() demands precisely the listed own keys on plain objects', () => {
  assert.equal(exact({a: 1, b: 2}, ['a', 'b']), true);
  assert.equal(exact({a: 1}, ['a', 'b']), false);
  assert.equal(exact({a: 1, b: 2, c: 3}, ['a', 'b']), false);
  assert.equal(exact(Object.create({a: 1}), ['a']), false);
  assert.equal(exact([], []), false);
  assert.equal(exact(null, []), false);
  assert.equal(exact(new (class X { constructor() { this.a = 1; } })(), ['a']), false);
});

test('isTimestamp accepts only canonical millisecond ISO strings', () => {
  assert.equal(isTimestamp('2026-11-02T00:00:00.000Z'), true);
  for (const x of ['2026-11-02T00:00:00Z', '2026-11-02 00:00:00.000Z', '2026-13-02T00:00:00.000Z', 'x', null, 5, '2026-11-02T00:00:00.000+00:00']) {
    assert.equal(isTimestamp(x), false);
  }
});

test('fail() throws a BridgeError carrying the code', () => {
  assert.throws(() => fail('SOME_CODE'), e => e.name === 'BridgeError' && e.code === 'SOME_CODE' && e.message === 'SOME_CODE');
});
