import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/circuit2-pack.mjs <assembler>');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'packs', 'circuit-2.0.0');
for (const d of ['objects', 'fixtures']) rmSync(join(OUT, d), { recursive: true, force: true });
for (const f of readdirSync(join(OUT, 'src'))) if (f.endsWith('.wat')) rmSync(join(OUT, 'src', f));

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
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
  const dir = mkdtempSync(join(tmpdir(), 'circuit2-pack-'));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const N_A = 6.02214076e23;
const BANDS = 'the standard for household breakers (IEC 60898-1)';
const CONSTANTS = {
  carriers: {
    copper: { value: 8.5e28, unit: 'm^-3', source: 'one conduction electron an atom: 8.96 g/cm^3 / 63.546 g/mol x N_A = 8.49e28 m^-3' },
    aluminium: { value: 1.8e29, unit: 'm^-3', source: 'three conduction electrons an atom: 2.70 g/cm^3 / 26.98 g/mol x N_A x 3 = 1.81e29 m^-3' },
  },
  curves: {
    fast: { tau: 1, unit: 's', source: 'circuit@1\'s quick-acting fuse: tau ln(I^2 / (I^2 - In^2)) inside the quick-acting band of IEC 60127-2' },
    slow: { tau: 10, unit: 's', source: 'circuit@1\'s time-lag fuse: the same heat balance with tau 10 s, inside the time-lag band of IEC 60127-2' },
  },
  charge: { value: 1.602176634e-19, unit: 'C', source: 'the elementary charge, exact in the SI since 2019' },
  breaker: {
    tau: { value: 60, unit: 's', source: `the thermal element's time constant: with the opening heat 1.69 it holds 1.13 x In for good (heat 1.2769) and opens after 97.72 s at 1.45 x In and 18.06 s at 2.55 x In, inside ${BANDS}: hold 1.13 x In for an hour, open at 1.45 x In within an hour and at 2.55 x In between 1 s and 60 s` },
    heat_open: { value: 1.69, source: 'the thermal element opens at the start of the first step its heat has reached 1.3^2, the current 1.3 x In would hold it at: between the 1.13 x In it must hold and the 1.45 x In it must open at' },
    curves: {
      B: { multiple: 4, band: [3, 5], source: `the magnetic element opens at 4 x In, inside ${BANDS}'s instantaneous band for type B, 3 to 5 x In` },
      C: { multiple: 7.5, band: [5, 10], source: `7.5 x In, inside ${BANDS}'s band for type C, 5 to 10 x In` },
      D: { multiple: 15, band: [10, 20], source: `15 x In, inside ${BANDS}'s band for type D, 10 to 20 x In` },
    },
  },
  rcd: {
    time: { value: 0.2, unit: 's', source: 'an RCD opens 0.2 s x rating / residual after its residual reached its rating: 0.2 s at its rating, 0.1 s at twice and 0.04 s at five times, inside the standard for household RCDs (IEC 61008-1), 0.3 s, 0.15 s and 0.04 s' },
    floor: { value: 0.01, unit: 's', source: 'that time is never under 0.01 s, a contact\'s opening' },
  },
};
{
  const { tau, heat_open: open } = CONSTANTS.breaker;
  const after = (x) => -tau.value * Math.log(1 - open.value / (x * x));
  if (!(1.13 ** 2 < open.value && after(1.45) < 3600 && after(2.55) > 1 && after(2.55) < 60)) throw Error('a breaker constant no longer agrees with its bands');
  if (after(1.45).toFixed(2) !== '97.72' || after(2.55).toFixed(2) !== '18.06') throw Error('the breaker no longer opens after 97.72 s at 1.45 x In and 18.06 s at 2.55 x In');
  for (const c of Object.values(CONSTANTS.breaker.curves)) if (!(c.multiple >= c.band[0] && c.multiple <= c.band[1])) throw Error('a curve multiple is out of its band');
  const t = (x) => Math.max(CONSTANTS.rcd.time.value / x, CONSTANTS.rcd.floor.value);
  if (!(t(1) <= 0.3 && t(2) <= 0.15 && t(5) <= 0.04)) throw Error('an RCD constant no longer agrees with its standard');
  if (Math.abs(8.96 / 63.546 * N_A * 1e6 - 8.5e28) / 8.5e28 > 0.01) throw Error('a carrier density no longer agrees with its source');
}

const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))[1];
const BUILDERS = ['node', 'source_dc', 'source_ac', 'resistor', 'load', 'switch', 'connector', 'fuse', 'meter', 'wire', 'fault', 'breaker', 'rcd', 'changeover', 'transformer'];
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
const PLANTED = Object.fromEntries(['no_magnetic', 'cold_reset', 'one_pole', 'both_ways', 'primary_current', 'late_set', 'late_fuse']
  .map((n) => [n, library(n, n)]));

const READS_AT = 0, WRITES_AT = 4096, DATA_AT = 49152, ASSETS_AT = 262144, STATE_AT = 1 << 20, PAGES = 32;
const FLICKS = 705_600_000;
const headOf = (c) => {
  const [n, p] = [c.nodes.length, c.parts.length];
  const f = (count) => ({ type: 'f64', count });
  return {
    v: f(n), i_rms: f(p), i: f(p), p: f(p), r: f(p), on: { type: 'i32', count: p }, energy: f(p), kwh: f(p),
    drift: f(p), drift_x: f(p), heat: f(p), residual: f(p), i2_rms: f(p), i2: f(p),
  };
};
const sizeOf = (ws) => Object.values(ws).reduce((s, w) => s + Math.ceil(((w.type === 'f64' ? 8 : 4) * w.count) / 8) * 8, 0);
const sigOf = (e) => `(param ${e.params.join(' ')}) (result ${e.results.join(' ')})`;
const S = `(i32.const ${STATE_AT})`, G = `(i32.const ${ASSETS_AT + 4})`;

function program(name, module, c, rate, own = '') {
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
    ${own}
    (drop (call $solve ${S} (i32.const ${READS_AT}) (local.get $k) (i64.const ${rate})))
    (memory.copy (i32.const ${WRITES_AT}) ${S} (i32.const ${sizeOf(headOf(c))})))
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
const TOLERANCE = { abs: 1e-12, rel: 1e-9 };
const INTERFACE = 'lib:circuit@2';
function fixture(name, { c, rate, inputs = [], track = [], steps, expect, answer, module = INTERFACE, links, more = {}, own, rules }) {
  const sha = program(name, module, c, rate, own);
  const params = {
    program: sha, step_rate: rate, ...(inputs.length ? { reads: inputs } : {}), writes: { ...headOf(c), ...more }, circuit: c,
    budget: { fuel: 10_000_000 }, ...(links ? { links } : {}),
  };
  const f = {
    name, item: { kind: 'logic@1', params }, ...(inputs.length ? { controls: Object.fromEntries(inputs.map((i) => [i, { kind: 'slider' }])) } : {}),
    track, steps, expect: { arrays: expect, tolerance: TOLERANCE }, answer, ...(rules ? { rules } : {}),
  };
  return put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify(f, null, 2)}\n`));
}
const parts = (p, at) => Array.from({ length: p }, (_, j) => at[j] ?? 0);
const mains = (from, to) => ({ id: 'mains', kind: 'source_ac', from, to, v_rms: 230, f: 50 });
const loadOf = (id, from, to, w) => ({ id, kind: 'load', from, to, p_rated: w, v_rated: 230 });
const steps = (m2, theta, open, a) => {
  const n = Math.log((m2 - open) / (m2 - theta)) / Math.log(a);
  if (Math.abs(n - Math.round(n)) < 1e-6) throw Error(`a heat lands on a step's edge: ${n}`);
  return Math.ceil(n);
};

const B = CONSTANTS.breaker;
const OVERLOAD = {
  nodes: ['neutral', 'live', 'board'],
  parts: [mains('neutral', 'live'), { id: 'breaker', kind: 'breaker', from: 'live', to: 'board', rating: 16, curve: 'B', reset_by: 'reset' },
    loadOf('heater', 'board', 'neutral', 2000), loadOf('oven', 'board', 'neutral', 3000), loadOf('kettle', 'board', 'neutral', 1000)],
};
const over = (() => {
  const rate = 10, a = Math.exp(-1 / rate / B.tau.value), I = 6000 / 230, m2 = (I / 16) ** 2;
  const trip = steps(m2, 0, B.heat_open.value, a);
  const heatAt = m2 * (1 - a ** trip);
  const reset = trip + 30 * rate;
  const cooled = heatAt * a ** (reset - trip);
  const again = reset + steps(m2, cooled, B.heat_open.value, a);
  return { rate, a, I, m2, trip, heatAt, reset, cooled, again };
})();
if (over.trip !== 606 || over.again !== 1220) throw Error(`the overload opens at ${over.trip} and ${over.again}, not 606 and 1220`);
const overloadFixture = fixture('overload', {
  c: OVERLOAD, rate: over.rate, inputs: ['reset'], steps: over.again + 2, track: [entry('reset', over.reset, over.rate, 1, 1)],
  expect: {
    0: { i_rms: parts(5, [over.I, over.I, 2000 / 230, 3000 / 230, 1000 / 230]), p: parts(5, [6000, 0, 2000, 3000, 1000]), on: [1, 1, 1, 1, 1], heat: parts(5, { 1: over.m2 * (1 - over.a) }) },
    [over.trip - 1]: { on: [1, 1, 1, 1, 1], heat: parts(5, { 1: over.m2 * (1 - over.a ** over.trip) }) },
    [over.trip]: { i_rms: parts(5, []), p: parts(5, []), on: [1, 0, 1, 1, 1], heat: parts(5, { 1: over.heatAt * over.a }) },
    [over.reset - 1]: { on: [1, 0, 1, 1, 1], heat: parts(5, { 1: over.cooled }) },
    [over.reset]: { i_rms: parts(5, [over.I, over.I, 2000 / 230, 3000 / 230, 1000 / 230]), on: [1, 1, 1, 1, 1] },
    [over.again - 1]: { on: [1, 1, 1, 1, 1] },
    [over.again]: { i_rms: parts(5, []), on: [1, 0, 1, 1, 1] },
  },
  answer: `The three loads take 2,000 + 3,000 + 1,000 = 6,000 W at 230 V: 26.087 A, 1.6304 times the breaker's 16 A, so its heat after n steps of 0.1 s is 1.6304² × (1 − e^(−0.1n/60)) = 2.6583 (1 − e^(−n/600)), which reaches the opening heat 1.69 after 600 × ln(2.6583 ÷ (2.6583 − 1.69)) = 605.93 steps: the breaker opens at step 606 (60.6 s), the first step it starts with that heat. Open, it carries nothing and cools by e^(−1/600) a step: 30 s later, at step 906, its heat is 1.0250, and the reset turns on there. It closes with that heat, so it reaches 1.69 again after 600 × ln((2.6583 − 1.0250) ÷ (2.6583 − 1.69)) = 313.7 steps and opens at step 1,220; a breaker reset cold would hold to step 906 + 606.`,
});

const SHORT = {
  nodes: ['neutral', 'live', 'board'],
  parts: [mains('neutral', 'live'), { id: 'breaker', kind: 'breaker', from: 'live', to: 'board', rating: 16 },
    loadOf('heater', 'board', 'neutral', 2000), { id: 'fault', kind: 'fault', from: 'board', to: 'neutral', r: 0.5, on_by: 'fault' }],
};
const shortFixture = fixture('short', {
  c: SHORT, rate: 1000, inputs: ['fault'], steps: 8, track: [entry('fault', 0, 1000, 0, 1), entry('fault', 3, 1000, 1, 2)],
  expect: {
    2: { i_rms: parts(4, [2000 / 230, 2000 / 230, 2000 / 230, 0]), on: [1, 1, 1, 0] },
    3: { i_rms: parts(4, [460 + 2000 / 230, 460 + 2000 / 230, 2000 / 230, 460]), on: [1, 1, 1, 1] },
    4: { i_rms: parts(4, []), i: parts(4, []), p: parts(4, []), on: [1, 0, 1, 1] },
    7: { on: [1, 0, 1, 1] },
  },
  answer: 'Before the fault the breaker and the heater carry 2,000 ÷ 230 = 8.6957 A. At step 3 the fault puts 0.5 Ω across the board: 230 ÷ 0.5 = 460 A through it, 468.70 A through the breaker, past the B curve\'s 4 × 16 = 64 A, so the magnetic element opens the breaker at the start of step 4, and from then no part carries current. A breaker with no magnetic element would hold until its heat, (468.70 ÷ 16)² (1 − e^(−t/60)), reached 1.69: 0.118 s.',
});

const LEAK = {
  nodes: ['neutral', 'live', 'load_live', 'load_neutral', 'earth'],
  parts: [mains('neutral', 'live'), { id: 'rcd', kind: 'rcd', live: ['live', 'load_live'], neutral: ['neutral', 'load_neutral'], rating: 0.03 },
    loadOf('lamp', 'load_live', 'load_neutral', 60), { id: 'fault', kind: 'fault', from: 'load_live', to: 'earth', r: 2000, on_by: 'fault' },
    { id: 'earth', kind: 'resistor', from: 'earth', to: 'neutral', r: 0 }],
};
const LAMP = 60 / 230;
const leakT = CONSTANTS.rcd.time.value * 0.03 / 0.115;
const leakOpens = 5 + Math.ceil(leakT * 1000);
if (leakOpens !== 58) throw Error(`the leak's RCD opens at ${leakOpens}, not 58`);
const leakFixture = fixture('leak', {
  c: LEAK, rate: 1000, inputs: ['fault'], steps: 64, track: [entry('fault', 0, 1000, 0, 1), entry('fault', 5, 1000, 1, 2)],
  expect: {
    4: { i_rms: parts(5, [LAMP, LAMP, LAMP, 0, 0]), i2_rms: parts(5, { 1: LAMP }), residual: parts(5, []), on: [1, 1, 1, 0, 1] },
    5: { i_rms: parts(5, [LAMP + 0.115, LAMP + 0.115, LAMP, 0.115, 0.115]), i2_rms: parts(5, { 1: LAMP }), residual: parts(5, { 1: 0.115 }), on: [1, 1, 1, 1, 1] },
    [leakOpens - 1]: { on: [1, 1, 1, 1, 1] },
    [leakOpens]: { i_rms: parts(5, []), i2_rms: parts(5, []), residual: parts(5, []), on: [1, 0, 1, 1, 1] },
  },
  answer: 'The lamp is 230² ÷ 60 = 881.67 Ω: 0.26087 A out through the live pole and back through the neutral pole, so the poles\' currents, each from the supply side, sum to 0. From step 5 the fault puts 2,000 Ω from the load-side live to the earth, joined to neutral with no resistance: 0.115 A leaves by the earth, so the live pole carries 0.37587 A, the neutral pole still 0.26087 A, and the residual is 0.115 A, 3.8333 times the 30 mA rating. The count rises by 1 ms ÷ (0.2 s × 0.03 ÷ 0.115) = 0.019167 a step and reaches 1 after 52.17 steps, so both poles open at step 5 + 53 = 58. An RCD that read its live pole alone would see 0.26087 A, 8.7 times its rating, and open after 23 ms.',
});

const TEST = {
  nodes: ['neutral', 'live', 'load_live', 'load_neutral'],
  parts: [mains('neutral', 'live'), { id: 'rcd', kind: 'rcd', live: ['live', 'load_live'], neutral: ['neutral', 'load_neutral'], test_r: 3000, test_by: 'test' },
    loadOf('lamp', 'load_live', 'load_neutral', 60)],
};
const testOpens = 2 + Math.ceil(CONSTANTS.rcd.time.value * 0.03 / (230 / 3000) * 1000);
if (testOpens !== 81) throw Error(`the test opens the RCD at ${testOpens}, not 81`);
const testFixture = fixture('test_button', {
  c: TEST, rate: 1000, inputs: ['test'], steps: 84, track: [entry('test', 0, 1000, 0, 1), entry('test', 2, 1000, 1, 2)],
  expect: {
    1: { i_rms: parts(3, [LAMP, LAMP, LAMP]), residual: parts(3, []), p: parts(3, [60, 0, 60]) },
    2: { i_rms: parts(3, [LAMP + 230 / 3000, LAMP + 230 / 3000, LAMP]), i2_rms: parts(3, { 1: LAMP }), residual: parts(3, { 1: 230 / 3000 }), p: parts(3, [60 + 230 * 230 / 3000, 230 * 230 / 3000, 60]), on: [1, 1, 1] },
    [testOpens - 1]: { on: [1, 1, 1] },
    [testOpens]: { i_rms: parts(3, []), residual: parts(3, []), on: [1, 0, 1] },
  },
  answer: 'The test path puts 3,000 Ω from the load-side live to the supply-side neutral: 230 ÷ 3,000 = 76.667 mA through the live pole that never comes back through the neutral pole, so the residual is 76.667 mA, 2.5556 times the 30 mA rating, and the path takes 230² ÷ 3,000 = 17.633 W, which the RCD\'s p holds. The count rises by 1 ms ÷ 78.26 ms a step and reaches 1 after 78.26 steps: both poles open at step 2 + 79 = 81.',
});

const STAIR = {
  nodes: ['neutral', 'live', 'a1', 'b1', 'a2', 'b2', 'lamp'],
  parts: [loadOf('bulb', 'lamp', 'neutral', 60), mains('neutral', 'live'), { id: 'top', kind: 'changeover', common: 'live', a: 'a1', b: 'b1', at_b_by: 's1' },
    { id: 'strap_a', kind: 'resistor', from: 'a1', to: 'a2', r: 0 }, { id: 'strap_b', kind: 'resistor', from: 'b1', to: 'b2', r: 0 },
    { id: 'bottom', kind: 'changeover', common: 'lamp', a: 'a2', b: 'b2', at_b_by: 's2' }],
};
const STATES = [[1, 1], [0, 1], [0, 0], [1, 0], [1, 1]];
const stairFixture = fixture('stair', {
  c: STAIR, rate: 1000, inputs: ['s1', 's2'], steps: STATES.length,
  track: STATES.flatMap(([a, b], k) => [entry('s1', k, 1000, a, 2 * k + 1), entry('s2', k, 1000, b, 2 * k + 2)]),
  expect: Object.fromEntries(STATES.map(([a, b], k) => [k, {
    i_rms: parts(6, a === b ? { 0: LAMP, 1: LAMP, 2: LAMP, 5: LAMP, [a ? 4 : 3]: LAMP } : {}),
    on: [1, 1, 1 + a, 1, 1, 1 + b],
  }])),
  answer: 'Each changeover joins its common to a at 0 and b at 1. The lamp, 881.67 Ω, has a path from the live only when both are at a (live, a1, the a strap, a2, the lamp) or both at b (through the b strap): then the source, both changeovers, the strap in use and the lamp carry 230 ÷ 881.67 = 0.26087 A, and the other strap nothing. At (0, 1) and (1, 0) the second one\'s common reaches a dead strap and nothing carries current. A changeover that joined both ways while it moved would light the lamp at step 1, when the first one moves to a with the second still at b.',
});

const BELL = {
  nodes: ['neutral', 'live', 'low_a', 'low_b'],
  parts: [mains('neutral', 'live'), { id: 'transformer', kind: 'transformer', primary: ['live', 'neutral'], secondary: ['low_a', 'low_b'], turns: [115, 6] },
    { id: 'bell', kind: 'load', from: 'low_a', to: 'low_b', p_rated: 6, v_rated: 12 }],
};
const doorbellFixture = fixture('doorbell', {
  c: BELL, rate: 1000, steps: 6,
  expect: {
    0: { i_rms: parts(3, [6 / 230, 6 / 230, 0.5]), i2_rms: parts(3, { 1: 0.5 }), p: parts(3, [6, 0, 6]), r: parts(3, { 2: 24 }), on: [1, 1, 1] },
    5: { v: [0, 230 * Math.SQRT2, 0, -12 * Math.SQRT2], i: parts(3, [6 / 230 * Math.SQRT2, 6 / 230 * Math.SQRT2, 0.5 * Math.SQRT2]), i2: parts(3, { 1: -0.5 * Math.SQRT2 }) },
  },
  answer: 'The secondary gives 230 × 6 ÷ 115 = 12 V rms into the bell, 12² ÷ 6 = 24 Ω: 0.5 A. The primary carries 0.5 × 6 ÷ 115 = 0.026087 A, so the source gives 230 × 0.026087 = 6 W, the bell takes 6 W and the transformer none. At step 5, a quarter of a 50 Hz cycle, every wave is at its crest: the live 230√2 V, low_b −12√2 V (low_a is the secondary\'s lowest node, which nothing joins to node 0, held at 0 V), the primary and the source 0.026087√2 A, the bell 0.5√2 A, and the secondary −0.5√2 A from low_a to low_b through the winding, which gives the power.',
});

const DIMMER = {
  nodes: ['neutral', 'live', 'lamp'],
  parts: [mains('neutral', 'live'), { id: 'knob_r', kind: 'resistor', from: 'live', to: 'lamp', r: { set_by: 'knob', range: [0, 2000] } },
    loadOf('lamp', 'lamp', 'neutral', 60)],
};
const R_LAMP = 230 * 230 / 60;
const dimmerFixture = fixture('dimmer', {
  c: DIMMER, rate: 1000, inputs: ['knob'], steps: 5, track: [entry('knob', 0, 1000, 0, 1), entry('knob', 2, 1000, R_LAMP, 2), entry('knob', 4, 1000, 2000, 3)],
  expect: {
    1: { r: parts(3, [0, 0, R_LAMP]), i_rms: parts(3, [LAMP, LAMP, LAMP]), p: parts(3, [60, 0, 60]) },
    2: { r: parts(3, [0, R_LAMP, R_LAMP]), i_rms: parts(3, [LAMP / 2, LAMP / 2, LAMP / 2]), p: parts(3, [30, 15, 15]) },
    4: { r: parts(3, [0, 2000, R_LAMP]), i_rms: parts(3, [230 / (2000 + R_LAMP), 230 / (2000 + R_LAMP), 230 / (2000 + R_LAMP)]) },
  },
  answer: 'The lamp is 230² ÷ 60 = 881.67 Ω. With the knob at 0 Ω it takes 60 W at 0.26087 A. With the knob at the lamp\'s own 881.67 Ω the loop is 1,763.3 Ω: 0.13043 A, and the lamp and the resistor take 0.13043² × 881.67 = 15 W each, 30 W from the source. At 2,000 Ω, the top of its range, 230 ÷ 2,881.67 = 0.079815 A. A library that read the knob a step late would still be at 0 Ω at step 2.',
});

const TIMER = {
  nodes: ['neutral', 'live', 'lamp'],
  parts: [mains('neutral', 'live'), { id: 'timer', kind: 'switch', from: 'live', to: 'lamp', closed_by: { array: 'run[0]' } }, loadOf('lamp', 'lamp', 'neutral', 60)],
};
const timerHead = sizeOf(headOf(TIMER));
const timerFixture = fixture('timer', {
  c: TIMER, rate: 1000, steps: 7, more: { run: { type: 'i32', count: 1 } },
  own: `(i32.store (i32.const ${WRITES_AT + timerHead}) (i32.and (i64.ge_s (local.get $k) (i64.const 2)) (i64.le_s (local.get $k) (i64.const 4))))`,
  expect: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((k) => [k, { i_rms: parts(3, k >= 2 && k <= 4 ? [LAMP, LAMP, LAMP] : []), on: [1, Number(k >= 2 && k <= 4), 1] }])),
  answer: 'The program writes run[0] = 1 on steps 2, 3 and 4 and 0 on the rest, before the solve of the same step, so the switch conducts on exactly those steps: 230 ÷ 881.67 = 0.26087 A through the source, the switch and the lamp, and nothing on the others, with no step of lag and no entry on the track.',
});

const SUPPLY = {
  nodes: ['neutral', 'live'],
  parts: [{ id: 'mains', kind: 'source_ac', from: 'neutral', to: 'live', v_rms: { set_by: 'volts', range: [0, 250] }, f: { set_by: 'hertz', range: [40, 70] } },
    { id: 'lamp', kind: 'load', from: 'live', to: 'neutral', p_rated: 60, v_rated: { set_by: 'rated', range: [100, 250] } }],
};
const supplyFixture = fixture('supply', {
  c: SUPPLY, rate: 1000, inputs: ['volts', 'hertz', 'rated'], steps: 6,
  track: [entry('volts', 0, 1000, 120, 1), entry('hertz', 0, 1000, 60, 2), entry('rated', 0, 1000, 120, 3)],
  expect: {
    0: { i_rms: [0.5, 0.5], p: [60, 60], r: [0, 240] },
    5: { i: [0.5 * Math.SQRT2 * Math.sin(2 * Math.PI * 60 * 0.005), 0.5 * Math.SQRT2 * Math.sin(2 * Math.PI * 60 * 0.005)] },
  },
  answer: 'The lamp is 120² ÷ 60 = 240 Ω on 120 V: 0.5 A rms and 60 W. At step 5, t = 5 ms, the wave is at 60 × 0.005 = 0.3 turns: 0.5 × √2 × sin(0.6π) = 0.67250 A.',
});

const FUSE = {
  nodes: ['neutral', 'live', 'fused', 'case'],
  parts: [mains('neutral', 'live'), { id: 'fuse', kind: 'fuse', from: 'live', to: 'fused', rating: 3, curve: 'fast' },
    { id: 'lamp', kind: 'load', from: 'fused', to: 'neutral', p_rated: 4.6, v_rated: 230 },
    { id: 'fault', kind: 'fault', from: 'fused', to: 'case', r: 1, on_by: 'fault' }, { id: 'earth', kind: 'resistor', from: 'case', to: 'neutral', r: 0 }],
};
const blow = 230.02;
const melts = 10 + Math.ceil(CONSTANTS.curves.fast.tau * Math.log(blow * blow / (blow * blow - 9)) * 100_000);
if (melts !== 28) throw Error(`the fuse opens at ${melts}, not 28`);
const fuseFixture = fixture('fuse', {
  c: FUSE, rate: 100_000, inputs: ['fault'], steps: 40, track: [entry('fault', 0, 100_000, 0, 1), entry('fault', 10, 100_000, 1, 2)],
  expect: {
    10: { i_rms: parts(5, [blow, blow, 0.02, 230, 230]), on: [1, 1, 1, 1, 1] },
    27: { on: [1, 1, 1, 1, 1] },
    28: { i_rms: parts(5, []), on: [1, 0, 1, 1, 1] },
  },
  answer: 'As circuit@1\'s fault fixture: 230.02 A through the 3 A fast fuse from step 10, which its curve (τ 1 s) opens after 1 s × ln(230.02² ÷ (230.02² − 3²)) = 170.1 µs, at step 28.',
});

const REF = 'circuit_ref@2.0.0';
const OWN = { nodes: ['neutral', 'live', 'board'], parts: [mains('neutral', 'live'), { id: 'breaker', kind: 'breaker', from: 'live', to: 'board', rating: 16 }, loadOf('lamp', 'board', 'neutral', 60)] };
const ownFixture = fixture('lamp_own', {
  c: OWN, rate: 1000, steps: 1, module: 'lib:circuit_ref', links: [{ name: REF, asset: reference }],
  expect: { 0: { i: [0, 0, 0], on: [1, 1, 1], residual: [0, 0, 0] } },
  answer: 'A lamp behind a breaker straight on the mains, importing circuit_ref by its own name: every part conducts, and at t = 0 the sine and so each current is 0.',
});

const fixtures = [overloadFixture, shortFixture, leakFixture, testFixture, stairFixture, doorbellFixture, dimmerFixture, timerFixture, supplyFixture, fuseFixture];
const layout = 'circuit.state@2';
const manifest = {
  name: 'circuit', version: '2.0.0', license: 'Apache-2.0',
  description: 'circuit@2 (#3604): circuit@1\'s nodes and parts plus a breaker that trips on its thermal and magnetic elements, an RCD that opens on the current that doesn\'t come back, a changeover, and an ideal transformer; inputs the item\'s own arrays drive; and number fields a control or one of the item\'s arrays sets within a range. Its fixtures\' expected values are worked by hand from Ohm\'s law and the closed forms. Its planted libraries each fail a fixture, and are its kind kit\'s twins for circuit.kcl, circuit.power, circuit.fuse, circuit.breaker, circuit.rcd and circuit.range. Written by scripts/circuit2-pack.mjs; the library is src/circuit.rs, its layouts are LAYOUT.md, and each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'circuit@2': {
      exports: EXPORTS, layout, fixtures, planted: Object.values(PLANTED),
      digest: sha256(canonical({ exports: EXPORTS, layout, fixtures })),
      rules: { 'circuit.kcl': { tolerance: 1e-9 }, 'circuit.power': { tolerance: 1e-6 }, 'circuit.fuse': {}, 'circuit.breaker': {}, 'circuit.rcd': {}, 'circuit.range': {} },
      twins: [
        { planted: PLANTED.both_ways, example: stairFixture, expect: 'circuit.kcl' },
        { planted: PLANTED.primary_current, example: doorbellFixture, expect: 'circuit.power' },
        { planted: PLANTED.late_fuse, example: fuseFixture, expect: 'circuit.fuse' },
        { planted: PLANTED.no_magnetic, example: shortFixture, expect: 'circuit.breaker' },
        { planted: PLANTED.one_pole, example: leakFixture, expect: 'circuit.rcd' },
        { planted: PLANTED.late_set, example: dimmerFixture, expect: 'circuit.range' },
      ],
      plants: PLANTED,
      constants: CONSTANTS,
    },
  },
  libs: { [REF]: { asset: reference, exports: EXPORTS.map((e) => e.name), fixtures: [ownFixture], implements: ['circuit@2'] } },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; circuit@2 digest ${manifest.interfaces['circuit@2'].digest}`);
