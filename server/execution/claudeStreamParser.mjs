import { UNKNOWN_MODEL } from './agentAdapter.mjs';

/**
 * Defensive parser for `claude -p --output-format stream-json --verbose`.
 *
 * STATUS OF THE EVENT SHAPES: the installed CLI's --help confirms the output
 * mode but not the per-event JSON schema (no inference was run in this task).
 * The shapes below follow the published Claude Code SDK stream format and local
 * session logs (assistant `message.model` / `message.usage`). Every field is
 * read defensively and nothing is trusted: see CLAUDE_ADAPTER_LIVE_SMOKE_PENDING
 * in docs/architecture/agent-console-phase3a-claude-adapter.md.
 *
 * Output is provider-neutral, UNGRADED events. Claude event names stay in this
 * file. Nothing the agent says can pick an evidence grade, create files_changed /
 * command / commit / PR evidence, or mark anything verified.
 */

const TEXT_MAX = 20_000;
const SUMMARY_MAX = 200;
const NAME_MAX = 64;
const MAX_REPORTED_MALFORMED = 5;

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);
const safeName = (v) => clip(v, NAME_MAX).replace(/[^\w.:/-]/g, '?');

function toTokens(usage) {
  if (!isRecord(usage)) return null;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  if (input === undefined || output === undefined) return null; // never fabricate missing fields
  const tokens = { input, output };
  const cached = count(usage.cache_read_input_tokens);
  const cacheCreation = count(usage.cache_creation_input_tokens);
  if (cached !== undefined) tokens.cached = cached;
  if (cacheCreation !== undefined) tokens.cacheCreation = cacheCreation;
  return tokens;
}

function sumTokens(list) {
  const total = { input: 0, output: 0 };
  for (const t of list) {
    total.input += t.input;
    total.output += t.output;
    for (const k of ['cached', 'cacheCreation']) if (t[k] !== undefined) total[k] = (total[k] ?? 0) + t[k];
  }
  return total;
}

/**
 * @param {{ allowedTools: readonly string[], expectedCwd?: string, allowedPermissionModes?: readonly string[] }} policy
 */
export function createClaudeStreamParser({ allowedTools, expectedCwd, allowedPermissionModes = ['acceptEdits'] }) {
  const state = {
    sawInit: false,
    sessionId: null,
    models: new Set(),
    initTools: null, // null = runtime did not report its tool list, so policy was not observed
    permissionMode: null,
    sawResult: false,
    resultOk: false,
    resultSubtype: null,
    resultText: '',
    resultTokens: null,
    messageTokens: new Map(),
    denials: [],
    malformed: 0,
    unknownTypes: new Set(),
    policyViolation: null,
  };

  const violate = (code, message) => {
    if (!state.policyViolation) state.policyViolation = { code, message };
  };

  function handleInit(event, out) {
    state.sawInit = true;
    if (typeof event.session_id === 'string') state.sessionId = event.session_id;
    if (typeof event.model === 'string' && event.model) state.models.add(event.model);
    if (Array.isArray(event.tools)) {
      state.initTools = event.tools.filter((t) => typeof t === 'string');
      const extra = state.initTools.filter((t) => !allowedTools.includes(t));
      if (extra.length > 0) violate('TOOL_POLICY_VIOLATION', `Runtime exposes tools outside the allowlist: ${extra.map(safeName).join(', ')}`);
    }
    if (typeof event.permissionMode === 'string') {
      state.permissionMode = event.permissionMode;
      if (!allowedPermissionModes.includes(event.permissionMode)) violate('PERMISSION_MODE_VIOLATION', `Runtime reports permission mode ${safeName(event.permissionMode)}`);
    }
    if (expectedCwd && typeof event.cwd === 'string' && event.cwd !== expectedCwd) violate('CWD_MISMATCH', 'Runtime reports a different working directory');
    out.push({ type: 'started', sessionId: state.sessionId, model: state.models.size === 1 ? [...state.models][0] : null });
  }

  function handleAssistant(event, out) {
    const message = isRecord(event.message) ? event.message : {};
    if (typeof message.model === 'string' && message.model) state.models.add(message.model);
    const tokens = toTokens(message.usage);
    if (tokens && typeof message.id === 'string') state.messageTokens.set(message.id, tokens); // repeated ids carry cumulative usage; keep the last
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
        out.push({ type: 'output', text: clip(block.text, TEXT_MAX) });
      } else if (block.type === 'tool_use') {
        const name = safeName(block.name);
        out.push({ type: 'tool', phase: 'use', name, toolUseId: safeName(block.id) });
        if (state.initTools && name && !allowedTools.includes(block.name)) violate('TOOL_POLICY_VIOLATION', `Agent invoked a tool outside the allowlist: ${name}`);
      }
    }
  }

  function handleUser(event, out) {
    const message = isRecord(event.message) ? event.message : {};
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (isRecord(block) && block.type === 'tool_result') {
        out.push({ type: 'tool', phase: 'result', toolUseId: safeName(block.tool_use_id), isError: block.is_error === true });
      }
    }
  }

  function handleResult(event, out) {
    state.sawResult = true;
    state.resultSubtype = safeName(event.subtype) || null;
    state.resultOk = event.subtype === 'success' && event.is_error !== true;
    state.resultText = clip(event.result, TEXT_MAX);
    if (typeof event.session_id === 'string' && !state.sessionId) state.sessionId = event.session_id;
    state.resultTokens = toTokens(event.usage);
    if (isRecord(event.modelUsage)) for (const model of Object.keys(event.modelUsage)) if (model) state.models.add(model);
    // total_cost_usd is deliberately ignored: subscription cost is not trustworthy per-run.
    for (const denial of Array.isArray(event.permission_denials) ? event.permission_denials : []) {
      const action = isRecord(denial) ? safeName(denial.tool_name) : '';
      if (action) { state.denials.push(action); out.push({ type: 'denied', action }); }
    }
  }

  return {
    /** Parse one stdout line into zero or more ungraded events. Never throws. */
    push(line) {
      const out = [];
      let event;
      try { event = JSON.parse(line); } catch { event = undefined; }
      if (!isRecord(event)) {
        state.malformed += 1;
        if (state.malformed <= MAX_REPORTED_MALFORMED) out.push({ type: 'error', code: 'MALFORMED_EVENT', message: 'Runtime emitted a line that is not a JSON object.' });
        return out;
      }
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') handleInit(event, out);
          else out.push({ type: 'raw', eventType: `system:${safeName(event.subtype)}` });
          break;
        case 'assistant': handleAssistant(event, out); break;
        case 'user': handleUser(event, out); break;
        case 'result': handleResult(event, out); break;
        default: {
          const name = safeName(event.type) || '(none)';
          state.unknownTypes.add(name);
          out.push({ type: 'raw', eventType: name }); // content intentionally dropped
        }
      }
      return out;
    },

    get policyViolation() { return state.policyViolation; },

    /** Summary after the process has exited. Usage is OBSERVED only if the runtime reported it. */
    finish() {
      const models = [...state.models];
      const sums = state.resultTokens ?? (state.messageTokens.size > 0 ? sumTokens([...state.messageTokens.values()]) : null);
      return {
        sawInit: state.sawInit,
        sessionId: state.sessionId,
        sawResult: state.sawResult,
        resultOk: state.resultOk,
        resultSubtype: state.resultSubtype,
        resultText: state.resultText,
        actualModel: models.length === 0 ? UNKNOWN_MODEL : models.join(','),
        toolPolicyObserved: state.initTools !== null,
        permissionMode: state.permissionMode,
        denials: [...state.denials],
        malformedLines: state.malformed,
        unknownEventTypes: [...state.unknownTypes],
        usage: sums ? { tokens: sums, costUsd: null, grade: 'OBSERVED' } : { tokens: null, costUsd: null, grade: 'UNAVAILABLE' },
      };
    },
  };
}
