// #166.f353deab: "With absorption depth 3 m, seen from straight above, the bed's transmitted share matches exp(−d ÷ 3 m)
// within 2% at depths of 0.2, 1 and 5 m"
//
// The fixture (400 × 400): a black sky, no light; the camera 6 m straight above the origin (fov 20°); a still lake plate
// (STILL: one wave of amplitude 0, no ripples, no rain) 30 m × 30 m at y = 0 whose material carries `water: {...STILL,
// distort: 0, absorption: {depth: 3}}` and names its own mirror at strength 0, so no reflection is mixed in; under it an
// unlit bed, a 30 m × 0.2 m × 30 m box whose top a channel holds at 0.2 m below the water at 0 s, 1 m at 1 s and 5 m at
// 2 s (frames 0, 30 and 60 at 30 fps).
//
// "The bed's transmitted share" is read so that the absorption color, whatever light it takes, cancels: the bed drawn
// white and drawn black, under the water (w) and with no water at all (o), each frame's linear `pre_tone` luminance
// averaged over the 41 × 41 pixels at the frame's centre (all within 1° of straight down, where the ray's distance to
// the bed is d within 0.02%): share = (w_white − w_black) ÷ (o_white − o_black). It must be within 2% of exp(−d ÷ 3)
// (0.9355, 0.7165, 0.1889), 2% of that share. Wrong programs: a tint by a linear ramp or by exp(−d ÷ depth) of the
// depth from the camera, a share that ignores the bed, a bed share taken from the depth target's raw (nonlinear) value.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DARK_SKY, type JsonObject, STILL, camItem, channel, frameAt, framesOf, look3d, lumAt, material, plate, readFloats, requireGpu, runGpu,
  sceneDoc, useGpu, useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [400, 400];
const CAM: Cam = { position: [0, 6, 0], target: [0, 0, 0], fov: 20, size: SIZE };
const LOOK = look3d('tint-166');
const DEPTHS: [number, number][] = [[0.2, 0], [1, 30], [5, 60]];

function pool(water: boolean, bed: [number, number, number]): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camItem(CAM), sky: DARK_SKY,
    'bed-paint': material({ base_color: [...bed, 1], unlit: true }),
    bed: { kind: 'mark.box@1', params: { size: [30, 0.2, 30] }, at: { pos: [0, -0.3, 0] }, material: 'bed-paint' },
  };
  if (water) {
    items['lake-water'] = waterMaterial({ ...STILL, distort: 0, absorption: { depth: 3 } }, { mirror: { strength: 0, blur: 0, plane: 'lake' } });
    items['lake'] = plate([30, 30], [8, 8], [0, 0, 0], 'lake-water');
  }
  // The bed's top at y = −d: its centre 0.1 m lower.
  return sceneDoc(`pool-${water ? 'water' : 'open'}-${bed[0]}`, SIZE, items, { channels: { sink: channel('items/bed/at/pos/1', DEPTHS.map(([d], k): [number, number] => [k, -d - 0.1])) } });
}

describe(`${AC[4]} depth tints: the bed's share falls as exp(−d ÷ depth)`, () => {
  it(`${AC[4]} with absorption depth 3 m, seen from straight above, the bed's share is exp(−d ÷ 3 m) within 2% at 0.2, 1 and 5 m`, () => {
    requireGpu();
    const dir = out();
    const sides: [boolean, [number, number, number]][] = [[true, [1, 1, 1]], [true, [0, 0, 0]], [false, [1, 1, 1]], [false, [0, 0, 0]]];
    const replies = runGpu(bin(), dir, sides.map(([w, b], k) => view3d({
      doc: writeJson(dir, `side-${k}`, pool(w, b)), look: LOOK, size: SIZE, frames: 61, fps: 30, capture: DEPTHS.map(([, n]) => n), targets: ['pre_tone'],
    })));
    const centre = (r: JsonObject, n: number, what: string): number => {
      const t = readFloats(dir, frameAt(framesOf(r, what), n, what), 'pre_tone', SIZE, `${what}, frame ${n}`);
      let s = 0;
      for (let y = 180; y <= 220; y++) for (let x = 180; x <= 220; x++) s += lumAt(t, x, y);
      return s / (41 * 41);
    };
    const failures: string[] = [];
    for (const [d, n] of DEPTHS) {
      const [ww, wb, ow, ob] = replies.map((r, k) => centre(r, n, `side ${k} (${sides[k]![0] ? 'water' : 'open'}, bed ${sides[k]![1][0]})`));
      const share = (ww! - wb!) / (ow! - ob!);
      const want = Math.exp(-d / 3);
      console.log(`${AC[4]}: at ${d} m the bed's share is ${share.toFixed(5)}, exp(−d ÷ 3) is ${want.toFixed(5)} (open white ${ow!.toFixed(4)}, black ${ob!.toFixed(4)})`);
      expect(ow! - ob!, `at ${d} m the open bed draws white brighter than black`).toBeGreaterThan(0.1);
      if (!(Math.abs(share - want) <= 0.02 * want)) failures.push(`at ${d} m the bed's transmitted share is ${share.toFixed(5)}, not exp(−${d} ÷ 3) = ${want.toFixed(5)} within 2%`);
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });
});
