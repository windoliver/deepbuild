// Criterion 3: "A 0.75 mm² copper wire on that load: the electrons' rms drift speed is 0.02 ÷ (8.5 × 10²⁸ × 0.75 ×
// 10⁻⁶ × 1.602176634 × 10⁻¹⁹) = 1.9581 × 10⁻⁶ m/s within 1e-4 relative; their displacement swings with an amplitude
// of 8.8146 × 10⁻⁹ m within 1e-4 relative; and after 3,600 s, which is 180,000 whole cycles, it is 0 within 1e-15 m."
//
// Through `deep-logic first_party` and `playback` (README: The surface): the lamp's circuit with its flex, 2 m of
// 0.75 mm² copper on the lamp (circuits.ts: FLEX_CIRCUIT), the plug in from step 0, linking circuit@1's reference
// library through the interface.
// - The swing (CYCLE): one cycle at 1,000 steps a second. By hand: v = I ÷ (n A e) = 1.958120 × 10⁻⁶ m/s; the current
//   is √2 × 0.02 × sin(2π·50·t) from t = 0, so the displacement is ∫ v dt = A (1 − cos 2π·50·t) with A = √2 v ÷ (2π ×
//   50) = 8.814639 × 10⁻⁹ m (model.ts): 0 at step 0, A at step 5, 2A at step 10, back to 0 at step 20; it swings with
//   amplitude A. Its sign is the current's (I ÷ n A e) or the electrons' own; the test takes either, the same at
//   every step. A displacement summed step by step (v × 1 ms) swings by 8.742 × 10⁻⁹ m, 0.8% short: it fails.
// - The hour (HOURLY): 3,600 s at 1 ms are 3.6 million circuit steps, too many for one logic step each in a bake's
//   record, so each logic step at 8 Hz solves 125 circuit steps (README: Pieces: more than one solve a step), and logic
//   step k leaves circuit step 125k at t = 0.125k s, where the closed form gives A (1 − cos(πk/2)): A, 2A, A, 0 for k =
//   1 to 4. At logic step 28,800, t = 3,600 s, 180,000 whole cycles: 0 within 1e-15 m. The meter on the lamp reads
//   3,600,001 × 4.6 mJ there, so the 3.6 million steps ran. This is the suite's one long run (README: Run them).
// The wrong programs: another carrier density, area unit or charge; a displacement centred on 0 (−A cos), summed step
// by step, from the speed (always growing), or from a clock summed in floats that drifts off the wave.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild } from '../190/helpers.ts';
import { CYCLE, HOUR, HOURLY, LAMP, index } from './circuits.ts';
import { AC, INTERFACE, circuitLib, fixturePiece, nums, playbackCall, played } from './helpers.ts';
import { CARRIERS, displacement, drift, swing } from './model.ts';

prebuild(() => { logicBin(); });

const V = drift(LAMP.amps, 0.75, CARRIERS.copper);
const A = swing(V, LAMP.f);
const rel = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);

describe(`${AC[3]} electrons drifting in the lamp's flex`, () => {
  it(`${AC[3]} a 0.75 mm² copper wire on that load: the rms drift speed is 1.9581e-6 m/s and the displacement swings with an amplitude of 8.8146e-9 m, each within 1e-4 relative`, () => {
    expect([rel(1.9581e-6, V) < 1e-4, rel(8.8146e-9, A) < 1e-4], `the issue's 1.9581 × 10⁻⁶ m/s and 8.8146 × 10⁻⁹ m are the closed forms' ${V} and ${A} within 1e-4`).toEqual([true, true]);
    let summed = 0, top = 0;
    for (let k = 0; k < 20; k++) { summed += Math.SQRT2 * V * Math.sin(Math.PI * k / 10) * 1e-3; top = Math.max(top, summed); }
    expect(rel(top / 2, A), 'a displacement summed step by step at 1 ms swings 0.8% short, outside 1e-4').toBeGreaterThan(1e-3);

    const L = circuitLib();
    const p = fixturePiece(CYCLE, INTERFACE, [L.ref], L.assets);
    const steps = Array.from({ length: CYCLE.steps }, (_, k) => k);
    const [play] = onHost([playbackCall(p, CYCLE, steps)]);
    const at = played(play!, CYCLE.item);
    const flex = index(CYCLE.circuit, 'flex');
    const speeds = steps.map((k) => nums(at.get(k), 'drift')[flex]!);
    expect(speeds.filter((v) => !(rel(v, V) <= 1e-4)), `the electrons' rms drift speed is ${V} m/s within 1e-4 relative at every step: ${speeds.slice(0, 3).join(', ')} …`).toEqual([]);
    const x = steps.map((k) => nums(at.get(k), 'drift_x')[flex]!);
    const sign = Math.sign(x[5]!) || 1;
    const off = steps.filter((k) => !(Math.abs(x[k]! - sign * displacement(V, LAMP.f, k / 1000)) <= 1e-4 * A)).map((k) => `step ${k}: ${x[k]} m, expected ${sign * displacement(V, LAMP.f, k / 1000)} m`);
    expect(off, 'their displacement from rest is A (1 − cos 2π·50·t), within 1e-4 of A, at every step of the cycle').toEqual([]);
    const amplitude = (Math.max(...x) - Math.min(...x)) / 2;
    expect(rel(amplitude, A), `it swings with an amplitude of ${amplitude} m: 8.8146 × 10⁻⁹ m within 1e-4 relative`).toBeLessThanOrEqual(1e-4);
  }, TIMEOUT);

  it(`${AC[3]} after 3,600 s, which is 180,000 whole cycles, the displacement is 0 within 1e-15 m`, () => {
    expect([HOUR.last * HOUR.solves, HOUR.last * HOUR.solves / HOUR.per, HOUR.last * HOUR.solves / HOUR.per * LAMP.f], '28,800 logic steps of 125 circuit steps of 1 ms: 3,600,000 steps, 3,600 s, 180,000 cycles').toEqual([3_600_000, 3600, 180_000]);
    const L = circuitLib();
    const p = fixturePiece(HOURLY, INTERFACE, [L.ref], L.assets, { per: HOUR.per, solves: HOUR.solves });
    const sampled = [1, 2, 3, 4, HOUR.last - 1, HOUR.last];
    const [play] = onHost([playbackCall(p, HOURLY, sampled)]);
    const at = played(play!, HOURLY.item);
    const [flex, meter] = [index(HOURLY.circuit, 'flex'), index(HOURLY.circuit, 'meter')];
    const x = (k: number): number => nums(at.get(k), 'drift_x')[flex]!;
    const sign = Math.sign(x(1)) || 1;
    const off = sampled.slice(0, -1).filter((k) => !(Math.abs(x(k) - sign * A * (1 - Math.cos(Math.PI * k / 2))) <= 1e-4 * A)).map((k) => `logic step ${k} (t = ${k * 0.125} s): ${x(k)} m`);
    expect(off, 'at 0.125 s, 0.25 s, 0.375 s, 0.5 s and 3,599.875 s the displacement is A, 2A, A, 0 and A: the long run keeps the wave').toEqual([]);
    expect(Math.abs(x(HOUR.last)), `after 3,600 s, 180,000 whole cycles, it is ${x(HOUR.last)} m: 0 within 1e-15 m`).toBeLessThanOrEqual(1e-15);
    const ran = nums(at.get(HOUR.last), 'energy')[meter]!;
    expect(rel(ran, 3_600_001 * LAMP.watts / 1000), `the meter read ${ran} J: 3,600,001 steps of 4.6 W × 1 ms ran`).toBeLessThanOrEqual(1e-6);
  }, TIMEOUT);
});
