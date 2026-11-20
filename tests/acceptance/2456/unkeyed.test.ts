// AC2 #2456.3ee39994: "A text with no channel on its reveal draws as it does today."
//
// Through `deep-show run` (README: The surface under test). Four films, 640 × 360 u over 3 s, none holding a channel,
// each the same text `tx`, "Hello there" in the body role at 64 u, ink fill, at (40, 140): `zero`, `half` and `whole`
// with `params.reveal` written as `{mode: fade, order: reading, progress}` at 0, 0.5 and 1, and `plain` with no reveal.
// Each is shown from your shell, then drawn by `eval` with `pixels` at 0.5 s, 1.5 s and 2.5 s, the times AC1 reads.
//
// Today (the issue: "the text layout reads the reveal from the item as written") a text whose reveal no channel keys
// draws at the progress its document writes, at every time, by the design's schedule (n = 11, lag = 0.2, w = 1/3): at 0
// none of its graphemes, at 0.5 each by its share (1, 1, 1, 0.9, 0.7, 0.5 for the space, 0.3, 0.1, 0, 0, 0), at 1 all;
// and a text with no reveal draws whole, the same at every time (README: Readings).
//
// Test 1. At each of the three times, read against `plain`'s frame at that time as AC1 reads (README: Readings), `zero`
// draws none of its graphemes, `half` each by its share at 0.5 and `whole` all; and `plain` draws the same frame at
// the three times, every pixel within 2 code values. Wrong programs: a reveal no channel keys read as progress 0, or as
// 1, or dropped (drawn whole); a written progress that runs with time; a text with no reveal given one.
//
// Test 2 (planted). Frames drawn at another progress than the one written fail the same judge at every time: `zero`'s
// frames read as `whole`'s (a reveal no channel keys read as progress 0) and `whole`'s as `half`'s (a reveal dropped).
import { describe, expect, it } from 'vitest';
import { AC, PLAIN, TEXT, TIMEOUT, TIMES, codeDiff, cut, drawAll, drawnBy, none, once, pixel, sharesAt, showTime, unkeyed, useFolders, useShow } from './helpers.ts';

const show = useShow();
const folder = useFolders();

/** Each film's progress as written. */
const WRITTEN = { zero: 0, half: 0.5, whole: 1 } as const;
const drawn = once(() => drawAll(show(), folder(), { zero: unkeyed(WRITTEN.zero), half: unkeyed(WRITTEN.half), whole: unkeyed(WRITTEN.whole), plain: PLAIN }));

/** Each way the film `name`'s frames fail to draw the text by its shares at `progress`, at every time. */
function judged(name: string, progress: number): string[][] {
  const { frames } = drawn();
  return TIMES.map((t, k) => drawnBy(
    frames[name]![k]!, cut(frames['plain']![k]!, `the plain film at ${showTime(t)}`), sharesAt(TEXT, progress),
    `the ${name} film at ${showTime(t)} read at progress ${progress}`,
  ));
}

describe(`${AC[2]} a text with no channel on its reveal draws as it does today`, () => {
  it(`${AC[2]} reveals no channel keys draw at their written progress 0, 0.5 and 1 at every time, and a text with no reveal draws the same frame at every time`, () => {
    const failures = Object.entries(WRITTEN).flatMap(([name, p]) => judged(name, p).flat());
    const plain = drawn().frames['plain']!;
    TIMES.forEach((t, k) => {
      if (k === 0) return;
      if (plain[k]!.width !== plain[0]!.width || plain[k]!.height !== plain[0]!.height) { failures.push(`the plain film at ${showTime(t)} is ${plain[k]!.width} × ${plain[k]!.height}, at ${showTime(TIMES[0])} ${plain[0]!.width} × ${plain[0]!.height}`); return; }
      let off = 0; let worst = 0;
      for (let y = 0; y < plain[0]!.height; y++) {
        for (let x = 0; x < plain[0]!.width; x++) {
          const d = codeDiff(pixel(plain[k]!, x, y), pixel(plain[0]!, x, y));
          if (d > 2) off++;
          worst = Math.max(worst, d);
        }
      }
      if (off > 0) failures.push(`the plain film at ${showTime(t)}: ${off} pixels differ from its frame at ${showTime(TIMES[0])} by more than 2 code values (up to ${worst})`);
    });
    none(failures, 'texts whose reveal no channel keys draw at their written progress at every time, and a text with no reveal the same frame');
  }, TIMEOUT);

  it(`${AC[2]} (planted) frames drawn at another progress than the one written fail, at every time`, () => {
    const asWhole = judged('zero', WRITTEN.whole);
    const asHalf = judged('whole', WRITTEN.half);
    TIMES.forEach((t, k) => {
      expect(asWhole[k]!.length, `the zero film's frame at ${showTime(t)}, read as the whole film's (a reveal no channel keys read as progress 0), fails`).toBeGreaterThan(0);
      expect(asHalf[k]!.length, `the whole film's frame at ${showTime(t)}, read as the half film's (a reveal dropped), fails`).toBeGreaterThan(0);
    });
  }, TIMEOUT);
});
