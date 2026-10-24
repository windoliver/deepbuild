// AC8: budgets, on the reference Mac in the local preflight, compared with the merge base: loading an extension takes
// under 100 ms; the host adds under 0.5 ms per event for each subscribed extension.
//
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #236's and #30's
// budgets are: a task for the extension host, a #348 first measurement (the merge base has no host), valid against
// the merge base's budgets. Its bench prints one JSON line of four readings, for a package in the hub (a release
// package) and one in the sandbox:
//   {"loadMs": {"hub": <median ms to load one TypeScript extension>, "sandbox": <...>},
//    "eventMs": {"hub": <median ms the host adds per event per subscribed extension>, "sandbox": <...>}}
// eventMs is a difference, never a ratio: (the time to deliver a batch of events with N extensions subscribed, minus
// the same with none) / (events × N), over a batch large enough that one reading's noise stays well under 0.5 ms.
// Each limit is judged by the design's timing rule on five bench runs after a warm-up run, on a reference Mac in a
// fit state only. Anywhere else the number fails BLOCKED, never passes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { environmentProblem, judgeTiming, NODE, REPO } from './helpers.ts';

const TASK = 'extension-host';
const BENCH = ['node', 'benchmarks/extension-host.mjs'];
type Task = { id: string; command: string[]; initialReason: string };
type Places = { hub: number; sandbox: number };
type Reading = { loadMs: Places; eventMs: Places };

const isPlaces = (v: unknown): v is Places => typeof v === 'object' && v !== null && ['hub', 'sandbox'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number' && Number.isFinite((v as Record<string, number>)[k]) && (v as Record<string, number>)[k]! >= 0);

/** One run of the bench: its last line, the four readings. */
function bench(): Reading {
  const out = execFileSync(NODE, [join(REPO, BENCH[1]!)], { cwd: REPO, encoding: 'utf8', timeout: 600_000 }).trim().split('\n').pop()!;
  const line = JSON.parse(out) as Partial<Reading>;
  if (!isPlaces(line.loadMs) || !isPlaces(line.eventMs)) throw Error(`the bench printed ${out}, not {loadMs: {hub, sandbox}, eventMs: {hub, sandbox}}`);
  return line as Reading;
}

describe('AC8 #348.b0d5cd73 loading an extension takes under 100 ms, and the host adds under 0.5 ms per event per subscribed extension, on the reference Mac, compared with the merge base', () => {
  it(`AC8 the perf lane has a ${TASK} task running ${BENCH.join(' ')}, a #348 first measurement, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('/usr/bin/git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `budgets.json has a task ${TASK}`).toBeDefined();
    expect(task!.command).toEqual(BENCH);
    expect(task!.initialReason, 'it says why, naming issue #348').toMatch(/#348\b/);
  });

  it(`AC8 \`${BENCH.join(' ')}\` runs, exits 0 and prints the four readings`, () => {
    const r = bench();
    expect(r.loadMs.hub).toBeGreaterThan(0);
    expect(r.loadMs.sandbox).toBeGreaterThan(0);
  }, 600_000);

  it('AC8 on the reference Mac, a load is under 100 ms and the host adds under 0.5 ms per event per subscribed extension, in the hub and in the sandbox (five bench runs each, by the timing rule)', () => {
    const problem = environmentProblem();
    if (problem) throw Error(`BLOCKED: the budget counts only on a reference Mac in a fit state: ${problem}`);
    bench();
    const runs: Reading[] = [];
    for (let i = 0; i < 5; i++) runs.push(bench());
    const problems = [
      judgeTiming('AC8 load, hub (ms)', runs.map((r) => r.loadMs.hub), 100),
      judgeTiming('AC8 load, sandbox (ms)', runs.map((r) => r.loadMs.sandbox), 100),
      judgeTiming('AC8 per event per subscribed extension, hub (ms)', runs.map((r) => r.eventMs.hub), 0.5),
      judgeTiming('AC8 per event per subscribed extension, sandbox (ms)', runs.map((r) => r.eventMs.sandbox), 0.5),
    ].filter((p): p is string => p !== null);
    if (problems.some((p) => p.startsWith('FAIL'))) expect.fail(problems.join('\n'));
    if (problems.length) throw Error(problems.join('\n'));
  }, 3_600_000);
});
