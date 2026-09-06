import { execFile } from 'node:child_process';

export class GithubCliError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'GithubCliError';
    this.kind = kind; // 'not_found' | 'not_authenticated' | 'failed'
  }
}

export function formatRelativeTime(dateInput, now = new Date()) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  if (diffDay < 30) {
    const diffWeek = Math.floor(diffDay / 7);
    return `${diffWeek} week${diffWeek === 1 ? '' : 's'} ago`;
  }
  if (diffDay < 365) {
    const diffMonth = Math.floor(diffDay / 30);
    return `${diffMonth} month${diffMonth === 1 ? '' : 's'} ago`;
  }
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear} year${diffYear === 1 ? '' : 's'} ago`;
}

export function mapGithubRepo(item, now = new Date()) {
  return {
    id: String(item.id),
    name: item.name,
    fullName: item.full_name,
    description: item.description || '',
    isPrivate: Boolean(item.private),
    language: item.language || 'Unknown',
    defaultBranch: item.default_branch || 'main',
    stars: item.stargazers_count || 0,
    lastPushed: item.pushed_at ? formatRelativeTime(item.pushed_at, now) : 'Unknown',
  };
}

/**
 * Low-level `gh api <path>` caller shared by every read-only GitHub fetch in
 * this server. Resolves with the parsed JSON body; rejects with a
 * GithubCliError classified as 'not_found' (gh missing), 'not_authenticated',
 * or 'failed'.
 */
export function ghApiJson(path, { execFileFn = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileFn('gh', ['api', path], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          reject(new GithubCliError('GitHub CLI (gh) was not found on the server PATH.', 'not_found'));
          return;
        }
        if (/not logged|auth login|authentication/i.test(stderr || '')) {
          reject(new GithubCliError('GitHub CLI is not authenticated. Run `gh auth login`.', 'not_authenticated'));
          return;
        }
        reject(new GithubCliError((stderr || error.message || '').trim(), 'failed'));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new GithubCliError('Failed to parse GitHub CLI response.', 'failed'));
      }
    });
  });
}

export async function fetchGithubRepos({ execFileFn = execFile } = {}) {
  const parsed = await ghApiJson('/user/repos?per_page=100&sort=pushed&direction=desc', { execFileFn });
  if (!Array.isArray(parsed)) {
    throw new GithubCliError('Unexpected response shape from GitHub CLI.', 'failed');
  }
  return parsed.map((item) => mapGithubRepo(item));
}
