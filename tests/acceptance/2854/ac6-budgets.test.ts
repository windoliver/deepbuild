// #2854 AC6: "`deep-mcp-30d` in `benchmarks/budgets.json` retires no more instructions and peaks no higher than on the
// merge base"
//
// The measurement is the local preflight's perf lane: it runs the task's command on the change and on the merge base
// and judges instructions retired and peak memory (scripts/benchmark.mjs), as #2897 AC8 left it. What a checkout can
// show is benchmarks/budgets.json: the task is still there with the merge base's command, so both sides measure the
// same thing, and the room it gives the change is no wider than the merge base's (margin 0.5, no limits). This test
// passes on the merge base by its nature (README: The budget criterion).
import { describe, expect, it } from 'vitest';
import { AC, budgets } from './helpers.ts';

/** deep-mcp-30d at the merge base, 58b4a8cb2. */
const BASE = { command: ['node', 'benchmarks/mcp.mjs'], margin: 0.5, limits: {} as Record<string, number> };

describe(`${AC.budgets} deep-mcp-30d no worse than the merge base`, () => {
  it(`${AC.budgets} deep-mcp-30d stays in benchmarks/budgets.json with the merge base's command, a margin no wider than 0.5 and no limit raised, so the perf lane compares instructions and peak memory with the merge base`, () => {
    const task = budgets().tasks.find((t) => t.id === 'deep-mcp-30d');
    expect(task, 'benchmarks/budgets.json holds deep-mcp-30d').toBeDefined();
    const failures: string[] = [];
    if (JSON.stringify(task!.command) !== JSON.stringify(BASE.command)) failures.push(`deep-mcp-30d's command is ${JSON.stringify(task!.command)}, not the merge base's ${JSON.stringify(BASE.command)}`);
    if (typeof task!.margin !== 'number' || task!.margin > BASE.margin) failures.push(`deep-mcp-30d's margin is ${JSON.stringify(task!.margin)}, wider than the merge base's ${BASE.margin}`);
    for (const [key, value] of Object.entries(task!.limits ?? {})) {
      const was = BASE.limits[key];
      if (typeof value !== 'number' || (was !== undefined && value > was)) failures.push(`deep-mcp-30d's limit ${key} is ${JSON.stringify(value)}, above the merge base's ${was ?? 'none'}`);
    }
    expect(failures, 'deep-mcp-30d as the perf lane reads it').toEqual([]);
  });
});
