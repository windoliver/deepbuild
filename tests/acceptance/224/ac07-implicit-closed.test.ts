// AC7 #224.52ce6885: "The unit sphere x² + y² + z² − 1 = 0 in the box [−1.5, 1.5] m on each axis, at tolerance 0.05 m,
// meshes as one closed shell with V − E + F = 2 and every vertex within √3 × its cell's edge of radius 1; the torus
// (√(x² + y²) − 1)² + z² − 0.09 = 0 meshes closed with V − E + F = 0; and meshing with 1 and 8 threads gives the same
// vertex hash, which a planted mesher that numbers vertices as its threads finish fails"
//
// Implicit `surface@1`s (`zero`, `box`, `tolerance`), one-sided (README: Readings), read back by `geometry`: positions and
// indices, and `values.cell`, the edge of the mesh's cells (README: The surface under test). Shells are counted on
// positions welded at 1e-6 m; a shell is closed when every edge lies on exactly two triangles.
//   - `sphere`: one closed shell, V − E + F = 2; its cell a level of the box's octree, 3 ÷ 2^k m, whose diagonal √3 × cell
//     is within the 0.05 m tolerance unless `surface.coarse` names that edge (the default `max_cells` is no part of the
//     criterion); every vertex's |‖p‖ − 1| ≤ √3 × cell.
//   - `torus` (in the same box, at the same tolerance): one closed shell, V − E + F = 0.
//   - Threads: the sphere meshed in a run whose scenario sets `threads: 1` and in one that sets `threads: 8` gives one
//     vertex hash (README: The vertex hash). Under `nets_number_by_thread` (the planted mesher: each vertex numbered as
//     its thread finishes it) the same comparison fails, naming the 8 threads.
// Fails: no implicit surface; a mesh with cracks, holes or wrong topology; vertices off the surface; a vertex order that
// depends on threads.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, UNIT_SPHERE_ZERO, admitted, ask, failsNaming, fieldOf, geometry, len, meshOf, names, none, num, present, sceneDoc, shellFailures,
  useBins, vertexHash, zeroSurface, type Planted,
} from './helpers.ts';

useBins();
const ID = AC[7];
const TORUS_ZERO = '(sqrt(x^2 + y^2) - 1)^2 + z^2 - 0.09';

describe(`${ID} implicit surfaces meshed closed, the same for any thread count`, () => {
  it(`${ID} the unit sphere is one closed shell with V − E + F = 2, every vertex within √3 × its cell's edge of radius 1, and the torus closed with V − E + F = 0`, () => {
    const [shownReply, geo] = ask([
      present(DOC(1), sceneDoc('An implicit sphere and torus', { sphere: zeroSurface(UNIT_SPHERE_ZERO, 1.5, 0.05), torus: zeroSurface(TORUS_ZERO, 1.5, 0.05) })),
      geometry(DOC(1), ['sphere', 'torus']),
    ]);
    const issues = admitted(shownReply, 'the implicit sphere and torus');
    const sphere = meshOf(geo, 'sphere', 'the implicit sphere');
    none(shellFailures(sphere, 1, 2, 'the sphere'), 'the unit sphere meshes as one closed shell with V − E + F = 2');
    const cell = num(sphere.values['cell'], 'the sphere: values.cell, its cells\' edge');
    const level = Math.log2(3 / cell);
    expect(Math.abs(level - Math.round(level)), `the sphere's cell edge ${cell} m is a level of the 3 m box's octree, 3 ÷ 2^k`).toBeLessThanOrEqual(1e-9);
    // Its cells are the tolerance's (diagonal within 0.05 m), unless surface.coarse says it stopped at that edge.
    const coarse = issues.filter((i) => i.code === 'surface.coarse' && names(i, 'sphere')).map((i) => fieldOf(i, 'size'));
    expect(Math.sqrt(3) * cell <= 0.05 + 1e-12 || coarse.some((s) => typeof s === 'number' && Math.abs(s - cell) <= 1e-12 * cell),
      `the sphere's cells (edge ${cell} m) have a diagonal within the 0.05 m tolerance, or surface.coarse names that edge (it names ${JSON.stringify(coarse)})`).toBe(true);
    const off = sphere.positions.map((p, i) => [i, Math.abs(len(p) - 1)] as const).filter(([, d]) => d > Math.sqrt(3) * cell);
    none(off.slice(0, 5).map(([i, d]) => `vertex ${i} is ${d} m from radius 1, past √3 × ${cell}`), 'every vertex lies within √3 × its cell\'s edge of radius 1');
    const torus = meshOf(geo, 'torus', 'the implicit torus');
    none(shellFailures(torus, 1, 0, 'the torus'), 'the torus meshes closed, one shell with V − E + F = 0');
  }, TIMEOUT);

  it(`${ID} meshing with 1 and 8 threads gives the same vertex hash, and a planted mesher that numbers vertices as its threads finish (planted nets_number_by_thread) fails`, () => {
    const hashWith = (threads: number, planted?: Planted): string => {
      const [shownReply, geo] = ask([present(DOC(1), sceneDoc('An implicit sphere', { sphere: zeroSurface(UNIT_SPHERE_ZERO, 1.5, 0.05) })), geometry(DOC(1), ['sphere'])], { threads, ...(planted ? { planted } : {}) });
      admitted(shownReply, `the implicit sphere on ${threads} threads`);
      return vertexHash(meshOf(geo, 'sphere', `the implicit sphere on ${threads} threads`));
    };
    const judge = (one: string, eight: string): string[] => (one === eight ? [] : [`meshing with 1 thread gives vertex hash ${one}, with 8 threads ${eight}`]);
    none(judge(hashWith(1), hashWith(8)), 'the sphere meshed with 1 and with 8 threads');
    failsNaming(judge(hashWith(1, 'nets_number_by_thread'), hashWith(8, 'nets_number_by_thread')), ['8 threads'], 'nets_number_by_thread');
  }, TIMEOUT);
});
