import express from 'express';
import { randomBytes } from 'node:crypto';

import { isLoopbackOrigin } from '../codexHandoffRoutes.mjs';
import { TASK_ID_PATTERN, createDraftTask } from './types.mjs';
import { PolicyGate } from './policyGate.mjs';

function requestOrigin(req) {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function evaluateTaskRequest({ origin, method, contentType }) {
  if (origin && !isLoopbackOrigin(origin)) return { ok: false, status: 403, error: 'Unexpected browser origin.' };
  if (method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(contentType || '')) {
    return { ok: false, status: 415, error: 'Creating a task requires application/json.' };
  }
  return { ok: true };
}

function defaultTaskId(now) {
  const day = now().slice(0, 10).replaceAll('-', '');
  return `CC-${day}-${randomBytes(4).toString('hex')}`;
}

/**
 * Phase 1 task API: create DRAFT tasks and read them back. It never spawns a
 * process, never runs git, and never touches a worktree. `registry` may be null
 * (registry missing or invalid): creation then fails closed with 503.
 */
export function createTaskRouter({
  store,
  registry,
  gate = new PolicyGate(),
  now = () => new Date().toISOString(),
  idFactory = defaultTaskId,
}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const decision = evaluateTaskRequest({ origin: requestOrigin(req), method: req.method, contentType: req.get('content-type') });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    next();
  });

  router.post('/', (req, res) => {
    if (!registry) {
      res.status(503).json({ error: 'Server-side project registry is unavailable.', code: 'REGISTRY_UNAVAILABLE' });
      return;
    }
    const decision = gate.evaluateCreate({ body: req.body, registry });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error, code: decision.code });
      return;
    }
    try {
      const task = createDraftTask({
        taskId: idFactory(now),
        input: decision.input,
        project: decision.project,
        now: now(),
      });
      store.create(task);
      res.status(201).json({ task, approvalRequired: decision.approvalRequired });
    } catch (error) {
      console.error('Error creating task:', error);
      res.status(500).json({ error: 'Failed to save task.' });
    }
  });

  router.get('/', (req, res) => {
    try {
      res.json(store.list());
    } catch (error) {
      console.error('Error listing tasks:', error);
      res.status(500).json({ error: 'Failed to read tasks.' });
    }
  });

  router.get('/:taskId', (req, res) => {
    if (!TASK_ID_PATTERN.test(req.params.taskId)) {
      res.status(400).json({ error: 'Malformed taskId.' });
      return;
    }
    try {
      const task = store.get(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found.' });
        return;
      }
      res.json({ task });
    } catch (error) {
      console.error('Error reading task:', error);
      res.status(500).json({ error: 'Stored task is unreadable.' });
    }
  });

  return router;
}
