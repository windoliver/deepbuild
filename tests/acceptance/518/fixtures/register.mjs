// Runs a test plug-in's own code against a recording `deep` and prints what it registered, one JSON array of
// {method, args} (#518 acceptance; helpers.ts `jobTool`). The scenario's `job_tools` entry is read from this, so the
// tool an export runs is the one the plug-in hands deep.registerJobTool, never a second description of it.
//   node register.mjs <the plug-in's folder>
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.argv[2];
if (!dir) throw Error('usage: node register.mjs <the plug-in\'s folder>');
const calls = [];
const deep = new Proxy({}, {
  get: (_target, method) => (typeof method === 'string' && method !== 'then' ? async (...args) => { calls.push({ method, args }); } : undefined),
});
const plugin = await import(pathToFileURL(join(dir, 'index.ts')).href);
await plugin.default(deep);
process.stdout.write(`${JSON.stringify(calls)}\n`);
