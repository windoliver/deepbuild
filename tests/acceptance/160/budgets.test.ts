// AC9: "Budgets, on the reference Mac in the local preflight, compared with the merge base: building 8 ops on a
// 1,000-segment path takes under 1 ms on change, a still path costs nothing per frame, and a 64-copy repeater stays
// within the figure budget at 1080p"
//
// Through `path` with `timing: true`: each frame's `build_ms` is the binary's own wall time for building the item's
// ops output and tessellation in that frame (0 when it reused them). A play is one line of 70 frames at 60 fps,
// judged on frames 10–69; each budget runs in five fresh processes after a warm-up and is judged by the design's rule
// for timing results (PASS when every run is within the budget, FAIL when every run is over it by more than the
// margin, else INCONCLUSIVE). The figure budget is the cost model's figure class, 4 ms of frame CPU, and its check:
// the 1080p document names `budget: {class: "figure"}` and the check must raise no `over_budget`. Off a reference Mac
// (Mac15,7 or Mac15,12), with Low Power Mode on or unknown, or with a thermal warning, each test reads its surface
// once (so a missing surface still fails) and then skips with a message starting INCONCLUSIVE; it never passes by
// skipping. "Compared with the merge base": the merge base refuses none of these documents but builds no ops, so it
// has no timing to compare; these tests judge the issue's absolute budgets (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, environmentProblem, errorsOf, check, figure, judge, keyed, median, pathFrames, pathItem,
  useRenderBinary, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const problem = environmentProblem();
const TIMES = Array.from({ length: 70 }, (_, k) => Math.round((k * FLICKS) / 60));

/** A 1,000-segment polyline under 8 ops; with `animated`, the first twist's angle moves every frame. */
function eightOps(animated: boolean): JsonObject {
  const pts = Array.from({ length: 1001 }, (_, i) => `${(40 + (i % 50) * 8).toFixed(1)} ${(40 + Math.floor(i / 50) * 8 + (i % 2) * 3).toFixed(1)}`);
  const ops = [
    { trim: { start: 0.02, end: 0.98 } }, { twist: { angle: 10, center: [240, 120] } }, { pucker: { amount: 0.1 } },
    { round_corners: { radius: 1 } }, { twist: { angle: -5, center: [240, 120] } }, { pucker: { amount: -0.05 } },
    { trim: { start: 0, end: 0.99 } }, { twist: { angle: 3, center: [240, 120] } },
  ];
  return figure('budgets-eight-ops', [480, 240], [pathItem('wire', 'a0', `M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')}`, { ops, paint: { stroke: { role: 'ink', width: 1 } } })],
    animated ? { transport: { span: '2s' }, channels: { 'wire-twist': keyed('items/wire/params/ops/1/angle', [[0, 0], [2, 40]]) } } : {});
}

/** A 1080p figure: a petal repeated 64 times, its repeater turning every frame. */
const burst64 = figure('budgets-burst', [1920, 1080], [
  pathItem('petal', 'a0', 'M 0 0 C 20 -40 20 -200 0 -400 C -20 -200 -20 -40 0 0 Z', {
    ops: [{ repeater: { copies: 64, at: { rot: 5.625 }, opacity: [1, 0.3] } }], paint: { fill: { role: 'petal' } },
  }, { at: { pos: [960, 540, 0] } }),
], { budget: { class: 'figure' }, transport: { span: '2s' }, channels: { 'petal-turn': keyed('items/petal/params/ops/0/at/rot', [[0, 5.625], [2, 6.5]]) } });

/** The median `build_ms` of frames 10–69 of one timed play, in a fresh process. */
function playMs(doc: JsonObject, id: string, from = 10): number {
  const frames = pathFrames({ doc, item: id, times: TIMES, timing: true }, `the timed play of ${id}`);
  const ms = frames.map((f, i) => { expect(typeof f.buildMs, `frame ${i} reports build_ms`).toBe('number'); return f.buildMs!; });
  return median(ms.slice(from));
}

describe('AC9 budgets on the reference Mac', () => {
  it('AC9 building 8 ops on a 1,000-segment path takes under 1 ms on change (median of frames 10–69 at 60 fps, five fresh processes after a warm-up)', (ctx) => {
    const doc = eightOps(true);
    const warm = playMs(doc, 'wire');
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, ${warm.toFixed(3)} ms): ${problem}`);
    judge(ctx, 'AC9: 8 ops on a 1,000-segment path, per changed frame (ms)', Array.from({ length: 5 }, () => playMs(doc, 'wire')), 1);
  }, TIMEOUT);

  it('AC9 a still path costs nothing per frame (no build after the first frame, five fresh processes)', (ctx) => {
    const doc = eightOps(false);
    const still = (): number => {
      const frames = pathFrames({ doc, item: 'wire', times: TIMES, timing: true }, 'the still path');
      expect(frames.slice(1).some((f) => f.rebuilt), 'a still path rebuilds nothing after its first frame').toBe(false);
      return frames.slice(1).reduce((s, f) => s + (f.buildMs ?? NaN), 0);
    };
    const warm = still();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, ${warm.toFixed(3)} ms over 69 still frames): ${problem}`);
    const runs = Array.from({ length: 5 }, still);
    expect(runs, 'the still frames spend no build time').toEqual([0, 0, 0, 0, 0]);
  }, TIMEOUT);

  it('AC9 a 64-copy repeater stays within the figure budget at 1080p (the check\'s figure class, and 4 ms of frame CPU to build it per changed frame)', (ctx) => {
    const errors = errorsOf(check(burst64));
    expect(errors.map((e) => e.code), 'the 1080p figure with a 64-copy repeater passes its figure budget check').toEqual([]);
    const warm = playMs(burst64, 'petal');
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, ${warm.toFixed(3)} ms): ${problem}`);
    judge(ctx, 'AC9: a 64-copy repeater at 1080p, per changed frame (ms)', Array.from({ length: 5 }, () => playMs(burst64, 'petal')), 4);
  }, TIMEOUT);
});
