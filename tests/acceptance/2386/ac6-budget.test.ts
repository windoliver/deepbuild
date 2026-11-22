// AC6 #2386.b3f6fe16: 10,000 rows with `draw` from one atlas draw in one instanced draw for their atlas. Each fixture
// of #1653 and #536 keeps its pixel hash. Budgets, on the reference Mac in the local preflight, compared with the merge
// base: the 10,000 rows add under 0.1 ms a frame over the same set without `draw` (drafted, a target to be measured)
// (this file carries the third clause, the budget; a timed file: README: The budget)
//
// "Compared with the merge base" is the perf lane's, as #2760's suite reads it: benchmarks/budgets.json holds a task for
// this issue, `canvas-atlas-draw`, run as `node benchmarks/canvas.mjs atlas-draw`, holding the issue's 0.1 ms at the
// lane's 50% margin, its criteria naming this criterion and its reason naming #2386; the file passes the lane's own
// validator against the merge base's budgets.json; and scripts/lanes.mjs times this file. That test runs anywhere.
//
// The timing: a release `deep-show`, one process a run, `frames` of two documents that differ by the two fields alone:
// the 10,000 rows of ac6-one-draw.test.ts with `draw: [4, 8]` and `anchor: [0.5, 0.75]`, and the same set without them,
// each sliding 15 u a second along x by a keyed channel on its `at.pos`, so each of the 300 frames at 60 fps places
// every row again. A side's reading is the median `frame_ms` (#387: the frame's evaluation, the rows built, no pixel
// drawn) of frames 1 to 299; a run's is the side with `draw` less the side without, the side that goes first
// alternating. Five runs after a warm-up one, each with the one-minute load read at its start and its end, judged by
// the lane's `judgeLimit` (scripts/benchmark.mjs, in a child process): PASS when all five are within 0.1 ms, FAIL when
// all five are over it by more than the margin, else INCONCLUSIVE; off a reference Mac, off mains, in Low Power Mode,
// not thermally nominal, or with the load above the core count, INCONCLUSIVE, never a pass. The machine is read before
// anything is timed, so an unfit machine builds and times nothing. The warm-up shows the measure sees what it times:
// on each side every frame runs operators and frames 0, 1 and 2 draw three different pictures, and the two sides draw
// different pixels.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rowsDoc } from './fixtures.ts';
import {
  AC, DOC, REPO, TIMEOUT, framesCall, framesOf, inconclusive, judge, lane, loadNow, median, num, presented, putEvidence, releaseBin, runShow, scenario,
  showCall, solidAtlas, timingProblem, useTemp, type JsonObject, type Load,
} from './helpers.ts';

const ID = AC[6];
const CRITERION = '#2386.b3f6fe16';
const FILE = 'tests/acceptance/2386/ac6-budget.test.ts';
const temp = useTemp();
/** The task the perf lane and the budget window run (README: The budget). */
const TASK = { id: 'canvas-atlas-draw', command: ['node', 'benchmarks/canvas.mjs', 'atlas-draw'], targets: { draw_rows_frame_ms: 0.1 } };
const FRAMES = 300;
const D = { draw: DOC(1), plain: DOC(2) };

/** One process: both documents presented and their frames drawn, the side named first going first. Each side's replies. */
function frames(bin: string, count: number, pixels: boolean, first: 'draw' | 'plain', what: string): Record<'draw' | 'plain', JsonObject[]> {
  const ev = temp();
  const atlas = putEvidence(ev, solidAtlas([4, 8], [[64, 112, 72], [236, 196, 64]]));
  const docs = { draw: rowsDoc(atlas, { sliding: true }), plain: rowsDoc(atlas, { plain: true, sliding: true }) };
  const order: ('draw' | 'plain')[] = first === 'draw' ? ['draw', 'plain'] : ['plain', 'draw'];
  const calls = order.flatMap((side) => [showCall(D[side], docs[side]), framesCall(D[side], count, pixels)]);
  const r = runShow(bin, scenario(ev, [{ doc: D.draw, rect: [0, 0, 808, 816] }, { doc: D.plain, rect: [0, 0, 808, 816] }], calls), what);
  const out: Partial<Record<'draw' | 'plain', JsonObject[]>> = {};
  order.forEach((side, i) => {
    presented(r[2 * i]!, `${what}: the 10,000 rows ${side === 'draw' ? 'with draw' : 'without draw'}`);
    out[side] = framesOf(r[2 * i + 1]!, count, `${what}: the ${side} side`);
  });
  return out as Record<'draw' | 'plain', JsonObject[]>;
}

describe(`${ID} the budget of 10,000 rows with draw`, () => {
  it(`${ID} budgets.json holds the task canvas-atlas-draw with the issue's 0.1 ms, compared with the merge base at the lane's margin, it passes the lane's validator, and lanes.mjs times this file`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const entry = current.tasks.find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's number`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(CRITERION);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #2386`).toMatch(/#2386\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    expect(lane('b.validateBudgets(input.current, input.base); return "valid";', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }), 'the lane\'s validator accepts budgets.json against the merge base\'s').toBe('valid');
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);
  }, TIMEOUT);

  it(`${ID} the 10,000 rows add under 0.1 ms a frame over the same set without draw, in five runs`, () => {
    const problem = timingProblem();
    if (problem) inconclusive(`the rows' frame time counts only on a reference Mac at rest: ${problem}`);
    const bin = releaseBin('deep-show');

    // The warm-up, untimed: both sides build their rows again each frame, and they differ by what the issue adds.
    {
      const shown = frames(bin, 3, true, 'draw', 'AC6 the warm-up');
      const hash = (side: 'draw' | 'plain', k: number): string => String(shown[side][k]!['pixel_hash']);
      for (const side of ['draw', 'plain'] as const) {
        expect(shown[side].map((f, k) => num(f['ran'], `the ${side} side: frame ${k}'s ran`) > 0), `the ${side} side: every frame runs operators, so the rows are placed again each frame`).toEqual([true, true, true]);
        expect(new Set([0, 1, 2].map((k) => hash(side, k))).size, `the ${side} side: frames 0, 1 and 2 draw three different pictures as the set slides`).toBe(3);
      }
      expect(hash('draw', 0), 'the two sides draw different pixels, so the measure sees what it times').not.toBe(hash('plain', 0));
    }

    const ms = (list: JsonObject[], what: string): number => median(list.slice(1).map((f, k) => num(f['frame_ms'], `${what}: frame ${k + 1}'s frame_ms`)));
    const once = (k: number): { added: number; load: Load } => {
      const start = loadNow();
      const sides = frames(bin, FRAMES, false, k % 2 === 0 ? 'draw' : 'plain', `AC6 timing run ${k}`);
      const end = loadNow();
      return { added: Math.max(0, ms(sides.draw, 'with draw') - ms(sides.plain, 'without draw')), load: { start, end } };
    };
    once(0);
    const runs = [1, 2, 3, 4, 5].map(once);
    judge(`${ID} 10,000 rows with draw, added frame time over the same set without draw (ms a frame)`, TASK.targets.draw_rows_frame_ms, runs.map((r) => r.added), runs.map((r) => r.load));
  }, 4 * TIMEOUT);
});
