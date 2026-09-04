import { readFileSync } from 'node:fs';
import express from 'express';

export function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

export function evaluateLocalHandoffRequest({ nodeEnv, origin, expectedOrigin, method, contentType }) {
  if (nodeEnv !== 'development') return { ok: false, status: 404, error: 'Local Codex handoff is disabled.' };
  if (!isLoopbackOrigin(expectedOrigin)) {
    return { ok: false, status: 403, error: 'Local Codex handoff origin is not loopback.' };
  }
  if (origin !== expectedOrigin) return { ok: false, status: 403, error: 'Unexpected browser origin.' };
  if (method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(contentType || '')) {
    return { ok: false, status: 415, error: 'Dispatch requires application/json.' };
  }
  return { ok: true };
}

export function loadCodexProjectAllowlist(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    throw new Error('Codex project allowlist must contain at least one project');
  }
  return parsed.projects;
}

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

export function createCodexHandoffRouter({ service, expectedOrigin, nodeEnv }) {
  const router = express.Router();
  router.use((req, res, next) => {
    const decision = evaluateLocalHandoffRequest({
      nodeEnv,
      origin: requestOrigin(req),
      expectedOrigin,
      method: req.method,
      contentType: req.get('content-type'),
    });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    if (!service) {
      res.status(503).json({
        execution_state: 'BLOCKED_ENVIRONMENT',
        error: 'Server-side Codex project allowlist is unavailable.',
      });
      return;
    }
    next();
  });

  router.post('/', async (req, res) => {
    try {
      const result = await service.dispatch(req.body || {});
      const status = result.execution_state === 'FAILED' ? 502 : 202;
      res.status(status).json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/:handoffId', (req, res) => {
    const status = service.getStatus(req.params.handoffId);
    if (!status) {
      res.status(404).json({ error: 'Handoff not found.' });
      return;
    }
    res.json(status);
  });

  return router;
}
