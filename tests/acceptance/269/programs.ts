// This suite's logic programs (README: Programs), in WebAssembly text, assembled by #544's assembler through #538's
// helpers (../538/helpers.ts `assemble`, read only). Each exports `memory`, `init`, `step` and the immutable globals
// `reads_at` (0) and `writes_at` (4096), keeps to the logic subset (no imports), and writes every cell of its one i32
// array at every step, so the array after step k is a function of k alone, written out here beside each program as the
// expected values the tests judge by.

import { assemble, type Program } from '../538/helpers.ts';
import { pagesFor, WRITES_AT } from '../538/programs.ts';

const head = (pages: number): string => `
  (memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64))`;

/** The roles every grid here names, by value: three teams, and 3 for `none`. A value of 4 or more is past `roles`. */
export const NONE = 3;

// ---------------------------------------------------------------------------------------------------
// The grid fixture: `teams.ground`, i32 × 4,096, a 64 × 64 grid, row-major (index 64 y + x).
//   x < 32, y < 32:  a three-role corner of four cells, two of them one role: 0 above row 16, then 1 left of column 16
//                    and 2 right of it (the corner where cells (15, 15), (16, 15), (15, 16) and (16, 16) meet);
//   x ≥ 32, y < 32:  `none`, but the lone held cell LONE, role 0;
//   y ≥ 32:          blocks of 4 × 4 cells cycling the three roles, ((x ÷ 4) + (y ÷ 4)) mod 3; step k (k ≥ 1) moves the 10
//                    cells of slots 10 k to 10 k + 9 on by one role and keeps them there, slot s being cell 2,048 + (397 s
//                    mod 2,048), so step k changes exactly those 10 cells;
//   BAD:             7 from step 30, a value past the four roles, inside the block of role 0.

export const SIDE = 64;
export const LONE = { x: 48, y: 16 } as const;
export const BAD = { x: 8, y: 6, value: 7, from: 30 } as const;
export const CORNER = { x: 16, y: 16 } as const;
/** 397's inverse mod 2,048: slot s of a cell 2,048 + j is j × 325 mod 2,048. */
const INVERSE = 325;
const MOVED = 10;
/** The slot of a cell of the lower half, whose step moves it (slot ÷ 10, from step 1). */
const slotOf = (x: number, y: number): number => (((64 * y + x - 2048) * INVERSE) % 2048 + 2048) % 2048;
/** The cells step k moves, in slot order. */
export function movedAt(k: number): { x: number; y: number }[] {
  return Array.from({ length: MOVED }, (_, m) => { const j = ((MOVED * k + m) * 397) % 2048; return { x: j % 64, y: 32 + Math.floor(j / 64) }; });
}
/** teams.ground at (x, y) after step k. */
export function teamAt(x: number, y: number, k: number): number {
  if (x === BAD.x && y === BAD.y && k >= BAD.from) return BAD.value;
  if (x === LONE.x && y === LONE.y) return 0;
  if (y < 32) return x < 32 ? (y < CORNER.y ? 0 : x < CORNER.x ? 1 : 2) : NONE;
  const base = (Math.floor(x / 4) + Math.floor(y / 4)) % 3;
  const s = slotOf(x, y);
  return s >= MOVED && s < MOVED * (k + 1) ? (base + 1) % 3 : base;
}
/** The rows whose cells step k changed, ascending (k ≥ 1). */
export function rowsChangedAt(k: number): number[] {
  const rows = new Set<number>();
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) if (teamAt(x, y, k) !== teamAt(x, y, k - 1)) rows.add(y);
  return [...rows].sort((a, b) => a - b);
}
const at = (x: number, y: number): number => WRITES_AT + 4 * (SIDE * y + x);
export const teamsProgram = (): Program => assemble('teams', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32) (local $x i32) (local $y i32) (local $v i32) (local $s i32) (local $k32 i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))
    (loop $each
      (local.set $x (i32.and (local.get $i) (i32.const 63)))
      (local.set $y (i32.shr_u (local.get $i) (i32.const 6)))
      (if (i32.lt_u (local.get $y) (i32.const 32))
        (then
          (if (i32.lt_u (local.get $x) (i32.const 32))
            (then (local.set $v (select (i32.const 0)
              (select (i32.const 1) (i32.const 2) (i32.lt_u (local.get $x) (i32.const ${CORNER.x})))
              (i32.lt_u (local.get $y) (i32.const ${CORNER.y})))))
            (else (local.set $v (i32.const ${NONE})))))
        (else
          (local.set $v (i32.rem_u (i32.add (i32.shr_u (local.get $x) (i32.const 2)) (i32.shr_u (local.get $y) (i32.const 2))) (i32.const 3)))
          (local.set $s (i32.and (i32.mul (i32.sub (local.get $i) (i32.const 2048)) (i32.const ${INVERSE})) (i32.const 2047)))
          (if (i32.and (i32.ge_u (local.get $s) (i32.const ${MOVED}))
                       (i32.lt_u (local.get $s) (i32.mul (i32.add (local.get $k32) (i32.const 1)) (i32.const ${MOVED}))))
            (then (local.set $v (i32.rem_u (i32.add (local.get $v) (i32.const 1)) (i32.const 3)))))))
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2))) (local.get $v))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${SIDE * SIDE}))))
    (i32.store (i32.const ${at(LONE.x, LONE.y)}) (i32.const 0))
    (if (i64.ge_s (local.get $k) (i64.const ${BAD.from})) (then (i32.store (i32.const ${at(BAD.x, BAD.y)}) (i32.const ${BAD.value}))))))`);

// ---------------------------------------------------------------------------------------------------
// The three-role corner alone: `front.ground`, i32 × 64, an 8 × 8 grid: role 0 in rows 0 to 3, then role 1 left of column
// 4 and role 2 right of it, at every step; its corner where cells (3, 3), (4, 3), (3, 4) and (4, 4) meet.

export const FRONT = 8;
export const frontAt = (x: number, y: number): number => (y < FRONT / 2 ? 0 : x < FRONT / 2 ? 1 : 2);
export const frontProgram = (): Program => assemble('front', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32) (local $x i32) (local $y i32)
    (loop $each
      (local.set $x (i32.and (local.get $i) (i32.const 7)))
      (local.set $y (i32.shr_u (local.get $i) (i32.const 3)))
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (select (i32.const 0) (select (i32.const 1) (i32.const 2) (i32.lt_u (local.get $x) (i32.const 4))) (i32.lt_u (local.get $y) (i32.const 4))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${FRONT * FRONT}))))))`);

// ---------------------------------------------------------------------------------------------------
// The budget's grid: `war.ground`, i32 × 65,536, 256 × 256: blocks of 16 × 16 cells cycling the three roles, each cell
// moving on by one role every 50 steps at its own phase, 7 i mod 50, so step k changes the cells whose phase is −k mod
// 50: 1,310 or 1,311 of 65,536, 2% of the grid, spread over every row.

export const WAR = 256;
export const WAR_PERIOD = 50;
export const warAt = (x: number, y: number, k: number): number => {
  const i = WAR * y + x;
  return (Math.floor(x / 16) + Math.floor(y / 16) + Math.floor((k + ((7 * i) % WAR_PERIOD)) / WAR_PERIOD)) % 3;
};
export const warProgram = (): Program => assemble('war', `
(module${head(pagesFor([['ground', 'i32', WAR * WAR]]))}
  (func (export "step") (param $k i64) (local $i i32) (local $k32 i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.rem_u
          (i32.add
            (i32.add (i32.shr_u (i32.and (local.get $i) (i32.const 255)) (i32.const 4)) (i32.shr_u (local.get $i) (i32.const 12)))
            (i32.div_u (i32.add (local.get $k32) (i32.rem_u (i32.mul (local.get $i) (i32.const 7)) (i32.const ${WAR_PERIOD}))) (i32.const ${WAR_PERIOD})))
          (i32.const 3)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${WAR * WAR}))))))`);
