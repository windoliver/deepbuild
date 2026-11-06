// AC1 #1285.2ac36129: A `view3d` of a document whose only items are a camera and a `sky@1` with a bright gradient (top
// and low near white) draws a final frame that isn't blank under film.blank's measure (luma at most 0.06 over at least
// 98% of its pixels), and `deep-gpu` writes no device validation error to stderr while drawing it.
//
// The document: a camera and `sky@1` with `top` 0.95 and `low` 0.85 grey. `view3d` draws one 64 × 48 frame with the
// final target, under #422's plain look (tone map none, exposure scale 1), so the sky's radiance is the pixel's.
// The final PNG is read back and measured with film.blank's measure; stderr is kept and must hold no device validation
// error. Since the gradient is near white everywhere, a sky that draws leaves no pixel near black: at least 98% of the
// pixels must be bright (luma at least 0.5), which a frame that draws the sky over a part of the view only fails.
// Wrong programs: the base (the sky's draw misses bind group 3, wgpu drops the encoder, the frame stays black and
// stderr names `scene3d.sky`); a sky drawn over a corner of the view; a fix that silences the error by skipping the
// sky's draw (the frame is then black).
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, requireMetal, useDir, useGpu, view3dCall, writeJson } from '../422/helpers.ts';
import { AC, BRIGHT_SKY, SIZE, darkShare, doc, finals, luma, noValidationError, notBlank, runKeepingStderr } from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC[1]} a camera and a bright sky@1 draw a frame that isn't blank`, () => {
  it(`${AC[1]} a view3d of a camera and a near-white sky@1 draws a final frame that isn't blank under film.blank's measure, and deep-gpu writes no device validation error to stderr`, () => {
    requireMetal();
    const out = dir();
    const { replies, stderr } = runKeepingStderr(bin(), out, [
      view3dCall({ doc: writeJson(out, 'sky', doc('sky-only', { sky: BRIGHT_SKY })), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final'] }),
    ]);
    const [sky] = finals(out, replies, ['the camera and the sky']);
    console.log(`${AC[1]}: ${(darkShare(sky!.final) * 100).toFixed(1)}% of the sky frame's pixels at luma ≤ 0.06; stderr: ${stderr.trim().slice(0, 600) || '(empty)'}`);
    notBlank(sky!.final, 'the camera and the near-white sky');
    const n = SIZE[0] * SIZE[1];
    let bright = 0;
    for (let i = 0; i < n; i++) if (luma(sky!.final, i) >= 0.5) bright++;
    expect.soft(bright / n, 'the near-white sky fills the view: at least 98% of the pixels are bright (luma ≥ 0.5)').toBeGreaterThanOrEqual(0.98);
    noValidationError(stderr, 'drawing the camera and the sky');
  }, 1_800_000);
});
