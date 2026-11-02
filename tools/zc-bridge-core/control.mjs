// ZC-MVP-B1 Local Bridge core: local STOP / PAUSE markers and quota breaker.
// Issue #119. MOCK-ONLY, OFFLINE: filesystem markers in a private directory.
//
// Authority is asymmetric by design: anything may make the bridge SAFER, but
// nothing in this module (and no task text) can make it LESS safe.
//   * requestStop / requestPause create a marker. There is deliberately NO
//     clear/resume function. An operator removes a marker by hand, locally.
//   * status() is fail-closed: an unreadable marker, a marker of the wrong
//     type, or an unsafe control directory all count as STOP.
// Provenance: new design for ZC-MVP-B1 (Issue #118 sections 5.2/6.5).
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fail, isTimestamp, canonical, exact} from './state-machine.mjs';
import {assertPrivateDirectory} from './journal.mjs';

const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const MARKERS = Object.freeze({STOP: 'STOP', PAUSE: 'PAUSE', BREAKER: 'BREAKER-QUOTA'});

export class Control {
  #dir; #io;
  constructor(dir, {io = fs} = {}) {
    assertPrivateDirectory(dir, io);
    this.#dir = dir;
    this.#io = io;
  }
  #p(name) { return path.join(this.#dir, name); }

  // Presence only. Any entry with the marker name counts, whatever it is.
  #present(name) {
    try { this.#io.lstatSync(this.#p(name)); return true; }
    catch (e) { return e?.code === 'ENOENT' ? false : true; }
  }

  status() {
    try { assertPrivateDirectory(this.#dir, this.#io); }
    catch { return Object.freeze({stop: true, pause: true, unsafe: true}); }
    return Object.freeze({
      stop: this.#present(MARKERS.STOP),
      pause: this.#present(MARKERS.PAUSE),
      unsafe: false,
    });
  }
  isStopped() { return this.status().stop; }

  #write(name, reason, extra = {}) {
    if (typeof reason !== 'string' || !REASON.test(reason)) fail('INVALID_CONTROL_REASON');
    assertPrivateDirectory(this.#dir, this.#io);
    const c = this.#io.constants ?? fs.constants;
    const body = canonical({reason, ...extra});
    let fd;
    try {
      fd = this.#io.openSync(this.#p(name),
        c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 0o600);
    } catch (e) {
      if (e?.code === 'EEXIST') return false; // already set: idempotent
      return fail('CONTROL_WRITE_FAILED');
    }
    try {
      this.#io.writeSync(fd, Buffer.from(body, 'utf8'));
      this.#io.fsyncSync(fd);
    } catch { return fail('CONTROL_WRITE_FAILED'); }
    finally { try { this.#io.closeSync(fd); } catch { /* ignore */ } }
    const dfd = this.#io.openSync(this.#dir, 'r');
    try { this.#io.fsyncSync(dfd); } finally { this.#io.closeSync(dfd); }
    return true;
  }
  requestStop(reason) { return this.#write(MARKERS.STOP, reason, {kind: 'STOP'}); }
  requestPause(reason) { return this.#write(MARKERS.PAUSE, reason, {kind: 'PAUSE'}); }

  // Quota breaker: refuses new claims until `untilIso`. Extending replaces the
  // marker atomically; it can never be shortened here.
  openQuotaBreaker(untilIso, reason = 'QUOTA_EXHAUSTED') {
    if (!isTimestamp(untilIso) || !REASON.test(reason)) fail('INVALID_CONTROL_REASON');
    assertPrivateDirectory(this.#dir, this.#io);
    const current = this.#readBreaker();
    if (current !== null && current !== 'INVALID' && Date.parse(current) >= Date.parse(untilIso))
      return false;
    const tmp = `.tmp-${randomBytes(16).toString('hex')}`;
    const c = this.#io.constants ?? fs.constants;
    const fd = this.#io.openSync(this.#p(tmp),
      c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 0o600);
    try {
      this.#io.writeSync(fd, Buffer.from(canonical({kind: 'QUOTA_BREAKER', until: untilIso, reason}), 'utf8'));
      this.#io.fsyncSync(fd);
    } finally { this.#io.closeSync(fd); }
    this.#io.renameSync(this.#p(tmp), this.#p(MARKERS.BREAKER));
    const dfd = this.#io.openSync(this.#dir, 'r');
    try { this.#io.fsyncSync(dfd); } finally { this.#io.closeSync(dfd); }
    return true;
  }
  #readBreaker() {
    if (!this.#present(MARKERS.BREAKER)) return null;
    const c = this.#io.constants ?? fs.constants;
    let fd;
    try {
      fd = this.#io.openSync(this.#p(MARKERS.BREAKER), c.O_RDONLY | c.O_NOFOLLOW);
      const st = this.#io.fstatSync(fd);
      if (!st.isFile() || st.size > 1024 || (st.mode & 0o777) !== 0o600) return 'INVALID';
      const v = JSON.parse(this.#io.readFileSync(fd, 'utf8'));
      if (!exact(v, ['kind', 'reason', 'until']) || v.kind !== 'QUOTA_BREAKER' ||
          !isTimestamp(v.until)) return 'INVALID';
      return v.until;
    } catch { return 'INVALID'; }
    finally { if (fd !== undefined) { try { this.#io.closeSync(fd); } catch { /* ignore */ } } }
  }
  // Fail closed: an unreadable/invalid breaker marker counts as open.
  quotaBreakerOpen(nowIso) {
    if (!isTimestamp(nowIso)) return true;
    const until = this.#readBreaker();
    if (until === null) return false;
    if (until === 'INVALID') return true;
    return Date.parse(nowIso) < Date.parse(until);
  }
}

