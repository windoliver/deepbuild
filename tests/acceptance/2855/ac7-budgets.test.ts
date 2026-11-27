import { describe, expect, it } from 'vitest';
import { budgets } from './helpers.ts';

const BASE = { command: ['node', 'benchmarks/mcp.mjs'], margin: 0.5, limits: {} as Record<string, number> };

describe(`#2855.afd330b4 deep-mcp-30d no worse than the merge base`, () => {
  it(`#2855.afd330b4 deep-mcp-30d stays in benchmarks/budgets.json with the merge base's command, a margin no wider than 0.5 and no limit raised, so the perf lane compares instructions and peak memory with the merge base`, () => {
    const task = budgets().tasks.find((t) => t.id === 'deep-mcp-30d');
    const failures: string[] = [];
    if (!task) failures.push('benchmarks/budgets.json holds no deep-mcp-30d');
    else {
      if (JSON.stringify(task.command) !== JSON.stringify(BASE.command)) failures.push(`deep-mcp-30d's command is ${JSON.stringify(task.command)}, not the merge base's ${JSON.stringify(BASE.command)}`);
      if (typeof task.margin !== 'number' || task.margin > BASE.margin) failures.push(`deep-mcp-30d's margin is ${JSON.stringify(task.margin)}, wider than the merge base's ${BASE.margin}`);
      for (const [key, value] of Object.entries(task.limits ?? {})) {
        const was = BASE.limits[key];
        if (typeof value !== 'number' || (was !== undefined && value > was)) failures.push(`deep-mcp-30d's limit ${key} is ${JSON.stringify(value)}, above the merge base's ${was ?? 'none'}`);
      }
    }
    expect(failures, 'deep-mcp-30d as the perf lane reads it').toEqual([]);
  });
});
