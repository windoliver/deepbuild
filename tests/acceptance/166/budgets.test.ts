// #166.198cb586: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a lake filling half a
// 1080p frame with four waves, ripples and rain adds under 0.5 ms of GPU beside its mirror's own pass, and a 256 × 256
// plate's waves add under 0.1 ms in the vertex stage"
//
// "Compared with the merge base" is the perf lane's, as #465's and #149's suites read it: benchmarks/budgets.json holds a
// task for this issue, `canvas-water`, run as `node benchmarks/canvas.mjs water`, holding the issue's numbers, at the
// lane's 50% margin, whose initialReason names #166, and the file passes the lane's own validator against the merge
// base's budgets.json. The lane compares the task with the merge base.
//
// The timings, each in its own test, at 1920 × 1080, 300 frames at 30 fps with `timings: true`, one process per run with
// the two sides, five runs after a warm-up run, judged by the lane's `judgeLimit` (scripts/benchmark.mjs, run in a child
// process): PASS when all five are within the limit, FAIL when all five are over it by more than the margin, else
// INCONCLUSIVE; off a reference Mac, off mains, in Low Power Mode, not thermally nominal, or with the machine loaded past
// its core count, INCONCLUSIVE, never a pass, checked before anything is timed. A cost is the difference of the medians
// of the two sides' `gpu_ms`, a negative one read as 0. Each side draws what it times: the first run's two sides have
// different pixel hashes.
// - The lake: a plate 400 m × 400 m of 256 × 256 cells, the camera 2 m above it looking level, so the water fills the
//   lower half of the frame up to its far edge 0.6° under the horizon, with a day sky, a sun and twelve crates on it.
//   The water (LAKE_WAVES, ripples 0.3, rain 50) against the same plate with a plain material whose mirror names the
//   plate (strength 1, blur 0, roughness 0, as the water's own): the difference is what the water adds beside its
//   mirror's own pass.
// - The waves in the vertex stage: a 10 m plate of 256 × 256 cells seen 300 m away, a few hundred pixels of the frame,
//   all its 66,049 vertices drawn: the water with LAKE_WAVES (no ripples, no rain) against the same plate with the plain
//   mirror material. The water's per-pixel work on so few pixels is under a microsecond, so the difference bounds the
//   waves' vertex cost from above.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DAY_SKY, FILMIC, type JsonObject, LAKE_WAVES, REPO, type Water, box, camera, framesOf, gpuMs, inconclusive, judge, lane, material, median, plate,
  requireGpu, runGpu, sceneDoc, sun, timingProblem, useGpu, useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const ID = AC[8];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 300;
const TASK = { id: 'canvas-water', command: ['node', 'benchmarks/canvas.mjs', 'water'], targets: { lake_gpu_ms: 0.5, waves_vertex_ms: 0.1 } };
const PLAIN = material({ base_color: [0.1, 0.12, 0.12, 1], roughness: 0, mirror: { strength: 1, blur: 0, plane: 'lake' } });

function lake(water: Water | null): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2, 0], [0, 2, -100], 60), sky: DAY_SKY, sun: sun(3, [-30, 30, 0]),
    'lake-water': water ? waterMaterial(water, { roughness: 0 }) : PLAIN,
    crate: material({ base_color: [0.55, 0.38, 0.2, 1], roughness: 0.7 }),
    lake: plate([400, 400], [256, 256], [0, 0, 0], 'lake-water'),
  };
  for (let k = 0; k < 12; k++) items[`crate${k}`] = box([1.5, 1.5, 1.5], [-15 + 2.7 * k, 0.5, -20 - 4 * (k % 3)], 'crate');
  return sceneDoc(`lake-${water ? 'water' : 'mirror'}`, SIZE, items);
}
function pondFar(water: Water | null): JsonObject {
  return sceneDoc(`pond-${water ? 'water' : 'mirror'}`, SIZE, {
    cam: camera([0, 40, 300], [0, 0, 0], 60), sky: DAY_SKY, sun: sun(3, [-30, 30, 0]),
    'lake-water': water ? waterMaterial(water, { roughness: 0 }) : PLAIN,
    lake: plate([10, 10], [256, 256], [0, 0, 0], 'lake-water'),
  });
}

/** Five runs after a warm-up, each one process drawing the two sides; returns each run's medians, and checks once that
 * the two sides draw different pixels. */
function timed(name: string, a: JsonObject, b: JsonObject): { a: number; b: number }[] {
  const problem = timingProblem();
  if (problem) inconclusive(`${name} counts only on a reference Mac at rest: ${problem}`);
  const once = (): { a: number; b: number; hashes: [string, string] } => {
    const dir = out();
    const call = (doc: JsonObject, k: number): JsonObject => view3d({ doc: writeJson(dir, `side-${k}`, doc), look: FILMIC, size: SIZE, frames: FRAMES, fps: 30, timings: true });
    const [ra, rb] = runGpu(bin(), dir, [call(a, 0), call(b, 1)]);
    const fa = framesOf(ra!, `${name}: with`); const fb = framesOf(rb!, `${name}: without`);
    expect([fa.length, fb.length], `${name}: each side draws ${FRAMES} frames`).toEqual([FRAMES, FRAMES]);
    return { a: median(gpuMs(fa, `${name}: with`)), b: median(gpuMs(fb, `${name}: without`)), hashes: [fa[0]!.pixel_hash, fb[0]!.pixel_hash] };
  };
  once();
  const runs = Array.from({ length: 5 }, once);
  expect(runs[0]!.hashes[0], `${name}: the two sides draw different pixels, so the measure sees what it times`).not.toBe(runs[0]!.hashes[1]);
  return runs;
}

describe(`${ID} the water's budgets`, () => {
  it(`${ID} budgets.json holds the task canvas-water with the issue's numbers, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
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
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #166`).toMatch(/#166\b/);
  });

  it(`${ID} a lake filling half a 1080p frame with four waves, ripples and rain adds under 0.5 ms of GPU beside its mirror's own pass, in five runs`, () => {
    requireGpu();
    const runs = timed('the lake', lake({ waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 50 }), lake(null));
    judge(`${ID} the lake's added GPU beside its mirror (ms a frame)`, TASK.targets.lake_gpu_ms, runs.map((r) => Math.max(0, r.a - r.b)));
  });

  it(`${ID} a 256 × 256 plate's waves add under 0.1 ms in the vertex stage, in five runs`, () => {
    requireGpu();
    const runs = timed('the waves', pondFar({ waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 0 }), pondFar(null));
    judge(`${ID} the 256 × 256 plate's waves (ms a frame)`, TASK.targets.waves_vertex_ms, runs.map((r) => Math.max(0, r.a - r.b)));
  });
});
