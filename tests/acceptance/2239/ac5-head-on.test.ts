// Criterion 5: two such balls head on at 20 m/s each, one of them with `ccd: true`, at `step_rate: 120` raise one issue
// of kind `pair` naming both, whose fix names `step_rate` and no `ccd`. At `step_rate: 480`, where each moves 0.042 m a
// step, the lint raises nothing and the two never swap order along x at the end of any step, in any of ten starts a
// tenth of a step apart. A planted lint that calls a pair held whenever one of the two has `ccd` on raises nothing at
// 120 Hz and fails.
import { describe, expect, test } from 'vitest';
import {
  AC, BALL_RADIUS, HEAD_ON_GAP, HEAD_ON_SPEED, LEFT, RIGHT, STARTS, TIMEOUT, bake, headOnWorld, lintOf, outcome, pairFailures,
  passStep, physics, planted, prebuild, raisedFailures, statesOf, told, tolds, type JsonObject,
} from './helpers.ts';

prebuild(['release']);
/** A tenth of a second at either rate: left alone, the two would be 2 m past each other. */
const SECONDS = 0.1;
const stepsAt = (rate: number): number => Math.round(SECONDS * rate);
const list = (failures: readonly string[]): string => `\n  ${failures.join('\n  ')}`;
const start = (rate: number, j: number): string => `${rate} Hz, start ${j} (${LEFT} ${(j * (HEAD_ON_SPEED / rate / 10)).toFixed(4)} m farther back)`;
const bakes = (rate: number): JsonObject[] => STARTS.map((j) => bake(headOnWorld(rate, j), stepsAt(rate)));

describe(`${AC[5]} two fast balls head on are a pair no ccd holds, until the step rate is high enough that neither is fast`, () => {
  test(`${AC[5]} at step_rate 120 the two raise one issue of kind pair naming both, whose fix names step_rate and no ccd`, () => {
    // Each moves 0.167 m a step, more than half its thinnest extent, 0.05 m: both are fast.
    expect(HEAD_ON_SPEED / 120, 'each ball\'s move in a step at 120 Hz, m').toBeGreaterThan(BALL_RADIUS);
    const replies = physics(bakes(120));
    const failures: string[] = [];
    STARTS.forEach((j) => {
      const [reply, what] = [replies[j]!, start(120, j)];
      console.log(`${outcome(reply, LEFT, RIGHT, what)}; physics.fast_body raises ${tolds(lintOf(reply, what).raised)}`);
      failures.push(...pairFailures(reply, LEFT, RIGHT, 'step_rate', stepsAt(120), what));
    });
    expect(failures, `head on at 120 Hz:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[5]} at step_rate 480, where each moves 0.042 m a step, the lint raises nothing and the two never swap order along x at the end of any step, in any of the ten starts`, () => {
    expect((HEAD_ON_SPEED / 480).toFixed(3), 'each ball\'s move in a step at 480 Hz, m').toBe('0.042');
    // Not vacuous: left alone, each would cross the other's start by the end of the run.
    expect(2 * HEAD_ON_SPEED * SECONDS, 'the distance the two close in the run, m').toBeGreaterThan(HEAD_ON_GAP + 1);
    const replies = physics(bakes(480));
    const outcomes = STARTS.map((j) => outcome(replies[j]!, LEFT, RIGHT, start(480, j)));
    const failures: string[] = [];
    const swapped = STARTS.filter((j) => passStep(replies[j]!, LEFT, RIGHT, start(480, j)) >= 0);
    if (swapped.length) failures.push(`the two swap order along x in ${swapped.length} of the ten starts (${swapped.join(', ')}), in none expected`);
    STARTS.forEach((j) => {
      const [reply, what] = [replies[j]!, start(480, j)];
      console.log(`${outcomes[j]}; physics.fast_body raises ${tolds(lintOf(reply, what).raised)}`);
      // The two met: neither still flies at its 20 m/s.
      const [l, r] = [statesOf(reply, LEFT, what).at(-1)!, statesOf(reply, RIGHT, what).at(-1)!];
      if (Math.abs(l.linear[0] - HEAD_ON_SPEED) < 1 || Math.abs(r.linear[0] + HEAD_ON_SPEED) < 1) failures.push(`${what}: the two never met`);
      failures.push(...raisedFailures(reply, what));
    });
    expect(failures, `head on at 480 Hz:${list(failures)}\n each start:${list(outcomes)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[5]} a planted lint that calls a pair held whenever one of the two has ccd on raises nothing at 120 Hz and fails`, () => {
    const twin = planted('lint_pair_held_by_one_ccd', bakes(120));
    expect(twin.refused, 'the planted lint runs').toBe('');
    const failures: string[] = [];
    const quiet: string[] = [];
    STARTS.forEach((j) => {
      const [reply, what] = [twin.replies[j]!, `the planted lint, ${start(120, j)}`];
      const { raised, unread } = lintOf(reply, what);
      console.log(`${what}: physics.fast_body raises ${tolds(raised)}`);
      if (unread.length || raised.length) quiet.push(...unread, ...raised.map((i) => `${what}: it raises ${told(i)}`));
      failures.push(...pairFailures(reply, LEFT, RIGHT, 'step_rate', stepsAt(120), what));
    });
    expect(quiet, `the planted lint raises nothing at 120 Hz:${list(quiet)}`).toEqual([]);
    console.log(`planted lint_pair_held_by_one_ccd fails:${list(failures)}`);
    expect(failures.length, 'the judge of the real lint fails on the planted one, in every start').toBe(STARTS.length);
  }, TIMEOUT);
});
