import express from 'express';
import { isLoopbackOrigin } from './codexHandoffRoutes.mjs';
import { fetchGithubRepos, GithubCliError } from './githubRepos.mjs';
import { fetchPullRequestStatus, fetchChangedFiles, fetchRecentCommits, isRealGithubRepo, aggregateCiResponse } from './githubPullStatus.mjs';
import {
  fetchDevelopmentHistory,
  fetchPullDetail,
  isAllowlistedHistoryRepo,
  createHistoryCache,
} from './githubDevelopmentHistory.mjs';
import { FIXED_TARGETS } from '../src/v1/zc08bStatusModel.mjs';

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

export function createGithubRouter({
  fetchRepos = fetchGithubRepos,
  fetchPullStatus = fetchPullRequestStatus,
  fetchFiles = fetchChangedFiles,
  fetchCommits = fetchRecentCommits,
  fetchHistory = fetchDevelopmentHistory,
  fetchHistoryPull = (repo, number, opts) => fetchPullDetail(repo, number, { ...opts, aggregateCi: aggregateCiResponse }),
  historyCache = createHistoryCache(),
  statusCache = createHistoryCache(),
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

  router.get('/development-history', async (req, res) => {
    const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
    if (!isAllowlistedHistoryRepo(repo)) {
      res.status(403).json({ error: 'Repository is not allowlisted for development history.', kind: 'forbidden', status: 'unavailable' });
      return;
    }
    const refresh = req.query.refresh === '1';
    if(refresh)historyCache.clear(repo);
    const cached = refresh ? null : historyCache.get(repo);
    if (cached) {
      res.json({ ...cached, cache: 'hit' });
      return;
    }
    try {
      const history = await fetchHistory(repo, { signal: abortOnClose(req, res) });
      if (history?.repository !== repo) throw new GithubCliError('History response repository mismatch.', 'failed');
      historyCache.set(repo, history);
      res.json({ ...history, cache: refresh ? 'refreshed' : 'miss' });
    } catch (error) {
      historyErrorResponse(res, error);
    }
  });

  router.get('/development-history/pull', async (req, res) => {
    const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
    const number = typeof req.query.number === 'string' && /^\d{1,7}$/.test(req.query.number) ? Number(req.query.number) : NaN;
    if (!isAllowlistedHistoryRepo(repo)) {
      res.status(403).json({ error: 'Repository is not allowlisted for development history.', kind: 'forbidden', status: 'unavailable' });
      return;
    }
    if (!Number.isInteger(number) || number < 1) {
      res.status(400).json({ error: 'Query param "number" must be a positive integer.', kind: 'failed', status: 'unavailable' });
      return;
    }
    try {
      const fixed=FIXED_TARGETS.some(t=>t.repo===repo&&t.pr===number);
      const key=`${repo}#${number}`;
      if(req.query.refresh==='1')statusCache.clear(key);
      const cached=fixed&&req.query.refresh!=='1'?statusCache.get(key):null;
      if(cached){res.json({...cached,cache:'hit'});return;}
      const detail=await fetchHistoryPull(repo, number, { signal: abortOnClose(req, res) });
      if(detail?.source!=='GitHub'||detail?.repository!==repo||detail?.number!==number)
        throw new GithubCliError('PR detail response identity mismatch.','failed');
      if(fixed&&detail.zcEvidence?.evidence?.consistent===true)statusCache.set(key,detail);
      res.json(detail);
    } catch (error) {
      historyErrorResponse(res, error);
    }
  });

  return router;
}
