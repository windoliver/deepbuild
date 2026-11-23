// AC2 #2054.e44715ba: "Three white diffuse squares each face that 800 lm point light with range 5, at 2 m, 4 m and 6 m
// in three directions, with no other light. The square at 4 m reads 9.18% of the linear radiance of the square at 2 m,
// within 0.2 points (drafted), and the square at 6 m reads 0 from the light. A planted recipe that drops the range
// reads 25.0% and a lit third square, and a planted window of `(1 − (d ÷ range)²)²` reads 4.6%. Each fails, naming
// the square"
//
// fixtures/light-range.json `ac2`: the engine's point light word (godot.omni_light_3d@1, 800 lm, omni_range 5, at
// (0, 1.5, 0)) is expanded by `deep-show run` through the pack's next minor, and the light it expanded to is drawn as
// expanded by `deep-gpu`'s view3d before three white matte slabs, sq_2m, sq_4m and sq_6m, whose faces stand square to
// the lamp 2 m, 4 m and 6 m away at −30°, 0° and 30° from −Z, under a black sky with no ambient light. The view is a
// pinhole at the lamp looking down −Z, so each face is seen square on where it is nearest the lamp; a square reads the
// mean linear radiance over the 3 × 3 pixels there, every one of which the object-ID target shows as that square.
// The 4 m square's share of the 2 m square's must be 9.18% within 0.2 points ((1/4) (1 − 0.8⁴)² ÷ (1 − 0.4⁴)² =
// 9.178%), and the 6 m square must read at most 1e-5. Frame readings count on a reference Mac and are INCONCLUSIVE
// elsewhere (the issue's Runs on line).
// Wrong programs: the base (no such pack version, so no lamp); scenario `planted: "range_word_dropped"`, whose light
// takes our automatic 35.68 m: 25.0% and a lit sq_6m, failing naming sq_4m and sq_6m; `deep-gpu --planted
// light_window_squared`, the renderer fading a local light by (1 − (d ÷ range)²)²: 4.6%, failing naming sq_4m; a
// window of d rather than d²; the inverse square dropped or applied twice.

import { describe, expect, it } from 'vitest';
import { failsNaming, none, obj, useDir, useShow } from '../433/helpers.ts';
import { useGpu } from '../1634/helpers.ts';
import { AC, FIXTURE, SLOW, onReferenceMac, pct, readSquares } from './helpers.ts';

const show = useShow();
const gpu = useGpu();
const dir = useDir();
const AC2 = obj(FIXTURE['ac2'], 'ac2');
const SHARE = obj(AC2['share'], 'ac2.share');

describe(`${AC[2]} three squares under the lamp's range`, () => {
  it(`${AC[2]} the square at 4 m reads 9.18% of the linear radiance of the square at 2 m within 0.2 points, and the square at 6 m reads 0 from the light`, () => {
    onReferenceMac();
    none(readSquares(show(), gpu(), dir()).failures, 'the three squares');
  }, SLOW);

  it(`${AC[2]} the planted range_word_dropped reads 25.0% and a lit third square, and fails, naming the squares`, () => {
    onReferenceMac();
    const r = readSquares(show(), gpu(), dir(), { planted: 'range_word_dropped' });
    failsNaming(r.failures, ['sq_4m', 'sq_6m'], 'the planted range_word_dropped');
    expect(pct(r.share), 'sq_4m\'s share of sq_2m under our automatic range, %').toBe(SHARE['dropped']);
    expect((r.reads.get('sq_6m') ?? 0) > (AC2['dark'] as number), `sq_6m is lit under our automatic range: it reads ${r.reads.get('sq_6m')}`).toBe(true);
  }, SLOW);

  it(`${AC[2]} the planted window (1 − (d ÷ range)²)² (light_window_squared) reads 4.6% and fails, naming the square`, () => {
    onReferenceMac();
    const r = readSquares(show(), gpu(), dir(), { gpuPlanted: 'light_window_squared' });
    failsNaming(r.failures, ['sq_4m'], 'the planted light_window_squared');
    expect(pct(r.share), 'sq_4m\'s share of sq_2m under the squared window, %').toBe(SHARE['squared']);
  }, SLOW);
});
