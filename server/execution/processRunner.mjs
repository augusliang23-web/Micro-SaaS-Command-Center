import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';

/** Executable + argv only. No task-supplied environment, shell or process options. */
export async function runProcess({ command, args, cwd, timeoutMs = 30_000, indexFile }) {
  if (typeof command !== 'string' || !command || command.includes('\0') || !Array.isArray(args) || !args.every(a => typeof a === 'string' && !a.includes('\0'))) throw new Error('Invalid process specification');
  // Ambient Git overrides must not redirect operations outside the selected cwd.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  // The only Git variable that can be set, and only by server code (never a task): an absolute scratch index for tree computation.
  if (indexFile !== undefined) { if (typeof indexFile !== 'string' || !indexFile.startsWith('/') || indexFile.includes('\0')) throw new Error('Invalid process specification'); env.GIT_INDEX_FILE = indexFile; }
  const start = performance.now();
  return await new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env, shell: false, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && !Number.isInteger(error.code) && !error.killed && !error.signal) { reject(error); return; }
      resolve({ command, args: [...args], stdout, stderr, exitCode: error ? (Number.isInteger(error.code) ? error.code : null) : 0, signal: error?.signal ?? null, durationMs: performance.now() - start });
    });
  });
}
