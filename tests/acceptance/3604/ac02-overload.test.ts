// Criterion 2: "With loads of 2,000 W, 3,000 W and 1,000 W closed together from step 0, the breaker carries 26.087 A,
// 1.6304 times its rating, and opens at 60.593 s, within one step. From then no part carries current, and
// `circuit.kcl` and `circuit.power` pass at every step. Feeding 9,384 W, 2.55 times its rating, it opens at 18.058 s,
// within one step."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): one piece of two items at 1,000
// steps a second for 61,000 steps (circuits.ts: THREE and HEAVY), each a B16 feeding its loads from step 0, each
// program tallying the first step its breaker's `on` reads 0 (README: Programs: tallies). By hand (model.ts): x =
// 6,000 ÷ 230 ÷ 16 = 1.6304, θ(t) = x² (1 − e^(−t/60)) reaches 1.69 at t = −60 ln(1 − 1.69 ÷ x²) = 60.5933 s; at
// x = 9,384 ÷ 230 ÷ 16 = 2.55, 18.0582 s. "Within one step" is the step `on` first reads 0, within one of 60,593 and of
// 18,058. From then, steps 60,585 to 60,999 are read: every part's `i` and `i_rms` 0 within 1e-9 A from the opening
// step on; the judge reads every step of both items. The wrong programs: a breaker on fuse's τ, on the instantaneous
// current, opening at θ 1 or held past 1.69, a thermal element that counts steps not seconds, current through an open
// breaker, and a kcl or power rule blind to the new parts.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild, show } from '../190/helpers.ts';
import { HEAVY, OVERLOAD, THREE, index } from './circuits.ts';
import { AC, BREAKER as BREAKER_RULE, KCL, POWER, circuitLib, judgeCall, judged, nums, playbackCall, played, refPiece, rel, rule, tallies } from './helpers.ts';
import { thermalSteps, thermalTime } from './model.ts';

prebuild(() => { logicBin(); });

const WINDOW = Array.from({ length: OVERLOAD.steps - OVERLOAD.window }, (_, j) => OVERLOAD.window + j);

describe(`${AC[2]} an overload trips a B16 on its thermal element`, () => {
  it(`${AC[2]} with 2,000 W, 3,000 W and 1,000 W from step 0 the breaker carries 26.087 A, 1.6304 times its rating, and opens at 60.593 s within one step; from then no part carries current, circuit.kcl and circuit.power pass at every step; feeding 9,384 W, 2.55 times, it opens at 18.058 s within one step`, () => {
    const [x, y] = [6000 / 230 / 16, 9384 / 230 / 16];
    expect([Math.abs(6000 / 230 - 26.087) < 5e-4, Math.abs(x - 1.6304) < 5e-5, Math.abs(y - 2.55) < 1e-12], '26.087 A, 1.6304 and 2.55 times 16 A').toEqual([true, true, true]);
    expect([Math.abs(thermalTime(x * x) - 60.593) < 5e-4, Math.abs(thermalTime(y * y) - 18.058) < 5e-4], `the closed form gives ${thermalTime(x * x)} s and ${thermalTime(y * y)} s`).toEqual([true, true]);
    expect([thermalSteps(x * x, 1e-3).steps, thermalSteps(y * y, 1e-3).steps], 'the heat moved step by step opens it at steps 60,594 and 18,059').toEqual([60_594, 18_059]);

    const L = circuitLib();
    const p = refPiece(L, [THREE, HEAVY]);
    const [play, judge] = onHost([playbackCall(p, THREE, [0, ...WINDOW]), judgeCall(p, THREE)]);
    const three = played(play!, THREE.item), heavy = played(play!, HEAVY.item);
    const main = index(THREE.circuit, 'main');
    expect(rel(nums(three.get(0), 'i_rms')[main]!, 6000 / 230), `at step 0 the breaker carries 26.087 A: ${nums(three.get(0), 'i_rms')[main]}`).toBeLessThanOrEqual(1e-9);
    expect(rel(nums(heavy.get(0), 'i_rms')[main]!, 9384 / 230), `and the other 40.8 A: ${nums(heavy.get(0), 'i_rms')[main]}`).toBeLessThanOrEqual(1e-9);

    const end = OVERLOAD.steps - 1;
    const opened = tallies(three.get(end), THREE)['main']!.first, other = tallies(heavy.get(end), HEAVY)['main']!.first;
    console.log(`${AC[2]} the three loads' breaker opened at step ${opened}, the 9,384 W one at ${other}`);
    expect(Math.abs(opened - 60_593), `the breaker opens at step ${opened}: 60.593 s within one step`).toBeLessThanOrEqual(1);
    expect(Math.abs(other - 18_058), `feeding 9,384 W it opens at step ${other}: 18.058 s within one step`).toBeLessThanOrEqual(1);

    const parts = THREE.circuit.parts.map((q) => q.id);
    const carrying = WINDOW.filter((k) => k >= opened).flatMap((k) => {
      const a = three.get(k);
      const live = parts.filter((_, q) => !(Math.abs(nums(a, 'i')[q]!) <= 1e-9 && Math.abs(nums(a, 'i_rms')[q]!) <= 1e-9));
      return live.length || nums(a, 'on')[main] !== 0 ? [`step ${k}: on ${nums(a, 'on')[main]}, carrying: ${live.join(', ')}`] : [];
    });
    expect(carrying.slice(0, 10), `from step ${opened} to ${end} the breaker stays open and no part carries current`).toEqual([]);

    for (const id of [THREE.item, HEAVY.item]) {
      const j = judged(judge!, id);
      for (const code of [KCL, POWER, BREAKER_RULE]) {
        const r = rule(j, code);
        expect([r.verdict, r.steps, r.fails], `${id}: ${code} passes at every one of the ${THREE.steps} steps: ${show(r.fails as never)}`).toEqual(['PASS', THREE.steps, []]);
      }
    }
  }, TIMEOUT);
});
