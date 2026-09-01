import React, { useState } from 'react';
import {
  ArrowRight,
  Sparkles,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Zap,
} from 'lucide-react';
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
  const [isExpanded, setIsExpanded] = useState(false);
  const modelStyle = getModelBadgeStyle(nba.model);

  return (
    <div className="bg-white border border-stone-300 rounded-lg p-3.5 sm:p-4 shadow-xs transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: High-signal title & project */}
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-md bg-stone-900 text-amber-300 shrink-0 mt-0.5 sm:mt-0">
            <Zap className="h-3.5 w-3.5" />
          </div>

          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono font-bold text-stone-900 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-300">
                {nba.projectName}
              </span>
              <span
                className="text-[10px] font-mono px-1.5 py-0.2 rounded border"
                style={{
                  backgroundColor: modelStyle.bg,
                  color: modelStyle.accent,
                  borderColor: modelStyle.border,
                }}
              >
                {nba.model}
              </span>
              <span className="text-[10px] font-mono text-stone-500">
                Gate: <strong className="text-amber-800">{nba.gate}</strong>
              </span>
              <span className="text-[10px] font-mono text-stone-500 hidden md:inline">
                • {nba.contextPill}
              </span>
            </div>

            <h3 className="text-xs sm:text-sm font-semibold text-stone-900 truncate">
              {nba.actionTitle}
            </h3>
          </div>
        </div>

        {/* Right: Quick actions & details toggle */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[11px] font-mono text-stone-500 hover:text-stone-800 px-2 py-1 rounded hover:bg-stone-100 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>{isExpanded ? '收起細節' : '查看說明'}</span>
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          <button
            onClick={() => onSimulateApprove(nba.projectId)}
            className="px-2.5 py-1.5 text-xs font-mono bg-white hover:bg-stone-50 text-stone-700 border border-stone-300 rounded-md flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
            title="快速決策並放行"
          >
            <CheckSquare className="h-3.5 w-3.5 text-emerald-700" />
            <span className="hidden sm:inline">快速放行</span>
          </button>

          <button
            onClick={() => onExecute(nba.projectId, nba.gate)}
            className="px-3 py-1.5 text-xs font-mono font-semibold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-md flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
          >
            <span>處理決策</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Expandable context details */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-stone-200 text-xs text-stone-600 font-mono space-y-1.5 animate-fadeIn">
          <p className="leading-relaxed">{nba.summary}</p>
          <div className="text-[11px] text-emerald-800 font-medium">
            預期效益：{nba.impactReason}
          </div>
        </div>
      )}
    </div>
  );
};
