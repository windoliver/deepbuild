// Criterion 4: "A load of 18,400 W, 5 times the rating, closed from step 0, opens a B16 at step 1. It opens a C16 and
// a D16 only by their thermal element, at 4.200 s within one step."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): a B16, a C16 and a D16 on the one
// source, each feeding its own 18,400 W load from step 0 (circuits.ts: CURVES), 1,000 steps a second, 4,300 steps, the
// program tallying the first step each breaker's `on` reads 0. By hand: 18,400 ÷ 230 = 80 A = 5 × 16. B's magnetic
// multiple 4 is under 5, so step 0's current opens it at the start of step 1; C's 7.5 and D's 15 are over it, so only
// the thermal element acts: θ reaches 1.69 at −60 ln(1 − 1.69 ÷ 25) = 4.1996 s (model.ts), step 4,200 within one. All
// three carry 80 A at step 0; circuit.breaker passes on the reference library. The wrong programs: one curve's
// multiple for all three, multiples read as A, a magnetic element on a C or D that acts at 5 times, and a B that waits
// for its heat.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild, show } from '../190/helpers.ts';
import { CURVES, index } from './circuits.ts';
import { AC, BREAKER, circuitLib, judgeCall, judged, nums, playbackCall, played, refPiece, rel, rule, tallies } from './helpers.ts';
import { BREAKER as CONSTANTS, thermalSteps, thermalTime } from './model.ts';

prebuild(() => { logicBin(); });

describe(`${AC[4]} five times the rating on B, C and D curves`, () => {
  it(`${AC[4]} a load of 18,400 W, 5 times the rating, closed from step 0, opens a B16 at step 1, and a C16 and a D16 only by their thermal element, at 4.200 s within one step`, () => {
    expect([18_400 / 230 / 16, CONSTANTS.magnetic.B < 5, CONSTANTS.magnetic.C > 5, CONSTANTS.magnetic.D > 5], '80 A is 5 times 16 A: past B\'s 4, under C\'s 7.5 and D\'s 15').toEqual([5, true, true, true]);
    expect([Math.abs(thermalTime(25) - 4.2) < 5e-4, thermalSteps(25, 1e-3).steps], `θ reaches 1.69 at ${thermalTime(25)} s, step 4,200`).toEqual([true, 4200]);

    const L = circuitLib();
    const p = refPiece(L, [CURVES]);
    const end = CURVES.steps - 1;
    const [play, judge] = onHost([playbackCall(p, CURVES, [0, 1, end]), judgeCall(p, CURVES)]);
    const at = played(play!, CURVES.item);
    const ids = ['cb_b', 'cb_c', 'cb_d'], parts = ids.map((id) => index(CURVES.circuit, id));
    expect(parts.map((q) => rel(nums(at.get(0), 'i_rms')[q]!, 80)).every((d) => d <= 1e-9), `at step 0 each carries 80 A: ${parts.map((q) => nums(at.get(0), 'i_rms')[q]).join(', ')}`).toBe(true);
    const t = tallies(at.get(end), CURVES);
    console.log(`${AC[4]} first step each reads on 0: B ${t['cb_b']!.first}, C ${t['cb_c']!.first}, D ${t['cb_d']!.first}`);
    expect(t['cb_b']!.first, 'the B16 opens at step 1').toBe(1);
    expect(parts.map((q) => nums(at.get(1), 'on')[q]), 'at step 1 the B16 reads 0 and the C16 and D16 still 1').toEqual([0, 1, 1]);
    for (const id of ['cb_c', 'cb_d']) expect(Math.abs(t[id]!.first - 4200), `the ${id === 'cb_c' ? 'C16' : 'D16'} opens at step ${t[id]!.first}: 4.200 s within one step`).toBeLessThanOrEqual(1);
    const r = rule(judged(judge!, CURVES.item), BREAKER);
    expect([r.verdict, r.fails], `circuit.breaker passes: each opened when its elements give: ${show(r.fails as never)}`).toEqual(['PASS', []]);
  }, TIMEOUT);
});
