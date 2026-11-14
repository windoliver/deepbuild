// #524.d7f0282a: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the rope bridge
// and banner labs step live on Rapier's soft bodies within the physics module's budget, under 2 ms of CPU per 120 Hz
// step, on their goldens"
//
// A timed file (README: The budgets). Per docs/parallel-proof.md §12a the budget window measures this criterion on the
// reference Mac against the merge base, once a task of benchmarks/budgets.json names it. In order:
//   1. The record: benchmarks/budgets.json holds the task `physics-soft-labs` (`node benchmarks/physics.mjs soft-labs`)
//      with the issue's numbers as its targets (bridge_step_ms 2, banner_step_ms 2), the lane's margin 0.5, a reason
//      naming #524 and this criterion's ID; the lane's validator accepts the file against the merge base's.
//   2. What the criterion names, on any machine: each lab's world, built by deep-physics in its scene, holds Rapier soft
//      bodies (the bridge its soft ropes, the banner its 28 × 10 cloth); and "their goldens": each lab's golden over its
//      first 600 steps, recorded here (#2010's `golden`, on the scene's world), verifies here (`golden_verify`: PASS).
//   3. Only on a reference Mac at rest (scripts/benchmark.mjs judgeLimit's rule, read for the machine and the load
//      alone), the task's own judge on this checkout (the window's `judgeTargets`): both targets judged, a FAIL fails,
//      anything but PASS is INCONCLUSIVE. Off the reference Mac or under load the test is INCONCLUSIVE before anything is
//      timed, never PASS.
import { describe, expect, it } from 'vitest';
import {
  BANNER_NU, BANNER_NV, CRITERIA, LABS_TASK, OTHER, TIMEOUT, ask, builtOf, check, goldenOf, inconclusive, isObject, judgeTask, labOf, load, none,
  on, prebuild, recordFailures, show, standing, useTemp,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const ID = CRITERIA[9];
const STEPS = 600;

describe(`${ID} the rope bridge and banner labs step live on Rapier's soft bodies within the module's budget, on their goldens`, () => {
  it(`${ID} recorded for the budget window, the two labs on Rapier's soft bodies with goldens that verify here, and on a reference Mac at rest each lab's 120 Hz step under 2 ms of CPU`, async () => {
    const start = load();
    none(await recordFailures(LABS_TASK, ID), `benchmarks/budgets.json records ${LABS_TASK.id} for the budget window`);
    const [bridge, banner] = [labOf('bridge'), labOf('banner')];
    const [cb, cn] = ask([check(bridge), check(banner)]);
    const b = builtOf(cb, 'the rope bridge lab');
    expect(Object.values(b.soft).filter((s) => s.shape === 'rope').length, 'the bridge lab steps soft ropes').toBeGreaterThan(0);
    const n = builtOf(cn, 'the banner lab');
    expect([n.soft['banner']?.shape, n.soft['banner']?.particles], 'the banner lab steps its 28 × 10 cloth').toEqual(['cloth', BANNER_NU * BANNER_NV]);

    const store = temp();
    const labs = [['the rope bridge lab', bridge], ['the banner lab', banner]] as const;
    const recorded = ask(labs.map(([, w]) => ({ call: 'golden', ...on(w), steps: STEPS, store, verify_on: [OTHER] })));
    const goldens = recorded.map((r, i) => goldenOf(r, `${labs[i]![0]}'s golden`));
    const verified = ask(labs.map(([, w], i) => ({ call: 'golden_verify', golden: goldens[i]!, ...on(w), steps: STEPS, store })));
    verified.forEach((r, i) => expect(r['verdict'], `${labs[i]![0]}'s golden verifies on this machine: ${show(r)}`).toBe('PASS'));

    const here = await standing({ start, end: load() });
    if (here.status !== 'PASS') inconclusive(`the budgets are judged only on a reference Mac at rest: ${here.reason}`);
    const judged = await judgeTask(LABS_TASK);
    const targets = isObject(judged['targets']) ? judged['targets'] : {};
    expect(Object.keys(targets).sort(), `the task's judge judges both labs: ${show(judged)}`).toEqual(Object.keys(LABS_TASK.targets).sort());
    expect(judged['status'], `the task's judge: ${show(judged)}`).not.toBe('FAIL');
    if (judged['status'] !== 'PASS') inconclusive(`the task's judge reads ${String(judged['status'])}: ${show(judged)}`);
  }, 4 * TIMEOUT);
});
