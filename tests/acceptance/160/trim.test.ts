// AC1: "A trim with start 0, end 0.25 and offset 90° on a circle covers the quarter of its length that starts 90°
// round it, within 0.01 u at 64 sampled points, and an offset of 450° gives the same arc"
//
// Through `path` (README: The surface under test). A circle@1 with ops becomes a path (Path: ops); where that path
// starts and which way it runs are the implementation's, so the test reads them from the same circle trimmed to
// its whole length (start 0, end 1), checks that path is the circle within 0.01 u, and expects the trimmed arc to
// run from 90° to 180° round it from its start, in its own direction. The 64 points are taken evenly by arc length
// along the trimmed output (flattened finely here) and compared with the circle's points at those angles, in f64.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, dist, figure, flatten, item, none, pathAt, sampleByLength, useRenderBinary, type JsonObject, type Pt,
} from './helpers.ts';

useRenderBinary();
const C: Pt = [100, 100];
const R = 25; // a 4-cubic circle stays within 0.007 u of r = 25, so the 0.01 u budget is the trim's

function ring(trim: JsonObject): JsonObject {
  return figure('trim-ring', [200, 200], [item('ring', 'circle@1', 'a0', { center: C, r: R, ops: [{ trim }], paint: { stroke: { role: 'ink', width: 3 } } })]);
}

/** The output of the ring's ops at t = 0, flattened: one sub-path. */
function traced(trim: JsonObject, what: string): Pt[] {
  const f = pathAt(ring(trim), 'ring', what);
  expect(f.subpaths.length, `${what}: one sub-path`).toBe(1);
  return flatten(f.subpaths[0]!, 512);
}

/** Where the ring's path starts (degrees from +x, y down) and which way it runs (+1 toward +y). */
function startAndSense(): { theta0: number; sense: 1 | -1 } {
  const whole = traced({ start: 0, end: 1, offset: 0 }, 'the ring trimmed to its whole length');
  const far = whole.map((p) => Math.abs(dist(p, C) - R));
  expect(Math.max(...far), 'the circle as a path lies on the circle within 0.01 u').toBeLessThanOrEqual(0.01);
  const p0 = whole[0]!; const p1 = whole[8]!;
  const cross = (p0[0] - C[0]) * (p1[1] - C[1]) - (p0[1] - C[1]) * (p1[0] - C[0]);
  return { theta0: Math.atan2(p0[1] - C[1], p0[0] - C[0]), sense: cross > 0 ? 1 : -1 };
}

function arcFailures(points: Pt[], theta0: number, sense: number, what: string): string[] {
  const failures: string[] = [];
  points.forEach((p, j) => {
    const a = theta0 + (sense * (Math.PI / 2) * (1 + j / 63));
    const want: Pt = [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)];
    const d = dist(p, want);
    if (d > 0.01) failures.push(`${what}: sample ${j} at (${p[0].toFixed(4)}, ${p[1].toFixed(4)}) is ${d.toFixed(4)} u from the arc's (${want[0].toFixed(4)}, ${want[1].toFixed(4)})`);
  });
  return failures;
}

describe('AC1 a trim with an offset travels round a closed path', () => {
  it('AC1 a trim with start 0, end 0.25 and offset 90° on a circle covers the quarter of its length that starts 90° round it, within 0.01 u at 64 sampled points', () => {
    const { theta0, sense } = startAndSense();
    const quarter = sampleByLength(traced({ start: 0, end: 0.25, offset: 90 }, 'the trim at offset 90°'), 64);
    none(arcFailures(quarter, theta0, sense, 'offset 90°'), 'the trimmed quarter against the circle from 90° to 180° round it');
    // A trim that ignores its offset covers the first quarter instead, every sample 2r·sin(45°) ≈ 35 u away.
  }, TIMEOUT);

  it('AC1 an offset of 450° gives the same arc as 90°', () => {
    const { theta0, sense } = startAndSense();
    const at90 = sampleByLength(traced({ start: 0, end: 0.25, offset: 90 }, 'the trim at offset 90°'), 64);
    const at450 = sampleByLength(traced({ start: 0, end: 0.25, offset: 450 }, 'the trim at offset 450°'), 64);
    none(arcFailures(at450, theta0, sense, 'offset 450°'), 'the trim at 450° against the circle from 90° to 180° round it');
    const apart = at450.map((p, j) => dist(p, at90[j]!));
    expect(Math.max(...apart), 'the 450° trim and the 90° trim draw the same arc, within 0.01 u at each sample').toBeLessThanOrEqual(0.01);
  }, TIMEOUT);
});
