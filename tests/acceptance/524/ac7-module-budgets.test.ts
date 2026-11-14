// #524.584c6e80: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a 120 Hz step of
// the bridge lab (about 35 bodies and particles, 32 joints) and of a 200-body stress world each take under 2 ms of CPU;
// a 10-second bake under 1 s; a world stays under 50 MB; and the seal's interface checks and the runtime digest together
// add under 5 ms at startup"
//
// A timed file (README: The budgets). Per docs/parallel-proof.md §12a the budget window measures this criterion on the
// reference Mac against the merge base, once a task of benchmarks/budgets.json names it. In order:
//   1. The record: benchmarks/budgets.json holds the task `physics-module` (`node benchmarks/physics.mjs module`) with
//      the issue's numbers as its targets (bridge_step_ms 2, stress_step_ms 2, bake_10s_ms 1000, world_mb 50,
//      startup_ms 5), the lane's margin 0.5, a reason naming #524 and this criterion's ID; the lane's validator accepts
//      the file against the merge base's.
//   2. The fixture the first number names, on any machine: the rope bridge lab's world, built by deep-physics in its
//      scene, holds soft ropes, 32 joints, and about 35 bodies and particles (30 to 40).
//   3. Only on a reference Mac at rest (scripts/benchmark.mjs judgeLimit's rule, read for the machine and the load
//      alone), the task's own judge on this checkout (the window's `judgeTargets`): every target judged, a FAIL fails,
//      anything but PASS is INCONCLUSIVE. Off the reference Mac or under load the test is INCONCLUSIVE before anything is
//      timed, never PASS.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, MODULE_TASK, TIMEOUT, ask, builtOf, check, inconclusive, isObject, judgeTask, labOf, load, none, prebuild, recordFailures, show,
  standing,
} from './helpers.ts';

prebuild();
const ID = CRITERIA[7];

describe(`${ID} the physics module's budgets, on the reference Mac against the merge base`, () => {
  it(`${ID} recorded for the budget window, the bridge lab as the criterion names it, and on a reference Mac at rest: a bridge step and a 200-body step under 2 ms, a 10 s bake under 1 s, a world under 50 MB, the seal's checks and digest under 5 ms`, async () => {
    const start = load();
    none(await recordFailures(MODULE_TASK, ID), `benchmarks/budgets.json records ${MODULE_TASK.id} for the budget window`);
    const b = builtOf(ask([check(labOf('bridge'))])[0], 'the rope bridge lab');
    expect(Object.values(b.soft).filter((s) => s.shape === 'rope').length, 'the bridge lab stands on soft ropes').toBeGreaterThan(0);
    expect(b.joints, 'the bridge lab holds 32 joints').toBe(32);
    const n = b.rigidBodies + b.particles;
    expect(n >= 30 && n <= 40, `the bridge lab holds about 35 bodies and particles: ${b.rigidBodies} bodies and ${b.particles} particles`).toBe(true);

    const here = await standing({ start, end: load() });
    if (here.status !== 'PASS') inconclusive(`the budgets are judged only on a reference Mac at rest: ${here.reason}`);
    const judged = await judgeTask(MODULE_TASK);
    const targets = isObject(judged['targets']) ? judged['targets'] : {};
    expect(Object.keys(targets).sort(), `the task's judge judges every target: ${show(judged)}`).toEqual(Object.keys(MODULE_TASK.targets).sort());
    expect(judged['status'], `the task's judge: ${show(judged)}`).not.toBe('FAIL');
    if (judged['status'] !== 'PASS') inconclusive(`the task's judge reads ${String(judged['status'])}: ${show(judged)}`);
  }, 4 * TIMEOUT);
});
