// Criterion 6, its planted library: "A planted library that reads the live pole alone opens within 0.03 s and fails
// `circuit.rcd`, naming the RCD and the step." (Its first half, the lamp held for 3,600 s, is hours.test.ts'.)
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): a 60 W lamp behind a 30 mA RCD
// (circuits.ts: RCD_LAMP), 1,000 steps a second, 100 steps. By hand: each pole carries 60 ÷ 230 = 0.26087 A and they
// sum to 0, so the reference library's count stays 0 and it never opens; read from the live pole alone the "residual"
// is 0.26087 A, 8.7 times 30 mA, so its count rises by 1 ms ÷ (0.2 s × 0.03 ÷ 0.26087 = 23 ms) a step and it opens about
// 23 ms in (model.ts). On the reference library the RCD reads on 1 at every step and circuit.rcd passes; the planted
// library `one_pole`, linked by its own name, opens at a step within 30 (0.03 s), and circuit.rcd fails naming `rcd`
// and that step. The wrong programs: an RCD that reads one pole, and an rcd rule that reads the library's residual
// instead of the poles' currents.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, num, onHost, prebuild, show } from '../190/helpers.ts';
import { LAMP, RCD_LAMP, index } from './circuits.ts';
import { AC, RCD, circuitLib, judgeCall, judged, nums, plantedPiece, playbackCall, played, refPiece, rule } from './helpers.ts';
import { rcdSteps, rcdTime } from './model.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: RCD_LAMP.steps }, (_, k) => k);
const rcd = index(RCD_LAMP.circuit, 'rcd');

describe(`${AC[6]} an RCD that reads one pole`, () => {
  it(`${AC[6]} a planted library that reads the live pole alone opens within 0.03 s and fails circuit.rcd, naming the RCD and the step`, () => {
    expect([Math.abs(rcdTime(LAMP.amps, 0.03) - 0.023) < 1e-12, rcdSteps(LAMP.amps, 0.03, 1e-3) <= 30], `read from one pole the count reaches 1 after ${rcdTime(LAMP.amps, 0.03)} s, ${rcdSteps(LAMP.amps, 0.03, 1e-3)} steps: within 0.03 s`).toEqual([true, true]);

    const L = circuitLib();
    const reference = refPiece(L, [RCD_LAMP]);
    const planted = plantedPiece(L, 'one_pole', RCD_LAMP);
    const [refPlay, refJudge, play, judge] = onHost([playbackCall(reference, RCD_LAMP, STEPS), judgeCall(reference, RCD_LAMP), playbackCall(planted, RCD_LAMP, STEPS), judgeCall(planted, RCD_LAMP)]);
    const ref = played(refPlay!, RCD_LAMP.item);
    expect(STEPS.filter((k) => nums(ref.get(k), 'on')[rcd] !== 1).slice(0, 5), 'the reference library\'s RCD stays closed at every step').toEqual([]);
    const passed = rule(judged(refJudge!, RCD_LAMP.item), RCD);
    expect([passed.verdict, passed.fails], `and circuit.rcd passes on it: ${show(passed.fails as never)}`).toEqual(['PASS', []]);

    const at = played(play!, RCD_LAMP.item);
    const opened = STEPS.find((k) => nums(at.get(k), 'on')[rcd] === 0);
    console.log(`${AC[6]} the planted RCD opened at step ${opened}`);
    expect(opened, 'the planted library\'s RCD opens').toBeDefined();
    expect(opened!, `it opens at step ${opened}: within 0.03 s`).toBeLessThanOrEqual(30);
    const failed = rule(judged(judge!, RCD_LAMP.item), RCD);
    expect(failed.verdict, `circuit.rcd fails: ${show(failed.fails as never)}`).toBe('FAIL');
    const f = failed.fails.find((x) => x['rcd'] === 'rcd' && typeof x['step'] === 'number');
    expect(f, `a fail names the RCD, rcd, and a step: ${show(failed.fails as never)}`).toBeDefined();
    expect(num(f!['step'], 'the fail\'s step'), `the step it opened, ${opened}: ${show(f!)}`).toBe(opened);
  }, TIMEOUT);
});
