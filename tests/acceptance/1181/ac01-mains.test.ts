// Criterion 1: "A 230 V rms, 50 Hz AC source through a closed connector into a load rated 4.6 W at 230 V, at a 1/1000 s
// step: the load's resistance is 11,500 Ω, its rms current 0.02 A and its power 4.6 W, each to 1e-12 relative; its
// instantaneous current at step 5 (t = 5 ms) is 0.02 × √2 = 0.028284 A to 1e-9 A; and `circuit.kcl` and
// `circuit.power` pass at every step of 10 s."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): the lamp's circuit (circuits.ts:
// PLUGGED), the plug in from step 0, at 1,000 steps a second, linking circuit@1's reference library through the
// interface. By hand: R = 230² ÷ 4.6 = 11,500 Ω, I = 230 ÷ 11,500 = 0.02 A, P = 4.6 W; at t = 5 ms the sine is at its
// crest, sin(2π × 50 × 0.005) = 1, so i = 0.02 × √2. The judge reads every step from 0 to 10,000 (t = 0 to 10 s). The
// wrong programs: a resistance from another formula (v ÷ p, or v_rated² × p_rated), a current from the rated power
// alone, an instantaneous value at another phase or time (a step off, or t = (k + 1) ÷ rate), a value that isn't √2 ×
// the rms, and a judge that passes nothing or fails a right run.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild, show } from '../190/helpers.ts';
import { LAMP, PLUGGED, index } from './circuits.ts';
import { AC, INTERFACE, KCL, POWER, circuitLib, fixturePiece, judgeCall, judged, nums, playbackCall, played, rule } from './helpers.ts';
import { loadOhms } from './model.ts';

prebuild(() => { logicBin(); });

const rel = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);

describe(`${AC[1]} a lamp on the mains through a closed plug`, () => {
  it(`${AC[1]} a 230 V rms, 50 Hz source through a closed connector into a 4.6 W load at 1/1000 s: 11,500 Ω, 0.02 A rms, 4.6 W, 0.028284 A at step 5, and circuit.kcl and circuit.power pass at every step of 10 s`, () => {
    // The values worked by hand.
    expect(rel(loadOhms(4.6, 230), LAMP.ohms), 'v_rated² ÷ p_rated = 11,500 Ω').toBeLessThan(1e-15);
    expect(Math.max(rel(230 / LAMP.ohms, LAMP.amps), rel(LAMP.amps * 230, LAMP.watts)), '230 V ÷ 11,500 Ω = 0.02 A, × 230 V = 4.6 W').toBeLessThan(1e-15);
    expect(Math.abs(LAMP.peak * Math.sin(2 * Math.PI * 50 * 0.005) - 0.028284), 'at 5 ms the wave is at its crest: 0.02 × √2 = 0.028284 A').toBeLessThan(5e-7);

    const L = circuitLib();
    const p = fixturePiece(PLUGGED, INTERFACE, [L.ref], L.assets);
    const [play, judge] = onHost([playbackCall(p, PLUGGED, [0, 4, 5, 6, 5000, PLUGGED.steps - 1]), judgeCall(p, PLUGGED)]);
    const at = played(play!, PLUGGED.item);
    const lamp = index(PLUGGED.circuit, 'lamp');
    for (const k of [0, 4, 5, 6, 5000, PLUGGED.steps - 1]) {
      const a = at.get(k);
      expect(rel(nums(a, 'r')[lamp]!, LAMP.ohms), `step ${k}: the load's resistance ${nums(a, 'r')[lamp]} Ω is 11,500 Ω to 1e-12 relative`).toBeLessThanOrEqual(1e-12);
      expect(rel(nums(a, 'i_rms')[lamp]!, LAMP.amps), `step ${k}: its rms current ${nums(a, 'i_rms')[lamp]} A is 0.02 A to 1e-12 relative`).toBeLessThanOrEqual(1e-12);
      expect(rel(nums(a, 'p')[lamp]!, LAMP.watts), `step ${k}: its power ${nums(a, 'p')[lamp]} W is 4.6 W to 1e-12 relative`).toBeLessThanOrEqual(1e-12);
    }
    const i5 = nums(at.get(5), 'i')[lamp]!;
    expect(Math.abs(i5 - LAMP.peak), `its instantaneous current at step 5 (t = 5 ms), ${i5} A, is 0.02 × √2 = 0.028284 A to 1e-9 A`).toBeLessThanOrEqual(1e-9);
    // Steps 4 and 6 sit on either side of the crest, equally: a value a step off can't stand in for step 5's.
    const [i4, i6] = [nums(at.get(4), 'i')[lamp]!, nums(at.get(6), 'i')[lamp]!];
    expect([Math.abs(i4 - LAMP.peak * Math.sin(0.4 * Math.PI)), Math.abs(i6 - LAMP.peak * Math.sin(0.6 * Math.PI))].every((d) => d <= 1e-9), `at steps 4 and 6 it is 0.02√2 sin(0.4π) and sin(0.6π): ${i4}, ${i6}`).toBe(true);

    const j = judged(judge!, PLUGGED.item);
    for (const code of [KCL, POWER]) {
      const r = rule(j, code);
      expect([r.verdict, r.steps, r.fails], `${code} passes at every step of 10 s, steps 0 to 10,000: ${show(r.fails as never)}`).toEqual(['PASS', PLUGGED.steps, []]);
    }
  }, TIMEOUT);
});
