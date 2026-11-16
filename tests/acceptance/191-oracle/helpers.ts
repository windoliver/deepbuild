// The #191 Oracle lane's tools: the #191 suite's surface (`deep-physics`, its test backends and planted names, its world
// documents and readers), reused as it stands so both lanes ask the same program the same way, plus the upstream tests'
// world: the upstream physics engine's defaults that the pinned tests leave as they are (README: Upstream's world as ours).
import { expect } from 'vitest';
import { arr, num, obj, show, world, type JsonObject } from '../191/helpers.ts';

export * from '../191/helpers.ts';

/** Upstream's default step (1/60 s) and solver iterations (4, our substeps). */
export const UPSTREAM_RATE = 60;
/** A collider's upstream defaults as a contact material: friction 0.5, density 1 kg/m³, restitution 0. */
export const upstreamMaterial = (extra: JsonObject = {}): JsonObject => ({ friction: 0.5, restitution: 0, density: 1, ...extra });
export function upstreamWorld(parts: JsonObject): JsonObject {
  return world({ step_rate: UPSTREAM_RATE, substeps: 4, contact_materials: { m: upstreamMaterial() }, ...parts });
}
/** An accepted bake's rotations of body `id` ([x, y, z, w]), one per step from the built state at index 0. */
export function rotsOf(reply: JsonObject, id: string, what: string): number[][] {
  expect(reply['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  return arr(obj(reply['bodies'], `${what}: bodies`)[id], `${what}: bodies.${id}`)
    .map((s, j) => arr(obj(s, `${what}: bodies.${id}[${j}]`)['rot'], `${what}: rot`).map((x, i) => num(x, `${what}: rot[${i}]`)));
}
/** Signed angle about +z of a unit quaternion [x, y, z, w], degrees, in (−180, 180]. */
export const zAngle = (rot: number[]): number => (2 * Math.atan2(rot[2]!, rot[3]!) * 180) / Math.PI;
/** Unwraps a series of angles in (−180, 180] into one that keeps counting past ±180, as upstream does. */
export function unwrap(angles: number[]): number[] {
  let total = 0;
  let prev = 0;
  return angles.map((a) => {
    let d = a - prev;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    total += d;
    prev = a;
    return total;
  });
}
