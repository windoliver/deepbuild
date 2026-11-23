// AC6 #269.6ad7e180: Budgets, on the reference Mac in the local preflight, compared with the merge base: a 256 × 256 grid
// that changes 2% of its cells a step, drawn `smooth` at 512 × 512 px, stays within the data view class's 2 ms of frame
// GPU, with its draw time recorded as a reading
//
// The budget's fixture (fixtures.ts `warDoc`, programs.ts `warProgram`): `war.ground`, 256 × 256, whose every step changes
// 1,310 or 1,311 cells spread over every row, drawn smooth at 2 px a cell, 512 × 512 px, by `deep-gpu run`'s `film2d`
// (README: The surface under test), 60 frames at 60 fps, one step a frame. "Compared with the merge base" is the perf
// lane's, as #265's and #538's suites read it: benchmarks/budgets.json holds a task whose `criteria` name #269.6ad7e180,
// with a command the lane runs, valid by the lane's validator against the merge base's file, and scripts/lanes.mjs lists
// this file in `timed`. Then:
// - On the debug build, the fixture draws: every frame from frame 1 uploads rows of the grid (`counts`'s `row_uploads`)
//   and answers its frame GPU (`gpu_ms`, #417) and the grid image's own draw time (`timings`'s `draw_ms`).
// - Only on a reference Mac at rest (else INCONCLUSIVE before anything is timed, never a pass): a release build, one
//   warm-up run and five, each a fresh process; each run's reading the p95 of `gpu_ms` over frames 5 to 59, judged
//   against 2 ms by the lane's `judgeLimit` (through #1634's helpers) with each run's load at its start and end; a FAIL
//   fails and anything but PASS is INCONCLUSIVE. Each run's median `draw_ms.war_map` is printed as the reading the
//   criterion records.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeLimit, lane, load, median, p95, timedFiles, timingProblem, type Load } from '../1634/helpers.ts';
import { warProgram } from './programs.ts';
import { sessionForm, warDoc } from './fixtures.ts';
import {
  AC, REPO, TIMEOUT, binOf, film2dCall, filmFrames, inconclusive, isObject, none, num, obj, prebuild, putAsset, requireMetal, rowUploads, runGpu,
  show, useTemp, type JsonObject,
} from './helpers.ts';

prebuild(['gpu']);
const temp = useTemp();
const ID = '#269.6ad7e180';
const FILE = 'tests/acceptance/269/ac6-budgets.test.ts';
const LIMIT_MS = 2;
const FRAMES = 60;
const WARM = 5;
const ITEM = 'war_map';

/** The perf lane's hold on this budget: its task, the validator against the merge base, the `timed` line. */
function laneProblems(): string[] {
  const out: string[] = [];
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
  const mine = current.tasks.filter((t) => Array.isArray(t['criteria']) && t['criteria'].includes(ID));
  if (mine.length === 0) out.push(`benchmarks/budgets.json has no task whose criteria name ${ID}`);
  for (const t of mine) if (!(Array.isArray(t['command']) && t['command'].length > 0)) out.push(`budgets.json task ${String(t['id'])} has no command the lane runs`);
  const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  if (mergeBase.status !== 0) out.push(`git merge-base HEAD origin/main: ${mergeBase.stderr}`);
  else {
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const verdict = base.status === 0
      ? lane('try { b.validateBudgets(input.current, input.base); return "valid"; } catch (e) { return String(e.message); }', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject })
      : base.stderr;
    if (verdict !== 'valid') out.push(`the lane's validator refuses budgets.json against the merge base's: ${String(verdict)}`);
  }
  if (!timedFiles().includes(FILE)) out.push(`scripts/lanes.mjs does not list ${FILE} in timed, the local preflight's perf step`);
  return out;
}

interface Reading { gpu: number; draw: number }
/** One run in a fresh process: the p95 of `gpu_ms` and the median `draw_ms.war_map` over frames 5 to 59. With
 * `counts`, the frames' uploads are read too. */
function run(bin: string, counts: boolean, failures: string[]): Reading {
  requireMetal();
  const out = temp();
  const program = warProgram();
  const [reply] = runGpu(bin, out, [film2dCall(sessionForm(warDoc(program)), putAsset(out, program.bytes, 'wasm'), { from: 0, frames: FRAMES, timings: true, counts, hash: false })], 'AC6 the 256 × 256 grid drawn smooth at 512 × 512 px');
  const frames = filmFrames(reply!, 'the budget\'s fixture');
  const gpu: number[] = [];
  const draw: number[] = [];
  for (let n = 0; n < FRAMES; n++) {
    const f = frames.get(n);
    expect(f, `the budget's film has frame ${n}`).toBeDefined();
    if (counts && n >= 1 && rowUploads(f!, ITEM, `frame ${n}`).length === 0) failures.push(`frame ${n}: ${ITEM} uploads no row, though its step changed 2% of the grid`);
    const timed = isObject(f!['draw_ms']) ? f!['draw_ms'][ITEM] : undefined;
    if (typeof timed !== 'number') failures.push(`frame ${n}: no draw_ms.${ITEM}, the grid image's draw time (README: The surface under test): ${show(f!['draw_ms'] ?? null)}`);
    if (n < WARM) continue;
    gpu.push(num(f!['gpu_ms'], `frame ${n}: gpu_ms`));
    if (typeof timed === 'number') draw.push(timed);
  }
  return { gpu: p95(gpu), draw: draw.length ? median(draw) : Number.NaN };
}

describe(`${AC[6]} a 256 × 256 grid drawn smooth at 512 × 512 px within the data view class's frame GPU`, () => {
  it(`${AC[6]} the perf lane carries the budget beside the merge base, the grid draws, and on the reference Mac it stays within 2 ms of frame GPU at p95, five runs by the lane's rule, its draw time recorded`, () => {
    const failures = laneProblems();
    const debug = run(binOf('gpu'), true, failures);
    none(failures, 'the budget\'s place in the perf lane and the fixture drawn');
    console.log(`${AC[6]}: the debug build's readings (not budget results): frame GPU p95 ${debug.gpu.toFixed(3)} ms, ${ITEM} draw ${debug.draw.toFixed(3)} ms`);

    const problem = timingProblem();
    if (problem) inconclusive(`the budget counts only on a reference Mac at rest: ${problem}`);
    const release = binOf('gpu', true);
    run(release, false, []);
    const runs: Reading[] = [];
    const loads: Load[] = [];
    for (let k = 0; k < 5; k++) { const start = load(); runs.push(run(release, false, [])); loads.push({ start, end: load() }); }
    console.log(`${AC[6]} reading: ${ITEM}'s draw time, the median of each run's frames 5 to 59 (ms): ${runs.map((r) => r.draw.toFixed(4)).join(', ')}`);
    const v = judgeLimit(LIMIT_MS, runs.map((r) => r.gpu), loads);
    console.log(`${AC[6]} frame GPU ms at p95 (the data view class: 2): ${String(v['status'])} ${show(v['runs'] ?? runs.map((r) => r.gpu))}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
    expect(v['status'], `the grid's frame GPU at p95 against 2 ms: ${show(obj(v, 'judgeLimit'))}`).not.toBe('FAIL');
    if (v['status'] !== 'PASS') inconclusive(`the five runs don't decide: ${String(v['status'])} ${String(v['reason'] ?? '')}`);
  }, 4 * TIMEOUT);
});
