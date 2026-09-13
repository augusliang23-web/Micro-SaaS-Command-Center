import express from 'express';
import { evaluateGithubRequest } from './githubRoutes.mjs';
import { fetchLocalGitStatus, LocalGitError } from './localGitStatus.mjs';

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

export function createLocalGitRouter({ fetchStatus = fetchLocalGitStatus } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const decision = evaluateGithubRequest({ origin: requestOrigin(req) });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    next();
  });

  router.get('/status', async (req, res) => {
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    if (!path) {
      res.status(400).json({ error: 'Query param "path" is required.' });
      return;
    }
    try {
      const status = await fetchStatus(path);
      res.json(status);
    } catch (error) {
      if (error instanceof LocalGitError) {
        const status = error.kind === 'not_found' ? 404 : error.kind === 'no_upstream' ? 409 : 500;
        res.status(status).json({ error: error.message });
        return;
      }
      console.error('Error fetching local git status:', error);
      res.status(500).json({ error: 'Failed to fetch local git status.' });
    }
  });

  return router;
}
