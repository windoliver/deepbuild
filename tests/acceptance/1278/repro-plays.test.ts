// AC1 #1278.09e67199: In that repro, every frame's `pixel_hash` is the same in all four plays.
//
// The issue's repro, built as it states it: a 97-frame `view3d` play at 320 × 240 and 32 fps of a material box (0.9 m,
// roughness 0.3) drawn before a material ball (`ball@1`, radius 1, 64 segments, roughness 0.3) partly behind it, under
// one `light.sun@1` and 30 point lights; the camera orbits the ball 90° while it pulls back from 5 m to 25 m over 3 s
// (linear keys at 0 s and 3 s, so frame 96 is t = 3 s). The lights (a 0.6 lx sun, 30 lamps of 6 lm on rings 3 to 4.5 m
// out) keep the picture inside 8 bits under the plain look, so a pixel that moves by a code value can show it (a
// clipped white picture can't); there is no `sky@1` (README: Notes on the base). The box is a `mark.box@1`, which draws before a `ball@1`
// builder mesh (the opaque batches are ordered by shape, box before built), so it is the earlier draw. Four plays of
// that view are four `view3d` calls in one `deep-gpu run` process, with no `capture`; each frame reports its
// `pixel_hash` (#378: SHA-256 of the frame's bytes) all the same. Every frame of every play must report one, and each
// frame's four hashes must be equal; the failure lists every frame whose hashes differ, with the four hashes.
// A second test checks the fixture is the repro: in a separate process, frames 0, 48 and 96 captured with the
// object-ID target show the box and the ball, with ball pixels beside box pixels (the box covers part of the ball, an
// occlusion edge the ball draws behind).
// Wrong programs: the base (the lobe's widening reads dpdx/dpdy of the shading normal across a 2 × 2 quad whose lanes
// an earlier draw may cull or not by GPU timing, so 9 to 11 frames flip by a code value in some play, as the issue
// measured); any fix that leaves a derivative of a shader-computed value at an occlusion edge.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN_LOOK, framesOf, frameAt, material, readIds, requireMetal, runGpu, sessionDoc, sun, useDir, useGpu, view3dCall, writeJson,
  type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [320, 240];
const FPS = 32;
const FRAMES = 97;
const PLAYS = 4;

/** The issue's repro document. */
function reproDoc(): JsonObject {
  const lights: Record<string, JsonObject> = {};
  for (let i = 0; i < 30; i++) {
    const a = (2 * Math.PI * i) / 30;
    const r = 3 + (i % 3) * 0.75;
    lights[`lamp${String(i).padStart(2, '0')}`] = {
      kind: 'light.point@1', params: { power: 6, color: [1, 1, 1] },
      at: { pos: [Number((r * Math.sin(a)).toFixed(4)), 1 + (i % 5) * 0.5, Number((r * Math.cos(a)).toFixed(4))] },
    };
  }
  // The box sits between the ball and the orbit's middle (azimuth 45°), turned to face the ball, so from every
  // azimuth of the orbit (0° to 90°) it covers part of the ball.
  const d = 1.6; const az = Math.PI / 4;
  return sessionDoc('repro-1278', SIZE, {
    cam: {
      kind: 'camera@1',
      params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 15, distance: 5 }, fov: 40, near: 0.1, far: 200 },
    },
    boxmat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 0.3 }),
    ballmat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 0.3 }),
    box: {
      kind: 'mark.box@1', params: { size: [0.9, 0.9, 0.9] },
      at: { pos: [Number((d * Math.sin(az)).toFixed(4)), 0.2, Number((d * Math.cos(az)).toFixed(4))], rot: [0, 45, 0] }, material: 'boxmat',
    },
    ball: { kind: 'ball@1', params: { radius: 1, segments: 64 }, at: { pos: [0, 0, 0] }, material: 'ballmat' },
    sun: sun(0.6, [-50, 30, 0]),
    ...lights,
  }, {
    channels: {
      orbit: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '3s', value: 90, interp: 'linear' } } },
      pull: { target: 'items/cam/params/orbit/distance', type: 'f32', keys: { k0: { t: '0s', value: 5, interp: 'linear' }, k1: { t: '3s', value: 25, interp: 'linear' } } },
    },
  });
}
const play = (doc: string): JsonObject => view3dCall({ doc, look: PLAIN_LOOK, size: SIZE, frames: FRAMES, fps: FPS });

describe(`${AC[1]} the repro's four plays in one process give the same pixel_hash at every frame`, () => {
  it(`${AC[1]} four plays of the 97-frame view in one deep-gpu run process, no capture: each frame's pixel_hash is the same in all four`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'repro', reproDoc());
    const replies = runGpu(bin(), out, Array.from({ length: PLAYS }, () => play(doc)));
    const hashes = replies.map((r, p) => {
      const frames = framesOf(r, `play ${p + 1}`);
      expect(frames.length, `play ${p + 1}: ${FRAMES} frames`).toBe(FRAMES);
      return Array.from({ length: FRAMES }, (_, n) => {
        const h = frameAt(frames, n, `play ${p + 1}`).pixel_hash;
        expect(h, `play ${p + 1}, frame ${n}: a pixel_hash`).toMatch(/^[0-9a-f]{64}$/);
        return h!;
      });
    });
    const differ: string[] = [];
    for (let n = 0; n < FRAMES; n++) {
      const at = hashes.map((h) => h[n]!);
      if (new Set(at).size > 1) differ.push(`frame ${n} (t = ${(n / FPS).toFixed(5)} s): ${at.map((h, p) => `play ${p + 1} ${h.slice(0, 12)}`).join(', ')}`);
    }
    console.log(`${AC[1]}: ${differ.length} of ${FRAMES} frames differ across ${PLAYS} plays${differ.length ? `:\n  ${differ.join('\n  ')}` : ''}`);
    expect(differ, `every frame's pixel_hash is the same in all ${PLAYS} plays; ${differ.length} of ${FRAMES} frames differ:\n  ${differ.join('\n  ')}`).toEqual([]);
  }, 1_800_000);

  it(`${AC[1]} the fixture is the repro: at frames 0, 48 and 96 the box covers part of the ball`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'repro', reproDoc());
    const [reply] = runGpu(bin(), out, [view3dCall({ doc, look: PLAIN_LOOK, size: SIZE, frames: FRAMES, fps: FPS, capture: [0, 48, 96], targets: ['ids'] })]);
    const frames = framesOf(reply!, 'the repro with ids');
    const problems: string[] = [];
    for (const n of [0, 48, 96]) {
      const ids = readIds(out, frameAt(frames, n, 'the repro with ids'), `frame ${n}: ids`);
      const ball = ids.count.get('ball') ?? 0; const box = ids.count.get('box') ?? 0;
      let edge = 0;
      for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) {
        if (ids.at(x, y) === 'ball' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ids.at(x + dx!, y + dy!) === 'box')) edge++;
      }
      console.log(`${AC[1]}: frame ${n}: ball ${ball} px, box ${box} px, ${edge} ball px beside the box`);
      if (ball < 200 || box < 100) problems.push(`frame ${n}: the ball (${ball} px) and the box (${box} px) are both in view`);
      if (edge < 10) problems.push(`frame ${n}: only ${edge} ball pixels lie beside box pixels; the box should cover part of the ball`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  }, 1_800_000);
});
