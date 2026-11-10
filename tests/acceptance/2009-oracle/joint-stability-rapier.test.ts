// Ported from rapier (dimforge, Apache-2.0) at 3406750a38286a0d3c7d0f4be2f9d53153e81d90,
// crates/rapier3d/tests/joint_stability.rs (the dim3 forms of prismatic_limit_chains_remain_stable and
// joint_net_remains_stable; the ignored long runs left out): each re-expressed as our world document and run against
// deep-physics's bake (#136). Criterion 2: a jointed chain whose energy runs away fails.
import { describe, it } from 'vitest';
import { AC, TIMEOUT, bake, box, none, physics, prebuild, speed, sphere, statesOf, upstreamMaterial, upstreamWorld, type JsonObject, type Vec3 } from './helpers.ts';

prebuild();

const CHECK_EVERY = 1000;
/** `assert_sane` after every 1,000 steps: every body within `bound` of the origin, no body faster than 100 m/s. */
function sane(w: JsonObject, steps: number, bound: number, scene: string): string[] {
  const [reply] = physics([bake(w, steps, { every: CHECK_EVERY })]);
  const ids = Object.keys(w['bodies'] as JsonObject);
  const series = ids.map((id) => statesOf(reply!, id, steps / CHECK_EVERY + 1, `${scene}: ${id}`));
  const out: string[] = [];
  for (let j = 1; j <= steps / CHECK_EVERY; j++) {
    let maxVel = 0;
    ids.forEach((id, i) => {
      const s = series[i]![j]!;
      if (!(Math.hypot(...s.pos) < bound)) out.push(`${scene}: after ${j * CHECK_EVERY} steps ${id} at non-sane position ${s.pos.join(', ')}`);
      maxVel = Math.max(maxVel, speed(s.linear));
    });
    if (!(maxVel < 100)) out.push(`${scene}: after ${j * CHECK_EVERY} steps runaway velocity ${maxVel} (energy is being injected)`);
  }
  return out;
}

describe(`${AC[2]} rapier joint_stability.rs, run on deep-physics`, () => {
  it(`${AC[2]} prismatic_limit_chains_remain_stable: 10 chains of 10 boxes on sliders limited to ±1.5 m along alternating diagonal rails stay sane over 10,000 steps`, () => {
    const rad = 0.4; const shift = 1; const num = 10;
    const bodies: JsonObject = {}; const joints: JsonObject = {};
    for (let chain = 0; chain < 10; chain++) {
      const x = chain * 4;
      let parent = `g${chain}`;
      bodies[parent] = { kind: 'static', shapes: [{ shape: 'cube', contact_material: 'm' }], pose: { pos: [x, 0, 0] } };
      for (let i = 0; i < num; i++) {
        const child = `c${chain}_${i}`;
        bodies[child] = { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'm' }], pose: { pos: [x, -(i + 1) * shift, 0] }, sleep: false };
        const sign = i % 2 === 0 ? 1 : -1; const n = Math.hypot(sign, 1);
        const axis: Vec3 = [sign / n, 1 / n, 0];
        // PrismaticJointBuilder::new(axis).local_anchor2((0, shift, 0)).limits([-1.5, 1.5]); Rapier's joints keep contacts on.
        joints[`p${chain}_${i}`] = { kind: 'slider', a: parent, b: child, frame_a: { anchor: [0, 0, 0], axis }, frame_b: { anchor: [0, shift, 0], axis }, limits: { min: -1.5, max: 1.5 }, collide_connected: true };
        parent = child;
      }
    }
    const w = upstreamWorld({
      capacity: { bodies: 128, shapes: 128, joints: 128, contacts: 2048, particles: 0 },
      contact_materials: { m: upstreamMaterial() }, shapes: { cube: box([rad, rad, rad]) }, bodies, joints,
    });
    none(sane(w, 10_000, 200, 'prismatic_limit_chains'), 'the chains stay sane');
  }, TIMEOUT);

  it(`${AC[2]} joint_net_remains_stable: a pinned 32 × 32 net of balls on ball joints stays sane over 4,000 steps`, () => {
    const n = 32; const rad = 0.4; const shift = 1;
    const id = (i: number, j: number): string => `b${i}_${j}`;
    const bodies: JsonObject = {}; const joints: JsonObject = {};
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const fixed = i === 0 && (j % 4 === 0 || j === n - 1);
        bodies[id(i, j)] = { kind: fixed ? 'static' : 'dynamic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: [j * shift, -i * shift, 0] }, ...(fixed ? {} : { sleep: false }) };
      }
    }
    const ball = (a: string, b: string, anchorA: Vec3, anchorB: Vec3): JsonObject => ({ kind: 'ball', a, b, frame_a: { anchor: anchorA }, frame_b: { anchor: anchorB }, collide_connected: true });
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i > 0) joints[`v${i}_${j}`] = ball(id(i - 1, j), id(i, j), [0, -shift / 2, 0], [0, shift / 2, 0]);
        if (j > 0) joints[`h${i}_${j}`] = ball(id(i, j - 1), id(i, j), [shift / 2, 0, 0], [-shift / 2, 0, 0]);
      }
    }
    const w = upstreamWorld({
      capacity: { bodies: 1024, shapes: 1024, joints: 2048, contacts: 8192, particles: 0 },
      contact_materials: { m: upstreamMaterial() }, shapes: { ball: sphere(rad) }, bodies, joints,
    });
    none(sane(w, 4000, 500, 'joint_net'), 'the net stays sane');
  }, TIMEOUT);
});
