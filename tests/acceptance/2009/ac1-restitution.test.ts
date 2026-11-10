// #2009.59ac371b: a world that sets restitution_threshold 1 m/s is refused on Rapier, naming the field; with 0, a ball
// of restitution 0.5 dropped 2 m onto a floor of restitution 0.5 rebounds to within 0.05 of a quarter of the drop, then
// rests. The refusal's twin `caps_allow_restitution_threshold` lets the 1 m/s world through, and is caught.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, admittedFailures, bake, caught, check, dynamic, floor, issuesOf, none, physics, prebuild, refusalFailures,
  sphere, speed, statesOf, world, type JsonObject,
} from './helpers.ts';

prebuild();

const R = 0.1;
const DROP = 2;
/** The ball's lowest point 2 m above the floor's top (y = 0); both of restitution 0.5. */
const dropWorld = (threshold: number): JsonObject => world({
  solver: { restitution_threshold: threshold },
  contact_materials: { half: { friction: 0.5, restitution: 0.5, density: 1000 } },
  shapes: { floor: { kind: 'box', half: [30, 0.1, 30] }, ball: sphere(R) },
  bodies: { floor: floor('half'), ball: dynamic('ball', 'half', [0, DROP + R, 0], { mass: 1 }) },
});
const WANT = { field: ['solver', 'restitution_threshold'], actual: 1 } as const;

describe(`${AC[1]} restitution_threshold is refused on Rapier; a 0.5 ball rebounds to a quarter of a 2 m drop, then rests`, () => {
  it(`${AC[1]} restitution_threshold 1 m/s is refused at check naming solver/restitution_threshold and ${'rapier3d'}; 0 is admitted; the twin that admits it is caught`, () => {
    const [refused, admitted] = physics([check(dropWorld(1)), check(dropWorld(0))]);
    none(refusalFailures(issuesOf(refused!, 'threshold 1'), WANT), 'restitution_threshold 1 is refused naming the field and the backend');
    none(admittedFailures(issuesOf(admitted!, 'threshold 0')), 'restitution_threshold 0 is admitted');
    const [twin] = physics([check(dropWorld(1))], 'caps_allow_restitution_threshold');
    caught(refusalFailures(issuesOf(twin!, 'threshold 1 under caps_allow_restitution_threshold'), WANT), 'caps_allow_restitution_threshold');
  }, TIMEOUT);

  it(`${AC[1]} with restitution_threshold 0 the ball rebounds to within 0.05 of a quarter of the 2 m drop, then rests`, () => {
    const steps = 600; // 5 s at 120 Hz
    const [reply] = physics([bake(dropWorld(0), steps, { read: ['ball'] })]);
    const s = statesOf(reply!, 'ball', steps + 1, 'the drop');
    const contact = s.findIndex((x, k) => k > 0 && x.linear[1] > 0);
    expect(contact, 'the ball bounces (its vertical velocity turns upward)').toBeGreaterThan(0);
    let apex = -Infinity;
    for (let k = contact; k < s.length && s[k]!.linear[1] > 0; k++) apex = Math.max(apex, s[k]!.pos[1] - R);
    const fraction = apex / DROP;
    expect(Math.abs(fraction - 0.25), `the first rebound ${apex.toFixed(4)} m is ${fraction.toFixed(4)} of the drop, within 0.05 of 0.25`).toBeLessThanOrEqual(0.05);
    const resting: string[] = [];
    for (let k = steps - 120; k <= steps; k++) {
      const x = s[k]!;
      if (speed(x.linear) >= 0.05) resting.push(`step ${k}: speed ${speed(x.linear).toFixed(4)} m/s`);
      if (Math.abs(x.pos[1] - R) > 0.01) resting.push(`step ${k}: centre at ${x.pos[1].toFixed(4)} m, not on the floor (${R} m)`);
    }
    none(resting, 'over its last second (4 to 5 s) the ball rests on the floor: speed under 0.05 m/s, centre within 0.01 m of its radius');
  }, TIMEOUT);
});
