import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { REQUIRED_CLAUDE_FLAGS } from '../../server/execution/claudeCliAdapter.mjs';

// A fake `claude` executable (POSIX sh). It makes NO provider call: it answers
// --version/--help/auth status from embedded text, and in run mode it records
// what it was given (argv, environment, cwd, stdin) into its cwd, then replays
// `behavior.sh` / `events.ndjson` that the test placed there.

export const HELP_OK = ['Usage: claude [options]', ...REQUIRED_CLAUDE_FLAGS].join('\n');
export const AUTH_OK = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro' });

export function realTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function makeBinary(dir, { version = '2.1.260 (Claude Code)', help = HELP_OK, auth = AUTH_OK, versionExit = 0, mode = 0o755 } = {}) {
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, `#!/bin/sh
case "$1" in
  --version) cat <<'EOF_V'
${version}
EOF_V
    exit ${versionExit};;
  --help) cat <<'EOF_H'
${help}
EOF_H
    exit 0;;
  auth) cat <<'EOF_A'
${auth}
EOF_A
    exit 0;;
esac
printf '%s\\n' "$@" > "$PWD/captured-args.txt"
env | sort > "$PWD/captured-env.txt"
pwd -P > "$PWD/captured-cwd.txt"
cat > "$PWD/captured-stdin.txt"
if [ -f "$PWD/behavior.sh" ]; then . "$PWD/behavior.sh"; elif [ -f "$PWD/events.ndjson" ]; then cat "$PWD/events.ndjson"; fi
`, { mode });
  fs.chmodSync(file, mode);
  return file;
}

export const SESSION = '0b7e2a54-9d3c-4f1e-8a61-5c2d9e7f1a30';
export const init = (extra = {}) => ({ type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-sonnet-4-5-20260101', tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'], permissionMode: 'acceptEdits', ...extra });
export const assistant = (content, extra = {}) => ({ type: 'assistant', message: { id: 'msg_1', model: 'claude-sonnet-4-5-20260101', content, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }, ...extra } });
export const text = (value) => ({ type: 'text', text: value });
export const toolUse = (name, id = 'toolu_1') => ({ type: 'tool_use', id, name, input: { file_path: 'a.txt' } });
export const toolResult = (id = 'toolu_1', isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'ok' }] } });
export const result = (extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: SESSION, total_cost_usd: 0.42, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 }, ...extra });

export const normalStream = () => [init(), assistant([text('Editing a.txt'), toolUse('Edit')]), toolResult(), result()];

/** Prepare a scratch worktree with a behavior. `lines` become events.ndjson; `script` overrides with shell. */
export function prepareWorktree(root, { lines, script, name = 'wt' } = {}) {
  const cwd = path.join(root, name);
  fs.mkdirSync(cwd, { recursive: true });
  if (lines) fs.writeFileSync(path.join(cwd, 'events.ndjson'), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  if (script) fs.writeFileSync(path.join(cwd, 'behavior.sh'), script);
  return cwd;
}

export const RUN_ID = 'RUN-20261003-aaaaaaaa';
export const TASK_ID = 'CC-20261003-12345678';
export const spec = (worktreePath, extra = {}) => ({ runId: RUN_ID, taskId: TASK_ID, worktreePath, prompt: 'Edit a.txt: add a line.', executionProfile: 'STANDARD', ...extra });

export const sourceEnv = (extra = {}) => ({ HOME: os.homedir(), USER: 'tester', LOGNAME: 'tester', TMPDIR: '/tmp/', LANG: 'en_US.UTF-8', PATH: '/opt/homebrew/bin:/usr/local/bin', ...extra });
