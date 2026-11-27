// #3617.ff2c540d: with the one-pass fixture at 1936 × 1584 on the zero-copy path, the draw-and-finish time is under
// 0.5 ms at p95, over five runs of at least 300 frames on a reference Mac. The fixture and the binary's frames are
// read on any machine. The bench `node benchmarks/canvas.mjs draw-finish` takes the five runs of a release build, and
// the lane's judge reads them: PASS on a reference Mac at rest, FAIL when every run is over, INCONCLUSIVE elsewhere.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DRAW_P95_MS, REPO, SCENES, TARGET_NAME, TASK, arr, expectReported, framesCall, framesReply, isObject, judgeReport, loadScene, machineProblem, num, obj,
  partsProblems, run, scenario, slotHash, useBuild, useOut, type JsonObject, type JsonValue,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = CRITERIA.onePass;
const SCENE = loadScene(SCENES.onePass);

describe(`${ID} the one-pass fixture at 1936 × 1584 on the zero-copy path costs under 0.5 ms at p95`, () => {
  it(`${ID} the fixture is one full-screen pass, and the binary draws it at 1936 × 1584 zero copy for 300 frames, each with its draw-and-finish time and parts, and the slot holds the scene's bytes`, () => {
    // The fixture is one full-screen pass and nothing else: one region over the whole frame, no layers, no pipelines.
    expect(SCENE.size).toEqual([1936, 1584]);
    expect(SCENE.frames).toBeGreaterThanOrEqual(300);
    expect(SCENE.regions?.length, 'one region, which test.scene@1 draws as its single `regions` pass').toBe(1);
    expect(SCENE.regions![0]!.rect).toEqual([0, 0, null, null]);
    expect(SCENE.layers ?? [], 'no layer pass beside it').toEqual([]);
    expect(SCENE.pipelines ?? [], 'no scene pipeline beside it').toEqual([]);
    const [reply] = run(bin(), scenario(out(), [framesCall({ scene: SCENES.onePass, count: SCENE.frames, path: 'zero_copy', timings: true })]));
    const { frames } = framesReply(reply!, 'the one-pass run');
    expect(frames.length, 'a run presents every frame of the fixture').toBe(SCENE.frames);
    expect(frames.every((f) => f.size[0] === 1936 && f.size[1] === 1584 && f.path === 'zero_copy'), 'every frame is 1936 × 1584 on the zero-copy path').toBe(true);
    expectReported(frames, 'the one-pass run');
    expect(partsProblems(frames, 'the one-pass run')).toEqual([]);
    const want = slotHash(SCENE, 0);
    expect(frames.filter((f) => f.pixel_hash !== want).map((f) => f.frame), 'frames whose slot isn\'t the scene\'s bytes').toEqual([]);
  }, 1_800_000);

  it(`${ID} benchmarks/budgets.json holds the task ${TASK} with the issue's 0.5 ms, it passes the lane's validator, and lanes-lists.mjs times this file`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const entry = current.tasks.find((t) => t['id'] === TASK);
    expect(entry, `benchmarks/budgets.json has the task ${TASK}`).toBeDefined();
    expect(entry!['command'], 'the task runs the draw-finish bench').toEqual(['node', 'benchmarks/canvas.mjs', 'draw-finish']);
    expect(entry!['targets'], 'the task holds the issue\'s number').toEqual({ [TARGET_NAME]: DRAW_P95_MS });
    expect(entry!['margin'], 'the task compares with the merge base at the lane\'s margin').toBe(0.5);
    expect(entry!['criteria'], 'the task names the criteria it measures').toEqual(expect.arrayContaining([CRITERIA.onePass, CRITERIA.inconclusive]));
    expect(String(entry!['initialReason']), 'the task says why, naming #3617').toMatch(/#3617\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's budgets.json: ${base.stderr}`).toBe(0);
    const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};const i = JSON.parse(process.argv[1]);b.validateBudgets(i.current, i.base);process.stdout.write('valid');`;
    const v = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ current, base: JSON.parse(base.stdout) })], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    expect(v.stdout, `the lane's validator accepts budgets.json against the merge base's: ${v.stderr.slice(-1500)}`).toBe('valid');
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, 'scripts/lanes.mjs runs ac2-onepass.test.ts as a timed file').toContain('tests/acceptance/3617/ac2-onepass.test.ts');
  }, 600_000);

  it(`${ID} five runs of the bench, after a warm-up one, are judged by the lane: PASS under 0.5 ms at p95 on a reference Mac at rest, INCONCLUSIVE anywhere else`, (ctx) => {
    const problem = machineProblem();
    const bench = spawnSync(process.execPath, ['benchmarks/canvas.mjs', 'draw-finish'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 3_000_000 });
    expect(bench.status, `node benchmarks/canvas.mjs draw-finish ran: ${(bench.stderr ?? '').slice(-2000)}`).toBe(0);
    const current = obj(JSON.parse(bench.stdout.trim().split('\n').at(-1)!) as JsonValue, 'the bench\'s report');
    expect(current['task']).toBe(TASK);
    expect(isObject(current['fingerprint']), 'the report names its machine and build').toBe(true);
    const runs = arr(current['runs'], 'the report\'s runs').map((r, i) => obj(r, `runs[${i}]`));
    expect(runs.length, 'five runs after the warm-up one').toBe(5);
    for (const [i, r] of runs.entries()) {
      expect(num(r[TARGET_NAME], `runs[${i}].${TARGET_NAME}`)).toBeGreaterThan(0);
      expect(Object.keys(obj(r['parts_mean_ms'], `runs[${i}].parts_mean_ms`)).sort(), `runs[${i}].parts_mean_ms names the four parts`).toEqual(['encode', 'gpu', 'submit', 'wait']);
      num(r['loadStart'], `runs[${i}].loadStart`); num(r['loadEnd'], `runs[${i}].loadEnd`);
    }
    const verdict = judgeReport(current);
    const line = `${ID} draw-finish p95 (ms): ${runs.map((r) => num(r[TARGET_NAME], 'p95').toFixed(3)).join(', ')} against ${DRAW_P95_MS}: ${String(verdict['status'])} ${String(verdict['reason'] ?? '')}`;
    console.log(line);
    if (problem) expect(verdict['status'], `off a reference Mac at rest (${problem}) the reading is never a pass: ${line}`).toBe('INCONCLUSIVE');
    expect(verdict['status'], `FAIL ${line}`).not.toBe('FAIL');
    if (verdict['status'] !== 'PASS') ctx.skip(`INCONCLUSIVE ${line}`);
  }, 3_600_000);
});
