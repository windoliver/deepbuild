// AC4 #1285.3c874962: The castle (`packs/examples/castle.json` in `packs/examples/castle.look.json`) draws non-blank
// frames, and with `timings` each frame's `gpu_ms` is above 0.
//
// The castle as committed, drawn as #422's suite draws it (`castle()`: its own size, its look, its recipes from
// `packs/composites-1.0.0`, 30 fps), with the final target and `timings`: three frames from the start of its orbit and
// three from its half-turn (`from`), every frame captured. Each frame's final PNG isn't blank under film.blank's
// measure (luma at most 0.06 over at least 98% of its pixels), and each frame's `gpu_ms` is above 0.
// Wrong programs: the base (the sky's and the puffs' draws miss bind group 3, the encoder is dropped: every frame is
// black and every `gpu_ms` is 0); a fix that draws the first frame only; a timer that reads 0.
import { describe, expect, it } from 'vitest';
import { CASTLE_FPS, CASTLE_PACKS, castle, decodePng, framesOf, readNamed, requireMetal, useDir, useGpu, view3dCall } from '../422/helpers.ts';
import { AC, darkShare, notBlank, runKeepingStderr } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const FRAMES = 3;

describe(`${AC[4]} the castle draws`, () => {
  it(`${AC[4]} the castle draws non-blank frames at the start of its orbit and at its half-turn, and with timings each frame's gpu_ms is above 0`, () => {
    requireMetal();
    const out = dir();
    const c = castle();
    const half = c.samples[2]!.frame;
    const starts = [0, half];
    const { replies, stderr } = runKeepingStderr(bin(), out, starts.map((from) =>
      view3dCall({ doc: c.doc, look: c.look, size: c.size, from, frames: FRAMES, fps: CASTLE_FPS, capture: 'every', targets: ['final'], timings: true, packs: CASTLE_PACKS })));
    console.log(`${AC[4]}: stderr: ${stderr.trim().slice(0, 600) || '(empty)'}`);
    let seen = 0;
    for (const [k, from] of starts.entries()) {
      const frames = framesOf(replies[k]!, `the castle from frame ${from}`);
      expect.soft(frames.length, `the castle from frame ${from}: ${FRAMES} frames, each captured`).toBe(FRAMES);
      for (const f of frames) {
        seen++;
        const im = decodePng(readNamed(out, f.final, 'png', `the castle's frame ${f.frame}: the final target`));
        console.log(`${AC[4]}: frame ${f.frame}: ${(darkShare(im) * 100).toFixed(1)}% of pixels at luma ≤ 0.06, gpu_ms ${f.gpu_ms}`);
        notBlank(im, `the castle's frame ${f.frame}`);
        expect.soft(f.gpu_ms, `the castle's frame ${f.frame} carries its GPU time`).not.toBeNull();
        expect.soft(f.gpu_ms ?? 0, `the castle's frame ${f.frame}: gpu_ms is above 0`).toBeGreaterThan(0);
      }
    }
    expect(seen, `the castle drew ${starts.length * FRAMES} frames`).toBe(starts.length * FRAMES);
  }, 1_800_000);
});
