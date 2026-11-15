// #2516 AC4 on the GPU (README: Proof mapping).
//
// AC4: "On the cube fixture at radius 0.5 m the reading on the floor 5 and 10 cm in front of the middle of a face is
// within 0.1 of a CPU reference in f64 of 4,096 cosine-weighted rays out to the radius (0.68 and 0.81), from a camera
// facing that face and from one 90° around it. The 0.1 is drafted until the first run. A planted loop that puts every
// one of main's points at the full radius passes the wall fixture, reads above 0.99 here and fails, naming the camera"
//
// Runs on the reference Mac under the GPU lease. No GPU: BLOCKED. Another machine: INCONCLUSIVE. Never PASS by either.
// At the base the occlusion loop is main's, so the first test reads well above the reference and fails; the planted
// loop is not in the base's `deep-gpu`, so the other two read BLOCKED there.
import { describe, expect, it } from 'vitest';
import { CUBE_FIXTURE, PLANTED, WALL_FIXTURE, offBy, readFixture, requireReferenceMac, useGpuBin, useOut, type Reading } from './fixtures.ts';
import { CUBE_STATED, WALL_STATED, cubeBandReference, misses, qualification } from './reference.ts';

const gpu = useGpuBin();
const out = useOut();

/** The criterion's bound, drafted until the first run (the issue's own words). */
const TOL = 0.1;
/** AC1's bound for the wall fixture, drafted until the first run. */
const WALL_TOL = 0.05;

/** The reference the GPU is compared to, once it has qualified (reference.test.ts); a reference that hasn't is a reading only. */
function qualifiedReference(): (cm: number) => number {
  const missed = misses(qualification('reference'));
  expect(missed, 'the CPU reference has qualified (reference.test.ts); until it does, a comparison against it is a reading and AC4 stays open').toEqual([]);
  const ref = new Map(CUBE_STATED.map(([cm]) => [cm, cubeBandReference(cm / 100)]));
  return (cm) => ref.get(cm)!;
}

const camerasNamed = (failures: string[]): string[] => CUBE_FIXTURE.cameras.map((c) => c.name).filter((n) => failures.some((f) => f.startsWith(`camera ${n} `)));

describe('AC4 the cube: the floor in front of a face reads the CPU reference\'s visibility within 0.1', () => {
  it('AC4 at radius 0.5 m, 5 and 10 cm in front of the middle of a face, the reading is within 0.1 of the reference (0.68 and 0.81), from a camera facing the face and one 90° around it, at 8 and 16 samples and half and full resolution', () => {
    const reference = qualifiedReference();
    const readings = readFixture(gpu.bin(), out(), CUBE_FIXTURE);
    requireReferenceMac();
    expect(readings.length, 'two cameras × four settings × two distances').toBe(16);
    const failures = offBy(readings, reference, TOL, 'the CPU reference');
    expect(failures, `every reading is within ${TOL} of the CPU reference: ${failures.join('; ')}`).toEqual([]);
  }, 3_600_000);

  it(`AC4 the planted loop (${PLANTED}: every one of main's points at the full radius) reads above 0.99 here and fails, naming the camera`, () => {
    const reference = qualifiedReference();
    const readings: Reading[] = readFixture(gpu.bin(), out(), CUBE_FIXTURE, PLANTED);
    requireReferenceMac();
    const above = readings.filter((r) => r.value > 0.99);
    expect(above.length, `the planted loop reads above 0.99 on the cube: ${readings.map((r) => `${r.camera} (${r.setting}) ${r.cm} cm ${r.value.toFixed(4)}`).join('; ')}`).toBeGreaterThan(0);
    const failures = offBy(readings, reference, TOL, 'the CPU reference');
    console.log(`${PLANTED} on the cube fails: ${failures.join('; ')}`);
    expect(failures.length, 'the check fails on the planted loop').toBeGreaterThan(0);
    expect(camerasNamed(failures).length, `each failure names its camera: ${failures.join('; ')}`).toBeGreaterThan(0);
  }, 3_600_000);

  it(`AC4 the same planted loop (${PLANTED}) passes the wall fixture: within 0.05 of the closed form at 5 to 40 cm, from both of its cameras, at every setting`, () => {
    const stated = new Map(WALL_STATED);
    const readings = readFixture(gpu.bin(), out(), WALL_FIXTURE, PLANTED);
    requireReferenceMac();
    expect(readings.length, 'two cameras × four settings × six distances').toBe(48);
    const failures = offBy(readings, (cm) => stated.get(cm)!, WALL_TOL, 'the closed form');
    expect(failures, `the planted loop passes the wall fixture, so only the cube catches it: ${failures.join('; ')}`).toEqual([]);
  }, 3_600_000);
});
