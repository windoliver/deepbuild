// Ported from the upstream physics engine's bindings/python/tests/test_new_bindings.py, lines 76-121
// (test_active_collision_types_enables_kinematic_fixed_contact), at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90
// (Apache-2.0; Copyright the upstream project's authors). No upstream code is copied. Upstream finds the pair of a
// kinematic ball resting inside a fixed cuboid once kinematic–fixed pairs are enabled, after one step; ours makes the
// cuboid a sensor (the case criterion 10's static-sensor × kinematic cell is) and reads the pair as the sensor_enter row
// our bake writes at step 1. The planted wrapper left on the default pair filter, which skips kinematic–fixed pairs,
// writes no row and must be rejected.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, box, caught, firstBetween, none, physics, prebuild, rowsOf, sphere, upstreamWorld, type JsonObject, type Runner,
} from './helpers.ts';

prebuild(['shipped']);

/** A fixed cuboid of half extent 5 (a sensor) and a kinematic ball of radius 2 inside it, both at the origin, 60 Hz. */
const restingWorld = (): JsonObject => upstreamWorld({
  shapes: { ground: box([5, 5, 5]), ball: sphere(2) },
  bodies: {
    ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'm', sensor: true }], pose: { pos: [0, 0, 0] } },
    kin: { kind: 'kinematic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: [0, 0, 0] } },
  },
});

/** Upstream's assertion on our bake: after one step the kinematic–fixed pair is found (its sensor_enter row at step 1). */
function pairFailures(r: Runner): string[] {
  const [reply] = physics([{ call: 'bake', world: restingWorld(), steps: 1 }], r);
  const row = firstBetween(rowsOf(reply!, 'the resting kinematic ball'), 'sensor_enter', 'ground', 'kin');
  return row && row.step === 1 ? [] : [`no sensor_enter between ground and kin at step 1: ${row ? `step ${row.step}` : 'none'}`];
}

describe(`${AC[10]} upstream test_new_bindings.py: kinematic–fixed pairs, run on deep-physics`, () => {
  test(`${AC[10]} test_active_collision_types_enables_kinematic_fixed_contact: a kinematic ball inside a fixed cuboid is a pair after one step, and the default pair filter is rejected`, () => {
    none(pairFailures({}), 'rapier3d');
    const planted = pairFailures({ planted: 'pair_filter_default' });
    caught(planted, 'the planted wrapper left on the default pair filter');
    expect(planted.length).toBe(1);
  }, TIMEOUT);
});
