// #465.5d373d2b: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the fused finish
// (print wear, tone curve, screen, grain and vignette) costs under 0.3 ms at 1080p, a flare under 0.3 ms, a mirror under
// a quarter of the scene's frame time, and an indexed look's target under 1 MB"
//
// "Compared with the merge base" is the perf lane's, as #149's and #429's suites read it: benchmarks/budgets.json holds a
// task for this issue, `canvas-flares-mirrors`, run as `node benchmarks/canvas.mjs flares-mirrors`, holding the issue's
// numbers, at the lane's 50% margin, whose initialReason names #465, and the file passes the lane's own validator
// against the merge base's budgets.json. The lane compares the task with the merge base.
//
// The timings, each in its own test, on the stage below at 1920 × 1080 (a 20 m floor plate, twelve boxes, a day sky, a
// sun, a point light, a camera orbiting at 12°/s), 300 frames at 30 fps with `timings: true`, one process per run with
// the two sides, five runs after a warm-up run, judged by the lane's `judgeLimit` (scripts/benchmark.mjs, run in a
// child process): PASS when all five are within the limit, FAIL when all five are over it by more than the margin,
// else INCONCLUSIVE; off a reference Mac, off mains, in Low Power Mode, not thermally nominal, or with the machine
// loaded past its core count, INCONCLUSIVE, never a pass, checked before anything is timed. A cost is the difference of
// the medians of the two sides' `gpu_ms`: the five finishes off identity against `finish: []`; the stage with a full
// flare (8 ghosts, a halo, 6 streaks and a 6-bladed starburst) against without it; and for the mirror, the floor's
// material with `mirror` against without it, as a share of the plain stage's median. Each side draws what it times: the
// first run's two sides have different pixel hashes.
// The indexed target: an indexed look at its default size, 320 × 180, scale 6 (1080p), with its light target on;
// `film2d`'s `indexed` record names `target_bytes`, the bytes of the GPU targets the indexed basis draws into, which
// must be under 1,000,000 and at least one byte per target pixel. Bytes don't vary by machine, so this one runs on any
// Mac. Wrong programs: a finish, flare or mirror over its budget; an indexed look drawn at full resolution.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DAY_SKY, FILMIC, type JsonObject, REPO, answered, arr, box, channel, flare, framesOf, gpuMs, inconclusive, isObject, judge, lane, material, median,
  num, obj, plate, pointLight, requireGpu, runGpu, sceneDoc, sun, timingProblem, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 300;
const TASK = { id: 'canvas-flares-mirrors', command: ['node', 'benchmarks/canvas.mjs', 'flares-mirrors'], targets: { finish_gpu_ms: 0.3, flare_gpu_ms: 0.3, mirror_share: 0.25, indexed_target_bytes: 1_000_000 } };

const FINISH: JsonObject[] = [
  { print_wear: { flicker: '5%', weave: 1.5, scratches: { count: [1, 3], width: 2, life: 6 }, dust: { density: 0.3, size: 3 }, hair: 0.2, gate: { corner_radius: 40, softness: 8 }, rate: 24 } },
  { tone_curve: { black: 0.04, white: 0.96, contrast: 1.15, toe: 0.2, shoulder: 0.2 } },
  { screen: { kind: 'crt', scanlines: 240, mask: 'aperture', curvature: 0.1 } },
  { grain: { amount: '4%', size: '1px', tone: 'flat', rate: 24 } },
  { vignette: { color: 'ink', shape: 'round', inner: 0.45, outer: 1, amount: 0.7, aspect: 'frame' } },
];
function stage(opts: { flare?: boolean; mirror?: boolean }): JsonObject {
  const floor: JsonObject = { base_color: [0.05, 0.05, 0.06, 1], metallic: 0, roughness: 0.2 };
  if (opts.mirror) floor['mirror'] = { strength: 1, blur: 0, plane: 'floor' };
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.8, 0], orbit: { azimuth: 30, elevation: 15, distance: 9 }, fov: 45, near: 0.1, far: 500 } },
    sky: DAY_SKY, sun: sun(3, [-45, 30, 0]), 'key-light': pointLight([0.8, 1.6, -1]),
    floor_mat: material(floor), box_mat: material({ base_color: [0.7, 0.45, 0.3, 1], roughness: 0.6 }),
    floor: plate([20, 20], [0, 0, 0], [0, 0, 0], 'floor_mat'),
  };
  for (let k = 0; k < 12; k++) items[`box${k}`] = box([0.7, 0.7 + 0.15 * (k % 4), 0.7], [3 * Math.cos((k * Math.PI) / 6), 0.35 + 0.075 * (k % 4), 3 * Math.sin((k * Math.PI) / 6)], 'box_mat');
  if (opts.flare) items['flare'] = flare({ ghosts: 8, halo: 0.05, streak: { count: 6, length: 0.25, anamorphic: false }, starburst: { blades: 6 } });
  return sceneDoc(`stage-${opts.flare ? 'flare' : ''}${opts.mirror ? 'mirror' : ''}`, SIZE, items, { channels: { spin: channel('items/cam/params/orbit/azimuth', [[0, 30], [10, 150]]) } });
}

/** Five runs after a warm-up, each one process drawing the two sides; returns each run's medians, and checks once that
 * the two sides draw different pixels. */
function timed(name: string, a: [JsonObject, JsonObject], b: [JsonObject, JsonObject]): { a: number; b: number }[] {
  const problem = timingProblem();
  if (problem) inconclusive(`${name} counts only on a reference Mac at rest: ${problem}`);
  const once = (): { a: number; b: number; hashes: [string, string] } => {
    const dir = out();
    const call = ([doc, look]: [JsonObject, JsonObject], k: number): JsonObject => view3d({ doc: writeJson(dir, `side-${k}`, doc), look, size: SIZE, frames: FRAMES, fps: 30, timings: true });
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

describe(`${ID} the finishes', the flare's, the mirror's and the indexed look's budgets`, () => {
  it(`${ID} budgets.json holds the task canvas-flares-mirrors with the issue's numbers, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
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
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #465`).toMatch(/#465\b/);
  });

  it(`${ID} the fused finish (print wear, tone curve, screen, grain and vignette) costs under 0.3 ms of GPU a frame at 1080p, in five runs`, () => {
    requireGpu();
    const doc = stage({});
    const runs = timed('the fused finish', [doc, { ...FILMIC, finish: FINISH }], [doc, FILMIC]);
    judgeAdded(`${ID} the fused finish's added GPU (ms a frame)`, TASK.targets.finish_gpu_ms, runs.map((r) => r.a - r.b));
  });

  it(`${ID} a flare costs under 0.3 ms of GPU a frame at 1080p, in five runs`, () => {
    requireGpu();
    const runs = timed('the flare', [stage({ flare: true }), FILMIC], [stage({}), FILMIC]);
    judgeAdded(`${ID} the flare's added GPU (ms a frame)`, TASK.targets.flare_gpu_ms, runs.map((r) => r.a - r.b));
  });

  it(`${ID} a mirror costs under a quarter of the scene's frame time at 1080p, in five runs`, () => {
    requireGpu();
    const runs = timed('the mirror', [stage({ mirror: true }), FILMIC], [stage({}), FILMIC]);
    judgeAdded(`${ID} the mirror's added GPU as a share of the scene's`, TASK.targets.mirror_share, runs.map((r) => (r.a - r.b) / r.b));
  });

  it(`${ID} an indexed look's target is under 1 MB: 320 × 180 at scale 6 with its light target`, () => {
    requireGpu();
    const base = JSON.parse(readFileSync(join(REPO, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8')) as JsonObject;
    const look: JsonObject = {
      ...base, id: 'indexed-465', description: 'The #465 indexed look.',
      palette: { ...obj(base['palette'], 'palette'), 'c-wall': '#2c3e7b' }, roles: { ...obj(base['roles'], 'roles'), wall: 'c-wall' },
      basis: { indexed: { size: [320, 180], scale: 6, palette: ['ground', 'wall'], tables: {}, protected: [], snap: 'integer', light: { max: 255 } } },
    };
    const doc: JsonObject = {
      format: 1, id: 'indexed-465', profile: 'figure', title: 'Indexed', description: 'One wall on an indexed look.', size: [...SIZE], seed: 465,
      transport: { span: '1s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'showpiece' },
      layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
      items: { wall: { id: 'wall', kind: 'rect@1', layer: 'main', name: 'wall', order: 'a0', params: { box: [240, 120, 960, 600], paint: { fill: { role: 'wall' } } } } },
    };
    const [reply] = runGpu(bin(), out(), [{ call: 'film2d', doc, look, frames: 1, hash: true }]);
    const indexed = answered(reply!, 'the indexed film')['indexed'];
    expect(isObject(indexed), `film2d's reply carries its indexed record: ${JSON.stringify(indexed)}`).toBe(true);
    const bytes = num((indexed as JsonObject)['target_bytes'], 'indexed.target_bytes');
    console.log(`${ID}: the indexed look's targets hold ${bytes} bytes (palette ${arr((indexed as JsonObject)['palette'], 'indexed.palette').length} entries)`);
    expect(bytes, 'the targets hold at least one byte per target pixel').toBeGreaterThanOrEqual(320 * 180);
    expect(bytes, 'the indexed look\'s targets are under 1 MB').toBeLessThan(TASK.targets.indexed_target_bytes);
  });
});

/** A cost below zero is read as zero: the lane's judge takes no negative reading, and a side that costs nothing is within any limit. */
function judgeAdded(name: string, limit: number, runs: number[]): void {
  judge(name, limit, runs.map((r) => Math.max(0, r)));
}
