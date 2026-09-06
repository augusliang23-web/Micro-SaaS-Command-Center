import assert from 'node:assert/strict';
import test from 'node:test';

import { getVerdict, getVerdictStyle } from '../src/verdict.mjs';

test('BLOCKED projects get the danger verdict using the blocker text', () => {
  const verdict = getVerdict({ waitingState: 'BLOCKED', blocker: 'Missing STRIPE_WEBHOOK_SECRET' });
  assert.equal(verdict.level, 'danger');
  assert.equal(verdict.explanation, 'Missing STRIPE_WEBHOOK_SECRET');
  assert.equal(verdict.hasAction, true);
  assert.equal(verdict.isWaiting, false);
  assert.equal(verdict.source, 'manual');
});

test('BLOCKED without blocker text falls back to a generic explanation', () => {
  const verdict = getVerdict({ waitingState: 'BLOCKED', blocker: null });
  assert.equal(verdict.level, 'danger');
  assert.match(verdict.explanation, /卡住/);
});

test('WAITING_FOR_HUMAN with a blocker is a decision verdict', () => {
  const verdict = getVerdict({ waitingState: 'WAITING_FOR_HUMAN', blocker: 'Pick a policy' });
  assert.equal(verdict.level, 'decision');
  assert.equal(verdict.explanation, 'Pick a policy');
  assert.equal(verdict.hasAction, true);
});

test('WAITING_FOR_HUMAN with no blocker is a ready verdict using nextAction', () => {
  const verdict = getVerdict({ waitingState: 'WAITING_FOR_HUMAN', blocker: null, nextAction: 'Ready to merge PR #89' });
  assert.equal(verdict.level, 'ready');
  assert.equal(verdict.explanation, 'Ready to merge PR #89');
});

test('AI_RUNNING and AUTOMATION_IDLE both get the waiting verdict with no action', () => {
  const running = getVerdict({ waitingState: 'AI_RUNNING', blocker: null, nextAction: 'Running tests' });
  const idle = getVerdict({ waitingState: 'AUTOMATION_IDLE', blocker: null });
  assert.equal(running.level, 'waiting');
  assert.equal(running.explanation, 'Running tests');
  assert.equal(running.hasAction, false);
  assert.equal(running.isWaiting, true);
  assert.equal(idle.level, 'waiting');
});

test('getVerdictStyle returns a color set per level and falls back for unknown levels', () => {
  assert.equal(getVerdictStyle('danger').headlineColor, '#e11d48');
  assert.equal(getVerdictStyle('ready').headlineColor, '#059669');
  assert.deepEqual(getVerdictStyle('nonsense'), getVerdictStyle('waiting'));
});

// --- Real GitHub-state-driven path (a githubState argument overrides manual fields) ---

const manualProject = { waitingState: 'WAITING_FOR_HUMAN', blocker: 'stale manual blocker text' };

test('a githubState argument takes priority over the project manual fields', () => {
  const verdict = getVerdict(manualProject, { state: 'none' });
  assert.equal(verdict.source, 'github');
  assert.notEqual(verdict.explanation, manualProject.blocker);
});

test('github state "none" is a waiting verdict (no code observed yet)', () => {
  const verdict = getVerdict(manualProject, { state: 'none' });
  assert.equal(verdict.level, 'waiting');
});

test('github state "merged" is a ready verdict that is honest about not implying deployment', () => {
  const verdict = getVerdict(manualProject, { state: 'merged', prNumber: 9 });
  assert.equal(verdict.level, 'ready');
  assert.match(verdict.explanation, /PR #9/);
  assert.match(verdict.explanation, /上線流程/);
});

test('a mergedAt / lastCommitAt timestamp surfaces as real relative time, proving the data is live', () => {
  const recentlyMerged = getVerdict(manualProject, {
    state: 'merged',
    prNumber: 1,
    mergedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  });
  assert.match(recentlyMerged.explanation, /45 分鐘前/);

  const recentPush = getVerdict(manualProject, {
    state: 'active',
    ciStatus: 'none',
    lastCommitMessage: 'chore: x',
    lastCommitAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  });
  assert.match(recentPush.explanation, /3 小時前/);
});

test('an open draft PR is waiting regardless of CI/review state', () => {
  const verdict = getVerdict(manualProject, {
    state: 'open',
    isDraft: true,
    ciStatus: 'passing',
    reviewDecision: 'approved',
  });
  assert.equal(verdict.level, 'waiting');
});

test('open PR with failing CI is danger', () => {
  const verdict = getVerdict(manualProject, {
    state: 'open',
    isDraft: false,
    ciStatus: 'failing',
    reviewDecision: 'review_required',
  });
  assert.equal(verdict.level, 'danger');
});

test('open PR with changes requested is danger even if CI passed', () => {
  const verdict = getVerdict(manualProject, {
    state: 'open',
    isDraft: false,
    ciStatus: 'passing',
    reviewDecision: 'changes_requested',
  });
  assert.equal(verdict.level, 'danger');
});

test('open PR with CI running (and no changes requested) is waiting', () => {
  const verdict = getVerdict(manualProject, {
    state: 'open',
    isDraft: false,
    ciStatus: 'running',
    reviewDecision: 'review_required',
  });
  assert.equal(verdict.level, 'waiting');
});

test('open PR with passing CI and no blocking review is ready', () => {
  const verdict = getVerdict(manualProject, {
    state: 'open',
    isDraft: false,
    ciStatus: 'passing',
    reviewDecision: 'approved',
  });
  assert.equal(verdict.level, 'ready');
});

test('the github path never returns the decision level (no product-decision signal exists in GitHub)', () => {
  const scenarios = [
    { state: 'none' },
    { state: 'merged', prNumber: 1 },
    { state: 'open', isDraft: true },
    { state: 'open', isDraft: false, ciStatus: 'failing' },
    { state: 'open', isDraft: false, ciStatus: 'passing', reviewDecision: 'changes_requested' },
    { state: 'open', isDraft: false, ciStatus: 'running' },
    { state: 'open', isDraft: false, ciStatus: 'passing', reviewDecision: 'approved' },
    { state: 'active', ciStatus: 'none', lastCommitMessage: 'x' },
  ];
  for (const githubState of scenarios) {
    assert.notEqual(getVerdict(manualProject, githubState).level, 'decision');
  }
});

// --- "active" state: direct pushes to the default branch past any known PR ---

test('active state with passing/no CI is waiting, and names the real commit message', () => {
  const verdict = getVerdict(manualProject, {
    state: 'active',
    ciStatus: 'none',
    lastCommitMessage: 'chore: isolate local UAT emulator tooling',
  });
  assert.equal(verdict.level, 'waiting');
  assert.match(verdict.explanation, /chore: isolate local UAT emulator tooling/);
  assert.equal(verdict.source, 'github');
});

test('active state with failing CI is danger', () => {
  const verdict = getVerdict(manualProject, {
    state: 'active',
    ciStatus: 'failing',
    lastCommitMessage: 'fix: something broke',
  });
  assert.equal(verdict.level, 'danger');
  assert.match(verdict.explanation, /fix: something broke/);
});
