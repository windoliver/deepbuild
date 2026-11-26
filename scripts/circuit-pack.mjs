// Writes the first-party pack packs/circuit-1.0.0 (#1181; canvas primitives: Logic: library interfaces): circuit@1,
// sources, loads, plugs, fuses, earth and meters, with its exports, its state layout circuit.state@1, its kind rules
// and their kit's planted twins, the constants its circuits read (carrier densities and fuse curves, each with its
// source), fixtures whose expected values are worked out here by hand from Ohm's law and the closed forms (never from a
// library), its reference library circuit_ref@1.0.0 with a fixture of its own, and three planted libraries that must
// each fail one of the fixtures. The library is src/circuit.rs, built by rustc into relocatable objects (the planted
// ones with --cfg kept_current, rated_meter and late_fuse); the fixtures' programs are WebAssembly text, assembled into
// relocatable objects by an assembler that takes `<out-dir> --program <file.wat>` (tests/acceptance/416/interfaces/wat
// builds one):
//
//   node scripts/circuit-pack.mjs <assembler>
//
// objects/, fixtures/, src/*.wat and pack.json are written whole each run; src/circuit.rs and LAYOUT.md are kept. A
// changed fixture, export or layout changes circuit@1's digest, which takes a new major.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/circuit-pack.mjs <assembler>');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'packs', 'circuit-1.0.0');
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
  const dir = mkdtempSync(join(tmpdir(), 'circuit-pack-'));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------
// The constants a circuit reads, each with its source. The check copies a wire's carrier density and a fuse's time
// constant into the table it builds (LAYOUT.md); the judge reads the curves from here.

const N_A = 6.02214076e23;
const CONSTANTS = {
  carriers: {
    copper: { value: 8.5e28, unit: 'm^-3', source: 'one conduction electron an atom: 8.96 g/cm^3 / 63.546 g/mol x N_A = 8.49e28 m^-3 (the issue\'s 8.5 x 10^28)' },
    aluminium: { value: 1.8e29, unit: 'm^-3', source: 'three conduction electrons an atom: 2.70 g/cm^3 / 26.98 g/mol x N_A x 3 = 1.81e29 m^-3 (the issue\'s 1.8 x 10^29)' },
  },
  curves: {
    fast: { tau: 1, unit: 's', source: 'a fuse element heated by i^2 and cooling in proportion to its rise melts after tau ln(I^2 / (I^2 - In^2)); tau 1 s puts 2.1, 2.75, 4 and 10 x In at 257 ms, 142 ms, 64.5 ms and 10.05 ms, inside the quick-acting band of IEC 60127-2' },
    slow: { tau: 10, unit: 's', source: 'the same heat balance with tau 10 s: 2.57 s, 1.42 s, 645 ms and 100.5 ms at 2.1, 2.75, 4 and 10 x In, inside the time-lag band of IEC 60127-2' },
  },
  charge: { value: 1.602176634e-19, unit: 'C', source: 'the elementary charge, exact in the SI since 2019' },
};
const check = Math.abs(8.96 / 63.546 * N_A * 1e6 - 8.5e28) / 8.5e28 < 0.01 && Math.abs(2.70 / 26.98 * N_A * 3e6 - 1.8e29) / 1.8e29 < 0.01;
if (!check) throw Error('a carrier density no longer agrees with its source');

// ---------------------------------------------------------------------------------------------------
// The library: rustc's relocatable object of src/circuit.rs, functions only, importing nothing but the caller's memory.

const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))[1];
const BUILDERS = ['node', 'source_dc', 'source_ac', 'resistor', 'load', 'switch', 'connector', 'fuse', 'meter', 'wire', 'fault'];
const EXPORTS = [
  ...BUILDERS.map((name) => ({ name, params: ['i32', 'i32', 'i32'], results: ['i32'] })),
  { name: 'solve', params: ['i32', 'i32', 'i64', 'i64'], results: ['i32'] },
];
function library(name, cfg) {
  const bytes = scratch((dir) => {
    const out = join(dir, `${name}.o`);
    const run = spawnSync('rustc', [
      '--target', 'wasm32-unknown-unknown', '--crate-type=lib', '--crate-name', 'circuit', '--edition', '2021', '--emit=obj',
      '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'target-cpu=mvp', '-C', 'debuginfo=0',
      '-C', 'target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint', ...(cfg ? ['--cfg', cfg] : []),
      '-o', out, join(OUT, 'src', 'circuit.rs'),
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
const reference = library('circuit_ref', null);
// The planted libraries: one keeps every part's current while a connector is open; one meters a load's rating; one
// opens its fuses at ten times their curve's time.
const kept = library('kept_current', 'kept_current');
const rated = library('rated_meter', 'rated_meter');
const late = library('late_fuse', 'late_fuse');

// ---------------------------------------------------------------------------------------------------
// The fixtures' programs: the read region at 0, writes at 4096, 8 bytes of data at 49152, the built table (asset 0)
// at assets_at + 4, the state at 1 MiB; 32 pages. init adds every node, then every part with its kind's builder; each
// step solves the circuit's step k at the item's rate and copies the state's head over the write region.

const READS_AT = 0, WRITES_AT = 4096, DATA_AT = 49152, ASSETS_AT = 262144, STATE_AT = 1 << 20, PAGES = 32;
const FLICKS = 705_600_000;
/** circuit.state@1's arrays for n nodes and p parts, in the head's order (LAYOUT.md: circuit.state@1). */
const writesOf = (c) => {
  const [n, p] = [c.nodes.length, c.parts.length];
  return {
    v: { type: 'f64', count: n }, i_rms: { type: 'f64', count: p }, i: { type: 'f64', count: p }, p: { type: 'f64', count: p },
    r: { type: 'f64', count: p }, on: { type: 'i32', count: p }, energy: { type: 'f64', count: p }, kwh: { type: 'f64', count: p },
    drift: { type: 'f64', count: p }, drift_x: { type: 'f64', count: p },
  };
};
const headSize = (c) => Object.values(writesOf(c)).reduce((s, w) => s + Math.ceil(((w.type === 'f64' ? 8 : 4) * w.count) / 8) * 8, 0);
const sigOf = (e) => `(param ${e.params.join(' ')}) (result ${e.results.join(' ')})`;
const S = `(i32.const ${STATE_AT})`, G = `(i32.const ${ASSETS_AT + 4})`;

function program(name, module, c, rate) {
  const kinds = new Set(c.parts.map((p) => p.kind));
  const used = EXPORTS.filter((e) => e.name === 'node' || e.name === 'solve' || kinds.has(e.name));
  const text = `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
${used.map((e) => `  (import "${module}" "${e.name}" (func $${e.name} ${sigOf(e)}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func (export "init") (param $seed i64)
    ${[...c.nodes.map((_, i) => `(drop (call $node ${S} ${G} (i32.const ${i})))`), ...c.parts.map((p, i) => `(drop (call $${p.kind} ${S} ${G} (i32.const ${i})))`)].join('\n    ')})
  (func (export "step") (param $k i64)
    (drop (call $solve ${S} (i32.const ${READS_AT}) (local.get $k) (i64.const ${rate})))
    (memory.copy (i32.const ${WRITES_AT}) ${S} (i32.const ${headSize(c)})))
  (data (i32.const ${DATA_AT}) "\\00\\00\\00\\00\\00\\00\\00\\00"))`;
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
const entry = (control, k, rate, value, seq) => ({ t: (k * FLICKS) / rate, seq, control, value, writer: 'you', player: 1 });
const TOLERANCE = { abs: 1e-15, rel: 1e-9 };
const INTERFACE = 'lib:circuit@1';
/** A fixture of circuit `c` at `rate` Hz, reading `inputs`, its item importing `module` and linking `links`. */
function fixture(name, { c, rate, inputs = [], track = [], steps, expect, answer, module = INTERFACE, links }) {
  const sha = program(name, module, c, rate);
  const params = {
    program: sha, step_rate: rate, ...(inputs.length ? { reads: inputs } : {}), writes: writesOf(c), circuit: c,
    budget: { fuel: 10_000_000 }, ...(links ? { links } : {}),
  };
  const f = {
    name, item: { kind: 'logic@1', params }, ...(inputs.length ? { controls: Object.fromEntries(inputs.map((i) => [i, { kind: 'slider' }])) } : {}),
    track, steps, expect: { arrays: expect, tolerance: TOLERANCE }, answer,
  };
  return put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify(f, null, 2)}\n`));
}
/** An array of p parts, `at` giving some by index, the rest 0. */
const parts = (p, at) => Array.from({ length: p }, (_, j) => at[j] ?? 0);
const mains = (from, to) => ({ id: 'mains', kind: 'source_ac', from, to, v_rms: 230, f: 50 });
const LAMP_R = 230 * 230 / 4.6; // 11,500 Ω
const crest = (turns) => 0.02 * Math.SQRT2 * Math.sin(2 * Math.PI * turns);

// The plug: a 230 V, 50 Hz source, a plug on `plug_in` into a 4.6 W lamp, a meter on the lamp; 1,000 steps a second,
// the plug in at step 0 and out at step 3. The kit's example for circuit.kcl: a library that keeps the lamp lit with
// the plug out leaves the plug's two nodes unbalanced at step 3.
const PLUG = {
  nodes: ['neutral', 'live', 'pin'],
  parts: [mains('neutral', 'live'), { id: 'plug', kind: 'connector', from: 'live', to: 'pin', closed_by: 'plug_in' },
    { id: 'lamp', kind: 'load', from: 'pin', to: 'neutral', p_rated: 4.6, v_rated: 230 }, { id: 'meter', kind: 'meter', on: 'lamp' }],
};
const plugFixture = fixture('plug', {
  c: PLUG, rate: 1000, inputs: ['plug_in'], steps: 6, track: [entry('plug_in', 0, 1000, 1, 1), entry('plug_in', 3, 1000, 0, 2)],
  expect: {
    0: { i_rms: parts(4, [0.02, 0.02, 0.02]), i: parts(4, []), p: parts(4, [4.6, 0, 4.6]), r: parts(4, [0, 0, LAMP_R]), on: [1, 1, 1, 0], energy: parts(4, { 3: 0.0046 }) },
    2: { i: parts(4, [crest(0.1), crest(0.1), crest(0.1)]), v: [0, 230 * Math.SQRT2 * Math.sin(0.2 * Math.PI), 230 * Math.SQRT2 * Math.sin(0.2 * Math.PI)], energy: parts(4, { 3: 0.0138 }) },
    3: { i_rms: parts(4, []), i: parts(4, []), p: parts(4, []), on: [1, 0, 1, 0], energy: parts(4, { 3: 0.0138 }), kwh: parts(4, { 3: 0.0138 / 3.6e6 }) },
  },
  answer: 'R = 230² ÷ 4.6 = 11,500 Ω; with the plug in, I = 230 ÷ 11,500 = 0.02 A rms in the source, the plug and the lamp, and P = 4.6 W in the source and the lamp (the plug has no resistance and takes none). At step k, t = k ÷ 1,000 s, each current is 0.02 × √2 × sin(2π × 50 × t): 0 at step 0, 0.02√2 sin(0.2π) = 0.016625 A at step 2, and the live and pin nodes 230√2 sin(0.2π) = 191.17 V. The meter counts 4.6 W × 1 ms a step, this step\'s included: 4.6 mJ at step 0, 13.8 mJ at step 2. The plug comes out at step 3: no current, no power, the plug and the meter not conducting, the meter still 13.8 mJ (3.83 × 10⁻⁹ kWh).',
});

// The kettle: 2,400 W at 230 V behind its switch on `kettle_on`, a meter on it; 120 steps a second, the switch on at
// step 2. The kit's example for circuit.power: a meter counting the kettle's rating reads 20 J at step 0.
const KETTLE = {
  nodes: ['neutral', 'live', 'element'],
  parts: [mains('neutral', 'live'), { id: 'switch', kind: 'switch', from: 'live', to: 'element', closed_by: 'kettle_on' },
    { id: 'kettle', kind: 'load', from: 'element', to: 'neutral', p_rated: 2400, v_rated: 230 }, { id: 'meter', kind: 'meter', on: 'kettle' }],
};
const kettleFixture = fixture('kettle', {
  c: KETTLE, rate: 120, inputs: ['kettle_on'], steps: 4, track: [entry('kettle_on', 0, 120, 0, 1), entry('kettle_on', 2, 120, 1, 2)],
  expect: {
    1: { p: parts(4, []), energy: parts(4, []), on: [1, 0, 1, 0] },
    2: { i_rms: parts(4, [2400 / 230, 2400 / 230, 2400 / 230]), p: parts(4, [2400, 0, 2400]), energy: parts(4, { 3: 20 }), on: [1, 1, 1, 0] },
    3: { energy: parts(4, { 3: 40 }), kwh: parts(4, { 3: 40 / 3.6e6 }) },
  },
  answer: 'The kettle is 230² ÷ 2,400 = 22.0417 Ω, so on 230 V it takes 2,400 W and 2,400 ÷ 230 = 10.4348 A. At 120 steps a second a step is 1/120 s: 2,400 W × 1/120 s = 20 J a step. The switch is open at steps 0 and 1: no current, no power, the meter at 0. Closed from step 2: 20 J at step 2 and 40 J (1.11 × 10⁻⁵ kWh) at step 3, each step\'s own power included.',
});

// The fault: a 3 A fast fuse from live, the lamp, and a 1 Ω fault on `fault` from the fused live to a case earthed by a
// 0 Ω earth wire to neutral; 100,000 steps a second, the fault on at step 10. The kit's example for circuit.fuse.
const FAULT = {
  nodes: ['neutral', 'live', 'fused', 'case'],
  parts: [mains('neutral', 'live'), { id: 'fuse', kind: 'fuse', from: 'live', to: 'fused', rating: 3, curve: 'fast' },
    { id: 'lamp', kind: 'load', from: 'fused', to: 'neutral', p_rated: 4.6, v_rated: 230 },
    { id: 'fault', kind: 'fault', from: 'fused', to: 'case', r: 1, on_by: 'fault' }, { id: 'earth', kind: 'resistor', from: 'case', to: 'neutral', r: 0 }],
};
const blow = 230.02;
const opens = 10 + Math.ceil(CONSTANTS.curves.fast.tau * Math.log(blow * blow / (blow * blow - 9)) * 100_000);
if (opens !== 28) throw Error(`the fault's fuse opens at ${opens}, not 28`);
const faultFixture = fixture('fault', {
  c: FAULT, rate: 100_000, inputs: ['fault'], steps: 200, track: [entry('fault', 0, 100_000, 0, 1), entry('fault', 10, 100_000, 1, 2)],
  expect: {
    9: { i_rms: parts(5, [0.02, 0.02, 0.02, 0, 0]), on: [1, 1, 1, 0, 1] },
    10: { i_rms: parts(5, [blow, blow, 0.02, 230, 230]), on: [1, 1, 1, 1, 1] },
    27: { on: [1, 1, 1, 1, 1] },
    28: { i_rms: parts(5, []), i: parts(5, []), p: parts(5, []), on: [1, 0, 1, 1, 1] },
  },
  answer: 'Before the fault the fuse and the lamp carry 230 ÷ 11,500 = 0.02 A and the earth wire nothing (the case joins nothing else). From step 10 the fault puts 1 Ω from the fused live to the case, earthed with no resistance: 230 A through it and the earth, 230.02 A through the fuse and the source. The fast curve (τ 1 s, constants.curves.fast) gives 1 s × ln(230.02² ÷ (230.02² − 3²)) = 170.117 µs at that current, 17.01 steps of 10 µs, so the fuse opens at the first step 18 steps after the fault, step 28, and from then no part carries current. A fuse opening at ten times its curve\'s time would open at step 10 + 171 = 181.',
});

// The battery: 12 V DC behind 0.5 Ω, a 1 A slow fuse reset by `fuse_reset`, 5.5 Ω, a meter on the battery and 1 m of
// 1 mm² aluminium on the resistor; 10 steps a second. 2 A melts the slow fuse in 10 s × ln(4 ÷ 3) = 2.8768 s, so at
// step 29; reset at step 35, it carries again and melts 29 steps later, at step 64.
const BATTERY = {
  nodes: ['minus', 'plus', 'fused'],
  parts: [{ id: 'cell', kind: 'source_dc', from: 'minus', to: 'plus', v: 12, r_internal: 0.5 },
    { id: 'fuse', kind: 'fuse', from: 'plus', to: 'fused', rating: 1, curve: 'slow', reset_by: 'fuse_reset' },
    { id: 'heater', kind: 'resistor', from: 'fused', to: 'minus', r: 5.5 }, { id: 'meter', kind: 'meter', on: 'cell' },
    { id: 'lead', kind: 'wire', part: 'heater', length: 1, area: 1, material: 'aluminium' }],
};
const DRIFT_AL = 2 / (CONSTANTS.carriers.aluminium.value * 1e-6 * CONSTANTS.charge.value);
const melt = Math.ceil(CONSTANTS.curves.slow.tau * Math.log(4 / 3) * 10);
if (melt !== 29) throw Error(`the battery's fuse melts after ${melt} steps, not 29`);
const batteryFixture = fixture('battery', {
  c: BATTERY, rate: 10, inputs: ['fuse_reset'], steps: 70, track: [entry('fuse_reset', 35, 10, 1, 1)],
  expect: {
    0: { v: [0, 11, 11], i_rms: parts(5, [2, 2, 2]), i: parts(5, [2, 2, 2]), p: parts(5, [22, 0, 22]), r: parts(5, [0.5, 0, 5.5]), on: [1, 1, 1, 0, 0], energy: parts(5, { 3: 2.2 }), drift: parts(5, { 4: DRIFT_AL }), drift_x: parts(5, {}) },
    10: { drift_x: parts(5, { 4: DRIFT_AL * 1 }) },
    28: { on: [1, 1, 1, 0, 0], energy: parts(5, { 3: 29 * 2.2 }) },
    29: { i_rms: parts(5, []), p: parts(5, []), on: [1, 0, 1, 0, 0], energy: parts(5, { 3: 29 * 2.2 }), drift_x: parts(5, { 4: DRIFT_AL * 2.9 }) },
    34: { on: [1, 0, 1, 0, 0], drift_x: parts(5, { 4: DRIFT_AL * 2.9 }) },
    35: { i_rms: parts(5, [2, 2, 2]), on: [1, 1, 1, 0, 0] },
    63: { on: [1, 1, 1, 0, 0] },
    64: { on: [1, 0, 1, 0, 0], energy: parts(5, { 3: 58 * 2.2 }) },
  },
  answer: '12 V behind 0.5 Ω into 5.5 Ω: I = 12 ÷ 6 = 2 A, the terminals at 12 − 2 × 0.5 = 11 V, the battery giving 11 × 2 = 22 W at them and the heater taking 2² × 5.5 = 22 W. A step is 0.1 s, so the meter adds 2.2 J a step. 1 mm² of aluminium (1.8 × 10²⁹ m⁻³, constants.carriers) drifts at 2 ÷ (1.8 × 10²⁹ × 10⁻⁶ × 1.602176634 × 10⁻¹⁹) = 6.9350 × 10⁻⁵ m/s, and with a steady current the electrons move that much a second: 6.9350 × 10⁻⁵ m by step 10 (t = 1 s). The slow fuse (τ 10 s) at twice its rating opens after 10 s × ln(2² ÷ (2² − 1)) = 2.8768 s, 28.77 steps: at step 29, after 29 steps of 2.2 J, and the displacement stays where the current stopped, 2.9 s of drift. fuse_reset turns on at step 35: the fuse closes cold, carries 2 A again and opens 29 steps later, at step 64, after 58 steps of 2.2 J in all.',
});

// The phase: 120 V rms at 60 Hz, phase 90°, behind 2 Ω, into 58 Ω; 240 steps a second, so a step is a quarter cycle.
const PHASE = {
  nodes: ['n', 'a'],
  parts: [{ id: 'gen', kind: 'source_ac', from: 'n', to: 'a', v_rms: 120, f: 60, phase: 90, r_internal: 2 }, { id: 'load', kind: 'resistor', from: 'a', to: 'n', r: 58 }],
};
const phaseFixture = fixture('phase', {
  c: PHASE, rate: 240, steps: 3,
  expect: {
    0: { i_rms: [2, 2], i: [2 * Math.SQRT2, 2 * Math.SQRT2], p: [232, 232], v: [0, 116 * Math.SQRT2], r: [2, 58] },
    1: { i: [0, 0], v: [0, 0] },
    2: { i: [-2 * Math.SQRT2, -2 * Math.SQRT2], v: [0, -116 * Math.SQRT2] },
  },
  answer: '120 V rms behind 2 Ω into 58 Ω: 120 ÷ 60 = 2 A rms, the terminals at 120 − 2 × 2 = 116 V rms, the source giving 116 × 2 = 232 W there and the load taking 2² × 58 = 232 W. The wave is √2 × sin(2π × 60 × t + 90°): at step k, t = k ÷ 240 s, a quarter cycle a step, so sin(90°), sin(180°), sin(270°) = 1, 0, −1: the current 2√2, 0, −2√2 A and node a 116√2, 0, −116√2 V.',
});

// The reference library's own fixture (#190's rule): a lamp straight on the mains, importing it by its own name.
const REF = 'circuit_ref@1.0.0';
const OWN = { nodes: ['neutral', 'live'], parts: [mains('neutral', 'live'), { id: 'lamp', kind: 'load', from: 'live', to: 'neutral', p_rated: 4.6, v_rated: 230 }] };
const ownFixture = fixture('lamp_own', {
  c: OWN, rate: 1000, steps: 1, module: 'lib:circuit_ref', links: [{ name: REF, asset: reference }],
  expect: { 0: { i: [0, 0], on: [1, 1] } },
  answer: 'circuit@1\'s lamp straight on the mains, importing circuit_ref by its own name: both parts conduct, and at t = 0 the sine and so each current is 0. A library\'s own fixture is compared exactly, so it holds only values that are exact.',
});

// ---------------------------------------------------------------------------------------------------

const fixtures = [plugFixture, kettleFixture, faultFixture, batteryFixture, phaseFixture];
const layout = 'circuit.state@1';
const manifest = {
  name: 'circuit', version: '1.0.0', license: 'Apache-2.0',
  description: 'circuit@1 (#1181): nodes and the parts between them (DC and AC sources, resistors, loads given by rated power at a rated voltage, switches and connectors closed while an input says so, fuses on a melt curve, earth faults, meters and wires), solved each step by nodal analysis, AC as rms phasors with each instant in closed form at the step\'s time. Its fixtures\' expected values are worked by hand from Ohm\'s law and the closed forms. Its planted libraries keep a lamp lit with the plug out, meter a load\'s rating, and open a fuse at ten times its curve\'s time; each fails a fixture and is its kind kit\'s twin for circuit.kcl, circuit.power and circuit.fuse. Written by scripts/circuit-pack.mjs; the library is src/circuit.rs, its layouts are LAYOUT.md, and each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'circuit@1': {
      exports: EXPORTS, layout, fixtures, planted: [kept, rated, late],
      digest: sha256(canonical({ exports: EXPORTS, layout, fixtures })),
      rules: { 'circuit.kcl': { tolerance: 1e-9 }, 'circuit.power': { tolerance: 1e-6 }, 'circuit.fuse': {} },
      twins: [
        { planted: kept, example: plugFixture, expect: 'circuit.kcl' },
        { planted: rated, example: kettleFixture, expect: 'circuit.power' },
        { planted: late, example: faultFixture, expect: 'circuit.fuse' },
      ],
      constants: CONSTANTS,
    },
  },
  libs: { [REF]: { asset: reference, exports: EXPORTS.map((e) => e.name), fixtures: [ownFixture], implements: ['circuit@1'] } },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; circuit@1 digest ${manifest.interfaces['circuit@1'].digest}`);
