// AC1 #507.0907f6fa: "In a 50 s film with a stage marker at 8 s that waits for a two-option choice (A plays on; B goes
// on at a marker at 21 s), a `goto` at 20 s to 30 s, three questions that wait at 33, 37 and 41 s, and a counter of right
// answers from 45 s, picking B and answering two of the three right plays the timeline over [0, 8 s] then [21, 50 s]
// and shows 2 when it reaches 46 s, whether reached by playing or by seeking the clock; an export of that input track
// renders exactly those two ranges, holding at each waiting marker as long as the film audit's hold rule asks; and a
// `then` that names a marker at 5 s, a waiting control of class view and a stage marker inside a narration line are
// each refused, naming them"
//
// The film is helpers.ts `quizFilm` (README: Fixtures). The input track: B at 10 s (the timeline held at 8 s since 8 s),
// question 1 answered right (a) at 24 s, question 2 wrong (a) at 30 s, question 3 right (a) at 35 s. By the design's fold
// (Marker: present mode) the position is the clock to 8 s, 8 s until 10 s, then 21 s on until 33 s at 22 s, held to 24 s,
// on to 37 s at 28 s, held to 30 s, on to 41 s at 34 s, held to 35 s, then on: 46 s at 40 s. The goto at 20 s lies before
// 21 s, so path B never meets it. Wrong programs the assertions fail: a timeline that plays through a waiting marker,
// takes A's path, follows the goto, counts the wrong answer or reads a seek other than a play; an export that plays the
// whole film, holds for the recorded times or a fixed time, or cuts a hold short; a check that lets any of the three
// faults through, or refuses without naming it.
import { describe, expect, it } from 'vitest';
import {
  DOC, FLICKS, QUIZ_FPS, QUIZ_TEXT, TIMEOUT, WAITS, arr, entry, fl, int, mentions, narratedFilm, none, numbersIn, obj, plainScenario,
  present, presented, quizFilm, runShow, secs, show, str, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const ID = 'AC1 #507.0907f6fa';
const bin = useShow();
const temp = useTemp();

/** The recorded input track: B, then a right, a wrong and a right answer. */
const TRACK: JsonObject[] = [entry(fl(10), 'path', 'B'), entry(fl(24), 'q1', 'a'), entry(fl(30), 'q2', 'a'), entry(fl(35), 'q3', 'a')];
/** Where the timeline goes on after each waiting marker's entry on this track (B's marker; the questions play on). */
const ON = [{ at: 8, entry: 10, to: 21 }, { at: 33, entry: 24, to: 33 }, { at: 37, entry: 30, to: 37 }, { at: 41, entry: 35, to: 41 }];
/** The position at clock time c s by the design's fold. */
function fold(c: number): number {
  let clock = 0; let p = 0;
  for (const w of ON) {
    const arrive = clock + (w.at - p);
    if (c < arrive) return p + (c - clock);
    if (c < w.entry) return w.at;
    clock = w.entry; p = w.to;
  }
  return Math.min(p + (c - clock), 50);
}
/** Clock times on every stretch of the path: playing to 8 s, held, after the jump, at and between the questions, at 46 s. */
const CLOCKS = [4, 9, 10.5, 15, 23, 26, 29, 31.5, 34.5, 40, 43];

describe(`${ID} the branching film: its path played and sought, its export, and the three faults refused`, () => {
  it(`${ID} picking B and answering two of three right plays [0, 8 s] then [21, 50 s] and shows 2 at 46 s, played and sought alike`, () => {
    const ev = temp();
    const replies = runShow(bin(), plainScenario(ev, [DOC.quiz], [
      present(DOC.quiz, quizFilm()),
      { call: 'determinism', doc: DOC.quiz, display_hz: QUIZ_FPS, at_times: CLOCKS.map(fl), track: TRACK },
    ]), 'the quiz film played and sought on its track');
    presented(replies[0], 'the quiz film');
    const d = obj(replies[1], 'determinism');
    expect(d['outcome'], `determinism compares: ${show(d)}`).toBe('compared');
    const frames = arr(d['frames'], 'determinism: frames').map((f, i) => obj(f, `determinism: frames[${i}]`));
    expect(frames.map((f) => f['t']), 'one frame per clock time, in order').toEqual(CLOCKS.map(fl));
    const failures: string[] = [];
    frames.forEach((f, i) => {
      const c = CLOCKS[i]!;
      const want = fl(fold(c));
      for (const side of ['play', 'seek'] as const) {
        const s = obj(f[side], `the ${side} side at ${c} s`);
        const got = int(s['position'], `the ${side} side's position at ${c} s`);
        if (got !== want) failures.push(`${side}ed to the clock's ${c} s the timeline is at ${secs(got)}, not ${secs(want)}`);
      }
      if (obj(f['play'], 'play')['pixel_hash'] !== obj(f['seek'], 'seek')['pixel_hash']) failures.push(`at the clock's ${c} s the frame played differs from the frame sought`);
      if (fold(c) >= 46) {
        for (const side of ['play', 'seek'] as const) {
          const shown = str(obj(obj(f[side], side)['texts'], `the ${side} side's texts at ${c} s`)['score'], `the counter's text, ${side}ed to ${c} s`);
          if (JSON.stringify(numbersIn(shown)) !== '[2]') failures.push(`${side}ed to the clock's ${c} s (timeline ${fold(c)} s) the counter shows ${JSON.stringify(shown)}, not 2`);
        }
      }
    });
    none(failures, 'the timeline on the recorded track');
  }, TIMEOUT);

  it(`${ID} the export of that track renders [0, 8 s] then [21, 50 s], holding at each waiting marker for the hold rule's time`, () => {
    const ev = temp(); const out = temp();
    const frame = FLICKS / QUIZ_FPS;
    // The film audit's hold rule (Film audit: hold): max(1.5 s, 1.5 s + graphemes ÷ 15 a second), whitespace never
    // counted; every text here has 39 or more, so its hold passes 4 s and a title card's minimum never decides it.
    const holdFrames = (words: string): number => {
      const n = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(words)].filter((s) => !/^\s+$/u.test(s.segment)).length;
      const need = Math.max(fl(1.5), fl(1.5) + (n * FLICKS) / 15);
      expect(need, `the hold for ${JSON.stringify(words)} passes the title card's 4 s`).toBeGreaterThan(fl(4));
      return Math.ceil(need / frame);
    };
    // The path the export plays, as reference frames (tenths of the timeline): the clock's frames to each waiting marker,
    // that marker's frame for its hold, then on from where its option goes (B: 21 s; a question: the marker itself).
    const path: number[] = [];
    let p = 0;
    for (const w of WAITS) {
      while (p < w.t * QUIZ_FPS) path.push(p++);
      for (let i = 0; i < holdFrames(QUIZ_TEXT[w.text]); i++) path.push(w.t * QUIZ_FPS);
      p = w.marker === 'fork' ? 21 * QUIZ_FPS : w.t * QUIZ_FPS;
    }
    while (p < 50 * QUIZ_FPS) path.push(p++);
    const exp = (doc: string, dir: string, track?: JsonObject[]): JsonObject =>
      ({ call: 'export', doc, out: dir, video: { codec: 'png_seq' }, frame_rate: [QUIZ_FPS, 1], ...(track ? { track } : {}) });
    const [refOut, gotOut] = [`${out}/plain`, `${out}/branch`];
    const replies = runShow(bin(), plainScenario(ev, [DOC.quiz, DOC.plain], [
      present(DOC.quiz, quizFilm()), present(DOC.plain, quizFilm({ plain: { q1: 'a', q2: 'a', q3: 'a' } })),
      exp(DOC.plain, refOut), exp(DOC.quiz, gotOut, TRACK),
    ]), 'the quiz film exported on its track, beside the film played straight');
    presented(replies[0], 'the quiz film'); presented(replies[1], 'the film played straight');
    const hashes = (r: JsonObject | undefined, what: string): string[] => {
      expect(obj(r, what)['outcome'], `${what} is exported: ${show(r)}`).toBe('exported');
      return arr(obj(r!['receipt'], `${what}: receipt`)['frame_hashes'], `${what}: receipt.frame_hashes`).map((h, i) => str(h, `${what}: frame_hashes[${i}]`));
    };
    const ref = hashes(replies[2], 'the film played straight');
    const got = hashes(replies[3], 'the branching export');
    expect(ref.length, 'the film played straight is 500 frames at 10 fps').toBe(500);
    expect(new Set(ref).size, 'every frame of the timeline differs from the others (the fixture tells positions apart)').toBe(500);
    const at = new Map(ref.map((h, k) => [h, k]));
    const failures: string[] = [];
    if (got.length !== path.length) failures.push(`the export is ${got.length} frames, not ${path.length} (${path.length / QUIZ_FPS} s)`);
    for (let k = 0; k < Math.min(got.length, path.length) && failures.length < 12; k++) {
      if (got[k] === ref[path[k]!]) continue;
      const shows = at.get(got[k]!);
      failures.push(`export frame ${k} (${(k / QUIZ_FPS).toFixed(1)} s) shows ${shows === undefined ? 'a frame the timeline never shows' : `the timeline at ${(shows / QUIZ_FPS).toFixed(1)} s`}, not ${(path[k]! / QUIZ_FPS).toFixed(1)} s`);
    }
    none(failures, 'the export of the recorded track');
  }, TIMEOUT);

  it(`${ID} a then to a marker at 5 s, a waiting control of class view and a stage inside a narration line are each refused, naming it`, () => {
    const ev = temp();
    const replies = runShow(bin(), plainScenario(ev, [DOC.quiz, DOC.narrated], [
      present(DOC.quiz, quizFilm({ earlyThen: true })),
      present(DOC.quiz, quizFilm({ viewWait: true })),
      present(DOC.quiz, quizFilm()),
      present(DOC.narrated, narratedFilm(ev, 11.5)),
      present(DOC.narrated, narratedFilm(ev, 14)),
    ]), 'the three faults and their fixed twins');
    const refusedNaming = (r: JsonObject | undefined, names: string[], what: string): string[] => {
      const o = obj(r, what);
      if (o['outcome'] !== 'refused') return [`${what} is not refused: ${show(o)}`];
      const text = JSON.stringify(o);
      return names.filter((n) => !(n === 'then' ? /\bthen\b/.test(text) : mentions(o, n))).map((n) => `${what} is refused without naming ${n}: ${show(o)}`);
    };
    none([
      ...refusedNaming(replies[0], ['fork', 'then'], "the fork's then naming the marker at 5 s"),
      ...refusedNaming(replies[1], ['viewer_pick'], 'the fork waiting for the view-class choice viewer_pick'),
      ...refusedNaming(replies[3], ['inside'], 'the stage marker inside, at 11.5 s inside the line spoken over [10.2 s, 12.8 s)'),
    ], 'the three faults');
    presented(replies[2], 'the quiz film, its then naming 21 s and its controls of class document');
    presented(replies[4], 'the narrated film with its stage marker at 14 s, after the line');
  }, TIMEOUT);
});
