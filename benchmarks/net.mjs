// #280's budgets (tasks `net-feel-eight`, `net-budget-report` and `net-without-module`): readings, held to no limit, on a
// release deep-show, of the gallery's eight-seat fixture (crates/deep-show/gallery/net-arena.json). `feel`: net.feel's
// run of eight copies for 3,600 match steps over the test relay at 40 ms one-way latency and 10 ms jitter; `budget`:
// net.budget's report on the app, 600 match steps; `no-net`: the same piece without its net item or the net module,
// shown at 60 s, which must gain no work from the net module. The budget window times each command against the merge
// base; this script prints the readings it took, in minutes.
//
// Usage: node benchmarks/net.mjs <feel | budget | no-net>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['feel', 'budget', 'no-net'].includes(mode)) {
  process.stderr.write('usage: node benchmarks/net.mjs <feel | budget | no-net>\n');
  process.exit(2);
}
const DOC = '01JB280B000000000000000001';
const gallery = join(root, 'crates', 'deep-show', 'gallery');
const wasm = readFileSync(join(gallery, 'net-arena.wasm'));
const sha = createHash('sha256').update(wasm).digest('hex');
let document = { ...JSON.parse(readFileSync(join(gallery, 'net-arena.json'), 'utf8')), id: DOC };
if (mode === 'no-net') {
  const { match, ...items } = document.items;
  const { net, ...modules } = document.requires.modules;
  document = { ...document, items, requires: { modules } };
}

/** Each seat moves its own mover every 30 to 89 steps, to −1, 0 or 1 in turn, by a fixed generator. */
function plays(steps) {
  const out = {};
  for (let seat = 1; seat <= 8; seat++) {
    let z = seat * 2_654_435_761 >>> 0;
    const next = () => { z = (Math.imul(z, 1_103_515_245) + 12_345) >>> 0; return z / 2 ** 32; };
    const list = [];
    for (let g = Math.floor(next() * 30), k = 0; g + 2 < steps; g += 30 + Math.floor(next() * 60), k++) list.push({ step: g, control: `move${seat}`, value: (k % 3) - 1 });
    out[String(seat)] = list;
  }
  return out;
}

const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'deep-show', '--bin', 'deep-show'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
if (built.status !== 0) throw Error(`cargo build --release -p deep-show exited ${built.status}`);
const evidence = mkdtempSync(join(tmpdir(), 'deep-bench-280-'));
try {
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), wasm);
  const peer = { pid: 3002, start: 3_000 };
  const calls = [{ call: 'deep show', peer, doc: DOC, document, include: ['issues'], ...(mode === 'no-net' ? { t: '60s' } : {}) }];
  if (mode === 'feel') {
    calls.push({ call: 'match', doc: DOC, steps: 3600, plays: plays(3600), check: 'net.feel',
      feel: { profile: { latency: Array(8).fill(40), jitter: 10 }, seed: 280, items: [], bounds: {} } });
  }
  if (mode === 'budget') calls.push({ call: 'match', doc: DOC, steps: 600, plays: plays(600), check: 'net.budget', on: ['app'] });
  const scenario = {
    evidence, sessions: { 'sess-280': { thread: 'thread-280', name: 'bench', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels: { main: { rect: [0, 0, 640, 360] } }, docs: { [DOC]: { panel: 'main' } }, calls,
  };
  const t0 = performance.now();
  const r = spawnSync(join(root, 'target', 'release', 'deep-show'), ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const ms = performance.now() - t0;
  if (r.status !== 0) throw Error(`deep-show run exited ${r.status}: ${r.stderr.slice(-2000)}`);
  const answer = JSON.parse(r.stdout);
  const shown = answer.replies?.[0];
  if (shown?.outcome !== 'presented') throw Error(`the eight-seat fixture wasn't presented: ${JSON.stringify(shown).slice(0, 2000)}`);
  const check = answer.replies?.[1]?.check;
  if (mode !== 'no-net' && !check) throw Error(`the match returned no check: ${JSON.stringify(answer.replies?.[1]).slice(0, 2000)}`);
  const reading = { mode, minutes: Math.round((ms / 60_000) * 1000) / 1000 };
  if (mode === 'feel') reading.stall_ms_per_min = check.readings.map((x) => Math.round(x.stall_ms_per_min));
  if (mode === 'budget') reading.windows = check.windows;
  process.stdout.write(`${JSON.stringify(reading)}\n`);
} finally {
  rmSync(evidence, { recursive: true, force: true });
}
