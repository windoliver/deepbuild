// AC1 #157.3b13ad66: "A 24 fps fixture with 4 black frames (0.167 s) fails film.blank naming them, and passes once that
// span is declared an exception"
// AC27 #157.96010227: "A 24 fps fixture whose 12 frames (0.5 s) show only the look's paper at luma 0.94, where an item
// failed to draw, fails film.blank naming them, which the dark-pixel rule alone passes; a title card of dark text on
// that paper passes, and a declared dip to white passes; a planted check that counts only pixels under the luma floor
// passes the paper frames and fails, naming the first"
//
// Through `deep-show run`'s `export` (README: `export`). film.blank runs on every film export with no brief; a FAIL is
// `{outcome: "failed", issues: [{check: "film.blank", frames, …}]}` with nothing written. An exception is the
// document's own check input, `checks: [{kind: "film.blank", except: [[from, to]]}]` (flicks, half open). AC1's film:
// 160 × 90 at 24 fps, 2 s, a full-frame black rect shown only on frames 24 to 27. AC27's film: 160 × 90 at 24 fps, 3 s,
// on a look whose ground, the paper, is #f0f0f0 (luma 240 of 255, 0.94): an ink block drawn on frames 0 to 23 and 52
// to 71 and left out on 24 to 35 (the item that failed to draw), a title card of dark text on the paper on 36 to 47,
// and a declared dip to white on 48 to 51. Planted: `blank_counts_dark_only`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, COLOURS, FULL, H264_AAC, TIMEOUT, exportCall, failsNaming, filmDoc, filmRun, frameFlicks, framesNamed, holdFrames, issueLines, issuesOf, leftIn,
  lookOf, luma, none, order, receiptOf, rect, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const D = frameFlicks([24, 1]);
const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);

/** One export of `document` into a fresh folder: the reply and the folder. */
function exportOf(document: (evidence: string) => JsonObject, what: string, planted?: Planted): { reply: JsonObject; dir: string } {
  const evidence = temp(); const dir = temp();
  const [reply] = filmRun(shows.bin(FULL), evidence, document(evidence), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC })], what, planted);
  return { reply: reply!, dir };
}
/** The judge: the export FAILs film.blank naming exactly `blank` and writes nothing. Each failure starts
 * `film.blank: frame <first frame it is about>`. */
function blankFailures(reply: JsonObject, dir: string, blank: number[], what: string): string[] {
  if (reply['outcome'] === 'exported') return [`film.blank: frame ${blank[0]}: ${what}: frames ${blank[0]} to ${blank[blank.length - 1]} are blank, and the export was delivered`];
  const named = new Set(issuesOf(reply, 'film.blank').flatMap(framesNamed));
  const f: string[] = [];
  const missing = blank.filter((k) => !named.has(k));
  const extra = [...named].filter((k) => !blank.includes(k)).sort((a, b) => a - b);
  if (missing.length) f.push(`film.blank: frame ${missing[0]}: ${what}: film.blank doesn't name frames ${missing.join(', ')}; the reply: ${issueLines(reply).join(' | ').slice(0, 800)}`);
  if (extra.length) f.push(`film.blank: frame ${extra[0]}: ${what}: film.blank names frames ${extra.join(', ')}, which aren't blank`);
  if (reply['outcome'] !== 'failed') f.push(`film.blank: ${what}: the outcome is ${String(reply['outcome'])}, not failed`);
  const left = leftIn(dir);
  if (left.length) f.push(`film.blank: ${what}: the FAILed export left ${left.join(', ')}`);
  return f;
}

/** AC1's film: frames 24 to 27 black, the span declared or not. */
const blackFilm = (declared: boolean) => (evidence: string): JsonObject => filmDoc(evidence, {
  frames: 48,
  items: [rect('blackout', [0, 0, 160, 90], 'black', 10, { adjust: { opacity: 0 } })],
  channels: { blackout: holdFrames('items/blackout/adjust/opacity', [24, 1], [[0, 0], [24, 1], [28, 0]]) },
  ...(declared ? { checks: [{ kind: 'film.blank', except: [[24 * D, 28 * D]] }] } : {}),
});

describe(`${AC[1]} four black frames fail film.blank, and pass once declared`, () => {
  it(`${AC[1]} a 24 fps film with black frames 24 to 27 (0.167 s) FAILs film.blank naming exactly them and writes nothing; with [24, 28) declared an exception it is delivered`, () => {
    expect(luma(COLOURS.black), 'the black frames are at luma 0, under the 0.06 floor').toBe(0);
    const bare = exportOf(blackFilm(false), 'the film with four black frames');
    none(blankFailures(bare.reply, bare.dir, range(24, 28), 'the four black frames'), 'film.blank on four black frames');
    const declared = exportOf(blackFilm(true), 'the same film with the span declared');
    const r = receiptOf(declared.reply, 'the film with its black span declared');
    expect(r.frame_hashes.length, 'all 48 frames are delivered').toBe(48);
  }, TIMEOUT);
});

/** AC27's film on the paper look: the block left out on frames 24 to 35 when `gap`, else drawn through 35. */
const paperFilm = (gap: boolean) => (evidence: string): JsonObject => {
  const look = lookOf('paper-157', { ground: COLOURS.paper });
  const rate: [number, number] = [24, 1];
  return filmDoc(evidence, {
    frames: 72, look, plain: true,
    items: [
      rect('paper', [0, 0, 160, 90], 'ground', 1),
      rect('block', [20, 25, 40, 40], 'ink', 2),
      { id: 'title', kind: 'text@1', name: 'Text title', order: order(3), params: { text: 'TITLE', font: 'body', size: 44, box: { w: 160, h: 60 }, align: 'center' }, at: { pos: [0, 15, 0] }, adjust: { opacity: 0 } },
      rect('dip', [0, 0, 160, 90], 'white', 4, { adjust: { opacity: 0 } }),
    ],
    channels: {
      block: holdFrames('items/block/adjust/opacity', rate, gap ? [[0, 1], [24, 0], [52, 1]] : [[0, 1], [36, 0], [52, 1]]),
      title: holdFrames('items/title/adjust/opacity', rate, [[0, 0], [36, 1], [48, 0]]),
      dip: holdFrames('items/dip/adjust/opacity', rate, [[0, 0], [48, 1], [52, 0]]),
    },
    checks: [{ kind: 'film.blank', except: [[48 * D, 52 * D]] }],
  });
};

describe(`${AC[27]} a frame of only paper is blank too, by the flat rule`, () => {
  it(`${AC[27]} 12 frames (24 to 35) of only the paper at luma 0.94 FAIL film.blank naming exactly them; the title card (36 to 47) and the declared dip to white (48 to 51) aren't named; the same film with the block drawn through is delivered`, () => {
    expect(Math.round(luma(COLOURS.paper)), 'the paper is luma 240 of 255 (0.94), far over the dark floor of 0.06').toBe(240);
    const gap = exportOf(paperFilm(true), 'the film whose block fails to draw on 24 to 35');
    none(blankFailures(gap.reply, gap.dir, range(24, 36), 'the paper frames'), 'film.blank on the paper frames');
    const whole = exportOf(paperFilm(false), 'the same film with the block drawn');
    expect(receiptOf(whole.reply, 'the film with the title card and the declared dip').frame_hashes.length, 'all 72 frames are delivered').toBe(72);
  }, TIMEOUT);

  it(`${AC[27]} a planted check that counts only pixels under the luma floor passes the paper frames and fails, naming the first`, () => {
    const { reply, dir } = exportOf(paperFilm(true), 'the film whose block fails to draw on 24 to 35', 'blank_counts_dark_only');
    failsNaming(blankFailures(reply, dir, range(24, 36), 'the paper frames'), /^film\.blank: frame 24\b/, 'the planted check (blank_counts_dark_only)');
  }, TIMEOUT);
});
