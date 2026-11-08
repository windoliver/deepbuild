// #465.72006fae: "A light outside the frame by more than its halo's radius draws no flare; one entering the frame fades
// in by the visible share of its disc, never changing by more than 5% of its energy between adjacent frames at 60 fps"
//
// The fixture (480 × 270, fov 60° across the width): a black room, the camera at z = 1 looking down −Z, and the light
// `key-light` (radius 0.05 m, radiance 50; its disc about 20.8 px in radius) at depth 1 m on the frame's horizontal
// midline, entering from the left: its projected point moves from 64 px left of the frame's left edge to 56 px inside,
// 1 px a frame at 60 fps (frames 0 to 120). The flare: `ghosts: 4, halo: 0.05, streak: {count: 4, length: 0.1}`.
//
// Readings (README): the halo's radius is `halo` × the frame's width, 24 px, as `streak.length` is a share of it (the
// issue's 0.25 → 480 px at 1920). A light is "outside by more than its halo's radius" when its disc's nearest point lies
// beyond the edge by more than that: its projected point more than 24 + 1.5 × 20.8 px out (1.5 allows the disc's
// stretch off the axis); frames 0 to 8. "Its energy" is the flare's summed linear energy: `pre_tone`'s luminance with
// the flare less without it, summed over the frame, and "its" full energy is the last frame's, the disc wholly inside.
// Held: frames 0 to 8 draw no flare (no pixel of the difference above 1e-6 of the full frame's brightest); between any
// two adjacent frames the energy changes by at most 5% of the full energy; and while the light enters, the energy never
// falls (by more than 1% of the full energy between adjacent frames), so it fades in. That the fade is the visible share
// itself is held by the occlusion criterion's measure (#465.c54ce6c3), where the frame cuts none of the flare: at the
// edge the frame also cuts the flare's own halo, streaks and ghosts, so the energy there isn't the share times a
// constant for any flare (README: Readings). Wrong programs: a flare drawn for every light in view of the frustum's
// bounds, a flare that pops in at full strength when the light's centre crosses the edge, one that culls by the centre.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DARK_SKY, type JsonObject, camItem, channel, discPx, energy, flare, frameAt, framesOf, look3d, minus, none, pointLight, readLum,
  requireGpu, runGpu, sceneDoc, unproject, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const CAM: Cam = { position: [0, 0, 1], target: [0, 0, 0], fov: 60, size: SIZE };
const LOOK = look3d('edge-465');
const DISC = discPx(CAM, 1);
const HALO = 0.05; const HALO_PX = HALO * SIZE[0];
const FRAMES = 121; const START = -64;
const xAt = (n: number): number => START + n;
const maxAbs = (y: Float64Array): number => y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const [X0] = unproject(CAM, START, SIZE[1] / 2, 1);
const [X1] = unproject(CAM, START + FRAMES - 1, SIZE[1] / 2, 1);

function room(withFlare: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: camItem(CAM), sky: DARK_SKY, 'key-light': pointLight([X0, 0, 0]) };
  if (withFlare) items['flare'] = flare({ ghosts: 4, halo: HALO, streak: { count: 4, length: 0.1, anamorphic: false } });
  return sceneDoc(`edge-${withFlare ? 'flare' : 'plain'}`, SIZE, items, { channels: { enter: channel('items/key-light/at/pos/0', [[0, X0], [2, X1]]) } });
}

describe(`${AC[6]} a light entering the frame`, () => {
  it(`${AC[6]} beyond its halo's radius outside the frame the light draws no flare, and entering it fades in, never changing by more than 5% of its energy between adjacent frames at 60 fps`, () => {
    requireGpu();
    const dir = out();
    const call = (doc: JsonObject): JsonObject => view3d({ doc: writeJson(dir, String(doc['id']), doc), look: LOOK, size: SIZE, frames: FRAMES, fps: 60, capture: 'every', targets: ['pre_tone'] });
    const [withFlare, without] = runGpu(bin(), dir, [call(room(true)), call(room(false))]);
    const a = framesOf(withFlare!, 'with the flare'); const b = framesOf(without!, 'without it');
    const flares = Array.from({ length: FRAMES }, (_, n) => minus(readLum(dir, frameAt(a, n, 'with'), 'pre_tone', SIZE, `frame ${n}`), readLum(dir, frameAt(b, n, 'without'), 'pre_tone', SIZE, `frame ${n}`)));
    const e = flares.map(energy);
    const full = e[FRAMES - 1]!;
    const peak = maxAbs(flares[FRAMES - 1]!.y);
    console.log(`${AC[6]}: energy by frame (share of the full energy ${full.toExponential(3)}): ${e.map((v) => (v / full).toFixed(3)).join(' ')}`);
    expect(full, 'the light wholly inside draws a flare').toBeGreaterThan(0);
    const failures: string[] = [];
    for (let n = 0; n < FRAMES; n++) {
      if (xAt(n) < -(HALO_PX + 1.5 * DISC)) {
        const most = maxAbs(flares[n]!.y);
        if (most > 1e-6 * peak) failures.push(`frame ${n}: the light is ${(-xAt(n)).toFixed(0)} px outside the frame, beyond its halo's radius, yet its flare draws (up to ${most.toExponential(3)})`);
      }
      if (n === 0) continue;
      const step = (e[n]! - e[n - 1]!) / full;
      if (Math.abs(step) > 0.05) failures.push(`frames ${n - 1} → ${n}: the flare's energy changes by ${(step * 100).toFixed(2)}% of its energy, more than 5%`);
      if (step < -0.01) failures.push(`frames ${n - 1} → ${n}: the flare's energy falls by ${(-step * 100).toFixed(2)}% while its light enters the frame`);
    }
    none(failures, 'the flare entering the frame');
  });
});
