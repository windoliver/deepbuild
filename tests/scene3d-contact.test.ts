// Contact shadows (#446; Light policy: soft shadows): a short march toward the key light finds what touches a surface,
// and nothing else. The false shadow this holds off: a ray that passes behind a post as the camera sees it isn't blocked
// by it, though the post stands in front of the ray on screen.
//
// A post and a low step on a floor, under one sun, each scene drawn with and without `contact`. A hit fades along
// the march, so a floor pixel d from the post's foot keeps at least d ÷ length of its light, less one step, and past the
// length all of it but that step: contact never moves a shadow's edge. The step is too low for the map's texels to catch (one cascade out to 400 m), so its
// shadow reaches the picture through contact alone: the floor just past it on the side away from the sun, which the camera sees, darkens by at
// least half its direct light on at least 100 pixels. A march that keeps a surface up to the whole length in front of
// the ray fails the first check, naming the moved edge; no march at all fails the second.
import { describe, expect, it } from 'vitest';
import {
  DARK_SKY, box, camera, matte, none, only, rayAt, readLinear, requireMetal, runGpu, sessionDoc, sun, useDir, useGpu, view3dCall, writeJson,
  type JsonObject, type Linear, type Pinhole, type V3,
} from './acceptance/446/helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [640, 400];
const CAM: Pinhole = { position: [1.2, 0.7, 1.6], target: [0, 0.05, 0], fov: 30, size: SIZE };
/** The post's sun stands behind the camera; the step's on its left, so the step's shadow falls where the camera sees it. */
const ROT: V3 = [-35, 50, 0];
const LENGTH = 0.3;
const SAMPLES = 16;
const STEP_ROT: V3 = [-35, -50, 0];
const POST = { size: [0.1, 0.4, 0.1] as V3, pos: [0.5, 0.2, -0.3] as V3 };
const STEP = { size: [0.6, 0.03, 0.6] as V3, pos: [0, 0.015, 0] as V3 };

function scene(id: string, shadowFar: number, item: { size: V3; pos: V3 }, rot: V3, contact: boolean): JsonObject {
  const grey = { material: 'grey' };
  return sessionDoc(id, SIZE, {
    cam: camera(CAM.position, CAM.target, CAM.fov, { near: 0.05, far: 60 }), sky: DARK_SKY, grey: matte(0.8),
    floor: box([40, 0.1, 40], [0, -0.05, 0], grey), thing: box(item.size, item.pos, grey),
    sun: sun(Math.PI, rot, { shadow: true, cascades: 1, shadow_far: shadowFar }),
  }, { light_policy: contact ? { contact: { length: LENGTH, samples: SAMPLES } } : {} });
}
function pair(name: string, shadowFar: number, item: { size: V3; pos: V3 }, rot: V3): [Linear, Linear] {
  const out = dir();
  const replies = [false, true].map((c) => view3dCall({ doc: writeJson(out, `${name}-${c}`, scene(`${name}-${c}`, shadowFar, item, rot, c)), size: SIZE, targets: ['linear'] }));
  const [off, on] = runGpu(bin(), out, replies);
  return [readLinear(out, only(off!, `${name} without contact`), SIZE, name), readLinear(out, only(on!, `${name} with contact`), SIZE, name)];
}
/** Where pixel (x, y) meets the floor, or null above the horizon. */
function onFloor(x: number, y: number): V3 | null {
  const d = rayAt(CAM, x + 0.5, y + 0.5);
  if (d[1] >= -1e-6) return null;
  const t = -CAM.position[1] / d[1];
  return [CAM.position[0] + t * d[0], 0, CAM.position[2] + t * d[2]];
}
/** How far a floor point lies outside the footprint of `item`. */
function offFoot(p: V3, item: { size: V3; pos: V3 }): number {
  const dx = Math.max(Math.abs(p[0] - item.pos[0]) - item.size[0] / 2, 0);
  const dz = Math.max(Math.abs(p[2] - item.pos[2]) - item.size[2] / 2, 0);
  return Math.hypot(dx, dz);
}

describe('#446 contact shadows', () => {
  it('finds what touches a surface and never moves a shadow\'s edge', () => {
    requireMetal();
    const moved: string[] = [];
    const [off, on] = pair('post', 30, POST, ROT);
    // A shadowed pixel reads nothing, under the black sky.
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      const p = onFloor(x, y);
      if (!p || off.at(x, y) < 0.05 || offFoot(p, POST) <= 0.06) continue;
      const keeps = Math.min(offFoot(p, POST) / LENGTH, 1) - 1 / SAMPLES;
      if (on.at(x, y) < keeps * off.at(x, y)) moved.push(`contact darkens lit floor at (${x}, ${y}), ${offFoot(p, POST).toFixed(3)} m from the post: ${off.at(x, y).toFixed(3)} to ${on.at(x, y).toFixed(3)}`);
    }
    none(moved, 'the edge of the post\'s shadow');

    const [stepOff, stepOn] = pair('step', 400, STEP, STEP_ROT);
    let found = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      const p = onFloor(x, y);
      if (!p || offFoot(p, STEP) === 0 || offFoot(p, STEP) > 0.08) continue;
      if (stepOff.at(x, y) > 0.05 && stepOn.at(x, y) < 0.5 * stepOff.at(x, y)) found++;
    }
    expect(found, 'contact alone shows the low step\'s shadow on at least 100 pixels').toBeGreaterThanOrEqual(100);
  }, 900_000);
});
