// Ported from the upstream physics engine's crates/rapier3d/tests/issue_974_restitution.rs, at commit
// 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (Apache-2.0; Copyright the upstream project's authors). No upstream code is
// copied: the setup and the assertion are re-expressed on our physics.world@1 document and asserted on what
// `deep-physics` answers. Upstream's ball and ground both carry e under the average rule (so e combined); ours declares
// the maximum rule with the ground at 0, so e is combined again, and the test backend that takes the minimum instead
// combines 0, which this test must reject.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, box, caught, none, physics, prebuild, sphere, statesOf, upstreamMaterial, upstreamWorld, type JsonObject, type Runner,
} from './helpers.ts';

prebuild(['shipped', 'test']);
const ES = [0.3, 0.5, 0.8, 0.95];

/** A ball of radius 0.2 m, density 1, at y 2.3 over a 30 × 0.1 × 30 cuboid at the origin, restitution e, 400 steps at 60 Hz. */
function dropWorld(e: number): JsonObject {
  return upstreamWorld({
    combine: { friction: 'average', restitution: 'max' },
    contact_materials: { ball: upstreamMaterial({ restitution: e }), ground: upstreamMaterial() },
    shapes: { ball: sphere(0.2), ground: box([30, 0.1, 30]) },
    bodies: {
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'ball' }], pose: { pos: [0, 2.3, 0] } },
      ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'ground' }], pose: { pos: [0, 0, 0] } },
    },
  });
}

/** Upstream's assertion on our bakes: after the ball first dips below y 0.35, (highest y − 0.3) ÷ 2 within 0.05 of e². */
function reboundFailures(r: Runner): string[] {
  const replies = physics(ES.map((e) => ({ call: 'bake', world: dropWorld(e), steps: 400, read: ['ball'] })), r);
  return ES.flatMap((e, i) => {
    const ys = statesOf(replies[i]!, 'ball', `the drop with e = ${e}`).slice(1).map((s) => s.pos[1]);
    const touched = ys.findIndex((y) => y < 0.35);
    if (touched < 0) return [`e = ${e}: the ball never came down to y 0.35`];
    const apex = Math.max(...ys.slice(touched));
    const fraction = (apex - 0.3) / 2;
    return Math.abs(fraction - e * e) < 0.05 ? [] : [`e = ${e}: rebound fraction ${fraction.toFixed(3)}, expected ~${(e * e).toFixed(3)}`];
  });
}

describe(`${AC[1]} ${AC[3]} upstream issue_974_restitution.rs, run on deep-physics`, () => {
  test(`${AC[1]} ${AC[3]} restitution_rebound_matches_e_squared: for e in 0.3, 0.5, 0.8, 0.95 the rebound fraction is within 0.05 of e², and restitution_min is rejected`, () => {
    none(reboundFailures({}), 'rapier3d');
    const planted = reboundFailures({ backend: 'restitution_min' });
    caught(planted, 'the test backend that takes the combined restitution as the minimum');
    expect(planted.length, 'every e is rejected under the minimum (it combines 0)').toBe(ES.length);
  }, TIMEOUT);
});
