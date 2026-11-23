// The redraft's logic program (README: The program): `war.ground`, i32 × 65,536, the 256 × 256 grid of the first suite's
// budget fixture (../269/fixtures.ts `warDoc`), row-major (index 256 y + x), in WebAssembly text assembled by #544's
// assembler through #538's helpers (read only). It keeps every step inside the logic item's default budget (Logic
// `logic@1`: 1,000,000 fuel a step, 4 MiB, 64 KiB of stack), so the grid really changes 2% of its cells a step; the values
// of every cell after every step are written out here beside it, and README: What was probed at the base checks them.
//   init:        blocks of 16 × 16 cells, value ((x ÷ 16) + (y ÷ 16)) mod 4: the three teams and `none` (3), the first
//                suite's four roles; one 16-cell run a loop pass, eight i64 stores of two cells each.
//   step 0:      changes nothing.
//   step k ≥ 1:  moves the 1,311 cells of slots 1,311 (k − 1) to 1,311 k − 1 on by one value, v → (v + 1) mod 4, slot t
//                being cell (40,503 t) mod 65,536; 40,503 is odd, so slots t and t + 65,536 are one cell and the 65,536
//                slots in a row are every cell once. So step k changes exactly 1,311 cells (2.0004%, the nearest whole
//                count to 2% of 65,536, 1,310.72), spread over all 256 rows, 3 to 6 a row; a cell changes about once
//                every 50 steps.

import { assemble, type Program } from '../538/helpers.ts';
import { pagesFor, WRITES_AT } from '../538/programs.ts';

export const SIDE = 256;
export const CELLS = SIDE * SIDE;
/** The cells each step from 1 moves on: 2% of the grid, rounded up to a whole cell. */
export const MOVED = 1311;
/** Slot t is cell (SPREAD × t) mod 65,536. */
export const SPREAD = 40503;
/** SPREAD's inverse mod 65,536: cell i is slot (i × INVERSE) mod 65,536. */
const INVERSE = (() => { for (let v = 1; v < CELLS; v += 2) if ((SPREAD * v) % CELLS === 1) return v; throw Error('SPREAD is odd, so it has an inverse'); })();

/** `war.ground` at cell index i as `init` leaves it. */
export const startAt = (i: number): number => (((i % SIDE) >> 4) + ((i >> 8) >> 4)) & 3;
/** `war.ground` at cell index i after step k: its start moved on once for every step from 1 to k whose slots hold its
 * slot. */
export function valueAt(i: number, k: number): number {
  const slot = (i * INVERSE) % CELLS;
  const used = MOVED * k;
  const times = slot < used ? Math.floor((used - 1 - slot) / CELLS) + 1 : 0;
  return (startAt(i) + times) & 3;
}
/** The cells step k moves on (none at step 0). */
export function movedAt(k: number): number[] {
  if (k < 1) return [];
  return Array.from({ length: MOVED }, (_, j) => ((MOVED * (k - 1) + j) * SPREAD) % CELLS);
}
/** The grid rows holding a cell step k changed, ascending, each once. */
export const rowsMovedAt = (k: number): number[] => [...new Set(movedAt(k).map((i) => i >> 8))].sort((a, b) => a - b);

/** Eight i64 stores of `$v` at `$p` + 0, 8, … 56: one 16-cell run. */
const EIGHT = Array.from({ length: 8 }, (_, j) => `(i64.store offset=${8 * j} (local.get $p) (local.get $v))`).join('\n      ');
export const program = (): Program => assemble('skirmish', `
(module
  (memory (export "memory") ${pagesFor([['ground', 'i32', CELLS]])} ${pagesFor([['ground', 'i32', CELLS]])})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64) (local $r i32) (local $p i32) (local $v i64)
    (local.set $p (i32.const ${WRITES_AT}))
    (loop $run
      (local.set $v (i64.mul
        (i64.extend_i32_u (i32.and (i32.add (i32.and (local.get $r) (i32.const 15)) (i32.shr_u (local.get $r) (i32.const 8))) (i32.const 3)))
        (i64.const 4294967297)))
      ${EIGHT}
      (local.set $p (i32.add (local.get $p) (i32.const 64)))
      (local.set $r (i32.add (local.get $r) (i32.const 1)))
      (br_if $run (i32.lt_u (local.get $r) (i32.const ${CELLS / 16})))))
  (func (export "step") (param $k i64) (local $t i32) (local $end i32) (local $p i32)
    (if (i64.eqz (local.get $k)) (then (return)))
    (local.set $t (i32.mul (i32.wrap_i64 (i64.sub (local.get $k) (i64.const 1))) (i32.const ${MOVED})))
    (local.set $end (i32.add (local.get $t) (i32.const ${MOVED})))
    (loop $each
      (local.set $p (i32.add (i32.const ${WRITES_AT})
        (i32.shl (i32.and (i32.mul (local.get $t) (i32.const ${SPREAD})) (i32.const ${CELLS - 1})) (i32.const 2))))
      (i32.store (local.get $p) (i32.and (i32.add (i32.load (local.get $p)) (i32.const 1)) (i32.const 3)))
      (local.set $t (i32.add (local.get $t) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $t) (local.get $end))))))`);
