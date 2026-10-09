// Phase 3B6B.10B: pure, offline-testable normalizer for the PROPOSED human MDM readback (not authorized to run).
//
// It never runs `sudo` or `profiles`. A human would capture the command's own exit status and its stdout in memory and hand both to this
// helper, which prints only a closed vocabulary of normalized words. Rules that matter:
//   * A well-formed XML plist proves SYNTAX only. Whether it is a COMPLETE device-wide inventory depends on the exact output schema of
//     `profiles show -all`, which has never been reviewed. So coverage can only be COMPLETE for a schema carrying a module-private trust brand
//     (synthetic for tests, or Control Plane-approved via the committed registry, which is empty). The command line supplies none, therefore the real
//     result can never be a success word today: the best it can say is BLOCKED (real-host mode disabled), plus a harmless schema fingerprint to review.
//   * Presence is conservative (any mention of the Claude domain, anywhere, blocks); absence needs complete coverage and nothing opaque.
//   * Policy-file checks use lstat on every ancestor; a symlinked or non-directory ancestor, an unreadable path or any unexpected error is UNKNOWN.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// PHASE 3B6B.10C — ISOLATION: this module imports no filesystem, OS, process or network API. It cannot read the host by construction.
// Policy-path inspection runs ONLY against an in-memory `createSyntheticFs` object; anything else is NOT_INSPECTED. Real-host mode is a
// constant `false` with no switch (no flag, no environment variable, no option). Enabling it needs a separately reviewed code change.
export const REAL_HOST_MODE = Object.freeze({ enabled: false, reason: 'NOT_AUTHORIZED' });

export const MDM_LIMITS = Object.freeze({ maxBytes: 8_000_000, maxDepth: 32, maxNodes: 200_000 });
const DOMAIN = 'com.anthropic.claudecode';
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---- strict XML property-list parser ---------------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeText(text) {
  let out = ''; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '&') { out += ch; i += 1; continue; }
    const end = text.indexOf(';', i);
    if (end < 0 || end - i > 10) throw new Error('entity');
    const name = text.slice(i + 1, end);
    if (Object.hasOwn(ENTITIES, name)) out += ENTITIES[name];
    else if (/^#\d{1,7}$/.test(name) || /^#x[0-9a-fA-F]{1,6}$/.test(name)) {
      const cp = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (!Number.isInteger(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Error('codepoint');
      out += String.fromCodePoint(cp);
    } else throw new Error('entity');
    i = end + 1;
  }
  return out;
}

/** @returns {{ok:true, root:object, dataBlobs:Buffer[]} | {ok:false, code:string}} */
export function parsePlistXml(input) {
  try {
    if (typeof input !== 'string' || input.length === 0 || input.length > MDM_LIMITS.maxBytes || input.includes('\0')) return { ok: false, code: 'MALFORMED_XML' };
    let s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; let pos = 0; let nodes = 0; const dataBlobs = [];
    const fail = () => { throw new Error('malformed'); };
    const skipWs = () => { while (pos < s.length && /\s/.test(s[pos])) pos += 1; };
    const skipMisc = () => {
      for (;;) {
        skipWs();
        if (s.startsWith('<!--', pos)) { const end = s.indexOf('-->', pos + 4); if (end < 0) fail(); pos = end + 3; } else break;
      }
    };
    skipMisc();
    if (s.startsWith('<?xml', pos)) { const end = s.indexOf('?>', pos); if (end < 0) fail(); pos = end + 2; skipMisc(); }
    if (s.startsWith('<!DOCTYPE', pos)) {
      const end = s.indexOf('>', pos); if (end < 0) fail();
      const decl = s.slice(pos, end + 1);
      if (/[\[\]]|<!ENTITY|<!ELEMENT|<!ATTLIST/.test(decl)) fail(); // no internal subset: no entity tricks
      pos = end + 1; skipMisc();
    }
    const readTag = () => {
      if (s[pos] !== '<') fail();
      const end = s.indexOf('>', pos); if (end < 0) fail();
      const body = s.slice(pos + 1, end); pos = end + 1;
      if (body.startsWith('!') || body.startsWith('?')) fail(); // CDATA, stray declarations
      const closing = body.startsWith('/'); const selfClosing = body.endsWith('/');
      const inner = body.slice(closing ? 1 : 0, selfClosing ? -1 : undefined).trim();
      const m = /^([A-Za-z]+)(\s+[^<>]*)?$/.exec(inner); if (!m) fail();
      return { name: m[1], attrs: m[2]?.trim() ?? '', closing, selfClosing };
    };
    const readText = () => { const end = s.indexOf('<', pos); if (end < 0) fail(); const t = s.slice(pos, end); pos = end; return decodeText(t); };
    const value = (depth) => {
      if (depth > MDM_LIMITS.maxDepth || ++nodes > MDM_LIMITS.maxNodes) fail();
      skipMisc();
      const tag = readTag(); if (tag.closing || tag.attrs) fail();
      const close = name => { skipMisc(); const t = readTag(); if (!t.closing || t.name !== name || t.attrs || t.selfClosing) fail(); };
      switch (tag.name) {
        case 'true': case 'false': if (!tag.selfClosing) { close(tag.name); } return { t: 'bool', v: tag.name === 'true' };
        case 'string': { if (tag.selfClosing) return { t: 'string', v: '' }; const v = readText(); close('string'); return { t: 'string', v }; }
        case 'integer': { if (tag.selfClosing) fail(); const v = readText().trim(); if (!/^-?\d{1,20}$/.test(v)) fail(); close('integer'); return { t: 'integer', v }; }
        case 'real': { if (tag.selfClosing) fail(); const v = readText().trim(); if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) fail(); close('real'); return { t: 'real', v }; }
        case 'date': { if (tag.selfClosing) fail(); const v = readText().trim(); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) fail(); close('date'); return { t: 'date', v }; }
        case 'data': {
          if (tag.selfClosing) return { t: 'data', v: Buffer.alloc(0) };
          const v = readText().replace(/\s+/g, ''); if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v) || v.length % 4 !== 0) fail(); close('data');
          const buf = Buffer.from(v, 'base64'); dataBlobs.push(buf); return { t: 'data', v: buf };
        }
        case 'array': { const items = []; if (tag.selfClosing) return { t: 'array', items };
          for (;;) { skipMisc(); if (s.startsWith('</', pos)) { close('array'); return { t: 'array', items }; } items.push(value(depth + 1)); } }
        case 'dict': { const entries = []; const seen = new Set(); if (tag.selfClosing) return { t: 'dict', entries };
          for (;;) {
            skipMisc();
            if (s.startsWith('</', pos)) { close('dict'); return { t: 'dict', entries }; }
            const k = readTag(); if (k.name !== 'key' || k.closing || k.attrs || k.selfClosing) fail();
            const name = readText(); close('key'); if (seen.has(name)) fail(); seen.add(name);
            entries.push([name, value(depth + 1)]);
          } }
        default: return fail();
      }
    };
    const head = readTag(); if (head.name !== 'plist' || head.closing || head.selfClosing || !/^version="1\.0"$/.test(head.attrs)) fail();
    const root = value(1);
    skipMisc(); const tail = readTag(); if (tail.name !== 'plist' || !tail.closing) fail();
    skipMisc(); if (pos !== s.length) fail();
    return { ok: true, root, dataBlobs };
  } catch { return { ok: false, code: 'MALFORMED_XML' }; }
}

// ---- content scan (conservative presence) ---------------------------------------------------------------------------------
function scanTree(root, dataBlobs) {
  let domain = false; let reference = false; let opaque = false;
  const check = text => { const l = text.toLowerCase(); if (l.includes(DOMAIN)) domain = true; if (l.includes('anthropic')) reference = true; };
  const walk = n => {
    if (n.t === 'string') check(n.v);
    else if (n.t === 'array') n.items.forEach(walk);
    else if (n.t === 'dict') for (const [k, v] of n.entries) { check(k); walk(v); }
  };
  walk(root);
  for (const blob of dataBlobs) {
    const be = Buffer.from(blob); for (let i = 0; i + 1 < be.length; i += 2) { const a = be[i]; be[i] = be[i + 1]; be[i + 1] = a; }
    for (const text of [blob.toString('latin1'), blob.toString('utf16le'), be.toString('utf16le')]) check(text);
    const head = blob.subarray(0, 8).toString('latin1');
    if (head.startsWith('bplist') || head.startsWith('<?xml') || head.startsWith('<plist')) opaque = true; // nested policy payload we do not unpack
  }
  return { domain, reference, opaque };
}

/**
 * Closed-vocabulary schema fingerprint for human/Control Plane review. DIAGNOSTIC ONLY: it never feeds coverage, trust or any admission decision.
 * Reveals no key names (user-name root keys are only counted) and no values.
 * The `profiles` manual documents the device-level top-level key as `_computerLevel`; older notes used `_computerlevel`. Both are recognised for
 * diagnostics (case-insensitively), the spelling is reported, and more than one candidate spelling is AMBIGUOUS: nothing below it is inspected.
 */
export function schemaFingerprint(parsed) {
  if (!parsed?.ok) return 'ROOT=NONE';
  const bucket = n => (n === 0 ? '0' : n <= 4 ? '1-4' : n <= 16 ? '5-16' : '17+');
  const root = parsed.root; const parts = [`ROOT=${root.t}`];
  if (root.t === 'dict') {
    parts.push(`ROOT_KEYS=${bucket(root.entries.length)}`);
    const matches = root.entries.filter(([k]) => k.toLowerCase() === '_computerlevel');
    const only = matches.length === 1 ? matches[0] : null;
    const spelling = only ? (only[0] === '_computerLevel' ? 'DOCUMENTED' : only[0] === '_computerlevel' ? 'LOWERCASE' : 'OTHER_CASE') : 'NONE';
    parts.push(`COMPUTERLEVEL=${matches.length === 0 ? 'ABSENT' : matches.length > 1 ? 'AMBIGUOUS' : only[1].t}`, `SPELLING=${spelling}`, `OTHER_ROOT_KEYS=${bucket(root.entries.length - matches.length)}`);
    const inv = only?.[1];
    if (inv?.t === 'array') {
      parts.push(`ENTRIES=${bucket(inv.items.length)}`, `ENTRIES_ALL_DICT=${inv.items.every(i => i.t === 'dict')}`,
        `ENTRIES_HAVE_PROFILEIDENTIFIER=${inv.items.length > 0 && inv.items.every(i => i.t === 'dict' && i.entries.some(([k]) => k === 'ProfileIdentifier'))}`);
    }
  }
  return parts.join(';');
}

function evaluateCoverage(parsed, brand) {
  if (!parsed.ok) return { coverage: 'PARTIAL', form: 'MALFORMED' };
  const trusted = isRecord(brand) ? SCHEMA_BRANDS.get(brand) : undefined; // an unbranded object (any self-asserted review id) is ignored
  if (!trusted) return { coverage: 'UNQUALIFIED', form: 'XML_PLIST' };
  const schema = trusted.descriptor;
  const root = parsed.root;
  if (root.t !== 'dict') return { coverage: 'PARTIAL', form: 'UNKNOWN_STRUCTURE' };
  const allowed = new Set([schema.inventoryKey, ...schema.allowedOtherRootKeys]);
  if (root.entries.some(([k]) => !allowed.has(k))) return { coverage: 'PARTIAL', form: 'UNKNOWN_STRUCTURE' };
  const inv = root.entries.find(([k]) => k === schema.inventoryKey)?.[1];
  if (!inv || inv.t !== 'array') return { coverage: 'PARTIAL', form: 'UNKNOWN_STRUCTURE' };
  if (!inv.items.every(i => i.t === 'dict' && schema.entryRequiredKeys.every(k => i.entries.some(([name]) => name === k)))) return { coverage: 'PARTIAL', form: 'UNKNOWN_STRUCTURE' };
  if (inv.items.length === 0 && !schema.emptyInventoryIsComplete) return { coverage: 'PARTIAL', form: 'EMPTY_INVENTORY_UNREVIEWED' };
  return { coverage: 'COMPLETE', form: 'XML_PLIST' };
}

// ---- synthetic filesystem (the ONLY thing path inspection accepts) -----------------------------------------------------------
const SYNTHETIC_FS = new WeakSet();
/** In-memory directory model. Only objects made here are accepted; the real `fs` module (or a wrapper around it) is never accepted. */
export function createSyntheticFs({ dirs = [], files = [], symlinks = [], errors = {} } = {}) {
  const D = new Set(dirs); const F = new Set(files); const L = new Set(symlinks); const E = new Map(Object.entries(errors));
  const api = Object.freeze({
    lstatSync(p) {
      if (E.has(p)) throw Object.assign(new Error('synthetic filesystem error'), { code: E.get(p) });
      const kind = L.has(p) ? 'link' : D.has(p) ? 'dir' : F.has(p) ? 'file' : null;
      if (!kind) throw Object.assign(new Error('synthetic ENOENT'), { code: 'ENOENT' });
      return { isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'dir' };
    },
  });
  SYNTHETIC_FS.add(api);
  return api;
}
const isSyntheticFs = x => x !== null && typeof x === 'object' && SYNTHETIC_FS.has(x);

// ---- schema trust --------------------------------------------------------------------------------------------------------
// A schema descriptor is DATA and never carries its own trust. Trust is a module-private brand given only by:
//   * createSyntheticTestSchema()           -> SYNTHETIC_TEST_SCHEMA  (tests; can never produce an "approved" outcome), or
//   * resolveControlPlaneApprovedSchema()   -> CONTROL_PLANE_APPROVED_SCHEMA, only if the descriptor's exact SHA-256 appears in the
//                                              committed APPROVED_SCHEMA_REGISTRY below. That registry is EMPTY: no schema is approved.
// A review id typed into a descriptor (or anywhere a caller controls) establishes nothing.
export const SCHEMA_TRUST = Object.freeze({ SYNTHETIC: 'SYNTHETIC_TEST_SCHEMA', APPROVED: 'CONTROL_PLANE_APPROVED_SCHEMA' });
export const APPROVAL_REPOSITORY = 'augusliang23-web/Micro-SaaS-Command-Center';
export const APPROVAL_COMMAND_CLASS = 'profiles show -type configuration -all -output stdout-xml';
/** Future entries are added only by a Control Plane-reviewed commit: { schemaSha256, commitSha, reviewId, reviewSource, repository, commandClass }. */
export const APPROVED_SCHEMA_REGISTRY = Object.freeze([]);
const SCHEMA_BRANDS = new WeakMap();

const validDescriptor = d => isRecord(d) && typeof d.inventoryKey === 'string' && d.inventoryKey !== '' &&
  Array.isArray(d.entryRequiredKeys) && d.entryRequiredKeys.every(k => typeof k === 'string' && k !== '') &&
  Array.isArray(d.allowedOtherRootKeys) && d.allowedOtherRootKeys.every(k => typeof k === 'string') && typeof d.emptyInventoryIsComplete === 'boolean';
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isRecord(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
/** Hash of the structural content only (never of a self-asserted review id). */
export function schemaSha256(d) {
  if (!validDescriptor(d)) return null;
  return createHash('sha256').update(canonical({ inventoryKey: d.inventoryKey, entryRequiredKeys: [...d.entryRequiredKeys].sort(), allowedOtherRootKeys: [...d.allowedOtherRootKeys].sort(), emptyInventoryIsComplete: d.emptyInventoryIsComplete })).digest('hex');
}
export function createSyntheticTestSchema(descriptor) {
  if (!validDescriptor(descriptor)) throw new TypeError('Invalid schema descriptor');
  const brand = Object.freeze({ kind: SCHEMA_TRUST.SYNTHETIC });
  SCHEMA_BRANDS.set(brand, { kind: SCHEMA_TRUST.SYNTHETIC, descriptor: structuredClone(descriptor) });
  return brand;
}
/** Pure binding check of a descriptor against a registry: exact schema hash, 40-hex commit, positive review id, fixed trusted source. */
export function matchApproval(descriptor, registry) {
  const hash = schemaSha256(descriptor);
  if (!hash || !Array.isArray(registry)) return { ok: false, code: 'SCHEMA_NOT_APPROVED' };
  const entry = registry.find(e => isRecord(e) && e.schemaSha256 === hash);
  if (!entry) return { ok: false, code: 'SCHEMA_NOT_APPROVED' };
  if (!/^[0-9a-f]{40}$/.test(entry.commitSha ?? '') || !Number.isInteger(entry.reviewId) || entry.reviewId <= 0 || entry.reviewSource !== 'GITHUB_CONTROL_PLANE_REVIEW' ||
      entry.repository !== APPROVAL_REPOSITORY || entry.commandClass !== APPROVAL_COMMAND_CLASS) return { ok: false, code: 'APPROVAL_BINDING_INVALID' };
  return { ok: true, entry };
}
export function resolveControlPlaneApprovedSchema(descriptor) {
  if (!matchApproval(descriptor, APPROVED_SCHEMA_REGISTRY).ok) return null;
  const brand = Object.freeze({ kind: SCHEMA_TRUST.APPROVED });
  SCHEMA_BRANDS.set(brand, { kind: SCHEMA_TRUST.APPROVED, descriptor: structuredClone(descriptor) });
  return brand;
}

// ---- policy-file inspection (symlink / ancestor safe) -------------------------------------------------------------------------
export function policyPaths({ home, user }) {
  return [
    '/Library/Application Support/ClaudeCode/managed-settings.json', '/Library/Application Support/ClaudeCode/managed-settings.d',
    '/Library/Application Support/ClaudeCode/managed-mcp.json', '/Library/Managed Preferences/com.anthropic.claudecode.plist',
    `/Library/Managed Preferences/${user}/com.anthropic.claudecode.plist`, path.join(home, 'Library/Managed Preferences/com.anthropic.claudecode.plist'),
    path.join(home, '.claude/remote-settings.json'),
  ];
}
export function inspectPolicyPath(target, fsApi) {
  if (!isSyntheticFs(fsApi)) return { state: 'NOT_INSPECTED', reason: 'NO_SYNTHETIC_FILESYSTEM' };
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.normalize(target) !== target || target.includes('\0')) return { state: 'UNKNOWN', reason: 'PATH_NOT_CANONICAL' };
  const parts = target.split('/').filter(Boolean); let current = '';
  for (let i = 0; i < parts.length; i += 1) {
    current += `/${parts[i]}`; let stat;
    try { stat = fsApi.lstatSync(current); } catch (error) {
      // ENOENT is "absent" only because every earlier component was already verified as a plain directory.
      if (error?.code === 'ENOENT') return { state: 'ABSENT', reason: 'NOT_FOUND' };
      return { state: 'UNKNOWN', reason: error?.code === 'ENOTDIR' ? 'NOT_DIRECTORY_ANCESTOR' : 'INSPECTION_ERROR' };
    }
    if (i === parts.length - 1) return { state: 'PRESENT', reason: stat.isSymbolicLink() ? 'SYMLINK' : 'EXISTS' };
    if (stat.isSymbolicLink()) return { state: 'UNKNOWN', reason: 'SYMLINK_ANCESTOR' };
    if (!stat.isDirectory()) return { state: 'UNKNOWN', reason: 'NOT_DIRECTORY_ANCESTOR' };
  }
  return { state: 'UNKNOWN', reason: 'INSPECTION_ERROR' };
}

// ---- decision --------------------------------------------------------------------------------------------------------------------
/**
 * @param {{ exitCode: unknown, signal?: unknown, timedOut?: boolean, stdout: unknown, home?: string, user?: string, syntheticFs?: object, schema?: object, now?: () => number }} input
 * Never throws; every failure is a BLOCKED word.
 */
export function normalizeMdmReadback(input) {
  const out = { runUtc: 'UNKNOWN', profilesExit: 'NONE', coverage: 'FAILED', form: 'NONE', claudeDomain: 'UNKNOWN', managedFiles: 'NOT_INSPECTED', domainScan: 'UNSCANNABLE', schema: 'ROOT=NONE', schemaTrust: 'NONE', hostMode: 'DISABLED', overall: 'BLOCKED_UNKNOWN' };
  try {
    try { out.runUtc = new Date((input.now ?? Date.now)()).toISOString().replace(/\.\d+Z$/, 'Z'); } catch { out.runUtc = 'UNKNOWN'; }
    // Policy files: ONLY against a synthetic in-memory filesystem. Without one nothing is inspected (there is no real-host fallback).
    if (isSyntheticFs(input.syntheticFs)) {
      out.hostMode = 'SYNTHETIC';
      const states = policyPaths({ home: input.home, user: input.user }).map(p => inspectPolicyPath(p, input.syntheticFs).state);
      out.managedFiles = states.includes('PRESENT') ? 'PRESENT' : states.every(s => s === 'ABSENT') ? 'ABSENT' : 'UNKNOWN';
    }
    out.schemaTrust = (isRecord(input.schema) && SCHEMA_BRANDS.get(input.schema)?.kind) || 'NONE';
    // The command's OWN status.
    const rc = input.exitCode;
    const statusOk = Number.isInteger(rc) && rc === 0 && !input.timedOut && !input.signal;
    if (Number.isInteger(rc)) out.profilesExit = String(rc);
    const stdout = typeof input.stdout === 'string' ? input.stdout : null;
    let parsed = { ok: false, code: 'MALFORMED_XML' }; let scan = { domain: false, reference: false, opaque: false };
    if (stdout === null || stdout.length === 0) out.form = stdout === null ? 'NONE' : 'EMPTY';
    else if (stdout.length > MDM_LIMITS.maxBytes) out.form = 'TOO_LARGE';
    else {
      parsed = parsePlistXml(stdout);
      out.form = parsed.ok ? 'XML_PLIST' : 'MALFORMED';
      if (parsed.ok) { out.schema = schemaFingerprint(parsed); scan = scanTree(parsed.root, parsed.dataBlobs); out.domainScan = 'SCANNED'; }
      else if (stdout.toLowerCase().includes(DOMAIN) || stdout.toLowerCase().includes('anthropic')) scan = { domain: stdout.toLowerCase().includes(DOMAIN), reference: true, opaque: false };
    }
    if (scan.domain) out.domainScan = 'FOUND'; else if (out.domainScan === 'SCANNED' && (scan.reference || scan.opaque)) out.domainScan = 'UNSCANNABLE';
    // Coverage can only be COMPLETE when the command succeeded AND a reviewed schema recognises the structure.
    if (!statusOk) out.coverage = 'FAILED';
    else if (out.form === 'EMPTY' || out.form === 'TOO_LARGE' || out.form === 'NONE') out.coverage = 'PARTIAL';
    else { const c = evaluateCoverage(parsed, input.schema); out.coverage = c.coverage; if (c.form !== 'XML_PLIST') out.form = c.form; }
    if (scan.domain) out.claudeDomain = 'PRESENT';
    else if (out.coverage === 'COMPLETE' && out.domainScan === 'SCANNED' && !scan.reference && !scan.opaque) out.claudeDomain = 'ABSENT';
    else out.claudeDomain = 'UNKNOWN';
    if (out.claudeDomain === 'PRESENT') out.overall = 'BLOCKED_PRESENT';
    else if (out.managedFiles === 'PRESENT') out.overall = out.claudeDomain === 'ABSENT' ? 'BLOCKED_CONTRADICTORY' : 'BLOCKED_PRESENT';
    else if (out.hostMode !== 'SYNTHETIC') out.overall = 'BLOCKED_REAL_HOST_MODE_DISABLED';
    else if (out.coverage === 'UNQUALIFIED' && out.managedFiles === 'ABSENT' && statusOk) out.overall = 'BLOCKED_SCHEMA_UNQUALIFIED';
    // The only success word is SYNTHETIC: there is no real-host mode, so `CURRENT_ABSENCE_OBSERVED` is reserved and unreachable.
    else if (out.coverage === 'COMPLETE' && out.claudeDomain === 'ABSENT' && out.managedFiles === 'ABSENT') out.overall = 'SYNTHETIC_ABSENCE_OBSERVED';
    else out.overall = 'BLOCKED_UNKNOWN';
  } catch { out.overall = 'BLOCKED_UNKNOWN'; }
  return out;
}

export function formatReadback(r) {
  return [`RUN_UTC=${r.runUtc}`, `PROFILES_EXIT=${r.profilesExit}`, `COVERAGE=${r.coverage} (form=${r.form})`, `CLAUDE_DOMAIN=${r.claudeDomain} (scan=${r.domainScan})`,
    `MANAGED_FILES=${r.managedFiles}`, `SCHEMA_FINGERPRINT=${r.schema}`, `SCHEMA_TRUST=${r.schemaTrust}`, `HOST_MODE=${r.hostMode}`, `OVERALL=${r.overall}`].join('\n');
}

/**
 * Thin command-line adapter: `print -rn -- "$raw" | node <this file> --rc="$rc"`. It reads ONLY standard input: no filesystem, no home directory,
 * no user lookup, no environment. Real-host inspection is disabled, so the policy files are reported NOT_INSPECTED and the overall word is
 * BLOCKED_*. A `syntheticFs` / `schema` can be supplied only by library callers (tests); the command line has no flag for either.
 */
export function runMdmCli({ argv, stdin, syntheticFs, schema, home, user, now = Date.now }) {
  const rcArgs = argv.filter(a => /^--rc=-?\d{1,4}$/.test(a));
  const argsValid = rcArgs.length === 1 && argv.length === 1; // any other argument (for example a real-host or fixture switch) is refused
  const exitCode = argsValid ? Number(rcArgs[0].slice(5)) : undefined;
  const result = normalizeMdmReadback({ exitCode, timedOut: exitCode !== undefined && exitCode > 128, stdout: stdin, home, user, syntheticFs, schema, now });
  if (!argsValid) result.overall = 'BLOCKED_UNKNOWN';
  return formatReadback(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const chunks = []; let total = 0;
  process.stdin.on('data', c => { total += c.length; if (total <= MDM_LIMITS.maxBytes + 1) chunks.push(c); });
  process.stdin.on('end', () => {
    const stdin = total > MDM_LIMITS.maxBytes ? 'x'.repeat(MDM_LIMITS.maxBytes + 1) : Buffer.concat(chunks).toString('utf8');
    process.stdout.write(`${runMdmCli({ argv: process.argv.slice(2), stdin })}\n`);
  });
}
