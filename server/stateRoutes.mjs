import express from 'express';
import { isLoopbackOrigin } from './codexHandoffRoutes.mjs';
import { isValidState, readState, writeState } from './localStateStore.mjs';

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

export function evaluateStateRequest({ origin }) {
  if (origin && !isLoopbackOrigin(origin)) {
    return { ok: false, status: 403, error: 'Unexpected browser origin.' };
  }
  return { ok: true };
}

export function createStateRouter() {
  const router = express.Router();

  router.use((req, res, next) => {
    const decision = evaluateStateRequest({ origin: requestOrigin(req) });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    next();
  });

  router.get('/', (req, res) => {
    const state = readState();
    if (!state) {
      res.status(404).json({ error: 'No saved state yet.' });
      return;
    }
    res.json(state);
  });

  router.put('/', (req, res) => {
    if (!isValidState(req.body)) {
      res.status(400).json({ error: 'Invalid state payload.' });
      return;
    }
    try {
      writeState(req.body);
      res.json({ ok: true });
    } catch (error) {
      console.error('Error writing local state:', error);
      res.status(500).json({ error: 'Failed to save state.' });
    }
  });

  return router;
}
