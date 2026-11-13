// #2014.13d18756: "On a plate cell with corner heights 0, 0, 0 and 1 m, the drawn surface at the cell's centre, a
// physics ray's hit there, a pick's ground point and an item resting on it with rest_on agree within 1e-6 m; a planted
// builder that splits the cell along its other diagonal draws the centre 0.5 m off the physics surface and fails,
// naming the cell"
//
// Fixture (helpers.ts, `cellDoc`), shown by the working agent through deep_show: `ground`, a terrain plate
// `plate@1 {terrain: {height, size: [2, 2], spacing: 1, tile: 2, lod_levels: 1}}` whose field raises only the sample at
// (1, −1) to 1 m, so cell [1, 0] (x 0 to 1, z −1 to 0) has corner heights 0, 0, 0 and 1 m and the other three cells are
// flat at 0; and `stone`, a ball of radius 0.1 m written 1.5 m over that cell's centre (0.5, −0.5), with the constraint
// `rest: {owner: stone, kind: rest_on, on: ground}` and every default.
//
// asserts, from one process (deep_show, geometry, terrain_rays, deep_query):
//   - the drawn mesh (the geometry row's positions and indices) holds the field's nine samples: the fixture is the cell
//     the criterion describes;
//   - at the centre of every cell, the drawn triangles' height there, and where the ray straight down through it meets
//     the drawn triangles, the plate's physics height-field shape and a pick on the plate (terrain_rays' `drawn`,
//     `physics` and `pick`), all lie on that ray within 1e-6 m of each other;
//   - the stone rests on the drawn surface: moved along (0, −1, 0) alone, its ball neither apart from the drawn
//     triangles nor passing into them by more than 1e-6 m;
//   - planted `terrain_splits_other_diagonal`: the same readings fail at one cell only, cell [1, 0], whose drawn centre
//     (by the triangles and by the ray) is 0.5 m off the physics surface, while the pick stays on the physics surface.
//
// Wrong programs this fails on (the first planted, the rest not):
//   - a builder that splits the cell along the other diagonal from the physics height field's: the drawn centre is
//     0.5 m off (0 against 0.5);
//   - a physics shape or a pick that reads the samples as a smooth or bilinear surface: the centre is at 0.25 m;
//   - a pick or a drawn reading that comes from another surface than the one it names: the planted run tells them apart;
//   - rest_on onto the plate's bounds, onto the ground plane, onto the other diagonal's surface, or by the ball's lowest
//     point onto the surface under its centre: a gap past 1e-6 m, a centre under the drawn surface, or a ball passing
//     into the cell's slope (0.042 m split one way, 0.018 m the other);
//   - a plate placed off its centre or with x and z swapped: a sample of the drawn mesh is off the field's.
import { describe, expect, it } from 'vitest';
import {
  AC, CELLS, CELL_PLATE, CELL_STONE, CELL_TOP, PLATE, SPLITS_OTHER_DIAGONAL, STONE_POS, TARGET, TIMEOUT, TOL, cellDoc, cellHeight,
  cellJudgesFailTheirPlants, cellName, cellOf, docId, down, drawnOf, geometry, none, positionAt, presented, query, raysOf,
  restFailures, run, sampleFailures, scenarioOf, show, spreadFailures, terrainRays, topAt, useFolders, useShow,
  type CellReading, type Tri, type V3,
} from './helpers.ts';

const ID = AC[1];
const bin = useShow();
const folder = useFolders();
const DOC = docId(1);

/** One process, under a planted program or none: the plate shown, its drawn mesh, the rays down through each cell's centre, and the stone's place. */
function read(planted?: string): { positions: V3[]; tris: Tri[]; cells: CellReading[]; stone: V3 } {
  const rays = CELLS.map((cell) => { const [x, z] = cellOf(CELL_PLATE, cell).centre; return down(x, z, CELL_TOP); });
  const calls = [show(DOC, cellDoc()), geometry(DOC, [PLATE]), terrainRays(DOC, PLATE, rays), query(DOC, [STONE_POS])];
  const [shown, built, met, placed] = run(bin(), scenarioOf(folder(), [DOC], calls, planted));
  presented(shown!, 'the plate cell with one raised corner and the stone over it');
  const { positions, tris } = drawnOf(built!, PLATE, 'the plate');
  const { rays: hits } = raysOf(met!, rays.length, 'the rays down through the cells\' centres');
  const cells = CELLS.map((cell, k): CellReading => { const [x, z] = cellOf(CELL_PLATE, cell).centre; return { cell, triangles: topAt(tris, x, z), hits: hits[k]! }; });
  return { positions, tris, cells, stone: positionAt(placed!, STONE_POS) };
}

describe(`${ID} one surface for drawing, physics, picks and rest_on on a plate cell`, () => {
  it(`${ID} at the cell's centre the drawn surface, a physics ray's hit, a pick's ground point and an item resting with rest_on agree within 1e-6 m`, () => {
    cellJudgesFailTheirPlants();
    const { positions, tris, cells, stone } = read();
    none(sampleFailures(CELL_PLATE, cellHeight, positions), 'the drawn mesh holds the field\'s samples: one cell with corner heights 0, 0, 0 and 1 m');
    none(spreadFailures(CELL_PLATE, cells), 'at each cell\'s centre the drawn surface, the physics ray\'s hit and the pick\'s ground point agree within 1e-6 m');
    none(restFailures(stone, CELL_STONE.at, CELL_STONE.r, tris, 'the stone'), `the stone rests on the drawn surface of ${cellName(CELL_PLATE, TARGET)}, within 1e-6 m`);
  }, TIMEOUT);

  it(`${ID} the planted builder that splits the cell along its other diagonal draws the centre 0.5 m off the physics surface and fails, naming the cell`, () => {
    cellJudgesFailTheirPlants();
    const { positions, cells } = read(SPLITS_OTHER_DIAGONAL);
    none(sampleFailures(CELL_PLATE, cellHeight, positions), 'the planted builder moves no sample');
    const failures = spreadFailures(CELL_PLATE, cells);
    expect(failures.length, `under ${SPLITS_OTHER_DIAGONAL} the readings disagree at one cell alone: ${failures.join(' | ')}`).toBe(1);
    expect(failures[0], 'the failure names the cell').toContain(cellName(CELL_PLATE, TARGET));
    const at = cells.find((c) => c.cell[0] === TARGET[0] && c.cell[1] === TARGET[1])!;
    const [drawnRay, physics, pick] = [at.hits.drawn, at.hits.physics, at.hits.pick];
    expect(drawnRay !== null && physics !== null && pick !== null && at.triangles !== null, 'every reading meets the target cell').toBe(true);
    expect(Math.abs(Math.abs(at.triangles! - physics![1]) - 0.5), `the drawn centre (y ${at.triangles}) is 0.5 m off the physics surface (y ${physics![1]})`).toBeLessThanOrEqual(TOL);
    expect(Math.abs(drawnRay![1] - at.triangles!), 'the ray meets the drawn triangles where they are').toBeLessThanOrEqual(TOL);
    expect(Math.abs(pick![1] - physics![1]), 'the pick stays on the surface the height-field collision uses').toBeLessThanOrEqual(TOL);
  }, TIMEOUT);
});
