// AC5 #903.b48e3025: "The input track's hash and every evaluated control value are identical with `pointer.show` true
// and false."
//
// Through `deep-input input`: the track's `hash` and `track`, #308's `read` (the value a driver reads of a control at a
// time) and the `tour_pointer` op (README: The surface under test). The fixture is the tour board, once with
// `tour.pointer: {show: true}` and once with `{show: false}`, each played through the same ops in one process: the tour
// to 6.5 s, your click on the slider's thumb there, (1480, 540), the tour's return after its default `resume_after`,
// and on to 20 s; then each of the three controls read at 17 times.
//
// asserts:
//   - the pointer is what differs: with `show: true` it draws at 2 s; with `show: false` no pointer pixel draws at any
//     of the five readings;
//   - both runs' track hashes are equal, their tracks are equal entry for entry, and all 51 control readings are equal;
//   - the runs did something to compare: the tour wrote fire's entry at 2 s and gain's at 4 s, your click wrote gain's at
//     6.5 s, and gain reads its default 0.5 at 1 s and 1 at 7 s.
// Wrong programs: the base (no pointer to hide); a pointer whose `show` stops the tour, or that writes an entry of its
// own, or that takes your click when it is shown.
import { describe, expect, it } from 'vitest';
import { AC, Ops, TIMEOUT, canon, drawn, fl, none, peek, prebuild, runInput, show, thumb, tourBoard, trackText, wrote } from './helpers.ts';

prebuild('deep-input');
const CONTROLS = ['fire', 'gain', 'lamp'] as const;
const READ_AT = [1, 2, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 9, 11, 13, 15, 17, 19, 20];

describe(`${AC[5]} showing the pointer changes no entry, value or hash`, () => {
  it(`${AC[5]} the input track's hash and every evaluated control value are identical with pointer.show true and false`, () => {
    const ops = new Ops();
    const pointers = [ops.pointerAt(fl(2)), ops.pointerAt(fl(5))];
    ops.down(thumb(1), fl(6.5));
    ops.up(thumb(1), fl(6.55));
    pointers.push(ops.pointerAt(fl(6.6)), ops.pointerAt(fl(8)), ops.pointerAt(fl(13)));
    ops.advance(fl(20));
    const reads = CONTROLS.flatMap((control) => READ_AT.map((s) => ({ control, s, i: ops.read(control, fl(s)) })));
    const [shown, hidden] = runInput([
      { doc: tourBoard('pointer-shown', { pointer: { show: true } }), ops: ops.list },
      { doc: tourBoard('pointer-hidden', { pointer: { show: false } }), ops: ops.list },
    ], 'the tour board with pointer.show true and false');

    const at2 = peek(shown!.results[pointers[0]!]);
    expect(at2 !== null && at2.opacity > 0, `with pointer.show true the pointer draws at 2 s: ${show(shown!.results[pointers[0]!], 300)}`).toBe(true);
    none(pointers.map((i, k) => drawn(hidden!.results[i], `with pointer.show false, reading ${k + 1} of 5`)).filter((f): f is string => f !== null), 'with pointer.show false no pointer draws');

    expect([wrote(shown!, 'tour', 'fire', fl(2)), wrote(shown!, 'tour', 'gain', fl(4)), wrote(shown!, 'you', 'gain', fl(6.5))], `the run holds the tour's entries and your click; the track: ${trackText(shown!)}`).toEqual([true, true, true]);
    const value = (control: string, s: number) => shown!.results[reads.find((r) => r.control === control && r.s === s)!.i]!['value'];
    expect([value('gain', 1), value('gain', 7)], 'gain reads its default 0.5 before any entry and 1 after the tour moved it there').toEqual([0.5, 1]);

    expect(hidden!.hash, "the input track's hash is the same with the pointer shown and hidden").toBe(shown!.hash);
    expect(canon(hidden!.raw['track']), `the track is the same entry for entry; shown: ${trackText(shown!)}; hidden: ${trackText(hidden!)}`).toBe(canon(shown!.raw['track']));
    const differ = reads.filter((r) => canon(shown!.results[r.i]) !== canon(hidden!.results[r.i]))
      .map((r) => `${r.control} at ${r.s} s reads ${show(shown!.results[r.i], 200)} with the pointer shown and ${show(hidden!.results[r.i], 200)} with it hidden`);
    none(differ, 'every evaluated control value with the pointer shown and hidden');
  }, TIMEOUT);
});
