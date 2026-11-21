// This suite's logic programs, as an agent would write them, in WebAssembly text: relocatable objects (#190's README:
// Relocatable objects) that import lanes@1's exports either through the interface (`lib:lanes@1`, #416) or by a
// library's own name (`lib:<name>`, #190), assembled by #416's arrangement of #190's assembler (../416/interfaces/wat.ts).
// Each one places its vehicles at init and, each step, sends them where its scene says and then calls `go` once, which
// writes lanes@1's arrays at the start of its write region (README: Arrays). Its own extra arrays come after them.

import { entryAt, type Layout, type Program } from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { FLEET, GRID, SEARCHES, STATE } from './scenes.ts';

/** A program's memory (README: Memory): 0 reads, 4096 writes, 8192 its data, 16384 its variables, 65536 its assets (the built graph first), 1 MiB the lane state; 2 MiB in all. */
const WRITES_AT = 4096, DATA_AT = 8192, VARS_AT = 16384, ASSETS_AT = 65536, STATE_AT = 1 << 20, PAGES = 32;
/** The built graph's bytes, after the u32 of its length. */
const GRAPH_AT = ASSETS_AT + 4;

type WriteType = 'i32' | 'f64' | 'vec2' | 'vec3';
export type Writes = Record<string, { type: WriteType; count?: number }>;
/** lanes@1's arrays for `v` vehicles, in the order and types the library writes them (README: Arrays), then `more`. */
export const lanesWrites = (v: number, more: Writes = {}): Writes => ({
  pos: { type: 'vec2', count: v }, heading: { type: 'f64', count: v }, speed: { type: 'f64', count: v },
  state: { type: 'i32', count: v }, fork: { type: 'f64', count: v }, load: { type: 'vec3', count: v }, ...more,
});
const align8 = (n: number): number => Math.ceil(n / 8) * 8;
/** Where each lanes@1 array starts after `out`, for v vehicles (README: Arrays). */
export const lanesOffsets = (v: number): Record<string, number> => {
  const pos = 0, heading = pos + 16 * v, speed = heading + 8 * v, state = speed + 8 * v, fork = state + align8(4 * v), load = fork + 8 * v;
  return { pos, heading, speed, state, fork, load };
};

const SIG = {
  graph: '(param i32 i32) (result i32)', vehicle: '(param i32 i32) (result i32)', route: '(param i32 i32 i32) (result f64)',
  go: '(param i32 f64 i32)', lift: '(param i32 i32 f64)', carry: '(param i32 i32)', set_down: '(param i32 i32)', park: '(param i32 i32 i32) (result f64)',
} as const;
type Export = keyof typeof SIG;
/** A module name the assembler's file name can hold. */
const tag = (s: string): string => s.replace(/[^a-z0-9]/gi, '_');
const head = (module: string, uses: Export[]): string => `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
${uses.map((n) => `  (import "${module}" "${n}" (func $${n} ${SIG[n]}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))`;
/** init's start: the lane state from the built graph, then a vehicle at each bay of `place`, IDs 0, 1, … in order. */
const start = (place: number[]): string => `
    (drop (call $graph (i32.const ${STATE_AT}) (i32.const ${GRAPH_AT})))${place.map((b) => `
    (drop (call $vehicle (i32.const ${STATE_AT}) (i32.const ${b})))`).join('')}`;
const go = (dt: number): string => `(call $go (i32.const ${STATE_AT}) (f64.const ${dt}) (i32.const ${WRITES_AT}))`;
const dataText = (b: Buffer): string => Array.from(b, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('');

/** A vehicle sent at step `at` to bay `bay` (with `park`). */
interface Send { at: number; v: number; bay: number }
/**
 * Places vehicles at `place` and, at each step, first sends those `send` names for that step, then calls go(dt).
 * Criteria 1, 2, 3 and 6, and criterion 3's stuck run.
 */
export function dispatchProgram(name: string, module: string, place: number[], send: Send[], dt: number): Program {
  return assemble(`dispatch_${tag(name)}_${tag(module)}`, `${head(module, ['graph', 'vehicle', 'park', 'go'])}
  (func (export "init") (param $seed i64)${start(place)})
  (func (export "step") (param $k i64)${send.map((s) => `
    (if (i64.eq (local.get $k) (i64.const ${s.at})) (then (drop (call $park (i32.const ${STATE_AT}) (i32.const ${s.v}) (i32.const ${s.bay})))))`).join('')}
    ${go(dt)})
  (data (i32.const ${DATA_AT}) "\\00"))`, 'program');
}

/**
 * Criterion 4: one vehicle at `from`. Step 0 lifts its forks to 0.1 m; then, each time it is parked: it takes a load
 * and goes to the rack (phase 1), lifts to the rack level (2), sets the load down and lowers to 0.1 m (3), goes on to
 * `to` (4). It writes its phase as `phase`, after the step's commands.
 */
export function liftProgram(module: string, l: Layout, place: number, rack: number, to: number, level: number, low: number): Program {
  const state = WRITES_AT + entryAt(l, 'writes', 'state'), phase = WRITES_AT + entryAt(l, 'writes', 'phase');
  const S = `(i32.const ${STATE_AT})`, V = '(i32.const 0)';
  return assemble(`lift_${tag(module)}_${state}_${phase}`, `${head(module, ['graph', 'vehicle', 'park', 'go', 'lift', 'carry', 'set_down'])}
  (func (export "init") (param $seed i64)${start([place])})
  (func (export "step") (param $k i64) (local $ph i32)
    (local.set $ph (i32.load (i32.const ${VARS_AT})))
    (block $done
      (if (i64.eqz (local.get $k)) (then (call $lift ${S} ${V} (f64.const ${low})) (br $done)))
      (br_if $done (i32.ne (i32.load (i32.const ${state})) (i32.const ${STATE.parked})))
      (if (i32.eq (local.get $ph) (i32.const 0))
        (then (call $carry ${S} ${V}) (drop (call $park ${S} ${V} (i32.const ${rack}))) (local.set $ph (i32.const 1)) (br $done)))
      (if (i32.eq (local.get $ph) (i32.const 1))
        (then (call $lift ${S} ${V} (f64.const ${level})) (local.set $ph (i32.const 2)) (br $done)))
      (if (i32.eq (local.get $ph) (i32.const 2))
        (then (call $set_down ${S} ${V}) (call $lift ${S} ${V} (f64.const ${low})) (local.set $ph (i32.const 3)) (br $done)))
      (if (i32.eq (local.get $ph) (i32.const 3))
        (then (drop (call $park ${S} ${V} (i32.const ${to}))) (local.set $ph (i32.const 4)))))
    (i32.store (i32.const ${VARS_AT}) (local.get $ph))
    ${go(0.1)}
    (i32.store (i32.const ${phase}) (local.get $ph)))
  (data (i32.const ${DATA_AT}) "\\00"))`, 'program');
}

/**
 * Criterion 5: six vehicles at their park bays, each with its legs (scenes.ts: fleetLegs) in its data, −1 after each
 * list; each step, every parked vehicle with a leg left is sent there, then go(0.5); it writes how many legs each has
 * been sent as `next`. `offGraph`: the wrong program, which moves vehicle 0's written position 0.06 m in x and in y
 * after each go.
 */
export function fleetProgram(module: string, l: Layout, legs: number[][], parks: number[], offGraph = false): Program {
  const v = legs.length;
  const state = WRITES_AT + entryAt(l, 'writes', 'state'), next = WRITES_AT + entryAt(l, 'writes', 'next'), pos = WRITES_AT + entryAt(l, 'writes', 'pos');
  const starts: number[] = [];
  const flat: number[] = [];
  for (const list of legs) { starts.push(flat.length); flat.push(...list, -1); }
  const data = Buffer.alloc(4 * (starts.length + flat.length));
  [...starts, ...flat].forEach((x, i) => data.writeInt32LE(x, 4 * i));
  const LEGS = DATA_AT + 4 * starts.length;
  const off = offGraph ? `
    (f64.store (i32.const ${pos}) (f64.add (f64.load (i32.const ${pos})) (f64.const 0.06)))
    (f64.store (i32.const ${pos + 8}) (f64.add (f64.load (i32.const ${pos + 8})) (f64.const 0.06)))` : '';
  return assemble(`fleet_${tag(module)}_${offGraph ? 'off' : 'on'}_${state}_${next}`, `${head(module, ['graph', 'vehicle', 'park', 'go'])}
  (func (export "init") (param $seed i64)${start(parks)})
  (func (export "step") (param $k i64) (local $v i32) (local $i i32) (local $leg i32)
    (local.set $v (i32.const 0))
    (loop $each
      (if (i32.eq (i32.load (i32.add (i32.const ${state}) (i32.shl (local.get $v) (i32.const 2)))) (i32.const ${STATE.parked}))
        (then
          (local.set $i (i32.load (i32.add (i32.const ${VARS_AT}) (i32.shl (local.get $v) (i32.const 2)))))
          (local.set $leg (i32.load (i32.add (i32.const ${LEGS})
            (i32.shl (i32.add (i32.load (i32.add (i32.const ${DATA_AT}) (i32.shl (local.get $v) (i32.const 2)))) (local.get $i)) (i32.const 2)))))
          (if (i32.ge_s (local.get $leg) (i32.const 0))
            (then
              (drop (call $park (i32.const ${STATE_AT}) (local.get $v) (local.get $leg)))
              (i32.store (i32.add (i32.const ${VARS_AT}) (i32.shl (local.get $v) (i32.const 2))) (i32.add (local.get $i) (i32.const 1)))))))
      (local.set $v (i32.add (local.get $v) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $v) (i32.const ${v}))))
    ${go(1 / FLEET.rate)}${off}
    (memory.copy (i32.const ${next}) (i32.const ${VARS_AT}) (i32.const ${4 * v})))
  (data (i32.const ${DATA_AT}) "${dataText(data)}"))`, 'program');
}

/**
 * Criterion 8's programs on the 400-path grid, 50 vehicles at bays 0 to 49. `busy`: steps 0 to 12 each send four
 * vehicles (4k to 4k + 3) to a seeded bay that isn't their own (a 64-bit LCG from 981, its top bits mod 54), then every
 * step calls go(0.1). `idle`: the same vehicles, and a step that calls nothing (the frame's own cost). `search`: the
 * same vehicles, and a step that only asks route() for SEARCHES[k mod 4], written as `t`.
 */
export function gridProgram(module: string, l: Layout, which: 'busy' | 'idle' | 'search'): Program {
  const n = GRID.vehicles, bays = GRID.spurCols * 2;
  const X = VARS_AT, CUR = VARS_AT + 8;
  const t = which === 'search' ? WRITES_AT + entryAt(l, 'writes', 't') : 0;
  const pairs = Buffer.alloc(8 * SEARCHES.length);
  SEARCHES.forEach(([a, b], i) => { pairs.writeInt32LE(a, 8 * i); pairs.writeInt32LE(b, 8 * i + 4); });
  const steps = {
    busy: `
    (if (i64.lt_u (local.get $k) (i64.const 13))
      (then
        (local.set $j (i32.const 0))
        (loop $four
          (local.set $v (i32.add (i32.shl (i32.wrap_i64 (local.get $k)) (i32.const 2)) (local.get $j)))
          (if (i32.lt_u (local.get $v) (i32.const ${n}))
            (then
              (i64.store (i32.const ${X}) (i64.add (i64.mul (i64.load (i32.const ${X})) (i64.const 6364136223846793005)) (i64.const 1442695040888963407)))
              (local.set $b (i32.wrap_i64 (i64.rem_u (i64.shr_u (i64.load (i32.const ${X})) (i64.const 33)) (i64.const ${bays}))))
              (if (i32.eq (local.get $b) (i32.load (i32.add (i32.const ${CUR}) (i32.shl (local.get $v) (i32.const 2)))))
                (then (local.set $b (i32.rem_u (i32.add (local.get $b) (i32.const 1)) (i32.const ${bays})))))
              (drop (call $park (i32.const ${STATE_AT}) (local.get $v) (local.get $b)))
              (i32.store (i32.add (i32.const ${CUR}) (i32.shl (local.get $v) (i32.const 2))) (local.get $b))))
          (local.set $j (i32.add (local.get $j) (i32.const 1)))
          (br_if $four (i32.lt_u (local.get $j) (i32.const 4))))))
    ${go(0.1)}`,
    idle: '',
    search: `
    (local.set $j (i32.add (i32.const ${DATA_AT}) (i32.shl (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const ${SEARCHES.length}))) (i32.const 3))))
    (f64.store (i32.const ${t}) (call $route (i32.const ${STATE_AT}) (i32.load (local.get $j)) (i32.load offset=4 (local.get $j))))`,
  }[which];
  const uses: Export[] = which === 'busy' ? ['graph', 'vehicle', 'park', 'go'] : which === 'search' ? ['graph', 'vehicle', 'route'] : ['graph', 'vehicle'];
  return assemble(`grid_${which}_${tag(module)}_${t}`, `${head(module, uses)}
  (func (export "init") (param $seed i64) (local $v i32)${start([])}
    (i64.store (i32.const ${X}) (i64.const 981))
    (loop $place
      (drop (call $vehicle (i32.const ${STATE_AT}) (local.get $v)))
      (i32.store (i32.add (i32.const ${CUR}) (i32.shl (local.get $v) (i32.const 2))) (local.get $v))
      (local.set $v (i32.add (local.get $v) (i32.const 1)))
      (br_if $place (i32.lt_u (local.get $v) (i32.const ${n})))))
  (func (export "step") (param $k i64) (local $j i32) (local $v i32) (local $b i32)${steps})
  (data (i32.const ${DATA_AT}) "${dataText(pairs)}"))`, 'program');
}
