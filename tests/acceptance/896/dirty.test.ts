// #896.18600d21: The same task's CPU per patch at 1,000 and at 10,000 items differs by under 25%; a planted
// `marks2d.frame` that rebuilds the whole list fails, naming the operator and its marks.
// #896.6987c701: A one-item patch uploads at most 64 B per changed item to the GPU; a planted view that repaints every
// mark fails, naming the bytes it uploaded.
//
// Both are judged on the perf-lane task `canvas-patch-dirty` (`node benchmarks/canvas.mjs patch-dirty`), which runs
// patch-settled's 200 one-item patches on a 1,000-item board and then a 10,000-item one in each of five runs, each
// sample as patch-settled's plus the bytes the view uploaded and the marks each operator built (README: The surface
// under test). It is a task of its own because canvas-patch-settled's budgets.json entry is frozen on main and #854's
// tests hold its verdict to its one target. The CPU per patch is timing, judged on a reference Mac only; bytes and
// marks are counts, judged on any Mac. The wrong programs: the base (no task: every stage walks the board, marks2d.frame
// rebuilds the list and GPUI paints every quad); the planted marks2d.frame and view; a task that doesn't report bytes;
// a ratio taken from a different board; a judge that never fails or names nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIRTY, ID, ITEMS, NOT_PASSED, REPO, SMALL, dirtyReading, dirtyRuns, growth, judgeOver, judgeWithin, judged, maxBytes, mentions, record,
  referenceMacProblem, requireMac, sampleProblems, str, targetOf, targetVerdict, type Board, type JsonObject,
} from './helpers.ts';

const records: Record<string, JsonObject> = {};
const recorded = (planted?: string): JsonObject => (records[planted ?? ''] ??= record(DIRTY.mode, DIRTY.id, planted));
const runsOf = (planted?: string): [Board, Board][] => {
  const runs = dirtyRuns(recorded(planted), planted ? `--planted ${planted}` : DIRTY.id);
  expect(runs.flatMap((boards, r) => boards.flatMap((b) => sampleProblems(b.samples, `run ${r + 1}, ${b.items} items`))), 'every patch is timed to its own settled frame, its stages adding up to its time').toEqual([]);
  return runs;
};
/** Per sample, the marks the operator that built most built, on the 10,000-item board of each run. */
const topMarks = (runs: [Board, Board][]): [string, number][] => runs.map(([, large]) => large.samples
  .flatMap((s) => Object.entries(s.marks)).reduce<[string, number]>((a, e) => (e[1] > a[1] ? e : a), ['', -1]));
const notPassed = (verdict: JsonObject, target: string, why: string): void => {
  expect(NOT_PASSED, `${why}: ${JSON.stringify(verdict).slice(0, 1500)}`).toContain(verdict['status']);
  expect(NOT_PASSED, `${why}: ${target} isn't passed`).toContain(targetOf(verdict, target).status);
};

describe(`${ID.growth} the same task's CPU per patch at 1,000 and at 10,000 items differs by under 25%; a planted marks2d.frame that rebuilds the whole list fails, naming the operator and its marks`, () => {
  it(`${ID.growth} ${ID.upload} budgets.json has the task canvas-patch-dirty: it runs node benchmarks/canvas.mjs patch-dirty, holds cpu_growth 0.25 and upload_bytes_per_item 64, compares with the merge base at the lane's 50% margin, and passes the lane's validator against the merge base's budgets`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; [k: string]: unknown }[] };
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const entry = current.tasks.find((t) => t.id === DIRTY.id);
    expect(entry, `budgets.json has the task ${DIRTY.id}`).toBeDefined();
    expect(entry!['command'], 'it runs the patch-dirty mode of the canvas bench').toEqual(['node', 'benchmarks/canvas.mjs', DIRTY.mode]);
    expect(entry!['targets'], 'it holds the issue\'s numbers').toEqual(DIRTY.targets);
    expect(entry!['margin'], 'at the perf lane\'s margin').toBe(0.5);
    expect(String(entry!['initialReason']), 'saying why, naming #896').toMatch(/#896/);
  }, 120_000);

  it(`${ID.growth} canvas-patch-dirty times the same 200 one-item patches at 1,000 and at 10,000 items, no operator building a mark for 1% of the board on one patch, and on the reference Mac the CPU per patch at the two sizes differs by under 25% in all five runs and the lane passes cpu_growth`, (ctx) => {
    requireMac(ctx);
    const runs = runsOf();
    const rebuilt = runs.flatMap((boards, r) => boards.flatMap((b) => b.samples.flatMap((s) => {
      const total = Object.values(s.marks).reduce((a, n) => a + n, 0);
      const over = Object.entries(s.marks).filter(([, n]) => n >= ITEMS / 100);
      return total >= 1 && !over.length ? [] : [`run ${r + 1}, ${b.items} items, patch ${s.patch}: marks ${JSON.stringify(s.marks)}`];
    })));
    expect(rebuilt, 'a one-item patch rebuilds its own mark and not the list').toEqual([]);
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const growths = runs.map(growth);
    judgeWithin(ctx, `${DIRTY.id} CPU per patch, 10,000 against 1,000 items`, growths, DIRTY.targets.cpu_growth);
    const verdict = judged(recorded());
    const target = targetOf(verdict, 'cpu_growth');
    expect(target.limit, 'the judge holds it to 25%').toBe(DIRTY.targets.cpu_growth);
    target.runs.forEach((v, i) => expect(v, `the judge judges run ${i + 1}'s difference`).toBeCloseTo(growths[i]!, 3));
    targetVerdict(ctx, verdict, 'cpu_growth', 'PASS');
  }, 3_600_000);

  it(`${ID.growth} a planted marks2d.frame that rebuilds the whole list builds a mark for every item of each board on each one-item patch, and on the reference Mac the lane fails its CPU per patch, naming marks2d.frame and its marks in every run`, (ctx) => {
    requireMac(ctx);
    const runs = runsOf(DIRTY.planted.growth);
    const partial = runs.flatMap((boards, r) => boards.flatMap((b) => b.samples.filter((s) => !((s.marks['marks2d.frame'] ?? 0) >= b.items))
      .map((s) => `run ${r + 1}, ${b.items} items, patch ${s.patch}: marks2d.frame built ${s.marks['marks2d.frame'] ?? 0}`)));
    expect(partial, 'the planted marks2d.frame rebuilds every mark of the board').toEqual([]);
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judgeOver(ctx, `--planted ${DIRTY.planted.growth} CPU per patch, 10,000 against 1,000 items`, runs.map(growth), DIRTY.targets.cpu_growth);
    const verdict = judged(recorded(DIRTY.planted.growth));
    targetVerdict(ctx, verdict, 'cpu_growth', 'FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    const unnamed = topMarks(runs).filter(([op, n]) => op !== 'marks2d.frame' || !reason.includes(op) || !mentions(reason, n));
    expect(unnamed, `the failure names the operator and its marks: ${reason.slice(0, 2000)}`).toEqual([]);
  }, 3_600_000);

  it(`${ID.growth} the lane's judge fails a reading whose CPU per patch doubles from 1,000 to 10,000 items, naming in each run the operator that built the most marks and how many; passes its twin within 25%; and passes no reading without a 1,000-item board or with its ratio taken from two 10,000-item boards`, () => {
    const within = judged(dirtyReading((_, items) => ({ ms: items === ITEMS ? 1.1 : 1 })));
    expect(within['status'], `CPU per patch 10% apart passes: ${JSON.stringify(within).slice(0, 1500)}`).toBe('PASS');
    const verdict = judged(dirtyReading((run, items) => (items === ITEMS ? { ms: 2, marks: { 'marks2d.frame': ITEMS + run, 'marks2d.item': 1 } } : { ms: 1 })));
    expect(verdict['status'], `CPU per patch doubling fails: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    expect(targetOf(verdict, 'cpu_growth').status, 'on cpu_growth').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    expect(reason, 'naming the operator').toContain('marks2d.frame');
    expect([1, 2, 3, 4, 5].filter((run) => !mentions(reason, ITEMS + run)), 'and each run\'s marks').toEqual([]);
    notPassed(judged(dirtyReading(() => ({ ms: 1 }), [ITEMS])), 'cpu_growth', 'a reading with no 1,000-item board isn\'t passed');
    notPassed(judged(dirtyReading(() => ({ ms: 1 }), [ITEMS, ITEMS])), 'cpu_growth', 'a ratio taken from two 10,000-item boards isn\'t passed');
    notPassed(judged(dirtyReading(() => ({ ms: 1 }), [SMALL, SMALL])), 'cpu_growth', 'a ratio taken from two 1,000-item boards isn\'t passed');
  }, 600_000);
});

describe(`${ID.upload} a one-item patch uploads at most 64 B per changed item to the GPU; a planted view that repaints every mark fails, naming the bytes it uploaded`, () => {
  it(`${ID.upload} each one-item patch of canvas-patch-dirty uploads between 1 and 64 B to the GPU at 1,000 and at 10,000 items, and the lane passes upload_bytes_per_item on any Mac`, (ctx) => {
    requireMac(ctx);
    const runs = runsOf();
    const off = runs.flatMap((boards, r) => boards.flatMap((b) => b.samples.filter((s) => !(s.uploaded_bytes >= 1 && s.uploaded_bytes <= DIRTY.targets.upload_bytes_per_item))
      .map((s) => `run ${r + 1}, ${b.items} items, patch ${s.patch}: ${s.uploaded_bytes} B`)));
    expect(off, 'every one-item patch reaches the GPU in at most 64 B').toEqual([]);
    const target = targetOf(judged(recorded()), 'upload_bytes_per_item');
    expect(target.limit, 'the judge holds it to 64 B').toBe(DIRTY.targets.upload_bytes_per_item);
    expect(target.runs, 'the judge judges each run\'s most bytes for one changed item').toEqual(runs.map(maxBytes));
    expect(target.status, 'a count, passed on any Mac').toBe('PASS');
  }, 3_600_000);

  it(`${ID.upload} a planted view that repaints every mark uploads at least a byte per mark of the board on each one-item patch, and the lane fails it on any Mac, naming each run's bytes`, (ctx) => {
    requireMac(ctx);
    const runs = runsOf(DIRTY.planted.upload);
    const few = runs.flatMap((boards, r) => boards.flatMap((b) => b.samples.filter((s) => s.uploaded_bytes < b.items).map((s) => `run ${r + 1}, ${b.items} items, patch ${s.patch}: ${s.uploaded_bytes} B`)));
    expect(few, 'the planted view uploads every mark of the board').toEqual([]);
    const verdict = judged(recorded(DIRTY.planted.upload));
    expect(verdict['status'], `the lane fails it: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    expect(targetOf(verdict, 'upload_bytes_per_item').status, 'on upload_bytes_per_item').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    expect(runs.map(maxBytes).filter((n) => !mentions(reason, n)), `the failure names the bytes each run uploaded: ${reason.slice(0, 2000)}`).toEqual([]);
  }, 3_600_000);

  it(`${ID.upload} the lane's judge fails a reading whose one-item patch uploads 640 KB, naming each run's bytes; passes its twin at 48 B; and passes no reading that doesn't report the bytes`, () => {
    const within = judged(dirtyReading(() => ({ ms: 1, bytes: 48 })));
    expect(within['status'], `48 B a patch passes: ${JSON.stringify(within).slice(0, 1500)}`).toBe('PASS');
    const verdict = judged(dirtyReading((run, items, k) => ({ ms: 1, bytes: items === ITEMS && k === 77 ? 640_000 + run : 48 })));
    expect(verdict['status'], `a patch uploading 640 KB fails: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    expect(targetOf(verdict, 'upload_bytes_per_item').status, 'on upload_bytes_per_item').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    expect([1, 2, 3, 4, 5].filter((run) => !mentions(reason, 640_000 + run)), 'naming each run\'s bytes').toEqual([]);
    notPassed(judged(dirtyReading(() => ({ ms: 1, bytes: null }))), 'upload_bytes_per_item', 'a reading that doesn\'t report the bytes isn\'t passed');
  }, 600_000);
});
