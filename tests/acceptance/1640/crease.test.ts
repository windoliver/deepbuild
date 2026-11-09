// AC1: "With `crease {angle: 30}`, a 1 m cube (12 triangles) draws exactly 12 segments, a 32-segment cylinder with
// flat caps draws 64 (its two rims) and none on its side, and a 32 × 16 UV ball draws 0. A planted test that keeps
// edges below the angle instead of above it fails, naming the item and the count"
//
// The fixture (fixtures/parity/geometry/crease-edges.scene): a 1 m slab@1 cube, a lathe@1 cylinder of 32 segments
// with flat caps, a 32 × 16 UV ball@1, each read by a `mark.line@1` with `edges: {of, kind: {crease: {angle: 30}}}`.
// Counted on wgpu's noop backend from `view3d`'s `segments` (#420: each segment a mesh-edge line drew, in world
// metres, with `counts: true`), on welded positions. Conditions: the cube draws exactly 12 segments, its 12 edges,
// 1 m long between 8 corners (and, as a fixture guard, its `all` line draws a closed 12-triangle mesh's 18); the
// cylinder draws 64, 32 on each rim, none on its side; the ball draws 0. `--planted crease_below_angle` keeps the
// edges below the angle instead: the same check fails, naming each item and the count it drew (the cube's 6 face
// diagonals among them).

import { describe, expect, it } from 'vitest';
import { cases, cubeProblems, cylinderProblems, drawScene, emptyProblems, guardProblems, twinNames, type Case } from './edge-sets.ts';
import { AC, ANGLE, BALL_SEGMENTS, CUBE_SEGMENTS, CYLINDER_SEGMENTS, CYLINDER_SIDES, failsNaming, none, segmentsOf, useDir, useGpuBin, type Frame3 } from './helpers.ts';

const bin = useGpuBin();
const dir = useDir();

/** AC1's three items, each held to its check; failures name the item and the count it drew. */
function creaseProblems(f: Frame3, what: string): string[] {
  const all = cases();
  const of = (name: string): Case => all.get(name)!;
  const check: [Case, (c: Case, s: Parameters<typeof cubeProblems>[1]) => string[]][] = [
    [of('cube'), cubeProblems], [of('cylinder'), cylinderProblems], [of('ball'), emptyProblems],
  ];
  return check.flatMap(([c, fn]) => fn(c, segmentsOf(f, c.line, what)));
}

describe(`${AC[1]} crease {angle: ${ANGLE}} on a cube, a cylinder and a UV ball`, () => {
  it(`${AC[1]} the cube draws exactly its ${CUBE_SEGMENTS} edges, the cylinder its two rims (${CYLINDER_SEGMENTS}) and none on its side, the ball ${BALL_SEGMENTS} (noop lane)`, () => {
    const c = cases();
    expect([c.get('cube')!.segments, c.get('cylinder')!.segments, c.get('cylinder')!.raw['per_rim'], c.get('ball')!.segments], 'the fixture\'s expected counts are the issue\'s').toEqual([CUBE_SEGMENTS, CYLINDER_SEGMENTS, CYLINDER_SIDES, BALL_SEGMENTS]);
    const what = 'the crease fixture';
    const f = drawScene(bin(), dir(), {});
    none(guardProblems(cases().get('cube')!, f, what), 'the fixture guard');
    none(creaseProblems(f, what), 'the crease edges');
  }, 3_600_000);

  it(`${AC[1]} the planted crease_below_angle keeps the edges below the angle and fails, naming each item and its count`, () => {
    const what = 'the crease fixture with --planted crease_below_angle';
    const f = drawScene(bin(), dir(), { planted: 'crease_below_angle' });
    const all = cases();
    const counts = ['cube', 'cylinder', 'ball'].map((n) => {
      const c = all.get(n)!;
      return { c, n: segmentsOf(f, c.line, what).length };
    });
    for (const { c, n } of counts) expect(n, `${what}: ${c.of} draws another count than ${c.segments}`).not.toBe(c.segments);
    // Each failure names the item and the count it drew; the cube's below-30° edges are its 6 face diagonals.
    const names = [...twinNames('crease_below_angle'), ...counts.map(({ c, n }) => `crease edges of ${c.of} draw ${n} segments, not ${c.segments}`)];
    failsNaming(creaseProblems(f, what), names, what);
  }, 3_600_000);
});
