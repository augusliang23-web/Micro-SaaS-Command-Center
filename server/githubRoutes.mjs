import express from 'express';
import { isLoopbackOrigin } from './codexHandoffRoutes.mjs';
import { fetchGithubRepos, GithubCliError } from './githubRepos.mjs';
import { fetchPullRequestStatus, isRealGithubRepo } from './githubPullStatus.mjs';

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

export function createGithubRouter({ fetchRepos = fetchGithubRepos, fetchPullStatus = fetchPullRequestStatus } = {}) {
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

  router.get('/pull-status', async (req, res) => {
    const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
    if (!isRealGithubRepo(repo)) {
      res.status(400).json({ error: 'Query param "repo" must be an owner/name GitHub slug.' });
      return;
    }
    try {
      const status = await fetchPullStatus(repo);
      res.json(status);
    } catch (error) {
      if (error instanceof GithubCliError) {
        const status = error.kind === 'not_authenticated' ? 401 : error.kind === 'not_found' ? 503 : 502;
        res.status(status).json({ error: error.message });
        return;
      }
      console.error('Error fetching GitHub pull status:', error);
      res.status(500).json({ error: 'Failed to fetch GitHub pull request status.' });
    }
  });

  return router;
}
