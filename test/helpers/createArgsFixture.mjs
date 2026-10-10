import path from 'node:path';
import { OwnedDocker } from './ownedDocker.mjs';
import { EffectDocker } from './dockerPathFixture.mjs';
import { LIMITS, PINNED_REF } from './realDockerScenarios.mjs';
import { buildCreateArgs, parseSandboxPolicy } from '../../server/sandbox/sandboxPolicy.mjs';
import { FAKE_AGENT_IMAGES, FAKE_AGENT_IMAGE_ALIAS } from '../../server/sandbox/fakeAgentImages.mjs';

/** A valid, production-built `docker create` argv plus the wrapper that must accept it (no Docker contact; paths are strings only). */
export function createFixture({ command = ['/bin/true'], stateRoot = '/private/tmp/cc-p3b7b2-fixture-state', workspacePath = '/private/tmp/cc-p3b7b2-fixture-ws' } = {}) {
  const inner = new EffectDocker();
  const owned = new OwnedDocker({ inner, imageRef: PINNED_REF, stateRoot });
  const sandboxId = owned.reserveSandbox('p3b7b2-abc123');
  const workspace = owned.registerWorkspace(workspacePath);
  const name = `cc-sandbox-agent-${sandboxId.toLowerCase()}`;
  const uid = process.getuid(); const gid = process.getgid();
  const policy = parseSandboxPolicy({ network: 'NO_NETWORK', image: FAKE_AGENT_IMAGE_ALIAS, writablePaths: ['/workspace', '/tmp'], ...LIMITS }, { images: FAKE_AGENT_IMAGES, role: 'agent' });
  const args = buildCreateArgs({
    name, sandboxId, role: 'agent', policy, image: FAKE_AGENT_IMAGES[FAKE_AGENT_IMAGE_ALIAS], workspacePath: workspace,
    gitMask: { kind: 'file', emptyFile: path.join(stateRoot, name, 'empty') }, user: `${uid}:${gid}`, command,
  });
  const ctx = { imageRef: PINNED_REF, reservedNames: owned.reservedNames, workspaces: owned.workspaces, stateRoot, uid, gid };
  return { owned, inner, args, ctx, name, sandboxId, workspace, stateRoot, uid, gid, imageIndex: args.indexOf(PINNED_REF) };
}
