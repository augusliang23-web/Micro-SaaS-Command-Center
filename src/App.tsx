import React, { useEffect, useState } from 'react';
import {
  initialProjects,
  initialAttentionItems,
  initialNextBestAction,
  initialExecutionSnapshot,
} from './mockData';
import { MicroSaaSProject, AttentionItem, NextBestAction, AIExecutionSnapshotData } from './types';
import { CockpitHeader } from './components/CockpitHeader';
import { NextBestActionCard } from './components/NextBestActionCard';
import { NeedsAttentionQueue } from './components/NeedsAttentionQueue';
import { PortfolioOverview } from './components/PortfolioOverview';
import { AIExecutionSnapshot } from './components/AIExecutionSnapshot';
import { ProjectDetailDrawer } from './components/ProjectDetailDrawer';
import { ModelRoutingGuide } from './components/ModelRoutingGuide';
import { ConnectRepoModal } from './components/ConnectRepoModal';
import { CiCdWorkflowModal } from './components/CiCdWorkflowModal';
import {
  Layers,
  ShieldAlert,
  Cpu,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

export default function App() {
  const [projects, setProjects] = useState<MicroSaaSProject[]>(initialProjects);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>(initialAttentionItems);
  const [nba, setNba] = useState<NextBestAction>(initialNextBestAction);
  const [snapshot, setSnapshot] = useState<AIExecutionSnapshotData>(initialExecutionSnapshot);

  const [selectedProject, setSelectedProject] = useState<MicroSaaSProject | null>(null);
  const [activeTab, setActiveTab] = useState<'projects' | 'attention' | 'telemetry'>('projects');
  const [activeFilter, setActiveFilter] = useState<'all' | 'attention' | 'running' | 'production'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isModelGuideOpen, setIsModelGuideOpen] = useState<boolean>(false);
  const [isConnectRepoOpen, setIsConnectRepoOpen] = useState<boolean>(false);
  const [isCiCdModalOpen, setIsCiCdModalOpen] = useState<boolean>(false);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  const [hasLoaded, setHasLoaded] = useState(false);

  // Load persisted state on first mount, falling back to mock data
  useEffect(() => {
    fetch('/api/state')
      .then((res) => (res.ok ? res.json() : null))
      .then((saved) => {
        if (saved) {
          setProjects(saved.projects ?? initialProjects);
          setAttentionItems(saved.attentionItems ?? initialAttentionItems);
          setNba(saved.nba ?? initialNextBestAction);
          setSnapshot(saved.snapshot ?? initialExecutionSnapshot);
        }
      })
      .catch((err) => console.warn('Failed to load saved state, using defaults:', err))
      .finally(() => setHasLoaded(true));
  }, []);

  // Persist state to the local server whenever it changes (debounced)
  useEffect(() => {
    if (!hasLoaded) return;
    const timeout = setTimeout(() => {
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects, attentionItems, nba, snapshot }),
      }).catch((err) => console.warn('Failed to save state:', err));
    }, 500);
    return () => clearTimeout(timeout);
  }, [hasLoaded, projects, attentionItems, nba, snapshot]);

  const showToast = (message: string) => {
    setNotificationToast(message);
    setTimeout(() => {
      setNotificationToast((prev) => (prev === message ? null : prev));
    }, 3500);
  };

  // Filter projects based on search and top-level filter
  const displayedProjects = projects.filter((p) => {
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchTask = p.currentTask.toLowerCase().includes(q);
      const matchModel = p.model.toLowerCase().includes(q);
      const matchTag = p.tags.some((t) => t.toLowerCase().includes(q));
      if (!matchName && !matchTask && !matchModel && !matchTag) return false;
    }

    // Top-level pill filter
    if (activeFilter === 'attention') {
      return (
        p.health === 'Attention' ||
        p.health === 'Blocked' ||
        p.health === 'At Risk' ||
        p.waitingState === 'WAITING_FOR_HUMAN'
      );
    }
    if (activeFilter === 'running') {
      return p.waitingState === 'AI_RUNNING';
    }
    if (activeFilter === 'production') {
      return (
        p.stage === 'Production' ||
        p.environment.production.status === 'Live' ||
        p.environment.production.status === 'Healthy'
      );
    }
    return true;
  });

  // Open detail drawer for a project
  const handleSelectProject = (project: MicroSaaSProject) => {
    setSelectedProject(project);
  };

  // Focus from Needs Attention or Next Best Action
  const handleFocusProjectGate = (projectId: string, gateId: string) => {
    const target = projects.find((p) => p.id === projectId);
    if (target) {
      setSelectedProject(target);
    }
  };

  // Simulate resolving a blocker / recording decision
  const handleResolveBlocker = (projectId: string, resolution: string) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id === projectId) {
          const updatedGates = proj.gates.map((g) => {
            if (g.id === proj.currentGate) {
              return {
                ...g,
                status: 'COMPLETED' as const,
                detail: `${g.detail || ''} [Decision Applied: ${resolution}]`,
              };
            }
            if (g.id === 'APPROVE') {
              return {
                ...g,
                status: 'CURRENT' as const,
                detail: 'Ready for final merge approval.',
              };
            }
            return g;
          });

          return {
            ...proj,
            health: 'Healthy',
            blocker: null,
            waitingState: 'WAITING_FOR_HUMAN',
            currentGate: 'APPROVE',
            currentGateLabel: 'Human Approval',
            reviewOutcome: 'APPROVED',
            nextAction: '1-click Merge PR & release to UAT',
            gates: updatedGates,
            activityHistory: [
              {
                id: `act-${Date.now()}`,
                timestamp: 'Just now',
                author: 'Human (You)',
                action: 'Decision Recorded',
                detail: resolution,
                gate: proj.currentGate,
              },
              ...proj.activityHistory,
            ],
          };
        }
        return proj;
      })
    );

    // Remove from attention items
    setAttentionItems((prev) => prev.filter((item) => item.projectId !== projectId));

    // Update snapshot
    setSnapshot((prev) => ({
      ...prev,
      blocked: Math.max(0, prev.blocked - 1),
      waitingForHuman: Math.max(0, prev.waitingForHuman - 1),
    }));

    showToast(`決策已套用：${resolution}`);

    // If currently selected, update drawer
    setSelectedProject((prev) => {
      if (!prev || prev.id !== projectId) return prev;
      return {
        ...prev,
        health: 'Healthy',
        blocker: null,
        waitingState: 'WAITING_FOR_HUMAN',
        currentGate: 'APPROVE',
        currentGateLabel: 'Human Approval',
        reviewOutcome: 'APPROVED',
        nextAction: '1-click Merge PR & release to UAT',
      };
    });
  };

  // Quick simulate approve review in NBA
  const handleSimulateApproveNBA = (projectId: string) => {
    handleResolveBlocker(
      projectId,
      'Policy selected: Skip duplicate email rows with warning report.'
    );

    // Update NBA to point to the next best item
    setNba({
      id: 'nba-2',
      projectId: 'proj-docupulse',
      projectName: 'DocuPulse AI',
      actionTitle: 'Approve & Merge PR #89 (Tailwind v4 Config Migration)',
      summary:
        'All automated regression tests (100%) and lint passes are green. Model Luna completed deterministic migration without conflict.',
      contextPill: 'Tests: PASS • Review: APPROVED',
      impactReason: 'Maintains zero technical debt on production API cluster.',
      gate: 'APPROVE',
      model: 'Luna',
      quickActionLabel: 'Approve PR #89 Merge',
    });
  };

  // Resolve single attention item
  const handleResolveAttentionItem = (itemId: string, projectId: string) => {
    setAttentionItems((prev) => prev.filter((i) => i.id !== itemId));
    showToast(`已放行待辦項目 [${itemId}]，AI 工作流已恢復自主執行。`);
  };

  // Approve current gate
  const handleApproveCurrentGate = (projectId: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id === projectId) {
          const updatedGates = p.gates.map((g) => {
            if (g.id === p.currentGate) {
              return { ...g, status: 'COMPLETED' as const };
            }
            return g;
          });
          return {
            ...p,
            gates: updatedGates,
            health: 'Healthy',
            nextAction: 'Gate approved. Proceeding to next bridge stage.',
          };
        }
        return p;
      })
    );
    showToast(`已核准關卡：${projectId}`);
  };

  // Advance to next gate
  const handleAdvanceToNextGate = (projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;

    const currentIndex = proj.gates.findIndex((g) => g.id === proj.currentGate);
    if (currentIndex < proj.gates.length - 1) {
      const nextGate = proj.gates[currentIndex + 1];
      const updatedGates = proj.gates.map((g, idx) => {
        if (idx <= currentIndex) return { ...g, status: 'COMPLETED' as const };
        if (idx === currentIndex + 1) return { ...g, status: 'CURRENT' as const };
        return g;
      });

      // If advancing to DONE (or RELEASE), promote Staging to Production!
      let updatedEnv = { ...proj.environment };
      let newHealth = proj.health;

      if (nextGate.id === 'DONE') {
        const targetVer = proj.environment.targetReleaseVersion || proj.environment.staging?.version?.replace('-rc.1', '').replace('-proto', '') || 'v1.0.0';
        updatedEnv = {
          ...updatedEnv,
          production: {
            ...updatedEnv.production,
            status: 'Live',
            version: targetVer,
            lastDeployed: 'Just now',
            metrics: updatedEnv.production.metrics || { uptime: '99.99%', p95Latency: '78ms' },
          },
          staging: updatedEnv.staging
            ? {
                ...updatedEnv.staging,
                status: 'Ready',
                lastRefreshed: 'Just now',
              }
            : undefined,
        };
        newHealth = 'Healthy';
      }

      const isWaitingHuman = nextGate.id === 'APPROVE';
      const updatedProj: MicroSaaSProject = {
        ...proj,
        currentGate: nextGate.id,
        currentGateLabel: nextGate.label,
        gates: updatedGates,
        waitingState: nextGate.id === 'DONE' ? 'AUTOMATION_IDLE' : isWaitingHuman ? 'WAITING_FOR_HUMAN' : 'AI_RUNNING',
        nextAction:
          nextGate.id === 'DONE'
            ? 'Production deployment verified. System healthy.'
            : isWaitingHuman
            ? 'Ready for Human Approval to Merge & Release'
            : `Executing ${nextGate.label}`,
        environment: updatedEnv,
        health: newHealth === 'Blocked' ? 'Attention' : newHealth,
        blocker: nextGate.id === 'APPROVE' || nextGate.id === 'DONE' ? null : proj.blocker,
      };

      setProjects((prev) => prev.map((p) => (p.id === projectId ? updatedProj : p)));
      setSelectedProject(updatedProj);
      if (nextGate.id === 'DONE') {
        showToast(`🎉 [${proj.name}] 已完成 1-Click Promote！正式生產環境已更新至版號 ${updatedEnv.production.version}`);
      } else {
        showToast(`已將 [${proj.name}] 推進至關卡：${nextGate.label}`);
      }
    }
  };

  // Start new iteration cycle on already deployed project
  const handleStartNewIteration = (projectId: string, type: 'major' | 'minor' | 'hotfix') => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;

    let targetGate: any = 'DISCUSS';
    let targetGateLabel = 'Discuss & Alignment';
    let nextAct = 'ChatGPT Bridge 對齊新版本 PRD 規格';
    let assignedModel: any = 'Terra';
    let branchName = `feat/v2-iteration-${Date.now().toString().slice(-4)}`;

    // Compute next version bump
    const currentProdVer = proj.environment.production.version || 'v1.0.0';
    let nextTargetVer = 'v1.1.0';
    let nextStageVer = 'v1.1.0-rc.1';

    const parts = currentProdVer.replace(/^v/, '').split('.').map(Number);
    const major = isNaN(parts[0]) ? 1 : parts[0];
    const minor = isNaN(parts[1]) ? 0 : parts[1];
    const patch = isNaN(parts[2]) ? 0 : parts[2];

    if (type === 'major') {
      nextTargetVer = `v${major + 1}.0.0`;
      nextStageVer = `v${major + 1}.0.0-alpha.1`;
    } else if (type === 'minor') {
      nextTargetVer = `v${major}.${minor + 1}.0`;
      nextStageVer = `v${major}.${minor + 1}.0-rc.1`;
    } else {
      // Hotfix
      nextTargetVer = `v${major}.${minor}.${patch + 1}`;
      nextStageVer = `v${major}.${minor}.${patch + 1}-hotfix.1`;
      targetGate = 'IMPLEMENT';
      targetGateLabel = 'Background Implementation';
      nextAct = 'Sol 高推理修復線上 Hotfix 補丁中';
      assignedModel = 'Sol';
      branchName = `hotfix/incident-${Date.now().toString().slice(-4)}`;
    }

    const resetGates = proj.gates.map((g) => {
      if (type === 'major' || type === 'minor') {
        if (g.id === 'DISCUSS') return { ...g, status: 'CURRENT' as const, detail: `AI 探討 ${nextTargetVer} 需求規格` };
        return { ...g, status: 'PENDING' as const, detail: undefined };
      } else {
        // Hotfix
        if (g.id === 'IMPLEMENT') return { ...g, status: 'CURRENT' as const, detail: `Sol 正在編寫 ${nextTargetVer} 修復補丁與單元測試` };
        if (['DISCUSS', 'SPECIFY', 'ROUTE'].includes(g.id)) return { ...g, status: 'COMPLETED' as const };
        return { ...g, status: 'PENDING' as const, detail: undefined };
      }
    });

    const updatedProj: MicroSaaSProject = {
      ...proj,
      currentGate: targetGate,
      currentGateLabel: targetGateLabel,
      waitingState: 'AI_RUNNING',
      model: assignedModel,
      nextAction: nextAct,
      gates: resetGates,
      environment: {
        ...proj.environment,
        targetReleaseVersion: nextTargetVer,
        releaseType: type,
        staging: {
          status: 'Active',
          lastRefreshed: 'Just now',
          version: nextStageVer,
          branch: branchName,
          commit: Math.random().toString(16).substring(2, 9),
          url: proj.environment.staging?.url || `https://staging-${proj.name.toLowerCase().replace(/\s+/g, '')}.dev`,
        },
      },
      executionContext: {
        ...proj.executionContext,
        branch: branchName,
        bridgeRunId: `run-${Date.now().toString().slice(-6)}`,
      },
      activityHistory: [
        {
          id: `act-${Date.now()}`,
          timestamp: 'Just now',
          author: 'Human (You)',
          action: type === 'hotfix' ? `Trigger Hotfix ${nextTargetVer} (Phase 2 Fast Track)` : `Start Iteration ${nextTargetVer} (Phase 1)`,
          detail: `以現行 Production (${currentProdVer}) 為基線發起 ${type.toUpperCase()} 改版，在測試分支 ${branchName} 建立 Stage ${nextStageVer}。`,
          gate: targetGate,
        },
        ...proj.activityHistory,
      ],
    };

    setProjects((prev) => prev.map((p) => (p.id === projectId ? updatedProj : p)));
    setSelectedProject(updatedProj);
    showToast(`已為 [${proj.name}] 發起新一輪改版！Stage 預發版號已設為 ${nextStageVer}，目標線上版號為 ${nextTargetVer}。`);
  };

  // Handle feature updates (from FeatureDeliveryMatrix toggle/add)
  const handleUpdateFeatures = (projectId: string, updatedFeatures: any[]) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id === projectId) {
          return {
            ...p,
            features: updatedFeatures,
          };
        }
        return p;
      })
    );
    setSelectedProject((prev) => {
      if (!prev || prev.id !== projectId) return prev;
      return {
        ...prev,
        features: updatedFeatures,
      };
    });
  };

  // Handle confirming a selective release
  const handleConfirmSelectiveRelease = (
    projectId: string,
    selectedFeatureIds: string[],
    releaseVersion: string,
    releaseNotes: string
  ) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;

    const currentFeatures = proj.features || [];
    const updatedFeatures = currentFeatures.map((f) => {
      if (selectedFeatureIds.includes(f.id)) {
        return {
          ...f,
          prodStatus: 'Live' as const,
          flagEnabledInProd: true,
          shippedVersion: releaseVersion,
        };
      } else if (f.prodStatus === 'Pending Release') {
        return {
          ...f,
          prodStatus: 'Flag Disabled' as const,
          flagEnabledInProd: false,
        };
      }
      return f;
    });

    const updatedEnv = {
      ...proj.environment,
      production: {
        ...proj.environment.production,
        status: 'Live' as const,
        version: releaseVersion,
        lastDeployed: 'Just now',
      },
      staging: proj.environment.staging
        ? {
            ...proj.environment.staging,
            status: 'Ready' as const,
            lastRefreshed: 'Just now',
          }
        : undefined,
    };

    const updatedProj: MicroSaaSProject = {
      ...proj,
      environment: updatedEnv,
      features: updatedFeatures,
      activityHistory: [
        {
          id: `act-${Date.now()}`,
          timestamp: 'Just now',
          author: 'Human (You)',
          action: `Selective Release ${releaseVersion}`,
          detail: `發布了 ${selectedFeatureIds.length} 項功能至 Production，並透過 Feature Flags 隔離其餘 ${
            currentFeatures.length - selectedFeatureIds.length
          } 項功能。`,
          gate: 'DONE',
        },
        ...proj.activityHistory,
      ],
    };

    setProjects((prev) => prev.map((p) => (p.id === projectId ? updatedProj : p)));
    setSelectedProject(updatedProj);
    showToast(
      `🚀 [${proj.name}] 選擇性發布成功！已將 ${selectedFeatureIds.length} 項功能上線至 Production (${releaseVersion})，其餘功能安全隔離並記入交付矩陣。`
    );
  };

  const handleRefreshSim = () => {
    showToast('Bridge 遙測已同步，共 6 個 Micro-SaaS 倉庫狀態最新。');
  };

  const handleConnectRepo = (newProject: MicroSaaSProject) => {
    setProjects((prev) => [newProject, ...prev]);
    setSelectedProject(newProject);
    setSnapshot((prev) => ({
      ...prev,
      waitingForHuman: prev.waitingForHuman + 1,
    }));
    showToast(`已成功接入 GitHub 倉庫 [${newProject.repository}]，8-Gate 工作流已啟動！`);
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-stone-800 font-sans antialiased selection:bg-stone-300 selection:text-stone-900 flex flex-col">
      {/* Toast Notification */}
      {notificationToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-stone-900 border border-stone-700 text-stone-100 text-xs font-mono px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 animate-bounce">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>{notificationToast}</span>
        </div>
      )}

      {/* Cockpit Top Navigation */}
      <CockpitHeader
        snapshot={snapshot}
        activeFilter={activeFilter}
        onSelectFilter={setActiveFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalProjects={projects.length}
        attentionCount={attentionItems.length}
        onOpenModelGuide={() => setIsModelGuideOpen(true)}
        onOpenConnectRepo={() => setIsConnectRepoOpen(true)}
        onOpenCiCdMap={() => setIsCiCdModalOpen(true)}
        onRefreshSim={handleRefreshSim}
      />

      {/* Main Cockpit Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-4">
        {/* Compact Next Best Action Banner */}
        {nba && attentionItems.length > 0 && (
          <NextBestActionCard
            nba={nba}
            attentionCount={attentionItems.length}
            onExecute={handleFocusProjectGate}
            onSimulateApprove={handleSimulateApproveNBA}
          />
        )}

        {/* View Mode Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-stone-300/80 pb-2 pt-1 font-mono text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('projects')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'projects'
                  ? 'bg-stone-900 text-stone-50 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>專案總覽 ({projects.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('attention')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'attention'
                  ? 'bg-amber-100 text-amber-950 border border-amber-300 shadow-xs'
                  : 'text-amber-800 hover:text-amber-950 hover:bg-amber-50'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
              <span>待人決策 ({attentionItems.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'telemetry'
                  ? 'bg-stone-900 text-stone-50 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
              }`}
            >
              <Cpu className="h-3.5 w-3.5" />
              <span>AI 執行與模型遙測 ({snapshot.aiRunning} 執行中)</span>
            </button>
          </div>

          <div className="text-[11px] text-stone-500 hidden sm:block">
            <span>ChatGPT ↔ Codex Bridge Protocol</span>
          </div>
        </div>

        {/* Tab 1: Portfolio Overview (Clean Projects List / Cards) */}
        {activeTab === 'projects' && (
          <div className="animate-fadeIn">
            <PortfolioOverview
              projects={displayedProjects}
              selectedProjectId={selectedProject?.id || null}
              onSelectProject={handleSelectProject}
              onOpenConnectRepo={() => setIsConnectRepoOpen(true)}
            />
          </div>
        )}

        {/* Tab 2: Needs Attention Queue (Pure Decision Focus) */}
        {activeTab === 'attention' && (
          <div className="animate-fadeIn space-y-4">
            <NeedsAttentionQueue
              items={attentionItems}
              onSelectItem={handleFocusProjectGate}
              onResolveItem={handleResolveAttentionItem}
            />
          </div>
        )}

        {/* Tab 3: AI Execution Snapshot (Telemetry & Model Breakdown) */}
        {activeTab === 'telemetry' && (
          <div className="animate-fadeIn space-y-4">
            <AIExecutionSnapshot
              snapshot={snapshot}
              onOpenModelGuide={() => setIsModelGuideOpen(true)}
              onFilterByModel={(model) => {
                setSearchQuery(model);
                setActiveTab('projects');
              }}
            />
          </div>
        )}
      </main>

      {/* Slide-over Project Detail Drawer */}
      <ProjectDetailDrawer
        project={selectedProject}
        onClose={() => setSelectedProject(null)}
        onResolveBlocker={handleResolveBlocker}
        onApproveCurrentGate={handleApproveCurrentGate}
        onAdvanceToNextGate={handleAdvanceToNextGate}
        onStartNewIteration={handleStartNewIteration}
        onUpdateFeatures={handleUpdateFeatures}
        onConfirmSelectiveRelease={handleConfirmSelectiveRelease}
        onShowToast={showToast}
      />

      {/* Model Routing Guide Modal */}
      <ModelRoutingGuide
        isOpen={isModelGuideOpen}
        onClose={() => setIsModelGuideOpen(false)}
      />

      {/* Connect GitHub Repository Modal */}
      <ConnectRepoModal
        isOpen={isConnectRepoOpen}
        onClose={() => setIsConnectRepoOpen(false)}
        existingRepoNames={projects.map((p) => p.repository)}
        onConnectRepo={handleConnectRepo}
      />

      {/* Global CI/CD Pipeline Mapping Modal */}
      <CiCdWorkflowModal
        isOpen={isCiCdModalOpen}
        onClose={() => setIsCiCdModalOpen(false)}
        currentProject={selectedProject}
      />
    </div>
  );
}
