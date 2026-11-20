// #2248.a0a41ad7: A 1 kg ball dropped from rest at 120 Hz with the output `{from: ball, read: velocity, sample: 12,
// average: 12}` bakes one value every 0.1 s, each the mean of the ball's vertical velocity over the 12 steps that end
// at it: −9.360 m/s at 1 s, within 0.1% (−9.81 × 114.5 ÷ 120); and with `keep: 0.5 s` a series reading it holds only
// the samples of the last 0.5 s.
//
// The dropped ball's world (helpers' `dropWorld`) is baked by `deep-physics`, and the output's series is read from the
// bake's `outputs.series.fall`: one row `{t, v}` a sample (README: Series). Every expected value is the closed form
// the issue gives: after step j the ball falls at −9.81 × j ÷ 120 m/s, so the mean over the 12 steps that end at
// step k is −9.81 × (k − 5.5) ÷ 120.
import { describe, expect, test } from 'vitest';
import {
  CRITERIA, FALL, KEEP, SAMPLE, SECOND, TIMEOUT, bake, dropWorld, everyNth, fallOutput, keptFailures, list, meanFailures, meanFall,
  physics, prebuild, rowText, rowsOf, stepsOf,
} from './helpers.ts';

prebuild(['release']);

const ID = CRITERIA[1];
/** The issue's value at 1 s, m/s, and its bound. */
const AT_ONE_SECOND = -9.36;
const WITHIN = 0.001;

describe(`${ID} a dropped ball's velocity sampled every 12 steps and averaged over 12 bakes one mean every 0.1 s, and keep holds the last 0.5 s of them`, () => {
  test(`${ID} the output {from: ball, read: velocity, sample: 12, average: 12} bakes one value every 0.1 s, each the mean of the ball's vertical velocity over the 12 steps that end at it: −9.360 m/s at 1 s within 0.1%`, () => {
    expect(meanFall(SECOND, SAMPLE).toFixed(3), 'the issue\'s closed form at 1 s, −9.81 × 114.5 ÷ 120, in m/s').toBe('-9.360');
    const [baked] = physics([bake(dropWorld({ [FALL]: fallOutput() }), SECOND)]);
    const what = 'the dropped ball baked 1 s';
    const { rows, problems } = rowsOf(baked, FALL, what);
    console.log(`${what}: outputs.series.${FALL} holds ${rows.length} rows: ${rows.map(rowText).join('; ') || 'none'}`);
    expect(problems, `${what}: the output's series is read:${list(problems)}`).toEqual([]);
    expect(stepsOf(rows), `${what}: one value every 0.1 s, a row at each of the steps 12, 24 … 120; the series: ${rows.map(rowText).join('; ')}`).toEqual(everyNth(SAMPLE, SAMPLE, SECOND));
    const failures = meanFailures(rows, what);
    expect(failures, `${what}: each value is the mean over the 12 steps that end at it:${list(failures)}`).toEqual([]);
    const last = rows.at(-1)!.v[1]!;
    expect(Math.abs(last - AT_ONE_SECOND) <= WITHIN * Math.abs(AT_ONE_SECOND), `${what}: at 1 s the series reads ${last} m/s; the issue's −9.360 m/s within 0.1%`).toBe(true);
  }, TIMEOUT);

  test(`${ID} with keep: 0.5 s a series reading it holds only the samples of the last 0.5 s`, () => {
    const kept = dropWorld({ [FALL]: fallOutput(KEEP) });
    // The series read at 1 s without keep and with it, and with it at 0.8 s: the last half second moves with the time read.
    const EARLIER = 96;
    const [whole, atOne, atEarlier] = physics([bake(dropWorld({ [FALL]: fallOutput() }), SECOND), bake(kept, SECOND), bake(kept, EARLIER)]);
    const all = rowsOf(whole, FALL, 'the series without keep, read at 1 s');
    const one = rowsOf(atOne, FALL, 'the series with keep: 0.5 s, read at 1 s');
    const earlier = rowsOf(atEarlier, FALL, 'the series with keep: 0.5 s, read at 0.8 s');
    for (const [name, r] of [['without keep at 1 s', all], ['keep: 0.5 s at 1 s', one], ['keep: 0.5 s at 0.8 s', earlier]] as const) {
      console.log(`${name}: ${r.rows.map(rowText).join('; ') || 'no rows'}`);
    }
    const problems = [...all.problems, ...one.problems, ...earlier.problems];
    expect(problems, `each series is read:${list(problems)}`).toEqual([]);
    // Not vacuous: without keep the series holds the samples older than half a second, which keep leaves out.
    expect(stepsOf(all.rows), 'without keep the series holds every sample of the bake, 0.1 s to 1 s').toEqual(everyNth(SAMPLE, SAMPLE, SECOND));
    const failures = [
      ...keptFailures(one.rows, SECOND, 'keep: 0.5 s, read at 1 s'), ...meanFailures(one.rows, 'keep: 0.5 s, read at 1 s'),
      ...keptFailures(earlier.rows, EARLIER, 'keep: 0.5 s, read at 0.8 s'), ...meanFailures(earlier.rows, 'keep: 0.5 s, read at 0.8 s'),
    ];
    expect(failures, `the series holds only the samples of the last 0.5 s, each the sample the unkept series holds there:${list(failures)}`).toEqual([]);
  }, TIMEOUT);
});
