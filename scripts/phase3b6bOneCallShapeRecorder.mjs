// Phase 3B6B.10B: RECORDING-ONLY stream-event shape fingerprints for the one-call smoke (offline).
//
// Purpose: if the first real call ends UNKNOWN because of an event kind we do not yet recognise, the sanitized evidence says exactly
// WHICH kind, WHERE in the lifecycle, and whether it carried security-relevant fields — without keeping any payload.
//
// This module has NO influence on admission: it returns nothing the verdict reads, never throws to its caller, and every value it emits
// comes from a closed vocabulary, a boolean, a bounded integer or a bucket label. It never stores raw lines, session ids, paths, prompt or
// model text, arbitrary key names or any value. An unknown kind stays UNKNOWN in the real observer; here it is merely labelled `OTHER`.

export const SHAPE_MAX_ENTRIES = 64;
export const SHAPE_MAX_LINE_BYTES = 1024 * 1024;
const TYPES = new Set(['system', 'assistant', 'user', 'result', 'rate_limit_event']);
const SUBTYPES = new Set(['init', 'status', 'compact_boundary', 'hook_started', 'hook_progress', 'hook_response', 'task_started', 'task_progress', 'task_updated',
  'task_notification', 'background_tasks_changed', 'commands_changed', 'session_state_changed', 'conversation_reset', 'informational', 'control_request_progress',
  'success', 'error_max_turns', 'error_during_execution']);
// Closed list of security-relevant FIELD NAMES whose mere presence is recorded (the names are ours; their values are never read into output).
const SENSITIVE_KEYS = Object.freeze({ tools: 'tools', mcp_servers: 'mcpServers', plugins: 'plugins', agents: 'agents', apiProvider: 'apiProvider', authMethod: 'authMethod',
  permissionMode: 'permissionMode', cwd: 'cwd', model: 'model', permission_denials: 'permissionDenials' });
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);

const sizeBucket = bytes => (bytes <= 256 ? '<=256' : bytes <= 1024 ? '<=1K' : bytes <= 4096 ? '<=4K' : bytes <= 65536 ? '<=64K' : bytes <= SHAPE_MAX_LINE_BYTES ? '<=1M' : 'OVERSIZE');
const keyBucket = n => (n === 0 ? '0' : n <= 4 ? '1-4' : n <= 8 ? '5-8' : n <= 16 ? '9-16' : '17+');
const emptySensitive = () => ({ tools: false, mcpServers: false, plugins: false, agents: false, apiProvider: false, authMethod: false, permissionMode: false, cwd: false,
  model: false, permissionDenials: false, toolUseBlock: false, toolResultBlock: false });

export function createShapeRecorder({ sessionId } = {}) {
  const entries = []; let overflow = 0; let ordinal = 0; let stage = 'BEFORE_INIT'; let failed = false;
  const expected = typeof sessionId === 'string' ? sessionId : null; // used for a boolean comparison only, never stored
  return {
    record(raw) {
      try {
        ordinal += 1;
        const bytes = typeof raw === 'string' ? Buffer.byteLength(raw) : 0;
        let entry = { ordinal, stage, type: 'MALFORMED', subtype: 'NONE', sessionMatch: null, sensitive: emptySensitive(), keyCountBucket: '0', sizeBucket: sizeBucket(bytes) };
        let event = null;
        if (typeof raw === 'string' && bytes <= SHAPE_MAX_LINE_BYTES) { try { event = JSON.parse(raw); } catch { event = null; } }
        if (isRecord(event)) {
          const type = typeof event.type === 'string' && TYPES.has(event.type) ? event.type : (typeof event.type === 'string' ? 'OTHER' : 'NONE');
          const subtype = typeof event.subtype === 'string' ? (SUBTYPES.has(event.subtype) ? event.subtype : 'OTHER') : 'NONE';
          const sensitive = emptySensitive();
          for (const [key, name] of Object.entries(SENSITIVE_KEYS)) sensitive[name] = Object.hasOwn(event, key);
          const content = isRecord(event.message) && Array.isArray(event.message.content) ? event.message.content : [];
          sensitive.toolUseBlock = content.some(b => isRecord(b) && b.type === 'tool_use');
          sensitive.toolResultBlock = content.some(b => isRecord(b) && b.type === 'tool_result');
          const sessionMatch = Object.hasOwn(event, 'session_id') ? (expected !== null && event.session_id === expected) : null;
          if (type === 'system' && subtype === 'init' && stage === 'BEFORE_INIT') entry.stage = 'INIT';
          entry = { ...entry, type, subtype, sessionMatch, sensitive, keyCountBucket: keyBucket(Object.keys(event).length) };
        }
        // Stage transitions are the recorder's own bookkeeping and never feed the observer.
        if (entry.type === 'system' && entry.subtype === 'init' && stage === 'BEFORE_INIT') stage = 'ACTIVE';
        else if (entry.type === 'result' && stage !== 'BEFORE_INIT') stage = 'AFTER_RESULT';
        if (entries.length < SHAPE_MAX_ENTRIES) entries.push(entry); else overflow = Math.min(overflow + 1, 1_000_000);
      } catch { failed = true; }
    },
    snapshot() {
      return { schema: 1, recorder: failed ? 'FAILED' : 'OK', admissionEffect: 'NONE', count: entries.length, overflow, entries: structuredClone(entries) };
    },
  };
}

/** Safe wrapper for callers: a broken recorder can never alter or abort the run it observes. */
export function safeSnapshot(recorder) {
  try {
    const snap = recorder?.snapshot?.();
    return isRecord(snap) ? snap : { schema: 1, recorder: 'FAILED', admissionEffect: 'NONE', count: 0, overflow: 0, entries: [] };
  } catch { return { schema: 1, recorder: 'FAILED', admissionEffect: 'NONE', count: 0, overflow: 0, entries: [] }; }
}
