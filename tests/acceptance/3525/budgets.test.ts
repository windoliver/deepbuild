// AC8: "Budgets, on the reference Mac in the local preflight, compared with the merge base: `deep-mcp-30d` in
// `benchmarks/budgets.json` retires no more instructions and peaks no higher"
//
// The measurement itself is the local preflight's perf lane on a reference Mac (scripts/benchmark.mjs): it runs the
// task's command on the change and on the merge base and judges instructions retired and peak memory. What a checkout
// can show, as #2897's AC8 test does, is benchmarks/budgets.json: the task is still there with the merge base's
// command, so the preflight measures the same thing on both sides, and the room it gives the change is no wider than
// the merge base's (margin 0.5, no limits). The base passes this by definition; its wrong program is the twin
// `budgets-widened` (README), a budgets.json whose deep-mcp-30d margin is 1, which this test must name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../2898/helpers.ts';
import { AC } from './helpers.ts';

/** deep-mcp-30d at the merge base, b134dd38f. */
const BASE = { command: ['node', 'benchmarks/mcp.mjs'], margin: 0.5, limits: {} as Record<string, number> };

describe('the deep mcp budget', () => {
  it(`AC8 ${AC.budgets} deep-mcp-30d stays in benchmarks/budgets.json with the merge base's command, a margin no wider than 0.5 and no limit raised, so the local preflight compares instructions retired and peak memory with the merge base`, () => {
    const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Array<{ id: string; command?: unknown; margin?: unknown; limits?: Record<string, unknown> }> };
    const task = budgets.tasks.find((t) => t.id === 'deep-mcp-30d');
    expect(task, 'benchmarks/budgets.json holds deep-mcp-30d').toBeDefined();
    const failures: string[] = [];
    if (JSON.stringify(task!.command) !== JSON.stringify(BASE.command)) failures.push(`deep-mcp-30d's command is ${JSON.stringify(task!.command)}, not the merge base's ${JSON.stringify(BASE.command)}`);
    if (typeof task!.margin !== 'number' || task!.margin > BASE.margin) failures.push(`deep-mcp-30d's margin is ${JSON.stringify(task!.margin)}, wider than the merge base's ${BASE.margin}`);
    for (const [key, value] of Object.entries(task!.limits ?? {})) {
      const was = BASE.limits[key];
      if (typeof value !== 'number' || (was !== undefined && value > was)) failures.push(`deep-mcp-30d's limit ${key} is ${JSON.stringify(value)}, above the merge base's ${was ?? 'none'}`);
    }
    expect(failures, 'deep-mcp-30d as the preflight reads it').toEqual([]);
  });
});
