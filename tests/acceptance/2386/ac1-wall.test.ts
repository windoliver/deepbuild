// AC1 #2386.2ebddc6b: On an isometric grid with cell [64, 32], a set with `atlas.cell: [64, 64]`, `draw: [64, 64]` and
// `anchor: [0.5, 0.75]` gives the row at cell (0, 0) the box [−32, −48, 64, 64], and in a snapshot at zoom 1 and scale
// factor 1 the box's 64 × 64 pixels equal the atlas cell's texels exactly. A planted draw that fills the grid's cell
// gives [−32, −16, 64, 32] and fails, naming the row and both boxes
//
// The fixture (fixtures.ts `wallSet`): the set `wall` with one row, on cell (0, 0), showing the wall atlas's code cell,
// whose every texel differs from its neighbours. The set sits at `at.pos` (64, 64) on a 128 × 96 u page, so the page
// holds the quad; the criterion's boxes and pixels are in the set's own u, and each is read at the criterion's numbers
// plus (64, 64). Through `deep-show run`: `deep_show` with pixels (its snapshot at the document's size, its `visible`
// table) and `spatial` (the set's bounds; the index, probed on each side of the box). The planted program is the
// scenario's `planted: "draw_fills_grid_cell"`. README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import { WALL_ANCHOR, WALL_DRAW, WALL_GRID, WALL_TILE, codeTexel, film, isoCentre, quadAt, wallAtlas, wallSet } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, boundsOf, boxProblems, boxText, failsNaming, moved, none, once, pngOf, presented, putEvidence, px, runShow, sameBox, scenario,
  showCall, shownSnapshot, sideProbes, spatialCall, useBin, useTemp, type Box, type Image, type JsonObject, type Planted, type Pt,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-show');
const temp = useTemp();
const D = DOC(1);
const POS: Pt = [64, 64];
const PAGE: Pt = [128, 96];
const ROW = 'wall#0';
/** The issue's boxes, written out. */
const WANT: Box = [-32, -48, 64, 64];
const CELL_FILLED: Box = [-32, -16, 64, 32];

interface Run { shown: JsonObject; spatial: JsonObject; snapshot: Image }
function wallRun(planted?: Planted): Run {
  const ev = temp();
  const atlas = putEvidence(ev, wallAtlas());
  const doc = film('wall', PAGE, [wallSet(atlas, [{ cx: 0, cy: 0, tile: WALL_TILE.code }], POS)], { wall_atlas: atlas });
  const calls = [showCall(D, doc, true), spatialCall(D, sideProbes(moved(WANT, POS)))];
  const [shown, spatial] = runShow(bin(), scenario(ev, [{ doc: D, rect: [0, 0, 800, 600] }], calls, planted ? { planted } : {}), 'AC1 the wall') as [JsonObject, JsonObject];
  presented(shown, 'the wall');
  return { shown, spatial, snapshot: pngOf(ev, shownSnapshot(shown, 'the wall'), 'the wall\'s snapshot') };
}
/** The criterion's check of the row's box: each failure names the row and both boxes. */
const problems = (run: Run): string[] => boxProblems(ROW, `row ${ROW} at cell (0, 0)`, run.shown, run.spatial, 0, WANT, POS);

const honest = once(() => wallRun());

describe(`${ID} a tile taller than its isometric cell draws at its own size from its anchor`, () => {
  it(`${ID} with atlas.cell [64, 64], draw [64, 64] and anchor [0.5, 0.75] on a grid of cell [64, 32], the row at cell (0, 0) has the box [−32, −48, 64, 64]: the set's bounds, the row's box in the spatial index and the set's row in deep_show's table`, () => {
    expect(quadAt(isoCentre(WALL_GRID, 0, 0), WALL_DRAW, WALL_ANCHOR), 'the issue\'s rule gives its own box: the drawn quad placed so its anchor is on the cell\'s center').toEqual(WANT);
    none(problems(honest()), 'the box of the row at cell (0, 0)');
  }, TIMEOUT);

  it(`${ID} in a snapshot at zoom 1 and scale factor 1 the box's 64 × 64 pixels equal the atlas cell's texels exactly`, () => {
    const im = honest().snapshot;
    expect([im.width, im.height], 'the snapshot is the 128 × 96 u page at zoom 1 and scale factor 1').toEqual(PAGE);
    const off: string[] = [];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const got = px(im, POS[0] + WANT[0] + x, POS[1] + WANT[1] + y);
      const want = [...codeTexel([64, 64], x, y), 255];
      if (got.some((v, i) => v !== want[i])) off.push(`pixel (${WANT[0] + x}, ${WANT[1] + y}) reads [${got.join(', ')}]; texel (${x}, ${y}) of the atlas cell is [${want.join(', ')}]`);
    }
    expect(off.slice(0, 12), `each of the box's 4,096 pixels equals the texel it shows (${off.length} don't)`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted draw_fills_grid_cell gives the row the box [−32, −16, 64, 32] and fails, naming the row and both boxes`, () => {
    const twin = wallRun('draw_fills_grid_cell');
    const box = moved(boundsOf(twin.spatial, 'wall', 'the wall under draw_fills_grid_cell'), [-POS[0], -POS[1]]);
    expect(sameBox(box, CELL_FILLED), `the planted draw fills the grid's cell, centered on the cell's center: ${boxText(CELL_FILLED)}; it gives ${boxText(box)}`).toBe(true);
    failsNaming(problems(twin), [/wall#0/, /\[-32, -16, 64, 32\]/, /\[-32, -48, 64, 64\]/], 'the row\'s box under draw_fills_grid_cell');
  }, TIMEOUT);
});
