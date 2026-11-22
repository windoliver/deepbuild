// Writes the first-party pack packs/separation-1.0.0 (#1255; canvas primitives: Logic: library interfaces):
// separation@1, movers that must keep apart, with its exports, its state layout separation.state@1, its kind rules and
// their kit's planted twins, fixtures whose expected values are worked out here by hand from each scene's straight
// lines (never from a library), its reference library separation_ref@1.0.0 with a fixture of its own, and two planted
// libraries that must each fail one of the fixtures. The library is src/separation.rs, built by rustc into relocatable
// objects (the planted ones with --cfg sampler and --cfg solver); the fixtures' programs are WebAssembly text,
// assembled into relocatable objects by an assembler that takes `<out-dir> --program <file.wat>`
// (tests/acceptance/416/interfaces/wat builds one):
//
//   node scripts/separation-pack.mjs <assembler>
//
// objects/, fixtures/, src/*.wat and pack.json are written whole each run; src/separation.rs and LAYOUT.md are kept. A
// changed fixture, export or layout changes separation@1's digest, which takes a new major.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/separation-pack.mjs <assembler>');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'packs', 'separation-1.0.0');
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
  const dir = mkdtempSync(join(tmpdir(), 'separation-pack-'));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------
// The library: rustc's relocatable object of src/separation.rs, functions only, importing nothing but the caller's
// memory.

const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))[1];
const EXPORTS = [
  { name: 'minima', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'mover', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'closest', params: ['i32', 'i32', 'i32', 'f64', 'f64'], results: ['f64'] },
  { name: 'conflicts', params: ['i32', 'f64', 'f64'], results: ['i32'] },
  { name: 'next_conflict', params: ['i32', 'f64'], results: ['i32'] },
  { name: 'delay', params: ['i32', 'i32', 'f64', 'f64', 'i32'], results: ['i32'] },
  { name: 'apply', params: ['i32', 'i32'], results: ['i32'] },
];
function library(name, cfg) {
  const bytes = scratch((dir) => {
    const out = join(dir, `${name}.o`);
    const run = spawnSync('rustc', [
      '--target', 'wasm32-unknown-unknown', '--crate-type=lib', '--crate-name', 'separation', '--edition', '2021', '--emit=obj',
      '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'target-cpu=mvp', '-C', 'debuginfo=0',
      '-C', 'target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint', ...(cfg ? ['--cfg', cfg] : []),
      '-o', out, join(OUT, 'src', 'separation.rs'),
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
const reference = library('separation_ref', null);
// The planted libraries: one looks at each pair once a second; one gives a delay's speed without reading the band.
const sampler = library('once_a_second', 'sampler');
const solver = library('leaves_band', 'solver');

// ---------------------------------------------------------------------------------------------------
// The fixtures' programs: the state at 1 MiB, the built table (asset 0) at assets_at + 4, the state's head copied over
// the start of the write region (4096) after each step's calls, the control records a program asks for after it, the
// program's own data at 49152; 32 pages.

const STATE_AT = 1 << 20, WRITES_AT = 4096, DATA_AT = 49152, ASSETS_AT = 262144;
const SLOTS = 8, WINDOWS = 64;
/** separation.state@1's arrays for m movers, in the head's order (LAYOUT.md: separation.state@1). */
const stateWrites = (m) => ({
  fix_count: { type: 'i32', count: m }, fix_ref: { type: 'i32', count: SLOTS * m }, fix_pos: { type: 'vec3', count: SLOTS * m },
  fix_speed: { type: 'f64', count: SLOTS * m }, fix_time: { type: 'f64', count: SLOTS * m },
  delay_s: { type: 'f64', count: m }, delay_fix: { type: 'i32', count: m },
  win_count: { type: 'i32' }, win_a: { type: 'i32', count: WINDOWS }, win_b: { type: 'i32', count: WINDOWS },
  win_from: { type: 'f64', count: WINDOWS }, win_to: { type: 'f64', count: WINDOWS }, win_min: { type: 'f64', count: WINDOWS },
  win_row: { type: 'i32', count: WINDOWS }, win_basis: { type: 'i32', count: WINDOWS },
  closest_a: { type: 'i32' }, closest_b: { type: 'i32' }, closest_dist: { type: 'f64' }, closest_time: { type: 'f64' },
});
/** A control record's fields, then what delay and apply returned for it: 8 bytes each. */
const RECORD = ['kind', 'mover', 'from', 'to', 'value', 'why', 'ret', 'did'];
const writesOf = (m, records = []) => ({
  ...stateWrites(m),
  ...Object.fromEntries(records.flatMap((r) => RECORD.map((f) => [`${r}_${f}`, { type: f === 'value' ? 'f64' : 'i32' }]))),
});
const BYTES = { i32: 4, f64: 8, vec3: 24 };
/** Where each array starts in a write region, each 8-aligned in order, and where they end. */
function offsets(writes) {
  const at = {};
  let size = 0;
  for (const [name, w] of Object.entries(writes)) { at[name] = size; size += Math.ceil((BYTES[w.type] * (w.count ?? 1)) / 8) * 8; }
  return { at, size };
}
const KIND = { refused: 0, speed: 1, stretch: 2, hold: 3 }, WHY = { none: 0, band: 1, route: 2 };
const sig = (e) => `${e.params.length ? `(param ${e.params.join(' ')})` : ''}${e.results.length ? ` (result ${e.results.join(' ')})` : ''}`;
const S = `(i32.const ${STATE_AT})`;
/**
 * A program importing separation@1's exports from `module`: init starts the state from the built table and adds movers
 * 0 to m − 1; step k makes `steps[k]`'s calls, then copies the state's head over its write region. A call is
 * {closest: [a, b, t0, t1]}, {conflicts: [t0, t1]}, {next_conflict: [t]}, {delay: [mover, seconds, t], rec}, {apply: rec}, or
 * {hold_if_conflict: [mover, seconds]}: the piece's own fix, a hold it carries as data and applies when the state
 * holds a window.
 */
function program(name, module, movers, steps, records = []) {
  const { at } = offsets(writesOf(movers, records));
  const head = offsets(stateWrites(movers));
  const rec = (r) => WRITES_AT + at[`${r}_kind`];
  const holds = steps.flat().filter((c) => c.hold_if_conflict);
  const data = Buffer.alloc(Math.max(8, 48 * holds.length));
  holds.forEach((h, i) => {
    [KIND.hold, h.hold_if_conflict[0], -1, -1].forEach((x, f) => data.writeInt32LE(x, 48 * i + 8 * f));
    data.writeDoubleLE(h.hold_if_conflict[1], 48 * i + 32);
  });
  const call = (c) => c.closest ? `(drop (call $closest ${S} (i32.const ${c.closest[0]}) (i32.const ${c.closest[1]}) (f64.const ${c.closest[2]}) (f64.const ${c.closest[3]})))`
    : c.conflicts ? `(drop (call $conflicts ${S} (f64.const ${c.conflicts[0]}) (f64.const ${c.conflicts[1]})))`
    : c.next_conflict ? `(drop (call $next_conflict ${S} (f64.const ${c.next_conflict[0]})))`
    : c.delay ? `(i32.store (i32.const ${rec(c.rec) + 48}) (call $delay ${S} (i32.const ${c.delay[0]}) (f64.const ${c.delay[1]}) (f64.const ${c.delay[2]}) (i32.const ${rec(c.rec)})))`
    : c.apply ? `(i32.store (i32.const ${rec(c.apply) + 56}) (call $apply ${S} (i32.const ${rec(c.apply)})))`
    : `(if (i32.gt_s (i32.load (i32.const ${STATE_AT + head.at.win_count})) (i32.const 0)) (then (drop (call $apply ${S} (i32.const ${DATA_AT + 48 * holds.indexOf(c)})))))`;
  const used = new Set(['minima', 'mover', ...steps.flat().map((c) => (c.hold_if_conflict ? 'apply' : Object.keys(c).find((k) => k !== 'rec')))]);
  const text = `
(module
  (import "env" "__linear_memory" (memory 32 32))
${EXPORTS.filter((e) => used.has(e.name)).map((e) => `  (import "${module}" "${e.name}" (func $${e.name} ${sig(e)}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func (export "init") (param $seed i64) (local $i i32)
    (drop (call $minima ${S} (i32.const ${ASSETS_AT + 4})))
    (loop $add
      (drop (call $mover ${S} (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $add (i32.lt_u (local.get $i) (i32.const ${movers})))))
  (func (export "step") (param $k i64)${steps.map((calls, k) => `
    (if (i64.eq (local.get $k) (i64.const ${k})) (then
      ${calls.map(call).join('\n      ')}))`).join('')}
    (memory.copy (i32.const ${WRITES_AT}) ${S} (i32.const ${head.size})))
  (data (i32.const ${DATA_AT}) "${Array.from(data, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('')}"))`;
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
const item = (scene, programSha, writes, links) => ({
  kind: 'logic@1', params: { program: programSha, writes, separation: scene, ...(links ? { links } : {}) },
});
const fixture = (name, f) => put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify({ name, ...f }, null, 2)}\n`));
/** An array's first values, the rest of its `count` zero: what a state holds past what it wrote. */
const first = (values, count) => [...values, ...Array(count - values.length).fill(0)];
/** A window as the state's arrays hold it at slot 0 of `n` found: its pair, ends, minimum, row and basis. */
const windows = (list) => ({
  win_count: [list.length],
  win_a: first(list.map((w) => w.a), WINDOWS), win_b: first(list.map((w) => w.b), WINDOWS),
  win_from: first(list.map((w) => w.from), WINDOWS), win_to: first(list.map((w) => w.to), WINDOWS),
  win_min: first(list.map((w) => w.min), WINDOWS), win_row: first(list.map((w) => w.row), WINDOWS), win_basis: first(list.map((w) => w.basis), WINDOWS),
});
const record = (name, r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [`${name}_${k}`, [v]]));
const TOLERANCE = { abs: 1e-6 };
const INTERFACE = 'lib:separation@1';

// ---------------------------------------------------------------------------------------------------
// Scenes. Positions are [x, y, z] in metres with y up, so (x, z) is the lateral plane; the table's minima are 5,556 m
// laterally and 300 m vertically in every scene. A basis cited here names this pack's own rule sheet (LAYOUT.md).

const LATERAL = 5556, VERTICAL = 300;
const CITED = { cited: { source: 'packs/separation-1.0.0/LAYOUT.md', section: 'The fixtures\' rule sheet' } };
const bands = (route, min, max) => route.map((f) => ({ fix: f.fix, min, max }));
const flies = (id, cls, route, speed, start, band) => ({
  id, class: cls, route, speed: route.slice(0, -1).map((f) => ({ from_fix: f.fix, speed })), band: bands(route, ...band), start,
});

// The crossing: `east` flies +x from (−30,000, 0) at 200 m/s and `north` +z from (0, −24,000) at 150 m/s, both from
// t = 0 for 300 s, level at 3,000 m. North from east is (30,000 − 200t, 150t − 24,000): its squared length is least
// where −200(30,000 − 200t) + 150(150t − 24,000) = 0, t = 9,600,000 ÷ 62,500 = 153.6 s, where it is (−720, −960):
// 1,200 m. They close at 250 m/s, so the pair is under a lateral minimum L for √(L² − 1,200²) ÷ 250 s either side.
const crossingMovers = (north) => [
  flies('east', 'heavy', [{ fix: 'east.in', at: [-30000, 3000, 0] }, { fix: 'east.out', at: [30000, 3000, 0] }], 200, 0, [150, 250]),
  flies('north', north, [{ fix: 'north.in', at: [0, 3000, -24000] }, { fix: 'north.out', at: [0, 3000, 21000] }], 150, 0, [100, 200]),
];
const half = (min) => Math.sqrt(min * min - 1200 * 1200) / 250;
const CROSSING = { movers: crossingMovers('heavy'), minima: { lateral: LATERAL, vertical: VERTICAL, by_pair: [] } };
const crossingProgram = program('crossing', INTERFACE, 2, [
  [{ closest: [0, 1, 0, 300] }, { conflicts: [0, 300] }], [{ next_conflict: [160] }], [{ next_conflict: [200] }],
]);
const crossingWindow = { a: 0, b: 1, from: 153.6 - half(LATERAL), to: 153.6 + half(LATERAL), min: LATERAL, row: -1, basis: 0 };
const crossingFixture = fixture('crossing', {
  item: item(CROSSING, crossingProgram, writesOf(2)), track: [], steps: 3,
  expect: {
    arrays: {
      0: { closest_a: [0], closest_b: [1], closest_dist: [1200], closest_time: [153.6], ...windows([crossingWindow]) },
      1: windows([{ ...crossingWindow, from: 160 }]),
      2: windows([]),
    },
    tolerance: TOLERANCE,
  },
  answer: 'east flies +x from (−30,000, 0) at 200 m/s and north +z from (0, −24,000) at 150 m/s, both from t = 0, level at 3,000 m. North from east is (30,000 − 200t, 150t − 24,000), least where −200(30,000 − 200t) + 150(150t − 24,000) = 0: t = 153.6 s, (−720, −960), 1,200 m. They close at 250 m/s, so the pair is under 5,556 m for √(5,556² − 1,200²) ÷ 250 = 21.6997 s either side of 153.6 s: one window of the table\'s minimum, row −1, basis 0. Step 1 asks the next conflict from 160 s, inside it: the window as conflicts(160, ∞) lists it, cut at 160 s. Step 2 asks from 200 s, past it: none.',
});

// The same crossing with a light mover north and a row that holds always: a light mover and a heavy one keep 7,408 m,
// whichever leads. The pair's window is then that of 7,408 m, and names the row and its basis, invented.
const WIDE = { movers: crossingMovers('light'), minima: { lateral: LATERAL, vertical: VERTICAL, by_pair: [{ leader: 'light', follower: 'heavy', min: 7408, at: 'always', basis: 'invented' }] } };
const wideProgram = program('wide', INTERFACE, 2, [[{ conflicts: [0, 300] }]]);
const wideFixture = fixture('wide', {
  item: item(WIDE, wideProgram, writesOf(2)), track: [], steps: 1,
  expect: { arrays: { 0: windows([{ a: 0, b: 1, from: 153.6 - half(7408), to: 153.6 + half(7408), min: 7408, row: 0, basis: 2 }]) }, tolerance: TOLERANCE },
  answer: 'The crossing, with north light and the row {light, heavy, 7,408 m, always, invented}: an always row raises the lateral minimum of each pair of its two classes, whichever leads, so the pair is under 7,408 m for √(7,408² − 1,200²) ÷ 250 = 29.2410 s either side of 153.6 s: one window, min 7,408, row 0, basis 2 (invented).',
});

// The breach: east flies +x at 200 m/s from t = 0 and north +z at 150 m/s from t = 20 s, level, closing at 250 m/s and
// placed to pass P = √(5,556² − 75²) m apart at 140.5 s, at right angles to their closing velocity (−200, 150): north
// from east is then (0.6, 0.8) × P. Their distance is √(P² + (250(t − 140.5))²), under 5,556 m while
// 250|t − 140.5| < 75: from 140.2 s to 140.8 s, 0.6 s strictly between two whole seconds. The piece's own fix holds
// north 150 s when a window is found: north is then 22,500 m back along its route at every time, 0.8 × 22,500 =
// 18,000 m of it across the closing line, so they pass 18,000 − P = 12,444.5 m apart and no window is left.
const P = Math.sqrt(LATERAL * LATERAL - 75 * 75);
const x0 = -200 * 140.5 - 0.6 * P, z0 = 0.8 * P - 150 * 140.5;
const BREACH = {
  movers: [
    flies('east', 'medium', [{ fix: 'east.in', at: [x0, 3000, 0] }, { fix: 'east.out', at: [x0 + 200 * 400, 3000, 0] }], 200, 0, [150, 250]),
    flies('north', 'medium', [{ fix: 'north.in', at: [0, 3000, z0 + 150 * 20] }, { fix: 'north.out', at: [0, 3000, z0 + 150 * 400] }], 150, 20, [100, 200]),
  ],
  minima: { lateral: LATERAL, vertical: VERTICAL, by_pair: [] },
};
const breachProgram = program('breach', INTERFACE, 2, [[{ conflicts: [0, 600] }], [{ hold_if_conflict: [1, 150] }, { conflicts: [0, 600] }]]);
const breachFixture = fixture('breach', {
  item: item(BREACH, breachProgram, writesOf(2)), track: [], steps: 2,
  expect: {
    arrays: {
      0: windows([{ a: 0, b: 1, from: 140.2, to: 140.8, min: LATERAL, row: -1, basis: 0 }]),
      1: { ...windows([]), fix_time: first([0, 400, 0, 0, 0, 0, 0, 0, 170, 550], 2 * SLOTS) },
    },
    tolerance: TOLERANCE,
  },
  rules: { 'separation.clear': { span: [0, 600] } },
  answer: 'east flies +x at 200 m/s from t = 0 and north +z at 150 m/s from t = 20 s, level, closing at 250 m/s and passing P = √(5,556² − 75²) = 5,555.4938 m apart at 140.5 s. Their distance is √(P² + (250(t − 140.5))²), under 5,556 m while 250|t − 140.5| < 75: 140.2 s to 140.8 s, between the whole seconds 140 and 141, which a look once a second never sees. At step 1 the piece holds north 150 s because a window was found: north then flies from 170 s to 550 s, 22,500 m back at every time, and they pass 0.8 × 22,500 − P = 12,444.5 m apart: no window. Under separation.clear over [0, 600] s the held run is clear; a run that found no window holds nothing and fails it, naming east and north.',
});

// The approach: entry (−40,000, 900, 0), gate (−20,000, 900, 0), threshold (0, 900, 0), level, two legs of 20,000 m at
// 80 m/s, 250 s each. The heavy leader starts at 0 and passes the threshold at 500 s; the light follower starts at
// 100 s, so it is 100 s × 80 m/s = 8,000 m behind then. The rule sheet's row: a light mover behind a heavy one keeps
// 10,000 m, measured when the heavy one passes the threshold. 8,000 m is under it and not under 5,556 m.
const ROUTE = [{ fix: 'entry', at: [-40000, 900, 0] }, { fix: 'gate', at: [-20000, 900, 0] }, { fix: 'threshold', at: [0, 900, 0] }];
const ROW = { leader: 'heavy', follower: 'light', min: 10000, at: 'threshold', basis: CITED };
const DEPARTURE = [{ fix: 'runway', at: [0, 900, 40000] }, { fix: 'exit', at: [8000, 900, 40000] }];
const approach = (band, departure) => ({
  movers: [
    flies('leader', 'heavy', ROUTE, 80, 0, [50, 90]), flies('follower', 'light', ROUTE, 80, 100, band),
    ...(departure ? [flies('departure', 'light', DEPARTURE, 80, 300, [75, 90])] : []),
  ],
  minima: { lateral: LATERAL, vertical: VERTICAL, by_pair: [ROW] },
});
const SPAN = [0, 800];
const rowWindow = { a: 0, b: 1, from: 500, to: 500, min: 10000, row: 0, basis: 1 };

// A delay of 50 s asked of the follower at time 0: its next leg, entry to gate, 20,000 m in 250 s, takes 300 s at
// 20,000 ÷ 300 = 66.6667 m/s, inside a band of 50 to 90 m/s: a speed. Applied, it is at the gate at 400 s and at the
// threshold at 650 s; at 500 s it is 100 s × 80 = 8,000 m past the gate, 12,000 m behind the leader: no window.
const delayedProgram = program('delayed', INTERFACE, 2, [[{ conflicts: SPAN }], [{ delay: [1, 50, 0], rec: 'given' }, { apply: 'given' }, { conflicts: SPAN }]], ['given']);
const delayedFixture = fixture('delayed', {
  item: item(approach([50, 90]), delayedProgram, writesOf(2, ['given'])), track: [], steps: 2,
  expect: {
    arrays: {
      0: { ...windows([rowWindow]), fix_count: [3, 3], fix_time: first([0, 250, 500, 0, 0, 0, 0, 0, 100, 350, 600], 2 * SLOTS) },
      1: {
        ...windows([]), ...record('given', { kind: KIND.speed, mover: 1, from: 0, to: 1, value: 20000 / 300, why: WHY.none, ret: KIND.speed, did: 1 }),
        fix_speed: first([80, 80, 0, 0, 0, 0, 0, 0, 20000 / 300, 80], 2 * SLOTS), fix_time: first([0, 250, 500, 0, 0, 0, 0, 0, 100, 400, 650], 2 * SLOTS),
        delay_s: [0, 50], delay_fix: [-1, 1],
      },
    },
    tolerance: TOLERANCE,
  },
  answer: 'One approach, entry to gate to threshold, two legs of 20,000 m at 80 m/s, the follower\'s band 50 to 90 m/s. The heavy leader starts at 0 and passes the threshold at 500 s; the light follower starts at 100 s and is 100 s × 80 m/s = 8,000 m behind then. The row {heavy, light, 10,000 m, at threshold, cited} is measured at that instant: 8,000 m is under 10,000 m and not under the table\'s 5,556 m, so step 0 finds one window, the row\'s, from 500 s to 500 s, min 10,000, row 0, basis 1 (cited). Step 1 asks delay(follower, 50) at time 0: its next leg, entry to gate, 20,000 m in 250 s, takes 300 s at 20,000 ÷ 300 = 66.6667 m/s, inside the band: speed {follower, entry, gate}. Applied, the follower is at the gate at 400 s and the threshold at 650 s; at 500 s it is 8,000 m past the gate, 12,000 m behind the leader, so no window is left. The state shows the delay: 50 s, wanted at fix 1.',
});

// The band too narrow: 75 to 90 m/s, so 66.67 m/s is under it. Asked at time 0, the leg entry to gate isn't the
// follower's last: a stretch, the leg's midpoint moved ½√((20,000 + 80 × 50)² − 20,000²) = 6,633.2496 m to the left of
// travel (−z), both halves 12,000 m at 80 m/s: off the route at (−30,000, 900, −6,633.2496) at 250 s, the gate at
// 400 s, the threshold at 650 s. The departure, asked at time 0, hasn't started and its one leg is its last (8,000 ÷
// 150 = 53.3 m/s, under 75): a hold of 50 s, so it flies from 350 s to 450 s. The follower asked at 200 s has left
// entry and only gate to threshold is left: no speed, no stretch, no hold, so a refusal naming the band at the gate.
const OFFSET = Math.sqrt(24000 * 24000 - 20000 * 20000) / 2;
const narrowProgram = program('narrow', INTERFACE, 3, [
  [{ delay: [1, 50, 200], rec: 'refused' }, { delay: [1, 50, 0], rec: 'stretch' }, { delay: [2, 50, 0], rec: 'hold' }],
  [{ apply: 'stretch' }, { apply: 'hold' }],
], ['refused', 'stretch', 'hold']);
const narrowFixture = fixture('narrow', {
  item: item(approach([75, 90], true), narrowProgram, writesOf(3, ['refused', 'stretch', 'hold'])), track: [], steps: 2,
  expect: {
    arrays: {
      0: {
        ...record('refused', { kind: KIND.refused, mover: 1, from: 1, to: -1, value: 20000 / 300, why: WHY.band, ret: KIND.refused, did: 0 }),
        ...record('stretch', { kind: KIND.stretch, mover: 1, from: 0, to: 1, value: OFFSET, why: WHY.none, ret: KIND.stretch, did: 0 }),
        ...record('hold', { kind: KIND.hold, mover: 2, from: -1, to: -1, value: 50, why: WHY.none, ret: KIND.hold, did: 0 }),
        fix_count: [3, 3, 2],
      },
      1: {
        stretch_did: [1], hold_did: [1], fix_count: [3, 4, 2],
        fix_ref: [0, 1, 2, -1, -1, -1, -1, -1, 0, -1, 1, 2, -1, -1, -1, -1, 0, 1, -1, -1, -1, -1, -1, -1],
        fix_pos: first([ROUTE[0].at, ROUTE[1].at, ROUTE[2].at], SLOTS).map((p) => p || [0, 0, 0])
          .concat(first([ROUTE[0].at, [-30000, 900, -OFFSET], ROUTE[1].at, ROUTE[2].at], SLOTS).map((p) => p || [0, 0, 0]))
          .concat(first([DEPARTURE[0].at, DEPARTURE[1].at], SLOTS).map((p) => p || [0, 0, 0])),
        fix_time: first([0, 250, 500, 0, 0, 0, 0, 0, 100, 250, 400, 650, 0, 0, 0, 0, 350, 450], 3 * SLOTS),
        delay_s: [0, 50, 50], delay_fix: [-1, 1, 1],
      },
    },
    tolerance: TOLERANCE,
  },
  rules: { 'separation.clear': { span: SPAN } },
  answer: 'The approach with a departure, the follower\'s band 75 to 90 m/s: a delay of 50 s over entry to gate needs 66.67 m/s, under it. Asked at 200 s, the follower has left entry and only gate to threshold is left: no speed (the band), no stretch (the last leg), no hold (it has started), so a refusal naming the band at the gate, with the speed it would need. Asked at time 0, entry to gate isn\'t its last leg: a stretch, the midpoint moved ½√(24,000² − 20,000²) = 6,633.2496 m to the left of travel, both halves 12,000 m at 80 m/s: (−30,000, 900, −6,633.2496) at 250 s, the gate at 400 s, the threshold at 650 s. The departure, not yet started, on its one leg: a hold of 50 s, flying 350 s to 450 s. Applied at step 1, each gives its 50 s at fix 1 with every speed in its band, and nothing is under a minimum over [0, 800] s. A library that gives the speed whatever the band answers 66.67 m/s three times.',
});

// The reference library's own fixture (#190's rule): the approach loaded, importing it by its own name.
const REF = 'separation_ref@1.0.0';
const ownProgram = program('approach_own', 'lib:separation_ref', 2, [[{ conflicts: SPAN }]]);
const ownFixture = fixture('approach_own', {
  item: item(approach([50, 90]), ownProgram, writesOf(2), [{ name: REF, asset: reference }]), track: [], steps: 1,
  expect: { arrays: { 0: { fix_count: [3, 3], win_count: [1] } } },
  answer: 'The approach of separation@1\'s fixture delayed, importing separation_ref by its own name: both movers hold three slots, and the row\'s one window is found.',
});

// ---------------------------------------------------------------------------------------------------

const fixtures = [crossingFixture, wideFixture, breachFixture, delayedFixture, narrowFixture];
const layout = 'separation.state@1';
const manifest = {
  name: 'separation', version: '1.0.0', license: 'Apache-2.0',
  description: 'separation@1 (#1255): movers that must keep apart. Each flies straight between the fixes of its route at speeds within its band; minima are lateral, vertical and by pair of classes, each row citing its basis or marked invented; closest approach and conflict windows are solved in closed form between fixes; delay gives a speed, a stretch or a hold, or refuses, naming why. Its fixtures\' expected values are worked by hand from each scene\'s straight lines. Its planted libraries, one that looks at each pair once a second and one whose delay gives a speed without reading the band, each fail a fixture and are its kind kit\'s twins for separation.clear and separation.exact. Written by scripts/separation-pack.mjs; the library is src/separation.rs, its layouts are LAYOUT.md, and each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'separation@1': {
      exports: EXPORTS, layout, fixtures, planted: [sampler, solver],
      digest: sha256(canonical({ exports: EXPORTS, layout, fixtures })),
      rules: { 'separation.clear': {}, 'separation.exact': { tolerance: 0.5 } },
      twins: [
        { planted: sampler, example: breachFixture, expect: 'separation.clear' },
        { planted: solver, example: narrowFixture, expect: 'separation.exact' },
      ],
    },
  },
  libs: { [REF]: { asset: reference, exports: EXPORTS.map((e) => e.name), fixtures: [ownFixture], implements: ['separation@1'] } },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; separation@1 digest ${manifest.interfaces['separation@1'].digest}`);
