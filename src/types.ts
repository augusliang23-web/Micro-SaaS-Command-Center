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
  uat: {
    status: 'Ready' | 'Active' | 'Stale' | 'Not Deployed' | 'Verifying';
    lastRefreshed: string;
    branch?: string;
    url?: string;
  };
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
  author: 'Human (You)' | 'Codex (Terra)' | 'Codex (Sol)' | 'Codex (Luna)' | 'Bridge Automation' | 'Google AI Studio';
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
  tags: string[];
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
