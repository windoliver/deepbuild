// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text, assembled by
// #544's assembler (../544/wat, read only). Every one exports `memory` (its maximum equal to its minimum), `init(seed:
// i64)`, `step(k: i64)` and the immutable globals `reads_at` (0: no reads) and `writes_at` (4096), and keeps to the
// logic subset (no imports). The write region is laid out as the logic module lays it: each array in declaration order,
// its elements contiguous, a bool or an i32 4 bytes, an f64 8, a vec3 24 (three f64), each array starting on an 8-byte
// boundary. Each program writes every element it owns at every step, so an array's value after step k is a function of
// k alone, written out here beside the program as the expected values.

import { assemble, type Program } from './helpers.ts';

export const WRITES_AT = 4096;
export type ArrayType = 'bool' | 'i32' | 'f64' | 'vec3';
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
/** The pages a program needs for its write region. */
export function pagesFor(writes: Writes): number {
  const end = writes.reduce((o, [, type, count]) => Math.ceil((o + SIZE[type] * count) / 8) * 8, 0);
  return Math.ceil((WRITES_AT + end) / 65_536);
}
const head = (pages: number): string => `
  (memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64))`;
/** `(i32.store (i32.const addr) value)` when step k satisfies `cond` (a WebAssembly i32 condition on `$k`). */
const storeIf = (cond: string, addr: number, value: number): string => `(if ${cond} (then (i32.store (i32.const ${addr}) (i32.const ${value}))))`;
const kGe = (n: number): string => `(i64.ge_s (local.get $k) (i64.const ${n}))`;
const kLt = (n: number): string => `(i64.lt_s (local.get $k) (i64.const ${n}))`;
const kIn = (from: number, to: number): string => `(i32.and ${kGe(from)} ${kLt(to)})`;

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the 40 × 12 logic grid. `cells: i32 × 480`, row-major: index 40 y + x.

export const COLS = 40;
export const ROWS = 12;
export const CELLS = COLS * ROWS;
export const GLYPHS = ['.', '#', '@', 'é'];
export const ROLES = ['ink', 'accent'];
/** Packs a glyph index and the foreground and background role indices (Cell grid: logic grid). */
export const pack = (glyph: number, fg: number, bg: number): number => glyph | (fg << 12) | (bg << 16);
export const WALL = pack(1, 0, 1);
export const FLOOR = pack(0, 1, 0);
/** The criterion's cell: 0x1002, '@' in the accent role on the ink role. */
export const HERO = { x: 5, y: 3, value: 0x1002 } as const;
/** 'é' in accent on ink, so the glyph list's fourth entry draws. */
export const GEM = { x: 20, y: 6, value: pack(3, 1, 0) } as const;
/** The value 7 from step 30: glyph 7 passes the four-glyph list. */
export const BAD = { x: 12, y: 7, value: 7, from: 30 } as const;
/** The grid's value at (x, y) after step k: walls round the edge, floor inside, the hero, the gem and the bad cell. */
export function gridValue(x: number, y: number, k: number): number {
  if (x === HERO.x && y === HERO.y) return HERO.value;
  if (x === GEM.x && y === GEM.y) return GEM.value;
  if (x === BAD.x && y === BAD.y && k >= BAD.from) return BAD.value;
  return x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1 ? WALL : FLOOR;
}
const cellAddr = (x: number, y: number): number => WRITES_AT + 4 * (COLS * y + x);
export const gridProgram = (): Program => assemble('grid', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32) (local $x i32) (local $y i32)
    (loop $each
      (local.set $x (i32.rem_u (local.get $i) (i32.const ${COLS})))
      (local.set $y (i32.div_u (local.get $i) (i32.const ${COLS})))
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (select (i32.const ${WALL}) (i32.const ${FLOOR})
          (i32.or (i32.or (i32.eqz (local.get $x)) (i32.eq (local.get $x) (i32.const ${COLS - 1})))
                  (i32.or (i32.eqz (local.get $y)) (i32.eq (local.get $y) (i32.const ${ROWS - 1}))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${CELLS}))))
    (i32.store (i32.const ${cellAddr(HERO.x, HERO.y)}) (i32.const ${HERO.value}))
    (i32.store (i32.const ${cellAddr(GEM.x, GEM.y)}) (i32.const ${GEM.value}))
    ${storeIf(kGe(BAD.from), cellAddr(BAD.x, BAD.y), BAD.value)}))`);

// ---------------------------------------------------------------------------------------------------
// Criteria 2 and 3: `rules`, `item: i32 × 1` and `count: i32 × 1`.

export const RULES_WRITES: Writes = [['item', 'i32', 1], ['count', 'i32', 1]];
/** The steps each reading is taken at: item 17 with count 12, 1 and 0; item 99; item 17 again with count 12. */
export const LOOT = { twelve: 5, one: 15, zero: 25, missing: 30, again: 45 } as const;
/** rules.item after step k: 99 at steps 30 to 39, else 17. */
export const itemAt = (k: number): number => (k >= 30 && k < 40 ? 99 : 17);
/** rules.count after step k: 12 before step 10, 1 at 10 to 19, 0 at 20 to 29, and 12 from 30. */
export const countAt = (k: number): number => (k < 10 ? 12 : k < 20 ? 1 : k < 30 ? 0 : 12);
export function lootProgram(): Program {
  const o = offsets(RULES_WRITES);
  return assemble('loot', `
(module${head(1)}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${o['item']}) (i32.const 17))
    ${storeIf(kIn(30, 40), o['item']!, 99)}
    (i32.store (i32.const ${o['count']}) (i32.const 12))
    ${storeIf(kIn(10, 20), o['count']!, 1)}
    ${storeIf(kIn(20, 30), o['count']!, 0)}))`);
}
/** Criterion 4 and the fit check's budget: rules.item 1 and rules.count 5 at every step, so no step picks key 23. */
export function shopProgram(): Program {
  const o = offsets(RULES_WRITES);
  return assemble('shop', `
(module${head(1)}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${o['item']}) (i32.const 1))
    (i32.store (i32.const ${o['count']}) (i32.const 5))))`);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: `units`, `kind: i32 × 30`.

export const LABELS = 30;
export const KINDS = 10;
export const LOST = { row: 17, kind: 42, from: 30 } as const;
/** Row i's kind after step k: i mod 10, and 42 (a kind the table lacks) at row 17 from step 30. */
export const kindAt = (i: number, k: number): number => (i === LOST.row && k >= LOST.from ? LOST.kind : i % KINDS);
export const UNITS_WRITES: Writes = [['kind', 'i32', LABELS]];
export const unitsProgram = (): Program => assemble('units', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2))) (i32.rem_u (local.get $i) (i32.const ${KINDS})))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${LABELS}))))
    ${storeIf(kGe(LOST.from), WRITES_AT + 4 * LOST.row, LOST.kind)}))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 6: `story`, `line: i32 × 1`.

export const STORY_WRITES: Writes = [['line', 'i32', 1]];
export const LINE = { first: 20, unmapped: 60, last: 90 } as const;
/** story.line after step k: 12 before step 20, 37 at 20 to 59, 52 at 60 to 89, 5 from 90. */
export const lineAt = (k: number): number => (k < LINE.first ? 12 : k < LINE.unmapped ? 37 : k < LINE.last ? 52 : 5);
export const storyProgram = (): Program => assemble('story', `
(module${head(1)}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${WRITES_AT}) (i32.const 12))
    ${storeIf(kIn(LINE.first, LINE.unmapped), WRITES_AT, 37)}
    ${storeIf(kIn(LINE.unmapped, LINE.last), WRITES_AT, 52)}
    ${storeIf(kGe(LINE.last), WRITES_AT, 5)}))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 8: the budgets' programs.

/** `heap`: `a: i32 × 262,144`, 1 MiB written every step; element i is i + 1 once step i has run, so step k changes
 * element k alone. */
export const HEAP = 262_144;
export const HEAP_WRITES: Writes = [['a', 'i32', HEAP]];
export const heapProgram = (): Program => assemble('heap', `
(module${head(pagesFor(HEAP_WRITES))}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.add (local.get $i) (i64.le_s (i64.extend_i32_u (local.get $i)) (local.get $k))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${HEAP}))))))`);

/** `map`: `cells: i32 × 9,216` on 96 × 96, ((cx + 3 cy) + [i ≤ k]) mod 8, so step k changes cell k alone. */
export const LAYER_COLS = 96;
export const LAYER_CELLS = LAYER_COLS * LAYER_COLS;
export const LAYER_WRITES: Writes = [['cells', 'i32', LAYER_CELLS]];
export const layerProgram = (): Program => assemble('layer', `
(module${head(pagesFor(LAYER_WRITES))}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.rem_u
          (i32.add
            (i32.add (i32.rem_u (local.get $i) (i32.const ${LAYER_COLS})) (i32.mul (i32.const 3) (i32.div_u (local.get $i) (i32.const ${LAYER_COLS}))))
            (i64.le_s (i64.extend_i32_u (local.get $i)) (local.get $k)))
          (i32.const 8)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${LAYER_CELLS}))))))`);

/** `crowd`: 100,000 slots, `live: bool`, `gen: i32` (all live, gen 1) and `pos: vec3` at ((s mod 400) − 200, y,
 * ⌊s ÷ 400⌋ − 125) m, y 0.25 once step ⌊s ÷ 1,000⌋ has run, else 0: step k moves the 1,000 slots of block k alone. */
export const SLOTS = 100_000;
export const BLOCK = 1_000;
export const CROWD_WRITES: Writes = [['live', 'bool', SLOTS], ['gen', 'i32', SLOTS], ['pos', 'vec3', SLOTS]];
export function crowdProgram(): Program {
  const o = offsets(CROWD_WRITES);
  const pos = (k: number): string => `(i32.add (i32.const ${o['pos']! + 8 * k}) (i32.mul (local.get $i) (i32.const 24)))`;
  return assemble('crowd', `
(module${head(pagesFor(CROWD_WRITES))}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${o['live']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (i32.store (i32.add (i32.const ${o['gen']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (f64.store ${pos(0)} (f64.convert_i32_s (i32.sub (i32.rem_u (local.get $i) (i32.const 400)) (i32.const 200))))
      (f64.store ${pos(1)} (select (f64.const 0.25) (f64.const 0)
        (i64.le_s (i64.extend_i32_u (i32.div_u (local.get $i) (i32.const ${BLOCK}))) (local.get $k))))
      (f64.store ${pos(2)} (f64.convert_i32_s (i32.sub (i32.div_u (local.get $i) (i32.const 400)) (i32.const 125))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${SLOTS}))))))`);
}

/** `fogger`: `fog: i32 × 65,536` on 256 × 256, index 256 cz + cx: (cx + cz + k) mod 3, so every cell changes every step. */
export const FIELD = 256;
export const FOG_WRITES: Writes = [['fog', 'i32', FIELD * FIELD]];
export const foggerProgram = (): Program => assemble('fogger', `
(module${head(pagesFor(FOG_WRITES))}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.rem_u
          (i32.add (i32.add (i32.rem_u (local.get $i) (i32.const ${FIELD})) (i32.div_u (local.get $i) (i32.const ${FIELD})))
                   (i32.wrap_i64 (local.get $k)))
          (i32.const 3)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${FIELD * FIELD}))))))`);

// ---------------------------------------------------------------------------------------------------
// The Oracle lane's program (../538-oracle): `rules`, item 1 at every step and count `counts[k]` at step k.

export function countsProgram(name: string, counts: number[]): Program {
  const o = offsets(RULES_WRITES);
  return assemble(name, `
(module${head(1)}
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${o['item']}) (i32.const 1))
    (i32.store (i32.const ${o['count']}) (i32.const 0))
    ${counts.map((c, k) => `(if (i64.eq (local.get $k) (i64.const ${k})) (then (i32.store (i32.const ${o['count']}) (i32.const ${c}))))`).join('\n    ')}))`);
}
