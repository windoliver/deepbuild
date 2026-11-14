// AC2 #224.e2f417bd: "A helicoid-to-catenoid family with θ on a slider rebuilds a 128 × 128 grid within 2 ms on the
// reference Mac, a seek to a slider entry gives the same vertex hash as playing to it, and its two marked curves keep
// their lengths within 1e-4 relative, read from evaluated data"
//
// The timed part, a timed file (README: The budget). Per docs/parallel-proof.md §12a the budget window measures a timing
// criterion on the reference Mac against the merge base once a task of benchmarks/budgets.json names it. In order:
//   1. The record: benchmarks/budgets.json holds the task `canvas-surface` (`node benchmarks/canvas.mjs surface`), its
//      target the issue's number, `rebuild_128_ms: 2`, the lane's margin 0.5, a reason naming #224 and this criterion's
//      ID; the lane's validator accepts the file against the merge base's.
//   2. Only on a reference Mac at rest (scripts/benchmark.mjs judgeLimit's rule, read for the machine and the load
//      alone, before anything is timed), the task's own judge on this checkout (the window's `judgeTargets`): its one
//      target judged, a FAIL fails, anything but PASS is INCONCLUSIVE. Off the reference Mac or under load the test is
//      INCONCLUSIVE, never PASS. The functional halves are ac02-family.test.ts's, untimed.
import { describe, expect, it } from 'vitest';
import { AC, SURFACE_TASK, TIMEOUT, idOf, inconclusive, isObject, judgeTask, load, none, recordFailures, shown, standing } from './helpers.ts';

const ID = AC[2];

describe(`${ID} the family's rebuild, on the reference Mac against the merge base`, () => {
  it(`${ID} recorded for the budget window, and on a reference Mac at rest a 128 × 128 rebuild of the family within 2 ms`, async () => {
    const start = load();
    none(await recordFailures(SURFACE_TASK, idOf(ID)), `benchmarks/budgets.json records ${SURFACE_TASK.id} for the budget window`);
    const here = await standing({ start, end: load() });
    if (here.status !== 'PASS') inconclusive(`the rebuild is judged only on a reference Mac at rest: ${here.reason}`);
    const judged = await judgeTask(SURFACE_TASK);
    const targets = isObject(judged['targets']) ? judged['targets'] : {};
    expect(Object.keys(targets).sort(), `the task's judge judges its target: ${shown(judged)}`).toEqual(Object.keys(SURFACE_TASK.targets).sort());
    expect(judged['status'], `the task's judge: ${shown(judged)}`).not.toBe('FAIL');
    if (judged['status'] !== 'PASS') inconclusive(`the task's judge reads ${String(judged['status'])}: ${shown(judged)}`);
  }, 4 * TIMEOUT);
});
