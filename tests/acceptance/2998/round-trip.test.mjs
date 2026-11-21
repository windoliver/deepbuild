// #2998 acceptance, AC3: 30 runs of the hub-round-trip budget task under the perf lane's counter never name
// /usr/bin/sandbox-exec in uncounted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { measureOnce } from '../../../scripts/benchmark.mjs';
import { REPO, SANDBOX_EXEC } from './helpers.mjs';

const OFF_MAC = 'macOS only (the issue\'s Runs on): Linux\'s sandbox reports come through the run\'s parent, with no canary';
const RUNS = 30;

test('AC3 #2998.7f39b900 30 measureOnce runs of the hub-round-trip budget task never name /usr/bin/sandbox-exec in uncounted', { skip: process.platform !== 'darwin' && OFF_MAC, timeout: 1_800_000 }, () => {
  // The task's command as the budgets file records it, run as the perf lane runs a budget's command.
  const task = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')).tasks.find((t) => t.id === 'hub-round-trip');
  assert.ok(task, 'BLOCKED: benchmarks/budgets.json has no hub-round-trip task');
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const run = measureOnce(task.command, REPO);
    assert.equal(run.status, 0, `run ${i + 1} of ${task.command.join(' ')} exited ${run.status}: ${run.output}`);
    // The counter ran and read this run: on a Mac without it, every count is missing and uncounted empty.
    assert.ok(run.instructions !== null || run.uncounted.length > 0, `BLOCKED: run ${i + 1} has no reading from the perf lane's counter (instructions ${run.instructions}, uncounted [])`);
    runs.push({ run: i + 1, instructions: run.instructions, uncounted: run.uncounted });
  }
  assert.deepEqual(runs.filter((r) => r.uncounted.includes(SANDBOX_EXEC)), [], `runs whose uncounted names ${SANDBOX_EXEC}, of ${JSON.stringify(runs)}`);
});
