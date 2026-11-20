// AC4 #971.0e27b835: Hue and chroma in OKLab at 64 sampled pixels of a coloured fixture differ from the same render
// without `local` by under 1° and 1% after the luminance change is divided out.
//
// The coloured patches (helpers.ts `patchesDoc`: eight hues at four saturations, a half 3 stops above middle grey and a
// half 3 stops below) are drawn under tone map none with no `local` and with `local: {strength: 0.5}`. One pixel is
// sampled in each of the 64 patches, at a seeded place, and read as the linear colour the tone curve reads there: with
// `local`, the target `pre_curve` (README: The surface under test); without it, #418's `pre_tone`, which at this look's
// exposure scale of 1 and its grade at identity is the same image. The luminance change is divided out by scaling the
// `local` render's linear colour by the ratio of the two Rec. 709 luminances; then both colours go to OKLab, where hue
// is the angle of (a, b) and chroma its length. The hue must differ by under 1° and the chroma by under 1% of the
// chroma without `local` (README: Readings).
//
// A program that leaves the frame alone keeps hue and chroma too, so the test first holds the frame to what `local`
// does here: its pixel hash is not the one drawn without `local`, and at every sampled pixel the luminance moved by
// more than 1 stop (the rule gives 1.5: a base 3 stops from middle grey times 1 − 0.5). At the base the look's `local`
// is read by nothing and the first of those fails.
import { describe, expect, it } from 'vitest';
import { Lcg, linearToOklab, luma, writeJson, type Lin } from '../418/helpers.ts';
import { AC, FULL, HALF, PATCH, TIMEOUT, drawn, frame, lookWith, none, patchColor, patchesDoc, readLinear, requireGpu, rgbAt, runGpu, useGpu, useOut, view3d } from './helpers.ts';

const bin = useGpu();
const out = useOut();

/** One pixel in each of the 64 patches, at a seeded place inside it. */
function samples(): { x: number; y: number; c: number; r: number }[] {
  const rng = new Lcg(971);
  const at: { x: number; y: number; c: number; r: number }[] = [];
  for (let r = 0; r < PATCH.rows; r++) for (let c = 0; c < PATCH.cols; c++)
    at.push({ x: c * PATCH.w + Math.floor(rng.next() * PATCH.w), y: r * PATCH.h + Math.floor(rng.next() * PATCH.h), c, r });
  return at;
}
const hueOf = (lab: Lin): number => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
const chromaOf = (lab: Lin): number => Math.hypot(lab[1], lab[2]);

describe(`${AC[4]} local keeps hue and chroma`, () => {
  it(`${AC[4]} at 64 sampled pixels of the coloured patches, with the luminance moved by local {strength: 0.5} divided out, OKLab hue differs by under 1° and chroma by under 1% from the render without local`, () => {
    requireGpu();
    const doc = writeJson(out(), 'patches.json', patchesDoc('patches-colour'));
    const [plainReply, hashReply, localReply] = runGpu(bin(), out(), [
      view3d({ doc, look: lookWith('none'), size: FULL, targets: ['pre_tone'], capture: [0] }),
      view3d({ doc, look: lookWith('none', HALF), size: FULL }),
      view3d({ doc, look: lookWith('none', HALF), size: FULL, targets: ['pre_curve'], capture: [0] }),
    ]);
    const at = samples();
    expect(at.length, 'the sampled pixels').toBe(64);

    // The fixture as drawn: each sampled pixel is its patch's colour.
    const asDrawn = frame(drawn(plainReply!, 'the patches without local'), 0, 'the patches without local');
    const plain = readLinear(out(), asDrawn, 'pre_tone', FULL, 'the patches without local');
    const wrong = at.flatMap((s) => {
      const want = patchColor(s.c, s.r); const got = rgbAt(plain, s.x, s.y);
      return got.every((v, i) => Math.abs(v - want[i]!) <= 0.005 * Math.max(...want)) ? [] : [`pixel (${s.x}, ${s.y}) of patch (${s.c}, ${s.r}) is drawn [${got.map((v) => v.toPrecision(5)).join(', ')}], not [${want.map((v) => v.toPrecision(5)).join(', ')}]`];
    });
    none(wrong, 'the fixture is the coloured patches as given');
    const changed = frame(drawn(hashReply!, 'the patches with local {strength: 0.5}'), 0, 'the patches with local {strength: 0.5}');
    expect(changed.pixel_hash, 'the guard: local {strength: 0.5} moves the patches\' luminance, so its frame is not the one drawn without local').not.toBe(asDrawn.pixel_hash);

    const local = readLinear(out(), frame(drawn(localReply!, 'the patches with local {strength: 0.5}, pre_curve'), 0, 'the patches with local {strength: 0.5}'), 'pre_curve', FULL, 'the patches with local {strength: 0.5}');
    const unmoved: string[] = []; const shifted: string[] = [];
    let worstHue = 0; let worstChroma = 0;
    for (const s of at) {
      const before = rgbAt(plain, s.x, s.y); const after = rgbAt(local, s.x, s.y);
      const where = `pixel (${s.x}, ${s.y}) of patch (${s.c}, ${s.r})`;
      const moved = Math.log2(luma(after) / luma(before));
      if (!(Math.abs(moved) > 1)) unmoved.push(`${where}: its luminance moved by ${moved.toFixed(4)} stop under local {strength: 0.5}`);
      const k = luma(before) / luma(after);
      const a = linearToOklab(before); const b = linearToOklab(after.map((v) => v * k) as Lin);
      const hue = Math.abs(((hueOf(b) - hueOf(a) + 540) % 360) - 180);
      const chroma = Math.abs(chromaOf(b) - chromaOf(a)) / chromaOf(a);
      if (hue > worstHue) worstHue = hue;
      if (chroma > worstChroma) worstChroma = chroma;
      if (!(hue < 1)) shifted.push(`${where}: hue ${hueOf(a).toFixed(3)}° without local, ${hueOf(b).toFixed(3)}° with it, ${hue.toFixed(3)}° apart`);
      if (!(chroma < 0.01)) shifted.push(`${where}: chroma ${chromaOf(a).toFixed(5)} without local, ${chromaOf(b).toFixed(5)} with it, ${(100 * chroma).toFixed(3)}% apart`);
    }
    none(unmoved, 'the guard: local {strength: 0.5} moved every sampled pixel\'s luminance by more than 1 stop, so a colour kept is not a frame left alone');
    console.log(`${AC[4]}: over the 64 sampled pixels, hue differs by at most ${worstHue.toFixed(4)}° and chroma by at most ${(100 * worstChroma).toFixed(4)}%`);
    none(shifted, 'hue within 1° and chroma within 1% at the 64 sampled pixels, the luminance change divided out');
  }, TIMEOUT);
});
