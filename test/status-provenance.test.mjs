import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAuthorizePromotion,
  isCompleteProvenance,
  normalizeGeneratedFeature,
  provenanceLabel,
} from '../src/statusProvenance.mjs';

const fixture = {
  authority: 'fixture',
  observedAt: '2026-09-01T00:00:00.000Z',
  evidenceRef: 'fixture:project:environment',
  confidence: 'low',
};

for (const target of ['APPROVED', 'Verified', 'Live', 'DONE', 'deployed', 'GitHub-synced', 'production-flag-on']) {
  test(`fixture provenance cannot authorize ${target}`, () => {
    assert.equal(canAuthorizePromotion({ target, provenance: fixture }), false);
  });
}

test('user-entered and AI-candidate provenance cannot authorize promotion either', () => {
  assert.equal(
    canAuthorizePromotion({ target: 'DONE', provenance: { ...fixture, authority: 'user-entered' } }),
    false,
  );
  assert.equal(
    canAuthorizePromotion({ target: 'DONE', provenance: { ...fixture, authority: 'AI-candidate' } }),
    false,
  );
});

test('a high-confidence deployment-observed record is still denied without human + deployment evidence', () => {
  const deploymentObserved = {
    authority: 'deployment-observed',
    observedAt: '2026-09-05T00:00:00.000Z',
    evidenceRef: 'deployment:run-123',
    confidence: 'high',
  };
  assert.equal(canAuthorizePromotion({ target: 'DONE', provenance: deploymentObserved }), false);
  assert.equal(
    canAuthorizePromotion({
      target: 'DONE',
      provenance: deploymentObserved,
      independentReview: true,
      humanApprovalEvidenceRef: 'human:augus',
    }),
    false,
  );
  assert.equal(
    canAuthorizePromotion({
      target: 'DONE',
      provenance: deploymentObserved,
      independentReview: true,
      humanApprovalEvidenceRef: 'human:augus',
      deploymentEvidenceRef: 'deployment:run-123',
    }),
    true,
  );
});

test('isCompleteProvenance rejects missing fields', () => {
  assert.equal(isCompleteProvenance(null), false);
  assert.equal(isCompleteProvenance({ authority: 'fixture' }), false);
  assert.equal(isCompleteProvenance({ ...fixture, confidence: 'certain' }), false);
  assert.equal(isCompleteProvenance(fixture), true);
});

test('AI candidate features normalize to a non-authoritative backlog item', () => {
  const normalized = normalizeGeneratedFeature(
    { name: 'Generated', stageStatus: 'Verified', prodStatus: 'Live', flagEnabledInProd: true, githubIssue: '#42' },
    { ...fixture, authority: 'AI-candidate', evidenceRef: 'ai-candidate:generated' },
  );
  assert.equal(normalized.stageStatus, 'Backlog');
  assert.equal(normalized.prodStatus, 'Planned');
  assert.equal(normalized.flagEnabledInProd, false);
  assert.equal(normalized.githubIssue, undefined);
  assert.equal(normalized.provenance.authority, 'AI-candidate');
});

test('provenanceLabel renders a Simulated / Prototype label for non-authoritative sources', () => {
  assert.equal(provenanceLabel(fixture), 'Simulated / Prototype');
  assert.equal(provenanceLabel(undefined), 'Simulated / Prototype');
  assert.equal(
    provenanceLabel({ authority: 'CI-observed', confidence: 'high', observedAt: 'x', evidenceRef: 'y' }),
    'CI-observed · high',
  );
});
