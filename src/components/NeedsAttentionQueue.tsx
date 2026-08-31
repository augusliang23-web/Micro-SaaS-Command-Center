import React from 'react';
import {
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  Lock,
  GitPullRequest,
  ArrowUpRight,
  UserCheck,
  Check,
} from 'lucide-react';
import { AttentionItem, AttentionCategory } from '../types';
import { getWaitingStateBadge } from '../utils';

interface NeedsAttentionQueueProps {
  items: AttentionItem[];
  onSelectItem: (projectId: string, gateId: string) => void;
  onResolveItem: (itemId: string, projectId: string) => void;
}

export const NeedsAttentionQueue: React.FC<NeedsAttentionQueueProps> = ({
  items,
  onSelectItem,
  onResolveItem,
}) => {
  const getCategoryMeta = (category: AttentionCategory) => {
    switch (category) {
      case 'HUMAN_DECISION':
        return {
          icon: <HelpCircle className="h-4 w-4 text-amber-700" />,
          badgeBg: 'bg-amber-50 text-amber-900 border-amber-200',
          label: 'Human Decision Required',
        };
      case 'PRODUCTION_BLOCKER':
        return {
          icon: <Lock className="h-4 w-4 text-rose-700" />,
          badgeBg: 'bg-rose-50 text-rose-900 border-rose-200',
          label: 'Environment / Blocker',
        };
      case 'READY_FOR_REVIEW':
        return {
          icon: <GitPullRequest className="h-4 w-4 text-emerald-700" />,
          badgeBg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          label: 'Ready for Review / Approval',
        };
      case 'REVIEW_FAILED':
        return {
          icon: <AlertCircle className="h-4 w-4 text-orange-700" />,
          badgeBg: 'bg-orange-50 text-orange-900 border-orange-200',
          label: 'Review / Test Issue',
        };
      default:
        return {
          icon: <UserCheck className="h-4 w-4 text-stone-700" />,
          badgeBg: 'bg-stone-100 text-stone-700 border-stone-300',
          label: 'Attention Required',
        };
    }
  };

  return (
    <section className="bg-white border border-stone-300/90 rounded-xl p-4 sm:p-5 shadow-xs">
      <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-stone-200">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber-600 animate-pulse" />
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider font-mono">
            Needs Attention — Human Decision Queue
          </h2>
        </div>
        <span className="text-xs font-mono text-stone-500">
          {items.length} pending items waiting for human input
        </span>
      </div>

      {items.length === 0 ? (
        <div className="py-8 text-center bg-stone-50 rounded-lg border border-dashed border-stone-300">
          <CheckCircle2 className="h-8 w-8 text-emerald-700 mx-auto mb-2 opacity-80" />
          <p className="text-sm font-medium text-stone-800">All Human Decisions & Reviews are Clear</p>
          <p className="text-xs text-stone-500 mt-0.5">AI workflows are running autonomously without blocker.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((item) => {
            const meta = getCategoryMeta(item.category);
            const waitMeta = getWaitingStateBadge(item.waitingState);

            return (
              <div
                key={item.id}
                className="group relative bg-[#FCFBF9] hover:bg-[#F7F6F2] border border-stone-300/80 hover:border-stone-400 rounded-lg p-3.5 transition-all flex flex-col justify-between gap-2.5 cursor-pointer shadow-xs"
                onClick={() => onSelectItem(item.projectId, item.gate)}
              >
                <div>
                  {/* Top Bar with Category & Project */}
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${meta.badgeBg}`}>
                        {meta.icon}
                        <span>{meta.label}</span>
                      </span>
                      <span className="text-xs font-bold text-stone-900 font-mono">
                        {item.projectName}
                      </span>
                    </div>

                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${waitMeta.bg} ${waitMeta.text} ${waitMeta.border}`}>
                      {waitMeta.label}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-xs sm:text-sm font-semibold text-stone-900 group-hover:text-stone-700 transition-colors leading-snug">
                    {item.title}
                  </h3>
                  <p className="text-xs text-stone-600 mt-1 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                {/* Bottom Action Footer */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-stone-200 text-xs font-mono">
                  <div className="flex items-center gap-2 text-[11px] text-stone-500">
                    <span>Gate: <strong className="text-amber-800">{item.gate}</strong></span>
                    {item.prOrIssueRef && (
                      <span className="text-stone-400">Ref: {item.prOrIssueRef}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onResolveItem(item.id, item.projectId)}
                      className="px-2 py-1 text-[11px] font-mono bg-white hover:bg-emerald-50 text-stone-700 hover:text-emerald-800 border border-stone-300 hover:border-emerald-300 rounded flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
                      title="Quick resolve item"
                    >
                      <Check className="h-3 w-3 text-emerald-700" />
                      <span>Resolve</span>
                    </button>
                    <button
                      onClick={() => onSelectItem(item.projectId, item.gate)}
                      className="p-1 text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 rounded transition-colors"
                      title="Inspect project"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
