import React from 'react';
import { X, Sparkles, CheckCircle2, ShieldCheck, Zap, AlertTriangle, ShieldAlert } from 'lucide-react';

interface ModelRoutingGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ModelRoutingGuide: React.FC<ModelRoutingGuideProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-[#F7F6F2] border border-stone-300 rounded-xl shadow-2xl overflow-hidden animate-fadeIn text-stone-800">
        {/* Modal Header */}
        <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-stone-100 text-stone-700 border border-stone-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-900 font-mono uppercase tracking-wider">
                Codex Model Routing Matrix
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Automated model allocation based on task risk, blast radius, and reasoning depth.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-4 text-xs font-mono">
          {/* Luna Tier */}
          <div className="bg-white border border-stone-300 rounded-lg p-4 space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Zap className="h-4 w-4 text-stone-500" />
                Luna Tier (Low Risk / Deterministic)
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-300">
                Reasoning: Low
              </span>
            </div>
            <p className="text-stone-600 text-xs leading-relaxed">
              Fast, deterministic tasks requiring zero architectural modifications or state changes.
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] text-stone-700">
              <div className="flex items-center gap-1.5">✓ Documentation updates</div>
              <div className="flex items-center gap-1.5">✓ Lint & formatting passes</div>
              <div className="flex items-center gap-1.5">✓ Safe package/config bumps</div>
              <div className="flex items-center gap-1.5">✓ Localized variable renames</div>
            </div>
          </div>

          {/* Terra Tier */}
          <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-4 space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-sky-950 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-sky-700" />
                Terra Tier (Moderate Complexity / Feature Building)
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300 font-medium">
                Reasoning: Medium
              </span>
            </div>
            <p className="text-stone-600 text-xs leading-relaxed">
              Core application feature engineering, multi-file CRUD workflows, automated testing, and independent code review.
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] text-sky-900">
              <div className="flex items-center gap-1.5">✓ Multi-file CRUD features</div>
              <div className="flex items-center gap-1.5">✓ Test suite generation</div>
              <div className="flex items-center gap-1.5">✓ Independent code reviews</div>
              <div className="flex items-center gap-1.5">✓ Medium component refactors</div>
            </div>
          </div>

          {/* Sol Tier */}
          <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-4 space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-amber-950 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-700" />
                Sol Tier (High Blast Radius / Critical Architecture)
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-medium">
                Reasoning: High
              </span>
            </div>
            <p className="text-stone-600 text-xs leading-relaxed">
              High-consequence system boundaries, financial billing paths, authentication security, schema migrations, and live incidents.
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] text-amber-900">
              <div className="flex items-center gap-1.5">✓ Auth, RBAC & token security</div>
              <div className="flex items-center gap-1.5">✓ Stripe / Billing idempotency</div>
              <div className="flex items-center gap-1.5">✓ Production incident triage</div>
              <div className="flex items-center gap-1.5">✓ Database schema migrations</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#FAF9F6] border-t border-stone-200 px-6 py-3 flex items-center justify-between">
          <span className="text-[11px] text-stone-500 font-mono">
            Model routing is automatically logged in each task's Bridge context.
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-mono bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-md transition-colors cursor-pointer shadow-xs"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
