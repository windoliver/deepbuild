// Writes the first-party pack packs/interfaces-1.0.0 (#416; canvas primitives: Logic: library interfaces):
// physics2d.lib@1, fsm@1 and nn.mlp@1, each with its exports, its fixtures and a planted library that must
// fail one of them. Every expected value is worked out here from the interface's own rule or the physics
// behavior kit's formula, never from a library. Programs are WebAssembly text, assembled into relocatable
// objects by an assembler that takes `<out-dir> --library|--program <file.wat>` (tests/acceptance/190/wat
// builds one):
//
//   node scripts/interfaces-pack.mjs <assembler>
//
// The pack's files are written whole each run; a changed fixture or export changes its interface's digest,
// which takes a new major.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/interfaces-pack.mjs <assembler>');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packs', 'interfaces-1.0.0');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
/** One canonical form before a hash: sorted keys, no white space (the values here hold no floats). */
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
function assemble(name, text, form) {
  const dir = mkdtempSync(join(tmpdir(), 'interfaces-pack-'));
  try {
    writeFileSync(join(dir, `${name}.wat`), text);
    const run = spawnSync(assembler, [dir, `--${form}`, join(dir, `${name}.wat`)], { encoding: 'utf8' });
    if (run.status !== 0) throw Error(`${name} doesn't assemble: ${run.stderr}`);
    return readFileSync(join(dir, `${name}.wasm`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A program's or library's text, kept beside its object, and the object. */
function object(name, text, form) {
  mkdirSync(join(OUT, 'src'), { recursive: true });
  writeFileSync(join(OUT, 'src', `${name}.wat`), text.trimStart());
  return put(`objects/${name}.wasm`, assemble(name, text, form));
}
const fixture = (name, f) => put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify({ name, ...f }, null, 2)}\n`));
/** A fixture program's memory: no reads, its writes at 4096, its own data at 8192, the library's state at 16384. */
const head = (module, imports) => `
(module
  (import "env" "__linear_memory" (memory 1 1))
${imports.map(([n, sig]) => `  (import "lib:${module}" "${n}" (func $${n} ${sig}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))`;

// ---------------------------------------------------------------------------------------------------
// physics2d.lib@1: boxes that don't rotate over flat ground at y = 0, y up, SI units. world(w, g, substeps,
// ground friction) starts a world in the memory at w; body(w, x, y, half width, half height, vx, vy, friction)
// adds a box and returns its index; step(w, dt) runs dt in `substeps` substeps of h = dt ÷ substeps: gravity
// (vy −= g·h), then a box whose bottom is at or below the ground while it moves down meets it: the ground takes
// its downward speed and friction takes up to μ times that from its sideways speed without reversing it, μ the
// geometric mean of the box's and the ground's friction; then x += vx·h, y += vy·h, and a bottom below the
// ground is set on it. x(w, b) and y(w, b) read a box's centre.

const PHYSICS2D = [
  { name: 'world', params: ['i32', 'f64', 'i32', 'f64'], results: [] },
  { name: 'body', params: ['i32', 'f64', 'f64', 'f64', 'f64', 'f64', 'f64', 'f64'], results: ['i32'] },
  { name: 'step', params: ['i32', 'f64'], results: [] },
  { name: 'x', params: ['i32', 'i32'], results: ['f64'] },
  { name: 'y', params: ['i32', 'i32'], results: ['f64'] },
];
const sig = (e) => `${e.params.length ? `(param ${e.params.join(' ')})` : ''}${e.results.length ? ` (result ${e.results.join(' ')})` : ''}`;
const physicsImports = PHYSICS2D.map((e) => [e.name, sig(e)]);
const G = 9.81;
/** A world of one box: the box's start and friction against ground friction 0.8, at 120 Hz in 4 substeps. */
const world = ({ y, vx, friction }) => `
  (func (export "init") (param $seed i64)
    (call $world (i32.const 16384) (f64.const ${G}) (i32.const 4) (f64.const 0.8))
    (drop (call $body (i32.const 16384) (f64.const 0) (f64.const ${y}) (f64.const 0.5) (f64.const 0.5)
      (f64.const ${vx}) (f64.const 0) (f64.const ${friction}))))`;
const physicsItem = (program, write) => ({ kind: 'logic@1', params: { program, step_rate: 120, writes: { [write]: { type: 'f64' } } } });

// The slide (Physics: behavior kit): a box from 5 m/s on flat ground, friction 0.2 against 0.8 under the
// geometric mean, slides v² ÷ 2μg; at 2 s it has long stopped.
const slideMu = Math.sqrt(0.2 * 0.8);
const slide = object('slide', `${head('physics2d.lib@1', physicsImports)}${world({ y: 0.5, vx: 5, friction: 0.2 })}
  (func (export "step") (param $k i64)
    (call $step (i32.const 16384) (f64.div (f64.const 1) (f64.const 120)))
    (f64.store (i32.const 4096) (call $x (i32.const 16384) (i32.const 0))))
  (data (i32.const 8192) "\\00"))`, 'program');
const slideFixture = fixture('slide', {
  item: physicsItem(slide, 'distance'), track: [], steps: 240,
  expect: { arrays: { 239: { distance: [(5 * 5) / (2 * slideMu * G)] } }, tolerance: { rel: 0.03 } },
  answer: 'The physics behavior kit\'s slide: v² ÷ 2μg with v = 5 m/s, g = 9.81 m/s² and μ = √(0.2 × 0.8) = 0.4, the geometric mean, is 3.186 m within 3%; the box has stopped by 2 s (v ÷ μg = 1.27 s), the distance at step 239 of 120 Hz.',
});
// Free fall (Physics: behavior kit): the drop after 1 s from rest is ½gt², far above the ground.
const fall = object('fall', `${head('physics2d.lib@1', physicsImports)}${world({ y: 10, vx: 0, friction: 0.5 })}
  (func (export "step") (param $k i64)
    (call $step (i32.const 16384) (f64.div (f64.const 1) (f64.const 120)))
    (f64.store (i32.const 4096) (f64.sub (f64.const 10) (call $y (i32.const 16384) (i32.const 0)))))
  (data (i32.const 8192) "\\00"))`, 'program');
const fallFixture = fixture('fall', {
  item: physicsItem(fall, 'drop'), track: [], steps: 120,
  expect: { arrays: { 119: { drop: [0.5 * G * 1 * 1] } }, tolerance: { rel: 0.01 } },
  answer: 'The physics behavior kit\'s free fall: ½gt² with g = 9.81 m/s² and t = 1 s is 4.905 m within 1%, the drop at step 119 of 120 Hz from 10 m up, which never reaches the ground.',
});
/** physics2d.lib@1's planted library: friction combined by the average, not the geometric mean. */
const physicsPlanted = object('physics2d_average', `
(module
  (import "env" "__linear_memory" (memory 0))
  (func (export "world") (param $w i32) (param $g f64) (param $substeps i32) (param $ground f64)
    (f64.store (local.get $w) (local.get $g))
    (f64.store offset=8 (local.get $w) (local.get $ground))
    (i32.store offset=16 (local.get $w) (local.get $substeps))
    (i32.store offset=20 (local.get $w) (i32.const 0)))
  (func (export "body") (param $w i32) (param $x f64) (param $y f64) (param $hw f64) (param $hh f64)
    (param $vx f64) (param $vy f64) (param $f f64) (result i32) (local $b i32) (local $at i32)
    (local.set $b (i32.load offset=20 (local.get $w)))
    (local.set $at (i32.add (local.get $w) (i32.add (i32.const 32) (i32.mul (local.get $b) (i32.const 56)))))
    (f64.store (local.get $at) (local.get $x))
    (f64.store offset=8 (local.get $at) (local.get $y))
    (f64.store offset=16 (local.get $at) (local.get $hw))
    (f64.store offset=24 (local.get $at) (local.get $hh))
    (f64.store offset=32 (local.get $at) (local.get $vx))
    (f64.store offset=40 (local.get $at) (local.get $vy))
    (f64.store offset=48 (local.get $at) (local.get $f))
    (i32.store offset=20 (local.get $w) (i32.add (local.get $b) (i32.const 1)))
    (local.get $b))
  (func (export "step") (param $w i32) (param $dt f64)
    (local $h f64) (local $s i32) (local $b i32) (local $at i32) (local $vx f64) (local $vy f64) (local $dv f64) (local $y f64)
    (local.set $h (f64.div (local.get $dt) (f64.convert_i32_s (i32.load offset=16 (local.get $w)))))
    (block $substeps
      (loop $substep
        (br_if $substeps (i32.ge_s (local.get $s) (i32.load offset=16 (local.get $w))))
        (local.set $b (i32.const 0))
        (block $bodies
          (loop $body
            (br_if $bodies (i32.ge_u (local.get $b) (i32.load offset=20 (local.get $w))))
            (local.set $at (i32.add (local.get $w) (i32.add (i32.const 32) (i32.mul (local.get $b) (i32.const 56)))))
            (local.set $vx (f64.load offset=32 (local.get $at)))
            (local.set $vy (f64.sub (f64.load offset=40 (local.get $at)) (f64.mul (f64.load (local.get $w)) (local.get $h))))
            (local.set $y (f64.load offset=8 (local.get $at)))
            (if (i32.and (f64.le (f64.sub (local.get $y) (f64.load offset=24 (local.get $at))) (f64.const 0))
                         (f64.lt (local.get $vy) (f64.const 0)))
              (then
                ;; The planted rule: the two frictions averaged.
                (local.set $dv (f64.mul (f64.neg (local.get $vy))
                  (f64.mul (f64.add (f64.load offset=48 (local.get $at)) (f64.load offset=8 (local.get $w))) (f64.const 0.5))))
                (local.set $vy (f64.const 0))
                (local.set $vx (if (result f64) (f64.le (f64.abs (local.get $vx)) (local.get $dv))
                  (then (f64.const 0))
                  (else (f64.sub (local.get $vx) (f64.copysign (local.get $dv) (local.get $vx))))))))
            (f64.store (local.get $at) (f64.add (f64.load (local.get $at)) (f64.mul (local.get $vx) (local.get $h))))
            (local.set $y (f64.add (local.get $y) (f64.mul (local.get $vy) (local.get $h))))
            (if (f64.lt (f64.sub (local.get $y) (f64.load offset=24 (local.get $at))) (f64.const 0))
              (then (local.set $y (f64.load offset=24 (local.get $at)))))
            (f64.store offset=8 (local.get $at) (local.get $y))
            (f64.store offset=32 (local.get $at) (local.get $vx))
            (f64.store offset=40 (local.get $at) (local.get $vy))
            (local.set $b (i32.add (local.get $b) (i32.const 1)))
            (br $body)))
        (local.set $s (i32.add (local.get $s) (i32.const 1)))
        (br $substep))))
  (func (export "x") (param $w i32) (param $b i32) (result f64)
    (f64.load (i32.add (local.get $w) (i32.add (i32.const 32) (i32.mul (local.get $b) (i32.const 56))))))
  (func (export "y") (param $w i32) (param $b i32) (result f64)
    (f64.load offset=8 (i32.add (local.get $w) (i32.add (i32.const 32) (i32.mul (local.get $b) (i32.const 56)))))))`, 'library');

// ---------------------------------------------------------------------------------------------------
// fsm@1: a table-driven state machine whose timers count steps. A table holds i32s: the state count S, the event
// count E, next[s][e] (the state event e leads to from s, or −1 for none), then for each state its timer T (0:
// none) and the state it leads to after T steps. start(m, t, s, k) puts the machine at m in state s at step k;
// step(m, t, k, e) at step k first leaves each state whose timer is due (entered at step a with T > 0, left for
// its next state at a + T once a + T ≤ k, which then counts as that state's entry), then takes event e (−1:
// none), and returns the state. A state's timer runs from the step it was entered.

const FSM = [
  { name: 'start', params: ['i32', 'i32', 'i32', 'i64'], results: [] },
  { name: 'step', params: ['i32', 'i32', 'i64', 'i32'], results: ['i32'] },
];
const CLOSED = 0, OPENING = 1, OPEN = 2;
/** The door: closed, opening, open; event 0 (open) takes closed to opening, whose 30-step timer leads to open. */
const doorTable = [3, 1, OPENING, -1, -1, 0, 0, 30, OPEN, 0, 0];
const i32Text = (xs) => xs.map((x) => { const b = Buffer.alloc(4); b.writeInt32LE(x); return [...b].map((y) => `\\${y.toString(16).padStart(2, '0')}`).join(''); }).join('');
const door = object('door', `${head('fsm@1', FSM.map((e) => [e.name, sig(e)]))}
  (func (export "init") (param $seed i64)
    (call $start (i32.const 16384) (i32.const 8192) (i32.const ${CLOSED}) (i64.const 0)))
  (func (export "step") (param $k i64)
    (i32.store (i32.const 4096) (call $step (i32.const 16384) (i32.const 8192) (local.get $k)
      (select (i32.const 0) (i32.const -1) (i64.eq (local.get $k) (i64.const 10))))))
  (data (i32.const 8192) "${i32Text(doorTable)}"))`, 'program');
/** fsm@1's rule for the door, fed open at step 10: closed, then opening at 10, then open at 10 + 30. */
const doorStates = Array.from({ length: 60 }, (_, k) => (k < 10 ? CLOSED : k < 40 ? OPENING : OPEN));
const doorFixture = fixture('door', {
  item: { kind: 'logic@1', params: { program: door, writes: { state: { type: 'i32' } } } }, track: [], steps: 60,
  expect: { arrays: Object.fromEntries(doorStates.map((s, k) => [k, { state: [s] }])), tolerance: 'exact' },
  answer: 'fsm@1\'s rule: the door starts closed at step 0; the open event at step 10 takes it to opening, entered at step 10; its 30-step timer is due at 10 + 30, so the state is open from step 40 and opening from 10 to 39.',
});
/** fsm@1's planted library: a state's timer counted from the first step it is read after it was entered. */
const fsmPlanted = object('fsm_lazy', `
(module
  (import "env" "__linear_memory" (memory 0))
  ;; The machine at $m: its state at +0 and the step its timer started at +8, or -1 until a step reads it.
  (func (export "start") (param $m i32) (param $t i32) (param $s i32) (param $k i64)
    (i32.store (local.get $m) (local.get $s))
    (i64.store offset=8 (local.get $m) (i64.const -1)))
  (func (export "step") (param $m i32) (param $t i32) (param $k i64) (param $e i32) (result i32)
    (local $entry i32) (local $timer i32) (local $next i32)
    (block $settled
      (loop $due
        (local.set $entry (i32.add (i32.add (local.get $t) (i32.const 8))
          (i32.add (i32.shl (i32.mul (i32.load (local.get $t)) (i32.load offset=4 (local.get $t))) (i32.const 2))
                   (i32.shl (i32.load (local.get $m)) (i32.const 3)))))
        (local.set $timer (i32.load (local.get $entry)))
        (br_if $settled (i32.le_s (local.get $timer) (i32.const 0)))
        (if (i64.lt_s (i64.load offset=8 (local.get $m)) (i64.const 0))
          (then (i64.store offset=8 (local.get $m) (local.get $k))))
        (br_if $settled (i64.gt_s (i64.add (i64.load offset=8 (local.get $m)) (i64.extend_i32_s (local.get $timer))) (local.get $k)))
        (i32.store (local.get $m) (i32.load offset=4 (local.get $entry)))
        (i64.store offset=8 (local.get $m) (i64.const -1))
        (br $due)))
    (if (i32.ge_s (local.get $e) (i32.const 0))
      (then
        (local.set $next (i32.load (i32.add (i32.add (local.get $t) (i32.const 8))
          (i32.shl (i32.add (i32.mul (i32.load (local.get $m)) (i32.load offset=4 (local.get $t))) (local.get $e)) (i32.const 2)))))
        (if (i32.ge_s (local.get $next) (i32.const 0))
          (then
            (i32.store (local.get $m) (local.get $next))
            (i64.store offset=8 (local.get $m) (i64.const -1))))))
    (i32.load (local.get $m))))`, 'library');

// ---------------------------------------------------------------------------------------------------
// nn.mlp@1: a multilayer perceptron in binary32. A network's bytes, little-endian: u32 L, u32 sizes n[0..L],
// then each layer's weights, row o holding output o's weight for each input, and its biases, f32.
// forward(net, in, out, scratch) reads n[0] inputs at `in` and writes n[L] outputs at `out`, using scratch for
// the layers between. Each output starts at its bias and adds weight × input in input order, the product
// rounded to binary32 and then the sum (f32.mul, then f32.add); every layer but the last keeps max(sum, 0),
// as +0 for a sum at or below 0.

const NN = [{ name: 'forward', params: ['i32', 'i32', 'i32', 'i32'], results: [] }];
// Binary32 by hand: a finite value as m × 2^e, kept exact, rounded once to 24 bits, ties to even.
function exact(x) {
  if (x === 0) return { m: 0n, e: 0 };
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  const hi = v.getUint32(0), lo = v.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const biased = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return biased === 0 ? { m: sign * fraction, e: -1074 } : { m: sign * ((1n << 52n) | fraction), e: biased - 1075 };
}
const times = (a, b) => ({ m: a.m * b.m, e: a.e + b.e });
function plus(a, b) {
  const e = Math.min(a.e, b.e);
  return { m: (a.m << BigInt(a.e - e)) + (b.m << BigInt(b.e - e)), e };
}
function round32(x) {
  if (x.m === 0n) return 0;
  const negative = x.m < 0n;
  const a = negative ? -x.m : x.m;
  const lsb = Math.max(x.e + a.toString(2).length - 24, -149);
  let q;
  if (lsb <= x.e) q = a << BigInt(x.e - lsb);
  else {
    const drop = BigInt(lsb - x.e);
    q = a >> drop;
    const rest = a - (q << drop);
    const half = 1n << (drop - 1n);
    if (rest > half || (rest === half && (q & 1n) === 1n)) q += 1n;
  }
  const v = Number(q) * 2 ** lsb;
  return negative ? -v : v;
}
const mul32 = (a, b) => round32(times(exact(a), exact(b)));
const add32 = (a, b) => round32(plus(exact(a), exact(b)));
const fma32 = (a, b, c) => round32(plus(times(exact(a), exact(b)), exact(c)));
function run(net, input, fused) {
  let x = input;
  net.layers.forEach((layer, l) => {
    x = layer.w.map((row, o) => {
      let acc = layer.b[o];
      row.forEach((w, i) => { acc = fused ? fma32(w, x[i], acc) : add32(acc, mul32(w, x[i])); });
      return l < net.layers.length - 1 && !(acc > 0) ? 0 : acc;
    });
  });
  return x;
}
/** Seeded binary32 values in (−1, 1) (xorshift32). */
function values(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return Math.fround((s / 2 ** 32) * 2 - 1); };
}
const ulps = (a, b) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat32(0, a); v.setFloat32(4, b); return Math.abs(v.getInt32(0) - v.getInt32(4)); };
/** The fixture table: the first seed whose 4-8-2 network keeps its hidden layer alive and whose fused twin
 * differs from the table by exactly one unit in the last place in some output and by no more in any. */
let table;
for (let seed = 416; !table; seed++) {
  const v = values(seed);
  const layer = (out, inp) => ({ w: Array.from({ length: out }, () => Array.from({ length: inp }, v)), b: Array.from({ length: out }, v) });
  const net = { sizes: [4, 8, 2], layers: [layer(8, 4), layer(2, 8)] };
  const input = Array.from({ length: 4 }, v);
  const hidden = run({ layers: [net.layers[0]] }, input, false);
  const out = run(net, input, false);
  const fused = run(net, input, true);
  const d = out.map((o, i) => ulps(o, fused[i]));
  if (hidden.filter((h) => h > 0).length >= 3 && d.some((x) => x === 1) && d.every((x) => x <= 1)) table = { seed, net, input, out, fused };
}
const f32 = (xs) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeFloatLE(x, 4 * i)); return b; };
const u32 = (xs) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeUInt32LE(x, 4 * i)); return b; };
const netAsset = put('data/net-4-8-2.bin', Buffer.concat([u32([2, 4, 8, 2]), f32(table.net.layers.flatMap((l) => [...l.w.flat(), ...l.b]))]));
const inputAsset = put('data/input-4.bin', f32(table.input));
// Its data assets are copied from assets_at, each after a u32 of its length: the network at 32772, then the input.
const net = object('net', `
(module
  (import "env" "__linear_memory" (memory 1 1))
  (import "lib:nn.mlp@1" "forward" (func $forward ${sig(NN[0])}))
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global (export "assets_at") i32 (i32.const 32768))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (call $forward (i32.const 32772) (i32.add (i32.const 32776) (i32.load (i32.const 32768))) (i32.const 16384) (i32.const 20480))
    (f64.store (i32.const 4096) (f64.promote_f32 (f32.load (i32.const 16384))))
    (f64.store (i32.const 4104) (f64.promote_f32 (f32.load (i32.const 16388)))))
  (data (i32.const 8192) "\\00"))`, 'program');
const netFixture = fixture('4-8-2', {
  item: { kind: 'logic@1', params: { program: net, writes: { out: { type: 'f64', count: 2 } }, assets: [netAsset, inputAsset] } },
  track: [], steps: 1,
  expect: { arrays: { 0: { out: table.out } }, tolerance: 'exact' },
  answer: `nn.mlp@1's rule worked by hand in binary32 (each product and each sum rounded once, to nearest, ties to even; max(sum, 0) after the hidden layer) on the table's 4-8-2 network (seeded values in (−1, 1), seed ${table.seed}) and input; each output widened to f64. A multiply and add fused into one rounding gives ${table.fused.join(', ')}.`,
});
/** nn.mlp@1's planted library: each weight × input added to the sum with one rounding. The binary64 sum of the
 * exact product and the sum is rounded to odd (its rounding error picks the odd neighbour), and then to binary32,
 * which rounds the exact value once. */
const nnPlanted = object('mlp_fused', `
(module
  (import "env" "__linear_memory" (memory 0))
  (func (export "forward") (param $net i32) (param $in i32) (param $out i32) (param $scratch i32)
    (local $L i32) (local $l i32) (local $nin i32) (local $nout i32) (local $w i32) (local $b i32) (local $src i32) (local $dst i32)
    (local $o i32) (local $i i32) (local $acc f32) (local $p f64) (local $z f64) (local $s f64) (local $v f64) (local $err f64) (local $bits i64)
    (local $j i32) (local $max i32)
    (local.set $L (i32.load (local.get $net)))
    ;; The widest layer: the layers between go to scratch, alternating halves of 8 × its bytes.
    (loop $widest
      (local.set $max (select (i32.load (i32.add (local.get $net) (i32.shl (i32.add (local.get $j) (i32.const 1)) (i32.const 2))))
        (local.get $max)
        (i32.gt_u (i32.load (i32.add (local.get $net) (i32.shl (i32.add (local.get $j) (i32.const 1)) (i32.const 2)))) (local.get $max))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $widest (i32.le_u (local.get $j) (local.get $L))))
    (local.set $w (i32.add (local.get $net) (i32.shl (i32.add (local.get $L) (i32.const 2)) (i32.const 2))))
    (local.set $src (local.get $in))
    (local.set $l (i32.const 1))
    (loop $layer
      (local.set $nin (i32.load (i32.add (local.get $net) (i32.shl (local.get $l) (i32.const 2)))))
      (local.set $nout (i32.load (i32.add (local.get $net) (i32.shl (i32.add (local.get $l) (i32.const 1)) (i32.const 2)))))
      (local.set $b (i32.add (local.get $w) (i32.shl (i32.mul (local.get $nin) (local.get $nout)) (i32.const 2))))
      (local.set $dst (select (local.get $out)
        (i32.add (local.get $scratch) (i32.mul (i32.and (local.get $l) (i32.const 1)) (i32.shl (local.get $max) (i32.const 2))))
        (i32.eq (local.get $l) (local.get $L))))
      (local.set $o (i32.const 0))
      (loop $neuron
        (local.set $acc (f32.load (i32.add (local.get $b) (i32.shl (local.get $o) (i32.const 2)))))
        (local.set $i (i32.const 0))
        (block $summed
          (loop $term
            (br_if $summed (i32.ge_u (local.get $i) (local.get $nin)))
            (local.set $p (f64.mul
              (f64.promote_f32 (f32.load (i32.add (local.get $w) (i32.shl (i32.add (i32.mul (local.get $o) (local.get $nin)) (local.get $i)) (i32.const 2)))))
              (f64.promote_f32 (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2)))))))
            (local.set $z (f64.promote_f32 (local.get $acc)))
            (local.set $s (f64.add (local.get $p) (local.get $z)))
            (local.set $v (f64.sub (local.get $s) (local.get $p)))
            (local.set $err (f64.add (f64.sub (local.get $p) (f64.sub (local.get $s) (local.get $v))) (f64.sub (local.get $z) (local.get $v))))
            (local.set $bits (i64.reinterpret_f64 (local.get $s)))
            (if (i32.and (f64.ne (local.get $err) (f64.const 0)) (i64.eqz (i64.and (local.get $bits) (i64.const 1))))
              (then (local.set $bits (select (i64.add (local.get $bits) (i64.const 1)) (i64.sub (local.get $bits) (i64.const 1))
                (i32.eq (f64.gt (local.get $err) (f64.const 0)) (f64.gt (local.get $s) (f64.const 0)))))))
            (local.set $acc (f32.demote_f64 (f64.reinterpret_i64 (local.get $bits))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $term)))
        (if (i32.lt_u (local.get $l) (local.get $L))
          (then (local.set $acc (select (local.get $acc) (f32.const 0) (f32.gt (local.get $acc) (f32.const 0))))))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $o) (i32.const 2))) (local.get $acc))
        (local.set $o (i32.add (local.get $o) (i32.const 1)))
        (br_if $neuron (i32.lt_u (local.get $o) (local.get $nout))))
      (local.set $w (i32.add (local.get $b) (i32.shl (local.get $nout) (i32.const 2))))
      (local.set $src (local.get $dst))
      (local.set $l (i32.add (local.get $l) (i32.const 1)))
      (br_if $layer (i32.le_u (local.get $l) (local.get $L))))))`, 'library');

// ---------------------------------------------------------------------------------------------------

/** An interface's digest: the d1 digest of its exports, its layout and its fixtures. */
function iface(exports, fixtures, planted) {
  return { exports, fixtures, planted, digest: sha256(canonical({ exports, layout: null, fixtures })) };
}
const manifest = {
  name: 'interfaces', version: '1.0.0', license: 'Apache-2.0',
  description: 'First-party library interfaces (#416): physics2d.lib@1, fsm@1 and nn.mlp@1, each with fixtures whose expected values come from the interface (the physics behavior kit\'s formulas, a timer rule, a binary32 table worked by hand) and a planted library that must fail one of them. Written by scripts/interfaces-pack.mjs; each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'physics2d.lib@1': iface(PHYSICS2D, [slideFixture, fallFixture], [physicsPlanted]),
    'fsm@1': iface(FSM, [doorFixture], [fsmPlanted]),
    'nn.mlp@1': iface(NN, [netFixture], [nnPlanted]),
  },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; nn.mlp@1's table from seed ${table.seed}: ${table.out.join(', ')} (fused ${table.fused.join(', ')})`);
