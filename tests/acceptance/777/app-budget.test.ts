// AC1: with windows on two displays, the GPU time of their frames counts against one app budget: two windows each
// under the limit but together over it step the ladder down, and a meter that budgets each window alone fails,
// naming both windows.
//
// #379's `live` call on the stub meter, wgpu's noop backend and the virtual clock (`test-meter` build), everywhere.
// The main window is on display A, a popped-out window on display B (README: The surface under test). bravo (0.5 ms)
// and charlie (0.4 ms) draw in the main window, 0.9 ms a frame; alpha draws in the popped-out window, 1.4 ms a frame
// for frames 1–45, then 0.6 ms. Each window stays under a work product's 2 ms; together they come to 2.3 ms, then
// 1.5 ms. The wrong program is `--planted budgets_each_window`.
import { describe, expect, it } from 'vitest';
import {
  BRAVO_MS, CHARLIE_MS, RING, WIN, WORK_PRODUCT_GPU_MS, appBudgetProblems, ladderProblems, layoutCall, liveOf, liveRun, perWindow, useBuild, useOut,
  type Charge, type Expected, type Live, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const FRAMES = RING; // the app ring then holds every frame of the run
const OVER: Charge[] = [{ from: 1, to: 45, gpu_ms: 1.4 }, { from: 46, gpu_ms: 0.6 }];
const UNDER: Charge[] = [{ from: 1, gpu_ms: 1.0 }]; // 0.9 + 1.0 = 1.9 ms: under the app limit

const initial: Expected = { frame: 1, from: null, to: 'base', reason: 'initial' };
const STEPPED: Record<string, Expected[]> = {
  's-alpha': [initial, { frame: 30, from: 'base', to: 'effects_off', reason: 'frame_health' }],
  's-bravo': [initial],
  's-charlie': [initial],
};
const HELD: Record<string, Expected[]> = { 's-alpha': [initial], 's-bravo': [initial], 's-charlie': [initial] };

const layout = (alpha: Charge[], planted?: Planted): Live => liveOf(liveRun(bin(), out(), layoutCall(out(), FRAMES, alpha), planted), `the live call${planted ? ` (planted ${planted})` : ''}`);

/** The scenario as the binary charged it: each window under the limit every frame, and the stub's charges. */
function layoutProblems(live: Live, alphaMs: (frame: number) => number): string[] {
  const outp: string[] = [];
  if (live.frames.length !== FRAMES) outp.push(`${live.frames.length} frames, not ${FRAMES}`);
  for (const f of live.frames) {
    const w = perWindow(f);
    const want = new Map([[WIN.main, BRAVO_MS + CHARLIE_MS], [WIN.pop, alphaMs(f.frame)]]);
    for (const [win, x] of want) {
      if (Math.abs((w.get(win) ?? NaN) - x) > 1e-6) outp.push(`frame ${f.frame}: window ${win}'s frame was charged ${w.get(win)} ms, not the stub's ${x} ms`);
      if (x > WORK_PRODUCT_GPU_MS) outp.push(`frame ${f.frame}: window ${win} is over the limit alone`);
    }
  }
  return outp;
}

describe('AC1 windows on two displays count against one app budget', () => {
  it('AC1 two windows each under the 2 ms limit but together over it step the costly writer down at frame 30, the app ring holds their frames summed, and together under it nothing steps; a meter that budgets each window alone fails, naming both windows', () => {
    const over = layout(OVER);
    expect(layoutProblems(over, (k) => (k <= 45 ? 1.4 : 0.6)), 'each window under the limit, charged as the stub says').toEqual([]);
    expect(appBudgetProblems(over, WORK_PRODUCT_GPU_MS), 'one app budget across both windows').toEqual([]);
    expect(ladderProblems(over, STEPPED), 'alpha steps to effects off at frame 30 for frame health; bravo and charlie keep base').toEqual([]);
    expect(over.app.measured.slice(0, 45).every((x) => x > WORK_PRODUCT_GPU_MS) && over.app.measured.slice(45).every((x) => x <= WORK_PRODUCT_GPU_MS), 'the ring shows frames 1–45 over the app limit and the rest under it').toBe(true);

    const under = layout(UNDER);
    expect(layoutProblems(under, () => 1.0), 'together under the limit: charged as the stub says').toEqual([]);
    expect(appBudgetProblems(under, WORK_PRODUCT_GPU_MS), 'the app ring, together under the limit').toEqual([]);
    expect(ladderProblems(under, HELD), 'together under the limit, nothing steps').toEqual([]);

    const planted = layout(OVER, 'budgets_each_window');
    const problems = [...appBudgetProblems(planted, WORK_PRODUCT_GPU_MS), ...ladderProblems(planted, STEPPED)];
    expect(problems.length, 'budgets_each_window fails the app budget').toBeGreaterThan(0);
    expect(problems.join('\n'), 'its failure names both windows').toMatch(new RegExp(`^.*(${WIN.main}.*${WIN.pop}|${WIN.pop}.*${WIN.main}).*$`, 'm'));
  }, 1_800_000);
});
