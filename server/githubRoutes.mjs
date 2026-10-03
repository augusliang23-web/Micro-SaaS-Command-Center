import express from 'express';
import { isLoopbackOrigin } from './codexHandoffRoutes.mjs';
import { fetchGithubRepos, GithubCliError } from './githubRepos.mjs';
import { fetchPullRequestStatus, fetchChangedFiles, fetchRecentCommits, isRealGithubRepo } from './githubPullStatus.mjs';

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

export function createGithubRouter({
  fetchRepos = fetchGithubRepos,
  fetchPullStatus = fetchPullRequestStatus,
  fetchFiles = fetchChangedFiles,
  fetchCommits = fetchRecentCommits,
} = {}) {
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

  router.get('/changed-files', async (req, res) => {
    const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
    const prNumber = typeof req.query.pr === 'string' && req.query.pr ? Number(req.query.pr) : undefined;
    const sha = typeof req.query.sha === 'string' ? req.query.sha : undefined;
    if (!isRealGithubRepo(repo)) {
      res.status(400).json({ error: 'Query param "repo" must be an owner/name GitHub slug.' });
      return;
    }
    if (!prNumber && !sha) {
      res.status(400).json({ error: 'Query param "pr" or "sha" is required.' });
      return;
    }
    try {
      const files = await fetchFiles(repo, { prNumber, sha });
      res.json({ files: files.map(({ filename, status, additions, deletions }) => ({ filename, status, additions, deletions })) });
    } catch (error) {
      if (error instanceof GithubCliError) {
        const status = error.kind === 'not_authenticated' ? 401 : error.kind === 'not_found' ? 503 : 502;
        res.status(status).json({ error: error.message });
        return;
      }
      console.error('Error fetching GitHub changed files:', error);
      res.status(500).json({ error: 'Failed to fetch changed files.' });
    }
  });

  router.get('/recent-commits', async (req, res) => {
    const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 30;
    if (!isRealGithubRepo(repo)) {
      res.status(400).json({ error: 'Query param "repo" must be an owner/name GitHub slug.' });
      return;
    }
    try {
      const commits = await fetchCommits(repo, { limit });
      res.json({ commits });
    } catch (error) {
      if (error instanceof GithubCliError) {
        const status = error.kind === 'not_authenticated' ? 401 : error.kind === 'not_found' ? 503 : 502;
        res.status(status).json({ error: error.message });
        return;
      }
      console.error('Error fetching recent GitHub commits:', error);
      res.status(500).json({ error: 'Failed to fetch recent commits.' });
    }
  });

  return router;
}
