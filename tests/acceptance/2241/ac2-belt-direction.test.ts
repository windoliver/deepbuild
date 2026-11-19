// Criterion 2: the same belt turned 90° about +Y carries the box along the belt's own +X, which is world −Z, by
// 1.898 m. With `tangent_speed: −1` on the level belt the box moves −1.898 m along x. A planted wrapper that applies
// the speed along world +X moves the turned belt's box the wrong way and fails, naming the axis.
import { describe, expect, test } from 'vitest';
import {
  AC, MINUS_Z, MOVED, PLUS_X, REVERSED, TIMEOUT, TURNED, WITHIN, ask, bake, carried, mm3, movedFailures, prebuild, reversedBelt,
  turnedBelt, type Carried,
} from './helpers.ts';

prebuild(['release']);
/** The axis the turned belt carries its box along: the belt's own +X once its body is turned 90° about +Y. */
const AXIS = 'world −Z';
const PLANTED = 'belt_speed_along_world_x';

/** Everything wrong with the turned belt's bake: at 2 s its box is 1.898 m along world −Z, within 1%, and no farther than that 1% across it. */
const turnedFailures = (c: Carried | string): string[] => (typeof c === 'string' ? [`${TURNED}: ${c}`] : movedFailures(TURNED, c, AXIS, MOVED));
/** The same for the level belt at `tangent_speed: −1`: −1.898 m along x. */
const reversedFailures = (c: Carried | string): string[] => (typeof c === 'string' ? [`${REVERSED}: ${c}`] : movedFailures(REVERSED, c, 'x', -MOVED));

describe(`${AC[2]} a belt runs along its own +X, turned with its body, and backwards under a negative tangent_speed`, () => {
  test(`${AC[2]} the belt turned 90° about +Y carries the box 1.898 m along world −Z, and tangent_speed −1 on the level belt moves it −1.898 m along x, each within 1%`, () => {
    const run = ask([bake(turnedBelt()), bake(reversedBelt())]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const turned = carried(run.replies[0]!, MINUS_Z, 'the belt turned 90° about +Y');
    const reversed = carried(run.replies[1]!, PLUS_X, 'the level belt with tangent_speed −1');
    if (typeof turned !== 'string') console.log(`${TURNED}: moved ${mm3(turned.along)} m along ${AXIS} at 2 s, worked ${MOVED.toFixed(3)} m`);
    if (typeof reversed !== 'string') console.log(`${REVERSED}: moved ${mm3(reversed.along)} m along x at 2 s, worked ${(-MOVED).toFixed(3)} m`);
    const failures = [...turnedFailures(turned), ...reversedFailures(reversed)];
    expect(failures, `the turned and the reversed belt baked 2 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[2]} a planted wrapper that applies the speed along world +X (${PLANTED}) moves the turned belt's box the wrong way and fails, naming the axis ${AXIS}`, () => {
    const run = ask([bake(turnedBelt())], { planted: PLANTED });
    expect(run.problem, `${run.what} answers: the planted wrapper runs`).toBe('');
    const what = `the belt turned 90° about +Y under ${PLANTED}`;
    const read = carried(run.replies[0]!, PLUS_X, what);
    expect(typeof read === 'string' ? read : '', `${PLANTED} bakes the turned belt`).toBe('');
    const alongX = read as Carried;
    console.log(`planted ${PLANTED}: ${TURNED}'s box has moved ${mm3(alongX.along)} m along world +X at 2 s`);
    // The wrong way: carried along world +X, as far as the belt would have carried it along its own +X.
    expect(Math.abs(alongX.along - MOVED) <= WITHIN * MOVED, `${PLANTED} carries the turned belt's box along world +X: at 2 s it has moved ${alongX.along} m along it`).toBe(true);
    const failures = turnedFailures(carried(run.replies[0]!, MINUS_Z, what));
    expect(failures.length, `${PLANTED}: the planted wrapper is caught (the judge finds nothing wrong with a box carried along world +X)`).toBeGreaterThan(0);
    expect(failures.some((x) => x.includes(AXIS)), `a failure names the axis ${AXIS}; failures:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
