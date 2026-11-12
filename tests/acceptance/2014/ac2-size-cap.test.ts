// #2014.be2d6fcd: "A 24 × 24 km plate at 30 m spacing (801 × 801 samples) builds as one plate with its physics
// height-field shape, and an item resting on it with rest_on stands within 1e-6 m of the drawn surface at a sampled
// cell; a plate whose size ÷ spacing is 4,097 on a side is refused at check, naming size and spacing; a planted cap
// read in metres refuses the 24 km plate and fails, naming it"
//
// Fixtures (helpers.ts), shown by the working agent through deep_show:
//   - `landDoc`: `ground`, `plate@1 {terrain: {height, size: [24000, 24000], spacing: 30, tile: 2400, lod_levels: 1}}`,
//     its field terraces 2,048 m wide (10 m a step along x, 5 m along z, from −90 m to 75 m), and `stone`, a ball of
//     radius 0.5 m written 5 m over the centre of the sampled cell [650, 250] (x 7,500 to 7,530 m, z −4,500 to −4,470 m),
//     which with its eight neighbours lies flat on the terrace at 15 m; `rest: {owner: stone, kind: rest_on, on: ground}`
//     with every default.
//   - `plateDoc(OVER)`: the same plate 4,097 × 30 = 122,910 m a side.
//
// asserts:
//   - the 24 km plate is presented with no error; its physics shape is one height field of 801 × 801 samples
//     (terrain_rays' `shape`); the ray down through the sampled cell's centre meets the drawn surface at 15 m there and
//     the physics shape within 1e-3 m of it; and the stone, moved along (0, −1, 0) alone, stands with its lowest point
//     within 1e-6 m of that drawn surface;
//   - the 4,097 plate is refused at check: an out_of_range error naming `ground` at items/ground/params/terrain, whose
//     actual holds the size [122910, 122910] and the spacing 30 as written;
//   - planted `terrain_cap_in_metres`: the 24 km plate isn't presented, and the refusal names it, its size and spacing.
//
// Wrong programs this fails on (the last planted, the rest not):
//   - a cap past which a 24 km plate is refused, or must be a chunk tree, or draws with no collision: not presented, or
//     shape null;
//   - a physics shape made coarser, or in tiles of shapes: samples other than 801 × 801;
//   - the 4,097-sample limit read as size ÷ spacing ≤ 4,097, one spacing too many: the 4,097 plate is presented;
//   - a refusal that doesn't name size and spacing, or a refusal for another reason (as the base's unknown_field);
//   - rest_on that leaves the stone where it was, rests it on the ground plane or on the plate's bounds: 4.5 m, 15 m or
//     60 m off the drawn surface;
//   - a cap read in metres (planted): the 24 km plate is refused.
import { describe, expect, it } from 'vitest';
import {
  AC, CAP_IN_METRES, LAND, LAND_SAMPLES, LAND_TOP, OVER, PLATE, SAMPLED, STONE_POS, TIMEOUT, capFailures, cellOf, docId, down,
  landDoc, landJudgesFailTheirPlants, none, plateDoc, positionAt, presented, presentedFailures, query, raysOf, run,
  sampledFailures, scenarioOf, shapeFailures, show, standFailures, terrainRays, useFolders, useShow,
} from './helpers.ts';

const ID = AC[2];
const bin = useShow();
const folder = useFolders();
const DOC = docId(2);
const OVER_DOC = docId(3);

describe(`${ID} the plate's size cap counts samples`, () => {
  it(`${ID} a 24 × 24 km plate at 30 m builds as one plate with its 801 × 801 physics height field, and an item resting on it with rest_on stands within 1e-6 m of the drawn surface at a sampled cell`, () => {
    landJudgesFailTheirPlants();
    const [x, z] = cellOf(LAND, SAMPLED).centre;
    const calls = [show(DOC, landDoc()), terrainRays(DOC, PLATE, [down(x, z, LAND_TOP)]), query(DOC, [STONE_POS])];
    const [shown, met, placed] = run(bin(), scenarioOf(folder(), [DOC], calls));
    presented(shown!, 'the 24 × 24 km plate at 30 m spacing');
    const rays = raysOf(met!, 1, 'the ray down through the sampled cell\'s centre');
    none(shapeFailures(rays, LAND_SAMPLES), `the plate builds as one plate with its physics height-field shape of ${LAND_SAMPLES} × ${LAND_SAMPLES} samples`);
    const hits = rays.rays[0]!;
    none(sampledFailures(hits), 'the ray down through the sampled cell\'s centre meets the drawn surface and the physics shape there');
    none(standFailures(positionAt(placed!, STONE_POS), hits.drawn), 'the stone rests on the plate with rest_on, within 1e-6 m of the drawn surface at the sampled cell');
  }, TIMEOUT);

  it(`${ID} a plate whose size ÷ spacing is 4,097 a side is refused at check, naming size and spacing`, () => {
    landJudgesFailTheirPlants();
    const [shown] = run(bin(), scenarioOf(folder(), [OVER_DOC], [show(OVER_DOC, plateDoc(OVER, 'A plate 4,097 spacings a side'))]));
    none(capFailures(shown!, OVER), `the plate ${OVER.size.join(' × ')} m at ${OVER.spacing} m spacing is refused at check, naming its size and spacing`);
  }, TIMEOUT);

  it(`${ID} the planted cap read in metres refuses the 24 km plate and fails, naming it`, () => {
    landJudgesFailTheirPlants();
    const [shown] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, landDoc())], CAP_IN_METRES));
    expect(presentedFailures(shown!).length, `under ${CAP_IN_METRES} the 24 km plate doesn't build`).toBeGreaterThan(0);
    none(capFailures(shown!, LAND), `under ${CAP_IN_METRES} the refusal names the 24 km plate, its size and its spacing`);
  }, TIMEOUT);
});
