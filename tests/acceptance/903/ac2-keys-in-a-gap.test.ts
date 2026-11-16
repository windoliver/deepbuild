// AC2 #903.406ccd5b: "Two keys 0.2 s apart with `glide` 0.5 s: the pointer is at each key's anchor at that key's time. A
// planted pointer that always starts `glide` before its key fails, naming the earlier key."
//
// Through `deep-input input` and its `tour_pointer` op (README: The surface under test). The fixture is the tour board
// with two keys only: the press `fire` at 2 s (anchor (420, 390)) and the toggle `lamp` at 2.2 s (anchor (1500, 790)),
// 1,152 px apart, and `tour.pointer: {glide: 0.5}`. The glide to the later key can't start before the earlier key's
// time (Tour: "starting at the later of the previous key's time and the key's time minus glide"), so it has 0.2 s.
//
// asserts:
//   - the tour writes fire's entry at 2 s and lamp's at 2.2 s; at 2 s the pointer's tip is within 1 px of fire's
//     anchor; at 2.2 s within 1 px of lamp's;
//   - on the planted `tour_pointer_glide_before_key`, whose glide to lamp starts at 1.7 s, the same check fails, and a
//     failure names the earlier key, the one on fire at 2 s.
// Wrong programs: the base (no pointer); a pointer that leaves for a key `glide` before it whatever came before; one
// that takes the whole `glide` from the earlier key's time and arrives late.
import { describe, expect, it } from 'vitest';
import { AC, BOARD, Ops, TIMEOUT, failsNaming, fl, none, offBy, prebuild, runInput, tourBoard, trackText, tryInput, wrote, type InputRun } from './helpers.ts';

prebuild('deep-input');
const D = tourBoard('keys-in-a-gap', { keys: { fire: [[2, 1, 'hold']], lamp: [[2.2, true, 'hold']] }, pointer: { glide: 0.5 } });
const ops = new Ops();
const EARLIER = ops.pointerAt(fl(2));
const LATER = ops.pointerAt(fl(2.2));

/** The pointer against each key's anchor at that key's time; each failure names its key. */
function keyFailures(run: InputRun | null): string[] {
  if (!run) return ['the session gave no answer'];
  return [
    offBy(run.results[EARLIER], BOARD.fire.anchor, 'the earlier key, on fire at 2 s', "fire's anchor"),
    offBy(run.results[LATER], BOARD.lamp.anchor, 'the later key, on lamp at 2.2 s', "lamp's anchor"),
  ].filter((f): f is string => f !== null);
}

describe(`${AC[2]} two keys closer than the glide`, () => {
  it(`${AC[2]} with two keys 0.2 s apart and glide 0.5 s, the pointer is at each key's anchor at that key's time`, () => {
    const [run] = runInput([{ doc: D, ops: ops.list }], 'two keys 0.2 s apart');
    expect([wrote(run!, 'tour', 'fire', fl(2)), wrote(run!, 'tour', 'lamp', fl(2.2))], `the tour writes the press's entry at 2 s and the toggle's at 2.2 s; the track: ${trackText(run!)}`).toEqual([true, true]);
    none(keyFailures(run!), 'the pointer at each of the two keys');
  }, TIMEOUT);

  it(`${AC[2]} a planted pointer that always starts glide before its key fails, naming the earlier key`, () => {
    const [run] = tryInput([{ doc: D, ops: ops.list, planted: 'tour_pointer_glide_before_key' }]);
    failsNaming(keyFailures(run ?? null), [/^the earlier key, on fire at 2 s: the pointer's tip is at /], 'the planted pointer that starts glide before its key (tour_pointer_glide_before_key)');
  }, TIMEOUT);
});
