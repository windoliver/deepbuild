// #2516 AC4, the CPU reference's qualification (README: Qualification). Runs with no GPU and no build.
//
// AC4: "On the cube fixture at radius 0.5 m the reading on the floor 5 and 10 cm in front of the middle of a face is
// within 0.1 of a CPU reference in f64 of 4,096 cosine-weighted rays out to the radius (0.68 and 0.81), …"
//
// The design: "A CPU reference counts as an oracle only once it reproduces at least one fixture whose expected numbers
// the issue states … and its own planted twin fails; until then a comparison against it is a reading." This file is
// that qualification; cube.test.ts refuses to compare against a reference that fails it.
import { describe, expect, it } from 'vitest';
import {
  CUBE_STATED, RADIUS, RAYS, SLAB_STATED, WALL_STATED, cubeBandClosed, cubeBandReference, cubeFaceClosed, cubeFaceReach,
  directions, misses, qualification, slabClosed, wallClosed,
} from './reference.ts';

describe('AC4 the CPU reference: 4,096 cosine-weighted rays in f64, out to the radius', () => {
  it('AC4 its directions are 4,096 unit vectors over the floor\'s hemisphere with the cosine density (mean cos θ = 2/3), where the even twin\'s mean is 1/2', () => {
    const dirs = directions('reference');
    expect(dirs.length, 'the issue\'s 4,096 rays').toBe(RAYS);
    expect(dirs.filter((d) => !(d[1] > 0)).length, 'every direction leaves the floor (y > 0)').toBe(0);
    expect(dirs.filter((d) => Math.abs(Math.hypot(...d) - 1) > 1e-12).length, 'every direction is a unit vector').toBe(0);
    const meanCos = dirs.reduce((s, d) => s + d[1], 0) / RAYS;
    expect(Math.abs(meanCos - 2 / 3), `mean cos θ ${meanCos.toFixed(5)} is the cosine density's 2/3`).toBeLessThanOrEqual(0.002);
    const even = directions('uniform_twin').reduce((s, d) => s + d[1], 0) / RAYS;
    expect(Math.abs(even - 0.5), `the even twin's mean cos θ ${even.toFixed(5)} is 1/2, so the two models differ`).toBeLessThanOrEqual(0.002);
  });

  it('AC4 the closed forms it is held to reproduce the issue\'s stated values: the wall\'s six, the slab\'s two and the cube\'s 0.68 and 0.81', () => {
    for (const [cm, v] of WALL_STATED) expect(Math.abs(wallClosed(cm / 100) - v), `wall at ${cm} cm: the closed form ${wallClosed(cm / 100).toFixed(4)} is the issue's ${v}`).toBeLessThanOrEqual(0.0005);
    for (const [h, v] of SLAB_STATED) expect(slabClosed(h), `slab at ${h} m`).toBeCloseTo(v, 12);
    for (const [cm, v] of CUBE_STATED) {
      const d = cm / 100;
      expect(cubeFaceReach(d, 0.05), `cube at ${cm} cm: every corner of the face lies within the radius from every point of the band, so the face's form factor is the reference's answer`).toBeLessThan(RADIUS);
      expect(Math.abs(cubeFaceClosed(d) - v), `cube at ${cm} cm: the face's closed form ${cubeFaceClosed(d).toFixed(4)} rounds to the issue's ${v}`).toBeLessThanOrEqual(0.005);
    }
  });

  it('AC4 the reference reproduces every stated fixture (wall, slab, cube) within 0.01, and reads exactly 1 at 60 cm and 1 m from the wall', () => {
    const rows = qualification('reference');
    for (const r of rows) console.log(`reference  ${r.fixture}: ${r.got.toFixed(4)} (expected ${r.expected.toFixed(4)})`);
    expect(misses(rows), 'the reference misses no row').toEqual([]);
    for (const [cm] of CUBE_STATED) console.log(`reference  cube band at ${cm} cm: ${cubeBandReference(cm / 100).toFixed(4)} (closed form ${cubeBandClosed(cm / 100).toFixed(4)}); this is what cube.test.ts compares the GPU's reading to`);
  });

  it('AC4 the planted twin that weights its directions evenly fails the qualification, naming the slab at 0.25 m (it reads 0.5 there)', () => {
    const missed = misses(qualification('uniform_twin'));
    console.log(`uniform_twin misses: ${missed.join('; ')}`);
    expect(missed.some((m) => m.startsWith('slab at 0.25 m:')), `the even twin fails, naming the slab at 0.25 m: ${missed.join('; ')}`).toBe(true);
  });

  it('AC4 the planted twin whose rays run past the radius fails the qualification, naming the wall at 40 cm', () => {
    const missed = misses(qualification('uncut_twin'));
    console.log(`uncut_twin misses: ${missed.join('; ')}`);
    expect(missed.some((m) => m.startsWith('wall at 40 cm:')), `the uncut twin fails, naming the wall at 40 cm: ${missed.join('; ')}`).toBe(true);
  });
});
