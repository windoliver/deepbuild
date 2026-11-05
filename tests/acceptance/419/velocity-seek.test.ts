// AC3 #419.209b85be: A velocity-blurred frame reached by seeking equals the played one on the same machine's pixel hash.
//
// The slider (helpers: `sliderDoc`, no hold) in the live view at 24 fps with motion blur by velocity at 180° (taps 16,
// max 32 px, tile 20 px). Frame 12 (0.5 s, the box moving 10 px per shutter) played from frame 0 and frame 12 opened by
// a seek have the same final-target hash; the seeked frame is blurred (at least 12 partly covered pixels, linear
// 0.05–0.95, on the box's centre row) and differs from the frame with motion blur off.
// Wrong programs: the base (no velocity mode: no blur); velocities from the previous frame's transforms or pixels (a
// seek has none, so it draws sharp, or another blur, and its hash differs from the played frame's).
import { describe, expect, it } from 'vitest';
import { AC, SLIDER, SLIDER_SIZE, blur, frameAt, framesOf, look, lum, readLinear, requireMetal, runGpu, sliderDoc, useDir, useGpu, view3dCall, writeJson } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const N = 12;

describe(`${AC[3]} velocity blur seeked equals played`, () => {
  it(`${AC[3]} the velocity-blurred frame ${N} opened by a seek has the played frame's final hash, and is blurred`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'slider', sliderDoc(false));
    const v = look({ motionBlur: blur('velocity') });
    const [played, seeked, off] = runGpu(bin(), out, [
      view3dCall({ doc, look: v, size: SLIDER_SIZE, fps: SLIDER.fps, frames: N + 1, capture: [N], targets: ['final'] }),
      view3dCall({ doc, look: v, size: SLIDER_SIZE, fps: SLIDER.fps, from: N, frames: 1, capture: [N], targets: ['final', 'linear'] }),
      view3dCall({ doc, look: look(), size: SLIDER_SIZE, fps: SLIDER.fps, from: N, frames: 1, capture: [N], targets: ['final'] }),
    ]).map((r, i) => frameAt(framesOf(r, `call ${i}`), N, ['played', 'seeked', 'unblurred'][i]!));
    const lin = readLinear(out, seeked!, SLIDER_SIZE, 'the seeked frame');
    let partial = 0;
    for (let x = 0; x < SLIDER_SIZE[0]; x++) { const c = lum(lin.at(x, SLIDER_SIZE[1] / 2)); if (c > 0.05 && c < 0.95) partial++; }
    console.log(`${AC[3]}: seeked frame ${N}: ${partial} partly covered pixels on the centre row`);
    expect(partial, 'the seeked frame is velocity-blurred: at least 12 partly covered pixels').toBeGreaterThanOrEqual(12);
    expect(seeked!.final, 'the velocity-blurred frame differs from the frame without blur').not.toBe(off!.final);
    expect(seeked!.final, `frame ${N} seeked equals frame ${N} played, by final-target hash`).toBe(played!.final);
  }, 1_800_000);
});
