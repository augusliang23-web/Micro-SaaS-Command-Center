// The complete V1 API: four GET routes. No state write, no tasks, no provider, no agent, no Git.
import express from 'express';
import { isValidState, readState } from './localStateStore.mjs';

const GITHUB_V1_PATHS = new Set(['/development-history', '/development-history/pull']);

/**
 * @param {object} deps
 * @param {import('express').Router} deps.githubRouter the existing GitHub router; only its two development-history GETs are reachable here
 * @param {() => unknown} [deps.readSavedState] read-only access to the saved state (returns null when absent, throws when unreadable)
 */
export function createV1ReadOnlyRouter({ githubRouter, readSavedState = readState }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Reads only. An absent state is a 404 with the message the V1 app already understands; an unreadable or malformed
  // one is a 500. The file is never created, repaired, migrated or overwritten here.
  router.get('/state', (req, res) => {
    let state;
    try {
      state = readSavedState();
    } catch {
      res.status(500).json({ error: 'Saved state is unreadable.' });
      return;
    }
    if (state === null || state === undefined) {
      res.status(404).json({ error: 'No saved state yet.' });
      return;
    }
    if (!isValidState(state)) {
      res.status(500).json({ error: 'Saved state has an unexpected shape.' });
      return;
    }
    res.json(state);
  });

  // The legacy GitHub router has more routes; only the two exact development-history paths (and its repository
  // allowlist, cancellation and rate-limit handling) are exposed. Everything else falls through to the API 404.
  router.use('/github', (req, res, next) => {
    if (!GITHUB_V1_PATHS.has(req.path)) {
      next('router');
      return;
    }
    next();
  }, githubRouter);

  return router;
}
