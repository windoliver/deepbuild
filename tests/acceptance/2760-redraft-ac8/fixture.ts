// The pond the budget is timed on (README: The fixture): a 12 m × 12 m plate `pond` seen from 30° above the horizon,
// filling half a 1920 × 1080 frame, and a logic item `drips` whose occurrence list keeps exactly 64 rings alive on it
// at every instant from 2 s on, one in each cell of an 8 × 8 grid of 1.5 m cells.

import {
  type Cam, DAY_SKY, type JsonObject, type Program, assemble, box, camItem, logicItem, material, plate, project, sceneDoc, sun,
} from './helpers.ts';

export const SIZE: [number, number] = [1920, 1080];
/** The document's frame rate and the logic item's step rate: frame n and step n fall on one flick, n ÷ 60 s. */
export const FPS = 60;
/** The Fields row's defaults, which the fixture leaves unwritten: a ring lives `span` s and its crest runs at `speed`. */
export const SPAN = 2;
export const SPEED = 0.3;

/** The grid: 8 × 8 cells of 1.5 m, so the pond is 12 m a side, centred on the origin. A ring's crest never passes
 * speed × span = 0.6 m from its centre, so no ring reaches within 0.9 m of another cell's centre. */
export const SIDE = 8;
export const CELL = 1.5;
export const POND = SIDE * CELL;
export const CELLS = SIDE * SIDE;
/** The centre of cell `slot` (0 to 63, row by row from the far left corner) in world x and z. */
export const cellCentre = (slot: number): [number, number] =>
  [(slot % SIDE - (SIDE - 1) / 2) * CELL, (Math.floor(slot / SIDE) - (SIDE - 1) / 2) * CELL];
/** The cell that holds the point (x, z), or −1 off the pond. */
export function cellOf(x: number, z: number): number {
  const col = Math.floor(x / CELL + SIDE / 2); const row = Math.floor(z / CELL + SIDE / 2);
  return col >= 0 && col < SIDE && row >= 0 && row < SIDE ? row * SIDE + col : -1;
}

/** The steps a touch falls on: 8 of every 15, the even ones of k mod 15, so every 120 steps (the rings' 2 s) hold 64
 * touches wherever they start, and a ring is alive from its flick until 2 s after it: 64 alive at every instant from
 * step 119 on, never 65. */
const PERIOD = 15;
export const touches = (k: number): boolean => (k % PERIOD) % 2 === 0;
/** The row a touch at step `k` is in the list, from 0: one row a step, so the list's order is the steps'. */
export const rowOf = (k: number): number => 8 * Math.floor(k / PERIOD) + (k % PERIOD) / 2;
/** Its cell: the rows walk the 64 cells in order, round and round, so each cell is touched every 120 steps, as its
 * last ring ends. */
export const slotOf = (k: number): number => rowOf(k) % CELLS;

/**
 * The logic item's program, in WebAssembly text (Logic `logic@1`: Exports; Logic: occurrences). Its one kind `drip`
 * declares `{point: vec3}` and the default 16 rows a step, so the emit region at 8192 is a u32 count, then rows of
 * {a: u32, b: u32, point: 3 × f64}: the count at 8192, row 0 at 8196, its point at 8204. On each step that `touches`
 * it writes one row: a the cell, b 0, point the cell's centre on the water at rest (y = 0). It keeps no state: the row
 * is a function of k alone.
 */
export const drips = (): Program => assemble('drips', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global (export "emits_at") i32 (i32.const 8192))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64) (local $m i64) (local $slot i64)
    (i32.store (i32.const 8192) (i32.const 0))
    (local.set $m (i64.rem_u (local.get $k) (i64.const ${PERIOD})))
    (if (i64.eqz (i64.and (local.get $m) (i64.const 1)))
      (then
        (local.set $slot (i64.rem_u
          (i64.add (i64.mul (i64.div_u (local.get $k) (i64.const ${PERIOD})) (i64.const 8)) (i64.shr_u (local.get $m) (i64.const 1)))
          (i64.const ${CELLS})))
        (i32.store (i32.const 8196) (i32.wrap_i64 (local.get $slot)))
        (i32.store (i32.const 8200) (i32.const 0))
        (f64.store (i32.const 8204) (f64.mul (f64.const ${CELL})
          (f64.sub (f64.convert_i64_u (i64.rem_u (local.get $slot) (i64.const ${SIDE}))) (f64.const ${(SIDE - 1) / 2}))))
        (f64.store (i32.const 8212) (f64.const 0))
        (f64.store (i32.const 8220) (f64.mul (f64.const ${CELL})
          (f64.sub (f64.convert_i64_u (i64.div_u (local.get $slot) (i64.const ${SIDE}))) (f64.const ${(SIDE - 1) / 2}))))
        (i32.store (i32.const 8192) (i32.const 1))))))`);

// ---------------------------------------------------------------------------------------------------
// The camera: 30° above the horizon on the pond's +Z side, looking at its centre, fov 40° across the width, at the
// distance where the pond's four corners enclose half the frame's area.

const ELEVATION = Math.PI / 6;
const camAt = (distance: number): Cam =>
  ({ position: [0, distance * Math.sin(ELEVATION), distance * Math.cos(ELEVATION)], target: [0, 0, 0], fov: 40, size: SIZE });
/** The area in px² the pond's corners enclose in the frame (the shoelace formula). */
function pondArea(cam: Cam): number {
  const h = POND / 2;
  const c = ([[-h, -h], [h, -h], [h, h], [-h, h]] as const).map(([x, z]) => project(cam, [x, 0, z]));
  return Math.abs(c.reduce((sum, [x, y], i) => { const [nx, ny] = c[(i + 1) % 4]!; return sum + x * ny - nx * y; }, 0)) / 2;
}
/** Found by bisection: the area falls as the camera backs away. About 23.15 m, the eye 11.57 m up. */
export const CAM: Cam = (() => {
  let near = 5; let far = 200;
  for (let i = 0; i < 80; i++) { const mid = (near + far) / 2; if (pondArea(camAt(mid)) > (SIZE[0] * SIZE[1]) / 2) near = mid; else far = mid; }
  return camAt(near);
})();

/**
 * The document: the pond's plate of 256 × 256 cells with a water material, every field its default (a light breeze's
 * waves and the ripples), over a dark bed 1 m down that also fills the frame around it, under a day sky and a sun;
 * and the logic item. With `rings` the water reads the item's list; without, the material has no `rings` at all, as
 * the merge base's water has none, and the item's list is read by nothing.
 */
export function pond(program: Program, rings: boolean): JsonObject {
  return sceneDoc(`pond-${rings ? 'rings' : 'bare'}`, SIZE, {
    cam: camItem(CAM), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'pond-water': material({ water: rings ? { rings: { on: { list: 'drips.occurrences', kinds: ['drip'] } } } : {} }),
    silt: material({ base_color: [0.16, 0.13, 0.09, 1], roughness: 0.9 }),
    bed: box([80, 1, 80], [0, -1.5, -10], 'silt'),
    pond: plate([POND, POND], [256, 256], [0, 0, 0], 'pond-water'),
    drips: logicItem(program, { drip: { fields: { point: 'vec3' } } }),
  });
}
