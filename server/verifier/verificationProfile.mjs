// Provider-neutral, server-owned profile shared verbatim by the host and verifier image.
export const COMMAND_CENTER_V1_PROFILE = Object.freeze({
  id: 'command-center-v1',
  version: 1,
  commands: Object.freeze([
    Object.freeze({ id: 'ui', kind: 'test', tool: 'vitest/vitest.mjs', args: Object.freeze(['run']), nodeEnv: 'test' }),
    Object.freeze({ id: 'typecheck', kind: 'typecheck', tool: 'typescript/bin/tsc', args: Object.freeze(['--noEmit']), nodeEnv: 'test' }),
    Object.freeze({ id: 'vite-build', kind: 'build', tool: 'vite/bin/vite.js', args: Object.freeze(['build']), nodeEnv: 'production' }),
    Object.freeze({ id: 'server-build', kind: 'build', tool: 'esbuild/bin/esbuild', args: Object.freeze(['server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', '--sourcemap', '--outfile=dist/server.cjs']), nodeEnv: 'production' }),
  ]),
});
export const RUNNER_INTERNAL_ERROR_EXIT = 254;

export function resolveProfileCommand(profileId, commandId) {
  if (profileId !== COMMAND_CENTER_V1_PROFILE.id) throw new Error('INVALID_VERIFICATION_PROFILE');
  const profile = COMMAND_CENTER_V1_PROFILE.commands.find(command => command.id === commandId);
  if (!profile) throw new Error('INVALID_VERIFICATION_COMMAND');
  return Object.freeze({
    commandId: profile.id,
    kind: profile.kind,
    executable: '/usr/local/bin/node',
    args: Object.freeze([`/verify/workspace/node_modules/${profile.tool}`, ...profile.args]),
    cwd: '/verify/workspace',
    env: Object.freeze({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/verify/tmp', CI: '1', NODE_ENV: profile.nodeEnv }),
    network: 'NO_NETWORK',
    timeoutMs: 180000,
    outputLimits: Object.freeze({ stdoutBytes: 1048576, stderrBytes: 262144 }),
    resourceLimits: Object.freeze({ cpus: 2, memoryMb: 2048, pids: 256, tmpfsBytes: 1073741824 }),
  });
}
