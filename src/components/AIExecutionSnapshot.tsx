import React from 'react';
import { Cpu, UserCheck, ShieldAlert, Clock, PauseCircle, PlayCircle, HelpCircle } from 'lucide-react';
import { AIExecutionSnapshotData } from '../types';

interface AIExecutionSnapshotProps {
  snapshot: AIExecutionSnapshotData;
  onOpenModelGuide: () => void;
  onFilterByModel?: (model: string) => void;
}

export const AIExecutionSnapshot: React.FC<AIExecutionSnapshotProps> = ({
  snapshot,
  onOpenModelGuide,
  onFilterByModel,
}) => {
  return (
    <section className="bg-white border border-stone-300/90 rounded-xl p-4 shadow-xs">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-200">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-stone-700" />
          <h3 className="text-xs font-semibold text-stone-900">
            AI 目前在忙什麼
          </h3>
        </div>

        <button
          onClick={onOpenModelGuide}
          className="text-[11px] font-mono text-stone-500 hover:text-stone-900 flex items-center gap-1 transition-colors cursor-pointer"
        >
          <HelpCircle className="h-3 w-3" />
          <span>AI 模型分級說明</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {/* Model Tiers */}
        <div
          onClick={() => onFilterByModel?.('Luna')}
          className="bg-stone-50 border border-stone-300/90 rounded-lg p-2.5 hover:border-stone-400 transition-colors cursor-pointer shadow-xs"
        >
          <div className="text-[10px] font-mono text-stone-600 uppercase tracking-wider">
            Luna
          </div>
          <div className="text-lg font-bold font-mono text-stone-900 mt-0.5">
            {snapshot.lunaTasks}
          </div>
          <div className="text-[10px] text-stone-500 truncate">簡單瑣事：文件、格式、設定</div>
        </div>

        <div
          onClick={() => onFilterByModel?.('Terra')}
          className="bg-sky-50/70 border border-sky-200 rounded-lg p-2.5 hover:border-sky-300 transition-colors cursor-pointer shadow-xs"
        >
          <div className="text-[10px] font-mono text-sky-800 uppercase tracking-wider">
            Terra
          </div>
          <div className="text-lg font-bold font-mono text-sky-950 mt-0.5">
            {snapshot.terraTasks}
          </div>
          <div className="text-[10px] text-sky-700/80 truncate">一般功能開發與測試</div>
        </div>

        <div
          onClick={() => onFilterByModel?.('Sol')}
          className="bg-amber-50/70 border border-amber-200 rounded-lg p-2.5 hover:border-amber-300 transition-colors cursor-pointer shadow-xs"
        >
          <div className="text-[10px] font-mono text-amber-900 uppercase tracking-wider">
            Sol
          </div>
          <div className="text-lg font-bold font-mono text-amber-950 mt-0.5">
            {snapshot.solTasks}
          </div>
          <div className="text-[10px] text-amber-800/80 truncate">高風險：架構、安全、金流</div>
        </div>

        {/* Workflow State Counters */}
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-2.5 shadow-xs">
          <div className="text-[10px] font-mono text-amber-900 uppercase tracking-wider flex items-center gap-1">
            <UserCheck className="h-3 w-3 text-amber-700" />
            <span>需要你決定</span>
          </div>
          <div className="text-lg font-bold font-mono text-amber-950 mt-0.5">
            {snapshot.waitingForHuman}
          </div>
          <div className="text-[10px] text-amber-800/80 truncate">等你回答問題</div>
        </div>

        <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5 shadow-xs">
          <div className="text-[10px] font-mono text-emerald-800 uppercase tracking-wider flex items-center gap-1">
            <Clock className="h-3 w-3 text-emerald-700" />
            <span>可以繼續了</span>
          </div>
          <div className="text-lg font-bold font-mono text-emerald-950 mt-0.5">
            {snapshot.waitingForReview}
          </div>
          <div className="text-[10px] text-emerald-800/80 truncate">等你確認即可繼續</div>
        </div>

        <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-2.5 shadow-xs">
          <div className="text-[10px] font-mono text-rose-800 uppercase tracking-wider flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 text-rose-700" />
            <span>AI 卡住了</span>
          </div>
          <div className="text-lg font-bold font-mono text-rose-950 mt-0.5">
            {snapshot.blocked}
          </div>
          <div className="text-[10px] text-rose-800/80 truncate">需要你看一下</div>
        </div>

        <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-2.5 shadow-xs">
          <div className="text-[10px] font-mono text-sky-800 uppercase tracking-wider flex items-center gap-1">
            <PlayCircle className="h-3 w-3 text-sky-700 animate-spin" />
            <span>AI 執行中</span>
          </div>
          <div className="text-lg font-bold font-mono text-sky-950 mt-0.5">
            {snapshot.aiRunning}
          </div>
          <div className="text-[10px] text-sky-700/80 truncate">自動進行中，還沒輪到你</div>
        </div>
      </div>
    </section>
  );
};
