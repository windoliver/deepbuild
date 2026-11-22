// #2960 acceptance, first criterion (bb693bcf): on macOS, measureOnce of deep-hook-guards, deep-hook-overhead,
// hub-round-trip and extension-host at the merge base each give a non-null instruction count with an empty
// uncounted. One test per task, each the task's own command from benchmarks/budgets.json, run by the real
// measureOnce with its real counter, in this checkout, as a perf side runs it. A failing run is named: one
// more run copies the counter's log and says which start has no end, so a counter that ignores _exit (the
// merge base's, and the twin exit-unseen) fails naming the supervisor helper's watcher.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { benchmark, budget, buildDeepHook, diagnose, macReady, root, TIMEOUT_MS } from './helpers.mjs';

const TASKS = ['deep-hook-guards', 'deep-hook-overhead', 'hub-round-trip', 'extension-host'];

before(() => {
  if (process.platform === 'darwin') buildDeepHook();
});

for (const id of TASKS) {
  test(`#2960.bb693bcf measureOnce of ${id} gives a non-null instruction count with an empty uncounted`, { timeout: 2 * TIMEOUT_MS + 600_000 }, async () => {
    macReady();
    const { measureOnce } = await benchmark();
    const task = budget(id);
    const run = measureOnce(task.command, root, false, TIMEOUT_MS);
    assert.equal(run.status, 0, `${id}: ${task.command.join(' ')} exited ${run.status}: ${run.output}`);
    const reading = { instructions: Number.isSafeInteger(run.instructions) && run.instructions > 0 ? 'a count' : run.instructions, uncounted: run.uncounted };
    if (reading.instructions === 'a count' && Array.isArray(run.uncounted) && run.uncounted.length === 0) return;
    assert.deepEqual(reading, { instructions: 'a count', uncounted: [] },
      `${id}: measureOnce read instructions ${JSON.stringify(run.instructions)}, uncounted ${JSON.stringify(run.uncounted)}. What the counter saw start and never end: ${diagnose(measureOnce, task.command)}`);
  });
}
