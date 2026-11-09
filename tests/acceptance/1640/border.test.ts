// AC2: "A 2-triangle plane draws 4 border segments with `border: true`, 0 with `border: false`, and never its
// diagonal"
//
// The fixture (fixtures/parity/geometry/crease-edges.scene): a 1 × 1 m plate@1 of one grid cell (2 triangles), read by
// two `mark.line@1` items with `edges: {of: "plane", kind: {crease: {angle: 30}}, border}`, one with `border: true`
// and one with `border: false`. Counted on wgpu's noop backend from `view3d`'s `segments`, on welded positions.
// Conditions: with `border: true` it draws exactly 4 segments, one on each side of the square, and no segment
// between opposite corners; with `border: false` it draws 0. As a fixture guard, its `all` line draws 5 (the
// 2-triangle plane's 4 border edges and its diagonal), so the diagonal exists to be left out. `--planted
// crease_below_angle` (AC1's twin) keeps the diagonal, whose faces meet at 0°, and the check fails, naming it.

import { describe, expect, it } from 'vitest';
import { borderProblems, cases, drawScene, emptyProblems, guardProblems } from './edge-sets.ts';
import { AC, PLANE_BORDER, failsNaming, none, segmentsOf, useDir, useGpuBin, type Frame3 } from './helpers.ts';

const bin = useGpuBin();
const dir = useDir();

function planeProblems(f: Frame3, what: string): string[] {
  const all = cases();
  const on = all.get('plane_border')!;
  const off = all.get('plane_no_border')!;
  return [...borderProblems(on, segmentsOf(f, on.line, what)), ...emptyProblems(off, segmentsOf(f, off.line, what)).map((p) => `with border: false, ${p}`)];
}

describe(`${AC[2]} border edges of a 2-triangle plane`, () => {
  it(`${AC[2]} with border: true the plane draws its ${PLANE_BORDER} border segments and never its diagonal; with border: false, 0 (noop lane)`, () => {
    expect(cases().get('plane_border')!.segments, 'the fixture\'s expected count is the issue\'s').toBe(PLANE_BORDER);
    const what = 'the crease fixture';
    const f = drawScene(bin(), dir(), {});
    none(guardProblems(cases().get('plane_border')!, f, what), 'the fixture guard');
    none(planeProblems(f, what), 'the plane\'s border edges');
  }, 3_600_000);

  it(`${AC[2]} the planted crease_below_angle draws the plane's diagonal and fails, naming it`, () => {
    const what = 'the crease fixture with --planted crease_below_angle';
    const f = drawScene(bin(), dir(), { planted: 'crease_below_angle' });
    failsNaming(planeProblems(f, what), ['crease edges of plane draw its diagonal'], what);
  }, 3_600_000);
});
