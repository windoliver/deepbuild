// AC1 #903.dd86ae00: "A tour with a press key at 2 s, a slider key from 0 to 1 over 4 s to 6 s and a toggle key at 8 s:
// at each key's time the pointer's tip is within 1 px of that control's anchor, and from 4 s to 6 s it stays within 1 px
// of the slider's thumb. Its positions at 120 sampled times are the same seeked and played. A planted pointer that moves
// by the frame clock fails, naming the first sample that differs."
//
// Through `deep-input input` (#308's sessions, where the tour lives) and its `tour_pointer` op (README: The surface
// under test). The fixture is the tour board (helpers.ts: tourBoard): the press `fire` hit through `fire-button`, whose
// centre is (420, 390); the slider `gain`, whose thumb's centre is (800 + 680 v, 540) at value v; the toggle `lamp` hit
// through `lamp-button`, centre (1500, 790); the tour's keys fire [2 s, 1], gain [4 s, 0, linear] to [6 s, 1], lamp
// [8 s, true]; the pointer at its defaults. The view is 1920 × 1080 px, 1 px a u.
//
// asserts:
//   - played at 60 fps: the tour writes fire's entry at 2 s, gain's at 4 s and lamp's at 8 s; at 2 s the tip is within
//     1 px of (420, 390); at 4 s within 1 px of the thumb at value 0, (800, 540), though the slider rested at its
//     default 0.5 until then; at 21 times from 4 s to 6 s, every 0.1 s, within 1 px of the thumb at (t − 4) ÷ 2; at 8 s
//     within 1 px of (1500, 790);
//   - at 120 seeded times in (0, 10 s), none on a frame of 30, 60 or 120 fps: the reading played to each time in turn at
//     30, 60 and 120 fps equals, number for number, the reading after the whole tour was played once and the playhead
//     then sought to the times in a shuffled order; the pointer draws at 20 or more different places among them;
//   - the same comparison on the planted `tour_pointer_frame_clock` fails, its failure naming the first sample that
//     differs by its index and time.
// Wrong programs: the base (no pointer); a pointer aimed at where a control was when its glide began; one that leaves
// the thumb while the value moves; one whose place depends on the frames played.
import { describe, expect, it } from 'vitest';
import {
  AC, BOARD, FLICKS, Ops, TIMEOUT, at, failsNaming, fl, gainAt, none, offBy, peek, prebuild, runInput, seeded, secs, show, shuffled, thumb, tourBoard, trackText, tryInput, wrote,
  type InputLine, type InputPlanted, type InputRun, type Pt,
} from './helpers.ts';

prebuild('deep-input');
const D = tourBoard('tour-board');
const FPS: Pt[] = [[30, 1], [60, 1], [120, 1]];

/** 120 seeded times in (0, 10 s), whole flicks, ascending. */
const SAMPLES: number[] = (() => {
  const rand = seeded(903);
  return Array.from({ length: 120 }, () => 1 + Math.floor(rand() * 10 * FLICKS)).sort((a, b) => a - b);
})();

/** The played sessions (one per frame rate, the times in turn) and the seeked one (the tour played once, then each time sought in a shuffled order). */
function sessions(planted?: InputPlanted): { lines: InputLine[]; played: number[]; seeked: number[] } {
  const play = new Ops();
  const played = SAMPLES.map((t) => play.pointerAt(t));
  const seek = new Ops();
  seek.advance(fl(10));
  const seeked = SAMPLES.map(() => -1);
  for (const k of shuffled(SAMPLES.map((_, i) => i), 903)) { seek.seek(SAMPLES[k]!); seeked[k] = seek.pointer(); }
  const extra = planted ? { planted } : {};
  return { lines: [...FPS.map((fps) => ({ doc: D, fps, ops: play.list, ...extra })), { doc: D, ops: seek.list, ...extra }], played, seeked };
}
/** Played against seeked, sample by sample; for each frame rate the failure names the first sample that differs. */
function seekPlayFailures(runs: (InputRun | null)[], s: { played: number[]; seeked: number[] }): string[] {
  const seeked = runs[FPS.length];
  if (!seeked) return ['the seeked session gave no answer'];
  const failures: string[] = [];
  FPS.forEach(([fps], i) => {
    const played = runs[i];
    if (!played) { failures.push(`the session played at ${fps} fps gave no answer`); return; }
    for (let k = 0; k < SAMPLES.length; k++) {
      const p = played.results[s.played[k]!]; const q = seeked.results[s.seeked[k]!];
      const a = peek(p); const b = peek(q);
      const where = `sample ${k} (t = ${secs(SAMPLES[k]!).toFixed(6)} s)`;
      if (!a || !b) { failures.push(`played at ${fps} fps, ${where} is no tour pointer reading: played ${show(p, 200)}, seeked ${show(q, 200)}`); return; }
      const sameTip = a.tip === null || b.tip === null ? a.tip === b.tip : a.tip[0] === b.tip[0] && a.tip[1] === b.tip[1];
      if (!sameTip || a.opacity !== b.opacity) { failures.push(`played at ${fps} fps, the first sample that differs is ${where}: played ${show(p, 200)}, seeked ${show(q, 200)}`); return; }
    }
  });
  return failures;
}

describe(`${AC[1]} the pointer is on each control at its key, rides the slider's thumb, and is the same seeked and played`, () => {
  it(`${AC[1]} at the press key at 2 s, the slider key at 4 s and the toggle key at 8 s the pointer's tip is within 1 px of that control's anchor, and from 4 s to 6 s it stays within 1 px of the slider's thumb`, () => {
    const ops = new Ops();
    const press = ops.pointerAt(fl(2));
    const ride = Array.from({ length: 21 }, (_, i) => ({ s: 4 + i / 10, i: ops.pointerAt(fl(4) + i * (FLICKS / 10)) }));
    const toggle = ops.pointerAt(fl(8));
    const [run] = runInput([{ doc: D, ops: ops.list }], 'the tour board, played at 60 fps');
    expect([wrote(run!, 'tour', 'fire', fl(2)), wrote(run!, 'tour', 'gain', fl(4)), wrote(run!, 'tour', 'lamp', fl(8))], `the tour writes the press's entry at 2 s, the slider's at 4 s and the toggle's at 8 s; the track: ${trackText(run!)}`).toEqual([true, true, true]);
    const failures: (string | null)[] = [
      offBy(run!.results[press], BOARD.fire.anchor, 'the press key on fire at 2 s', "fire's anchor"),
      offBy(run!.results[ride[0]!.i], thumb(0), 'the slider key on gain at 4 s', "gain's anchor, its thumb at value 0,"),
      ...ride.map(({ s, i }) => offBy(run!.results[i], thumb(gainAt(s)), `at ${s} s, the slider's value moving`, `the slider's thumb at value ${+gainAt(s).toFixed(3)}`)),
      offBy(run!.results[toggle], BOARD.lamp.anchor, 'the toggle key on lamp at 8 s', "lamp's anchor"),
    ];
    none(failures.filter((f): f is string => f !== null), 'the pointer at each key and on the thumb');
  }, TIMEOUT);

  it(`${AC[1]} its positions at 120 sampled times are the same seeked and played`, () => {
    const s = sessions();
    const runs = runInput(s.lines, 'the tour board at 120 times, played at 30, 60 and 120 fps and seeked');
    none(seekPlayFailures(runs, s), 'played against seeked');
    const places = new Set(s.played.map((i) => peek(runs[1]!.results[i])).filter((p) => p !== null && p.opacity > 0 && p.tip !== null).map((p) => at(p!.tip!)));
    expect(places.size, `the comparison saw the pointer move: it draws at 20 or more different places among the 120 samples (it rides the thumb for 2 s); it drew at ${places.size}`).toBeGreaterThanOrEqual(20);
  }, TIMEOUT);

  it(`${AC[1]} a planted pointer that moves by the frame clock fails, naming the first sample that differs`, () => {
    const s = sessions('tour_pointer_frame_clock');
    failsNaming(seekPlayFailures(tryInput(s.lines), s), [/the first sample that differs is sample \d+ \(t = \d+\.\d+ s\)/], 'the planted pointer moved by the frame clock (tour_pointer_frame_clock)');
  }, TIMEOUT);
});
