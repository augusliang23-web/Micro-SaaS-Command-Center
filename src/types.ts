export type ProjectHealth = 'Healthy' | 'Attention' | 'At Risk' | 'Blocked';
export type ProjectStage = 'Prototype' | 'Alpha' | 'Beta' | 'Production';

export type BridgeGateId =
  | 'DISCUSS'
  | 'SPECIFY'
  | 'SPECIFY_UX'
  | 'PROTOTYPE'
  | 'PROTOTYPE_REVIEW'
  | 'APPROVE_UI'
  | 'SPECIFY_TASK'
  | 'ROUTE'
  | 'IMPLEMENT'
  | 'TEST'
  | 'REVIEW'
  | 'APPROVE'
  | 'DONE';

export type GateStatus = 'COMPLETED' | 'CURRENT' | 'CHANGES_REQUIRED' | 'FAILED' | 'PENDING' | 'SKIPPED';

export type TestOutcome = 'PASS' | 'FAIL' | 'RUNNING' | 'PENDING' | 'N/A';
export type ReviewOutcome = 'APPROVED' | 'CHANGES_REQUIRED' | 'IN_REVIEW' | 'PENDING' | 'N/A';

export type CodexModelName = 'Luna' | 'Terra' | 'Sol' | 'Not Assigned';
export type ReasoningEffort = 'Low' | 'Medium' | 'High' | 'None';

export type AttentionCategory =
  | 'HUMAN_DECISION'
  | 'READY_FOR_REVIEW'
  | 'REVIEW_FAILED'
  | 'PRODUCTION_BLOCKER'
  | 'WAITING_IMPLEMENTATION'
  | 'UAT_VERIFY';

export type WaitingState = 'WAITING_FOR_HUMAN' | 'AI_RUNNING' | 'BLOCKED' | 'AUTOMATION_IDLE';

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

export interface GateStepInfo {
  id: BridgeGateId;
  label: string;
  shortLabel: string;
  status: GateStatus;
  detail?: string;
  timestamp?: string;
  testOutcome?: TestOutcome;
  reviewOutcome?: ReviewOutcome;
  agentModel?: CodexModelName;
  artifacts?: {
    type: 'github_pr' | 'issue' | 'prototype' | 'test_report' | 'review_diff' | 'spec_doc';
    label: string;
    url?: string;
    value?: string;
  }[];
}

export interface ProjectEnvironment {
  production: {
    status: 'Live' | 'Healthy' | 'Degraded' | 'Down' | 'Not Deployed' | 'Deploying';
    lastDeployed: string;
    version?: string;
    url?: string;
    metrics?: { uptime: string; p95Latency: string };
  };
  staging: {
    status: 'Ready' | 'Active' | 'Deploying' | 'Stale' | 'Not Deployed' | 'Verifying';
    lastRefreshed: string;
    version?: string;
    branch?: string;
    url?: string;
    commit?: string;
  };
  uat?: {
    status: 'Ready' | 'Active' | 'Deploying' | 'Stale' | 'Not Deployed' | 'Verifying';
    lastRefreshed: string;
    version?: string;
    branch?: string;
    url?: string;
  };
  targetReleaseVersion?: string;
  releaseType?: 'major' | 'minor' | 'patch' | 'hotfix';
}

export type FeatureCategory = 'Core' | 'UI/UX' | 'Integration' | 'Infra' | 'AI' | 'Security';
export type FeatureStageStatus = 'Verified' | 'Testing' | 'Blocked' | 'Backlog';
export type FeatureProdStatus = 'Live' | 'Flag Disabled' | 'Pending Release' | 'Planned';

export interface FeatureItem {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  stageStatus: FeatureStageStatus;
  prodStatus: FeatureProdStatus;
  featureFlagKey: string;
  flagEnabledInProd: boolean;
  shippedVersion?: string;
  targetReleaseVersion?: string;
  githubIssue?: string;
  authorModel?: CodexModelName;
  addedAt: string;
}

export interface ExecutionContext {
  githubIssue?: string;
  githubPR?: string;
  branch: string;
  lastCommit?: string;
  model: CodexModelName;
  reasoningEffort: ReasoningEffort;
  risk: 'Low' | 'Medium' | 'High';
  routingReason: string;
  bridgeRunId: string;
  contextTokens?: string;
}

export interface ActivityItem {
  id: string;
  timestamp: string;
  author: 'Human (You)' | 'AI (Terra)' | 'AI (Sol)' | 'AI (Luna)' | 'Bridge Automation' | 'AI Prototyping Tool';
  action: string;
  detail: string;
  gate?: BridgeGateId;
}

export interface MicroSaaSProject {
  id: string;
  name: string;
  tagline: string;
  stage: ProjectStage;
  health: ProjectHealth;
  workflowType: 'standard' | 'ui_prototype';
  currentTask: string;
  currentGate: BridgeGateId;
  currentGateLabel: string;
  testOutcome: TestOutcome;
  reviewOutcome: ReviewOutcome;
  nextAction: string;
  blocker: string | null;
  waitingState: WaitingState;
  model: CodexModelName;
  reasoningEffort: ReasoningEffort;
  routingReason: string;
  environment: ProjectEnvironment;
  executionContext: ExecutionContext;
  gates: GateStepInfo[];
  lastActivity: string;
  activityHistory: ActivityItem[];
  repository: string;
  /** Absolute path to this project's local clone, set by the owner; used to compare local git state against GitHub. */
  localPath?: string;
  /** History of AI-generated change summaries (see ChangeSummaryRecord), newest last. */
  changeSummaries?: ChangeSummaryRecord[];
  tags: string[];
  features?: FeatureItem[];
  provenance: ProjectProvenance;
}

// One saved result of POST /api/bridge/summarize-changes, kept so the same
// PR/commit doesn't need to be re-summarized (and re-spend AI quota) every
// time the card is reopened, while still building up a browsable history.
export interface ChangeSummaryRecord {
  id: string;
  /** Identifies which PR or commit this summary is for: `pr:<number>` or `sha:<sha>`. */
  refKey: string;
  summary: string;
  provider: string;
  fileCount: number;
  includedLocalDiff: boolean;
  generatedAt: string;
}

// Shape returned by GET /api/github/pull-status (server/githubPullStatus.mjs)
export interface GithubPullStatus {
  state: 'open' | 'merged' | 'active' | 'none';
  mergedAt?: string;
  prNumber?: number;
  prUrl?: string;
  isDraft?: boolean;
  ciStatus?: 'passing' | 'failing' | 'running' | 'none' | 'unknown' | 'pending';
  reviewDecision?: 'approved' | 'changes_requested' | 'review_required';
  lastCommitMessage?: string;
  lastCommitAt?: string;
  lastCommitUrl?: string;
  lastCommitSha?: string;
}

// Shape returned by GET /api/github/changed-files (server/githubRoutes.mjs)
export interface GithubChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

// Shape returned by GET /api/local-git/status (server/localGitRoutes.mjs)
export interface LocalGitStatus {
  branch: string;
  ahead: number;
  behind: number;
  uncommittedCount: number;
  /** True when the pre-check `git fetch` failed (offline, timeout, auth) — ahead/behind may be stale. */
  fetchFailed?: boolean;
}

export interface AttentionItem {
  id: string;
  projectId: string;
  projectName: string;
  category: AttentionCategory;
  categoryLabel: string;
  title: string;
  description: string;
  waitingState: WaitingState;
  urgency: 'critical' | 'high' | 'medium';
  gate: BridgeGateId;
  actionPrompt: string;
  prOrIssueRef?: string;
}

export interface NextBestAction {
  id: string;
  projectId: string;
  projectName: string;
  actionTitle: string;
  summary: string;
  contextPill: string;
  impactReason: string;
  gate: BridgeGateId;
  model: CodexModelName;
  quickActionLabel: string;
}

export interface AIExecutionSnapshotData {
  lunaTasks: number;
  terraTasks: number;
  solTasks: number;
  waitingForReview: number;
  waitingForHuman: number;
  blocked: number;
  aiRunning: number;
}
