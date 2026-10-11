import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { ACTIVE_TASK_STATUSES, TASK_ID_PATTERN, validateDevelopmentTask } from './types.mjs';
import { assertTaskTransition } from './stateTransitions.mjs';

// One JSON file per task: <dir>/<taskId>.json. Writes are atomic
// (temp file -> fsync -> rename). <taskId>.events.jsonl is reserved for a later
// phase and is not read or written here.

export class TaskStore {
  #dir;
  #fs;
  #now;

  /**
   * Opening a store is the "process start" moment: any task persisted in an
   * active state is rewritten as UNKNOWN, because nothing on disk can prove the
   * old execution still exists. Use one store per process.
   */
  constructor({ dir, fsImpl = fs, now = () => new Date().toISOString() }) {
    this.#dir = dir;
    this.#fs = fsImpl;
    this.#now = now;
    this.#fs.mkdirSync(dir, { recursive: true });
    this.recoveredTaskIds = this.#recoverActiveTasks();
  }

  #file(taskId) {
    if (!TASK_ID_PATTERN.test(taskId)) throw new Error('Invalid taskId');
    return path.join(this.#dir, `${taskId}.json`);
  }

  #write(task) {
    const problems = validateDevelopmentTask(task);
    if (problems.length > 0) throw new Error(`Refusing to persist an invalid task: ${problems.join('; ')}`);
    const target = this.#file(task.taskId);
    const temp = `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    let fd;
    try {
      fd = this.#fs.openSync(temp, 'wx', 0o600);
      const payload = Buffer.from(JSON.stringify(task, null, 2), 'utf8');
      let offset = 0;
      while (offset < payload.length) {
        const remaining = payload.length - offset;
        const written = this.#fs.writeSync(fd, payload, offset, remaining);
        if (!Number.isInteger(written) || written <= 0 || written > remaining) {
          throw new Error('Task write did not make valid progress');
        }
        offset += written;
      }
      this.#fs.fsyncSync(fd);
      this.#fs.closeSync(fd);
      fd = undefined;
      this.#fs.renameSync(temp, target);
    } catch (error) {
      if (fd !== undefined) {
        try { this.#fs.closeSync(fd); } catch { /* already failing */ }
      }
      try { this.#fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
      throw error;
    }
    try {
      const dirFd = this.#fs.openSync(this.#dir, 'r');
      try { this.#fs.fsyncSync(dirFd); } finally { this.#fs.closeSync(dirFd); }
    } catch { /* directory fsync is best effort */ }
  }

  #read(taskId) {
    const file = this.#file(taskId);
    if (!this.#fs.existsSync(file)) return null;
    const task = JSON.parse(this.#fs.readFileSync(file, 'utf8'));
    const problems = validateDevelopmentTask(task);
    if (problems.length > 0 || task.taskId !== taskId) {
      throw new Error(`Stored task ${taskId} is invalid: ${problems.join('; ') || 'taskId mismatch'}`);
    }
    return task;
  }

  #recoverActiveTasks() {
    const recovered = [];
    for (const name of this.#fs.readdirSync(this.#dir)) {
      const match = /^(CC-\d{8}-[0-9a-f]{8})\.json$/.exec(name);
      if (!match) continue;
      let task;
      try {
        task = this.#read(match[1]);
      } catch {
        continue; // surfaced by list() as unreadable; never "fixed" silently
      }
      if (task && ACTIVE_TASK_STATUSES.includes(task.status)) {
        this.#write({ ...task, status: 'UNKNOWN', updatedAt: this.#now() });
        recovered.push(task.taskId);
      }
    }
    return recovered;
  }

  /** Persist a new task. Throws if the id already exists. */
  create(task) {
    if (this.#fs.existsSync(this.#file(task.taskId))) throw new Error(`Task ${task.taskId} already exists`);
    this.#write(task);
    return task;
  }

  get(taskId) {
    return this.#read(taskId);
  }

  /** Controlled execution updates; task identity, request policy and review are immutable. */
  update(taskId, patch) {
    const allowed = ['status', 'baseSha', 'updatedAt', 'startedAt', 'completedAt', 'runIds', 'commitSha', 'pr'];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !allowed.includes(key))) {
      throw new Error('Invalid or immutable task update field');
    }
    const current = this.#read(taskId);
    if (!current) throw new Error('Task not found');
    const next = { ...current, ...patch, updatedAt: patch.updatedAt ?? this.#now() };
    assertTaskTransition(current.status, next.status);
    // A1-0: a publishing task is never COMPLETED on a status change alone; it must carry the commit and a verified PR record.
    // (The authoritative evidence check belongs to the later continuation phase; this only refuses the bare transition.)
    if (current.status === 'PUBLISHING' && next.status === 'COMPLETED' && !(typeof next.commitSha === 'string' && next.pr && typeof next.pr.verifiedAt === 'string')) {
      throw new Error('A PUBLISHING task cannot complete without a commit and a verified PR record');
    }
    this.#write(next);
    return this.#read(taskId);
  }

  /** Newest first. Unreadable/invalid files are reported, not hidden and not repaired. */
  list() {
    const tasks = [];
    const unreadable = [];
    for (const name of this.#fs.readdirSync(this.#dir)) {
      const match = /^(CC-\d{8}-[0-9a-f]{8})\.json$/.exec(name);
      if (!match) continue;
      try {
        tasks.push(this.#read(match[1]));
      } catch {
        unreadable.push(name);
      }
    }
    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.taskId.localeCompare(a.taskId));
    return { tasks, unreadable };
  }
}
