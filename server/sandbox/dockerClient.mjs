import path from 'node:path';
import { startProcess } from '../execution/streamingProcess.mjs';

/**
 * Thin Docker CLI wrapper: absolute binary, explicit argv, `shell:false`, bounded
 * output, minimal environment. The binary path comes from server configuration.
 * The runtime depends only on { run, stream }, so tests can inject a fake driver.
 */
export class DockerClient {
  #docker; #env; #spawn;
  constructor({ dockerPath, env = process.env, spawnImpl }) {
    if (typeof dockerPath !== 'string' || !path.isAbsolute(dockerPath) || path.normalize(dockerPath) !== dockerPath || dockerPath.includes('\0')) {
      throw new Error('Docker binary path must be a clean absolute path from server configuration');
    }
    if (typeof env.HOME !== 'string' || !path.isAbsolute(env.HOME)) throw new Error('HOME is required to locate the Docker context');
    this.#docker = dockerPath;
    // The CLI needs HOME (context/config) and its own bin dir on PATH (credential helpers).
    // Nothing else from the host environment — in particular no DOCKER_HOST/DOCKER_CONFIG overrides.
    this.#env = { HOME: env.HOME, PATH: `${path.dirname(dockerPath)}:/usr/bin:/bin` };
    this.#spawn = spawnImpl;
  }

  #spec(args, extra) {
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && !a.includes('\0'))) throw new Error('Invalid docker arguments');
    return { command: this.#docker, args, cwd: '/', env: this.#env, ...(this.#spawn ? { spawnImpl: this.#spawn } : {}), ...extra };
  }

  /** Run to completion; returns { exitCode, stdout, stderr, spawnError, timedOut }. */
  async run(args, { timeoutMs = 30_000, maxStdoutBytes = 512 * 1024 } = {}) {
    const lines = [];
    const handle = startProcess(this.#spec(args, { timeoutMs, killGraceMs: 1000, onLine: (l) => lines.push(l), limits: { maxStdoutBytes } }));
    const done = await handle.done;
    return { exitCode: done.exitCode, stdout: lines.join('\n'), stderr: done.stderr, spawnError: done.spawnError, timedOut: done.terminateReason === 'timeout', limit: done.limit };
  }

  /** Stream stdout lines (used for `docker start -a`). Returns { cancel, done }. */
  stream(args, { onLine, timeoutMs = 0, limits } = {}) {
    return startProcess(this.#spec(args, { onLine, timeoutMs, limits, killGraceMs: 2000 }));
  }
}
