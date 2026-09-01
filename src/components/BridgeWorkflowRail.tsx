import React from 'react';
import {
  Check,
  AlertTriangle,
  X,
  Circle,
  Clock,
  Sparkles,
  GitPullRequest,
  FileCode2,
  FileCheck2,
  ExternalLink,
  Bot,
  Terminal,
  ShieldCheck,
  PlayCircle,
  CheckCircle2,
  Rocket,
  GitBranch,
} from 'lucide-react';
import { GateStepInfo, GateStatus, TestOutcome, ReviewOutcome } from '../types';

interface BridgeWorkflowRailProps {
  gates: GateStepInfo[];
  currentGateId: string;
  selectedGateId?: string;
  onSelectGate?: (gate: GateStepInfo) => void;
  workflowType?: 'standard' | 'ui_prototype';
}

export const BridgeWorkflowRail: React.FC<BridgeWorkflowRailProps> = ({
  gates,
  currentGateId,
  selectedGateId,
  onSelectGate,
  workflowType = 'standard',
}) => {
  const getGateVisual = (gate: GateStepInfo) => {
    switch (gate.status) {
      case 'COMPLETED':
        return {
          icon: <Check className="h-3 w-3 stroke-[3]" />,
          circleClass: 'bg-emerald-50 text-emerald-800 border-emerald-400 shadow-xs',
          lineClass: 'bg-emerald-300',
          tagClass: 'text-emerald-800 bg-emerald-50 border-emerald-200',
          badgeText: '✓ Complete',
        };
      case 'CURRENT':
        return {
          icon: <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />,
          circleClass: 'bg-stone-900 text-stone-50 border-stone-800 ring-4 ring-stone-200 shadow-xs',
          lineClass: 'bg-stone-200',
          tagClass: 'text-stone-900 bg-stone-100 border-stone-300 font-bold',
          badgeText: '● Current Gate',
        };
      case 'CHANGES_REQUIRED':
        return {
          icon: <AlertTriangle className="h-3 w-3 text-amber-700" />,
          circleClass: 'bg-amber-50 text-amber-900 border-amber-400 ring-4 ring-amber-100 shadow-xs',
          lineClass: 'bg-stone-200',
          tagClass: 'text-amber-900 bg-amber-50 border-amber-200 font-bold',
          badgeText: '⚠️ Changes Req.',
        };
      case 'FAILED':
        return {
          icon: <X className="h-3 w-3 stroke-[3] text-rose-700" />,
          circleClass: 'bg-rose-50 text-rose-900 border-rose-400 ring-4 ring-rose-100 shadow-xs',
          lineClass: 'bg-stone-200',
          tagClass: 'text-rose-900 bg-rose-50 border-rose-200 font-bold',
          badgeText: '✕ Failed',
        };
      case 'PENDING':
      default:
        return {
          icon: <Circle className="h-2 w-2 text-stone-400" />,
          circleClass: 'bg-stone-100 text-stone-400 border-stone-300',
          lineClass: 'bg-stone-200',
          tagClass: 'text-stone-400 bg-stone-50 border-stone-200',
          badgeText: '○ Pending',
        };
    }
  };

  const getCiCdPhaseMeta = (gateId: string) => {
    switch (gateId) {
      case 'DISCUSS':
        return { tool: 'ChatGPT Bridge', role: 'Architecture Spec' };
      case 'SPECIFY':
        return { tool: 'PRD Contracts', role: 'API & Schema' };
      case 'ROUTE':
        return { tool: 'Model Router', role: 'Luna/Terra/Sol' };
      case 'IMPLEMENT':
        return { tool: 'Codex Worker', role: 'Branch Commit' };
      case 'TEST':
        return { tool: 'CI Runners', role: 'Unit / Security' };
      case 'REVIEW':
        return { tool: 'AI Reviewer', role: 'Tests ≠ Review' };
      case 'APPROVE':
        return { tool: 'Gatekeeper', role: 'Human Signoff' };
      case 'DONE':
        return { tool: 'CD Pipeline', role: 'Auto Deploy' };
      default:
        return { tool: 'Pipeline', role: 'Automated' };
    }
  };

  // Determine current active phase
  const isCurrentGateInPhase = (gateIds: string[]) => {
    return gateIds.includes(currentGateId);
  };

  return (
    <div className="w-full space-y-2">
      {/* 3-Zone CI/CD Pipeline Phase Visual Header */}
      <div className="grid grid-cols-8 gap-1 text-[10px] font-mono select-none px-2">
        {/* Phase 1: Pre-Commit & Planning (Gates 1-3) */}
        <div
          className={`col-span-3 py-1 px-2 rounded-t-md border border-b-0 transition-colors flex items-center justify-between ${
            isCurrentGateInPhase(['DISCUSS', 'SPECIFY', 'ROUTE'])
              ? 'bg-amber-50/80 border-amber-300 text-amber-900 font-semibold'
              : 'bg-stone-100 border-stone-300 text-stone-600'
          }`}
        >
          <span className="flex items-center gap-1">
            <Bot className="h-3 w-3 text-amber-700" />
            <strong className="tracking-wider">PHASE 1: PRE-COMMIT</strong> (AI 決策區)
          </span>
          <span className="text-[9px] text-stone-500 hidden sm:inline">ChatGPT ↔ Spec</span>
        </div>

        {/* Phase 2: Continuous Integration (CI) (Gates 4-6) */}
        <div
          className={`col-span-3 py-1 px-2 rounded-t-md border border-b-0 transition-colors flex items-center justify-between ${
            isCurrentGateInPhase(['IMPLEMENT', 'TEST', 'REVIEW'])
              ? 'bg-sky-50/80 border-sky-300 text-sky-950 font-semibold'
              : 'bg-stone-100 border-stone-300 text-stone-600'
          }`}
        >
          <span className="flex items-center gap-1">
            <Terminal className="h-3 w-3 text-sky-700" />
            <strong className="tracking-wider">PHASE 2: CI</strong> (持續整合驗證)
          </span>
          <span className="text-[9px] text-stone-500 hidden sm:inline">GitHub Actions</span>
        </div>

        {/* Phase 3: Continuous Delivery (CD) (Gates 7-8) */}
        <div
          className={`col-span-2 py-1 px-2 rounded-t-md border border-b-0 transition-colors flex items-center justify-between ${
            isCurrentGateInPhase(['APPROVE', 'DONE'])
              ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 font-semibold'
              : 'bg-stone-100 border-stone-300 text-stone-600'
          }`}
        >
          <span className="flex items-center gap-1">
            <Rocket className="h-3 w-3 text-emerald-700" />
            <strong className="tracking-wider">PHASE 3: CD</strong> (交付發布)
          </span>
          <span className="text-[9px] text-stone-500 hidden sm:inline">Release</span>
        </div>
      </div>

      {/* Horizontal Lifecycle Gate Flow Rail */}
      <div className="relative bg-white border border-stone-300 rounded-lg p-3 overflow-x-auto shadow-xs">
        <div className="flex items-start min-w-[720px] px-2">
          {gates.map((gate, index) => {
            const visual = getGateVisual(gate);
            const meta = getCiCdPhaseMeta(gate.id);
            const isLast = index === gates.length - 1;
            const isSelected = selectedGateId === gate.id;

            return (
              <div
                key={gate.id}
                className="flex-1 flex flex-col items-center relative group cursor-pointer"
                onClick={() => onSelectGate?.(gate)}
              >
                {/* Connecting Line between nodes */}
                {!isLast && (
                  <div
                    className={`absolute top-4 left-1/2 w-full h-[2px] -z-0 transition-colors ${
                      gate.status === 'COMPLETED' ? 'bg-emerald-300' : 'bg-stone-200'
                    }`}
                  />
                )}

                {/* Gate Step Circle Indicator */}
                <div
                  className={`relative z-10 h-8 w-8 rounded-full border flex items-center justify-center transition-all ${
                    visual.circleClass
                  } ${
                    isSelected ? 'ring-2 ring-stone-800 scale-110' : 'hover:scale-105'
                  }`}
                >
                  {visual.icon}
                </div>

                {/* Gate Label & CI/CD Mapping Details */}
                <div className="mt-2 text-center flex flex-col items-center max-w-[95px]">
                  <span
                    className={`text-[11px] font-mono font-semibold tracking-tight transition-colors ${
                      gate.status === 'CURRENT'
                        ? 'text-stone-900 font-bold'
                        : gate.status === 'CHANGES_REQUIRED'
                        ? 'text-amber-900 font-bold'
                        : gate.status === 'COMPLETED'
                        ? 'text-stone-800'
                        : 'text-stone-400'
                    }`}
                  >
                    {gate.shortLabel}
                  </span>

                  {/* CI/CD tool badge */}
                  <span className="text-[9px] font-mono text-stone-500 bg-stone-50 px-1 py-0.2 rounded border border-stone-200 mt-0.5">
                    {meta.tool}
                  </span>

                  {/* Sub-status tag (e.g. Tests: PASS vs Review: CHANGES) */}
                  {gate.testOutcome && (
                    <span
                      className={`text-[9px] font-mono px-1 py-0.2 rounded mt-1 border ${
                        gate.testOutcome === 'PASS'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : gate.testOutcome === 'FAIL'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-sky-50 text-sky-800 border-sky-200'
                      }`}
                    >
                      CI: {gate.testOutcome}
                    </span>
                  )}

                  {gate.reviewOutcome && (
                    <span
                      className={`text-[9px] font-mono px-1 py-0.2 rounded mt-1 border ${
                        gate.reviewOutcome === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : gate.reviewOutcome === 'CHANGES_REQUIRED'
                          ? 'bg-amber-50 text-amber-900 border-amber-200 font-bold'
                          : 'bg-stone-100 text-stone-600 border-stone-200'
                      }`}
                    >
                      {gate.reviewOutcome === 'CHANGES_REQUIRED' ? 'REV: CHANGES' : `REV: ${gate.reviewOutcome}`}
                    </span>
                  )}

                  {/* Timestamp if completed */}
                  {gate.timestamp && (
                    <span className="text-[9px] text-stone-400 font-mono mt-0.5 truncate max-w-[85px]">
                      {gate.timestamp}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
