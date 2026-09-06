const NON_AUTHORITATIVE = new Set(['fixture', 'user-entered', 'AI-candidate']);

const REQUIRED_AUTHORITY = new Map([
  ['APPROVED', 'GitHub-observed'],
  ['Verified', 'CI-observed'],
  ['GitHub-synced', 'GitHub-observed'],
  ['Live', 'deployment-observed'],
  ['DONE', 'deployment-observed'],
  ['deployed', 'deployment-observed'],
  ['production-flag-on', 'deployment-observed'],
]);

export function isCompleteProvenance(provenance) {
  return Boolean(
    provenance &&
      typeof provenance.observedAt === 'string' &&
      provenance.observedAt.length > 0 &&
      typeof provenance.evidenceRef === 'string' &&
      provenance.evidenceRef.length > 0 &&
      ['low', 'medium', 'high'].includes(provenance.confidence),
  );
}

export function canAuthorizePromotion({
  target,
  provenance,
  independentReview = false,
  humanApprovalEvidenceRef = '',
  deploymentEvidenceRef = '',
}) {
  if (!isCompleteProvenance(provenance) || NON_AUTHORITATIVE.has(provenance.authority)) return false;
  if (REQUIRED_AUTHORITY.get(target) !== provenance.authority || provenance.confidence !== 'high') return false;
  if (!independentReview || !humanApprovalEvidenceRef) return false;
  if (REQUIRED_AUTHORITY.get(target) === 'deployment-observed' && !deploymentEvidenceRef) return false;
  return true;
}

export function normalizeGeneratedFeature(feature, provenance) {
  const { githubIssue: _githubIssue, shippedVersion: _shippedVersion, ...safe } = feature;
  return {
    ...safe,
    stageStatus: 'Backlog',
    prodStatus: 'Planned',
    flagEnabledInProd: false,
    provenance: { ...provenance, authority: 'AI-candidate', confidence: 'low' },
  };
}

export function provenanceLabel(provenance) {
  if (!provenance || NON_AUTHORITATIVE.has(provenance.authority)) return 'Simulated / Prototype';
  return `${provenance.authority} · ${provenance.confidence}`;
}
