import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as mdm from '../scripts/phase3b6bMdmReadbackNormalizer.mjs';

// SYNTHETIC ONLY. Nothing here runs the real sudo or profiles: the runbook blocks are executed ONLY after every privileged path is replaced by
// a fake script in a temp directory (and the test refuses to run a block that still names a real one). No host policy path is read.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const NORMALIZER = path.join(ROOT, 'scripts/phase3b6bMdmReadbackNormalizer.mjs');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/evidence/agent-console-phase3b6b11a-stage1-runbook.md'), 'utf8');
const NODE_PATH = '/opt/homebrew/Cellar/node@20/20.20.2/bin/node';
const NODE_SHA = 'edc0c98fee8947a04913cb45cf80e7341653b0ea9e907ff3dc50d7fdaedda1d2';
const OLD_SHA = 'dd5d58ce47670e9b6db27848ea48ecdf39442d397992bc087897e0ecbf4d1626';
const WORKTREE = '~/Developer/worktrees/command-center-agent-console-p3b6b-negative-proof';
const sha256File = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const NORMALIZER_SHA = sha256File(NORMALIZER);
const nodeAvailable = fs.existsSync(NODE_PATH);

// ---- 1. fingerprint fix (diagnostic only) --------------------------------------------------------------------------------------
const plist = body => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${body}</plist>\n`;
const entry = '<dict><key>ProfileIdentifier</key><string>com.example.p</string><key>ProfileDisplayName</key><string>P</string></dict>';
const level = (key, inner = `<array>${entry}</array>`) => `<key>${key}</key>${inner}`;
const fp = body => mdm.schemaFingerprint(mdm.parsePlistXml(plist(`<dict>${body}</dict>`)));
const DESC = Object.freeze({ inventoryKey: '_computerLevel', entryRequiredKeys: ['ProfileIdentifier', 'ProfileDisplayName'], allowedOtherRootKeys: [], emptyInventoryIsComplete: false });

test('fingerprint: the documented spelling _computerLevel is recognised and reported as DOCUMENTED', () => {
  assert.equal(fp(level('_computerLevel')), 'ROOT=dict;ROOT_KEYS=1-4;COMPUTERLEVEL=array;SPELLING=DOCUMENTED;OTHER_ROOT_KEYS=0;ENTRIES=1-4;ENTRIES_ALL_DICT=true;ENTRIES_HAVE_PROFILEIDENTIFIER=true');
});

test('fingerprint: the historical lowercase spelling and other case variants are recognised and reported distinctly', () => {
  assert.match(fp(level('_computerlevel')), /COMPUTERLEVEL=array;SPELLING=LOWERCASE;/);
  for (const key of ['_COMPUTERLEVEL', '_Computerlevel', '_computerLEVEL']) assert.match(fp(level(key)), /COMPUTERLEVEL=array;SPELLING=OTHER_CASE;/, key);
  assert.match(fp(level('_computerLevel', '<array/>')), /ENTRIES=0;ENTRIES_ALL_DICT=true;ENTRIES_HAVE_PROFILEIDENTIFIER=false$/);
});

test('fingerprint: simultaneous or duplicate spellings are AMBIGUOUS and nothing under them is inspected', () => {
  for (const keys of [['_computerLevel', '_computerlevel'], ['_computerLevel', '_COMPUTERLEVEL'], ['_computerlevel', '_computerLevel', '_Computerlevel']]) {
    const r = fp(keys.map(k => level(k)).join(''));
    assert.match(r, /COMPUTERLEVEL=AMBIGUOUS;SPELLING=NONE;/, keys.join()); assert.doesNotMatch(r, /ENTRIES/);
  }
  assert.equal(mdm.parsePlistXml(plist(`<dict>${level('_computerLevel')}${level('_computerLevel')}</dict>`)).ok, false, 'exact duplicate keys are still malformed');
});

test('fingerprint: absent key, wrong value kinds and user-name root entries are described with fixed words only', () => {
  assert.match(fp('<key>other</key><string>x</string>'), /COMPUTERLEVEL=ABSENT;SPELLING=NONE;OTHER_ROOT_KEYS=1-4$/);
  assert.match(fp(level('_computerLevel', '<dict/>')), /COMPUTERLEVEL=dict;SPELLING=DOCUMENTED;/); assert.doesNotMatch(fp(level('_computerLevel', '<dict/>')), /ENTRIES/);
  assert.match(fp(level('_computerLevel', '<string>x</string>')), /COMPUTERLEVEL=string;/);
  const users = fp(`${level('_computerLevel')}${level('secretuser1')}${level('anotheruser')}${level('thirduser')}${level('fourthuser')}${level('fifthuser')}`);
  assert.match(users, /ROOT_KEYS=5-16;COMPUTERLEVEL=array;SPELLING=DOCUMENTED;OTHER_ROOT_KEYS=5-16;/);
  for (const name of ['secretuser1', 'anotheruser', 'com.example.p']) assert.equal(users.includes(name), false, `${name} must not be printed`);
  assert.match(fp(level('secretuser1')), /COMPUTERLEVEL=ABSENT;SPELLING=NONE;OTHER_ROOT_KEYS=1-4$/);
  assert.match(fp(level('_computerLevel', `<array>${entry}<string>x</string></array>`)), /ENTRIES_ALL_DICT=false;ENTRIES_HAVE_PROFILEIDENTIFIER=false$/);
  assert.equal(mdm.schemaFingerprint(mdm.parsePlistXml(plist('<array/>'))), 'ROOT=array'); assert.equal(mdm.schemaFingerprint({ ok: false }), 'ROOT=NONE');
});

test('fingerprint is DIAGNOSTIC ONLY: spelling never changes coverage, schema trust, domain status or the overall word; trusted-schema matching stays exact', () => {
  const run = (key, over = {}) => mdm.normalizeMdmReadback({ exitCode: 0, stdout: plist(`<dict>${level(key)}</dict>`), home: '/Users/t', user: 't', now: () => 0, ...over });
  const results = ['_computerLevel', '_computerlevel', '_COMPUTERLEVEL', 'other'].map(k => run(k));
  for (const r of results) assert.deepEqual([r.coverage, r.schemaTrust, r.claudeDomain, r.overall, r.managedFiles, r.hostMode], ['UNQUALIFIED', 'NONE', 'UNKNOWN', 'BLOCKED_REAL_HOST_MODE_DISABLED', 'NOT_INSPECTED', 'DISABLED']);
  const schema = mdm.createSyntheticTestSchema(DESC);
  const fs0 = mdm.createSyntheticFs({ dirs: ['/Library', '/Library/Application Support', '/Library/Managed Preferences', '/Users', '/Users/t', '/Users/t/Library', '/Users/t/.claude'] });
  const exact = run('_computerLevel', { schema, syntheticFs: fs0 });
  assert.deepEqual([exact.coverage, exact.overall], ['COMPLETE', 'SYNTHETIC_ABSENCE_OBSERVED']);
  for (const wrong of ['_computerlevel', '_COMPUTERLEVEL']) { const r = run(wrong, { schema, syntheticFs: fs0 }); assert.equal(r.coverage, 'PARTIAL', wrong); assert.notEqual(r.overall, 'SYNTHETIC_ABSENCE_OBSERVED'); assert.match(r.schema, /SPELLING=/); }
  const both = run('_computerLevel', { schema, syntheticFs: fs0, stdout: plist(`<dict>${level('_computerLevel')}${level('_computerlevel')}</dict>`) });
  assert.equal(both.coverage, 'PARTIAL'); assert.match(both.schema, /AMBIGUOUS/);
  assert.equal(mdm.APPROVED_SCHEMA_REGISTRY.length, 0); assert.equal(mdm.resolveControlPlaneApprovedSchema(DESC), null);
  assert.equal(/CURRENT_ABSENCE_OBSERVED/.test(fs.readFileSync(NORMALIZER, 'utf8').replace(/\/\/.*$/gm, '')), false);
});

// ---- 2. runbook document consistency ---------------------------------------------------------------------------------------------
const blocks = [...DOC.matchAll(/```zsh\n([\s\S]*?)```/g)].map(m => m[1]);
const [wantHead, precheck, main, recovery] = blocks;

test('runbook: pins the NEW normalizer hash and the verified absolute Node identity; the old hash appears only as superseded', () => {
  assert.equal(blocks.length, 4);
  assert.notEqual(NORMALIZER_SHA, OLD_SHA, 'the normalizer changed, so the old hash cannot apply');
  const RUN1_SHA = '656c2f3940bc288bedca8f996434b7adc7b5cb4efbfd6f66f786412bbc1d7cec'; assert.notEqual(NORMALIZER_SHA, RUN1_SHA, 'the normalizer changed after Stage 1 run #1');
  assert.ok(DOC.split('\n').filter(l => l.includes(RUN1_SHA)).every(l => /Superseded/.test(l)), 'the run #1 hash is only ever listed as superseded'); assert.equal(precheck.includes(RUN1_SHA), false);
  const hashLines = DOC.split('\n').filter(l => l.includes(OLD_SHA)); assert.ok(hashLines.length >= 1); assert.ok(hashLines.every(l => /Superseded|old normalizer|must not be reused/i.test(l)), 'the old hash is only ever mentioned as superseded');
  assert.equal(precheck.includes(OLD_SHA.slice(0, 12)), false); assert.equal(main.includes(OLD_SHA.slice(0, 12)), false);
  assert.equal(DOC.includes(NORMALIZER_SHA), true, 'the document states the current normalizer SHA-256'); assert.ok(precheck.includes(NORMALIZER_SHA));
  assert.ok(precheck.includes(NODE_SHA) && DOC.includes(NODE_SHA)); assert.ok(DOC.includes('v20.20.2'));
  assert.ok(path.isAbsolute(NODE_PATH)); assert.equal(NODE_PATH.split('/').filter(Boolean).every(p => p !== '..'), true);
  for (const b of [precheck, main]) assert.ok(b.includes(NODE_PATH.replace('/bin/node', '')), 'absolute Node path used');
  assert.equal(/(?<![\w/.-])node scripts\//.test(main) || /\| node /.test(main), false, 'no unqualified node from PATH');
  assert.equal(/-> /.test(precheck), false);
});

test('runbook: the privileged block orders visible sudo -v before non-interactive sudo -n, cleans up with sudo -k on every exit path, and has no hidden prompt', () => {
  const i = s => main.indexOf(s);
  assert.ok(i('trap \'/usr/bin/sudo -k') > -1 && i('trap \'exit 130\' INT TERM HUP') > -1 && i('EXIT') > -1);
  assert.ok(i('/usr/bin/sudo -k\n') < i('/usr/bin/sudo -v') && i('/usr/bin/sudo -v') < i('/usr/bin/sudo -n --') && i('/usr/bin/sudo -n --') < i('print -rn --'), 'order: -k, -v, -n, normalizer');
  assert.ok(main.split('\n').some(l => /^\s*\/usr\/bin\/sudo -k\s*$/.test(l)), 'explicit -k after the capture');
  assert.equal((main.match(/\/usr\/bin\/sudo -n --/g) ?? []).length, 1); assert.equal((main.match(/profiles show/g) ?? []).length, 1);
  assert.match(main, /raw="\$\(\/usr\/bin\/sudo -n -- \/usr\/bin\/profiles show -type configuration -all -output stdout-xml 2>\/dev\/null\)"; rc=\$\?\n/);
  for (const forbidden of [/perl/, /alarm/, /sudo -k --/, /sudo -S/, /\bread\b/, /\bsecurity\b/, /\btee\b/, /history/, /set -x/, /setopt xtrace/, /> *[^/&\s]/, />>/, /printf|echo /, /sudo -s\b/, /sudo -i\b/, /\bsu\b/]) assert.equal(forbidden.test(main.replace(/2>\/dev\/null|>\/dev\/null 2>&1/g, '')), false, String(forbidden));
  assert.equal((main.match(/\/dev\/null/g) ?? []).length, 2);
  assert.ok(main.includes('exit 1') && main.includes('STOP: sudo did not authenticate'));
  assert.ok(main.trimStart().startsWith('(') && main.trimEnd().endsWith(')'), 'subshell');
  const allowed = new Set(['/usr/bin/sudo', '/usr/bin/profiles', NODE_PATH, '/dev/null']);
  for (const b of [main, precheck, recovery]) for (const p of b.match(/(?<![\w~.-])\/(?:usr|opt|bin|dev)[\w./@-]*/g) ?? []) assert.ok([...allowed, '/usr/bin/git', '/usr/bin/shasum', '/usr/bin/cut'].includes(p), `unexpected executable or path ${p}`);
});

test('runbook: interruption, partial execution and manual recovery are documented, and no step asks for the password to be shared', () => {
  for (const phrase of ['subsh>', 'cmdsubst>', 'Ctrl-C', 'EXIT', 'sudo -k', 'sudo -K', 'NOT_CACHED', 'STILL_CACHED', 'Terminal.app', 'twelve lines', 'PRECHECK=PASS', 'exact commit', 'STAGE1_WANT_HEAD', 'not authorized', 'diagnostic only']) assert.ok(DOC.toLowerCase().includes(phrase.toLowerCase()), phrase);
  assert.match(DOC, /Never share:\*\*[^\n]*password/); assert.doesNotMatch(DOC, /send (me|us|the assistant) (your|the) password/i);
  assert.ok(recovery.includes('sudo -k') && recovery.includes('sudo -K') && recovery.includes('sudo -n true'));
  assert.equal(/CURRENT_ABSENCE_OBSERVED/.test(main + precheck), false);
});

test('runbook: zsh -n (parse only, nothing executed) accepts every proposed block, and rejects a deliberately broken one', () => {
  for (const [name, block] of Object.entries({ wantHead, precheck, main, recovery })) {
    const r = spawnSync('/bin/zsh', ['-f', '-n', '-c', block], { encoding: 'utf8', shell: false, env: { PATH: '/usr/bin:/bin' } });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  }
  assert.notEqual(spawnSync('/bin/zsh', ['-f', '-n', '-c', main.replace(/\)\s*$/, '')], { encoding: 'utf8', shell: false, env: { PATH: '/usr/bin:/bin' } }).status, 0);
  assert.notEqual(spawnSync('/bin/zsh', ['-f', '-n', '-c', main.replace('then', '').replace('||', '||| ')], { encoding: 'utf8', shell: false, env: { PATH: '/usr/bin:/bin' } }).status, 0);
});

// ---- 3. behaviour of the blocks against FAKE sudo/profiles ------------------------------------------------------------------------
function fixtureDir() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p3b6b11a-'))); }
function installFakes(dir) {
  const sudo = path.join(dir, 'fake-sudo'); const profiles = path.join(dir, 'fake-profiles');
  fs.writeFileSync(sudo, `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$1" in
  -k|-K) rm -f "$FAKE_STATE"; exit 0;;
  -v) [ "$FAKE_MODE" = authfail ] && exit 1; : > "$FAKE_STATE"; exit 0;;
  -n) [ -f "$FAKE_STATE" ] || { echo "sudo: a password is required" >&2; exit 1; }; shift; [ "$1" = "--" ] && shift; exec "$@";;
  *) exit 99;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(profiles, `#!/bin/sh
case "$FAKE_MODE" in
  profilesfail) echo "synthetic failure SECRET-RAW-TEXT" ; exit 3;;
  hang) sleep 30; exit 0;;
  *) cat <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>_computerLevel</key><array><dict><key>ProfileIdentifier</key><string>com.example.SECRET-PROFILE</string><key>ProfileDisplayName</key><string>SECRET-NAME</string></dict></array></dict></plist>
XML
  ;;
esac
`, { mode: 0o755 });
  return { sudo, profiles };
}
function stubbed(block, { sudo, profiles, repo }) {
  const out = block.replaceAll('/usr/bin/sudo', sudo).replaceAll('/usr/bin/profiles', profiles).replaceAll(NODE_PATH, process.execPath).replaceAll(WORKTREE, repo);
  for (const real of ['/usr/bin/sudo', '/usr/bin/profiles', '~/Developer']) assert.equal(out.includes(real), false, `refusing to execute a block that still names ${real}`);
  return out;
}
const runBlock = (block, env) => spawnSync('/bin/zsh', ['-f', '-c', block], { encoding: 'utf8', shell: false, cwd: os.tmpdir(), env: { PATH: '/usr/bin:/bin', ...env }, timeout: 60_000 });
const lines = text => text.trim().split('\n').filter(Boolean);

test('blocks, normal path with FAKE sudo/profiles: twelve safe lines only, ordered sudo calls, credentials dropped, no raw text', () => {
  const dir = fixtureDir(); try {
    const fakes = installFakes(dir); const env = { FAKE_LOG: path.join(dir, 'log'), FAKE_STATE: path.join(dir, 'cached'), FAKE_MODE: 'ok', rc: '0', raw: 'stale-junk' };
    const r = runBlock(stubbed(main, { ...fakes, repo: ROOT }), env);
    assert.equal(r.status, 0, r.stderr); const out = lines(r.stdout); assert.equal(out.length, 12, r.stdout);
    assert.ok(out.includes('PROFILES_EXIT=0') && out.includes('OVERALL=BLOCKED_REAL_HOST_MODE_DISABLED') && out.includes('MANAGED_FILES=NOT_INSPECTED') && out.includes('SCHEMA_TRUST=NONE'));
    assert.ok(out.some(l => /^SCHEMA_FINGERPRINT=.*COMPUTERLEVEL=array;SPELLING=DOCUMENTED;/.test(l)));
    for (const leak of ['SECRET', 'com.example', 'stale-junk']) assert.equal(r.stdout.includes(leak) || r.stderr.includes(leak), false, leak);
    const log = lines(fs.readFileSync(env.FAKE_LOG, 'utf8')); const verbs = log.map(l => l.split(' ')[0]);
    assert.deepEqual(verbs, ['-k', '-v', '-n', '-k', '-k'], log.join(' | ')); assert.equal(fs.existsSync(env.FAKE_STATE), false, 'credentials dropped at the end');
    assert.match(log[2], /^-n -- .*fake-profiles show -type configuration -all -output stdout-xml$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('blocks, failures: failed authentication never captures; a failing profiles command is reported FAILED; stale shell variables cannot leak in', () => {
  const dir = fixtureDir(); try {
    const fakes = installFakes(dir);
    const make = mode => ({ FAKE_LOG: path.join(dir, `log-${mode}`), FAKE_STATE: path.join(dir, `cached-${mode}`), FAKE_MODE: mode, rc: '0', raw: 'stale' });
    const auth = make('authfail'); const a = runBlock(stubbed(main, { ...fakes, repo: ROOT }), auth);
    assert.equal(a.status, 1); assert.match(a.stdout, /STOP: sudo did not authenticate/); assert.equal(a.stdout.includes('OVERALL='), false);
    const authLog = lines(fs.readFileSync(auth.FAKE_LOG, 'utf8')); assert.equal(authLog.some(l => l.startsWith('-n')), false, 'no capture after failed authentication'); assert.equal(authLog.at(-1), '-k');
    const bad = make('profilesfail'); const b = runBlock(stubbed(main, { ...fakes, repo: ROOT }), bad);
    assert.equal(b.status, 0); assert.ok(b.stdout.includes('PROFILES_EXIT=3')); assert.ok(b.stdout.includes('COVERAGE=FAILED')); assert.equal(b.stdout.includes('SECRET'), false); assert.equal(b.stderr.includes('SECRET'), false);
    const wrongOrder = make('ok'); fs.writeFileSync(wrongOrder.FAKE_LOG, ''); // the -n capture alone, without -v, must fail (fake enforces no cached credentials)
    const direct = spawnSync(fakes.sudo, ['-n', '--', fakes.profiles], { encoding: 'utf8', env: { ...wrongOrder } }); assert.equal(direct.status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`blocks, interruption (${signal}) during the capture: output is empty, nothing leaks, and the sudo -k cleanup still runs`, async () => {
    const dir = fixtureDir(); try {
      const fakes = installFakes(dir); const env = { PATH: '/usr/bin:/bin', FAKE_LOG: path.join(dir, 'log'), FAKE_STATE: path.join(dir, 'cached'), FAKE_MODE: 'hang' };
      const child = spawn('/bin/zsh', ['-f', '-c', stubbed(main, { ...fakes, repo: ROOT })], { cwd: os.tmpdir(), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; child.stdout.on('data', c => { stdout += c; }); let stderr = ''; child.stderr.on('data', c => { stderr += c; });
      const started = Date.now();
      while (!(fs.existsSync(env.FAKE_LOG) && /-n -- /.test(fs.readFileSync(env.FAKE_LOG, 'utf8'))) && Date.now() - started < 15_000) await new Promise(r => setTimeout(r, 50));
      assert.ok(fs.existsSync(env.FAKE_STATE), 'credentials were cached at the moment of interruption');
      const closed = new Promise(resolve => child.on('close', (code, sig) => resolve({ code, sig })));
      process.kill(-child.pid, signal); const result = await Promise.race([closed, new Promise(r => setTimeout(() => r('TIMEOUT'), 15_000))]);
      assert.notEqual(result, 'TIMEOUT', 'the block ended promptly');
      assert.equal(stdout.includes('OVERALL='), false, 'an interrupted run prints no result'); assert.equal((stdout + stderr).includes('SECRET'), false);
      assert.equal(fs.existsSync(env.FAKE_STATE), false, 'credentials were dropped by the cleanup trap');
      const verbs = lines(fs.readFileSync(env.FAKE_LOG, 'utf8')).map(l => l.split(' ')[0]); assert.equal(verbs.at(-1), '-k'); assert.ok(verbs.includes('-n'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

// ---- 4. pre-check block against a temporary repository ------------------------------------------------------------------------------
test('pre-check block: exact commit, clean worktree, normalizer hash and Node identity — each mismatch is a single FAIL line', { skip: nodeAvailable ? false : 'pinned Node path not present on this machine' }, () => {
  const dir = fixtureDir(); try {
    const git = (...a) => spawnSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd: dir, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
    git('init', '-q', '-b', 'main'); fs.mkdirSync(path.join(dir, 'scripts')); fs.copyFileSync(NORMALIZER, path.join(dir, 'scripts/phase3b6bMdmReadbackNormalizer.mjs'));
    git('add', '-A'); assert.equal(git('commit', '-q', '-m', 'fixture').status, 0); const head = git('rev-parse', 'HEAD').stdout.trim();
    const pre = want => runBlock(`STAGE1_WANT_HEAD=${want}\n${stubbed(precheck, { sudo: 'x', profiles: 'x', repo: dir })}`, {});
    assert.equal(pre(head).stdout.trim(), 'PRECHECK=PASS', pre(head).stderr);
    assert.equal(pre('1'.repeat(40)).stdout.trim(), 'PRECHECK=FAIL:head_mismatch'); assert.equal(pre('short').stdout.trim(), 'PRECHECK=FAIL:want_head_format');
    assert.equal(pre(head.toUpperCase()).stdout.trim(), 'PRECHECK=FAIL:want_head_format'); assert.equal(runBlock(stubbed(precheck, { sudo: 'x', profiles: 'x', repo: dir }), {}).stdout.trim(), 'PRECHECK=FAIL:want_head_format');
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x'); assert.equal(pre(head).stdout.trim(), 'PRECHECK=FAIL:worktree_not_clean'); fs.rmSync(path.join(dir, 'untracked.txt'));
    fs.appendFileSync(path.join(dir, 'scripts/phase3b6bMdmReadbackNormalizer.mjs'), '\n// tampered\n'); git('add', '-A'); git('commit', '-q', '-m', 'tamper'); const head2 = git('rev-parse', 'HEAD').stdout.trim();
    assert.equal(pre(head2).stdout.trim(), 'PRECHECK=FAIL:normalizer_hash', 'a committed but modified normalizer is refused');
    assert.equal(runBlock(`STAGE1_WANT_HEAD=${head}\n${stubbed(precheck, { sudo: 'x', profiles: 'x', repo: path.join(dir, 'missing') })}`, {}).stdout.trim(), 'PRECHECK=FAIL:repo_path');
    const wrongNode = stubbed(precheck, { sudo: 'x', profiles: 'x', repo: dir }).replaceAll('node@20/20.20.2', 'node@20/0.0.0');
    git('reset', '-q', '--hard', head); assert.equal(runBlock(`STAGE1_WANT_HEAD=${head}\n${wrongNode}`, {}).stdout.trim(), 'PRECHECK=FAIL:node_path');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the pinned Node file on this machine matches the recorded identity (read-only)', { skip: nodeAvailable ? false : 'pinned Node path not present on this machine' }, () => {
  const st = fs.lstatSync(NODE_PATH); assert.ok(st.isFile() && !st.isSymbolicLink());
  assert.equal(sha256File(NODE_PATH), NODE_SHA); assert.equal(path.dirname(fs.realpathSync(NODE_PATH)), path.dirname(NODE_PATH));
});
