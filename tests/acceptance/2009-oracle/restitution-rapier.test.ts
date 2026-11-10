// Ported from rapier (dimforge, Apache-2.0) at 3406750a38286a0d3c7d0f4be2f9d53153e81d90,
// crates/rapier3d/tests/issue_974_restitution.rs: the setup and assertions re-expressed as our world document and run
// against deep-physics's bake (#136), never against Rapier directly. Criteria 1 (the e² rebound of a 2 m drop within
// 0.05) and 2 (restitution matching e²h).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bake, box, none, physics, prebuild, sphere, statesOf, upstreamMaterial, upstreamWorld, type JsonObject } from './helpers.ts';

prebuild();

const STEPS = 400;
/** `rebound(e)`: a ball of radius 0.2, density 1, at y 2.3 over a fixed 30 × 0.1 × 30 cuboid at the origin, restitution e on both, combined by Average. */
const reboundWorld = (e: number): JsonObject => upstreamWorld({
  combine: { friction: 'average', restitution: 'average' },
  contact_materials: { m: upstreamMaterial({ restitution: e }) },
  shapes: { ground: box([30, 0.1, 30]), ball: sphere(0.2) },
  bodies: {
    ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'm' }], pose: { pos: [0, 0, 0] } },
    ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: [0, 2.3, 0] } },
  },
});
/** Upstream's measure: after the ball first dips below 0.35, its highest y; (apex − 0.3) ÷ 2, the fraction of the 2 m drop. */
function fractions(es: number[]): number[] {
  const replies = physics(es.map((e) => bake(reboundWorld(e), STEPS, { read: ['ball'] })));
  return es.map((e, i) => {
    const s = statesOf(replies[i]!, 'ball', STEPS + 1, `rebound(${e})`);
    let touched = false; let apex = 0;
    for (let k = 1; k <= STEPS; k++) {
      const y = s[k]!.pos[1];
      if (!touched && y < 0.35) touched = true;
      if (touched && y > apex) apex = y;
    }
    return (apex - 0.3) / 2;
  });
}

describe(`${AC[1]} ${AC[2]} rapier issue_974_restitution.rs, run on deep-physics`, () => {
  it(`${AC[1]} ${AC[2]} restitution_rebound_matches_e_squared: for e in 0.3, 0.5, 0.8, 0.95 the rebound fraction is within 0.05 of e²`, () => {
    const es = [0.3, 0.5, 0.8, 0.95];
    const got = fractions(es);
    none(es.flatMap((e, i) => (Math.abs(got[i]! - e * e) < 0.05 ? [] : [`restitution ${e}: rebound fraction ${got[i]!.toFixed(3)}, expected ~${(e * e).toFixed(3)}`])), 'each rebound within 0.05 of e²');
  }, TIMEOUT);

  it(`${AC[1]} ${AC[2]} zero_restitution_does_not_bounce: with e = 0 the rebound fraction is under 0.02`, () => {
    const [measured] = fractions([0]);
    expect(measured!, `restitution 0.0: rebound fraction ${measured!.toFixed(3)}, expected ~0`).toBeLessThan(0.02);
  }, TIMEOUT);
});
