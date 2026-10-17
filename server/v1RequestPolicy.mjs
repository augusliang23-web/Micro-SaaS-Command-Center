// Command Center V1 request policy: capability selection and the browser/host boundary for the read-only API.
//
// Capability and request-header functions are pure so they can run BEFORE anything with a side effect.
// The Vite development asset guard combines lexical URL/dotfile classification with canonical filesystem realpath containment.
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

import fs from 'node:fs';
import path from 'node:path';

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
// ALLOWLIST that runs before Vite:
//   1. Lexical URL & dotfile validation rejects non-frontend paths, traversal spellings and dotfiles (including nested dotfiles
//      and dotfiles under `/@fs/.../node_modules/` or `/node_modules/.vite/deps/`).
//   2. Canonical filesystem verification (`lstatSync` + `realpathSync`) ensures that every ancestor segment and the final file
//      destination stay inside the approved canonical root (`<realpath(root)>/src`, `<realpath(root)>/node_modules`, or
//      `<realpath(root)>/node_modules/.vite/deps`) and never resolve to a dotfile or outside the boundary via symlinks.
// ---------------------------------------------------------------------------------------------------------------------

function verifyCanonicalTarget(target, { root, checkFs }) {
  const deny = { action: 'deny' };
  const outAction = target.kind === 'spa' ? { action: 'spa' } : { action: 'allow' };
  if (typeof root !== 'string' || root.length === 0) return deny;

  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (err) {
    // Allow pure lexical unit tests with a synthetic non-existent root string when checkFs is not forced.
    if (!checkFs && err && err.code === 'ENOENT') return outAction;
    return deny;
  }
  if (!rootStat.isDirectory()) return deny;

  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return deny;
  }

  if (target.kind === 'spa') {
    const rawIndex = path.join(realRoot, 'index.html');
    try {
      const indexLstat = fs.lstatSync(rawIndex);
      if (indexLstat.isSymbolicLink() || !indexLstat.isFile()) return deny;
      if (fs.realpathSync(rawIndex) !== rawIndex) return deny;
    } catch {
      return deny;
    }
    return outAction;
  }

  const baseSegments =
    target.kind === 'src'
      ? ['src']
      : target.kind === 'node-modules'
        ? ['node_modules']
        : ['node_modules', '.vite', 'deps'];

  let baseCur = realRoot;
  for (const seg of baseSegments) {
    baseCur = path.join(baseCur, seg);
    try {
      const st = fs.lstatSync(baseCur);
      if (st.isSymbolicLink() || !st.isDirectory()) return deny;
      if (fs.realpathSync(baseCur) !== baseCur) return deny;
    } catch {
      return deny;
    }
  }
  const realAllowedBase = baseCur;

  let cur = realAllowedBase;
  const relSegments = target.relSegments;
  for (let i = 0; i < relSegments.length; i += 1) {
    const seg = relSegments[i];
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('.')) return deny;
    const nextPath = path.join(cur, seg);
    let realStep;
    try {
      fs.lstatSync(nextPath);
      realStep = fs.realpathSync(nextPath);
    } catch {
      return deny;
    }
    const relCanonical = path.relative(realAllowedBase, realStep);
    if (!relCanonical || relCanonical.startsWith('..') || path.isAbsolute(relCanonical)) {
      return deny;
    }
    const canonSegments = relCanonical.split(path.sep);
    if (canonSegments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.'))) {
      return deny;
    }
    if (i === relSegments.length - 1) {
      try {
        if (!fs.statSync(realStep).isFile()) return deny;
      } catch {
        return deny;
      }
    }
    cur = realStep;
  }
  return outAction;
}

/**
 * Classifies a raw request target (path and query, exactly as received) for the development server.
 *   'spa'   an HTML page request (no file is named): answered with the app's index.html
 *   'allow' a V1 frontend asset: the source tree, Vite's client, its pre-bundled dependencies, an installed package
 *   'deny'  anything else, including every path whose spelling or resolved symlink target leaves the allowed surface; fails closed
 */
export function classifyDevAssetRequest(rawUrl, { root, checkFs = false } = {}) {
  const deny = { action: 'deny' };
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) return deny;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(rawUrl)) return deny; // backslash, NUL and other control characters
  if (/%(?:2e|2f|5c|00|25)/i.test(rawUrl)) return deny;
  const cut = rawUrl.search(/[?#]/);
  const pathname = cut === -1 ? rawUrl : rawUrl.slice(0, cut);
  let decoded;
  try {
    decoded = decodeURI(pathname);
    if (decodeURIComponent(pathname) !== decoded) return deny;
  } catch {
    return deny;
  }
  if (/(^|\/)\.\.?(\/|$)/.test(decoded)) return deny;

  // `/@fs/<absolute path>`: Vite's way of addressing a file by absolute path. Only installed packages under <root>/node_modules/ are allowed.
  if (decoded.startsWith('/@fs/')) {
    const fsPath = decoded.slice('/@fs/'.length).replace(/^\/?/, '/');
    if (fsPath.includes('//')) return deny;
    const normalizedRoot = String(root ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const nodeModules = `${normalizedRoot}/node_modules/`;
    if (!normalizedRoot || !fsPath.startsWith(nodeModules) || fsPath.length <= nodeModules.length) return deny;
    const rel = fsPath.slice(nodeModules.length);
    const nmSegments = rel.split('/');
    const isViteDeps = rel.startsWith('.vite/deps/') && nmSegments.length > 2;
    const checkSegments = isViteDeps ? nmSegments.slice(2) : nmSegments;
    if (checkSegments.some((segment) => !segment || segment.startsWith('.'))) return deny;
    return verifyCanonicalTarget(
      isViteDeps
        ? { kind: 'dep-cache', relSegments: nmSegments.slice(2) }
        : { kind: 'node-modules', relSegments: nmSegments },
      { root, checkFs },
    );
  }
  if (decoded.includes('//')) return deny;

  if (decoded === '/' || decoded === '/index.html') {
    return verifyCanonicalTarget({ kind: 'spa' }, { root, checkFs });
  }

  if (decoded === '/@react-refresh' || decoded === '/@vite/client' || decoded === '/@vite/env') {
    return { action: 'allow' };
  }
  if (decoded.startsWith('/@id/')) {
    const idRest = decoded.slice('/@id/'.length);
    if (idRest.split('/').some((segment) => !segment || segment.startsWith('.'))) return deny;
    // Only Vite's virtual modules. `@/...` (the project alias, which points at the project root) and bare file paths are not.
    return /^(?:__x00__|virtual:)[^/]/.test(idRest) ? { action: 'allow' } : deny;
  }

  const segments = decoded.split('/').slice(1);
  if (decoded.startsWith('/node_modules/.vite/deps/')) {
    const depSegments = segments.slice(3);
    if (depSegments.length === 0 || depSegments.some((segment) => !segment || segment.startsWith('.'))) return deny;
    return verifyCanonicalTarget({ kind: 'dep-cache', relSegments: depSegments }, { root, checkFs });
  }

  // Dotfiles and dot-directories (.env, .bridge, .git, nested dotfiles, ...) are never frontend assets.
  if (segments.some((segment) => !segment || segment.startsWith('.'))) return deny;

  if (decoded.startsWith('/src/') && segments.length > 1) {
    return verifyCanonicalTarget({ kind: 'src', relSegments: segments.slice(1) }, { root, checkFs });
  }

  // Vite internals and tooling endpoints (/@vite-plugin-*, /__open-in-editor, /__vite_ping, ...) are not part of the V1 surface.
  if (/^\/(?:@|__)/.test(decoded)) return deny;
  // A path whose last segment names no file extension is a client-side route, never a file.
  if (segments[segments.length - 1].includes('.')) return deny;
  return verifyCanonicalTarget({ kind: 'spa' }, { root, checkFs });
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
    const decision = classifyDevAssetRequest(req.url, { root, checkFs: true });
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
