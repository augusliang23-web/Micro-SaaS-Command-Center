import express from 'express';
import { isLoopbackOrigin } from './codexHandoffRoutes.mjs';
import { fetchGithubRepos, GithubCliError } from './githubRepos.mjs';
import { fetchPullRequestStatus, fetchChangedFiles, fetchRecentCommits, isRealGithubRepo, aggregateCiResponse } from './githubPullStatus.mjs';
import {
  fetchDevelopmentHistory,
  fetchPullDetail,
  createHistoryCache,
} from './githubDevelopmentHistory.mjs';

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

// GitHub's per_page must be a whole number in 1..50 here; anything else
// (missing, fractional below 1, negative, non-numeric) falls back to 30.
export function parseRecentCommitsLimit(raw) {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Math.floor(Number(raw)) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : 30;
}

/** The default authorizer: nothing is readable unless the server injects its saved-state authorizer. */
// eslint-disable-next-line no-unused-vars
function denyAllHistory(_scope) {
  return null;
}

export function createGithubRouter({
  fetchRepos = fetchGithubRepos,
  fetchPullStatus = fetchPullRequestStatus,
  fetchFiles = fetchChangedFiles,
  fetchCommits = fetchRecentCommits,
  fetchHistory = fetchDevelopmentHistory,
  fetchHistoryPull = (repo, number, opts) => fetchPullDetail(repo, number, { ...opts, aggregateCi: aggregateCiResponse }),
  historyCache = createHistoryCache(),
  // V1.2C: ({ repo, projectId }) => registry-issued authorization or null. Re-derived from saved state on EVERY call. The default
  // authorizes nothing, so a router built without the server's authorizer can never read history.
  authorizeHistory = denyAllHistory,
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
    const limit = parseRecentCommitsLimit(req.query.limit);
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

  // Read-only development history, bound to the exact allowlisted repository.
  // A refresh bypasses the per-process cache; a client disconnect cancels the
  // in-flight `gh` reads so an abandoned request cannot keep consuming quota.
  function historyErrorResponse(res, error) {
    if (error instanceof GithubCliError) {
      const map = { not_authenticated: 401, forbidden: 403, missing: 404, rate_limited: 429, not_found: 503, timeout: 504, aborted: 499 };
      const status = map[error.kind] ?? 502;
      res.status(status).json({ error: error.message, kind: error.kind, resetAt: error.resetAt ?? null, status: 'unavailable' });
      return;
    }
    console.error('Error fetching GitHub development history:', error);
    res.status(500).json({ error: 'Failed to fetch development history.', kind: 'failed', status: 'unavailable' });
  }

  function abortOnClose(req, res) {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    return controller.signal;
  }

  // Authorization is checked BEFORE the cache and again AFTER every fetch: if the connection was revoked or changed meanwhile, the
  // result is discarded (409 authorization_changed) and never cached. Cache keys carry the authority's scopeKey, so a reconnect
  // or another project can never be served an older identity's snapshot.
  function authorize(req, res) {
    const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
    const rawProject = req.query.projectId;
    const projectId = rawProject === undefined ? undefined : typeof rawProject === 'string' && rawProject.length <= 200 ? rawProject : null;
    const authorization = projectId === null ? null : authorizeHistory({ repo, projectId });
    if (!authorization) {
      res.status(403).json({ error: 'Repository is not authorized for development history.', kind: 'forbidden', status: 'unavailable' });
      return null;
    }
    return { repo, projectId, authorization };
  }
  function stillAuthorized(res, { repo, projectId, authorization }) {
    const again = authorizeHistory({ repo, projectId });
    if (again && again.scopeKey === authorization.scopeKey) return true;
    res.status(409).json({ error: 'The GitHub connection changed while reading; the result was discarded.', kind: 'authorization_changed', status: 'unavailable' });
    return false;
  }

  router.get('/development-history', async (req, res) => {
    const scope = authorize(req, res);
    if (!scope) return;
    const { repo, authorization } = scope;
    const refresh = req.query.refresh === '1';
    const cached = refresh ? null : historyCache.get(authorization.scopeKey);
    if (cached) {
      res.json({ ...cached, cache: 'hit' });
      return;
    }
    try {
      const history = await fetchHistory(repo, { authorization, signal: abortOnClose(req, res) });
      if (history?.repository !== repo) throw new GithubCliError('History response repository mismatch.', 'failed');
      if (!stillAuthorized(res, scope)) return;
      historyCache.set(authorization.scopeKey, history);
      res.json({ ...history, cache: refresh ? 'refreshed' : 'miss' });
    } catch (error) {
      historyErrorResponse(res, error);
    }
  });

  router.get('/development-history/pull', async (req, res) => {
    const scope = authorize(req, res);
    if (!scope) return;
    const { repo, authorization } = scope;
    const number = typeof req.query.number === 'string' && /^\d{1,7}$/.test(req.query.number) ? Number(req.query.number) : NaN;
    if (!Number.isInteger(number) || number < 1) {
      res.status(400).json({ error: 'Query param "number" must be a positive integer.', kind: 'failed', status: 'unavailable' });
      return;
    }
    try {
      const detail = await fetchHistoryPull(repo, number, { authorization, signal: abortOnClose(req, res) });
      if (!stillAuthorized(res, scope)) return;
      res.json(detail);
    } catch (error) {
      historyErrorResponse(res, error);
    }
  });

  return router;
}
