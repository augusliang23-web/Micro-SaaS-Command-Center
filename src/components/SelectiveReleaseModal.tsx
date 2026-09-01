import React, { useState } from 'react';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Layers,
  FileCode,
  Tag,
  Copy,
  Check,
  Server,
  Filter,
} from 'lucide-react';
import { MicroSaaSProject, FeatureItem } from '../types';

interface SelectiveReleaseModalProps {
  project: MicroSaaSProject;
  isOpen: boolean;
  onClose: () => void;
  onConfirmSelectiveRelease: (
    projectId: string,
    selectedFeatureIds: string[],
    releaseVersion: string,
    releaseNotes: string
  ) => void;
}

export const SelectiveReleaseModal: React.FC<SelectiveReleaseModalProps> = ({
  project,
  isOpen,
  onClose,
  onConfirmSelectiveRelease,
}) => {
  if (!isOpen) return null;

  const currentProdVer = project.environment.production.version || 'v1.0.0';
  const defaultTargetVer =
    project.environment.targetReleaseVersion ||
    project.environment.staging?.version?.replace('-rc.1', '').replace('-alpha.1', '').replace('-proto', '') ||
    'v1.1.0';

  const [targetVersion, setTargetVersion] = useState<string>(defaultTargetVer);
  const [releaseStrategy, setReleaseStrategy] = useState<'flags' | 'cherrypick'>('flags');

  // Filter features that are in Stage / Ready or Pending
  const allFeatures: FeatureItem[] = project.features || [];
  const stagedFeatures = allFeatures.filter(
    (f) => f.stageStatus === 'Verified' || f.stageStatus === 'Testing' || f.prodStatus === 'Pending Release' || f.prodStatus === 'Flag Disabled'
  );

  // Default selected: features that are 'Verified' or 'Pending Release'
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const initial = stagedFeatures
      .filter((f) => f.stageStatus === 'Verified' || f.prodStatus === 'Pending Release')
      .map((f) => f.id);
    return initial.length > 0 ? initial : stagedFeatures.slice(0, 3).map((f) => f.id);
  });

  const [copiedChangelog, setCopiedChangelog] = useState(false);

  const toggleFeature = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedIds(stagedFeatures.map((f) => f.id));
  };

  const selectNone = () => {
    setSelectedIds([]);
  };

  const selectedFeatures = stagedFeatures.filter((f) => selectedIds.includes(f.id));
  const unselectedFeatures = stagedFeatures.filter((f) => !selectedIds.includes(f.id));

  // Auto-generate Release Notes Markdown preview
  const generateChangelog = () => {
    const dateStr = new Date().toISOString().split('T')[0];
    const releasedList = selectedFeatures
      .map(
        (f) =>
          `- **${f.name}** (${f.category})${f.githubIssue ? ` [${f.githubIssue}]` : ''}: ${f.description}`
      )
      .join('\n');

    const heldList = unselectedFeatures
      .map(
        (f) =>
          `- ⏸️ [Held in Stage] **${f.name}** (Flag: \`${f.featureFlagKey}\` = OFF in Prod, Target: Next Train)`
      )
      .join('\n');

    return `## [${targetVersion}] - ${dateStr}\n\n### 🚀 Shipped to Production (${selectedFeatures.length} features)\n${
      releasedList || '- No features selected'
    }\n\n### 🔒 Held in Staging Sandbox (${unselectedFeatures.length} features)\n${
      heldList || '- None'
    }\n\n---\n*Deployment Strategy: ${
      releaseStrategy === 'flags' ? 'Feature Flags Gating (Zero Branch Drift)' : 'Cherry-Pick Release Branch'
    } | Verified via ChatGPT Bridge CI/CD*`;
  };

  const handleCopyChangelog = () => {
    navigator.clipboard.writeText(generateChangelog());
    setCopiedChangelog(true);
    setTimeout(() => setCopiedChangelog(false), 2000);
  };

  const handleConfirm = () => {
    onConfirmSelectiveRelease(
      project.id,
      selectedIds,
      targetVersion,
      generateChangelog()
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#F7F6F2] rounded-2xl border border-stone-300 shadow-2xl max-w-3xl w-full overflow-hidden text-stone-800 animate-fadeIn my-6">
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-amber-700 font-bold">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-stone-900 font-mono text-base">
                  選擇性發布至 Production (Selective Promote)
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-300">
                  {project.name}
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                從 Stage 測試環境的 <strong>{stagedFeatures.length} 個候選功能</strong> 中，勾選本次要推進線上的項目，其餘自動留存於 Stage 等候下一輪。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Target Version & Strategy Bar */}
          <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-stone-700 font-mono">發布目標版號 (Target SemVer):</span>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="text-xs text-stone-500 bg-stone-100 px-2 py-1 rounded border border-stone-200">
                    目前線上: {currentProdVer}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={targetVersion}
                    onChange={(e) => setTargetVersion(e.target.value)}
                    className="w-28 px-2 py-1 text-xs font-bold font-mono bg-amber-50/70 border border-amber-300 rounded text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    placeholder="v1.1.0"
                  />
                </div>
              </div>

              {/* Release Strategy Selector */}
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-stone-500">控管模式:</span>
                <div className="inline-flex rounded-lg border border-stone-300 p-0.5 bg-stone-100">
                  <button
                    type="button"
                    onClick={() => setReleaseStrategy('flags')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      releaseStrategy === 'flags'
                        ? 'bg-white text-stone-900 shadow-xs font-bold'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    Feature Flags (推薦)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReleaseStrategy('cherrypick')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      releaseStrategy === 'cherrypick'
                        ? 'bg-white text-stone-900 shadow-xs font-bold'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    Cherry-Pick 分支
                  </button>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded border border-stone-200 leading-relaxed">
              💡 <strong>Feature Flags 原理</strong>：10 個功能程式碼可一次安全部署至 Production，但系統會自動將未勾選的 <strong>{unselectedFeatures.length} 個功能旗標 (Flags) 設為 OFF</strong>，確保線上零風險，且永不丟失開發進度！
            </div>
          </div>

          {/* Feature Selection Table */}
          <div className="bg-white rounded-xl border border-stone-300 shadow-xs overflow-hidden">
            <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="font-bold text-stone-900">
                  Stage 候選功能清單 ({selectedFeatures.length} / {stagedFeatures.length} 已選擇)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="text-stone-600 hover:text-stone-900 text-[11px] underline cursor-pointer"
                >
                  全選
                </button>
                <span className="text-stone-300">|</span>
                <button
                  onClick={selectNone}
                  className="text-stone-600 hover:text-stone-900 text-[11px] underline cursor-pointer"
                >
                  清除
                </button>
              </div>
            </div>

            <div className="divide-y divide-stone-200 max-h-64 overflow-y-auto">
              {stagedFeatures.map((feat) => {
                const isSelected = selectedIds.includes(feat.id);
                return (
                  <div
                    key={feat.id}
                    onClick={() => toggleFeature(feat.id)}
                    className={`p-3 flex items-start gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-amber-50/50 hover:bg-amber-50/80' : 'hover:bg-stone-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleFeature(feat.id)}
                      className="mt-1 h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900 cursor-pointer"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-stone-900">{feat.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-100 text-stone-600 border border-stone-200 font-mono">
                          {feat.category}
                        </span>
                        {feat.githubIssue && (
                          <span className="text-[10px] text-sky-700 font-mono">
                            {feat.githubIssue}
                          </span>
                        )}
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                            feat.stageStatus === 'Verified'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-50 text-amber-900 border border-amber-200'
                          }`}
                        >
                          Stage: {feat.stageStatus}
                        </span>
                      </div>

                      <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">{feat.description}</p>

                      <div className="flex items-center gap-3 text-[10px] font-mono text-stone-400 mt-1">
                        <span>Flag: <code className="text-stone-600">{feat.featureFlagKey}</code></span>
                        <span>•</span>
                        <span>{isSelected ? '🟢 Prod 將開啟 (Flag: ON)' : '🔒 Prod 將封鎖 (Flag: OFF)'}</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded font-mono ${
                          isSelected
                            ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                            : 'bg-stone-100 text-stone-500 border border-stone-200'
                        }`}
                      >
                        {isSelected ? `推入 ${targetVersion}` : '留在 Stage'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Real-time Generated CHANGELOG.md Preview */}
          <div className="bg-white rounded-xl border border-stone-300 p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold text-stone-900 flex items-center gap-1.5">
                <FileCode className="h-4 w-4 text-stone-700" />
                自動產出發布日誌與版本檔案 (Release Notes & CHANGELOG.md)
              </span>
              <button
                onClick={handleCopyChangelog}
                className="text-[11px] text-stone-600 hover:text-stone-900 flex items-center gap-1 cursor-pointer"
              >
                {copiedChangelog ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-stone-400" />}
                <span>{copiedChangelog ? '已複製' : '複製 Markdown'}</span>
              </button>
            </div>

            <pre className="bg-stone-900 text-stone-200 p-3 rounded-lg text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
              {generateChangelog()}
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-white px-6 py-4 border-t border-stone-200 flex items-center justify-between">
          <div className="text-xs font-mono text-stone-500">
            發布後：<strong className="text-stone-800">{selectedFeatures.length} 個功能</strong> 上線 Prod，
            <strong className="text-stone-800">{unselectedFeatures.length} 個功能</strong> 留存於 Stage Backlog 待下一輪。
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-mono text-stone-600 hover:text-stone-800 bg-white hover:bg-stone-100 rounded-lg border border-stone-300 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedFeatures.length === 0}
              className="px-4 py-2 text-xs font-mono font-bold text-white bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>🚀 確認發布 ({selectedFeatures.length} 項至 {targetVersion})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
