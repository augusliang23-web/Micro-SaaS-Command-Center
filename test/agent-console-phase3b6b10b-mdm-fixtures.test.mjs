import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as mdm from '../scripts/phase3b6bMdmReadbackNormalizer.mjs';

// SYNTHETIC FIXTURES ONLY. Nothing here runs sudo, profiles or any Claude command; the "filesystem" is an in-memory fake.
const SRC = fs.readFileSync(fileURLToPath(new URL('../scripts/phase3b6bMdmReadbackNormalizer.mjs', import.meta.url)), 'utf8');
const HOME = '/Users/tester'; const USER = 'tester';
const NOW = () => Date.parse('2026-10-09T01:02:03Z');
const SCHEMA = Object.freeze({ reviewId: 1, inventoryKey: '_computerlevel', entryRequiredKeys: ['ProfileIdentifier', 'ProfileDisplayName'], allowedOtherRootKeys: [], emptyInventoryIsComplete: false });
const plist = body => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${body}</plist>\n`;
const entry = (id = 'com.example.wifi', name = 'Wi-Fi') => `<dict><key>ProfileIdentifier</key><string>${id}</string><key>ProfileDisplayName</key><string>${name}</string></dict>`;
const inventory = (...entries) => plist(`<dict><key>_computerlevel</key><array>${entries.join('')}</array></dict>`);
const COMPLETE = inventory(entry());

function fakeFs({ dirs = [], files = [], symlinks = [], errors = {} } = {}) {
  const base = ['/Library', '/Library/Application Support', '/Library/Managed Preferences', '/Users', HOME, `${HOME}/Library`, `${HOME}/.claude`];
  const D = new Set([...base, ...dirs]); const F = new Set(files); const L = new Set(symlinks);
  return { lstatSync(p) {
    if (Object.hasOwn(errors, p)) throw Object.assign(new Error(`synthetic ${errors[p]}`), { code: errors[p] });
    const kind = L.has(p) ? 'link' : D.has(p) ? 'dir' : F.has(p) ? 'file' : null;
    if (!kind) throw Object.assign(new Error('synthetic ENOENT'), { code: 'ENOENT' });
    return { isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'dir' };
  } };
}
const run = (over = {}) => mdm.normalizeMdmReadback({ exitCode: 0, stdout: COMPLETE, home: HOME, user: USER, fsApi: fakeFs(), qualifiedSchema: SCHEMA, now: NOW, ...over });
const POLICY = mdm.policyPaths({ home: HOME, user: USER });
const PASS = 'CURRENT_ABSENCE_OBSERVED';

test('synthetic complete inventory with a reviewed schema and clean metadata is the ONLY path to CURRENT_ABSENCE_OBSERVED', () => {
  const r = run();
  assert.deepEqual([r.overall, r.coverage, r.claudeDomain, r.managedFiles, r.profilesExit, r.runUtc], [PASS, 'COMPLETE', 'ABSENT', 'ABSENT', '0', '2026-10-09T01:02:03Z']);
  assert.equal(run({ stdout: inventory(entry(), entry('com.example.vpn', 'VPN')) }).overall, PASS);
});

test('without a reviewed schema even a perfect inventory cannot PASS: valid XML proves syntax, not device-wide completeness', () => {
  for (const qualifiedSchema of [undefined, null, {}, { ...SCHEMA, reviewId: undefined }, { ...SCHEMA, reviewId: 0 }, { ...SCHEMA, reviewId: '1' }, { ...SCHEMA, inventoryKey: '' }, { ...SCHEMA, emptyInventoryIsComplete: 'yes' }, { ...SCHEMA, entryRequiredKeys: 'x' }]) {
    const r = run({ qualifiedSchema });
    assert.equal(r.overall, 'BLOCKED_SCHEMA_UNQUALIFIED', JSON.stringify(qualifiedSchema)); assert.equal(r.coverage, 'UNQUALIFIED'); assert.notEqual(r.claudeDomain, 'ABSENT');
  }
  assert.match(run({ qualifiedSchema: undefined }).schema, /^ROOT=dict;ROOT_KEYS=1-4;COMPUTERLEVEL=array;ENTRIES=1-4;ENTRIES_ALL_DICT=true;ENTRIES_HAVE_PROFILEIDENTIFIER=true$/);
});

test('well-formed but semantically partial or unrecognised inventories are PARTIAL and never PASS', () => {
  const cases = {
    'extra root key': plist(`<dict><key>_computerlevel</key><array>${entry()}</array><key>_userlevel</key><array/></dict>`),
    'entry missing a required key': inventory('<dict><key>ProfileIdentifier</key><string>x</string></dict>'),
    'entry is a string': inventory('<string>profile</string>'), 'inventory is a dict': plist('<dict><key>_computerlevel</key><dict/></dict>'),
    'inventory key missing': plist('<dict><key>other</key><array/></dict>'), 'empty inventory (unreviewed meaning)': inventory(),
    'root is an array': plist('<array/>'), 'root is a string': plist('<string>There are no configuration profiles installed</string>'), 'empty root dict': plist('<dict/>'),
    'mixed entries': inventory(entry(), '<integer>1</integer>'),
  };
  for (const [name, stdout] of Object.entries(cases)) { const r = run({ stdout }); assert.equal(r.coverage, 'PARTIAL', name); assert.notEqual(r.overall, PASS, name); assert.notEqual(r.claudeDomain, 'ABSENT', name); }
  assert.equal(run({ stdout: inventory(), qualifiedSchema: { ...SCHEMA, emptyInventoryIsComplete: true } }).overall, PASS, 'only an explicitly reviewed empty-inventory rule makes empty complete (synthetic)');
});

test('malformed XML, truncation and hostile structure are rejected', () => {
  const bad = ['', '   ', 'not xml at all', '<plist version="1.0"><dict>', COMPLETE.slice(0, COMPLETE.length - 12), COMPLETE.replace('</array>', ''), COMPLETE.replace('<key>_computerlevel</key>', '<key>_computerlevel</key><key>again</key>'),
    plist('<dict><key>a</key><string>x</string><key>a</key><string>y</string></dict>'), plist('<dict><key>a</key><string>&bogus;</string></dict>'), plist('<dict><key>a</key><string>&#0;</string></dict>'),
    plist('<dict><key>a</key><string><![CDATA[x]]></string></dict>'), plist('<dict><key>a</key><integer>12x</integer></dict>'), plist('<dict><key>a</key><data>!!!</data></dict>'),
    plist('<dict><key>a</key><date>yesterday</date></dict>'), plist('<dict><key>a</key><mystery/></dict>'), plist('<dict><key a="1">a</key><string/></dict>'),
    '<?xml version="1.0"?><!DOCTYPE plist [<!ENTITY x "y">]><plist version="1.0"><dict/></plist>', COMPLETE + '<extra/>', 'junk' + COMPLETE, COMPLETE.replace('<plist version="1.0">', '<plist version="2.0">'),
    '<plist version="1.0"><dict></dict></plist><plist version="1.0"><dict/></plist>', `${'<array>'.repeat(40)}${'</array>'.repeat(40)}`, plist(`${'<array>'.repeat(40)}${'</array>'.repeat(40)}`), 'a\0b'];
  for (const stdout of bad) { const r = mdm.parsePlistXml(stdout); assert.equal(r.ok, false, JSON.stringify(stdout.slice(0, 50))); const n = run({ stdout }); assert.notEqual(n.overall, PASS); assert.notEqual(n.coverage, 'COMPLETE'); }
  assert.equal(mdm.parsePlistXml(COMPLETE).ok, true); assert.equal(mdm.parsePlistXml(plist('<dict><key>a</key><string>a &amp; &lt;b&gt; &#65; &#x42;</string></dict>')).ok, true);
});

test('empty, missing, non-string and oversized output are never complete', () => {
  for (const stdout of ['', undefined, null, 42, {}, [], 'x'.repeat(mdm.MDM_LIMITS.maxBytes + 1)]) {
    const r = run({ stdout }); assert.notEqual(r.overall, PASS); assert.notEqual(r.coverage, 'COMPLETE'); assert.ok(['EMPTY', 'NONE', 'TOO_LARGE'].includes(r.form), String(r.form));
  }
});

test('permission denied, non-zero exit, missing status, timeout and signals are FAILED even with a complete-looking inventory', () => {
  for (const [name, over] of Object.entries({
    'exit 1': { exitCode: 1 }, 'exit 2': { exitCode: 2 }, 'sudo auth failure text': { exitCode: 1, stdout: 'Sorry, try again.\nsudo: 3 incorrect password attempts' },
    'profiles permission text rc 0': { stdout: 'profiles: Operation not permitted; permission denied' }, 'timeout rc 142': { exitCode: 142 }, 'killed 137': { exitCode: 137 },
    'timedOut flag': { timedOut: true }, 'signal': { signal: 'SIGTERM' }, 'undefined status': { exitCode: undefined }, 'null status': { exitCode: null }, 'string zero': { exitCode: '0' },
    'NaN': { exitCode: Number.NaN }, 'negative': { exitCode: -1 },
  })) { const r = run(over); assert.notEqual(r.overall, PASS, name); if (['exitCode', 'timedOut', 'signal'].some(k => k in over)) assert.equal(r.coverage, 'FAILED', name); else assert.equal(r.coverage, 'PARTIAL', name); }
  assert.equal(run({ exitCode: 1 }).profilesExit, '1'); assert.equal(run({ exitCode: undefined }).profilesExit, 'NONE');
});

test('a Claude managed domain anywhere in the inventory is PRESENT (conservative), in keys, values, nesting, case variants and data blobs', () => {
  const d = 'com.anthropic.claudecode';
  const utf16le = Buffer.from(d, 'utf16le').toString('base64'); const utf16be = Buffer.from(d, 'utf16le').swap16().toString('base64'); const latin = Buffer.from(`xx${d}yy`).toString('base64');
  const cases = { 'profile id': inventory(entry(d, 'Policy')), 'display name': inventory(entry('a', d)), 'upper case': inventory(entry(d.toUpperCase(), 'P')), 'nested payload key': plist(`<dict><key>_computerlevel</key><array><dict><key>ProfileIdentifier</key><string>p</string><key>ProfileDisplayName</key><string>n</string><key>PayloadContent</key><array><dict><key>${d}</key><dict/></dict></array></dict></array></dict>`),
    'utf16le data': inventory(`<dict><key>ProfileIdentifier</key><string>p</string><key>ProfileDisplayName</key><string>n</string><key>blob</key><data>${utf16le}</data></dict>`),
    'utf16be data': inventory(`<dict><key>ProfileIdentifier</key><string>p</string><key>ProfileDisplayName</key><string>n</string><key>blob</key><data>${utf16be}</data></dict>`),
    'latin1 data': inventory(`<dict><key>ProfileIdentifier</key><string>p</string><key>ProfileDisplayName</key><string>n</string><key>blob</key><data>${latin}</data></dict>`) };
  for (const [name, stdout] of Object.entries(cases)) { const r = run({ stdout }); assert.deepEqual([r.claudeDomain, r.overall], ['PRESENT', 'BLOCKED_PRESENT'], name); }
  for (const stdout of [`garbage ${d} garbage`, `<plist><dict>${d}`]) { const r = run({ stdout, exitCode: 1 }); assert.equal(r.claudeDomain, 'PRESENT', 'even a failed or malformed output that names the domain blocks'); }
  assert.equal(run({ qualifiedSchema: undefined, stdout: inventory(entry(d, 'x')) }).overall, 'BLOCKED_PRESENT');
});

test('domain absent is claimed only with nothing else suspicious: other Anthropic references and opaque nested payloads are UNKNOWN', () => {
  assert.equal(run({ stdout: inventory(entry('com.anthropic.claudefordesktop', 'Desktop')) }).claudeDomain, 'UNKNOWN');
  assert.equal(run({ stdout: inventory(entry('com.example.x', 'Made by Anthropic PBC')) }).overall, 'BLOCKED_UNKNOWN');
  const nested = Buffer.from('bplist00....').toString('base64'); const xml = Buffer.from('<?xml version="1.0"?><plist/>').toString('base64');
  for (const blob of [nested, xml]) assert.equal(run({ stdout: inventory(`<dict><key>ProfileIdentifier</key><string>p</string><key>ProfileDisplayName</key><string>n</string><key>b</key><data>${blob}</data></dict>`) }).overall, 'BLOCKED_UNKNOWN');
  const cert = Buffer.from([0x30, 0x82, 0x01, 0x0a, 0x02, 0x82]).toString('base64');
  assert.equal(run({ stdout: inventory(`<dict><key>ProfileIdentifier</key><string>p</string><key>ProfileDisplayName</key><string>n</string><key>cert</key><data>${cert}</data></dict>`) }).overall, PASS, 'an ordinary binary blob alone does not block (synthetic)');
});

test('contradictory evidence (readback says absent, a policy source exists) is BLOCKED_CONTRADICTORY for every source', () => {
  for (const target of POLICY) {
    const parent = target.slice(0, target.lastIndexOf('/'));
    const dirs = []; for (let p = parent; p.length > 1; p = p.slice(0, p.lastIndexOf('/')) || '/') dirs.push(p);
    const r = run({ fsApi: fakeFs({ dirs, files: [target] }) });
    assert.deepEqual([r.claudeDomain, r.managedFiles, r.overall], ['ABSENT', 'PRESENT', 'BLOCKED_CONTRADICTORY'], target);
  }
  const unknownDomain = run({ stdout: inventory(entry('com.anthropic.other', 'x')), fsApi: fakeFs({ dirs: ['/Library/Application Support/ClaudeCode'], files: [POLICY[0]] }) });
  assert.equal(unknownDomain.overall, 'BLOCKED_PRESENT');
});

test('symlinked policy files, dangling links and symlinked or non-directory ancestors are never ABSENT', () => {
  const tgt = POLICY[0];
  const present = run({ fsApi: fakeFs({ dirs: ['/Library/Application Support/ClaudeCode'], symlinks: [tgt] }) });
  assert.deepEqual([present.managedFiles, present.overall], ['PRESENT', 'BLOCKED_CONTRADICTORY'], 'a symlink (even dangling) at the policy path counts as present');
  assert.deepEqual(mdm.inspectPolicyPath(tgt, fakeFs({ dirs: ['/Library/Application Support/ClaudeCode'], symlinks: [tgt] })), { state: 'PRESENT', reason: 'SYMLINK' });
  const ancestorLink = fakeFs({ symlinks: ['/Library/Application Support/ClaudeCode'] });
  assert.deepEqual(mdm.inspectPolicyPath(tgt, ancestorLink), { state: 'UNKNOWN', reason: 'SYMLINK_ANCESTOR' });
  assert.equal(run({ fsApi: ancestorLink }).overall, 'BLOCKED_UNKNOWN');
  assert.deepEqual(mdm.inspectPolicyPath(tgt, fakeFs({ files: ['/Library/Application Support/ClaudeCode'] })), { state: 'UNKNOWN', reason: 'NOT_DIRECTORY_ANCESTOR' });
  assert.equal(run({ fsApi: fakeFs({ symlinks: [HOME] }) }).overall, 'BLOCKED_UNKNOWN', 'a symlinked home directory');
  assert.equal(run({ fsApi: fakeFs({ symlinks: ['/Library'] }) }).overall, 'BLOCKED_UNKNOWN', 'a symlinked top-level ancestor');
  assert.equal(mdm.inspectPolicyPath(tgt, fakeFs()).state, 'ABSENT');
});

test('unreadable paths and unexpected filesystem errors are UNKNOWN, not absent', () => {
  for (const code of ['EACCES', 'EPERM', 'EIO', 'ELOOP', 'ENOTDIR', 'ETIMEDOUT', undefined]) {
    for (const target of [POLICY[0], POLICY[3], POLICY[6]]) {
      const r = run({ fsApi: fakeFs({ dirs: ['/Library/Application Support/ClaudeCode'], errors: { [target]: code } }) });
      assert.equal(r.managedFiles, 'UNKNOWN', `${code} ${target}`); assert.notEqual(r.overall, PASS);
    }
  }
  const throwing = { lstatSync: () => { throw 'a string, not an Error'; } };
  assert.equal(run({ fsApi: throwing }).overall, 'BLOCKED_UNKNOWN');
  const weird = { lstatSync: () => ({ isSymbolicLink: () => { throw new Error('x'); }, isDirectory: () => true }) };
  assert.notEqual(run({ fsApi: weird }).overall, PASS);
  for (const p of ['relative/path', '/a/../b', '', '/a//b', '/a/\0b', undefined, null]) assert.equal(mdm.inspectPolicyPath(p, fakeFs()).state, 'UNKNOWN', String(p));
  assert.equal(mdm.inspectPolicyPath('/Library/Managed Preferences/x', { lstatSync: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } }).state, 'UNKNOWN');
});

test('output is closed-vocabulary: no profile names, ids, secrets, paths or keys leak; the schema fingerprint names only fixed words', () => {
  const secretProfile = inventory(entry('com.secret.corp.vpn', 'CEO-WIFI-PASSWORD-hunter2'));
  const r = run({ stdout: secretProfile, qualifiedSchema: undefined });
  const text = mdm.formatReadback(r);
  for (const leak of ['secret', 'hunter2', 'CEO', 'corp', 'wifi', HOME, 'Library', '/Users']) assert.equal(text.toLowerCase().includes(leak.toLowerCase()), false, leak);
  assert.equal(text.split('\n').length, 7);
  for (const line of text.split('\n')) assert.match(line, /^(RUN_UTC|PROFILES_EXIT|COVERAGE|CLAUDE_DOMAIN|MANAGED_FILES|SCHEMA_FINGERPRINT|OVERALL)=[A-Za-z0-9_:;=\-(). ]+$/);
  assert.equal(mdm.schemaFingerprint(mdm.parsePlistXml(plist('<dict><key>my-secret-key</key><string>v</string></dict>'))).includes('secret'), false);
  assert.equal(mdm.schemaFingerprint({ ok: false }), 'ROOT=NONE');
});

test('the command-line adapter never supplies a schema, requires exactly one valid --rc and cannot reach PASS', () => {
  const cli = (argv, stdin = COMPLETE) => mdm.runMdmCli({ argv, stdin, fsApi: fakeFs(), home: HOME, user: USER, now: NOW });
  assert.match(cli(['--rc=0']), /OVERALL=BLOCKED_SCHEMA_UNQUALIFIED/);
  for (const argv of [[], ['--rc='], ['--rc=abc'], ['--rc=0', '--rc=0'], ['--rc=0.5'], ['--rc=99999'], ['--schema={"reviewId":1}'], ['rc=0']]) assert.doesNotMatch(cli(argv), /OVERALL=(CURRENT_ABSENCE_OBSERVED)/, JSON.stringify(argv));
  assert.match(cli([]), /PROFILES_EXIT=NONE/); assert.match(cli(['--rc=142']), /COVERAGE=FAILED/); assert.match(cli(['--rc=1']), /PROFILES_EXIT=1/);
  assert.equal(/qualifiedSchema\s*[:=]\s*(?!input)/.test(SRC.slice(SRC.indexOf('export function runMdmCli'))), false, 'runMdmCli passes no schema');
});

test('the helper never throws on hostile input and the false-PASS matrix never produces PASS', () => {
  const hostile = [undefined, null, 5, 'x', [], { get exitCode() { throw new Error('g'); } }, { exitCode: 0, get stdout() { throw new Error('g'); } }, { exitCode: 0, stdout: COMPLETE, home: undefined, user: undefined }, { exitCode: 0, stdout: COMPLETE, fsApi: null, home: HOME, user: USER }];
  for (const input of hostile) { let r; assert.doesNotThrow(() => { r = mdm.normalizeMdmReadback(input); }); assert.notEqual(r.overall, PASS); }
  let passes = 0; const stdouts = [COMPLETE, inventory(), '', 'x', plist('<dict/>'), inventory(entry('com.anthropic.claudecode', 'x'))];
  const fsVariants = [fakeFs(), fakeFs({ symlinks: ['/Library'] }), fakeFs({ errors: { [POLICY[2]]: 'EIO' } }), fakeFs({ dirs: ['/Library/Application Support/ClaudeCode'], files: [POLICY[2]] })];
  for (const stdout of stdouts) for (const exitCode of [0, 1, 142, undefined]) for (const qualifiedSchema of [SCHEMA, undefined]) for (const fsApi of fsVariants) if (run({ stdout, exitCode, qualifiedSchema, fsApi }).overall === PASS) passes += 1;
  assert.equal(passes, 2, 'the only PASS combinations are the synthetic complete inventories with exit 0, a reviewed schema and a clean fake filesystem');
});

test('the helper has no process-launching code, no network and no environment-driven schema (it cannot run sudo or profiles)', () => {
  for (const pattern of [/child_process/, /\bspawn(Sync)?\s*\(/, /\bexecFile(Sync)?\s*\(/, /\bexecSync\s*\(/, /node:(http|https|net|dgram)/, /\bfetch\s*\(/, /process\.env/]) assert.equal(pattern.test(SRC), false, String(pattern));
  assert.equal(/\/usr\/bin\/(sudo|profiles)/.test(SRC), false);
});
