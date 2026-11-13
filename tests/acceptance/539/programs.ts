// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text, assembled by
// #544's assembler (../544/wat, read only). Every one exports `memory` (its maximum equal to its minimum), `init(seed:
// i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at` (4096), and keeps to the logic subset (no
// imports). The write region is laid out as the logic module lays it (#535's suite): each array in declaration order,
// a bool or an i32 4 bytes, an f64 8, each array starting on an 8-byte boundary. Each program writes every element it
// owns at every step, so an array after step k is a function of k (and, for `rules`, of what it read).

import { assemble, type Program } from './helpers.ts';

export const WRITES_AT = 4096;
type ArrayType = 'bool' | 'i32' | 'f64';
const SIZE: Record<ArrayType, number> = { bool: 4, i32: 4, f64: 8 };
export type Writes = [string, ArrayType, number][];
/** The byte offset of each array of a write region in declaration order. */
export function offsets(writes: Writes): Record<string, number> {
  const out: Record<string, number> = {};
  let o = 0;
  for (const [name, type, count] of writes) {
    out[name] = WRITES_AT + o;
    o = Math.ceil((o + SIZE[type] * count) / 8) * 8;
  }
  return out;
}
const head = (readsAt: number, init = ''): string => `
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${readsAt}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64)${init})`;

export type Cell = [number, number];

// ---------------------------------------------------------------------------------------------------
// The grids' arrays: `tiles: i32 × cols·rows` and `alive: bool × cols·rows`, row-major (index cols × cy + cx, the cell
// grid.size lays row i at). Tile (cx + cy) mod 2: a checkerboard of the atlas's first two cells. Every cell alive but
// `dead`, and `dies` from its step on.

export interface WorldPlan { cols: number; rows: number; dead?: Cell[]; dies?: { cell: Cell; step: number } }
/** The 12 × 12 square grid, every cell drawn, and the 6 × 6 hex fixture's. */
export const SQUARE: WorldPlan = { cols: 12, rows: 12 };
export const HEX: WorldPlan = { cols: 6, rows: 6 };
export const worldWrites = (p: WorldPlan): Writes => [['tiles', 'i32', p.cols * p.rows], ['alive', 'bool', p.cols * p.rows]];
export const tileOf = (cx: number, cy: number): number => (cx + cy) % 2;
export function worldProgram(p: WorldPlan): Program {
  const n = p.cols * p.rows;
  const o = offsets(worldWrites(p));
  const at = ([cx, cy]: Cell): number => o['alive']! + 4 * (p.cols * cy + cx);
  const dead = (p.dead ?? []).map((c) => `(i32.store (i32.const ${at(c)}) (i32.const 0))`).join('\n    ');
  const dies = p.dies ? `(if (i64.ge_s (local.get $k) (i64.const ${p.dies.step})) (then (i32.store (i32.const ${at(p.dies.cell)}) (i32.const 0))))` : '';
  const name = `world-${p.cols}x${p.rows}${(p.dead ?? []).map(([x, y]) => `-d${x}.${y}`).join('')}${p.dies ? `-k${p.dies.cell.join('.')}@${p.dies.step}` : ''}`;
  return assemble(name, `
(module${head(0)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${o['tiles']}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.and (i32.add (i32.rem_u (local.get $i) (i32.const ${p.cols})) (i32.div_u (local.get $i) (i32.const ${p.cols}))) (i32.const 1)))
      (i32.store (i32.add (i32.const ${o['alive']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${n}))))
    ${dead}
    ${dies}))`);
}

// ---------------------------------------------------------------------------------------------------
// `rules`: reads the pick control `place` (README: the read region). Its read region starts at 1024 with `place`'s part:
// a u32 count and 4 zero bytes, then each entry as a u32 player, 4 zero bytes and the pick's 24 B (u32 set, 4 zero
// bytes, i64 key[0], i64 key[1]). Each step it copies that part's first 40 bytes, ten u32 words, into `got` (so `got`
// after step k is what step k read: w0 the count, w4 the set, w5 the zero bytes, w6/w7 key[0] low/high, w8/w9 key[1]),
// and, from the first entry it reads, keeps key[0] + 12 key[1] as the last picked cell (−1 before any), lighting that
// one cell of `lit` (bool × 144), which criterion 6's pictures draw.

export const READS_AT = 1024;
export const RULES_WRITES: Writes = [['got', 'i32', 10], ['lit', 'bool', 144]];
export function rulesProgram(): Program {
  const o = offsets(RULES_WRITES);
  return assemble('rules', `
(module${head(READS_AT, `
    (i32.store (i32.const 512) (i32.const -1))`)}
  (func (export "step") (param $k i64) (local $j i32) (local $last i32)
    (loop $copy
      (i32.store (i32.add (i32.const ${o['got']}) (i32.shl (local.get $j) (i32.const 2)))
        (i32.load (i32.add (i32.const ${READS_AT}) (i32.shl (local.get $j) (i32.const 2)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $copy (i32.lt_u (local.get $j) (i32.const 10))))
    (if (i32.gt_u (i32.load (i32.const ${READS_AT})) (i32.const 0))
      (then (i32.store (i32.const 512)
        (i32.add (i32.wrap_i64 (i64.load (i32.const ${READS_AT + 24})))
          (i32.mul (i32.const 12) (i32.wrap_i64 (i64.load (i32.const ${READS_AT + 32}))))))))
    (local.set $last (i32.load (i32.const 512)))
    (local.set $j (i32.const 0))
    (loop $lit
      (i32.store (i32.add (i32.const ${o['lit']}) (i32.shl (local.get $j) (i32.const 2))) (i32.eq (local.get $j) (local.get $last)))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $lit (i32.lt_u (local.get $j) (i32.const 144))))))`);
}
/** `got`'s ten words as a step read them. */
export interface Got { count: number; set: number; pad: number; key: [number, number]; high: [number, number] }
export const gotOf = (w: number[]): Got => ({ count: w[0]!, set: w[4]!, pad: w[5]!, key: [w[6]!, w[8]!], high: [w[7]!, w[9]!] });

// ---------------------------------------------------------------------------------------------------
// `troops`: 8 units, free rows. `alive: bool × 8`, `x`, `y`, `fog`: f64 × 8. Unit i at the centre of cell (2 + i, 8),
// (40 + 16 i, 136) u, alive, fog 1; `dead5`: unit 5's alive false; `fog5`: unit 5's fog (its opacity) 0.

export type Troops = 'all' | 'dead5' | 'fog5';
export const UNITS = 8;
export const UNIT = 5;
export const TROOP_WRITES: Writes = [['alive', 'bool', UNITS], ['x', 'f64', UNITS], ['y', 'f64', UNITS], ['fog', 'f64', UNITS]];
export const unitAt = (i: number): [number, number] => [40 + 16 * i, 136];
export const unitCell = (i: number): Cell => [2 + i, 8];
export function troopsProgram(v: Troops): Program {
  const o = offsets(TROOP_WRITES);
  const odd = v === 'dead5' ? `(i32.store (i32.const ${o['alive']! + 4 * UNIT}) (i32.const 0))` : v === 'fog5' ? `(f64.store (i32.const ${o['fog']! + 8 * UNIT}) (f64.const 0))` : '';
  return assemble(`troops-${v}`, `
(module${head(0)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${o['alive']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (f64.store (i32.add (i32.const ${o['x']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.add (i32.const 40) (i32.mul (i32.const 16) (local.get $i)))))
      (f64.store (i32.add (i32.const ${o['y']}) (i32.shl (local.get $i) (i32.const 3))) (f64.const 136))
      (f64.store (i32.add (i32.const ${o['fog']}) (i32.shl (local.get $i) (i32.const 3))) (f64.const 1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${UNITS}))))
    ${odd}))`);
}
