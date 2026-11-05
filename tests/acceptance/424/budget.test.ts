// AC8 #424.73418e8a: Budget: per-pixel resolve of the saddle adds under 2 ms of GPU at 1080p on the reference Mac.
//
// AC6's saddle crossing its plane (`layeredDoc`, helpers) drawn at 1920 × 1080 through the same camera, twice in one
// process: with `resolve: per_pixel` and with `resolve: sorted`, 120 frames each with `timings`. A run's cost is the
// per-pixel draw's median `gpu_ms` less the sorted draw's; the five-run rule (`judge`: five runs after a warm-up, PASS
// when all five are under 2 ms, FAIL when all five are over it by more than the margin, else INCONCLUSIVE). The
// warm-up run also checks that the two draws differ on at least 1% of pixels, so a renderer that ignores `resolve`
// (the base) can't pass by timing two sorted draws. Off a reference Mac (Mac15,7 or Mac15,12) the test is
// INCONCLUSIVE. Wrong programs: the base; a resolve that sorts every list on the CPU or reads fragments back.
import { describe, expect, it } from 'vitest';
import {
  AC, RUNS, SADDLE_CAM, SADDLE_LAYERS, codeOff, frameAt, framesOf, judge, layeredDoc, median, px, readPng, requireReferenceMac, runGpu, useDir, useGpu,
  view3dCall, writeJson,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 120;

describe(`${AC[8]} the per-pixel resolve's GPU budget`, () => {
  it(`${AC[8]} per-pixel resolve of the saddle adds under 2 ms of GPU at 1080p, by the five-run rule`, () => {
    requireReferenceMac();
    let checked = false;
    const cost = (): number => {
      const out = dir();
      const calls = (['per_pixel', 'sorted'] as const).map((resolve) => {
        const { doc, assets } = layeredDoc(out, `saddle-${resolve}`, { ...SADDLE_CAM, size: SIZE }, SIZE, SADDLE_LAYERS, resolve);
        return view3dCall({ doc: writeJson(out, `saddle-${resolve}`, doc), size: SIZE, frames: FRAMES, fps: 60, capture: checked ? [] : [0], targets: ['final'], timings: true, assets });
      });
      const frames = runGpu(bin(), out, calls).map((r, i) => framesOf(r, i === 0 ? 'per_pixel' : 'sorted'));
      if (!checked) {
        // The timed draws resolve differently: the per-pixel frame differs from the sorted one on at least 1% of
        // pixels (AC6's twin misses on one side), so a renderer that ignores `resolve` times nothing.
        const [a, b] = frames.map((fs, i) => readPng(out, frameAt(fs, 0, i === 0 ? 'per_pixel' : 'sorted').final, 'frame 0'));
        let changed = 0;
        for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) if (codeOff(px(a!, x, y), px(b!, x, y)) > 2) changed++;
        expect(changed / (SIZE[0] * SIZE[1]), 'the per-pixel draw resolves differently from the sorted one on at least 1% of pixels').toBeGreaterThanOrEqual(0.01);
        checked = true;
      }
      const [pp, so] = frames.map((fs) => {
        expect(fs.length, `the timed draw has ${FRAMES} frames`).toBe(FRAMES);
        return median(fs.map((f) => { expect(f.gpu_ms, `frame ${f.frame} carries its GPU time`).not.toBeNull(); return f.gpu_ms!; }));
      });
      return pp! - so!;
    };
    cost(); // the warm-up run, discarded, which also checks that the draws resolve differently
    judge(`${AC[8]}: per-pixel resolve's added GPU time at 1080p (ms)`, Array.from({ length: RUNS }, cost), 2);
  }, 3_600_000);
});
