// AC6 #1992.9d39bde2: Linear fog costs what exp does: the castle fixture with `fog_curve: linear` holds its p50 frame
// time within 2% of the same fixture with exp, on the reference Mac in the local preflight, against the merge base.
//
// The two documents: the castle as committed, whose sky's curve is `exp` at 0.002 per m (checked here), and a copy
// whose sky takes `fog_curve: linear {near: 0, far: 693}` in its place: the linear curve with the exp one's halfway
// distance, ln 2 ÷ 0.002 = 346.6 m (README: Readings), so both mix about as much fog into the castle.
//   - The record, "in the local preflight, against the merge base" (docs/parallel-proof.md §12a, the reading rule;
//     README: Outside this folder): `benchmarks/budgets.json` holds the task `canvas-fog-linear`, running
//     `node benchmarks/canvas.mjs fog-linear` with the target `linear_over_exp: 1.02`, the lane's 50% margin and this
//     criterion's ID, which the lane's validator accepts against the merge base's file; `scripts/lanes.mjs` runs this
//     file as a timed one.
//   - The surface, on any Mac: the linear castle is drawn, not refused, and its first frame differs from the exp
//     castle's (the curve is read), with `timings` giving every frame its `gpu_ms`.
//   - The timing, only where the lane can judge one (a reference Mac at rest, else INCONCLUSIVE before anything is
//     timed): each document's orbit, 300 frames at 30 fps at the castle's own size with `timings`, its p50 `gpu_ms`
//     the run's frame time; one warm-up pair, then five pairs, exp and linear in turn, each a fresh process. The five
//     linear p50s are judged by the lane's `judgeLimit` against 1.02 × the median of the five exp p50s: FAIL fails,
//     anything but PASS is INCONCLUSIVE.
// Wrong programs: the base (no task, no linear curve); a linear curve that costs a pass, a texture fetch or a branch
// per light more than exp; a castle that draws no fog under linear, which the surface check catches.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, REPO, arr, castleOf, castleSky, clone, differing, frameAt, framesOf, idOf, inconclusive, isObject, judgeLimit, load, obj, readPng,
  requireMetal, runGpu, shown, timingProblem, useBin, useDir, validateBudgets, view3dCall, writeJson, type JsonObject,
} from './helpers.ts';

const bin = useBin();
const dir = useDir();
const ID = idOf(6);
/** The task the perf lane and the budget window run (README: Outside this folder). */
const TASK = { id: 'canvas-fog-linear', command: ['node', 'benchmarks/canvas.mjs', 'fog-linear'], targets: { linear_over_exp: 1.02 } };
const FILE = 'tests/acceptance/1992/cost.test.ts';
const FRAMES = 300;
const LINEAR_FAR = 693;

/** The castle with exp fog (as committed) and with the linear curve of the same halfway distance. */
function twins(): { look: JsonObject; size: [number, number]; packs: string[]; exp: JsonObject; linear: JsonObject } {
  const c = castleOf(REPO);
  const sky = castleSky(c.doc);
  expect([sky.params['fog_curve'], sky.params['fog_density']], 'the castle fixture\'s sky fogs by exp at 0.002 per m').toEqual(['exp', 0.002]);
  expect(Math.log(2) / 0.002, 'the linear twin\'s halfway distance, (0 + 693) ÷ 2 m, is the exp curve\'s').toBeCloseTo(LINEAR_FAR / 2, 0);
  const linear = clone(c.doc);
  obj(obj(obj(linear['items'], 'items')[sky.id], 'the sky')['params'], 'the sky\'s params')['fog_curve'] = { linear: { near: 0, far: LINEAR_FAR } };
  return { look: c.look, size: c.size, packs: c.packs, exp: c.doc, linear };
}
const p50 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

describe(`${AC[6]} linear fog costs what exp does`, () => {
  it(`${AC[6]} the castle with fog_curve linear holds its p50 frame time within 2% of the castle with exp, recorded against the merge base and judged on the reference Mac`, async () => {
    // The record.
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's number`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(ID);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #1992`).toMatch(/#1992\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    await expect(validateBudgets(current, JSON.parse(base.stdout) as JsonObject), 'the lane\'s validator accepts budgets.json against the merge base\'s').resolves.toBeUndefined();
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);

    // The surface: the linear castle is drawn, its curve read, its frames timed.
    requireMetal();
    const t = twins();
    const out = dir();
    const docs = { exp: writeJson(out, 'castle-exp', t.exp), linear: writeJson(out, 'castle-linear', t.linear) };
    const first = runGpu(bin(), out, (['exp', 'linear'] as const).map((k) => view3dCall({ doc: docs[k], look: t.look, size: t.size, frames: 1, fps: CASTLE_FPS, capture: [0], targets: ['final'], packs: t.packs, timings: true })));
    const shots = first.map((r, i) => { const f = frameAt(framesOf(r, `the ${i ? 'linear' : 'exp'} castle`), 0, 'the castle'); expect(f.gpu_ms, 'a timed frame carries its gpu_ms').not.toBeNull(); return readPng(out, f.final, 'the castle\'s first frame'); });
    expect(differing(shots[0]!, shots[1]!).length, 'the linear castle\'s first frame differs from the exp castle\'s: the curve is read').toBeGreaterThan(0);

    // The timing, only where the lane can judge it.
    const problem = await timingProblem();
    if (problem) inconclusive(`the frame times are judged only on a reference Mac at rest: ${problem}`);
    const timed = (k: 'exp' | 'linear'): number => {
      const [reply] = runGpu(bin(), out, [view3dCall({ doc: docs[k], look: t.look, size: t.size, frames: FRAMES, fps: CASTLE_FPS, packs: t.packs, timings: true })]);
      const fs = framesOf(reply!, `the ${k} castle, timed`);
      expect(fs.length, `the ${k} castle draws ${FRAMES} frames`).toBe(FRAMES);
      expect(fs.filter((f) => f.gpu_ms === null).length, `every frame of the ${k} castle carries its gpu_ms`).toBe(0);
      return p50(fs.map((f) => f.gpu_ms!));
    };
    timed('exp'); timed('linear'); // the warm-up pair, discarded
    const exp: number[] = []; const linear: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < 5; k++) { exp.push(timed('exp')); const start = load(); linear.push(timed('linear')); loads.push({ start, end: load() }); }
    const limit = TASK.targets.linear_over_exp * p50(exp);
    const v = await judgeLimit(limit, linear, loads);
    console.log(`${ID} p50 gpu_ms: exp ${exp.map((x) => x.toFixed(3)).join(', ')}; linear ${linear.map((x) => x.toFixed(3)).join(', ')}; against 1.02 × ${p50(exp).toFixed(3)} → ${String(v['status'])}`);
    expect(v['status'], `the linear castle's p50 frame time against 1.02 × the exp castle's ${p50(exp).toFixed(3)} ms: ${shown(v)}`).not.toBe('FAIL');
    if (v['status'] !== 'PASS') inconclusive(`the linear castle against the exp castle: ${shown(v)}`);
  }, 4 * 3_600_000);
});
