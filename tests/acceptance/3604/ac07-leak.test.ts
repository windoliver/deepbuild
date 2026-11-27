// Criterion 7: "A fault of 2,000 Ω from the lamp's live side to an earth node, joined to node 0 by a resistor of 0 Ω,
// is closed by an input. From the first step that carries it `residual` reads 0.115 A, 3.8333 times the rating, and
// both poles open 52.17 ms later, within one step. After that the lamp and the fault carry 0 A. [The 101 kΩ sentence
// is hours.test.ts'.] With no fault, `test_by` on a `test_r` of 3,000 Ω gives a `residual` of 76.667 mA, and both
// poles open 78.26 ms later, within one step."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): the lamp behind a 30 mA RCD with a
// test path of 3,000 Ω and the fault (circuits.ts: LEAK_CIRCUIT), 1,000 steps a second, 300 steps: LEAKING closes the
// fault at step 100, TESTED presses `test` at step 100 with no fault. By hand: 230 ÷ 2,000 = 0.115 A leave by the
// earth, so the poles' sum is 0.115 A, 3.8333 times 0.03; the count rises by 1 ms ÷ (0.2 × 0.03 ÷ 0.115 = 52.17 ms) a
// step, so the RCD opens 52.17 ms after the first step that carries the fault, within one step: step 100 + 52 or 53.
// The test path from the load-side live to the supply-side neutral bypasses the neutral pole: 230 ÷ 3,000 = 76.667
// mA, 78.26 ms. On the reference library: before k the residual is 0; from k until the RCD opens it is the fault's
// within 1e-9 relative and the poles read on 1; the step `on` first reads 0 is within one of k + 52.17 (k + 78.26);
// from then the lamp, the fault (the test path) carry 0 A within 1e-9; circuit.rcd, circuit.kcl and circuit.power
// pass. The wrong programs: a residual from one pole or from the lamp, a count that doesn't scale with the residual,
// one that opens on the first step at or above the rating, a test path that returns through the neutral pole, and
// current through an open RCD.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild, show } from '../190/helpers.ts';
import { LEAKED, LEAKING, LEAK_CIRCUIT, TESTED, index, type Fix } from './circuits.ts';
import { AC, KCL, POWER, RCD, circuitLib, judgeCall, judged, nums, playbackCall, played, refPiece, rel, rule } from './helpers.ts';
import { rcdTime } from './model.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: LEAKING.steps }, (_, k) => k);
const [rcd, lamp, leak] = ['rcd', 'lamp', 'leak'].map((id) => index(LEAK_CIRCUIT, id)) as [number, number, number];

/** One run of `f`: the RCD's residual from its first step, the step it opens, and the parts after. */
function opens(f: Fix, residual: number, after: number, path: number[]): void {
  const L = circuitLib();
  const p = refPiece(L, [f]);
  const [play, judge] = onHost([playbackCall(p, f, STEPS), judgeCall(p, f)]);
  const at = played(play!, f.item);
  const k = STEPS.find((s) => nums(at.get(s), 'residual')[rcd]! > 1e-9);
  expect(k, `the first step that carries it is the step its input closes it, ${LEAKED.k}`).toBe(LEAKED.k);
  expect(STEPS.slice(0, k).filter((s) => Math.abs(nums(at.get(s), 'residual')[rcd]!) > 1e-12).slice(0, 5), 'before it the residual reads 0').toEqual([]);
  const opened = STEPS.find((s) => nums(at.get(s), 'on')[rcd] === 0);
  console.log(`${f.item}: residual ${nums(at.get(k!), 'residual')[rcd]} A from step ${k}; the RCD opened at step ${opened}`);
  expect(opened, 'both poles open').toBeDefined();
  expect(STEPS.slice(k, opened).filter((s) => !(rel(nums(at.get(s), 'residual')[rcd]!, residual) <= 1e-9)).map((s) => `step ${s}: ${nums(at.get(s), 'residual')[rcd]}`).slice(0, 5), `from step ${k} until they open residual reads ${residual} A`).toEqual([]);
  expect(Math.abs(opened! - (k! + after)), `they open at step ${opened}: ${after} ms after step ${k}, within one step`).toBeLessThanOrEqual(1);
  const lit = STEPS.slice(opened).flatMap((s) => [lamp, ...path].filter((q) => !(Math.abs(nums(at.get(s), 'i')[q]!) <= 1e-9 && Math.abs(nums(at.get(s), 'i_rms')[q]!) <= 1e-9)).map((q) => `step ${s}: ${LEAK_CIRCUIT.parts[q]!.id}`));
  expect(lit.slice(0, 10), 'after that the lamp and the fault carry 0 A').toEqual([]);
  const j = judged(judge!, f.item);
  for (const code of [RCD, KCL, POWER]) expect([rule(j, code).verdict, rule(j, code).fails], `${code} passes: ${show(rule(j, code).fails as never)}`).toEqual(['PASS', []]);
}

describe(`${AC[7]} current that doesn't come back`, () => {
  it(`${AC[7]} a 2,000 Ω fault to an earth node closed by an input: from the first step that carries it residual reads 0.115 A, 3.8333 times the rating, and both poles open 52.17 ms later within one step; after that the lamp and the fault carry 0 A`, () => {
    expect([230 / 2000, Math.abs(230 / 2000 / 0.03 - 3.8333) < 5e-5, Math.abs(rcdTime(0.115, 0.03) * 1000 - LEAKED.opensAfter) < 5e-3], '0.115 A, 3.8333 times 30 mA, 52.17 ms').toEqual([LEAKED.residual, true, true]);
    opens(LEAKING, LEAKED.residual, LEAKED.opensAfter, [leak]);
  }, TIMEOUT);

  it(`${AC[7]} with no fault, test_by on a test_r of 3,000 Ω gives a residual of 76.667 mA, and both poles open 78.26 ms later within one step`, () => {
    expect([Math.abs(LEAKED.test - 0.076667) < 5e-7, Math.abs(rcdTime(LEAKED.test, 0.03) * 1000 - LEAKED.testOpensAfter) < 5e-3], '76.667 mA, 78.26 ms').toEqual([true, true]);
    opens(TESTED, LEAKED.test, LEAKED.testOpensAfter, []);
  }, TIMEOUT);
});
