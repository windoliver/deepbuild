// AC7 #226.6a40f5c8: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the axes draw
// at the cost of the same ticks, labels and planes written as marks in 3D, under the frame-budget rule, and an item that
// carries `mod.axes@1` maps through its three scales only in frames where it or a scale changes, so a still frame gains
// no work; a planted modifier that maps every frame adds work to a still frame and fails, naming the item"
//
// The first test, by counters that hold on any machine: the axes of criterion 1 with the point `pt` and the surface
// `surface`, both carrying mod.axes@1, under a still camera, drawn by `view3d` for four frames with `counts`; a patch
// before frame 2 sets the x scale's domain to [−5, 5]. `counts.axes_mapped` (README: Assumed surfaces 4) names the items
// mod.axes@1 mapped through the scales in each frame: frame 0 and frame 2 (a scale changed) map pt and surface; the still
// frames 1 and 3 map nothing, build no mesh, write no instance record, upload no element and encode no batch. Each
// failure names the frame and the item. Under `deep-gpu run --planted axes_mod_maps_every_frame` (README: The planted
// programs) the same judge fails, naming pt or surface.
// The second test, the budgets: benchmarks/budgets.json holds the task `canvas-axes3d` with this criterion's ID, which
// the lane's validator accepts against the merge base's file, and scripts/lanes.mjs times this file; then, only where
// the lane can judge a timing (a reference Mac at rest, else INCONCLUSIVE before anything is timed), `frame_budget`
// (#1899, the frame-budget rule: five runs after warm-up of 5 s at 60 fps, 1920 × 1080) on two documents under the same
// orbiting camera: the axes with the xy grid plane, and their twin, the same ticks, labels, axis lines with tips and
// grid plane written as `mark.line@1` and `mark.text@1` (helpers.ts `marksTwinItems`). The axes' run passes the
// frame-budget rule for its class, and its five GPU p95s are judged by the lane's `judgeLimit` against 1.05 × the
// twin's median GPU p95 (the lane's smallest margin): a FAIL fails, anything but PASS is INCONCLUSIVE.
// Wrong programs: the base (no axes3d@1, no `axes_mapped`, no task); the plant; a mapping that reruns on every frame or
// on every frame the camera moves; axes drawn through a path dearer than the marks they stand for.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AXES, PLAIN, REPO, TIMEOUT, WRITER, agentDoc, arr, axesDoc, axesItem, brief, framesOf, inconclusive, isObject, judgeLimit, load, marksTwinItems,
  num, obj, orbitCamera, pointOnAxes, ramp, requireMetal, runGpu, scales, sessionDoc, set, sun, surfaceOnAxes, timingProblem, DAY_SKY, useBins, useOut,
  validateBudgets, writeJson, type JsonObject, type Planted,
} from './helpers.ts';

const ID = AC[7];
const NAME = `AC7 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();
const FRAMES = 4;
const STILL = [1, 3];
const MAPPED = ['pt', 'surface'];
/** The task the perf lane and the budget window run (README: Assumed surfaces 6). */
const TASK = { id: 'canvas-axes3d', command: ['node', 'benchmarks/canvas.mjs', 'axes3d'], targets: { axes_over_marks: 1.05, still_maps: 0 } };
const FILE = 'tests/acceptance/226/ac7-budgets.test.ts';

function counted(planted?: Planted): JsonObject[] {
  const dir = out();
  const doc = writeJson(dir, 'still', axesDoc('still-226', [640, 360], { pt: pointOnAxes([2, 3, 1]), surface: surfaceOnAxes() }));
  const patches = [{ frame: 2, writer: WRITER, ops: [set('xs', 'params/domain', [-5, 5])] }];
  const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc, look: PLAIN, size: [640, 360], fps: 30, frames: FRAMES, patches, counts: true }], planted);
  return framesOf(reply!, FRAMES, `the still axes${planted ? ` (--planted ${planted})` : ''}`);
}
const mappedIn = (f: JsonObject, k: number): string[] => arr(f['axes_mapped'], `frame ${k}: counts' axes_mapped (README: Assumed surfaces 4)`).map(String).sort();
/** Work a still frame does, each naming its frame and what it did (the item, for a mapping). */
function stillWork(frames: JsonObject[]): string[] {
  const work: string[] = [];
  for (const k of STILL) {
    const f = frames[k]!;
    const at = `frame ${k} (still)`;
    for (const id of mappedIn(f, k)) work.push(`${at}: mod.axes@1 maps ${id} through its three scales while nothing it reads changed`);
    for (const key of ['meshes_built', 'instances_written']) { const n = num(f[key], `${at}: ${key}`); if (n !== 0) work.push(`${at}: ${key} ${n}`); }
    const uploads = Object.entries(obj(f['element_uploads'], `${at}: element_uploads`)).filter(([, ids]) => arr(ids, `${at}: element_uploads`).length > 0);
    if (uploads.length) work.push(`${at}: uploads elements of ${uploads.map(([id]) => id).join(', ')}`);
    const encoded = arr(f['encoded'], `${at}: encoded`);
    if (encoded.length) work.push(`${at}: encodes ${brief(encoded, 300)}`);
  }
  return work;
}

/** Criterion 7's timing documents: the axes with the xy grid plane, or the same drawn as marks, under a camera orbiting
 * 360° in 5 s at 1920 × 1080. */
function timingDoc(twin: boolean): JsonObject {
  const common = { cam: orbitCamera('perspective', 0, 25, 24), sky: DAY_SKY, sun: sun(3, [-40, 30, 0]) };
  const items = twin ? { ...common, ...marksTwinItems() } : { ...common, ...scales(), [AXES]: axesItem({ planes: ['xy'] }) };
  return agentDoc(sessionDoc(twin ? 'axes-as-marks-226' : 'axes-226', [1920, 1080], items, { transport: { span: '5s' }, channels: { spin: ramp('items/cam/params/orbit/azimuth', 0, 360, 5) } }));
}

describe(`${NAME} the task's budgets`, () => {
  it(`${NAME} an item carrying mod.axes@1 maps through its scales only in frames where it or a scale changes; a planted modifier that maps every frame fails, naming the item`, () => {
    requireMetal();
    const frames = counted();
    expect(mappedIn(frames[0]!, 0), 'frame 0 maps the point and the surface through the scales').toEqual(MAPPED);
    expect(mappedIn(frames[2]!, 2), 'frame 2, where the x scale changed, maps them again').toEqual(MAPPED);
    expect(stillWork(frames), 'a still frame gains no work').toEqual([]);

    const planted = stillWork(counted('axes_mod_maps_every_frame'));
    expect(planted.length, 'the plant adds work to a still frame and fails').toBeGreaterThan(0);
    expect(planted.some((w) => MAPPED.some((id) => w.includes(` ${id} `))), `the failure names the item: ${planted.join('; ')}`).toBe(true);
  }, TIMEOUT);

  it(`${NAME} the budgets, recorded against the merge base and judged on the reference Mac: the axes at the cost of the same ticks, labels and planes as marks in 3D, under the frame-budget rule`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds this criterion's targets`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(ID);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #226`).toMatch(/#226\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    await expect(validateBudgets(current, JSON.parse(base.stdout) as JsonObject), 'the lane\'s validator accepts budgets.json against the merge base\'s').resolves.toBeUndefined();
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);

    const problem = await timingProblem();
    if (problem) inconclusive(`the budgets are judged only on a reference Mac at rest: ${problem}`);
    requireMetal();
    const run = (twin: boolean): { verdict: string; gpu: number[] } => {
      const dir = out();
      const doc = writeJson(dir, twin ? 'twin' : 'axes', timingDoc(twin));
      const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'frame_budget', look: PLAIN, writer: WRITER, doc, render: { seconds: 5, pixels: [1920, 1080] } }]);
      const what = twin ? 'the marks twin' : 'the axes';
      expect(reply!['code'], `${what}: frame_budget is answered: ${brief(reply)}`).toBeUndefined();
      const gpu = obj(obj(reply!['limits'], `${what}: limits`)['gpu'], `${what}: limits.gpu`);
      const runs = arr(gpu['runs'], `${what}: limits.gpu.runs`).map((r, i) => num(obj(r, `${what}: run ${i + 1}`)['p95_ms'], `${what}: run ${i + 1}: p95_ms`));
      return { verdict: String(reply!['verdict']), gpu: runs };
    };
    const twin = run(true);
    const start = load();
    const axes = run(false);
    const end = load();
    console.log(`${ID} GPU p95 ms: axes ${axes.gpu.map((x) => x.toFixed(3)).join(', ')} (${axes.verdict}); marks twin ${twin.gpu.map((x) => x.toFixed(3)).join(', ')} (${twin.verdict})`);
    expect(axes.verdict, 'the axes under the frame-budget rule').not.toBe('FAIL');
    const open: string[] = axes.verdict === 'PASS' ? [] : [`the axes' frame budget is ${axes.verdict}`];
    const median = [...twin.gpu].sort((a, b) => a - b)[2]!;
    const v = await judgeLimit(TASK.targets.axes_over_marks * median, axes.gpu, axes.gpu.map(() => ({ start, end })));
    expect(v['status'], `the axes' GPU p95 against 1.05 × the marks twin's median ${median.toFixed(3)} ms: ${JSON.stringify(v)}`).not.toBe('FAIL');
    if (v['status'] !== 'PASS') open.push(`the axes against their marks twin: ${JSON.stringify(v)}`);
    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
