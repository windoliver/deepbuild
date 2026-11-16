// #268.b2dd7e77: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a lake filling half
// a 1080p frame with `shore` on still adds under 0.5 ms of GPU beside its mirror's own pass, as #166's budget holds, and
// the field's bake time is recorded as a reading"
//
// The blind redraft of tests/acceptance/268/budgets.test.ts for #1830: the same three tests, names and measures. What
// changes is the load: each timed run, and the bake's one run, reads the one-minute load average (`os.loadavg()[0]`, as
// the lane's own runs read it) at its start and at its end, and every `judgeLimit` call passes them as `loads`, one
// { start, end } per run in the runs' order, as the design's timing rule reads a run (How we know version 0 works: a run
// whose load at its start or end is above the core count, or can't be read, counts neither way). The first draft gave
// judgeLimit no loads, so since #1555 its timing and its reading were INCONCLUSIVE on every machine.
//
// "Compared with the merge base" is the perf lane's, as #166's suite reads it. #166's task `canvas-water` is frozen
// (the lane's validator refuses a changed established task), so benchmarks/budgets.json holds a task for this issue,
// `canvas-water-shore`, run as `node benchmarks/canvas.mjs water-shore`, holding the issue's 0.5 ms at the lane's 50%
// margin, whose initialReason names #268; the file passes the lane's validator against the merge base's budgets.json.
//
// The timing, at 1920 × 1080, 300 frames at 30 fps with `timings: true`, one process per run with the two sides, five
// runs after a warm-up run, judged by the lane's `judgeLimit` (scripts/benchmark.mjs, in a child process) with each
// run's load: PASS when all five are within the limit, FAIL when all five are over it by more than the margin, else
// INCONCLUSIVE; off a reference Mac, off mains, in Low Power Mode, not thermally nominal, or with the load at a run's
// start or end above the core count, INCONCLUSIVE, never a pass. The machine is also read before anything is timed, by
// the same judge with the load read then, so an unfit machine times nothing. The lake is #166's: a 400 m × 400 m plate
// of 256 × 256 cells, the camera 2 m above it looking level, so the water fills the lower half of the frame, with four
// waves, ripples 0.3 and rain 50; on it twelve piles, a quay and a floating deck, all in `lake-shore`, and `shore:
// {items: "lake-shore", cell: 0.25, shade: 0.5}` (1,600 × 1,600 cells; at the default 0.1 m a 400 m plate is past the
// cap). Against the same plate and items with a plain material whose mirror names the plate: the difference of the
// sides' median `gpu_ms` is what the water with its shore adds beside its mirror's own pass. Each side draws what it
// times: the first run's two sides have different pixel hashes.
// The bake time: the same lake drawn once in a fresh process with `shore: true`, the load read at that run's start and
// end; its frame row's `shore.bake_ms` is printed as a reading line, a finite number above 0 with no limit; it counts
// only on a reference Mac at rest, which the same judge reads with that run's load.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DAY_SKY, FILMIC, type JsonObject, LAKE_WAVES, REPO, type Water, box, camera, collection, cylinder, frameAt, framesOf, gpuMs, inconclusive, lane,
  material, median, obj, plate, requireGpu, runGpu, sceneDoc, shoreOf, sun, useGpu, useOut, view3d, waterMaterial, writeJson,
} from '../268/helpers.ts';

const ID = AC[6];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 300;
const TASK = { id: 'canvas-water-shore', command: ['node', 'benchmarks/canvas.mjs', 'water-shore'], targets: { shore_lake_gpu_ms: 0.5 } };
const PLAIN = material({ base_color: [0.1, 0.12, 0.12, 1], roughness: 0, mirror: { strength: 1, blur: 0, plane: 'lake' } });
const SHORE_WATER: Water = { waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 50, shore: { items: 'lake-shore', cell: 0.25, shade: 0.5 } };

// ---------------------------------------------------------------------------------------------------
// The load and the judge

/** A run's one-minute load average, read at its start and at its end. */
type Load = { start: number; end: number };
const loadNow = (): number => loadavg()[0]!;
/** The load read now, as a run that starts and ends now. */
const atNow = (): Load => { const now = loadNow(); return { start: now, end: now }; };

/** The lane's `judgeLimit` in a child process, on this machine's fingerprint, with one load per run. */
function judgeLimit(limit: number, runs: number[], loads: Load[]): JsonObject {
  return obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads }), 'judgeLimit');
}
/** Why a reading can't count on this machine with this load, or '' when it can: the judge on five empty readings, each
 * with the given load, so the fingerprint and the load are read as a run's would be. */
function timingProblem(load: Load): string {
  const v = judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => load));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** One budget judged by the lane's rule on five runs after a warm-up, each with its load: PASS passes, FAIL fails, and
 * INCONCLUSIVE or BLOCKED fails `INCONCLUSIVE:` with its reason, never a pass. */
function judge(name: string, limit: number, runs: number[], loads: Load[]): void {
  const v = judgeLimit(limit, runs, loads);
  const line = `${name}: ${String(v['status'])} ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit}, the load at each run's start and end ${loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ')}${v['reason'] ? ` (${String(v['reason'])})` : ''}`;
  console.log(line);
  if (v['status'] === 'PASS') return;
  expect(v['status'], `FAIL: ${line}`).not.toBe('FAIL');
  inconclusive(line);
}

// ---------------------------------------------------------------------------------------------------
// The lake and the runs

function lake(water: Water | null): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2, 0], [0, 2, -100], 60), sky: DAY_SKY, sun: sun(3, [-30, 30, 0]),
    'lake-water': water ? waterMaterial(water, { roughness: 0 }) : PLAIN,
    wood: material({ base_color: [0.5, 0.36, 0.24, 1], roughness: 0.8 }),
    lake: plate([400, 400], [256, 256], [0, 0, 0], 'lake-water'),
    quay: box([60, 3, 6], [0, -0.5, -40], 'wood'),
    deck: box([8, 0.2, 6], [-10, 0.6, -14], 'wood'),
  };
  const members = ['quay', 'deck'];
  for (let k = 0; k < 12; k++) { items[`pile${k}`] = cylinder([1, 3, 1], [-15 + 2.7 * k, 0, -20 - 4 * (k % 3)], 'wood'); members.push(`pile${k}`); }
  return sceneDoc(`lake-${water ? 'shore' : 'mirror'}`, SIZE, items, { collections: { 'lake-shore': collection(members) } });
}

type Run = { a: number; b: number; hashes: [string, string]; load: Load };
/** Five runs after a warm-up, each one process drawing the two sides with the load read at its start and end; returns
 * each run's medians and load, and checks once that the two sides draw different pixels. */
function timed(name: string, a: JsonObject, b: JsonObject): Run[] {
  const problem = timingProblem(atNow());
  if (problem) inconclusive(`${name} counts only on a reference Mac at rest: ${problem}`);
  const once = (): Run => {
    const dir = out();
    const call = (doc: JsonObject, k: number): JsonObject => view3d({ doc: writeJson(dir, `side-${k}`, doc), look: FILMIC, size: SIZE, frames: FRAMES, fps: 30, timings: true });
    const calls = [call(a, 0), call(b, 1)];
    const start = loadNow();
    const [ra, rb] = runGpu(bin(), dir, calls);
    const end = loadNow();
    const fa = framesOf(ra!, `${name}: with`); const fb = framesOf(rb!, `${name}: without`);
    expect([fa.length, fb.length], `${name}: each side draws ${FRAMES} frames`).toEqual([FRAMES, FRAMES]);
    return { a: median(gpuMs(fa, `${name}: with`)), b: median(gpuMs(fb, `${name}: without`)), hashes: [fa[0]!.pixel_hash, fb[0]!.pixel_hash], load: { start, end } };
  };
  once();
  const runs = Array.from({ length: 5 }, once);
  expect(runs[0]!.hashes[0], `${name}: the two sides draw different pixels, so the measure sees what it times`).not.toBe(runs[0]!.hashes[1]);
  return runs;
}

describe(`${ID} the shore's budgets`, () => {
  it(`${ID} budgets.json holds the task canvas-water-shore with the issue's number, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
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
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #268`).toMatch(/#268\b/);
  });

  it(`${ID} a lake filling half a 1080p frame with shore on still adds under 0.5 ms of GPU beside its mirror's own pass, in five runs`, () => {
    requireGpu();
    const runs = timed('the lake with its shore', lake(SHORE_WATER), lake(null));
    judge(`${ID} the lake with shore on, added GPU beside its mirror (ms a frame)`, TASK.targets.shore_lake_gpu_ms, runs.map((r) => Math.max(0, r.a - r.b)), runs.map((r) => r.load));
  });

  it(`${ID} the field's bake time is recorded as a reading`, () => {
    requireGpu();
    const dir = out();
    const calls = [view3d({ doc: writeJson(dir, 'lake', lake(SHORE_WATER)), look: FILMIC, size: SIZE, frames: 1, fps: 30, capture: [0], shore: true })];
    const start = loadNow();
    const [reply] = runGpu(bin(), dir, calls);
    const end = loadNow();
    const row = shoreOf(dir, frameAt(framesOf(reply!, 'the lake with its shore'), 0, 'the lake with its shore'), 'the lake with its shore');
    expect(row.bakeMs, 'the bake time is a reading above 0 ms').toBeGreaterThan(0);
    const problem = timingProblem({ start, end });
    console.log(`${ID} reading: shore field bake ${row.bakeMs.toFixed(3)} ms for ${row.bytes.length} bytes (material ${row.material}, key ${row.key}), the load ${start.toFixed(2)} at the run's start and ${end.toFixed(2)} at its end${problem ? `; not on a reference Mac at rest: ${problem}` : ''}`);
    if (problem) inconclusive(`the bake time counts only on a reference Mac at rest: ${problem}`);
  });
});
