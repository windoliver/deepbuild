// #21 AC3: the budgets' place in the local preflight and the recorded numbers. The perf lane (scripts/perf.mjs,
// benchmarks/budgets.json) is how a budget is "compared with the merge base" (#12, #315): each task runs a bench
// in 20 rounds interleaved with the merge base's, and a task new on this change says why in its initialReason.
// #21's tasks run a bench over 1,000 or more tool calls that prints its readings as one JSON line, as
// benchmarks/deep-hook.mjs's modes do. "Both numbers are recorded" is the run that set the budget, written down in
// docs/spikes/21/record.json's `budgets` with its date, machine and method (README: Readings). The numbers themselves
// are measured by the tests, on the replayed days (replay.test.ts AC3) and on the live day (sessions.live.test.ts).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC3, isReferenceMachine, jsonLines, NODE, REPO, run, shownRan, type Line } from './helpers.ts';

const RECORD = join(REPO, 'docs/spikes/21/record.json');
interface Task { id: string; command: string[]; initialReason: string; limits: Line; margin: number }

const budgets = () => JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
/** The merge base's budgets.json, as the perf lane reads it. */
function baseBudgets(): { tasks: Task[] } {
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  return JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })) as { tasks: Task[] };
}
/** #21's perf tasks: the ones whose first measurement names issue #21. */
const ours = (tasks: Task[]) => tasks.filter((t) => /#21\b/.test(String(t.initialReason)));

describe(`${AC3} Budgets, on the reference Mac in the local preflight, compared with the merge base: over 1,000 real tool calls, hook overhead stays under 10 ms at p95 and fail-open under 50 ms, and both numbers are recorded`, () => {
  it(`${AC3} the perf lane has #21's tasks, each a bench under benchmarks/ with a first measurement naming #21, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = budgets();
    validateBudgets(current, baseBudgets());
    const tasks = ours(current.tasks);
    expect(tasks.map((t) => t.id), 'benchmarks/budgets.json has at least one task whose initialReason names #21').not.toEqual([]);
    const base = new Set(baseBudgets().tasks.map((t) => t.id));
    for (const t of tasks) {
      expect(t.command.slice(0, 2), `${t.id} runs a bench under benchmarks/ with node`).toEqual(['node', expect.stringMatching(/^benchmarks\/[\w-]+\.mjs$/)]);
      // A task the merge base already has is frozen there; #21's is new, so the lane records it as INITIAL with its reason.
      expect(base.has(t.id), `${t.id} is new on this change, not one the merge base froze`).toBe(false);
    }
  });

  it(`${AC3} #21's benches run, each over 1,000 or more tool calls, and between them print both numbers: the hook overhead at p95 and the fail-open time`, async () => {
    const tasks = ours(budgets().tasks);
    expect(tasks.length, 'benchmarks/budgets.json has #21\'s tasks').toBeGreaterThan(0);
    const lines: Line[] = [];
    for (const t of tasks) {
      const r = await run(NODE, [join(REPO, t.command[1]!), ...t.command.slice(2)], { timeoutMs: 1_500_000 });
      expect(r.code, `${t.id}: ${t.command.join(' ')} exits 0: ${shownRan(r)}`).toBe(0);
      const printed = jsonLines(r.stdout);
      expect(printed.length, `${t.id} prints its readings as a JSON line: ${shownRan(r)}`).toBeGreaterThan(0);
      lines.push(...printed.map((l) => ({ ...l, task: t.id })));
    }
    const reading = (field: string) => lines.find((l) => Number.isFinite(l[field]) && Number(l.calls) >= 1000);
    expect(reading('overheadP95Ms'), `a #21 bench prints overheadP95Ms with calls >= 1000: ${JSON.stringify(lines)}`).toBeDefined();
    expect(reading('failOpenP95Ms'), `a #21 bench prints failOpenP95Ms with calls >= 1000: ${JSON.stringify(lines)}`).toBeDefined();
  }, 3_000_000);

  it(`${AC3} both numbers are recorded: docs/spikes/21/record.json holds five runs of each from a reference Mac, with the date, the machine, the method and the commands of #21's perf tasks, all within the budgets`, () => {
    expect(existsSync(RECORD), `${RECORD} exists`).toBe(true);
    const b = (JSON.parse(readFileSync(RECORD, 'utf8')) as Line).budgets as Line | undefined;
    expect(b, 'record.json has a budgets section').toBeDefined();
    expect(String(b!.date), 'budgets.date is a date, YYYY-MM-DD, not after today').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(`${b!.date}T00:00:00Z`) <= Date.now(), 'budgets.date is not in the future').toBe(true);
    expect(isReferenceMachine(b!.machine), `budgets.machine is a reference Mac on mains power, Low Power Mode off, thermal state nominal, with its macOS build: ${JSON.stringify(b!.machine)}`).toBe(true);
    expect(String(b!.method ?? '').trim().length, 'budgets.method says, in words, how the numbers were taken').toBeGreaterThanOrEqual(40);
    expect(Number(b!.calls), 'budgets.calls is 1,000 or more').toBeGreaterThanOrEqual(1000);
    const commands = ours(budgets().tasks).map((t) => JSON.stringify(t.command));
    expect((b!.commands as string[][] | undefined)?.map((c) => JSON.stringify(c)).sort(), 'budgets.commands are #21\'s perf tasks\' commands').toEqual(commands.sort());
    for (const [field, limit] of [['overheadP95Ms', 10], ['failOpenP95Ms', 50]] as const) {
      const runs = b![field] as number[] | undefined;
      expect(Array.isArray(runs) && runs.length === 5 && runs.every((r) => Number.isFinite(r) && r > 0), `budgets.${field} holds the five runs: ${JSON.stringify(runs)}`).toBe(true);
      expect(runs!.every((r) => r < limit), `every recorded run of ${field} is under ${limit} ms: ${JSON.stringify(runs)}`).toBe(true);
    }
  });
});
