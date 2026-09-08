import React, { useState } from 'react';
import {
  X,
  Bot,
  Terminal,
  Rocket,
  GitBranch,
  GitPullRequest,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles,
  Server,
  Zap,
  RotateCcw,
  RefreshCw,
  Flame,
  FileCode2,
  FileCheck2,
  Workflow,
  HelpCircle,
  Activity,
} from 'lucide-react';
import { MicroSaaSProject } from '../types';

interface CiCdWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject?: MicroSaaSProject | null;
}

export const CiCdWorkflowModal: React.FC<CiCdWorkflowModalProps> = ({
  isOpen,
  onClose,
  currentProject,
}) => {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'environments' | 'selective' | 'iteration'>('pipeline');
  const [selectedScenario, setSelectedScenario] = useState<'major' | 'minor' | 'hotfix' | 'maint'>('major');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-[#F7F6F2] border border-stone-300 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-stone-800">
        {/* Header */}
        <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-stone-900 text-stone-50">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-stone-900 font-mono uppercase tracking-wider">
                  Bridge 8-Gate ↔ 標準 CI/CD 流程 & 改版迭代機制
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300">
                  Standard CI/CD Architecture
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                將 AI Agent 自主編程納入企業級 Pre-Commit ➔ CI ➔ CD 與上線後改版回流循環。
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

        {/* Tab Navigation */}
        <div className="bg-white px-6 border-b border-stone-200 flex items-center gap-4 text-xs font-mono overflow-x-auto">
          <button
            onClick={() => setActiveTab('pipeline')}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'pipeline'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Workflow className="h-4 w-4" />
            <span>三階段 CI/CD 流水線架構</span>
          </button>
          <button
            onClick={() => setActiveTab('environments')}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'environments'
                ? 'border-sky-600 text-sky-900 bg-sky-50/50 px-2 rounded-t'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Server className="h-4 w-4 text-sky-700" />
            <span>🌐 Stage vs. Production 雙軌環境</span>
          </button>
          <button
            onClick={() => setActiveTab('selective')}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'selective'
                ? 'border-emerald-600 text-emerald-900 bg-emerald-50/50 px-2 rounded-t'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Zap className="h-4 w-4 text-emerald-700" />
            <span>🎯 選擇性發布 (Selective Release & 旗標)</span>
          </button>
          <button
            onClick={() => setActiveTab('iteration')}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'iteration'
                ? 'border-amber-600 text-amber-900 bg-amber-50/50 px-2 rounded-t'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <RotateCcw className="h-4 w-4 text-amber-700" />
            <span>⚡ 改版迭代與 Hotfix 回流路徑</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 text-xs font-mono">
          {/* Current Project Live Position Indicator */}
          {currentProject && (
            <div className="bg-white p-3.5 rounded-lg border border-stone-300 shadow-xs flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-stone-500">當前專案位置：</span>
                <strong className="text-stone-900 text-xs">{currentProject.name}</strong>
                <span className="text-stone-400">({currentProject.repository})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-stone-600">當前停留在關卡：</span>
                <span className="px-2.5 py-1 rounded bg-stone-900 text-stone-50 font-bold">
                  {currentProject.currentGate} ({currentProject.currentGateLabel})
                </span>
                {currentProject.currentGate === 'DONE' && (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold border border-emerald-300">
                    🟢 已在 Production 營運中 (可發起新改版)
                  </span>
                )}
              </div>
            </div>
          )}

          {activeTab === 'pipeline' && (
            <>
              {/* 3 Main Stages Pipeline Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Phase 1: Pre-Commit */}
                <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-400" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-amber-900 font-bold">
                      <Bot className="h-4 w-4 text-amber-700" />
                      <span>PHASE 1: PRE-COMMIT</span>
                    </div>
                    <span className="text-[10px] bg-amber-50 text-amber-900 px-1.5 py-0.2 rounded border border-amber-200">
                      AI 決策與架構
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    在代碼產生前建立明確規格契約與模型路由，避免 AI 瞎猜與無謂消耗 Token。
                  </p>
                  <div className="space-y-2 pt-1 border-t border-stone-100">
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">1. DISCUSS (對齊目標)</div>
                      <div className="text-[10px] text-stone-500">AI 顧問上下文對話、產品方向溝通</div>
                    </div>
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">2. SPECIFY (規格契約)</div>
                      <div className="text-[10px] text-stone-500">技術 PRD、Schema 定義、Safety Checklist</div>
                    </div>
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">3. ROUTE (模型分流)</div>
                      <div className="text-[10px] text-stone-500">依爆炸半徑動態指派 Luna / Terra / Sol</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-stone-500 bg-stone-100 p-2 rounded">
                    ⚡ <strong>輸出產物</strong>：.bridge/context.md 規格檔與 Issue 指派
                  </div>
                </div>

                {/* Phase 2: CI (Continuous Integration) */}
                <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-sky-500" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sky-950 font-bold">
                      <Terminal className="h-4 w-4 text-sky-700" />
                      <span>PHASE 2: CI (整合驗證)</span>
                    </div>
                    <span className="text-[10px] bg-sky-50 text-sky-900 px-1.5 py-0.2 rounded border border-sky-200">
                      GitHub Actions
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    自主背景工作者撰寫代碼並即時執行測試流水線，落實「Tests PASS ≠ Review PASS」。
                  </p>
                  <div className="space-y-2 pt-1 border-t border-stone-100">
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">4. IMPLEMENT (自主開發)</div>
                      <div className="text-[10px] text-stone-500">AI 代理背景分支執行、多檔案自動修改</div>
                    </div>
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">5. TEST (自動化測試)</div>
                      <div className="text-[10px] text-stone-500">Unit Tests、Linting、型別檢查、安全掃描</div>
                    </div>
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">6. REVIEW (獨立 AI 審查)</div>
                      <div className="text-[10px] text-stone-500">第二獨立 AI 審查架構安全與死鎖風險</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-stone-500 bg-stone-100 p-2 rounded">
                    ⚡ <strong>輸出產物</strong>：Pull Request + CI 綠燈測試報告
                  </div>
                </div>

                {/* Phase 3: CD (Continuous Delivery) */}
                <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-emerald-950 font-bold">
                      <Rocket className="h-4 w-4 text-emerald-700" />
                      <span>PHASE 3: CD (交付發布)</span>
                    </div>
                    <span className="text-[10px] bg-emerald-50 text-emerald-900 px-1.5 py-0.2 rounded border border-emerald-200">
                      Release & Deploy
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    人工看門人放行（Human-in-the-loop）後，觸發正式環境與預發環境的容器發布。
                  </p>
                  <div className="space-y-2 pt-1 border-t border-stone-100">
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">7. APPROVE (人工放行)</div>
                      <div className="text-[10px] text-stone-500">人類工程師 1-Click PR Merge / 合併分支</div>
                    </div>
                    <div className="p-2 bg-stone-50 rounded border border-stone-200 space-y-0.5">
                      <div className="font-bold text-stone-800">8. DONE (自動部屬上線)</div>
                      <div className="text-[10px] text-stone-500">Docker 映像檔構建、推送至 Cloud Run / UAT</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-stone-500 bg-stone-100 p-2 rounded">
                    ⚡ <strong>輸出產物</strong>：Live Production 營運版本
                  </div>
                </div>
              </div>

              {/* End-to-End Visual Workflow Comparison Matrix */}
              <div className="bg-white p-4 rounded-xl border border-stone-300 space-y-3 shadow-xs">
                <h4 className="font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-700" />
                  <span>Bridge 與傳統 CI/CD 的關鍵差別對照</span>
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-stone-200 bg-[#F7F6F2] text-stone-500">
                        <th className="py-2 px-3">環節</th>
                        <th className="py-2 px-3">傳統 CI/CD (Legacy)</th>
                        <th className="py-2 px-3 text-emerald-800 font-bold">Bridge + CI/CD 協同流水線 (Modern)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200 text-stone-700">
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">需求與 PRD</td>
                        <td className="py-2.5 px-3 text-stone-500">人類在 Jira 撰寫，無程式碼合約綁定</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          <strong>AI 顧問 (Gate 1-2)</strong> 自動產出標準化 <code>.bridge/context.md</code>
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">模型與運算分配</td>
                        <td className="py-2.5 px-3 text-stone-500">無（工程師手動手刻）</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          <strong>Dynamic Routing (Gate 3)</strong> 依風險分流至 Luna / Terra / Sol
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">代碼審查機制</td>
                        <td className="py-2.5 px-3 text-stone-500">僅看單元測試是否 PASS</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          <strong>Tests PASS ≠ Review PASS (Gate 6)</strong> 測試過仍須獨立 AI 審查死鎖與安全
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">最終發布決策</td>
                        <td className="py-2.5 px-3 text-stone-500">手動建立 PR，逐行 Code Review</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          <strong>Human Gatekeeper (Gate 7)</strong> 專注於架構決策與一鍵放行
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === 'environments' && (
            <div className="space-y-5">
              {/* Architecture Introduction */}
              <div className="bg-sky-50/70 border border-sky-300 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-sky-950 font-bold">
                  <Server className="h-4 w-4 text-sky-700" />
                  <span>雙軌環境架構：Stage (測試/預發驗證) ➔ Production (正式線上穩定)</span>
                </div>
                <p className="text-[11px] text-sky-900 leading-relaxed">
                  為了避免 AI 自主修改的程式碼或改版直接衝擊線上付費用戶，系統落實<strong>「隔離預發（Stage Preview）」</strong>與<strong>「線上正式（Production）」</strong>雙軌架構。所有改版分支皆會自動佈署至獨立的 Stage 測試網址，供創辦人實測無誤後，方可 1-Click Promote 至 Production。
                </p>
              </div>

              {/* Dual Environment Comparison Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Stage Environment */}
                <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                      <h4 className="font-bold text-stone-900 text-xs uppercase font-mono">
                        Stage (預發 / 測試環境 / UAT)
                      </h4>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-900 border border-amber-300">
                      動態測試站
                    </span>
                  </div>

                  <div className="space-y-2 text-[11px] text-stone-600">
                    <div className="flex items-start gap-2">
                      <span className="text-amber-700 font-bold">•</span>
                      <span><strong>版號命名規則：</strong> 候選版本 (Release Candidate)，如 <code>v1.2.0-rc.1</code> 或 <code>v1.1.1-hotfix.1</code>。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-amber-700 font-bold">•</span>
                      <span><strong>自動部署時機：</strong> 當 AI 在 Phase 2（Gate 4 IMPLEMENT）完成代碼並通過 Gate 5 自動測試時，CI 立即自動構建預發容器。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-amber-700 font-bold">•</span>
                      <span><strong>主要用途：</strong> 供創辦人點擊測試 URL，親自驗證 UI/UX 與新功能邏輯，不影響線上運行的資料庫。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-amber-700 font-bold">•</span>
                      <span><strong>資料庫配置：</strong> 使用 Staging 獨立沙盒 DB 或 Mock 數據，隔離正式線上生產數據。</span>
                    </div>
                  </div>
                </div>

                {/* 2. Production Environment */}
                <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                      <h4 className="font-bold text-stone-900 text-xs uppercase font-mono">
                        Production (正式生產環境)
                      </h4>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-300">
                      Live 線上穩定版
                    </span>
                  </div>

                  <div className="space-y-2 text-[11px] text-stone-600">
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-700 font-bold">•</span>
                      <span><strong>版號命名規則：</strong> 正式語意化版號 (SemVer)，如 <code>v1.1.0</code>、<code>v1.2.0</code>。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-700 font-bold">•</span>
                      <span><strong>發布門檻：</strong> 必須滿足 <strong>Tests PASS</strong> (Gate 5) + <strong>Review PASS</strong> (Gate 6) + <strong>Human 1-Click Approval</strong> (Gate 7)。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-700 font-bold">•</span>
                      <span><strong>零中斷更新 (Blue/Green)：</strong> Cloud Run / 容器平滑切換流量，失敗時自動回滾至上一穩定版號。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-700 font-bold">•</span>
                      <span><strong>即時遙測：</strong> 監控 99.99% Uptime 與 P95 Latency，若發生崩潰則自動告警並啟動 Hotfix 流程。</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Versioning & Release Tracking Explanation */}
              <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs">
                <h4 className="font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-stone-700" />
                  <span>改版後如何清楚知道當前版本與升級狀態？</span>
                </h4>

                <div className="space-y-3 text-[11px] text-stone-600">
                  <p className="leading-relaxed">
                    在 Bridge 看板與專案抽屜中，系統透過<strong>三層版本可視化</strong>隨時讓您掌握版本升級動態：
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1">
                      <div className="font-bold text-stone-800 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                        1. 看板「環境與版本」欄位
                      </div>
                      <div className="text-[10px] text-stone-500">
                        隨時並列顯示 <code>Prod: v1.1.0</code> 與 <code>Stage: v1.2.0-rc.1</code>，並在改版中顯示 <code>v1.1.0 ➔ v1.2.0</code> 升級徽章。
                      </div>
                    </div>

                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1">
                      <div className="font-bold text-stone-800 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        2. 抽屜「版本改版流向」圖
                      </div>
                      <div className="text-[10px] text-stone-500">
                        點開任一專案抽屜第 4 區塊，即見「目前線上 ➔ 預發測試 ➔ 目標發布」三階即時動態卡。
                      </div>
                    </div>

                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1">
                      <div className="font-bold text-stone-800 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-600" />
                        3. 1-Click Promote 自動升級
                      </div>
                      <div className="text-[10px] text-stone-500">
                        驗證通過點擊 Promote 後，系統自動將 Target Version 寫入 Production，並記錄歷史 Timeline。
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'selective' && (
            <div className="space-y-5">
              {/* Problem Statement Box */}
              <div className="bg-emerald-50/80 border border-emerald-300 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-emerald-950 font-bold">
                  <Zap className="h-4 w-4 text-emerald-700" />
                  <span>核心問題解決：Stage 開發了 10 個功能，但時間緊迫只想推 3 個到 Prod？</span>
                </div>
                <p className="text-[11px] text-emerald-900 leading-relaxed">
                  在一人創業或 Micro-SaaS 敏捷開發中，經常會遇到「預發環境一口氣堆疊了 10 個新功能，但其中 7 個需要更長時間驗證或屬於未公開的進階功能」。平台提供 <strong>Feature Flags 旗標隔離</strong> 與 <strong>Git Cherry-Pick 精選推送</strong> 兩大標準解法，並以 <strong>Feature Delivery Matrix</strong> 永久記錄所有待推與已推功能！
                </p>
              </div>

              {/* 2 Recommended Solutions Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Method 1: Feature Flags */}
                <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-600" />
                      <h4 className="font-bold text-stone-900 text-xs">方案 A：Feature Flags 旗標隔離 (業界最佳實踐 ⭐)</h4>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-900 font-bold rounded">
                      推薦首選
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-600 leading-relaxed font-sans">
                    將 10 個功能的程式碼<strong>整包發布到 Production</strong>，但在 Production 環境上<strong>僅將 3 個功能的 Feature Flag 設為 ON，其餘 7 個設為 OFF（隔離隱藏）</strong>。
                  </p>

                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1.5 text-[11px]">
                    <div className="font-bold text-stone-800">✅ 核心優勢：</div>
                    <ul className="list-disc list-inside space-y-1 text-stone-600">
                      <li><strong>零 Git 分支衝突 (Zero Merge Hell)：</strong> Stage 與 Prod 的主幹程式碼完全一致，不用維護多條複雜分支。</li>
                      <li><strong>秒級線上開關：</strong> 當其餘 7 個功能驗證通過時，<strong>無需重新部署</strong>，直接在儀表板將 Flag 切換為 ON 即可秒級對用戶生效！</li>
                      <li><strong>即時降級安全網：</strong> 若新上線功能突發 Bug，直接將 Flag 切回 OFF 即可止血，不用慌張 Rollback。</li>
                    </ul>
                  </div>
                </div>

                {/* Method 2: Cherry-Pick */}
                <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-sky-600" />
                      <h4 className="font-bold text-stone-900 text-xs">方案 B：Git Cherry-Pick 精選提交 (實體隔離)</h4>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-700 rounded">
                      乾淨發布
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-600 leading-relaxed font-sans">
                    建立獨立的發布分支 <code>release/vX.Y.Z</code>，僅挑選與這 3 個功能相關的 Git Commits 合併至 <code>main</code>。
                  </p>

                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1.5 text-[11px]">
                    <div className="font-bold text-stone-800">⚠️ 適用情境與注意事項：</div>
                    <ul className="list-disc list-inside space-y-1 text-stone-600">
                      <li><strong>程式碼完全隔離：</strong> Production 的打包檔案中完全不包含未發布功能的代碼。</li>
                      <li><strong>需注意依賴關係：</strong> 若 3 個功能的代碼依賴了其餘 7 個功能的共用模組，需要 AI 自動進行相依性補齊。</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Long-term Memory & Tracking System */}
              <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-stone-700" />
                    <h4 className="font-bold text-stone-900 text-xs">
                      久了以後還會記得有哪些待開發與待推送的功能嗎？ (Long-term Delivery Memory)
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                    永久記憶機制
                  </span>
                </div>

                <p className="text-[11px] text-stone-600 leading-relaxed">
                  系統透過 <strong>功能交付矩陣（Feature Delivery Matrix）</strong> 與 <strong>自動變更紀錄（Release Notes Generator）</strong>，替您終生記憶每一項功能的狀態：
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-1">
                    <strong className="text-stone-900 block">1. 狀態標籤隨時可查</strong>
                    <p className="text-[11px] text-stone-500">
                      清楚標示 <code>Live (線上)</code>、<code>Pending (待推)</code>、<code>Flag OFF (關閉)</code>、<code>Backlog (規劃)</code>，一秒掌握進度。
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-1">
                    <strong className="text-stone-900 block">2. 目標版號關聯</strong>
                    <p className="text-[11px] text-stone-500">
                      每項功能皆連結 <code>targetReleaseVersion</code>（例如 v0.4.3、v0.5.0），明確知道它預計何時上線。
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-1">
                    <strong className="text-stone-900 block">3. 歷史版本自動歸檔</strong>
                    <p className="text-[11px] text-stone-500">
                      每次 Selective Release 均會自動產生 Markdown Release Notes，記錄「本次發布了哪些、保留了哪些」。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'iteration' && (
            <div className="space-y-5">
              {/* Architecture Core Rule Box */}
              <div className="bg-amber-50/70 border border-amber-300 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-950 font-bold">
                  <RotateCcw className="h-4 w-4 text-amber-700" />
                  <span>核心觀念：改版不是單純「倒退」，而是開啟新的可追蹤迭代循環（Iteration Run）</span>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  在現代 CI/CD 與 Bridge 協議中，已上線到 Production 的版本是<strong>不可變的歷史基準（Immutable Baseline）</strong>。當您發起改版時，系統會站在當前 Production 的基底上建立新分支，並<strong>依據改動的性質，智慧分流至不同的切入起點</strong>！
                </p>
              </div>

              {/* Scenario Interactive Selector */}
              <div className="space-y-3">
                <h4 className="font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-700" />
                  <span>點擊查看 4 種改版情境的 CI/CD 執行路徑：</span>
                </h4>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <button
                    onClick={() => setSelectedScenario('major')}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedScenario === 'major'
                        ? 'bg-white border-stone-800 ring-2 ring-stone-800 shadow-xs'
                        : 'bg-white/60 border-stone-300 hover:bg-white text-stone-600'
                    }`}
                  >
                    <div className="font-bold text-stone-900 flex items-center justify-between">
                      <span>情境 A：重大改版</span>
                      <span className="text-[9px] px-1 bg-amber-100 text-amber-800 rounded">Phase 1</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-1">新架構 / 新功能 / 商業轉向</div>
                  </button>

                  <button
                    onClick={() => setSelectedScenario('minor')}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedScenario === 'minor'
                        ? 'bg-white border-stone-800 ring-2 ring-stone-800 shadow-xs'
                        : 'bg-white/60 border-stone-300 hover:bg-white text-stone-600'
                    }`}
                  >
                    <div className="font-bold text-stone-900 flex items-center justify-between">
                      <span>情境 B：日常迭代</span>
                      <span className="text-[9px] px-1 bg-sky-100 text-sky-800 rounded">Phase 1 尾</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-1">已知需求優化 / 功能調整</div>
                  </button>

                  <button
                    onClick={() => setSelectedScenario('hotfix')}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedScenario === 'hotfix'
                        ? 'bg-white border-rose-700 ring-2 ring-rose-700 shadow-xs'
                        : 'bg-white/60 border-stone-300 hover:bg-white text-stone-600'
                    }`}
                  >
                    <div className="font-bold text-rose-900 flex items-center justify-between">
                      <span>情境 C：線上 Hotfix</span>
                      <span className="text-[9px] px-1 bg-rose-100 text-rose-800 rounded font-bold">Phase 2 快速</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-1">Production 報錯緊急修復</div>
                  </button>

                  <button
                    onClick={() => setSelectedScenario('maint')}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedScenario === 'maint'
                        ? 'bg-white border-stone-800 ring-2 ring-stone-800 shadow-xs'
                        : 'bg-white/60 border-stone-300 hover:bg-white text-stone-600'
                    }`}
                  >
                    <div className="font-bold text-stone-900 flex items-center justify-between">
                      <span>情境 D：確定性維護</span>
                      <span className="text-[9px] px-1 bg-emerald-100 text-emerald-800 rounded">Phase 2 輕量</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-1">套件升級 / 文案修改</div>
                  </button>
                </div>
              </div>

              {/* Dynamic Visualization based on Scenario */}
              <div className="bg-white rounded-xl border border-stone-300 p-5 space-y-4 shadow-xs">
                {selectedScenario === 'major' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        <h4 className="font-bold text-stone-900 text-sm">情境 A：重大改版 ➔ 完整重新跑 Phase 1~3</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-stone-900 text-stone-50 rounded">建議模型：Sol / Terra</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      牽涉核心商業邏輯或 DB Schema 變更。<strong>從 Gate 1 (DISCUSS) 切入</strong>，先由 AI 顧問與您重新對齊目標並產出最新 <code>.bridge/context.md</code> 規格，再交由 AI 代理實作與全套 CI/CD。
                    </p>
                    {/* Visual Loop diagram */}
                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-[10px] font-mono space-y-2">
                      <div className="text-stone-500">執行路徑：</div>
                      <div className="flex items-center gap-1.5 flex-wrap text-stone-800 font-bold">
                        <span className="px-2 py-1 bg-stone-200 rounded text-stone-600">Prod v1.0 (Live)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded">1. DISCUSS (AI 顧問)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded">2. SPECIFY (PRD)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded">3. ROUTE</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">4. IMPLEMENT</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">5. TEST</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">6. REVIEW</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded">7. APPROVE</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-600 text-white rounded">8. DONE (v2.0)</span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedScenario === 'minor' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-sky-500" />
                        <h4 className="font-bold text-stone-900 text-sm">情境 B：日常功能迭代 ➔ 跳過冗長探討，從 Gate 2/3 切入</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-stone-900 text-stone-50 rounded">建議模型：Terra</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      需求明確（例如新增篩選器或匯出 CSV 功能）。<strong>跳過 Gate 1 的初步探索</strong>，直接在 GitHub Issue 補充規格契約（Gate 2），系統自動 Route 給 Terra 實作並走 CI 驗證。
                    </p>
                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-[10px] font-mono space-y-2">
                      <div className="text-stone-500">執行路徑：</div>
                      <div className="flex items-center gap-1.5 flex-wrap text-stone-800 font-bold">
                        <span className="px-2 py-1 bg-stone-200 rounded text-stone-600">Prod v1.0 (Live)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded">2. SPECIFY</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded">3. ROUTE (Terra)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">4. IMPLEMENT</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">5. TEST</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">6. REVIEW</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded">7. APPROVE</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-600 text-white rounded">8. DONE (v1.1)</span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedScenario === 'hotfix' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-rose-600" />
                        <h4 className="font-bold text-rose-950 text-sm">情境 C：線上緊急修復 (Hotfix) ➔ Phase 2 快速通道</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-rose-900 text-rose-50 rounded font-bold">高推理模型：Sol</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      線上生產環境出現嚴重 Bug 或 Sentry 警報。<strong>完全跳過 Phase 1</strong>，直接拉出 <code>hotfix/*</code> 分支進 <strong>Gate 4 (IMPLEMENT)</strong>，由 Sol 高推理模型直接分析日誌並修復，跑完完整 CI 測試與 AI 審查後，等待您一鍵放行發布。
                    </p>
                    <div className="p-3 bg-rose-50/60 rounded-lg border border-rose-200 text-[10px] font-mono space-y-2">
                      <div className="text-rose-900 font-semibold">⚡ Hotfix 快速通道路徑：</div>
                      <div className="flex items-center gap-1.5 flex-wrap text-stone-800 font-bold">
                        <span className="px-2 py-1 bg-rose-100 text-rose-900 border border-rose-300 rounded">Prod Alert 💥</span>
                        <ArrowRight className="h-3 w-3 text-rose-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">4. IMPLEMENT (Sol 修復)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">5. TEST (Unit/Lint)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">6. REVIEW (安全檢查)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded">7. APPROVE (1-Click)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-600 text-white rounded">8. DONE (Hotfix Live)</span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedScenario === 'maint' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <h4 className="font-bold text-stone-900 text-sm">情境 D：確定性維護 / 文案 ➔ Phase 2 輕量通道</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-stone-900 text-stone-50 rounded">省 Token 模型：Luna</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      例如 Dependabot 依賴升級、文字修訂或小 CSS 微調。<strong>直接交由 Luna 輕量模型</strong> 在分支執行並跑測試，成本極低、速度極快。
                    </p>
                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-[10px] font-mono space-y-2">
                      <div className="text-stone-500">執行路徑：</div>
                      <div className="flex items-center gap-1.5 flex-wrap text-stone-800 font-bold">
                        <span className="px-2 py-1 bg-stone-200 rounded text-stone-600">Prod v1.0</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">4. IMPLEMENT (Luna)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-sky-100 text-sky-900 border border-sky-300 rounded">5. TEST (綠燈)</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded">7. APPROVE</span>
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                        <span className="px-2 py-1 bg-emerald-600 text-white rounded">8. DONE</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Safety Guarantee Callout */}
              <div className="p-3 bg-stone-100 rounded-lg border border-stone-200 text-[11px] text-stone-600 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-stone-900">核心安全鐵律：</strong> 不論是哪種改版情境，<strong>都絕對不可繞過 Gate 5 (自動測試) 與 Gate 7 (人工放行)</strong>。這樣即便 AI 出現幻覺或邏輯瑕疵，也不會直接推爆 Production！
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-white border-t border-stone-200 px-6 py-3 flex items-center justify-between">
          <span className="text-[11px] text-stone-500 font-mono">
            標準化 CI/CD 生命週期 & 迭代回流協議已就緒
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-mono font-semibold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-md transition-colors cursor-pointer shadow-xs"
          >
            關閉檢視
          </button>
        </div>
      </div>
    </div>
  );
};
