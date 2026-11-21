// Writes the first-party pack packs/lanes-1.0.0 (#981; canvas primitives: Logic: library interfaces): lanes@1, vehicles
// on a lane graph, with its exports, its state layout lanes.state@1, its kind rules, fixtures whose expected values are
// worked out here from the rest-to-rest profile and the reservation rule (never from a library), its reference library
// lanes_ref@1.0.0 with a fixture of its own, and a planted library that must fail one of the fixtures. The library is
// src/lanes.rs, built by rustc into relocatable objects (the planted one with --cfg planted); the fixtures' programs are
// WebAssembly text, assembled into relocatable objects by an assembler that takes `<out-dir> --program <file.wat>`
// (tests/acceptance/190/wat builds one):
//
//   node scripts/lanes-pack.mjs <assembler>
//
// objects/, fixtures/, src/*.wat and pack.json are written whole each run; src/lanes.rs and LAYOUT.md are kept. A
// changed fixture, export or layout changes lanes@1's digest, which takes a new major.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/lanes-pack.mjs <assembler>');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'packs', 'lanes-1.0.0');
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
  const dir = mkdtempSync(join(tmpdir(), 'lanes-pack-'));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------
// The library: rustc's relocatable object of src/lanes.rs, functions only, importing nothing but the caller's memory.

const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))[1];
const EXPORTS = [
  { name: 'graph', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'vehicle', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'route', params: ['i32', 'i32', 'i32'], results: ['f64'] },
  { name: 'go', params: ['i32', 'f64', 'i32'], results: [] },
  { name: 'lift', params: ['i32', 'i32', 'f64'], results: [] },
  { name: 'carry', params: ['i32', 'i32'], results: [] },
  { name: 'set_down', params: ['i32', 'i32'], results: [] },
  { name: 'park', params: ['i32', 'i32', 'i32'], results: ['f64'] },
];
function library(name, planted) {
  const bytes = scratch((dir) => {
    const out = join(dir, `${name}.o`);
    const run = spawnSync('rustc', [
      '--target', 'wasm32-unknown-unknown', '--crate-type=lib', '--crate-name', 'lanes', '--edition', '2021', '--emit=obj',
      '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'target-cpu=mvp', '-C', 'debuginfo=0',
      '-C', 'target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint', ...(planted ? ['--cfg', 'planted'] : []),
      '-o', out, join(OUT, 'src', 'lanes.rs'),
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
const reference = library('lanes_ref', false);
const planted = library('lanes_planted', true);

// ---------------------------------------------------------------------------------------------------
// The fixtures' programs: a lane state at 1 MiB, the built graph (asset 0) at assets_at + 4, lanes@1's arrays written at
// the start of the write region (4096), the program's own data at 8192 and variables at 16384; 32 pages.

const STATE_AT = 1 << 20, WRITES_AT = 4096, VARS_AT = 16384, ASSETS_AT = 65536;
const sig = (e) => `${e.params.length ? `(param ${e.params.join(' ')})` : ''}${e.results.length ? ` (result ${e.results.join(' ')})` : ''}`;
const head = (module) => `
(module
  (import "env" "__linear_memory" (memory 32 32))
${EXPORTS.map((e) => `  (import "${module}" "${e.name}" (func $${e.name} ${sig(e)}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))`;
const init = (place) => `
  (func (export "init") (param $seed i64)
    (drop (call $graph (i32.const ${STATE_AT}) (i32.const ${ASSETS_AT + 4})))${place.map((b) => `
    (drop (call $vehicle (i32.const ${STATE_AT}) (i32.const ${b})))`).join('')})`;
const go = (dt) => `(call $go (i32.const ${STATE_AT}) (f64.const ${dt}) (i32.const ${WRITES_AT}))`;
function program(name, text) {
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
/** Places vehicles at `place`; each step sends those `send` names for it, then steps the world dt. */
const dispatch = (name, module, place, send, dt) => program(name, `${head(module)}${init(place)}
  (func (export "step") (param $k i64)${send.map((s) => `
    (if (i64.eq (local.get $k) (i64.const ${s.at})) (then (drop (call $park (i32.const ${STATE_AT}) (i32.const ${s.v}) (i32.const ${s.bay})))))`).join('')}
    ${go(dt)})
  (data (i32.const 8192) "\\00"))`);

// ---------------------------------------------------------------------------------------------------
// Scenes: vehicles 2 m × 1 m with a 0.5 m gap, so a junction's zone reaches 1.25 m along each path; 1 m/s² each way.

const VEHICLE = { length: 2, width: 1, gap: 0.5, speed: 2, accel: 1, decel: 1 };
const byName = (bays) => Object.fromEntries(Object.entries(bays).sort(([a], [b]) => (a < b ? -1 : 1)));
const scene = (paths, bays, vehicle) => ({
  items: Object.fromEntries(paths.map((p) => [p.id, { kind: 'path@1', params: { verbs: ['M', ...p.pts.slice(1).map(() => 'L')], pts: p.pts.flat() } }])),
  lanes: {
    graph: { paths: paths.map((p) => p.id), two_way: paths.map((p) => p.id), speed: Object.fromEntries(paths.map((p) => [p.id, 2])), bays: byName(bays) },
    vehicle,
  },
});
const bayOf = (s, name) => Object.keys(s.lanes.graph.bays).indexOf(name);
const writes = (v, more = {}) => ({
  pos: { type: 'vec2', count: v }, heading: { type: 'f64', count: v }, speed: { type: 'f64', count: v },
  state: { type: 'i32', count: v }, fork: { type: 'f64', count: v }, load: { type: 'vec3', count: v }, ...more,
});
const item = (s, programSha, w, links) => ({
  kind: 'logic@1', params: { program: programSha, step_rate: 10, writes: w, lanes: s.lanes, ...(links ? { links } : {}) },
});
const STATE = { parked: 0, driving: 1, waiting: 2, lifting: 3, lowering: 4 };

/** Rest to rest over d with top speed v, accel a, decel b: the distance at time t. */
function profile(d, v, a, b) {
  const ta = v / a, tb = v / b, sa = (v * v) / (2 * a), sb = (v * v) / (2 * b);
  const T = ta + tb + (d - sa - sb) / v;
  const at = (t) => (t <= 0 ? 0 : t <= ta ? (a * t * t) / 2 : t <= T - tb ? sa + v * (t - ta) : t <= T ? d - (b * (T - t) * (T - t)) / 2 : d);
  return { T, at };
}
const end = (k) => (k + 1) / 10;
const fixture = (name, f) => put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify({ name, ...f }, null, 2)}\n`));
const near = (x) => Math.round(x * 1e9) / 1e9;

// The straight edge: 20 m at a 2 m/s limit, the vehicle's own top speed 3 m/s, so the limit holds it: up 2 s over 2 m,
// 16 m at 2 m/s in 8 s, down 2 s over 2 m, rest to rest in 12 s; sent at step 0, step k ends at (k + 1)/10 s.
const STRAIGHT = scene([{ id: 'e', pts: [[0, 0], [20, 0]] }], { 'park.a': [0, 0], 'rack.b': [20, 0] }, { ...VEHICLE, speed: 3 });
const straightRun = profile(20, 2, 1, 1);
const straightSteps = [0, 9, 19, 49, 99, 109, 115, 118, 119, 139];
const straightArrays = Object.fromEntries(straightSteps.map((k) => [k, { pos: [[near(straightRun.at(end(k))), 0]] }]));
straightArrays[0].state = [STATE.driving];
straightArrays[119].state = [STATE.parked];
const straightProgram = dispatch('straight', 'lib:lanes@1', [bayOf(STRAIGHT, 'park.a')], [{ at: 0, v: 0, bay: bayOf(STRAIGHT, 'rack.b') }], 0.1);
const straightFixture = fixture('straight', {
  items: STRAIGHT.items, item: item(STRAIGHT, straightProgram, writes(1)), track: [], steps: 140,
  expect: { arrays: straightArrays, tolerance: { abs: 1e-6 } },
  answer: 'One vehicle, top speed 3 m/s, on the 20 m edge e with a 2 m/s limit, 1 m/s² each way, at 10 Hz, sent from park.a to rack.b at step 0. The limit holds it to 2 m/s: up 2 s over 2 m (s = t²/2), 16 m at 2 m/s in 8 s, down 2 s over 2 m (s = 20 − (12 − t)²/2): rest to rest in 12 s. Step k ends at t = (k + 1)/10 s, so pos at step k is (s(t), 0): driving at step 0, parked at rack.b at step 119.',
});

// The merge: a (from park.w, 20 m west) and b (from park.s, 20 m south) meet c1 at J (0, 0), a junction of three path
// ends whose zone reaches 1.25 m along each; c1 (6.25 m, to rack.m) is cut into c1.0 [1.25, 3.75] and c1.1, c2 runs on
// 10 m to dock.e. Both start at rest, 2 m/s, so each asks for J with c1.0 once J's zone (18.75 m along) is within its
// horizon, 2 × 0.1 + 2²/2 = 2.2 m, of its front, a length's half ahead of its centre: at step 88 for both. Vehicle 0
// asks first and takes them; vehicle 1 can't, and comes to rest with its front at J's zone, its centre at 17.75 m,
// (0, −2.25), at 10.875 s, inside step 108. Vehicle 0's rear passes c1.0's end, its centre at 24.75 m, at 13.375 s,
// inside step 133, which gives c1.0 back; vehicle 1 asks again in that step and goes, 8.5 m on to rack.m from 13.3 s.
const MERGE = scene([
  { id: 'a', pts: [[-20, 0], [0, 0]] }, { id: 'b', pts: [[0, -20], [0, 0]] },
  { id: 'c1', pts: [[0, 0], [6.25, 0]] }, { id: 'c2', pts: [[6.25, 0], [16.25, 0]] },
], { 'dock.e': [16.25, 0], 'park.s': [0, -20], 'park.w': [-20, 0], 'rack.m': [6.25, 0] }, VEHICLE);
const free = profile(36.25, 2, 1, 1), toStop = profile(17.75, 2, 1, 1), rest = profile(8.5, 2, 1, 1);
const askAt = Array.from({ length: 200 }, (_, k) => k).find((k) => 1 + free.at(k / 10) + 2.2 >= 18.75);
const rests = Math.ceil(toStop.T * 10 - 1e-9) - 1, goes = Math.ceil((2 + 22.75 / 2) * 10 - 1e-9) - 1;
if (askAt !== 88 || rests !== 108 || goes !== 133) throw Error(`the merge's timeline: ${askAt}, ${rests}, ${goes}`);
const v0At = (k) => [near(-20 + free.at(end(k))), 0];
const v1At = (k) => {
  const s = end(k) <= goes / 10 ? toStop.at(end(k)) : 17.75 + rest.at(end(k) - goes / 10);
  return s <= 20 ? [0, near(-20 + s)] : [near(s - 20), 0];
};
const mergeSteps = [0, 20, 40, 60, 80, 87, 109, 115, 120, 125, 132, 133, 140, 160, 180, 200, 219];
const mergeArrays = Object.fromEntries(mergeSteps.map((k) => [k, { pos: [v0At(k), v1At(k)] }]));
for (const k of [109, 120, 132]) mergeArrays[k].state = [STATE.driving, STATE.waiting];
mergeArrays[133].state = [STATE.driving, STATE.driving];
const mergeProgram = dispatch('merge', 'lib:lanes@1', [bayOf(MERGE, 'park.w'), bayOf(MERGE, 'park.s')],
  [{ at: 0, v: 0, bay: bayOf(MERGE, 'dock.e') }, { at: 0, v: 1, bay: bayOf(MERGE, 'rack.m') }], 0.1);
const mergeFixture = fixture('merge', {
  items: MERGE.items, item: item(MERGE, mergeProgram, writes(2)), track: [], steps: 220,
  expect: { arrays: mergeArrays, tolerance: { abs: 1e-6 } },
  answer: 'Lanes a (from park.w, 20 m west) and b (from park.s, 20 m south) meet c1 at the junction J (0, 0), whose zone reaches (2 + 0.5)/2 = 1.25 m along each; c1.0 is [1.25, 3.75] along c1. Both vehicles start at rest, 2 m/s, 1 m/s² each way, horizon 2 × 0.1 + 2²/2 = 2.2 m, so both ask for J with c1.0 at step 88; vehicle 0 asks first and takes them, vehicle 1 waits with its front at J\'s zone, centre (0, −2.25), from 10.875 s. Vehicle 0 runs on unchecked to dock.e (36.25 m); its rear passes the end of c1.0 at 13.375 s, inside step 133, and vehicle 1 goes in that step, on to rack.m from rest at 13.3 s.',
});

// The lift: park.p (0, 0), rack.r (10.1, 0), dock.d (20, 0); a 1 m/s mast to 6 m. Step 0 lifts the forks to 0.1 m (one
// step); then, each time the vehicle is parked, it takes a load and goes to the rack (phase 1: from 0.1 s, at rest at
// 7.15 s, inside step 71), lifts to 5.4 m (phase 2, from step 72: 0.1 m a step, 5.4 m at step 124), sets the load down at
// its forks' point, 1 m ahead of its centre at 5.4 m, and lowers to 0.1 m (phase 3, from step 125), then goes on to
// dock.d (phase 4, from step 178: 9.9 m, at rest within step 247). It writes its phase.
const LIFT = scene([{ id: 'p', pts: [[0, 0], [10.1, 0]] }, { id: 'q', pts: [[10.1, 0], [20, 0]] }],
  { 'dock.d': [20, 0], 'park.p': [0, 0], 'rack.r': [10.1, 0] }, { ...VEHICLE, lift: { max: 6, speed: 1 } });
const liftWrites = writes(1, { phase: { type: 'i32' } });
const PHASE = WRITES_AT + 16 + 8 + 8 + 8 + 8 + 24, STATE_ARRAY = WRITES_AT + 32;
const [park, rack, dock] = ['park.p', 'rack.r', 'dock.d'].map((b) => bayOf(LIFT, b));
const S = `(i32.const ${STATE_AT})`, V0 = '(i32.const 0)';
const liftProgram = program('lift', `${head('lib:lanes@1')}${init([park])}
  (func (export "step") (param $k i64) (local $ph i32)
    (local.set $ph (i32.load (i32.const ${VARS_AT})))
    (block $done
      (if (i64.eqz (local.get $k)) (then (call $lift ${S} ${V0} (f64.const 0.1)) (br $done)))
      (br_if $done (i32.ne (i32.load (i32.const ${STATE_ARRAY})) (i32.const ${STATE.parked})))
      (if (i32.eq (local.get $ph) (i32.const 0))
        (then (call $carry ${S} ${V0}) (drop (call $park ${S} ${V0} (i32.const ${rack}))) (local.set $ph (i32.const 1)) (br $done)))
      (if (i32.eq (local.get $ph) (i32.const 1))
        (then (call $lift ${S} ${V0} (f64.const 5.4)) (local.set $ph (i32.const 2)) (br $done)))
      (if (i32.eq (local.get $ph) (i32.const 2))
        (then (call $set_down ${S} ${V0}) (call $lift ${S} ${V0} (f64.const 0.1)) (local.set $ph (i32.const 3)) (br $done)))
      (if (i32.eq (local.get $ph) (i32.const 3))
        (then (drop (call $park ${S} ${V0} (i32.const ${dock}))) (local.set $ph (i32.const 4)))))
    (i32.store (i32.const ${VARS_AT}) (local.get $ph))
    ${go(0.1)}
    (i32.store (i32.const ${PHASE}) (local.get $ph)))
  (data (i32.const 8192) "\\00"))`);
const leg = profile(10.1, 2, 1, 1);
const liftArrays = { 0: { fork: [0.1], state: [STATE.parked] } };
for (const k of [1, 10, 30, 50, 70]) {
  const x = near(leg.at(end(k) - 0.1));
  liftArrays[k] = { pos: [[x, 0]], fork: [0.1], load: [[near(x + 1), 0.1, 0]], phase: [1] };
}
Object.assign(liftArrays, {
  72: { fork: [0.2], state: [STATE.lifting], phase: [2] }, 100: { fork: [3], state: [STATE.lifting] }, 124: { fork: [5.4], load: [[11.1, 5.4, 0]] },
  125: { load: [[11.1, 5.4, 0]], phase: [3], state: [STATE.lowering] }, 150: { fork: [2.8], load: [[11.1, 5.4, 0]] },
  178: { fork: [0.1], phase: [4], state: [STATE.driving] },
  259: { pos: [[20, 0]], fork: [0.1], load: [[11.1, 5.4, 0]], state: [STATE.parked], phase: [4] },
});
const liftFixture = fixture('lift', {
  items: LIFT.items, item: item(LIFT, liftProgram, liftWrites), track: [], steps: 260,
  expect: { arrays: liftArrays, tolerance: { abs: 1e-6 } },
  answer: 'One vehicle with a 1 m/s mast at park.p, at 10 Hz. Step 0 lifts the forks from 0 to 0.1 m in one step; step 1 takes the load and sends it 10.1 m to rack.r (from 0.1 s, at rest at 7.15 s, step 71), the load on the forks\' point, 1 m ahead of the centre at 0.1 m. Step 72 lifts to 5.4 m at 0.1 m a step (3 m at step 100, 5.4 m at step 124, 5.3 s); step 125 sets the load down at the forks\' point, (11.1, 5.4, 0) as [x, height, y], and lowers (2.8 m at step 150, 0.1 m at step 177); step 178 goes on to dock.d, parked there at step 259 with the load still at the rack level\'s pose.',
});

// The reference library's own fixture (#190's rule): the straight run, linking it by its own name.
const REF = 'lanes_ref@1.0.0';
const ownProgram = dispatch('straight_own', 'lib:lanes_ref', [bayOf(STRAIGHT, 'park.a')], [{ at: 0, v: 0, bay: bayOf(STRAIGHT, 'rack.b') }], 0.1);
const ownFixture = fixture('straight_own', {
  items: STRAIGHT.items, item: item(STRAIGHT, ownProgram, writes(1), [{ name: REF, asset: reference }]), track: [], steps: 126,
  expect: { arrays: { 0: { state: [STATE.driving] }, 125: { state: [STATE.parked], pos: [[20, 0]] } } },
  answer: 'The straight run of lanes@1\'s fixture straight, importing lanes_ref by its own name: driving at step 0, parked at rack.b (20, 0) from step 119.',
});

// ---------------------------------------------------------------------------------------------------

const fixtures = [straightFixture, mergeFixture, liftFixture];
const layout = 'lanes.state@1';
const manifest = {
  name: 'lanes', version: '1.0.0', license: 'Apache-2.0',
  description: 'lanes@1 (#981): vehicles on a lane graph built at check from a piece\'s floor paths, with zones, reservations, quickest routes, a loop broken where it forms, closed-form motion and a lift. Its fixtures\' expected values come from the rest-to-rest profile and the reservation rule; its planted library takes a junction whether or not it is held, and fails the merge. Written by scripts/lanes-pack.mjs; the library is src/lanes.rs, its layouts are LAYOUT.md, and each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'lanes@1': {
      exports: EXPORTS, layout, fixtures, planted: [planted],
      digest: sha256(canonical({ exports: EXPORTS, layout, fixtures })),
      rules: { 'lanes.clear': {}, 'lanes.stuck': { max_wait: 60 } },
    },
  },
  libs: { [REF]: { asset: reference, exports: EXPORTS.map((e) => e.name), fixtures: [ownFixture], implements: ['lanes@1'] } },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; lanes@1 digest ${manifest.interfaces['lanes@1'].digest}`);
