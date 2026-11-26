// #3033.49bf9e99: "A sea filling half of a 1080p frame adds under 0.6 ms of GPU time over the same plate with `waves:
// wind` (drafted), measured in a budget window on a reference Mac. Unmeasured is never PASS"
//
// The budget window runs benchmarks/budgets.json's tasks against the merge base (docs/parallel-proof.md, 12a), so the
// file holds a task for this issue, `canvas-water-sea`, run as `node benchmarks/canvas.mjs water-sea`, holding the
// issue's 0.6 ms at the lane's 50% margin, its criteria naming this criterion and its initialReason naming #3033; the
// file passes the lane's own validator against the merge base's budgets.json (the earlier water tasks stay frozen).
// The window's verdict at the merged commit is the window's, not this file's: the PR says `Part of #3033` until it
// closes the issue. The first test runs anywhere.
//
// The timing, as #166's, #968's and #2760's suites time theirs: at 1920 × 1080, 300 frames at 30 fps with `timings:
// true`, one process per run drawing the two sides, five runs after a warm-up run, each with the one-minute load
// average read at its start and its end, judged by the lane's `judgeLimit` (scripts/benchmark.mjs, in a child process):
// PASS when all five are within the limit, FAIL when all five are over it by more than the margin, else INCONCLUSIVE;
// off a reference Mac, off mains, in Low Power Mode, not thermally nominal, or with the load at a run's start or end
// above the core count, INCONCLUSIVE, never a pass. Without a GPU it reads BLOCKED.
//
// The sea: a plate 1 km × 1 km of 256 × 256 cells, `water: {waves: {sea: {wind: 10, direction: 90, spread: 30, seed:
// 3033}}}`, every other field its default, under a day sky and a sun, seen by a level camera 12 m above it and 60 m in
// from its near edge (fov 60° across the width), so the water fills the frame from its bottom row up to 0.7° under the
// horizon: 48% of the frame at rest. Against the same plate and camera with `waves: {wind: {speed: 10, direction:
// 90}}`: the difference of the sides' median `gpu_ms` is what the sea adds.
//
// Before the machine is read, a first run shows that what will be timed is what the criterion names: the sea side's
// receipt lists the sea's wave table; on each side the `depth` target shows a surface over 45% to 55% of the frame's
// pixels; and the two sides draw different pixels.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, type JsonObject, type Load, REPO, type Sea, type Size, type Wind, camera, depthOf, fourWaves, frameAt, framesOf, gpuMs, inconclusive, judge, lane,
  loadNow, median, requireGpu, runGpu, sea, seaDoc, timingProblem, useGpu, useOut, view3d, waveTable, writeJson,
} from './helpers.ts';

const ID = AC[6];
const bin = useGpu();
const out = useOut();
const SIZE: Size = [1920, 1080];
const FRAMES = 300;
const FPS = 30;
const TASK = { id: 'canvas-water-sea', command: ['node', 'benchmarks/canvas.mjs', 'water-sea'], targets: { sea_gpu_ms: 0.6 } };
/** The frame the first run reads: 2 s. */
const SHOWN = 60;
const side = (name: string, waves: Sea | Wind): JsonObject =>
  seaDoc(`half-frame-${name}`, SIZE, camera([0, 12, 440], [0, 12, -500], 60, 5000), waves, [1000, 1000], [256, 256]);

describe(`${ID} the sea's budget`, () => {
  it(`${ID} budgets.json holds the task canvas-water-sea with the issue's number, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    expect(lane('b.validateBudgets(input.current, input.base); return "valid";', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }), 'the lane\'s validator accepts budgets.json against the merge base\'s').toBe('valid');
    const entry = current.tasks.find((t) => t['id'] === TASK.id);
    expect(entry, `budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's number`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} proves this criterion`).toEqual([ID]);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #3033`).toMatch(/#3033\b/);
  });

  it(`${ID} a sea filling half of a 1080p frame adds under 0.6 ms of GPU time over the same plate with waves: wind, in five runs`, () => {
    requireGpu();
    const sides = (dir: string): [string, string] => [writeJson(dir, 'sea', side('sea', sea(10))), writeJson(dir, 'four-waves', side('four-waves', fourWaves(10)))];

    // The first run, untimed: both sides draw, and they are what the criterion names.
    {
      const dir = out();
      const [a, b] = runGpu(bin(), dir, sides(dir).map((doc) => view3d({ doc, look: FILMIC, size: SIZE, from: SHOWN, frames: 1, fps: FPS, capture: [SHOWN], targets: ['depth'], receipt: true })));
      expect(waveTable(a!, 'the sea'), 'the side that is timed is a sea: its receipt lists the sea\'s wave table, receipt.water.waves').not.toBeNull();
      const [fa, fb] = [frameAt(framesOf(a!, 'the sea'), SHOWN, 'the sea'), frameAt(framesOf(b!, 'the same plate with waves: wind'), SHOWN, 'the same plate with waves: wind')];
      for (const [what, f] of [['the sea', fa], ['the same plate with waves: wind', fb]] as const) {
        const share = depthOf(dir, f, SIZE, what).filter((d) => Number.isFinite(d)).length / (SIZE[0] * SIZE[1]);
        console.log(`${ID}: ${what} is drawn over ${(share * 100).toFixed(1)}% of the 1080p frame`);
        expect(share, `${what} fills half of the 1080p frame: over 45% of its pixels`).toBeGreaterThan(0.45);
        expect(share, `${what} fills half of the 1080p frame: under 55% of its pixels`).toBeLessThan(0.55);
      }
      expect(fa.pixel_hash, 'the two sides draw different pixels, so the measure sees what it times').not.toBe(fb.pixel_hash);
    }

    const problem = timingProblem();
    if (problem) inconclusive(`the sea's GPU time counts only on a reference Mac at rest: ${problem}`);
    const once = (): { a: number; b: number; load: Load } => {
      const dir = out();
      const calls = sides(dir).map((doc) => view3d({ doc, look: FILMIC, size: SIZE, frames: FRAMES, fps: FPS, timings: true }));
      const start = loadNow();
      const [ra, rb] = runGpu(bin(), dir, calls);
      const end = loadNow();
      const fa = framesOf(ra!, 'the sea'); const fb = framesOf(rb!, 'the same plate with waves: wind');
      expect([fa.length, fb.length], `each side draws ${FRAMES} frames`).toEqual([FRAMES, FRAMES]);
      return { a: median(gpuMs(fa, 'the sea')), b: median(gpuMs(fb, 'the same plate with waves: wind')), load: { start, end } };
    };
    once();
    const runs = Array.from({ length: 5 }, once);
    judge(`${ID} a sea filling half of a 1080p frame, added GPU over waves: wind (ms a frame)`, TASK.targets.sea_gpu_ms, runs.map((r) => Math.max(0, r.a - r.b)), runs.map((r) => r.load));
  });
});
