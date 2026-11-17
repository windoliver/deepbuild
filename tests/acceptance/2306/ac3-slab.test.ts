// #2306.f80ef2cc: "The same car on a dynamic slab of 1,000 kg, 60 × 0.2 × 6 m, on a static floor, slab and floor of
// friction 0, driven at 2,000 N for 2 s after it has settled: the car moves at 4.00 m/s within 2% and the slab at
// 4.00 m/s the other way within 2%, so their momenta sum to 0 within 100 kg·m/s. The planted wrapper leaves the slab at
// rest and fails, naming the slab and the 4,000 kg·m/s it made"
//
// The slab (README: The fixtures, the slab) runs 60 m along z on a floor, both of friction 0; the car, heading +Z, is set
// down settled on its middle, sleep off, left 1 s, then driven at 2,000 N (stamped at step 120) and read 2 s later, at
// step 360. The car's speed is along its heading; the slab's against it (−z); the momenta are each body's declared mass
// times its velocity along z. `controller_as_is` pushes the car and not the slab, so the slab stays at rest and the two
// make 4,000 kg·m/s from nothing.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DRIVE_SLAB, MASS, TIMEOUT, ask, bakeOf, bodyOf, caught, drive, fmt, forward, naming, near, none, prebuild, slabWorld, stepAt,
  type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[3];
const SETTLE = stepAt(1);
const END = SETTLE + stepAt(2);
const SPEED = 4;
const MADE = 4000;

/** The car's and the slab's speeds and momenta 2 s into the drive, and the judge's failures. */
function pushed(planted?: Planted): { failures: string[]; slabSpeed: number; sum: number } {
  const [r] = ask([bakeOf(slabWorld(), END, [drive(SETTLE, 2000)], ['kart', 'slab'])], planted, 'the car driven along the free slab');
  const car = bodyOf(r, 'kart', END, 'the car driven along the free slab')[END]!;
  const slab = bodyOf(r, 'slab', END, 'the car driven along the free slab')[END]!;
  const carSpeed = forward(car);
  const slabSpeed = -slab.linear[2];
  const sum = MASS * car.linear[2] + DRIVE_SLAB * slab.linear[2];
  const failures: string[] = [];
  if (!near(carSpeed, SPEED, 0.02)) failures.push(`kart: moves ${fmt(carSpeed)} m/s along its heading 2 s into the drive, not 4.00 m/s within 2%`);
  if (!near(slabSpeed, SPEED, 0.02)) failures.push(`slab: moves ${fmt(slabSpeed)} m/s against the car's heading 2 s into the drive, not 4.00 m/s within 2%`);
  if (Math.abs(sum) > 100) failures.push(`slab: the car's and the slab's momenta sum to ${fmt(sum)} kg·m/s along the drive, not 0 within 100 kg·m/s`);
  return { failures, slabSpeed, sum };
}

describe(`${ID} a car driven along a free slab pushes the slab back as hard as it is pushed`, () => {
  it(`${ID} after 2 s of a 2,000 N drive the car moves at 4.00 m/s and the slab at 4.00 m/s the other way, within 2%, their momenta summing to 0 within 100 kg·m/s`, () => {
    none(pushed().failures, 'the car and the slab 2 s into the drive');
  }, TIMEOUT);

  it(`${ID} (twin: controller_as_is) the planted wrapper leaves the slab at rest and fails, naming the slab and the 4,000 kg·m/s it made`, () => {
    const { failures, slabSpeed, sum } = pushed('controller_as_is');
    caught(failures, 'controller_as_is');
    expect(Math.abs(slabSpeed), `the planted wrapper leaves the slab at rest (it moves ${fmt(slabSpeed)} m/s, under 2% of 4 m/s)`).toBeLessThanOrEqual(0.02 * SPEED);
    expect(near(sum, MADE, 0.02), `the planted wrapper's momenta sum to ${fmt(sum)} kg·m/s, the issue's 4,000 within 2%`).toBe(true);
    naming(failures, RegExp(`^slab: .*${fmt(sum).replace('.', '\\.')} kg·m/s`), 'controller_as_is\'s failure names the slab and the momentum it made');
  }, TIMEOUT);
});
