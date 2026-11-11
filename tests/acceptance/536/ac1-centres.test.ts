// AC1 #536.a6553751: On a 6 × 6 atlas hex fixture with cell [32, 28], the centres are, for pointy odd, (48, 21) for
// cell (1, 1) and (64, 42) for (2, 2); for pointy even, (32, 21) and (80, 42); and for flat odd, (24, 42) and (48, 56);
// each within 1e-9 u; and a planted layout that shifts the other parity of rows fails, naming the first cell whose
// centre differs
//
// The fixture (helpers.ts `board`): one `marks@1` image set `board` at the document's origin, an atlas tile set on
// `grid: {shape: hex, cell: [32, 28], hex: {orient, offset}}` with 36 rows, (cx, cy) for cx and cy from 0 to 5, over a
// one-cell solid atlas. A cell's centre is `deep-canvas-render geometry {doc, item: "board"}`'s `rows.<key>.place.{x, y}`,
// the row matched by its own `columns.cx` and `columns.cy`, as #1653's suite reads its isometric centres. The planted
// layout is `geometry`'s `planted: "hex_shifts_other_parity"`, run on the pointy odd fixture, where it shifts the even
// rows instead of the odd ones. README: The surface under test; Planted programs.
import { describe, expect, it } from 'vitest';
import {
  AC, CELL, GRID, LAYOUTS, LOOK, POINTY_ODD, TIMEOUT, atlasSet, centresOf, doc, failsNaming, geometryOf, hexCentre, none,
  putAssets, shown, solidAtlas, useDir, useRender, type Hex, type JsonObject,
} from './helpers.ts';

const ID = AC[1];
const bin = useRender();
const dir = useDir();

/** The 6 × 6 atlas hex fixture with `hex`'s orient and offset, every row showing tile 0. */
const board = (asset: string, hex: Hex): JsonObject =>
  doc(`board-${hex.orient}-${hex.offset}`, [240, 200], [atlasSet('board', 'a1', asset, [16, 16], { shape: 'hex', cell: CELL, hex: { ...hex } }, GRID.map(([cx, cy]) => ({ cx, cy, tile: 0 })))]);

function centres(hex: Hex, planted?: string): Map<string, [number, number]> {
  const store = dir();
  const [asset] = putAssets(store, [solidAtlas([16, 16], [[200, 120, 40]])]);
  const answer = geometryOf(bin(), { doc: board(asset!, hex), item: 'board', t: 0, look: LOOK, store, ...(planted ? { planted } : {}) });
  return centresOf(answer, `of the ${hex.orient} ${hex.offset} fixture${planted ? ` with ${planted}` : ''}`);
}
/** Each of the criterion's cells, in its order, whose centre isn't the criterion's within 1e-9 u on each axis. */
function layoutProblems(got: Map<string, [number, number]>, layout: (typeof LAYOUTS)[number]): string[] {
  return layout.centres.flatMap(([[cx, cy], [ex, ey]]) => {
    const c = got.get(`${cx},${cy}`);
    if (!c) return [`${layout.name}: cell (${cx}, ${cy}): no row of the set answers it`];
    return Math.abs(c[0] - ex) <= 1e-9 && Math.abs(c[1] - ey) <= 1e-9 ? [] : [`${layout.name}: cell (${cx}, ${cy}): centre (${c[0]}, ${c[1]}), the criterion's (${ex}, ${ey})`];
  });
}

describe(`${ID} hex centres`, () => {
  it(`${ID} on the 6 × 6 atlas hex fixture with cell [32, 28], (1, 1) and (2, 2) sit at the criterion's centres for pointy odd, pointy even and flat odd, each within 1e-9 u`, () => {
    for (const layout of LAYOUTS) for (const [[cx, cy], want] of layout.centres) {
      expect(hexCentre(layout.hex, cx, cy), `the design's layout gives the criterion's own numbers for ${layout.name} (${cx}, ${cy})`).toEqual(want);
    }
    none(LAYOUTS.flatMap((layout) => {
      const got = centres(layout.hex);
      expect(got.size, `geometry answers each of the 36 cells of the ${layout.name} fixture: ${shown([...got.keys()])}`).toBe(36);
      return layoutProblems(got, layout);
    }), 'each cell sits at its hex centre');
  }, TIMEOUT);

  it(`${ID} a planted layout that shifts the other parity of rows puts (1, 1) at (32, 21) and fails, naming the first cell whose centre differs`, () => {
    const got = centres(POINTY_ODD, 'hex_shifts_other_parity');
    expect(got.get('1,1'), `the planted layout shifts the even rows of the pointy odd grid, so (1, 1) is unshifted at (32, 21): ${shown([...got])}`).toEqual([32, 21]);
    const problems = layoutProblems(got, LAYOUTS[0]!);
    failsNaming(problems, 'cell (1, 1)', 'the layout that shifts the other parity of rows');
    expect(problems[0], 'the first failure names the first cell whose centre differs').toContain('cell (1, 1)');
  }, TIMEOUT);
});
