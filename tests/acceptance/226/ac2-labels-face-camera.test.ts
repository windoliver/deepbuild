// AC2 #226.1adcd447: "Every tick label faces the camera within 1° through a 360° orbit, and none reads mirrored at any of
// 36 sampled azimuths"
//
// The axes of criterion 1 (`ticks.labels` at its default, `camera`) under an orthographic orbit camera at 20° elevation
// whose azimuth is keyed from 0° at 0 s to 360° at 1 s; `view3d` draws 36 frames at 36 fps, so frame k sees azimuth
// 10k° (k = 0 … 35). Each frame's `axes` report (README: Assumed surfaces 2) gives every tick with its label's quad in
// world space, corners in reading order (bottom-left, bottom-right, top-right, top-left). For each label drawn
// (opacity > 0): its reading normal n = (BR − BL) × (TL − BL), and b, the unit vector from the camera's target toward
// its eye at that azimuth (camera.rs's orbit). Under an orthographic camera "faces the camera" is n parallel to b: the
// angle between the label's plane and the view plane, acos(|n̂ · b|), is at most 1°. It reads mirrored when n̂ · b < 0
// (its front faces away, so its text runs right to left on screen). Every axis shows at least three labels in every
// frame, so an axes drawing no labels can't pass.
// Wrong programs: the base (no axes3d@1, no `axes` report); labels fixed in the axes' planes (off by up to 90°);
// labels turned about +Y only (`upright`, off by the 20° elevation); labels that face +b on half the orbit and are
// drawn from behind on the other (mirrored); a billboard turned toward −b (every label mirrored).
import { describe, expect, it } from 'vitest';
import {
  AC, ORBIT, PLAIN, TIMEOUT, cross, dot, framesOf, length, orbitDoc, requireMetal, runGpu, sub, ticksOf, towardEye, unit, useBins, useOut, writeJson,
} from './helpers.ts';

const ID = AC[2];
const NAME = `AC2 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();

describe(`${NAME} tick labels face the camera through an orbit and never read mirrored`, () => {
  it(`${NAME} at each of 36 azimuths through a 360° orbit every tick label faces the camera within 1° and none reads mirrored`, () => {
    requireMetal();
    const dir = out();
    const doc = writeJson(dir, 'orbit', orbitDoc('orbit-226', [640, 360]));
    const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc, look: PLAIN, size: [640, 360], fps: ORBIT.fps, frames: ORBIT.frames, axes: true }]);
    const frames = framesOf(reply!, ORBIT.frames, 'the orbit');
    const facing: string[] = [];
    const mirrored: string[] = [];
    const few: string[] = [];
    let judged = 0;
    frames.forEach((f, k) => {
      const azimuth = 10 * k;
      const b = towardEye(azimuth, ORBIT.elevation);
      const ticks = ticksOf(f, 'axes', `frame ${k} (azimuth ${azimuth}°)`).filter((t) => t.opacity > 0);
      for (const axis of ['x', 'y', 'z'] as const) {
        const n = ticks.filter((t) => t.axis === axis && t.label !== null).length;
        if (n < 3) few.push(`azimuth ${azimuth}°: the ${axis} axis draws ${n} tick labels`);
      }
      for (const t of ticks) {
        if (t.label === null) continue;
        const [bl, br, , tl] = t.label.quad;
        const normal = cross(sub(br, bl), sub(tl, bl));
        const name = `azimuth ${azimuth}°: the ${t.axis} tick label "${t.label.text}" (${t.value})`;
        if (length(normal) === 0) { facing.push(`${name} has an empty quad`); continue; }
        judged++;
        const c = dot(unit(normal), b);
        const off = (Math.acos(Math.min(1, Math.abs(c))) * 180) / Math.PI;
        if (off > 1) facing.push(`${name} is ${off.toFixed(3)}° off facing the camera`);
        if (c < 0) mirrored.push(`${name} reads mirrored: its front faces away from the camera (n̂ · b = ${c.toFixed(4)})`);
      }
    });
    expect(few, 'every axis draws at least three tick labels at every azimuth').toEqual([]);
    expect(judged, 'labels were judged').toBeGreaterThanOrEqual(36 * 9);
    expect(facing, 'every tick label faces the camera within 1° at each of the 36 azimuths').toEqual([]);
    expect(mirrored, 'no tick label reads mirrored at any of the 36 azimuths').toEqual([]);
  }, TIMEOUT);
});
