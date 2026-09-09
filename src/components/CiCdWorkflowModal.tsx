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
                <h3 className="text-sm font-bold text-stone-900">
                  AI 怎麼把每次改動安全地送上線
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300">
                  標準 CI/CD 架構
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                從 AI 動手改代碼開始，到自動測試、人工確認、正式上線，每一步都留下紀錄可以回溯。
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
            <span>三個階段：準備、驗證、上線</span>
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
            <span>🌐 測試環境跟正式環境的差別</span>
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
            <span>🎯 只推部分功能上線的做法</span>
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
            <span>⚡ 改版跟緊急修復怎麼處理</span>
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
                      <span>第一階段：想清楚再動手</span>
                    </div>
                    <span className="text-[10px] bg-amber-50 text-amber-900 px-1.5 py-0.2 rounded border border-amber-200">
                      AI 決策與架構
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    AI 動手改代碼之前，先跟你把需求對齊、寫清楚要做什麼，避免猜錯方向白做工。
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
                    ⚡ <strong>這階段結束時會有</strong>：一份寫清楚需求的規格文件，以及派給誰執行的紀錄
                  </div>
                </div>

                {/* Phase 2: CI (Continuous Integration) */}
                <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-sky-500" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sky-950 font-bold">
                      <Terminal className="h-4 w-4 text-sky-700" />
                      <span>第二階段：動手改，自動檢查</span>
                    </div>
                    <span className="text-[10px] bg-sky-50 text-sky-900 px-1.5 py-0.2 rounded border border-sky-200">
                      GitHub Actions
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    AI 開始寫代碼，改完立刻自動跑測試——測試通過不代表沒問題，所以還會再讓另一個 AI 覆核一次。
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
                    ⚡ <strong>這階段結束時會有</strong>：一個等你確認的修改請求（PR），附上自動測試都通過的報告
                  </div>
                </div>

                {/* Phase 3: CD (Continuous Delivery) */}
                <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-emerald-950 font-bold">
                      <Rocket className="h-4 w-4 text-emerald-700" />
                      <span>第三階段：你點頭，正式上線</span>
                    </div>
                    <span className="text-[10px] bg-emerald-50 text-emerald-900 px-1.5 py-0.2 rounded border border-emerald-200">
                      發布與部署
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    最後一定要等你親自按下確認，系統才會把改動實際發布到正式環境跟測試環境。
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
                    ⚡ <strong>這階段結束時會有</strong>：正式環境上跑著最新、通過驗證的版本
                  </div>
                </div>
              </div>

              {/* End-to-End Visual Workflow Comparison Matrix */}
              <div className="bg-white p-4 rounded-xl border border-stone-300 space-y-3 shadow-xs">
                <h4 className="font-bold text-stone-900 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-700" />
                  <span>這套流程跟「工程師自己土法煉鋼」差在哪</span>
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-stone-200 bg-[#F7F6F2] text-stone-500">
                        <th className="py-2 px-3">環節</th>
                        <th className="py-2 px-3">沒有這套流程時</th>
                        <th className="py-2 px-3 text-emerald-800 font-bold">現在這裡怎麼做</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200 text-stone-700">
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">需求怎麼定義</td>
                        <td className="py-2.5 px-3 text-stone-500">工程師自己寫需求文件，代碼不一定照著做</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          <strong>AI 顧問</strong>先跟你對齊，再自動產出跟代碼綁定的規格文件
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">誰來執行</td>
                        <td className="py-2.5 px-3 text-stone-500">沒有分派機制，全靠工程師自己判斷</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          系統依風險高低，自動分配給 Luna / Terra / Sol 其中一個
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">怎麼把關品質</td>
                        <td className="py-2.5 px-3 text-stone-500">只看自動測試有沒有過</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          測試過仍不算數——<strong>再讓另一個 AI 覆核一次</strong>安全性跟邏輯
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-semibold">誰拍板上線</td>
                        <td className="py-2.5 px-3 text-stone-500">工程師逐行看完代碼才敢合併</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          <strong>你</strong>只需要看結論、一鍵放行，不用懂代碼細節
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
                  <span>永遠先在測試環境試跑，你點頭才上正式環境</span>
                </div>
                <p className="text-[11px] text-sky-900 leading-relaxed">
                  為了不讓 AI 改的東西直接影響到正在使用產品的用戶，任何改動都會先自動部署到一個獨立的<strong>測試網址（Stage）</strong>，你可以先點進去實際操作看看沒問題，才會一鍵推上<strong>正式環境（Production）</strong>。
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
                      <span><strong>版號怎麼標：</strong> 標示為「候選版本」，例如 <code>v1.2.0-rc.1</code>，代表還在等你驗收，還不是正式版。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-amber-700 font-bold">•</span>
                      <span><strong>什麼時候會出現：</strong> AI 一改完代碼、自動測試也通過，這裡就會立刻更新成最新的測試版本。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-amber-700 font-bold">•</span>
                      <span><strong>用來做什麼：</strong> 讓你點連結親自試用新功能，確認沒問題再決定要不要正式上線。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-amber-700 font-bold">•</span>
                      <span><strong>資料安全：</strong> 用的是獨立的測試資料，不會動到正式環境裡用戶的真實資料。</span>
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
                      <span><strong>版號怎麼標：</strong> 正式版號，例如 <code>v1.1.0</code>、<code>v1.2.0</code>，代表已經上線給用戶用的版本。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-700 font-bold">•</span>
                      <span><strong>什麼時候能上線：</strong> 一定要自動測試通過、另一個 AI 覆核過，而且<strong>你親自按下確認</strong>，三個條件缺一不可。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-700 font-bold">•</span>
                      <span><strong>切換不中斷：</strong> 更新時用戶不會感覺到服務中斷；如果新版出問題，系統會自動退回上一個穩定版本。</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-700 font-bold">•</span>
                      <span><strong>持續監控：</strong> 系統會持續觀察正式環境是否正常運作，一旦異常就自動告警並啟動緊急修復流程。</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Versioning & Release Tracking Explanation */}
              <div className="bg-white rounded-xl border border-stone-300 p-4 space-y-3 shadow-xs">
                <h4 className="font-bold text-stone-900 flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-stone-700" />
                  <span>怎麼知道現在正式環境跟測試環境分別是哪個版本</span>
                </h4>

                <div className="space-y-3 text-[11px] text-stone-600">
                  <p className="leading-relaxed">
                    有三個地方可以隨時查看版本狀態，不用自己去記：
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1">
                      <div className="font-bold text-stone-800 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                        1. 專案卡片的版本欄位
                      </div>
                      <div className="text-[10px] text-stone-500">
                        同時顯示正式環境（<code>v1.1.0</code>）跟測試環境（<code>v1.2.0-rc.1</code>）目前各是哪一版。
                      </div>
                    </div>

                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1">
                      <div className="font-bold text-stone-800 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        2. 專案詳情裡的版本進度圖
                      </div>
                      <div className="text-[10px] text-stone-500">
                        打開任一專案的詳情頁，可以看到「目前線上 ➔ 測試中 ➔ 準備發布」的即時進度。
                      </div>
                    </div>

                    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1">
                      <div className="font-bold text-stone-800 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-600" />
                        3. 一鍵升級，自動記錄
                      </div>
                      <div className="text-[10px] text-stone-500">
                        你確認沒問題、按下推上正式環境後，系統會自動更新版號，並把這次上線記錄下來方便之後查。
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
                  <span>常見情況：測試環境做了 10 個功能，但現在只想先推 3 個上線</span>
                </div>
                <p className="text-[11px] text-emerald-900 leading-relaxed">
                  一人創業常會遇到「測試環境已經堆了一堆新功能，但其中幾個還需要更多驗證，或還不想公開」的情況。這裡提供兩種做法讓你可以只推部分功能上線，並且用<strong>功能交付列表</strong>幫你永久記住每個功能現在的狀態，不用自己記。
                </p>
              </div>

              {/* 2 Recommended Solutions Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Method 1: Feature Flags */}
                <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-600" />
                      <h4 className="font-bold text-stone-900 text-xs">做法 A：功能開關（推薦 ⭐）</h4>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-900 font-bold rounded">
                      推薦首選
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-600 leading-relaxed font-sans">
                    10 個功能的代碼<strong>一起發布上線</strong>，但只把想公開的 3 個功能「開關」打開，其餘 7 個保持關閉、用戶看不到。
                  </p>

                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1.5 text-[11px]">
                    <div className="font-bold text-stone-800">✅ 好處：</div>
                    <ul className="list-disc list-inside space-y-1 text-stone-600">
                      <li><strong>不用管理多條代碼分支：</strong> 測試環境跟正式環境的代碼永遠一致，少了很多維護上的麻煩。</li>
                      <li><strong>之後要開放，不用重新發布：</strong> 剩下 7 個功能驗證通過後，直接把開關切成 ON，用戶馬上就看得到。</li>
                      <li><strong>出問題可以馬上關掉：</strong> 新功能如果出 Bug，把開關切回 OFF 就能立刻止血，不用緊急回滾整個版本。</li>
                    </ul>
                  </div>
                </div>

                {/* Method 2: Cherry-Pick */}
                <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-sky-600" />
                      <h4 className="font-bold text-stone-900 text-xs">做法 B：只挑選要上線的部分</h4>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-700 rounded">
                      乾淨發布
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-600 leading-relaxed font-sans">
                    建立一個獨立的發布版本，只挑出跟這 3 個功能有關的代碼變更，其餘 7 個完全不放進去。
                  </p>

                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1.5 text-[11px]">
                    <div className="font-bold text-stone-800">⚠️ 適合的情況跟要注意的地方：</div>
                    <ul className="list-disc list-inside space-y-1 text-stone-600">
                      <li><strong>代碼完全隔離：</strong> 正式環境裡完全不會有還沒公開的功能代碼，最乾淨的做法。</li>
                      <li><strong>要注意功能之間的關聯：</strong> 如果這 3 個功能剛好用到其他 7 個功能的共用部分，AI 需要先處理好這個相依關係。</li>
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
                      過了幾個月，還記得哪些功能推了、哪些還沒嗎？
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                    永久記憶機制
                  </span>
                </div>

                <p className="text-[11px] text-stone-600 leading-relaxed">
                  不用靠自己記——系統會把每個功能現在的狀態記下來，隨時可以回頭查：
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-1">
                    <strong className="text-stone-900 block">1. 狀態一目了然</strong>
                    <p className="text-[11px] text-stone-500">
                      清楚標示「已上線」「等待推送」「開關已關閉」「還在規劃」，一眼看懂每項功能現在的進度。
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-1">
                    <strong className="text-stone-900 block">2. 知道預計何時上線</strong>
                    <p className="text-[11px] text-stone-500">
                      每項功能都標好預計上線的版本（例如 v0.4.3、v0.5.0），不用自己去猜。
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-1">
                    <strong className="text-stone-900 block">3. 每次發布自動留紀錄</strong>
                    <p className="text-[11px] text-stone-500">
                      每次選擇性上線後，系統會自動整理一份紀錄，寫下「這次推了什麼、保留了什麼」。
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
                  <span>發起改版，不會動到已經上線的版本，只會開一條新的紀錄</span>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  已經上線的版本會被完整保留，不會被覆蓋。每次你發起改版，系統都會以目前正式環境的版本為基礎，開一條新的紀錄，並<strong>依照改動的大小跟急迫程度，走不同的處理路徑</strong>——小修改不用像大改版那樣走完整流程。
                </p>
              </div>

              {/* Scenario Interactive Selector */}
              <div className="space-y-3">
                <h4 className="font-bold text-stone-900 flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-700" />
                  <span>點一下看看 4 種不同情況分別怎麼處理：</span>
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
                        <h4 className="font-bold text-stone-900 text-sm">情境 A：重大改版 ➔ 完整走完三個階段</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-stone-900 text-stone-50 rounded">建議模型：Sol / Terra</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      牽涉核心邏輯或資料庫結構變更的大改版。<strong>從頭開始</strong>，先由 AI 顧問跟你重新對齊目標、寫出最新規格，再交由 AI 代理實作，完整跑完三個階段。
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
                        <h4 className="font-bold text-stone-900 text-sm">情境 B：日常功能迭代 ➔ 省略前期討論，直接寫規格</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-stone-900 text-stone-50 rounded">建議模型：Terra</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      需求已經很明確（例如新增一個篩選器、加個匯出功能）。<strong>跳過前期討論</strong>，直接補上規格細節，系統會自動指派給 Terra 實作，照樣走完整測試流程。
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
                        <h4 className="font-bold text-rose-950 text-sm">情境 C：線上緊急修復 ➔ 快速通道</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-rose-900 text-rose-50 rounded font-bold">高推理模型：Sol</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      正式環境出現嚴重問題，需要馬上處理。<strong>直接跳過討論階段</strong>，由高推理能力的 Sol 模型直接分析問題並修復，一樣要跑完自動測試跟 AI 覆核，最後等你一鍵放行才會發布。
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
                        <h4 className="font-bold text-stone-900 text-sm">情境 D：小修小改 ➔ 輕量通道</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-stone-900 text-stone-50 rounded">省成本模型：Luna</span>
                    </div>
                    <p className="text-[11px] text-stone-600">
                      像是套件升級、文案修正、小小的樣式調整。<strong>直接交給 Luna 輕量模型</strong>處理並跑測試，速度快、成本也低。
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
                  <strong className="text-stone-900">不會被跳過的兩道防線：</strong> 不管是哪種情況，<strong>自動測試</strong>跟<strong>你的最終確認</strong>都不會被跳過。就算 AI 判斷錯誤或邏輯有問題，也不會未經你同意就直接影響正式環境。
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-white border-t border-stone-200 px-6 py-3 flex items-center justify-between">
          <span className="text-[11px] text-stone-500 font-mono">
            這套流程一直在背景運作，隨時保護你的正式環境
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
