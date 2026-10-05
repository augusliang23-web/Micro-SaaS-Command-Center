import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blocked = (code, message) => Object.assign(new Error(message), { code });
const safeRelative = value => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split('/').some(p => !p || p === '.' || p === '..') && !/[\0\r\n\\]/.test(value);
// Hash the completed copy, not a pre-copy source inventory. No symlinks or special nodes are allowed.
export function fingerprintSnapshot(root) {
    const entries = [];
    let bytes = 0;
    const walk = (dir, rel = '') => {
        for (const name of fs.readdirSync(dir).sort()) {
            const relative = rel ? `${rel}/${name}` : name;
            if (!safeRelative(relative))
                throw blocked('SNAPSHOT_UNSAFE', 'Unsafe snapshot name');
            const full = path.join(dir, name), stat = fs.lstatSync(full);
            if (entries.length >= 50000)
                throw blocked('SNAPSHOT_LIMIT', 'Too many snapshot entries');
            if (stat.isDirectory()) {
                entries.push({ path: relative, type: 'dir', mode: stat.mode & 0o777, size: 0, digest: null });
                walk(full, relative);
            }
            else {
                if (!stat.isFile() || stat.nlink !== 1)
                    throw blocked('SNAPSHOT_UNSAFE', `Snapshot must contain independent ordinary files: ${relative} (type=${stat.mode}, nlink=${stat.nlink})`);
                const fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                try {
                    const observed = fs.fstatSync(fd);
                    if (!observed.isFile() || observed.nlink !== 1 || observed.ino !== stat.ino || observed.dev !== stat.dev || observed.size > 8 * 1024 * 1024 || bytes + observed.size > 64 * 1024 * 1024)
                        throw blocked('SNAPSHOT_UNSAFE', 'Snapshot changed or exceeded bounds');
                    const content = fs.readFileSync(fd);
                    bytes += content.length;
                    entries.push({ path: relative, type: 'file', mode: observed.mode & 0o777, size: content.length, digest: digest(content) });
                }
                finally {
                    fs.closeSync(fd);
                }
            }
        }
    };
    walk(root);
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return Object.freeze({ fingerprint: digest(JSON.stringify(entries)), entries: Object.freeze(entries.map(Object.freeze)), bytes });
}
