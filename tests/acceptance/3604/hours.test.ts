// The hour: criterion 1 whole, and criterion 6's and criterion 7's parts that run 3,600 s. One run serves all three.
//
// Criterion 1: "A B16 breaker feeding a 2,000 W load carries 8.6957 A. Its `heat` settles at 0.29537 within 1e-5 and
// `on` reads 1 at every step of 3,600 s. Feeding 4,158.4 W, 1.13 times its rating, it also holds for 3,600 s, with
// `heat` settling at 1.2769."
// Criterion 6, its first half: "A 60 W lamp behind a 30 mA RCD carries 0.26087 A on each pole. `residual` reads 0
// within 1e-12 A and both poles stay closed for 3,600 s."
// Criterion 7, its 101 kΩ sentence: "A fault of 101,000 Ω gives a `residual` of 2.2772 mA and the RCD holds for
// 3,600 s."
//
// Through `deep-logic first_party` and `playback` (README: The surface): the hour's circuit (circuits.ts: HOURS), each
// branch on the one ideal source and so its own circuit, solved 125 circuit steps of 1 ms a logic step at 8 Hz for
// 28,801 logic steps, 3,600,000 circuit steps. Its program tallies every circuit step it solves (README: Programs:
// tallies): how many steps each breaker's and each RCD's `on` read other than 1, and the largest |residual| of each
// RCD and the largest heat of the 1.13 times breaker. By hand: 2,000 ÷ 230 = 8.6957 A, (8.6957 ÷ 16)² = 0.295369;
// 4,158.4 ÷ 230 = 18.08 A = 1.13 × 16, 1.13² = 1.2769, under 1.69, so θ = x² (1 − e^(−t/60)) settles there and never
// opens it; the lamp 60 ÷ 230 = 0.26087 A through both poles of its RCD, which sum to 0; 230 ÷ 101,000 = 2.2772 mA,
// under 30 mA, so the count never rises. The wrong programs: a breaker on another curve, τ or limit (one that opens at
// 1.13 times, say at θ ≥ 1.2769), heat that settles elsewhere or isn't the thermal element's, an RCD that reads one
// pole, another rating, or rms of the sum taken wrongly, and one that trips under its rating.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild, type JsonObject } from '../190/helpers.ts';
import { HOUR, HOURS, LAMP, index } from './circuits.ts';
import { AC, circuitLib, nums, peakOf, playbackCall, played, refPiece, rel, tallies, type Arrays } from './helpers.ts';
import { BREAKER, heatAfter } from './model.ts';

prebuild(() => { logicBin(); });

/** The logic steps read: the first few, each hour's quarter, and the last (3,600 s). */
const READ = [0, 1, 2, 8, 7200, 14_400, 21_600, HOUR.last];
let run: Map<number, Arrays> | undefined;
/** The one playback of the hour, once per file. */
function hour(): Map<number, Arrays> {
  if (run) return run;
  const L = circuitLib();
  const [reply] = onHost([playbackCall(refPiece(L, [HOURS]), HOURS, READ)]);
  run = played(reply as JsonObject, HOURS.item);
  return run;
}
const at = (k: number): Arrays => hour().get(k)!;
const part = (id: string): number => index(HOURS.circuit, id);
const last = (): Arrays => at(HOUR.last);

describe(`${AC[1]} ${AC[6]} ${AC[7]} an hour on the mains`, () => {
  it(`${AC[1]} a B16 feeding 2,000 W carries 8.6957 A, its heat settles at 0.29537 within 1e-5 and on reads 1 at every step of 3,600 s; feeding 4,158.4 W, 1.13 times its rating, it holds too, heat settling at 1.2769`, () => {
    // The values worked by hand.
    const [x1, x2] = [2000 / 230 / 16, 4158.4 / 230 / 16];
    expect([Math.abs(2000 / 230 - 8.6957) < 5e-5, Math.abs(x2 - 1.13) < 1e-12, Math.abs(x1 * x1 - 0.29537) < 1e-5, Math.abs(x2 * x2 - 1.2769) < 1e-12], '8.6957 A, 1.13 times, 0.29537 and 1.2769').toEqual([true, true, true, true]);
    expect([heatAfter(x2 * x2, 3600) < BREAKER.open, Math.abs(heatAfter(x1 * x1, 3600) - x1 * x1) < 1e-20], 'by the closed form θ settles at x² and 1.2769 never reaches 1.69').toEqual([true, true]);
    expect(HOUR.last * HOUR.solves, 'the last logic step leaves circuit step 3,600,000: 3,600 s at 1 ms').toBe(3_600_000);

    const [a, b] = [part('cb_2000'), part('cb_4158')];
    for (const k of READ) {
      const irms = nums(at(k), 'i_rms');
      expect([rel(irms[a]!, 2000 / 230), rel(irms[b]!, 4158.4 / 230)].every((d) => d <= 1e-9), `logic step ${k}: the breakers carry ${irms[a]} A and ${irms[b]} A, 8.6957 A and 18.08 A within 1e-9 relative`).toBe(true);
      expect([nums(at(k), 'on')[a], nums(at(k), 'on')[b]], `logic step ${k}: both read on 1`).toEqual([1, 1]);
    }
    const heat = nums(last(), 'heat');
    expect(Math.abs(heat[a]! - 0.29537), `the 2,000 W breaker's heat at 3,600 s, ${heat[a]}, is 0.29537 within 1e-5`).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(heat[b]! - 1.2769), `the 4,158.4 W breaker's heat at 3,600 s, ${heat[b]}, is 1.2769 within 1e-5`).toBeLessThanOrEqual(1e-5);
    expect(peakOf(last(), HOURS, 'heat', 'cb_4158'), 'and it never passed 1.2769 (+1e-5) on its way: no step reached 1.69').toBeLessThanOrEqual(1.2769 + 1e-5);
    const t = tallies(last(), HOURS);
    expect([t['cb_2000'], t['cb_4158']], 'at every one of the 3,600,000 circuit steps both breakers read on 1: no step read otherwise, none opened').toEqual([{ first: -1, last: -1, off: 0 }, { first: -1, last: -1, off: 0 }]);
  }, TIMEOUT);

  it(`${AC[6]} a 60 W lamp behind a 30 mA RCD carries 0.26087 A on each pole, residual reads 0 within 1e-12 A and both poles stay closed for 3,600 s`, () => {
    const [rcd, lamp] = [part('rcd_lamp'), part('lamp_a')];
    for (const k of READ) {
      const a = at(k);
      expect([rel(nums(a, 'i_rms')[rcd]!, LAMP.amps), rel(nums(a, 'i2_rms')[rcd]!, LAMP.amps), rel(nums(a, 'i_rms')[lamp]!, LAMP.amps)].every((d) => d <= 1e-9), `logic step ${k}: the live pole ${nums(a, 'i_rms')[rcd]} A, the neutral pole ${nums(a, 'i2_rms')[rcd]} A and the lamp carry 0.26087 A within 1e-9 relative`).toBe(true);
      expect(Math.abs(nums(a, 'residual')[rcd]!), `logic step ${k}: residual ${nums(a, 'residual')[rcd]} A is 0 within 1e-12 A`).toBeLessThanOrEqual(1e-12);
    }
    expect(peakOf(last(), HOURS, 'residual', 'rcd_lamp'), 'at every circuit step of the hour |residual| stayed within 1e-12 A').toBeLessThanOrEqual(1e-12);
    expect(tallies(last(), HOURS)['rcd_lamp'], 'and both poles stayed closed: on read 1 at every one of the 3,600,000 steps').toEqual({ first: -1, last: -1, off: 0 });
  }, TIMEOUT);

  it(`${AC[7]} a fault of 101,000 Ω gives a residual of 2.2772 mA and the RCD holds for 3,600 s`, () => {
    expect(Math.abs(230 / 101_000 - 0.0022772), '230 ÷ 101,000 = 2.2772 mA, under 30 mA').toBeLessThan(5e-8);
    const [rcd, leak] = [part('rcd_leak'), part('leak')];
    for (const k of READ) {
      const a = at(k);
      expect([rel(nums(a, 'residual')[rcd]!, 230 / 101_000), rel(nums(a, 'i_rms')[leak]!, 230 / 101_000)].every((d) => d <= 1e-9), `logic step ${k}: residual ${nums(a, 'residual')[rcd]} A and the fault's ${nums(a, 'i_rms')[leak]} A are 2.2772 mA within 1e-9 relative`).toBe(true);
    }
    expect(rel(peakOf(last(), HOURS, 'residual', 'rcd_leak'), 230 / 101_000), 'it was never more at any circuit step').toBeLessThanOrEqual(1e-9);
    expect(tallies(last(), HOURS)['rcd_leak'], 'and the RCD held: on read 1 at every one of the 3,600,000 steps').toEqual({ first: -1, last: -1, off: 0 });
  }, TIMEOUT);
});
