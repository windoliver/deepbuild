// Criterion 10: "A resistor with `r: {set_by: <a slider>, range: [0, 2000]}` in series with the 60 W lamp, which is
// 881.67 Ω. At 0 Ω the lamp takes 60 W. At 881.67 Ω the loop carries 0.13043 A and the lamp and the resistor take 15 W
// each. A slider entry of 2,500 solves at 2,000 Ω and fails `circuit.range`, naming the resistor, `r` and the step."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): the resistor `dimmer` set by the
// slider `knob` (circuits.ts: DIMMER), 1,000 steps a second, 300 steps; `knob` reads 0 from step 0, the lamp's own
// 52,900 ÷ 60 = 881.67 Ω from step 100 and 2,500 from step 200. By hand: at 0 Ω the lamp has the whole 230 V, 60 W; at
// its own resistance each takes half, 115 V: 230 ÷ (2 × 881.67) = 0.13043 A and 115² ÷ 881.67 = 15 W each; 2,500 is
// held to 2,000 Ω, so 230 ÷ 2,881.67 = 0.079815 A. The resistor's `r` reads the value it solves at (README: The
// state). circuit.range fails, its first fail naming `dimmer`, `r` and step 200, and none before. The wrong programs:
// a set value read once at check or a step late, a solve kept from before the value changed, a value not held to its
// range (2,500 Ω solved), held to the other end, and a range rule that reads only the library's arrays.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, num, onHost, prebuild, show, str } from '../190/helpers.ts';
import { DIMMER, KNOB, LAMP, index } from './circuits.ts';
import { AC, RANGE, circuitLib, judgeCall, judged, nums, playbackCall, played, refPiece, rel, rule } from './helpers.ts';

prebuild(() => { logicBin(); });

describe(`${AC[10]} a sliding resistor`, () => {
  it(`${AC[10]} at 0 Ω the lamp takes 60 W; at 881.67 Ω the loop carries 0.13043 A and the lamp and the resistor take 15 W each; a slider entry of 2,500 solves at 2,000 Ω and fails circuit.range, naming the resistor, r and the step`, () => {
    expect([Math.abs(LAMP.ohms - 881.67) < 5e-3, Math.abs(230 / (2 * LAMP.ohms) - 0.13043) < 5e-6, Math.abs((230 / (2 * LAMP.ohms)) ** 2 * LAMP.ohms - 15) < 1e-12], '881.67 Ω, 0.13043 A, 15 W').toEqual([true, true, true]);

    const L = circuitLib();
    const p = refPiece(L, [DIMMER]);
    const read = [0, 50, 99, 100, 150, 199, 200, 250, 299];
    const [play, judge] = onHost([playbackCall(p, DIMMER, read), judgeCall(p, DIMMER)]);
    const at = played(play!, DIMMER.item);
    const [dimmer, lamp] = [index(DIMMER.circuit, 'dimmer'), index(DIMMER.circuit, 'lamp')];
    const r = (k: number) => nums(at.get(k), 'r'), w = (k: number) => nums(at.get(k), 'p'), i = (k: number) => nums(at.get(k), 'i_rms');
    for (const k of [0, 50, 99]) {
      expect([r(k)[dimmer], rel(w(k)[lamp]!, 60) <= 1e-9], `step ${k}: at 0 Ω (r ${r(k)[dimmer]}) the lamp takes 60 W: ${w(k)[lamp]}`).toEqual([0, true]);
    }
    for (const k of [100, 150, 199]) {
      expect(rel(r(k)[dimmer]!, KNOB.matched), `step ${k}: the resistor solves at 881.67 Ω: ${r(k)[dimmer]}`).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(i(k)[lamp]! - 0.13043), `step ${k}: the loop carries 0.13043 A: ${i(k)[lamp]}`).toBeLessThanOrEqual(5e-6);
      expect([rel(w(k)[lamp]!, 15) <= 1e-9, rel(w(k)[dimmer]!, 15) <= 1e-9], `step ${k}: the lamp and the resistor take 15 W each: ${w(k)[lamp]}, ${w(k)[dimmer]}`).toEqual([true, true]);
    }
    for (const k of [200, 250, 299]) {
      expect(r(k)[dimmer], `step ${k}: the slider's 2,500 solves at 2,000 Ω`).toBe(KNOB.held);
      expect(rel(i(k)[lamp]!, 230 / (KNOB.held + LAMP.ohms)), `step ${k}: 230 ÷ 2,881.67 = 0.079815 A: ${i(k)[lamp]}`).toBeLessThanOrEqual(1e-9);
    }
    const failed = rule(judged(judge!, DIMMER.item), RANGE);
    expect(failed.verdict, `circuit.range fails: ${show(failed.fails as never)}`).toBe('FAIL');
    const f = failed.fails[0]!;
    expect([str(f['part'], 'part'), str(f['field'], 'field'), num(f['step'], 'step')], `its first fail names the resistor, r and step 200, the slider's 2,500: ${show(f)}`).toEqual(['dimmer', 'r', KNOB.overAt]);
    expect(failed.fails.filter((x) => num(x['step'], 'a fail\'s step') < KNOB.overAt), 'and no fail before it: 0 and 881.67 Ω are inside the range').toEqual([]);
  }, TIMEOUT);
});
