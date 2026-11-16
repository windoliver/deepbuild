// AC5 #1425.30ab78a9, blind redraft for #1830 (README): budgets, on the reference Mac in the local preflight, compared
// with the merge base: a panel's update stays within its budget, with no new time on the load path above 1 ms.
//
// It runs in place of tests/acceptance/1425/budgets.test.ts, with its two tests, and measures what that draft measures,
// split as it is:
// - The merge-base comparison is the perf lane's (scripts/perf.mjs over benchmarks/budgets.json): the first test holds
//   the lane to a task for this budget, `panel-module-load`, valid against the merge base's budgets, whose command runs.
// - The issue's numbers are judged here, by the repo's judgeLimit (scripts/benchmark.mjs), five runs a limit:
//   - A panel's update, against the design's 4 ms per update for a panel in the app: each of the 12 panels runs in the
//     panel host (`serve`); after 5 untimed invalidations, a run is the slowest `scriptNs` of 20 more.
//   - New time on the load path, against 1 ms: what `deep_app::mount_panel` takes with its module check less what it
//     takes without it (the planted loader, `DEEP_HUB_PLANT=panel-load-unchecked`, the merge base's path), timed in one
//     process by the suite's frozen Rust half (../1425/app/panels.rs): a run is the difference of the medians of 15
//     loads a side, after one untimed load a side.
//
// What this draft changes: each run reads the one-minute load average, os.loadavg()[0], at its start and at its end,
// and every judgeLimit call gets them as `loads`, one { start, end } per run in the runs' order (the design's timing
// rule: a run whose load at its start or its end is above the core count counts neither way). An update run is one
// `serve`, read around it. The Rust half takes its load-path runs inside one process and reports neither a time nor a
// load per run, so here a load-path run is one invocation of it: the Rust half is built first, then run five times,
// the load read just before each invocation starts and just after it ends, and from each invocation each panel's first
// run is taken. The work runs first, so a missing surface fails. judgeLimit is the judge: PASS passes, FAIL fails, and
// INCONCLUSIVE (off a reference Mac, on battery, Low Power Mode on, the thermal state not nominal, or a run loaded past
// the core count) or BLOCKED prints the readings and skips as INCONCLUSIVE with its reason. It never passes by skipping.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type TestContext } from 'vitest';
import { AC5, BUILD_MS, buildHost, cargo, PANELS, REPO, rustSuite, serve, show } from '../1425/helpers.ts';

const TASK = 'panel-module-load';
const UPDATE_MS = 4;
const LOAD_MS = 1;
const RUNS = 5;
/** The Rust half's AC5 test, by the name it prints. */
const LOAD_PATH = `${AC5} the load path timed with the module check and without it, for each of the 12 panels`;

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Judged;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
const shownLoads = (loads: readonly Load[]): string => loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ');

/** One invocation of the Rust half's load-path test: each panel's checked and unchecked medians, per run, from its load.json. */
function loadPathOnce(): Record<string, { checkedMs: number[]; uncheckedMs: number[] }> {
  const out = mkdtempSync(join(tmpdir(), 'deep-1425-budgets-'));
  try {
    const suite = rustSuite(['30ab78a9'], { DEEP_1425_OUT: out });
    const result = suite.results.get(LOAD_PATH);
    expect(result, `BLOCKED: app/panels.rs didn't report its timing test\n${suite.output}`).toBeDefined();
    expect(result!.ok, result!.message).toBe(true);
    return JSON.parse(readFileSync(join(out, 'load.json'), 'utf8')) as Record<string, { checkedMs: number[]; uncheckedMs: number[] }>;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

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
  // The work: the load path timed both ways (the Rust half fails when the check or its plant isn't there). Built first,
  // so no run's readings hold a build.
  const built = cargo(['test', '--locked', '-p', 'deep-replica', '--test', 'acceptance_1425', '--no-run']);
  if (built.code !== 0) throw Error(`BLOCKED: app/panels.rs didn't build\n${show(built)}`);
  const added: Record<string, number[]> = {};
  const loadPathLoads: Load[] = [];
  for (let run = 0; run < RUNS; run++) {
    const start = loadavg()[0]!;
    const readings = loadPathOnce();
    loadPathLoads.push({ start, end: loadavg()[0]! });
    for (const panel of PANELS) {
      const reading = readings[panel];
      expect(reading, `load.json has ${panel}`).toBeDefined();
      (added[panel] ??= []).push(Math.max(0, reading!.checkedMs[0]! - reading!.uncheckedMs[0]!));
    }
  }
  const host = buildHost();
  const updates: Record<string, number[]> = {};
  const updateLoads: Record<string, Load[]> = {};
  for (const panel of PANELS) {
    const runs: number[] = [];
    const loads: Load[] = [];
    for (let run = 0; run < RUNS; run++) {
      const start = loadavg()[0]!;
      const { scriptNs } = await serve(host, `crates/deep-app/panels/${panel}`, 25);
      loads.push({ start, end: loadavg()[0]! });
      runs.push(Math.max(...scriptNs.slice(5)) / 1e6);
    }
    updates[panel] = runs;
    updateLoads[panel] = loads;
  }

  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const lines: string[] = [];
  const results: Judged[] = [];
  for (const panel of PANELS) {
    for (const [what, limit, runs, loads] of [['update', UPDATE_MS, updates[panel]!, updateLoads[panel]!], ['load check adds', LOAD_MS, added[panel]!, loadPathLoads]] as const) {
      const result = judgeLimit({ limit, runs: [...runs], fingerprint: machine, loads: [...loads] });
      results.push(result);
      lines.push(`${panel} ${what} (ms): ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit}, load at each run's start and end ${shownLoads(loads)}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    }
  }
  const shown = `on ${String(machine.model)} macOS ${String(machine.macosBuild)}\n${lines.join('\n')}`;
  console.log(`AC5 ${shown}`);
  expect(results.map((r) => r.status), `FAIL ${shown}`).not.toContain('FAIL');
  if (results.some((r) => r.status !== 'PASS')) ctx.skip(`INCONCLUSIVE ${shown}`);
}, 3 * BUILD_MS);
