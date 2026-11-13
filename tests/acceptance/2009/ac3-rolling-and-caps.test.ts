// #2009.43ed60cb: on Rapier, a world whose contact material sets rolling_resistance 0.05 or tangent_speed 1 m/s, or that
// joins two hinges with a gear in dynamic mode, is refused at check naming the field and the backend; a solid ball of
// radius 0.1 m rolling at 2 m/s on a level floor with angular damping 2/s slows below 0.05 m/s between 6 and 7.5 s
// (v = v0·e^(−2ct/7): 6.46 s). Each refusal's twin lets its world through, and is caught.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, admittedFailures, bake, box, caught, check, dynamic, floor, issuesOf, none, physics, prebuild, refusalFailures,
  sphere, statesOf, world, type JsonObject, type Planted, type Want,
} from './helpers.ts';

prebuild();

const RATE = 120;
const material = (extra: JsonObject = {}): JsonObject => ({ friction: 0.5, restitution: 0, density: 1000, ...extra });
/** A box resting on a floor; its contact material `pad` carries `extra`. */
const padWorld = (extra: JsonObject): JsonObject => world({
  contact_materials: { pad: material(extra) },
  shapes: { floor: box([30, 0.1, 30]), crate: box([0.25, 0.25, 0.25]) },
  bodies: { floor: floor('pad'), crate: dynamic('crate', 'pad', [0, 0.25, 0], { mass: 1 }) },
});
/** Two wheels, each on a hinge to the world about z; with `gear`, a gear of ratio 2 joins the hinges. */
const gearWorld = (gear: boolean): JsonObject => {
  const hinge = (b: string, x: number): JsonObject => ({ kind: 'hinge', a: 'world', b, frame_a: { anchor: [x, 1, 0], axis: [0, 0, 1] }, frame_b: { anchor: [0, 0, 0], axis: [0, 0, 1] } });
  return world({
    mode: 'dynamic',
    contact_materials: { steel: material() },
    shapes: { wheel: { kind: 'cylinder', half_height: 0.05, radius: 0.2 } },
    bodies: { w1: dynamic('wheel', 'steel', [0, 1, 0], { mass: 1 }), w2: dynamic('wheel', 'steel', [1, 1, 0], { mass: 1 }) },
    joints: {
      h1: hinge('w1', 0), h2: hinge('w2', 1),
      ...(gear ? { gear: { kind: 'gear', a: 'w1', b: 'w2', ratio: 2, of: ['h1', 'h2'] } } : {}),
    },
  });
};

const CASES: { name: string; refused: JsonObject; admitted: JsonObject; want: Want; twin: Planted }[] = [
  { name: 'rolling_resistance 0.05', refused: padWorld({ rolling_resistance: 0.05 }), admitted: padWorld({ rolling_resistance: 0 }), want: { field: ['contact_materials', 'pad', 'rolling_resistance'], actual: 0.05 }, twin: 'caps_allow_rolling_resistance' },
  { name: 'tangent_speed 1 m/s', refused: padWorld({ tangent_speed: 1 }), admitted: padWorld({ tangent_speed: 0 }), want: { field: ['contact_materials', 'pad', 'tangent_speed'], actual: 1 }, twin: 'caps_allow_tangent_speed' },
  { name: 'a gear joining two hinges in dynamic mode', refused: gearWorld(true), admitted: gearWorld(false), want: { field: ['joints', 'gear', 'kind'], actual: 'gear', id: 'gear' }, twin: 'caps_allow_dynamic_gear' },
];

describe(`${AC[3]} rolling_resistance, tangent_speed and a dynamic gear are refused on Rapier; a damped rolling ball slows as v0·e^(−2ct/7)`, () => {
  it(`${AC[3]} rolling_resistance 0.05, tangent_speed 1 m/s and a gear of two hinges in dynamic mode are each refused at check naming the field and rapier3d; at 0 and without the gear each world is admitted; each cap's twin is caught`, () => {
    const replies = physics(CASES.flatMap((c) => [check(c.refused), check(c.admitted)]));
    const off: string[] = [];
    CASES.forEach((c, i) => {
      off.push(...refusalFailures(issuesOf(replies[2 * i]!, c.name), c.want).map((f) => `${c.name}: ${f}`));
      off.push(...admittedFailures(issuesOf(replies[2 * i + 1]!, `${c.name}, admitted twin of the world`)).map((f) => `${c.name} at 0 or without the gear: ${f}`));
    });
    none(off, 'each refused, each control admitted');
    for (const c of CASES) {
      const [twin] = physics([check(c.refused)], c.twin);
      caught(refusalFailures(issuesOf(twin!, `${c.name} under ${c.twin}`), c.want), c.twin);
    }
  }, TIMEOUT);

  it(`${AC[3]} a solid ball of radius 0.1 m rolling at 2 m/s with angular damping 2/s slows below 0.05 m/s between 6 and 7.5 s (6.46 s predicted)`, () => {
    const R = 0.1; const V0 = 2; const C = 2;
    const predicted = (7 / (2 * C)) * Math.log(V0 / 0.05);
    expect(Number(predicted.toFixed(2)), 'v0·e^(−2ct/7) = 0.05 m/s at').toBe(6.46);
    const w = world({
      contact_materials: { plain: material() },
      shapes: { floor: box([50, 0.1, 50]), ball: sphere(R) },
      bodies: {
        floor: floor('plain', [50, 0.1, 50]),
        // Rolling without slipping: ω = v ÷ r about −z for travel along +x, in deg/s.
        ball: dynamic('ball', 'plain', [0, R, 0], { mass: 1, velocity: { linear: [V0, 0, 0], angular: [0, 0, -(V0 / R) * (180 / Math.PI)] }, damping: { linear: 0, angular: C } }),
      },
    });
    const steps = 9 * RATE;
    const [reply] = physics([bake(w, steps, { read: ['ball'] })]);
    const s = statesOf(reply!, 'ball', steps + 1, 'the rolling ball');
    const slow = s.findIndex((x) => Math.hypot(x.linear[0], x.linear[2]) < 0.05);
    expect(slow, 'the ball slows below 0.05 m/s within 9 s').toBeGreaterThan(0);
    const t = slow / RATE;
    expect(t >= 6 && t <= 7.5, `the ball first rolls under 0.05 m/s at ${t.toFixed(3)} s, between 6 and 7.5 s`).toBe(true);
  }, TIMEOUT);
});
