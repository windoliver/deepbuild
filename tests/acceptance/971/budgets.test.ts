// AC8 #971.ae60e422: Budgets, measured in the scheduled budget window on a reference Mac at the merged commit against
// its merge base; the PR says `Part of #971` until that window closes the issue; unmeasured is never PASS: `local`
// adds under 0.6 ms of GPU at 1080p and under 2 ms at 3840 × 2160.
//
// The budget window runs benchmarks/budgets.json's tasks against the merge base, so the file holds a task for this
// issue, `canvas-local-tone-map`, run as `node benchmarks/canvas.mjs local-tone-map`, holding the issue's 0.6 ms and
// 2 ms at the lane's 50% margin, its criteria naming this criterion and its initialReason naming #971; the file passes
// the lane's validator against the merge base's budgets.json. The PR's `Part of #971` and the window's verdict are the
// window's, not this file's: this file judges a local run, as #968's suite does.
//
// The timing, at each size: the temple (helpers.ts `templeDoc`) under filmic, 300 frames at 30 fps with
// `timings: true`, one process per run drawing the two sides, with `local: {strength: 0.5}` and without; what `local`
// adds is the difference of the sides' median `gpu_ms`, a negative difference reading 0. Five runs after a warm-up
// run, each with the one-minute load read at its start and at its end, judged by the lane's `judgeLimit`
// (scripts/benchmark.mjs, in a child process): PASS when all five are within the limit, FAIL when all five are over it
// by more than the margin, else INCONCLUSIVE; off a reference Mac, off mains, in Low Power Mode, not thermally nominal,
// or with the load at a run's start or end above the core count, INCONCLUSIVE, never a pass. A program that draws
// nothing for `local` adds no time, so before anything is timed one frame of each side is drawn and the two must have
// different pixel hashes; at the base the look's `local` is read by nothing and that fails. Then the machine is read by
// the same judge, so an unfit machine times nothing.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeJson, type JsonObject } from '../418/helpers.ts';
import {
  AC, FULL, HALF, REPO, TIMEOUT, UHD, drawn, frame, gpuMs, inconclusive, judge, lane, loadNow, lookWith, median, requireGpu, runGpu, templeDoc, timingProblem,
  useGpu, useOut, view3d, type Load, type Size,
} from './helpers.ts';

const ID = AC[8].split(' ')[1]!;
const bin = useGpu();
const out = useOut();
const FRAMES = 300;
const TASK = { id: 'canvas-local-tone-map', command: ['node', 'benchmarks/canvas.mjs', 'local-tone-map'], targets: { local_1080p_gpu_ms: 0.6, local_2160p_gpu_ms: 2 } };

/** The temple's two sides at `size`, `frames` frames each: with `local: {strength: 0.5}` and without. */
function sides(size: Size, frames: number): JsonObject[] {
  const dir = out();
  const doc = writeJson(dir, 'temple.json', templeDoc('temple-budget'));
  return [HALF, undefined].map((local) => view3d({ doc, look: lookWith('filmic', local), size, frames, fps: 30, timings: true }));
}
/** What `local` adds at `size`, in ms of GPU a frame, judged against `limit`. */
function added(size: Size, limit: number): void {
  requireGpu();
  const what = `the temple at ${size[0]} × ${size[1]}`;
  const [withLocal, without] = runGpu(bin(), out(), sides(size, 1));
  expect(frame(drawn(withLocal!, `${what} with local`), 0, `${what} with local`).pixel_hash, 'the two sides draw different pixels, so the measure sees what it times').not.toBe(frame(drawn(without!, `${what} without local`), 0, `${what} without local`).pixel_hash);
  const problem = timingProblem();
  if (problem) inconclusive(`local's GPU time counts only on a reference Mac at rest: ${problem}`);
  const once = (): { added: number; load: Load } => {
    const calls = sides(size, FRAMES);
    const start = loadNow();
    const [a, b] = runGpu(bin(), out(), calls);
    const end = loadNow();
    const fa = drawn(a!, `${what} with local`); const fb = drawn(b!, `${what} without local`);
    expect([fa.length, fb.length], `each side draws ${FRAMES} frames`).toEqual([FRAMES, FRAMES]);
    return { added: Math.max(0, median(gpuMs(fa, `${what} with local`)) - median(gpuMs(fb, `${what} without local`))), load: { start, end } };
  };
  once();
  const runs = Array.from({ length: 5 }, once);
  judge(`${AC[8]} local at ${size[0]} × ${size[1]}, added GPU (ms a frame)`, limit, runs.map((r) => r.added), runs.map((r) => r.load));
}

describe(`${AC[8]} the local tone map's budgets`, () => {
  it(`${AC[8]} budgets.json holds the task canvas-local-tone-map with the issue's numbers, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    expect(lane('b.validateBudgets(input.current, input.base); return "valid";', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }), 'the lane\'s validator accepts budgets.json against the merge base\'s').toBe('valid');
    const entry = current.tasks.find((t) => t['id'] === TASK.id);
    expect(entry, `budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's numbers`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} proves this criterion`).toEqual([ID]);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #971`).toMatch(/#971\b/);
  }, TIMEOUT);

  it(`${AC[8]} local {strength: 0.5} adds under 0.6 ms of GPU at 1920 × 1080, in five runs`, () => {
    added(FULL, TASK.targets.local_1080p_gpu_ms);
  }, TIMEOUT);

  it(`${AC[8]} local {strength: 0.5} adds under 2 ms of GPU at 3840 × 2160, in five runs`, () => {
    added(UHD, TASK.targets.local_2160p_gpu_ms);
  }, TIMEOUT);
});
