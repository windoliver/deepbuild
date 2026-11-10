// Ported from rapier (dimforge, Apache-2.0) at 3406750a38286a0d3c7d0f4be2f9d53153e81d90: the free-fall formula of
// crates/rapier3d/tests/soft_bodies.rs (fem_free_fall_is_exact) and crates/rapier3d/tests/total_contact_impulse.rs
// (resting_impulse_matches_gravity_for_any_warmstart_coefficient), each re-expressed as our world document and run
// against deep-physics's bake (#136). Criterion 2: free fall and rest on the ground match the discrete solution.
import { describe, expect, it } from 'vitest';
import { AC, G, TIMEOUT, UPSTREAM_RATE, bake, box, none, physics, prebuild, sphere, statesOf, upstreamMaterial, upstreamWorld, type JsonObject } from './helpers.ts';

prebuild();

describe(`${AC[2]} rapier soft_bodies.rs (free-fall formula) and total_contact_impulse.rs, run on deep-physics`, () => {
  it(`${AC[2]} fem_free_fall_is_exact's formula: over 60 one-substep steps a body drops g·dt²·n(n+1)/2 within 1e-4 of it`, () => {
    // Upstream: num_solver_iterations = 1 (our substeps 1), 60 steps of dt = 1/60 s from y = 10; a rigid body stands in
    // for the soft body's particle (our build leaves Rapier's fem feature off), so only the formula is ported.
    const steps = 60; const dt = 1 / UPSTREAM_RATE;
    const w = upstreamWorld({
      substeps: 1,
      contact_materials: { m: upstreamMaterial() },
      shapes: { ball: sphere(0.1) },
      bodies: { ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: [0, 10, 0] }, mass: 1, sleep: false } },
    });
    const [reply] = physics([bake(w, steps, { read: ['ball'] })]);
    const s = statesOf(reply!, 'ball', steps + 1, 'free fall');
    const expected = -G * dt * dt * (steps * (steps + 1) / 2);
    const drop = s[steps]!.pos[1] - s[0]!.pos[1];
    expect(Math.abs(drop - expected), `free fall ${drop} vs expected ${expected}`).toBeLessThan(1.0e-4 * Math.abs(expected));
  }, TIMEOUT);

  it(`${AC[2]} resting_impulse_matches_gravity: a 1 kg ball or cube at rest on the ground, free or on a slider, reads a contact impulse of m·g·dt per step within 1%`, () => {
    // Upstream also varies IntegrationParameters::warmstart_coefficient (1, 0.5, 0); no world field names it (nor may
    // one: it is Rapier's), so each case runs once, at the backend's own setting. Its multibody case hangs the body on a
    // prismatic joint along y from a fixed anchor at y = 10; ours is a slider from the world at that point.
    const MASS = 1; const expected = MASS * G / UPSTREAM_RATE;
    const cases: { name: string; w: JsonObject }[] = [];
    for (const slider of [false, true]) {
      for (const cuboid of [false, true]) {
        cases.push({
          name: `${cuboid ? 'cuboid' : 'ball'}${slider ? ' on a slider' : ''}`,
          w: upstreamWorld({
            contact_materials: { m: upstreamMaterial() },
            shapes: { ground: box([10, 0.5, 10]), body: cuboid ? box([0.5, 0.5, 0.5]) : sphere(0.5) },
            bodies: {
              ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'm' }], pose: { pos: [0, -0.5, 0] } },
              body: { kind: 'dynamic', shapes: [{ shape: 'body', contact_material: 'm' }], pose: { pos: [0, 0.5, 0] }, mass: MASS, sleep: false },
            },
            ...(slider ? { joints: { rail: { kind: 'slider', a: 'world', b: 'body', frame_a: { anchor: [0, 10, 0], axis: [0, 1, 0] }, frame_b: { anchor: [0, 0, 0], axis: [0, 1, 0] } } } } : {}),
          }),
        });
      }
    }
    const steps = 300;
    const replies = physics(cases.map((c) => bake(c.w, steps, { read: ['body'] })));
    none(cases.flatMap((c, i) => {
      const impulse = statesOf(replies[i]!, 'body', steps + 1, c.name)[steps]!.contactImpulse;
      if (impulse === null) return [`${c.name}: the state carries no contact_impulse`];
      return Math.abs(impulse - expected) <= expected * 1.0e-2 ? [] : [`${c.name}: reported ${impulse}, expected ${expected}`];
    }), 'each resting contact impulse is m·g·dt within 1%');
  }, TIMEOUT);
});
