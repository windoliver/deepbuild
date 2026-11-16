// AC4 #903.da7f464f: "A click that lands where the pointer is drawn reaches the control under it. Your first gesture
// fades the pointer over 0.2 s, and no pointer pixel draws while you drag. After `resume_after` of quiet it reappears at
// its last position and glides to the next key."
//
// Through `deep-input input`: #308's pointer events and track, and the `tour_pointer` op (README: The surface under
// test). The fixture is the tour board with `resume_after: 2` and its toggle key moved to 14 s, so a key is still to
// come when the tour resumes, whichever way a resumed tour keeps its clock (README: Readings). The tour's slider key
// leaves the pointer at rest on the slider's thumb at value 1, (1480, 540), from 6 s. One run:
//   6.4 s   the pointer is read: where it is drawn;
//   6.5 s   your first gesture, a click exactly there (pressed at 6.5 s, released at 6.55 s);
//   7 s     your drag of the slider's thumb, 400 px left, released at 8 s;
//   10 s    2 s of quiet after the drag: the tour resumes.
//
// asserts:
//   - at 6.4 s the pointer draws in full with its tip within 1 px of the thumb, and the click at its tip writes one
//     entry of yours on `gain`, the control under it, stamped 6.5 s;
//   - 0.1 s and 0.15 s after the click began the pointer still draws, less than in full and never more than before;
//     0.3 s after, no pointer pixel draws;
//   - at 7.3 s and 7.6 s, inside the drag, and at 9 s and 9.9 s, in the quiet, no pointer pixel draws;
//   - at 10.1 s the pointer draws again with its tip within 1 px of where it was at 6.4 s (the thumb has since moved);
//   - the tour writes again after 10 s; for the first entry it writes then, the run is played again with two more
//     readings: half a glide (0.25 s) before that entry the tip is under way, more than 1 px from both ends and nearer
//     the entry's control than it started; at the entry's time it is within 1 px of that control's anchor;
//   - on the planted `tour_pointer_takes_hits` the click at the pointer's tip writes no entry on `gain`, and the check
//     fails naming the control.
// Wrong programs: the base (no pointer); a pointer that is a hit target; one that vanishes at once, or stays while you
// drag; one that comes back before the quiet is over, or on the control's new place, or jumps to the next key.
import { describe, expect, it } from 'vitest';
import {
  AC, Ops, TIMEOUT, anchorOf, at, dist, drawn, failsNaming, fl, none, offBy, peek, prebuild, readingOf, runInput, secs, show, thumb, tourBoard, trackText, tryInput, wrote,
  type InputPlanted, type InputRun, type Pt,
} from './helpers.ts';

prebuild('deep-input');
const D = tourBoard('yield-and-resume', { keys: { fire: [[2, 1, 'hold']], gain: [[4, 0, 'linear'], [6, 1, 'hold']], lamp: [[14, true, 'hold']] }, resume_after: 2 });
const CLICK = fl(6.5);
/** The drag ends at 8 s; `resume_after` is 2 s. */
const RESUME = fl(10);
const HALF_GLIDE = fl(0.25);

interface Marks { before: number; fading: [number, number]; gone: number; dragging: number[]; quiet: number[]; back: number; under_way: number; arrived: number }
/** The run: the click at `tip`, the drag, the quiet and the resume; with `next`, two readings around the tour's next entry at that flick. */
function session(tip: Pt, next?: number): { ops: Ops; m: Marks } {
  const ops = new Ops();
  const before = ops.pointerAt(fl(6.4));
  ops.down(tip, CLICK);
  ops.up(tip, fl(6.55));
  const fading: [number, number] = [ops.pointerAt(fl(6.6)), ops.pointerAt(fl(6.65))];
  const gone = ops.pointerAt(fl(6.8));
  ops.down(thumb(1), fl(7));
  ops.move([1280, 540], fl(7.3));
  const d1 = ops.pointer();
  ops.move([1080, 540], fl(7.6));
  const d2 = ops.pointer();
  ops.up([1080, 540], fl(8));
  const quiet = [ops.pointerAt(fl(9)), ops.pointerAt(fl(9.9))];
  const back = ops.pointerAt(fl(10.1));
  const under_way = next === undefined ? -1 : ops.pointerAt(next - HALF_GLIDE);
  const arrived = next === undefined ? -1 : ops.pointerAt(next);
  ops.advance(fl(20));
  return { ops, m: { before, fading, gone, dragging: [d1, d2], quiet, back, under_way, arrived } };
}
/** Where the pointer is drawn at 6.4 s, read in a run of its own; null when none draws. */
function drawnAt(planted?: InputPlanted): Pt | null {
  const ops = new Ops();
  const i = ops.pointerAt(fl(6.4));
  const line = { doc: D, ops: ops.list, ...(planted ? { planted } : {}) };
  const [run] = planted ? tryInput([line]) : runInput([line], 'the tour board played to 6.4 s');
  const p = run ? peek(run.results[i]) : null;
  return p && p.opacity > 0 ? p.tip : null;
}
/** The click at the pointer's tip reaches the control under it, the slider: one entry of yours on `gain`, stamped at the press. */
function clickFailures(run: InputRun | null, tip: Pt): string[] {
  if (!run) return ['the session gave no answer'];
  return wrote(run, 'you', 'gain', CLICK) ? [] : [`the click at the pointer's tip ${at(tip)} at 6.5 s never reached gain, the control under it: the track holds no entry of yours on gain stamped 6.5 s; the track: ${trackText(run)}`];
}

describe(`${AC[4]} the pointer takes no hit, yields to you and comes back`, () => {
  it(`${AC[4]} a click that lands where the pointer is drawn reaches the control under it`, () => {
    const tip = drawnAt();
    expect(tip, 'at 6.4 s the tour pointer draws, so a click can land on it').not.toBeNull();
    const { ops, m } = session(tip!);
    const [run] = runInput([{ doc: D, ops: ops.list }], 'the click, the drag and the resume');
    const off = offBy(run!.results[m.before], thumb(1), 'at 6.4 s, the slider at rest at 1', "the slider's thumb");
    none(off === null ? [] : [off], 'the pointer is drawn on the control the click is meant for');
    none(clickFailures(run!, tip!), 'the click at the pointer');
  }, TIMEOUT);

  it(`${AC[4]} your first gesture fades the pointer over 0.2 s, no pointer pixel draws while you drag, and after resume_after of quiet it reappears at its last position and glides to the next key`, () => {
    const tip = drawnAt();
    expect(tip, 'at 6.4 s the tour pointer draws').not.toBeNull();
    const first = session(tip!);
    const [probe] = runInput([{ doc: D, ops: first.ops.list }], 'the click, the drag and the resume');
    const next = probe!.track.find((e) => e.writer === 'tour' && e.t > RESUME);
    expect(next, `the tour resumes: it writes an entry after 10 s, 2 s after your drag ends at 8 s; the track: ${trackText(probe!)}`).toBeDefined();
    expect(next!.t - 2 * HALF_GLIDE, `the tour's next key, on ${next!.control} at ${secs(next!.t)} s, leaves the 0.5 s of its glide after the tour resumes at 10 s`).toBeGreaterThanOrEqual(RESUME);
    const { ops, m } = session(tip!, next!.t);
    const [run] = runInput([{ doc: D, ops: ops.list }], 'the click, the drag and the resume, read around the next key');
    expect(run!.track.find((e) => e.writer === 'tour' && e.t > RESUME), 'the same run writes the same next entry').toEqual(next);
    const r = (i: number, what: string) => readingOf(run!.results[i], what);

    // The fade.
    const full = r(m.before, 'at 6.4 s');
    const [f1, f2] = [r(m.fading[0], 'at 6.6 s'), r(m.fading[1], 'at 6.65 s')];
    expect(full.opacity, 'before your gesture the pointer draws in full (opacity 1)').toBe(1);
    expect(f1.opacity > 0 && f1.opacity < 1, `0.1 s after your first gesture began the pointer is fading: its opacity is between 0 and 1, got ${f1.opacity}`).toBe(true);
    expect(f2.opacity > 0 && f2.opacity <= f1.opacity, `0.15 s after it began the pointer is still fading, no more opaque than at 0.1 s (${f1.opacity}); got ${f2.opacity}`).toBe(true);
    const failures: (string | null)[] = [
      drawn(run!.results[m.gone], 'at 6.8 s, 0.3 s after your first gesture began'),
      drawn(run!.results[m.dragging[0]!], 'at 7.3 s, while you drag'),
      drawn(run!.results[m.dragging[1]!], 'at 7.6 s, while you drag'),
      drawn(run!.results[m.quiet[0]!], 'at 9 s, 1 s into the quiet'),
      drawn(run!.results[m.quiet[1]!], 'at 9.9 s, before resume_after has passed'),
      // The return, at its last position.
      offBy(run!.results[m.back], full.tip!, 'at 10.1 s, after 2 s of quiet', 'its last position'),
    ];
    none(failures.filter((f): f is string => f !== null), 'the fade, the drag, the quiet and the return');

    // The glide to the tour's next key.
    const anchor = anchorOf(next!.control, next!.value);
    const way = r(m.under_way, `0.25 s before the next key on ${next!.control}`);
    expect(way.opacity > 0 && way.tip !== null, `half a glide before the next key, on ${next!.control} at ${secs(next!.t)} s, the pointer draws: ${show(way)}`).toBe(true);
    const [from, to, whole] = [dist(way.tip!, full.tip!), dist(way.tip!, anchor), dist(full.tip!, anchor)];
    expect(from > 1 && to > 1 && to < whole, `half a glide before the next key the pointer is under way from ${at(full.tip!)} to ${next!.control}'s anchor ${at(anchor)}: at ${at(way.tip!)} it is ${+from.toFixed(2)} px from its start and ${+to.toFixed(2)} px from the anchor, of ${+whole.toFixed(2)} px`).toBe(true);
    const off = offBy(run!.results[m.arrived], anchor, `the next key, on ${next!.control} at ${secs(next!.t)} s`, `${next!.control}'s anchor`);
    none(off === null ? [] : [off], 'the pointer glides to the next key');
  }, TIMEOUT);

  it(`${AC[4]} a planted pointer that takes hits fails, naming the control the click never reached`, () => {
    const planted: InputPlanted = 'tour_pointer_takes_hits';
    const tip = drawnAt(planted);
    const failures = tip === null
      ? ['the planted program draws no pointer at 6.4 s, so no click can land on it']
      : clickFailures(tryInput([{ doc: D, ops: session(tip).ops.list, planted }])[0] ?? null, tip);
    failsNaming(failures, [/never reached gain, the control under it/], 'the planted pointer that takes hits (tour_pointer_takes_hits)');
  }, TIMEOUT);
});
