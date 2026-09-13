import 'dotenv/config';
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
import { createStateRouter } from './server/stateRoutes.mjs';
import { createGithubRouter } from './server/githubRoutes.mjs';
import { createLocalGitRouter } from './server/localGitRoutes.mjs';
import { fetchChangedFiles, isRealGithubRepo } from './server/githubPullStatus.mjs';
import { GithubCliError } from './server/githubRepos.mjs';

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
app.use('/api/state', createStateRouter());

// Server-side proxy over the local `gh` CLI session; the GitHub token never reaches the browser
app.use('/api/github', createGithubRouter());

// Runs `git status` against a local clone path the owner typed in himself — read-only, loopback-only
app.use('/api/local-git', createLocalGitRouter());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
});

// Live Architecture Advice Endpoint for AI Advisor ↔ Bridge
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
        provider: 'AI Bridge Engine (Powered by Gemini 3.7 Flash)',
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
      provider: 'AI Bridge (Local Fallback Policy)',
      modelUsed: 'rule-based-architect',
      analysisMarkdown: `### AI Architecture Evaluation (ProSync - CSV Batch Import)

1. **Recommended Strategy**: **Option A (Skip with Audit Error Report)**
   - *Security & Data Integrity*: In multi-tenant B2B architectures, silent account overwriting without explicit user confirmation risks unauthorized data contamination.
   - *Audit Trail*: Returning a downloadable \`import_errors.csv\` with row numbers and \`ERR_DUPLICATE_EMAIL\` provides complete transparency to end users.

2. **Actionable Directive for AI Agent (Terra Tier)**:
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

// Live AI Auto-Extraction of Features from AI Advisor PRD / Raw Specs
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
        description: `依據 AI 顧問討論之 PRD 規範，在上傳前即時校驗 Email 與欄位型態。`,
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

// Plain-language AI summary of what actually changed in a PR/commit
const MAX_PATCH_CHARS = 12000;

app.post('/api/bridge/summarize-changes', async (req, res) => {
  try {
    const { repo, prNumber, sha } = req.body || {};

    if (!isRealGithubRepo(repo)) {
      res.status(400).json({ error: '"repo" must be an owner/name GitHub slug.' });
      return;
    }
    if (!prNumber && !sha) {
      res.status(400).json({ error: 'Either "prNumber" or "sha" is required.' });
      return;
    }

    const files = await fetchChangedFiles(repo, { prNumber, sha });
    const fileListText = files
      .map((f: { filename: string; status: string; additions: number; deletions: number }) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`,
      )
      .join('\n');

    let patchText = '';
    let truncated = false;
    for (const file of files as Array<{ filename: string; patch?: string }>) {
      if (!file.patch) continue;
      const chunk = `\n--- ${file.filename} ---\n${file.patch}`;
      if (patchText.length + chunk.length > MAX_PATCH_CHARS) {
        truncated = true;
        break;
      }
      patchText += chunk;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.json({
        summary: `目前沒有設定 AI 金鑰（GEMINI_API_KEY），無法產生摘要。以下是這次變更的檔案清單：\n\n${fileListText || '（無檔案變更資訊）'}`,
        provider: 'local-fallback (no AI key configured)',
        fileCount: files.length,
      });
      return;
    }

    const systemPrompt = `你是一位技術顧問，正在為一位不具軟體工程背景的產品負責人，用清楚易懂的白話文摘要一次程式碼變更。
請說明：這次修改大致做了什麼、影響了哪些功能或使用者體驗、有沒有看起來需要注意的風險。
不要使用艱澀的技術術語，如果必須提到技術名詞，請簡單解釋。用繁體中文回答，控制在 300 字以內。`;

    const userPrompt = `Repository: ${repo}
變更檔案清單：
${fileListText || '（無檔案變更資訊）'}
${truncated ? '\n（註：程式碼差異內容過長，以下僅節錄部分內容）' : ''}

程式碼差異內容：
${patchText || '（無可用的差異內容）'}`;

    const geminiRes = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: `${systemPrompt}\n\n=== CONTEXT ===\n${userPrompt}`,
      config: {
        temperature: 0.2,
      },
    });

    res.json({
      summary: geminiRes.text || '（AI 未回傳摘要內容）',
      provider: 'Gemini 3.5 Flash-Lite',
      fileCount: files.length,
    });
  } catch (error) {
    if (error instanceof GithubCliError) {
      const status = error.kind === 'not_authenticated' ? 401 : error.kind === 'not_found' ? 503 : 502;
      res.status(status).json({ error: error.message });
      return;
    }
    console.error('Error in /api/bridge/summarize-changes:', error);
    const geminiStatus = (error as { status?: number })?.status;
    const friendlyError =
      geminiStatus === 503
        ? `Google AI 目前用量過大，請稍後再試一次。（錯誤代碼 503）`
        : geminiStatus === 429
        ? `Google AI 今日免費額度已經用完了，要等額度重置（通常隔天）才能再用，或改用付費方案。（錯誤代碼 429）`
        : geminiStatus
        ? `產生摘要時發生問題，請稍後再試一次。（錯誤代碼 ${geminiStatus}）`
        : '產生摘要時發生問題，請稍後再試一次。';
    res.status(500).json({
      error: friendlyError,
      detail: error instanceof Error ? error.message : String(error),
    });
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
