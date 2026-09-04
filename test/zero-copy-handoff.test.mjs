import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  HANDOFF_REQUIRED_FIELDS,
  STATUS_REQUIRED_FIELDS,
  buildHandoff,
  validateDispatch,
} from '../src/bridge/codexHandoff.mjs';
import {
  CodexAppServerClient,
  buildAppServerEnvironment,
  buildAppServerSpawnSpec,
} from '../server/codexAppServerClient.mjs';
import { CodexHandoffService } from '../server/codexHandoffService.mjs';
import { evaluateLocalHandoffRequest, isLoopbackOrigin } from '../server/codexHandoffRoutes.mjs';

const project = {
  project_id: 'proj-command-center',
  repository: 'augusliang23-web/Micro-SaaS-Command-Center',
  cwd: '/tmp/command-center',
  control_mode: 'COLLABORATIVE',
  automation_level: 'DISPATCHED',
  allowed_risk_levels: ['LOW'],
  eligible: true,
  capability_tier: 'STANDARD_EXECUTION',
  provider_capability_evidence: {
    code_execution: 'NATIVE',
    repository_read: 'NATIVE',
    approval_pause: 'NATIVE',
    status_query: 'NATIVE',
  },
};

const dispatch = {
  project_id: project.project_id,
  task_id: 'task-read-only-smoke',
  canonical_task_ref: 'local://command-center/task-read-only-smoke',
  target_surface: 'CODE_EXECUTOR',
  task_classification: 'READ_ONLY_REPOSITORY_INSPECTION',
  governance_classification: 'LOW_RISK_EXPLICIT_ACTION',
  risk_level: 'LOW',
  execution_authority: {
    explicit_user_action: true,
    authorized_by: 'local_user',
    authorized_actions: ['repository_read'],
  },
  objective: 'Inspect the repository and report its branch, HEAD, and working-tree state without modifying files.',
  scope: ['read repository metadata', 'report branch, HEAD, and git status'],
  acceptance_criteria: ['report branch', 'report exact HEAD', 'report clean or dirty state'],
  constraints: ['read-only', 'do not modify files'],
  prohibited_actions: [
    'auto_merge',
    'production_deploy',
    'billing_changes',
    'secrets_changes',
    'destructive_actions',
    'self_approval',
  ],
  context_refs: ['Command Center project drawer'],
  architecture_refs: ['Bridge V0.4 Zero-Copy Codex Handoff MVP Design'],
  required_completion_evidence: ['branch', 'HEAD SHA', 'working-tree state'],
  callback_expectation: 'Return the read-only inspection result to Command Center.',
};

test('buildHandoff emits every V0.4 portable field and preserves prohibitions', () => {
  const handoff = buildHandoff({ dispatch, project, handoffId: 'handoff-1' });

  for (const field of HANDOFF_REQUIRED_FIELDS) {
    assert.ok(Object.hasOwn(handoff, field), `missing ${field}`);
  }
  assert.deepEqual(handoff.required_evidence, dispatch.required_completion_evidence);
  assert.deepEqual(handoff.prohibited_actions, dispatch.prohibited_actions);
  assert.equal(handoff.target_provider, 'CODEX_APP_SERVER');
  assert.equal(handoff.handoff_strategy, 'CONTROL_CENTER_ADAPTER');
  assert.equal(handoff.canonical_next_state_owner, 'COMMAND_CENTER');
});

test('dispatch gates reject PAUSED, missing authority, wrong target, risk, and allowlist misses', () => {
  assert.throws(
    () => validateDispatch({ dispatch, project: { ...project, control_mode: 'PAUSED' } }),
    /PAUSED/,
  );
  assert.throws(
    () => validateDispatch({ dispatch: { ...dispatch, execution_authority: {} }, project }),
    /explicit user action/,
  );
  assert.throws(
    () => validateDispatch({ dispatch: { ...dispatch, target_surface: 'CHAT' }, project }),
    /CODE_EXECUTOR/,
  );
  assert.throws(
    () => validateDispatch({ dispatch: { ...dispatch, risk_level: 'HIGH' }, project }),
    /risk/,
  );
  assert.throws(() => validateDispatch({ dispatch, project: undefined }), /allowlist/);
});

test('dispatch requires evidenced native execution and all canonical prohibitions', () => {
  assert.throws(
    () =>
      validateDispatch({
        dispatch,
        project: { ...project, provider_capability_evidence: { repository_read: 'NATIVE' } },
      }),
    /code_execution/,
  );
  assert.throws(
    () => validateDispatch({ dispatch: { ...dispatch, prohibited_actions: ['auto_merge'] }, project }),
    /prohibited_actions/,
  );
  assert.throws(
    () => validateDispatch({ dispatch: { ...dispatch, task_classification: 'CODE_CHANGE' }, project }),
    /read-only/i,
  );
  assert.throws(
    () =>
      validateDispatch({
        dispatch: {
          ...dispatch,
          execution_authority: { ...dispatch.execution_authority, authorized_actions: ['repository_write'] },
        },
        project,
      }),
    /repository_read/,
  );
});

test('handoff service deduplicates an active dispatch and reports the full status contract', async () => {
  const calls = [];
  const provider = {
    async start(input) {
      calls.push(input);
      input.onUpdate({ state: 'WORKING', threadId: 'thread-1', turnId: 'turn-1', model: 'reported-model' });
      return { threadId: 'thread-1', turnId: 'turn-1', model: 'reported-model' };
    },
  };
  const service = new CodexHandoffService({ projects: [project], provider, idFactory: () => 'handoff-1' });

  const first = await service.dispatch(dispatch);
  const second = await service.dispatch(dispatch);

  assert.equal(first.handoff_id, second.handoff_id);
  assert.equal(calls.length, 1);
  const status = service.getStatus('handoff-1');
  for (const field of STATUS_REQUIRED_FIELDS) {
    assert.ok(Object.hasOwn(status, field), `missing status ${field}`);
  }
  assert.equal(status.execution_state, 'WORKING');
  assert.equal(status.thread_id, 'thread-1');
  assert.equal(status.actual_model, 'reported-model');
  assert.equal(status.idempotency_persistence, 'PROCESS_MEMORY_ONLY');
  assert.equal(calls[0].cwd, project.cwd);
  assert.equal(calls[0].handoff.cwd, undefined);
});

test('concurrent non-idempotent handoffs use isolated provider clients and callbacks', async () => {
  const starts = [];
  let providerNumber = 0;
  const ids = ['handoff-a', 'handoff-b'];
  const service = new CodexHandoffService({
    projects: [project],
    providerFactory() {
      const current = ++providerNumber;
      return {
        async start(input) {
          starts.push({ current, input });
          return { threadId: `thread-${current}`, turnId: `turn-${current}` };
        },
      };
    },
    idFactory: () => ids.shift(),
  });

  const first = await service.dispatch({ ...dispatch, task_id: 'task-a', canonical_task_ref: 'local://task-a' });
  const second = await service.dispatch({ ...dispatch, task_id: 'task-b', canonical_task_ref: 'local://task-b' });
  starts[0].input.onUpdate({ state: 'COMPLETED', result: 'first result' });
  starts[1].input.onUpdate({ state: 'WORKING', output: 'second result' });

  assert.equal(providerNumber, 2);
  assert.equal(service.getStatus(first.handoff_id).execution_state, 'COMPLETED');
  assert.equal(service.getStatus(first.handoff_id).terminal_result, 'first result');
  assert.equal(service.getStatus(second.handoff_id).execution_state, 'WORKING');
  assert.equal(service.getStatus(second.handoff_id).terminal_result, 'second result');
});

test('approval updates pause for input and are never auto-approved', async () => {
  const provider = {
    async start(input) {
      input.onUpdate({ state: 'AWAITING_INPUT', blocker: 'Native approval required' });
      return {};
    },
  };
  const service = new CodexHandoffService({ projects: [project], provider, idFactory: () => 'handoff-2' });

  await service.dispatch({ ...dispatch, task_id: 'approval-test' });
  const status = service.getStatus('handoff-2');

  assert.equal(status.execution_state, 'AWAITING_INPUT');
  assert.equal(status.approval_state, 'REQUIRED');
  assert.match(status.normalized_blocker, /approval/i);
  assert.equal(status.stalled, false);
  assert.equal(status.stalled_reason, null);
});

test('provider launch and native account failures map honestly', async () => {
  const environmentError = Object.assign(new Error('codex not found'), { code: 'ENOENT' });
  const environmentService = new CodexHandoffService({
    projects: [project],
    provider: { start: async () => Promise.reject(environmentError) },
    idFactory: () => 'handoff-environment',
  });
  const providerService = new CodexHandoffService({
    projects: [project],
    provider: { start: async () => Promise.reject(new Error('native ChatGPT account required')) },
    idFactory: () => 'handoff-provider',
  });
  const failedService = new CodexHandoffService({
    projects: [project],
    provider: { start: async () => Promise.reject(new Error('native process failed')) },
    idFactory: () => 'handoff-failed',
  });

  const environmentStatus = await environmentService.dispatch({ ...dispatch, task_id: 'env-failure' });
  const providerStatus = await providerService.dispatch({ ...dispatch, task_id: 'provider-failure' });
  const failedStatus = await failedService.dispatch({ ...dispatch, task_id: 'failed-dispatch' });

  assert.equal(environmentStatus.execution_state, 'BLOCKED_ENVIRONMENT');
  assert.equal(environmentStatus.governance_state, 'BLOCKED');
  assert.equal(providerStatus.execution_state, 'BLOCKED_PROVIDER');
  assert.equal(providerStatus.governance_state, 'BLOCKED');
  assert.equal(failedStatus.execution_state, 'FAILED');
  assert.equal(failedStatus.governance_state, 'BLOCKED');
});

test('process cleanup alone does not advance last meaningful activity', async () => {
  const timestamps = ['initial', 'dispatch', 'cleanup'];
  let capturedInput;
  const service = new CodexHandoffService({
    projects: [project],
    provider: {
      async start(input) {
        capturedInput = input;
        return { threadId: 'thread-cleanup' };
      },
    },
    idFactory: () => 'handoff-cleanup',
    now: () => timestamps.shift() || 'unexpected',
  });

  await service.dispatch({ ...dispatch, task_id: 'cleanup-activity' });
  const before = service.getStatus('handoff-cleanup').last_meaningful_activity;
  capturedInput.onUpdate({ processCleanup: 'SIGTERM_SENT' });

  const status = service.getStatus('handoff-cleanup');
  assert.equal(status.last_meaningful_activity, before);
  assert.equal(status.process_cleanup, 'SIGTERM_SENT');
});

test('App Server invocation uses the documented stdio command without a shell', () => {
  const spec = buildAppServerSpawnSpec({ PATH: '/usr/bin', OPENAI_API_KEY: 'must-not-pass' });
  assert.equal(spec.command, 'codex');
  assert.deepEqual(spec.args, ['app-server']);
  assert.equal(spec.options.shell, false);
  assert.deepEqual(spec.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(spec.options.env, { PATH: '/usr/bin' });
});

test('App Server environment never forwards API credentials', () => {
  assert.deepEqual(
    buildAppServerEnvironment({
      PATH: '/usr/bin',
      CODEX_HOME: '/native/codex/home',
      OPENAI_API_KEY: 'secret',
      CODEX_API_KEY: 'secret',
      OPENAI_ACCESS_TOKEN: 'secret',
      CHATGPT_ACCESS_TOKEN: 'secret',
    }),
    { PATH: '/usr/bin', CODEX_HOME: '/native/codex/home' },
  );
});

class FakeChild extends EventEmitter {
  constructor(accountType = 'chatgpt') {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new EventEmitter();
    this.stdin.messages = [];
    this.stdin.write = (line) => {
      const message = JSON.parse(line);
      this.stdin.messages.push(message);
      queueMicrotask(() => {
        if (message.method === 'initialize') this.respond(message.id, { userAgent: 'fake' });
        if (message.method === 'account/read') this.respond(message.id, { account: { type: accountType } });
        if (message.method === 'thread/start') {
          this.respond(message.id, { thread: { id: 'thread-1', model: 'reported-model' } });
        }
        if (message.method === 'turn/start') {
          this.respond(message.id, { turn: { id: 'turn-1', status: 'inProgress' } });
        }
      });
      return true;
    };
    this.stdin.end = () => {
      this.stdin.ended = true;
    };
    this.killSignals = [];
    this.kill = (signal) => {
      this.killSignals.push(signal);
      return true;
    };
  }

  respond(id, result) {
    this.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }
}

test('App Server client performs the official handshake and starts read-only work', async () => {
  const child = new FakeChild();
  const spawnCalls = [];
  const client = new CodexAppServerClient({
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  const started = await client.start({ cwd: project.cwd, prompt: 'read-only task', onUpdate() {} });

  assert.deepEqual(spawnCalls, [buildAppServerSpawnSpec()]);
  assert.deepEqual(
    child.stdin.messages.map((message) => message.method),
    ['initialize', 'initialized', 'account/read', 'thread/start', 'turn/start'],
  );
  const threadStart = child.stdin.messages.find((message) => message.method === 'thread/start');
  assert.equal(threadStart.params.cwd, project.cwd);
  assert.equal(threadStart.params.approvalPolicy, 'on-request');
  assert.equal(threadStart.params.sandbox, 'read-only');
  assert.deepEqual(started, { threadId: 'thread-1', turnId: 'turn-1', model: 'reported-model' });
});

test('App Server client rejects any non-ChatGPT account without starting a thread', async () => {
  const child = new FakeChild('apiKey');
  const client = new CodexAppServerClient({ spawnImpl: () => child });

  await assert.rejects(
    client.start({ cwd: project.cwd, prompt: 'read-only task', onUpdate() {} }),
    /ChatGPT account/,
  );
  assert.equal(child.stdin.messages.some((message) => message.method === 'thread/start'), false);
});

test('App Server notifications map completion and approvals without resolving them', async () => {
  const child = new FakeChild();
  const updates = [];
  const client = new CodexAppServerClient({ spawnImpl: () => child });
  await client.start({ cwd: project.cwd, prompt: 'read-only task', onUpdate: (update) => updates.push(update) });

  child.stdout.write(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn-1' } } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Read-only result' } })}\n`);
  child.stdout.write(
    `${JSON.stringify({ id: 91, method: 'item/commandExecution/requestApproval', params: {} })}\n`,
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(updates.some((update) => update.state === 'WORKING'));
  assert.ok(updates.some((update) => update.output === 'Read-only result'));
  assert.ok(updates.some((update) => update.state === 'AWAITING_INPUT'));
  assert.equal(child.stdin.messages.some((message) => message.id === 91), false);
});

test('an interrupted App Server turn is never reported as completed', async () => {
  const child = new FakeChild();
  const updates = [];
  const client = new CodexAppServerClient({ spawnImpl: () => child });
  await client.start({ cwd: project.cwd, prompt: 'read-only task', onUpdate: (update) => updates.push(update) });

  child.stdout.write(
    `${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'interrupted' } } })}\n`,
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(updates.some((update) => update.state === 'FAILED' && /interrupted/i.test(update.error)));
  assert.equal(updates.some((update) => update.state === 'COMPLETED'), false);
});

test('an App Server exit before turn completion fails the active handoff', async () => {
  const child = new FakeChild();
  const updates = [];
  const client = new CodexAppServerClient({ spawnImpl: () => child });
  await client.start({ cwd: project.cwd, prompt: 'read-only task', onUpdate: (update) => updates.push(update) });

  child.emit('exit', 0, null);

  assert.ok(updates.some((update) => update.state === 'FAILED' && /exited/i.test(update.error)));
});

test('a completed App Server turn closes stdin then escalates bounded cleanup if it remains alive', async () => {
  const child = new FakeChild();
  const updates = [];
  const client = new CodexAppServerClient({
    spawnImpl: () => child,
    cleanupGraceMs: 1,
    cleanupKillGraceMs: 1,
  });
  await client.start({ cwd: project.cwd, prompt: 'read-only task', onUpdate: (update) => updates.push(update) });

  child.stdout.write(
    `${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(child.stdin.ended, true);
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
  assert.ok(updates.some((update) => update.processCleanup === 'SIGTERM_SENT'));
});

test('local endpoint guard is development-only, origin-bound, and JSON-only', () => {
  const expectedOrigin = 'http://127.0.0.1:3000';
  assert.deepEqual(
    evaluateLocalHandoffRequest({
      nodeEnv: 'development',
      origin: expectedOrigin,
      expectedOrigin,
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
    }),
    { ok: true },
  );
  assert.equal(
    evaluateLocalHandoffRequest({
      nodeEnv: 'production',
      origin: expectedOrigin,
      expectedOrigin,
      method: 'POST',
      contentType: 'application/json',
    }).status,
    404,
  );
  assert.equal(
    evaluateLocalHandoffRequest({
      nodeEnv: 'development',
      origin: 'https://example.com',
      expectedOrigin,
      method: 'POST',
      contentType: 'application/json',
    }).status,
    403,
  );
  assert.equal(
    evaluateLocalHandoffRequest({
      nodeEnv: 'development',
      origin: expectedOrigin,
      expectedOrigin,
      method: 'POST',
      contentType: 'text/plain',
    }).status,
    415,
  );
});

test('only loopback browser origins are accepted as endpoint configuration', () => {
  assert.equal(isLoopbackOrigin('http://127.0.0.1:3000'), true);
  assert.equal(isLoopbackOrigin('http://localhost:3000'), true);
  assert.equal(isLoopbackOrigin('https://127.0.0.1:3000'), false);
  assert.equal(isLoopbackOrigin('http://0.0.0.0:3000'), false);
  assert.equal(isLoopbackOrigin('https://example.com'), false);
});
