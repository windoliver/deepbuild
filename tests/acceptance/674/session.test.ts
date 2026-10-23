import { describe, expect, it } from 'vitest';
import {
  checkerDoc, checkerPng, gpuiAnswerOf, imageDoc, put, resamples, scratch, session, sha256, useBinaries, type Step,
} from './helpers.ts';

useBinaries('deep-canvas-render');
const dir = scratch('session');
const png = checkerPng();
const asset = put(dir, png);

/** A step that presents one frame of `doc`. */
const frame = (doc: ReturnType<typeof checkerDoc>, view?: { zoom: number }): Step => ({ doc, t: 0, frames: 1, ...(view ? { view } : {}) });

describe('AC5 a nearest image moved by whole device pixels over 10 frames on the GPUI path resamples once', () => {
  for (const zoom of [1, 2]) {
    it(`AC5 ten frames at zoom ${zoom}, the image one device pixel further each: one resample, in the first frame`, () => {
      // One device pixel is 1 / zoom u. Each frame is a revision that moves the image, so the content key changes every frame.
      const steps = Array.from({ length: 10 }, (_, i) => frame(checkerDoc(asset, { sampling: 'nearest', at: { pos: [i / zoom, 0, 0] } }), i === 0 ? { zoom } : undefined));
      const counts = session(dir, steps, `GPUI session, ten frames at zoom ${zoom}`).map((r, i) => resamples(r, i));
      expect(counts, `resamples per frame at zoom ${zoom} (the copy is built in the first frame and served from the cache after it)`).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }, 300_000);
  }

  it('AC5 the copy is cached by asset, crop, opacity and drawn size: a new opacity or a new drawn size resamples again, and a linear image never does', () => {
    const nearest = (extra: Parameters<typeof checkerDoc>[1] = {}) => frame(checkerDoc(asset, { sampling: 'nearest', ...extra }));
    const steps: Step[] = [
      nearest(), // 0: built
      nearest({ at: { pos: [3, 2, 0] } }), // 1: moved: cached
      nearest({ opacity: 0.5 }), // 2: another opacity: built
      nearest({ opacity: 0.5, at: { pos: [5, 5, 0] } }), // 3: moved again: cached
      nearest({ box: [4, 4, 12, 12] }), // 4: another drawn size: built
      frame(checkerDoc(asset, { sampling: 'linear', box: [4, 4, 20, 20] })), // 5: linear: no copy at any size
      frame(checkerDoc(asset)), // 6: no field: no copy
    ];
    const counts = session(dir, steps, 'GPUI session over opacity, size and linear images').map((r, i) => resamples(r, i));
    expect(counts, 'resamples per step: 1 built, 0 moved, 1 opacity, 0 moved, 1 size, 0 linear, 0 no field').toEqual([1, 0, 1, 0, 1, 0, 0]);
  }, 300_000);
});

describe('AC5 a nearest image whose resampled copy would pass the 64 MB cap is refused, naming its asset', () => {
  /** An image drawn `w` × `h` u at zoom 1 in a 64 × 64 document: its resampled copy is w × h × 4 bytes. */
  const big = (w: number, h: number) => imageDoc([64, 64], [{ id: 'checker', asset, box: [0, 0, w, h], sampling: 'nearest' }]);

  it('AC5 5000 × 4000 px (80 MB) is refused, and the refusal names the asset by its hash', () => {
    const out = gpuiAnswerOf(dir, big(5000, 4000), { zoom: 1 }).out;
    expect(out['ok'], `a nearest image drawn at 5000 × 4000 device px, 80 MB resampled, is over the 64 MB cap: ${JSON.stringify(out).slice(0, 1000)}`).toBe(false);
    expect(sha256(png), 'the checker\'s hash').toBe(asset);
    expect(JSON.stringify(out), 'the refusal names the image\'s asset').toContain(asset);
  }, 300_000);

  it('AC5 3000 × 3000 px (36 MB) is under the cap and is drawn', () => {
    const out = gpuiAnswerOf(dir, big(3000, 3000), { zoom: 1 }).out;
    expect(out['ok'], `a nearest image drawn at 3000 × 3000 device px, 36 MB resampled, is under the cap: ${JSON.stringify(out).slice(0, 1000)}`).toBe(true);
  }, 300_000);

  it('AC5 the cap counts device pixels: 2600 × 2600 u at zoom 2 is 5200 × 5200 px (108 MB) and is refused', () => {
    const out = gpuiAnswerOf(dir, big(2600, 2600), { zoom: 2 }).out;
    expect(out['ok'], `a nearest image drawn at 2600 × 2600 u at zoom 2, 108 MB resampled, is over the cap: ${JSON.stringify(out).slice(0, 1000)}`).toBe(false);
    expect(JSON.stringify(out), 'the refusal names the image\'s asset').toContain(asset);
  }, 300_000);
});
