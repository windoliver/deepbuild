// `deep env up` and `deep env down` for the perf lane's budgets (issue #331): node benchmarks/env.mjs up|down.
// It starts a dev hub on a temp folder, with HOME there too, and a folder whose .deepbuild/done.yaml names a small
// Node server as its stack; then times five `deep env up` runs against five bare starts of the same server until
// its health route answers, each up followed by a timed `deep env down`, and prints the medians as one JSON line:
// `up` the time up adds beyond the bare start, `down` the teardown. The issue's 1 s and 5 s limits stay in
// tests/acceptance/331/budgets.test.ts. It stops only the hub and servers it started, by PID.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'up' && mode !== 'down') throw Error('usage: node benchmarks/env.mjs up|down');
const CLI = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const ROUNDS = 5;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-env-bench-')));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))), HOME: dir, LC_ALL: 'C' };
const app = join(dir, 'app');
mkdirSync(join(app, '.deepbuild'), { recursive: true });
writeFileSync(join(app, 'server.mjs'), [
  "import { createServer } from 'node:http';",
  "createServer((q, s) => { s.writeHead(q.url === '/health' ? 200 : 404); s.end(); }).listen(Number(process.env.web), '127.0.0.1');",
  "process.on('SIGTERM', () => process.exit(0));",
  '',
].join('\n'));
writeFileSync(join(app, '.deepbuild', 'done.yaml'), `environment:\n  up: ${JSON.stringify(`${process.execPath} server.mjs`)}\n  ports: [web]\n  ready: { http: "http://127.0.0.1:\${web}/health", within: 20 }\n`);

const healthy = async (port) => { try { return (await fetch(`http://127.0.0.1:${port}/health`)).status === 200; } catch { return false; } };
/** The repo's own start: the server spawned bare until its health route answers, then stopped. */
async function bare(port) {
  const t0 = performance.now();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: app, env: { ...env, web: String(port) }, stdio: 'ignore' });
  while (!(await healthy(port))) await sleep(5);
  const took = performance.now() - t0;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('exit', resolve));
  return took;
}
const deep = (...args) => {
  const t0 = performance.now();
  const out = JSON.parse(execFileSync(process.execPath, [CLI, 'env', ...args, '--root', join(dir, 'hub'), '--json'], { cwd: app, env, encoding: 'utf8' }).trim().split('\n').pop());
  return { ms: performance.now() - t0, out };
};

const hub = spawn(process.execPath, [CLI, 'hub', 'run', '--root', join(dir, 'hub')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the dev hub did not start'))); });
  const ups = [];
  const bares = [];
  const downs = [];
  for (let i = 0; i <= ROUNDS; i++) {
    const up = deep('up');
    if (up.out.status !== 'ready') throw Error(`deep env up: ${JSON.stringify(up.out)}`);
    const down = deep('down');
    const port = up.out.ports.web;
    const b = await bare(port);
    // The first round warms the hub, the sandbox's denial stream and the file cache; it isn't counted.
    if (i > 0) { ups.push(up.ms); downs.push(down.ms); bares.push(b); }
  }
  console.log(JSON.stringify(mode === 'up' ? { upMs: median(ups), bareMs: median(bares), addedMs: median(ups) - median(bares) } : { downMs: median(downs) }));
} finally {
  hub.kill('SIGTERM');
  await new Promise((resolve) => (hub.exitCode !== null ? resolve() : hub.once('exit', resolve)));
  rmSync(dir, { recursive: true, force: true });
}
