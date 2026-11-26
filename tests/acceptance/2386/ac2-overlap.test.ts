// AC2 #2386.4227a011: On that grid, two opaque tiles of different colors at (1, 0) and (0, 0), written in that order:
// the pixel at (10, −20), which both quads cover, reads the tile of (1, 0), whose cell center is lower on screen. A
// planted set that draws in written order reads the tile of (0, 0) there and fails, naming the pixel
//
// The fixture (fixtures.ts `wallSet`): criterion 1's set, grid isometric with cell [64, 32], atlas cell [64, 64],
// `draw: [64, 64]`, `anchor: [0.5, 0.75]`, with two rows written (1, 0) in red, then (0, 0) in blue, each an opaque
// solid cell. The set sits at `at.pos` (32, 48) on a 96 × 80 u page, so the pixel at (10, −20) of the set's own u is
// device pixel (42, 28). Through `deep-canvas-render raster` at zoom 1 (Vello CPU, every platform), as #1653's suite
// reads its pixel at (10, 2). The planted program is the base's own, `raster`'s `planted: "tiles_in_row_order"` (#1653).
// README: The surface under test; Planted programs.
import { describe, expect, it } from 'vitest';
import { BLUE, RED, WALL_ANCHOR, WALL_DRAW, WALL_GRID, WALL_TILE, figure, holds, isoCentre, quadAt, wallAtlas, wallSet } from './fixtures.ts';
import { AC, TIMEOUT, failsNaming, none, putAssets, px, rasterLine, rasterLines, rgbOff, useBin, useTemp, type Image, type Pt } from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-canvas-render');
const temp = useTemp();
const POS: Pt = [32, 48];
const PAGE: Pt = [96, 80];
/** The issue's pixel, in the set's own u, and where the page puts it. */
const PIXEL: Pt = [10, -20];
const DEVICE: Pt = [POS[0] + PIXEL[0], POS[1] + PIXEL[1]];

/** The two tiles drawn at zoom 1: (1, 0) written first, in red, then (0, 0), in blue. */
function drawn(planted?: string): Image {
  const store = temp();
  const [asset] = putAssets(store, [wallAtlas()]);
  const doc = figure('overlap', PAGE, [wallSet(asset!, [{ cx: 1, cy: 0, tile: WALL_TILE.red }, { cx: 0, cy: 0, tile: WALL_TILE.blue }], POS)]);
  const line = rasterLine(temp(), doc, 0, { store, view: { zoom: 1 }, ...(planted ? { planted } : {}) });
  return rasterLines(bin(), [line], `the two tiles${planted ? ` with ${planted}` : ''}`)[0]!.image;
}
/** The criterion's check: the pixel at (10, −20), if it doesn't read the tile of (1, 0). */
function pixelProblems(im: Image): string[] {
  const p = px(im, DEVICE[0], DEVICE[1]);
  return rgbOff(im, DEVICE[0], DEVICE[1], RED) <= 1 && p[3] >= 254 ? [] : [`pixel (${PIXEL[0]}, ${PIXEL[1]}) reads [${p.join(', ')}], not the tile of (1, 0) [${RED.join(', ')}, 255]`];
}

describe(`${ID} tall tiles stack by their cells' centers`, () => {
  it(`${ID} with opaque tiles at (1, 0) and (0, 0) written in that order, the pixel at (10, −20), which both quads cover, reads the tile of (1, 0)`, () => {
    // The criterion's geometry: both drawn quads hold the pixel's centre, and (1, 0)'s cell center is lower on screen.
    const centre: Pt = [PIXEL[0] + 0.5, PIXEL[1] + 0.5];
    for (const [cx, cy] of [[1, 0], [0, 0]] as Pt[]) {
      expect(holds(quadAt(isoCentre(WALL_GRID, cx, cy), WALL_DRAW, WALL_ANCHOR), centre), `the fixture: the quad of (${cx}, ${cy}) covers the pixel at (10, −20)`).toBe(true);
    }
    expect(isoCentre(WALL_GRID, 1, 0)[1], 'the fixture: the center of (1, 0) is lower on screen than that of (0, 0)').toBeGreaterThan(isoCentre(WALL_GRID, 0, 0)[1]);
    none(pixelProblems(drawn()), 'the tile whose cell center is lower on screen shows at (10, −20)');
  }, TIMEOUT);

  it(`${ID} planted tiles_in_row_order draws in written order, reads the tile of (0, 0) at (10, −20) and fails, naming the pixel`, () => {
    const im = drawn('tiles_in_row_order');
    expect(rgbOff(im, DEVICE[0], DEVICE[1], BLUE), `the planted set draws (0, 0) last, so (10, −20) reads its tile [${BLUE.join(', ')}]; it reads [${px(im, DEVICE[0], DEVICE[1]).join(', ')}]`).toBeLessThanOrEqual(1);
    failsNaming(pixelProblems(im), [/pixel \(10, -20\)/], 'the two tiles drawn in written order');
  }, TIMEOUT);
});
