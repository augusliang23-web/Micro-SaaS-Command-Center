import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { TASK_ID_PATTERN, RUN_ID_PATTERN, validateAgentRun, validateEvidence } from './types.mjs';

// Evidence is logically append-only. Atomically replace the JSONL snapshot when
// appending so a short/failed write never corrupts the existing evidence tail.
export class ExecutionStore {
  #dir; #fs; #now;
  constructor({ dir, fsImpl = fs, now = () => new Date().toISOString() }) {
    this.#dir = dir; this.#fs = fsImpl; this.#now = now;
    fsImpl.mkdirSync(dir, { recursive: true });
    for (const file of fsImpl.readdirSync(dir)) {
      if (!/^RUN-\d{8}-[0-9a-f]{8}\.json$/.test(file)) continue;
      const run = this.getRun(file.slice(0, -5));
      if (['STARTING', 'RUNNING'].includes(run.status)) this.saveRun({ ...run, status: 'UNKNOWN' });
    }
  }
  #file(id, type) {
    const pattern = type === 'run' ? RUN_ID_PATTERN : TASK_ID_PATTERN;
    if (typeof id !== 'string' || !pattern.test(id)) throw new Error(`Invalid ${type === 'run' ? 'runId' : 'taskId'}`);
    return path.join(this.#dir, type === 'run' ? `${id}.json` : `${id}.events.jsonl`);
  }
  #write(file, text) {
    const temp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    let fd;
    try {
      fd = this.#fs.openSync(temp, 'wx', 0o600);
      const bytes = Buffer.from(text, 'utf8'); let offset = 0;
      while (offset < bytes.length) {
        const count = this.#fs.writeSync(fd, bytes, offset, bytes.length - offset);
        if (!Number.isInteger(count) || count <= 0 || count > bytes.length - offset) throw new Error('Execution record write made invalid progress');
        offset += count;
      }
      this.#fs.fsyncSync(fd); this.#fs.closeSync(fd); fd = undefined;
      this.#fs.renameSync(temp, file);
    } catch (error) {
      if (fd !== undefined) try { this.#fs.closeSync(fd); } catch { /* best effort */ }
      try { this.#fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
      throw error;
    }
    let dirFd;
    try { dirFd = this.#fs.openSync(this.#dir, 'r'); this.#fs.fsyncSync(dirFd); }
    catch { /* directory fsync is best effort */ }
    finally { if (dirFd !== undefined) this.#fs.closeSync(dirFd); }
  }
  saveRun(run) {
    const problems = validateAgentRun(run);
    if (problems.length) throw new Error(`Invalid run: ${problems.join('; ')}`);
    const old = this.getRun(run.runId);
    if (old && (old.taskId !== run.taskId || old.agent !== run.agent)) throw new Error('Immutable run association');
    this.#write(this.#file(run.runId, 'run'), JSON.stringify(run, null, 2));
    return this.getRun(run.runId);
  }
  getRun(runId) {
    const file = this.#file(runId, 'run'); if (!this.#fs.existsSync(file)) return null;
    const run = JSON.parse(this.#fs.readFileSync(file, 'utf8'));
    if (run.runId !== runId || validateAgentRun(run).length) throw new Error('Invalid stored run');
    return run;
  }
  appendEvidence(record) {
    const problems = validateEvidence(record);
    if (problems.length) throw new Error(`Invalid evidence: ${problems.join('; ')}`);
    if (record.runId && this.getRun(record.runId)?.taskId !== record.taskId) throw new Error('Invalid evidence run/task association');
    const records = this.listEvidence(record.taskId);
    if (records.some(e => e.evidenceId === record.evidenceId)) throw new Error('Duplicate evidenceId');
    this.#write(this.#file(record.taskId, 'evidence'), [...records, record].map(e => JSON.stringify(e)).join('\n') + '\n');
    return record;
  }
  listEvidence(taskId) {
    const file = this.#file(taskId, 'evidence'); if (!this.#fs.existsSync(file)) return [];
    const text = this.#fs.readFileSync(file, 'utf8');
    if (text && !text.endsWith('\n')) throw new Error('Invalid evidence log tail');
    const records = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const ids = new Set();
    for (const e of records) {
      if (e.taskId !== taskId || validateEvidence(e).length || ids.has(e.evidenceId)) throw new Error('Invalid stored evidence');
      ids.add(e.evidenceId);
    }
    return records;
  }
}
