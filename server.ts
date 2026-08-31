import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Command Center full-stack server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
