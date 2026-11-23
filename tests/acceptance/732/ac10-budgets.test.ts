// AC10 #732.bbcc6582: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a 20-stage piece
// with two 3D stages exports in under 5 s"
//
// Split as #162's and #157's budget suites are. The merge-base comparison is the perf lane's: benchmarks/budgets.json has
// a task whose reason names this criterion's ID, and the file passes the lane's own validator against the merge base's
// budgets.json. The limit is judged here by the lane's `judgeLimit` (scripts/benchmark.mjs): five runs after a warm-up,
// each a fresh `deep-show run` exporting the twenty-stage piece (helpers.ts `twentyStages`: 20 stages, the display with
// its inset in view at stages 7 and 14 only) to pptx, its time the receipt's `timing.wall` (Export: the time from the
// command to the file), with the load read at each run's start and end. Off a reference Mac, off mains power, in Low
// Power Mode, not thermally nominal, loaded past the core count, or with the five runs neither all within nor all over
// the limit, it is INCONCLUSIVE, never a pass; all five over by more than the margin fails.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, REPO, TIMEOUT, deliveredOf, inconclusive, obj, pptxExport, referenceMacProblem, show, showRun, twentyStages, useShow, useTemp,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const ID = AC[10].split(' ')[1]!;

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

/** One export of the twenty-stage piece in a fresh deep-show process: its receipt's `timing.wall`, in seconds. */
function exportOnce(): number {
  const ev = temp(); const dir = temp();
  const [reply] = showRun(shows.bin(FULL), ev, [[DOC.twenty, twentyStages(ev)]], [pptxExport(DOC.twenty, join(dir, 'deck.pptx'))], 'the twenty-stage piece');
  const { receipt, slides } = deliveredOf(reply, "the twenty-stage piece's deck");
  expect(slides.length, 'the receipt lists twenty slides').toBe(20);
  const wall = obj(receipt['timing'], "the receipt's timing")['wall'];
  expect(typeof wall === 'number' && Number.isFinite(wall), `the receipt times the export: timing.wall ${show(wall ?? null)}`).toBe(true);
  return wall as number;
}

describe(`${AC[10]} budgets: a 20-stage piece with two 3D stages exports to pptx in under 5 s`, () => {
  it(`${AC[10]} the perf lane has a task whose reason names ${ID}, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => new RegExp(`${ID.replace('.', '\\.')}\\b`).test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), `benchmarks/budgets.json has a task whose reason names ${ID}`).toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })));
  }, TIMEOUT);

  it(`${AC[10]} on the reference Mac, the twenty-stage piece with two 3D stages exports in under 5 s (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budget counts only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    exportOnce();
    const runs: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) { const start = loadavg()[0]!; runs.push(exportOnce()); loads.push({ start, end: loadavg()[0]! }); }
    const { fingerprint, judgeLimit } = await benchmark();
    const machine = fingerprint();
    const result = judgeLimit({ limit: 5, runs, fingerprint: machine, loads });
    const reading = `exporting the twenty-stage piece to pptx: ${runs.map((r) => r.toFixed(3)).join(', ')} s against 5 s on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
    console.log(`${AC[10]} ${reading}`);
    expect(result.status, reading).not.toBe('BLOCKED');
    expect(result.status, reading).not.toBe('FAIL');
    if (result.status === 'INCONCLUSIVE') inconclusive(reading);
  }, TIMEOUT);
});
