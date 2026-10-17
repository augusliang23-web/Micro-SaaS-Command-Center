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

/** Express middleware: Host is checked for every request, Origin and Referer for /api. Refusals are JSON and run no handler. */
export function createRequestPolicy({ trustedOrigin }) {
  const trusted = parseTrustedOrigin(trustedOrigin);
  if (!trusted) throw new CapabilityConfigError('The trusted origin must be an http loopback origin such as http://127.0.0.1:3000.');
  return function requestPolicy(req, res, next) {
    const decision = evaluateRequestPolicy({
      trusted,
      host: req.headers.host,
      origin: req.headers.origin,
      referer: req.headers.referer,
      checkOrigin: req.path === '/api' || req.path.startsWith('/api/'),
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
  const isApi = req.path === '/api' || req.path.startsWith('/api/');
  const allowed = isApi ? ['GET'] : ['GET', 'HEAD'];
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
