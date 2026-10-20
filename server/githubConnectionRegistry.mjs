// V1.2C GitHub read authority: a PURE projection of validated saved state. There is no second registry file and nothing here
// writes. A repository may be read for development history only when ALL of these hold for one project:
//   - it is in `projects` (not removed), its lifecycle is active, and it has no `dataMode` (trusted registered provenance);
//   - its id is non-blank and unique across current AND removed projects;
//   - EITHER management.githubConnection is `connected` for exactly its saved `repository`
//     OR it is the single legacy PM Dashboard record (see legacyCompatProjectId);
//   - NO OTHER saved record (current or removed, any lifecycle, connected or not, demo or not) names the same repository in any
//     spelling (V1.2 remediation F2): a repository claimed twice grants nothing to anyone, legacy rule included;
//   - a user-verified connection carries the GitHub repository id verified at connect time; the history service checks every
//     GitHub answer against it (V1.2 remediation F3).
// A repository string alone, a display name, a demo record or a missing/invalid state never grants anything.

import { LIFECYCLE, assertUsableState, connectionOf, lifecycleOf, removedOf, repositoryKey } from './projectManagementSchema.mjs';

/** The one repository that V1.1 read before connections existed. Only the strict legacy rule below can use it. */
export const LEGACY_COMPAT_REPOSITORY = 'augusliang23-web/pm-dashboard';

const issued = new WeakSet();
const text = (v) => (typeof v === 'string' ? v : '');
const isRecordLike = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * F2 conflict key: one repository in any spelling (case, surrounding space, https/www/github.com prefix, git@github.com: SSH
 * form, trailing slash, .git suffix) maps to the same key, so look-alike records collide instead of slipping past the check.
 */
export function repositoryClaimKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase()
    .replace(/^git@github\.com:/, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

/** F2: how many distinct saved records (current AND removed) name each repository, via `repository` or a connection record. */
export function repositoryClaimCounts(state) {
  const counts = new Map();
  for (const p of [...state.projects, ...removedOf(state).map((e) => e.project)]) {
    const connection = isRecordLike(p.management) && isRecordLike(p.management.githubConnection) ? p.management.githubConnection : null;
    const keys = new Set([repositoryClaimKey(p.repository), repositoryClaimKey(connection?.repository)].filter(Boolean));
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function idCounts(state) {
  const counts = new Map();
  for (const p of [...state.projects, ...removedOf(state).map((e) => e.project)]) {
    const id = text(p.id);
    if (id.trim()) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Decision B: the unique legacy PM Dashboard record keeps V1.1 read access WITHOUT any saved-state rewrite, if and only if it has
 * no `dataMode`, no `management`, a non-blank id unique across current and removed projects, the exact repository
 * `augusliang23-web/pm-dashboard`, and is the only such record. Anything else (lookalikes, duplicates, case variants) -> null.
 */
export function legacyCompatProjectId(state) {
  const counts = idCounts(state);
  if (repositoryClaimCounts(state).get(repositoryClaimKey(LEGACY_COMPAT_REPOSITORY)) !== 1) return null; // F2 applies to the legacy rule too
  const candidates = state.projects.filter((p) => p.dataMode === undefined && p.management === undefined && p.repository === LEGACY_COMPAT_REPOSITORY);
  if (candidates.length !== 1) return null;
  const id = text(candidates[0].id);
  return id.trim() && id === id.trim() && counts.get(id) === 1 ? id : null;
}

/**
 * Every repository readable right now, keyed by lower-case repository. Each entry carries a `scopeKey` that changes whenever
 * the authority changes (connect, disconnect, change, legacy -> persisted), so caches and in-flight reads can be invalidated.
 * Throws if the state itself is invalid; callers treat that as "nothing authorized".
 */
export function connectionAuthorizations(state) {
  assertUsableState(state);
  const counts = idCounts(state);
  const claimCounts = repositoryClaimCounts(state); // F2: computed over ALL records BEFORE any authority is issued
  const legacyId = legacyCompatProjectId(state);
  const claims = new Map();
  for (const p of state.projects) {
    const id = text(p.id);
    if (p.dataMode !== undefined || !id.trim() || counts.get(id) !== 1 || lifecycleOf(p) !== LIFECYCLE.ACTIVE) continue;
    if (claimCounts.get(repositoryClaimKey(p.repository)) !== 1) continue; // another record names this repository: nobody gets it
    const c = connectionOf(p);
    let entry = null;
    if (c && c.status === 'connected' && c.repository === p.repository) {
      // F3: a user-verified connection must carry the GitHub id verified at connect time. The persisted legacy record carries
      // none, so it is accepted only for the exact legacy repository (explicit, documented exception).
      const pinned = c.verifiedRepositoryId;
      if (c.source === 'user-verified' && !(Number.isInteger(pinned) && pinned > 0)) continue;
      if (c.source === 'legacy-pm-dashboard-compat' && p.repository !== LEGACY_COMPAT_REPOSITORY) continue;
      entry = { projectId: id, repository: p.repository, source: c.source, generation: c.generation, connectedAt: c.connectedAt, verifiedRepositoryId: c.source === 'user-verified' ? pinned : null };
    } else if (!c && id === legacyId) {
      entry = { projectId: id, repository: p.repository, source: 'legacy-pm-dashboard-compat', generation: 0, connectedAt: null, verifiedRepositoryId: null };
    }
    if (!entry) continue;
    const key = repositoryKey(entry.repository);
    claims.set(key, claims.has(key) ? 'CLASH' : entry);
  }
  const out = new Map();
  for (const [key, entry] of claims) {
    if (entry === 'CLASH') continue;
    out.set(key, Object.freeze({ ...entry, scopeKey: JSON.stringify([entry.repository, entry.projectId, entry.source, entry.generation, entry.connectedAt, entry.verifiedRepositoryId]) }));
  }
  return out;
}

/**
 * Issues a history-read authorization for exactly `repo` (exact case) and, when given, exactly `projectId`. Returns null on any
 * doubt, including an absent or invalid state. Only objects issued here satisfy isHistoryAuthorizationFor.
 */
export function issueHistoryAuthorization(state, { repo, projectId } = {}) {
  if (state === null || state === undefined || typeof repo !== 'string' || !repo) return null;
  if (projectId !== undefined && (typeof projectId !== 'string' || !projectId)) return null;
  let entries;
  try {
    entries = connectionAuthorizations(state);
  } catch {
    return null;
  }
  const entry = entries.get(repositoryKey(repo));
  if (!entry || entry.repository !== repo) return null;
  if (projectId !== undefined && entry.projectId !== projectId) return null;
  const authorization = Object.freeze({ ...entry });
  issued.add(authorization);
  return authorization;
}

/** True only for an authorization object issued by issueHistoryAuthorization for this exact repository. */
export function isHistoryAuthorizationFor(authorization, repo) {
  return !!authorization && typeof authorization === 'object' && issued.has(authorization) && authorization.repository === repo;
}

/** Read model for the UI: who is authorized and why. Never contains anything beyond saved-state facts. */
export function authorizationSummary(state) {
  try {
    return [...connectionAuthorizations(state).values()].map(({ projectId, repository, source, generation }) => ({ projectId, repository, source, generation }));
  } catch {
    return [];
  }
}
