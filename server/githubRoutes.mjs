import express from 'express';
import { isLoopbackOrigin } from './codexHandoffRoutes.mjs';
import { fetchGithubRepos, GithubCliError } from './githubRepos.mjs';

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

export function evaluateGithubRequest({ origin }) {
  if (origin && !isLoopbackOrigin(origin)) {
    return { ok: false, status: 403, error: 'Unexpected browser origin.' };
  }
  return { ok: true };
}

export function createGithubRouter({ fetchRepos = fetchGithubRepos } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const decision = evaluateGithubRequest({ origin: requestOrigin(req) });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    next();
  });

  router.get('/repos', async (req, res) => {
    try {
      const repos = await fetchRepos();
      res.json({ repos });
    } catch (error) {
      if (error instanceof GithubCliError) {
        const status = error.kind === 'not_authenticated' ? 401 : error.kind === 'not_found' ? 503 : 502;
        res.status(status).json({ error: error.message });
        return;
      }
      console.error('Error fetching GitHub repos:', error);
      res.status(500).json({ error: 'Failed to fetch GitHub repositories.' });
    }
  });

  return router;
}
