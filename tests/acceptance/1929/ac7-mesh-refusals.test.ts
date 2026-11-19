// AC7 #1929.303648a3: "With the octahedron's points 1 m out instead of 2 m, the cube's 8 corners lie outside it and
// its 12 edge midpoints on it, and the item is refused at check with `mesh_deform.outside`, naming those 20 vertices,
// with 0 builds. The 2 m octahedron less one triangle is refused with `mesh_deform.mesh`, naming its 3 open edges,
// and a control mesh of 65 points with the same code. A planted deform that extrapolates outside vertices builds and
// fails"
//
// The cube's points are read first from a document of its own (`plain`). Then, each in a document of its own, the
// cube `crate` under `mod.mesh_deform@1`, every move (0, 0, 0):
//   - the octahedron 1 m out: its faces are the planes |x| + |y| + |z| = 1 m about the cube's centre, so the corners
//     (1.5 m) lie 0.289 m outside, the edge midpoints (1 m) on it and the face centres (0.5 m) 0.289 m inside. The
//     revision is refused with an error issue `mesh_deform.outside` that names the item and exactly the 8 corners and
//     12 edge midpoints, each once (README: Naming a vertex).
//   - the 2 m octahedron without its +x, +y, +z triangle: refused with `mesh_deform.mesh`, whose `edges` name
//     exactly that triangle's three edges, each by its two point indices (README: Naming an open edge).
//   - a bipyramid of 65 points (a ring of 63 and two apexes, 2 m out), closed, manifold, wound outward, the cube well
//     inside: refused with `mesh_deform.mesh`. The same of 64 points is the clean twin: presented and built.
// "0 builds" is read as in AC4: `geometry` for the item after each refusal answers the base's `no_revision`, or
// `builds: 0` with no mesh. The wrong program: scenario `planted: mesh_deform_extrapolates_outside` extrapolates the
// vertices outside the 1 m octahedron instead of refusing them: the revision is presented and `geometry` counts a
// build and answers a mesh, so the same judge must fail, naming the missing `mesh_deform.outside` and the build.

import { describe, expect, it } from 'vitest';
import {
  AC, CENTRE, DOC, TIMEOUT, admitted, builtVertices, cube, cubeOf, failsNaming, geometry, kindOf, meshDeform, none, num, outcome, refusalProblems, rowOf, runShow,
  scenario, sceneDoc, show, useBin, useDir, verticesWhere, zeros, type Cube, type JsonObject, type Planted,
} from './helpers.ts';
import { OCTA, bipyramid, cageProblems, depthInside, edgeKey, fmtV, octahedron, openEdges, type Cage } from './reference.ts';

const bin = useBin();
const dir = useDir();

/** The criterion's small control mesh: the octahedron with its points 1 m out. */
const SMALL = octahedron(CENTRE, 1);
const crateDoc = (title: string, cage: Cage): JsonObject => sceneDoc(title, { crate: cube([meshDeform(cage, zeros(cage.points.length))]) });
const plainDoc = (): JsonObject => sceneDoc('The cube before any deform', { plain: cube() });

/** The cube read, the 1 m octahedron's revision shown and `geometry` asked for its item, under the shipped program or a planted one. */
function small(planted?: Planted): { cube: Cube; named: number[]; replies: JsonObject[] } {
  const replies = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [
    show(DOC.a, plainDoc()), geometry(DOC.a, ['plain']),
    show(DOC.b, crateDoc('A cube whose corners lie outside its control mesh', SMALL)), geometry(DOC.b, ['crate']),
  ], planted));
  admitted(replies[0]!, 'the cube before any deform');
  const c = cubeOf(rowOf(replies[1]!, 'plain', 'the cube before any deform'));
  // The fixture: 8 corners outside the 1 m octahedron, 12 edge midpoints on it, 6 face centres inside.
  none(cageProblems(SMALL), 'the 1 m octahedron is closed, manifold and wound outward');
  for (const p of c.points) {
    const depth = depthInside(SMALL, p.at);
    const want = { 'corner': -0.5 / Math.sqrt(3), 'edge midpoint': 0, 'face centre': 0.5 / Math.sqrt(3) }[kindOf(p.place)];
    expect(Math.abs(depth - want) <= 1e-12, `the fixture's vertex ${p.vertex} at ${fmtV(p.at)}, a ${kindOf(p.place)}, lies ${want} m inside the 1 m octahedron, got ${depth}`).toBe(true);
  }
  const named = verticesWhere(c, (place) => kindOf(place) !== 'face centre');
  expect(named.length, 'the cube has 8 corners and 12 edge midpoints').toBe(20);
  return { cube: c, named, replies };
}

describe(`${AC[7]} vertices outside the control mesh and bad control meshes are refused at check`, () => {
  it(`${AC[7]} with the octahedron's points 1 m out the item is refused at check with mesh_deform.outside, naming the cube's 8 corners and 12 edge midpoints, with 0 builds`, () => {
    const { cube: c, named, replies } = small();
    none(refusalProblems(replies[2]!, replies[3]!, { id: 'crate', code: 'mesh_deform.outside', vertices: named }, c), 'the cube in the 1 m octahedron');
  }, TIMEOUT);

  it(`${AC[7]} the 2 m octahedron less one triangle is refused with mesh_deform.mesh, naming its 3 open edges, and a control mesh of 65 points with the same code`, () => {
    const whole = octahedron(CENTRE, 2);
    const corner = [OCTA.px, OCTA.py, OCTA.pz];
    const open: Cage = { points: whole.points, triangles: whole.triangles.filter((t) => !corner.every((i) => t.includes(i))) };
    const edges = [edgeKey(OCTA.px, OCTA.py), edgeKey(OCTA.py, OCTA.pz), edgeKey(OCTA.pz, OCTA.px)].sort();
    const [big, most] = [bipyramid(CENTRE, 63, 2), bipyramid(CENTRE, 62, 2)];
    // The fixtures: seven triangles with exactly those three edges open; closed meshes of 65 and 64 points around the cube.
    expect([open.triangles.length, openEdges(open.triangles)], 'the octahedron less its +x, +y, +z triangle: 7 triangles, 3 open edges').toEqual([7, edges]);
    expect([big.points.length, most.points.length], 'the bipyramids have 65 and 64 points').toEqual([65, 64]);
    for (const cage of [big, most]) {
      none(cageProblems(cage), `the bipyramid of ${cage.points.length} points is closed, manifold and wound outward`);
      for (const x of [-0.5, 0, 0.5]) for (const y of [-0.5, 0, 0.5]) for (const z of [-0.5, 0, 0.5]) {
        expect(depthInside(cage, [CENTRE[0] + x, CENTRE[1] + y, CENTRE[2] + z]), `the cube lies well inside the bipyramid of ${cage.points.length} points`).toBeGreaterThan(0.1);
      }
    }
    const replies = runShow(bin(), scenario(dir(), [DOC.b, DOC.c, DOC.d], [
      show(DOC.b, crateDoc('A control mesh with one triangle missing', open)), geometry(DOC.b, ['crate']),
      show(DOC.c, crateDoc('A control mesh of 65 points', big)), geometry(DOC.c, ['crate']),
      show(DOC.d, crateDoc('A control mesh of 64 points', most)), geometry(DOC.d, ['crate']),
    ]));
    none(refusalProblems(replies[0]!, replies[1]!, { id: 'crate', code: 'mesh_deform.mesh', edges }), 'the 2 m octahedron less one triangle');
    none(refusalProblems(replies[2]!, replies[3]!, { id: 'crate', code: 'mesh_deform.mesh' }), 'the control mesh of 65 points');
    // The clean twin, one point inside the rule: nothing is refused.
    admitted(replies[4]!, 'the control mesh of 64 points');
    expect(rowOf(replies[5]!, 'crate', 'the cube in the control mesh of 64 points').positions.length, 'the cube in the control mesh of 64 points builds').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[7]} planted mesh_deform_extrapolates_outside, a deform that extrapolates outside vertices, builds and fails`, () => {
    const { cube: c, named, replies } = small('mesh_deform_extrapolates_outside');
    expect(outcome(replies[2]!), 'planted mesh_deform_extrapolates_outside presents the revision').toBe('presented');
    expect(num(replies[3]!['builds'], 'planted mesh_deform_extrapolates_outside: geometry\'s builds'), 'planted mesh_deform_extrapolates_outside builds the item').toBeGreaterThanOrEqual(1);
    expect(builtVertices(replies[3]!, 'crate'), 'planted mesh_deform_extrapolates_outside builds every vertex').toBe(c.input.length);
    failsNaming(refusalProblems(replies[2]!, replies[3]!, { id: 'crate', code: 'mesh_deform.outside', vertices: named }, c),
      ['crate: no error issue mesh_deform.outside', 'want 0 builds'], 'planted mesh_deform_extrapolates_outside');
  }, TIMEOUT);
});
