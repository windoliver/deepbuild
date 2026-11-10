// The #2010 Oracle lane's tools: the #2010 suite's surface (`deep-physics` with step hashes, checkpoints and restores,
// ../2010/helpers.ts), reused as it stands so both lanes ask the same program the same way, and the upstream tests'
// world as the #2009 Oracle lane writes it (Rapier's defaults as our fields: 60 Hz, 4 solver iterations, a collider's
// friction 0.5 and density 1), plus the scenes the ported tests build.
import { box, sphere, type JsonObject } from '../2010/helpers.ts';
import { UPSTREAM_RATE, upstreamMaterial, upstreamWorld } from '../2009-oracle/helpers.ts';

export * from '../2010/helpers.ts';
export { UPSTREAM_RATE, upstreamMaterial, upstreamWorld };

/** Enough room for upstream's piles (205 bodies at most here) under our world's required capacity. */
export const CAPACITY = { bodies: 512, shapes: 512, joints: 64, contacts: 16384, particles: 0 };
/** Rapier's default coefficient combine rule is Average, for friction and restitution alike. */
export const AVERAGE = { friction: 'average', restitution: 'average' };

const stat = (shape: string, pos: number[], extra: JsonObject = {}): JsonObject => ({ kind: 'static', shapes: [{ shape, contact_material: 'plain', ...extra }], pose: { pos } });
const dyn = (shape: string, pos: number[], extra: JsonObject = {}): JsonObject => ({ kind: 'dynamic', shapes: [{ shape, contact_material: 'plain' }], pose: { pos }, ...extra });

/**
 * snapshot_roundtrip's `pile(sleepy)`: a 20 × 0.5 × 20 ground with its top at y 0, 8 × 3 × 8 unit boxes on a 1.05 m
 * pitch with a small jitter, sleep as `sleepy` says; when sleepy, four balls of r 0.4 that never sleep rolling in at
 * 4 m/s so the scene isn't simply frozen.
 */
export function pile(sleepy: boolean): { shapes: JsonObject; bodies: JsonObject } {
  const bodies: JsonObject = { ground: stat('ground', [0, -0.5, 0]) };
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 8; k++) {
    const jitter = (i * 0.013 + k * 0.017) % 0.05;
    bodies[`box_${i}_${j}_${k}`] = dyn('cube', [i * 1.05 - 4 + jitter, j * 1.05 + 0.55, k * 1.05 - 4 - jitter], { sleep: sleepy });
  }
  if (sleepy) for (let i = 0; i < 4; i++) bodies[`roller_${i}`] = dyn('roller', [-9 + i * 0.7, 3.4, -3 + i], { sleep: false, velocity: { linear: [4, 0, 0.3 * i] } });
  return { shapes: { ground: box([20, 0.5, 20]), cube: box([0.5, 0.5, 0.5]), roller: sphere(0.4) }, bodies };
}
/** snapshot_roundtrip's `with_joints_and_sensor`: a chain of four r 0.25 balls on ball joints from a fixed point at y 7, and a sensor box it swings through. */
export function withJointsAndSensor(scene: { shapes: JsonObject; bodies: JsonObject }): { shapes: JsonObject; bodies: JsonObject; joints: JsonObject } {
  const shapes = { ...scene.shapes, link: sphere(0.25), sensor_box: box([3, 0.5, 3]) };
  const bodies: JsonObject = { ...scene.bodies, sensor: stat('sensor_box', [0, 4, 0], { sensor: true }) };
  const joints: JsonObject = {};
  for (let i = 0; i < 4; i++) {
    bodies[`link_${i}`] = dyn('link', [0.6 * (i + 1), 7, 0], { sleep: false });
    joints[`joint_${i}`] = {
      kind: 'ball', collide_connected: true,
      a: i === 0 ? 'world' : `link_${i - 1}`, frame_a: { anchor: i === 0 ? [0.3, 7, 0] : [0.3, 0, 0] },
      b: `link_${i}`, frame_b: { anchor: [-0.3, 0, 0] },
    };
  }
  return { shapes, bodies, joints };
}
/** snapshot_roundtrip's `ccd_bodies` additions: eight r 0.15 balls with CCD on, thrown at (90, −45, 3i) m/s. */
export function withCcdBalls(scene: { shapes: JsonObject; bodies: JsonObject }): { shapes: JsonObject; bodies: JsonObject } {
  const bodies: JsonObject = { ...scene.bodies };
  for (let i = 0; i < 8; i++) bodies[`bullet_${i}`] = dyn('bullet', [-6 + i * 1.5, 4 + i * 0.3, 0], { ccd: true, sleep: false, velocity: { linear: [90, -45, 3 * i] } });
  return { shapes: { ...scene.shapes, bullet: sphere(0.15) }, bodies };
}
/** A scene as our world document under upstream's defaults, its checkpoint ring's budget (1 GiB) wide enough that the spacing never doubles. */
export function upstreamScene(parts: JsonObject, checkpointEvery: number): JsonObject {
  return upstreamWorld({ capacity: CAPACITY, combine: AVERAGE, contact_materials: { plain: upstreamMaterial() }, checkpoint: { every: checkpointEvery, budget: 1 << 30 }, ...parts });
}
