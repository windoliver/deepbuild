// CPU only, no GPU: the expected values every GPU criterion here compares against, and the stated cameras.
//
// 1. The closed forms reproduce the issue's numbers to the digits it states: the wall at 5 to 40 cm (0.564, 0.626,
//    0.688, 0.748, 0.858, 0.948), 1 at 60 cm and 1 m, and the slab at 0.25 and 0.375 m (0.25, 0.5625).
// 2. The f64 CPU reference (4,096 cosine-weighted rays on a 64 × 64 stratified grid, out to the radius, against the
//    fixture's boxes) counts as an oracle only once it reproduces a fixture whose numbers the issue states and its own
//    planted twin fails (design: How we know version 0 works, "A CPU reference counts as an oracle only once …"). It is
//    held to the wall's six closed forms and the slab's two within 0.01 (README: drafted). On the cube (owner-approved,
//    APPROVED.md, A) its value at the point in front of the middle of the face is held to the issue's 0.68 and 0.81 and
//    to the face's f64 closed form, and its average over the middle 10 cm (what the GPU is compared with) to that closed
//    form averaged the same way, each within 0.01. Its twin, the same rays weighted evenly over the hemisphere, must read
//    0.5 under the slab at 0.25 m and so fail.
// 3. Each fixture's stated camera keeps in the frame every surface within the radius of every point it reads (AC1, AC3,
//    AC4's "from a second camera", "a camera facing that face and one 90° around it"; scope: "no occluder is left outside
//    the frame").
import { describe, expect, it } from 'vitest';
import {
  CUBE_BOXES, CUBE_CAMS, CUBE_HALF_SPAN, CUBE_POINTS, ISSUE, RADIUS, SLAB_HEIGHTS, WALL_BOXES, WALL_CAMS, WALL_OPEN, WALL_POINTS,
  cubeBandClosedForm, cubePointReference, cubeReads, cubeReference, neighbourhood, outOfFrame, rays, slabBoxes, slabCam, slabClosed, slabReads,
  visibility, wallClosed, wallReads,
} from './helpers.ts';
import { cubeFaceClosed, cubeFaceReach } from './redraft-ac4/reference.ts';

const QUALIFY = 0.01;

describe('the expected values: closed forms and the qualified CPU reference', () => {
  it('AC1 AC2 AC3 the closed forms reproduce the issue\'s numbers to the digits it states', () => {
    WALL_POINTS.forEach((d, i) => expect(Math.abs(wallClosed(d) - ISSUE.wall[i]!), `the wall's closed form at ${d * 100} cm is ${wallClosed(d).toFixed(5)}, the issue's ${ISSUE.wall[i]}`).toBeLessThanOrEqual(0.0005));
    for (const d of WALL_OPEN) expect(wallClosed(d), `past the radius (${d} m) the wall's closed form is 1`).toBe(1);
    SLAB_HEIGHTS.forEach((h, i) => expect(slabClosed(h), `the slab's closed form at ${h} m`).toBeCloseTo(ISSUE.slab[i]!, 12));
  });

  it('AC4 the 4,096-ray cosine-weighted f64 reference reproduces the wall\'s and the slab\'s closed forms and the cube\'s stated numbers, so it counts as the cube\'s oracle', () => {
    const cosine = rays('cosine');
    expect(cosine.length, 'the reference casts 4,096 rays').toBe(4096);
    const wall = WALL_BOXES.filter((b) => b.id !== 'floor');
    const misses: string[] = [];
    for (const d of [...WALL_POINTS, ...WALL_OPEN]) {
      const v = visibility([0, 0, d], wall, cosine);
      if (Math.abs(v - wallClosed(d)) > QUALIFY) misses.push(`wall at ${d * 100} cm: ${v.toFixed(4)} against ${wallClosed(d).toFixed(4)}`);
    }
    for (const h of SLAB_HEIGHTS) {
      const v = visibility([0, 0, 0], slabBoxes(h).filter((b) => b.id !== 'floor'), cosine);
      if (Math.abs(v - slabClosed(h)) > QUALIFY) misses.push(`slab at ${h} m: ${v.toFixed(4)} against ${slabClosed(h)}`);
    }
    // APPROVED.md, A: the issue's 0.68 and 0.81 are values at the point in front of the middle of the face; the band the
    // GPU reads is held to the redraft's f64 closed form averaged over the same points. Each is qualified on its own.
    CUBE_POINTS.forEach((d, i) => {
      const stated = ISSUE.cube[i] ?? NaN;
      const point = cubePointReference(d);
      const band = cubeReference(d);
      const closedPoint = cubeFaceClosed(d);
      const closedBand = cubeBandClosedForm(d);
      console.log(`#2516 cube CPU reference at ${d * 100} cm (4,096 cosine-weighted rays to ${RADIUS} m): point ${point.toFixed(4)} (the issue states ${stated}, the face's closed form ${closedPoint.toFixed(4)}); middle 10 cm of the face ${band.toFixed(4)} (the closed form averaged ${closedBand.toFixed(4)}), which the GPU is compared with`);
      if (!(cubeFaceReach(d, CUBE_HALF_SPAN) < RADIUS)) misses.push(`cube at ${d * 100} cm: a corner of the face lies beyond the radius from the band, so the face's closed form doesn't hold there`);
      if (!(Math.abs(point - stated) <= QUALIFY)) misses.push(`cube at ${d * 100} cm (point): ${point.toFixed(4)} against the issue's ${stated}`);
      if (!(Math.abs(point - closedPoint) <= QUALIFY)) misses.push(`cube at ${d * 100} cm (point): ${point.toFixed(4)} against the face's closed form ${closedPoint.toFixed(4)}`);
      if (!(Math.abs(band - closedBand) <= QUALIFY)) misses.push(`cube band at ${d * 100} cm: ${band.toFixed(4)} against the closed form averaged ${closedBand.toFixed(4)}`);
    });
    expect(misses, `the CPU reference reproduces every stated fixture within ${QUALIFY}:\n  ${misses.join('\n  ')}`).toEqual([]);
  });

  it('AC4 the reference\'s planted twin (rays weighted evenly over the hemisphere) reads 0.5 under the slab at 0.25 m and fails the qualification', () => {
    const v = visibility([0, 0, 0], slabBoxes(0.25).filter((b) => b.id !== 'floor'), rays('uniform'));
    expect(Math.abs(v - 0.5), `the even-weighted twin reads ${v.toFixed(4)} under the slab at 0.25 m`).toBeLessThanOrEqual(QUALIFY);
    expect(Math.abs(v - slabClosed(0.25)), 'so the twin fails the qualification the reference passes').toBeGreaterThan(QUALIFY);
  });
});

describe('each fixture states its camera, which keeps every surface within the radius of a read point in the frame', () => {
  const cases = [
    ...WALL_CAMS.map((c) => ({ c, what: `wall, camera ${c.name}`, pts: neighbourhood(WALL_BOXES, wallReads(), RADIUS) })),
    ...SLAB_HEIGHTS.map((h) => ({ c: slabCam(h), what: `slab at ${h} m`, pts: neighbourhood(slabBoxes(h), slabReads(), RADIUS) })),
    ...CUBE_CAMS.map((c) => ({ c, what: `cube, camera ${c.name}`, pts: neighbourhood(CUBE_BOXES, cubeReads(), RADIUS) })),
  ];
  for (const { c, what, pts } of cases) {
    it(`AC1 AC3 AC4 ${what}: every surface point within ${RADIUS} m of a read point lands inside the frame`, () => {
      expect(pts.length, `${what}: the neighbourhood has surface points`).toBeGreaterThan(1000);
      const o = outOfFrame(c, pts);
      expect(o.count, `${what}: ${o.count} of ${pts.length} neighbourhood points fall outside the frame: ${o.listed.join('; ')}`).toBe(0);
    });
  }
});
