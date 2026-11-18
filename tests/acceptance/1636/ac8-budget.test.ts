// AC8 #1636.2d5eb798: "Budget, on the reference Mac in the local preflight against the merge base: a 4-level tree of
// about 20,000 triangles builds in under 20 ms, and 10,000 instances of 8 seeded variants draw in one instanced draw per
// (variant, material)"
//
// The first test, the draws, by a counter, not a timing: the forest (an `instance@1` of 10,000 elements, 100 × 100 at
// 4 m, of eight `tree@1` prototypes, the fixture's params at seeds 1 to 8, element k of variant k mod 8, so 1,250 each;
// each tree's tubes in `bark` and its cards in `leaf`) drawn by `view3d` for one frame with `counts: true` under a
// straight-down orthographic camera that sees every element. Its `draws` (README: Assumed surfaces 8) hold, in the color
// pass, exactly one draw per (variant, material) of the forest: 16 draws, each of 1,250 instances, and none other of it.
// The second test, the build time:
//   - recorded for the perf lane and the budget window, "against the merge base" (README: Readings): budgets.json holds
//     the task `canvas-tree` with this criterion's ID and the issue's numbers, which the lane's validator accepts against
//     the merge base's file; scripts/lanes.mjs runs this file as a timed one;
//   - the surface answers on the debug build: `geometry` with `timings` gives the budget tree's `build_ms`, and the
//     budget tree (4 levels, 4 children a fork, 12 sides, 10 rings) has 17,000 to 23,000 triangles ("about 20,000");
//   - then, only where the lane can judge a timing (a reference Mac at rest, else INCONCLUSIVE before anything is timed):
//     deep-show built for release, one warm-up process and five, each reading `build_ms`, judged against 20 ms by the
//     lane's `judgeLimit`: FAIL fails, anything but PASS is INCONCLUSIVE.
// Wrong programs: the base (no tree@1, no counter, no task); a draw per instance, per part or per level of a variant; a
// material per part that splits the tubes; a build past 20 ms.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BUDGET_TREE, FIXTURE, PLAIN, REPO, TIMEOUT, arr, brief, buildInto, docId, framesOf, geometry, inconclusive, int, isObject, judgeLimit, load,
  num, obj, presented, requireMetal, rowOf, runGpu, runShow, scenario, sessionDoc, show, str, timingProblem, treeItem, treesDoc, useBins, useFolders,
  validateBudgets, writeJson, type JsonObject,
} from './helpers.ts';

const ID = AC[8];
const NAME = `AC8 ${ID}`;
const bin = useBins(['deep-show', 'deep-gpu']);
const folder = useFolders();
const DOC = docId(9);
const VARIANTS = 8;
const ELEMENTS = 10_000;
const SIDE = 100;
/** The task the perf lane and the budget window run (README: Assumed surfaces 11). */
const TASK = { id: 'canvas-tree', command: ['node', 'benchmarks/canvas.mjs', 'tree'], targets: { tree_build_ms: 20, forest_draws_per_variant_material: 1 } };
const FILE = 'tests/acceptance/1636/ac8-budget.test.ts';
const variant = (k: number): string => `variant-${k}`;

function forestDoc(): JsonObject {
  const pos = Array.from({ length: ELEMENTS }, (_, k) => [4 * (k % SIDE), 0, 4 * Math.floor(k / SIDE)]);
  const protos = Object.fromEntries(Array.from({ length: VARIANTS }, (_, k) => [variant(k + 1), treeItem({ ...FIXTURE, seed: k + 1 }, { visible: false })]));
  return sessionDoc('forest-1636', [512, 512], {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [198, 120, 198], target: [198, 0, 198], view_width: 440, near: 1, far: 300 } },
    ...protos,
    forest: {
      kind: 'instance@1',
      params: { of: Array.from({ length: VARIANTS }, (_, k) => variant(k + 1)), ids: pos.map((_, k) => k), proto: pos.map((_, k) => k % VARIANTS), pos, yaw: pos.map((_, k) => (k * 137.5) % 360), scale: pos.map(() => 1) },
    },
  });
}

describe(`${NAME} the tree's budgets`, () => {
  it(`${NAME} 10,000 instances of 8 seeded variants draw in one instanced draw per (variant, material)`, () => {
    requireMetal();
    const out = folder();
    const [reply] = runGpu(bin('deep-gpu'), out, [{ call: 'view3d', doc: writeJson(out, 'forest', forestDoc()), look: PLAIN, size: [512, 512], fps: 30, frames: 1, counts: true }]);
    const frame = framesOf(reply!, 1, 'the forest')[0]!;
    const draws = arr(frame['draws'], 'the frame\'s draws (README: Assumed surfaces 8)').map((d, k) => {
      const o = obj(d, `draws[${k}]`);
      return { pass: str(o['pass'], `draws[${k}].pass`), of: str(o['of'], `draws[${k}].of`), mesh: str(o['mesh'], `draws[${k}].mesh`), material: str(o['material'], `draws[${k}].material`), instances: int(o['instances'], `draws[${k}].instances`) };
    });
    const forest = draws.filter((d) => d.pass === 'color' && d.of === 'forest');
    const groups = new Map<string, number[]>();
    for (const d of forest) groups.set(`${d.mesh} in ${d.material}`, [...(groups.get(`${d.mesh} in ${d.material}`) ?? []), d.instances]);
    console.log(`${ID} the forest's color-pass draws: ${[...groups.entries()].map(([k, v]) => `${k}: ${v.join('+')}`).join('; ')}`);
    const want = Array.from({ length: VARIANTS }, (_, k) => [`${variant(k + 1)} in bark`, `${variant(k + 1)} in leaf`]).flat().sort();
    expect([...groups.keys()].sort(), 'the forest draws each variant in each of its two materials, and nothing else').toEqual(want);
    expect([...groups.entries()].filter(([, v]) => v.length !== 1).map(([k, v]) => `${k}: ${v.length} draws`), 'one instanced draw per (variant, material)').toEqual([]);
    expect([...groups.entries()].filter(([, v]) => v[0] !== ELEMENTS / VARIANTS).map(([k, v]) => `${k}: ${v[0]} instances`), `each draw holds its variant's ${ELEMENTS / VARIANTS} instances`).toEqual([]);
  }, 2 * TIMEOUT);

  it(`${NAME} a 4-level tree of about 20,000 triangles builds in under 20 ms on the reference Mac, against the merge base`, async () => {
    // The record.
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's numbers`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(ID);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #1636`).toMatch(/#1636\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    await expect(validateBudgets(current, JSON.parse(base.stdout) as JsonObject), 'the lane\'s validator accepts budgets.json against the merge base\'s').resolves.toBeUndefined();
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);

    // The surface on the debug build, and the tree the clause names.
    const timed = (binary: string): { ms: number; triangles: number } => {
      const [shown, read] = runShow(binary, scenario(folder(), [DOC], [show(DOC, treesDoc({ tree: treeItem(BUDGET_TREE) })), geometry(DOC, ['tree'], { timings: true })]));
      presented(shown!, 'the budget tree');
      const row = rowOf(read!, 'tree', 'the budget tree with timings');
      return { ms: num(row['build_ms'], 'the budget tree: build_ms (README: Assumed surfaces 5)'), triangles: arr(row['indices'], 'the budget tree: indices').length / 3 };
    };
    const first = timed(bin('deep-show'));
    console.log(`${ID} the budget tree: ${first.triangles} triangles, ${first.ms.toFixed(3)} ms on the debug build`);
    expect(first.triangles, 'a 4-level tree of about 20,000 triangles: at least 17,000').toBeGreaterThanOrEqual(17_000);
    expect(first.triangles, 'a 4-level tree of about 20,000 triangles: at most 23,000').toBeLessThanOrEqual(23_000);

    // The timing, only where the lane can judge it.
    const problem = await timingProblem();
    if (problem) inconclusive(`the build time is judged only on a reference Mac at rest: ${problem}`);
    const relDir = mkdtempSync(join(tmpdir(), 'deep-1636-release-'));
    try {
      const built = buildInto('deep-show', true, relDir);
      expect(built.error, 'deep-show builds for release').toBe('');
      timed(built.path);
      const runs: number[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < 5; k++) { const start = load(); runs.push(timed(built.path).ms); loads.push({ start, end: load() }); }
      const v = await judgeLimit(TASK.targets.tree_build_ms, runs, loads);
      console.log(`${ID} the budget tree builds in ${runs.map((x) => x.toFixed(3)).join(', ')} ms against 20 → ${String(v['status'])}`);
      expect(v['status'], `the build against 20 ms: ${brief(v)}`).not.toBe('FAIL');
      if (v['status'] !== 'PASS') inconclusive(`the build against 20 ms: ${brief(v)}`);
    } finally {
      rmSync(relDir, { recursive: true, force: true });
    }
  }, 4 * TIMEOUT);
});
