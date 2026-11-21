// #2998 acceptance, AC3: 30 runs of the hub-round-trip budget task under the perf lane's counter never name
// /usr/bin/sandbox-exec in uncounted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureOnce } from '../../../scripts/benchmark.mjs';
import { describe, expect, test } from 'vitest';
import { REPO, SANDBOX_EXEC } from './helpers.mjs';

const mac = process.platform === 'darwin';
const OFF_MAC = 'macOS only (the issue\'s Runs on): Linux\'s sandbox reports come through the run\'s parent, with no canary';
const RUNS = 30;

describe('AC3 #2998.7f39b900 30 measureOnce runs of hub-round-trip never name /usr/bin/sandbox-exec in uncounted', () => {
  test.skipIf(!mac)(`AC3 ${RUNS} measureOnce runs of the hub-round-trip budget task never name ${SANDBOX_EXEC} in uncounted${mac ? '' : ` (skipped: ${OFF_MAC})`}`, () => {
    // The task's command as the budgets file records it, run as the perf lane runs a budget's command.
    const task = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')).tasks.find((t) => t.id === 'hub-round-trip');
    expect(task, 'benchmarks/budgets.json has a hub-round-trip task').toBeTruthy();
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const run = measureOnce(task.command, REPO);
      expect(run.status, `run ${i + 1} of ${task.command.join(' ')} exited ${run.status}: ${run.output}`).toBe(0);
      // The counter ran and read this run: on a Mac without it, every count is missing and uncounted empty.
      expect(run.instructions !== null || run.uncounted.length > 0, `BLOCKED: run ${i + 1} has no reading from the perf lane's counter (instructions ${run.instructions}, uncounted [])`).toBe(true);
      runs.push({ run: i + 1, instructions: run.instructions, uncounted: run.uncounted });
    }
    expect(runs.filter((r) => r.uncounted.includes(SANDBOX_EXEC)), `runs whose uncounted names ${SANDBOX_EXEC}, of ${JSON.stringify(runs)}`).toEqual([]);
  }, 1_800_000);
});
