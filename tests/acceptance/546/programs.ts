// This suite's own logic programs, as WebAssembly text, and the grids it searches (README: Programs). The guide's
// examples (the grid search, split or not, and the dice game) are read from deep_kinds instead; nothing here stands in
// for them.

import { expect } from 'vitest';
import { assemble, bakeCall, bakeOf, fuelOf, onMac, piece, seeded, sha256, type JsonObject, type Program } from './helpers.ts';

// ---------------------------------------------------------------------------------------------------
// burn: step k runs a loop counts[k] times (none past the table), so its fuel is b + a × counts[k], and writes the
// loop's sum to `acc`. One page of memory; the counts sit in a data segment at 4,096.

const hexBytes = (b: Buffer): string => [...b].map((x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
export function burnWat(counts: readonly number[]): string {
  const data = Buffer.alloc(4 * counts.length);
  counts.forEach((n, i) => data.writeUInt32LE(n, 4 * i));
  return `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (data (i32.const 4096) "${hexBytes(data)}")
  (func (export "init") (param i64))
  (func (export "step") (param $k i64) (local $n i32) (local $acc i32)
    (if (i64.lt_u (local.get $k) (i64.const ${counts.length}))
      (then (local.set $n (i32.load (i32.add (i32.const 4096) (i32.shl (i32.wrap_i64 (local.get $k)) (i32.const 2)))))))
    (block $done
      (loop $spin
        (br_if $done (i32.eqz (local.get $n)))
        (local.set $acc (i32.add (local.get $acc) (local.get $n)))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (br $spin)))
    (i32.store (i32.const 1024) (local.get $acc))))
`;
}
export const burn = (counts: readonly number[]): Program => assemble(`burn_${sha256(counts.join(',')).slice(0, 8)}`, burnWat(counts));
/** burn's item params at `hz`, its fuel budget the cap so no step of these tests traps. */
export const burnParams = (hz: number): JsonObject => ({ step_rate: hz, writes: { acc: { type: 'i32' } }, budget: { fuel: 10_000_000 } });

/** burn's fuel line, read off one bake on this Mac: a step of n iterations spends b + a × n. */
export interface Line { a: number; b: number; count: (fuel: number) => number }
let line: Line | undefined;
export function burnLine(): Line {
  if (line) return line;
  const counts = [0, 1_000, 101_000];
  const [reply] = onMac([bakeCall(piece({ seed: 546, class: 'figure', items: { burn: { program: burn(counts), params: burnParams(60) } } }), { steps: 3 })]);
  const fuel = fuelOf(bakeOf(reply!, 'burn\'s calibration bake'), 'burn');
  const [f0, f1, f2] = [fuel.get(0)!, fuel.get(1)!, fuel.get(2)!];
  const a = (f2 - f1) / 100_000;
  expect(a > 0 && Number.isInteger(a) && f1 - f0 === 1_000 * a, `burn's fuel is linear in its loop count (fuel ${f0}, ${f1}, ${f2})`).toBe(true);
  line = { a, b: f0, count: (fuel: number) => Math.max(0, Math.floor((fuel - f0) / a)) };
  return line;
}
/** Loop counts whose fuels sit just under and just over `threshold`: two at or under it, two over it. */
export function straddle(l: Line, threshold: number): number[] {
  const n = l.count(threshold);
  return [n - 1, n, n + 1, n + 2].map((x) => Math.max(0, x));
}

// ---------------------------------------------------------------------------------------------------
// crowd: 600 units. Each step moves every unit by its velocity (set by init from the seed, by xorshift64) after a
// loop of W iterations per unit of a dependent square root and division chain (slow per fuel unit, so a heavy step
// takes real time), and writes the units' positions to `pos` (vec2, linear) and a phase to `phase` (i32, hold). The
// write region sits at 1,024 (pos 9,600 bytes, phase 2,400), the velocities at 16,384.

export const UNITS = 600;
export function crowdWat(w: number): string {
  return `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param $seed i64) (local $i i32) (local $s i64) (local $v i32)
    (local.set $s (i64.or (local.get $seed) (i64.const 1)))
    (loop $each
      (local.set $s (i64.xor (local.get $s) (i64.shl (local.get $s) (i64.const 13))))
      (local.set $s (i64.xor (local.get $s) (i64.shr_u (local.get $s) (i64.const 7))))
      (local.set $s (i64.xor (local.get $s) (i64.shl (local.get $s) (i64.const 17))))
      (local.set $v (i32.add (i32.const 16384) (i32.shl (local.get $i) (i32.const 4))))
      (f64.store (local.get $v) (f64.sub (f64.div (f64.convert_i64_u (i64.and (local.get $s) (i64.const 65535))) (f64.const 65536)) (f64.const 0.5)))
      (f64.store offset=8 (local.get $v) (f64.sub (f64.div (f64.convert_i64_u (i64.and (i64.shr_u (local.get $s) (i64.const 16)) (i64.const 65535))) (f64.const 65536)) (f64.const 0.5)))
      (f64.store (i32.add (i32.const 1024) (i32.shl (local.get $i) (i32.const 4))) (f64.convert_i32_u (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${UNITS})))))
  (func (export "step") (param $k i64) (local $i i32) (local $j i32) (local $a f64) (local $p i32) (local $v i32)
    (loop $each
      (local.set $p (i32.add (i32.const 1024) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $v (i32.add (i32.const 16384) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $a (f64.const 0))
      (local.set $j (i32.const ${w}))
      (block $done
        (loop $work
          (br_if $done (i32.eqz (local.get $j)))
          (local.set $a (f64.div (f64.sqrt (f64.add (local.get $a) (f64.const 1.5))) (f64.const 1.25)))
          (local.set $a (f64.div (f64.sqrt (f64.add (local.get $a) (f64.const 1.5))) (f64.const 1.25)))
          (local.set $a (f64.div (f64.sqrt (f64.add (local.get $a) (f64.const 1.5))) (f64.const 1.25)))
          (local.set $a (f64.div (f64.sqrt (f64.add (local.get $a) (f64.const 1.5))) (f64.const 1.25)))
          (local.set $j (i32.sub (local.get $j) (i32.const 1)))
          (br $work)))
      (f64.store (local.get $p) (f64.add (f64.load (local.get $p)) (f64.add (f64.load (local.get $v)) (f64.mul (local.get $a) (f64.const 0.000001)))))
      (f64.store offset=8 (local.get $p) (f64.add (f64.load offset=8 (local.get $p)) (f64.load offset=8 (local.get $v))))
      (i32.store (i32.add (i32.const 10624) (i32.shl (local.get $i) (i32.const 2))) (i32.and (i32.add (i32.wrap_i64 (local.get $k)) (local.get $i)) (i32.const 7)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${UNITS}))))))
`;
}
export const crowd = (w: number): Program => assemble(`crowd_${w}`, crowdWat(w));
/** crowd's item at 30 Hz: only linear and hold writes; a checkpoint every step, so a bake holds every step's full-state hash. */
export const crowdParams = (): JsonObject => ({
  step_rate: 30,
  writes: { pos: { type: 'vec2', count: UNITS, interpolate: 'linear' }, phase: { type: 'i32', count: UNITS, interpolate: 'hold' } },
  budget: { fuel: 10_000_000 }, checkpoint: { every: 1 },
});

// ---------------------------------------------------------------------------------------------------
// Grids for the guide's search (README: The guide's examples: the grid asset). A seeded square grid, a fifth of its
// cells walls, the start at the top-left corner and the goal at the bottom-right, both corners' 2 × 2 cells open;
// the next seed is drawn until the goal is reachable. The test's own breadth-first search gives the shortest route's
// length, which a route the guide's search finds must have.

export interface Grid { side: number; start: number; goal: number; walls: Uint8Array; bytes: Buffer; cells: number }
/** Cells on a shortest route from start to goal (start and goal included), or 0 when none. */
export function shortest(side: number, walls: Uint8Array, start: number, goal: number): number {
  const dist = new Int32Array(side * side).fill(-1);
  const queue = new Int32Array(side * side);
  let head = 0; let tail = 0;
  dist[start] = 0; queue[tail++] = start;
  while (head < tail) {
    const c = queue[head++]!;
    if (c === goal) return dist[c]! + 1;
    const x = c % side; const y = (c - x) / side;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
      const n = ny * side + nx;
      if (walls[n] === 1 || dist[n] !== -1) continue;
      dist[n] = dist[c]! + 1;
      queue[tail++] = n;
    }
  }
  return 0;
}
export function grid(side: number, seed: number): Grid {
  for (let attempt = 0; attempt < 100; attempt++) {
    const r = seeded(seed + 7_919 * side + 104_729 * attempt);
    const walls = new Uint8Array(side * side);
    for (let i = 0; i < walls.length; i++) walls[i] = r() < 0.2 ? 1 : 0;
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [side - 1, side - 1], [side - 2, side - 1], [side - 1, side - 2], [side - 2, side - 2]] as const) walls[y * side + x] = 0;
    const start = 0;
    const goal = side * side - 1;
    const cells = shortest(side, walls, start, goal);
    if (cells === 0) continue;
    const head = Buffer.alloc(16);
    head.writeUInt32LE(side, 0); head.writeUInt32LE(side, 4); head.writeUInt32LE(start, 8); head.writeUInt32LE(goal, 12);
    return { side, start, goal, walls, bytes: Buffer.concat([head, Buffer.from(walls)]), cells };
  }
  return expect.fail(`no seeded ${side} × ${side} grid with a route from corner to corner`);
}
/** What's wrong with a route on a grid: each problem names the route's first bad cell. */
export function routeProblems(g: Grid, route: readonly number[], what: string): string[] {
  const out: string[] = [];
  if (route.length !== g.cells) out.push(`${what} has ${route.length} cells; a shortest route has ${g.cells}`);
  if (route[0] !== g.start) out.push(`${what} starts at cell ${String(route[0])}, not the start ${g.start}`);
  if (route[route.length - 1] !== g.goal) out.push(`${what} ends at cell ${String(route[route.length - 1])}, not the goal ${g.goal}`);
  for (let i = 0; i < route.length; i++) {
    const c = route[i]!;
    if (!Number.isInteger(c) || c < 0 || c >= g.side * g.side || g.walls[c] === 1) { out.push(`${what}'s cell ${i} (${c}) is off the grid or a wall`); break; }
    if (i > 0) {
      const p = route[i - 1]!;
      if (Math.abs((c % g.side) - (p % g.side)) + Math.abs(Math.floor(c / g.side) - Math.floor(p / g.side)) !== 1) { out.push(`${what}'s cells ${i - 1} and ${i} (${p}, ${c}) aren't neighbours`); break; }
    }
  }
  return out;
}
