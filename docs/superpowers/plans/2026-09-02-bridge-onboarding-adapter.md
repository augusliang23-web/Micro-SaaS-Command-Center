# Bridge Onboarding Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed Project Adapter for Micro-SaaS Command Center, obtain independent review, register the approved repository mapping, prove a `NO_OP` watcher cycle, and prepare the first safety Issue without bypassing any human gate.

**Architecture:** Repository changes are documentation and adapter configuration only. Package normalization and UI safety implementation remain in the separate Prototype Safety Guardrails plan; machine-local mapping and GitHub mutations occur only after their named authorization gates.

**Tech Stack:** Markdown, YAML, Git, GitHub CLI, Node.js 20.20.2, npm 10.8.2, ChatGPT Codex Bridge V0.3.1.

**Spec:** `docs/superpowers/specs/2026-08-31-bridge-onboarding-design.md`

## Global Constraints

- Repository: `augusliang23-web/Micro-SaaS-Command-Center`; default branch: `main`.
- Approved Prototype baseline: `6fcd2395c3d5028c14aced1e278b49d29f36f2af`.
- Work only on `bridge/onboarding-v0`; never write directly to `main`.
- Local onboarding changes are limited to `.bridge/**`, root `AGENTS.md`, `docs/superpowers/evidence/**`, and `docs/superpowers/issue-drafts/**`.
- Do not install dependencies or run lint, build, tests, preview, dev, start, browser, or either `/api/bridge/*` endpoint during adapter implementation.
- Dependency, lint, build, test, runtime, accessibility, and viewport status remain `BLOCKED_DECISION` or unverified; never report them as passing.
- No automatic approval, merge, deployment, release, billing/service creation, secret access, production-data change, or authentication/security-boundary change.
- Codex stops at `READY_FOR_REVIEW`; Terra findings are non-authoritative; ChatGPT records canonical review; a named human alone authorizes merge.
- GitHub writes, npm registry access, mapping writes, and watcher execution each require separately recorded current authorization.

## File Structure

| File | Responsibility |
|---|---|
| `.bridge/PROJECT_CONTEXT.md` | Canonical identity, product purpose, source roots, and Prototype authority boundary |
| `.bridge/ARCHITECTURE.md` | React fixture flow, Express/provider flow, and simulated-versus-observed data model |
| `.bridge/PROJECT_RULES.md` | Scope, protected surfaces, evidence requirements, and fail-closed behavior |
| `.bridge/ENVIRONMENTS.md` | Observed AI Studio Preview and explicitly unverified environments |
| `.bridge/BRIDGE_CONFIG.yaml` | Machine-readable identity, blocked commands, routing, and deployment policy |
| `AGENTS.md` | Repository-wide agent instructions and cost-efficient model routing |
| `docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md` | Fresh, non-secret onboarding evidence |
| `docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md` | Exact local body for the future Terra safety Issue |

---

### Task 1: Capture Fresh Baseline Evidence

**Files:**
- Create: `docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md`

**Interfaces:**
- Consumes: current checkout, approved baseline SHA, repository manifest, and tracked tree.
- Produces: an evidence record used by adapter review; it grants no implementation authority.

- [ ] **Step 1: Run the identity and baseline checks**

Run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git remote get-url origin
git status --porcelain=v2 --branch
node --version
npm --version
command -v bun
test -f bun.lock
test ! -f package-lock.json
git diff --check 57e6402fb3390225fd500b46e0a8a17a7fc1ef26..6fcd2395c3d5028c14aced1e278b49d29f36f2af
```

Expected: canonical checkout and remote; branch `bridge/onboarding-v0`; `origin/main` equals `6fcd2395c3d5028c14aced1e278b49d29f36f2af`; Node `v20.20.2`; npm `10.8.2`; Bun lookup exits non-zero; `bun.lock` exists; `package-lock.json` does not; the historical diff check reports only the two known blank-line findings in `FeatureDeliveryMatrix.tsx:1081` and `main.tsx:14`.

- [ ] **Step 2: Write the evidence record**

Use `apply_patch` to create the file with this exact structure, replacing only `Onboarding branch HEAD` with the fresh `git rev-parse HEAD` output:

```markdown
# Bridge Onboarding Baseline Evidence

- Repository: `augusliang23-web/Micro-SaaS-Command-Center`
- Remote baseline: `6fcd2395c3d5028c14aced1e278b49d29f36f2af`
- Onboarding branch: `bridge/onboarding-v0`
- Onboarding branch HEAD: recorded from the fresh identity check
- Runtime: Node `v20.20.2`; npm `10.8.2`; Bun unavailable
- Package state: `bun.lock` present; `package-lock.json` absent; `packageManager` absent
- Commands declared but not run: `npm run lint`, `npm run build`
- Tests: no test script and no tracked test files
- Dependency, lint, build, runtime, accessibility, and viewport status: `BLOCKED_DECISION`

## Known source findings

- `src/components/SelectiveReleaseModal.tsx` changes Hook count when opened.
- Its checkbox click reaches both checkbox and row toggle handlers.
- Historical diff check reports blank lines at EOF in `src/components/FeatureDeliveryMatrix.tsx` and `src/main.tsx`.

## Prohibited actions confirmed absent

No dependency install, test, lint, build, server start, preview, endpoint call, browser run, GitHub write, mapping write, watcher execution, deployment, billing action, secret access, production-data change, or authentication/security change occurred.
```

- [ ] **Step 3: Validate the evidence file**

Run:

```bash
test -f docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md
rg -n '6fcd2395c3d5028c14aced1e278b49d29f36f2af|BLOCKED_DECISION|Bun unavailable|Prohibited actions confirmed absent' docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md
git diff --check -- docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md
```

Expected: every required marker is found and the whitespace check exits `0`.

- [ ] **Step 4: Commit the evidence**

```bash
git add docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md
git diff --cached --check
git commit -m "docs: record command center onboarding baseline"
```

### Task 2: Add Project Context, Architecture, and Environment Adapter

**Files:**
- Create: `.bridge/PROJECT_CONTEXT.md`
- Create: `.bridge/ARCHITECTURE.md`
- Create: `.bridge/ENVIRONMENTS.md`

**Interfaces:**
- Consumes: Task 1 evidence and the approved design.
- Produces: project-specific context consumed by future Bridge executors and reviewers.

- [ ] **Step 1: Verify the adapter files do not already exist**

Run:

```bash
test ! -e .bridge/PROJECT_CONTEXT.md
test ! -e .bridge/ARCHITECTURE.md
test ! -e .bridge/ENVIRONMENTS.md
```

Expected: all commands exit `0`; otherwise stop `BLOCKED_DECISION` and review the existing adapter instead of overwriting it.

- [ ] **Step 2: Create `PROJECT_CONTEXT.md`**

Use `apply_patch` with these exact facts:

```markdown
# Project Context

- Project ID: `micro-saas-command-center`
- Repository: `augusliang23-web/Micro-SaaS-Command-Center`
- Default branch: `main`
- Approved Prototype baseline: `6fcd2395c3d5028c14aced1e278b49d29f36f2af`
- Local workspace: `/Users/augusliang/Developer/workspaces/micro-saas-command-center`
- Product purpose: a portfolio cockpit for a solo developer operating multiple micro-SaaS projects.
- Source roots: `src/`, `server.ts`, `vite.config.ts`

All tracked project, GitHub, Bridge, review, test, environment, release, and activity values are Prototype fixtures or browser-memory state unless an immutable external evidence reference proves otherwise. Prototype values are never operational authority.
```

- [ ] **Step 3: Create `ARCHITECTURE.md`**

Use `apply_patch` to record this data flow:

```text
src/mockData.ts -> src/App.tsx React state -> dashboard and modal presentation
FeatureDeliveryMatrix -> /api/bridge/extract-features -> Gemini or fabricated fallback
ChatGPTBridgeModal -> /api/bridge/chatgpt-advice -> OpenAI, Gemini, or fabricated fallback
```

State explicitly that there is no persistence, GitHub adapter, Bridge artifact store, feature-flag provider, CI runner, deployment API, authenticated identity, authorization layer, or verified Dev/UAT/Production environment. Both API routes and every provider/fallback path are protected and must not run during onboarding.

- [ ] **Step 4: Create `ENVIRONMENTS.md`**

Use this exact environment table:

```markdown
| Environment | Evidence | Authority |
|---|---|---|
| AI Studio Preview | Observed Prototype surface only | Non-production visual reference |
| Local loopback verification | Not yet authorized or implemented | `BLOCKED_DECISION` |
| Development | No verified deployment evidence | Not established |
| Staging / UAT | Fixture copy only | Not established |
| Production | Fixture copy only | Not established |
```

Add: `verify:ui` is future safety-Issue-only Vite frontend verification on `127.0.0.1:4173`; it is not a deployment and exposes no API server.

- [ ] **Step 5: Validate and commit the context adapter**

```bash
test -f .bridge/PROJECT_CONTEXT.md
test -f .bridge/ARCHITECTURE.md
test -f .bridge/ENVIRONMENTS.md
rg -n 'Prototype|not established|chatgpt-advice|extract-features|127.0.0.1:4173' .bridge
git diff --check -- .bridge
git add .bridge/PROJECT_CONTEXT.md .bridge/ARCHITECTURE.md .bridge/ENVIRONMENTS.md
git diff --cached --check
git commit -m "docs: add command center project adapter context"
```

### Task 3: Add Fail-Closed Rules and Machine Configuration

**Files:**
- Create: `.bridge/PROJECT_RULES.md`
- Create: `.bridge/BRIDGE_CONFIG.yaml`
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: Task 2 identity and environment statements.
- Produces: repository-wide execution constraints and machine-readable routing metadata.

- [ ] **Step 1: Verify no existing rules will be overwritten**

```bash
test ! -e .bridge/PROJECT_RULES.md
test ! -e .bridge/BRIDGE_CONFIG.yaml
test ! -e AGENTS.md
```

Expected: all exit `0`; otherwise stop `BLOCKED_DECISION` for reconciliation.

- [ ] **Step 2: Create `BRIDGE_CONFIG.yaml`**

```yaml
version: 1
project:
  id: micro-saas-command-center
  repository: augusliang23-web/Micro-SaaS-Command-Center
  default_branch: main
runtime:
  node: "20.20.2"
  npm: "10.8.2"
  canonical_package_manager: npm
  package_state: BLOCKED_DECISION
commands:
  lint: npm run lint
  build: npm run build
  test: BLOCKED_DECISION
  verify_ui: BLOCKED_DECISION
environments:
  preview: PROTOTYPE_ONLY
  development: NOT_ESTABLISHED
  staging: NOT_ESTABLISHED
  uat: NOT_ESTABLISHED
  production: NOT_ESTABLISHED
deployment:
  policy: HUMAN_AUTHORIZATION_REQUIRED
routing:
  adapter_docs:
    model: luna
    reasoning_effort: low
    risk: low
  first_safety_issue:
    model: terra
    reasoning_effort: medium
    risk: medium
```

- [ ] **Step 3: Create `PROJECT_RULES.md` and root `AGENTS.md`**

Both files must contain these exact rules in plain language:

```markdown
- Require an exact GitHub Issue, allowed file list, model label, `- Reasoning Effort:` line, risk label, and `bridge:ready` before feature execution.
- Treat fixture, browser-memory, user-entered, and AI-generated state as non-authoritative.
- Never call `/api/bridge/chatgpt-advice` or `/api/bridge/extract-features` unless a separately reviewed task explicitly opens that provider boundary.
- Never auto-approve, merge, deploy, release, change billing, access secrets, delete production data, or change authentication/security boundaries.
- Stop at `READY_FOR_REVIEW`; Codex and its findings reviewer cannot add `bridge:approved`.
- Changes to `server.ts`, `.env*`, provider behavior, GitHub integration, auth, persistence, billing, deployment, or runtime networking are `BLOCKED_DECISION` unless an exact approved task opens them.
- Prefer the lowest-cost capable route: Luna for mechanical work, Terra for normal implementation, Sol only for architecture, ambiguous/high-risk integration, or critical final review.
```

Also include the npm gate: reject a project `.npmrc` by filename; reject `npm_config_*` case-insensitively plus `NPM_TOKEN`, `NODE_AUTH_TOKEN`, and `NPM_AUTH_TOKEN` by name without reading values; require explicit clean npm configs and separately authorized registry access.

- [ ] **Step 4: Validate and commit rules/config**

Run:

```bash
test -f .bridge/PROJECT_RULES.md
test -f .bridge/BRIDGE_CONFIG.yaml
test -f AGENTS.md
rg -n 'READY_FOR_REVIEW|BLOCKED_DECISION|model: terra|reasoning_effort: medium|HUMAN_AUTHORIZATION_REQUIRED' .bridge AGENTS.md
git diff --check -- .bridge AGENTS.md
git add .bridge/PROJECT_RULES.md .bridge/BRIDGE_CONFIG.yaml AGENTS.md
git diff --cached --check
git commit -m "docs: add bridge execution boundaries"
```

### Task 4: Prepare the First Safety Issue Contract Locally

**Files:**
- Create: `docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md`

**Interfaces:**
- Consumes: approved design and `docs/superpowers/plans/2026-09-02-prototype-safety-guardrails.md`.
- Produces: exact future GitHub Issue body; does not create or authorize the Issue.

- [ ] **Step 1: Create the Issue draft**

The file must begin exactly:

```markdown
# Prototype State Provenance & Safety Guardrails

- Reasoning Effort: Medium
- Risk: Medium
- Required Model Label: `model:terra`
- Required Risk Label: `risk:medium`
- Bridge Authorization: NOT GRANTED; do not add `bridge:ready`
```

Copy the exact allowed application/package boundaries, provenance contract, safe-mode contract, defects, accessibility criteria, test commands, exclusions, and `READY_FOR_REVIEW` stop from the approved design. Link the separate safety implementation plan. State that npm registry access requires a separate current authorization and that `server.ts`, external APIs, provider behavior, authentication, persistence, billing, deployment, secrets, and production automation remain excluded.

- [ ] **Step 2: Validate routing and forbidden-state markers**

```bash
rg -n '^- Reasoning Effort: Medium$|model:terra|risk:medium|READY_FOR_REVIEW|Bridge Authorization: NOT GRANTED|server.ts|npm registry' docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md
! rg -n 'bridge:ready.*GRANTED|bridge:approved|auto-merge|auto-deploy' docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md
git diff --check -- docs/superpowers/issue-drafts
```

Expected: required markers exist; no authorization or automated release claim exists.

- [ ] **Step 3: Commit the local contract**

```bash
git add docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md
git diff --cached --check
git commit -m "docs: draft prototype safety bridge issue"
```

### Task 5: Run the Local Onboarding Review Gate

**Files:**
- Modify: `docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: fresh staged and committed-scope evidence for independent review.

- [ ] **Step 1: Verify the complete branch scope**

```bash
git status --short
git diff --name-status origin/main...HEAD
git diff origin/main...HEAD --check
git log --oneline --decorate origin/main..HEAD
```

Expected changed paths: the approved spec/plans, `.bridge/**`, `AGENTS.md`, the baseline evidence, and the local Issue draft only. Any source, manifest, lockfile, environment, or server change is `BLOCKED_DECISION`.

- [ ] **Step 2: Append review evidence**

Use `apply_patch` to append exact output summaries and these statements:

```markdown
## Local onboarding review gate

- Changed paths are limited to approved documentation, adapter, rules, evidence, and Issue-draft files.
- Dependency install, lint, build, tests, runtime, accessibility, and viewport validation remain unperformed and unclaimed.
- No provider, GitHub write, mapping, watcher, deployment, billing, secret, production-data, or authentication/security action occurred.
- Required next state: independent findings review, then canonical ChatGPT review, then named-human merge decision.
```

- [ ] **Step 3: Verify and commit final local evidence**

```bash
git add docs/superpowers/evidence/2026-09-02-bridge-onboarding-baseline.md
git diff --cached --name-status
git diff --cached --check
git commit -m "docs: finalize bridge onboarding evidence"
git status --porcelain=v2 --branch
```

Expected: commit succeeds and worktree is clean.

- [ ] **Step 4: Stop at local `READY_FOR_REVIEW`**

Request a Terra findings review, then ChatGPT Control Plane review. Do not push, create GitHub state, merge, map, or run the watcher within the same authorization.

### Task 6: Create the Administrative Onboarding Issue and PR

**Files:**
- No new local files.

**Interfaces:**
- Consumes: clean reviewed branch and a new explicit GitHub-write authorization.
- Produces: one administrative Issue and one onboarding PR; neither is dispatchable.

- [ ] **Step 1: Confirm authorization and remote identity**

```bash
git status --porcelain=v2 --branch
git remote get-url origin
gh auth status
gh repo view augusliang23-web/Micro-SaaS-Command-Center --json nameWithOwner,defaultBranchRef
```

Expected: clean branch, canonical repository, default branch `main`, authenticated GitHub access. Without recorded write authorization, stop before the next step.

- [ ] **Step 2: Ensure administrative labels exist**

Read current labels first. Under the same explicit label-write authorization, create only missing labels:

```bash
if ! onboarding_label_names="$(gh label list --repo augusliang23-web/Micro-SaaS-Command-Center --limit 100 --json name --jq '.[].name')"; then
  echo 'BLOCKED_ENVIRONMENT: unable to read repository labels' >&2
  exit 2
fi
if ! rg -x 'model:luna' <<<"$onboarding_label_names"; then gh label create model:luna --repo augusliang23-web/Micro-SaaS-Command-Center --color C5DEF5 --description "Low-cost mechanical execution"; fi
if ! rg -x 'risk:low' <<<"$onboarding_label_names"; then gh label create risk:low --repo augusliang23-web/Micro-SaaS-Command-Center --color 0E8A16 --description "Low implementation risk"; fi
```

- [ ] **Step 3: Create the administrative Issue without `bridge:ready`**

```bash
onboarding_issue_url="$(gh issue create \
  --repo augusliang23-web/Micro-SaaS-Command-Center \
  --title "Bridge onboarding: add Project Adapter and execution boundaries" \
  --label model:luna \
  --label risk:low \
  --body-file - <<'EOF'
## Objective
Add and review the Project Adapter, repository execution rules, environment inventory, and onboarding evidence for Bridge V0.3.1.

- Reasoning Effort: Low

## Scope
`.bridge/**`, root `AGENTS.md`, approved specs/plans, baseline evidence, and the local safety-Issue draft only.

## Acceptance Criteria
1. Canonical repository identity and Prototype baseline are recorded.
2. Provider, auth, billing, deployment, secret, production-data, and merge boundaries fail closed.
3. Dependency, lint, build, test, runtime, accessibility, and viewport status remain explicitly unverified.
4. Independent findings review and ChatGPT Control Plane review are required.
5. Work stops at `READY_FOR_REVIEW`; no merge, mapping, watcher, deploy, or release occurs.

## Authorization
This administrative Issue intentionally has no `bridge:ready` label and must not dispatch Codex.
EOF
)"
onboarding_issue_number="${onboarding_issue_url##*/}"
test -n "$onboarding_issue_number"
```

Expected: exactly one new Issue URL. Verify its labels do not include `bridge:ready`.

- [ ] **Step 4: Push the reviewed branch and open one PR**

```bash
onboarding_issue_number="$(gh issue list --repo augusliang23-web/Micro-SaaS-Command-Center --state open --limit 100 --json number,title --jq '[.[] | select(.title=="Bridge onboarding: add Project Adapter and execution boundaries")] | if length==1 then .[0].number else error("expected exactly one onboarding issue") end')"
git push --set-upstream origin bridge/onboarding-v0
gh pr create \
  --repo augusliang23-web/Micro-SaaS-Command-Center \
  --base main \
  --head bridge/onboarding-v0 \
  --title "docs: onboard command center to Bridge V0.3.1" \
  --body "Adds the reviewed Project Adapter, execution boundaries, environment inventory, and local first-safety-Issue contract. Closes #${onboarding_issue_number}. Bridge Status: READY_FOR_REVIEW. No feature code, install, runtime, provider call, mapping, watcher, deployment, or release action is included."
```

Verify `gh pr view bridge/onboarding-v0 --repo augusliang23-web/Micro-SaaS-Command-Center --json closingIssuesReferences` contains the exact Issue number resolved above.

- [ ] **Step 5: Stop for independent review and named-human merge**

Do not add `bridge:approved`, merge, map, run watcher, create the safety Issue, or reuse the GitHub-write authorization.

### Task 7: Register the Approved Mapping and Prove `NO_OP`

**Files:**
- Machine-local write only: `/Users/augusliang/.config/chatgpt-codex-bridge/projects.json`

**Interfaces:**
- Consumes: merged onboarding PR, exact merge SHA, and new mapping/watcher authorization.
- Produces: one canonical mapping and one machine-readable `NO_OP` result.

- [ ] **Step 1: Resolve and verify the merged adapter SHA**

```bash
git -C /Users/augusliang/Developer/workspaces/micro-saas-command-center fetch origin main
gh pr view bridge/onboarding-v0 --repo augusliang23-web/Micro-SaaS-Command-Center --json state,mergedAt,mergeCommit
git -C /Users/augusliang/Developer/workspaces/micro-saas-command-center merge-base --is-ancestor "$(gh pr view bridge/onboarding-v0 --repo augusliang23-web/Micro-SaaS-Command-Center --json mergeCommit --jq .mergeCommit.oid)" origin/main
```

Expected: PR state `MERGED`, non-null merge SHA, ancestry exit `0`. Otherwise stop `BLOCKED_ENVIRONMENT`.

- [ ] **Step 2: Preflight the current mapping without overwriting it**

```bash
shasum -a 256 /Users/augusliang/.config/chatgpt-codex-bridge/projects.json
node --input-type=module -e "import fs from 'node:fs'; const p='/Users/augusliang/.config/chatgpt-codex-bridge/projects.json'; const c=JSON.parse(fs.readFileSync(p,'utf8')); const matches=(c.projects??[]).filter(x=>x.repository==='augusliang23-web/Micro-SaaS-Command-Center'); if(matches.some(x=>x.path!=='/Users/augusliang/Developer/workspaces/micro-saas-command-center')) process.exit(2); console.log(JSON.stringify({version:c.version,count:(c.projects??[]).length,matches}));"
```

Expected: version `1`; zero matches or the exact canonical match; no different-path match. Preserve every unrelated entry.

- [ ] **Step 3: Register and verify the exact mapping**

```bash
node /Users/augusliang/Developer/ChatGPT-Codex-Bridge/scripts/v0_3_trigger.mjs \
  --register-project \
  --repo augusliang23-web/Micro-SaaS-Command-Center \
  --project-path /Users/augusliang/Developer/workspaces/micro-saas-command-center
shasum -a 256 /Users/augusliang/.config/chatgpt-codex-bridge/projects.json
```

Expected: `MAPPING_REGISTERED`; exact canonical entry; unrelated entries unchanged semantically. If registration would replace a different path, do not run it.

- [ ] **Step 4: Prove no Issue is eligible before watcher execution**

```bash
gh issue list --repo augusliang23-web/Micro-SaaS-Command-Center --state open --limit 100 --json number,title,labels,body,updatedAt
while IFS= read -r mapped_repository; do
  gh issue list --repo "$mapped_repository" --state open --limit 100 --json number,title,labels,body,updatedAt
done < <(node --input-type=module -e "import fs from 'node:fs'; const c=JSON.parse(fs.readFileSync('/Users/augusliang/.config/chatgpt-codex-bridge/projects.json','utf8')); for(const p of c.projects??[]) console.log(p.repository)")
```

Because the watcher iterates every mapped repository, inspect each mapped repository's state paths under `/Users/augusliang/.local/state/chatgpt-codex-bridge/` for active locks, resumable quota runs, and active blockers. Expected across all mapped repositories: no eligible `bridge:ready`, no eligible `bridge:changes-required`, no active lock, and no resumable quota candidate. If any mapped repository is eligible, do not run the watcher; stop `BLOCKED_DECISION` rather than dispatching unrelated work.

- [ ] **Step 5: Run one watcher cycle**

```bash
node /Users/augusliang/Developer/ChatGPT-Codex-Bridge/scripts/v0_3_watcher.mjs
```

Expected: the Micro-SaaS Command Center result is exactly `NO_OP`. Any dispatch or blocker is a failure; stop before creating the safety Issue.

### Task 8: Create the Safety Issue and Leave Dispatch at a Separate Gate

**Files:**
- No local changes.

**Interfaces:**
- Consumes: approved local Issue draft, successful mapping, and `NO_OP` evidence.
- Produces: one GitHub Issue with Terra routing but no `bridge:ready` until registry and dispatch authorization are separately granted.

- [ ] **Step 1: Ensure lifecycle and routing labels exist**

Under explicit label-write authorization, create only missing labels:

```bash
if ! safety_label_names="$(gh label list --repo augusliang23-web/Micro-SaaS-Command-Center --limit 100 --json name --jq '.[].name')"; then
  echo 'BLOCKED_ENVIRONMENT: unable to read repository labels' >&2
  exit 2
fi
if ! rg -x 'model:terra' <<<"$safety_label_names"; then gh label create model:terra --repo augusliang23-web/Micro-SaaS-Command-Center --color 1D76DB --description "Normal multi-file implementation"; fi
if ! rg -x 'risk:medium' <<<"$safety_label_names"; then gh label create risk:medium --repo augusliang23-web/Micro-SaaS-Command-Center --color FBCA04 --description "Medium implementation risk"; fi
if ! rg -x 'bridge:ready' <<<"$safety_label_names"; then gh label create bridge:ready --repo augusliang23-web/Micro-SaaS-Command-Center --color 0E8A16 --description "Authorized for Bridge dispatch"; fi
if ! rg -x 'bridge:in-progress' <<<"$safety_label_names"; then gh label create bridge:in-progress --repo augusliang23-web/Micro-SaaS-Command-Center --color 5319E7 --description "Bridge execution in progress"; fi
if ! rg -x 'bridge:review' <<<"$safety_label_names"; then gh label create bridge:review --repo augusliang23-web/Micro-SaaS-Command-Center --color D4C5F9 --description "READY_FOR_REVIEW"; fi
if ! rg -x 'bridge:changes-required' <<<"$safety_label_names"; then gh label create bridge:changes-required --repo augusliang23-web/Micro-SaaS-Command-Center --color B60205 --description "Independent review requires correction"; fi
```

- [ ] **Step 2: Create the Issue without dispatch authorization**

```bash
gh issue create \
  --repo augusliang23-web/Micro-SaaS-Command-Center \
  --title "Prototype State Provenance & Safety Guardrails" \
  --label model:terra \
  --label risk:medium \
  --body-file docs/superpowers/issue-drafts/2026-09-02-prototype-state-provenance-safety-guardrails.md
```

Expected: one open Issue; exact `- Reasoning Effort: Medium` body line; labels `model:terra` and `risk:medium`; no `bridge:ready`.

- [ ] **Step 3: Stop for npm-registry and dispatch authorization**

Do not add `bridge:ready` until the owner separately authorizes the clean public npm registry read and the Control Plane re-verifies Issue scope, exclusions, labels, no active lock, no quota resume candidate, and no duplicate dispatch.

- [ ] **Step 4: Under that later authorization, add only `bridge:ready` and observe one dispatch**

```bash
safety_issue_number="$(gh issue list --repo augusliang23-web/Micro-SaaS-Command-Center --state open --limit 100 --json number,title --jq '[.[] | select(.title=="Prototype State Provenance & Safety Guardrails")] | if length==1 then .[0].number else error("expected exactly one safety issue") end')"
gh issue edit "$safety_issue_number" \
  --repo augusliang23-web/Micro-SaaS-Command-Center \
  --add-label bridge:ready
```

Expected watcher evidence: one selected repository/Issue in `new` mode, requested `gpt-5.6-terra`, medium reasoning, one live lock, then eventual `READY_FOR_REVIEW`. Do not claim effective model/reasoning unless runtime evidence emits it. Do not approve, merge, deploy, or release.
