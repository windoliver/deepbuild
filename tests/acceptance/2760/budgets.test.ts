// #2760.6dfadd78: "Budget, on the reference Mac in the local preflight, compared with the merge base: 64 live rings on a
// pond that fills half a 1080p frame add under 0.3 ms of GPU"
//
// "Compared with the merge base" is the perf lane's, as #166's and #968's suites read it: benchmarks/budgets.json holds a
// task for this issue, `canvas-water-rings`, run as `node benchmarks/canvas.mjs water-rings`, holding the issue's 0.3 ms
// at the lane's 50% margin, its criteria naming this criterion and its initialReason naming #2760, and the file passes
// the lane's own validator against the merge base's budgets.json (the earlier water tasks stay frozen). The lane
// compares the task with the merge base. This test runs anywhere.
//
// The timing, as #166's and #968's suites time theirs: at 1920 × 1080, 300 frames at 30 fps with `timings: true`, one
// process per run drawing the two sides, five runs after a warm-up run, each with the one-minute load average read at
// its start and its end, judged by the lane's `judgeLimit` (scripts/benchmark.mjs, in a child process): PASS when all
// five are within the limit, FAIL when all five are over it by more than the margin, else INCONCLUSIVE; off a reference
// Mac, off mains, in Low Power Mode, not thermally nominal, or with the load at a run's start or end above the core
// count, INCONCLUSIVE, never a pass. The machine is read before anything is timed, by the same judge with the load
// read then, so an unfit machine times nothing.
// The pond: the plate `pond`, 12 m × 8 m of 128 × 128 cells, its material carrying `water: {rings: {on: {list:
// "shower.occurrences", kinds: ["touch"]}}}` (every other field its default: a 3 m/s breeze's waves and the ripples),
// seen straight down from the height at which the pond fills half the frame's area (fov 60° across the width: 18.5 m ×
// 10.4 m of the plane, 16 m up). The logic item `shower` (60 Hz) emits 64 touches in one step, on an 8 × 8 grid 1.5 m by
// 1 m apart, at steps 0, 122, 244, 366 and 488: each batch's rings live 2 s and the next batch falls two steps after
// they end, so 64 rings are alive at every frame but one in 61, and never more. Against the same pond and logic item
// with `water: {}`: the difference of the sides' median `gpu_ms` is what the rings add. The warm-up shows the measure
// sees what it times: at 0.5 s the rows list 64 rings and the two sides draw different pixels.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CAP, DAY_SKY, FILMIC, REPO, TOUCH, type Emitter, type JsonObject, type Load, type Touch, arr, camera, emitter, frameAt, framesOf, gpuMs, inconclusive, judge,
  lane, loadNow, logicItem, material, median, plate, putAsset, requireGpu, runGpu, sceneDoc, sun, timingProblem, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const ID = AC[8];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 300;
const FPS = 30;
const TASK = { id: 'canvas-water-rings', command: ['node', 'benchmarks/canvas.mjs', 'water-rings'], targets: { rings_pond_gpu_ms: 0.3 } };
const POND: [number, number] = [12, 8];
/** The camera's height: the frame sees W × W·(1080 ÷ 1920) of the plane, and the 96 m² pond is half of that. */
const VIEW_WIDTH = Math.sqrt((2 * POND[0] * POND[1] * SIZE[0]) / SIZE[1]);
const HEIGHT = VIEW_WIDTH / 2 / Math.tan(Math.PI / 6);
/** The frame the warm-up reads: 0.5 s, when the first batch's rings are 0.15 m wide. */
const SHOWN = 15;

/** 64 touches in one step, five times, 122 steps apart, on an 8 × 8 grid over the pond. */
const shower = (): Emitter => emitter('shower', [{ ...TOUCH, max: CAP }], [0, 122, 244, 366, 488].flatMap((step) => Array.from({ length: CAP }, (_, i): Touch => ({
  step, kind: 'touch', a: i + 1, fields: { point: [-5.25 + 1.5 * (i % 8), 0, -3.5 + Math.floor(i / 8)], n: i + 1 },
}))));
function pond(e: Emitter, rings: boolean): JsonObject {
  return sceneDoc(`half-frame-pond-${rings ? 'rings' : 'bare'}`, SIZE, {
    cam: camera([0, HEIGHT, 0], [0, 0, 0], 60), sky: DAY_SKY, sun: sun(3, [-30, 30, 0]),
    'pond-water': material({ roughness: 0.05, water: rings ? { rings: { on: { list: 'shower.occurrences', kinds: ['touch'] } } } : {} }),
    pond: plate(POND, [128, 128], [0, 0, 0], 'pond-water'),
    shower: logicItem(e),
  });
}

describe(`${ID} the rings' budget`, () => {
  it(`${ID} budgets.json holds the task canvas-water-rings with the issue's number, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
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
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #2760`).toMatch(/#2760\b/);
  });

  it(`${ID} 64 live rings on a pond that fills half a 1080p frame add under 0.3 ms of GPU, in five runs`, () => {
    requireGpu();
    const problem = timingProblem();
    if (problem) inconclusive(`the rings' GPU time counts only on a reference Mac at rest: ${problem}`);
    const e = shower();
    const sides = (dir: string): [string, string] => [writeJson(dir, 'rings', pond(e, true)), writeJson(dir, 'bare', pond(e, false))];

    // The warm-up, untimed: both sides draw, and they are what the criterion names.
    {
      const dir = out();
      const assets = putAsset(dir, e.program);
      const [ringed, bare] = sides(dir);
      const shot = (doc: string): JsonObject => view3d({ doc, look: FILMIC, size: SIZE, from: SHOWN, frames: 1, fps: FPS, capture: [SHOWN], targets: [], rings: true, assets });
      const [a, b] = runGpu(bin(), dir, [shot(ringed), shot(bare)]);
      const fa = frameAt(framesOf(a!, 'the pond with rings'), SHOWN, 'the pond with rings'); const fb = frameAt(framesOf(b!, 'the pond without rings'), SHOWN, 'the pond without rings');
      expect(arr(fa.raw['rings'], 'the pond with rings: frame 15\'s rings').length, '64 rings are alive on the pond at 0.5 s').toBe(CAP);
      expect(fa.pixel_hash, 'the two sides draw different pixels, so the measure sees what it times').not.toBe(fb.pixel_hash);
    }

    const once = (): { a: number; b: number; load: Load } => {
      const dir = out();
      const assets = putAsset(dir, e.program);
      const calls = sides(dir).map((doc) => view3d({ doc, look: FILMIC, size: SIZE, frames: FRAMES, fps: FPS, timings: true, assets }));
      const start = loadNow();
      const [ra, rb] = runGpu(bin(), dir, calls);
      const end = loadNow();
      const fa = framesOf(ra!, 'the pond with rings'); const fb = framesOf(rb!, 'the pond without rings');
      expect([fa.length, fb.length], `each side draws ${FRAMES} frames`).toEqual([FRAMES, FRAMES]);
      return { a: median(gpuMs(fa, 'the pond with rings')), b: median(gpuMs(fb, 'the pond without rings')), load: { start, end } };
    };
    once();
    const runs = Array.from({ length: 5 }, once);
    judge(`${ID} 64 live rings on the pond, added GPU (ms a frame)`, TASK.targets.rings_pond_gpu_ms, runs.map((r) => Math.max(0, r.a - r.b)), runs.map((r) => r.load));
  });
});
