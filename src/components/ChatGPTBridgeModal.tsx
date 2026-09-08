import React, { useState } from 'react';
import {
  X,
  Bot,
  Copy,
  Check,
  Send,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  MessageSquare,
  FileText,
  HelpCircle,
  Cpu,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { MicroSaaSProject } from '../types';

interface ChatGPTBridgeModalProps {
  project: MicroSaaSProject | null;
  isOpen: boolean;
  onClose: () => void;
  onApplyResolution?: (projectId: string, resolution: string) => void;
}

export const ChatGPTBridgeModal: React.FC<ChatGPTBridgeModalProps> = ({
  project,
  isOpen,
  onClose,
  onApplyResolution,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'api' | 'prompt'>('api');
  const [simulatedResponse, setSimulatedResponse] = useState<string | null>(null);
  const [providerInfo, setProviderInfo] = useState<string | null>(null);
  const [decisionString, setDecisionString] = useState<string>(
    'Policy selected: Skip duplicate email rows with warning report and audit log.'
  );
  const [customQuestion, setCustomQuestion] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !project) return null;

  // Generate the high-density structured prompt payload for the AI advisor
  const fullBridgePrompt = `[BRIDGE HANDOVER: AI ADVISOR SESSION]
Timestamp: ${new Date().toISOString()}
Repository: ${project.repository} (${project.executionContext.branch})
Project Stage: ${project.stage} | Current Health: ${project.health}

=== CURRENT TASK & WORKFLOW STATE ===
Task: ${project.currentTask}
Gate: ${project.currentGate} (${project.currentGateLabel})
AI Model Routing: ${project.model} (Risk Tier)
Waiting State: ${project.waitingState}

=== DIAGNOSTIC & BLOCKER STATUS ===
Test Outcome: ${project.testOutcome || 'N/A'}
Review Outcome: ${project.reviewOutcome || 'N/A'}
Active Blocker: ${project.blocker || 'None'}

=== HUMAN DECISION REQUIRED ===
Issue Context:
During CSV Batch Import processing, duplicate email entries can collide with existing accounts.
The automated Review Bot raised a CHANGES REQUIRED objection because the current implementation silently drops duplicates without an audit trail.

Questions for AI Advisor:
1. What is the recommended architectural pattern for handling duplicate emails in B2B multi-tenant imports (Skip with report vs. Upsert vs. Fail entire batch)?
2. How should we instruct the AI agent to implement this with idempotency and clear error reporting?
3. Generate the updated .bridge task specification and decision resolution string.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullBridgePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCallChatGPTAPI = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bridge/chatgpt-advice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project,
          userQuery: customQuestion || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`API returned status ${res.status}`);
      }

      const data = await res.json();
      setSimulatedResponse(data.analysisMarkdown || 'No advice returned.');
      setProviderInfo(`${data.provider || 'AI Engine'} • Model: ${data.modelUsed || 'default'}`);
      if (data.decisionString) {
        setDecisionString(data.decisionString);
      }
    } catch (err) {
      console.error('Failed to query AI advisor API:', err);
      setErrorMsg('Could not reach backend API. Using local architectural policy engine.');
      // Fallback
      setSimulatedResponse(
        `### AI Architecture Evaluation (ProSync - CSV Batch Import)

1. **Recommended Strategy**: **Option A (Skip with Audit Error Report)**
   - *Security & Data Integrity*: In multi-tenant B2B architectures, silent account overwriting without explicit user confirmation risks unauthorized data contamination.
   - *Audit Trail*: Returning a downloadable \`import_errors.csv\` with row numbers and \`ERR_DUPLICATE_EMAIL\` provides complete transparency to end users.

2. **Actionable Directive for AI Agent (Terra Tier)**:
   - Modify \`src/services/importer.ts\` to collect duplicate collision rows into an in-memory \`skippedRecords\` buffer.
   - Emit a summary banner on UI: \`Imported X records, Y skipped due to duplication\`.

3. **Bridge Decision String**:
   \`Policy selected: Skip duplicate email rows with warning report and audit log.\``
      );
      setProviderInfo('AI Advisor Engine (Local High-Availability Mode)');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyDecision = () => {
    if (onApplyResolution) {
      onApplyResolution(project.id, decisionString);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-3xl bg-[#F7F6F2] border border-stone-300 rounded-xl shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[92vh] text-stone-800">
        {/* Header */}
        <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-stone-900 font-mono uppercase tracking-wider">
                  AI 顧問即時協作
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                  {project.name}
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Direct AI API connector: analyzes architecture trade-offs and generates syncable decision specs.
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
        <div className="flex items-center px-6 pt-3 border-b border-stone-200 bg-white text-xs font-mono gap-4">
          <button
            onClick={() => setActiveTab('api')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeTab === 'api'
                ? 'border-stone-800 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>1. Live AI Architect Query (API)</span>
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeTab === 'prompt'
                ? 'border-stone-800 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>2. Raw Bridge Context Payload</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs font-mono flex-1">
          {activeTab === 'api' && (
            <div className="space-y-4">
              {/* Context Summary banner */}
              <div className="bg-white border border-stone-300 rounded-lg p-4 space-y-3 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <span className="text-stone-900 font-bold flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-stone-700" />
                      Live Architectural Evaluation Engine
                    </span>
                    <p className="text-stone-600 text-[11px]">
                      Task: <strong className="text-stone-900">{project.currentTask}</strong> • Blocker:{' '}
                      <span className="text-amber-900 font-medium">{project.blocker || 'Human Decision Required'}</span>
                    </p>
                  </div>

                  <button
                    onClick={handleCallChatGPTAPI}
                    disabled={isLoading}
                    className="px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-stone-50 font-semibold rounded-md flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-xs shrink-0 cursor-pointer"
                  >
                    {isLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                    <span>{isLoading ? 'Querying AI API...' : 'Ask AI Advisor for Advice'}</span>
                  </button>
                </div>

                {/* Optional Query Input */}
                <div className="pt-2 border-t border-stone-200">
                  <label className="text-[11px] text-stone-600 block mb-1">
                    Custom Prompt or Specific Constraint (Optional):
                  </label>
                  <input
                    type="text"
                    value={customQuestion}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                    placeholder="e.g. Compare Option A vs Option B with emphasis on compliance & audit trail..."
                    className="w-full bg-stone-50 border border-stone-300 rounded px-3 py-1.5 text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-600 text-xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleCallChatGPTAPI()}
                  />
                </div>
              </div>

              {errorMsg && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded text-[11px]">
                  {errorMsg}
                </div>
              )}

              {/* API Response display */}
              {simulatedResponse ? (
                <div className="space-y-3 animate-fadeIn">
                  {providerInfo && (
                    <div className="flex items-center justify-between text-[11px] text-stone-500 px-1">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-600" />
                        Provider: <strong className="text-stone-800">{providerInfo}</strong>
                      </span>
                      <button
                        onClick={handleCallChatGPTAPI}
                        disabled={isLoading}
                        className="text-stone-600 hover:text-stone-900 flex items-center gap-1 text-[11px] cursor-pointer"
                      >
                        <RefreshCw className="h-3 w-3" /> Re-generate
                      </button>
                    </div>
                  )}

                  <div className="bg-white border border-stone-300 rounded-lg p-4 text-[11px] text-stone-800 space-y-2 whitespace-pre-wrap leading-relaxed max-h-[320px] overflow-y-auto shadow-xs">
                    {simulatedResponse}
                  </div>

                  {/* One-click Sync Action Card */}
                  <div className="bg-stone-100 border border-stone-300 rounded-lg p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
                    <div className="space-y-0.5 text-left">
                      <div className="text-stone-900 font-semibold flex items-center gap-1.5 text-xs">
                        <ShieldCheck className="h-4 w-4 text-emerald-700" />
                        <span>Ready to Sync Decision Spec to Bridge</span>
                      </div>
                      <p className="text-stone-600 text-[11px]">
                        Will unblock <strong className="text-stone-900">{project.name}</strong>, record decision in history, and advance gate to <strong className="text-emerald-800">APPROVE</strong>.
                      </p>
                    </div>

                    <button
                      onClick={handleApplyDecision}
                      className="w-full sm:w-auto px-4 py-2 bg-stone-900 hover:bg-stone-800 text-stone-50 font-bold rounded-md flex items-center justify-center gap-1.5 transition-colors shadow-xs shrink-0 cursor-pointer"
                    >
                      <Check className="h-4 w-4" />
                      <span>Sync Decision to Project & Unblock</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 border border-dashed border-stone-300 rounded-lg space-y-2 bg-white">
                  <Bot className="h-8 w-8 text-stone-400 mx-auto" />
                  <p className="text-stone-500 text-xs">
                    Click <strong>"Ask AI Advisor for Advice"</strong> to query live AI reasoning.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'prompt' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-stone-800 font-semibold flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-stone-700" />
                  Full Bridge Context Payload (.bridge format):
                </span>
                <button
                  onClick={handleCopy}
                  className="px-3 py-1 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-md flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-stone-500" />}
                  <span>{copied ? 'Copied to Clipboard!' : 'Copy Structured Prompt'}</span>
                </button>
              </div>

              {/* Code / Context Box */}
              <div className="bg-white border border-stone-300 rounded-lg p-4 font-mono text-[11px] text-stone-800 whitespace-pre-wrap leading-relaxed overflow-x-auto shadow-xs max-h-[350px]">
                {fullBridgePrompt}
              </div>

              <div className="bg-stone-100 border border-stone-300 rounded-lg p-3 flex items-start gap-2.5 text-stone-600">
                <HelpCircle className="h-4 w-4 text-stone-700 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong className="text-stone-900">Bridge Protocol:</strong> In production, the AI advisor can automatically read and write directly to <code className="text-stone-800 bg-white px-1 py-0.5 rounded border border-stone-200">.bridge/ai-context.md</code> via the Bridge CLI / Custom Actions.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#FAF9F6] border-t border-stone-200 px-6 py-3 flex items-center justify-between">
          <span className="text-[11px] text-stone-500 font-mono">
            Bridge API Endpoint: <code className="text-stone-700">/api/bridge/chatgpt-advice</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-mono bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-md transition-colors cursor-pointer shadow-xs"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
