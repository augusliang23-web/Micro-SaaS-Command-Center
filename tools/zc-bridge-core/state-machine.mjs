// ZC-MVP-B1 Local Bridge core: state machine and shared pure helpers.
// Issue #119. MOCK-ONLY, OFFLINE: no network, no subprocess, no filesystem here.
//
// Provenance (design reference / re-implementation, nothing copied verbatim):
//   repo   augusliang23-web/cc-h15a-claude-dispatch-lab
//   path   bridge/foundation.mjs (transition table idea), bridge/security.mjs
//          (canonical JSON / exact-key helpers idea)
//   commit b577bbae9e26c8751db9fe389753c4dda1b5cdac
// States and transitions follow the ZC-MVP-A design (Issue #118, section 6.4).
import {createHash} from 'node:crypto';

export class BridgeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BridgeError';
    this.code = code;
  }
}
export const fail = code => { throw new BridgeError(code); };

export const isRecord = x => x !== null && typeof x === 'object' &&
  !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
export const exact = (x, keys) => isRecord(x) &&
  Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
export const isTimestamp = x => typeof x === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;

// Restricted canonical JSON (sorted keys, safe integers only). Not RFC 8785.
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0))
    return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isRecord(value))
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return fail('INVALID_CANONICAL_INPUT');
}
export const digest = value =>
  createHash('sha256').update(canonical(value), 'utf8').digest('hex');

// event -> next state, per current state. A state absent from this table is
// terminal: no event can ever move it (terminal states are immutable).
const EVENT_TABLE = deepFreeze({
  PROPOSED: {ADMIT: 'PENDING_GRANT', REJECT: 'REJECTED', HOLD: 'HELD'},
  PENDING_GRANT: {GRANT_OK: 'AUTHORIZED', EXPIRE: 'EXPIRED', REJECT: 'REJECTED', HOLD: 'HELD'},
  AUTHORIZED: {CLAIM: 'CLAIMED', EXPIRE: 'EXPIRED', HOLD: 'HELD'},
  CLAIMED: {PREPARE: 'PREPARING', RECONCILE: 'RECONCILE_REQUIRED'},
  PREPARING: {PREPARED: 'RUNNING', PREP_FAILED: 'FAILED_PREP', RECONCILE: 'RECONCILE_REQUIRED'},
  RUNNING: {
    EXIT_CLEAN: 'VERIFYING', TIMEOUT: 'TIMED_OUT', STOP: 'STOPPED',
    INTERRUPT: 'INTERRUPTED', QUOTA: 'FAILED_QUOTA',
    ADAPTER_FAILURE: 'FAILED_ADAPTER', RECONCILE: 'RECONCILE_REQUIRED',
  },
  VERIFYING: {
    VERIFIED: 'REPORTING', SCOPE_VIOLATION: 'FAILED_SCOPE',
    ADAPTER_FAILURE: 'FAILED_ADAPTER', RECONCILE: 'RECONCILE_REQUIRED',
  },
  REPORTING: {
    REPORT_OK: 'READY_FOR_REVIEW', REPORT_DEFERRED: 'REPORT_PENDING',
    RECONCILE: 'RECONCILE_REQUIRED',
  },
  REPORT_PENDING: {REPORT_OK: 'READY_FOR_REVIEW', RECONCILE: 'RECONCILE_REQUIRED'},
  INTERRUPTED: {RECONCILE: 'RECONCILE_REQUIRED'},
});
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

const TERMINAL = [
  'REJECTED', 'EXPIRED', 'HELD', 'FAILED_PREP', 'TIMED_OUT', 'STOPPED',
  'FAILED_SCOPE', 'FAILED_ADAPTER', 'FAILED_QUOTA', 'READY_FOR_REVIEW',
  'RECONCILE_REQUIRED',
];
export const STATES = Object.freeze([...Object.keys(EVENT_TABLE), ...TERMINAL]);
export const TERMINAL_STATES = Object.freeze([...TERMINAL]);
export const EVENTS = Object.freeze([...new Set(
  Object.values(EVENT_TABLE).flatMap(m => Object.keys(m)))].sort());

export const isState = s => typeof s === 'string' && STATES.includes(s);
export const isTerminal = s => TERMINAL.includes(s);

export function canTransition(from, to) {
  if (!Object.hasOwn(EVENT_TABLE, from)) return false;
  return Object.values(EVENT_TABLE[from]).includes(to);
}
export function transition(from, to) {
  if (!canTransition(from, to)) fail('INVALID_STATE_TRANSITION');
  return to;
}

// Where an unexpected event sends a non-terminal state: before a claim it is a
// HOLD; once a claim exists the outcome of the attempt is uncertain, so a human
// must reconcile it. Terminal states have no hold target.
export function holdTarget(state) {
  const row = Object.hasOwn(EVENT_TABLE, state) ? EVENT_TABLE[state] : null;
  if (!row) return null;
  if (Object.hasOwn(row, 'HOLD')) return row.HOLD;
  if (Object.hasOwn(row, 'RECONCILE')) return row.RECONCILE;
  return null;
}

// Pure, fail-closed event application. Never throws, never mutates.
//   terminal state          -> unchanged, ok:false  (immutable)
//   unknown state           -> HELD,      ok:false
//   unknown/illegal event   -> holdTarget(state), ok:false
export function applyEvent(state, event) {
  if (!isState(state))
    return Object.freeze({ok: false, state: 'HELD', reason: 'UNKNOWN_STATE'});
  if (isTerminal(state))
    return Object.freeze({ok: false, state, reason: 'TERMINAL_STATE_IMMUTABLE'});
  const row = EVENT_TABLE[state];
  if (typeof event === 'string' && Object.hasOwn(row, event))
    return Object.freeze({ok: true, state: row[event], reason: null});
  const target = holdTarget(state);
  return Object.freeze({
    ok: false,
    state: target ?? state,
    reason: EVENTS.includes(event) ? 'EVENT_NOT_ALLOWED_IN_STATE' : 'UNKNOWN_EVENT',
  });
}
