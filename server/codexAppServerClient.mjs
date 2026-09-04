import { spawn } from 'node:child_process';
import readline from 'node:readline';

const BLOCKED_CREDENTIAL_ENV = new Set([
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_ACCESS_TOKEN',
  'CHATGPT_ACCESS_TOKEN',
]);

export function buildAppServerEnvironment(sourceEnvironment = process.env) {
  return Object.fromEntries(
    Object.entries(sourceEnvironment).filter(([name]) => !BLOCKED_CREDENTIAL_ENV.has(name)),
  );
}

export function buildAppServerSpawnSpec(sourceEnvironment = process.env) {
  return {
    command: 'codex',
    args: ['app-server'],
    options: {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildAppServerEnvironment(sourceEnvironment),
    },
  };
}

function responseModel(thread) {
  return thread?.model || thread?.modelName || null;
}

export class CodexAppServerClient {
  constructor({
    spawnImpl = spawn,
    requestTimeoutMs = 15_000,
    cleanupGraceMs = 1_000,
    cleanupKillGraceMs = 1_000,
  } = {}) {
    this.spawnImpl = spawnImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.cleanupGraceMs = cleanupGraceMs;
    this.cleanupKillGraceMs = cleanupKillGraceMs;
    this.nextId = 1;
    this.pending = new Map();
    this.onUpdate = () => {};
    this.stderr = '';
  }

  async start({ cwd, prompt, onUpdate }) {
    const spec = buildAppServerSpawnSpec();
    this.onUpdate = onUpdate;
    this.completed = false;
    this.intentionalClose = false;
    this.exited = false;
    this.closeStarted = false;
    this.cleanupTimers = [];
    this.child = this.spawnImpl(spec.command, spec.args, spec.options);
    this.#connectProcess();

    try {
      await this.#request('initialize', {
        clientInfo: { name: 'micro-saas-command-center', title: 'Micro-SaaS Command Center', version: '0.4.0' },
      });
      this.#notify('initialized');

      const accountResult = await this.#request('account/read', { refreshToken: false });
      if (accountResult?.account?.type !== 'chatgpt') {
        throw new Error('Codex App Server requires a native ChatGPT account; API-key fallback is disabled');
      }

      const threadResult = await this.#request('thread/start', {
        cwd,
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      });
      const threadId = threadResult?.thread?.id;
      if (!threadId) throw new Error('Codex App Server did not return a thread id');

      const turnResult = await this.#request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
      });
      const turnId = turnResult?.turn?.id;
      if (!turnId) throw new Error('Codex App Server did not return a turn id');

      return { threadId, turnId, model: responseModel(threadResult.thread) };
    } catch (error) {
      this.#close();
      throw error;
    }
  }

  #connectProcess() {
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        this.#handleMessage(JSON.parse(line));
      } catch (error) {
        this.onUpdate({ state: 'FAILED', error: `Invalid App Server message: ${error.message}` });
      }
    });
    this.child.stderr?.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-2_000);
    });
    this.child.on('error', (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.onUpdate({
        state: error?.code === 'ENOENT' ? 'BLOCKED_ENVIRONMENT' : 'FAILED',
        error: error.message,
      });
    });
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      for (const timer of this.cleanupTimers) clearTimeout(timer);
      this.cleanupTimers = [];
      if (code && this.pending.size > 0) {
        const error = new Error(`Codex App Server exited (${code}${signal ? `, ${signal}` : ''}): ${this.stderr}`);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      }
      if (!this.completed && !this.intentionalClose) {
        this.onUpdate({
          state: 'FAILED',
          error: `Codex App Server exited before turn completion (${code ?? 'unknown'}${signal ? `, ${signal}` : ''}).`,
        });
      }
    });
  }

  #request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server timed out waiting for ${method}`));
      }, this.requestTimeoutMs);
      timeout.unref?.();
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  #notify(method, params) {
    const message = params === undefined ? { method } : { method, params };
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleMessage(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Codex App Server request failed'));
      else pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method) {
      if (/approval|requestUserInput|elicitation/i.test(message.method)) {
        this.onUpdate({ state: 'AWAITING_INPUT', blocker: `Native request pending: ${message.method}` });
      }
      return;
    }

    const params = message.params || {};
    switch (message.method) {
      case 'thread/started':
        this.onUpdate({ state: 'QUEUED', threadId: params.thread?.id, model: responseModel(params.thread) });
        break;
      case 'turn/started':
        this.onUpdate({ state: 'WORKING', turnId: params.turn?.id });
        break;
      case 'item/agentMessage/delta':
        if (params.delta) this.onUpdate({ output: params.delta });
        break;
      case 'model/rerouted':
        this.onUpdate({ model: params.toModel || params.model });
        break;
      case 'turn/completed': {
        const completed = params.turn?.status === 'completed';
        const terminalStatus = params.turn?.status || 'unknown';
        this.onUpdate({
          state: completed ? 'COMPLETED' : 'FAILED',
          turnId: params.turn?.id,
          error: completed
            ? undefined
            : params.turn?.error?.message || `Codex turn ended without completion: ${terminalStatus}.`,
        });
        this.completed = true;
        this.#close();
        break;
      }
      case 'error':
        this.onUpdate({ state: 'FAILED', error: params.error?.message || params.message || 'Codex App Server error' });
        break;
      default:
        break;
    }
  }

  #close() {
    this.intentionalClose = true;
    if (this.closeStarted) return;
    this.closeStarted = true;
    if (this.child?.stdin && !this.child.stdin.destroyed) this.child.stdin.end();
    const terminateTimer = setTimeout(() => {
      if (this.exited) return;
      this.onUpdate({ processCleanup: 'SIGTERM_SENT' });
      this.child?.kill?.('SIGTERM');
      const killTimer = setTimeout(() => {
        if (this.exited) return;
        this.onUpdate({ processCleanup: 'SIGKILL_SENT' });
        this.child?.kill?.('SIGKILL');
      }, this.cleanupKillGraceMs);
      killTimer.unref?.();
      this.cleanupTimers.push(killTimer);
    }, this.cleanupGraceMs);
    terminateTimer.unref?.();
    this.cleanupTimers.push(terminateTimer);
  }
}
