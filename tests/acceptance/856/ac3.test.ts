import { describe, expect, it } from 'vitest';
import {
  CHANGE_AT, DOC, FIGURE_AFTER, FIGURE_BEFORE, FIGURE_CPU_MS, arr, changeFailures, changeFrames, figure, frames, judge, obj,
  presented, scenario, show, showRun, str, useEvidence, useRelease, worstFrame,
} from './helpers.ts';

useRelease('deep-show');
const evidence = useEvidence();

const BEFORE = figure(FIGURE_BEFORE);
const AFTER = figure(FIGURE_AFTER);

/** The new revision shaped on the UI thread: a clean `eval` with pixels, in a fresh process, renders it with every node run on the calling thread. */
function reference(): string {
  const replies = showRun(scenario(evidence(), [show(DOC.a, AFTER), { call: 'eval', doc: DOC.a, clean: true, pixels: true }]));
  presented(replies[0]!, 'the changed figure, shown on its own');
  const eval_ = replies[1]!;
  expect(eval_['outcome'], `the clean eval evaluated: ${JSON.stringify(eval_).slice(0, 800)}`).toBe('evaluated');
  const snaps = arr(eval_['snapshots'], 'the clean eval: snapshots');
  expect(snaps.length, 'the clean eval carries one snapshot').toBe(1);
  return str(obj(snaps[0], 'the clean eval: snapshot')['sha256'], 'the clean eval: snapshot sha256');
}

/** The figure shown, then 180 paced frames with the text changed at frame 60's latch, in one fresh process. */
function changed(pixels: boolean, planted?: string): ReturnType<typeof frames> {
  const replies = showRun(scenario(evidence(), [show(DOC.a, BEFORE), changeFrames(AFTER, pixels)]), planted);
  presented(replies[0]!, 'the figure with its 10,000-glyph text');
  return frames(replies[1]!, pixels, 'the frames around the change');
}

describe('AC3 a 10,000-glyph text changed in a figure shapes on the worker: the UI thread stays under its 4 ms frame CPU and the frame is settling until the new run draws', () => {
  it('AC3 the frames after the change draw the last shaped run, marked settling, until the new run draws, and the settled frame equals the new text shaped on the UI thread by pixel hash', () => {
    const ref = reference();
    expect(changeFailures(changed(true), ref), 'the frames from the change on').toEqual([]);
  }, 1_800_000);

  it('AC3 the UI thread stays under the figure\'s 4 ms frame CPU in every frame from the change on, while the text shapes on the worker (five runs after a warm-up)', () => {
    const worst = (): number => {
      const list = changed(false);
      const settled = list.slice(CHANGE_AT).some((f) => !f.settling);
      expect(settled, 'the new run drew within the 120 frames after the change').toBe(true);
      const w = worstFrame(list);
      console.log(`worst UI frame from the change on: frame ${w.frame}, ${w.ui_ms.toFixed(3)} ms`);
      return w.ui_ms;
    };
    worst();
    judge('the UI thread\'s CPU in its worst frame from the change on, ms', Array.from({ length: 5 }, worst), FIGURE_CPU_MS);
  }, 1_800_000);

  it('AC3 the planted program that shapes the changed text on the UI thread fails, naming the frame that drew it unsettled', () => {
    const ref = reference();
    const failures = changeFailures(changed(true, 'shapes_on_ui_thread'), ref);
    expect(failures.length, 'the planted program fails the frames\' check').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the change\'s frame, drawn without settling').toMatch(new RegExp(`frame ${CHANGE_AT}, at whose latch the 10,000-glyph text changed, is not settling`));
  }, 1_800_000);
});
