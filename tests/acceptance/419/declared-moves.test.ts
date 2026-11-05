// AC1 #419.f32101aa: Blur shows only during declared moves, never in a reading hold, and a blurred frame reached by
// seeking equals the played one.
//
// The slider (helpers: `sliderDoc`): a 1 m white unlit box, orthographic at 60 px/m, keyed along x at 8 m/s over
// 0–1 s (a declared move), still over 1–2 s, and moving back over 2–3 s under a `hold` marker over 2–3 s (a reading
// hold). Exports at 24 fps, one look sample, motion blur by samples at 8 samples, 180° (10 px of travel per shutter),
// against the same frames with motion blur off. Frame 12 (0.5 s, moving): on the box's centre row at least 12 pixels
// are partly covered (linear 0.05–0.95; ideal ≈ 16) where the unblurred frame has at most 2, so blur shows. Frame 36
// (1.5 s, still) and frame 60 (2.5 s, moving inside the hold): the final target is byte-equal to the unblurred frame.
// The control: the same document without the hold blurs frame 60 (at least 12 partly covered pixels), so the hold,
// not stillness, keeps frame 60 sharp. Seek against play: frame 12 played from 0 and frame 12 opened by a seek have
// the same final-target hash, and the seeked frame is blurred.
// Wrong programs: the base (no motion blur: frame 12 has no partly covered pixels); blur applied while nothing moves
// with a frame that isn't the unblurred one; blur over a reading hold; blur that reads the previous frame (a seek has
// none, so the seeked frame differs from the played one).
import { describe, expect, it } from 'vitest';
import {
  AC, SLIDER, SLIDER_SIZE, blur, frameAt, framesOf, look, lum, readLinear, requireMetal, runGpu, sliderDoc, useDir, useGpu, view3dCall,
  writeJson, type JsonObject, type ViewFrame,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const [MOVING, STILL, HELD] = [12, 36, 60];
const ROW = SLIDER_SIZE[1] / 2;

const call = (out: string, hold: boolean, on: boolean, from: number, frames: number, capture: number[]): JsonObject => view3dCall({
  doc: writeJson(out, `slider-${hold}`, sliderDoc(hold)), look: look({ motionBlur: on ? blur('samples', 8) : 'none' }), size: SLIDER_SIZE,
  class: 'export', fps: SLIDER.fps, from, frames, capture, targets: ['final', 'linear'],
});
/** Pixels on the box's centre row that are partly covered: linear 0.05 to 0.95. */
function partial(out: string, f: ViewFrame, what: string): number {
  const lin = readLinear(out, f, SLIDER_SIZE, what);
  let n = 0;
  for (let x = 0; x < SLIDER_SIZE[0]; x++) { const v = lum(lin.at(x, ROW)); if (v > 0.05 && v < 0.95) n++; }
  return n;
}

describe(`${AC[1]} blur during declared moves only, never in a reading hold, seek equal to play`, () => {
  it(`${AC[1]} the moving box blurs; the still box and the box moving inside a reading hold equal the unblurred frames byte for byte`, () => {
    requireMetal();
    const out = dir();
    const [on, off, plainOn, plainOff] = runGpu(bin(), out, [
      call(out, true, true, 0, HELD + 1, [MOVING, STILL, HELD]),
      call(out, true, false, 0, HELD + 1, [MOVING, STILL, HELD]),
      call(out, false, true, HELD, 1, [HELD]),
      call(out, false, false, HELD, 1, [HELD]),
    ]).map((r, i) => framesOf(r, `call ${i}`));
    const at = (fs: ViewFrame[], n: number, what: string): ViewFrame => frameAt(fs, n, what);
    const moving = partial(out, at(on!, MOVING, 'blurred'), 'blurred frame 12');
    const movingSharp = partial(out, at(off!, MOVING, 'unblurred'), 'unblurred frame 12');
    console.log(`${AC[1]}: frame ${MOVING} partly covered pixels: ${moving} blurred, ${movingSharp} unblurred`);
    expect(moving, `frame ${MOVING} (moving): at least 12 partly covered pixels on the centre row, blur shows`).toBeGreaterThanOrEqual(12);
    expect(movingSharp, `frame ${MOVING} without blur: at most 2 partly covered pixels`).toBeLessThanOrEqual(2);
    expect(at(on!, MOVING, 'blurred').final, `frame ${MOVING}: the blurred frame differs from the unblurred one`).not.toBe(at(off!, MOVING, 'unblurred').final);
    expect(at(on!, STILL, 'blurred').final, `frame ${STILL} (still): equal to the unblurred frame, no blur where nothing moves`).toBe(at(off!, STILL, 'unblurred').final);
    expect(at(on!, HELD, 'blurred').final, `frame ${HELD} (moving inside the reading hold): equal to the unblurred frame, no blur in a hold`).toBe(at(off!, HELD, 'unblurred').final);
    const control = partial(out, at(plainOn!, HELD, 'control'), 'control frame 60');
    expect(control, `the control: without the hold, frame ${HELD} blurs (partly covered pixels)`).toBeGreaterThanOrEqual(12);
    expect(at(plainOn!, HELD, 'control').final, 'the control differs from its unblurred frame').not.toBe(at(plainOff!, HELD, 'control off').final);
  }, 1_800_000);

  it(`${AC[1]} blurred frame ${MOVING} reached by seeking equals the played one, by final-target hash`, () => {
    requireMetal();
    const out = dir();
    const [played, seeked] = runGpu(bin(), out, [call(out, true, true, 0, MOVING + 1, [MOVING]), call(out, true, true, MOVING, 1, [MOVING])])
      .map((r, i) => frameAt(framesOf(r, `call ${i}`), MOVING, i ? 'seeked' : 'played'));
    expect(partial(out, seeked!, 'seeked frame'), 'the seeked frame is blurred').toBeGreaterThanOrEqual(12);
    expect(seeked!.final, `frame ${MOVING} seeked equals frame ${MOVING} played`).toBe(played!.final);
  }, 1_800_000);
});
