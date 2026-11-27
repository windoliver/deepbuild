// AC4 #2039.2e193c48: 500 such rows from one atlas draw in one instanced draw for their atlas, and a set with `slice`
// on `place: cell` is refused, naming the set. Budgets, on the reference Mac in the local preflight, compared with the
// merge base: the 500 rows add under 0.2 ms a frame (drafted, a target to be measured)
// (this file carries the third clause, the budget; a timed file: README: The budget)
//
// "Compared with the merge base" is the perf lane's, as #2386's suite reads it: benchmarks/budgets.json holds a task for
// this issue, `canvas-atlas-slice`, run as `node benchmarks/canvas.mjs atlas-slice`, holding the issue's 0.2 ms as a
// target at the lane's 50% margin, its criteria naming this criterion and its reason naming #2039; the file passes the
// lane's own validator against the merge base's budgets.json; and scripts/lanes.mjs times this file. That test runs
// anywhere.
//
// The timing: a release `deep-show`, one process a run, `frames` of two documents that differ by the issue's fields
// alone: the 500 rows of ac4-one-draw.test.ts with `slice` 8 on each side and their `w` and `h`, and the same rows
// with none of the three, one quad of the whole cell a row, which is how the merge base draws them. Each set slides
// 15 u a second along x by a keyed channel on its `at.pos`, so each of the 300 frames at 60 fps places every row
// again. A side's reading is the median `frame_ms` (#387: the frame's evaluation, the rows built, no pixel drawn) of
// frames 1 to 299; a run's is the nine-part side less the other, the side that goes first alternating. Five runs
// after a warm-up one, each with the one-minute load read at its start and its end, judged by the lane's `judgeLimit`
// (scripts/benchmark.mjs, in a child process): PASS when all five are within 0.2 ms, FAIL when all five are over it by
// more than the margin, else INCONCLUSIVE; off a reference Mac, off mains, in Low Power Mode, not thermally nominal,
// or with the load above the core count, INCONCLUSIVE, never a pass and never a fail. The machine is read before
// anything is timed, so an unfit machine builds and times nothing. The warm-up shows the measure sees what it times:
// on each side every frame runs operators and frames 0, 1 and 2 draw three different pictures, and the two sides draw
// different pixels, which they don't where `slice` is not read.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rowsDoc } from './fixtures.ts';
import {
  AC, DOC, REPO, TIMEOUT, atlasPng, framesCall, framesOf, inconclusive, judge, lane, loadNow, median, num, presented, putEvidence, releaseBin, runShow, scenario,
  showCall, timingProblem, useTemp, type JsonObject, type Load,
} from './helpers.ts';

const ID = AC[4];
const CRITERION = '#2039.2e193c48';
const FILE = 'tests/acceptance/2039/ac4-budget.test.ts';
const temp = useTemp();
/** The task the perf lane and the budget window run (README: The budget). */
const TASK = { id: 'canvas-atlas-slice', command: ['node', 'benchmarks/canvas.mjs', 'atlas-slice'], targets: { slice_rows_frame_ms: 0.2 } };
const FRAMES = 300;
type Side = 'slice' | 'plain';
const D: Record<Side, string> = { slice: DOC(1), plain: DOC(2) };

/** One process: both documents presented and their frames drawn, the side named first going first. Each side's replies. */
function frames(bin: string, count: number, pixels: boolean, first: Side, what: string): Record<Side, JsonObject[]> {
  const ev = temp();
  const atlas = putEvidence(ev, atlasPng());
  const docs: Record<Side, JsonObject> = { slice: rowsDoc(atlas, { sliding: true }), plain: rowsDoc(atlas, { plain: true, sliding: true }) };
  const order: Side[] = first === 'slice' ? ['slice', 'plain'] : ['plain', 'slice'];
  const calls = order.flatMap((side) => [showCall(D[side], docs[side]), framesCall(D[side], count, pixels)]);
  const r = runShow(bin, scenario(ev, [D.slice, D.plain], calls, [0, 0, 1394, 884]), what);
  const out: Partial<Record<Side, JsonObject[]>> = {};
  order.forEach((side, i) => {
    presented(r[2 * i]!, `${what}: the 500 rows ${side === 'slice' ? 'with slice' : 'without slice'}`);
    out[side] = framesOf(r[2 * i + 1]!, count, `${what}: the ${side} side`);
  });
  return out as Record<Side, JsonObject[]>;
}

describe(`${ID} the budget of 500 nine-part rows`, () => {
  it(`${ID} budgets.json holds the task canvas-atlas-slice with the issue's 0.2 ms, compared with the merge base at the lane's margin, it passes the lane's validator, and lanes.mjs times this file`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const entry = current.tasks.find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's number`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(CRITERION);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #2039`).toMatch(/#2039\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    expect(lane('b.validateBudgets(input.current, input.base); return "valid";', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }), 'the lane\'s validator accepts budgets.json against the merge base\'s').toBe('valid');
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);
  }, TIMEOUT);

  it(`${ID} the 500 rows add under 0.2 ms a frame over the same rows drawn as the merge base draws them, in five runs`, () => {
    const problem = timingProblem();
    if (problem) inconclusive(`the rows' frame time counts only on a reference Mac at rest: ${problem}`);
    const bin = releaseBin('deep-show');

    // The warm-up, untimed: both sides build their rows again each frame, and they differ by what the issue adds.
    {
      const shown = frames(bin, 3, true, 'slice', 'AC4 the warm-up');
      const hash = (side: Side, k: number): string => String(shown[side][k]!['pixel_hash']);
      for (const side of ['slice', 'plain'] as const) {
        expect(shown[side].map((f, k) => num(f['ran'], `the ${side} side: frame ${k}'s ran`) > 0), `the ${side} side: every frame runs operators, so the rows are placed again each frame`).toEqual([true, true, true]);
        expect(new Set([0, 1, 2].map((k) => hash(side, k))).size, `the ${side} side: frames 0, 1 and 2 draw three different pictures as the set slides`).toBe(3);
      }
      expect(hash('slice', 0), 'the two sides draw different pixels, so the measure sees what it times').not.toBe(hash('plain', 0));
    }

    const ms = (list: JsonObject[], what: string): number => median(list.slice(1).map((f, k) => num(f['frame_ms'], `${what}: frame ${k + 1}'s frame_ms`)));
    const once = (k: number): { added: number; load: Load } => {
      const start = loadNow();
      const sides = frames(bin, FRAMES, false, k % 2 === 0 ? 'slice' : 'plain', `AC4 timing run ${k}`);
      const end = loadNow();
      return { added: Math.max(0, ms(sides.slice, 'with slice') - ms(sides.plain, 'without slice')), load: { start, end } };
    };
    once(0);
    const runs = [1, 2, 3, 4, 5].map(once);
    judge(`${ID} 500 nine-part rows, added frame time over the same rows without slice (ms a frame)`, TASK.targets.slice_rows_frame_ms, runs.map((r) => r.added), runs.map((r) => r.load));
  }, 4 * TIMEOUT);
});
