// Criterion 2: a body under `wind {velocity: (2, 0, 0)}` with `coupling: {kind: aero_triangles, coefficient: 1}`
// reaches the wind's speed within 1% at its closed-form time; the same seed gives the same gusts by hash on every
// run. Its planted twin takes the wind's noise from platform sin.
//
// Neither the issue nor the design states the force an `aero_triangles` coupling puts on a body, so the closed form
// and its time aren't theirs to read, and no test here guesses them: the first test holds what is stated without
// them (the world as the criterion writes it is taken and run, and the wind moves the body along it), and "within
// 1% at its closed-form time" is listed in the README under "For the early question".
import { describe, expect, test } from 'vitest';
import {
  AC, GUST, GUST_STEPS, NOISE_FROM_SIN, OTHER_SEED, SEED, TIMEOUT, VANE, WIND, WIND_STEPS, acceptedFailures, ask, bake, calmWind, check,
  firstDifference, gustyWind, hashesOf, prebuild, sameFailures, startedFailures, statesOf, steadyWind, type State,
} from './helpers.ts';

prebuild(['release']);
const STEADY = `a body under wind {velocity: (${WIND.join(', ')}), coupling: {kind: aero_triangles, coefficient: 1}}`;
const GUSTY = `the wind with gust {amplitude: ${GUST.amplitude}, scale: ${GUST.scale}, speed: ${GUST.speed}} and seed ${SEED}`;
const CALM = `the same wind and seed ${SEED} with no gust`;
const RESEEDED = `the same gusty wind with seed ${OTHER_SEED}`;

describe(`${AC[2]} a wind force carries a body toward the wind's speed, and the same seed gives the same gusts by hash on every run`, () => {
  test(`${AC[2]} a body under wind {velocity: (2, 0, 0)} with coupling {kind: aero_triangles, coefficient: 1} is taken at check, runs, and the wind moves it from rest along +x`, () => {
    const run = ask([check(steadyWind()), bake(steadyWind(), WIND_STEPS, [VANE])]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const accepted = acceptedFailures(run.replies[0]!, STEADY);
    expect(accepted, `${STEADY} is accepted at check:\n  ${accepted.join('\n  ')}`).toEqual([]);
    const read = statesOf(run.replies[1]!, VANE, WIND_STEPS, STEADY);
    expect(typeof read === 'string' ? read : '', `${STEADY} bakes: its state after each of ${WIND_STEPS} steps`).toBe('');
    const states = read as State[];
    console.log(`${STEADY}: ${states[1]!.linear[0]} m/s along +x after step 1, ${states[WIND_STEPS]!.linear[0]} m/s after step ${WIND_STEPS}`);
    const failures = startedFailures(states);
    expect(failures, `${STEADY}, baked 1 s from rest:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[2]} the same seed gives the same gusts on every run, step hash by step hash; the gusts move the body, and another seed gives others`, () => {
    const first = ask([bake(gustyWind(SEED), GUST_STEPS, [VANE])]);
    expect(first.problem, `${first.what} answers`).toBe('');
    const again = ask([bake(gustyWind(SEED), GUST_STEPS, [VANE]), bake(gustyWind(SEED), GUST_STEPS, [VANE]), bake(calmWind(SEED), GUST_STEPS, [VANE]), bake(gustyWind(OTHER_SEED), GUST_STEPS, [VANE])]);
    expect(again.problem, `${again.what} answers`).toBe('');
    const hashes = [
      hashesOf(first.replies[0]!, GUST_STEPS, GUSTY), hashesOf(again.replies[0]!, GUST_STEPS, `${GUSTY}, in a second process`),
      hashesOf(again.replies[1]!, GUST_STEPS, `${GUSTY}, a second time in that process`), hashesOf(again.replies[2]!, GUST_STEPS, CALM), hashesOf(again.replies[3]!, GUST_STEPS, RESEEDED),
    ];
    const unread = hashes.filter((h) => typeof h === 'string');
    expect(unread, `each wind bakes ${GUST_STEPS} steps, a hash for each:\n  ${unread.join('\n  ')}`).toEqual([]);
    const [gusty, second, third, calm, reseeded] = hashes as string[][];
    // Not vacuous: the gusts are in what the hashes compare, and it is the seed that gives them.
    expect(firstDifference(gusty!, calm!) >= 0, `the gusts move the body: ${GUSTY} and ${CALM} differ in some step's hash`).toBe(true);
    expect(firstDifference(gusty!, reseeded!) >= 0, `the seed gives the gusts: ${GUSTY} and ${RESEEDED} differ in some step's hash`).toBe(true);
    const failures = [...sameFailures(gusty!, second!, GUSTY, 'in a second process'), ...sameFailures(gusty!, third!, GUSTY, 'run a second time in that process')];
    expect(failures, `the same seed gives the same gusts by hash on every run:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[2]} a planted program whose wind noise comes from platform sin (${NOISE_FROM_SIN}) is caught: it still gusts, and its gusts aren't the ones the hash gives the seed, the failure naming the step`, () => {
    const planted = ask([bake(gustyWind(SEED), GUST_STEPS, [VANE]), bake(calmWind(SEED), GUST_STEPS, [VANE])], NOISE_FROM_SIN);
    expect(planted.problem, `${planted.what} answers: the planted program runs`).toBe('');
    const shipped = ask([bake(gustyWind(SEED), GUST_STEPS, [VANE]), bake(calmWind(SEED), GUST_STEPS, [VANE])]);
    expect(shipped.problem, `${shipped.what} answers`).toBe('');
    const hashes = [
      hashesOf(shipped.replies[0]!, GUST_STEPS, GUSTY), hashesOf(shipped.replies[1]!, GUST_STEPS, CALM),
      hashesOf(planted.replies[0]!, GUST_STEPS, `${GUSTY} under ${NOISE_FROM_SIN}`), hashesOf(planted.replies[1]!, GUST_STEPS, `${CALM} under ${NOISE_FROM_SIN}`),
    ];
    const unread = hashes.filter((h) => typeof h === 'string');
    expect(unread, `each wind bakes ${GUST_STEPS} steps as shipped and under ${NOISE_FROM_SIN}:\n  ${unread.join('\n  ')}`).toEqual([]);
    const [gusty, calm, plantedGusty, plantedCalm] = hashes as string[][];
    // The planted program changes the noise alone: with no gust it steps as shipped, and with one it still gusts.
    const alone = sameFailures(calm!, plantedCalm!, CALM, `under ${NOISE_FROM_SIN}`);
    expect(alone, `${NOISE_FROM_SIN} changes the wind's noise alone:\n  ${alone.join('\n  ')}`).toEqual([]);
    expect(firstDifference(plantedGusty!, plantedCalm!) >= 0, `${NOISE_FROM_SIN} still gusts: under it ${GUSTY} and ${CALM} differ in some step's hash`).toBe(true);
    const failures = sameFailures(gusty!, plantedGusty!, GUSTY, `under ${NOISE_FROM_SIN}`);
    expect(failures.length, `${NOISE_FROM_SIN}: the planted program is caught (its gusts are the shipped program's, step hash by step hash)`).toBeGreaterThan(0);
    expect(failures.some((f) => /the step hash at step \d+ /.test(f)), `a failure names the first step whose hash differs; failures:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
