// Command Center V1 request policy: capability selection and the browser/host boundary for the read-only API.
//
// This module is pure (no filesystem, process, network or service construction) so it can run BEFORE anything with a side effect.
//
// Capability model
//   V1 is the default and the only mode that needs no configuration. It serves exactly four GET routes
//   (/api/health, /api/state, /api/github/development-history, /api/github/development-history/pull) and the static app.
//   Legacy capabilities exist in the source tree but are unreachable unless the SERVER OPERATOR names them in
//   COMMAND_CENTER_LEGACY_CAPABILITIES (process environment only). NODE_ENV never enables anything.
//
// Trust boundary (what the Host / Origin / Referer checks do and do NOT do)
//   They stop other WEB PAGES and DNS-rebinding hosts from using the user's browser to reach this loopback server.
//   They are NOT authentication: any local process can send any headers, and a request carrying no Origin and no Referer
//   (curl, a script, a CLI) is accepted by design. Protecting data from arbitrary local processes needs a separate
//   caller-authentication or OS-isolation decision; this server does not provide it.

export const LEGACY_CAPABILITIES = Object.freeze(['state-write', 'tasks', 'providers', 'github-legacy', 'local-git', 'codex-handoff']);

export class CapabilityConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CapabilityConfigError';
  }
}

/**
 * Parses COMMAND_CENTER_LEGACY_CAPABILITIES. Unset or blank = no legacy capability. Otherwise it must be a comma separated
 * list of exact, known, lower-case names; anything else (unknown name, empty entry, wrong case) throws and the server must not start.
 */
export function resolveCapabilities(env = process.env) {
  const raw = env.COMMAND_CENTER_LEGACY_CAPABILITIES;
  const enabled = new Set();
  if (raw === undefined || raw.trim() === '') return enabled;
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!LEGACY_CAPABILITIES.includes(name)) {
      throw new CapabilityConfigError(
        `Invalid COMMAND_CENTER_LEGACY_CAPABILITIES entry ${JSON.stringify(name.slice(0, 40))}: expected a comma separated list of ${LEGACY_CAPABILITIES.join(', ')}.`,
      );
    }
    enabled.add(name);
  }
  return enabled;
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The exact origin this server trusts: http, loopback host, optional port, nothing else. */
export function parseTrustedOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(url.hostname) || url.username || url.password) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return { origin: url.origin, host: url.host };
}

/** Pure decision used by the middleware (and unit-testable). `headers` holds raw header values or undefined. */
export function evaluateRequestPolicy({ trusted, host, origin, referer, checkOrigin }) {
  if (typeof host !== 'string' || host.toLowerCase() !== trusted.host.toLowerCase()) {
    return { ok: false, status: 403, error: 'Unexpected Host header.' };
  }
  if (!checkOrigin) return { ok: true };
  if (origin !== undefined && origin !== trusted.origin) return { ok: false, status: 403, error: 'Unexpected Origin.' };
  if (referer !== undefined) {
    let refererOrigin = null;
    try {
      const u = new URL(referer);
      if (u.protocol === 'http:' || u.protocol === 'https:') refererOrigin = u.origin;
    } catch {
      refererOrigin = null;
    }
    if (refererOrigin !== trusted.origin) return { ok: false, status: 403, error: 'Unexpected Referer.' };
  }
  return { ok: true };
}

/**
 * The ONE definition of "this is an API path". Express mounts `app.use('/api', ...)` case-insensitively (`/API/state` reaches the
 * router), so classification must be case-insensitive too, otherwise a mixed-case spelling is routed as API but checked as a page.
 * Only the pathname is classified (no query). `//api/x` and `/%61pi/x` are NOT API paths for Express either, and stay that way here.
 */
const API_PATH = /^\/api(?:\/|$)/i;
export function isApiPath(pathname) {
  return typeof pathname === 'string' && API_PATH.test(pathname);
}

/** Express middleware: Host is checked for every request, Origin and Referer for /api (any spelling). Refusals are JSON and run no handler. */
export function createRequestPolicy({ trustedOrigin }) {
  const trusted = parseTrustedOrigin(trustedOrigin);
  if (!trusted) throw new CapabilityConfigError('The trusted origin must be an http loopback origin such as http://127.0.0.1:3000.');
  return function requestPolicy(req, res, next) {
    const decision = evaluateRequestPolicy({
      trusted,
      host: req.headers.host,
      origin: req.headers.origin,
      referer: req.headers.referer,
      checkOrigin: isApiPath(req.path),
    });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    next();
  };
}

/** After legacy routers: /api accepts GET only, everything else only GET and HEAD. Refused requests reach no handler. */
export function methodGate(req, res, next) {
  const allowed = isApiPath(req.path) ? ['GET'] : ['GET', 'HEAD'];
  if (allowed.includes(req.method)) {
    next();
    return;
  }
  req.resume(); // discard any request body: a refused request is never parsed or buffered
  res.set('Allow', allowed.join(', ')).status(405).json({ error: 'Method not allowed.' });
}

/** Last API middleware: an unknown /api path is an API error, never the SPA fallback. */
export function apiNotFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// ---------------------------------------------------------------------------------------------------------------------
// Vite development surface (R2)
//
// In development Vite serves the whole project root: any file under the working directory is addressable as a static file, a raw
// module (`?raw`, `?import`), `/@fs/<absolute path>`, through the `@` alias (`/@id/@/...`) or an editor launcher. The project
// root also holds business data (projects.local.json, data/tasks, .bridge, .env). So the development server is put behind an
// ALLOWLIST that runs before Vite: only the V1 frontend surface is reachable and everything else is a plain 404 that never reaches Vite.
// ---------------------------------------------------------------------------------------------------------------------

const DEV_ASSET_PREFIXES = ['/src/', '/@vite/', '/node_modules/.vite/deps/'];

/**
 * Classifies a raw request target (path and query, exactly as received) for the development server.
 *   'spa'   an HTML page request (no file is named): answered with the app's index.html
 *   'allow' a V1 frontend asset: the source tree, Vite's client, its pre-bundled dependencies, an installed package
 *   'deny'  anything else, including every path whose spelling could hide a traversal; fails closed
 * Pure: it only reads its arguments (no filesystem access), so it can be tested without a server.
 */
export function classifyDevAssetRequest(rawUrl, { root }) {
  const deny = { action: 'deny' };
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) return deny;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(rawUrl)) return deny; // backslash, NUL and other control characters
  const cut = rawUrl.search(/[?#]/);
  const pathname = cut === -1 ? rawUrl : rawUrl.slice(0, cut);
  // Anything that could hide a dot segment, a separator or a double-encoding behind percent escapes is refused outright.
  if (/%(?:2e|2f|5c|00|25)/i.test(pathname)) return deny;
  let decoded;
  try {
    decoded = decodeURI(pathname);
  } catch {
    return deny;
  }
  if (/(^|\/)\.\.?(\/|$)/.test(decoded)) return deny;

  // `/@fs/<absolute path>`: Vite's way of addressing a file by absolute path. Only installed packages are legitimate.
  if (decoded.startsWith('/@fs/')) {
    const fsPath = `/${decoded.slice('/@fs/'.length).replace(/^\/+/, '')}`;
    const nodeModules = `${String(root).replace(/\\/g, '/').replace(/\/+$/, '')}/node_modules/`;
    return !fsPath.includes('//') && fsPath.startsWith(nodeModules) && fsPath.length > nodeModules.length ? { action: 'allow' } : deny;
  }
  if (decoded.includes('//')) return deny;
  if (decoded === '/' || decoded === '/index.html') return { action: 'spa' };

  const segments = decoded.split('/').slice(1);
  // Dotfiles and dot-directories (.env, .bridge, .git, ...) are never frontend assets. Only Vite's own dependency cache is exempt.
  const inDepCache = decoded.startsWith('/node_modules/.vite/deps/');
  if (!inDepCache && segments.some((segment) => segment.startsWith('.'))) return deny;

  if (decoded === '/@react-refresh') return { action: 'allow' };
  if (decoded.startsWith('/@id/')) {
    // Only Vite's virtual modules. `@/...` (the project alias, which points at the project root) and bare file paths are not.
    return /^(?:__x00__|virtual:)[^/]/.test(decoded.slice('/@id/'.length)) ? { action: 'allow' } : deny;
  }
  if (DEV_ASSET_PREFIXES.some((prefix) => decoded.startsWith(prefix) && decoded.length > prefix.length)) return { action: 'allow' };
  // Vite internals and tooling endpoints (/@vite-plugin-*, /__open-in-editor, /__vite_ping, ...) are not part of the V1 surface.
  if (/^\/(?:@|__)/.test(decoded)) return deny;
  // A path whose last segment names no file extension is a client-side route, never a file.
  return segments[segments.length - 1].includes('.') ? deny : { action: 'spa' };
}

/**
 * Express middleware for the development server, installed BEFORE Vite. Denied paths get a JSON 404 and never reach Vite; page
 * requests are rewritten to /index.html (so no file outside the app can be read through a "page" URL); frontend assets additionally
 * get the Origin/Referer check that /api gets, so another web page cannot use the user's browser to load source modules.
 */
export function createDevAssetGuard({ trustedOrigin, root }) {
  const trusted = parseTrustedOrigin(trustedOrigin);
  if (!trusted) throw new CapabilityConfigError('The trusted origin must be an http loopback origin such as http://127.0.0.1:3000.');
  return function devAssetGuard(req, res, next) {
    const decision = classifyDevAssetRequest(req.url, { root });
    if (decision.action === 'deny') {
      res.status(404).json({ error: 'Not found.' });
      return;
    }
    if (decision.action === 'spa') {
      req.url = '/index.html';
      next();
      return;
    }
    const policy = evaluateRequestPolicy({ trusted, host: req.headers.host, origin: req.headers.origin, referer: req.headers.referer, checkOrigin: true });
    if (!policy.ok) {
      res.status(policy.status).json({ error: policy.error });
      return;
    }
    next();
  };
}

