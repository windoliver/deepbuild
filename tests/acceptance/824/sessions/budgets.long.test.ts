// #824 AC4, the budget: the per-session reading's default run, on a reference Mac in a fit state, with the merge base's
// reading beside it. Anywhere else it is a reading, skipped as INCONCLUSIVE, never passed. Long (the merge base is
// built, deep-hook with it): run by hand (README, What scripts/lanes.mjs needs).
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, environmentProblem, MINUTE, REPO } from '../helpers.ts';
import { AC4, bench, COUNTS, CRITERION, LIMIT, lineFrom, perSessionGrowth, shown, worded } from './helpers.ts';

afterEach(cleanup, MINUTE);

const TWO_HOURS = 120 * MINUTE;
const problem = environmentProblem();

describe(`${AC4} ${CRITERION}: the budget`, () => {
  it(`${AC4} the default run on a reference Mac: each session added past the first raises the summed memory under 25 MB, the merge base's reading beside it`, async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const r = await bench({ args: ['--merge-base'], timeoutMs: TWO_HOURS });
    const line = lineFrom(r);
    const growth = perSessionGrowth(line);
    console.log(`#824 per added session: ${growth} B, the most from ${line.grew.role}; merge base ${JSON.stringify(line.mergeBase)}`);
    expect(line.readings.map((x) => x.sessions), `the issue's counts: ${shown(r)}`).toEqual(COUNTS);
    expect(line.method, 'shared pages counted once, as macOS reads them').toBe('phys_footprint');
    expect(growth, `the summed memory's growth per added session, recomputed from the readings, in bytes: ${shown(r)}`).toBeLessThan(LIMIT);
    expect(r.code, `an under-budget run exits 0: ${shown(r)}`).toBe(0);
    expect(worded(r, 'FAIL'), 'an under-budget run prints no FAIL').toBeUndefined();
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    expect(line.mergeBase?.commit, 'the comparison names the merge base').toBe(base);
    const measured = Number.isFinite(line.mergeBase?.perSessionBytes);
    expect(measured || (line.mergeBase?.initial ?? '').trim().length > 0, `the merge base's reading, or the reason it has none: ${JSON.stringify(line.mergeBase)}`).toBe(true);
  }, TWO_HOURS + MINUTE);
});
