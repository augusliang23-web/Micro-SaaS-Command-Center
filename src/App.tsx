import React, { useState } from 'react';
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

export default function App() {
  const [projects, setProjects] = useState<MicroSaaSProject[]>(initialProjects);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>(initialAttentionItems);
  const [nba, setNba] = useState<NextBestAction>(initialNextBestAction);
  const [snapshot, setSnapshot] = useState<AIExecutionSnapshotData>(initialExecutionSnapshot);

  const [selectedProject, setSelectedProject] = useState<MicroSaaSProject | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'attention' | 'running' | 'production'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isModelGuideOpen, setIsModelGuideOpen] = useState<boolean>(false);
  const [isConnectRepoOpen, setIsConnectRepoOpen] = useState<boolean>(false);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

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
      return p.health === 'Attention' || p.health === 'Blocked' || p.health === 'At Risk' || p.waitingState === 'WAITING_FOR_HUMAN';
    }
    if (activeFilter === 'running') {
      return p.waitingState === 'AI_RUNNING';
    }
    if (activeFilter === 'production') {
      return p.stage === 'Production' || p.environment.production.status === 'Live' || p.environment.production.status === 'Healthy';
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

    showToast(`Decision recorded for project: ${resolution}`);

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
      summary: 'All automated regression tests (100%) and lint passes are green. Model Luna completed deterministic migration without conflict.',
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
    showToast(`Resolved attention item [${itemId}]. AI workflow unblocked.`);
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
    showToast(`Gate approved for ${projectId}.`);
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

      const updatedProj: MicroSaaSProject = {
        ...proj,
        currentGate: nextGate.id,
        currentGateLabel: nextGate.label,
        gates: updatedGates,
        waitingState: 'AI_RUNNING',
        nextAction: `Executing ${nextGate.label}`,
      };

      setProjects((prev) => prev.map((p) => (p.id === projectId ? updatedProj : p)));
      setSelectedProject(updatedProj);
      showToast(`Advanced ${proj.name} to gate: ${nextGate.label}`);
    }
  };

  const handleRefreshSim = () => {
    showToast('Bridge telemetry re-synced across 6 micro-SaaS repositories.');
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
        onRefreshSim={handleRefreshSim}
      />

      {/* Main Cockpit Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* AREA 1: Next Best Action Focus Area */}
        <NextBestActionCard
          nba={nba}
          attentionCount={attentionItems.length}
          onExecute={handleFocusProjectGate}
          onSimulateApprove={handleSimulateApproveNBA}
        />

        {/* AREA 3: Needs Attention (Human Attention Queue) */}
        <NeedsAttentionQueue
          items={attentionItems}
          onSelectItem={handleFocusProjectGate}
          onResolveItem={handleResolveAttentionItem}
        />

        {/* AREA 2: Portfolio Overview (Compact Structured Table) */}
        <PortfolioOverview
          projects={displayedProjects}
          selectedProjectId={selectedProject?.id || null}
          onSelectProject={handleSelectProject}
          onOpenConnectRepo={() => setIsConnectRepoOpen(true)}
        />

        {/* AREA 4: AI Execution Snapshot (Secondary technical cockpit readout) */}
        <AIExecutionSnapshot
          snapshot={snapshot}
          onOpenModelGuide={() => setIsModelGuideOpen(true)}
          onFilterByModel={(model) => setSearchQuery(model)}
        />
      </main>

      {/* Footer / Operating Principles summary */}
      <footer className="border-t border-stone-200 bg-[#FAF9F6] py-4 px-6 text-xs text-stone-500 font-mono">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-stone-700 font-semibold">ChatGPT ↔ Codex Bridge Workflow:</span>
            <span className="text-stone-500">DISCUSS → SPECIFY → ROUTE → IMPLEMENT → TEST → REVIEW → APPROVE → DONE</span>
          </div>
          <div className="text-stone-600">
            Rule: <strong className="text-amber-800">Tests PASS ≠ Review PASS</strong>
          </div>
        </div>
      </footer>

      {/* Slide-over Project Detail Drawer */}
      <ProjectDetailDrawer
        project={selectedProject}
        onClose={() => setSelectedProject(null)}
        onResolveBlocker={handleResolveBlocker}
        onApproveCurrentGate={handleApproveCurrentGate}
        onAdvanceToNextGate={handleAdvanceToNextGate}
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
    </div>
  );
}
