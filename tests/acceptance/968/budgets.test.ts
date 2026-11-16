// #968.3dca895d: "Budget, measured in the scheduled budget window on a reference Mac at the merged commit against its
// merge base; the PR says `Part of #968` until that window closes the issue; unmeasured is never PASS: a 20 m wide,
// 30 m sheet of water with flow filling a third of a 1080p frame adds under 0.4 ms of GPU"
//
// The budget window runs benchmarks/budgets.json's tasks against the merge base, so the file holds a task for this
// issue, `canvas-water-flow`, run as `node benchmarks/canvas.mjs water-flow`, holding the issue's 0.4 ms at the lane's
// 50% margin, its criteria naming this criterion and its initialReason naming #968; the file passes the lane's
// validator against the merge base's budgets.json (#166's `canvas-water` and #268's `canvas-water-shore` stay frozen).
// The PR's `Part of #968` and the window's verdict are the window's, not this file's.
//
// The timing, as #166's and #268's suites time theirs: at 1920 × 1080, 300 frames at 30 fps with `timings: true`, one
// process per run drawing the two sides, five runs after a warm-up run, judged by the lane's `judgeLimit`
// (scripts/benchmark.mjs, in a child process): PASS when all five are within the limit, FAIL when all five are over it
// by more than the margin, else INCONCLUSIVE; off a reference Mac, off mains, in Low Power Mode, not thermally nominal,
// or with the machine loaded past its core count, INCONCLUSIVE, never a pass, checked before anything is timed. The
// sheet: a plate 30 m along x and 20 m wide of 256 × 256 cells whose material carries `water: {flow: {along: "c",
// speed: 1.5, cycle: 2}}` (every other field its default, so a 3 m/s breeze's waves and the ripples), `c` a straight
// curve down its middle; the camera looks straight down from the height at which the sheet fills a third of the
// frame's area (fov 60° across the width: 56.6 m × 31.8 m of the plane at y = 0). Against the same sheet with
// `water: {}`: the difference of the sides' median `gpu_ms` is what the flow adds. Each side draws what it times: the
// first run's two sides have different pixel hashes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DAY_SKY, FILMIC, type JsonObject, REPO, type Water, camera, framesOf, gpuMs, inconclusive, judge, lane, line, median, plate, requireGpu, runGpu,
  sceneDoc, sun, timingProblem, useGpu, useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 300;
const TASK = { id: 'canvas-water-flow', command: ['node', 'benchmarks/canvas.mjs', 'water-flow'], targets: { flow_sheet_gpu_ms: 0.4 } };
/** The camera's height: the frame sees W × W·(1080 ÷ 1920) of the plane, and the 600 m² sheet is a third of that. */
const VIEW_WIDTH = Math.sqrt((3 * 30 * 20 * SIZE[0]) / SIZE[1]);
const HEIGHT = VIEW_WIDTH / 2 / Math.tan(Math.PI / 6);

function sheet(water: Water): JsonObject {
  return sceneDoc(`sheet-${water.flow ? 'flow' : 'still'}`, SIZE, {
    cam: camera([0, HEIGHT, 0], [0, 0, 0], 60), sky: DAY_SKY, sun: sun(3, [-30, 30, 0]),
    'sheet-water': waterMaterial(water),
    c: line([[-15, 0, 0], [15, 0, 0]]),
    sheet: plate([30, 20], [256, 256], [0, 0, 0], 'sheet-water'),
  });
}

describe(`${ID} the flow's budget`, () => {
  it(`${ID} budgets.json holds the task canvas-water-flow with the issue's number, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
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
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #968`).toMatch(/#968\b/);
  });

  it(`${ID} a 20 m wide, 30 m sheet of water with flow filling a third of a 1080p frame adds under 0.4 ms of GPU, in five runs`, () => {
    requireGpu();
    const problem = timingProblem();
    if (problem) inconclusive(`the sheet's GPU time counts only on a reference Mac at rest: ${problem}`);
    const once = (): { a: number; b: number; hashes: [string, string] } => {
      const dir = out();
      const call = (doc: JsonObject, k: number): JsonObject => view3d({ doc: writeJson(dir, `side-${k}`, doc), look: FILMIC, size: SIZE, frames: FRAMES, fps: 30, timings: true });
      const [ra, rb] = runGpu(bin(), dir, [call(sheet({ flow: { along: 'c', speed: 1.5, cycle: 2 } }), 0), call(sheet({}), 1)]);
      const fa = framesOf(ra!, 'the sheet with flow'); const fb = framesOf(rb!, 'the sheet without flow');
      expect([fa.length, fb.length], `each side draws ${FRAMES} frames`).toEqual([FRAMES, FRAMES]);
      return { a: median(gpuMs(fa, 'the sheet with flow')), b: median(gpuMs(fb, 'the sheet without flow')), hashes: [fa[0]!.pixel_hash, fb[0]!.pixel_hash] };
    };
    once();
    const runs = Array.from({ length: 5 }, once);
    expect(runs[0]!.hashes[0], 'the two sides draw different pixels, so the measure sees what it times').not.toBe(runs[0]!.hashes[1]);
    judge(`${ID} the sheet with flow, added GPU (ms a frame)`, TASK.targets.flow_sheet_gpu_ms, runs.map((r) => Math.max(0, r.a - r.b)));
  });
});
