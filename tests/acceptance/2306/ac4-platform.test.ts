// #2306.5f9f29ae: "The same car braked at 4,000 N on a kinematic platform whose `follow` channel takes it from rest to
// 2 m/s along the car's axle over 1 s and holds it for 2 s, 5 m in all: the car ends within 0.02 m of its place on the
// platform. Set down already moving with a platform that holds 2 m/s along its axle, it is within 0.02 m of its place
// 3 s on. With `brake` 0 and the platform moving along the car's heading, the car stays within 0.02 m of where it was in
// the world, since a free wheel rolls. The planted wrapper leaves the braked car 5.000 m behind and fails, naming the
// body"
//
// The platform (README: The fixtures, the platform) is a kinematic body of a scene's world `ride` following the channel
// `deck`, #1918's form, with nothing under it; the car is set down settled on its middle, heading +Z (its axle x), sleep
// off, and each run is baked 3 s. Its place on the platform is its position less the platform's, read from both bodies'
// states; distances are horizontal (x, z). Braked: a brake of 4,000 N stamped at step 0, the platform ramping to 2 m/s
// along x over 1 s and holding it to 3 s; the car's place at step 360 against its place at step 0. Moving: the car set
// down at 2 m/s along x on a platform holding 2 m/s along x from the start, braked the same way; its place at step 360.
// Free: no brake, the platform ramping along z the same way; the car's position at every step against where it started.
// `controller_as_is` reads a kinematic body's speed as nothing, so the braked car stays where it started in the world
// and ends 5.000 m from its place.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, ask, bodyOf, brake, caught, flat, fmt, naming, none, prebuild, ramp, rideBake, rideScene, steady, stepAt, sub,
  type JsonObject, type Path, type Planted, type State,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];
const END = stepAt(3);
const WITHIN = 0.02;
const BEHIND = 5;

/** The car's and the platform's states over the run. */
function ride(path: Path, braked: boolean, kartExtra: JsonObject = {}, planted?: Planted): { car: State[]; deck: State[] } {
  const what = `the car on the platform${braked ? ', braked' : ', free'}`;
  const [r] = ask([rideBake(rideScene(path, kartExtra), END, braked ? [brake(0, 4000)] : [])], planted, what);
  return { car: bodyOf(r, 'kart', END, what), deck: bodyOf(r, 'platform', END, what) };
}
/** How far the car is from its place on the platform at step `k`: its offset from the platform then, against at step 0. */
const offPlace = (car: State[], deck: State[], k: number): number => flat(sub(car[k]!.pos, deck[k]!.pos), sub(car[0]!.pos, deck[0]!.pos));

function braked(planted?: Planted): { failures: string[]; off: number } {
  const { car, deck } = ride(ramp(0), true, {}, planted);
  const off = offPlace(car, deck, END);
  return { failures: off <= WITHIN ? [] : [`kart: ends ${fmt(off)} m from its place on the platform after the platform's 5 m along its axle, not within 0.02 m`], off };
}

describe(`${ID} a kinematic platform under a car carries it, braked or rolling with it, and a free wheel rolls`, () => {
  it(`${ID} braked at 4,000 N on a platform taken from rest to 2 m/s along the car's axle over 1 s and held 2 s, the car ends within 0.02 m of its place on the platform`, () => {
    none(braked().failures, 'the braked car on the platform');
  }, TIMEOUT);

  it(`${ID} set down already moving with a platform that holds 2 m/s along its axle, it is within 0.02 m of its place 3 s on`, () => {
    const { car, deck } = ride(steady(), true, { velocity: { linear: [2, 0, 0] } });
    const off = offPlace(car, deck, END);
    none(off <= WITHIN ? [] : [`kart: is ${fmt(off)} m from its place on the platform 3 s on, not within 0.02 m`], 'the car moving with the platform');
  }, TIMEOUT);

  it(`${ID} with brake 0 and the platform moving along the car's heading, the car stays within 0.02 m of where it was in the world`, () => {
    const { car, deck } = ride(ramp(2), false);
    expect(deck[END]!.pos[2] - deck[0]!.pos[2], 'the platform moves 5 m along the car\'s heading').toBeCloseTo(5, 3);
    const far = car.map((s, k) => ({ d: flat(s.pos, car[0]!.pos), k })).filter(({ d }) => d > WITHIN);
    none(far.length ? [`kart: is ${fmt(far[0]!.d)} m from where it was in the world at step ${far[0]!.k} (${far.length} steps past 0.02 m), not within 0.02 m`] : [], 'the free car on the platform moving along its heading');
  }, TIMEOUT);

  it(`${ID} (twin: controller_as_is) the planted wrapper leaves the braked car 5.000 m behind and fails, naming the body`, () => {
    const { failures, off } = braked('controller_as_is');
    caught(failures, 'controller_as_is');
    naming(failures, /^kart: /, 'controller_as_is\'s failure names the body');
    expect(Math.abs(off - BEHIND), `the planted wrapper leaves the braked car ${fmt(off)} m from its place, the issue's 5.000 m`).toBeLessThanOrEqual(0.0005);
  }, TIMEOUT);
});
