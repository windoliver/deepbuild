// The three wrong programs the criteria name (README: Planted programs), each written whole as test code: a set built
// from what the merge base already draws (a plain free row of the same atlas, #535 and #2386), which the shipped
// binary checks and draws as it draws any plain set. None is a `planted` value, a build feature or a file laid over
// the program, so each stands at the merge base and beside any implementation, and nothing in a shipped binary knows
// them. Each test hands the planted set's picture, or its check's answer, to the judge the shipped program's own row
// passes (judges.ts), and that judge must fail it, naming what its criterion names. No test runner is imported here.

import { SIDE, boxOf, parts, quads, type Item, type Part, type Row } from './fixtures.ts';

/**
 * `whole_cell_scaled_to_box` (criterion 1): the row drawn as one quad of the frame's whole cell, scaled to the box the
 * row fills, w × h centred at (x, y). It is how an atlas row draws without `slice`: the same set with `atlas.draw` the
 * box and no `slice`, `w` and `h`. The 24 px cell is stretched over the box, so each corner's 8 × 8 texels are smeared
 * over more pixels than 8 × 8.
 */
export const wholeCellScaledToBox = (asset: string, row: Row, id: string): Item => quads({ id, asset, at: [[row.x, row.y]], draw: [row.w, row.h] });

/**
 * A frame's nine parts laid by hand in the box a row fills, each part at its own size, 8 × 8 u, never scaled: a corner
 * in each corner of the box, and from each corner's inner side one 8 u tile after another along the edge and through
 * the centre, as many as start before the far corner's side. Rows draw in order of centre y, then centre x, so the far
 * corner and the far edge draw last on their line and cover whatever a tile holds past the run's end: the last tile is
 * cut there. In a box narrower than two corners no tile starts, and the right corner draws over the left one.
 */
export function handLaid(row: Row): Part[] {
  const [x0, y0, w, h] = boxOf(row);
  const along = (from: number, length: number): { at: number; k: 0 | 1 | 2 }[] => {
    const out: { at: number; k: 0 | 1 | 2 }[] = [{ at: from + SIDE / 2, k: 0 }];
    for (let n = 0; n * SIDE < length - 2 * SIDE; n++) out.push({ at: from + SIDE + n * SIDE + SIDE / 2, k: 1 });
    out.push({ at: from + length - SIDE / 2, k: 2 });
    return out;
  };
  const out: Part[] = [];
  for (const y of along(y0, h)) for (const x of along(x0, w)) out.push({ x: x.at, y: y.at, i: x.k, j: y.k });
  return out;
}

/**
 * `tile_fit_cuts_last_tile` (criterion 2): the row drawn as `tile_fit` must not draw it: every tile at the strip's own
 * size, 8 u, and the last one cut at the run's end, as `fill: tile` cuts it. Across the 174 u between the corners of a
 * row 190 u wide that is 21 whole tiles and the first 6 u of a 22nd.
 */
export const tileFitCutsLastTile = (asset: string, row: Row, id: string): Item => parts({ id, asset, parts: handLaid(row) });

/**
 * `check_takes_narrow_row` (criterion 3): a check with no smallest size, which takes the row 12 u wide. What it takes
 * is drawn: both corners at their own size, 8 u each, in a box 12 u wide, so they overlap by 4 u. Laid by hand the
 * frame has no `slice` for the shipped check to refuse, so that check takes it, and the shipped renderer draws it.
 */
export const checkTakesNarrowRow = (asset: string, row: Row, id: string): Item => parts({ id, asset, parts: handLaid(row) });
