import React from 'react';
import { ArrowRight, CheckCircle2, AlertTriangle, Sparkles, CornerDownRight, CheckSquare } from 'lucide-react';
import { NextBestAction } from '../types';
import { getModelBadgeStyle } from '../utils';

interface NextBestActionCardProps {
  nba: NextBestAction;
  attentionCount: number;
  onExecute: (projectId: string, gateId: string) => void;
  onSimulateApprove: (projectId: string) => void;
}

export const NextBestActionCard: React.FC<NextBestActionCardProps> = ({
  nba,
  attentionCount,
  onExecute,
  onSimulateApprove,
}) => {
  const modelStyle = getModelBadgeStyle(nba.model);

  return (
    <section className="bg-white border border-stone-300/90 rounded-xl p-4 sm:p-5 shadow-xs relative overflow-hidden">
      {/* Subtle indicator bar */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-stone-300" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Main Focus Content */}
        <div className="space-y-2 max-w-3xl">
          {/* Eyebrow & Badges */}
          <div className="flex items-center flex-wrap gap-2 text-xs">
            <span className="font-mono text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-stone-900 text-stone-100 border border-stone-800 flex items-center gap-1.5 shadow-xs">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Next Best Action
            </span>

            <span className="text-stone-500 font-mono">
              Target Project: <strong className="text-stone-900 font-semibold">{nba.projectName}</strong>
            </span>

            <span
              className="text-[11px] font-mono px-2 py-0.5 rounded border"
              style={{
                backgroundColor: modelStyle.bg,
                color: modelStyle.accent,
                borderColor: modelStyle.border,
              }}
            >
              Model: {nba.model}
            </span>

            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-300">
              Gate: <span className="text-amber-800 font-semibold">{nba.gate}</span>
            </span>

            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
              {nba.contextPill}
            </span>
          </div>

          {/* Action Title */}
          <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight leading-snug">
            {nba.actionTitle}
          </h2>

          {/* Summary & Impact */}
          <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
            {nba.summary}
          </p>

          <div className="flex items-center gap-1.5 text-xs text-stone-500 font-mono pt-0.5">
            <CornerDownRight className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
            <span className="text-stone-500">Business Impact:</span>
            <span className="text-emerald-800 font-medium">{nba.impactReason}</span>
          </div>
        </div>

        {/* Action Controls & Attention Counter */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-start lg:items-end justify-between gap-3 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-stone-200">
          {/* Attention Badge Counter */}
          <div className="text-right">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs font-mono">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
              <span>{attentionCount} Projects Need Attention</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => onExecute(nba.projectId, nba.gate)}
              className="w-full sm:w-auto px-4 py-2 text-xs font-medium bg-stone-900 hover:bg-stone-800 text-stone-50 font-mono rounded-lg flex items-center justify-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <span>{nba.quickActionLabel}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => onSimulateApprove(nba.projectId)}
              className="px-3 py-2 text-xs font-mono bg-white hover:bg-stone-50 text-stone-800 border border-stone-300 rounded-lg flex items-center gap-1.5 transition-colors active:scale-95 whitespace-nowrap shadow-xs cursor-pointer"
              title="Quick-simulate approving policy and advancing gate"
            >
              <CheckSquare className="h-3.5 w-3.5 text-emerald-700" />
              <span>Quick-Decide & Pass</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
