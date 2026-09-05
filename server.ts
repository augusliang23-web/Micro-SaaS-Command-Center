import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { CodexAppServerClient } from './server/codexAppServerClient.mjs';
import { CodexHandoffService } from './server/codexHandoffService.mjs';
import {
  createCodexHandoffRouter,
  isLoopbackOrigin,
  loadCodexProjectAllowlist,
} from './server/codexHandoffRoutes.mjs';
import { readState, writeState } from './server/localStateStore.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '127.0.0.1';
const EXPECTED_COMMAND_CENTER_ORIGIN = process.env.COMMAND_CENTER_ORIGIN || `http://${HOST}:${PORT}`;

app.use(express.json());

if (process.env.NODE_ENV === 'development') {
  let codexHandoffService: CodexHandoffService | null = null;
  if (isLoopbackOrigin(EXPECTED_COMMAND_CENTER_ORIGIN)) {
    try {
      const allowlistPath =
        process.env.COMMAND_CENTER_CODEX_PROJECTS_CONFIG ||
        path.join(process.cwd(), '.bridge', 'codex-projects.local.json');
      codexHandoffService = new CodexHandoffService({
        projects: loadCodexProjectAllowlist(allowlistPath),
        provider: {
          start(input: { cwd: string; prompt: string; onUpdate: (update: unknown) => void }) {
            return new CodexAppServerClient().start(input);
          },
        },
      });
    } catch (error) {
      console.warn(
        'Local Codex handoff is blocked until a valid server-side project allowlist is configured:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  app.use(
    '/api/bridge/codex-handoffs',
    createCodexHandoffRouter({
      service: codexHandoffService,
      expectedOrigin: EXPECTED_COMMAND_CENTER_ORIGIN,
      nodeEnv: process.env.NODE_ENV,
    }),
  );
}

// Lazy-initialized Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

// Local single-file persistence for the dashboard's own state
app.get('/api/state', (req, res) => {
  const state = readState();
  if (!state) {
    res.status(404).json({ error: 'No saved state yet.' });
    return;
  }
  res.json(state);
});

app.put('/api/state', (req, res) => {
  try {
    writeState(req.body);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error writing local state:', error);
    res.status(500).json({ error: 'Failed to save state.' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
});

// Live Architecture Advice Endpoint for ChatGPT ↔ Bridge
app.post('/api/bridge/chatgpt-advice', async (req, res) => {
  try {
    const { project, userQuery } = req.body || {};

    if (!project) {
      res.status(400).json({ error: 'Project data is required.' });
      return;
    }

    const systemPrompt = `You are ChatGPT acting as the Principal Architect, Tech Lead, and Governance Orchestrator for an AI-native Micro-SaaS fleet (the "ChatGPT ↔ Codex Bridge" system).
Your mission is to resolve technical blockers, review discrepancies (e.g. Tests: PASS but Review: CHANGES REQUIRED), evaluate architectural options, and output concrete decision directives for Codex.

Always format your response cleanly with:
1. Executive Summary & Recommended Strategy (Highlight Option A or Option B clearly).
2. Architectural Trade-off Analysis (Security, Data Integrity, Blast Radius, User Experience).
3. Exact Directive for Codex implementation (files, error handling, idempotency).
4. Exact Single-line Bridge Decision String in format: \`Policy selected: <summary>\``;

    const userPrompt = `Project: ${project.name} (${project.stage} Stage)
Repository: ${project.repository || 'repo'} (Branch: ${project.branch || 'main'})
Current Gate: ${project.currentGate} (${project.currentGateLabel})
Current Task: ${project.currentTask}
Codex Routing Model: ${project.model}
Test Outcome: ${project.testOutcome || 'N/A'}
Review Outcome: ${project.reviewOutcome || 'N/A'}
Active Blocker: ${project.blocker || 'None'}

User Specific Query: ${userQuery || 'Please analyze the trade-offs between Option A and Option B, recommend the best decision, and generate the .bridge resolution spec.'}

Evaluate the situation with high rigor.`;

    // 1. Try OpenAI if user provided OPENAI_API_KEY
    if (process.env.OPENAI_API_KEY) {
      try {
        const openAIRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.2,
          }),
        });

        if (openAIRes.ok) {
          const openAIData = await openAIRes.json();
          const responseText = openAIData.choices?.[0]?.message?.content || '';

          res.json({
            provider: 'OpenAI (ChatGPT API)',
            modelUsed: 'gpt-4o',
            analysisMarkdown: responseText,
            recommendedOption: responseText.includes('Option A') ? 'Option A' : 'Option B',
            decisionString: 'Policy selected: Skip duplicate email rows with warning report and audit log.',
            suggestedNextGate: 'APPROVE',
          });
          return;
        }
      } catch (err) {
        console.warn('OpenAI API call failed, falling back to integrated Gemini API:', err);
      }
    }

    // 2. Default to Gemini 3.7 Flash as the architecture reasoning engine
    const ai = getGeminiClient();
    if (ai) {
      const geminiRes = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: `${systemPrompt}\n\n=== CONTEXT ===\n${userPrompt}`,
        config: {
          temperature: 0.2,
        },
      });

      const responseText = geminiRes.text || '';

      res.json({
        provider: 'ChatGPT Bridge Engine (Powered by Gemini 3.7 Flash)',
        modelUsed: 'gemini-3.7-flash',
        analysisMarkdown: responseText,
        recommendedOption: responseText.includes('Option A') ? 'Option A' : 'Option B',
        decisionString: 'Policy selected: Skip duplicate email rows with warning report and audit log.',
        suggestedNextGate: 'APPROVE',
      });
      return;
    }

    // 3. Fallback response if no keys are set
    res.json({
      provider: 'ChatGPT Bridge (Local Fallback Policy)',
      modelUsed: 'rule-based-architect',
      analysisMarkdown: `### ChatGPT Architecture Evaluation (ProSync - CSV Batch Import)

1. **Recommended Strategy**: **Option A (Skip with Audit Error Report)**
   - *Security & Data Integrity*: In multi-tenant B2B architectures, silent account overwriting without explicit user confirmation risks unauthorized data contamination.
   - *Audit Trail*: Returning a downloadable \`import_errors.csv\` with row numbers and \`ERR_DUPLICATE_EMAIL\` provides complete transparency to end users.

2. **Actionable Directive for Codex (Terra Tier)**:
   - Modify \`src/services/importer.ts\` to collect duplicate collision rows into an in-memory \`skippedRecords\` buffer.
   - Emit a summary banner on UI: \`Imported X records, Y skipped due to duplication\`.

3. **Bridge Decision String**:
   \`Policy selected: Skip duplicate email rows with warning report and audit log.\``,
      recommendedOption: 'Option A',
      decisionString: 'Policy selected: Skip duplicate email rows with warning report and audit log.',
      suggestedNextGate: 'APPROVE',
    });
  } catch (error) {
    console.error('Error in /api/bridge/chatgpt-advice:', error);
    res.status(500).json({
      error: 'Failed to generate architectural advice.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// Live AI Auto-Extraction of Features from ChatGPT PRD / Raw Specs
app.post('/api/bridge/extract-features', async (req, res) => {
  try {
    const { text, project, source } = req.body || {};

    const projectContext = project
      ? `Project: ${project.name} (${project.stage})
Repository: ${project.repository || 'repo'}
Current Task: ${project.currentTask || ''}
Target Release Version: ${project.environment?.targetReleaseVersion || 'v1.1.0'}`
      : '';

    const contentToExtract =
      text ||
      `PRD and specifications discussed with ChatGPT for ${project?.name || 'the project'}:
Task: ${project?.currentTask || 'Batch CSV import with field mapping'}
Features discussed:
1. Intelligent field mapping for CSV/XLSX
2. Asynchronous Queue Processing (BullMQ)
3. Inline error fixer for rejected rows
4. Chunked file upload for large 500MB+ imports
5. Gemini 2.5 smart field autocomplete`;

    const systemPrompt = `You are the Bridge Feature Extraction Assistant.
Your job is to read raw text from ChatGPT PRD discussions, user stories, or architecture notes, and extract a clean list of structured feature objects for the Feature Delivery Matrix.

You must return a valid JSON array of feature objects matching this exact structure:
[
  {
    "name": "Feature Name (Concise & Clear)",
    "description": "Brief description and acceptance criteria",
    "category": "Core" | "UI/UX" | "Integration" | "AI" | "Infra" | "Security",
    "stageStatus": "Testing" | "Verified" | "Backlog",
    "prodStatus": "Pending Release" | "Planned",
    "featureFlagKey": "domain.feature_identifier (snake_case, lowercase)",
    "flagEnabledInProd": false,
    "targetReleaseVersion": "${project?.environment?.targetReleaseVersion || 'v1.1.0'}",
    "githubIssue": "#42" (or optional)
  }
]

Respond ONLY with valid JSON array. No markdown code blocks, no other text.`;

    const ai = getGeminiClient();
    if (ai) {
      const geminiRes = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: `${systemPrompt}\n\nContext:\n${projectContext}\n\nInput Content to Parse:\n${contentToExtract}`,
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const responseText = geminiRes.text || '[]';
      try {
        const parsed = JSON.parse(responseText);
        const featuresWithIds = (Array.isArray(parsed) ? parsed : [parsed]).map((item: any, idx: number) => ({
          ...item,
          id: `feat-${Date.now()}-${idx}`,
          addedAt: new Date().toISOString().split('T')[0],
          authorModel: project?.model || 'Terra',
        }));
        res.json({ features: featuresWithIds, provider: 'Gemini 3.7 Flash' });
        return;
      } catch (jsonErr) {
        console.warn('Failed to parse AI JSON response, falling back:', jsonErr);
      }
    }

    // Fallback extraction generator based on project context
    const fallbackList = [
      {
        id: `feat-${Date.now()}-1`,
        name: `即時欄位格式自動驗證 (Live Validation)`,
        description: `依據 ChatGPT 討論之 PRD 規範，在上傳前即時校驗 Email 與欄位型態。`,
        category: 'Core',
        stageStatus: 'Testing',
        prodStatus: 'Pending Release',
        featureFlagKey: 'core.live_validation',
        flagEnabledInProd: false,
        targetReleaseVersion: project?.environment?.targetReleaseVersion || 'v1.1.0',
        githubIssue: '#45',
        addedAt: new Date().toISOString().split('T')[0],
        authorModel: project?.model || 'Terra',
      },
      {
        id: `feat-${Date.now()}-2`,
        name: `錯誤資料即時修正預覽表 (Inline Error Fixer)`,
        description: `在匯入前於網頁直接編輯標紅欄位，提供行內修正避免整份重新上傳。`,
        category: 'UI/UX',
        stageStatus: 'Verified',
        prodStatus: 'Pending Release',
        featureFlagKey: 'ui.inline_error_fixer',
        flagEnabledInProd: false,
        targetReleaseVersion: project?.environment?.targetReleaseVersion || 'v1.1.0',
        githubIssue: '#48',
        addedAt: new Date().toISOString().split('T')[0],
        authorModel: project?.model || 'Terra',
      },
      {
        id: `feat-${Date.now()}-3`,
        name: `非同步批次解析佇列 (BullMQ Stream)`,
        description: `後端使用 Redis Queue 進行非阻塞批次讀取，提昇大型檔案解析速率 400%。`,
        category: 'Infra',
        stageStatus: 'Testing',
        prodStatus: 'Pending Release',
        featureFlagKey: 'importer.async_batch_queue',
        flagEnabledInProd: false,
        targetReleaseVersion: project?.environment?.targetReleaseVersion || 'v1.1.0',
        githubIssue: '#50',
        addedAt: new Date().toISOString().split('T')[0],
        authorModel: project?.model || 'Terra',
      },
    ];

    res.json({ features: fallbackList, provider: 'Rule-Based Extractor' });
  } catch (error) {
    console.error('Error in /api/bridge/extract-features:', error);
    res.status(500).json({ error: 'Failed to extract features.' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Command Center full-stack server running at http://${HOST}:${PORT}`);
  });
}

startServer();
