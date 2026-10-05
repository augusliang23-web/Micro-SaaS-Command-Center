import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const VOLATILE = new Set(['node_modules', 'dist', 'coverage', '.vite', '.vitest', '.cache', '.turbo']);

function identity(target) {
  let first;
  try { first = fs.lstatSync(target); }
  catch (error) {
    if (error.code === 'ENOENT') return { path: path.resolve(target), fingerprint: hash('ABSENT'), entries: 0, state: 'ABSENT' };
    throw error;
  }
  if (first.isSymbolicLink()) {
    const value = fs.readlinkSync(target);
    return { path: path.resolve(target), fingerprint: hash(`SYMLINK\0${value}`), entries: 1, state: 'PRESENT' };
  }
  const absolute = fs.realpathSync(target);
  const entries = [];
  const walk = (current, relative = '') => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      entries.push({ path: relative || '.', type: 'symlink', target: fs.readlinkSync(current) });
      return;
    }
    if (stat.isDirectory()) {
      entries.push({ path: relative || '.', type: 'directory', mode: stat.mode & 0o777 });
      for (const name of fs.readdirSync(current).sort()) {
        if (!relative && VOLATILE.has(name)) continue;
        walk(path.join(current, name), relative ? `${relative}/${name}` : name);
      }
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('HOST_INTEGRITY_UNSUPPORTED_NODE');
    const bytes = fs.readFileSync(current);
    entries.push({ path: relative || '.', type: 'file', mode: stat.mode & 0o777, size: bytes.length, sha256: hash(bytes) });
  };
  walk(absolute);
  return { path: absolute, fingerprint: hash(JSON.stringify(entries)), entries: entries.length };
}

/** Bounded path fingerprints only; this does not scan or attest the whole host. */
export class HostIntegrityGuard {
  #paths;
  constructor({ sourceRoot, protectedPaths = [], controllerVersion = 'verification-controller-v1' }) {
    const source = fs.realpathSync(sourceRoot);
    this.#paths = [...new Set([source, ...protectedPaths.map(p => {
      const resolved = path.resolve(source, p);
      try { return fs.realpathSync(resolved); } catch (error) { if (error.code === 'ENOENT') return resolved; throw error; }
    })])].sort();
    this.controllerVersion = controllerVersion;
  }
  capture() {
    const records = this.#paths.map(identity);
    return Object.freeze({ state: 'VERIFIED', controllerVersion: this.controllerVersion, capturedAt: new Date().toISOString(), paths: Object.freeze(records) });
  }
  compare(checkpoint) {
    try {
      const current = this.capture();
      const prior = checkpoint?.paths;
      if (!Array.isArray(prior) || prior.length !== current.paths.length) return { state: 'UNKNOWN', reason: 'CHECKPOINT_INCOMPLETE' };
      const same = current.paths.every((entry, index) => entry.path === prior[index]?.path && entry.fingerprint === prior[index]?.fingerprint && entry.entries === prior[index]?.entries);
      return { state: same ? 'UNCHANGED' : 'MISMATCH', before: prior.map(({ path: p, fingerprint, entries }) => ({ path: p, fingerprint, entries })), after: current.paths };
    } catch (error) { return { state: 'UNKNOWN', reason: error.code ?? error.message }; }
  }
}

export function gitMetadataPaths(sourceRoot) {
  const gitEntry = path.join(fs.realpathSync(sourceRoot), '.git');
  if (!fs.existsSync(gitEntry)) throw new Error('GIT_METADATA_UNAVAILABLE');
  const gitText = fs.readFileSync(gitEntry, 'utf8').trim();
  if (!gitText.startsWith('gitdir: ')) throw new Error('GIT_METADATA_UNSUPPORTED');
  const gitDir = path.resolve(sourceRoot, gitText.slice(8));
  const commonText = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
  const commonDir = path.resolve(gitDir, commonText);
  const branch = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim().replace(/^ref: refs\/heads\//, '');
  return [gitEntry, gitDir, path.join(commonDir, 'config'), path.join(commonDir, 'packed-refs'), path.join(commonDir, 'refs', 'heads', branch)].filter(p => fs.existsSync(p));
}
