// Criterion 11: "With the source's `v_rms` and `f` and the lamp's `v_rated` set by controls that read 120, 60 and 120,
// the lamp carries 0.5 A rms, and its instantaneous current at step 5 is 0.67250 A within 1e-5 A."
//
// Through `deep-logic first_party` and `playback` (README: The surface): the source's `v_rms` set by `volts` within
// [0, 250], its `f` by `hertz` within [1, 100], and the 60 W lamp's `v_rated` by `rated` within [1, 250] (circuits.ts:
// SET), each control reading its value from step 0, 1,000 steps a second, 20 steps. By hand: the lamp is 120² ÷ 60 =
// 240 Ω, so 120 ÷ 240 = 0.5 A rms; at step 5, t = 5 ms, the wave is at 60 × 0.005 = 0.3 turns, so i = 0.5 × √2 ×
// sin(0.6π) = 0.67250 A. The lamp's `r` reads 240 Ω. The wrong programs: a number field kept at its value at check
// (no number to keep: each is set), a frequency of 50 or a phase from the wrong f, the lamp's resistance from 230 V,
// and a set value read a step late (step 0 would read 0, held to its range's low end).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild } from '../190/helpers.ts';
import { SET, index } from './circuits.ts';
import { AC, circuitLib, nums, playbackCall, played, refPiece, rel } from './helpers.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: SET.steps }, (_, k) => k);

describe(`${AC[11]} a supply a viewer's settings name`, () => {
  it(`${AC[11]} with v_rms, f and the lamp's v_rated set by controls reading 120, 60 and 120, the lamp carries 0.5 A rms, and 0.67250 A within 1e-5 A at step 5`, () => {
    const i5 = 0.5 * Math.SQRT2 * Math.sin(2 * Math.PI * 60 * 0.005);
    expect([(120 * 120) / 60, 120 / 240, Math.abs(i5 - 0.6725) < 5e-6], '240 Ω, 0.5 A, 0.67250 A').toEqual([240, 0.5, true]);

    const L = circuitLib();
    const [play] = onHost([playbackCall(refPiece(L, [SET]), SET, STEPS)]);
    const at = played(play!, SET.item);
    const lamp = index(SET.circuit, 'lamp');
    expect(STEPS.filter((k) => !(rel(nums(at.get(k), 'i_rms')[lamp]!, 0.5) <= 1e-9 && rel(nums(at.get(k), 'r')[lamp]!, 240) <= 1e-9)).map((k) => `step ${k}: ${nums(at.get(k), 'i_rms')[lamp]} A, ${nums(at.get(k), 'r')[lamp]} Ω`), 'at every step the lamp is 240 Ω and carries 0.5 A rms').toEqual([]);
    const i = nums(at.get(5), 'i')[lamp]!;
    expect(Math.abs(i - 0.6725), `its instantaneous current at step 5, ${i} A, is 0.67250 A within 1e-5 A`).toBeLessThanOrEqual(1e-5);
  }, TIMEOUT);
});
