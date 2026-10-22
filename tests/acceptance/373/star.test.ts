import { describe, expect, it } from 'vitest';
import {
  LOOK, check, clone, errorsOf, expectClean, expectRefused, fixture, geometry, paramsOf, rasterInput, scratch,
  useRenderBinary, type Subpath,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('star');
const DOC = fixture('star.figure');
const TOLERANCE = 0.01; // u, the criterion's

type Point = [number, number];

/**
 * A star's vertices, read as the criterion counts them: one closed subpath of M and L points (its
 * roundness is 0), with a last point that repeats the first dropped.
 */
function vertices(subpaths: Subpath[], what: string): Point[] {
  expect(subpaths.length, `${what} is one path`).toBe(1);
  const path = subpaths[0]!;
  expect(path.closed, `${what} is a closed path`).toBe(true);
  expect(path.verbs.filter((v) => v !== 'Z').every((v, i) => v === (i === 0 ? 'M' : 'L')), `${what} is straight segments (M, then L), got ${path.verbs.join(' ')}`).toBe(true);
  const points = [...path.points];
  const first = points[0]; const last = points.at(-1);
  if (points.length > 1 && first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) points.pop();
  return points;
}

/**
 * The closed form: vertex k at angle −90° + s·k·(180° ÷ points), straight up first, at radius `radius(k)`
 * from the centre (y down). The design doesn't say which way degrees turn in 2D, so s = +1 and s = −1
 * (the mirror image) are both accepted; the failures are those of the closer one.
 */
function closedFormFailures(points: Point[], center: Point, count: number, step: number, radius: (k: number) => number): string[] {
  const attempt = (s: number): string[] => {
    const failures: string[] = [];
    if (points.length !== count) failures.push(`${points.length} vertices, not ${count}`);
    for (let k = 0; k < Math.min(count, points.length); k++) {
      const a = ((-90 + s * k * step) * Math.PI) / 180;
      const want: Point = [center[0] + radius(k) * Math.cos(a), center[1] + radius(k) * Math.sin(a)];
      const got = points[k]!;
      const d = Math.hypot(got[0] - want[0], got[1] - want[1]);
      if (d > TOLERANCE) failures.push(`vertex ${k} is at (${got[0]}, ${got[1]}), ${d.toFixed(4)} u from the closed form's (${want[0].toFixed(4)}, ${want[1].toFixed(4)})`);
    }
    return failures;
  };
  const cw = attempt(1); const ccw = attempt(-1);
  return cw.length <= ccw.length ? cw : ccw;
}

describe('AC2 star@1: stars and regular polygons as closed paths, a fractional count, and the 200-vertex limit', () => {
  it('AC2 star@1 with 5 points is a closed path of 10 vertices matching its closed form within 0.01 u', () => {
    const points = vertices(geometry(DOC, 'star5'), 'star5');
    expect(points.length, 'a five-point star has 10 vertices').toBe(10);
    expect(closedFormFailures(points, [110, 110], 10, 36, (k) => (k % 2 === 0 ? 100 : 40)), 'star5 against its closed form').toEqual([]);
  }, 300_000);

  it('AC2 a polygon with 6 points is a regular hexagon', () => {
    const points = vertices(geometry(DOC, 'hexagon'), 'hexagon');
    expect(points.length, 'a polygon of 6 points has 6 corners').toBe(6);
    expect(closedFormFailures(points, [330, 110], 6, 60, () => 100), 'the hexagon against a regular hexagon of radius 100, a corner straight up').toEqual([]);
    // Regular: every side is the radius, 100 u, and every corner is 100 u from the centre.
    for (let k = 0; k < 6; k++) {
      const a = points[k]!; const b = points[(k + 1) % 6]!;
      expect(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 100), `side ${k} is 100 u long`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(Math.hypot(a[0] - 330, a[1] - 110) - 100), `corner ${k} is 100 u from the centre`).toBeLessThanOrEqual(TOLERANCE);
    }
  }, 300_000);

  it('AC2 a star of 5.5 points closes on a half spike', () => {
    // ⌈5.5⌉ × 2 = 12 vertices, 180° ÷ 5.5 apart: five whole spikes and the half spike at the top, whose last
    // vertex sits straight up at the inner radius, so the path closes along the radius back to the first.
    const points = vertices(geometry(DOC, 'star55'), 'star55');
    expect(points.length, 'a star of 5.5 points has ⌈5.5⌉ × 2 = 12 vertices').toBe(12);
    expect(closedFormFailures(points, [550, 110], 12, 180 / 5.5, (k) => (k % 2 === 0 ? 100 : 40)), 'star55 against its closed form').toEqual([]);
    const last = points[11]!; const first = points[0]!;
    expect(Math.hypot(last[0] - 550, last[1] - 70), `the last vertex is straight up at the inner radius, (550, 70); got (${last[0]}, ${last[1]})`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.hypot(first[0] - 550, first[1] - 10), `the first vertex is straight up at the outer radius, (550, 10); got (${first[0]}, ${first[1]})`).toBeLessThanOrEqual(TOLERANCE);
  }, 300_000);

  it('AC2 a star past 200 vertices is refused, naming the item; one of exactly 200 is drawn', () => {
    // 100 points is the most (Star: 3 to 100), 200 vertices.
    expectClean(DOC, LOOK, 'the star fixture');
    const burst = vertices(geometry(DOC, 'burst'), 'burst');
    expect(burst.length, 'a star of 100 points has 200 vertices').toBe(200);

    const planted = clone(DOC);
    paramsOf(planted, 'burst')['points'] = 100.5; // ⌈100.5⌉ × 2 = 202 vertices
    const errors = errorsOf(check(planted, LOOK));
    expect(errors.map((e) => e.code), 'the only error is the star\'s range').toEqual(['out_of_range']);
    expect(errors[0]?.ids, 'the error names the star').toContain('burst');
    expect(errors[0]?.path, 'the error is at the star\'s points').toBe('items/burst/params/points');
    expectRefused('geometry', { doc: planted, item: 'burst' }, 'out_of_range', 'the star has 202 vertices');
    expectRefused('raster', rasterInput(dir, planted, LOOK), 'out_of_range', 'the star has 202 vertices');
  }, 300_000);
});
