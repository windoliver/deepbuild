// AC7 #903.f0bb108a: "Under reduced motion the tour writes no entry and no pointer draws."
//
// Through `deep-input input` with the session's `reduced_motion` (#308's field, the viewer's preference) and the
// `tour_pointer` op (README: The surface under test). The fixture is the tour board, played to 10 s with the pointer
// read at 21 times, every half second: once under reduced motion and once without, in one process.
//
// asserts:
//   - without reduced motion, the run this one is held against: the tour writes fire's entry at 2 s, gain's at 4 s and
//     lamp's at 8 s, and the pointer draws at 2 s;
//   - under reduced motion the track holds no entry, and at each of the 21 times no pointer pixel draws.
// Wrong programs: the base (no pointer reading at all); a pointer that draws from the tour's keys though the tour
// doesn't run; one that only hides while it would glide.
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, Ops, TIMEOUT, drawn, fl, none, peek, prebuild, runInput, show, tourBoard, trackText, wrote } from './helpers.ts';

prebuild('deep-input');

describe(`${AC[7]} reduced motion`, () => {
  it(`${AC[7]} under reduced motion the tour writes no entry and no pointer draws`, () => {
    const ops = new Ops();
    const readings = Array.from({ length: 21 }, (_, i) => ({ s: i / 2, i: i === 0 ? ops.pointer() : ops.pointerAt(i * (FLICKS / 2)) }));
    const doc = tourBoard('reduced-motion');
    const [moving, reduced] = runInput([{ doc, ops: ops.list }, { doc, ops: ops.list, reduced_motion: true }], 'the tour board with and without reduced motion');

    expect([wrote(moving!, 'tour', 'fire', fl(2)), wrote(moving!, 'tour', 'gain', fl(4)), wrote(moving!, 'tour', 'lamp', fl(8))], `without reduced motion the tour writes the press's entry at 2 s, the slider's at 4 s and the toggle's at 8 s; the track: ${trackText(moving!)}`).toEqual([true, true, true]);
    const at2 = moving!.results[readings.find((r) => r.s === 2)!.i];
    expect((peek(at2)?.opacity ?? 0) > 0, `without reduced motion the pointer draws at 2 s: ${show(at2, 300)}`).toBe(true);

    expect(reduced!.track.length, `under reduced motion the tour writes no entry; the track: ${trackText(reduced!)}`).toBe(0);
    none(readings.map((r) => drawn(reduced!.results[r.i], `under reduced motion at ${r.s} s`)).filter((f): f is string => f !== null), 'under reduced motion no pointer draws');
  }, TIMEOUT);
});
