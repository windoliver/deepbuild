// Ported from the upstream physics engine's src/dynamics/coefficient_combine_rule.rs (its geometric_mean_combine test), at
// commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (Apache-2.0; Copyright the upstream project's authors). No upstream code
// is copied. Upstream asserts the combined coefficient directly; our document has no call that answers it, so the
// coefficient is read the way the behavior kit reads a slide: from the box's own motion on the ground under friction
// alone, μ = v0² ÷ (2·g·d) for a box that stops, and μ = (v0 − v) ÷ (g·t) for one that doesn't, within the slide fixtures'
// 3%. The test backend that averages friction while the world declares the geometric mean must be rejected.
import { describe, expect, test } from 'vitest';
import {
  AC, G, TIMEOUT, UPSTREAM_RATE, box, caught, none, physics, prebuild, statesOf, upstreamMaterial, upstreamWorld,
  type JsonObject, type Runner,
} from './helpers.ts';

prebuild(['shipped', 'test']);
const V0 = 5;
const STEPS = 3 * UPSTREAM_RATE;

/** A box of half extent 0.25 m sliding along +x at 5 m/s on a static floor, the box's friction a and the floor's b, geometric mean. */
function slideWorld(a: number, b: number): JsonObject {
  return upstreamWorld({
    combine: { friction: 'geometric', restitution: 'max' },
    contact_materials: { box: upstreamMaterial({ friction: a }), floor: upstreamMaterial({ friction: b }) },
    shapes: { block: box([0.25, 0.25, 0.25]), floor: box([100, 0.1, 100]) },
    bodies: {
      block: { kind: 'dynamic', shapes: [{ shape: 'block', contact_material: 'box' }], pose: { pos: [0, 0.25, 0] }, velocity: { linear: [V0, 0, 0] } },
      floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'floor' }], pose: { pos: [0, -0.1, 0] } },
    },
  });
}

/** Upstream's cases on our slides: combine(0.25, 1.0) = 0.5 and combine(0.7, 0.0) = 0.0 under the geometric mean. */
function combineFailures(r: Runner): string[] {
  const [half, zero] = physics([
    { call: 'bake', world: slideWorld(0.25, 1.0), steps: STEPS, read: ['block'] },
    { call: 'bake', world: slideWorld(0.7, 0.0), steps: UPSTREAM_RATE, read: ['block'] },
  ], r);
  const out: string[] = [];
  const slid = statesOf(half!, 'block', 'the slide on 0.25 against 1.0');
  const d = slid.at(-1)!.pos[0] - slid[0]!.pos[0];
  const mu = (V0 * V0) / (2 * G * d);
  if (Math.abs(slid.at(-1)!.linear[0]) > 1e-3) out.push(`0.25 against 1.0: the box hasn't stopped after ${STEPS} steps`);
  if (Math.abs(mu - 0.5) > 0.03 * 0.5) out.push(`0.25 against 1.0: the box slid ${d.toFixed(3)} m, μ = ${mu.toFixed(4)}, not the geometric mean 0.5`);
  const free = statesOf(zero!, 'block', 'the slide on 0.7 against 0.0');
  const v = free.at(-1)!.linear[0];
  const mu0 = (V0 - v) / (G * 1);
  if (mu0 > 0.01) out.push(`0.7 against 0.0: the box slowed from ${V0} to ${v.toFixed(3)} m/s in 1 s, μ = ${mu0.toFixed(4)}, not the geometric mean 0.0`);
  return out;
}

describe(`${AC[1]} ${AC[2]} ${AC[3]} upstream coefficient_combine_rule.rs, run on deep-physics`, () => {
  test(`${AC[1]} ${AC[2]} ${AC[3]} geometric_mean_combine: 0.25 against 1.0 combines 0.5 and 0.7 against 0.0 combines 0.0, and friction_average is rejected`, () => {
    none(combineFailures({}), 'rapier3d');
    const planted = combineFailures({ backend: 'friction_average' });
    caught(planted, 'the test backend that averages friction');
    expect(['0.25 against 1.0', '0.7 against 0.0'].map((c) => planted.some((f) => f.startsWith(c))), `both cases are rejected under the average: ${planted.join('; ')}`).toEqual([true, true]);
  }, TIMEOUT);
});
