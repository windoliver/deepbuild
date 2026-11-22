// #2648 AC5: "`hub-idle` in `benchmarks/budgets.json` reports wakeups and instructions a second beside its CPU, and
// its record keeps both".
//
// The task's own command, as budgets.json names it, run once: its report, the last stdout line that is a JSON object,
// holds `wakeupsPerSecond` and `instructionsPerSecond` beside `idleCpuPercent`, each the hub's own reading over the
// reader's span (README, Choices). The budget window's record keeps a task's numbers as the readings of its limits
// (scripts/benchmark.mjs: judgeTask, `report.<name>`; scripts/budget-window.mjs: each row's `limits`), so the task holds
// a count ceiling on each, valid against the merge base's manifest, and the base's judge keeps this run's readings. The
// wrong program is the merge base.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AC5, cleanup, gitEnv, mergeBaseCommit, NODE, REPO, run, type Line } from './helpers.ts';

afterAll(cleanup, 120_000);

/** The two numbers the report gains, and the count ceilings that make the record keep them (README, Choices). */
const WAKEUPS = 'wakeupsPerSecond';
const INSTRUCTIONS = 'instructionsPerSecond';
const CPU = 'idleCpuPercent';

interface Task { id: string; command: string[]; limits: Record<string, number> }
type Benchmark = {
  validateBudgets(current: unknown, base: unknown, approved?: string[]): unknown;
  judgeCount(o: { limit: number; runs: (number | null)[] }): { status: string; limit: number; runs: (number | null)[]; reason?: string };
};

/** The number `name` in a run's report, its last stdout line that is a JSON object, as the perf lane reads `report.<name>`: null when it can't be read. */
function reported(stdout: string, name: string): number | null {
  try {
    const value = (JSON.parse(stdout.trim().split('\n').filter((line) => line.trim().startsWith('{')).at(-1)!) as Line)[name];
    return Number.isFinite(value) ? (value as number) : null;
  } catch {
    return null;
  }
}

describe(`AC5 ${AC5} hub-idle reports wakeups and instructions a second beside its CPU, and its record keeps both`, () => {
  it(`AC5 ${AC5} hub-idle's report holds ${WAKEUPS} and ${INSTRUCTIONS} beside ${CPU}, and its limits hold report.${WAKEUPS} and report.${INSTRUCTIONS}`, async () => {
    const bench = (await import(pathToFileURL(join(REPO, 'scripts/benchmark.mjs')).href)) as Benchmark;
    const manifest = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const task = manifest.tasks.find((t) => t.id === 'hub-idle');
    if (!task) throw Error('BLOCKED: benchmarks/budgets.json holds no hub-idle task');
    const [command, ...args] = task.command;
    const ran = await run(command === 'node' ? NODE : command!, args, { cwd: REPO, timeoutMs: 600_000 });
    if (ran.code !== 0) throw Error(`BLOCKED: hub-idle's command ${task.command.join(' ')} exited ${ran.code}: ${ran.stderr.slice(-1500)}`);
    const line = JSON.parse(ran.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).at(-1)!) as Line;
    console.log(`AC5 reading: hub-idle's report ${JSON.stringify(line)}`);

    // Its report: both numbers beside its CPU, each the hub's own reading a second over the span.
    expect(reported(ran.stdout, CPU), `AC5 ${AC5}: hub-idle's report keeps its CPU, ${CPU}: ${JSON.stringify(line)}`).not.toBeNull();
    for (const name of [WAKEUPS, INSTRUCTIONS]) {
      expect(reported(ran.stdout, name), `AC5 ${AC5}: hub-idle reports no ${name} beside ${CPU}, a number of its report's own: ${JSON.stringify(line)}`).not.toBeNull();
      expect(reported(ran.stdout, name)!, `AC5 ${AC5}: hub-idle's ${name} is a reading, above 0`).toBeGreaterThan(0);
    }
    const span = Number(line.spanMs) / 1000;
    const own: Record<string, number> = { [WAKEUPS]: Number(line.hub?.wakeups) / span, [INSTRUCTIONS]: Number(line.hub?.instructionsPerSecond) };
    for (const name of [WAKEUPS, INSTRUCTIONS]) {
      const value = reported(ran.stdout, name)!;
      expect(Math.abs(value - own[name]!) / own[name]!, `AC5 ${AC5}: hub-idle's ${name} ${value} is not the hub's own reading over its span, ${own[name]} (the line's hub)`).toBeLessThanOrEqual(0.02);
    }

    // Its record: the budget window keeps a number's readings as a count ceiling's, so the task holds one on each.
    const shown = await run('git', ['show', `${await mergeBaseCommit()}:benchmarks/budgets.json`], { cwd: REPO, env: gitEnv() });
    if (shown.code !== 0) throw Error(`BLOCKED: the merge base's benchmarks/budgets.json can't be read: ${shown.stderr}`);
    for (const name of [WAKEUPS, INSTRUCTIONS]) {
      const limit = task.limits[`report.${name}`];
      expect(limit, `AC5 ${AC5}: hub-idle's limits hold no report.${name}, so its record keeps no reading of it: ${JSON.stringify(task.limits)}`).toBeTypeOf('number');
      const kept = bench.judgeCount({ limit: limit!, runs: [reported(ran.stdout, name)] });
      expect(kept.runs, `AC5 ${AC5}: the record's row for report.${name} keeps this run's reading`).toEqual([reported(ran.stdout, name)]);
    }
    expect(() => bench.validateBudgets(manifest, JSON.parse(shown.stdout)), `AC5 ${AC5}: benchmarks/budgets.json is valid against the merge base's`).not.toThrow();
  }, 900_000);
});
