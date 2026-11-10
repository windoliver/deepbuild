// #268.7e7ee25a: "Water under a floating deck with `shade: 0.8` shows 0.2 of its unshaded radiance within 2% at 16
// sampled pixels, and water outside the deck's footprint is unchanged by pixel hash"
//
// The fixture (helpers.ts `deckDoc`): a still 20 m × 20 m plate whose material `deck-water` carries `shore: {items:
// "deck-shore", shade}`, and the deck `deck`, a 5 m × 0.2 m × 5 m box floating over the origin from 0.5 to 0.7 m above
// the water, the one member of `deck-shore`; a day sky and a sun. Drawn with `shade: 0.8` and with `shade: 0` (the
// unshaded water: the same scene, the deck's own shadow and reflection in both), in one process.
//
// Under the deck: a camera 0.4 m above the water at (0, 0.4, 7), below the deck's underside, looking toward the origin
// (fov 16° across 640 × 360), so its rays reach the water under the deck through the gap. 16 pixels whose centre ray meets
// the water at rest at least 0.5 m inside the footprint (x and z within ±2 m) are drawn with a seeded generator; at each,
// the linear `pre_tone` luminance with shade 0.8 over that with shade 0 must be within 2% of 0.2 (0.196 to 0.204, 2% of
// the expected value, the stricter reading).
// Outside: a camera 8 m straight above the origin (fov 50°, 320 × 320). The deck's top hides the water within 2.74 m of
// the origin along x and z (its footprint and 0.24 m past it); every water pixel this frame shows lies outside the
// footprint, and the frame with shade 0.8 has the pixel hash of the one with shade 0.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, Lcg, camItem, deckDoc, frameAt, framesOf, look3d, lumAt, none, onWater, readFloats, requireGpu, runGpu, useGpu, useOut, view3d,
  writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const LOOK = look3d('shade-268');
const UNDER: Cam = { position: [0, 0.4, 7], target: [0, 0, 0], fov: 16, size: [640, 360] };
const ABOVE: Cam = { position: [0, 8, 0], target: [0, 0, 0], fov: 50, size: [320, 320] };
const AT = 30;

describe(`${AC[3]} water under a floating deck darkens by its shade, and only there`, () => {
  it(`${AC[3]} under the deck with shade 0.8 the water shows 0.2 of its unshaded radiance within 2% at 16 pixels, and the water outside the footprint is unchanged by pixel hash`, () => {
    requireGpu();
    const dir = out();
    const call = (cam: Cam, shade: number, name: string) => view3d({
      doc: writeJson(dir, name, deckDoc(`deck-${name}`, cam.size, camItem(cam), shade)), look: LOOK, size: cam.size, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['pre_tone'],
    });
    const [under8, under0, above8, above0] = runGpu(bin(), dir, [call(UNDER, 0.8, 'under-8'), call(UNDER, 0, 'under-0'), call(ABOVE, 0.8, 'above-8'), call(ABOVE, 0, 'above-0')]);
    const pre = (r: typeof under8, what: string) => readFloats(dir, frameAt(framesOf(r!, what), AT, what), 'pre_tone', UNDER.size, what);
    const shaded = pre(under8, 'under the deck, shade 0.8'); const unshaded = pre(under0, 'under the deck, shade 0');

    const rng = new Lcg(268); const failures: string[] = []; let found = 0;
    for (let n = 0; n < 1_000_000 && found < 16; n++) {
      const i = Math.floor(rng.next() * UNDER.size[0]); const j = Math.floor(rng.next() * UNDER.size[1]);
      const p = onWater(UNDER, i, j);
      if (!p || Math.abs(p[0]) > 2 || Math.abs(p[1]) > 2) continue;
      found++;
      const a = lumAt(shaded, i, j); const b = lumAt(unshaded, i, j);
      expect(b, `pixel (${i}, ${j}) under the deck at (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) has unshaded radiance to compare`).toBeGreaterThan(1e-4);
      const share = a / b;
      if (!(Math.abs(share - 0.2) <= 0.02 * 0.2)) failures.push(`material deck-water: pixel (${i}, ${j}) under the deck at (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) shows ${share.toFixed(4)} of its unshaded radiance (${a.toFixed(5)} of ${b.toFixed(5)}), not 0.2 within 2%`);
    }
    expect(found, 'the seeded draw found 16 pixels of water under the deck').toBe(16);
    none(failures, 'the shade under the deck');
    expect(framesOf(above8!, 'from above, shade 0.8')[0]!.pixel_hash, 'the water outside the deck\'s footprint is unchanged by its shade, by pixel hash')
      .toBe(framesOf(above0!, 'from above, shade 0')[0]!.pixel_hash);
  });
});
