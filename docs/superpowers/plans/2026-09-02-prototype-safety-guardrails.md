# Prototype State Provenance & Safety Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every operational-looking value in the Prototype visibly non-authoritative, prevent fixture or AI data from promoting protected states, repair the confirmed Selective Release defects, and provide safe local verification without exposing backend/provider routes.

**Architecture:** A pure `statusProvenance.mjs` policy is shared by the React application and the mandatory Node built-in test. Typed fixture provenance flows through existing project records and renderers; `VITE_PROTOTYPE_SAFE_MODE=true` disables backend-triggering controls and permits a loopback-only Vite verification surface.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, npm 10.8.2, Vitest 3.2.4, jsdom 26.1.0, React Testing Library 16.3.0, jest-dom 6.6.3, user-event 14.6.1, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-bridge-onboarding-design.md`

## Global Constraints

- Execute only from the Bridge-created Issue branch after exact labels `model:terra`, `risk:medium`, and `bridge:ready`, plus the exact body line `- Reasoning Effort: Medium`, have been independently verified.
- Allowed application files are exactly those listed in the approved spec; tests may be created only under `src/**/*.test.ts`, `src/**/*.test.tsx`, `src/test/setup.ts`, and `test/**/*.test.mjs`.
- Allowed package changes are `package.json`, deletion of `bun.lock`, and one generated `package-lock.json`.
- Do not modify or start `server.ts`; do not read or invoke `.env*`, `/api/bridge/chatgpt-advice`, `/api/bridge/extract-features`, OpenAI, Gemini, GitHub integrations, feature-flag providers, CI/CD runners, persistence, auth, billing, deployment, secrets, or production automation.
- The only allowed environment value is literal non-secret `VITE_PROTOTYPE_SAFE_MODE=true` for the separately authorized loopback verification command. AI keys and `APP_URL` stay unset.
- Fixture, user-entered, and AI-candidate values never authorize `APPROVED`, `Verified`, `Live`, `DONE`, deployed, GitHub-synced, or production flag-on state.
- npm registry access and loopback UI execution are separate authorization gates. Missing authority stops `BLOCKED_DECISION`; unsafe config or unavailable tooling stops `BLOCKED_ENVIRONMENT`.
- Run tests without application or provider network access. Stop at `READY_FOR_REVIEW`; do not approve, merge, deploy, or release.

## File Structure

| File | Responsibility |
|---|---|
| `src/statusProvenance.mjs` | Pure promotion policy, generated-feature normalization, and display label helpers |
| `test/statusProvenance.test.mjs` | Mandatory Node built-in contract tests used by Bridge V0.3.1 |
| `src/types.ts` | Typed provenance authority, confidence, field map, and record contracts |
| `src/mockData.ts` | Stable fixture evidence references for every simulated record |
| `src/test/setup.ts` | jest-dom setup and zero-network test guard |
| `src/statusProvenance.test.ts` | Vitest coverage for the shared pure policy |
| `src/App.test.tsx` | Global banner and protected-state simulation tests |
| `src/components/PortfolioOverview.test.tsx` | Status badge, table, and responsive-region tests |
| `src/components/ProjectDetailDrawer.test.tsx` | Provenance, safe links, dialog, focus, and keyboard tests |
| `src/components/FeatureDeliveryMatrix.test.tsx` | Safe-mode, candidate normalization, and flag/release semantics tests |
| `src/components/SelectiveReleaseModal.test.tsx` | Hook stability and single-toggle regression tests |
| `src/components/ErrorBoundary.test.tsx` | Honest browser-memory recovery wording test |
| Existing allowed React files | Render provenance, safe copy, simulation-only actions, and accessibility behavior |
| `package.json` / `package-lock.json` | Canonical npm scripts and exact dependency graph |

---

### Task 1: Normalize npm and Establish a Zero-Network Test Harness

**Files:**
- Modify: `package.json`
- Delete: `bun.lock`
- Create: `package-lock.json`
- Create: `src/test/setup.ts`
- Test: `src/test/setup.test.ts`

**Interfaces:**
- Consumes: separately recorded public npm-registry authorization.
- Produces: npm 10.8.2 authority, `npm test`, `npm run verify:ui`, jsdom setup, and a test-time network guard.

- [ ] **Step 1: Run the no-secret npm preflight**

Run before any npm command:

```bash
test ! -e .npmrc
node --input-type=module -e "const denied=Object.keys(process.env).filter((name)=>/^npm_config_/i.test(name)||['NPM_TOKEN','NODE_AUTH_TOKEN','NPM_AUTH_TOKEN'].includes(name)); if(denied.length){console.error(JSON.stringify({blockedEnvironmentVariableNames:denied})); process.exit(2)}"
```

Expected: project `.npmrc` is absent and the Node check exits `0`. It prints names only on failure; never inspect values. If either check fails, stop `BLOCKED_ENVIRONMENT`.

- [ ] **Step 2: Create clean temporary npm config files**

```bash
safety_npm_userconfig="$(mktemp /tmp/micro-saas-npm-user.XXXXXX)"
safety_npm_globalconfig="$(mktemp /tmp/micro-saas-npm-global.XXXXXX)"
test -f "$safety_npm_userconfig"
test -f "$safety_npm_globalconfig"
```

Expected: two empty temporary files. Do not read user or global `.npmrc` files.

- [ ] **Step 3: Change package authority with an exact manifest edit**

Use `apply_patch` to add:

```json
{
  "packageManager": "npm@10.8.2",
  "scripts": {
    "test": "vitest run --environment jsdom --setupFiles src/test/setup.ts",
    "verify:ui": "VITE_PROTOTYPE_SAFE_MODE=true vite --host 127.0.0.1 --port 4173 --strictPort"
  }
}
```

Preserve every existing script and dependency. Then remove the tracked `bun.lock` with `git rm -- bun.lock`; do not create a second lockfile first.

- [ ] **Step 4: Add exact test dependencies and generate only the npm lockfile**

```bash
npm install --save-dev --package-lock-only --ignore-scripts \
  --userconfig "$safety_npm_userconfig" \
  --globalconfig "$safety_npm_globalconfig" \
  --registry=https://registry.npmjs.org/ \
  --always-auth=false \
  vitest@3.2.4 jsdom@26.1.0 @testing-library/react@16.3.0 \
  @testing-library/jest-dom@6.6.3 @testing-library/user-event@14.6.1
```

Expected: `package.json` contains only those added test packages; one `package-lock.json` exists; `bun.lock` is deleted; no lifecycle scripts ran.

- [ ] **Step 5: Review the lockfile before installing**

```bash
test ! -f bun.lock
test -f package-lock.json
git diff -- package.json package-lock.json bun.lock
git diff --check -- package.json package-lock.json
npm ci --ignore-scripts \
  --userconfig "$safety_npm_userconfig" \
  --globalconfig "$safety_npm_globalconfig" \
  --registry=https://registry.npmjs.org/ \
  --always-auth=false
```

Expected: npm installs exactly from the reviewed lockfile without scripts.

After installation, remove only the two empty task-created config files:

```bash
/usr/bin/unlink "$safety_npm_userconfig"
/usr/bin/unlink "$safety_npm_globalconfig"
```

- [ ] **Step 6: Write the failing zero-network setup test**

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterAll, beforeAll, vi } from 'vitest';

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    throw new Error(`Network forbidden in tests: ${String(input)}`);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
```

Create `src/test/setup.test.ts`:

```ts
import { expect, test } from 'vitest';

test('test harness rejects network requests', async () => {
  await expect(fetch('/api/bridge/chatgpt-advice')).rejects.toThrow(
    'Network forbidden in tests',
  );
});
```

- [ ] **Step 7: Run the focused harness test**

```bash
npm test -- src/test/setup.test.ts
```

Expected: one passing test and no network request.

- [ ] **Step 8: Commit package normalization and harness**

```bash
git add package.json package-lock.json bun.lock src/test/setup.ts src/test/setup.test.ts
git diff --cached --check
git commit -m "test: establish safe npm verification harness"
```

### Task 2: Implement the Shared Provenance Policy with Node TDD

**Files:**
- Create: `src/statusProvenance.mjs`
- Create: `test/statusProvenance.test.mjs`
- Create: `src/statusProvenance.test.ts`

**Interfaces:**
- Produces: `canAuthorizePromotion(input)`, `normalizeGeneratedFeature(feature, provenance)`, `provenanceLabel(provenance)`, and `isCompleteProvenance(provenance)`.
- Consumers: every later UI task and both test runners.

- [ ] **Step 1: Write the failing Node built-in policy tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAuthorizePromotion,
  normalizeGeneratedFeature,
} from '../src/statusProvenance.mjs';

const fixture = {
  authority: 'fixture',
  observedAt: '2026-09-01T00:00:00.000Z',
  evidenceRef: 'fixture:project:environment',
  confidence: 'low',
};

for (const target of ['APPROVED', 'Verified', 'Live', 'DONE', 'deployed', 'GitHub-synced', 'production-flag-on']) {
  test(`fixture cannot authorize ${target}`, () => {
    assert.equal(canAuthorizePromotion({ target, provenance: fixture }), false);
  });
}

test('AI candidate normalizes to a non-authoritative backlog item', () => {
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
```

- [ ] **Step 2: Run the test and verify the expected red state**

```bash
node --test test/statusProvenance.test.mjs
```

Expected: FAIL with module-not-found for `src/statusProvenance.mjs`.

- [ ] **Step 3: Implement the minimal pure policy**

```js
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
```

- [ ] **Step 4: Run Node and Vitest policy tests**

Add `src/statusProvenance.test.ts` with the same denial matrix plus one high-confidence deployment case that remains denied without both human and deployment evidence. Then run:

```bash
node --test test/statusProvenance.test.mjs
npm test -- src/statusProvenance.test.ts
```

Expected: both commands pass.

- [ ] **Step 5: Commit the pure policy**

```bash
git add src/statusProvenance.mjs src/statusProvenance.test.ts test/statusProvenance.test.mjs
git diff --cached --check
git commit -m "feat: add fail-closed status provenance policy"
```

### Task 3: Type and Populate Stable Fixture Provenance

**Files:**
- Modify: `src/types.ts`
- Modify: `src/mockData.ts`
- Test: `src/mockData.test.ts`

**Interfaces:**
- Consumes: Task 2 policy vocabulary.
- Produces: `StatusProvenance`, `ProjectProvenance`, and provenance on every rendered fixture record.

- [ ] **Step 1: Write the failing fixture completeness test**

```ts
import { describe, expect, test } from 'vitest';
import { initialAttentionItems, initialExecutionSnapshot, initialNextBestAction, initialProjects } from './mockData';

describe('fixture provenance', () => {
  test('every rendered record has a stable fixture evidence reference', () => {
    for (const project of initialProjects) {
      expect(Object.values(project.provenance).every((item) => item.authority === 'fixture')).toBe(true);
      expect(project.gates.every((gate) => gate.provenance.evidenceRef.startsWith('fixture:'))).toBe(true);
      expect(project.activityHistory.every((item) => item.provenance.evidenceRef.startsWith('fixture:'))).toBe(true);
      expect((project.features ?? []).every((item) => item.provenance.evidenceRef.startsWith('fixture:'))).toBe(true);
    }
    expect(initialAttentionItems.every((item) => item.provenance.authority === 'fixture')).toBe(true);
    expect(initialNextBestAction.provenance.authority).toBe('fixture');
    expect(initialExecutionSnapshot.provenance.authority).toBe('fixture');
  });
});
```

- [ ] **Step 2: Run the test and verify red**

```bash
npm test -- src/mockData.test.ts
```

Expected: TypeScript/runtime failures because `provenance` does not exist.

- [ ] **Step 3: Add exact provenance types**

Add to `src/types.ts`:

```ts
export type ProvenanceAuthority =
  | 'fixture'
  | 'user-entered'
  | 'AI-candidate'
  | 'GitHub-observed'
  | 'CI-observed'
  | 'deployment-observed';

export interface StatusProvenance {
  authority: ProvenanceAuthority;
  observedAt: string;
  evidenceRef: string;
  confidence: 'low' | 'medium' | 'high';
}

export type ProjectProvenanceField =
  | 'gate'
  | 'github'
  | 'test'
  | 'review'
  | 'environment'
  | 'featureFlag'
  | 'release'
  | 'activity';

export type ProjectProvenance = Record<ProjectProvenanceField, StatusProvenance>;
```

Require `provenance: StatusProvenance` on `GateStepInfo`, `FeatureItem`, `ActivityItem`, `AttentionItem`, `NextBestAction`, and `AIExecutionSnapshotData`; require `provenance: ProjectProvenance` on `MicroSaaSProject`.

- [ ] **Step 4: Add stable fixture provenance**

At the top of `src/mockData.ts`, add:

```ts
const FIXTURE_OBSERVED_AT = '2026-09-01T00:00:00.000Z';

const fixtureProvenance = (evidenceRef: string): StatusProvenance => ({
  authority: 'fixture',
  observedAt: FIXTURE_OBSERVED_AT,
  evidenceRef: `fixture:${evidenceRef}`,
  confidence: 'low',
});

const projectProvenance = (projectId: string): ProjectProvenance => ({
  gate: fixtureProvenance(`${projectId}:gate`),
  github: fixtureProvenance(`${projectId}:github`),
  test: fixtureProvenance(`${projectId}:test`),
  review: fixtureProvenance(`${projectId}:review`),
  environment: fixtureProvenance(`${projectId}:environment`),
  featureFlag: fixtureProvenance(`${projectId}:feature-flag`),
  release: fixtureProvenance(`${projectId}:release`),
  activity: fixtureProvenance(`${projectId}:activity`),
});
```

Add stable references to every fixture project, gate, feature, activity, attention item, NBA, and execution snapshot. Do not use `Date.now()`, random IDs, URLs, Issue numbers, PR numbers, or Bridge run IDs as evidence.

- [ ] **Step 5: Run fixture and policy tests**

```bash
npm test -- src/mockData.test.ts src/statusProvenance.test.ts
node --test test/statusProvenance.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit typed provenance**

```bash
git add src/types.ts src/mockData.ts src/mockData.test.ts
git diff --cached --check
git commit -m "feat: attach provenance to prototype fixtures"
```

### Task 4: Render the Global Prototype Boundary and Dashboard Provenance

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/CockpitHeader.tsx`
- Modify: `src/components/PortfolioOverview.tsx`
- Modify: `src/components/BridgeWorkflowRail.tsx`
- Modify: `src/components/NeedsAttentionQueue.tsx`
- Modify: `src/components/NextBestActionCard.tsx`
- Modify: `src/components/AIExecutionSnapshot.tsx`
- Test: `src/App.test.tsx`
- Test: `src/components/PortfolioOverview.test.tsx`

**Interfaces:**
- Consumes: `provenanceLabel()` and typed fixture provenance.
- Produces: persistent Prototype boundary, visible badges, simulation-only dashboard copy, and accessible tabs.

- [ ] **Step 1: Write failing global-boundary and tab tests**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import App from './App';

test('renders a persistent Prototype boundary and accessible tabs', async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByText('Simulated / Prototype')).toBeVisible();
  const projects = screen.getByRole('tab', { name: /projects/i });
  const attention = screen.getByRole('tab', { name: /attention/i });
  expect(projects).toHaveAttribute('aria-selected', 'true');
  projects.focus();
  await user.keyboard('{ArrowRight}');
  expect(attention).toHaveFocus();
  expect(attention).toHaveAttribute('aria-selected', 'true');
});

test('dashboard never labels fixture refresh as live synchronization', async () => {
  render(<App />);
  expect(screen.queryByText(/GitHub App Live|Live Sync|deployment verified/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused tests and verify red**

```bash
npm test -- src/App.test.tsx
```

Expected: missing Prototype banner and tab semantics.

- [ ] **Step 3: Add the persistent boundary and tab keyboard model**

In `App.tsx`, render this immediately inside the root application container:

```tsx
<div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950">
  Simulated / Prototype — no GitHub, Bridge, CI/CD, feature flag, staging, UAT, or Production state is changed by this interface.
</div>
```

Wrap the three top-level tab buttons in `role="tablist"`; give each `role="tab"`, `aria-selected`, and `aria-controls`; add ArrowLeft/ArrowRight/Home/End keyboard handling that updates both focus and `activeTab`.

- [ ] **Step 4: Render provenance beside every dashboard status**

In each named component, import `provenanceLabel` and render a visible badge adjacent to the operational value:

```tsx
<span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900">
  {provenanceLabel(project.provenance.gate)}
</span>
```

Use the matching map entry: `github`, `test`, `review`, `environment`, `featureFlag`, `release`, or `activity`. Replace `Live Sync`, deployment-success, and GitHub-sync claims with `Prototype snapshot` or `Simulation only` wording.

- [ ] **Step 5: Run dashboard tests**

Add `PortfolioOverview.test.tsx` assertions for visible provenance near GitHub, environment, review, model, and last-activity values, plus a labelled internal overflow region. Run:

```bash
npm test -- src/App.test.tsx src/components/PortfolioOverview.test.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit dashboard provenance**

```bash
git add src/App.tsx src/components/CockpitHeader.tsx src/components/PortfolioOverview.tsx src/components/BridgeWorkflowRail.tsx src/components/NeedsAttentionQueue.tsx src/components/NextBestActionCard.tsx src/components/AIExecutionSnapshot.tsx src/App.test.tsx src/components/PortfolioOverview.test.tsx
git diff --cached --check
git commit -m "feat: label dashboard state as prototype data"
```

### Task 5: Make Drawer and Modal Surfaces Safe and Accessible

**Files:**
- Modify: `src/components/ProjectDetailDrawer.tsx`
- Modify: `src/components/ChatGPTBridgeModal.tsx`
- Modify: `src/components/ConnectRepoModal.tsx`
- Modify: `src/components/CiCdWorkflowModal.tsx`
- Test: `src/components/ProjectDetailDrawer.test.tsx`

**Interfaces:**
- Consumes: typed provenance and `VITE_PROTOTYPE_SAFE_MODE`.
- Produces: non-navigating fixture references, disabled API actions in safe mode, and accessible dialog behavior.

- [ ] **Step 1: Write failing safe-link, safe-mode, and focus tests**

```tsx
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { initialProjects } from '../mockData';
import { ProjectDetailDrawer } from './ProjectDetailDrawer';

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open project</button>
      <ProjectDetailDrawer
        project={open ? initialProjects[0] : null}
        onClose={() => setOpen(false)}
        onResolveBlocker={vi.fn()}
        onApproveCurrentGate={vi.fn()}
        onAdvanceToNextGate={vi.fn()}
        onStartNewIteration={vi.fn()}
        onUpdateFeatures={vi.fn()}
        onConfirmSelectiveRelease={vi.fn()}
        onShowToast={vi.fn()}
      />
    </>
  );
}

test('drawer exposes simulated references without navigable external links', async () => {
  const user = userEvent.setup();
  render(<DrawerHarness />);
  await user.click(screen.getByRole('button', { name: /open project/i }));
  expect(screen.getByText(/Simulated \/ Prototype/)).toBeVisible();
  expect(screen.queryByRole('link', { name: /production|staging|github/i })).not.toBeInTheDocument();
});

test('dialog closes with Escape and restores trigger focus', async () => {
  const user = userEvent.setup();
  render(<DrawerHarness />);
  const trigger = screen.getByRole('button', { name: /open project/i });
  await user.click(trigger);
  expect(screen.getByRole('dialog')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Run focused tests and verify red**

```bash
npm test -- src/components/ProjectDetailDrawer.test.tsx
```

Expected: fixture URLs are links and dialog/focus requirements fail.

- [ ] **Step 3: Add dialog semantics and focus containment to each modal**

For each named modal/drawer, move Hooks before conditional returns, retain the opening element, focus the first control, trap Tab/Shift+Tab, close on Escape, and restore opening focus. The rendered container must include:

```tsx
<div
  ref={dialogRef}
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  onKeyDown={handleDialogKeyDown}
>
```

Every icon-only close button receives `aria-label="Close dialog"`. Do not add a new shared source file outside the approved allowlist.

- [ ] **Step 4: Disable backend-triggering controls in safe mode**

In both `ChatGPTBridgeModal.tsx` and the relevant parent/trigger surfaces:

```ts
const prototypeSafeMode = import.meta.env.VITE_PROTOTYPE_SAFE_MODE === 'true';
```

When true, disable advice/extraction actions, do not call `fetch`, and render `Simulation only — API disabled in Prototype verification`. In `ProjectDetailDrawer.tsx`, render fixture environment/GitHub URLs as `<span>` elements with `Simulated reference`; never set `href` for fixture provenance.

- [ ] **Step 5: Correct misleading integration copy**

Replace `GitHub App Live`, `automatically synced`, `verified via ChatGPT Bridge CI/CD`, and equivalent operational wording with explicit Prototype/reference language. The CI/CD modal must state it is a future reference model, not an observed pipeline.

- [ ] **Step 6: Run modal tests and commit**

```bash
npm test -- src/components/ProjectDetailDrawer.test.tsx src/App.test.tsx
git add src/components/ProjectDetailDrawer.tsx src/components/ChatGPTBridgeModal.tsx src/components/ConnectRepoModal.tsx src/components/CiCdWorkflowModal.tsx src/components/ProjectDetailDrawer.test.tsx
git diff --cached --check
git commit -m "fix: make prototype dialogs safe and accessible"
```

### Task 6: Repair Feature Delivery and Selective Release Semantics

**Files:**
- Modify: `src/components/FeatureDeliveryMatrix.tsx`
- Modify: `src/components/SelectiveReleaseModal.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/FeatureDeliveryMatrix.test.tsx`
- Test: `src/components/SelectiveReleaseModal.test.tsx`

**Interfaces:**
- Consumes: `normalizeGeneratedFeature()`, `canAuthorizePromotion()`, and safe-mode state.
- Produces: draft-only generated features, simulation-only flags/releases, stable modal Hooks, and one-toggle checkbox behavior.

- [ ] **Step 1: Write the failing Hook and checkbox regressions**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { initialProjects } from '../mockData';
import { FeatureDeliveryMatrix } from './FeatureDeliveryMatrix';
import { SelectiveReleaseModal } from './SelectiveReleaseModal';

function renderMatrix() {
  return render(
    <FeatureDeliveryMatrix
      project={initialProjects[0]}
      onUpdateFeatures={vi.fn()}
      onConfirmSelectiveRelease={vi.fn()}
      onShowToast={vi.fn()}
    />,
  );
}

function renderOpenSelectiveRelease() {
  return render(
    <SelectiveReleaseModal
      project={initialProjects[0]}
      isOpen
      onClose={vi.fn()}
      onConfirmSelectiveRelease={vi.fn()}
    />,
  );
}

test('opens the Selective Release dialog without changing Hook order', async () => {
  const user = userEvent.setup();
  renderMatrix();
  await user.click(screen.getByRole('button', { name: /publish to prod|發布至 prod/i }));
  expect(screen.getByRole('dialog', { name: /selective/i })).toBeVisible();
});

test('checkbox toggles exactly once for pointer and Space', async () => {
  const user = userEvent.setup();
  renderOpenSelectiveRelease();
  const checkbox = screen.getAllByRole('checkbox')[0];
  expect(checkbox).toBeChecked();
  await user.click(checkbox);
  expect(checkbox).not.toBeChecked();
  checkbox.focus();
  await user.keyboard(' ');
  expect(checkbox).toBeChecked();
});
```

- [ ] **Step 2: Run the regressions and verify red**

```bash
npm test -- src/components/SelectiveReleaseModal.test.tsx
```

Expected: opening hits the Hook-order Error Boundary or the checkbox returns to its original state.

- [ ] **Step 3: Fix the two confirmed defects minimally**

Move `if (!isOpen) return null` below every Hook in `SelectiveReleaseModal.tsx`. Keep the row click handler, and prevent checkbox click bubbling:

```tsx
<input
  type="checkbox"
  checked={isSelected}
  onClick={(event) => event.stopPropagation()}
  onChange={() => toggleFeature(feat.id)}
/>
```

- [ ] **Step 4: Normalize all generated candidates**

At the response boundary, never trust returned status or Issue fields:

```ts
const provenance = {
  authority: 'AI-candidate' as const,
  observedAt: new Date().toISOString(),
  evidenceRef: `ai-candidate:${project.id}:feature-extraction`,
  confidence: 'low' as const,
};
const items = (data.features ?? []).map((item: FeatureItem) =>
  normalizeGeneratedFeature(item, provenance),
);
```

In safe mode, do not execute `fetch`; present a disabled action. Mock GitHub issues remain fixture candidates, use stable `fixture:` evidence references, and never claim synchronization.

- [ ] **Step 5: Deny flag and release promotion**

Before any flag/release update, call `canAuthorizePromotion`. Because all current provenance is non-authoritative, keep production fields unchanged and show `Simulation only — no Production or feature-flag state changed`. Remove assignments that set `prodStatus: 'Live'`, `flagEnabledInProd: true`, production `status: 'Live'`, deployed timestamps, or `DONE` based on local clicks.

- [ ] **Step 6: Run feature/release tests**

Add tests asserting safe mode makes zero fetch calls, imported candidates are Backlog/Planned, mock GitHub actions say simulation, and confirm-release leaves production state unchanged. Run:

```bash
npm test -- src/components/FeatureDeliveryMatrix.test.tsx src/components/SelectiveReleaseModal.test.tsx src/App.test.tsx
node --test test/statusProvenance.test.mjs
```

Expected: all pass.

- [ ] **Step 7: Commit the feature/release guardrails**

```bash
git add src/components/FeatureDeliveryMatrix.tsx src/components/SelectiveReleaseModal.tsx src/App.tsx src/components/FeatureDeliveryMatrix.test.tsx src/components/SelectiveReleaseModal.test.tsx
git diff --cached --check
git commit -m "fix: prevent prototype status promotion"
```

### Task 7: Correct Error Recovery and Complete State Coverage

**Files:**
- Modify: `src/components/ErrorBoundary.tsx`
- Test: `src/components/ErrorBoundary.test.tsx`
- Modify as needed within the approved allowlist to close uncovered provenance renderers.

**Interfaces:**
- Consumes: all earlier UI changes.
- Produces: honest recovery copy and a coverage test that rejects unlabelled operational states.

- [ ] **Step 1: Write the failing Error Boundary test**

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowingChild(): never {
  throw new Error('render failure');
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('does not claim browser-memory workflow state was persisted', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <ErrorBoundary>
      <ThrowingChild />
    </ErrorBoundary>,
  );
  expect(screen.getByText(/Prototype state was not persisted/i)).toBeVisible();
  expect(screen.queryByText(/safely saved|安全保存/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify red**

```bash
npm test -- src/components/ErrorBoundary.test.tsx
```

Expected: old safe-save claim is still rendered.

- [ ] **Step 3: Replace recovery wording exactly**

Use this meaning in both languages shown by the UI:

```text
The Prototype encountered a rendering error. Browser-memory state was not persisted; reset returns to the fixture baseline.
```

Do not claim automatic recovery, storage, audit logging, or backend state.

- [ ] **Step 4: Add an operational-copy coverage test**

Render the main Prototype and assert every visible occurrence of `APPROVED`, `Verified`, `Live`, `DONE`, Production, GitHub, CI/CD, test/review outcome, release, feature flag, and environment status has an adjacent `Simulated / Prototype` label or is explicitly phrased as a non-operational reference. Avoid source-text matching; test the rendered DOM.

- [ ] **Step 5: Run the complete Vitest and Node suites**

```bash
npm test
node --test
```

Expected: all tests pass and no test attempts network access.

- [ ] **Step 6: Commit recovery and coverage**

```bash
git add src/components/ErrorBoundary.tsx src/components/ErrorBoundary.test.tsx
git add src/App.tsx src/components/*.tsx src/**/*.test.ts src/**/*.test.tsx
git diff --cached --check
git commit -m "test: cover prototype authority boundaries"
```

Before committing, verify the staged filename list remains within the approved Issue allowlist; unapproved component files must be unstaged and reported `BLOCKED_DECISION` rather than committed.

### Task 8: Run Full Verification and Produce `READY_FOR_REVIEW` Evidence

**Files:**
- No new production files.
- PR body/evidence is written through the Bridge delivery flow.

**Interfaces:**
- Consumes: Tasks 1–7 and separate loopback-run authorization.
- Produces: fresh test/lint/build/viewport evidence and a PR stopped at `READY_FOR_REVIEW`.

- [ ] **Step 1: Run non-runtime verification with provider values absent**

Do not print existing values. Verify by filename only that `.env`, `.env.local`, `.env.development`, and `.env.development.local` are absent; stop `BLOCKED_ENVIRONMENT` without reading any file that exists. Run each command with the three protected process variables removed:

```bash
test ! -e .env
test ! -e .env.local
test ! -e .env.development
test ! -e .env.development.local
env -u GEMINI_API_KEY -u OPENAI_API_KEY -u APP_URL npm test
env -u GEMINI_API_KEY -u OPENAI_API_KEY -u APP_URL node --test
env -u GEMINI_API_KEY -u OPENAI_API_KEY -u APP_URL npm run lint
env -u GEMINI_API_KEY -u OPENAI_API_KEY -u APP_URL npm run build
git diff --check
git status --short
```

Expected: every command exits `0`; no provider endpoint starts or runs; changed files match the approved allowlist.

- [ ] **Step 2: Start the separately authorized frontend-only harness**

```bash
env -u GEMINI_API_KEY -u OPENAI_API_KEY -u APP_URL npm run verify:ui
```

Expected: Vite binds only `127.0.0.1:4173`; `server.ts` is not imported; `/api/*` has no implementation. Keep the process under direct supervision.

- [ ] **Step 3: Verify user-visible behavior at both viewports**

At 1280×800 and 768×800 CSS pixels, verify:

- persistent global `Simulated / Prototype` banner;
- visible provenance on operational-looking values;
- no body-level horizontal overflow;
- wide portfolio content scrolls inside its labelled region at 768px;
- tabs work with ArrowLeft/ArrowRight/Home/End;
- dialogs open, trap focus, close on Escape, and restore trigger focus;
- Selective Release opens without Error Boundary and checkbox toggles once;
- AI/provider buttons are disabled and labelled non-network simulation;
- fixture GitHub/environment references are not navigable;
- approval, flag, release, and deployment simulations never claim external change.

Use the browser network inspector to confirm zero `/api/*` and external requests.

- [ ] **Step 4: Stop the loopback process and prove it stopped**

Send the process interrupt, then verify port 4173 has no listener:

```bash
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

Expected: no output and non-zero exit status.

- [ ] **Step 5: Review staged scope and final commits**

```bash
git status --short
git diff --name-status origin/main...HEAD
git diff origin/main...HEAD --check
git log --oneline --decorate origin/main..HEAD
```

Expected: only approved application, test, manifest, and lockfile paths; multiple focused commits; no `server.ts`, `.env*`, provider, auth, persistence, billing, CI/CD runner, deployment, or secret changes.

- [ ] **Step 6: Deliver through Bridge and stop**

Push the Issue branch and update the single PR with exact command results, viewport evidence, network evidence, npm preflight outcome, changed files, and unresolved items. Move the Issue from `bridge:in-progress` to `bridge:review`, set PR Bridge Status `READY_FOR_REVIEW`, and stop. Do not add `bridge:approved`, merge, deploy, release, or modify billing/auth/security/production data.
