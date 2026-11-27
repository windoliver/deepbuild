// AC7 #3233.640994cd budgets, on the reference Mac in the local preflight, compared with the merge base: the three
// rules add under 1 ms to the check of a 500-node update. The 1 ms is a target, to be measured.
//
// Split as #1425's budget is (design: Every task carries its own budgets):
// - The merge-base comparison is the perf lane's (scripts/perf.mjs over benchmarks/budgets.json): the first test holds
//   the lane to a task for this budget, `panel-rules-500`, valid against the merge base's budgets, whose command runs.
// - The issue's number is judged here, by the repo's judgeLimit (scripts/benchmark.mjs): PASS when all five runs are
//   within 1 ms, FAIL when all five are over it by more than the margin, else INCONCLUSIVE. At the merge base the
//   three rules add nothing to a check, so what they add is their own time on an update's tree, which
//   `deep-app panel-bench` reports beside the times it reports at the base, as `rulesNs`, one a timed update (README,
//   The surface). The update is a tree of 500 nodes that passes revision 2 and gives each rule its most work
//   (helpers.ts, BENCH_PANEL). A run is one `panel-bench` of one fresh host, 100 updates after its own warm-up, and
//   its reading is its slowest update; the one-minute load is read at each run's start and end.
//   The work runs first, so a missing surface fails. Off a reference Mac, on battery, with Low Power Mode on, the
//   thermal state not nominal or the load above the core count, judgeLimit reads INCONCLUSIVE and the test fails as
//   INCONCLUSIVE with its readings: a time that can't be taken here decides nothing, and is never a pass.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC7, bench, benchBinaries, BENCH_NODES, BUILD_MS, REPO } from './helpers.ts';
import { nodeCount, rulesMs, rulesProblems } from './judges.ts';

const TASK = 'panel-rules-500';
/** The issue's target, in ms. */
const LIMIT_MS = 1;
const RUNS = 5;
const UPDATES = 100;

interface Load { start: number; end: number }
interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): unknown;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Judged;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

test(`AC7 ${AC7} the perf lane has the task ${TASK}, a #3233 first measurement, valid against the merge base's budgets, and it runs`, async () => {
  const { validateBudgets } = await benchmark();
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 })));
  const task = current.tasks.find((t) => t.id === TASK);
  expect(task, `benchmarks/budgets.json has a task ${TASK}`).toBeDefined();
  expect(String(task!.initialReason), `${TASK} says why, naming issue #3233`).toMatch(/#3233\b/);
  const [command, ...args] = task!.command;
  execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, encoding: 'utf8', timeout: BUILD_MS, maxBuffer: 1 << 26 });
}, BUILD_MS);

test(`AC7 ${AC7} on a reference Mac, the three rules add under 1 ms to the check of a 500-node update`, async () => {
  // The work: five runs, each a fresh host, with the load read around each.
  const bins = benchBinaries();
  const readings: number[] = [];
  const loads: Load[] = [];
  for (let run = 0; run < RUNS; run++) {
    const start = loadavg()[0]!;
    const report = bench(bins, 1, UPDATES);
    loads.push({ start, end: loadavg()[0]! });
    expect(nodeCount(report.tree), `BLOCKED unless the panel's update is a tree of ${BENCH_NODES} nodes`).toBe(BENCH_NODES);
    expect(report.runs?.length, 'panel-bench reports the one run asked for').toBe(1);
    expect(rulesProblems(report.runs!, UPDATES), 'each timed update carries the three rules\' time').toEqual([]);
    readings.push(...rulesMs(report.runs!, UPDATES));
  }

  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit: LIMIT_MS, runs: readings, fingerprint: machine, loads });
  const shown = `the three rules on a ${BENCH_NODES}-node update, each run's slowest of ${UPDATES} (ms): ${readings.map((r) => r.toFixed(4)).join(', ')} against ${LIMIT_MS}, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])} macOS ${String(machine['macosBuild'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`AC7 ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status !== 'PASS') throw Error(`${result.status === 'BLOCKED' ? 'BLOCKED' : 'INCONCLUSIVE'}: ${shown}`);
}, BUILD_MS);
