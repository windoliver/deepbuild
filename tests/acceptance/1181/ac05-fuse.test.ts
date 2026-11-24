// Criterion 5: "A 3 A fast fuse in series with a fault of 1 Ω from live to an earthed case on that 230 V source opens
// within the curve's time at 230 A, within one step; after it opens no part carries current; before the fault the
// earth wire carries 0 A at every step. A planted fuse that opens at 10 times its curve's time fails `circuit.fuse`,
// naming the fuse and the step."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): the fault's circuit (circuits.ts:
// FAULTY) at 100,000 steps a second (10 µs), the fault's input on from step 1,000, for 3,000 steps. The fast curve is
// README: The fuse curve's, t = 1 s × ln(I² ÷ (I² − 3²)): 170.12 µs at the 230.02 A the fuse carries (230 A through the
// fault, 0.02 A through the lamp; 170.15 µs at 230 A), 17.01 steps, so it opens at step 1,018; within one step is 1,017
// to 1,019. A 10 µs step is what lets one step resolve it: at 1 ms the curve's time and ten times it would both fall in
// the fault's first step. On the reference library: before step 1,000 the earth wire's current is 0 and the fuse
// carries the lamp's 0.02 A; from the fault until it opens, 230.02 A; from its opening step on, every part's current
// is 0 and the fuse stays open; circuit.fuse, circuit.kcl and circuit.power pass. Then the kit's planted library for
// circuit.fuse, linked by its own name (README: Planted twins: late_fuse), which opens at 10 times the curve's time,
// step 1,171: circuit.fuse fails, naming the fuse, the step it opened and the step its curve gives. The wrong
// programs: a fuse on instantaneous current, on another curve or a step-count clock, one that stays shut or opens
// early, current through an open fuse, an earth that leaks, and a fuse rule that reads no curve.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, num, onHost, prebuild, show, str } from '../190/helpers.ts';
import { BLOW, FAULTY, index } from './circuits.ts';
import { AC, FUSE, INTERFACE, KCL, POWER, circuitLib, fixturePiece, judgeCall, judged, nums, plantedPiece, playbackCall, played, rule } from './helpers.ts';
import { TAU, fuseStep, fuseTime } from './model.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: BLOW.steps }, (_, k) => k);
const rel = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);

describe(`${AC[5]} a fault to an earthed case blows the fuse`, () => {
  it(`${AC[5]} a 3 A fast fuse in series with a 1 Ω fault from live to an earthed case opens within the curve's time at 230 A, within one step; after it opens no part carries current; before the fault the earth wire carries 0 A at every step`, () => {
    expect([fuseStep(BLOW.fault, BLOW.amps, 3, TAU.fast, BLOW.rate), fuseStep(BLOW.fault, BLOW.faultAmps, 3, TAU.fast, BLOW.rate), BLOW.fault + Math.ceil(10 * fuseTime(BLOW.amps, 3, TAU.fast) * BLOW.rate)], `the curve's time at 230.02 A is ${fuseTime(BLOW.amps, 3, TAU.fast)} s: step 1,018, as at 230 A; ten times it, step 1,171`).toEqual([BLOW.opens, BLOW.opens, BLOW.late]);
    expect(Math.ceil(10 * fuseTime(BLOW.amps, 3, TAU.fast) * 1000) - Math.ceil(fuseTime(BLOW.amps, 3, TAU.fast) * 1000), 'at a 1 ms step the curve\'s time and ten times it would be one step apart').toBeLessThanOrEqual(1);

    const L = circuitLib();
    const p = fixturePiece(FAULTY, INTERFACE, [L.ref], L.assets);
    const [play, judge] = onHost([playbackCall(p, FAULTY, STEPS), judgeCall(p, FAULTY)]);
    const at = played(play!, FAULTY.item);
    const [fuse, fault, earth] = ['fuse', 'fault', 'earth'].map((id) => index(FAULTY.circuit, id)) as [number, number, number];
    const parts = FAULTY.circuit.parts.map((x) => x.id);

    const leaks = STEPS.slice(0, BLOW.fault).filter((k) => !(Math.abs(nums(at.get(k), 'i')[earth]!) <= 1e-9 && Math.abs(nums(at.get(k), 'i_rms')[earth]!) <= 1e-9));
    expect(leaks.slice(0, 10), 'before the fault the earth wire carries 0 A at every step').toEqual([]);
    expect(STEPS.slice(0, BLOW.fault).filter((k) => nums(at.get(k), 'on')[fuse] !== 1 || !(rel(nums(at.get(k), 'i_rms')[fuse]!, 0.02) <= 1e-9)).slice(0, 10), 'and the fuse is shut, carrying the lamp\'s 0.02 A').toEqual([]);

    const opened = STEPS.find((k) => nums(at.get(k), 'on')[fuse] === 0);
    expect(opened, 'the fuse opens').toBeDefined();
    expect(Math.abs(opened! - BLOW.opens), `it opens at step ${opened}: within one step of 1,018, the curve's time at 230 A after the fault`).toBeLessThanOrEqual(1);
    const carried = STEPS.slice(BLOW.fault, opened).filter((k) => !(rel(nums(at.get(k), 'i_rms')[fuse]!, BLOW.amps) <= 1e-9 && rel(nums(at.get(k), 'i_rms')[fault]!, BLOW.faultAmps) <= 1e-9));
    expect(carried.slice(0, 10), 'from the fault until it opens the fault takes 230 A and the fuse 230.02 A').toEqual([]);
    const after = STEPS.slice(opened).flatMap((k) => {
      const a = at.get(k);
      const live = parts.filter((_, q) => !(Math.abs(nums(a, 'i')[q]!) <= 1e-9 && Math.abs(nums(a, 'i_rms')[q]!) <= 1e-9));
      return [...(live.length ? [`step ${k}: ${live.join(', ')} carry current`] : []), ...(nums(a, 'on')[fuse] !== 0 ? [`step ${k}: the fuse is shut again`] : [])];
    });
    expect(after.slice(0, 10), 'after it opens no part carries current, and it stays open').toEqual([]);

    const j = judged(judge!, FAULTY.item);
    for (const code of [FUSE, KCL, POWER]) {
      const r = rule(j, code);
      expect([r.verdict, r.steps, r.fails], `${code} passes on the reference library over the 3,000 steps: ${show(r.fails as never)}`).toEqual(['PASS', FAULTY.steps, []]);
    }
  }, TIMEOUT);

  it(`${AC[5]} a planted fuse that opens at 10 times its curve's time fails circuit.fuse, naming the fuse and the step`, () => {
    const L = circuitLib();
    const [bad] = onHost([judgeCall(plantedPiece(L, FUSE, FAULTY), FAULTY)]);
    const failed = rule(judged(bad!, FAULTY.item), FUSE);
    expect(failed.verdict, `the planted fuse fails circuit.fuse: ${show(failed.fails as never)}`).toBe('FAIL');
    const named = failed.fails.filter((f) => f['fuse'] === 'fuse');
    expect(named.length, `a fail names the fuse: ${show(failed.fails as never)}`).toBeGreaterThan(0);
    const f = named[0]!;
    expect(Math.abs(num(f['step'], 'the fail\'s step') - BLOW.late), `and the step it opened, 1,171 within one step (10 times the curve's time): ${show(f)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(num(f['expected'], 'the fail\'s expected step') - BLOW.opens), `and the step its curve gives, 1,018 within one step: ${show(f)}`).toBeLessThanOrEqual(1);
    expect(str(f['fuse'], 'fuse'), 'by its part ID').toBe('fuse');
  }, TIMEOUT);
});
