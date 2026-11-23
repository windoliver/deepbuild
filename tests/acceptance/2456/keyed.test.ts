// AC1 #2456.6a4fab33: "A text whose `reveal.progress` a channel keys draws none of its graphemes at progress 0, each
// grapheme by its share at 0.5, and all at 1, read from the canvas's own frames."
//
// Through `deep-show run` (README: The surface under test). The issue's film, 640 × 360 u over 3 s: `tx`, "Hello there"
// (11 graphemes, the space one of them) in the body role at 64 u, ink fill, at (40, 140), its `params.reveal` written
// as `{mode: fade, order: reading, progress: 1}`, and a channel on `items/tx/params/reveal/progress` keyed 0 at 1 s and
// 1 at 2 s, linear. The plain film holds the same text with no reveal; the written film the same reveal with no
// channel. Each film is shown from your shell, then drawn by `eval` with `pixels` at 0.5 s, 1.5 s and 2.5 s, the keyed
// film's eval also reading the progress (`paths`), which must read 0, 0.5 and 1 there (else INCONCLUSIVE: the issue's
// own reading of this channel).
//
// The design's schedule (Text `text@1`): n = 11, lag = min(4 ÷ 11, 0.2) = 0.2, w = 1 ÷ (1 + 10 × 0.2) = 1/3, grapheme u
// revealing from u/15 of the progress; at 0.5 the shares are 1, 1, 1, 0.9, 0.7, 0.5 (the space), 0.3, 0.1, 0, 0, 0.
//
// Test 1. Each keyed frame, cut into one stripe per grapheme that draws by the plain frame at its time (README:
// Readings): at 0.5 s every stripe within 2 code values of the ground; at 1.5 s "H", "e" and "l" with all of the plain
// text's ink, "l" 0.9 of it, "o" 0.7, "t" 0.3 and "h" 0.1 (each within 0.05, and its solid pixels at that share within
// 0.1), "e", "r" and "e" none; at 2.5 s every grapheme with all of it. Wrong programs: the reveal drawn as written, whole
// at every time (the issue's bug); the reveal ignored; one share for every grapheme; units that skip the space (0.8,
// 0.6, 0.4 and 0.2 for "l", "o", "t" and "h"); the reading order reversed; a grapheme wiped on instead of faded.
//
// Test 2 (planted). The written film's frames are what a frame that draws the issue's reveal as written shows: judged as
// test 1 judges the keyed film's, they fail at progress 0 and 0.5, and pass at 1, so the judge can fail and still
// passes a text drawn whole.
import { describe, expect, it } from 'vitest';
import {
  AC, KEYED, PLAIN, PROGRESS, TEXT, TIMEOUT, TIMES, cut, drawAll, drawnBy, inconclusive, none, once, sharesAt, showTime, unkeyed, useFolders,
  useShow,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();

/** The progress the issue's channel holds at each of TIMES: 0 before its first key, 0.5 midway, 1 after its last. */
const PROGRESSES = [0, 0.5, 1] as const;
const drawn = once(() => drawAll(show(), folder(), { keyed: KEYED, written: unkeyed(1), plain: PLAIN }, 'keyed'));

/** Each way the film `name`'s frames fail to draw the text by its shares at PROGRESSES. */
function judged(name: string): string[][] {
  const { frames } = drawn();
  return TIMES.map((t, k) => drawnBy(
    frames[name]![k]!, cut(frames['plain']![k]!, `the plain film at ${showTime(t)}`), sharesAt(TEXT, PROGRESSES[k]!),
    `the ${name} film at ${showTime(t)} (progress ${PROGRESSES[k]})`,
  ));
}

describe(`${AC[1]} a text whose reveal a channel keys draws in its frames by the progress the frame evaluated`, () => {
  it(`${AC[1]} the keyed text draws none of its graphemes at progress 0, each by its share at 0.5 and all at 1, in the frames deep-show draws`, () => {
    const { progress } = drawn();
    TIMES.forEach((t, k) => {
      const p = progress[k];
      if (typeof p !== 'number' || !(Math.abs(p - PROGRESSES[k]!) <= 1e-9)) {
        inconclusive(`eval reads ${PROGRESS} = ${JSON.stringify(p)} at ${showTime(t)}, not ${PROGRESSES[k]}, so the frame there isn't at a progress the criterion names`);
      }
    });
    none(judged('keyed').flat(), 'the keyed text draws none of its graphemes at progress 0, each by its share at 0.5 and all at 1');
  }, TIMEOUT);

  it(`${AC[1]} (planted) frames that draw the reveal as written, whole at every time, fail at progress 0 and 0.5`, () => {
    const [at0, at05, at1] = judged('written');
    expect(at0!.length, 'drawn as written, the text fails "none of its graphemes at progress 0"').toBeGreaterThan(0);
    expect(at05!.length, 'drawn as written, the text fails "each grapheme by its share at 0.5"').toBeGreaterThan(0);
    none(at1!, 'drawn as written at progress 1, the whole text passes "all at 1"');
  }, TIMEOUT);
});
