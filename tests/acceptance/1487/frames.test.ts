// AC1, frames on the virtual display clock: a document with one looping rotation panned out of view presents
// 0 frames over 5 s; the merge base arms one per frame and fails. Judged on any machine (no real clock).
// The wrong programs: the base (its valid_until reads the document, not the view) and the planted
// `valid_until_ignores_view`, the same rule reachable through `planted`.
import { describe, expect, it } from 'vitest';
import {
  V_CARD, V_SPIN, VSYNC_60, evalFrames, fixture, presentedIn, run, sec, secondsOf, useBinaries, vsyncOf, type Vsync,
} from './helpers.ts';

useBinaries('deep-motion');

const DOC = fixture('spinner.json');
const PAN_OUT = sec(1);
const QUIET_END = PAN_OUT + sec(5);

/** Null when no frame is presented in (from, to], else a sentence naming how many were and the first ones. */
function quietFailure(vsyncs: readonly Vsync[], from: number, to: number): string | null {
  const shown = presentedIn(vsyncs, from, to);
  if (shown.length === 0) return null;
  return `${shown.length} frames presented in (${secondsOf(from)}, ${secondsOf(to)}] with the spinner out of view, `
    + `the first at vsyncs ${shown.slice(0, 3).map(vsyncOf).join(', ')}`;
}

describe('AC1 a document with one looping rotation panned out of view: 0 frames over 5 s on the virtual clock', () => {
  it('AC1 the spinner turns in view and arms every frame; panned out of view at 1 s, the pan presents one frame valid for ever and nothing is presented over the next 5 s', () => {
    const vsyncs = run({ doc: DOC, to: QUIET_END, mode: 'armed', view: V_SPIN, pans: [{ at: PAN_OUT, rect: V_CARD }] });
    // In view, the loop keeps the clock running: this is the document the issue describes, not a still one.
    expect(presentedIn(vsyncs, -1, PAN_OUT - VSYNC_60).length, 'while the spinner is in view every vsync before the pan presents').toBe(PAN_OUT / VSYNC_60);
    const pan = vsyncs[vsyncOf(PAN_OUT)]!;
    expect(pan.presented, 'the pan is input, so it arms a frame at 1 s').toBe(true);
    // The issue: the merge base arms one per frame here and fails.
    expect(quietFailure(vsyncs, PAN_OUT, QUIET_END), 'out of view the spinner stops the clock: 0 frames over 5 s').toBeNull();
    expect(pan.valid_until, 'the frame after the pan shows nothing that changes, so it is valid for ever (null)').toBeNull();
  });

  it('AC1 opened with the spinner already out of view, the board presents its first frame and nothing for 5 s, while a straight evaluation of the same document still reports the spinner\'s next change (canonical renders ignore the rule)', () => {
    const vsyncs = run({ doc: DOC, to: sec(5), mode: 'armed', view: V_CARD });
    expect(quietFailure(vsyncs, 0, sec(5)), 'nothing is presented after the first frame').toBeNull();
    expect(vsyncs[0]!.presented, 'the session\'s first frame is presented').toBe(true);
    expect(vsyncs[0]!.valid_until, 'the first frame is valid for ever').toBeNull();
    // eval has no view: it is the canonical evaluation, and the rule must not reach it.
    const [straight] = evalFrames(DOC, [sec(2.5)]);
    const vu = straight!['valid_until'];
    expect(typeof vu === 'number' && vu > sec(2.5) && vu <= sec(2.5) + VSYNC_60,
      `the canonical frame at 2.5 s is valid only until the spinner next changes, within one vsync; got ${String(vu)}`).toBe(true);
  });

  it('AC1 (wrong program) the planted valid_until_ignores_view, the merge base\'s rule, arms a frame at every vsync out of view and fails the same check, naming the frames', () => {
    const vsyncs = run({ doc: DOC, to: QUIET_END, mode: 'armed', view: V_SPIN, pans: [{ at: PAN_OUT, rect: V_CARD }], planted: 'valid_until_ignores_view' });
    const failure = quietFailure(vsyncs, PAN_OUT, QUIET_END);
    expect(failure, 'the check fails on the planted clock').not.toBeNull();
    expect(failure!, 'it arms one per frame: all 300 vsyncs of the 5 s').toMatch(/^300 frames presented/);
  });
});
