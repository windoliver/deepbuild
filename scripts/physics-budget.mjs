// The physics module's step budget on each host a piece ships to (issue #2011; canvas primitives: World and backend,
// `budget.step_p95`): the app, the physics crate's native release build stepped by `deep-physics`; and the web, the same
// crate's release build for wasm32-unknown-unknown stepped in headless Chrome. Each host with a reference Mac configured
// takes one untimed warm-up run and five timed runs, each building the world anew and timing every step on the host's
// own clock; a run's reading is its steps' 95th percentile, judged by the reference-Mac rule (scripts/benchmark.mjs
// judgeLimit). A host with no reference Mac configured, or without its engine, is BLOCKED with one unblock ask and never
// timed. The surface is tests/acceptance/2011/README.md's.
//
// Usage: node scripts/physics-budget.mjs [--planted times_only_app] < {"world", "steps", "reference_mac": {"app", "web"}}
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, judgeLimit } from './benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const WASM32 = 'wasm32-unknown-unknown';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNS = 5;

const badInput = () => { process.stdout.write(`${JSON.stringify({ ok: false, code: 'bad_input' })}\n`); process.exit(2); };
const args = process.argv.slice(2);
const planted = args.length === 2 && args[0] === '--planted' && args[1] === 'times_only_app';
if (args.length && !planted) badInput();
let request;
try { request = JSON.parse(readFileSync(0, 'utf8')); } catch { badInput(); }
const { world, steps, reference_mac: reference } = request ?? {};
if (typeof world !== 'object' || world === null || !Number.isSafeInteger(steps) || steps < 1
  || typeof reference?.app !== 'boolean' || typeof reference?.web !== 'boolean') badInput();

const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0' };
// The builds' flags are the checkout's cargo configuration alone, never the caller's shell's.
for (const k of Object.keys(env)) if (/^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS)$/.test(k)) delete env[k];
const cargo = (cargoArgs) => {
  const r = spawnSync('cargo', cargoArgs, { cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    process.stderr.write(`cargo ${cargoArgs.join(' ')} failed:\n${(r.error?.message ?? r.stderr).slice(-4000)}\n`);
    process.exit(1);
  }
};

// The app's release build answers deep-physics calls, one process a call.
cargo(['build', '--release', '--locked', '--bin', 'deep-physics']);
const physics = join(target, 'release', 'deep-physics');
const call = (c) => {
  const r = spawnSync(physics, [], { input: `${JSON.stringify(c)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) { process.stderr.write(`deep-physics failed: ${r.stderr}\n`); process.exit(1); }
  return JSON.parse(r.stdout);
};
const checked = call({ call: 'check', world });
if (checked.issues?.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, issues: checked.issues })}\n`);
  process.exit(0);
}
const limit = world.budget?.step_p95 ?? 2;

/** The nearest-rank 95th percentile of `ms`. */
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.ceil(0.95 * ms.length) - 1];

/** A timed host from its five runs, each `{ms, top}` with its `load`: its verdict, slowest step and what a FAIL names. */
function judged(host, targetTriple, engine, timed) {
  const runs = timed.map((r) => p95(r.ms));
  const loads = timed.map((r) => r.load);
  let slowest = null;
  timed.forEach((r, i) => r.ms.forEach((ms, k) => {
    if (!slowest || ms > slowest.ms) slowest = { run: i + 1, step: k + 1, ms, pair: r.top[k]?.pair ?? null, tests: r.top[k]?.tests ?? 0 };
  }));
  const judge = judgeLimit({ limit, runs, fingerprint: fingerprint(), loads });
  const name = (u) => `${u.body}/shapes/${u.index} (${u.shape})`;
  const what = judge.status !== 'FAIL' ? null
    : `${host}: step_p95 is over ${limit} ms in all five runs (${runs.map((r) => r.toFixed(3)).join(', ')} ms); its slowest step, step ${slowest.step} of run ${slowest.run} at ${slowest.ms.toFixed(3)} ms, ran the most narrow-phase tests (${slowest.tests}) between ${slowest.pair ? slowest.pair.map(name).join(' and ') : 'no pair'}`;
  return { verdict: judge.status, target: targetTriple, engine, profile: 'release', runs, loads, slowest, reason: judge.reason ?? null, what };
}

const blocked = (what) => ({ verdict: 'BLOCKED', target: null, engine: null, profile: 'release', runs: [], loads: [], slowest: null, reason: what, what: null });

function timeApp() {
  call({ call: 'time', world, steps }); // the untimed warm-up
  const timed = [];
  let triple;
  for (let i = 0; i < RUNS; i++) {
    const start = loadavg()[0];
    const r = call({ call: 'time', world, steps });
    const end = loadavg()[0];
    if (!r.ok) { process.stderr.write(`deep-physics time: ${JSON.stringify(r)}\n`); process.exit(1); }
    triple = r.target;
    timed.push({ ms: r.ms, top: r.top, load: { start, end } });
  }
  return judged('app', triple, 'native', timed);
}

// The page: the release wasm32 build, stepped one exported call at a time and timed on the page's clock; the server
// reads the load at each timed run's start and end.
const PAGE = `<!doctype html><meta charset="utf-8"><title>#2011 step budget</title><script type="module">
const post = (path, body) => fetch(path, { method: 'POST', body: JSON.stringify(body) });
try {
  const { world, steps, runs } = await (await fetch('/request.json')).json();
  const { instance } = await WebAssembly.instantiate(await (await fetch('/physics.wasm')).arrayBuffer(), {});
  const e = instance.exports;
  const line = (c) => {
    const bytes = new TextEncoder().encode(JSON.stringify(c));
    const at = e.deep_physics_alloc(bytes.length);
    new Uint8Array(e.memory.buffer, at, bytes.length).set(bytes);
    const room = e.deep_physics_call(at, bytes.length);
    const [ptr, len] = [Number(room >> 32n), Number(room & 0xffffffffn)];
    const reply = JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, ptr, len)));
    e.deep_physics_free(ptr, len);
    return reply;
  };
  const out = [];
  for (let run = 0; run <= runs; run++) {
    const built = line({ call: 'time_build', world });
    if (!built.ok) throw Error(JSON.stringify(built));
    if (run > 0) await post('/mark', { run, at: 'start' });
    const ms = [];
    for (let k = 0; k < steps; k++) {
      const t0 = performance.now();
      const ok = e.deep_physics_step();
      ms.push(performance.now() - t0);
      if (!ok) throw Error('step ' + (k + 1) + ' was refused');
      e.deep_physics_note();
    }
    if (run > 0) await post('/mark', { run, at: 'end' });
    const ended = line({ call: 'time_end' });
    if (run > 0) out.push({ ms, top: ended.top, target: built.target });
  }
  await post('/results', { userAgent: navigator.userAgent, isolated: crossOriginIsolated, out });
} catch (err) { await post('/results', { userAgent: navigator.userAgent, error: String((err && err.stack) || err) }); }
</script>`;

async function timeWeb() {
  cargo(['rustc', '--release', '--locked', '-p', 'deep-physics-rapier', '--lib', '--crate-type', 'cdylib', '--target', WASM32]);
  const wasm = readFileSync(join(target, WASM32, 'release', 'deep_physics_rapier.wasm'));
  const loads = {};
  let settle;
  const posted = new Promise((res) => { settle = res; });
  const server = createServer((req, res) => {
    // Cross-origin isolated, so performance.now() keeps its finer resolution.
    const headers = { 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
    if (req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const at = loadavg()[0];
        res.writeHead(200, headers);
        res.end('ok');
        let v;
        try { v = JSON.parse(body); } catch { v = { error: `unreadable post: ${body.slice(0, 500)}` }; }
        if (req.url === '/mark') (loads[v.run] ??= {})[v.at] = at;
        else settle(v);
      });
      return;
    }
    const send = (type, data) => { res.writeHead(200, { ...headers, 'content-type': type }); res.end(data); };
    if (req.url === '/' || req.url === '/index.html') send('text/html', PAGE);
    else if (req.url === '/request.json') send('application/json', JSON.stringify({ world, steps, runs: RUNS }));
    else if (req.url === '/physics.wasm') send('application/wasm', wasm);
    else { res.writeHead(404, headers); res.end(); }
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const profile = mkdtempSync(join(tmpdir(), 'deep-2011-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`], { detached: true, stdio: 'ignore' });
  try {
    const out = await posted;
    if (out.error) { process.stderr.write(`headless Chrome: the page failed: ${out.error}\n`); process.exit(1); }
    const timed = out.out.map((r, i) => ({ ms: r.ms, top: r.top, load: loads[i + 1] }));
    return judged('web', out.out[0].target, out.userAgent, timed);
  } finally {
    // Chrome and its helpers are this script's own process group (a detached child): stopped by its PID.
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ }
    await new Promise((res) => server.close(res));
    rmSync(profile, { recursive: true, force: true });
  }
}

const asks = [];
const unblock = (host, what) => { asks.push({ kind: 'unblock', host, what }); return blocked(what); };
const noMac = (host) => unblock(host, `configure a reference Mac to time the ${host} host's step_p95; until one runs it, the ${host} budget is BLOCKED`);
const hosts = {};
hosts.app = reference.app ? timeApp() : noMac('app');
if (planted) hosts.web = { ...hosts.app };
else if (!reference.web) hosts.web = noMac('web');
else if (!existsSync(CHROME)) hosts.web = unblock('web', `install headless Chrome at ${CHROME} (or set CHROME_BIN): the web host steps the wasm32 build there`);
else hosts.web = await timeWeb();
const verdicts = [hosts.app.verdict, hosts.web.verdict];
const verdict = ['FAIL', 'BLOCKED', 'INCONCLUSIVE'].find((v) => verdicts.includes(v)) ?? 'PASS';
process.stdout.write(`${JSON.stringify({ ok: true, verdict, limit_ms: limit, hosts, asks })}\n`);
