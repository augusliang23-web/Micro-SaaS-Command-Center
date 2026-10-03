import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from './processRunner.mjs';
import { requireAction, BoundaryError } from './executionPolicy.mjs';

/** Only actual orchestrator command evidence may support a PASS. Empty is unknown. */
export function verificationPassed(records) {
  if (records.length === 0) return null;
  return records.every(e => e.kind === 'command_result' && e.grade === 'LOCALLY_VERIFIED' && e.data.exitCode === 0);
}
export async function runVerification({ task, project, worktreePath, record, timeoutMs = 30_000 }) {
  const results = [];
  for (const [kind, action] of [['test','RUN_TESTS'],['lint','RUN_LINT'],['build','RUN_BUILD']]) {
    if (!task.allowedActions.includes(action)) continue;
    requireAction(task,project,action);
    const spec = project.verifyCommands[kind];
    if (!spec || typeof spec !== 'object' || typeof spec.command !== 'string' || !Array.isArray(spec.args)) throw new BoundaryError(`Missing structured ${kind} command`);
    let args = [...spec.args], configDir;
    try {
      if (path.basename(spec.command) === 'npm') {
        const badNames = Object.keys(process.env).filter(k => k.toLowerCase().startsWith('npm_config_') || ['NPM_TOKEN','NODE_AUTH_TOKEN','NPM_AUTH_TOKEN'].includes(k));
        if (badNames.length || fs.existsSync(path.join(worktreePath,'.npmrc'))) throw new BoundaryError('Untrusted npm configuration; refusing verification');
        configDir = fs.mkdtempSync(path.join(os.tmpdir(),'cc-verification-npm-'));
        for (const name of ['user.conf','global.conf']) fs.writeFileSync(path.join(configDir,name),'', { mode: 0o600 });
        args = [`--userconfig=${path.join(configDir,'user.conf')}`,`--globalconfig=${path.join(configDir,'global.conf')}`,...args];
      }
      const result = await runProcess({ command: spec.command, args, cwd: worktreePath, timeoutMs });
      const evidence = record('command_result','LOCALLY_VERIFIED',{ ...result, verification: kind });
      results.push(evidence);
      if (result.exitCode === null) throw new Error(`Verification ${kind} terminated without an exit code`);
    } finally { if (configDir) fs.rmSync(configDir,{recursive:true,force:true}); }
  }
  return { results, passed: verificationPassed(results) };
}
