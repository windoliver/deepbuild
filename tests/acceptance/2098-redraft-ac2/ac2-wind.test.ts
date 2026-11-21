// Criterion 2, #2098.7c1127fe: a body under `wind {velocity: (2, 0, 0)}` with `coupling: {kind: aero_triangles,
// coefficient: 1}` reaches the wind's speed within 1% at its closed-form time; the same seed gives the same gusts by
// hash on every run. Its planted twin takes the wind's noise from platform sin.
//
// The two conditions the first draft (../2098/ac2-wind.test.ts) left for the owner's answer, held from the Force
// section as amended (README: Criteria to tests):
// - "within 1% at its closed-form time": the 1 kg cube of 1 m is first within 1% of the wind's 2 m/s at
//   m × ln 100 ÷ (2 × coefficient × A) = 2.303 s, within 1% of that time, in a world stepped at 120 Hz;
// - "the same gusts": over every step the wind the cube feels is the formula's, velocity × (1 + amplitude ×
//   noise((p − d × speed × t) ÷ scale, seed)) with the closed function list's noise, worked in helpers.ts from that
//   function's published steps and never from a run of the wind. The planted twin fails that judge.
// That the gusts repeat run after run, and that the world is taken at check, stay the first draft's.
import { describe, expect, test } from 'vitest';
import {
  AC, GUST, GUST_STEPS, GUST_WITHIN, NOISE_FROM_SIN, OTHER_SEED, REACH_STEPS, REACH_TIME, SEED, TIMEOUT, VANE, WIND, ask, bake, gustFailures,
  lockedCalm, lockedGusty, prebuild, reachFailures, statesOf, steadyWind, type State,
} from './helpers.ts';

prebuild(['release']);
const ID = AC[2];
const STEADY = `a 1 kg cube of 1 m under wind {velocity: (${WIND.join(', ')}), coupling: {kind: aero_triangles, coefficient: 1}}`;
const GUSTY = `the cube that can't turn, under that wind with gust {amplitude: ${GUST.amplitude}, scale: ${GUST.scale}, speed: ${GUST.speed}} and seed ${SEED}`;
const CALM = `the cube that can't turn, under that wind and seed ${SEED} with no gust`;
const FORMULA = 'velocity × (1 + amplitude × noise((p − d × speed × t) ÷ scale, seed))';

describe(`${ID} a body under the wind reaches the wind's speed within 1% at its closed-form time, and its gusts are the ones the formula gives its seed`, () => {
  test(`${ID} a 1 kg cube of 1 m under wind {velocity: (2, 0, 0)} with coupling {kind: aero_triangles, coefficient: 1} is first within 1% of 2 m/s at m × ln 100 ÷ (2 × coefficient × A) = 2.303 s, within 1% of that time, and stays there`, () => {
    expect(REACH_TIME.toFixed(3), 'm × ln 100 ÷ (2 × coefficient × A), worked for a 1 kg cube of 1 m at coefficient 1, is the 2.303 s the Force section prints').toBe('2.303');
    const run = ask([bake(steadyWind(), REACH_STEPS, [VANE])]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = statesOf(run.replies[0]!, VANE, REACH_STEPS, STEADY);
    expect(typeof read === 'string' ? read : '', `${STEADY} bakes: its state after each of ${REACH_STEPS} steps`).toBe('');
    const states = read as State[];
    console.log(`${STEADY}: ${[274, 275, 279, REACH_STEPS].map((k) => `${states[k]!.linear[0]} m/s after step ${k}`).join(', ')}`);
    const failures = reachFailures(states);
    expect(failures, `${STEADY}, baked ${REACH_STEPS} steps from rest, reaches the wind's speed within 1% at its closed-form time:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${ID} the gusts are the ones the formula gives the seed with the closed function list's noise: over every step the wind the cube feels is ${FORMULA} at its four centroids across the wind, within ${GUST_WITHIN} m/s`, () => {
    const run = ask([bake(lockedGusty(SEED), GUST_STEPS, [VANE])]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = statesOf(run.replies[0]!, VANE, GUST_STEPS, GUSTY);
    expect(typeof read === 'string' ? read : '', `${GUSTY} bakes: its state after each of ${GUST_STEPS} steps`).toBe('');
    const states = read as State[];
    const failures = gustFailures(states, { gust: GUST, seed: SEED });
    expect(failures, `${GUSTY}: its gusts are ${FORMULA}, with the noise of the integer lattice hash:\n  ${failures.join('\n  ')}`).toEqual([]);
    // Not vacuous: the gusts are in what the judge compares, and it is the seed that gives them.
    expect(gustFailures(states, { seed: SEED }).length, `the judge sees the gusts: held to the same wind with no gust, ${GUSTY} fails`).toBeGreaterThan(0);
    expect(gustFailures(states, { gust: GUST, seed: OTHER_SEED }).length, `the judge sees the seed: held to the gusts of seed ${OTHER_SEED}, ${GUSTY} fails`).toBeGreaterThan(0);
  }, TIMEOUT);

  test(`${ID} a planted program whose wind noise comes from platform sin (${NOISE_FROM_SIN}) is caught: it still gusts, and its gusts aren't the ones the formula gives the seed with the integer lattice hash, the failure naming the step`, () => {
    const planted = ask([bake(lockedGusty(SEED), GUST_STEPS, [VANE]), bake(lockedCalm(SEED), GUST_STEPS, [VANE])], NOISE_FROM_SIN);
    expect(planted.problem, `${planted.what} answers: the planted program runs`).toBe('');
    const reads = [statesOf(planted.replies[0]!, VANE, GUST_STEPS, `${GUSTY}, under ${NOISE_FROM_SIN}`), statesOf(planted.replies[1]!, VANE, GUST_STEPS, `${CALM}, under ${NOISE_FROM_SIN}`)];
    const unread = reads.filter((r) => typeof r === 'string');
    expect(unread, `each wind bakes ${GUST_STEPS} steps under ${NOISE_FROM_SIN}:\n  ${unread.join('\n  ')}`).toEqual([]);
    const [gusty, calm] = reads as State[][];
    // The planted program changes the noise alone: with no gust its wind is the law's, and with one it still gusts.
    const alone = gustFailures(calm!, { seed: SEED });
    expect(alone, `${NOISE_FROM_SIN} changes the wind's noise alone: ${CALM} feels the steady wind:\n  ${alone.join('\n  ')}`).toEqual([]);
    expect(gustFailures(gusty!, { seed: SEED }).length, `${NOISE_FROM_SIN} still gusts: held to the same wind with no gust, ${GUSTY} fails`).toBeGreaterThan(0);
    const failures = gustFailures(gusty!, { gust: GUST, seed: SEED });
    expect(failures.length, `${NOISE_FROM_SIN}: the planted program is caught (its gusts are ${FORMULA} with the noise of the integer lattice hash)`).toBeGreaterThan(0);
    expect(failures.some((f) => /over step \d+,/.test(f)), `a failure names the first step whose wind isn't the formula's; failures:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
