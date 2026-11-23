// #2654 criterion 5: "`deep-mcp-30d` in `benchmarks/budgets.json` retires no more instructions and peaks no higher
// than on the merge base"
//
// The measurement is the local preflight's perf lane: it runs the task's command on the change and on the merge base
// and judges instructions retired and peak memory (scripts/benchmark.mjs). A checkout can't run its own merge base, so
// what this test holds is that the lane still measures the same thing on both sides with no more room than the merge
// base gives: deep-mcp-30d is in budgets.json with the base's command, a margin no wider and no limit raised. It passes
// at the base by construction; it fails only on a budgets.json that drops or loosens the task (a planted twin).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, REPO } from './helpers.ts';

/** deep-mcp-30d at the base, 58b4a8cb2. */
const BASE = { command: ['node', 'benchmarks/mcp.mjs'], margin: 0.5, limits: {} as Record<string, number> };

test(`${AC.budgets} deep-mcp-30d stays in benchmarks/budgets.json with the merge base's command, a margin no wider than 0.5 and no limit raised, so the preflight's perf lane compares instructions retired and peak memory with the merge base`, () => {
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
