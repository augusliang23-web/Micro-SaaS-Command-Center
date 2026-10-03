import fs from 'node:fs';
import path from 'node:path';
import { TASK_ID_PATTERN } from '../tasks/types.mjs';

/**
 * Internal adapter contract: id, probe(), start(RunSpec, emit) → {exitCode}.
 * RunSpec has taskId, canonical worktreePath and server-owned fixturePath.
 * Task/run/Git/verification/evidence ownership stays with the Orchestrator.
 */
export class FakeAdapter {
  id = 'fake';
  async probe() { return { id: this.id, available: true, version: 'fake-v1', capabilities: { editOnly: true, shell: false, git: false, network: false } }; }
  async start(spec, emit) {
    if (typeof spec.taskId !== 'string' || !TASK_ID_PATTERN.test(spec.taskId) || spec.fixturePath !== `agent-console-fixture/${spec.taskId}.txt`) throw new Error('Invalid server-owned fixture specification');
    const root = fs.realpathSync(spec.worktreePath);
    const directory = path.join(root, 'agent-console-fixture');
    try { if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Fixture directory must not be a symlink'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.mkdirSync(directory, { recursive: true });
    if (fs.realpathSync(directory) !== directory || fs.realpathSync(spec.worktreePath) !== root) throw new Error('Fixture path escaped worktree');
    emit({ type: 'started' });
    // Exclusive creation prevents following existing symlinks or hard links.
    fs.writeFileSync(path.join(root, spec.fixturePath), `Task ${spec.taskId}\nDeterministic Fake Adapter fixture\n`, { flag: 'wx', mode: 0o600 });
    emit({ type: 'files_changed', paths: [spec.fixturePath] });
    emit({ type: 'output', message: 'Fake edit complete; verification belongs to the orchestrator.' });
    emit({ type: 'finished', exitCode: 0 });
    return { exitCode: 0 };
  }
}
