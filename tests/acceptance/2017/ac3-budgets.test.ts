// AC3 #2017.751f674c: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a bevel with
// weighted normals on a 10,000-face prop builds in under 20 ms; two levels of subdivision of a 1,000-face mesh in under
// 50 ms; distributing 100,000 points with pruning in under 200 ms; a curve's arc-length table for 1,000 spans in under
// 2 ms; nothing in this task runs per frame while still; sway on 10,000 instanced trees of 2,000 vertices each adds
// under 0.5 ms of GPU at 1080p"
//
// The first test, "nothing in this task runs per frame while still", by counters, not timings (helpers.ts `stillDoc`):
// the terrain plate with its levels, a lawn scattered with pruning, a beveled prop with weighted normals, a subdivided
// mesh and a rail swept along a curve, under a still camera with nothing bound to time, drawn for six frames at 30 fps.
//   - deep-show `frames` (the canvas core's scheduler), beside the bare scene (the same camera, sky, sun and materials
//     with one box in place of the task's items) in the same process: the first frame runs more operators than the
//     bare scene's; no later frame runs more than the bare scene's same frame (`ran`; the base runs one generic
//     operator a frame even for a single box).
//   - deep-gpu `view3d` with `counts` and `lod`: the first frame selects tiles' levels (`terrain_tiles_selected` > 0,
//     README: Assumed surfaces 5) and draws some tile coarser than full detail; every later frame builds no mesh,
//     writes no instance record, uploads no element, encodes no batch and selects no tile.
// The second test, the budgets:
//   - recorded for the perf lane and the budget window, "compared with the merge base" (README: Readings):
//     benchmarks/budgets.json holds the task `canvas-ground` with the issue's numbers and this criterion's ID, which the
//     lane's validator accepts against the merge base's file; scripts/lanes.mjs runs this file as a timed one;
//   - the timing surface answers on this (debug) build (README: Assumed surfaces 4), and the fixtures are what the
//     clauses name: the scatter keeps between 20,000 and 99,999 of its 100,000 points (pruning drops some), the tree
//     has 2,000 vertices (`geometry` `estimate_only`); the prop's 10,000 builder faces, the mesh's 1,000 and the curve's
//     1,000 spans follow from the params (README: Fixtures, observed at the base);
//   - then, only where the lane can judge a timing (a reference Mac at rest, else INCONCLUSIVE before anything is
//     timed): deep-show built for release, one warm-up process and five, each reading bevel + normals, subdivision,
//     distribution and the arc-length table from `geometry` with `timings`; and the forest of 10,000 swaying trees at
//     1920 × 1080, 300 frames at 30 fps a side, sway on against sway off in one process, the sides' order alternating,
//     one warm-up run and five, the cost the difference of the sides' median `gpu_ms` (a negative one read as 0). Each
//     number is judged by the lane's `judgeLimit`: a FAIL fails, anything but PASS is INCONCLUSIVE.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BUDGET_IDS, FOREST_TREES, HD, PLAIN, PLATE, PLATE_ID, REPO, TIMEOUT, agentDoc, arr, brief, budgetDoc, buildInto, docId, forestDoc, framesOf,
  inconclusive, int, isObject, judgeLimit, load, num, obj, presented, requireMetal, runGpu, runShow, show, stillDoc, tilesOf, timingProblem,
  useBins, useOut, validateBudgets, writeJson, type JsonObject,
} from './helpers.ts';

const ID = AC[3];
const NAME = `AC3 ${ID}`;
const bin = useBins(['deep-show', 'deep-gpu']);
const out = useOut();
const STILL_FRAMES = 6;
const RUNS = 5;
const SWAY_FRAMES = 300;
/** The task the perf lane and the budget window run (README: Assumed surfaces 6). */
const TASK = {
  id: 'canvas-ground', command: ['node', 'benchmarks/canvas.mjs', 'ground'],
  targets: { bevel_ms: 20, subdivide_ms: 50, distribute_ms: 200, arc_length_ms: 2, still_steps: 0, sway_gpu_ms: 0.5 },
};
const FILE = 'tests/acceptance/2017/ac3-budgets.test.ts';

describe(`${NAME} the task's budgets`, () => {
  it(`${NAME} nothing in this task runs per frame while still, by the scheduler's and the view's counters`, () => {
    const dir = out();
    const [still, bare] = [docId(1), docId(2)];
    const replies = runShow(bin('deep-show'), dir, [still, bare], [
      show(still, agentDoc(stillDoc())), { call: 'frames', doc: still, count: STILL_FRAMES },
      show(bare, agentDoc(stillDoc(true))), { call: 'frames', doc: bare, count: STILL_FRAMES },
    ]);
    presented(replies[0]!, 'the still scene');
    presented(replies[2]!, 'the bare scene');
    const ran = (reply: JsonObject, what: string): number[] => {
      const frames = arr(obj(reply, `${what}: the frames reply`)['frames'], `${what}: frames`).filter(isObject);
      expect(frames.length, `${what}: deep-show draws ${STILL_FRAMES} frames`).toBe(STILL_FRAMES);
      return frames.map((f, k) => int(f['ran'], `${what}: frame ${k}: ran`));
    };
    const [task, base] = [ran(replies[1]!, 'the still scene'), ran(replies[3]!, 'the bare scene')];
    expect(task[0], 'the first frame runs the task\'s operators, more than the bare scene\'s').toBeGreaterThan(base[0]!);
    const ranLater = task.slice(1).map((n, k) => [k + 1, n, base[k + 1]!] as const).filter(([, n, b]) => n > b)
      .map(([k, n, b]) => `deep-show frame ${k} ran ${n} operators while nothing changed, the bare scene ${b}`);
    expect(ranLater, 'no frame after the first runs more operators in the canvas core than the same scene without the task\'s items').toEqual([]);

    requireMetal();
    const path = writeJson(dir, 'still', stillDoc());
    const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc: path, look: PLAIN, size: [640, 360], fps: 30, frames: STILL_FRAMES, counts: true, lod: true }]);
    const frames = framesOf(reply!, STILL_FRAMES, 'the still scene in view3d');
    const first = frames[0]!;
    expect(num(first['terrain_tiles_selected'], 'frame 0: counts\' terrain_tiles_selected (README: Assumed surfaces 5)'), 'the first frame selects the tiles\' levels').toBeGreaterThan(0);
    expect([...tilesOf(first, PLATE_ID, PLATE, 'the still scene, frame 0').values()].some((t) => t.level > 0), 'the still plate draws some tile coarser than full detail').toBe(true);
    const work: string[] = [];
    frames.slice(1).forEach((f) => {
      const at = `view3d frame ${String(f['frame'])}`;
      const n = (key: string): number => num(f[key], `${at}: ${key}`);
      for (const key of ['meshes_built', 'instances_written', 'terrain_tiles_selected']) if (n(key) !== 0) work.push(`${at}: ${key} ${n(key)}`);
      const uploads = Object.entries(obj(f['element_uploads'], `${at}: element_uploads`)).filter(([, ids]) => arr(ids, `${at}: element_uploads`).length > 0);
      if (uploads.length) work.push(`${at}: uploads elements of ${uploads.map(([k]) => k).join(', ')}`);
      const encoded = arr(f['encoded'], `${at}: encoded`);
      if (encoded.length) work.push(`${at}: encodes ${brief(encoded, 300)}`);
    });
    expect(work, 'no frame after the first builds, writes, uploads, encodes or selects anything while still').toEqual([]);
  }, TIMEOUT);

  it(`${NAME} the budgets, recorded against the merge base and judged on the reference Mac: bevel 20 ms, subdivision 50 ms, distribution 200 ms, arc length 2 ms, sway 0.5 ms of GPU at 1080p`, async () => {
    // The record.
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's numbers`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(ID);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #2017`).toMatch(/#2017\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    await expect(validateBudgets(current, JSON.parse(base.stdout) as JsonObject), 'the lane\'s validator accepts budgets.json against the merge base\'s').resolves.toBeUndefined();
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);

    // The surface, on the debug build, and the fixtures the clauses name.
    const cpu = (binary: string): { bevel: number; subdivide: number; distribute: number; arcLength: number } => {
      const dir = out();
      const doc = docId(2);
      const [shown, timed] = runShow(binary, dir, [doc], [show(doc, agentDoc(budgetDoc())), { call: 'geometry', doc, items: Object.values(BUDGET_IDS), timings: true }]);
      presented(shown!, 'the budget scene');
      const r = new Map(arr(timed!['items'], 'geometry with timings: items').filter(isObject).map((x) => [String(x['id']), x]));
      const stack = (id: string, k: number, kind: string): number => {
        const step = obj(arr(r.get(id)?.['stack'], `${id}: stack`)[k], `${id}: stack[${k}]`);
        expect(step['kind'], `${id}: stack[${k}] is ${kind}`).toBe(kind);
        return num(step['ms'], `${id}: stack[${k}].ms (README: Assumed surfaces 4)`);
      };
      const scatter = r.get(BUDGET_IDS.scatter);
      const kept = arr(scatter?.['elements'], 'the scatter: elements').length;
      expect(kept, 'the scatter keeps under 100,000 of its 100,000 points: pruning drops some').toBeLessThan(100_000);
      expect(kept, 'the scatter keeps at least 20,000 points').toBeGreaterThanOrEqual(20_000);
      return {
        bevel: stack(BUDGET_IDS.prop, 0, 'mod.bevel@1') + stack(BUDGET_IDS.prop, 1, 'mod.normals@1'),
        subdivide: stack(BUDGET_IDS.mesh, 0, 'mod.subdivide@1'),
        distribute: num(scatter?.['distribute_ms'], 'the scatter: distribute_ms (README: Assumed surfaces 4)'),
        arcLength: num(r.get(BUDGET_IDS.path)?.['arc_length_ms'], 'the curve: arc_length_ms (README: Assumed surfaces 4)'),
      };
    };
    cpu(bin('deep-show'));
    {
      const dir = out();
      const doc = docId(3);
      const [shown, counted] = runShow(bin('deep-show'), dir, [doc], [show(doc, agentDoc(forestDoc(true))), { call: 'geometry', doc, items: ['tree'], estimate_only: true }]);
      presented(shown!, 'the forest');
      const tree = arr(counted!['items'], 'the tree\'s count').filter(isObject)[0];
      expect(num(obj(tree?.['declared'], 'the tree: declared')['vertices'], 'the tree: vertices'), 'each tree has 2,000 vertices').toBe(2_000);
    }

    // The timings, only where the lane can judge them.
    const problem = await timingProblem();
    if (problem) inconclusive(`the budgets are judged only on a reference Mac at rest: ${problem}`);
    requireMetal();
    const relDir = mkdtempSync(join(tmpdir(), 'deep-2017-release-'));
    try {
      const built = buildInto('deep-show', true, relDir);
      expect(built.error, 'deep-show builds for release').toBe('');
      cpu(built.path);
      const runs: ReturnType<typeof cpu>[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < RUNS; k++) { const start = load(); runs.push(cpu(built.path)); loads.push({ start, end: load() }); }

      const swayRun = (k: number): number => {
        const dir = out();
        const side = (swaying: boolean): JsonObject => ({ call: 'view3d', doc: writeJson(dir, swaying ? 'forest-on' : 'forest-off', forestDoc(swaying)), look: PLAIN, size: [...HD], fps: 30, frames: SWAY_FRAMES, capture: [], timings: true });
        const onFirst = k % 2 === 0;
        const replies = runGpu(bin('deep-gpu'), dir, onFirst ? [side(true), side(false)] : [side(false), side(true)]);
        const [on, off] = onFirst ? [replies[0]!, replies[1]!] : [replies[1]!, replies[0]!];
        const median = (r: JsonObject, what: string): number => {
          const ms = framesOf(r, SWAY_FRAMES, what).map((f, i) => num(f['gpu_ms'], `${what}: frame ${i}: gpu_ms`)).sort((a, b) => a - b);
          return ms[Math.floor(ms.length / 2)]!;
        };
        if (k === 0) {
          const hashes = (r: JsonObject): string[] => framesOf(r, SWAY_FRAMES, `the forest`).map((f) => String(f['pixel_hash']));
          const [h1, h0] = [hashes(on), hashes(off)];
          expect(h1.some((h, i) => h !== h0[i]), `${FOREST_TREES} swaying trees draw other pixels than still ones, so the measure sees the sway`).toBe(true);
        }
        return Math.max(0, median(on, 'sway on') - median(off, 'sway off'));
      };
      swayRun(0);
      const sway: number[] = [];
      const swayLoads: { start: number; end: number }[] = [];
      for (let k = 1; k <= RUNS; k++) { const start = load(); sway.push(swayRun(k)); swayLoads.push({ start, end: load() }); }

      const open: string[] = [];
      const judge = async (what: string, limit: number, values: number[], at: { start: number; end: number }[]): Promise<void> => {
        const v = await judgeLimit(limit, values, at);
        console.log(`${ID} ${what}: ${values.map((x) => x.toFixed(3)).join(', ')} against ${limit} → ${String(v['status'])}`);
        expect(v['status'], `${what} against ${limit}: ${JSON.stringify(v)}`).not.toBe('FAIL');
        if (v['status'] !== 'PASS') open.push(`${what}: ${JSON.stringify(v)}`);
      };
      await judge('bevel with weighted normals on a 10,000-face prop (ms)', TASK.targets.bevel_ms, runs.map((r) => r.bevel), loads);
      await judge('two levels of subdivision of a 1,000-face mesh (ms)', TASK.targets.subdivide_ms, runs.map((r) => r.subdivide), loads);
      await judge('distributing 100,000 points with pruning (ms)', TASK.targets.distribute_ms, runs.map((r) => r.distribute), loads);
      await judge('an arc-length table for 1,000 spans (ms)', TASK.targets.arc_length_ms, runs.map((r) => r.arcLength), loads);
      await judge(`sway on ${FOREST_TREES} instanced trees at 1080p (GPU ms a frame)`, TASK.targets.sway_gpu_ms, sway, swayLoads);
      if (open.length) inconclusive(open.join('; '));
    } finally {
      rmSync(relDir, { recursive: true, force: true });
    }
  }, 4 * TIMEOUT);
});
