// This suite's libraries and driver programs, as an agent would write them, in WebAssembly text (README: Programs),
// with the TypeScript that works out what each must give from the interfaces' documented rules (README: The surface),
// never from a library's output.
//
// Libraries are relocatable objects (#190's README: Relocatable objects) that keep no data of their own: each works on
// memory its caller names. Driver programs are objects too: they import a library's functions either by the library's
// own name (`lib:<name>`, #190) or by an interface it implements (`lib:<name>@<major>`, this suite's surface).

import { entryAt, seeded, type Layout, type Program } from '../../190/helpers.ts';
import { add32, fma32, mul32 } from './floats.ts';
import { assemble } from './wat.ts';

/** An interface export as a pack lists it. */
export interface Export { name: string; params: string[]; results: string[] }

const i32le = (xs: number[]): Buffer => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeInt32LE(x, 4 * i)); return b; };
/** WebAssembly text's string of these bytes. */
const dataText = (b: Buffer): string => Array.from(b, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
/** A driver's memory: 0 reads, 4096 writes, 8192 its own data, 16384 the state it gives a library, 32768 its assets. */
const WRITES_AT = 4096;
const DATA_AT = 8192;
const STATE_AT = 16384;
const SCRATCH_AT = 24576;
const ASSETS_AT = 32768;
/** A driver object's head: its memory (one page), its imports, its regions and an empty init unless given one. */
const head = (imports: string): string => `
  (import "env" "__linear_memory" (memory 1 1))
  ${imports}
  (global $reads_at (export "reads_at") i32 (i32.const 0))
  (global $writes_at (export "writes_at") i32 (i32.const ${WRITES_AT}))`;
const at = (l: Layout, name: string): number => WRITES_AT + entryAt(l, 'writes', name);
/** A module name with no characters the assembler's file name can't hold. */
const tag = (module: string): string => module.replace(/[^a-z0-9]/gi, '_');

// ---------------------------------------------------------------------------------------------------
// physics2d.lib@1 (README: The surface): boxes that don't rotate, over flat ground at y = 0, y up, SI units.

export const PHYSICS2D_EXPORTS: Export[] = [
  { name: 'world', params: ['i32', 'f64', 'i32', 'f64'], results: [] },
  { name: 'body', params: ['i32', 'f64', 'f64', 'f64', 'f64', 'f64', 'f64', 'f64'], results: ['i32'] },
  { name: 'step', params: ['i32', 'f64'], results: [] },
  { name: 'x', params: ['i32', 'i32'], results: ['f64'] },
  { name: 'y', params: ['i32', 'i32'], results: ['f64'] },
];
/** The slide (Physics: behavior kit): a box from 5 m/s on flat ground, friction 0.2 against the ground's 0.8, g = 9.81 m/s², 120 Hz, 4 substeps. */
export const SLIDE = { gravity: 9.81, substeps: 4, ground: 0.8, friction: 0.2, x: 0, y: 0.5, halfW: 0.5, halfH: 0.5, vx: 5, vy: 0, rate: 120, steps: 240 };
/** The kit's answer: v² ÷ 2μg, with μ the two frictions combined. */
export const slideAnswer = (mu: number): number => (SLIDE.vx * SLIDE.vx) / (2 * mu * SLIDE.gravity);
export const GEOMETRIC = Math.sqrt(SLIDE.friction * SLIDE.ground);
export const AVERAGE = (SLIDE.friction + SLIDE.ground) / 2;

/**
 * A 2D physics library under physics2d.lib@1, as this suite writes it: each substep h = dt ÷ substeps, gravity first
 * (vy −= g·h); a body whose bottom is at or below the ground while moving down meets it: the ground takes its downward
 * speed (normal impulse jn = −vy, then vy = 0) and friction takes up to μ·jn from its sideways speed, never reversing
 * it, μ = √(friction × ground friction); then x += vx·h, y += vy·h, and a bottom below the ground is set on it.
 * `average`: the planted library, μ = (friction + ground friction) ÷ 2.
 */
export function physics2d(average = false): Program {
  const mu = average
    ? '(f64.mul (f64.add (f64.load offset=48 (local.get $at)) (f64.load offset=8 (local.get $w))) (f64.const 0.5))'
    : '(f64.sqrt (f64.mul (f64.load offset=48 (local.get $at)) (f64.load offset=8 (local.get $w))))';
  const bodyAt = '(i32.add (local.get $w) (i32.add (i32.const 32) (i32.shl (local.get $b) (i32.const 6))))';
  return assemble(`physics2d_${average ? 'average' : 'geometric'}`, `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $world (export "world") (param $w i32) (param $g f64) (param $substeps i32) (param $ground f64)
    (f64.store (local.get $w) (local.get $g))
    (f64.store offset=8 (local.get $w) (local.get $ground))
    (i32.store offset=16 (local.get $w) (local.get $substeps))
    (i32.store offset=20 (local.get $w) (i32.const 0)))
  (func $body (export "body") (param $w i32) (param $x f64) (param $y f64) (param $hw f64) (param $hh f64)
    (param $vx f64) (param $vy f64) (param $f f64) (result i32) (local $b i32) (local $at i32)
    (local.set $b (i32.load offset=20 (local.get $w)))
    (if (i32.ge_u (local.get $b) (i32.const 64)) (then (return (i32.const -1))))
    (local.set $at ${bodyAt})
    (f64.store (local.get $at) (local.get $x))
    (f64.store offset=8 (local.get $at) (local.get $y))
    (f64.store offset=16 (local.get $at) (local.get $hw))
    (f64.store offset=24 (local.get $at) (local.get $hh))
    (f64.store offset=32 (local.get $at) (local.get $vx))
    (f64.store offset=40 (local.get $at) (local.get $vy))
    (f64.store offset=48 (local.get $at) (local.get $f))
    (i32.store offset=20 (local.get $w) (i32.add (local.get $b) (i32.const 1)))
    (local.get $b))
  (func $step (export "step") (param $w i32) (param $dt f64)
    (local $h f64) (local $g f64) (local $s i32) (local $b i32) (local $at i32)
    (local $x f64) (local $y f64) (local $hh f64) (local $vx f64) (local $vy f64) (local $dv f64)
    (local.set $g (f64.load (local.get $w)))
    (local.set $h (f64.div (local.get $dt) (f64.convert_i32_s (i32.load offset=16 (local.get $w)))))
    (block $done
      (loop $substep
        (br_if $done (i32.ge_s (local.get $s) (i32.load offset=16 (local.get $w))))
        (local.set $b (i32.const 0))
        (block $all
          (loop $each
            (br_if $all (i32.ge_u (local.get $b) (i32.load offset=20 (local.get $w))))
            (local.set $at ${bodyAt})
            (local.set $x (f64.load (local.get $at)))
            (local.set $y (f64.load offset=8 (local.get $at)))
            (local.set $hh (f64.load offset=24 (local.get $at)))
            (local.set $vx (f64.load offset=32 (local.get $at)))
            (local.set $vy (f64.sub (f64.load offset=40 (local.get $at)) (f64.mul (local.get $g) (local.get $h))))
            (if (i32.and (f64.le (f64.sub (local.get $y) (local.get $hh)) (f64.const 0)) (f64.lt (local.get $vy) (f64.const 0)))
              (then
                (local.set $dv (f64.mul ${mu} (f64.neg (local.get $vy))))
                (local.set $vy (f64.const 0))
                (if (f64.le (f64.abs (local.get $vx)) (local.get $dv))
                  (then (local.set $vx (f64.const 0)))
                  (else (local.set $vx (if (result f64) (f64.gt (local.get $vx) (f64.const 0))
                    (then (f64.sub (local.get $vx) (local.get $dv)))
                    (else (f64.add (local.get $vx) (local.get $dv)))))))))
            (local.set $x (f64.add (local.get $x) (f64.mul (local.get $vx) (local.get $h))))
            (local.set $y (f64.add (local.get $y) (f64.mul (local.get $vy) (local.get $h))))
            (if (f64.lt (f64.sub (local.get $y) (local.get $hh)) (f64.const 0)) (then (local.set $y (local.get $hh))))
            (f64.store (local.get $at) (local.get $x))
            (f64.store offset=8 (local.get $at) (local.get $y))
            (f64.store offset=32 (local.get $at) (local.get $vx))
            (f64.store offset=40 (local.get $at) (local.get $vy))
            (local.set $b (i32.add (local.get $b) (i32.const 1)))
            (br $each)))
        (local.set $s (i32.add (local.get $s) (i32.const 1)))
        (br $substep))))
  (func $x (export "x") (param $w i32) (param $b i32) (result f64) (f64.load ${bodyAt}))
  (func $y (export "y") (param $w i32) (param $b i32) (result f64) (f64.load offset=8 ${bodyAt})))`, 'library');
}
/** The distance the slide's box has gone after each step, as `physics2d` integrates it, operation for operation. */
export function slideRun(average = false, steps = SLIDE.steps): number[] {
  const mu = average ? (SLIDE.friction + SLIDE.ground) * 0.5 : Math.sqrt(SLIDE.friction * SLIDE.ground);
  const h = 1 / SLIDE.rate / SLIDE.substeps;
  let { x, y, vx, vy } = SLIDE;
  const out: number[] = [];
  for (let k = 0; k < steps; k++) {
    for (let s = 0; s < SLIDE.substeps; s++) {
      vy = vy - SLIDE.gravity * h;
      if (y - SLIDE.halfH <= 0 && vy < 0) {
        const dv = mu * -vy;
        vy = 0;
        if (Math.abs(vx) <= dv) vx = 0;
        else vx = vx > 0 ? vx - dv : vx + dv;
      }
      x = x + vx * h;
      y = y + vy * h;
      if (y - SLIDE.halfH < 0) y = SLIDE.halfH;
    }
    out.push(x - SLIDE.x);
  }
  return out;
}
export const SLIDE_WRITES = { distance: { type: 'f64' as const } };
/** The slide as a program: at init a world and its box, then each step one step of 1/120 s and the box's distance. Item: step_rate 120, writes SLIDE_WRITES. */
export function slideProgram(l: Layout, module: string): Program {
  const s = SLIDE;
  return assemble(`slide_${tag(module)}_${at(l, 'distance')}`, `
(module${head(`(import "${module}" "world" (func $world (param i32 f64 i32 f64)))
  (import "${module}" "body" (func $body (param i32 f64 f64 f64 f64 f64 f64 f64) (result i32)))
  (import "${module}" "step" (func $advance (param i32 f64)))
  (import "${module}" "x" (func $x (param i32 i32) (result f64)))`)}
  (func $init (export "init") (param $seed i64)
    (call $world (i32.const ${STATE_AT}) (f64.const ${s.gravity}) (i32.const ${s.substeps}) (f64.const ${s.ground}))
    (drop (call $body (i32.const ${STATE_AT}) (f64.const ${s.x}) (f64.const ${s.y}) (f64.const ${s.halfW}) (f64.const ${s.halfH})
      (f64.const ${s.vx}) (f64.const ${s.vy}) (f64.const ${s.friction}))))
  (func $step (export "step") (param $k i64)
    (call $advance (i32.const ${STATE_AT}) (f64.div (f64.const 1) (f64.const ${s.rate})))
    (f64.store (i32.const ${at(l, 'distance')}) (f64.sub (call $x (i32.const ${STATE_AT}) (i32.const 0)) (f64.const ${s.x}))))
  (data (i32.const ${DATA_AT}) "\\00"))`, 'program');
}

// ---------------------------------------------------------------------------------------------------
// fsm@1 (README: The surface): a table-driven state machine with timers counted in steps.

export const FSM_EXPORTS: Export[] = [
  { name: 'start', params: ['i32', 'i32', 'i32', 'i64'], results: [] },
  { name: 'step', params: ['i32', 'i32', 'i64', 'i32'], results: ['i32'] },
];
export interface Fsm { states: number; events: number; next: number[][]; timer: number[]; after: number[] }
/** The door: closed 0, opening 1, open 2; event open 0 takes closed to opening, whose 30-step timer leads to open. */
export const DOOR: Fsm = { states: 3, events: 1, next: [[1], [-1], [-1]], timer: [0, 30, 0], after: [0, 2, 0] };
export const CLOSED = 0, OPENING = 1, OPEN = 2, OPEN_EVENT = 0, OPEN_AT = 10;
/** A machine table's bytes (README: fsm@1): S, E, next[s][e], then each state's timer and the state it leads to. */
export const fsmBytes = (t: Fsm): Buffer => i32le([t.states, t.events, ...t.next.flat(), ...t.timer.flatMap((n, s) => [n, t.after[s]!])]);
/**
 * fsm@1's rule, worked here: the machine starts in `start` at step 0; at step k, `step` first takes every timer due
 * (a state entered at step a with timer T > 0 is left for its `after` at step a + T, once a + T ≤ k), then the event.
 * `lazy`: the planted rule, a state's timer counted from the first step it is read at after it was entered.
 */
export function fsmRun(t: Fsm, steps: number, eventAt: (k: number) => number, lazy = false): number[] {
  let state = 0;
  let armed: number | null = lazy ? null : 0;
  const out: number[] = [];
  for (let k = 0; k < steps; k++) {
    for (;;) {
      const timer = t.timer[state]!;
      if (timer <= 0) break;
      if (armed === null) armed = k;
      if (armed + timer > k) break;
      armed += timer;
      state = t.after[state]!;
      if (lazy) armed = null;
    }
    const e = eventAt(k);
    const n = e >= 0 ? t.next[state]![e]! : -1;
    if (n >= 0) { state = n; armed = lazy ? null : k; }
    out.push(state);
  }
  return out;
}
/** The door's states, fed open at step 10. */
export const doorRun = (steps: number, lazy = false): number[] => fsmRun(DOOR, steps, (k) => (k === OPEN_AT ? OPEN_EVENT : -1), lazy);
export const DOOR_STEPS = 60;
export const DOOR_WRITES = { state: { type: 'i32' as const } };

const tableAt = (t: string): { s: string; e: string } => ({ s: `(i32.load ${t})`, e: `(i32.load offset=4 ${t})` });
/** An fsm@1 library: the machine at $m keeps its state (+0) and the step its timer was armed at (+8). */
export function fsmTable(): Program {
  const t = tableAt('(local.get $t)');
  const timerAt = `(i32.add (i32.add (local.get $t) (i32.const 8)) (i32.add (i32.shl (i32.mul ${t.s} ${t.e}) (i32.const 2)) (i32.shl (i32.load (local.get $m)) (i32.const 3))))`;
  return assemble('fsm_table', `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $start (export "start") (param $m i32) (param $t i32) (param $s i32) (param $k i64)
    (i32.store (local.get $m) (local.get $s))
    (i64.store offset=8 (local.get $m) (local.get $k)))
  (func $step (export "step") (param $m i32) (param $t i32) (param $k i64) (param $e i32) (result i32)
    (local $timer i32) (local $entry i32) (local $n i32)
    (block $settled
      (loop $due
        (local.set $entry ${timerAt})
        (local.set $timer (i32.load (local.get $entry)))
        (br_if $settled (i32.le_s (local.get $timer) (i32.const 0)))
        (br_if $settled (i64.gt_s (i64.add (i64.load offset=8 (local.get $m)) (i64.extend_i32_s (local.get $timer))) (local.get $k)))
        (i64.store offset=8 (local.get $m) (i64.add (i64.load offset=8 (local.get $m)) (i64.extend_i32_s (local.get $timer))))
        (i32.store (local.get $m) (i32.load offset=4 (local.get $entry)))
        (br $due)))
    (if (i32.ge_s (local.get $e) (i32.const 0))
      (then
        (local.set $n (i32.load (i32.add (i32.add (local.get $t) (i32.const 8))
          (i32.shl (i32.add (i32.mul (i32.load (local.get $m)) ${t.e}) (local.get $e)) (i32.const 2)))))
        (if (i32.ge_s (local.get $n) (i32.const 0))
          (then
            (i32.store (local.get $m) (local.get $n))
            (i64.store offset=8 (local.get $m) (local.get $k))))))
    (i32.load (local.get $m))))`, 'library');
}
/** A second fsm@1 library, written another way: the machine keeps its state (+0) and the step its timer ends at (+8, or -1). */
export function fsmSwitch(): Program {
  const t = tableAt('(local.get $t)');
  return assemble('fsm_switch', `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $enter (param $m i32) (param $t i32) (param $s i32) (param $at i64) (local $timer i32)
    (i32.store (local.get $m) (local.get $s))
    (local.set $timer (i32.load (i32.add (i32.add (local.get $t) (i32.const 8))
      (i32.add (i32.shl (i32.mul ${t.s} ${t.e}) (i32.const 2)) (i32.shl (local.get $s) (i32.const 3))))))
    (i64.store offset=8 (local.get $m) (select (i64.add (local.get $at) (i64.extend_i32_s (local.get $timer))) (i64.const -1)
      (i32.gt_s (local.get $timer) (i32.const 0)))))
  (func $start (export "start") (param $m i32) (param $t i32) (param $s i32) (param $k i64)
    (call $enter (local.get $m) (local.get $t) (local.get $s) (local.get $k)))
  (func $step (export "step") (param $m i32) (param $t i32) (param $k i64) (param $e i32) (result i32)
    (local $end i64) (local $n i32)
    (loop $due
      (local.set $end (i64.load offset=8 (local.get $m)))
      (if (i32.and (i64.ge_s (local.get $end) (i64.const 0)) (i64.le_s (local.get $end) (local.get $k)))
        (then
          (call $enter (local.get $m) (local.get $t)
            (i32.load offset=4 (i32.add (i32.add (local.get $t) (i32.const 8))
              (i32.add (i32.shl (i32.mul ${t.s} ${t.e}) (i32.const 2)) (i32.shl (i32.load (local.get $m)) (i32.const 3)))))
            (local.get $end))
          (br $due))))
    (if (i32.ge_s (local.get $e) (i32.const 0))
      (then
        (local.set $n (i32.load (i32.add (i32.add (local.get $t) (i32.const 8))
          (i32.shl (i32.add (i32.mul (i32.load (local.get $m)) ${t.e}) (local.get $e)) (i32.const 2)))))
        (if (i32.ge_s (local.get $n) (i32.const 0))
          (then (call $enter (local.get $m) (local.get $t) (local.get $n) (local.get $k))))))
    (i32.load (local.get $m))))`, 'library');
}
/** The door as a program: the door's table in its data, start(closed) at init, then step(k, open at step 10, else -1) and the state. Item: writes DOOR_WRITES. */
export function doorProgram(l: Layout, module: string): Program {
  return assemble(`door_${tag(module)}_${at(l, 'state')}`, `
(module${head(`(import "${module}" "start" (func $start (param i32 i32 i32 i64)))
  (import "${module}" "step" (func $run (param i32 i32 i64 i32) (result i32)))`)}
  (func $init (export "init") (param $seed i64)
    (call $start (i32.const ${STATE_AT}) (i32.const ${DATA_AT}) (i32.const ${CLOSED}) (i64.const 0)))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${at(l, 'state')}) (call $run (i32.const ${STATE_AT}) (i32.const ${DATA_AT}) (local.get $k)
      (select (i32.const ${OPEN_EVENT}) (i32.const -1) (i64.eq (local.get $k) (i64.const ${OPEN_AT}))))))
  (data (i32.const ${DATA_AT}) "${dataText(fsmBytes(DOOR))}"))`, 'program');
}

// ---------------------------------------------------------------------------------------------------
// nn.mlp@1 (README: The surface): a multilayer perceptron in binary32, every multiply and add rounded on its own.

export const NN_EXPORTS: Export[] = [{ name: 'forward', params: ['i32', 'i32', 'i32', 'i32'], results: [] }];
/** A network: its layer sizes, input first, and each layer's weights (row o: output o's weight for each input) and biases. */
export interface Net { sizes: number[]; layers: { w: number[][]; b: number[] }[] }
/** A network's bytes (README: nn.mlp@1): u32 L, u32 sizes n[0..L], then each layer's weights row by row and its biases, f32. */
export function netBytes(n: Net): Buffer {
  const f32 = n.layers.flatMap((l) => [...l.w.flat(), ...l.b]);
  const b = Buffer.alloc(4 * (1 + n.sizes.length + f32.length));
  b.writeUInt32LE(n.sizes.length - 1, 0);
  n.sizes.forEach((s, i) => b.writeUInt32LE(s, 4 + 4 * i));
  f32.forEach((v, i) => b.writeFloatLE(v, 4 * (1 + n.sizes.length + i)));
  return b;
}
/** A network from its bytes; throws when they don't hold one whole. */
export function readNet(b: Buffer): Net {
  const layers = b.readUInt32LE(0);
  const sizes = Array.from({ length: layers + 1 }, (_, i) => b.readUInt32LE(4 + 4 * i));
  let p = 4 * (layers + 2);
  const f32 = (): number => { const v = b.readFloatLE(p); p += 4; return v; };
  const net: Net = { sizes, layers: [] };
  for (let l = 1; l <= layers; l++) {
    const w = Array.from({ length: sizes[l]! }, () => Array.from({ length: sizes[l - 1]! }, f32));
    net.layers.push({ w, b: Array.from({ length: sizes[l]! }, f32) });
  }
  if (p !== b.length) throw Error(`a network of sizes ${sizes.join('-')} is ${p} bytes; the asset is ${b.length}`);
  return net;
}
export const f32Bytes = (xs: number[]): Buffer => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeFloatLE(x, 4 * i)); return b; };
export const readF32 = (b: Buffer): number[] => Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(4 * i));
/**
 * nn.mlp@1's rule, worked here with floats.ts's exact rounding: each output starts at its bias and adds each weight ×
 * input in input order, the product rounded to binary32 and then the sum (f32.mul, then f32.add); every layer but the
 * last keeps max(sum, 0), as +0 for a sum at or below 0. `fused`: the planted rule, each multiply and add one rounding.
 */
export function mlpRun(n: Net, input: number[], fused = false): number[] {
  let x = input;
  n.layers.forEach((layer, l) => {
    x = layer.w.map((row, o) => {
      let acc = layer.b[o]!;
      row.forEach((w, i) => { acc = fused ? fma32(w, x[i]!, acc) : add32(acc, mul32(w, x[i]!)); });
      return l < n.layers.length - 1 && !(acc > 0) ? 0 : acc;
    });
  });
  return x;
}
/** This suite's own network, 3-5-2, its weights, biases and input seeded binary32 values in (-1, 1). */
export function ownNet(): { net: Net; input: number[] } {
  const r = seeded(416);
  const v = (): number => Math.fround(r() * 2 - 1);
  const layer = (out: number, inp: number) => ({ w: Array.from({ length: out }, () => Array.from({ length: inp }, v)), b: Array.from({ length: out }, v) });
  return { net: { sizes: [3, 5, 2], layers: [layer(5, 3), layer(2, 5)] }, input: [v(), v(), v()] };
}

/**
 * An nn.mlp@1 library. `fused`: the planted one, which adds each weight × input to the sum with one rounding: the
 * product is exact in binary64, the binary64 sum is rounded to odd (TwoSum's error picks the odd neighbour) and then to
 * binary32, which is the exact sum rounded once.
 */
export function mlp(fused = false): Program {
  const w = '(f32.load (i32.add (local.get $w) (i32.shl (i32.add (i32.mul (local.get $o) (local.get $nin)) (local.get $i)) (i32.const 2))))';
  const x = '(f32.load (i32.add (local.get $cur) (i32.shl (local.get $i) (i32.const 2))))';
  const term = fused ? `(call $fma ${w} ${x} (local.get $acc))` : `(f32.add (local.get $acc) (f32.mul ${w} ${x}))`;
  const fma = `
  (func $fma (param $a f32) (param $b f32) (param $c f32) (result f32)
    (local $p f64) (local $z f64) (local $s f64) (local $v f64) (local $err f64) (local $bits i64)
    (local.set $p (f64.mul (f64.promote_f32 (local.get $a)) (f64.promote_f32 (local.get $b))))
    (local.set $z (f64.promote_f32 (local.get $c)))
    (local.set $s (f64.add (local.get $p) (local.get $z)))
    (local.set $v (f64.sub (local.get $s) (local.get $p)))
    (local.set $err (f64.add (f64.sub (local.get $p) (f64.sub (local.get $s) (local.get $v))) (f64.sub (local.get $z) (local.get $v))))
    (local.set $bits (i64.reinterpret_f64 (local.get $s)))
    (if (i32.and (f64.ne (local.get $err) (f64.const 0)) (i64.eqz (i64.and (local.get $bits) (i64.const 1))))
      (then (local.set $bits (if (result i64) (i32.eq (f64.gt (local.get $err) (f64.const 0)) (f64.gt (local.get $s) (f64.const 0)))
        (then (i64.add (local.get $bits) (i64.const 1)))
        (else (i64.sub (local.get $bits) (i64.const 1)))))))
    (f32.demote_f64 (f64.reinterpret_i64 (local.get $bits))))`;
  const size = (j: string): string => `(i32.load (i32.add (i32.add (local.get $net) (i32.const 4)) (i32.shl ${j} (i32.const 2))))`;
  return assemble(`mlp_${fused ? 'fused' : 'unfused'}`, `
(module
  (import "env" "__linear_memory" (memory 0))${fused ? fma : ''}
  (func $forward (export "forward") (param $net i32) (param $in i32) (param $out i32) (param $scratch i32)
    (local $L i32) (local $l i32) (local $j i32) (local $max i32) (local $nin i32) (local $nout i32) (local $w i32)
    (local $b i32) (local $cur i32) (local $dst i32) (local $o i32) (local $i i32) (local $acc f32)
    (local.set $L (i32.load (local.get $net)))
    (loop $widest
      (if (i32.gt_u ${size('(local.get $j)')} (local.get $max)) (then (local.set $max ${size('(local.get $j)')})))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $widest (i32.le_u (local.get $j) (local.get $L))))
    (local.set $w (i32.add (local.get $net) (i32.shl (i32.add (local.get $L) (i32.const 2)) (i32.const 2))))
    (local.set $cur (local.get $in))
    (local.set $l (i32.const 1))
    (loop $layer
      (local.set $nin ${size('(i32.sub (local.get $l) (i32.const 1))')})
      (local.set $nout ${size('(local.get $l)')})
      (local.set $b (i32.add (local.get $w) (i32.shl (i32.mul (local.get $nin) (local.get $nout)) (i32.const 2))))
      (local.set $dst (if (result i32) (i32.eq (local.get $l) (local.get $L))
        (then (local.get $out))
        (else (i32.add (local.get $scratch) (i32.mul (i32.and (local.get $l) (i32.const 1)) (i32.shl (local.get $max) (i32.const 2)))))))
      (local.set $o (i32.const 0))
      (loop $neuron
        (local.set $acc (f32.load (i32.add (local.get $b) (i32.shl (local.get $o) (i32.const 2)))))
        (local.set $i (i32.const 0))
        (block $summed
          (loop $term
            (br_if $summed (i32.ge_u (local.get $i) (local.get $nin)))
            (local.set $acc ${term})
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $term)))
        (if (i32.lt_u (local.get $l) (local.get $L))
          (then (local.set $acc (select (local.get $acc) (f32.const 0) (f32.gt (local.get $acc) (f32.const 0))))))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $o) (i32.const 2))) (local.get $acc))
        (local.set $o (i32.add (local.get $o) (i32.const 1)))
        (br_if $neuron (i32.lt_u (local.get $o) (local.get $nout))))
      (local.set $w (i32.add (local.get $b) (i32.shl (local.get $nout) (i32.const 2))))
      (local.set $cur (local.get $dst))
      (local.set $l (i32.add (local.get $l) (i32.const 1)))
      (br_if $layer (i32.le_u (local.get $l) (local.get $L))))))`, 'library');
}
export const netWrites = (n: number) => ({ out: { type: 'f64' as const, count: n } });
/**
 * A network as a program: its item's first two data assets are the network and its input (copied from `assets_at`,
 * each after a u32 of its length); each step it runs forward and writes the `n` outputs, each binary32 widened to f64.
 * Item: writes netWrites(n), assets [network, input].
 */
export function netProgram(l: Layout, module: string, n: number): Program {
  const out = at(l, 'out');
  const writes = Array.from({ length: n }, (_, i) => `
    (f64.store (i32.const ${out + 8 * i}) (f64.promote_f32 (f32.load (i32.const ${STATE_AT + 4 * i}))))`).join('');
  return assemble(`net_${tag(module)}_${n}_${out}`, `
(module${head(`(import "${module}" "forward" (func $forward (param i32 i32 i32 i32)))`)}
  (global $assets_at (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (call $forward (i32.const ${ASSETS_AT + 4}) (i32.add (i32.const ${ASSETS_AT + 8}) (i32.load (i32.const ${ASSETS_AT})))
      (i32.const ${STATE_AT}) (i32.const ${SCRATCH_AT}))${writes})
  (data (i32.const ${DATA_AT}) "\\00"))`, 'program');
}

// ---------------------------------------------------------------------------------------------------
// The no_fma oracle's program (oracle/no-fma.test.ts).

export interface Triple { x: number; y: number; z: number }
export const ORACLE_WRITES = {
  f32_bits: { type: 'i32' as const, count: 5 },
  f64_no_fma: { type: 'f64' as const, count: 5 },
  f64_no_contraction: { type: 'f64' as const, count: 5 },
};
/**
 * Each step: each f32 case as a one-input, one-output network (weight x, bias z, input y) through `module`'s forward,
 * its result's bits written to f32_bits; each f64 case as f64.add(f64.mul(x, y), z) in the program's own code. Every
 * input is read from the program's data, so no engine can fold it. Item: writes ORACLE_WRITES.
 */
export function oracleProgram(l: Layout, module: string, f32: Triple[], f64: { no_fma: Triple[]; no_contraction: Triple[] }): Program {
  const nets = Buffer.concat(f32.map((c) => netBytes({ sizes: [1, 1], layers: [{ w: [[c.x]], b: [c.z] }] })));
  const inputs = f32Bytes(f32.map((c) => c.y));
  const triples = (cs: Triple[]): Buffer => { const b = Buffer.alloc(24 * cs.length); cs.forEach((c, i) => { b.writeDoubleLE(c.x, 24 * i); b.writeDoubleLE(c.y, 24 * i + 8); b.writeDoubleLE(c.z, 24 * i + 16); }); return b; };
  const NETS = DATA_AT, INPUTS = NETS + nets.length, FMA = INPUTS + 32, CONTRACTION = FMA + 24 * f64.no_fma.length;
  const data = Buffer.concat([nets, inputs, Buffer.alloc(FMA - INPUTS - inputs.length), triples(f64.no_fma), triples(f64.no_contraction)]);
  const f32Cases = f32.map((_, i) => `
    (call $forward (i32.const ${NETS + 20 * i}) (i32.const ${INPUTS + 4 * i}) (i32.const ${STATE_AT + 4 * i}) (i32.const ${SCRATCH_AT}))
    (i32.store (i32.const ${at(l, 'f32_bits') + 4 * i}) (i32.reinterpret_f32 (f32.load (i32.const ${STATE_AT + 4 * i}))))`).join('');
  const f64Cases = (base: number, name: string, n: number): string => Array.from({ length: n }, (_, i) => `
    (f64.store (i32.const ${at(l, name) + 8 * i}) (f64.add (f64.mul (f64.load (i32.const ${base + 24 * i})) (f64.load (i32.const ${base + 24 * i + 8}))) (f64.load (i32.const ${base + 24 * i + 16}))))`).join('');
  return assemble(`oracle_${tag(module)}_${at(l, 'f32_bits')}_${at(l, 'f64_no_fma')}_${at(l, 'f64_no_contraction')}`, `
(module${head(`(import "${module}" "forward" (func $forward (param i32 i32 i32 i32)))`)}
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)${f32Cases}${f64Cases(FMA, 'f64_no_fma', f64.no_fma.length)}${f64Cases(CONTRACTION, 'f64_no_contraction', f64.no_contraction.length)})
  (data (i32.const ${DATA_AT}) "${dataText(data)}"))`, 'program');
}

// ---------------------------------------------------------------------------------------------------
// Whole modules (no links): the layout probe, and a counter that names no interface (criteria 4 and 7).

/** A program built for no layout: `check` of an item naming it reports the item's layout. */
export const layoutProbe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param i64))
  (func (export "step") (param i64)))`);
export const COUNT_WRITES = { v: { type: 'i32' as const } };
/** A counter in a mutable global, written each step as `v`. Item: writes COUNT_WRITES. */
export const counter = (l: Layout): Program => assemble(`counter_${at(l, 'v')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global $c (mut i32) (i32.const 0))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64)
    (global.set $c (i32.add (global.get $c) (i32.const 1)))
    (i32.store (i32.const ${at(l, 'v')}) (global.get $c))))`);
