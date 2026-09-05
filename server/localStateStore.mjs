import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'app-state.json');

export function isValidState(state) {
  return (
    !!state &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    Array.isArray(state.projects) &&
    Array.isArray(state.attentionItems) &&
    typeof state.nba === 'object' &&
    state.nba !== null &&
    typeof state.snapshot === 'object' &&
    state.snapshot !== null
  );
}

export function readState(filePath = STATE_FILE) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeState(state, filePath = STATE_FILE) {
  if (!isValidState(state)) {
    throw new Error('Rejected state write: expected { projects: [], attentionItems: [], nba: {}, snapshot: {} }');
  }
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}
