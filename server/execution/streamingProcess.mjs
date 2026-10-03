import { spawn as nodeSpawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export const DEFAULT_PROCESS_LIMITS = Object.freeze({
  maxLineBytes: 1024 * 1024,
  maxStdoutBytes: 32 * 1024 * 1024,
  maxStderrBytes: 256 * 1024,
});

/**
 * Launch an executable directly (never through a shell), stream stdout as
 * bounded lines, and terminate it honestly.
 *
 * - argv only; `shell` is always false.
 * - stdin is written once and closed (prompt transport).
 * - output limits terminate the child and are reported; nothing is silently truncated.
 * - cancel(): SIGTERM -> wait killGraceMs -> SIGKILL -> wait killGraceMs. `done` reports
 *   exitObserved=false if the process never exited, so callers cannot claim CANCELLED early.
 *   The Claude CLI exposes no verified graceful-cancel channel, so none is used.
 * - On a real spawn the child leads its own process group, and signals go to the group.
 */
export function startProcess({
  command,
  args,
  cwd,
  env,
  stdin,
  limits = {},
  onLine = () => {},
  timeoutMs = 0,
  killGraceMs = 5000,
  spawnImpl = nodeSpawn,
}) {
  if (typeof command !== 'string' || !command || command.includes('\0')) throw new Error('Invalid process specification');
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && !a.includes('\0'))) throw new Error('Invalid process specification');
  const max = { ...DEFAULT_PROCESS_LIMITS, ...limits };
  const realSpawn = spawnImpl === nodeSpawn;

  let child;
  try {
    child = spawnImpl(command, args, { cwd, env, shell: false, detached: realSpawn, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch (spawnError) {
    return { pid: undefined, cancel() {}, done: Promise.resolve({ spawnError, exitCode: null, signal: null, exitObserved: false, stderr: '', limit: null, terminateReason: null, stdoutBytes: 0, finalLinePartial: false }) };
  }

  let stdoutBytes = 0;
  let stderr = '';
  let stderrBytes = 0;
  let pending = '';
  let limit = null;
  let terminateReason = null;
  let exited = false;
  let spawnError = null;
  let finalLinePartial = false;
  let finished = false;
  const timers = [];
  const decoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const signal = (name) => {
    try {
      if (realSpawn && child.pid) process.kill(-child.pid, name);
      else child.kill(name);
    } catch {
      try { child.kill(name); } catch { /* already gone */ }
    }
  };
  const settle = (extra = {}) => {
    if (finished) return;
    finished = true;
    for (const t of timers) clearTimeout(t);
    resolveDone({ spawnError, exitCode: child.exitCode ?? null, signal: child.signalCode ?? null, exitObserved: exited, stderr, limit, terminateReason, stdoutBytes, finalLinePartial, ...extra });
  };
  const terminate = (reason) => {
    if (terminateReason !== null || exited) return;
    terminateReason = reason;
    signal('SIGTERM');
    const kill = setTimeout(() => {
      if (exited) return;
      signal('SIGKILL');
      const giveUp = setTimeout(() => { if (!exited) settle(); }, killGraceMs);
      timers.push(giveUp);
    }, killGraceMs);
    timers.push(kill);
  };
  const trip = (kind) => {
    if (limit === null) { limit = kind; terminate('limit'); }
  };

  const feed = (text) => {
    pending += text;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (Buffer.byteLength(line) > max.maxLineBytes) { trip('LINE_LIMIT'); pending = ''; return; }
      if (line !== '') onLine(line);
    }
    if (Buffer.byteLength(pending) > max.maxLineBytes) { trip('LINE_LIMIT'); pending = ''; }
  };

  child.stdout?.on('data', (chunk) => {
    if (limit !== null) return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > max.maxStdoutBytes) { trip('STDOUT_LIMIT'); return; }
    feed(decoder.write(chunk));
  });
  child.stdout?.on('end', () => {
    if (limit !== null) return;
    const rest = pending + decoder.end();
    pending = '';
    if (rest.trim() !== '') { finalLinePartial = true; onLine(rest.replace(/\r$/, '')); }
  });
  child.stderr?.on('data', (chunk) => {
    if (limit !== null && limit !== 'STDERR_LIMIT') return;
    stderrBytes += chunk.length;
    if (stderrBytes > max.maxStderrBytes) { trip('STDERR_LIMIT'); return; }
    stderr += errDecoder.write(chunk);
  });
  child.stdin?.on('error', () => { /* child may exit before reading stdin */ });
  child.on('error', (error) => {
    spawnError = error;
    exited = true;
    settle();
  });
  child.on('exit', () => {
    exited = true;
    const grace = setTimeout(() => settle(), 2000); // grandchildren holding stdio must not hang us
    timers.push(grace);
  });
  child.on('close', () => { exited = true; settle(); });

  if (stdin !== undefined) child.stdin?.end(stdin);
  else child.stdin?.end();
  if (timeoutMs > 0) {
    const timeout = setTimeout(() => terminate('timeout'), timeoutMs);
    timers.push(timeout);
  }

  return { pid: child.pid, cancel: (reason = 'cancel') => terminate(reason), done };
}

/** Run to completion and capture stdout lines (used for bounded --version/--help/auth probes). */
export async function runCapture({ timeoutMs = 10_000, ...spec }) {
  const lines = [];
  const handle = startProcess({ ...spec, timeoutMs, onLine: (line) => lines.push(line), limits: { maxStdoutBytes: 512 * 1024, ...(spec.limits ?? {}) } });
  const result = await handle.done;
  return { ...result, stdout: lines.join('\n') };
}
