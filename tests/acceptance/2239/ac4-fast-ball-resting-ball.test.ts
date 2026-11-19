// Criterion 4: a dynamic ball of radius 0.05 m at 100 m/s with `ccd: true` moves toward a resting ball of the same size
// with gravity_scale 0, from ten starts a tenth of a step apart. With the resting ball's `ccd` off it never passes it in
// any start, and the lint raises nothing. With `ccd: true` on the resting ball too, the lint raises one issue of kind
// `pair` naming both balls, whose fix says to turn `ccd` off on the resting one. On Rapier 0.36.1, while both have `ccd`
// on, the moving ball passes through the resting one in nine of the ten starts. A planted lint that reads one body at a
// time raises nothing for the second world and fails.
import { describe, expect, test } from 'vitest';
import {
  AC, MOVING, RATE, RESTING, SHOT_SPEED, STARTS, TIMEOUT, bake, lintOf, outcome, pairFailures, passStep, physics, planted,
  prebuild, raisedFailures, shotStart, shotWorld, statesOf, told, tolds, type JsonObject,
} from './helpers.ts';

prebuild(['release']);
/** A tenth of a second, 8.3 m of free flight: every start, 2.55 to 3.30 m back, reaches the resting ball by step 4. */
const STEPS = 12;
const list = (failures: readonly string[]): string => `\n  ${failures.join('\n  ')}`;
const start = (j: number): string => `start ${j} (${MOVING} from x = ${shotStart(j).toFixed(4)} m)`;
const bakes = (restingCcd: boolean): JsonObject[] => STARTS.map((j) => bake(shotWorld(j, restingCcd), STEPS));

describe(`${AC[4]} a fast ball with ccd holds a resting ball only while the resting ball's ccd is off`, () => {
  test(`${AC[4]} with the resting ball's ccd off the moving ball never passes it in any of the ten starts, and the lint raises nothing`, () => {
    // Not vacuous: left alone, the moving ball would be metres past x = 0 by the end of the run from every start.
    expect(shotStart(9) + (STEPS * SHOT_SPEED) / RATE, 'free flight from the farthest start ends past the resting ball, m').toBeGreaterThan(1);
    const replies = physics(bakes(false));
    const whats = STARTS.map((j) => `ccd off on ${RESTING}, ${start(j)}`);
    const outcomes = STARTS.map((j) => outcome(replies[j]!, MOVING, RESTING, whats[j]!));
    const failures: string[] = [];
    const passed = STARTS.filter((j) => passStep(replies[j]!, MOVING, RESTING, whats[j]!) >= 0);
    if (passed.length) failures.push(`the moving ball passes the resting one in ${passed.length} of the ten starts (${passed.join(', ')}), in none expected`);
    STARTS.forEach((j) => {
      const [reply, what] = [replies[j]!, whats[j]!];
      console.log(`${outcomes[j]}; physics.fast_body raises ${tolds(lintOf(reply, what).raised)}`);
      // The moving ball reached it: the resting ball was struck and moves on.
      if (!(statesOf(reply, RESTING, what).at(-1)!.linear[0] > 1)) failures.push(`${what}: ${RESTING} was never struck`);
      failures.push(...raisedFailures(reply, what));
    });
    expect(failures, `with ccd off on the resting ball:${list(failures)}\n each start:${list(outcomes)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} with ccd: true on the resting ball too, the lint raises one issue of kind pair naming both balls, whose fix says to turn ccd off on the resting one`, () => {
    const replies = physics(bakes(true));
    const failures: string[] = [];
    STARTS.forEach((j) => {
      const [reply, what] = [replies[j]!, `ccd on both, ${start(j)}`];
      console.log(`${what}: physics.fast_body raises ${tolds(lintOf(reply, what).raised)}`);
      failures.push(...pairFailures(reply, MOVING, RESTING, { ccdOff: RESTING }, STEPS, what));
    });
    expect(failures, `with ccd on both balls:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} on Rapier 0.36.1, while both have ccd on, the moving ball passes through the resting one in nine of the ten starts`, () => {
    const replies = physics(bakes(true));
    const outcomes = STARTS.map((j) => outcome(replies[j]!, MOVING, RESTING, `ccd on both, ${start(j)}`));
    for (const o of outcomes) console.log(o);
    const passed = STARTS.filter((j) => passStep(replies[j]!, MOVING, RESTING, `ccd on both, ${start(j)}`) >= 0);
    expect(passed.length, `the moving ball passes through the resting one in ${passed.length} of the ten starts, nine expected:${list(outcomes)}`).toBe(9);
  }, TIMEOUT);

  test(`${AC[4]} a planted lint that reads one body at a time raises nothing for the second world and fails`, () => {
    const twin = planted('lint_one_body_at_a_time', bakes(true));
    expect(twin.refused, 'the planted lint runs').toBe('');
    const failures: string[] = [];
    const quiet: string[] = [];
    STARTS.forEach((j) => {
      const [reply, what] = [twin.replies[j]!, `the planted lint, ccd on both, ${start(j)}`];
      const { raised, unread } = lintOf(reply, what);
      console.log(`${what}: physics.fast_body raises ${tolds(raised)}`);
      if (unread.length || raised.length) quiet.push(...unread, ...raised.map((i) => `${what}: it raises ${told(i)}`));
      failures.push(...pairFailures(reply, MOVING, RESTING, { ccdOff: RESTING }, STEPS, what));
    });
    expect(quiet, `the planted lint raises nothing for the second world:${list(quiet)}`).toEqual([]);
    console.log(`planted lint_one_body_at_a_time fails:${list(failures)}`);
    expect(failures.length, 'the judge of the real lint fails on the planted one, in every start').toBe(STARTS.length);
  }, TIMEOUT);
});
