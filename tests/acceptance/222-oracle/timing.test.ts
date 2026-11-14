// AC1 #222.88afab32 (Oracle lane): plays and waits laid end to end. Ported from the upstream projects' tests the
// Oracle page pins (README: Sources): an upstream animation library's scene-time test (test_scene.py, lines 53–62),
// its succession tests (test_composition.py, lines 20–92), and a fork's exact-duration layout test
// (test_timeline.py, TestLayout, lines 416–447). Each upstream assertion becomes a cue list whose markers
// `cues.<id>` (the #222 suite's expansion reading) must give the same start and end times, exactly, in flicks.
//
// - Scene time: a 2 s wait, then a 0.5 s play, reads 2.5 s; then a 5 s play, 7.5 s.
// - Succession: a 1 s fade in and a 4 s fade out last 5 s, the second starting at 1 s (20% of 5 s).
// - Succession in succession: 4 s, then (1 s, 4 s), then 1 s last 10 s; the inner pair starts at 4 s (40%), its second
//   part at 5 s (50%) and the last part at 9 s (90%). Cue lists don't nest, so the inner pair is written in line.
// - Exact durations: waits of 2.5 s, 1/3 s (8 frames at 24 fps, a whole number of flicks) and 0.25 s chain to
//   exactly their sum, with no rounding carried from one to the next.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, cueList, docId, film, fl, present, presented, run, showTime, square, useFolders, useShow, windows, type JsonObject } from './helpers.ts';

const show = useShow();
const folder = useFolders();

interface Case { name: string; doc: JsonObject; ids: string[]; want: [number, number][] }
const cases: Case[] = [
  {
    name: 'scene time (test_scene_time)',
    doc: film('Scene time', [square('c'), square('s', [40, 0]), cueList([
      { id: 'hold', span: '2s' },
      { id: 'quick', kind: 'fade_in', targets: ['c'], span: '0.5s' },
      { id: 'long', kind: 'fade_in', targets: ['s'], span: '5s' },
    ])], 8),
    ids: ['hold', 'quick', 'long'],
    want: [[0, fl(2)], [fl(2), fl(2.5)], [fl(2.5), fl(7.5)]],
  },
  {
    name: 'succession (test_succession_timing)',
    doc: film('Succession', [square('line'), cueList([
      { id: 'in', kind: 'fade_in', targets: ['line'], span: '1s' },
      { id: 'out', kind: 'fade_out', targets: ['line'], span: '4s' },
    ])], 6),
    ids: ['in', 'out'],
    want: [[0, fl(1)], [fl(1), fl(5)]],
  },
  {
    name: 'succession in succession (test_succession_in_succession_timing)',
    doc: film('Succession in succession', [square('line'), cueList([
      { id: 'first', kind: 'fade_in', targets: ['line'], span: '4s' },
      { id: 'inner_in', kind: 'fade_in', targets: ['line'], span: '1s' },
      { id: 'inner_out', kind: 'fade_out', targets: ['line'], span: '4s' },
      { id: 'last', kind: 'fade_in', targets: ['line'], span: '1s' },
    ])], 11),
    ids: ['first', 'inner_in', 'inner_out', 'last'],
    want: [[0, fl(4)], [fl(4), fl(5)], [fl(5), fl(9)], [fl(9), fl(10)]],
  },
  {
    name: 'exact durations (TestLayout.test_nested_successions_keep_exact_durations)',
    doc: film('Exact durations', [square('sq'), cueList([{ id: 'a', span: '2.5s' }, { id: 'b', span: '8f' }, { id: 'c', span: '0.25s' }])], 4),
    ids: ['a', 'b', 'c'],
    want: [[0, fl(2.5)], [fl(2.5), fl(2.5) + 235_200_000], [fl(2.5) + 235_200_000, fl(2.5) + 235_200_000 + fl(0.25)]],
  },
];

describe(`${AC[1]} plays and waits laid end to end, as the upstream projects' tests time them`, () => {
  for (const [k, c] of cases.entries()) {
    it(`${AC[1]} ${c.name}: each cue starts where the one before it ends, and the list lasts the sum of its parts, exactly`, () => {
      const [reply] = run(show(), folder(), [present(docId(k + 1), c.doc)]);
      presented(reply!, c.name);
      const got = windows(reply!, c.ids, c.name);
      expect(got.map(([a, b]) => `${showTime(a)} to ${showTime(b)}`), `${c.name}: each cue's window, in flicks`).toEqual(c.want.map(([a, b]) => `${showTime(a)} to ${showTime(b)}`));
    }, TIMEOUT);
  }
});
