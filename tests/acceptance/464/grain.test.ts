// #464.737ef81a: "Grain: `grain: {amount: 4%, size: 1 px, tone: flat, rate: 24}` over a flat linear 0.18 grey 1920 ×
// 1080 frame gives a per-pixel luminance standard deviation of 4% of the mean within 10% and a frame mean within 0.25 of
// a code value of the grain-free frame; frames are identical inside each 1/24 s step and differ across steps, played or
// seeked. With `tone: midtones` the deviation at linear 0.01 and 0.9 is at most a quarter of that at 0.18"
//
// The grey is #767676 (linear 0.1812), the nearest 8-bit grey to 0.18; 0.01 is #191919 (0.0097) and 0.9 is #f3f3f3
// (0.8963), each a rect over the whole frame. Luminance is Rec. 709 Y of `film2d`'s `linear` target (f32, the frame in
// linear light before its 8-bit encode); its standard deviation over every pixel must be 0.04 × the mean, ±10%. The
// frame mean in code values is the mean of the final PNG's R, G and B over every pixel, within 0.25 of the grain-free
// frame's. At 96 fps each 1/24 s step is four frames: frames 0 to 11 played have one pixel hash per step and a new one
// each step, and frames 1, 5 and 10 opened cold have their played hashes. "The deviation" with `tone: midtones` is the
// same standard deviation of Y (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  AC, type F32, type JsonObject, film2d, flat, frameAt, framesOf, look2d, lumaAt, readFinal, readLinear, requireGpu, runGpu, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const SIZE: [number, number] = [1920, 1080];
const GREYS = { g01: '#191919', g18: '#767676', g90: '#f3f3f3' };
const grain = (tone: string): JsonObject => ({ grain: { amount: '4%', size: '1px', tone, rate: 24 } });

function stats(im: F32): { mean: number; sd: number } {
  let s = 0; let s2 = 0; const n = im.width * im.height;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) { const v = lumaAt(im, x, y); s += v; s2 += v * v; }
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

describe(`${AC[10]} grain's deviation, mean and rate, and its midtones tone`, () => {
  it(`${AC[10]} grain at 4% over linear 0.18 grey has a luminance deviation of 4% of the mean within 10%, a mean within 0.25 of a code value of no grain, and changes once per 1/24 s step, played or seeked`, () => {
    requireGpu();
    const doc = flat('grey18-464', SIZE, 'g18');
    const look = (finish: JsonObject[]): JsonObject => look2d('grain-464', GREYS, { finish });
    const replies = runGpu(bins.bin('deep-gpu'), out(), [
      film2d(doc, look([]), { frames: 1, capture: [0], targets: ['final', 'linear'] }),
      film2d(doc, look([grain('flat')]), { fps: 96, frames: 12, capture: [0], targets: ['final', 'linear'] }),
      ...[1, 5, 10].map((from) => film2d(doc, look([grain('flat')]), { fps: 96, from, frames: 1 })),
    ]);
    const bare = frameAt(replies[0]!, 0, 'no grain');
    const grained = frameAt(replies[1]!, 0, 'grain');
    const { mean, sd } = stats(readLinear(out(), grained, SIZE, 'grain'));
    expect(Math.abs(sd / (0.04 * mean) - 1), `the luminance deviation ${sd.toFixed(5)} is 4% of the mean ${mean.toFixed(5)} (${(0.04 * mean).toFixed(5)}) within 10%`).toBeLessThanOrEqual(0.1);
    const codeMean = (f: typeof bare, what: string): number => {
      const img = readFinal(out(), f, what); let s = 0;
      for (let i = 0; i < img.rgba.length; i += 4) s += img.rgba[i]! + img.rgba[i + 1]! + img.rgba[i + 2]!;
      return s / ((img.rgba.length / 4) * 3);
    };
    const m0 = codeMean(bare, 'no grain'); const m1 = codeMean(grained, 'grain');
    expect(Math.abs(m1 - m0), `the grained frame's mean ${m1.toFixed(3)} is within 0.25 of a code value of the grain-free ${m0.toFixed(3)}`).toBeLessThanOrEqual(0.25);
    const played = framesOf(replies[1]!, 'grain played');
    expect(played.map((f) => f.frame), 'frames 0 to 11 played').toEqual([...Array(12).keys()]);
    for (let n = 1; n < 12; n++) {
      const same = Math.floor(n / 4) === Math.floor((n - 1) / 4);
      if (same) expect(played[n]!.pixel_hash, `frame ${n} is frame ${n - 1}: both in step ${Math.floor(n / 4)} (1/24 s)`).toBe(played[n - 1]!.pixel_hash);
      else expect(played[n]!.pixel_hash, `frame ${n} starts step ${n / 4} and differs from frame ${n - 1}`).not.toBe(played[n - 1]!.pixel_hash);
    }
    [1, 5, 10].forEach((n, k) => expect(frameAt(replies[2 + k]!, n, `grain seeked to frame ${n}`).pixel_hash, `frame ${n} seeked equals frame ${n} played`).toBe(played[n]!.pixel_hash));
  });

  it(`${AC[10]} with tone: midtones the deviation at linear 0.01 and 0.9 is at most a quarter of that at 0.18`, () => {
    requireGpu();
    const look = look2d('grain-mid-464', GREYS, { finish: [grain('midtones')] });
    const keys = ['g01', 'g18', 'g90'] as const;
    const replies = runGpu(bins.bin('deep-gpu'), out(), keys.map((k) => film2d(flat(`${k}-464`, SIZE, k), look, { frames: 1, capture: [0], targets: ['linear'] })));
    const sd = Object.fromEntries(keys.map((k, i) => [k, stats(readLinear(out(), frameAt(replies[i]!, 0, k), SIZE, k)).sd])) as Record<(typeof keys)[number], number>;
    expect(sd.g18, `grain shows at 0.18 (deviation ${sd.g18.toFixed(5)})`).toBeGreaterThan(0.001);
    expect(sd.g01, `the deviation at 0.01 (${sd.g01.toFixed(5)}) is at most a quarter of that at 0.18 (${sd.g18.toFixed(5)})`).toBeLessThanOrEqual(sd.g18 / 4);
    expect(sd.g90, `the deviation at 0.9 (${sd.g90.toFixed(5)}) is at most a quarter of that at 0.18 (${sd.g18.toFixed(5)})`).toBeLessThanOrEqual(sd.g18 / 4);
  });
});
