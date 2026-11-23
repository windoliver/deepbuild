// AC6 #269.6ad7e180: Budgets, on the reference Mac in the local preflight, compared with the merge base: a 256 × 256 grid
// that changes 2% of its cells a step, drawn `smooth` at 512 × 512 px, stays within the data view class's 2 ms of frame
// GPU, with its draw time recorded as a reading
//
// The blind redraft of this criterion (README). The fixture is the first suite's budget fixture (../269/fixtures.ts
// `warDoc`: `war_map`, a `grid_image@1` of `war.ground`, 256 × 256 cells of 2 px drawn smooth, 512 × 512 px) holding this
// folder's program (programs.ts): every step from 1 changes exactly 1,311 of the 65,536 cells (2%), spread over all 256
// rows, inside the logic item's default fuel. One test:
//   1. The record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json holds a task
//      whose `criteria` name #269.6ad7e180 with a command the lane runs, valid by the lane's validator against the merge
//      base's file, and scripts/lanes.mjs lists this file in `timed`, the local preflight's perf step.
//   2. On the debug build, on the Mac's Metal device: `deep-gpu run`'s `film2d` of the fixture (the first suite's surface:
//      `assets`, `counts`, `timings`, `hash`), 120 frames at 60 fps from frame 0. Every frame n from 1 uploads exactly
//      the grid rows its step changed (`row_uploads.war_map`), draws another picture than frame n − 1 (`pixel_hash`), and
//      every frame answers its frame GPU (`gpu_ms`, #417) and the grid image's draw time (`draw_ms.war_map`), each a time
//      above 0. So what is timed is the criterion's grid, changing 2% a step, drawn on the GPU.
//   3. Only on a reference Mac at rest (else INCONCLUSIVE before anything is timed, never a pass): a release build, one
//      warm-up run and five, each a fresh process playing the same 120 frames with `timings` and nothing hashed or
//      counted; each run's reading the p95 of `gpu_ms` over frames 10 to 119, judged against 2 ms by the lane's
//      `judgeLimit` (scripts/benchmark.mjs, through #1634's helpers) with each run's load at its start and end: a FAIL
//      fails, anything but PASS is INCONCLUSIVE. Each run's median `draw_ms.war_map` over the same frames is printed as
//      the reading the criterion records; it is never judged.
// Parts 1 and 2 gather what is missing or wrong into one list, asserted before any timing, so one run names all of it.
// Wrong programs it fails: the base (no grid image, no task); a grid that stops changing, as a logic step that runs out
// of fuel leaves it; a GPU path that keeps the first picture or skips the rows a step changed; a draw time not reported;
// a frame GPU over 2 ms on the reference Mac; a budget no lane compares with the merge base.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeLimit, lane, load, median, p95, timedFiles, timingProblem, type Load } from '../1634/helpers.ts';
import { sessionForm, warDoc } from '../269/fixtures.ts';
import {
  AC, REPO, TIMEOUT, binOf, film2dCall, inconclusive, isObject, none, prebuild, putAsset, requireMetal, runGpu, show, useTemp, type JsonObject,
  type JsonValue,
} from '../269/helpers.ts';
import { MOVED, program, rowsMovedAt } from './programs.ts';

prebuild(['gpu']);
const temp = useTemp();
const ID = '#269.6ad7e180';
const FILE = 'tests/acceptance/269-redraft-ac6/ac6-budgets.test.ts';
const LIMIT_MS = 2;
/** 2 s at 60 fps, one step a frame: frame n draws the grid as step n left it. */
const FRAMES = 120;
/** Frames each run draws before its readings: the process's first pipelines, uploads and caches. */
const WARM = 10;
const RUNS = 5;
const ITEM = 'war_map';
/** deep-gpu's refusals for a machine with no GPU to draw on: the machine's, not the program's. */
const NO_DEVICE = ['no_device', 'unsupported_platform'];

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

/** The budget's fixture played by `film2d` from frame 0 in a fresh process, with `timings`. */
function film(bin: string, o: { counts: boolean; hash: boolean }, what: string): JsonObject {
  const out = temp();
  const p = program();
  const [reply] = runGpu(bin, out, [film2dCall(sessionForm(warDoc(p)), putAsset(out, p.bytes, 'wasm'), { from: 0, frames: FRAMES, timings: true, counts: o.counts, hash: o.hash })], what);
  return reply!;
}
/** A `film2d` reply's frames by number, or why it has none. */
function framesOf(reply: JsonObject): Map<number, JsonObject> | string {
  if (reply['code'] !== undefined) return `it refuses the call: ${show(reply, 800)}`;
  if (!Array.isArray(reply['frames'])) return `its reply has no frames: ${show(reply, 800)}`;
  const out = new Map<number, JsonObject>();
  for (const f of reply['frames']) if (isObject(f) && typeof f['frame'] === 'number') out.set(f['frame'], f);
  return out;
}
const positive = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const drawOf = (f: JsonObject): JsonValue | undefined => (isObject(f['draw_ms']) ? f['draw_ms'][ITEM] : undefined);

/** What the debug build's film lacks: each frame's times, and from frame 1 the rows its step changed and a new picture. */
function drawnProblems(reply: JsonObject): string[] {
  const frames = framesOf(reply);
  if (typeof frames === 'string') return [`deep-gpu's film2d doesn't draw the budget's fixture: ${frames}`];
  const out: string[] = [];
  for (let n = 0; n < FRAMES; n++) {
    const f = frames.get(n);
    if (!f) { out.push(`frame ${n} is missing (the film answers ${frames.size} frames)`); continue; }
    if (!positive(f['gpu_ms'])) out.push(`frame ${n}: gpu_ms, its frame GPU, is ${show(f['gpu_ms'] ?? null)}, not a time above 0`);
    if (!positive(drawOf(f))) out.push(`frame ${n}: draw_ms.${ITEM}, the grid image's draw time, is ${show(drawOf(f) ?? null)}, not a time above 0`);
    if (n === 0) continue;
    const want = rowsMovedAt(n);
    const got = isObject(f['row_uploads']) ? f['row_uploads'][ITEM] : undefined;
    if (!Array.isArray(got) || got.length !== want.length || got.some((y, i) => y !== want[i]))
      out.push(`frame ${n}: row_uploads.${ITEM} is ${show(got ?? null, 160)}, not the ${want.length} rows holding the ${MOVED} cells step ${n} changed`);
    const [before, now] = [frames.get(n - 1)?.['pixel_hash'], f['pixel_hash']];
    if (typeof now !== 'string' || now === before) out.push(`frame ${n}: pixel_hash ${show(now ?? null)} is no new picture after frame ${n - 1}'s, though step ${n} changed ${MOVED} cells`);
  }
  return out;
}

interface Reading { gpu: number; draw: number }
/** One timed run: the p95 of `gpu_ms` and the median `draw_ms.war_map` over frames WARM to FRAMES − 1. */
function timedRun(bin: string): Reading {
  const frames = framesOf(film(bin, { counts: false, hash: false }, 'AC6 the budget\'s fixture, timed'));
  if (typeof frames === 'string') expect.fail(`the timed film draws the budget's fixture: ${frames}`);
  const gpu: number[] = [];
  const draw: number[] = [];
  for (let n = WARM; n < FRAMES; n++) {
    const f = frames.get(n);
    expect(f, `the timed film has frame ${n}`).toBeDefined();
    const [g, d] = [f!['gpu_ms'], drawOf(f!)];
    expect(positive(g) && positive(d), `frame ${n} answers gpu_ms and draw_ms.${ITEM} above 0: ${show(g ?? null)}, ${show(d ?? null)}`).toBe(true);
    gpu.push(g as number);
    draw.push(d as number);
  }
  return { gpu: p95(gpu), draw: median(draw) };
}

describe(`${AC[6]} a 256 × 256 grid changing 2% of its cells a step, drawn smooth at 512 × 512 px, within the data view class's frame GPU`, () => {
  it(`${AC[6]} the perf lane carries the budget beside the merge base, the GPU draws each step's 2%, and on the reference Mac the frame GPU stays within 2 ms at p95 over five runs by the lane's rule, the draw time recorded`, () => {
    const failures = laneProblems();
    let noDevice = '';
    if (process.platform === 'darwin') {
      const reply = film(binOf('gpu'), { counts: true, hash: true }, 'AC6 the budget\'s fixture, debug build');
      if (NO_DEVICE.includes(String(reply['code']))) noDevice = show(reply, 600);
      else failures.push(...drawnProblems(reply));
    }
    none(failures, 'the budget\'s place in the perf lane, and the grid drawn changing 2% of its cells a step');
    requireMetal();
    if (noDevice) inconclusive(`the GPU layer has no device to draw on here: ${noDevice}`);

    const problem = timingProblem();
    if (problem) inconclusive(`the budget counts only on a reference Mac at rest: ${problem}`);
    const release = binOf('gpu', true);
    timedRun(release);
    const runs: Reading[] = [];
    const loads: Load[] = [];
    for (let k = 0; k < RUNS; k++) { const start = load(); runs.push(timedRun(release)); loads.push({ start, end: load() }); }
    console.log(`${AC[6]} reading: ${ITEM}'s draw time, each run's median over frames ${WARM} to ${FRAMES - 1} (ms): ${runs.map((r) => r.draw.toFixed(4)).join(', ')}`);
    const v = judgeLimit(LIMIT_MS, runs.map((r) => r.gpu), loads);
    console.log(`${AC[6]} frame GPU ms at p95 (the data view class: 2): ${String(v['status'])} ${show(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
    expect(v['status'], `the grid's frame GPU at p95 against 2 ms: ${show(v)}`).not.toBe('FAIL');
    if (v['status'] !== 'PASS') inconclusive(`the five runs don't decide: ${String(v['status'])} ${String(v['reason'] ?? '')}`);
  }, 4 * TIMEOUT);
});
