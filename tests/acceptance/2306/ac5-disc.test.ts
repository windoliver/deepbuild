// #2306.61717c4c: "On a dynamic disc of 20,000 kg and radius 8 m turned by a hinge motor at 30°/s about the vertical,
// the braked car parked 3 m from the axis has gone around the axis within 3° of the disc's own turn after 4 s and is
// within 0.15 m of 3 m from it. A planted wrapper whose wheels' grip reads the chassis's velocity alone carries the car
// less than 10° around and fails, naming the body"
//
// The disc (README: The fixtures, the disc) is hinged to the world about +Y through its centre by `axle`, whose
// velocity motor turns it at 30°/s from rest; the car is set down settled on it with its centre at (3, ·, 0), heading
// +X, away from the axis, so its axle runs along the disc's turn and only its wheels' grip carries it around; a brake of
// 4,000 N is stamped at step 0. Baked 4 s. The car's turn around the axis is the angle of its centre about +Y, and the
// disc's own turn the angle of its local +X about +Y, each unwrapped step to step from step 0; both read from the bodies'
// states at step 480. The disc turning at 30°/s within 1% by then is the fixture's premise (the behavior kit's hinge
// motor), so a disc that never turned can't pass it. `grip_reads_chassis_only` lets the disc turn under the car.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DISC_AT, DISC_RATE, TIMEOUT, around, ask, bakeOf, bodyOf, brake, caught, discWorld, flat, fmt, naming, near, none, prebuild,
  stepAt, turnOf, unwrapped, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[5];
const END = stepAt(4);

/** The car's and the disc's turns about the axis after 4 s, the car's distance from it, and the judge's failures. */
function carried(planted?: Planted): { failures: string[]; carTurn: number } {
  const [r] = ask([bakeOf(discWorld(), END, [brake(0, 4000)], ['kart', 'disc'])], planted, 'the car parked on the turning disc');
  const car = bodyOf(r, 'kart', END, 'the car parked on the turning disc');
  const disc = bodyOf(r, 'disc', END, 'the car parked on the turning disc');
  const spin = disc[END]!.angular[1];
  expect(near(spin, DISC_RATE, 0.01), `the disc turns at ${fmt(spin)} deg/s about +Y after 4 s, its motor's 30°/s within 1%`).toBe(true);
  const carTurn = unwrapped(car.map((s) => around(s.pos)))[END]!;
  const discTurn = unwrapped(disc.map(turnOf))[END]!;
  const radius = flat(car[END]!.pos, [0, 0, 0]);
  const failures: string[] = [];
  if (Math.abs(carTurn - discTurn) > 3) failures.push(`kart: has gone ${fmt(carTurn)}° around the axis after 4 s, where the disc has turned ${fmt(discTurn)}°, not within 3° of it`);
  if (Math.abs(radius - DISC_AT) > 0.15) failures.push(`kart: is ${fmt(radius)} m from the axis after 4 s, not 3 m within 0.15 m`);
  return { failures, carTurn };
}

describe(`${ID} a turning disc carries a braked car around with it`, () => {
  it(`${ID} after 4 s the braked car has gone around the axis within 3° of the disc's own turn and is within 0.15 m of 3 m from it`, () => {
    none(carried().failures, 'the car on the disc after 4 s');
  }, TIMEOUT);

  it(`${ID} (twin: grip_reads_chassis_only) a wrapper whose wheels' grip reads the chassis's velocity alone carries the car less than 10° around and fails, naming the body`, () => {
    const { failures, carTurn } = carried('grip_reads_chassis_only');
    caught(failures, 'grip_reads_chassis_only');
    naming(failures, /^kart: /, 'grip_reads_chassis_only\'s failure names the body');
    expect(Math.abs(carTurn), `the planted wrapper carries the car ${fmt(carTurn)}° around, less than 10°`).toBeLessThan(10);
  }, TIMEOUT);
});
