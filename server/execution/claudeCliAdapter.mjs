import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { UNKNOWN_MODEL, gradeForEvent } from './agentAdapter.mjs';
import { createClaudeStreamParser } from './claudeStreamParser.mjs';
import { runCapture, startProcess } from './streamingProcess.mjs';
import { RUN_ID_PATTERN, TASK_ID_PATTERN, EXECUTION_PROFILES } from '../tasks/types.mjs';

// ---------------------------------------------------------------------------
// Server-owned policy. Nothing in this section is derived from a browser
// request, a task, or a prompt.
// ---------------------------------------------------------------------------

/** Edit-only tool surface. No shell, no git, no gh, no WebFetch/WebSearch. */
export const CLAUDE_TOOL_ALLOWLIST = Object.freeze(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
/** Belt and braces on top of the allowlist. */
export const CLAUDE_TOOL_DENYLIST = Object.freeze(['Bash', 'PowerShell', 'REPL', 'WebFetch', 'WebSearch', 'mcp__*']);

/**
 * Execution profile -> model/effort. This is CONFIGURATION, not domain logic:
 * persisted tasks only ever hold the profile name, and changing a model is a
 * config edit. Defaults follow the routing strategy (Sonnet normally, Opus for
 * critical gates) and can be overridden through the constructor.
 */
export const DEFAULT_CLAUDE_PROFILES = Object.freeze({
  FAST: Object.freeze({ model: 'haiku', effort: 'low' }),
  STANDARD: Object.freeze({ model: 'sonnet', effort: 'medium' }),
  DEEP: Object.freeze({ model: 'sonnet', effort: 'high' }),
  CRITICAL: Object.freeze({ model: 'opus', effort: 'high' }),
});
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function validateProfiles(profiles) {
  for (const name of EXECUTION_PROFILES) {
    const p = profiles?.[name];
    if (!p || !MODEL_PATTERN.test(p.model ?? '') || !EFFORTS.includes(p.effort)) throw new Error(`Claude profile ${name} must define a valid model and effort`);
  }
  return profiles;
}

/**
 * Flags the installed CLI (2.1.260) lists in --help, verified read-only. probe()
 * re-checks that every one is still present and fails closed otherwise.
 */
export const REQUIRED_CLAUDE_FLAGS = Object.freeze([
  '--print', '--output-format', 'stream-json', '--verbose', '--session-id', '--model', '--effort',
  '--tools', '--disallowedTools', '--permission-mode', 'acceptEdits', '--permission-prompts',
  '--restricted', '--safe-mode', '--strict-mcp-config', '--disable-slash-commands',
  '--no-session-persistence', '--no-chrome',
]);

/**
 * Child environment ALLOWLIST. Subscription auth needs HOME plus USER/LOGNAME
 * (verified: HOME+PATH alone reads as logged out; adding USER+LOGNAME restores
 * it). Everything else — ANTHROPIC_*, CLAUDE_CODE_* host/messaging tokens,
 * cloud and provider routing, GIT_*, npm/GitHub/OpenAI/SSH secrets — is dropped
 * simply by not being listed. PATH is fixed so the child cannot inherit
 * project-local tool directories.
 */
const ENV_PASSTHROUGH = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'];
export function buildClaudeEnvironment(source = process.env) {
  if (typeof source.HOME !== 'string' || !path.isAbsolute(source.HOME)) throw new Error('HOME is required for Claude subscription authentication');
  const env = { PATH: '/usr/bin:/bin', DISABLE_AUTOUPDATER: '1' };
  for (const name of ENV_PASSTHROUGH) if (typeof source[name] === 'string' && source[name] !== '' && !source[name].includes('\0')) env[name] = source[name];
  return env;
}

/** argv for one run. The prompt is NEVER in argv (it goes through stdin). */
export function buildClaudeArgs({ sessionId, model, effort }) {
  if (!MODEL_PATTERN.test(model) || !EFFORTS.includes(effort)) throw new Error('Invalid model configuration');
  return [
    '-p',
    '--output-format=stream-json',
    '--verbose',
    `--session-id=${sessionId}`,
    `--model=${model}`,
    `--effort=${effort}`,
    `--tools=${CLAUDE_TOOL_ALLOWLIST.join(',')}`,
    `--disallowedTools=${CLAUDE_TOOL_DENYLIST.join(',')}`,
    '--restricted', // confines file tools to the cwd, ignores user/project/local settings, no command tools
    '--safe-mode', // disables hooks, plugins, MCP, custom agents/commands from any config
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--no-chrome',
    '--permission-mode=acceptEdits', // edits inside the cwd are pre-approved...
    '--permission-prompts=none', // ...and anything else is denied automatically, never waits for a terminal
  ];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROMPT_MAX_BYTES = 256 * 1024;

export class AdapterError extends Error {
  constructor(code, message) { super(message); this.name = 'AdapterError'; this.code = code; }
}

/** The cwd must be an absolute, canonical, existing directory that is not the Command Center checkout. */
export function assertSafeWorktree(worktreePath, { commandCenterRoot = process.cwd() } = {}) {
  if (typeof worktreePath !== 'string' || !path.isAbsolute(worktreePath) || worktreePath.includes('\0')) throw new AdapterError('INVALID_CWD', 'cwd must be an absolute path');
  let real;
  try { real = fs.realpathSync(worktreePath); } catch { throw new AdapterError('INVALID_CWD', 'cwd does not exist'); }
  if (real !== worktreePath) throw new AdapterError('INVALID_CWD', 'cwd must be canonical (no symlinks or trailing segments)');
  if (!fs.statSync(real).isDirectory()) throw new AdapterError('INVALID_CWD', 'cwd must be a directory');
  const root = fs.realpathSync(commandCenterRoot);
  const inside = (parent, child) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if (inside(real, root)) throw new AdapterError('INVALID_CWD', 'cwd may not be the Command Center checkout or one of its ancestors');
  if (real === fs.realpathSync(os.homedir()) || real === path.parse(real).root) throw new AdapterError('INVALID_CWD', 'cwd may not be the home or filesystem root');
  return real;
}

export class ClaudeCliAdapter {
  id = 'claude-code';
  #binaryPath; #profiles; #env; #spawn; #idFactory; #commandCenterRoot; #limits; #killGraceMs; #timeoutMs; #onProtocolLine; #active = new Map(); #reserved = new Set();

  /**
   * @param {{ binaryPath: string }} options binaryPath comes from ProjectRegistry.agentBinaries.claude
   */
  constructor({ binaryPath, profiles = DEFAULT_CLAUDE_PROFILES, env = process.env, spawnImpl, idFactory = randomUUID, commandCenterRoot = process.cwd(), limits, killGraceMs = 5000, timeoutMs = 120_000, onProtocolLine }) {
    if (typeof binaryPath !== 'string' || !path.isAbsolute(binaryPath) || binaryPath.includes('\0') || path.normalize(binaryPath) !== binaryPath) {
      throw new AdapterError('INVALID_BINARY', 'Claude binary path must be a clean absolute path from server configuration');
    }
    this.#binaryPath = binaryPath;
    this.#profiles = validateProfiles(profiles);
    this.#env = buildClaudeEnvironment(env);
    this.#spawn = spawnImpl;
    this.#idFactory = idFactory;
    this.#commandCenterRoot = commandCenterRoot;
    this.#limits = limits;
    this.#killGraceMs = killGraceMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new AdapterError('INVALID_LIMIT', 'timeout must be between 1 and 300000 ms');
    if (onProtocolLine !== undefined && typeof onProtocolLine !== 'function') throw new AdapterError('INVALID_SPEC', 'protocol observer must be a server-owned function');
    this.#timeoutMs = timeoutMs;
    this.#onProtocolLine = onProtocolLine;
  }

  async #capture(args) {
    return runCapture({ command: this.#binaryPath, args, cwd: os.tmpdir(), env: this.#env, killGraceMs: 1000, ...(this.#spawn ? { spawnImpl: this.#spawn } : {}) });
  }

  /** Read-only inspection (--version, --help, auth status). Never sends a prompt. Never throws for "unavailable". */
  async probe() {
    const base = { id: this.id, binaryPath: this.#binaryPath, observedAt: new Date().toISOString() };
    const unavailable = (reason, detail) => ({ ...base, available: false, reason, ...(detail ? { detail } : {}) });
    try {
      const stat = fs.statSync(this.#binaryPath);
      if (!stat.isFile()) return unavailable('BINARY_NOT_A_FILE');
      fs.accessSync(this.#binaryPath, fs.constants.X_OK);
    } catch {
      return unavailable('BINARY_UNAVAILABLE');
    }
    const versionRun = await this.#capture(['--version']);
    const version = /^(\d+\.\d+\.\d+)\b/.exec(versionRun.stdout.trim());
    if (versionRun.spawnError || versionRun.exitCode !== 0 || !version) return unavailable('UNEXPECTED_VERSION_OUTPUT');

    const helpRun = await this.#capture(['--help']);
    if (helpRun.exitCode !== 0) return unavailable('HELP_UNAVAILABLE');
    const missing = REQUIRED_CLAUDE_FLAGS.filter((flag) => !helpRun.stdout.includes(flag));
    if (missing.length > 0) return unavailable('UNSUPPORTED_CLI', `missing: ${missing.join(', ')}`);

    const authRun = await this.#capture(['auth', 'status']);
    let auth;
    try { auth = JSON.parse(authRun.stdout); } catch { auth = null; }
    if (authRun.exitCode !== 0 || !auth || auth.loggedIn !== true) return unavailable('AUTH_UNAVAILABLE');
    // Subscription only: an API-key/console login is separately billed and refused.
    if (auth.authMethod !== 'claude.ai' || auth.apiProvider !== 'firstParty') return unavailable('AUTH_NOT_SUBSCRIPTION');

    return {
      ...base,
      available: true,
      version: version[1],
      authStatusExitCode: authRun.exitCode,
      authMethod: auth.authMethod,
      authMode: 'claude.ai-subscription',
      flagsVerified: [...REQUIRED_CLAUDE_FLAGS],
      capabilities: {
        structuredEvents: true,
        streaming: 'message',
        cancellation: 'signal', // SIGTERM -> SIGKILL; no graceful channel verified
        modelSelection: true,
        usageTelemetry: 'tokens',
        costTelemetry: 'none',
        sandbox: 'tool-policy',
        editOnly: true,
        shell: false,
        git: false,
        network: false, // no agent network tool; the CLI's own provider transport is separate
      },
    };
  }

  /**
   * spec (server-built, never browser-supplied):
   *   { runId, taskId, worktreePath, prompt, executionProfile, signal? }
   * Returns a RunResult. Throws AdapterError only for an invalid spec.
   */
  async start(spec, emit) {
    if (!spec || typeof spec !== 'object') throw new AdapterError('INVALID_SPEC', 'Run specification is required');
    if (this.#reserved.has(spec.runId)) throw new AdapterError('INVALID_SPEC', 'Run already active');
    this.#reserved.add(spec.runId); // closes the gap between validation and process registration
    try { return await this.#run(spec, emit); } finally { this.#reserved.delete(spec.runId); }
  }

  async #run(spec, emit) {
    if (!RUN_ID_PATTERN.test(spec.runId ?? '') || !TASK_ID_PATTERN.test(spec.taskId ?? '')) throw new AdapterError('INVALID_SPEC', 'runId/taskId are malformed');
    if (typeof spec.prompt !== 'string' || spec.prompt.trim() === '' || spec.prompt.includes('\0') || Buffer.byteLength(spec.prompt) > PROMPT_MAX_BYTES) throw new AdapterError('INVALID_SPEC', 'prompt must be a non-empty string under 256 KiB');
    const profile = this.#profiles[spec.executionProfile];
    if (!Object.hasOwn(this.#profiles, spec.executionProfile) || !profile) throw new AdapterError('INVALID_SPEC', 'Unknown execution profile');
    const cwd = assertSafeWorktree(spec.worktreePath, { commandCenterRoot: this.#commandCenterRoot });

    const base = { requestedProfile: spec.executionProfile, requestedModel: profile.model, requestedEffort: profile.effort };
    let handle;
    let emitFailure = null;
    const emitEvent = (event) => {
      try { emit({ ...event, grade: gradeForEvent(event.type) }); }
      catch (error) { emitFailure ??= error; handle?.cancel('emit'); }
    };

    const probe = await this.probe();
    if (!probe.available) {
      emitEvent({ type: 'error', code: 'ADAPTER_UNAVAILABLE', message: probe.reason });
      emitEvent({ type: 'finished', outcome: 'blocked', exitCode: null });
      return { ...base, outcome: 'blocked', code: 'ADAPTER_UNAVAILABLE', reason: probe.reason, exitCode: null, sessionId: null, actualModel: UNKNOWN_MODEL, usage: { tokens: null, costUsd: null, grade: 'UNAVAILABLE' } };
    }

    const sessionId = this.#idFactory();
    if (!UUID.test(sessionId)) throw new AdapterError('INVALID_SPEC', 'Session id must be a UUID');
    const parser = createClaudeStreamParser({ allowedTools: CLAUDE_TOOL_ALLOWLIST, expectedCwd: cwd });
    let violation = null;
    const onLine = (line) => {
      // Internal diagnostic observer: bounded lines, never browser-configured.
      // It may tighten policy but cannot waive the parser's tool checks.
      try { violation ??= this.#onProtocolLine?.(line) ?? null; }
      catch { violation ??= { code: 'PROTOCOL_OBSERVER_FAILED', message: 'Protocol observation failed' }; }
      for (const event of parser.push(line)) emitEvent(event);
      violation ??= parser.policyViolation;
      if (violation) {
        emitEvent({ type: 'error', code: violation.code, message: violation.message });
        handle?.cancel('policy');
      }
    };

    handle = startProcess({
      command: this.#binaryPath,
      args: buildClaudeArgs({ sessionId, model: profile.model, effort: profile.effort }),
      cwd,
      env: this.#env,
      stdin: spec.prompt,
      limits: this.#limits,
      killGraceMs: this.#killGraceMs,
      timeoutMs: this.#timeoutMs,
      onLine,
      ...(this.#spawn ? { spawnImpl: this.#spawn } : {}),
    });
    this.#active.set(spec.runId, handle);
    const onAbort = () => handle.cancel('cancel');
    spec.signal?.addEventListener?.('abort', onAbort, { once: true });
    if (spec.signal?.aborted) onAbort();

    let proc;
    try { proc = await handle.done; }
    finally { this.#active.delete(spec.runId); spec.signal?.removeEventListener?.('abort', onAbort); }
    if (emitFailure) throw emitFailure;
    // Stderr is bounded too; a boundary disclosure there is equally unsafe.
    if (proc.stderr) {
      try { violation ??= this.#onProtocolLine?.(proc.stderr) ?? null; }
      catch { violation ??= { code: 'PROTOCOL_OBSERVER_FAILED', message: 'Protocol observation failed' }; }
    }

    const summary = parser.finish();
    let outcome; let code = null; let reason = null;
    if (proc.spawnError) {
      outcome = ['ENOENT', 'EACCES'].includes(proc.spawnError.code) ? 'blocked' : 'failed'; code = 'SPAWN_FAILED'; reason = proc.spawnError.code ?? 'spawn error';
    } else if (!proc.exitObserved) {
      outcome = 'unknown'; code = 'EXIT_NOT_OBSERVED'; reason = 'The process did not confirm exit after SIGKILL.';
    } else if (proc.terminateReason === 'cancel') {
      outcome = 'cancelled'; // only after the exit was observed
    } else if (violation) {
      outcome = 'unknown'; code = violation.code; reason = violation.message;
    } else if (proc.limit) {
      outcome = 'unknown'; code = 'OUTPUT_LIMIT'; reason = proc.limit;
    } else if (proc.terminateReason === 'timeout') {
      outcome = 'unknown'; code = 'TIMEOUT';
    } else if (summary.malformedLines > 0) {
      outcome = 'unknown'; code = 'PROTOCOL_PARSE_FAILED';
    } else if (proc.exitCode !== 0) {
      outcome = 'failed'; code = 'NONZERO_EXIT'; reason = `exit ${proc.exitCode ?? proc.signal}`;
    } else if (!summary.sawResult) {
      outcome = 'unknown'; code = 'TRUNCATED_STREAM'; reason = 'Exit 0 without a terminal result event.';
    } else if (!summary.resultOk) {
      outcome = 'failed'; code = 'AGENT_REPORTED_ERROR'; reason = summary.resultSubtype;
    } else {
      outcome = 'completed';
    }
    if (outcome !== 'completed' && outcome !== 'cancelled' && code !== 'OUTPUT_LIMIT') {
      const tail = proc.stderr.trim().slice(-500);
      if (tail) emitEvent({ type: 'error', code: 'STDERR_TAIL', message: tail });
    }
    emitEvent({ type: 'usage', ...summary.usage });
    emitEvent({ type: 'finished', outcome, exitCode: proc.exitCode, signal: proc.signal, sessionId, actualModel: summary.actualModel });
    if (emitFailure) throw emitFailure;

    return {
      ...base,
      outcome, code, reason,
      exitCode: proc.exitCode,
      exitObserved: proc.exitObserved,
      timeout: proc.terminateReason === 'timeout',
      outputLimit: proc.limit,
      stdoutBytes: proc.stdoutBytes,
      stderrBytes: Buffer.byteLength(proc.stderr),
      signal: proc.signal,
      sessionId,
      processId: handle.pid,
      actualModel: summary.actualModel,
      usage: summary.usage,
      denials: summary.denials,
      toolPolicyObserved: summary.toolPolicyObserved,
      malformedLines: summary.malformedLines,
      unknownEventTypes: summary.unknownEventTypes,
      reportedText: summary.resultText, // agent statement: AGENT_CLAIM, never evidence
      stderrTail: proc.stderr.trim().slice(-500),
    };
  }

  /** Resolves only after the process exit has been observed (or reports that it was not). */
  async cancel(runId) {
    const handle = this.#active.get(runId);
    if (!handle) return { terminated: false, reason: 'NOT_ACTIVE' };
    handle.cancel('cancel');
    const proc = await handle.done;
    return { terminated: proc.exitObserved === true };
  }
}

/** The binary comes only from the server-side registry entry. */
export function createClaudeAdapterForProject(project, options = {}) {
  const binaryPath = project?.agentBinaries?.claude;
  if (!binaryPath) throw new AdapterError('INVALID_BINARY', 'Project has no registered Claude binary');
  return new ClaudeCliAdapter({ ...options, binaryPath });
}
