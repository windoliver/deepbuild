// Bloom (Look `look@1`: bloom), two criteria, on the dot: one emissive sphere about 6 px across at the centre of a
// 512 × 512 black frame (emission 20 in linear light), read back from the new `pre_tone` target, the linear image
// the tone-mapping pass reads (after the effects chain and bloom, before exposure).
//
// #418.87688852 With no threshold, bloom conserves energy: the frame's summed linear luminance changes by under 1%.
// #418.ecfba785 Lens dirt shows only where bloom is: with one emissive dot at the frame's centre and a dirt image white
// on its left half and black on its right, at intensity 2, the light bloom adds at 20 pixels away from the dot is 3
// times the same frame's without dirt on the left and equal to it on the right, within 1% on linear targets read
// back; a black frame stays black; seeded dirt gives the same image for the same seed, by hash; and a planted dirt
// laid over the frame as an overlay brightens the black frame and fails, naming the pixel.
//
// "The light bloom adds" at a pixel is its `pre_tone` value with bloom on less the same frame's with `bloom: none`.
// The pixels 20 px from the dot are those whose centres lie 19.5 px left and right of the frame's centre (x = 236 and
// 275) on the two rows through it (y = 255 and 256). At the base there is no `pre_tone` target, no `dirt`, no
// emissive material and no `dirt_overlay` plant.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOT_SIZE, answered, dot, encodePng, frameAt, look, luma, pixel, readPng, readTarget, requireGpu, run, sha256, texel, useGpuBin, useOut, writeJson,
  type F32, type Image, type JsonObject, type Planted, type Rgb,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const ROLES: Record<string, Rgb> = { dot: [255, 255, 255] };
const ground: JsonObject = { night: '#000000' };
const BLOOM: JsonObject = { intensity: 0.04, radius: 0.85 };
const lookWith = (bloom: JsonObject | 'none', seed = 418): JsonObject => {
  const l = look('bloom-418', ROLES, { bloom, seed });
  Object.assign(l['palette'] as JsonObject, ground);
  return l;
};
const view = (doc: string, bloom: JsonObject | 'none', extra: JsonObject = {}, seed?: number): JsonObject =>
  ({ call: 'view3d', doc, look: lookWith(bloom, seed), size: DOT_SIZE, targets: ['final', 'pre_tone'], capture: [0], ...extra });
const preTone = (reply: JsonObject, what: string): F32 => readTarget(out(), frameAt(answered(reply, what), 0, what), 'pre_tone', DOT_SIZE, what);
function summed(img: F32): number { let s = 0; for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) s += luma(texel(img, x, y)); return s; }
const LEFT: [number, number][] = [[236, 255], [236, 256]];
const RIGHT: [number, number][] = [[275, 255], [275, 256]];

/** The black frame's failures: every pixel of the linear image the tone map reads is 0 and every final pixel black, naming the first pixels that aren't. */
function blackProblems(pre: F32, final: Image, what: string): string[] {
  const p: string[] = [];
  for (let y = 0; y < pre.height && p.length < 5; y++) for (let x = 0; x < pre.width && p.length < 5; x++) {
    const l = texel(pre, x, y); const f = pixel(final, x, y);
    if (l.some((v) => v !== 0) || f.some((v) => v !== 0)) p.push(`${what}: pixel (${x}, ${y}) isn't black: linear [${l.map((v) => v.toExponential(3))}], final [${f}]`);
  }
  return p;
}
/** The dirt image: the frame's size, white on its left half and black on its right, written under the test's folder by its hash. */
function dirtImage(): { sha: string; path: string } {
  const png = encodePng(DOT_SIZE[0], DOT_SIZE[1], (x) => (x < DOT_SIZE[0] / 2 ? [255, 255, 255] : [0, 0, 0]));
  const sha = sha256(png); const path = join(out(), `${sha}.png`);
  writeFileSync(path, png);
  return { sha, path };
}

describe('#418.87688852 bloom with no threshold conserves energy', () => {
  it('#418.87688852 the dot\'s frame sums the same linear luminance within 1% with bloom on as with bloom none, while bloom spreads its light', () => {
    requireGpu();
    const doc = writeJson(out(), 'dot.json', dot('dot-energy-418'));
    const [none, on] = run(gpu.bin(), out(), [view(doc, 'none'), view(doc, BLOOM)]);
    const a = preTone(none!, 'bloom none'); const b = preTone(on!, 'bloom on');
    const before = summed(a); const after = summed(b);
    expect(before, 'the dot gives the frame light').toBeGreaterThan(100);
    expect(Math.abs(after - before) / before, `bloom with no threshold keeps the frame's summed linear luminance within 1% (${before.toFixed(3)} → ${after.toFixed(3)})`).toBeLessThan(0.01);
    expect(luma(texel(b, 236, 255)), 'bloom spreads the dot\'s light 20 px out').toBeGreaterThan(luma(texel(a, 236, 255)));
  }, 1_800_000);
});

describe('#418.ecfba785 lens dirt shows only where bloom is', () => {
  it('#418.ecfba785 dirt white on the left at intensity 2 triples the light bloom adds 20 px left of the dot and leaves it on the right, within 1%; the black frame stays black; seeded dirt is one image per seed', () => {
    requireGpu();
    const doc = writeJson(out(), 'dot.json', dot('dot-dirt-418'));
    const black = writeJson(out(), 'black.json', dot('black-dirt-418', false));
    const { sha, path } = dirtImage();
    const dirt: JsonObject = { ...BLOOM, dirt: { texture: sha, intensity: 2 } };
    const seeded: JsonObject = { ...BLOOM, dirt: { texture: 'seeded', intensity: 2 } };
    const assets = { assets: { [sha]: path } };
    const [none, clean, dirty, dark, s1] = run(gpu.bin(), out(), [
      view(doc, 'none'), view(doc, BLOOM), view(doc, dirt, assets), view(black, dirt, assets), view(doc, seeded, { targets: ['pre_tone', 'dirt'] }, 418),
    ]);
    const base = preTone(none!, 'bloom none'); const c = preTone(clean!, 'bloom without dirt'); const d = preTone(dirty!, 'bloom with dirt');
    const added = (img: F32, [x, y]: [number, number]): number => luma(texel(img, x, y)) - luma(texel(base, x, y));
    for (const at of [...LEFT, ...RIGHT]) expect(added(c, at), `bloom without dirt adds light at (${at})`).toBeGreaterThan(1e-6);
    for (const at of LEFT) {
      const r = added(d, at) / added(c, at);
      expect(Math.abs(r / 3 - 1), `left of the dot at (${at}), under white dirt, bloom adds 3 times the light it adds without dirt, within 1% (×${r.toFixed(4)})`).toBeLessThanOrEqual(0.01);
    }
    for (const at of RIGHT) {
      const r = added(d, at) / added(c, at);
      expect(Math.abs(r - 1), `right of the dot at (${at}), under black dirt, bloom adds the same light as without dirt, within 1% (×${r.toFixed(4)})`).toBeLessThanOrEqual(0.01);
    }

    // A black frame stays black under bloom with dirt.
    const darkF = frameAt(answered(dark!, 'the black frame with dirt'), 0, 'the black frame with dirt');
    expect(blackProblems(readTarget(out(), darkF, 'pre_tone', DOT_SIZE, 'the black frame'), readPng(out(), darkF, 'final', 'the black frame'), 'the black frame with dirt')).toEqual([]);

    // Seeded dirt: the same image for the same seed in another process, by hash; another seed, another image.
    const [s2] = run(gpu.bin(), out(), [view(doc, seeded, { targets: ['pre_tone', 'dirt'] }, 418)]);
    const [s3] = run(gpu.bin(), out(), [view(doc, seeded, { targets: ['pre_tone', 'dirt'] }, 419)]);
    const dirtOf = (r: JsonObject, what: string): string => {
      const f = frameAt(answered(r, what), 0, what);
      const img = readTarget(out(), f, 'dirt', DOT_SIZE, what);
      let lo = Infinity; let hi = -Infinity;
      for (let i = 0; i < img.rgba.length; i += 4) { lo = Math.min(lo, img.rgba[i]!); hi = Math.max(hi, img.rgba[i]!); }
      expect(lo >= 0 && hi <= 1 && hi - lo > 0.05, `${what}: the seeded dirt image lies in [0, 1] and isn't flat (${lo} to ${hi})`).toBe(true);
      return f.raw['dirt'] as string;
    };
    expect(dirtOf(s2!, 'seed 418, a second process'), 'the same seed gives the same dirt image, by hash').toBe(dirtOf(s1!, 'seed 418'));
    expect(dirtOf(s3!, 'seed 419'), 'another seed gives another dirt image').not.toBe(dirtOf(s1!, 'seed 418'));
  }, 1_800_000);

  it('#418.ecfba785 a planted dirt laid over the frame as an overlay brightens the black frame and fails, naming the pixel', () => {
    requireGpu();
    const black = writeJson(out(), 'black.json', dot('black-overlay-418', false));
    const { sha, path } = dirtImage();
    const planted: Planted = 'dirt_overlay';
    const [dark] = run(gpu.bin(), out(), [view(black, { ...BLOOM, dirt: { texture: sha, intensity: 2 } }, { assets: { [sha]: path } })], planted);
    const f = frameAt(answered(dark!, 'the black frame, planted overlay dirt'), 0, 'the black frame, planted overlay dirt');
    const problems = blackProblems(readTarget(out(), f, 'pre_tone', DOT_SIZE, 'the planted frame'), readPng(out(), f, 'final', 'the planted frame'), 'the black frame, planted overlay dirt');
    expect(problems.length, '--planted dirt_overlay brightens the black frame, so the black-frame check fails it').toBeGreaterThan(0);
    expect(problems[0], 'the failure names the pixel').toMatch(/pixel \(\d+, \d+\)/);
  }, 1_800_000);
});
