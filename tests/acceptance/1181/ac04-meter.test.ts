// Criterion 4: "A meter on a 2,400 W kettle closed for 135 s reads 324,000 J and 0.09 kWh to 1e-9 relative, and
// `circuit.power` passes at every step. A planted meter that counts from the rated power while the kettle's switch is
// open fails `circuit.power`, naming the step."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): the kettle's circuit (circuits.ts:
// KITCHEN) at 120 steps a second, its switch's input `kettle_on` 0 from step 0, 1 from step 600 (5 s) and 0 from step
// 16,800 (140 s): closed for 16,200 steps, 135 s. By hand: a 2,400 W kettle on 230 V takes 2,400 W, and the meter adds
// 2,400 W × 1/120 s = 20 J a step it is closed, this step's included (README: The state and its arrays: energy): 0 J at
// step 599, 20 J at step 600, 16,200 × 20 = 324,000 J at step 16,799, which is 324,000 ÷ 3,600,000 = 0.09 kWh, and the
// same at the run's last step. The judge reads all 18,000 steps. Then the kit's planted library for circuit.power,
// linked by its own name (README: Planted twins: rated_meter), which counts the kettle's rated 2,400 W at every step,
// on the same piece: at step 0 the switch is open, the kettle takes 0 W and the meter reads 20 J, so circuit.power
// fails and its first fail names step 0, the meter and a gap of 20 J. The wrong programs: a meter that counts while
// open, counts a step's power twice or not at all, or counts kWh as J; and a power rule that never reads a meter.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, num, onHost, prebuild, show, str } from '../190/helpers.ts';
import { BOIL, BOILED, KITCHEN, index } from './circuits.ts';
import { AC, INTERFACE, POWER, circuitLib, fixturePiece, judgeCall, judged, nums, plantedPiece, playbackCall, played, rule } from './helpers.ts';
import { loadOhms } from './model.ts';

prebuild(() => { logicBin(); });

const rel = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);

describe(`${AC[4]} a meter on a kettle`, () => {
  it(`${AC[4]} a meter on a 2,400 W kettle closed for 135 s reads 324,000 J and 0.09 kWh to 1e-9 relative, and circuit.power passes at every step`, () => {
    expect([(BOIL.off - BOIL.on) / BOIL.rate, rel(230 ** 2 / loadOhms(2400, 230), 2400) < 1e-15, 2400 / BOIL.rate, (BOIL.off - BOIL.on) * BOILED.perStep, BOILED.joules / 3.6e6], 'closed for 135 s, 2,400 W, 20 J a step, 324,000 J, 0.09 kWh').toEqual([135, true, BOILED.perStep, BOILED.joules, BOILED.kwh]);

    const L = circuitLib();
    const p = fixturePiece(KITCHEN, INTERFACE, [L.ref], L.assets);
    const sampled = [0, BOIL.on - 1, BOIL.on, BOIL.off - 1, BOIL.off, BOIL.steps - 1];
    const [play, judge] = onHost([playbackCall(p, KITCHEN, sampled), judgeCall(p, KITCHEN)]);
    const at = played(play!, KITCHEN.item);
    const [sw, meter] = [index(KITCHEN.circuit, 'switch'), index(KITCHEN.circuit, 'meter')];
    const e = (k: number): number => nums(at.get(k), 'energy')[meter]!;
    const kwh = (k: number): number => nums(at.get(k), 'kwh')[meter]!;
    expect(sampled.map((k) => nums(at.get(k), 'on')[sw]), 'the switch is open, closed from step 600, open from step 16,800').toEqual([0, 0, 1, 1, 0, 0]);
    expect(Math.max(Math.abs(e(0)), Math.abs(e(BOIL.on - 1))), `the meter reads 0 J while the switch has been open: ${e(0)}, ${e(BOIL.on - 1)}`).toBeLessThanOrEqual(1e-9);
    expect(rel(e(BOIL.on), BOILED.perStep), `the first closed step adds 2,400 W × 1/120 s = 20 J: ${e(BOIL.on)}`).toBeLessThanOrEqual(1e-9);
    for (const k of [BOIL.off - 1, BOIL.off, BOIL.steps - 1]) {
      expect(rel(e(k), BOILED.joules), `step ${k}: after 135 s closed the meter reads ${e(k)} J: 324,000 J to 1e-9 relative`).toBeLessThanOrEqual(1e-9);
      expect(rel(kwh(k), BOILED.kwh), `step ${k}: and ${kwh(k)} kWh: 0.09 kWh to 1e-9 relative`).toBeLessThanOrEqual(1e-9);
    }
    const power = rule(judged(judge!, KITCHEN.item), POWER);
    expect([power.verdict, power.steps, power.fails], `circuit.power passes at every step, steps 0 to 17,999: ${show(power.fails as never)}`).toEqual(['PASS', KITCHEN.steps, []]);
  }, TIMEOUT);

  it(`${AC[4]} a planted meter that counts from the rated power while the kettle's switch is open fails circuit.power, naming the step`, () => {
    const L = circuitLib();
    const [bad] = onHost([judgeCall(plantedPiece(L, POWER, KITCHEN), KITCHEN)]);
    const failed = rule(judged(bad!, KITCHEN.item), POWER);
    expect(failed.verdict, `the planted meter fails circuit.power: ${show(failed.fails as never)}`).toBe('FAIL');
    const f = failed.fails[0]!;
    expect(num(f['step'], 'the first fail\'s step'), `its first fail names step 0, where the switch is open and the meter counts 2,400 W: ${show(f)}`).toBe(0);
    expect(str(f['meter'], 'the fail\'s meter'), `and the meter: ${show(f)}`).toBe('meter');
    expect(rel(Math.abs(num(f['gap'], 'the fail\'s gap')), BOILED.perStep), `and a gap of 20 J, a step of the rated power: ${show(f)}`).toBeLessThanOrEqual(1e-6);
  }, TIMEOUT);
});
