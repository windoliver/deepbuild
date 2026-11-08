// AC5 #1425.30ab78a9 budgets, on the reference Mac in the local preflight, compared with the merge base: a panel's
// update stays within its budget, with no new time on the load path above 1 ms.
//
// Split as #1098's budgets are (design: Every task carries its own budgets):
// - The merge-base comparison is the perf lane's (scripts/perf.mjs over benchmarks/budgets.json): the first test holds
//   the lane to a task for this budget, `panel-module-load`, valid against the merge base's budgets, whose command runs.
// - The issue's numbers are judged here, by the repo's judgeLimit (scripts/benchmark.mjs): PASS when all five runs are
//   within the limit, FAIL when all five are over it by more than the margin, else INCONCLUSIVE.
//   - A panel's update: its budget is the design's 4 ms per update for a panel in the app. Each of the 12 panels runs in
//     the panel host (`serve`); after 5 untimed invalidations, a run is the slowest `scriptNs` of 20 more.
//   - New time on the load path: what `deep_app::mount_panel` takes with its module check less what it takes without
//     it (the planted loader, `DEEP_HUB_PLANT=panel-load-unchecked`, the merge base's path), in one process, alternated;
//     a run is the difference of the medians of 15 loads a side (app/panels.rs), against 1 ms.
//   The work runs first, so a missing surface fails; off a reference Mac, on battery, Low Power Mode on, the thermal
//   state not nominal, or with the load average above the core count, the readings print and the test skips as
//   INCONCLUSIVE. It never passes by skipping.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type TestContext } from 'vitest';
import { AC5, BUILD_MS, buildHost, PANELS, REPO, rustSuite, serve } from './helpers.ts';

const TASK = 'panel-module-load';
const UPDATE_MS = 4;
const LOAD_MS = 1;

interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown> }): Judged;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

test(`${AC5} the perf lane has the task ${TASK}, a #1425 first measurement, valid against the merge base's budgets, and it runs`, async () => {
  const { validateBudgets } = await benchmark();
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  const task = current.tasks.find((t) => t.id === TASK);
  expect(task, `benchmarks/budgets.json has a task ${TASK}`).toBeDefined();
  expect(String(task!.initialReason), `${TASK} says why, naming issue #1425`).toMatch(/#1425\b/);
  const [command, ...args] = task!.command;
  execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, encoding: 'utf8', timeout: BUILD_MS });
}, BUILD_MS);

test(`${AC5} on a reference Mac, each of the 12 panels updates within 4 ms and the load check adds at most 1 ms to its load`, async (ctx: TestContext) => {
  // The work: the load path timed both ways (the Rust half fails when the check or its plant isn't there).
  const out = mkdtempSync(join(tmpdir(), 'deep-1425-budgets-'));
  let loads: Record<string, { checkedMs: number[]; uncheckedMs: number[] }>;
  try {
    const suite = rustSuite(['30ab78a9'], { DEEP_1425_OUT: out });
    const name = `${AC5} the load path timed with the module check and without it, for each of the 12 panels`;
    const result = suite.results.get(name);
    expect(result, `BLOCKED: app/panels.rs didn't report its timing test\n${suite.output}`).toBeDefined();
    expect(result!.ok, result!.message).toBe(true);
    loads = JSON.parse(readFileSync(join(out, 'load.json'), 'utf8')) as typeof loads;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  const host = buildHost();
  const updates: Record<string, number[]> = {};
  for (const panel of PANELS) {
    const runs: number[] = [];
    for (let run = 0; run < 5; run++) {
      const { scriptNs } = await serve(host, `crates/deep-app/panels/${panel}`, 25);
      runs.push(Math.max(...scriptNs.slice(5)) / 1e6);
    }
    updates[panel] = runs;
  }

  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const [load] = loadavg();
  const loaded = load! > availableParallelism() ? `load average ${load!.toFixed(1)} above ${availableParallelism()} cores` : null;
  const lines: string[] = [];
  const results: Judged[] = [];
  for (const panel of PANELS) {
    const reading = loads[panel];
    expect(reading, `load.json has ${panel}`).toBeDefined();
    const added = reading!.checkedMs.map((ms, i) => Math.max(0, ms - reading!.uncheckedMs[i]!));
    for (const [what, limit, runs] of [['update', UPDATE_MS, updates[panel]!], ['load check adds', LOAD_MS, added]] as const) {
      const result = judgeLimit({ limit, runs: [...runs], fingerprint: machine });
      results.push(result);
      lines.push(`${panel} ${what} (ms): ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    }
  }
  const shown = `on ${String(machine.model)} macOS ${String(machine.macosBuild)}${loaded ? `; ${loaded}` : ''}\n${lines.join('\n')}`;
  console.log(`AC5 ${shown}`);
  if (results.some((r) => r.status === 'BLOCKED')) throw Error(`BLOCKED ${shown}`);
  if (loaded && results.some((r) => r.status !== 'PASS')) ctx.skip(`INCONCLUSIVE (a reading only: ${loaded}) ${shown}`);
  expect(results.map((r) => r.status), `FAIL ${shown}`).not.toContain('FAIL');
  if (results.some((r) => r.status === 'INCONCLUSIVE')) ctx.skip(`INCONCLUSIVE ${shown}`);
}, BUILD_MS);
