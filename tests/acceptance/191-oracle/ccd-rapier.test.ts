// Ported from the upstream physics engine's crates/rapier3d/tests/ccd_default_vs_fixed.rs (default_ccd_vs_fixed_no_tunnel
// and bullet_still_hits_dynamic), at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (Apache-2.0; Copyright the upstream
// project's authors). No upstream code is copied: each setup is our physics.world@1 document, read from our bake. The
// planted wrapper that turns swept collision off for the whole world (upstream's global_ccd_off_tunnels setting) while
// the world declares `solver.ccd: true` must be rejected by both.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, box, caught, none, physics, prebuild, statesOf, upstreamWorld, type JsonObject, type Runner,
} from './helpers.ts';

prebuild(['shipped']);

/** No gravity, 60 Hz, `solver.ccd: true`: a 0.2 m cube at x −3 moving at 200 m/s along +x, and `target` beside it. */
function fastWorld(ccd: boolean, target: JsonObject, targetShape: JsonObject): JsonObject {
  return upstreamWorld({
    gravity: [0, 0, 0],
    solver: { ccd: true },
    shapes: { cube: box([0.1, 0.1, 0.1]), target: targetShape },
    bodies: {
      cube: { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'm' }], pose: { pos: [-3, 0, 0] }, velocity: { linear: [200, 0, 0] }, ccd },
      target,
    },
  });
}
/** A thin fixed wall at the origin spanning the y–z plane. */
const wallWorld = (): JsonObject => fastWorld(false, { kind: 'static', shapes: [{ shape: 'target', contact_material: 'm' }], pose: { pos: [0, 0, 0] } }, box([0.05, 5, 5]));
/** A stationary dynamic 0.4 m cube at the origin, and the cube a bullet (`ccd: true`). */
const bulletWorld = (): JsonObject => fastWorld(true, { kind: 'dynamic', shapes: [{ shape: 'target', contact_material: 'm' }], pose: { pos: [0, 0, 0] } }, box([0.2, 0.2, 0.2]));

/** Upstream's assertions on our bakes. */
function ccdFailures(r: Runner): string[] {
  const [wall, bullet] = physics([
    { call: 'bake', world: wallWorld(), steps: 120, read: ['cube'] },
    { call: 'bake', world: bulletWorld(), steps: 60, read: ['cube', 'target'] },
  ], r);
  const out: string[] = [];
  const x = statesOf(wall!, 'cube', 'the cube toward the wall').at(-1)!.pos[0];
  if (!(x < 0)) out.push(`default_ccd_vs_fixed_no_tunnel: the cube tunneled through the fixed wall (x = ${x})`);
  const b = statesOf(bullet!, 'cube', 'the bullet').at(-1)!.pos[0];
  const t = statesOf(bullet!, 'target', 'the target').at(-1)!.pos[0];
  if (!(t > 0.05)) out.push(`bullet_still_hits_dynamic: the bullet didn't hit the dynamic target (target.x = ${t})`);
  if (!(b < t)) out.push(`bullet_still_hits_dynamic: the bullet passed through its target (bullet.x = ${b}, target.x = ${t})`);
  return out;
}

describe(`${AC[11]} upstream ccd_default_vs_fixed.rs, run on deep-physics`, () => {
  test(`${AC[11]} default_ccd_vs_fixed_no_tunnel and bullet_still_hits_dynamic hold, and the wrapper with swept collision off is rejected`, () => {
    none(ccdFailures({}), 'rapier3d');
    const planted = ccdFailures({ planted: 'swept_collision_off' });
    caught(planted, 'the planted wrapper that turns swept collision off for the world');
    expect(planted.some((f) => f.startsWith('default_ccd_vs_fixed_no_tunnel')), `the wall case is rejected: ${planted.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
