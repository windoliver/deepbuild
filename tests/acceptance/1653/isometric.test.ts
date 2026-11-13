// AC4 #1653.00cbd0dd: On a new isometric atlas fixture with cell [32, 16], the centres of cells (1, 0), (0, 1) and
// (2, 1) are (16, 8), (−16, 8) and (16, 24), each within 1e-9 u. A planted layout that places the cells as a square grid
// puts (1, 0) at (32, 0) and fails, naming the first cell whose centre differs. With two opaque tiles of different colors
// at (1, 0) and (0, 0), written in that order, the pixel at (10, 2) reads the tile of (1, 0), which draws later by
// centre y. A planted set that draws in row order reads the tile of (0, 0) there and fails, naming the pixel
//
// The fixture (helpers.ts `isoDoc`): one `marks@1` image set `iso` at the document's origin on an isometric grid with
// cell [32, 16], rows written (1, 0) tile 0, (0, 0) tile 1, (0, 1) tile 1, (2, 1) tile 0, over an atlas of two opaque
// 32 × 16 cells. A cell's centre is `deep-canvas-render geometry {doc, item: "iso"}`'s `rows.<key>.place.{x, y}`, the
// row matched by its `columns.cx` and `columns.cy`; the pixel is `raster`'s at zoom 1 (Vello CPU, every platform). The
// planted programs are `geometry`'s `planted: "isometric_as_square_grid"` and `raster`'s `planted: "tiles_in_row_order"`.
// README: The surface under test; Planted programs.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, TILE_A, TILE_B, centresOf, failsNaming, geometryOf, isoAtlas, isoCentre, isoDoc, none, px, putAssets,
  rasterLine, rasterLines, rgbOff, shown, useBin, useDir, type Image,
} from './helpers.ts';

const ID = AC[4];
const bin = useBin('deep-canvas-render');
const dir = useDir();

/** The issue's numbers, written out. */
const EXPECTED: [[number, number], [number, number]][] = [[[1, 0], [16, 8]], [[0, 1], [-16, 8]], [[2, 1], [16, 24]]];
const PIXEL: [number, number] = [10, 2];

/** Each cell, in the issue's order, whose centre isn't the issue's within 1e-9 u. */
function layoutProblems(centres: Map<string, [number, number]>): string[] {
  return EXPECTED.flatMap(([[cx, cy], [ex, ey]]) => {
    const got = centres.get(`${cx},${cy}`);
    if (!got) return [`cell (${cx}, ${cy}): no row of the set answers it`];
    return Math.abs(got[0] - ex) <= 1e-9 && Math.abs(got[1] - ey) <= 1e-9 ? [] : [`cell (${cx}, ${cy}): centre (${got[0]}, ${got[1]}), the isometric layout's (${ex}, ${ey})`];
  });
}
/** The pixel at (10, 2), if it doesn't read the tile of (1, 0). */
function pixelProblems(im: Image): string[] {
  const [x, y] = PIXEL;
  return rgbOff(im, x, y, TILE_A) <= 1 && px(im, x, y)[3] >= 254 ? [] : [`pixel (${x}, ${y}) reads [${px(im, x, y).join(', ')}], not the tile of (1, 0) [${TILE_A.join(', ')}, 255]`];
}
function geometry(store: string, asset: string, planted?: string): Map<string, [number, number]> {
  const answer = geometryOf(bin(), { doc: isoDoc(asset), item: 'iso', t: 0, look: LOOK, store, ...(planted ? { planted } : {}) });
  return centresOf(answer, planted ? `with ${planted}` : 'of the isometric set');
}

describe(`${ID} the isometric grid's layout and order`, () => {
  it(`${ID} the centres of cells (1, 0), (0, 1) and (2, 1) are (16, 8), (−16, 8) and (16, 24) within 1e-9 u`, () => {
    for (const [[cx, cy], want] of EXPECTED) expect(isoCentre(cx, cy), `the issue's formula gives its own numbers for (${cx}, ${cy})`).toEqual(want);
    const store = dir();
    const [asset] = putAssets(store, [isoAtlas()]);
    none(layoutProblems(geometry(store, asset!)), 'each cell sits at its isometric centre');
  });

  it(`${ID} a planted layout that places the cells as a square grid puts (1, 0) at (32, 0) and fails, naming the first cell whose centre differs`, () => {
    const store = dir();
    const [asset] = putAssets(store, [isoAtlas()]);
    const centres = geometry(store, asset!, 'isometric_as_square_grid');
    expect(centres.get('1,0'), `the planted square layout puts (1, 0) at (32, 0): ${shown([...centres])}`).toEqual([32, 0]);
    const problems = layoutProblems(centres);
    failsNaming(problems, 'cell (1, 0)', 'the square layout');
    expect(problems[0], 'the first failure names the first cell whose centre differs').toContain('cell (1, 0)');
  });

  it(`${ID} with tiles at (1, 0) and (0, 0) written in that order, the pixel at (10, 2) reads the tile of (1, 0)`, () => {
    const store = dir();
    const [asset] = putAssets(store, [isoAtlas()]);
    const [drawn] = rasterLines(bin(), [rasterLine(dir(), isoDoc(asset!), 0, { store })], 'the isometric set');
    none(pixelProblems(drawn!.image), 'the tile drawn later by centre y shows at (10, 2)');
  });

  it(`${ID} a planted set that draws in row order reads the tile of (0, 0) at (10, 2) and fails, naming the pixel`, () => {
    const store = dir();
    const [asset] = putAssets(store, [isoAtlas()]);
    const [drawn] = rasterLines(bin(), [rasterLine(dir(), isoDoc(asset!), 0, { store, planted: 'tiles_in_row_order' })], 'the isometric set in row order');
    expect(rgbOff(drawn!.image, PIXEL[0], PIXEL[1], TILE_B), `the planted set draws (0, 0) last, so (10, 2) reads its tile [${TILE_B.join(', ')}]`).toBeLessThanOrEqual(1);
    failsNaming(pixelProblems(drawn!.image), 'pixel (10, 2)', 'the set drawn in row order');
  });
});
