// AC4 #1430.8a0fdfd2: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a width change
// on a 50 KB text under 5 ms, and a typed character under 2 ms"
//
// A timed file (README: The budget task). Per docs/parallel-proof.md §12a the budget window measures a budget criterion
// that says "in the local preflight" on a reference Mac against the merge base, once a task of benchmarks/budgets.json
// names it. In order:
//   0. The record judge fails its planted wrong records and passes its clean twin, the merge base's budgets.json with
//      the task added, so the shape below is one the lane's own validator takes.
//   1. The record: benchmarks/budgets.json holds the task `canvas-text-reflow` (`node benchmarks/canvas.mjs
//      text-reflow`), its targets the issue's two numbers, the lane's margin 0.5 against the merge base, a reason naming
//      #1430 and this criterion's ID; the lane's validator takes the file against the merge base's.
//   2. Only on a reference Mac at rest (scripts/benchmark.mjs's judgeLimit rule, read for the machine and the load alone,
//      before anything is timed), the task's own judge on this checkout, as the window runs it: its two targets judged,
//      a FAIL fails, BLOCKED is BLOCKED, anything else but PASS is INCONCLUSIVE. Elsewhere INCONCLUSIVE, never PASS.
import { describe, expect, it } from 'vitest';
import {
  AC, REFLOW_TASK, TIMEOUT, blocked, budgetFiles, failsNaming, idOf, inconclusive, isObject, judgeTask, load, none, recordFailures, show, standing,
  type JsonObject,
} from './helpers.ts';

const ID = AC[4];

describe(`${ID} the text's budgets: recorded for the budget window against the merge base, judged on a reference Mac at rest`, () => {
  it(`${ID} the task canvas-text-reflow records a width change on a 50 KB text under 5 ms and a typed character under 2 ms for this criterion, against the merge base; on a reference Mac at rest its judge passes them`, async () => {
    const start = load();
    const criterion = idOf(ID);

    // 0. The record judge against its planted wrong records.
    const { current, base } = budgetFiles();
    const baseTasks = Array.isArray(base['tasks']) ? base['tasks'] : [];
    const clean: JsonObject = { ...base, tasks: [...baseTasks, { ...REFLOW_TASK, margin: 0.5, limits: {}, criteria: [criterion], initialReason: 'Issue #1430 first measurement: the merge base has no such task.' }] };
    none(await recordFailures(clean, base, REFLOW_TASK, criterion), 'the record judge passes the merge base with the task added');
    const planted = (change: (task: JsonObject) => JsonObject): JsonObject =>
      ({ ...clean, tasks: (clean['tasks'] as JsonObject[]).map((t) => (t['id'] === REFLOW_TASK.id ? change(t) : t)) });
    failsNaming(await recordFailures(planted((t) => ({ ...t, targets: { ...REFLOW_TASK.targets, width_change_50kb_ms: 10 } })), base, REFLOW_TASK, criterion), [/the issue's numbers/], 'planted: a width change allowed 10 ms');
    failsNaming(await recordFailures(planted((t) => ({ ...t, criteria: [] })), base, REFLOW_TASK, criterion), [/never measures it/], 'planted: the criterion not named');
    failsNaming(await recordFailures(planted((t) => ({ ...t, margin: 1 })), base, REFLOW_TASK, criterion), [/margin/], 'planted: another margin against the merge base');
    failsNaming(await recordFailures(planted((t) => ({ ...t, initialReason: '' })), base, REFLOW_TASK, criterion), [/initialReason|validator/], 'planted: no reason');
    failsNaming(await recordFailures({ ...clean, tasks: (clean['tasks'] as JsonObject[]).slice(1) }, base, REFLOW_TASK, criterion), [/validator refuses/], 'planted: a frozen task of the merge base removed');

    // 1. The record.
    none(await recordFailures(current, base, REFLOW_TASK, criterion), `benchmarks/budgets.json records ${REFLOW_TASK.id} for the budget window`);

    // 2. The times, on a reference Mac at rest only.
    const here = await standing({ start, end: load() });
    if (here.status !== 'PASS') inconclusive(`the times are judged only on a reference Mac at rest: ${here.reason}`);
    const judged = await judgeTask(REFLOW_TASK);
    if (judged['status'] === 'BLOCKED') blocked(`the task's judge couldn't run: ${show(judged)}`);
    const targets = judged['targets'];
    expect(Object.keys(isObject(targets) ? targets : {}).sort(), `the task's judge judges its two targets: ${show(judged)}`).toEqual(Object.keys(REFLOW_TASK.targets).sort());
    expect(judged['status'], `the task's judge: ${show(judged)}`).not.toBe('FAIL');
    if (judged['status'] !== 'PASS') inconclusive(`the task's judge reads ${String(judged['status'])}: ${show(judged)}`);
  }, TIMEOUT);
});
