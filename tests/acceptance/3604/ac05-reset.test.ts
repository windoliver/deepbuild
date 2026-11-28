// Criterion 5: "After the 26.087 A trip, the breaker is left open for 30 s, and its `heat` then reads 1.0250 within
// 1e-4. Reset onto the same three loads, it opens again 31.367 s after the reset, within one step. A planted library
// that closes a reset breaker cold opens 60.593 s after the reset and fails `circuit.breaker`, naming the breaker and
// both steps."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): criterion 2's three loads behind a
// B16 (circuits.ts: RESETS) at 1,000 steps a second. It trips at step 60,594 (θ about 1.69); `reset` reads 1 at step
// 90,594, 30 s later, and 0 from the next step. By hand (model.ts): open, it carries nothing, so θ falls at the same
// τ: 1.69 e^(−30/60) = 1.0250; reset with that heat, θ(t) = x² − (x² − 1.0250) e^(−t/60) reaches 1.69 at 31.367 s, step
// 90,594 + 31,367 within one; from cold it would take 60.593 s, as the first trip did. The program tallies the first
// and the latest step the breaker's `on` turns 0. On the reference library: open from the first trip to step 90,593,
// heat 1.0250 within 1e-4 there and at the reset, closed at 90,594, open again at 90,594 + 31,367 within one step;
// circuit.breaker passes over the 122,100 steps. Then the planted library `cold_reset`, linked by its own name, run to
// step 151,299: it opens again at 90,594 + 60,593 within one step, and circuit.breaker fails naming `main`, the step it
// opened and the step its elements give, 90,594 + 31,367 within one. The wrong programs: heat that doesn't fall while
// open, or falls at another τ, a reset that zeroes it, a reset that doesn't close it or one that closes it while
// `reset` reads 0, and a breaker rule that starts each reset cold.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, num, onHost, prebuild, show } from '../190/helpers.ts';
import { RESET, RESETS, THREE_LOADS, index, type Fix } from './circuits.ts';
import { AC, BREAKER, circuitLib, judgeCall, judged, nums, plantedPiece, playbackCall, played, refPiece, rule, tallies } from './helpers.ts';
import { heatAfter, thermalSteps, thermalTime } from './model.ts';

prebuild(() => { logicBin(); });

const main = index(RESETS.circuit, 'main');
const x2 = (THREE_LOADS.reduce((a, b) => a + b, 0) / 230 / 16) ** 2;

describe(`${AC[5]} a breaker reset onto its overload`, () => {
  it(`${AC[5]} left open 30 s after the 26.087 A trip its heat reads 1.0250 within 1e-4; reset onto the same three loads it opens again 31.367 s after the reset, within one step`, () => {
    const trip = thermalSteps(x2, 1e-3);
    const cooled = heatAfter(0, 30, trip.theta);
    expect([trip.steps, Math.abs(cooled - 1.025) < 1e-4, Math.abs(thermalTime(x2, cooled) - 31.367) < 5e-4, thermalSteps(x2, 1e-3, cooled).steps], `the trip at step 60,594 with θ ${trip.theta}; ${cooled} after 30 s open; ${thermalTime(x2, cooled)} s to open again, 31,367 steps`).toEqual([RESET.trip, true, true, RESET.again]);
    expect(RESET.at - RESET.trip, 'the reset comes 30 s after the trip').toBe(30_000);

    const L = circuitLib();
    const p = refPiece(L, [RESETS]);
    const end = RESETS.steps - 1;
    const [play, judge] = onHost([playbackCall(p, RESETS, [RESET.at - 1, RESET.at, end]), judgeCall(p, RESETS)]);
    const at = played(play!, RESETS.item);
    const t = tallies(at.get(end), RESETS)['main']!;
    console.log(`${AC[5]} the breaker first opened at step ${t.first} and again at ${t.last}; heat ${nums(at.get(RESET.at - 1), 'heat')[main]} before the reset`);
    expect(Math.abs(t.first - 60_593), `the first trip at step ${t.first}: 60.593 s within one step`).toBeLessThanOrEqual(1);
    expect([nums(at.get(RESET.at - 1), 'on')[main], nums(at.get(RESET.at), 'on')[main]], 'left open until the reset, closed by it').toEqual([0, 1]);
    for (const k of [RESET.at - 1, RESET.at]) expect(Math.abs(nums(at.get(k), 'heat')[main]! - 1.025), `its heat at step ${k}, ${nums(at.get(k), 'heat')[main]}, reads 1.0250 within 1e-4`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(t.last - (RESET.at + RESET.again)), `it opens again at step ${t.last}: 31.367 s after the reset at ${RESET.at}, within one step`).toBeLessThanOrEqual(1);
    const r = rule(judged(judge!, RESETS.item), BREAKER);
    expect([r.verdict, r.steps, r.fails], `circuit.breaker passes over the ${RESETS.steps} steps: ${show(r.fails as never)}`).toEqual(['PASS', RESETS.steps, []]);
  }, TIMEOUT);

  it(`${AC[5]} a planted library that closes a reset breaker cold opens 60.593 s after the reset and fails circuit.breaker, naming the breaker and both steps`, () => {
    const L = circuitLib();
    const cold: Fix = { ...RESETS, steps: RESET.coldSteps };
    const end = cold.steps - 1;
    const p = plantedPiece(L, 'cold_reset', cold);
    const [play, judge] = onHost([playbackCall(p, cold, [end]), judgeCall(p, cold)]);
    const t = tallies(played(play!, cold.item).get(end), cold)['main']!;
    console.log(`${AC[5]} the planted breaker first opened at step ${t.first} and again at ${t.last}`);
    expect(Math.abs(t.last - (RESET.at + RESET.cold)), `it opens again at step ${t.last}: 60.593 s after the reset at ${RESET.at}, within one step`).toBeLessThanOrEqual(1);
    const failed = rule(judged(judge!, cold.item), BREAKER);
    expect(failed.verdict, `circuit.breaker fails: ${show(failed.fails as never)}`).toBe('FAIL');
    const f = failed.fails.find((x) => x['breaker'] === 'main' && typeof x['step'] === 'number' && typeof x['expected'] === 'number');
    expect(f, `a fail names the breaker main and both steps: ${show(failed.fails as never)}`).toBeDefined();
    expect(num(f!['step'], 'the step it opened'), `the step it opened, ${t.last}: ${show(f!)}`).toBe(t.last);
    expect(Math.abs(num(f!['expected'], 'the step its elements give') - (RESET.at + RESET.again)), `and the step its elements give, 31.367 s after the reset within one step: ${show(f!)}`).toBeLessThanOrEqual(1);
  }, TIMEOUT);
});
