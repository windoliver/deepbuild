// AC2: the step-down lands only on the costly writer's layer, in the window it draws in, and that writer is told why
// at every rung; the other window's writers keep their rung.
//
// The layout of app-budget.test.ts (README: The surface under test): bravo (0.5 ms) and charlie (0.4 ms) in the main
// window on display A, alpha in the popped-out window on display B at 1.4 ms a frame for frames 1–75, then 0.6 ms.
// The app's frames come to 2.3 ms against a work product's 2 ms for 75 frames, so alpha's layer steps to effects off
// at frame 30 and to LOD down at frame 60 (the count restarts after each change; frames 61–75 are only 15), then holds
// with the view still. The wrong programs are `--planted steps_main_window` and `tells_first_step_only`.
import { describe, expect, it } from 'vitest';
import {
  WIN, WORK_PRODUCT_GPU_MS, appBudgetProblems, ladderProblems, layoutCall, liveOf, liveRun, rungProblems, toldProblems, useBuild, useOut,
  type Charge, type Expected, type Live, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const FRAMES = 150;
const ALPHA: Charge[] = [{ from: 1, to: 75, gpu_ms: 1.4 }, { from: 76, gpu_ms: 0.6 }];

const initial: Expected = { frame: 1, from: null, to: 'base', reason: 'initial' };
const EXPECTED: Record<string, Expected[]> = {
  's-alpha': [
    initial,
    { frame: 30, from: 'base', to: 'effects_off', reason: 'frame_health' },
    { frame: 60, from: 'effects_off', to: 'lod_down', reason: 'frame_health' },
  ],
  's-bravo': [initial],
  's-charlie': [initial],
};

const layout = (planted?: Planted): Live => liveOf(liveRun(bin(), out(), layoutCall(out(), FRAMES, ALPHA), planted), `the live call${planted ? ` (planted ${planted})` : ''}`);
const problemsOf = (live: Live): string[] => [
  ...ladderProblems(live, EXPECTED),
  ...rungProblems(live, 's-alpha'),
  ...toldProblems(live),
  ...appBudgetProblems(live, WORK_PRODUCT_GPU_MS),
];

describe('AC2 the app budget steps down only the costly writer, in the window it draws in', () => {
  it('AC2 alpha in the popped-out window on B steps to effects off at 30 and LOD down at 60 and is told why at each rung; bravo and charlie in the main window on A keep base; a ladder that steps the main window\'s writer, or tells only the first step, fails', () => {
    const live = layout();
    expect(live.frames.length, `${FRAMES} frames`).toBe(FRAMES);
    expect(problemsOf(live), 'the costly writer\'s layer alone steps, in its window, told why at every rung').toEqual([]);
    const lod = live.changes.find((c) => c.session === 's-alpha' && c.to === 'lod_down')!;
    expect(live.frames.filter((f) => f.frame >= lod.effective).every((f) => f.views.some((v) => v.session === 's-alpha' && v.window === WIN.pop && v.rung === 'lod_down')), 'alpha draws at LOD down in the popped-out window from the step on').toBe(true);
    expect(live.told.filter((t) => t.session === 's-alpha' && t.scope === 'app').map((t) => [t.frame, t.rung]), 'alpha is told of the app budget at each step').toEqual([[30, 'effects_off'], [60, 'lod_down']]);

    const main = problemsOf(layout('steps_main_window'));
    expect(main.length, 'steps_main_window fails').toBeGreaterThan(0);
    expect(main.join('\n'), 'its failure names a main-window writer moved off its rung').toMatch(/^frame \d+: s-(bravo|charlie) .*(effects_off|lod_down)/m);

    const first = problemsOf(layout('tells_first_step_only'));
    expect(first.length, 'tells_first_step_only fails').toBeGreaterThan(0);
    expect(first.join('\n'), 'its failure names frame 60 and LOD down').toMatch(/^frame 60: agent:alpha \(s-alpha\) wasn't told why it moved to lod_down/m);
  }, 1_800_000);
});
