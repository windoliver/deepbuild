// AC7 #466.e1124907: "With the look's quantize at 12 Hz, a 24 fps export, motion blur on at a 180° shutter and a box
// moving at 240 u/s, frames 2m and 2m + 1 are byte-identical and each shows one blur; a planted blur that quantizes each
// sample shows two half-opacity copies on even frames and fails, naming the frame"
//
// Fixture (helpers.ts): a 640 × 360 film at 24 fps, 2 s (48 frames), under a look with `time.quantize_hz: 12` and
// `motion_blur {shutter_angle: 180, samples: 8, …}` (one sub-sample per frame otherwise): a 12 × 40 u ink box on the
// white top half, its x keyed linearly from 40 u at 0 s to 520 u at 2 s (240 u/s), over a mid-grey bottom half. Exported
// whole as a png_seq at 24 fps.
//
// Numbers: frame k's time after the quantize is ⌊k ÷ 2⌋ ÷ 12 s, so frames 2m and 2m + 1 share it. The exposure is
// 180° of a 1/24 s frame, 1/48 s, centred on that time: the box travels 5 px in it. One blur on the box's middle row is
// one run of non-ground pixels 12 + 5 = 17 ± 2 px long, 7 ± 2 px of full ink between ≥ 3 partial pixels each side,
// centred within 1 px on the box at the quantized time. A blur that quantizes each sample again puts the samples before
// m/12 s at (m − 1)/12 s and those after at m/12 s: on even frames, two sharp copies 20 px apart, each at half opacity.
//
// asserts:
//   - The clean export: the receipt's frame rate is [24, 1] with 48 frames; every pair 2m, 2m + 1 is byte-identical
//     (one receipt hash, the same decoded pixels); every frame from 2 on shows one blur.
//   - Under the planted `blur_quantizes_samples`: every even frame from 2 to 46 shows two half-opacity copies 20 ± 1.5 px
//     apart, and the same judge fails, naming frame 2.
import { describe, it } from 'vitest';
import { AC7, exported, exportFailures, exportScenario, failsNaming, FRAMES, none, run, TIMEOUT, twoCopiesFailures, useFolders, useShow } from './helpers.ts';
import { join } from 'node:path';

const bin = useShow();
const folder = useFolders();

const exportOf = (planted?: string): ReturnType<typeof exported> => {
  const out = join(folder(), 'frames');
  const what = `the 24 fps png_seq export of the moving box${planted ? ` under ${planted}` : ''}`;
  const [, reply] = run(bin(), exportScenario(folder(), out, planted), what);
  return exported(reply!, out, what);
};

describe(`${AC7} with time quantized at 12 Hz, a 24 fps export holds each drawing two frames and blurs it once`, () => {
  it(`${AC7} frames 2m and 2m + 1 are byte-identical and each shows one blur`, () => {
    none(exportFailures(exportOf()), 'the export with quantize at 12 Hz and a 180° shutter');
  }, TIMEOUT);

  it(`${AC7} a planted blur that quantizes each sample shows two half-opacity copies on even frames and fails, naming the frame`, () => {
    const e = exportOf('blur_quantizes_samples');
    const copies: string[] = [];
    if (e.frames.length !== FRAMES) copies.push(`the planted export holds ${e.frames.length} PNG frames, not ${FRAMES}`);
    else for (let k = 2; k < FRAMES; k += 2) copies.push(...twoCopiesFailures(e.frames[k]!, k));
    none(copies, 'the planted blur on even frames');
    failsNaming(exportFailures(e), ['frame 2:'], 'the export judge on a blur that quantizes each sample');
  }, TIMEOUT);
});
