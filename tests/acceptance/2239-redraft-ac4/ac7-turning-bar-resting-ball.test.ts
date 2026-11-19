// Criterion 7, added by the amendment: a dynamic bar 2 m long and 0.02 m thick, turning at 720°/s about its centre
// with `ccd: true`, turns toward a resting ball of radius 0.02 m whose centre is 0.95 m from the bar's centre, both
// with gravity_scale 0, from ten starts a tenth of a step's turn (0.6°) apart, the ball 15° ahead of the bar in the
// first. With the ball's `ccd` off the bar strikes it in every start, and the lint raises nothing. With `ccd: true` on
// the ball too, the bar passes it and leaves it at rest in at least one start, and the lint raises one issue of kind
// `pair` naming both, whose fix says to turn `ccd` off on the ball. A planted lint that reads one body at a time
// raises nothing for the second world and fails.
import { describe, expect, test } from 'vitest';
import {
  BALL, BAR, BAR_TURN, RATE, STARTS, TIMEOUT, bake, lintOf, pairFailures, physics, planted, prebuild, raisedFailures, told,
  tolds, type JsonObject,
} from '../2239/helpers.ts';
import { AC, CLEAR, ONE_BODY, START_TURN, aheadOf, barBallWorld, swingOf } from './helpers.ts';

prebuild(['release']);
/** A tenth of a second: left alone, the bar turns 72°, and the ball is at most 20.4° ahead of it. */
const STEPS = 12;
const OFF = 'ccd off on the ball';
const BOTH = 'ccd on the bar and the ball';
const list = (lines: readonly string[]): string => `\n  ${lines.join('\n  ')}`;
const start = (j: number, ccd: string): string => `${ccd}, start ${j} (the ball ${aheadOf(j).toFixed(1)}° ahead)`;
const bakes = (ballCcd: boolean): JsonObject[] => STARTS.map((j) => bake(barBallWorld(j, ballCcd), STEPS));

describe(`${AC[7]} a bar fast by its turn holds a resting ball only while the ball's ccd is off, and the lint names the pair it can't hold`, () => {
  test(`${AC[7]} with the ball's ccd off the bar strikes it in every one of the ten starts, and the lint raises nothing`, () => {
    expect(START_TURN.toFixed(1), 'a tenth of a step\'s turn, degrees').toBe('0.6');
    // Not vacuous: left alone, the bar ends the run far past the ball in every start.
    expect((STEPS * BAR_TURN) / RATE, 'the bar\'s free turn in the run, degrees').toBeGreaterThan(aheadOf(STARTS.length - 1) + CLEAR + 10);
    const replies = physics(bakes(false));
    const swings = STARTS.map((j) => swingOf(replies[j]!, j, start(j, OFF)));
    const failures: string[] = [];
    const missed = STARTS.filter((j) => swings[j]!.struck < 0);
    if (missed.length) failures.push(`${OFF}: the bar leaves the ball at rest in ${missed.length} of the ten starts (${missed.join(', ')}), where it strikes it in every start`);
    STARTS.forEach((j) => {
      const [reply, what] = [replies[j]!, start(j, OFF)];
      console.log(`${swings[j]!.said}; physics.fast_body raises ${tolds(lintOf(reply, what).raised)}`);
      failures.push(...raisedFailures(reply, what));
    });
    expect(failures, `the bar and the ball, ${OFF}:${list(failures)}\n each start:${list(swings.map((s) => s.said))}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[7]} with ccd: true on the ball too the bar passes it and leaves it at rest in at least one of the ten starts, and the lint raises one issue of kind pair naming both, whose fix says to turn ccd off on the ball`, () => {
    const replies = physics(bakes(true));
    const swings = STARTS.map((j) => swingOf(replies[j]!, j, start(j, BOTH)));
    const failures = swings.flatMap((s) => s.unread);
    const passed = STARTS.filter((j) => swings[j]!.struck < 0 && swings[j]!.passed >= 0);
    if (!passed.length) failures.push(`${BOTH}: the bar passes the ball and leaves it at rest in none of the ten starts, where it does in at least one`);
    STARTS.forEach((j) => {
      const [reply, what] = [replies[j]!, start(j, BOTH)];
      console.log(`${swings[j]!.said}; physics.fast_body raises ${tolds(lintOf(reply, what).raised)}`);
      failures.push(...pairFailures(reply, BAR, BALL, { ccdOff: BALL }, STEPS, what));
    });
    console.log(`${BOTH}: the bar passes the ball and leaves it at rest in ${passed.length} of the ten starts (${passed.join(', ')})`);
    expect(failures, `the bar and the ball, ${BOTH}:${list(failures)}\n each start:${list(swings.map((s) => s.said))}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[7]} a planted lint that reads one body at a time raises nothing for the second world and fails`, () => {
    const twin = planted(ONE_BODY, bakes(true));
    expect(twin.refused, 'the planted lint runs').toBe('');
    const [loud, failures]: [string[], string[]] = [[], []];
    STARTS.forEach((j) => {
      const [reply, what] = [twin.replies[j]!, `the planted lint, ${start(j, BOTH)}`];
      const { raised, unread } = lintOf(reply, what);
      console.log(`${what}: physics.fast_body raises ${tolds(raised)}`);
      loud.push(...unread, ...raised.map((i) => `${what}: it raises ${told(i)}`));
      // The judge of the real lint, for the second world: one issue of kind pair naming both, its fix turning ccd off on the ball.
      failures.push(...pairFailures(reply, BAR, BALL, { ccdOff: BALL }, STEPS, what));
    });
    expect(loud, `the planted lint raises nothing in any start of the second world:${list(loud)}`).toEqual([]);
    console.log(`planted ${ONE_BODY} fails:${list(failures)}`);
    expect(failures.length, 'the judge of the real lint fails on the planted one, in every start').toBe(STARTS.length);
  }, TIMEOUT);
});
