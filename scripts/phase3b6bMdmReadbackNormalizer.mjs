// Phase 3B6B.10B: pure, offline-testable normalizer for the PROPOSED human MDM readback (not authorized to run).
//
// It never runs `sudo` or `profiles`. A human would capture the command's own exit status and its stdout in memory and hand both to this
// helper, which prints only a closed vocabulary of normalized words. Rules that matter:
//   * A well-formed XML plist proves SYNTAX only. Whether it is a COMPLETE device-wide inventory depends on the exact output schema of
//     `profiles show -all`, which has never been reviewed. So coverage can only be COMPLETE when the caller supplies a `qualifiedSchema`
//     that carries an independent review id. The real command-line entry supplies none, therefore the real result can never be
//     CURRENT_ABSENCE_OBSERVED today: the best it can say is BLOCKED_SCHEMA_UNQUALIFIED, plus a harmless schema fingerprint to review.
//   * Presence is conservative (any mention of the Claude domain, anywhere, blocks); absence needs complete coverage and nothing opaque.
//   * Policy-file checks use lstat on every ancestor; a symlinked or non-directory ancestor, an unreadable path or any unexpected error is UNKNOWN.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

/** Closed-vocabulary schema fingerprint for human/Control Plane review. Reveals no key names beyond two fixed schema names, and no values. */
export function schemaFingerprint(parsed) {
  if (!parsed?.ok) return 'ROOT=NONE';
  const bucket = n => (n === 0 ? '0' : n <= 4 ? '1-4' : n <= 16 ? '5-16' : '17+');
  const root = parsed.root; const parts = [`ROOT=${root.t}`];
  if (root.t === 'dict') {
    parts.push(`ROOT_KEYS=${bucket(root.entries.length)}`);
    const inv = root.entries.find(([k]) => k === '_computerlevel')?.[1];
    parts.push(`COMPUTERLEVEL=${inv ? inv.t : 'ABSENT'}`);
    if (inv?.t === 'array') {
      parts.push(`ENTRIES=${bucket(inv.items.length)}`, `ENTRIES_ALL_DICT=${inv.items.every(i => i.t === 'dict')}`,
        `ENTRIES_HAVE_PROFILEIDENTIFIER=${inv.items.length > 0 && inv.items.every(i => i.t === 'dict' && i.entries.some(([k]) => k === 'ProfileIdentifier'))}`);
    }
  }
  return parts.join(';');
}

function qualified(schema) {
  return isRecord(schema) && Number.isInteger(schema.reviewId) && schema.reviewId > 0 && typeof schema.inventoryKey === 'string' && schema.inventoryKey !== '' &&
    Array.isArray(schema.entryRequiredKeys) && schema.entryRequiredKeys.every(k => typeof k === 'string' && k !== '') &&
    Array.isArray(schema.allowedOtherRootKeys) && schema.allowedOtherRootKeys.every(k => typeof k === 'string') && typeof schema.emptyInventoryIsComplete === 'boolean';
}

function evaluateCoverage(parsed, schema) {
  if (!parsed.ok) return { coverage: 'PARTIAL', form: 'MALFORMED' };
  if (!qualified(schema)) return { coverage: 'UNQUALIFIED', form: 'XML_PLIST' };
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

// ---- policy-file inspection (symlink / ancestor safe) -------------------------------------------------------------------------
export function policyPaths({ home, user }) {
  return [
    '/Library/Application Support/ClaudeCode/managed-settings.json', '/Library/Application Support/ClaudeCode/managed-settings.d',
    '/Library/Application Support/ClaudeCode/managed-mcp.json', '/Library/Managed Preferences/com.anthropic.claudecode.plist',
    `/Library/Managed Preferences/${user}/com.anthropic.claudecode.plist`, path.join(home, 'Library/Managed Preferences/com.anthropic.claudecode.plist'),
    path.join(home, '.claude/remote-settings.json'),
  ];
}
export function inspectPolicyPath(target, fsApi = fs) {
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
 * @param {{ exitCode: unknown, signal?: unknown, timedOut?: boolean, stdout: unknown, home: string, user: string, fsApi?: object, qualifiedSchema?: object, now?: () => number }} input
 * Never throws; every failure is a BLOCKED word.
 */
export function normalizeMdmReadback(input) {
  const out = { runUtc: 'UNKNOWN', profilesExit: 'NONE', coverage: 'FAILED', form: 'NONE', claudeDomain: 'UNKNOWN', managedFiles: 'UNKNOWN', domainScan: 'UNSCANNABLE', schema: 'ROOT=NONE', overall: 'BLOCKED_UNKNOWN' };
  try {
    try { out.runUtc = new Date((input.now ?? Date.now)()).toISOString().replace(/\.\d+Z$/, 'Z'); } catch { out.runUtc = 'UNKNOWN'; }
    // Policy files (metadata only).
    const states = policyPaths({ home: input.home, user: input.user }).map(p => inspectPolicyPath(p, input.fsApi ?? fs).state);
    out.managedFiles = states.includes('PRESENT') ? 'PRESENT' : states.every(s => s === 'ABSENT') ? 'ABSENT' : 'UNKNOWN';
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
    else { const c = evaluateCoverage(parsed, input.qualifiedSchema); out.coverage = c.coverage; if (c.form !== 'XML_PLIST') out.form = c.form; }
    if (scan.domain) out.claudeDomain = 'PRESENT';
    else if (out.coverage === 'COMPLETE' && out.domainScan === 'SCANNED' && !scan.reference && !scan.opaque) out.claudeDomain = 'ABSENT';
    else out.claudeDomain = 'UNKNOWN';
    if (out.claudeDomain === 'PRESENT') out.overall = 'BLOCKED_PRESENT';
    else if (out.managedFiles === 'PRESENT') out.overall = out.claudeDomain === 'ABSENT' ? 'BLOCKED_CONTRADICTORY' : 'BLOCKED_PRESENT';
    else if (out.coverage === 'UNQUALIFIED' && out.managedFiles === 'ABSENT' && statusOk) out.overall = 'BLOCKED_SCHEMA_UNQUALIFIED';
    else if (out.coverage === 'COMPLETE' && out.claudeDomain === 'ABSENT' && out.managedFiles === 'ABSENT') out.overall = 'CURRENT_ABSENCE_OBSERVED';
    else out.overall = 'BLOCKED_UNKNOWN';
  } catch { out.overall = 'BLOCKED_UNKNOWN'; }
  return out;
}

export function formatReadback(r) {
  return [`RUN_UTC=${r.runUtc}`, `PROFILES_EXIT=${r.profilesExit}`, `COVERAGE=${r.coverage} (form=${r.form})`, `CLAUDE_DOMAIN=${r.claudeDomain} (scan=${r.domainScan})`,
    `MANAGED_FILES=${r.managedFiles}`, `SCHEMA_FINGERPRINT=${r.schema}`, `OVERALL=${r.overall}`].join('\n');
}

/** Thin command-line adapter: `print -rn -- "$raw" | node <this file> --rc="$rc"`. No qualified schema is supplied here. */
export function runMdmCli({ argv, stdin, fsApi = fs, home = os.homedir(), user = os.userInfo().username, now = Date.now }) {
  const args = argv.filter(a => a.startsWith('--rc='));
  const rcText = args.length === 1 ? args[0].slice(5) : '';
  const exitCode = /^-?\d{1,4}$/.test(rcText) ? Number(rcText) : undefined;
  const result = normalizeMdmReadback({ exitCode, timedOut: exitCode !== undefined && exitCode > 128, stdout: stdin, home, user, fsApi, now });
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
