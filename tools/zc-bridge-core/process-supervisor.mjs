// ZC-MVP-B1 Local Bridge core: bounded supervision of TEST FAKE child processes.
// Issue #119. This is the only module allowed to import node:child_process.
//
// It can run exactly one kind of child: `node <script>` where <script> is a
// regular file inside a private mkdtemp fixture directory. It cannot run `agy`,
// a shell, or any command or argument derived from task text. The command is
// fixed to process.execPath and the script must live in the fixture.
//
// Provenance (design reference / re-implementation, nothing copied verbatim):
//   repo   augusliang23-web/cc-h15a-claude-dispatch-lab
//   path   bridge/zc06c-single-model.mjs (Draft PR #36, HOLD): supervisedRun
//          process-group timeout idea and safeEnvironment allowlist idea only.
//          NOT ported: CONTRACT, --once, real agent launch, policy transaction,
//          inspectDenyPolicy, inspectAgYExecutable.
//   commit f8df9a24dfd6f3745516d585219017bcbe28edec (PR #36 head, evidence only)
//
// macOS process-group behaviour is UNKNOWN until observed on a real host: the
// group-liveness probe below uses kill(-pgid, 0).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn as nodeSpawn} from 'node:child_process';
import {BridgeError, fail} from './state-machine.mjs';

export const SUPERVISOR_LIMITS = Object.freeze({
  maxStdoutBytes: 32768,
  maxArgs: 8,
  maxArgLength: 512,
  maxScriptBytes: 65536,
  minTimeoutMs: 50,
  maxTimeoutMs: 1200000,
});

// A fixture root is a direct child of the OS temp directory, named like
// mkdtemp(".../zc-bridge-core-XXXXXX"), canonical, private and owned by us.
export function assertFixtureRoot(root) {
  const uid = process.getuid?.();
  if (uid === undefined) fail('PLATFORM_UNSUPPORTED');
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('UNSAFE_FIXTURE_ROOT');
  let st;
  try {
    st = fs.lstatSync(root);
    if (fs.realpathSync(root) !== root) fail('UNSAFE_FIXTURE_ROOT');
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir())) fail('UNSAFE_FIXTURE_ROOT');
  } catch (e) {
    if (e instanceof BridgeError) throw e;
    return fail('UNSAFE_FIXTURE_ROOT');
  }
  if (!/^zc-bridge-core-[A-Za-z0-9]{6}$/.test(path.basename(root)) ||
      !st.isDirectory() || st.isSymbolicLink() || st.uid !== uid ||
      (st.mode & 0o777) !== 0o700) fail('UNSAFE_FIXTURE_ROOT');
  return root;
}

export function assertFakeChild({command, args, fixtureRoot}) {
  assertFixtureRoot(fixtureRoot);
  if (command !== process.execPath) fail('SUPERVISOR_COMMAND_NOT_ALLOWED');
  if (!Array.isArray(args) || args.length < 1 || args.length > SUPERVISOR_LIMITS.maxArgs)
    fail('SUPERVISOR_ARGS_INVALID');
  for (const a of args) {
    if (typeof a !== 'string' || a.length > SUPERVISOR_LIMITS.maxArgLength || a.includes('\0'))
      fail('SUPERVISOR_ARGS_INVALID');
  }
  const script = args[0];
  // args[0] is the script, so no node flag (--eval, -p, --require...) can lead.
  if (script.startsWith('-') || !path.isAbsolute(script) || !/\.m?js$/.test(script))
    fail('SUPERVISOR_SCRIPT_INVALID');
  if (path.basename(script).toLowerCase().startsWith('agy'))
    fail('SUPERVISOR_SCRIPT_INVALID');
  let st;
  try {
    st = fs.lstatSync(script);
    if (fs.realpathSync(script) !== script) fail('SUPERVISOR_SCRIPT_INVALID');
  } catch (e) {
    if (e instanceof BridgeError) throw e;
    return fail('SUPERVISOR_SCRIPT_INVALID');
  }
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 ||
      st.size > SUPERVISOR_LIMITS.maxScriptBytes ||
      path.dirname(script) !== fixtureRoot) fail('SUPERVISOR_SCRIPT_INVALID');
}

// Explicit allowlist: nothing is inherited from the parent environment.
export function safeEnvironment({tmp}) {
  if (typeof tmp !== 'string' || !path.isAbsolute(tmp)) fail('SUPERVISOR_ENV_INVALID');
  return {PATH: '/usr/bin:/bin', TMPDIR: tmp, LANG: 'C', LC_ALL: 'C', CI: 'true', NO_COLOR: '1'};
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Resolves with a plain result object; never throws for child misbehaviour.
//   error: null | TIMEOUT | ABORTED | OUTPUT_LIMIT | SPAWN_FAILED |
//          SPAWN_UNOBSERVABLE | PROCESS_STILL_ALIVE | SPAWN_ERROR
// stderr content is never returned, only its byte count.
export async function supervisedRun({
  command, args, cwd, env, fixtureRoot, timeoutMs,
  shouldAbort = () => false, abortPollMs = 20, graceMs = 300,
  launch = nodeSpawn, sendSignal = process.kill,
} = {}) {
  assertFakeChild({command, args, fixtureRoot});
  if (!Number.isInteger(timeoutMs) || timeoutMs < SUPERVISOR_LIMITS.minTimeoutMs ||
      timeoutMs > SUPERVISOR_LIMITS.maxTimeoutMs) fail('SUPERVISOR_TIMEOUT_INVALID');
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) ||
      path.dirname(cwd) !== fixtureRoot) fail('SUPERVISOR_CWD_INVALID');
  const startedAt = Date.now();
  let child;
  try {
    child = launch(command, args, {
      cwd, env, shell: false, detached: true, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { return {error: 'SPAWN_FAILED', status: null, signal: null, stdout: '', stderrBytes: 0, groupExitObserved: true, exitObserved: false, durationMs: 0}; }

  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 1 || !child.stdout || !child.stderr ||
      typeof child.once !== 'function') {
    child?.once?.('error', () => {});
    try { child?.kill?.('SIGKILL'); } catch { /* ignore */ }
    return {error: 'SPAWN_UNOBSERVABLE', status: null, signal: null, stdout: '', stderrBytes: 0, groupExitObserved: false, exitObserved: false, durationMs: Date.now() - startedAt};
  }

  const out = [];
  let bytes = 0;
  let stderrBytes = 0;
  let overflow = false;
  let aborted = false;
  let closed = false;
  const groupGone = () => {
    try { sendSignal(-pid, 0); return false; }
    catch (e) { return e?.code === 'ESRCH'; }
  };
  const stop = signal => { try { sendSignal(-pid, signal); } catch { /* ignore */ } };

  const ended = new Promise(resolve => {
    let settled = false;
    const done = (status, signal, error) => {
      if (settled) return;
      settled = true;
      closed = true;
      resolve({status, signal, error});
    };
    child.once('error', () => done(null, null, 'SPAWN_ERROR'));
    child.once('close', (status, signal) => done(status, signal, null));
  });
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > SUPERVISOR_LIMITS.maxStdoutBytes) { overflow = true; stop('SIGKILL'); return; }
    out.push(Buffer.from(chunk));
  });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });

  let timer;
  let poller;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({timeout: true}), timeoutMs); });
  const abort = new Promise(resolve => {
    poller = setInterval(() => {
      let want = false;
      try { want = shouldAbort() === true; } catch { want = true; }
      if (want) resolve({abort: true});
    }, abortPollMs);
  });
  const first = await Promise.race([ended, timeout, abort]);
  clearTimeout(timer);
  clearInterval(poller);

  let result = first;
  if (first.timeout || first.abort) {
    aborted = Boolean(first.abort);
    stop('SIGTERM');
    result = await Promise.race([ended, delay(graceMs).then(() => ({stuck: true}))]);
    if (result.stuck) {
      stop('SIGKILL');
      result = await Promise.race([ended, delay(graceMs).then(() => ({stuck: true}))]);
    }
  }
  // A clean parent exit does not imply the whole process group is gone.
  if (!groupGone()) {
    stop('SIGTERM');
    await delay(150);
    if (!groupGone()) { stop('SIGKILL'); await delay(150); }
  }
  const groupExitObserved = groupGone();
  let error = null;
  if (first.timeout) error = 'TIMEOUT';
  else if (aborted) error = 'ABORTED';
  else if (overflow) error = 'OUTPUT_LIMIT';
  else if (result.stuck) error = 'PROCESS_STILL_ALIVE';
  else error = result.error ?? null;
  if (!groupExitObserved && error === null) error = 'PROCESS_STILL_ALIVE';
  return {
    error,
    status: result.status ?? null,
    signal: result.signal ?? null,
    stdout: Buffer.concat(out).toString('utf8'),
    stderrBytes,
    groupExitObserved,
    exitObserved: closed,
    durationMs: Date.now() - startedAt,
  };
}
