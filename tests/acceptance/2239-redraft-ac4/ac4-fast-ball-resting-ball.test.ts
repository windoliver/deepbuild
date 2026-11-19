// Criterion 4, as amended: a dynamic ball of radius 0.05 m at 100 m/s with `ccd: true` moves toward a resting ball of
// the same size with gravity_scale 0, from ten starts a tenth of a step apart. With the resting ball's `ccd` off it
// never passes it in any start, and the lint raises nothing. With `ccd: true` on the resting ball too it never passes
// it in any start either, since a body with `ccd` on predicts its contacts along its own move, and the lint raises
// nothing. A planted lint that reads the backend's sweep alone, without that prediction, raises an issue of kind
// `pair` for the second world and fails, naming both balls.
import { describe, expect, test } from 'vitest';
import {
  MOVING, RATE, RESTING, SHOT_SPEED, STARTS, TIMEOUT, bake, lintOf, outcome, passStep, physics, prebuild, raisedFailures,
  shotStart, shotWorld, tolds, type JsonObject,
} from '../2239/helpers.ts';
import { AC, SWEEP_ALONE, pairNaming, plantedSweepAlone, struckStep } from './helpers.ts';

prebuild(['release']);
/** A tenth of a second: left alone, the moving ball flies 10 m, from at most 3.3 m before the resting one. */
const STEPS = 12;
const OFF = 'ccd off on the ball at rest';
const BOTH = 'ccd on both balls';
const list = (lines: readonly string[]): string => `\n  ${lines.join('\n  ')}`;
/** A start's label, which holds neither ball's ID, so a failure that names a ball took it from an issue. */
const start = (j: number, ccd: string): string => `${ccd}, start ${j} (${(-shotStart(j)).toFixed(4)} m back)`;
const bakes = (restingCcd: boolean): JsonObject[] => STARTS.map((j) => bake(shotWorld(j, restingCcd), STEPS));

/** Everything wrong with "it never passes it in any start, and the lint raises nothing", and each start's outcome. */
function heldFailures(replies: JsonObject[], ccd: string): { failures: string[]; outcomes: string[] } {
  const outcomes = STARTS.map((j) => outcome(replies[j]!, MOVING, RESTING, start(j, ccd)));
  const failures: string[] = [];
  const passed = STARTS.filter((j) => passStep(replies[j]!, MOVING, RESTING, start(j, ccd)) >= 0);
  if (passed.length) failures.push(`${ccd}: the ball at 100 m/s passes the ball at rest in ${passed.length} of the ten starts (${passed.join(', ')}), where it passes it in none`);
  STARTS.forEach((j) => {
    const [reply, what] = [replies[j]!, start(j, ccd)];
    console.log(`${outcomes[j]}; physics.fast_body raises ${tolds(lintOf(reply, what).raised)}`);
    // Not vacuous: the ball at 100 m/s reached the other, which is struck and no longer at rest.
    if (struckStep(reply, RESTING, what) < 0) failures.push(`${what}: the ball at rest is left at rest where it was built, so the ball at 100 m/s never struck it`);
    failures.push(...raisedFailures(reply, what));
  });
  return { failures, outcomes };
}

describe(`${AC[4]} a fast ball with ccd on holds a resting ball in its path, whatever the resting ball's ccd, and the lint raises nothing`, () => {
  test(`${AC[4]} with the resting ball's ccd off the moving ball never passes it in any of the ten starts, and the lint raises nothing`, () => {
    // Not vacuous: left alone, the moving ball ends the run metres past the resting one in every start.
    expect((STEPS * SHOT_SPEED) / RATE, 'the moving ball\'s free flight in the run, m').toBeGreaterThan(-shotStart(STARTS.length - 1) + 1);
    const { failures, outcomes } = heldFailures(physics(bakes(false)), OFF);
    expect(failures, `the shot, ${OFF}:${list(failures)}\n each start:${list(outcomes)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} with ccd: true on the resting ball too the moving ball never passes it in any of the ten starts either, and the lint raises nothing`, () => {
    const { failures, outcomes } = heldFailures(physics(bakes(true)), BOTH);
    expect(failures, `the shot, ${BOTH}:${list(failures)}\n each start:${list(outcomes)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} a planted lint that reads the backend's sweep alone, without that prediction, raises an issue of kind pair for the second world and fails, naming both balls`, () => {
    const twin = plantedSweepAlone(bakes(true));
    expect(twin.refused, 'the planted lint runs').toBe('');
    const [silent, unnamed, failures]: [string[], string[], string[]] = [[], [], []];
    STARTS.forEach((j) => {
      const [reply, what] = [twin.replies[j]!, `the planted lint, ${start(j, BOTH)}`];
      const { raised, unread } = lintOf(reply, what);
      console.log(`${what}: physics.fast_body raises ${tolds(raised)}`);
      if (!raised.some((i) => pairNaming(i, MOVING, RESTING))) silent.push(...unread, `${what}: it raises no issue of kind pair naming ${MOVING} and ${RESTING}: ${tolds(raised)}`);
      // The judge of the real lint, for the second world: the lint raises nothing.
      const mine = raisedFailures(reply, what);
      if (!mine.some((f) => f.includes(MOVING) && f.includes(RESTING))) unnamed.push(`${what}: no failure names ${MOVING} and ${RESTING}:${list(mine)}`);
      failures.push(...mine);
    });
    expect(silent, `the planted lint raises an issue of kind pair naming both balls, in each start of the second world:${list(silent)}`).toEqual([]);
    console.log(`planted ${SWEEP_ALONE} fails:${list(failures)}`);
    expect(unnamed, `the judge of the real lint fails on the planted one in every start, naming both balls:${list(unnamed)}`).toEqual([]);
  }, TIMEOUT);
});
