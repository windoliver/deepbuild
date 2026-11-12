// The logic module's metering benchmark (#546; canvas primitives: Logic: work across steps): ns per fuel unit in the
// app (wasmtime) and in headless Chrome's own WebAssembly engine, from the benchmark program and its one-iteration
// twin. node benchmarks/logic.mjs [--write]; --write on a reference Mac makes the readings the logic module's step
// ceilings (crates/deep-logic/metering.json).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../scripts/benchmark.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const RECORD = join(root, 'crates', 'deep-logic', 'metering.json');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNS = 5;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function logic(lines) {
  const out = spawnSync(join(root, 'target', 'release', 'deep-logic'), [], { input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (out.status !== 0) throw Error(`deep-logic exited ${out.status}: ${out.stderr}`);
  return out.stdout.trim().split('\n').map((line) => JSON.parse(line));
}

// The page times the web runner's bake of the benchmark and of its twin, a warm-up pair first.
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
const post = (body) => fetch('/results', { method: 'POST', body: JSON.stringify(body) });
try {
  const runner = await import('/runner.mjs');
  const { bench, twin, runs } = await (await fetch('/requests.json')).json();
  const time = async (req) => { const t = performance.now(); const r = await runner.bake(req); return [performance.now() - t, r]; };
  for (let i = 0; i < 2; i++) { await time(bench); await time(twin); }
  const out = [];
  for (let i = 0; i < runs; i++) { const [b, rb] = await time(bench); const [w, rw] = await time(twin); out.push({ bench: b, twin: w, fuel: [rb.steps[0], rw.steps[0]] }); }
  await post({ userAgent: navigator.userAgent, runs: out });
} catch (e) { await post({ error: String((e && e.stack) || e) }); }
</script>`;

async function inChrome(source, requests) {
  if (!existsSync(CHROME)) throw Error(`no Chrome at ${CHROME} (set CHROME_BIN)`);
  const profile = mkdtempSync(join(tmpdir(), 'deep-metering-chrome-'));
  let settle;
  const posted = new Promise((res) => { settle = res; });
  const server = createServer((req, res) => {
    if (req.method === 'POST') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { res.end('ok'); settle(JSON.parse(body)); }); return; }
    const send = (type, text) => { res.writeHead(200, { 'content-type': type }); res.end(text); };
    if (req.url === '/') send('text/html', PAGE);
    else if (req.url === '/runner.mjs') send('text/javascript', source);
    else if (req.url === '/requests.json') send('application/json', JSON.stringify(requests));
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`], { detached: true, stdio: 'ignore' });
  try {
    const out = await posted;
    if (out.error) throw Error(`the page failed: ${out.error}`);
    return out;
  } finally {
    // Chrome and its helpers are this script's own process group: stopped by its PID.
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ }
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

const build = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'deep-logic', '--bin', 'deep-logic'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) throw Error('cargo build failed');
const [about, { source }, ...readings] = logic([{ call: 'about' }, { call: 'web_runner' }, ...Array.from({ length: RUNS + 1 }, () => ({ call: 'metering' }))]);
if (readings.some((r) => !r.ok)) throw Error(`metering answered ${JSON.stringify(readings.find((r) => !r.ok))}`);
const { fuel, steps, web } = readings[0];
const app = readings.slice(1).map((r) => r.app.ns_per_fuel);
const page = await inChrome(source, { bench: web.bench, twin: web.twin, runs: RUNS });
const fuelOf = (step) => Object.values(step.items)[0].fuel;
for (const run of page.runs) {
  const seen = run.fuel.map(fuelOf);
  if (seen[0] !== fuel[0] || seen[1] !== fuel[1]) throw Error(`the web runner's fuel ${seen} isn't the app's ${fuel}`);
}
const webRuns = page.runs.map((r) => ((r.bench - r.twin) * 1e6) / (steps * (fuel[0] - fuel[1])));
const round = (x) => Math.round(x * 1000) / 1000;
const machine = fingerprint();
const record = {
  fingerprint: machine,
  build: { profile: 'release', toolchain: spawnSync('rustc', ['-V'], { encoding: 'utf8' }).stdout.trim() },
  engines: { app: `${about.engine.name} ${about.engine.version}`, web: page.userAgent },
  fuel: { bench: fuel[0], twin: fuel[1] },
  steps,
  runs: { app, web: webRuns },
  // The app's fixed cost of a step (#532): an empty step at 1, 100 and 1,000 items, the median run's.
  fixed: readings.slice(1).map((r) => r.app.fixed).sort((a, b) => a.per_item_ns - b.per_item_ns)[Math.floor(RUNS / 2)],
  ns_per_fuel: { app: round(median(app)), web: round(median(webRuns)) },
};
console.log(JSON.stringify(record, null, 2));
if (process.argv.includes('--write')) {
  if (!['Mac15,7', 'Mac15,12', 'Mac17,10'].includes(machine.model)) throw Error(`the readings come from a reference Mac; this is ${machine.model}`);
  writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`wrote ${RECORD}`);
}
