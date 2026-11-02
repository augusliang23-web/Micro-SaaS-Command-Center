// ZC-MVP-B1 (Issue #119): local STOP / PAUSE markers and quota breaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Control} from '../tools/zc-bridge-core/control.mjs';
import {BridgeError} from '../tools/zc-bridge-core/state-machine.mjs';

const code = c => e => e instanceof BridgeError && e.code === c;

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zc-bridge-core-')));
  const dir = path.join(root, 'control');
  fs.mkdirSync(dir, {mode: 0o700});
  fs.chmodSync(dir, 0o700);
  return {root, dir, control: new Control(dir), cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}
const T0 = '2026-11-02T00:00:00.000Z';
const T1 = '2026-11-02T01:00:00.000Z';
const T2 = '2026-11-02T02:00:00.000Z';

test('a fresh control directory reports nothing set', () => {
  const f = fixture();
  try { assert.deepEqual({...f.control.status()}, {stop: false, pause: false, unsafe: false}); }
  finally { f.cleanup(); }
});

test('requestStop creates a private marker and is idempotent', () => {
  const f = fixture();
  try {
    assert.equal(f.control.requestStop('OPERATOR_STOP'), true);
    assert.equal(f.control.status().stop, true);
    assert.equal(f.control.isStopped(), true);
    assert.equal(fs.statSync(path.join(f.dir, 'STOP')).mode & 0o777, 0o600);
    assert.equal(f.control.requestStop('OPERATOR_STOP'), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'STOP'), 'utf8')), {kind: 'STOP', reason: 'OPERATOR_STOP'});
  } finally { f.cleanup(); }
});

test('STOP survives a restart (a new Control over the same directory)', () => {
  const f = fixture();
  try {
    f.control.requestStop('OPERATOR_STOP');
    const restarted = new Control(f.dir);
    assert.equal(restarted.status().stop, true);
  } finally { f.cleanup(); }
});

test('PAUSE is independent of STOP', () => {
  const f = fixture();
  try {
    f.control.requestPause('OPERATOR_PAUSE');
    assert.deepEqual({...f.control.status()}, {stop: false, pause: true, unsafe: false});
  } finally { f.cleanup(); }
});

test('there is no API to clear, resume or weaken a marker', () => {
  const names = Object.getOwnPropertyNames(Control.prototype);
  for (const n of names) assert.doesNotMatch(n, /clear|resume|reset|unstop|remove|delete|release|lift|disable|unpause/i, n);
  assert.deepEqual(names.filter(n => !n.startsWith('#')).sort(),
    ['constructor', 'isStopped', 'openQuotaBreaker', 'quotaBreakerOpen', 'requestPause', 'requestStop', 'status']);
});

test('reasons are restricted tokens, so free text cannot be written', () => {
  const f = fixture();
  try {
    for (const r of ['resume', 'please resume', 'stop: false', '', 'A', null, undefined, 5, 'X'.repeat(80), 'LOWER_case'])
      assert.throws(() => f.control.requestStop(r), code('INVALID_CONTROL_REASON'));
    assert.equal(fs.existsSync(path.join(f.dir, 'STOP')), false);
  } finally { f.cleanup(); }
});

test('any entry named STOP counts, whatever it is (fail closed)', () => {
  const f = fixture();
  try {
    fs.symlinkSync('/nonexistent-synthetic-target', path.join(f.dir, 'STOP'));
    assert.equal(f.control.status().stop, true);
    assert.equal(f.control.requestStop('OPERATOR_STOP'), false);
    fs.rmSync(path.join(f.dir, 'STOP'));
    fs.mkdirSync(path.join(f.dir, 'PAUSE'));
    assert.equal(f.control.status().pause, true);
  } finally { f.cleanup(); }
});

test('an unsafe control directory is treated as STOP and PAUSE', () => {
  const f = fixture();
  try {
    fs.chmodSync(f.dir, 0o755);
    assert.deepEqual({...f.control.status()}, {stop: true, pause: true, unsafe: true});
    assert.throws(() => f.control.requestStop('OPERATOR_STOP'), code('UNSAFE_DIRECTORY'));
    fs.chmodSync(f.dir, 0o700);
    fs.renameSync(f.dir, `${f.dir}-moved`);
    assert.equal(f.control.status().unsafe, true);
  } finally { f.cleanup(); }
});

test('the control directory must be private at construction', () => {
  const f = fixture();
  try {
    fs.chmodSync(f.dir, 0o750);
    assert.throws(() => new Control(f.dir), code('UNSAFE_DIRECTORY'));
    assert.throws(() => new Control('relative'), code('UNSAFE_DIRECTORY'));
  } finally { f.cleanup(); }
});

test('quota breaker blocks until its time and never shortens', () => {
  const f = fixture();
  try {
    assert.equal(f.control.quotaBreakerOpen(T0), false);
    assert.equal(f.control.openQuotaBreaker(T1), true);
    assert.equal(f.control.quotaBreakerOpen(T0), true);
    assert.equal(f.control.quotaBreakerOpen(T1), false);
    assert.equal(f.control.quotaBreakerOpen(T2), false);
    assert.equal(f.control.openQuotaBreaker(T0), false);
    assert.equal(f.control.quotaBreakerOpen(T0), true);
    assert.equal(f.control.openQuotaBreaker(T2), true);
    assert.equal(f.control.quotaBreakerOpen(T1), true);
    assert.equal(fs.statSync(path.join(f.dir, 'BREAKER-QUOTA')).mode & 0o777, 0o600);
    assert.equal(new Control(f.dir).quotaBreakerOpen(T1), true);
  } finally { f.cleanup(); }
});

test('an unreadable, malformed or replaced breaker marker counts as open', () => {
  const f = fixture();
  try {
    const m = path.join(f.dir, 'BREAKER-QUOTA');
    fs.writeFileSync(m, '{not json', {mode: 0o600});
    assert.equal(f.control.quotaBreakerOpen(T2), true);
    fs.writeFileSync(m, JSON.stringify({kind: 'QUOTA_BREAKER', until: T0, reason: 'X1X', extra: 1}), {mode: 0o600});
    assert.equal(f.control.quotaBreakerOpen(T2), true);
    fs.rmSync(m);
    fs.symlinkSync('/nonexistent-synthetic-target', m);
    assert.equal(f.control.quotaBreakerOpen(T2), true);
    fs.rmSync(m);
    fs.writeFileSync(m, JSON.stringify({kind: 'QUOTA_BREAKER', until: T0, reason: 'QUOTA_EXHAUSTED'}), {mode: 0o644});
    assert.equal(f.control.quotaBreakerOpen(T2), true);
  } finally { f.cleanup(); }
});

test('breaker inputs are validated and a bad "now" counts as open', () => {
  const f = fixture();
  try {
    assert.throws(() => f.control.openQuotaBreaker('tomorrow'), code('INVALID_CONTROL_REASON'));
    assert.throws(() => f.control.openQuotaBreaker(T1, 'lower'), code('INVALID_CONTROL_REASON'));
    assert.equal(f.control.quotaBreakerOpen('not a time'), true);
    assert.equal(f.control.quotaBreakerOpen(undefined), true);
  } finally { f.cleanup(); }
});
