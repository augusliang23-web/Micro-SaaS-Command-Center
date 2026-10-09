import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mdm from '../scripts/phase3b6bMdmReadbackNormalizer.mjs';

// SYNTHETIC FIXTURES ONLY: made-up text shapes. Nothing here runs sudo/profiles or reads the host; the normalizer has no filesystem access.
const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const SRC = fs.readFileSync(path.join(SCRIPTS, 'phase3b6bMdmReadbackNormalizer.mjs'), 'utf8');
const plist = body => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${body}</plist>`;
const entry = (id = 'com.example.SECRET-ID', name = 'SECRET-NAME') => `<dict><key>ProfileIdentifier</key><string>${id}</string><key>ProfileDisplayName</key><string>${name}</string></dict>`;
const VALID = plist(`<dict><key>_computerLevel</key><array>${entry()}</array></dict>`);
const DESC = Object.freeze({ inventoryKey: '_computerLevel', entryRequiredKeys: ['ProfileIdentifier', 'ProfileDisplayName'], allowedOtherRootKeys: [], emptyInventoryIsComplete: false });
const HOME = '/Users/t';
const synthFs = () => mdm.createSyntheticFs({ dirs: ['/Library', '/Library/Application Support', '/Library/Managed Preferences', '/Users', HOME, `${HOME}/Library`, `${HOME}/.claude`] });
const norm = (stdout, over = {}) => mdm.normalizeMdmReadback({ exitCode: 0, stdout, home: HOME, user: 't', now: () => 0, ...over });
const fmt = stdout => mdm.diagnoseFormat(stdout);
const KEYS = ['size', 'lines', 'first', 'xml_decl', 'plist_open', 'plist_close', 'dict', 'leading_text', 'trailing_text', 'extracted_parses', 'non_text', 'phrase_no_profiles', 'phrase_error', 'phrase_usage', 'phrase_sudo', 'parse_reason', 'parse_at'];

const FIXTURES = {
  'valid XML plist': { text: VALID, cls: 'XML_PLIST_VALID' },
  'XML followed by status text': { text: `${VALID}\nProfiles listed: 1\n`, cls: 'XML_PLIST_WITH_TRAILING_TEXT', reason: 'TRAILING_CONTENT' },
  'status text then XML': { text: `Computer-level profiles:\n${VALID}\n`, cls: 'XML_PLIST_WITH_LEADING_TEXT', reason: 'LEADING_TEXT' },
  'status text on both sides': { text: `Header line\n${VALID}\nFooter line\n`, cls: 'XML_PLIST_WITH_LEADING_AND_TRAILING_TEXT' },
  'plain-text "no profiles" sentence': { text: 'There are no configuration profiles installed in the system domain\n', cls: 'PLAIN_TEXT', noProfiles: true },
  'plain-text short sentence': { text: 'No profiles installed.', cls: 'PLAIN_TEXT', noProfiles: true },
  'plain-text error': { text: 'profiles: Error: operation not permitted\n', cls: 'PLAIN_TEXT', errorWord: true },
  'plain-text usage': { text: 'Usage: profiles <command> [options]\nInvalid option -x\n', cls: 'PLAIN_TEXT', usageWord: true },
  'plain-text sudo/password': { text: 'Sorry, try again.\nsudo: a password is required\n', cls: 'PLAIN_TEXT', sudoWord: true },
  'empty inventory dict': { text: plist('<dict/>'), cls: 'XML_PLIST_VALID' },
  'empty computer-level array': { text: plist('<dict><key>_computerLevel</key><array/></dict>'), cls: 'XML_PLIST_VALID' },
  'user-name-only root': { text: plist('<dict><key>someuser</key><array/></dict>'), cls: 'XML_PLIST_VALID' },
  'truncated mid-document': { text: VALID.slice(0, Math.floor(VALID.length * 0.6)), cls: 'XML_PLIST_TRUNCATED', reason: 'TRUNCATED' },
  'truncated before the end tag': { text: VALID.replace('</plist>', ''), cls: 'XML_PLIST_TRUNCATED' },
  'truncated prolog only': { text: '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"', cls: 'XML_LIKE_OTHER' },
  'closing tag present, broken body': { text: plist('<dict><key>a</key></plist>'), cls: 'XML_PLIST_MALFORMED_BODY' },
  'bad entity in body': { text: plist('<dict><key>a</key><string>&nope;</string></dict>'), cls: 'XML_PLIST_MALFORMED_BODY', reason: 'BAD_ENTITY' },
  'duplicate key in body': { text: plist('<dict><key>a</key><true/><key>a</key><false/></dict>'), cls: 'XML_PLIST_MALFORMED_BODY', reason: 'DUPLICATE_KEY' },
  'unknown element in body': { text: plist('<dict><key>a</key><mystery/></dict>'), cls: 'XML_PLIST_MALFORMED_BODY', reason: 'UNKNOWN_ELEMENT' },
  'unsupported CDATA': { text: plist('<dict><key>a</key><string><![CDATA[x]]></string></dict>'), cls: 'XML_PLIST_MALFORMED_BODY', reason: 'CDATA_OR_DECL' },
  'depth bomb': { text: plist(`${'<array>'.repeat(60)}${'</array>'.repeat(60)}`), cls: 'XML_PLIST_MALFORMED_BODY', reason: 'LIMIT' },
  'XML-like but not a plist': { text: '<html><body>nope</body></html>', cls: 'XML_LIKE_OTHER' },
  'JSON-looking text': { text: '{"profiles": []}', cls: 'PLAIN_TEXT', first: 'BRACE' },
  'binary / control characters': { text: 'abc\u0000\u0001\u0002def', cls: 'BINARY_OR_NONTEXT' },
  'mojibake replacement characters': { text: '�'.repeat(50) + 'x', cls: 'BINARY_OR_NONTEXT' },
};

test('diagnosis distinguishes every synthetic output shape with a closed class and closed reason', () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    const d = fmt(f.text);
    assert.equal(d.formatClass, f.cls, `${name} → ${d.formatClass}`);
    if (f.reason) assert.equal(d.reason, f.reason, name);
    if (f.noProfiles) assert.equal(d.noProfiles, true, name);
    if (f.errorWord) assert.equal(d.errorWord, true, name);
    if (f.usageWord) assert.equal(d.usageWord, true, name);
    if (f.sudoWord) assert.equal(d.sudoWord, true, name);
    if (f.first) assert.equal(d.first, f.first, name);
  }
  assert.deepEqual([fmt('').formatClass, fmt(undefined).formatClass, fmt(null).formatClass, fmt(5).formatClass, fmt('x'.repeat(mdm.MDM_LIMITS.maxBytes + 1)).formatClass], ['EMPTY', 'NONE', 'NONE', 'NONE', 'TOO_LARGE']);
  for (const [name, text] of Object.entries({ trailing: FIXTURES['XML followed by status text'].text, leading: FIXTURES['status text then XML'].text })) {
    const d = fmt(text); assert.equal(d.extractedParses, true, name); assert.match(d.extractedFingerprint, /^ROOT=dict;ROOT_KEYS=1-4;COMPUTERLEVEL=array;SPELLING=DOCUMENTED;/, name);
  }
  assert.match(fmt(VALID).extractedFingerprint, /SPELLING=DOCUMENTED/); assert.equal(fmt(FIXTURES['plain-text "no profiles" sentence'].text).extractedFingerprint, 'NONE');
  assert.ok(['END', '75-100'].includes(fmt(FIXTURES['truncated mid-document'].text).at), 'a truncation is detected near the end of what was captured');
});

test('the reported Stage-1 facts (exit 0, PARTIAL, MALFORMED, ROOT=NONE) fit many shapes; the new FORMAT lines now tell them apart', () => {
  const sameFacts = ['XML followed by status text', 'status text then XML', 'plain-text "no profiles" sentence', 'plain-text error', 'truncated mid-document', 'closing tag present, broken body', 'JSON-looking text'];
  const classes = new Set();
  for (const name of sameFacts) {
    const r = norm(FIXTURES[name].text);
    assert.deepEqual([r.profilesExit, r.coverage, r.form, r.schema, r.claudeDomain, r.overall], ['0', 'PARTIAL', 'MALFORMED', 'ROOT=NONE', 'UNKNOWN', 'BLOCKED_REAL_HOST_MODE_DISABLED'], name);
    classes.add(mdm.formatReadback(r).split('\n').slice(9).join('|'));
  }
  assert.equal(classes.size, sameFacts.length, 'every one of these shapes has its own FORMAT_* signature');
  assert.ok(new Set(sameFacts.map(n => norm(FIXTURES[n].text).format.formatClass)).size >= 5);
});

test('RECORDING ONLY: the diagnosis never changes coverage, trust, domain verdict or the overall word — even a "no profiles" sentence or valid inner XML', () => {
  const schema = mdm.createSyntheticTestSchema(DESC);
  for (const [name, f] of Object.entries(FIXTURES)) for (const over of [{}, { schema, syntheticFs: synthFs() }]) {
    const r = norm(f.text, over);
    if (f.cls === 'XML_PLIST_VALID' && over.schema && name === 'valid XML plist') { assert.equal(r.overall, 'SYNTHETIC_ABSENCE_OBSERVED'); continue; }
    assert.notEqual(r.coverage, 'COMPLETE', name); assert.notEqual(r.claudeDomain, 'ABSENT', name); assert.notEqual(r.overall, 'SYNTHETIC_ABSENCE_OBSERVED', name); assert.notEqual(r.overall, 'CURRENT_ABSENCE_OBSERVED', name);
    assert.ok(r.overall.startsWith('BLOCKED_'), `${name}: ${r.overall}`);
  }
  const noProfiles = norm('There are no configuration profiles installed in the system domain\n', { schema, syntheticFs: synthFs() });
  assert.deepEqual([noProfiles.coverage, noProfiles.claudeDomain, noProfiles.overall, noProfiles.format.noProfiles], ['PARTIAL', 'UNKNOWN', 'BLOCKED_UNKNOWN', true], 'a "no profiles" sentence is not evidence of absence');
  for (const [a, b] of [['No profiles installed.', 'Something else entirely.'], ['no configuration profiles', 'a different sentence']]) {
    const x = norm(a, { schema, syntheticFs: synthFs() }); const y = norm(b, { schema, syntheticFs: synthFs() });
    assert.deepEqual([x.coverage, x.claudeDomain, x.overall, x.form], [y.coverage, y.claudeDomain, y.overall, y.form], 'the phrase flag changes nothing');
  }
  for (const text of [FIXTURES['XML followed by status text'].text, FIXTURES['status text then XML'].text]) { const r = norm(text, { schema, syntheticFs: synthFs() }); assert.equal(r.coverage, 'PARTIAL'); assert.equal(r.form, 'MALFORMED'); assert.notEqual(r.overall, 'SYNTHETIC_ABSENCE_OBSERVED'); }
  assert.deepEqual((SRC.match(/out\.format/g) ?? []).length, 1, 'the decision code only ASSIGNS the diagnosis; it never reads it');
  assert.equal(/\.format\./.test(SRC.slice(SRC.indexOf('// ---- decision'), SRC.indexOf('export function formatReadback'))), false);
});

test('empty-inventory shapes stay unreviewed: well-formed, diagnosed XML_PLIST_VALID, never complete without an explicit synthetic rule, never a real success', () => {
  const schema = mdm.createSyntheticTestSchema(DESC);
  for (const name of ['empty inventory dict', 'empty computer-level array', 'user-name-only root']) {
    const r = norm(FIXTURES[name].text, { schema, syntheticFs: synthFs() });
    assert.equal(r.format.formatClass, 'XML_PLIST_VALID'); assert.equal(r.coverage, 'PARTIAL', name); assert.notEqual(r.overall, 'SYNTHETIC_ABSENCE_OBSERVED', name);
    assert.notEqual(norm(FIXTURES[name].text).overall, 'CURRENT_ABSENCE_OBSERVED');
  }
  assert.equal(norm(FIXTURES['empty computer-level array'].text, { schema: mdm.createSyntheticTestSchema({ ...DESC, emptyInventoryIsComplete: true }), syntheticFs: synthFs() }).overall, 'SYNTHETIC_ABSENCE_OBSERVED');
});

test('uncertain results stay BLOCKED: a mention of the Claude domain still blocks as PRESENT, whatever the format class', () => {
  const d = 'com.anthropic.claudecode';
  for (const text of [`status ${d} text`, `${VALID}\n${d}\n`, plist(`<dict><key>${d}</key><true/></dict>`), `profiles: error ${d}`]) {
    const r = norm(text); assert.equal(r.claudeDomain, 'PRESENT'); assert.equal(r.overall, 'BLOCKED_PRESENT');
  }
  for (const exitCode of [1, 142, undefined]) assert.equal(norm(VALID, { exitCode }).coverage, 'FAILED');
});

test('sanitization: the diagnosis lines are closed-vocabulary — no raw text, names, ids, paths, keys or line contents ever appear', () => {
  const sentinels = ['SECRET-ID', 'SECRET-NAME', 'com.example', '/Users/someone', 'hunter2', 'someuser', 'Footer line', 'Header line', 'Profiles listed', 'try again'];
  const vocab = /^(RUN_UTC|PROFILES_EXIT|COVERAGE|CLAUDE_DOMAIN|MANAGED_FILES|SCHEMA_FINGERPRINT|SCHEMA_TRUST|HOST_MODE|OVERALL|FORMAT_CLASS|FORMAT_DETAIL|EXTRACTED_FINGERPRINT)=[A-Za-z0-9_:;=\-(). <>/+]+$/;
  for (const [name, f] of Object.entries(FIXTURES)) {
    const text = mdm.formatReadback(norm(`${f.text}\nhunter2 /Users/someone`));
    const lines = text.split('\n'); assert.equal(lines.length, 12, name);
    for (const line of lines) assert.match(line, vocab, `${name}: ${line}`);
    for (const s of sentinels) assert.equal(text.includes(s), false, `${name} leaked ${s}`);
    const detail = lines.find(l => l.startsWith('FORMAT_DETAIL=')).slice('FORMAT_DETAIL='.length).split(';');
    assert.deepEqual(detail.map(x => x.split('=')[0]), KEYS, name);
    assert.ok(/^FORMAT_CLASS=[A-Z_]+$/.test(lines.find(l => l.startsWith('FORMAT_CLASS='))));
  }
  const d = fmt('x'.repeat(5000)); assert.equal(d.size, '<=64K'); assert.deepEqual(Object.keys(d).sort(), ['at', 'dict', 'errorWord', 'extractedFingerprint', 'extractedParses', 'first', 'formatClass', 'leading', 'lines', 'noProfiles', 'nonText', 'plistClose', 'plistOpen', 'reason', 'size', 'sudoWord', 'trailing', 'usageWord', 'xmlDecl']);
});

test('parser failure reasons are a closed set and parsing behaviour is unchanged (still strict)', () => {
  const reasons = new Set(); for (const f of Object.values(FIXTURES)) { const p = mdm.parsePlistXml(f.text); if (!p.ok) reasons.add(p.reason); }
  const allowed = new Set(['INVALID_INPUT', 'UNTERMINATED_COMMENT', 'UNTERMINATED_DECL', 'DOCTYPE_SUBSET', 'LEADING_TEXT', 'STRAY_TEXT', 'TRUNCATED', 'CDATA_OR_DECL', 'BAD_TAG', 'LIMIT', 'UNEXPECTED_TAG', 'MISMATCHED_CLOSE', 'BAD_SCALAR', 'BAD_DICT', 'DUPLICATE_KEY', 'UNKNOWN_ELEMENT', 'NOT_PLIST_ROOT', 'BAD_TAIL', 'TRAILING_CONTENT', 'BAD_ENTITY', 'UNKNOWN']);
  for (const r of reasons) assert.ok(allowed.has(r), r); assert.ok(reasons.size >= 6);
  assert.equal(mdm.parsePlistXml(VALID).ok, true); assert.equal(mdm.parsePlistXml(`${VALID}\ntext`).ok, false); assert.equal(mdm.parsePlistXml(`text\n${VALID}`).ok, false);
  assert.deepEqual(mdm.parsePlistXml('').reason, 'INVALID_INPUT'); assert.equal(mdm.parsePlistXml(5).ok, false);
  assert.equal(mdm.parsePlistXml(plist('<dict><key>a</key><date>2024-01-01T00:00:00Z</date></dict>')).ok, true);
  assert.equal(mdm.parsePlistXml(plist('<dict><key>a</key><date>yesterday</date></dict>')).reason, 'BAD_SCALAR');
  assert.equal(/\.reason|\.at\b/.test(SRC.slice(SRC.indexOf('// ---- decision'), SRC.indexOf('export function formatReadback'))), false, 'decision code does not read failure reasons');
});

const nodeMajor = Number(process.versions.node.split('.')[0]);
test('the command line prints the twelve diagnosis lines for plain-text and XML-with-status output under a no-filesystem sandbox, and stays BLOCKED', { skip: nodeMajor < 20 ? 'permission model unavailable' : false }, () => {
  const flags = nodeMajor >= 22 ? ['--permission'] : ['--experimental-permission'];
  const sandbox = input => spawnSync(process.execPath, [...flags, `--allow-fs-read=${SCRIPTS}`, path.join(SCRIPTS, 'phase3b6bMdmReadbackNormalizer.mjs'), '--rc=0'], { input, encoding: 'utf8', shell: false, env: { PATH: '/usr/bin:/bin' } });
  for (const [name, text, cls] of [['plain text', 'There are no configuration profiles installed\n', 'PLAIN_TEXT'], ['xml + trailing', `${VALID}\nsome status\n`, 'XML_PLIST_WITH_TRAILING_TEXT'], ['valid', VALID, 'XML_PLIST_VALID']]) {
    const r = sandbox(text); assert.equal(r.status, 0, r.stderr); const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 12, name); assert.ok(lines.includes(`FORMAT_CLASS=${cls}`), `${name}: ${r.stdout}`); assert.ok(lines.some(l => l.startsWith('OVERALL=BLOCKED_')), name);
    assert.ok(lines.includes('MANAGED_FILES=NOT_INSPECTED') && lines.includes('HOST_MODE=DISABLED') && lines.includes('SCHEMA_TRUST=NONE'));
    assert.doesNotMatch(r.stdout, /SECRET|some status|configuration profiles installed/);
  }
});
