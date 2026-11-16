// AC9 #224.08c2cd78: "The unit sphere in the box [−1.5, 1.5] m on each axis at tolerance 0.001 m with `max_cells: 4,096`
// meshes at the last level whose cells fit, raises `surface.coarse` naming that cell edge, uses at most 4,096 cells and
// stays closed with V − E + F = 2; a planted mesher that stops part way through a level at the cap leaves open edges and
// fails"
//
// `capped`, the implicit unit sphere in [−1.5, 1.5]³ at tolerance 0.001 m with `max_cells: 4096`, one-sided (README:
// Readings). `geometry` answers `values.cell` (the cells' edge) and `values.cells` (how many cells the last level kept);
// `deep_show` answers `surface.coarse {item, size}`.
//   - The capped build: `surface.coarse` names `capped` and a size equal to `values.cell` (within 1e-12 relative); the
//     cell is a level of the box's octree, 3 ÷ 2^k m; `values.cells` ≤ 4,096; one closed shell, V − E + F = 2.
//   - "The last level whose cells fit": the same sphere at the next level, tolerance √3 × cell ÷ 2 (×(1 + 1e-9)) with
//     `max_cells: 262144`, meshes at edge cell ÷ 2 with no `surface.coarse` and keeps more than 4,096 cells, so that
//     level would have passed the cap.
//   - Under `octree_stops_mid_level` (the planted mesher: past the cap it stops part way through the next level's cells)
//     the closed-shell judge fails, naming open edges.
// Fails: a cap passed; a level that fits left unused; no issue, or one naming another size; a part-built level.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, UNIT_SPHERE_ZERO, admitted, ask, failsNaming, fieldOf, geometry, meshOf, names, none, num, present, sceneDoc, shellFailures,
  useBins, zeroSurface, type Run,
} from './helpers.ts';

useBins();
const ID = AC[9];
const capped = zeroSurface(UNIT_SPHERE_ZERO, 1.5, 0.001, { max_cells: 4096 });

function capRun(o: Run = {}): ReturnType<typeof ask> {
  return ask([present(DOC(1), sceneDoc('A capped implicit sphere', { capped })), geometry(DOC(1), ['capped'])], o);
}

describe(`${ID} an implicit surface at its cell cap`, () => {
  it(`${ID} the unit sphere at tolerance 0.001 m with max_cells 4,096 meshes at the last level whose cells fit, raises surface.coarse naming that cell edge, uses at most 4,096 cells and stays closed with V − E + F = 2`, () => {
    const [shownReply, geo] = capRun();
    const coarse = admitted(shownReply, 'the capped sphere').filter((i) => i.code === 'surface.coarse' && names(i, 'capped'));
    expect(coarse.length, 'surface.coarse names the capped sphere').toBe(1);
    const m = meshOf(geo, 'capped', 'the capped sphere');
    const cell = num(m.values['cell'], 'the capped sphere: values.cell');
    const cells = num(m.values['cells'], 'the capped sphere: values.cells');
    const size = num(fieldOf(coarse[0]!, 'size'), 'surface.coarse: size');
    expect(Math.abs(size - cell) / cell, `surface.coarse names the cell edge the mesh stopped at: size ${size}, cell ${cell}`).toBeLessThanOrEqual(1e-12);
    const k = Math.log2(3 / cell);
    expect(Math.abs(k - Math.round(k)), `the cell edge ${cell} m is a level of the 3 m box's octree, 3 ÷ 2^k`).toBeLessThanOrEqual(1e-9);
    expect(cells, 'the capped sphere uses at most 4,096 cells').toBeLessThanOrEqual(4096);
    none(shellFailures(m, 1, 2, 'the capped sphere'), 'the capped sphere stays one closed shell with V − E + F = 2');

    const next = zeroSurface(UNIT_SPHERE_ZERO, 1.5, Math.sqrt(3) * (cell / 2) * (1 + 1e-9), { max_cells: 262144 });
    const [nextShown, nextGeo] = ask([present(DOC(2), sceneDoc('The next level', { next })), geometry(DOC(2), ['next'])]);
    const nextIssues = admitted(nextShown, 'the sphere at the next level');
    expect(nextIssues.filter((i) => i.code === 'surface.coarse').map((i) => i.raw), 'the next level meshes uncapped').toEqual([]);
    const n = meshOf(nextGeo, 'next', 'the sphere at the next level');
    expect(Math.abs(num(n.values['cell'], 'the next level: values.cell') - cell / 2) / cell, 'the next level\'s cells are half the edge').toBeLessThanOrEqual(1e-12);
    expect(num(n.values['cells'], 'the next level: values.cells'), 'the next level keeps more than 4,096 cells, so the capped mesh is at the last level whose cells fit').toBeGreaterThan(4096);
  }, TIMEOUT);

  it(`${ID} a planted mesher that stops part way through a level at the cap (planted octree_stops_mid_level) leaves open edges and fails`, () => {
    const [, geo] = capRun({ planted: 'octree_stops_mid_level' });
    failsNaming(shellFailures(meshOf(geo, 'capped', 'the part-built sphere'), 1, 2, 'the part-built sphere'), ['open edges'], 'octree_stops_mid_level');
  }, TIMEOUT);
});
