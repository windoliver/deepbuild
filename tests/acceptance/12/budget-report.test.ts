// #12 AC6: `scripts/preflight` holds its checks and their builds to the `preflight` budget in benchmarks/budgets.json,
// and a run over it prints `FAIL preflight budget` and exits non-zero; the benchmark harness every later budget uses
// reports p50 and p95 time and peak memory against the merge base, with its sample count, and a report without the
// sample count fails this test.
//
// Two fixtures. In the first, the change's benchmarks/budgets.json gives the preflight 1 ms, which no run of the checks
// fits. In the second, the preflight has this checkout's declared budget, and one task, a Node program that does
// nothing, which the perf lane's harness times against the merge base. Its report is the task's line in the output.
import { afterAll, expect, it } from 'vitest';
import {
  AC6, MINUTE, benchProgram, benchTask, declaredPreflightBudget, fixture, makeBox, needNode, preflight, reading, removeBoxes, shown, sideOf, taskReports,
} from './helpers.ts';

afterAll(removeBoxes, 10 * MINUTE);

const SAMPLES = 20;

/** Every sample count a report states: a number, or a list of the samples, under a key that names samples. */
function sampleCounts(value: unknown, found: number[] = []): number[] {
  if (!value || typeof value !== 'object') return found;
  for (const [key, item] of Object.entries(value)) {
    if (/sample/i.test(key) && typeof item === 'number') found.push(item);
    else if (/sample/i.test(key) && Array.isArray(item)) found.push(item.length);
    else if (item && typeof item === 'object' && !Array.isArray(item)) sampleCounts(item, found);
  }
  return found;
}

it(`${AC6} scripts/preflight holds its checks to the preflight budget in benchmarks/budgets.json, printing FAIL preflight budget over it, and the benchmark harness reports p50, p95 and peak memory against the merge base with its sample count`, () => {
  needNode(AC6);
  // Over the budget.
  const over = makeBox('ac6-over');
  const tight = { margin: 0.5, limits: { elapsedMs: 1 }, initialReason: 'Fixture: a budget of 1 ms, which no run of the checks fits.' };
  fixture(over, { budgets: { base: { tasks: [] }, change: { preflight: tight, tasks: [] } } });
  const late = preflight(over, 10 * MINUTE);
  expect(late.out, `${AC6} a run over the preflight budget in benchmarks/budgets.json prints FAIL preflight budget: ${shown(late)}`).toMatch(/^FAIL preflight budget/m);
  expect(late.status, `${AC6} a run over the preflight budget exits non-zero: ${shown(late)}`).not.toBe(0);

  // The harness's report.
  const box = makeBox('ac6');
  const budgets = { preflight: declaredPreflightBudget(), tasks: [benchTask('sampled')] };
  fixture(box, { budgets: { base: budgets, change: budgets }, base: { 'bench/sampled.mjs': benchProgram('sampled') } });
  const ran = preflight(box, 12 * MINUTE);

  const reports = taskReports(ran.out, 'sampled');
  expect(reports.length, `${AC6} the benchmark harness reports the budget's task: ${shown(ran)}`).toBeGreaterThan(0);
  const [found] = reports;
  for (const which of ['change', 'base'] as const) {
    const side = sideOf(found!, which);
    for (const [label, key] of [['p50 time', /p50/i], ['p95 time', /p95/i], ['peak memory', /peak/i]] as const) {
      const value = reading(side, key);
      expect(value !== undefined && value > 0, `${AC6} the report gives ${which === 'base' ? "the merge base's" : "the change's"} ${label}: ${JSON.stringify(found)}`).toBe(true);
    }
  }
  expect(sampleCounts(found), `${AC6} the report states its sample count, ${SAMPLES} a side: ${JSON.stringify(found)}`).toContain(SAMPLES);
}, 25 * MINUTE);
