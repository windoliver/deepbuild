// AC2 #222.98d07f32 (Oracle lane): from-values taken when a cue begins. Ported from a fork's
// test_keys_are_applied_as_the_animation_begins_to_a_copy (test_transform.py, lines 90–106), which the Oracle page
// pins (README: Sources): a transform's target is made from the object as it is when the animation begins, so a
// shift of 2 right reads 1 right halfway and 2 right at the end. Ours: a square at the origin; cue `go` sets its
// position to (3, 0) over 0–1 s; cue `shift`, after it, sets it to (5, 0) over 1–2 s, 2 u right of where `go` left it,
// both on smoothstep. `shift` starts from what the square holds at 1 s, so it reads x = 3 at 1 s, 4 halfway (1.5 s)
// and 5 at 2 s, each within 1e-9.
//
// Not ported: test_a_moving_target_moves_from_when_the_transform_begins (test_motion.py, lines 169–180) moves its
// target with an updater, code run each frame, which a cue list can never run.
import { describe, it } from 'vitest';
import { AC, TIMEOUT, arr, cueList, docId, evalAt, film, fl, none, num, present, presented, run, square, useFolders, useShow, valuesOf } from './helpers.ts';

const show = useShow();
const folder = useFolders();

describe(`${AC[2]} a cue starts from what its targets hold when it begins, as the upstream projects' tests take it`, () => {
  it(`${AC[2]} test_keys_are_applied_as_the_animation_begins_to_a_copy: a cue after another moves from where the first left its target`, () => {
    const doc = film('Keys applied as the cue begins', [square('sq'), cueList([
      { id: 'go', targets: ['sq'], ease: 'smoothstep', set: { 'at/pos': [3, 0, 0] } },
      { id: 'shift', targets: ['sq'], ease: 'smoothstep', set: { 'at/pos': [5, 0, 0] } },
    ])], 3);
    const at = [1, 1.5, 2];
    const replies = run(show(), folder(), [present(docId(1), doc), ...at.map((s) => evalAt(docId(1), fl(s), ['items/sq/at/pos']))]);
    presented(replies[0]!, 'the two moves');
    const want = [3, 4, 5];
    const failures: string[] = [];
    at.forEach((s, k) => {
      const x = num(arr(valuesOf(replies[1 + k]!, `the square at ${s} s`)['items/sq/at/pos'], `the square at ${s} s`)[0], `x at ${s} s`);
      if (Math.abs(x - want[k]!) > 1e-9) failures.push(`at ${s} s the square is at x = ${x}, not ${want[k]} within 1e-9`);
    });
    none(failures, 'the second cue moves from where the first left the square');
  }, TIMEOUT);
});
