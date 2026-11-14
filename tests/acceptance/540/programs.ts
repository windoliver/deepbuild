// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text, assembled by
// #544's assembler (../544/wat, read only). Every one exports `memory` (two pages, its maximum equal to its minimum),
// `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at` (65,536: past the largest read
// region one point control can fill, 8 + 16 × (256 + 8 + 8 × 256) B), and keeps to the logic subset (no imports). The
// write region is laid out as the logic module lays it: each array in declaration order, a bool or an
// i32 4 bytes, an f64 8, a vec3 24 (three f64), each array starting on an 8-byte boundary. A program that reads a point
// control finds, at `reads_at` (1024), the control's part of the read region as Logic `logic@1` lays a control out (a
// u32 count and 4 zero bytes, then each entry as a u32 player, 4 zero bytes and the entry's row), each row the point
// control's 248 B (README: The read region) and, after a box release that carries unit keys, their tail.

import { assemble, type Program } from './helpers.ts';
import type { V3 } from './geometry.ts';

export const WRITES_AT = 65_536;
export const READS_AT = 1024;
type ArrayType = 'bool' | 'i32' | 'f64' | 'vec3';
const SIZE: Record<ArrayType, number> = { bool: 4, i32: 4, f64: 8, vec3: 24 };
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
const head = (readsAt: number): string => `
  (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const ${readsAt}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64))`;
/** Scratch memory the programs keep between steps, below the read region. */
const TABLE = 64;

// ---------------------------------------------------------------------------------------------------
// The point control's row (README: The read region). Offsets from the row's start; an entry's row starts 8 bytes after
// the entry (its u32 player and 4 zero bytes).

export const ROW = {
  phase: 0, button: 1, mods: 2, flags: 3, x: 8, y: 16, z: 24, set: 32, key0: 40, key1: 48, corners: 56, normal: 152, uv: 176, face: 192,
  origin: 200, dir: 224, tail: 248,
} as const;
export const ROW_BYTES = 248;
/** Phase codes, button codes and the bits of `mods` and `flags` (README: Byte codes). */
export const PHASE = { press: 0, move: 1, release: 2 } as const;
export const BUTTON = { primary: 0, secondary: 1, middle: 2 } as const;
export const MODS = { shift: 1, ctrl: 2, alt: 4, meta: 8 } as const;
export const FLAG = { cell: 1, ground: 2, hit: 4, corners: 8, surface: 16, uv: 32, ray: 64, units: 128 } as const;

/**
 * Walks the read region's entries of the one control read at READS_AT, calling `$entry` with each entry's start (its
 * player word): a u32 count and 4 zero bytes, then each entry's 8 B and 248 B row, and after a row whose flags hold
 * `units`, the tail (u32 n, u32 truncated, n × (u32 slot, u32 gen)).
 */
const WALK = `
  (func $walk (local $n i32) (local $i i32) (local $e i32)
    (local.set $n (i32.load (i32.const ${READS_AT})))
    (local.set $e (i32.const ${READS_AT + 8}))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (call $entry (local.get $e))
        (local.set $e (i32.add (local.get $e)
          (if (result i32) (i32.and (i32.load8_u (i32.add (local.get $e) (i32.const ${8 + ROW.flags}))) (i32.const ${FLAG.units}))
            (then (i32.add (i32.const ${8 + ROW_BYTES + 8}) (i32.shl (i32.load (i32.add (local.get $e) (i32.const ${8 + ROW.tail}))) (i32.const 3))))
            (else (i32.const ${8 + ROW_BYTES})))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each))))`;
/** Copies `words` u32 words from `from` to `to`. */
const COPY = `
  (func $copy (param $from i32) (param $to i32) (param $words i32) (local $j i32)
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $j) (local.get $words)))
        (i32.store (i32.add (local.get $to) (i32.shl (local.get $j) (i32.const 2)))
          (i32.load (i32.add (local.get $from) (i32.shl (local.get $j) (i32.const 2)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $each))))`;
/** Writes `n` i32 words from `from` into the array at `to` (a bool array the same: 0 or 1 a word). */
const out = (from: number, to: number, n: number): string => `(call $copy (i32.const ${from}) (i32.const ${to}) (i32.const ${n}))`;

// ---------------------------------------------------------------------------------------------------
// The 12 × 12 grid (criterion 1): `tiles: i32` and `alive: bool`, one per cell, row-major (index 12 cy + cx): tile
// (cx + cy) mod 2, every cell alive.

export const GRID = 12;
export const WORLD_WRITES: Writes = [['tiles', 'i32', GRID * GRID], ['alive', 'bool', GRID * GRID]];
export function worldProgram(): Program {
  const o = offsets(WORLD_WRITES);
  return assemble('world', `
(module${head(0)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${o['tiles']}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.and (i32.add (i32.rem_u (local.get $i) (i32.const ${GRID})) (i32.div_u (local.get $i) (i32.const ${GRID}))) (i32.const 1)))
      (i32.store (i32.add (i32.const ${o['alive']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${GRID * GRID}))))))`);
}

// `belts` (criterion 1): reads `place`. Each entry whose flags hold a cell lays a belt on the cell its row's x and y
// name (cx, cy), kept from step to step; `belts: bool × 144` is every cell's belt, row-major.
export const BELT_WRITES: Writes = [['belts', 'bool', GRID * GRID]];
export function beltsProgram(): Program {
  const o = offsets(BELT_WRITES);
  return assemble('belts', `
(module${head(READS_AT)}${WALK}${COPY}
  (func $entry (param $e i32) (local $cx i32) (local $cy i32)
    (if (i32.and (i32.load8_u (i32.add (local.get $e) (i32.const ${8 + ROW.flags}))) (i32.const ${FLAG.cell}))
      (then
        (local.set $cx (i32.trunc_f64_s (f64.load (i32.add (local.get $e) (i32.const ${8 + ROW.x})))))
        (local.set $cy (i32.trunc_f64_s (f64.load (i32.add (local.get $e) (i32.const ${8 + ROW.y})))))
        (if (i32.and (i32.and (i32.ge_s (local.get $cx) (i32.const 0)) (i32.lt_s (local.get $cx) (i32.const ${GRID})))
                     (i32.and (i32.ge_s (local.get $cy) (i32.const 0)) (i32.lt_s (local.get $cy) (i32.const ${GRID}))))
          (then (i32.store (i32.add (i32.const ${TABLE}) (i32.shl (i32.add (local.get $cx) (i32.mul (local.get $cy) (i32.const ${GRID}))) (i32.const 2)))
            (i32.const 1)))))))
  (func (export "step") (param $k i64)
    (call $walk)
    ${out(TABLE, o['belts']!, GRID * GRID)}))`);
}

// `pins` (criteria 4 and 11): reads `aim`, and keeps the last press entry it read: `rec: i32 × 64`, that entry's 256 B
// as the region held them (its u32 player, 4 zero bytes and its 248 B row), word by word, all zero before any press.
export const REC_WORDS = 64;
export const PIN_WRITES: Writes = [['rec', 'i32', REC_WORDS]];
export function pinsProgram(): Program {
  const o = offsets(PIN_WRITES);
  return assemble('pins', `
(module${head(READS_AT)}${WALK}${COPY}
  (func $entry (param $e i32)
    (if (i32.eq (i32.load8_u (i32.add (local.get $e) (i32.const ${8 + ROW.phase}))) (i32.const ${PHASE.press}))
      (then (call $copy (local.get $e) (i32.const ${TABLE}) (i32.const ${REC_WORDS})))))
  (func (export "step") (param $k i64)
    (call $walk)
    ${out(TABLE, o['rec']!, REC_WORDS)}))`);
}

// ---------------------------------------------------------------------------------------------------
// The units (criteria 2 and 7): `army` writes `live: bool × 10`, `gen: i32 × 10` and `pos: vec3 × 10`; unit i live
// with gen 1 at (x_i + v (k − K0), y, z_i) after step k, its y the plate's height there or 0 (README: Fixtures).

export const UNITS = 10;
export const ARMY_WRITES: Writes = [['live', 'bool', UNITS], ['gen', 'i32', UNITS], ['pos', 'vec3', UNITS]];
export interface Army { name: string; at: [number, number][]; perStep: number; k0: number; height: (x: number, z: number) => number; heightText: (x: string, z: string) => string }
/** Unit i's position after step k. */
export const unitAt = (a: Army, i: number, k: number): V3 => {
  const x = a.at[i]![0] + a.perStep * (k - a.k0), z = a.at[i]![1];
  return [x, a.height(x, z), z];
};
export function armyProgram(a: Army): Program {
  const o = offsets(ARMY_WRITES);
  const units = a.at.map(([x, z], i) => {
    const xs = `(f64.add (f64.const ${x}) (f64.mul (f64.const ${a.perStep}) (f64.convert_i64_s (i64.sub (local.get $k) (i64.const ${a.k0})))))`;
    return `
    (i32.store (i32.const ${o['live']! + 4 * i}) (i32.const 1))
    (i32.store (i32.const ${o['gen']! + 4 * i}) (i32.const 1))
    (local.set $x ${xs})
    (f64.store (i32.const ${o['pos']! + 24 * i}) (local.get $x))
    (f64.store (i32.const ${o['pos']! + 24 * i + 8}) ${a.heightText('(local.get $x)', `(f64.const ${z})`)})
    (f64.store (i32.const ${o['pos']! + 24 * i + 16}) (f64.const ${z}))`;
  }).join('');
  return assemble(a.name, `
(module${head(0)}
  (func (export "step") (param $k i64) (local $x f64)${units}))`);
}

// `select` (criterion 2): reads `box`. On a release whose flags hold `corners`, it keeps that entry's 256 B (`rel: i32 ×
// 64`, as `pins` keeps one) and selects the units whose x and z lie inside the polygon of the four corners' x and z
// (the crossing rule), replacing the selection: `selected: bool × 10`. The units' x and z are its own constants, the
// same as `army`'s (they stand still here).
export const SELECT_WRITES: Writes = [['selected', 'bool', UNITS], ['rel', 'i32', REC_WORDS]];
const INSIDE = `
  (func $inside (param $px f64) (param $pz f64) (param $c i32) (result i32)
    (local $i i32) (local $j i32) (local $in i32) (local $xi f64) (local $zi f64) (local $xj f64) (local $zj f64)
    (local.set $j (i32.const 3))
    (loop $edge
      (local.set $xi (f64.load (i32.add (local.get $c) (i32.mul (local.get $i) (i32.const 24)))))
      (local.set $zi (f64.load (i32.add (local.get $c) (i32.add (i32.mul (local.get $i) (i32.const 24)) (i32.const 16)))))
      (local.set $xj (f64.load (i32.add (local.get $c) (i32.mul (local.get $j) (i32.const 24)))))
      (local.set $zj (f64.load (i32.add (local.get $c) (i32.add (i32.mul (local.get $j) (i32.const 24)) (i32.const 16)))))
      (if (i32.ne (f64.gt (local.get $zi) (local.get $pz)) (f64.gt (local.get $zj) (local.get $pz)))
        (then
          (if (f64.lt (local.get $px)
                (f64.add (f64.div (f64.mul (f64.sub (local.get $xj) (local.get $xi)) (f64.sub (local.get $pz) (local.get $zi)))
                                  (f64.sub (local.get $zj) (local.get $zi)))
                         (local.get $xi)))
            (then (local.set $in (i32.xor (local.get $in) (i32.const 1)))))))
      (local.set $j (local.get $i))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $edge (i32.lt_u (local.get $i) (i32.const 4))))
    (local.get $in))`;
const SEL = TABLE;
const REL = TABLE + 4 * UNITS;
export function selectProgram(at: [number, number][]): Program {
  const o = offsets(SELECT_WRITES);
  const tests = at.map(([x, z], i) =>
    `(i32.store (i32.const ${SEL + 4 * i}) (call $inside (f64.const ${x}) (f64.const ${z}) (i32.add (local.get $e) (i32.const ${8 + ROW.corners}))))`).join('\n          ');
  return assemble('select', `
(module${head(READS_AT)}${WALK}${COPY}${INSIDE}
  (func $entry (param $e i32)
    (if (i32.and
          (i32.eq (i32.load8_u (i32.add (local.get $e) (i32.const ${8 + ROW.phase}))) (i32.const ${PHASE.release}))
          (i32.ne (i32.and (i32.load8_u (i32.add (local.get $e) (i32.const ${8 + ROW.flags}))) (i32.const ${FLAG.corners})) (i32.const 0)))
      (then
          ${tests}
          (call $copy (local.get $e) (i32.const ${REL}) (i32.const ${REC_WORDS})))))
  (func (export "step") (param $k i64)
    (call $walk)
    ${out(SEL, o['selected']!, UNITS)}
    ${out(REL, o['rel']!, REC_WORDS)}))`);
}

// `orders` (criterion 7): reads `box`. On a release whose flags hold `units`, it replaces the selection with the units
// its keys name, each (slot, gen) whose slot is below 10 and whose gen is 1, the generation `army` gives every unit:
// `selected: bool × 10`; `releases: i32 × 1` counts the releases it has read.
export const ORDER_WRITES: Writes = [['selected', 'bool', UNITS], ['releases', 'i32', 1]];
export function ordersProgram(): Program {
  const o = offsets(ORDER_WRITES);
  const COUNT = SEL + 4 * UNITS;
  return assemble('orders', `
(module${head(READS_AT)}${WALK}${COPY}
  (func $entry (param $e i32) (local $n i32) (local $j i32) (local $slot i32) (local $key i32)
    (if (i32.and
          (i32.eq (i32.load8_u (i32.add (local.get $e) (i32.const ${8 + ROW.phase}))) (i32.const ${PHASE.release}))
          (i32.ne (i32.and (i32.load8_u (i32.add (local.get $e) (i32.const ${8 + ROW.flags}))) (i32.const ${FLAG.units})) (i32.const 0)))
      (then
        (i32.store (i32.const ${COUNT}) (i32.add (i32.load (i32.const ${COUNT})) (i32.const 1)))
        (local.set $j (i32.const 0))
        (loop $clear
          (i32.store (i32.add (i32.const ${SEL}) (i32.shl (local.get $j) (i32.const 2))) (i32.const 0))
          (local.set $j (i32.add (local.get $j) (i32.const 1)))
          (br_if $clear (i32.lt_u (local.get $j) (i32.const ${UNITS}))))
        (local.set $n (i32.load (i32.add (local.get $e) (i32.const ${8 + ROW.tail}))))
        (local.set $j (i32.const 0))
        (block $done
          (loop $each
            (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
            (local.set $key (i32.add (local.get $e) (i32.add (i32.const ${8 + ROW.tail + 8}) (i32.shl (local.get $j) (i32.const 3)))))
            (local.set $slot (i32.load (local.get $key)))
            (if (i32.and (i32.lt_u (local.get $slot) (i32.const ${UNITS})) (i32.eq (i32.load (i32.add (local.get $key) (i32.const 4))) (i32.const 1)))
              (then (i32.store (i32.add (i32.const ${SEL}) (i32.shl (local.get $slot) (i32.const 2))) (i32.const 1))))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $each))))))
  (func (export "step") (param $k i64)
    (call $walk)
    ${out(SEL, o['selected']!, UNITS)}
    ${out(COUNT, o['releases']!, 1)}))`);
}

// ---------------------------------------------------------------------------------------------------
// Reading a row back: `rec` and `rel` hold an entry's 256 B as i32 words (a JSON number each, as the `logic` call
// reports an i32 array); these give its bytes.

/** The bytes of i32 words, little-endian. */
export function bytesOf(words: readonly number[]): Buffer {
  const b = Buffer.alloc(words.length * 4);
  words.forEach((w, i) => b.writeInt32LE(w | 0, i * 4));
  return b;
}
/** An entry's row as a logic item read it, from its 256 B (the u32 player and 4 zero bytes first). */
export interface Row {
  bytes: Buffer;
  player: number; pad: number;
  phase: number; button: number; mods: number; flags: number; zero4: number;
  xyz: V3; set: number; zeroSet: number; key: [bigint, bigint];
  corners: [V3, V3, V3, V3]; normal: V3; uv: [number, number]; face: number; zeroFace: number; origin: V3; dir: V3;
}
export function rowOf(words: readonly number[]): Row {
  const b = bytesOf(words);
  const v = (o: number): number => b.readDoubleLE(8 + o);
  const v3 = (o: number): V3 => [v(o), v(o + 8), v(o + 16)];
  return {
    bytes: b, player: b.readUInt32LE(0), pad: b.readUInt32LE(4),
    phase: b.readUInt8(8 + ROW.phase), button: b.readUInt8(8 + ROW.button), mods: b.readUInt8(8 + ROW.mods), flags: b.readUInt8(8 + ROW.flags),
    zero4: b.readUInt32LE(8 + 4),
    xyz: v3(ROW.x), set: b.readUInt32LE(8 + ROW.set), zeroSet: b.readUInt32LE(8 + ROW.set + 4), key: [b.readBigInt64LE(8 + ROW.key0), b.readBigInt64LE(8 + ROW.key1)],
    corners: [v3(ROW.corners), v3(ROW.corners + 24), v3(ROW.corners + 48), v3(ROW.corners + 72)],
    normal: v3(ROW.normal), uv: [v(ROW.uv), v(ROW.uv + 8)], face: b.readUInt32LE(8 + ROW.face), zeroFace: b.readUInt32LE(8 + ROW.face + 4),
    origin: v3(ROW.origin), dir: v3(ROW.dir),
  };
}
