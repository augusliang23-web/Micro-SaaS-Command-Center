import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/opt/cc-verifier/deps/package.json');
const root = '/opt/cc-verifier/deps/node_modules/';
for (const tool of ['vitest/vitest.mjs', 'typescript/bin/tsc', 'vite/bin/vite.js', 'esbuild/bin/esbuild'])
    if (!fs.statSync(root + tool).isFile())
        throw new Error(`Missing tool: ${tool}`);
const esbuild = require('esbuild');
if (!esbuild.transformSync('const synthetic = 1', { loader: 'js' }).code.includes('synthetic'))
    throw new Error('esbuild capability failure');
require('rollup');
const oxide = require('@tailwindcss/oxide');
new oxide.Scanner({ sources: [] });
const css = require('lightningcss');
if (!css.transform({ filename: 'synthetic.css', code: Buffer.from('a { color: red }') }).code.length)
    throw new Error('Lightning CSS capability failure');
console.log(JSON.stringify({ node: process.version, npm: require('/usr/local/lib/node_modules/npm/package.json').version, platform: process.platform, arch: process.arch, entrypoints: true, esbuild: esbuild.version, rollupNative: true, tailwindOxide: true, lightningCss: true, lifecycleScripts: 'ignored', projectCommandsRun: false }));
