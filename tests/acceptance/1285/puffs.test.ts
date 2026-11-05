// AC3 #1285.a78aa552: A `view3d` of a document with `puff@1` clouds and no `sky@1` draws the clouds: its frame differs
// from the same document's frame without them, its `gpu_ms` is above 0, and no device validation error is written.
//
// The document: a camera, a key sun (so the puffs have light: Puff `puff@1`, `light.sun: key`) and three `puff@1`
// clouds of 0.7 to 0.9 m, density 0.8, about 5 m in front of the camera, over the middle of the 64 × 48 frame and
// clear of its corners; no `sky@1`. The same document without the puffs is the control. Each draws one frame with the
// final target and `timings`, in one `deep-gpu run` whose stderr is kept (the control first). Then:
//   - the clouds draw: at least 5% of the frame's pixels differ from the control's by more than 2 codes, every pixel
//     of its middle 8 × 8 (inside the nearest puff, lit by the sun) is brighter by more than 16 codes in some channel, while its four 4 × 4
//     corners (no puff reaches them) stay within 2 codes of the control's, so the difference is the clouds, not a
//     frame that went black around them;
//   - the frame's `gpu_ms` is above 0 (the control's too, so a timer that reads 0 for every frame fails as well);
//   - stderr holds no device validation error.
// Wrong programs: the base (the puffs' draw misses bind group 3, wgpu drops the encoder: the frame is black where the
// control's is the dark grey background, `gpu_ms` is 0 and stderr names `scene3d.puff`); clouds that don't change the
// frame (dropped, or drawn with no alpha); a fix that skips the puffs' draw to silence the error.
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, changedShare, requireMetal, useDir, useGpu, view3dCall, writeJson, type JsonObject } from '../422/helpers.ts';
import { AC, KEY, SIZE, centre, codes, corners, darkShare, doc, finals, noValidationError, px, runKeepingStderr } from './helpers.ts';

const bin = useGpu();
const dir = useDir();

const puff = (radius: number, pos: [number, number, number], seed: number): JsonObject =>
  ({ kind: 'puff@1', params: { radius, aspect: 1.6, density: 0.8, bright: 1, seed, light: { sun: 'key', ambient: 'none', phase: 0.5, shade: 0.6 } }, at: { pos } });

describe(`${AC[3]} puff@1 clouds without a sky draw`, () => {
  it(`${AC[3]} a view3d of puff@1 clouds and no sky@1 draws the clouds: its frame differs from the frame without them, its gpu_ms is above 0, and no device validation error is written`, () => {
    requireMetal();
    const out = dir();
    const without = doc('no-puffs', { sun: KEY });
    const withPuffs = doc('puffs', { sun: KEY, puff_a: puff(0.9, [0, 0, 0], 1), puff_b: puff(0.7, [-0.8, 0.25, -0.5], 2), puff_c: puff(0.7, [0.8, -0.2, -0.3], 3) });
    const call = (name: string, d: JsonObject) => view3dCall({ doc: writeJson(out, name, d), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final'], timings: true });
    const { replies, stderr } = runKeepingStderr(bin(), out, [call('without', without), call('with', withPuffs)]);
    const [control, clouds] = finals(out, replies, ['the document without the puffs', 'the document with the puffs']);
    const changed = changedShare(clouds!.final, control!.final);
    console.log(`${AC[3]}: control corner ${px(control!.final, 0, 0).join(', ')}, middle ${px(control!.final, 32, 24).join(', ')}; with puffs corner ${px(clouds!.final, 0, 0).join(', ')}, middle ${px(clouds!.final, 32, 24).join(', ')}; ${(changed * 100).toFixed(1)}% of pixels changed by the puffs (${(darkShare(clouds!.final) * 100).toFixed(1)}% dark); gpu_ms with puffs ${clouds!.frame.gpu_ms}, without ${control!.frame.gpu_ms}; stderr: ${stderr.trim().slice(0, 600) || '(empty)'}`);

    const [w, h] = SIZE;
    expect.soft(changed, 'the clouds draw: at least 5% of the frame\'s pixels differ from the frame without them by more than 2 codes').toBeGreaterThanOrEqual(0.05);
    const middle = centre(w, h, 4);
    const brighter = (a: [number, number, number], b: [number, number, number]): number => Math.max(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const unchanged = middle.filter(([x, y]) => brighter(px(clouds!.final, x, y), px(control!.final, x, y)) <= 16);
    expect.soft(unchanged.length, `the clouds draw over the middle: every pixel of the middle 8 × 8 is brighter than the frame without them by more than 16 codes in some channel; ${unchanged.length} of ${middle.length} don't`).toBe(0);
    const edge = corners(w, h, 4);
    const moved = edge.filter(([x, y]) => codes(px(clouds!.final, x, y), px(control!.final, x, y)) > 2);
    expect.soft(moved.length, `only the clouds change the frame: every corner pixel (no puff reaches the corners) is within 2 codes of the frame without them; ${moved.length} of ${edge.length} aren't, such as (${moved[0]?.join(', ')}) = ${moved[0] ? px(clouds!.final, ...moved[0]).join(', ') : ''} against ${moved[0] ? px(control!.final, ...moved[0]).join(', ') : ''}`).toBe(0);
    expect.soft(control!.frame.gpu_ms, 'the frame without the puffs carries its GPU time').not.toBeNull();
    expect.soft(control!.frame.gpu_ms ?? 0, 'the frame without the puffs: gpu_ms is above 0').toBeGreaterThan(0);
    expect.soft(clouds!.frame.gpu_ms, 'the frame with the puffs carries its GPU time').not.toBeNull();
    expect.soft(clouds!.frame.gpu_ms ?? 0, 'the frame with the puffs: gpu_ms is above 0').toBeGreaterThan(0);
    noValidationError(stderr, 'drawing the puffs');
  }, 1_800_000);
});
