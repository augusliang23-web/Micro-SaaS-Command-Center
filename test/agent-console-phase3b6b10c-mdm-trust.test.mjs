import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mdm from '../scripts/phase3b6bMdmReadbackNormalizer.mjs';
import * as smoke from '../scripts/phase3b6bOneCallSmoke.mjs';
import * as threeCall from '../scripts/phase3b6bSyntheticNegativeQualification.mjs';

// SYNTHETIC ONLY. This file never inspects the real host's policy paths, never runs sudo/profiles/Claude, and proves it:
// it instruments the real `fs` during every normalizer call and also runs the CLI under Node's permission model with fs access denied.
const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const SCRIPT = path.join(SCRIPTS, 'phase3b6bMdmReadbackNormalizer.mjs');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const HOME = '/Users/tester'; const USER = 'tester';
const NOW = () => Date.parse('2026-10-09T01:02:03Z');
const DESC = Object.freeze({ inventoryKey: '_computerlevel', entryRequiredKeys: ['ProfileIdentifier', 'ProfileDisplayName'], allowedOtherRootKeys: [], emptyInventoryIsComplete: false });
const plist = body => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${body}</plist>\n`;
const COMPLETE = plist('<dict><key>_computerlevel</key><array><dict><key>ProfileIdentifier</key><string>com.example.wifi</string><key>ProfileDisplayName</key><string>Wi-Fi</string></dict></array></dict>');
const synth = (over = {}) => mdm.createSyntheticFs({ dirs: ['/Library', '/Library/Application Support', '/Library/Managed Preferences', '/Users', HOME, `${HOME}/Library`, `${HOME}/.claude`], ...over });
const run = (over = {}) => mdm.normalizeMdmReadback({ exitCode: 0, stdout: COMPLETE, home: HOME, user: USER, now: NOW, ...over });
const SYNTH_PASS = 'SYNTHETIC_ABSENCE_OBSERVED';

// ---- Part A: isolation ----------------------------------------------------------------------------------------------------------
test('A: the module imports no filesystem, OS, process, network or environment API', () => {
  const imports = [...SRC.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]).sort();
  assert.deepEqual(imports, ['node:crypto', 'node:path', 'node:url']);
  for (const pattern of [/\brequire\s*\(/, /\bimport\s*\(/, /process\.env/, /homedir|userInfo|tmpdir/, /\bfs\./, /\b(readFileSync|statSync|readdirSync|openSync|existsSync|accessSync|realpathSync|readlinkSync|opendirSync)\b/, /child_process|spawn|execFile|execSync/, /\bfetch\s*\(|node:(http|https|net|dgram|dns)/, /\/usr\/bin\/(sudo|profiles)/]) {
    assert.equal(pattern.test(SRC.replace(/\/\/.*$/gm, '')), false, String(pattern));
  }
  assert.equal((SRC.match(/lstatSync/g) ?? []).length, 2, 'lstatSync appears only in the synthetic filesystem definition and its single call site');
  assert.deepEqual(mdm.REAL_HOST_MODE, { enabled: false, reason: 'NOT_AUTHORIZED' }); assert.equal(Object.isFrozen(mdm.REAL_HOST_MODE), true);
});

test('A: without a synthetic filesystem NOTHING is inspected and the answer is BLOCKED_REAL_HOST_MODE_DISABLED (no real-host fallback)', () => {
  const r = run({ schema: mdm.createSyntheticTestSchema(DESC) });
  assert.deepEqual([r.managedFiles, r.hostMode, r.overall], ['NOT_INSPECTED', 'DISABLED', 'BLOCKED_REAL_HOST_MODE_DISABLED']);
  for (const [name, syntheticFs] of Object.entries({ undefined: undefined, null: null, 'plain object': {}, 'real fs module': fs, 'wrapper around real fs': { lstatSync: (...a) => fs.lstatSync(...a) },
    'proxy of real fs': new Proxy(fs, {}), 'string': '/', 'spread copy': { ...synth() }, 'prototype copy': Object.create(synth()) })) {
    const x = run({ syntheticFs, schema: mdm.createSyntheticTestSchema(DESC) });
    assert.deepEqual([x.managedFiles, x.hostMode, x.overall], ['NOT_INSPECTED', 'DISABLED', 'BLOCKED_REAL_HOST_MODE_DISABLED'], name);
  }
  assert.equal(mdm.inspectPolicyPath('/Library/Application Support/ClaudeCode/managed-settings.json', fs).state, 'NOT_INSPECTED');
  assert.equal(mdm.inspectPolicyPath('/Library/Application Support/ClaudeCode/managed-settings.json').state, 'NOT_INSPECTED');
});

test('A: attempts to switch on real-host mode (options, environment-style flags, extra arguments) have no effect', () => {
  const r = run({ realHost: true, hostMode: 'REAL', mode: 'REAL_HOST', enableRealHost: true, REAL_HOST_MODE: { enabled: true }, schema: mdm.createSyntheticTestSchema(DESC) });
  assert.equal(r.hostMode, 'DISABLED'); assert.equal(r.overall, 'BLOCKED_REAL_HOST_MODE_DISABLED');
  const cli = argv => mdm.runMdmCli({ argv, stdin: COMPLETE, now: NOW });
  for (const argv of [['--rc=0', '--real-host'], ['--rc=0', '--fixture=/x'], ['--real-host', '--rc=0'], ['--rc=0', '--rc=0'], ['--rc=0', '--enable-real-host=1'], ['--hostMode=REAL']]) {
    const out = cli(argv); assert.match(out, /OVERALL=BLOCKED_UNKNOWN/, JSON.stringify(argv)); assert.match(out, /MANAGED_FILES=NOT_INSPECTED/); assert.match(out, /HOST_MODE=DISABLED/);
  }
  assert.match(cli(['--rc=0']), /OVERALL=BLOCKED_REAL_HOST_MODE_DISABLED/);
});

test('A: ZERO real-host reads — the real fs is instrumented during the whole normalizer matrix and records no call at all', async () => {
  const calls = []; const originals = new Map();
  const sync = ['lstatSync', 'statSync', 'readFileSync', 'readdirSync', 'openSync', 'existsSync', 'accessSync', 'realpathSync', 'readlinkSync', 'opendirSync', 'readSync', 'fstatSync', 'readdir', 'stat', 'lstat', 'readFile', 'open', 'access'];
  for (const name of sync) if (typeof fs[name] === 'function') { originals.set(name, fs[name]); fs[name] = (...a) => { calls.push([name, String(a[0])]); return originals.get(name)(...a); }; }
  const pOriginals = new Map();
  for (const name of ['lstat', 'stat', 'readFile', 'readdir', 'open', 'access', 'realpath', 'readlink']) if (typeof fs.promises[name] === 'function') { pOriginals.set(name, fs.promises[name]); fs.promises[name] = (...a) => { calls.push([`promises.${name}`, String(a[0])]); return pOriginals.get(name)(...a); }; }
  try {
    const schema = mdm.createSyntheticTestSchema(DESC);
    const outcomes = [];
    for (const stdout of [COMPLETE, '', 'junk', COMPLETE.replace('</plist>', '')]) for (const exitCode of [0, 1, 142, undefined]) for (const withFs of [false, true]) {
      outcomes.push(run({ stdout, exitCode, schema, ...(withFs ? { syntheticFs: synth() } : {}) }).overall);
      outcomes.push(mdm.runMdmCli({ argv: [`--rc=${exitCode ?? 'x'}`], stdin: stdout, syntheticFs: withFs ? synth() : undefined, schema, home: HOME, user: USER, now: NOW }));
    }
    for (const target of mdm.policyPaths({ home: HOME, user: USER })) mdm.inspectPolicyPath(target, synth({ errors: { '/Library': 'EACCES' } }));
    mdm.inspectPolicyPath('/Library/x', fs); mdm.schemaFingerprint(mdm.parsePlistXml(COMPLETE)); mdm.resolveControlPlaneApprovedSchema(DESC); mdm.matchApproval(DESC, []);
    assert.ok(outcomes.length > 60);
  } finally { for (const [name, fn] of originals) fs[name] = fn; for (const [name, fn] of pOriginals) fs.promises[name] = fn; }
  assert.deepEqual(calls, [], 'no filesystem API was touched by the normalizer — real policy paths were never reached');
  assert.equal(fs.lstatSync === originals.get('lstatSync'), true, 'instrumentation restored');
});

const nodeMajor = Number(process.versions.node.split('.')[0]);
const permissionFlags = nodeMajor >= 22 ? ['--permission'] : ['--experimental-permission'];
test('A: the command line runs correctly with filesystem access DENIED by Node\'s permission model (so it cannot be reading the host)', { skip: nodeMajor < 20 ? 'Node permission model unavailable' : false }, () => {
  const env = { PATH: '/usr/bin:/bin' };
  const sandbox = (args, input) => spawnSync(process.execPath, [...permissionFlags, `--allow-fs-read=${SCRIPTS}`, ...args], { input, encoding: 'utf8', shell: false, env });
  // Sanity: the sandbox really blocks host reads (otherwise this test would prove nothing).
  const probe = sandbox(['-e', "try { require('fs').lstatSync('/Library'); console.log('READ'); } catch (e) { console.log(e.code); }"], '');
  assert.match(probe.stdout, /ERR_ACCESS_DENIED/, `the permission model must deny host reads: ${probe.stdout}${probe.stderr}`);
  const ok = sandbox([SCRIPT, '--rc=0'], COMPLETE);
  assert.equal(ok.status, 0, ok.stderr); const lines = ok.stdout.trim().split('\n');
  assert.equal(lines.length, 9); assert.ok(lines.includes('MANAGED_FILES=NOT_INSPECTED')); assert.ok(lines.includes('HOST_MODE=DISABLED')); assert.ok(lines.includes('OVERALL=BLOCKED_REAL_HOST_MODE_DISABLED'));
  assert.ok(lines.includes('SCHEMA_TRUST=NONE')); assert.ok(lines.some(l => l.startsWith('SCHEMA_FINGERPRINT=ROOT=dict;')));
  for (const args of [[SCRIPT], [SCRIPT, '--rc=0', '--real-host'], [SCRIPT, '--rc=abc'], [SCRIPT, '--fixture=/etc/hosts', '--rc=0']]) {
    const r = sandbox(args, COMPLETE); assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stdout, /OVERALL=(SYNTHETIC_ABSENCE_OBSERVED|CURRENT_ABSENCE_OBSERVED)/); assert.match(r.stdout, /MANAGED_FILES=NOT_INSPECTED/);
  }
  const fail = sandbox([SCRIPT, '--rc=1'], 'Sorry, try again.'); assert.match(fail.stdout, /COVERAGE=FAILED/);
});

// ---- Part B: schema trust ------------------------------------------------------------------------------------------------------
test('B: a self-asserted review id establishes nothing — plain objects, even carrying real review ids, are UNTRUSTED', () => {
  for (const reviewId of [1, 5466095478, 5465429018, 5449763219, 9e15, '5466095478']) {
    for (const schema of [{ ...DESC, reviewId }, { ...DESC, reviewId, approved: true, kind: 'CONTROL_PLANE_APPROVED_SCHEMA', trust: 'CONTROL_PLANE_APPROVED_SCHEMA' }, { reviewId }]) {
      const r = run({ schema, syntheticFs: synth() });
      assert.deepEqual([r.schemaTrust, r.coverage, r.overall], ['NONE', 'UNQUALIFIED', 'BLOCKED_SCHEMA_UNQUALIFIED'], JSON.stringify(schema));
    }
  }
  assert.equal(mdm.schemaSha256({ ...DESC, reviewId: 1 }), mdm.schemaSha256({ ...DESC, reviewId: 999 }), 'the review id is not part of the identity');
  assert.notEqual(mdm.schemaSha256({ ...DESC, entryRequiredKeys: ['ProfileIdentifier'] }), mdm.schemaSha256(DESC));
  assert.equal(mdm.schemaSha256({ ...DESC, entryRequiredKeys: [...DESC.entryRequiredKeys].reverse() }), mdm.schemaSha256(DESC), 'key order is canonicalized');
  assert.equal(mdm.schemaSha256(null), null); assert.equal(mdm.schemaSha256({ ...DESC, inventoryKey: '' }), null);
});

test('B: SYNTHETIC_TEST_SCHEMA and CONTROL_PLANE_APPROVED_SCHEMA are distinct brands; only the synthetic one can be made, and its success word is SYNTHETIC', () => {
  assert.deepEqual(mdm.SCHEMA_TRUST, { SYNTHETIC: 'SYNTHETIC_TEST_SCHEMA', APPROVED: 'CONTROL_PLANE_APPROVED_SCHEMA' });
  const synthetic = mdm.createSyntheticTestSchema(DESC);
  const r = run({ schema: synthetic, syntheticFs: synth() });
  assert.deepEqual([r.schemaTrust, r.hostMode, r.coverage, r.overall], ['SYNTHETIC_TEST_SCHEMA', 'SYNTHETIC', 'COMPLETE', SYNTH_PASS]);
  assert.match(mdm.formatReadback(r), /SCHEMA_TRUST=SYNTHETIC_TEST_SCHEMA\nHOST_MODE=SYNTHETIC\nOVERALL=SYNTHETIC_ABSENCE_OBSERVED$/);
  assert.throws(() => mdm.createSyntheticTestSchema({ ...DESC, inventoryKey: '' }), TypeError); assert.throws(() => mdm.createSyntheticTestSchema(null), TypeError);
  assert.equal(Object.isFrozen(synthetic), true); assert.throws(() => { synthetic.kind = 'CONTROL_PLANE_APPROVED_SCHEMA'; }, TypeError);
  assert.equal(run({ schema: synthetic, syntheticFs: synth() }).schemaTrust, 'SYNTHETIC_TEST_SCHEMA');
  assert.deepEqual(Object.keys(mdm).filter(k => /approv|brand|trust/i.test(k)).sort(), ['APPROVAL_COMMAND_CLASS', 'APPROVAL_REPOSITORY', 'APPROVED_SCHEMA_REGISTRY', 'SCHEMA_TRUST', 'matchApproval', 'resolveControlPlaneApprovedSchema']);
});

test('B: forged brands are rejected — copies, prototype tricks, clones, proxies and JSON round-trips are untrusted', () => {
  const synthetic = mdm.createSyntheticTestSchema(DESC);
  const forged = { spread: { ...synthetic }, proto: Object.create(synthetic), clone: structuredClone({ ...synthetic }), json: JSON.parse(JSON.stringify(synthetic)), proxy: new Proxy(synthetic, {}),
    claimsApproved: { kind: 'CONTROL_PLANE_APPROVED_SCHEMA' }, descriptorOnly: DESC, frozenCopy: Object.freeze({ ...DESC }) };
  for (const [name, schema] of Object.entries(forged)) { const r = run({ schema, syntheticFs: synth() }); assert.equal(r.schemaTrust, 'NONE', name); assert.equal(r.coverage, 'UNQUALIFIED', name); assert.notEqual(r.overall, SYNTH_PASS, name); }
});

test('B: no real schema is approved — the committed registry is empty and frozen, and nothing resolves to CONTROL_PLANE_APPROVED_SCHEMA', () => {
  assert.deepEqual([...mdm.APPROVED_SCHEMA_REGISTRY], []); assert.equal(Object.isFrozen(mdm.APPROVED_SCHEMA_REGISTRY), true);
  assert.throws(() => mdm.APPROVED_SCHEMA_REGISTRY.push({}), TypeError);
  for (const d of [DESC, { ...DESC, reviewId: 5466095478 }, { ...DESC, emptyInventoryIsComplete: true }, { inventoryKey: 'x', entryRequiredKeys: [], allowedOtherRootKeys: [], emptyInventoryIsComplete: false }, null, undefined, {}, []]) assert.equal(mdm.resolveControlPlaneApprovedSchema(d), null);
  assert.equal(mdm.APPROVAL_REPOSITORY, 'augusliang23-web/Micro-SaaS-Command-Center'); assert.equal(mdm.APPROVAL_COMMAND_CLASS, 'profiles show -type configuration -all -output stdout-xml');
});

test('B: a future approval must bind the exact schema hash, a 40-hex commit, a positive review id, the trusted source, repository and command class', () => {
  const hash = mdm.schemaSha256(DESC);
  const entry = { schemaSha256: hash, commitSha: 'a'.repeat(40), reviewId: 1234567, reviewSource: 'GITHUB_CONTROL_PLANE_REVIEW', repository: 'augusliang23-web/Micro-SaaS-Command-Center', commandClass: 'profiles show -type configuration -all -output stdout-xml' };
  assert.equal(mdm.matchApproval(DESC, [entry]).ok, true, 'a complete synthetic registry entry binds (this registry is a test value, not the committed one)');
  assert.equal(mdm.matchApproval({ ...DESC, reviewId: 42 }, [entry]).ok, true, 'self-asserted ids in the descriptor are irrelevant');
  const bad = {
    'wrong schema hash': { ...entry, schemaSha256: 'b'.repeat(64) }, 'schema changed after approval': null, 'short commit': { ...entry, commitSha: 'a'.repeat(39) }, 'uppercase commit': { ...entry, commitSha: 'A'.repeat(40) }, 'branch name as commit': { ...entry, commitSha: 'main' },
    'no commit': { ...entry, commitSha: undefined }, 'zero review': { ...entry, reviewId: 0 }, 'string review': { ...entry, reviewId: '1234567' }, 'fractional review': { ...entry, reviewId: 1.5 },
    'wrong source': { ...entry, reviewSource: 'SELF_ASSERTED' }, 'no source': { ...entry, reviewSource: undefined }, 'wrong repository': { ...entry, repository: 'someone/else' }, 'wrong command class': { ...entry, commandClass: 'profiles list' },
  };
  for (const [name, e] of Object.entries(bad)) {
    if (e === null) { assert.equal(mdm.matchApproval({ ...DESC, entryRequiredKeys: ['ProfileIdentifier'] }, [entry]).ok, false, name); continue; }
    const r = mdm.matchApproval(DESC, [e]); assert.equal(r.ok, false, name); assert.ok(['SCHEMA_NOT_APPROVED', 'APPROVAL_BINDING_INVALID'].includes(r.code), name);
  }
  for (const registry of [undefined, null, {}, 'x', [null], [1], [[]]]) assert.equal(mdm.matchApproval(DESC, registry).ok, false);
  assert.equal(mdm.matchApproval(null, [entry]).ok, false);
});

test('B: CURRENT_ABSENCE_OBSERVED is unreachable, a synthetic success never leaves the normalizer, and current MDM admission stays BLOCKED', async () => {
  assert.equal(/CURRENT_ABSENCE_OBSERVED/.test(SRC.replace(/\/\/.*$/gm, '')), false, 'the reserved word appears only in comments');
  const schemas = [undefined, mdm.createSyntheticTestSchema(DESC), { ...DESC, reviewId: 1 }];
  const seen = new Set();
  for (const stdout of [COMPLETE, '', 'x']) for (const exitCode of [0, 1]) for (const schema of schemas) for (const syntheticFs of [undefined, synth(), synth({ files: ['/Library/Application Support/ClaudeCode/managed-settings.json'] })])
    seen.add(run({ stdout, exitCode, schema, syntheticFs }).overall);
  assert.equal(seen.has('CURRENT_ABSENCE_OBSERVED'), false); assert.ok(seen.has(SYNTH_PASS));
  for (const file of fs.readdirSync(SCRIPTS).filter(f => f.endsWith('.mjs') && f !== 'phase3b6bMdmReadbackNormalizer.mjs')) {
    const text = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
    assert.equal(/MdmReadbackNormalizer|SYNTHETIC_ABSENCE_OBSERVED|CURRENT_ABSENCE_OBSERVED/.test(text), false, `${file} does not consume the normalizer's outcome`);
  }
  const real = await smoke.runOneCallSmoke({ binaryPath: path.join('/nonexistent-home', '.local/share/cc-qualification/claude/2.1.292/claude'), sourceEnv: { HOME: '/nonexistent-home' } });
  assert.equal(real.gates.managedPolicyRuntimeAdmission.state, 'MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED'); assert.equal(real.gates.liveExecutionAuthorized, false); assert.equal(real.providerCallsUsed, 0);
});

test('preserved boundaries: one-call budget 1, full-suite budget 3, Sonnet 5.5 one-call mapping and the event shape recorder remain', async () => {
  assert.equal(smoke.MAX_SMOKE_PROVIDER_CALLS, 1); assert.equal(threeCall.MAX_PROVIDER_CALLS, 3);
  assert.deepEqual(smoke.ONE_CALL_ADDITIONAL_MODEL_FAMILIES, { 'claude-sonnet-5-5': 'sonnet' }); assert.deepEqual(threeCall.APPROVED_TOOLS, ['Read', 'Edit', 'Write', 'Glob', 'Grep']);
  const recorder = (await import('../scripts/phase3b6bOneCallShapeRecorder.mjs')).createShapeRecorder({ sessionId: 's' }); recorder.record('{"type":"assistant"}');
  assert.equal(recorder.snapshot().admissionEffect, 'NONE');
});
