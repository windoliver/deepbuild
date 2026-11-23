// Criterion 4: budgets, on the reference Mac in the local preflight, compared with the merge base: the 800-body world
// of the step budget (#2011) stays under its `budget.step_p95`, and the report lists the step's p50 and p95 before and
// after, so what the change costs a pile at rest is a number you see.
//
// The 800-body world is #1921's drop (its `dropScene`), timed by #2011's check, `node scripts/physics-budget.mjs`, on
// the app host, as #1921's sixth criterion times it; the web host is asked with no reference Mac and isn't judged.
// The request names the merge base's release build as `before` (README: The budget report). Everything the report
// lists apart from the verdict is judged first. Then the verdict is the reference-Mac rule's own: off a reference
// Mac, or under load, it reads INCONCLUSIVE and this test fails with `INCONCLUSIVE:`, never passing.
import { describe, expect, test } from 'vitest';
import { DROP_STEPS, DROP_WORLD, dropScene } from '../1921/helpers.ts';
import { LIMIT_MS, hostTriple, reportFailures, timedFailures } from '../2011/helpers.ts';
import { AC, BASE_TIMEOUT, baseBin, budget, comparedFailures, show, stepTimes, withBase } from './helpers.ts';

withBase();

const ms = (runs: number[]): string => runs.map((r) => r.toFixed(3)).join(', ');

describe(`${AC[4]} the 800-body world's step budget on the reference Mac, with its step times before and after`, () => {
  test(`${AC[4]} the report lists the step's p50 and p95 on the merge base's build and on this one, and the 800-body world stays under its budget.step_p95`, () => {
    const { sha, bin } = baseBin();
    const triple = hostTriple();
    const run = budget({ scene: dropScene(), world: DROP_WORLD, steps: DROP_STEPS, reference_mac: { app: true, web: false }, before: bin });
    expect(run.problem, 'node scripts/physics-budget.mjs answers one report').toBe('');
    const { app, before, after } = stepTimes(run.report);
    if (before && after) console.log(`the 800-body world's step, five runs each, ms: p50 ${ms(before.p50)} before (the merge base ${sha.slice(0, 12)}) and ${ms(after.p50)} after; p95 ${ms(before.p95)} before and ${ms(after.p95)} after`);
    const failures = [...reportFailures(run.report), ...timedFailures(run.report, 'app', DROP_STEPS, triple), ...comparedFailures(run.report)];
    expect(failures, `the report on the 800-body world, timed on this Mac's release build and on the merge base's:\n  ${failures.join('\n  ')}`).toEqual([]);
    const runs = `runs ${show(app['runs'])} ms against ${LIMIT_MS} ms; ${String(app['reason'] ?? '')}`;
    const inconclusive = app['verdict'] === 'INCONCLUSIVE' ? 'INCONCLUSIVE: a reading, not a budget result, and not a pass: ' : '';
    expect(app['verdict'], `${inconclusive}the 800-body world's step stays under its budget.step_p95 at the 95th percentile in every run: ${runs}`).toBe('PASS');
  }, BASE_TIMEOUT);
});
