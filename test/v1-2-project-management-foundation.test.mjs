// V1.2A project management data foundation. SYNTHETIC ONLY: every state below is built in this file and every file lives in a
// fresh mkdtemp directory under os.tmpdir(). Nothing reads or writes a real data/app-state.json, starts a server, calls a
// provider, an agent, git, gh or the network. Child processes (concurrency race) run only the store against those temp dirs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isUsableSavedState } from '../src/savedState.mjs';
import { isRealProject } from '../src/verdict.mjs';
import { isValidState } from '../server/localStateStore.mjs';
import {
  addProject,
  applyProjectCommand,
  archiveProject,
  editProject,
  recoverRemovedProject,
  removeProject,
  restoreProject,
} from '../server/projectManagementCommands.mjs';
import { LIMITS, ProjectDataError, canonicalRepository, cleanText, serializeState } from '../server/projectManagementSchema.mjs';
import { ABSENT_VERSION, BACKUP_GENERATIONS, createProjectStore, defaultIo } from '../server/projectManagementStore.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-10-19T12:00:00.000Z';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v12a-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
let dirCount = 0;
const tempDir = () => { const d = path.join(ROOT, `d${(dirCount += 1)}`); fs.mkdirSync(d, { mode: 0o700 }); return d; };

// ---------------------------------------------------------------------------------------------------- synthetic fixtures
function syntheticProject(id, overrides = {}) {
  return {
    id,
    name: `SYNTHETIC ${id}`,
    tagline: 'synthetic fixture',
    repository: `synthetic-owner/${id}`,
    stage: 'Beta',
    health: 'Healthy',
    workflowType: 'standard',
    currentTask: 'synthetic task',
    currentGate: 'IMPLEMENT',
    currentGateLabel: 'Implementation',
    testOutcome: 'PASS',
    reviewOutcome: 'PENDING',
    nextAction: 'synthetic next',
    blocker: null,
    waitingState: 'WAITING_FOR_HUMAN',
    model: 'Terra',
    reasoningEffort: 'Medium',
    routingReason: 'synthetic',
    lastActivity: 'Just now',
    tags: ['synthetic'],
    gates: [{ id: 'DISCUSS', label: 'Discussion', shortLabel: 'DISCUSS', status: 'COMPLETED', detail: 'kept' }],
    activityHistory: [{ id: `act-${id}`, timestamp: '2026-10-01T00:00:00Z', author: 'Human (You)', action: 'synthetic', detail: 'kept' }],
    executionContext: { branch: 'main', model: 'Terra', reasoningEffort: 'Medium', risk: 'Low', routingReason: 'synthetic', bridgeRunId: 'run-1', githubPR: '#1' },
    environment: { production: { status: 'Live', lastDeployed: 'synthetic' }, staging: { status: 'Healthy', lastRefreshed: 'synthetic' }, targetReleaseVersion: 'v9' },
    provenance: { gate: { authority: 'fixture' } },
    changeSummaries: [{ id: 's1', refKey: 'pr:1', summary: 'kept', provider: 'synthetic', generatedAt: '2026-10-01T00:00:00Z', fileCount: 1, includedLocalDiff: false }],
    futureProjectField: { keep: [1, 2, 3] },
    ...overrides,
  };
}
function syntheticState() {
  return {
    projects: [syntheticProject('p1'), syntheticProject('p2', { dataMode: 'demo', repository: 'github.com/my-org/demo' }), syntheticProject('p3')],
    attentionItems: [{ id: 'a1', synthetic: true }],
    nba: { synthetic: true },
    snapshot: { synthetic: true },
    futureTopLevel: { untouched: 'yes', nested: [true, null, 1.5] },
  };
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
const ids = (() => { let n = 0; return () => `proj-new-${(n += 1)}`; })();
const ctx = (extra = {}) => ({ now: NOW, newId: ids, ...extra });
const code = (fn, expected) => {
  try { fn(); } catch (error) {
    assert.ok(error instanceof ProjectDataError, `expected ProjectDataError, got ${error}`);
    assert.equal(error.code, expected, error.message);
    return error;
  }
  assert.fail(`expected ${expected}`);
};
const usable = (state) => { assert.ok(isValidState(state), 'isValidState'); assert.ok(isUsableSavedState(state), 'isUsableSavedState'); };

// ---------------------------------------------------------------------------------------------------- A. schema & V1.1 compatibility
describe('A. schema and V1.1 saved-state compatibility', () => {
  test('a new project is a complete legacy-shaped record both V1 readers accept, with no dataMode and no evidence claims', () => {
    const { state, result } = addProject(syntheticState(), { name: '  New  Project ', repository: 'synthetic-owner/new' }, ctx({ newId: () => 'proj-fixed' }));
    usable(state);
    const p = state.projects.at(-1);
    assert.equal(result.projectId, 'proj-fixed');
    assert.equal(p.name, 'New  Project');
    assert.equal('dataMode' in p, false);
    assert.equal(isRealProject(p), true, 'with an owner/repo repository it is a registered identity (V1 still shows NOT CONNECTED unless allowlisted)');
    assert.deepEqual([p.gates, p.activityHistory, p.testOutcome, p.reviewOutcome, p.model, p.blocker], [[], [], 'N/A', 'N/A', 'Not Assigned', null]);
    assert.equal(p.management.lifecycle, 'active');
  });

  test('without a repository the project is saved but is not a registered GitHub identity (stays NOT CONNECTED)', () => {
    const { state } = addProject(syntheticState(), { name: 'No repo' }, ctx());
    usable(state);
    assert.equal(state.projects.at(-1).repository, '');
    assert.equal(isRealProject(state.projects.at(-1)), false);
  });

  test('demo and unverified records are never promoted: editing a demo keeps dataMode, even with a registered-looking name', () => {
    const { state } = editProject(syntheticState(), { id: 'p2', patch: { name: 'SYNTHETIC p1' } }, ctx());
    assert.equal(state.projects[1].dataMode, 'demo');
    assert.equal(isRealProject(state.projects[1]), false);
  });

  test('repository input accepts only exact owner/repo', () => {
    for (const ok of ['a/b', 'synthetic-owner/repo.name_1', 'A-1/x']) assert.equal(canonicalRepository(` ${ok} `), ok);
    for (const bad of ['https://github.com/a/b', 'git@github.com:a/b.git', 'a/b.git', 'a/b/c', 'a', '/b', 'a/', '-a/b', 'a-/b', 'a--b/c', 'a/..', 'a/.', 'a b/c', 'ownér/x', '../x', 'a/b\nc', 123]) {
      code(() => canonicalRepository(bad), 'INVALID_INPUT');
    }
  });

  test('text input: NFC normalisation, length in code points, and refusal of blank, control, bidi and malformed Unicode', () => {
    assert.equal(cleanText('Café', { field: 'name', maxChars: 10 }), 'Café');
    assert.equal(cleanText('\u{1F680}'.repeat(LIMITS.nameMaxChars), { field: 'name', maxChars: LIMITS.nameMaxChars }).length, LIMITS.nameMaxChars * 2);
    for (const bad of ['', '   ', 'a\u0000b', 'a\nb', 'a\u202eb', 'a\u2028b', '\ud800', 'x'.repeat(LIMITS.nameMaxChars + 1), 5, null]) {
      code(() => cleanText(bad, { field: 'name', maxChars: LIMITS.nameMaxChars }), 'INVALID_INPUT');
    }
  });

  test('malformed input states are refused, never repaired', () => {
    const broken = [
      { ...syntheticState(), nba: null },
      { ...syntheticState(), projects: [{ id: 'x', name: 'only id and name' }] },
      { ...syntheticState(), projects: [syntheticProject('p1', { tags: 'not-an-array' })] },
      { ...syntheticState(), projects: [syntheticProject('p1', { management: { lifecycle: 'deleted' } })] },
      { ...syntheticState(), projectManagement: { removed: 'nope' } },
      { ...syntheticState(), projectManagement: { removed: [{ project: { id: 'x' }, removedAt: NOW }] } },
    ];
    for (const state of broken) code(() => addProject(state, { name: 'x' }, ctx()), 'INVALID_STATE');
  });
});

// ---------------------------------------------------------------------------------------------------- B. pure commands
describe('B. Add / Edit / Archive / Restore / Remove / Recover pure commands', () => {
  test('commands never mutate their input and carry unrelated data over unchanged (same references, same JSON)', () => {
    const input = deepFreeze(syntheticState());
    const before = JSON.stringify(input);
    const steps = [
      (s) => addProject(s, { name: 'x' }, ctx()),
      (s) => editProject(s, { id: 'p1', patch: { name: 'renamed' } }, ctx()),
      (s) => archiveProject(s, { id: 'p1' }, ctx()),
      (s) => removeProject(s, { id: 'p1' }, ctx()),
    ];
    for (const step of steps) {
      const { state } = step(input);
      assert.equal(JSON.stringify(input), before);
      assert.equal(state.futureTopLevel, input.futureTopLevel);
      assert.equal(state.attentionItems, input.attentionItems);
      assert.equal(state.projects.find((p) => p.id === 'p3'), input.projects[2]);
      usable(state);
    }
  });

  test('add is deterministic for fixed now/id and refuses id collisions, duplicate repositories and unknown fields', () => {
    const a = addProject(syntheticState(), { name: 'Same', tags: ['x'] }, ctx({ newId: () => 'proj-z' }));
    const b = addProject(syntheticState(), { name: 'Same', tags: ['x'] }, ctx({ newId: () => 'proj-z' }));
    assert.equal(serializeState(a.state), serializeState(b.state));
    code(() => addProject(syntheticState(), { name: 'x' }, ctx({ newId: () => 'p1' })), 'ID_COLLISION');
    code(() => addProject(syntheticState(), { name: 'x', repository: 'SYNTHETIC-OWNER/P3' }, ctx()), 'DUPLICATE_REPOSITORY');
    code(() => addProject(syntheticState(), { name: 'x', dataMode: 'registered' }, ctx()), 'INVALID_INPUT');
    code(() => addProject(syntheticState(), { name: 'x' }, { now: 'not-a-date', newId: ids }), 'INVALID_INPUT');
    code(() => addProject(syntheticState(), { name: 'x', tags: ['a', 'A'] }, ctx()), 'INVALID_INPUT');
    code(() => addProject(syntheticState(), { name: 'x', stage: 'Live' }, ctx()), 'INVALID_INPUT');
  });

  test('add refuses to exceed the project limit', () => {
    const big = syntheticState();
    big.projects = Array.from({ length: LIMITS.maxProjects }, (_, i) => syntheticProject(`p${i}`));
    code(() => addProject(big, { name: 'one too many' }, ctx()), 'LIMIT_EXCEEDED');
  });

  test('edit changes only allowlisted presentation fields and preserves identity, history, gates and unknown fields', () => {
    const input = syntheticState();
    const { state, result } = editProject(input, { id: 'p1', patch: { name: 'Renamed', tags: ['a', 'b'], stage: 'Alpha', tagline: '' } }, ctx());
    const [before, afterP] = [input.projects[0], state.projects[0]];
    assert.deepEqual(result.fields.sort(), ['name', 'stage', 'tagline', 'tags']);
    for (const key of Object.keys(before).filter((k) => !['name', 'tags', 'stage', 'tagline'].includes(k))) assert.deepEqual(afterP[key], before[key], key);
    assert.equal(afterP.management.events.at(-1).type, 'edited');
    for (const forbidden of [{ id: 'x' }, { repository: 'a/b' }, { dataMode: 'demo' }, { management: {} }, { health: 'Healthy' }, { gates: [] }]) {
      code(() => editProject(input, { id: 'p1', patch: forbidden }, ctx()), 'FIELD_NOT_EDITABLE');
    }
    code(() => editProject(input, { id: 'p1', patch: {} }, ctx()), 'INVALID_INPUT');
    code(() => editProject(input, { id: 'nope', patch: { name: 'x' } }, ctx()), 'NOT_FOUND');
    code(() => editProject(input, { id: '', patch: { name: 'x' } }, ctx()), 'INVALID_ID');
  });

  test('a no-op edit returns the same state object (nothing to write)', () => {
    const input = syntheticState();
    const out = editProject(input, { id: 'p1', patch: { name: input.projects[0].name } }, ctx());
    assert.equal(out.state, input);
    assert.equal(out.result.changed, false);
  });

  test('a duplicated legacy id is never guessed: every targeted command refuses it', () => {
    const dup = syntheticState();
    dup.projects.push(syntheticProject('p1', { repository: 'synthetic-owner/other' }));
    for (const run of [
      () => editProject(dup, { id: 'p1', patch: { name: 'x' } }, ctx()),
      () => archiveProject(dup, { id: 'p1' }, ctx()),
      () => removeProject(dup, { id: 'p1' }, ctx()),
    ]) code(run, 'AMBIGUOUS_ID');
  });

  test('lifecycle: archive <-> restore, remove keeps the full record, recover returns it with its lifecycle and position', () => {
    let s = syntheticState();
    const original = JSON.stringify(s.projects[0]);
    s = archiveProject(s, { id: 'p1' }, ctx()).state;
    assert.equal(s.projects[0].management.lifecycle, 'archived');
    code(() => archiveProject(s, { id: 'p1' }, ctx()), 'ILLEGAL_TRANSITION');
    s = restoreProject(s, { id: 'p1' }, ctx()).state;
    assert.equal(s.projects[0].management.lifecycle, 'active');
    code(() => restoreProject(s, { id: 'p1' }, ctx()), 'ILLEGAL_TRANSITION');
    code(() => restoreProject(syntheticState(), { id: 'p3' }, ctx()), 'ILLEGAL_TRANSITION');
    s = archiveProject(s, { id: 'p1' }, ctx()).state;
    s = removeProject(s, { id: 'p1' }, ctx()).state;
    usable(s);
    assert.deepEqual(s.projects.map((p) => p.id), ['p2', 'p3']);
    const entry = s.projectManagement.removed[0];
    assert.equal(entry.previousIndex, 0);
    assert.equal(entry.previousLifecycle, 'archived');
    const { management: _m, ...kept } = entry.project;
    const { management: _o, ...orig } = JSON.parse(original);
    assert.deepEqual(kept, orig, 'the removed record keeps every original field');
    code(() => archiveProject(s, { id: 'p1' }, ctx()), 'NOT_FOUND');
    code(() => addProject(s, { name: 'x' }, ctx({ newId: () => 'p1' })), 'ID_COLLISION');
    s = recoverRemovedProject(s, { id: 'p1' }, ctx()).state;
    assert.deepEqual(s.projects.map((p) => p.id), ['p1', 'p2', 'p3']);
    assert.equal(s.projects[0].management.lifecycle, 'archived');
    assert.equal(s.projectManagement.removed.length, 0);
    code(() => recoverRemovedProject(s, { id: 'p1' }, ctx()), 'NOT_FOUND');
    assert.deepEqual(s.projects[0].management.events.map((e) => e.type), ['archived', 'restored', 'archived', 'removed', 'recovered']);
  });

  test('recover refuses when the repository has been reused by a current project meanwhile', () => {
    let s = removeProject(syntheticState(), { id: 'p3' }, ctx()).state;
    s = addProject(s, { name: 'reuse', repository: 'synthetic-owner/p3' }, ctx()).state;
    code(() => recoverRemovedProject(s, { id: 'p3' }, ctx()), 'DUPLICATE_REPOSITORY');
  });

  test('dispatcher refuses unknown commands', () => {
    code(() => applyProjectCommand(syntheticState(), { type: 'purge', id: 'p1' }, ctx()), 'INVALID_COMMAND');
    code(() => applyProjectCommand(syntheticState(), { type: '__proto__' }, ctx()), 'INVALID_COMMAND');
    assert.equal(applyProjectCommand(syntheticState(), { type: 'archive', id: 'p1' }, ctx()).result.changed, true);
  });
});

// ---------------------------------------------------------------------------------------------------- C. store: atomic, backup, safety
function seeded(state = syntheticState()) {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'app-state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  return { dir, store: createProjectStore({ dataDir: dir, now: () => NOW, newId: ids }) };
}
const fileOf = (dir, name = 'app-state.json') => fs.readFileSync(path.join(dir, name));
/** io whose calls fail when `when(op, pathOfCall)` returns an Error. Tracks fd -> path so fsync/write failures can be targeted. */
function faultyIo(when) {
  const fdPath = new Map();
  const check = (op, p) => { const e = when(op, p); if (e) throw e; };
  return {
    ...defaultIo,
    openSync: (p, ...rest) => { check('open', p); const fd = defaultIo.openSync(p, ...rest); fdPath.set(fd, p); return fd; },
    writeSync: (fd, buf, off, len) => {
      const p = fdPath.get(fd);
      const e = when('write', p);
      if (e) { defaultIo.writeSync(fd, buf, off, Math.floor(len / 2)); throw e; } // a partial write, then the failure
      return defaultIo.writeSync(fd, buf, off, len);
    },
    fsyncSync: (fd) => { check('fsync', fdPath.get(fd)); return defaultIo.fsyncSync(fd); },
    renameSync: (from, to) => { check('rename', to); return defaultIo.renameSync(from, to); },
  };
}
const eio = () => Object.assign(new Error('synthetic EIO'), { code: 'EIO' });
const isTargetTemp = (p) => typeof p === 'string' && path.basename(p).startsWith('.app-state.json.tmp-');

describe('C. store: atomic replacement, backups and filesystem safety', () => {
  test('absent state: version is "absent", apply refuses, createInitialState makes an EMPTY owner-only file (no demo data)', () => {
    const dir = tempDir();
    const store = createProjectStore({ dataDir: dir, now: () => NOW, newId: ids });
    assert.deepEqual(store.read(), { state: null, version: ABSENT_VERSION });
    code(() => store.apply({ expectedVersion: ABSENT_VERSION, command: { type: 'add', input: { name: 'x' } } }), 'NO_STATE');
    store.createInitialState();
    assert.deepEqual(store.read().state, { projects: [], attentionItems: [], nba: {}, snapshot: {} });
    assert.equal(fs.statSync(store.statePath).mode & 0o777, 0o600);
    code(() => store.createInitialState(), 'CONFLICT');
  });

  test('a commit preserves untouched fields and records exactly the expected bytes; backups are verified and bounded', () => {
    const { dir, store } = seeded();
    let { version } = store.read();
    for (let i = 0; i < BACKUP_GENERATIONS + 2; i += 1) ({ version } = store.apply({ expectedVersion: version, command: { type: 'add', input: { name: `n${i}` } } }));
    const { state } = store.read();
    assert.deepEqual(state.futureTopLevel, syntheticState().futureTopLevel);
    assert.deepEqual(state.projects.slice(0, 3), syntheticState().projects);
    const backups = store.listBackups();
    assert.equal(backups.length, BACKUP_GENERATIONS);
    assert.ok(backups.every((b) => b.valid));
    assert.ok(fs.readdirSync(dir).every((f) => /^app-state\.json(\.bak\.[1-3])?$/.test(f)), fs.readdirSync(dir).join(','));
    for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  });

  test('commit requires an expected version (no last-write-wins) and refuses a stale one without touching the file', () => {
    const { dir, store } = seeded();
    const before = fileOf(dir);
    const { state } = store.read();
    code(() => store.commit({ nextState: state }), 'INVALID_INPUT');
    code(() => store.commit({ expectedVersion: 'f'.repeat(64), nextState: state }), 'CONFLICT');
    assert.deepEqual(fileOf(dir), before);
  });

  for (const [label, op, expectCode] of [
    ['an interrupted (partial) write', 'write', 'WRITE_FAILED'],
    ['a failed fsync', 'fsync', 'WRITE_FAILED'],
    ['a failed rename', 'rename-target', 'WRITE_FAILED'],
    ['a failed backup', 'rename-backup', 'BACKUP_FAILED'],
  ]) {
    test(`${label} leaves the original file intact and readable, and no temp file of ours behind`, () => {
      const { dir } = seeded();
      const before = fileOf(dir);
      const io = faultyIo((kind, p) => {
        if (op === 'write' && kind === 'write' && isTargetTemp(p)) return eio();
        if (op === 'fsync' && kind === 'fsync' && isTargetTemp(p)) return eio();
        if (op === 'rename-target' && kind === 'rename' && path.basename(p) === 'app-state.json') return eio();
        if (op === 'rename-backup' && kind === 'rename' && path.basename(p) === 'app-state.json.bak.1') return eio();
        return null;
      });
      const store = createProjectStore({ dataDir: dir, io, now: () => NOW, newId: ids });
      const { version } = store.read();
      code(() => store.apply({ expectedVersion: version, command: { type: 'add', input: { name: 'x' } } }), expectCode);
      assert.deepEqual(fileOf(dir), before);
      assert.equal(store.read().version, version);
      assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-') || f.endsWith('.lock')), []);
    });
  }

  test('stale temp files from a crashed writer are ignored (never read as state) and left in place', () => {
    const { dir, store } = seeded();
    const stale = path.join(dir, '.app-state.json.tmp-99999-deadbeef');
    fs.writeFileSync(stale, '{"projects": [', { mode: 0o600 });
    const { version } = store.read();
    store.apply({ expectedVersion: version, command: { type: 'add', input: { name: 'after crash' } } });
    assert.equal(store.read().state.projects.at(-1).name, 'after crash');
    assert.equal(fs.readFileSync(stale, 'utf8'), '{"projects": [');
  });

  test('corrupt state is reported, never replaced by defaults; a verified backup restore keeps the corrupt bytes aside', () => {
    const { dir, store } = seeded();
    let { version } = store.read();
    ({ version } = store.apply({ expectedVersion: version, command: { type: 'add', input: { name: 'good' } } }));
    const corrupt = Buffer.from('{"projects": [ truncated');
    fs.writeFileSync(path.join(dir, 'app-state.json'), corrupt, { mode: 0o600 });
    code(() => store.read(), 'CORRUPT_STATE');
    code(() => store.apply({ expectedVersion: version, command: { type: 'archive', id: 'p1' } }), 'CORRUPT_STATE');
    assert.deepEqual(fileOf(dir), corrupt, 'nothing rewrote the corrupt file');
    const raw = store.rawVersion();
    code(() => store.restoreBackup({ generation: 1, expectedCurrentVersion: 'f'.repeat(64) }), 'CONFLICT');
    store.restoreBackup({ generation: 1, expectedCurrentVersion: raw });
    assert.deepEqual(store.read().state, syntheticState(), 'generation 1 is the state before the last commit');
    assert.deepEqual(fileOf(dir, `app-state.json.pre-restore-${raw.slice(0, 16)}`), corrupt);
  });

  test('invalid UTF-8, a byte-order mark and oversize files are refused', () => {
    for (const bytes of [Buffer.from([0x7b, 0xff, 0x7d]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(syntheticState()))])]) {
      const dir = tempDir();
      fs.writeFileSync(path.join(dir, 'app-state.json'), bytes, { mode: 0o600 });
      code(() => createProjectStore({ dataDir: dir }).read(), 'CORRUPT_STATE');
    }
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'app-state.json'), Buffer.alloc(LIMITS.maxStateBytes + 1, 0x20), { mode: 0o600 });
    code(() => createProjectStore({ dataDir: dir }).read(), 'LIMIT_EXCEEDED');
  });

  test('symlinked or hard-linked targets, symlinked backups, wrong permissions and unsafe data dirs are refused', () => {
    // symlinked target: the file it points at must stay untouched
    const outside = path.join(tempDir(), 'elsewhere.json');
    fs.writeFileSync(outside, JSON.stringify(syntheticState()), { mode: 0o600 });
    const before = fs.readFileSync(outside);
    const d1 = tempDir();
    fs.symlinkSync(outside, path.join(d1, 'app-state.json'));
    code(() => createProjectStore({ dataDir: d1 }).read(), 'UNSAFE_TARGET');
    code(() => createProjectStore({ dataDir: d1 }).commit({ expectedVersion: ABSENT_VERSION, nextState: syntheticState() }), 'UNSAFE_TARGET');
    assert.deepEqual(fs.readFileSync(outside), before);
    // hard link
    const d2 = tempDir();
    const extra = path.join(tempDir(), 'hard.json');
    fs.writeFileSync(extra, JSON.stringify(syntheticState()), { mode: 0o600 });
    fs.linkSync(extra, path.join(d2, 'app-state.json'));
    code(() => createProjectStore({ dataDir: d2 }).read(), 'UNSAFE_TARGET');
    // group-writable target
    const { dir: d3, store: s3 } = seeded();
    fs.chmodSync(path.join(d3, 'app-state.json'), 0o664);
    code(() => s3.read(), 'UNSAFE_TARGET');
    // symlinked backup generation: refused before the target is touched
    const { dir: d4, store: s4 } = seeded();
    const target4 = fileOf(d4);
    fs.symlinkSync(outside, path.join(d4, 'app-state.json.bak.2'));
    const { version } = s4.read();
    code(() => s4.apply({ expectedVersion: version, command: { type: 'add', input: { name: 'x' } } }), 'UNSAFE_TARGET');
    assert.deepEqual(fileOf(d4), target4);
    assert.deepEqual(fs.readFileSync(outside), before);
    // data directory: relative path, symlinked dir, missing dir, world-writable dir
    code(() => createProjectStore({ dataDir: 'data' }), 'UNSAFE_TARGET');
    const realDir = tempDir();
    const linkDir = path.join(ROOT, 'linked-dir');
    fs.symlinkSync(realDir, linkDir);
    code(() => createProjectStore({ dataDir: linkDir }), 'UNSAFE_TARGET');
    code(() => createProjectStore({ dataDir: path.join(ROOT, 'missing') }), 'UNSAFE_TARGET');
    const open = tempDir();
    fs.chmodSync(open, 0o777);
    code(() => createProjectStore({ dataDir: open }), 'UNSAFE_TARGET');
  });

  test('a held lock blocks writers (LOCKED), is never broken automatically, and our own lock is always released', () => {
    const { dir, store } = seeded();
    const { version } = store.read();
    const lock = path.join(dir, 'app-state.json.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: 1, token: 'someone-else' }), { mode: 0o600 });
    code(() => store.apply({ expectedVersion: version, command: { type: 'add', input: { name: 'x' } } }), 'LOCKED');
    assert.ok(fs.existsSync(lock), 'a foreign lock is left alone');
    fs.unlinkSync(lock);
    code(() => store.commit({ expectedVersion: 'f'.repeat(64), nextState: store.read().state }), 'CONFLICT');
    assert.equal(fs.existsSync(lock), false, 'released after a refused commit');
    store.apply({ expectedVersion: version, command: { type: 'add', input: { name: 'x' } } });
    assert.equal(fs.existsSync(lock), false, 'released after a successful commit');
  });
});

// ---------------------------------------------------------------------------------------------------- D. concurrency
const STORE_URL = pathToFileURL(path.join(REPO_ROOT, 'server/projectManagementStore.mjs')).href;
function runWorker(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('exit', (status) => (status === 0 ? resolve(out.trim()) : reject(new Error(`worker exit ${status}: ${err}`))));
  });
}
const WORKER = `
const [storeUrl, dir, go, name, mode, baseVersion] = process.argv.slice(1);
const { createProjectStore } = await import(storeUrl);
const fs = await import('node:fs');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
while (!fs.existsSync(go)) sleep(2);
const store = createProjectStore({ dataDir: dir });
if (mode === 'once') {
  try { store.apply({ expectedVersion: baseVersion, command: { type: 'add', input: { name } } }); console.log('OK'); }
  catch (e) { console.log(e.code); }
} else {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try { const { version } = store.read(); store.apply({ expectedVersion: version, command: { type: 'add', input: { name } } }); console.log('OK'); process.exit(0); }
    catch (e) { if (e.code !== 'CONFLICT' && e.code !== 'LOCKED') { console.log(e.code); process.exit(0); } sleep(1 + Math.floor(Math.random() * 8)); }
  }
  console.log('GAVE_UP');
}`;

describe('D. concurrency: stale callers are refused and no update is lost', () => {
  test('two independent store instances: the stale one gets CONFLICT, re-reads, and both changes survive', () => {
    const { dir } = seeded();
    const a = createProjectStore({ dataDir: dir, now: () => NOW, newId: ids });
    const b = createProjectStore({ dataDir: dir, now: () => NOW, newId: ids });
    const seenByA = a.read().version;
    const seenByB = b.read().version;
    a.apply({ expectedVersion: seenByA, command: { type: 'edit', id: 'p1', patch: { name: 'from A' } } });
    code(() => b.apply({ expectedVersion: seenByB, command: { type: 'edit', id: 'p3', patch: { name: 'from B' } } }), 'CONFLICT');
    b.apply({ expectedVersion: b.read().version, command: { type: 'edit', id: 'p3', patch: { name: 'from B' } } });
    const names = a.read().state.projects.map((p) => p.name);
    assert.deepEqual([names[0], names[2]], ['from A', 'from B']);
  });

  test('8 processes racing from the same version: exactly one succeeds, the others are refused', async () => {
    const { dir, store } = seeded();
    const go = path.join(ROOT, `go-once-${Date.now()}`);
    const base = store.read().version;
    const runs = Array.from({ length: 8 }, (_, i) => runWorker(WORKER, [STORE_URL, dir, go, `once-${i}`, 'once', base]));
    fs.writeFileSync(go, '');
    const results = await Promise.all(runs);
    assert.equal(results.filter((r) => r === 'OK').length, 1, results.join(','));
    assert.ok(results.every((r) => ['OK', 'CONFLICT', 'LOCKED'].includes(r)), results.join(','));
    assert.equal(store.read().state.projects.length, 4);
  });

  test('8 processes racing with re-read and retry: all 8 additions are present (no lost update)', async () => {
    const { dir, store } = seeded();
    const go = path.join(ROOT, `go-retry-${Date.now()}`);
    const runs = Array.from({ length: 8 }, (_, i) => runWorker(WORKER, [STORE_URL, dir, go, `retry-${i}`, 'retry', '']));
    fs.writeFileSync(go, '');
    const results = await Promise.all(runs);
    assert.deepEqual(results, Array(8).fill('OK'));
    const names = store.read().state.projects.map((p) => p.name).filter((n) => n.startsWith('retry-')).sort();
    assert.deepEqual(names, Array.from({ length: 8 }, (_, i) => `retry-${i}`).sort());
    assert.equal(new Set(store.read().state.projects.map((p) => p.id)).size, 11, 'ids stay unique');
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-') || f.endsWith('.lock')), []);
  });
});

// ---------------------------------------------------------------------------------------------------- E. V1 boundary regression (static)
describe('E. the V1 read-only server is unchanged and cannot reach the new modules', () => {
  const NEW = ['server/projectManagementSchema.mjs', 'server/projectManagementCommands.mjs', 'server/projectManagementStore.mjs'];
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const sourceFiles = (dir) => fs.readdirSync(path.join(REPO_ROOT, dir), { recursive: true })
    .filter((f) => /\.(mjs|ts|tsx|js)$/.test(f) && !f.includes('node_modules')).map((f) => path.join(dir, f));

  // V1.2B (Issue #90 V1_2B_TEST_CONTRACT_AMENDMENT): exactly these two files may use the foundation modules. Any other
  // importer, including server.ts or the V1 app, is still a failure.
  const AUTHORIZED_IMPORTERS = ['server/v1ProjectManagementRoutes.mjs', 'src/v1/ManageProjects.test.tsx'];

  test('only the explicitly authorized V1.2B files import the project management modules', () => {
    const importers = [...sourceFiles('server'), ...sourceFiles('src'), 'server.ts']
      .filter((f) => !NEW.includes(f) && /projectManagement(Schema|Commands|Store)/.test(read(f)));
    assert.deepEqual(importers.filter((f) => !AUTHORIZED_IMPORTERS.includes(f)), [], 'unexpected importer of the project management modules');
    assert.deepEqual([...importers].sort(), [...AUTHORIZED_IMPORTERS].sort(), 'the authorized importers are exactly the expected ones');
  });

  test('the V1 read-only router keeps its original routes; server.ts mounts only the scoped V1.2 project router', () => {
    const v1 = read('server/v1ReadOnlyRoutes.mjs');
    assert.deepEqual([...v1.matchAll(/router\.(get|post|put|patch|delete|all|use)\(\s*'([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`), ['get /health', 'get /state', 'use /github']);
    assert.doesNotMatch(v1, /projectManagement/i, 'the V1 read-only router does not reach the project writer');
    const server = read('server.ts');
    assert.doesNotMatch(server, /projectManagement(Schema|Commands|Store)/, 'server.ts never uses the foundation modules directly');
    assert.equal([...server.matchAll(/createV1ProjectManagementRouter\(/g)].length, 1, 'exactly one project router is mounted');
    assert.match(server, /from '\.\/server\/v1ProjectManagementRoutes\.mjs'/);
    const router = read('server/v1ProjectManagementRoutes.mjs');
    assert.deepEqual([...router.matchAll(/router\.(get|post|put|patch|delete|all|use)\(\s*'([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`), ['get /projects', 'post /projects/commands'], 'the single scoped writer and its read model');
  });

  test('the new modules use no network, child process, provider, git or gh facility', () => {
    for (const rel of NEW) {
      const src = read(rel);
      assert.doesNotMatch(src, /node:(child_process|net|http|https|dgram|tls|dns|worker_threads)|\bfetch\(|execFile|spawn\(|\bgh\b|['"]git['"]|GoogleGenAI|openai|anthropic/i, rel);
    }
  });

  test('every fixture of this file lives under the task temp root', () => {
    assert.ok(ROOT.startsWith(fs.realpathSync(os.tmpdir())) || ROOT.startsWith(os.tmpdir()));
    assert.ok(!ROOT.startsWith(REPO_ROOT));
  });
});
