// Writes the first-party pack packs/process-1.0.0 (#980; canvas primitives: Logic: library interfaces): process@1,
// process models of entities, queues, resources, conveyors and batches, with its exports, its state layout
// process.state@1, its kind rules, fixtures whose expected values are worked out here from the step contract (never
// from a library), its reference library process_ref@1.0.0 with a fixture of its own, and two planted libraries that
// must each fail one of the fixtures: `drop` frees a belt's lead at a blocked end, `over` grants one unit past a
// resource's capacity. The library is src/process.rs, built by rustc into relocatable objects (the planted ones with
// --cfg planted_drop or --cfg planted_over); the fixtures' programs are WebAssembly text, assembled into relocatable
// objects by an assembler that takes `<out-dir> --program <file.wat>` (tests/acceptance/190/wat builds one):
//
//   node scripts/process-pack.mjs <assembler>
//
// objects/, fixtures/, src/*.wat and pack.json are written whole each run; src/process.rs is kept. A changed fixture,
// export or layout changes process@1's digest, which takes a new major.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/process-pack.mjs <assembler>');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'packs', 'process-1.0.0');
for (const d of ['objects', 'fixtures']) rmSync(join(OUT, d), { recursive: true, force: true });
for (const f of readdirSync(join(OUT, 'src'))) if (f.endsWith('.wat')) rmSync(join(OUT, 'src', f));

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
/** One canonical form before a hash: sorted keys, no white space. */
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
const assets = [];
function put(path, bytes) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), bytes);
  const sha = sha256(bytes);
  assets.push({ path, sha256: sha, size: bytes.length });
  return sha;
}
function scratch(f) {
  const dir = mkdtempSync(join(tmpdir(), 'process-pack-'));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------
// The library: rustc's relocatable object of src/process.rs, functions only, importing nothing but the caller's memory.

const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))[1];
const SIG = {
  source: [['i32', 'i32', 'f64', 'f64', 'i32', 'f64', 'i32'], ['i32']],
  queue: [['i32', 'i32', 'i32', 'i32'], ['i32']],
  resource: [['i32', 'i32'], ['i32']],
  request: [['i32', 'i32', 'i32', 'f64', 'f64', 'i32'], ['i32']],
  release: [['i32', 'i32'], ['i32']],
  conveyor: [['i32', 'f64', 'f64', 'f64', 'i32'], ['i32']],
  pack: [['i32', 'i32', 'i32', 'i32'], ['i32']],
  unpack: [['i32', 'i32', 'i32'], ['i32']],
  sink: [['i32'], ['i32']],
  stats: [['i32', 'i32', 'i32'], []],
};
const EXPORTS = Object.entries(SIG).map(([name, [params, results]]) => ({ name, params, results }));
function library(name, cfg) {
  const bytes = scratch((dir) => {
    const out = join(dir, `${name}.o`);
    const run = spawnSync('rustc', [
      '--target', 'wasm32-unknown-unknown', '--crate-type=lib', '--crate-name', 'process', '--edition', '2021', '--emit=obj',
      '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'target-cpu=mvp', '-C', 'debuginfo=0',
      '-C', 'target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint', ...(cfg ? ['--cfg', cfg] : []),
      '-o', out, join(OUT, 'src', 'process.rs'),
    ], { encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: channel } });
    if (run.status !== 0) throw Error(`${name} doesn't build: ${run.stderr}`);
    return readFileSync(out);
  });
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
  if (JSON.stringify(imports) !== JSON.stringify([{ module: 'env', name: '__linear_memory', kind: 'memory' }])) {
    throw Error(`${name} imports ${JSON.stringify(imports)}: a library imports only the caller's memory`);
  }
  return put(`objects/${name}.wasm`, bytes);
}
const reference = library('process_ref', null);
const drop = library('process_drop', 'planted_drop');
const over = library('process_over', 'planted_over');

// ---------------------------------------------------------------------------------------------------
// The fixtures' programs: the header and the model built at init, process@1's arrays written at the start of the write
// region (4096) by one `stats` a step, tables at 8192, the state at 1 MiB; 32 pages.

const WRITES_AT = 4096, DATA_AT = 8192, STATE_AT = 1 << 20;
const S = `(i32.const ${STATE_AT})`;
const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
const sig = ([params, results]) => `(param ${params.join(' ')})${results.length ? ` (result ${results.join(' ')})` : ''}`;
const dataText = (b) => Array.from(b, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('');

/** A model: its header, its builder calls (each a station or resource, in order) and the ticks each step runs. */
function program(name, module, m) {
  let tables = Buffer.alloc(0);
  const call = (b) => {
    switch (b.op) {
      case 'source': {
        let at = -1;
        if (b.at) {
          at = DATA_AT + tables.length;
          const t = Buffer.alloc(8 + 8 * b.at.length);
          t.writeUInt32LE(b.at.length, 0);
          b.at.forEach((x, i) => t.writeDoubleLE(x, 8 + 8 * i));
          tables = Buffer.concat([tables, t]);
        }
        return `(call $source ${S} (i32.const ${b.kind}) (f64.const ${f(b.every ?? 0)}) (f64.const 0.0) (i32.const ${at}) (f64.const -1.0) (i32.const ${b.to}))`;
      }
      case 'queue': return `(call $queue ${S} (i32.const 0) (i32.const -1) (i32.const ${b.to}))`;
      case 'resource': return `(call $resource ${S} (i32.const ${b.capacity}))`;
      case 'request': return `(call $request ${S} (i32.const 0) (i32.const 1) (f64.const ${f(b.hold)}) (f64.const 0.0) (i32.const ${b.to}))`;
      case 'conveyor': return `(call $conveyor ${S} (f64.const ${f(b.length)}) (f64.const ${f(b.speed)}) (f64.const ${f(b.spacing)}) (i32.const ${b.to}))`;
      case 'sink': return `(call $sink ${S})`;
      default: throw Error(b.op);
    }
  };
  const builds = m.build.map((b) => `\n    (drop ${call(b)})`).join('');
  const uses = [...new Set([...m.build.map((b) => b.op), 'stats'])];
  const text = `
(module
  (import "env" "__linear_memory" (memory 32 32))
${uses.map((n) => `  (import "${module}" "${n}" (func $${n} ${sig(SIG[n])}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64)
    (f64.store ${S} (f64.const ${f(m.tick)}))
    (i64.store offset=8 ${S} (local.get $seed))
    (i32.store offset=16 ${S} (i32.const ${m.rows}))
    (i32.store offset=20 ${S} (i32.const ${m.kinds.length}))
    (i32.store offset=24 ${S} (i32.const ${m.ring}))
    (f64.store offset=32 ${S} (f64.const 3600.0))
    (f64.store offset=40 ${S} (f64.const 0.0))${builds})
  (func (export "step") (param $k i64)
    (call $stats ${S} (i32.const ${m.ticksPerStep}) (i32.const ${WRITES_AT})))
  (data (i32.const ${DATA_AT}) "${dataText(tables.length ? tables : Buffer.from([0]))}"))
`;
  mkdirSync(join(OUT, 'src'), { recursive: true });
  writeFileSync(join(OUT, 'src', `${name}.wat`), text.trimStart());
  const bytes = scratch((dir) => {
    writeFileSync(join(dir, `${name}.wat`), text);
    const run = spawnSync(assembler, [dir, '--program', join(dir, `${name}.wat`)], { encoding: 'utf8' });
    if (run.status !== 0) throw Error(`${name} doesn't assemble: ${run.stderr}`);
    return readFileSync(join(dir, `${name}.wasm`));
  });
  return put(`objects/${name}.wasm`, bytes);
}

/** process@1's arrays for a model, in the library's order and types (README of the interface: Arrays). */
function writes(m) {
  const stations = m.build.filter((b) => b.op !== 'resource').length;
  const E = m.rows, K = m.kinds.length, N1 = stations + 1, R = Math.max(m.build.length - stations, 1), M = m.ring;
  const w = (type, count) => ({ type, count });
  return {
    kind: w('i32', E), gen: w('i32', E), at: w('i32', E), batch: w('i32', E), holds: w('i32', E), rank: w('i32', E), made: w('f64', E), d: w('f64', E),
    made_n: w('i32', K), out_n: w('i32', K), count: w('i32', N1), left: w('i32', N1), area: w('f64', N1), dwell: w('f64', N1),
    busy: w('i32', R), cap: w('i32', R), busy_area: w('f64', R), thru: w('f64', N1), mean: w('f64', N1), p90: w('f64', N1), wip: w('f64', N1),
    clock: w('f64', 3), rec_n: w('i32', 1), rec_t: w('f64', M), rec_w: w('f64', M),
  };
}
const item = (m, programSha, links) => ({
  kind: 'logic@1',
  params: { program: programSha, step_rate: m.rate, writes: writes(m), process: { kinds: m.kinds }, budget: { fuel: 10_000_000 }, ...(links ? { links } : {}) },
});
const fixture = (name, f) => put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify({ name, ...f }, null, 2)}\n`));
const fill = (n, v) => Array(n).fill(v);
/** Seconds to ticks, rounded to the nearest, as the step contract keeps time. */
const ticks = (m, seconds) => Math.round(seconds / m.tick);

// steady: one source every 60 s into a queue, one resource of capacity 1 held 45 s, a sink; a 1/60 s tick, a minute a
// step. Stations: 0 sink, 1 request, 2 queue, 3 source.
const STEADY = {
  tick: 1 / 60, rows: 8, kinds: ['order'], ring: 64, rate: 1, ticksPerStep: 3600,
  build: [{ op: 'sink' }, { op: 'resource', capacity: 1 }, { op: 'request', hold: 45, to: 0 }, { op: 'queue', to: 1 }, { op: 'source', kind: 0, every: 60, to: 2 }],
};
if (ticks(STEADY, 45) !== 2700 || ticks(STEADY, 60) !== STEADY.ticksPerStep) throw Error('steady: a 2,700-tick hold, one arrival a step');
/** After step k: k + 1 orders made, each through the empty queue at its first tick, held 2,700 ticks and out. */
const steadyAt = (k) => {
  const n = k + 1, held = 45 * n;
  return {
    clock: [60 * n, 3600, 0], made_n: [n], out_n: [n], rec_n: [n], count: fill(5, 0), left: fill(5, n),
    area: [0, held, 0, 0, held], dwell: [0, held, 0, 0, held], busy: [0], cap: [1], busy_area: [held],
    thru: fill(5, 60), mean: [0, 45, 0, 0, 45], p90: [0, 45, 0, 0, 45], wip: [0, 0.75, 0, 0, 0.75], kind: fill(8, -1), gen: [n, ...fill(7, 0)],
  };
};
const steadyFixture = fixture('steady', {
  item: item(STEADY, program('steady', 'lib:process@1', STEADY)), track: [], steps: 60,
  expect: { arrays: { 0: steadyAt(0), 1: steadyAt(1), 59: steadyAt(59) }, tolerance: { abs: 1e-9 } },
  answer: 'One source every 60 s (0, 60, 120 … s) into a fifo queue feeding one resource of capacity 1 held 45 s, then a sink, at a 1/60 s tick, 3,600 ticks (a minute) a step. Each order arrives at the first tick of its minute, passes the empty queue in that tick, holds 45 ÷ (1/60) = 2,700 ticks and leaves, so at each step\'s end nothing is held and after step k, k + 1 orders were made, taken out and recorded, every station left k + 1 times, the resource was busy 45(k + 1) s, and row 0, reused each minute, is at generation k + 1. Over the hour\'s window: 60 departures an hour everywhere, 45 s at the resource and in the system, mean work in progress 45/60 = 0.75 there.',
});

// blocked: a 10 m belt at 0.5 m/s with 0.6 m spacing whose end leads nowhere, fed 18 cases at t = 0 through its infeed
// queue; a 1/60 s tick a step. Stations: 0 belt, 1 queue, 2 source.
const BLOCKED = {
  tick: 1 / 60, rows: 20, kinds: ['case'], ring: 8, rate: 60, ticksPerStep: 1,
  build: [{ op: 'conveyor', length: 10, speed: 0.5, spacing: 0.6, to: -1 }, { op: 'queue', to: 0 }, { op: 'source', kind: 0, at: fill(18, 0), to: 1 }],
};
const P = ticks(BLOCKED, 10 / 0.5), GAP = ticks(BLOCKED, 0.6 / 0.5);
if (P !== 1200 || GAP !== 72 || Math.floor(P / GAP) + 1 !== 17) throw Error('blocked: 1,200 ticks end to end, 72 of spacing, 17 ride');
/** At step k ≥ 1,199: cases 0 … 16 on the belt at progress 1,200 − 72i (10 − 0.6i m), case 17 at the queue's head. */
const blockedAt = () => ({
  kind: [...fill(18, 0), -1, -1], at: [...fill(17, 0), 1, -1, -1], rank: [...Array.from({ length: 17 }, (_, i) => i), 0, 0, 0],
  d: [...Array.from({ length: 17 }, (_, i) => ((P - GAP * i) * 0.5) / 60), 0, 0, 0],
  count: [17, 1, 0, 18], made_n: [18], out_n: [0],
});
const blockedFixture = fixture('blocked', {
  item: item(BLOCKED, program('blocked', 'lib:process@1', BLOCKED)), track: [], steps: 1300,
  expect: { arrays: { 1199: blockedAt(), 1250: blockedAt(), 1299: blockedAt() }, tolerance: { abs: 1e-9 } },
  answer: 'A 10 m belt at 0.5 m/s with 0.6 m spacing at a 1/60 s tick: 10 ÷ (0.5 ÷ 60) = 1,200 ticks end to end and 0.6 ÷ (0.5 ÷ 60) = 72 ticks of spacing; its end leads nowhere. 18 cases made at t = 0 wait in its infeed queue; case i enters at tick 72i, when the one before is 72 ticks along, and all ride a tick a tick until the lead reaches the end in tick 1,199 and stops there; then every case stops where it is, case i at 1,200 − 72i ticks (10 − 0.6i m), case 16 at 0.4 m, short of the 0.6 m the next needs, so ⌊1,200 ÷ 72⌋ + 1 = 17 ride and case 17 waits at the head of the queue from then on: 18 made, 18 held, none out.',
});

// grant: one resource of capacity 2 and three orders at t = 0 by three sources (rows 0, 1, 2) into three queues built in
// the reverse order, all into one request held 1 s; a 1/60 s tick a step. Stations: 0 sink, 1 request, 2 to 4 the
// queues of rows 2, 1, 0, 5 to 7 the sources.
const GRANT = {
  tick: 1 / 60, rows: 4, kinds: ['order'], ring: 8, rate: 60, ticksPerStep: 1,
  build: [
    { op: 'sink' }, { op: 'resource', capacity: 2 }, { op: 'request', hold: 1, to: 0 },
    { op: 'queue', to: 1 }, { op: 'queue', to: 1 }, { op: 'queue', to: 1 },
    { op: 'source', kind: 0, at: [0], to: 4 }, { op: 'source', kind: 0, at: [0], to: 3 }, { op: 'source', kind: 0, at: [0], to: 2 },
  ],
};
if (ticks(GRANT, 1) !== 60) throw Error('grant: a 60-tick hold');
const grantFixture = fixture('grant', {
  item: item(GRANT, program('grant', 'lib:process@1', GRANT)), track: [], steps: 130,
  expect: {
    arrays: {
      0: { busy: [2], cap: [2], holds: [0, 0, -1, -1], at: [1, 1, 2, -1], out_n: [0] },
      59: { busy: [2], holds: [0, 0, -1, -1], at: [1, 1, 2, -1], out_n: [0] },
      60: { busy: [1], holds: [-1, -1, 0, -1], at: [-1, -1, 1, -1], out_n: [2] },
      120: { busy: [0], holds: [-1, -1, -1, -1], at: [-1, -1, -1, -1], out_n: [3] },
    },
    tolerance: { abs: 1e-9 },
  },
  answer: 'Three orders made at tick 0 (rows 0, 1, 2) reach the heads of their queues at once and ask the one resource of capacity 2; requests are granted in step order, then by entity ID, so rows 0 and 1 take its two units and row 2 waits at its queue\'s head, the resource busy 2 of 2. Each holds 1 s = 60 ticks: at tick 60 rows 0 and 1 leave to the sink, freeing the units, and row 2 takes one, held to tick 120, when it leaves too. A resource is never busy past its capacity.',
});

// The reference library's own fixture (#190's rule): three minutes of steady, linking it by its own name.
const REF = 'process_ref@1.0.0';
const ownFixture = fixture('steady_own', {
  item: item(STEADY, program('steady_own', 'lib:process_ref', STEADY), [{ name: REF, asset: reference }]), track: [], steps: 3,
  expect: { arrays: { 0: { rec_n: [1], busy_area: [45] }, 2: { rec_n: [3], out_n: [3], busy_area: [135] } }, tolerance: { abs: 1e-9 } },
  answer: 'The steady model of process@1\'s fixture steady for three minutes, importing process_ref by its own name: one order a minute, each held 45 s, one record a minute.',
});

// ---------------------------------------------------------------------------------------------------

const fixtures = [steadyFixture, blockedFixture, grantFixture];
const layout = 'process.state@1';
const manifest = {
  name: 'process', version: '1.0.0', license: 'Apache-2.0',
  description: 'process@1 (#980): process models of entities with a kind and a generation, made by sources on an interval, a table or seeded exponential gaps, waiting in queues, holding resources, riding conveyors, packed into batches and taken out by sinks, with statistics over a sliding window, and its kind rules process.conserve, process.busy and process.little. Its fixtures\' expected values come from the step contract; its planted libraries drop a belt\'s blocked lead (failing blocked) and grant past a capacity (failing grant). Written by scripts/process-pack.mjs; the library is src/process.rs, which documents process.state@1, and each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'process@1': {
      exports: EXPORTS, layout, fixtures, planted: [drop, over],
      digest: sha256(canonical({ exports: EXPORTS, layout, fixtures })),
      rules: { 'process.conserve': {}, 'process.busy': {}, 'process.little': { tolerance: 0.02 } },
    },
  },
  libs: { [REF]: { asset: reference, exports: EXPORTS.map((e) => e.name), fixtures: [ownFixture], implements: ['process@1'] } },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; process@1 digest ${manifest.interfaces['process@1'].digest}`);
