import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectRegistry } from '../server/tasks/projectRegistry.mjs';

const project = (overrides = {}) => ({
  projectId: 'demo',
  repository: 'me/demo',
  localPath: '/srv/repos/demo',
  defaultBranch: 'main',
  worktreeRoot: '/srv/worktrees/demo',
  allowedAgents: ['codex'],
  allowedActions: ['READ_REPO', 'RUN_TESTS', 'RUN_LINT', 'RUN_BUILD'],
  verifyCommands: {
    test: { command: 'npm', args: ['test'] },
    lint: { command: 'npm', args: ['run', 'lint'] },
    build: { command: 'npm', args: ['run', 'build'] },
  },
  protectedPaths: ['AGENTS.md'],
  agentBinaries: {},
  setupCommand: 'npm ci',
  ...overrides,
});

const registry = (value) => new ProjectRegistry({ projects: [value] });

test('registry rejects legacy strings, malformed structured commands, and command extras', () => {
  const invalid = [
    'npm test',
    { command: '', args: [] },
    { command: 'npm', args: 'test' },
    { command: 'npm', args: ['test', 2] },
    { command: 'npm\0evil', args: [] },
    { command: 'npm', args: ['test\0evil'] },
    { command: 'npm', args: [], shell: true },
    { command: 'npm', args: [], env: { PATH: '/tmp' } },
    { command: 'npm', args: [], unexpected: 'value' },
  ];
  for (const verifyCommand of invalid) {
    assert.throws(() => registry(project({ verifyCommands: { test: verifyCommand } })), undefined, JSON.stringify(verifyCommand));
  }
});

test('registry requires a structured command for every permitted verification action', () => {
  for (const [action, key] of [['RUN_TESTS', 'test'], ['RUN_LINT', 'lint'], ['RUN_BUILD', 'build']]) {
    const commands = { ...project().verifyCommands };
    delete commands[key];
    assert.throws(() => registry(project({ verifyCommands: commands })), new RegExp(action));
  }
});

test('registry clones and freezes nested policy and argv data', () => {
  const source = project();
  const loaded = registry(source);
  source.allowedActions.push('DEPLOY');
  source.allowedAgents[0] = 'claude-code';
  source.verifyCommands.test.args.push('--force');
  source.protectedPaths[0] = 'secrets';

  const stored = loaded.get('demo');
  assert.deepEqual(stored.allowedActions, ['READ_REPO', 'RUN_TESTS', 'RUN_LINT', 'RUN_BUILD']);
  assert.deepEqual(stored.allowedAgents, ['codex']);
  assert.deepEqual(stored.verifyCommands.test, { command: 'npm', args: ['test'] });
  assert.deepEqual(stored.protectedPaths, ['AGENTS.md']);
  for (const mutate of [
    () => { stored.allowedAgents[0] = 'claude-code'; },
    () => stored.allowedActions.push('DEPLOY'),
    () => { stored.verifyCommands.lint.args[0] = 'evil'; },
    () => { stored.verifyCommands.test.args[0] = 'evil'; },
    () => stored.protectedPaths.push('secrets'),
    () => { stored.agentBinaries.claude = '/bin/sh'; },
  ]) assert.throws(mutate, TypeError);
});

test('registry rejects non-string identifiers instead of coercing them', () => {
  assert.throws(() => registry(project({ projectId: { toString: () => 'demo' } })));
  assert.throws(() => registry(project({ repository: { toString: () => 'me/demo' } })));
  assert.throws(() => registry(project({ defaultBranch: { toString: () => 'main' } })));
});
