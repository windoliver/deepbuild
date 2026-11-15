// Ported from the upstream physics engine's crates/rapier3d/tests/issue_499_angular_limits.rs (its velocity-motor drive
// of angular_limits_within_half_a_turn_are_reached, angular_limits_past_half_a_turn_are_reached and
// angular_limits_straddling_half_a_turn_are_reached), at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (Apache-2.0;
// Copyright the upstream project's authors). No upstream code is copied: each setup is our physics.world@1 document and
// each angle is read from the body's rotation in our bake, unwrapped as upstream does. The test backend that skips joint
// limits must be rejected.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, box, caught, none, physics, prebuild, rotsOf, unwrap, upstreamWorld, zAngle, type JsonObject, type Runner,
} from './helpers.ts';

prebuild(['shipped', 'test']);
const RANGES: [number, number][] = [
  [-45, 45], [-135, 135], [0, 90], [-170, -10],
  [0, 270], [-270, 0], [-90, 200], [-350, 0],
  [45, 315], [-315, -45], [135, 225],
];
/** Upstream's motor: a velocity of 5 rad/s either way (our motor target is in deg/s), with torque to spare. */
const MOTOR_DEG_S = (5 * 180) / Math.PI;

/** A fixed anchor at the origin, a 1 × 0.2 × 0.2 box at x 1 on a hinge about +z (its anchor 1 m back), angular damping 3, no gravity, 60 Hz. */
function hingeWorld(limits: [number, number], dir: number): JsonObject {
  return upstreamWorld({
    gravity: [0, 0, 0],
    shapes: { arm: box([0.5, 0.1, 0.1]) },
    bodies: { arm: { kind: 'dynamic', shapes: [{ shape: 'arm', contact_material: 'm' }], pose: { pos: [1, 0, 0] }, damping: { angular: 3 }, sleep: false } },
    joints: {
      hinge: {
        kind: 'hinge', a: 'world', b: 'arm', frame_a: { anchor: [0, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [-1, 0, 0], axis: [0, 0, 1] },
        limits: { min: limits[0], max: limits[1] }, motor: { mode: 'velocity', target: dir * MOTOR_DEG_S, max_torque: 20 },
      },
    },
  });
}

/** Upstream's assertion on our bakes: driven either way for 600 steps, the joint settles within 2° of the limit it is driven to. */
function limitFailures(r: Runner): string[] {
  const cases = RANGES.flatMap((limits) => [1, -1].map((dir) => ({ limits, dir })));
  const replies = physics(cases.map((c) => ({ call: 'bake', world: hingeWorld(c.limits, c.dir), steps: 600, read: ['arm'] })), r);
  return cases.flatMap((c, i) => {
    const angle = unwrap(rotsOf(replies[i]!, 'arm', `limits ${c.limits}`).map(zAngle)).at(-1)!;
    const target = c.dir > 0 ? c.limits[1] : c.limits[0];
    return Math.abs(angle - target) < 2 ? [] : [`limits [${c.limits}] driven ${c.dir > 0 ? '+' : '-'}: settled at ${angle.toFixed(2)}° instead of ${target}°`];
  });
}

describe(`${AC[1]} ${AC[3]} upstream issue_499_angular_limits.rs, run on deep-physics`, () => {
  test(`${AC[1]} ${AC[3]} angular limits within, past and straddling half a turn are reached by a motor driving either way, and no_joint_limits is rejected`, () => {
    none(limitFailures({}), 'rapier3d');
    const planted = limitFailures({ backend: 'no_joint_limits' });
    caught(planted, 'the test backend that skips joint limits');
    expect(planted.length, 'every driven limit is passed without limits').toBe(RANGES.length * 2);
  }, TIMEOUT);
});
